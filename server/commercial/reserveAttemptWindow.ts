import type { DocumentSnapshot } from 'firebase-admin/firestore';
import {
  RESERVE_ATTEMPT_DOCUMENTS,
  type ReserveAttemptDocumentName,
  type ReserveAttemptDocumentVersion,
  type ReserveAttemptEvidence,
  type ReserveAttemptVersions,
} from './reserveAttemptEvidence';

/**
 * LV-019.B step 1.3b design 3.2. The trusted caller supplies the snapshots it
 * re-read inside the job transaction. Documents nobody rewrites in the request
 * window must keep the exact version recorded before the Account POST; the
 * intent and the account carry only a semantic value; the guard may stay absent
 * or must not block this account. A mismatched pair of terminal rows is not a
 * clean history.
 *
 * This function is pure shape comparison: it does not authenticate the caller,
 * prove that the reads happened, or replace the A-3 release fence.
 */
export type ReserveAttemptWindowDocuments = Record<ReserveAttemptDocumentName, DocumentSnapshot>;

/**
 * Nobody rewrites these inside the request window, so the exact version recorded
 * before the POST must still hold when the job is written. `account`, `intent`
 * and `guard` are deliberately absent: their comparison is semantic below.
 */
export const RESERVE_ATTEMPT_IMMUTABLE_DOCUMENTS = Object.freeze([
  'identity', 'input', 'project', 'origin', 'intentGuard', 'request', 'jobMarker',
  'sealWitness', 'sealRecovery', 'releaseWitness', 'releaseRecovery',
] as const);

function documentVersion(doc:DocumentSnapshot):ReserveAttemptDocumentVersion|null{
  if(!doc.exists)return {exists:false};
  const encode=(value:DocumentSnapshot['createTime'])=>value&&Number.isSafeInteger(value.seconds)&&value.seconds>=0&&Number.isSafeInteger(value.nanoseconds)&&value.nanoseconds>=0&&value.nanoseconds<1_000_000_000?`${value.seconds}:${String(value.nanoseconds).padStart(9,'0')}`:null;
  const createTime=encode(doc.createTime),updateTime=encode(doc.updateTime);
  return createTime&&updateTime?{exists:true,createTime,updateTime}:null;
}
/** The four terminal rows come in witness/recovery pairs; a half pair is not a clean history. */
function terminalVersion(sealWitness:DocumentSnapshot,sealRecovery:DocumentSnapshot):ReserveAttemptDocumentVersion|null{
  if(!sealWitness.exists&&!sealRecovery.exists)return {exists:false};
  if(sealWitness.exists!==sealRecovery.exists)return null;
  return documentVersion(sealWitness);
}

/**
 * Builds the 14-version copy persisted in the attempt. `account`, `intent` and
 * `guard` keep a placeholder version for the frozen record shape; their real
 * comparison is semantic in `reserveAttemptWindowChanged`.
 */
export function reserveAttemptVersions(docs:ReserveAttemptWindowDocuments):ReserveAttemptVersions|null{
  const versions={} as Record<ReserveAttemptDocumentName,ReserveAttemptDocumentVersion>;
  for(const name of RESERVE_ATTEMPT_DOCUMENTS){
    if(name==='account'||name==='intent'||name==='guard')continue;
    const value=name==='sealWitness'||name==='sealRecovery'?terminalVersion(docs.sealWitness,docs.sealRecovery):
      name==='releaseWitness'||name==='releaseRecovery'?terminalVersion(docs.releaseWitness,docs.releaseRecovery):
      documentVersion(docs[name]);
    if(!value)return null;
    versions[name]=value;
  }
  if(!docs.account.exists||!docs.intent.exists||!docs.identity.exists||!docs.input.exists||!docs.project.exists||!docs.origin.exists||!docs.intentGuard.exists)return null;
  const guard=docs.guard.exists?documentVersion(docs.guard):({exists:false} as const);
  if(!guard)return null;
  versions.account=documentVersion(docs.account)!;
  versions.intent=documentVersion(docs.intent)!;
  versions.guard=guard;
  return versions;
}

/** Returns true when any document invalidates the history recorded before the POST. */
export function reserveAttemptWindowChanged(attempt:ReserveAttemptEvidence,docs:ReserveAttemptWindowDocuments,accountId:string):boolean{
  for(const name of RESERVE_ATTEMPT_IMMUTABLE_DOCUMENTS){
    const expected=attempt.versions[name],actual=documentVersion(docs[name]);
    if(!expected||!actual||expected.exists!==actual.exists)return true;
    if(expected.exists&&actual.exists&&(expected.createTime!==actual.createTime||expected.updateTime!==actual.updateTime))return true;
  }
  const row=docs.intent.data() as {state?:unknown;inputId?:unknown;operation?:unknown;revision?:unknown;seconds?:unknown;jobId?:unknown}|undefined;
  if(!row)return true;
  if(row.state!=='reserve_pending')return true;
  if(row.inputId!==attempt.witness.inputId)return true;
  if(row.operation!==attempt.witness.operation)return true;
  if(row.revision!==attempt.witness.revision)return true;
  if(row.seconds!==attempt.witness.seconds)return true;
  if(row.jobId!==undefined)return true;
  if(!docs.account.exists)return true;
  const account=docs.account.data() as {aiPilot?:unknown;simulationOnly?:unknown};
  if(account.aiPilot!==true)return true;
  if(account.simulationOnly!==true)return true;
  const guard=docs.guard;
  if(guard.exists&&(guard.get('accountId')!==accountId||guard.get('blocked')!==false))return true;
  return false;
}
