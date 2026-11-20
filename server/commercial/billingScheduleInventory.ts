/**
 * LV-019.B: strictly read-only inventory of the scheduling field `nextAttemptAt` in the queue collections the billing drains select
 * from (intents, settlement outbox, hold outbox). It answers with COUNTS ONLY how many selectable rows are due, in the future, missing
 * the field or carrying an invalid one. That is the evidence needed to decide whether a date migration is needed at all
 * (docs/specs/LV-019-B-migracion-fechas-intenciones.md): Firestore drops a document without the ordering field from an ordered query,
 * and the batched selectors can hide a due row behind many future ones.
 * How the current selectors in firestoreBackend.ts treat a row's date (this is what `needsNumericDate` encodes):
 *  - billingIntents reserve_pending/release_pending (`pendingExternalBillingIntents`): the first 100 rows of each state by document
 *    id; a date that is not a safe integer counts as DUE, so a row without a date is still selected;
 *  - billingOutbox pending: the first 100 rows, selected whatever their date; retry_wait: selected only if `typeof date==='number'`
 *    and `date<=now` (`pendingExternalBilling`), so a row with no date or a non-number date is never selected;
 *  - billingHoldOutbox pending: a query on `nextAttemptAt<=now` (`pendingExternalHolds`), which a range filter never satisfies with an
 *    absent or non-number value.
 * `neverSelectedAtLeast` counts those rows (absent or non-number date in a state that needs a numeric one): AT LEAST that many rows are
 * never picked up by the current selectors. It is a lower bound: a numeric but unusable date (NaN, negative, fraction) is counted as
 * `invalid`, not here, because how Firestore orders NaN in a range filter is not relied upon.
 * It never writes, never reads a document by id, never calls the Account service and returns no id, account or value. It reads every
 * document of the three collections once (projected to the two fields it needs), so run it by hand and rarely; rows that change
 * while it reads can be counted once, twice or not at all for this run.
 */
import type {DocumentReference} from 'firebase-admin/firestore';

export interface ScheduledSource{collection:string;/** States the drains select by `nextAttemptAt` (firestoreBackend.ts selectors). */selectable:readonly string[];/** Subset whose selector needs a numeric date: without one the row is never selected. */needsNumericDate:readonly string[]}
export const SCHEDULED_SOURCES:readonly ScheduledSource[]=Object.freeze([
  {collection:'billingIntents',selectable:['reserve_pending','release_pending'],needsNumericDate:[]},
  {collection:'billingOutbox',selectable:['pending','retry_wait'],needsNumericDate:['retry_wait']},
  {collection:'billingHoldOutbox',selectable:['pending'],needsNumericDate:['pending']},
].map(source=>Object.freeze({collection:source.collection,selectable:Object.freeze([...source.selectable]),needsNumericDate:Object.freeze([...source.needsNumericDate])})));
export const INVENTORY_PAGE_SIZE=200,MAX_PAGE_SIZE=1000;

export interface StateSchedule{due:number;future:number;/** Field absent. */missing:number;/** Field present and a number, but not a non-negative safe integer (fraction, negative, NaN, infinite, out of range). */invalid:number;/** Field present but not a number (null, string, boolean, object...). */nonNumeric:number}
export interface CollectionInventory{collection:string;scanned:number;/** Documents whose `state` is absent, empty or not a string. */noState:number;/** Documents in a state the drains do not select by date (terminal or other). */otherStates:number;selectable:Record<string,StateSchedule>}
export interface ScheduleInventory{generatedAtMs:number;collections:CollectionInventory[];/** Largest number of FUTURE rows in any one selectable state: compare it with the selectors' batch limit. */maxFuturePerState:number;/** Lower bound of rows the current selectors never pick up (absent or non-number date where a numeric one is required). */neverSelectedAtLeast:number}

export type RowSchedule='noState'|'otherState'|{state:string;kind:'due'|'future'|'missing'|'invalid'|'nonNumeric'};
const validDate=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;

/** Pure: where one document falls. */
export function classifySchedule(data:Record<string,unknown>|undefined,nowMs:number,selectable:readonly string[]):RowSchedule{
  const state=data?.state;
  if(typeof state!=='string'||!state)return 'noState';
  if(!selectable.includes(state))return 'otherState';
  const value=data?.nextAttemptAt;
  if(value===undefined)return {state,kind:'missing'};
  if(typeof value!=='number')return {state,kind:'nonNumeric'};
  if(!validDate(value))return {state,kind:'invalid'};
  return {state,kind:value<=nowMs?'due':'future'};
}

export async function readScheduleInventory(root:DocumentReference,nowMs:number,options:{pageSize?:number}={}):Promise<ScheduleInventory>{
  if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new RangeError('invalid clock');
  const pageSize=options.pageSize??INVENTORY_PAGE_SIZE;
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>MAX_PAGE_SIZE)throw new RangeError('invalid page size');
  const collections:CollectionInventory[]=[];
  for(const source of SCHEDULED_SOURCES){
    const inventory:CollectionInventory={collection:source.collection,scanned:0,noState:0,otherStates:0,selectable:Object.fromEntries(source.selectable.map(state=>[state,{due:0,future:0,missing:0,invalid:0,nonNumeric:0}]))};
    let last:unknown;
    for(;;){
      let query=root.collection(source.collection).select('state','nextAttemptAt').orderBy('__name__');
      if(last!==undefined)query=query.startAfter(last);
      const page=await query.limit(pageSize).get();
      for(const doc of page.docs){
        inventory.scanned++;
        const row=classifySchedule(doc.data() as Record<string,unknown>|undefined,nowMs,source.selectable);
        if(row==='noState')inventory.noState++;else if(row==='otherState')inventory.otherStates++;else inventory.selectable[row.state][row.kind]++;
      }
      if(page.docs.length<pageSize)break;
      last=page.docs[page.docs.length-1];
    }
    collections.push(inventory);
  }
  const maxFuturePerState=Math.max(0,...collections.flatMap(c=>Object.values(c.selectable).map(s=>s.future)));
  const neverSelectedAtLeast=SCHEDULED_SOURCES.reduce((sum,source)=>sum+source.needsNumericDate.reduce((n,state)=>{const row=collections.find(c=>c.collection===source.collection)!.selectable[state];return n+row.missing+row.nonNumeric;},0),0);
  return {generatedAtMs:nowMs,collections,maxFuturePerState,neverSelectedAtLeast};
}
