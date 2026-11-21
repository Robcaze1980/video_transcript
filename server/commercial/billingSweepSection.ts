/**
 * LV-019.B phase 3 (plan step 3.4, A2): the cloud-ready sweep SECTION, an isolated sub-handler for the maintenance pass.
 * It runs the existing read-only report + durable alerts sweep (piece B+C) with its own time budget, its own outcome and
 * its own heartbeat, and it NEVER throws: any failure is reported as a value. It is OFF by default (`enabled` false).
 * The section and everything it imports transitively stay on the read/alert side: it must never import the write paths
 * (firestoreBackend, firestoreAi, accountBillingClient) nor the billing-mode modules, so the maintenance image cannot
 * move balance, drain queues or touch holds. A failing or slow sweep can neither change the status of the other
 * maintenance sections nor be counted as a failure of them.
 * The heartbeat is exactly one single-line JSON record per run, with the timestamps, the outcome and COUNTS ONLY: never
 * a row id, an account id or any row content.
 * One sweep runs at a time per root (the maintenance pass fires every 5 minutes, but the budget does NOT cancel the real
 * sweep): while a previous sweep is still in flight the new pass returns `skipped` and starts nothing, so a hung sweep
 * cannot pile up. The guard is released when the REAL sweep finishes, never when the budget expires. Consequence: after
 * a `timeout` the real sweep can finish later and write alerts; those writes are idempotent transactions, so the next
 * pass simply observes the same state.
 * Design: docs/specs/LV-019-B-conciliacion-fase2-barrido-diseno.md
 */
import {performance} from 'node:perf_hooks';
import type {DocumentReference,Firestore} from 'firebase-admin/firestore';
import {runPendingSweep} from './billingPendingSweep';
import {PENDING_SOURCES} from './billingPendingReport';

export type BillingSweepOutcome='ok'|'partial'|'error'|'timeout'|'disabled'|'skipped';
/** Default wall-clock budget of one pass; the maintenance pass passes its own (20 s). */
export const BILLING_SWEEP_BUDGET_MS=20000;
const MAX_BUDGET_MS=60000;
/** The only failure steps the underlying sweep can raise; anything else is not a step and is dropped. */
const STAGES=['read','raise','clear','review','alert'] as const;
type BillingSweepStage=typeof STAGES[number];
const isStage=(value:unknown):value is BillingSweepStage=>typeof value==='string'&&(STAGES as readonly string[]).includes(value);
const KINDS=PENDING_SOURCES.map(source=>source.kind as string);
export interface BillingSweepCounts{
  reported:number;attention:number;created:number;seen:number;cleared:number;superseded:number;kept:number;unverified:number;raced:number;corrupt:number;
  byKind:Record<string,number>;
}
export interface BillingSweepSectionResult extends BillingSweepCounts{outcome:BillingSweepOutcome;/** Only on a raised error, from the closed allow-list; never a message. */stage?:BillingSweepStage}
/** The sweep is injectable only to keep the section testable; the default is the real one. */
export type BillingSweepRunner=(db:Firestore,root:DocumentReference,nowMs:number)=>Promise<unknown>;
export interface BillingSweepSectionOptions{
  db:Firestore;root:DocumentReference;/** Clock value in epoch ms, also the sweep's `now`. */now:number;
  enabled?:boolean;budgetMs?:number;log?:(line:string)=>void;sweep?:BillingSweepRunner;
}
const TIMEOUT=Symbol('billing-sweep-timeout');
/** Roots whose real sweep is still running. Keyed by the stable document path so a second pass on the same root skips. */
const inFlight=new Set<string>();
let anonSeq=0;
const asRecord=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'?value as Record<string,unknown>:{};
/** Copies a count and nothing else: a negative, fractional, NaN or non-numeric value becomes 0. */
const count=(value:unknown):number=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.floor(value):0;
function countsFrom(source:unknown):BillingSweepCounts{
  const record=asRecord(source),byKind=asRecord(record.byKind);
  return {
    reported:count(record.reported),attention:count(record.attention),created:count(record.created),seen:count(record.seen),
    cleared:count(record.cleared),superseded:count(record.superseded),kept:count(record.kept),unverified:count(record.unverified),raced:count(record.raced),corrupt:count(record.corrupt),
    byKind:Object.fromEntries(KINDS.map(kind=>[kind,count(byKind[kind])])),
  };
}

export async function runBillingSweepSection(options:BillingSweepSectionOptions):Promise<BillingSweepSectionResult>{
  const {db,root,now,enabled=false,budgetMs=BILLING_SWEEP_BUDGET_MS,log=line=>console.log(line),sweep}=options;
  const started=performance.now();
  const emit=(outcome:BillingSweepOutcome,counts:BillingSweepCounts)=>{
    const line=JSON.stringify({event:'billing-sweep',startedAtMs:now,durationMs:Math.max(0,Math.round(performance.now()-started)),outcome,...counts});
    try{log(line);}catch{/* a broken logger must never break the pass */}
  };
  const finish=(outcome:BillingSweepOutcome,counts:BillingSweepCounts,stage?:BillingSweepStage):BillingSweepSectionResult=>{
    emit(outcome,counts);
    return stage===undefined?{outcome,...counts}:{outcome,stage,...counts};
  };
  if(!enabled)return finish('disabled',countsFrom(undefined));
  if(!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>MAX_BUDGET_MS)return finish('error',countsFrom(undefined));
  // Stable identity of the root; a real runtime root (a DocumentReference) always has a non-empty path. A root we cannot
  // name is never shared, so two unrelated roots can never wrongly block each other.
  const key=typeof root?.path==='string'&&root.path.length>0?root.path:'anonymous:'+(anonSeq++);
  // The guard is taken before the first await and released only when the REAL sweep settles, so a hung sweep is not re-armed.
  if(inFlight.has(key))return finish('skipped',countsFrom(undefined));
  inFlight.add(key);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const realRun=Promise.resolve()
    .then(()=>(sweep??((d:Firestore,r:DocumentReference,n:number)=>runPendingSweep(d,r,n)))(db,root,now))
    .finally(()=>{inFlight.delete(key);});
  // Attach a no-op catch so a rejected real sweep that outlives its budget can never be an unhandled rejection.
  realRun.catch(()=>undefined);
  try{
    const gate=new Promise<typeof TIMEOUT>(resolve=>{timer=setTimeout(()=>resolve(TIMEOUT),budgetMs);});
    const settled=await Promise.race([realRun,gate]);
    if(settled===TIMEOUT)return finish('timeout',countsFrom(undefined));
    const summary=asRecord(settled);
    if(typeof summary.ok!=='boolean')return finish('error',countsFrom(undefined));
    return finish(summary.ok?'ok':'partial',countsFrom(summary));
  }catch(error){
    const record=asRecord(error);
    return finish('error',countsFrom(record.summary),isStage(record.stage)?record.stage:undefined);
  }finally{
    if(timer!==undefined)clearTimeout(timer);
  }
}