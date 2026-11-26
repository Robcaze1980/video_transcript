/**
 * LV-019.B phase 2: LOCAL sweep chaining the read-only report (B) and the durable alerts (C).
 * It reads every non-terminal billing row, raises one alert per row that needs attention, and clears alerts whose row
 * is verifiably terminal. It never moves balance, never calls the Account service, never edits a billing row and never
 * resolves anything for a human (that is piece D).
 * Loud by construction: the promise RESOLVES only when every step succeeded. Any failure (including an alert document
 * found corrupt) leaves a durable `sweep_failed`/`sweep_review` alert AND rejects with a SweepError that carries the
 * partial summary, so a caller that ignores a return value cannot mistake a failed sweep for a good one.
 * Overlapping sweeps are safe: every alert write is an idempotent transaction. Nothing schedules or deploys this.
 * Design: docs/specs/LV-019-B-conciliacion-fase2-barrido-diseno.md
 */
import type {DocumentReference,Firestore} from 'firebase-admin/firestore';
import {clearResolvedAlerts,raisePendingAlerts,raiseSweepAlert,type AlertPolicy,type ClearResult} from './billingPendingAlerts';
import {readPendingReport,type PendingReport} from './billingPendingReport';

export type SweepStage='read'|'raise'|'clear'|'review'|'alert';
export interface SweepOptions{audit?:boolean;pageSize?:number;policy?:AlertPolicy}
export interface SweepSummary extends ClearResult{
  ok:boolean;generatedAtMs:number;reported:number;byKind:PendingReport['byKind'];attention:number;created:number;seen:number;failures:SweepStage[];
}
/** Carries only codes, a stage and the partial counts, never the underlying message (which could contain private detail). */
export class SweepError extends Error{
  constructor(readonly code:'sweep_failed'|'sweep_review',readonly stage:SweepStage,readonly alerted:boolean,readonly summary?:SweepSummary){super(`${code}:${stage}`);}
}
const zero=():ClearResult=>({cleared:0,superseded:0,kept:0,unverified:0,raced:0,corrupt:0});
const counters:Array<keyof ClearResult>=['cleared','superseded','kept','unverified','raced','corrupt'];
/** A rejection can be any value (undefined, a string...); reading a property of it must never throw inside a catch. */
const asRecord=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'?value as Record<string,unknown>:{};

export async function runPendingSweep(db:Firestore,root:DocumentReference,nowMs:number,options:SweepOptions={}):Promise<SweepSummary>{
  if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new RangeError('invalid clock');
  const pageSize=options.pageSize;
  if(pageSize!==undefined&&(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>500))throw new RangeError('invalid page size');
  const threshold=options.policy?.ageThresholdMs;
  if(threshold!==undefined&&(!Number.isSafeInteger(threshold)||threshold<1))throw new RangeError('invalid age threshold');
  const alertWith=async(code:'sweep_failed'|'sweep_review')=>{try{await raiseSweepAlert(db,root,code,nowMs);return true;}catch{return false;}};

  let report;
  try{report=await readPendingReport(root,nowMs,{pageSize,audit:options.audit});}
  catch{
    const alerted=await alertWith('sweep_failed');
    const byKind:PendingReport['byKind']={intent:0,terminal_recovery:0,hold:0,outbox:0,job_unknown:0,guard:0};
    throw new SweepError('sweep_failed','read',alerted,{ok:false,generatedAtMs:nowMs,reported:0,byKind,attention:0,created:0,seen:0,...zero(),failures:alerted?['read']:['read','alert']});
  }

  const failures:SweepStage[]=[];let created=0,seen=0,cleared=zero();
  try{({created,seen}=await raisePendingAlerts(db,root,report,nowMs,options.policy));}
  catch(error){
    failures.push('raise');
    // Rows that could be alerted were; the partial counts travel on the error so nothing is silently lost.
    const partial=asRecord(error);
    if(typeof partial.created==='number')created=partial.created;if(typeof partial.seen==='number')seen=partial.seen;
  }
  try{cleared=await clearResolvedAlerts(db,root,report,nowMs,options.policy);}
  catch(error){
    failures.push('clear');
    const partial=asRecord(asRecord(error).partial);
    for(const key of counters)if(typeof partial[key]==='number')cleared[key]=partial[key] as number;
  }
  // An alert document whose key does not match its content is an integrity problem that needs a person, not a retry.
  if(cleared.corrupt>0)failures.push('review');
  const hard=failures.some(f=>f!=='review'),review=failures.includes('review');
  let alerted=true;
  if(hard&&!await alertWith('sweep_failed'))alerted=false;
  if(review&&!await alertWith('sweep_review'))alerted=false;
  if(!alerted)failures.push('alert');
  const summary:SweepSummary={ok:failures.length===0,generatedAtMs:nowMs,reported:report.total,byKind:report.byKind,attention:report.attention.length,created,seen,...cleared,failures};
  if(!summary.ok)throw new SweepError(hard?'sweep_failed':'sweep_review',failures[0],alerted,summary);
  return summary;
}
