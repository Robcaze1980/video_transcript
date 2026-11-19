/**
 * LV-019.B phase 2, piece C: durable, deduplicated alerts derived from the read-only pending report.
 * It writes ONLY to `billingPendingAlerts`. It never moves balance, never calls the Account service and never resolves
 * a billing row: an alert is cleared only after the row itself is read in a known terminal state, and otherwise stays
 * open for a human (piece D). There is no default age threshold: age alerts exist only when the owner supplies one.
 * Design: docs/specs/LV-019-B-conciliacion-fase2-barrido-diseno.md
 */
import {createHash} from 'node:crypto';
import type {DocumentReference,DocumentSnapshot,Firestore} from 'firebase-admin/firestore';
import {PENDING_SOURCES,buildPendingReport,normalizePending,type PendingKind,type PendingReport,type ReportRow} from './billingPendingReport';

export const ALERT_COLLECTION='billingPendingAlerts';
export type AlertKind=PendingKind|'sweep';
export type AlertReason='needs_review'|'malformed'|'unknown_age'|'age'|'sweep_failed'|'sweep_review';
export const SWEEP_REASONS=['sweep_failed','sweep_review'] as const;
export interface AlertPolicy{/** Owner-chosen, positive integer milliseconds. Absent = no age alerts. */ageThresholdMs?:number}

const nonNegativeInteger=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
/** A state change or a different reason is a different alert, so it can never hide inside an older one. */
export function alertKey(kind:AlertKind,rowId:string,state:string,reason:AlertReason):string{
  return createHash('sha256').update(JSON.stringify(['billing-pending-alert-v1',kind,rowId,state,reason])).digest('hex');
}
function reasonFor(row:ReportRow,threshold:number|undefined):AlertReason|null{
  if(row.attention!=='pending')return row.attention;
  if(threshold!==undefined&&row.ageMs!==null&&row.ageMs>=threshold)return 'age';
  return null;
}
/** A row id is read back into a document path, so it must be a plain document id: never a path or a dot segment. */
const safeDocId=(value:unknown):value is string=>typeof value==='string'&&value.length>=1&&Buffer.byteLength(value)<=1500&&!/[\/\u0000-\u001f\u007f]/.test(value)&&value!=='.'&&value!=='..';
function validAlertShape(data:Record<string,unknown>|undefined,key:string){
  return !!data&&data.alertKey===key&&safeDocId(data.rowId)&&['open','cleared','superseded','dispositioned'].includes(String(data.status))&&nonNegativeInteger(data.seenCount)&&data.seenCount>=1&&nonNegativeInteger(data.firstSeenAtMs)&&nonNegativeInteger(data.lastSeenAtMs)&&data.lastSeenAtMs>=data.firstSeenAtMs;
}
/** Identity of a stored alert, or null when its content does not match its key or its shape is invalid. */
export function alertIdentity(snap:{exists:boolean;id:string;data():unknown}):{kind:AlertKind;rowId:string;state:string;reason:AlertReason;status:string;accountId:string|null}|null{
  const d=snap.data() as Record<string,unknown>|undefined;
  if(!snap.exists||!d||typeof d.kind!=='string'||typeof d.rowId!=='string'||typeof d.state!=='string'||typeof d.reason!=='string'||typeof d.status!=='string')return null;
  if(alertKey(d.kind as AlertKind,d.rowId,d.state,d.reason as AlertReason)!==snap.id||!validAlertShape(d,snap.id))return null;
  return {kind:d.kind as AlertKind,rowId:d.rowId,state:d.state,reason:d.reason as AlertReason,status:d.status,accountId:typeof d.accountId==='string'?d.accountId:null};
}
/** Fresh, in-transaction view of an alert: 'raced' if no longer open, 'corrupt' if its content no longer matches its key. */
function openAlertState(snap:{exists:boolean;id:string;data():unknown}):'open'|'raced'|'corrupt'{
  const d=snap.data() as Record<string,unknown>|undefined;
  if(!snap.exists||d?.status!=='open')return 'raced';
  if(typeof d.kind!=='string'||typeof d.rowId!=='string'||typeof d.state!=='string'||typeof d.reason!=='string'||alertKey(d.kind as AlertKind,d.rowId,d.state,d.reason as AlertReason)!==snap.id||!validAlertShape(d,snap.id))return 'corrupt';
  return 'open';
}
/** One transaction per alert: under concurrency exactly one writer creates it, the others count a sighting. */
async function raiseOne(db:Firestore,root:DocumentReference,fields:{kind:AlertKind;rowId:string;state:string;reason:AlertReason;accountId:string|null},nowMs:number):Promise<'created'|'seen'>{
  const key=alertKey(fields.kind,fields.rowId,fields.state,fields.reason),ref=root.collection(ALERT_COLLECTION).doc(key);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists){
      tx.create(ref,{alertKey:key,...fields,status:'open',seenCount:1,firstSeenAtMs:nowMs,lastSeenAtMs:nowMs});
      return 'created' as const;
    }
    const data=snap.data() as Record<string,unknown>|undefined;
    if(!validAlertShape(data,key))throw new Error('Corrupt alert document');
    const base={seenCount:(data!.seenCount as number)+1,lastSeenAtMs:Math.max(nowMs,data!.lastSeenAtMs as number)};
    // A cleared or superseded alert whose exact condition comes back reopens WITH its history. A dispositioned one
    // (a human already decided this exact situation) only counts the sighting and keeps its status.
    if(data!.status==='cleared'||data!.status==='superseded'){
      const wasCleared=data!.status==='cleared',keep=(v:unknown)=>nonNegativeInteger(v)?v:null;
      tx.update(ref,{...base,status:'open',reopenCount:(nonNegativeInteger(data!.reopenCount)?data!.reopenCount:0)+1,
        previousClearedAtMs:wasCleared?keep(data!.clearedAtMs):keep(data!.previousClearedAtMs),
        previousSupersededAtMs:wasCleared?keep(data!.previousSupersededAtMs):keep(data!.supersededAtMs),
        clearedAtMs:null,observedState:null,supersededAtMs:null,supersededByKey:null});
    }else tx.update(ref,base);
    return 'seen' as const;
  });
}
/** Every row that needs attention gets one open alert; all rows are processed even if one alert document is corrupt. */
export async function raisePendingAlerts(db:Firestore,root:DocumentReference,report:PendingReport,nowMs:number,policy:AlertPolicy={}):Promise<{created:number;seen:number}>{
  if(!nonNegativeInteger(nowMs))throw new RangeError('invalid clock');
  const threshold=policy.ageThresholdMs;
  if(threshold!==undefined&&(!Number.isSafeInteger(threshold)||threshold<1))throw new RangeError('invalid age threshold');
  let created=0,seen=0;const failures:unknown[]=[];
  for(const row of report.rows){
    const reason=reasonFor(row,threshold);if(!reason)continue;
    try{(await raiseOne(db,root,{kind:row.kind,rowId:row.id,state:row.state,reason,accountId:row.accountId},nowMs))==='created'?created++:seen++;}
    catch(error){failures.push(error);}
  }
  if(failures.length)throw Object.assign(new AggregateError(failures,`${failures.length} alert(s) could not be raised`),{created,seen});
  return {created,seen};
}
/** A failed or unreviewed sweep is itself an alert: a loud failure with nobody listening is not observable. */
export async function raiseSweepAlert(db:Firestore,root:DocumentReference,code:string,nowMs:number):Promise<{created:boolean}>{
  if(!nonNegativeInteger(nowMs))throw new RangeError('invalid clock');
  if(!(SWEEP_REASONS as readonly string[]).includes(code))throw new RangeError('invalid sweep alert code');
  return {created:(await raiseOne(db,root,{kind:'sweep',rowId:'sweep',state:code,reason:code as AlertReason,accountId:null},nowMs))==='created'};
}
export interface ClearResult{
  /** Closed after a read INSIDE the closing transaction showed a known terminal state. */cleared:number;
  /** Closed because the row is still reported under a different state/reason whose own alert is already open. */superseded:number;
  /** Left open on purpose, no check possible or needed: sweep alerts, jobs (no verifiable terminal set), unchanged reported rows. */kept:number;
  /** Left open because the row could not be verified terminal (missing, unexpected or listed state) or no successor alert exists. */unverified:number;
  /** Left open because another writer changed the alert first. */raced:number;
  /** Alert documents whose key does not match their content; never modified. */corrupt:number;
}
/**
 * Closes an alert only when the row is no longer reported AND a read INSIDE the closing transaction shows a known
 * terminal state, or when the row moved to a different state/reason whose own alert is already open (superseded: a
 * statement about alerts, never about balance). Anything else stays open for a human.
 */
export async function clearResolvedAlerts(db:Firestore,root:DocumentReference,report:PendingReport,nowMs:number,policy:AlertPolicy={}):Promise<ClearResult>{
  if(!nonNegativeInteger(nowMs))throw new RangeError('invalid clock');
  const threshold=policy.ageThresholdMs;
  if(threshold!==undefined&&(!Number.isSafeInteger(threshold)||threshold<1))throw new RangeError('invalid age threshold');
  const reported=new Map(report.rows.map(r=>[r.kind+' '+r.id,r]));
  const out:ClearResult={cleared:0,superseded:0,kept:0,unverified:0,raced:0,corrupt:0};
  let last:DocumentSnapshot|null=null;
  try{
  for(;;){
    let query=root.collection(ALERT_COLLECTION).where('status','==','open').orderBy('__name__');
    if(last)query=query.startAfter(last);
    const page=await query.limit(200).get();
    for(const doc of page.docs){
      const alert=doc.data() as Record<string,unknown>,kind=alert.kind as AlertKind,rowId=alert.rowId,state=alert.state,reason=alert.reason;
      if(typeof rowId!=='string'||typeof state!=='string'||typeof reason!=='string'||doc.id!==alertKey(kind,rowId,state,reason as AlertReason)||!validAlertShape(alert,doc.id)){out.corrupt++;continue;}
      if(kind==='sweep'){out.kept++;continue;}
      const current=reported.get(kind+' '+rowId);
      if(current){
        const now=reasonFor(current,threshold);
        if(now===null||(current.state===state&&now===reason)){out.kept++;continue;}
        const successorRef=root.collection(ALERT_COLLECTION).doc(alertKey(kind,rowId,current.state,now));
        const source=PENDING_SOURCES.find(x=>x.kind===kind)!,rowRef=root.collection(source.collection).doc(rowId);
        const result=await db.runTransaction(async tx=>{
          const mine=await tx.get(doc.ref),successor=await tx.get(successorRef),rowSnap=await tx.get(rowRef);
          const fresh=openAlertState(mine);if(fresh!=='open')return fresh;
          const sd=successor.data() as Record<string,unknown>|undefined;
          // The successor must be a well-formed open alert for exactly this row, state and reason; otherwise attention could be lost.
          if(!successor.exists||openAlertState(successor)!=='open'||sd!.kind!==kind||sd!.rowId!==rowId||sd!.state!==current.state||sd!.reason!==now)return 'unverified' as const;
          // The row is re-read here: it must STILL be in the state and reason the successor describes.
          if(!rowSnap.exists)return 'unverified' as const;
          const live=buildPendingReport([normalizePending(kind as PendingKind,rowId,rowSnap.data() as Record<string,unknown>|undefined)],report.generatedAtMs).rows[0];
          if(live.state!==current.state||reasonFor(live,threshold)!==now)return 'unverified' as const;
          tx.update(doc.ref,{status:'superseded',supersededAtMs:nowMs,supersededByKey:successorRef.id});return 'superseded' as const;
        });
        out[result]++;continue;
      }
      const source=PENDING_SOURCES.find(s=>s.kind===kind);
      if(!source||source.terminalStates===null){out.kept++;continue;}
      // The decisive read of the row happens INSIDE the transaction, together with the alert: a row that went back
      // to a listed state (and an alert re-raised meanwhile) can never be closed by a stale earlier read.
      const rowRef=root.collection(source.collection).doc(rowId);
      const result=await db.runTransaction(async tx=>{
        const mine=await tx.get(doc.ref),rowSnap=await tx.get(rowRef);
        const fresh=openAlertState(mine);if(fresh!=='open')return fresh;
        const observed=rowSnap.exists?(rowSnap.data() as Record<string,unknown>|undefined)?.state:undefined;
        if(typeof observed!=='string'||!source.terminalStates!.includes(observed)||source.states.includes(observed))return 'unverified' as const;
        tx.update(doc.ref,{status:'cleared',clearedAtMs:nowMs,observedState:observed});return 'cleared' as const;
      });
      out[result]++;
    }
    if(page.docs.length<200)break;
    last=page.docs[page.docs.length-1];
  }
  }catch(error){
    // What was already closed is real: the counters travel on the error so a caller never reports less than happened.
    throw Object.assign(error instanceof Error?error:new Error('clear failed'),{partial:{...out}});
  }
  return out;
}
