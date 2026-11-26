/**
 * LV-019.B phase 2, piece B: a strictly read-only report of every non-terminal
 * billing row (intents, terminal recovery, hold outbox, settlement outbox, unknown
 * jobs). It never writes, never calls the Account service and never moves balance.
 * Every non-terminal row is listed (cursor over all pages), so a due row cannot be
 * hidden behind future rows the way the batched selectors can.
 * Design: docs/specs/LV-019-B-conciliacion-fase2-barrido-diseno.md
 */
import type {DocumentReference,DocumentSnapshot} from 'firebase-admin/firestore';

export type PendingKind='intent'|'terminal_recovery'|'hold'|'outbox'|'job_unknown'|'guard';
export type PendingAttention='needs_review'|'malformed'|'unknown_age'|'pending';

/** `terminalStates` lets the opt-in audit tell a finished row from an unexpected one; null = audit not supported (jobs have too many valid states). */
export interface PendingSource{kind:PendingKind;collection:string;states:readonly string[];terminalStates:readonly string[]|null;/** A single equality field for sources without a `state` (the D-4 guard); served by Firestore's automatic single-field index. */filter?:{field:string;value:string|number|boolean}}
/** Only non-terminal states are ever queried; terminal ones (settled, applied, closed...) are absent on purpose. */
export const PENDING_SOURCES:readonly PendingSource[]=Object.freeze([
  {kind:'intent',collection:'billingIntents',states:['reserve_pending','release_pending','needs_review'],terminalStates:['closed','insufficient','job_created']},
  {kind:'terminal_recovery',collection:'billingIntentTerminalRecovery',states:['pending'],terminalStates:[]},
  {kind:'hold',collection:'billingHoldOutbox',states:['pending','needs_review'],terminalStates:['applied']},
  {kind:'outbox',collection:'billingOutbox',states:['pending','retry_wait','needs_review'],terminalStates:['settled']},
  {kind:'job_unknown',collection:'jobs',states:['unknown'],terminalStates:null},
  // LV-019.B D-4: one blocked account, one alert. `blocked == true` is one equality on one field, no composite index; the row has no `state`.
  {kind:'guard',collection:'billingGuards',states:[],terminalStates:[],filter:{field:'blocked',value:true}},
]);

export interface PendingRow{kind:PendingKind;id:string;state:string;createdAtMs:number|null;nextAttemptAt:number|null;attempts:number|null;lastErrorCode:string|null;accountId:string|null;malformed:boolean}
export interface ReportRow extends PendingRow{ageMs:number|null;attention:PendingAttention}
export interface PendingReport{generatedAtMs:number;total:number;byKind:Record<PendingKind,number>;oldest:ReportRow|null;attention:ReportRow[];rows:ReportRow[]}

const nonNegativeInteger=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The only codes the writers can store (firestoreBackend.ts failure recorders coerce anything else to 'unavailable'). */
const errorCode=/^(unavailable|insufficient|conflict|invalid|quota|not_found|forbidden|reserved_unconfirmed|closure_unverified)$/;

/** Copies only what an operator needs; identity keys, uids and emails are never copied. */
export function normalizePending(kind:PendingKind,id:string,data:Record<string,unknown>|undefined):PendingRow{
  const d=data&&typeof data==='object'?data:{};
  const state=typeof d.state==='string'&&d.state?d.state:'';
  const createdAtMs=nonNegativeInteger(d.createdAtMs)?d.createdAtMs:null;
  const present=(value:unknown)=>value!==undefined&&value!==null;
  const nextAttemptAt=nonNegativeInteger(d.nextAttemptAt)?d.nextAttemptAt:null;
  const attempts=nonNegativeInteger(d.attempts)?d.attempts:null;
  const lastErrorCode=typeof d.lastErrorCode==='string'&&errorCode.test(d.lastErrorCode)?d.lastErrorCode:null;
  const accountId=typeof d.accountId==='string'&&uuid.test(d.accountId)?d.accountId:null;
  const malformed=!data||typeof data!=='object'||!state||(present(d.createdAtMs)&&createdAtMs===null)||(present(d.nextAttemptAt)&&nextAttemptAt===null)||(present(d.attempts)&&attempts===null)||
    (present(d.lastErrorCode)&&lastErrorCode===null)||(present(d.accountId)&&accountId===null);
  if(kind==='guard'){
    // A blocked account is its own row. Its state carries the guard GENERATION, so an account blocked again after a release is a new
    // alert; a guard with neither incident nor hold ref cannot be attributed to anything and is malformed (the writers create incident
    // and hold in the same transaction). Since step 1.4b every writer stamps `epoch` (1, then +1 per new incident) AND `createdAtMs`,
    // and since the epoch restarts at 1 after the guard is deleted, the creation mark is part of the state: `blocked:<epoch>:<createdAtMs>`.
    // A guard written before 1.4b has NEITHER: it reads as the declared legacy generation `blocked:1:0`. An epoch or a createdAtMs that is
    // PRESENT and invalid is a malformed guard, never silently read as the legacy value.
    const hasEpoch=present(d.epoch),validEpoch=hasEpoch&&Number.isSafeInteger(d.epoch)&&(d.epoch as number)>=1,epoch=validEpoch?d.epoch as number:1;
    const hasCreated=present(d.createdAtMs),validCreated=hasCreated&&nonNegativeInteger(d.createdAtMs),createdAtMs=validCreated?d.createdAtMs as number:0;
    const guardAccount=typeof d.accountId==='string'&&uuid.test(d.accountId)?d.accountId:null,incident=present(d.lastIncidentId)||present(d.lastOutboxIncidentId);
    // The incident key is part of the state too: the epoch restarts at 1 when a released guard is recreated and the
    // creation mark can repeat within one millisecond, so the named incident is what makes a different block a different
    // alert (and a repeat sweep of the SAME incident identical). It is a public id, already visible on the guard.
    const incidentKey=typeof d.lastOutboxIncidentId==='string'?d.lastOutboxIncidentId:typeof d.lastIncidentId==='string'?d.lastIncidentId:'';
    // The guard row keeps no `createdAtMs` age of its own (the alert is raised as soon as it appears), but the mark is in its state.
    return {kind,id,state:'blocked:'+epoch+':'+createdAtMs+':'+incidentKey,createdAtMs:null,nextAttemptAt:null,attempts:null,lastErrorCode:null,accountId:guardAccount,
      malformed:!data||typeof data!=='object'||d.blocked!==true||guardAccount===null||!incident||(hasEpoch&&!validEpoch)||(hasCreated&&!validCreated)||hasEpoch!==hasCreated};
  }
  return {kind,id,state,createdAtMs,nextAttemptAt,attempts,lastErrorCode,accountId,malformed};
}

const kindOrder:Record<PendingKind,number>={intent:0,terminal_recovery:1,hold:2,outbox:3,job_unknown:4,guard:5};
function attentionOf(row:PendingRow):PendingAttention{
  if(row.malformed)return 'malformed';
  if(row.state==='needs_review'||row.state.startsWith('blocked:'))return 'needs_review';
  if(row.createdAtMs===null)return 'unknown_age';
  return 'pending';
}
/** Pure and deterministic: total order (unknown age first, then oldest, kind, id) and exact-duplicate removal. */
export function buildPendingReport(input:readonly PendingRow[],nowMs:number):PendingReport{
  if(!nonNegativeInteger(nowMs))throw new RangeError('invalid clock');
  const unique=new Map<string,PendingRow>();
  for(const row of input){const key=row.kind+'\u0000'+row.id;if(!unique.has(key))unique.set(key,row);}
  const rows:ReportRow[]=[...unique.values()].map(row=>({...row,ageMs:row.createdAtMs===null?null:Math.max(0,nowMs-row.createdAtMs),attention:attentionOf(row)}));
  rows.sort((a,b)=>{
    if((a.createdAtMs===null)!==(b.createdAtMs===null))return a.createdAtMs===null?-1:1;
    if(a.createdAtMs!==b.createdAtMs&&a.createdAtMs!==null&&b.createdAtMs!==null)return a.createdAtMs-b.createdAtMs;
    if(a.kind!==b.kind)return kindOrder[a.kind]-kindOrder[b.kind];
    return a.id<b.id?-1:a.id>b.id?1:0;
  });
  const byKind:Record<PendingKind,number>={intent:0,terminal_recovery:0,hold:0,outbox:0,job_unknown:0,guard:0};
  for(const row of rows)byKind[row.kind]++;
  return {generatedAtMs:nowMs,total:rows.length,byKind,oldest:rows.find(row=>row.createdAtMs!==null)??null,attention:rows.filter(row=>row.attention!=='pending'),rows};
}

/**
 * Exhaustive read. Default mode: one EQUALITY query per source and listed non-terminal state, paged by document id.
 * Equality + `orderBy('__name__')` is served by Firestore's automatic single-field index, so no composite index has to be
 * deployed (an `in` filter combined with that ordering is not documented as covered, so it is deliberately not used).
 * A row that changes state while the sweep is reading may be seen twice (deduplicated) or missed for this sweep only. KNOWN LIMIT: a document whose `state` is missing, not a string or not listed cannot be matched by that
 * query. `audit:true` closes that gap at the cost of reading every document of the audited collections: anything that
 * is neither a listed non-terminal state nor a known terminal one becomes a malformed row. Run it rarely.
 */
export async function readPendingReport(root:DocumentReference,nowMs:number,options:{pageSize?:number;audit?:boolean}={}):Promise<PendingReport>{
  const pageSize=options.pageSize??200;
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>500)throw new RangeError('invalid page size');
  const rows:PendingRow[]=[];
  for(const source of PENDING_SOURCES){
    const audit=options.audit===true&&source.terminalStates!==null;
    const terminal=new Set(source.terminalStates??[]),listed=new Set(source.states),filter=source.filter;
    // A filtered source (the guard) has no `state`: one equality on one field, paged by document id, in both modes.
    if(filter){
      let lastFiltered:DocumentSnapshot|null=null;
      for(;;){
        let query=root.collection(source.collection).where(filter.field,'==',filter.value).orderBy('__name__');
        if(lastFiltered)query=query.startAfter(lastFiltered);
        const page=await query.limit(pageSize).get();
        for(const doc of page.docs)rows.push(normalizePending(source.kind,doc.id,doc.data() as Record<string,unknown>|undefined));
        if(page.docs.length<pageSize)break;
        lastFiltered=page.docs[page.docs.length-1];
      }
      continue;
    }
    // Audit mode scans the whole collection once; the default mode runs one equality query per listed state.
    for(const only of audit?[null]:source.states){
      let last:DocumentSnapshot|null=null;
      for(;;){
        const base=root.collection(source.collection);
        let query=only===null?base.orderBy('__name__'):base.where('state','==',only).orderBy('__name__');
        if(last)query=query.startAfter(last);
        const page=await query.limit(pageSize).get();
        for(const doc of page.docs){
          const data=doc.data() as Record<string,unknown>|undefined,state=data?.state;
          if(audit&&typeof state==='string'&&terminal.has(state)&&!listed.has(state))continue;
          const row=normalizePending(source.kind,doc.id,data);
          rows.push(audit&&!(typeof state==='string'&&listed.has(state))?{...row,malformed:true}:row);
        }
        if(page.docs.length<pageSize)break;
        last=page.docs[page.docs.length-1];
      }
    }
  }
  return buildPendingReport(rows,nowMs);
}
