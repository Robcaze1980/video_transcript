import { createHash, randomUUID } from 'node:crypto';
import {diagnosticStage,diagnosticTransaction,diagnosticMark} from './cloudDiagnostics';
import { Firestore, FieldPath, FieldValue, type DocumentReference, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import {readyPrivateInput,type PrivateInputBinding} from './privateObjectPlan';
import {narrationChunks,VOICE_MODEL} from './pipelineVoiceProvider';
import {textModel} from './pipelineTextProvider';
import {AI_CATALOG_VERSION,AI_TEXT_WINDOW_MS,AI_TEXT_MAX_DURATION_MS,AI_TEXT_MAX_WINDOWS,artifactPlan,artifactPlanHash,simulatedAiPrice,storageQuota,validateArtifactManifest,type AiArtifactPlan,type AiArtifactReceipt} from './aiContracts';
import {validateDigitalSilenceProof,digitalSilenceProofHash} from './digitalSilence';
import {validResolution,UNKNOWN_RESOLUTION_MIN_AGE_MS,type ResolutionKind,type VideoResolution} from '../account/settlementContract';

// Server-only persistence for the cloud candidate; the public application remains separate.
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** LV-019.B C2a: `reconcile` evidence is already a bounded text string, so its hash is over the raw bytes (never JSON-quoted). */
const textHash = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/i;
type State = 'queued' | 'running' | 'unknown' | 'succeeded' | 'failed' | 'cancelled';
type Balance = { credited: number; available: number; reserved: number; consumed: number; active: number };
export type ProjectSnapshot = {accountId: string; inputId: string; revision: number; draft: string; updatedAtMs: number};
export type ExternalVideoBilling = {provider:'account_seconds';identityKey:string;reservationId:string;seconds:number};
export type ExternalBillingIntent = ExternalVideoBilling & {id:string;accountId:string;inputId:string;requestKey:string;operation:string;revision:number;state:'reserve_pending'|'release_pending'|'needs_review'|'job_created'|'insufficient'|'closed';jobId?:string};
export type ExternalBillingObservation = {reservationId:string;state:'reserved'|'captured'|'released';seconds:number};
export type ExternalBillingReleaseFence = {state:'release_pending'}|{state:'job_created';jobId:string};
export type ExternalBillingAdmission = {state:'permitted'}|{state:'job_created';jobId:string};
export type ExternalBillingReviewReason = 'captured_without_job'|'seconds_mismatch'|'intent_job_mismatch'|'capture_before_success'|'release_before_failure'|'outbox_mismatch'|'remote_ack_intent_mismatch'|'remote_ack_closure_unverified'|'direct_status_uncertain';
export type ExternalBillingReviewResult = {state:'needs_review';reason:ExternalBillingReviewReason}|{state:'job_created';jobId:string};
export type ExternalBillingHold = {id:string;accountId:string;identityKey:string;sourceKind:'intent'|'outbox';sourceId:string};
export type ExternalBillingIntentWitness = ExternalVideoBilling & {intentId:string;accountId:string;inputId:string;operation:string;revision:number;profile:typeof AI_CATALOG_VERSION};
export type TerminalRecoveryDocumentVersion = {exists:false}|{exists:true;createTime:string;updateTime:string};
export type TerminalRecoveryReadSnapshot = {intentId:string;action:'seal'|'release';origin:TerminalRecoveryDocumentVersion;sealWitness:TerminalRecoveryDocumentVersion;sealRecovery:TerminalRecoveryDocumentVersion;releaseWitness:TerminalRecoveryDocumentVersion;releaseRecovery:TerminalRecoveryDocumentVersion};
const directDocumentNames=['account','identity','input','project','intent','origin','guard','intentGuard','request','jobMarker','sealWitness','sealRecovery','releaseWitness','releaseRecovery'] as const;
type DirectDocumentName=typeof directDocumentNames[number];
export type DirectObservationSnapshot={attemptId:string;source:'status'|'seal'|'release';witness:ExternalBillingIntentWitness;versions:Record<DirectDocumentName,TerminalRecoveryDocumentVersion>};
export type ExternalBillingIntentLease = {leaseToken:string;leaseOwner:string;generation:number;leaseUntil:number};
export type ExternalBillingIntentFailureEvidence = {snapshotVersion:string;intentGuardVersion:string;state:'reserve_pending'|'release_pending';witness:ExternalBillingIntentWitness}&(
  |{mode:'unleased'}
  |({mode:'leased'}&ExternalBillingIntentLease));
export type ExternalBillingConfirmedIntentObservation = {reservationId:string;seconds:number}&(
  |{action:'release';source:'status'|'release_ack'|'seal_status';state:'released'}
  |{action:'seal';source:'seal_ack';state:'sealed'}
  |{action:'release';source:'resolution_status';terminalAction:'seal'|'release';state:'released'}
  |{action:'seal';source:'resolution_status';terminalAction:'seal'|'release';state:'sealed'});
export type ExternalBillingIntentObservationResult = {state:'closed'|'already_closed';ownerBlocked:false}|{state:'needs_review';ownerBlocked:boolean;incidentId?:string};
export type ExternalBillingOutboxSnapshot = ExternalVideoBilling & {jobId:string;accountId:string;action:'capture'|'release';attemptId?:string;
  settlementProtocol?:3;capturedSeconds?:number;resolutionKind?:ResolutionKind;evidenceSha256?:string};
/**
 * LV-019.B C2a: a repeated `conflict` must stop retrying here and move the row to `needs_review` with an alert. `too_early` is an early refusal of an unknown
 * release and never consumes an attempt.
 */
export const EXTERNAL_BILLING_ATTEMPT_LIMIT=8;
/**
 * LV-019.B step 1.6c (design 3.4): a non-terminal row older than this reaches `needs_review` with an alert, even when
 * the reason is infrastructure. 48 h is a starting point to adjust with real data, like the unknown review window.
 */
export const EXTERNAL_BILLING_MAX_AGE_MS=48*60*60*1000;
/** @deprecated Kept for the existing tests and callers that already import the old name. */
export const EXTERNAL_BILLING_CONFLICT_ATTEMPT_LIMIT=EXTERNAL_BILLING_ATTEMPT_LIMIT;
const settlementDocumentNames=['account','outbox','job','terminal','artifact','classification','simulatedReserve','identity','request','intent','guard','intentGuard','origin','jobMarker'] as const;
type SettlementDocumentName=typeof settlementDocumentNames[number];
export type ExternalBillingSettlementReadSnapshot={expected:ExternalBillingOutboxSnapshot;intentId:string;versions:Record<SettlementDocumentName,TerminalRecoveryDocumentVersion>};
export type ExternalBillingOutboxFailureEvidence = {snapshotVersion:string;state:'pending'|'retry_wait';outbox:ExternalBillingOutboxSnapshot};
export type ExternalBillingOutboxQuarantine =
  | {phase:'before_ack';snapshotVersion?:string|null}
  | {phase:'after_ack';snapshotVersion?:string|null;expected:ExternalBillingOutboxSnapshot;ack:ExternalBillingObservation;settlementSnapshot?:ExternalBillingSettlementReadSnapshot|null};
export type ExternalBillingOutboxQuarantineResult = {state:'changed'|'already_settled'|'needs_review';ownerBlocked:boolean;incidentId?:string};
export type Job = { aiProfile?:typeof AI_CATALOG_VERSION;snapshotSha256?:string; accountId: string; inputId: string; price: number; state: State; inputSha256: string;
  externalBilling?:ExternalVideoBilling;
  operation: string; revision: number | null; snapshot: ProjectSnapshot | null;
  inputStorage: PrivateInputBinding | null;
  attemptId: string | null; completedAttemptId?:string; leaseUntil: number | null; unknownAttemptId: string | null; requestKey: string;
  invocationPhase: 'not_started' | 'local_check' | 'invoking' | null;
  quarantinedAtMs?: number; reconciliationRef?: string | null };
export type JobAccountingMode='simulation'|'account_seconds'|'unverified';
type Input = { accountId: string; expiresAtMs: number; sha256: string; deleted: boolean; unknownCount: number;
  ready?: boolean; storage?: PrivateInputBinding; metadata?:{duration:number;audioTracks?:number} };
export class LedgerFault extends Error {
  constructor(readonly code: 'invalid' | 'conflict' | 'not_found' | 'insufficient' | 'invariant') { super(code); }
}
/** Recheck an already verified Firebase UID against its account inside the caller's transaction. */
export async function verifiedUidAccountInTransaction(tx:Transaction,root:DocumentReference,accountId:string,uid:string):Promise<boolean>{
  if(typeof accountId!=='string'||!uuid.test(accountId)||typeof uid!=='string'||!uid||uid.length>128)return false;
  const identity=await tx.get(root.collection('identities').doc(hash(['firebase',uid])));
  return identity.exists&&identity.get('uid')===uid&&identity.get('accountId')===accountId;
}
function integer(value: number, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new LedgerFault('invalid');
}
/**
 * Preserve the whole future billing lease across intent-state transitions.
 * `generation` is also a durable counter when no lease is present; the other
 * three fields must be all absent or a complete, coherent tuple. A local lease
 * does not revoke a previously sent remote request or prove its outcome.
 */
function externalIntentTransitionDue(doc:DocumentSnapshot):number{
  const row=doc.data();if(!row)throw new LedgerFault('invariant');
  const has=(field:string)=>Object.hasOwn(row,field);
  // Legacy missing dates require the audited ID-ordered migration; malformed
  // dates are not silently repaired by beginning or retrying an operation.
  if(!has('nextAttemptAt')||!Number.isSafeInteger(row.nextAttemptAt)||row.nextAttemptAt<0)throw new LedgerFault('invariant');
  const fields=['leaseToken','leaseOwner','leaseUntil'];
  const hasAny=fields.some(has),hasAll=fields.every(has),generation=row.generation;
  if(generation!==undefined&&(!Number.isSafeInteger(generation)||generation<0))throw new LedgerFault('invariant');
  if(!hasAny)return 0;
  if(!hasAll||typeof row.leaseToken!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/i.test(row.leaseToken)||
    typeof row.leaseOwner!=='string'||!/^[a-z0-9][a-z0-9._:-]{0,127}(?![\s\S])/i.test(row.leaseOwner)||
    !Number.isSafeInteger(generation)||generation<1||!Number.isSafeInteger(row.leaseUntil)||row.leaseUntil<0||
    !Number.isSafeInteger(row.nextAttemptAt)||row.nextAttemptAt!==row.leaseUntil)throw new LedgerFault('invariant');
  return row.leaseUntil as number;
}
function identifier(value: string) { if (typeof value !== 'string' || !uuid.test(value)) throw new LedgerFault('invalid'); }
function text(value: string) { if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new LedgerFault('invalid'); }
function validExternalBilling(billing:ExternalVideoBilling){
  if(!billing||billing.provider!=='account_seconds'||typeof billing.identityKey!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(billing.identityKey)||
    typeof billing.reservationId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/i.test(billing.reservationId)||
    !Number.isSafeInteger(billing.seconds)||billing.seconds<1||billing.seconds>600)throw new LedgerFault('invalid');
}
function copyExternalBilling(billing:ExternalVideoBilling):ExternalVideoBilling{
  return {provider:billing.provider,identityKey:billing.identityKey,reservationId:billing.reservationId,seconds:billing.seconds};
}
export function copyIntentWitness(witness:ExternalBillingIntentWitness):ExternalBillingIntentWitness{
  return {intentId:witness.intentId,accountId:witness.accountId,inputId:witness.inputId,operation:witness.operation,
    revision:witness.revision,profile:witness.profile,...copyExternalBilling(witness)};
}
function matchesExternalBilling(value:unknown,expected:ExternalVideoBilling){
  if(!value||typeof value!=='object')return false;
  const actual=value as Partial<ExternalVideoBilling>;
  return actual.provider===expected.provider&&actual.identityKey===expected.identityKey&&actual.reservationId===expected.reservationId&&actual.seconds===expected.seconds;
}
function validIntentWitness(value:ExternalBillingIntentWitness){
  if(!value||typeof value!=='object')throw new LedgerFault('invalid');
  identifier(value.accountId);identifier(value.inputId);text(value.operation);integer(value.revision,true);validExternalBilling(value);
  if(typeof value.intentId!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(value.intentId)||value.profile!==AI_CATALOG_VERSION)throw new LedgerFault('invalid');
}
function sameIntentWitness(value:unknown,expected:ExternalBillingIntentWitness){
  if(!value||typeof value!=='object')return false;const row=value as Partial<ExternalBillingIntentWitness>;
  return row.intentId===expected.intentId&&row.accountId===expected.accountId&&row.inputId===expected.inputId&&row.operation===expected.operation&&row.revision===expected.revision&&row.profile===expected.profile&&matchesExternalBilling(row,expected);
}
function intentWitness(accountId:string,inputId:string,requestKey:string,operation:string,revision:number,billing:ExternalVideoBilling):ExternalBillingIntentWitness{
  const result={intentId:hash([accountId,requestKey]),accountId,inputId,operation,revision,profile:AI_CATALOG_VERSION,...copyExternalBilling(billing)};validIntentWitness(result);return result;
}
function validStoredIntentWitness(doc:DocumentSnapshot,expected:ExternalBillingIntentWitness){
  return doc.exists&&sameIntentWitness(doc.data(),expected)&&doc.get('historyProtocol')===1&&doc.get('baseline')==='before_reservation'&&Number.isSafeInteger(doc.get('createdAtMs'))&&doc.get('createdAtMs')>=0;
}
/** A missing or unrecognized guard for an existing intent is not a clean history. */
export function validClearIntentAdmissionGuard(doc:DocumentSnapshot,intentId:string){
  const row=doc.data();return !!row&&Object.keys(row).length===4&&['protocol','intentId','state','createdAtMs'].every(field=>Object.hasOwn(row,field))&&
    row.protocol===1&&row.intentId===intentId&&row.state==='clear'&&Number.isSafeInteger(row.createdAtMs)&&row.createdAtMs>=0;
}
function validTerminalRecoveryOrigin(doc:DocumentSnapshot,expected:ExternalBillingIntentWitness){
  if(!validStoredIntentWitness(doc,expected))return false;
  const row=doc.data()!,fields=['intentId','accountId','inputId','operation','revision','profile','provider','identityKey','reservationId','seconds','historyProtocol','baseline','createdAtMs','terminalRecovery'];
  if(Object.keys(row).length!==fields.length||fields.some(field=>!Object.hasOwn(row,field)))return false;
  const marker=row.terminalRecovery;
  return !!marker&&typeof marker==='object'&&!Array.isArray(marker)&&Object.keys(marker).length===3&&
    ['protocol','sealPrepared','releasePrepared'].every(field=>Object.hasOwn(marker,field))&&marker.protocol===1&&
    typeof marker.sealPrepared==='boolean'&&typeof marker.releasePrepared==='boolean';
}
function intentTerminalKey(intentId:string,action:'release'|'seal'){return hash(['billing-intent-terminal-v1',intentId,action]);}
function validInitialTerminalRecovery(value:unknown,terminalId:string,createdAtMs:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const row=value as Record<string,unknown>;
  const fields=['terminalId','protocol','state','generation','attempts','createdAtMs','nextAttemptAt'];
  return Object.keys(row).length===fields.length&&fields.every(field=>Object.hasOwn(row,field))&&
    row.terminalId===terminalId&&row.protocol===1&&row.state==='pending'&&row.generation===0&&row.attempts===0&&
    Number.isSafeInteger(row.createdAtMs)&&Number(row.createdAtMs)>=0&&row.createdAtMs===createdAtMs&&row.nextAttemptAt===row.createdAtMs;
}
function validInitialReaderPair(prepared:boolean,terminal:DocumentSnapshot,recovery:DocumentSnapshot,witness:ExternalBillingIntentWitness,action:'seal'|'release'){
  if(!prepared)return !terminal.exists&&!recovery.exists;
  const id=intentTerminalKey(witness.intentId,action),row=terminal.data();
  if(!terminal.exists||!recovery.exists||terminal.id!==id||recovery.id!==id||!row)return false;
  const fields=['intentId','accountId','inputId','operation','revision','profile','provider','identityKey','reservationId','seconds','action','historyProtocol','stage','createdAtMs'];
  return Object.keys(row).length===fields.length&&fields.every(field=>Object.hasOwn(row,field))&&
    sameIntentWitness(row,witness)&&row.action===action&&row.historyProtocol===1&&row.stage==='prepared'&&
    Number.isSafeInteger(row.createdAtMs)&&row.createdAtMs>=0&&validInitialTerminalRecovery(recovery.data(),id,row.createdAtMs);
}
function terminalDocumentVersion(doc:DocumentSnapshot):TerminalRecoveryDocumentVersion|null{
  if(!doc.exists)return {exists:false};
  const encode=(value:DocumentSnapshot['createTime'])=>value&&Number.isSafeInteger(value.seconds)&&value.seconds>=0&&Number.isSafeInteger(value.nanoseconds)&&value.nanoseconds>=0&&value.nanoseconds<1_000_000_000?`${value.seconds}:${String(value.nanoseconds).padStart(9,'0')}`:null;
  const createTime=encode(doc.createTime),updateTime=encode(doc.updateTime);
  return createTime&&updateTime?{exists:true,createTime,updateTime}:null;
}
function copyTerminalDocumentVersion(value:unknown):TerminalRecoveryDocumentVersion|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;const item=value as Record<string,unknown>;
  const keys=Object.keys(item);if(!Object.hasOwn(item,'exists'))return null;const exists=item.exists;
  if(exists===false&&keys.length===1)return {exists:false};
  if(exists!==true||keys.length!==3||!['exists','createTime','updateTime'].every(field=>Object.hasOwn(item,field)))return null;
  const createTime=item.createTime,updateTime=item.updateTime;
  if(typeof createTime!=='string'||typeof updateTime!=='string'||!/^\d{1,15}:\d{9}(?![\s\S])/.test(createTime)||!/^\d{1,15}:\d{9}(?![\s\S])/.test(updateTime))return null;
  return {exists:true,createTime,updateTime};
}
/** Internal in-memory comparison data, not proof of authentication or durability. */
export function copyDirectObservationSnapshot(value:unknown):DirectObservationSnapshot|null{
  try{
    if(!value||typeof value!=='object'||Array.isArray(value))return null;const row=value as Record<string,unknown>;
    if(Object.keys(row).length!==4||!['attemptId','source','witness','versions'].every(field=>Object.hasOwn(row,field)))return null;
    const attemptId=row.attemptId,source=row.source,witnessValue=row.witness,versionsValue=row.versions;
    if(typeof attemptId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/i.test(attemptId)||!['status','seal','release'].includes(source as string)||!witnessValue||typeof witnessValue!=='object'||Array.isArray(witnessValue)||!versionsValue||typeof versionsValue!=='object'||Array.isArray(versionsValue))return null;
    const witness=copyIntentWitness(witnessValue as ExternalBillingIntentWitness);validIntentWitness(witness);
    const raw=versionsValue as Record<string,unknown>;if(Object.keys(raw).length!==directDocumentNames.length||directDocumentNames.some(name=>!Object.hasOwn(raw,name)))return null;
    const versions={} as Record<DirectDocumentName,TerminalRecoveryDocumentVersion>;
    for(const name of directDocumentNames){const item=raw[name],copied=copyTerminalDocumentVersion(item);if(!copied)return null;versions[name]=copied;}
    if(!versions.account.exists||!versions.identity.exists||!versions.input.exists||!versions.intent.exists||!versions.origin.exists||!versions.intentGuard.exists||
      versions.sealWitness.exists!==versions.sealRecovery.exists||versions.releaseWitness.exists!==versions.releaseRecovery.exists||
      source==='seal'&&!versions.sealWitness.exists||source==='release'&&!versions.releaseWitness.exists)return null;
    return {attemptId,source:source as DirectObservationSnapshot['source'],witness,versions};
  }catch{return null;}
}
function directSnapshotHash(snapshot:DirectObservationSnapshot){return hash(['direct-observation-v1',snapshot.attemptId,snapshot.source,snapshot.witness,directDocumentNames.map(name=>[name,snapshot.versions[name]])]);}
export function copyTerminalRecoveryReadSnapshot(value:unknown):TerminalRecoveryReadSnapshot|null{
  try{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const row=value as Record<string,unknown>,fields=['intentId','action','origin','sealWitness','sealRecovery','releaseWitness','releaseRecovery'];
  if(Object.keys(row).length!==fields.length||fields.some(field=>!Object.hasOwn(row,field)))return null;
  // Snapshot each permitted value once: accessors must not supply one value to
  // validation and a different value to the returned consistency proof.
  const intentId=row.intentId,action=row.action,originValue=row.origin,sealWitnessValue=row.sealWitness,sealRecoveryValue=row.sealRecovery,releaseWitnessValue=row.releaseWitness,releaseRecoveryValue=row.releaseRecovery;
  if(typeof intentId!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(intentId)||!['seal','release'].includes(action as string))return null;
  const copy=(value:unknown):TerminalRecoveryDocumentVersion|null=>{
    if(!value||typeof value!=='object'||Array.isArray(value))return null;const item=value as Record<string,unknown>;
    const keys=Object.keys(item);if(!Object.hasOwn(item,'exists'))return null;const exists=item.exists;
    if(exists===false&&keys.length===1)return {exists:false};
    if(exists!==true||keys.length!==3||!['exists','createTime','updateTime'].every(field=>Object.hasOwn(item,field)))return null;
    const createTime=item.createTime,updateTime=item.updateTime;
    if(typeof createTime!=='string'||typeof updateTime!=='string'||!/^\d{1,15}:\d{9}(?![\s\S])/.test(createTime)||!/^\d{1,15}:\d{9}(?![\s\S])/.test(updateTime))return null;
    return {exists:true,createTime,updateTime};
  };
  const origin=copy(originValue),sealWitness=copy(sealWitnessValue),sealRecovery=copy(sealRecoveryValue),releaseWitness=copy(releaseWitnessValue),releaseRecovery=copy(releaseRecoveryValue);
  if(!origin||!origin.exists||!sealWitness||!sealRecovery||!releaseWitness||!releaseRecovery||sealWitness.exists!==sealRecovery.exists||releaseWitness.exists!==releaseRecovery.exists||
    action==='seal'&&!sealWitness.exists||action==='release'&&!releaseWitness.exists)return null;
  return {intentId,action:action as 'seal'|'release',origin,sealWitness,sealRecovery,releaseWitness,releaseRecovery};
  }catch{return null;}
}
function sameTerminalDocumentVersion(doc:DocumentSnapshot,expected:TerminalRecoveryDocumentVersion){
  const current=terminalDocumentVersion(doc);return !!current&&current.exists===expected.exists&&(!current.exists||expected.exists&&current.createTime===expected.createTime&&current.updateTime===expected.updateTime);
}
/** In-memory evidence for comparing a POST's original reads; not an authenticated capability. */
export function copyExternalBillingSettlementReadSnapshot(value:unknown):ExternalBillingSettlementReadSnapshot|null{
  try{
    if(!value||typeof value!=='object'||Array.isArray(value))return null;const row=value as Record<string,unknown>;
    if(Object.keys(row).length!==3||!Object.hasOwn(row,'expected')||!Object.hasOwn(row,'intentId')||!Object.hasOwn(row,'versions'))return null;
    const expectedValue=row.expected,intentId=row.intentId,versionsValue=row.versions;
    if(!expectedValue||typeof expectedValue!=='object'||Array.isArray(expectedValue))return null;
    const e=expectedValue as Record<string,unknown>;
    // LV-019.B C2a: accept the v1 tuple (no new fields, no `attemptId` on release) and the protocol-3 tuple; any unknown key is rejected, and a new field
    // without `settlementProtocol: 3` is rejected by `validOutboxSnapshot`.
    if(Object.keys(e).some(key=>!(outboxSnapshotKeys as readonly string[]).includes(key)))return null;
    const expected={jobId:e.jobId,accountId:e.accountId,provider:e.provider,identityKey:e.identityKey,reservationId:e.reservationId,seconds:e.seconds,action:e.action,
      ...(e.attemptId!==undefined?{attemptId:e.attemptId}:{}),...(e.settlementProtocol!==undefined?{settlementProtocol:e.settlementProtocol}:{}),
      ...(e.capturedSeconds!==undefined?{capturedSeconds:e.capturedSeconds}:{}),...(e.resolutionKind!==undefined?{resolutionKind:e.resolutionKind}:{}),
      ...(e.evidenceSha256!==undefined?{evidenceSha256:e.evidenceSha256}:{})} as ExternalBillingOutboxSnapshot;
    validOutboxSnapshot(expected);
    if(typeof intentId!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(intentId)||!versionsValue||typeof versionsValue!=='object'||Array.isArray(versionsValue))return null;
    const raw=versionsValue as Record<string,unknown>;if(Object.keys(raw).length!==settlementDocumentNames.length||settlementDocumentNames.some(name=>!Object.hasOwn(raw,name)))return null;
    const versions={} as Record<SettlementDocumentName,TerminalRecoveryDocumentVersion>;
    for(const name of settlementDocumentNames){const item=raw[name],copy=copyTerminalDocumentVersion(item);if(!copy)return null;versions[name]=copy;}
    if(['account','outbox','job','terminal','artifact','classification','identity','request','intent','intentGuard','origin','jobMarker'].some(name=>!versions[name as SettlementDocumentName].exists)||versions.simulatedReserve.exists)return null;
    return {expected,intentId,versions};
  }catch{return null;}
}
function validIntentObservation(witness:ExternalBillingIntentWitness,observed:ExternalBillingConfirmedIntentObservation){
  validIntentWitness(witness);
  if(!observed||observed.reservationId!==witness.reservationId||observed.seconds!==witness.seconds||
    !(observed.action==='release'&&observed.state==='released'&&(['status','release_ack','seal_status'].includes(observed.source)||observed.source==='resolution_status'&&['seal','release'].includes(observed.terminalAction))||
      observed.action==='seal'&&observed.state==='sealed'&&(observed.source==='seal_ack'||observed.source==='resolution_status'&&['seal','release'].includes(observed.terminalAction))))throw new LedgerFault('invalid');
}
function copyIntentObservation(observed:ExternalBillingConfirmedIntentObservation):ExternalBillingConfirmedIntentObservation{
  const source=observed.source,common={action:observed.action,source,state:observed.state,reservationId:observed.reservationId,seconds:observed.seconds};
  return (source==='resolution_status'?{...common,terminalAction:(observed as Extract<ExternalBillingConfirmedIntentObservation,{source:'resolution_status'}>).terminalAction}:common) as ExternalBillingConfirmedIntentObservation;
}
function validOutboxSnapshot(snapshot:ExternalBillingOutboxSnapshot){
  if(!snapshot||typeof snapshot!=='object')throw new LedgerFault('invalid');
  identifier(snapshot.jobId);identifier(snapshot.accountId);validExternalBilling(snapshot);
  if(!['capture','release'].includes(snapshot.action))throw new LedgerFault('invalid');
  // LV-019.B C2a: a row without `settlementProtocol` keeps the v1 semantics; every new field is only valid under `settlementProtocol: 3`.
  const protocol=snapshot.settlementProtocol;
  if(protocol!==undefined&&protocol!==3)throw new LedgerFault('invalid');
  const resolutionKind=snapshot.resolutionKind,evidenceSha256=snapshot.evidenceSha256,capturedSeconds=snapshot.capturedSeconds;
  const hasResolution=resolutionKind!==undefined||evidenceSha256!==undefined;
  if((hasResolution||capturedSeconds!==undefined||snapshot.action==='release'&&snapshot.attemptId!==undefined)&&protocol!==3)throw new LedgerFault('invalid');
  // LV-019.B C2a: each protocol-3 field belongs to one action. A resolution only describes a release and `capturedSeconds` only a partial capture;
  // crossing them would make the client reject the POST every time, so the row would sit in `retry_wait` forever.
  if(hasResolution&&snapshot.action!=='release')throw new LedgerFault('invalid');
  if(capturedSeconds!==undefined&&snapshot.action!=='capture')throw new LedgerFault('invalid');
  if(hasResolution&&!validResolution({kind:resolutionKind,evidenceSha256}))throw new LedgerFault('invalid');
  if(capturedSeconds!==undefined&&(!Number.isSafeInteger(capturedSeconds)||capturedSeconds<1||capturedSeconds>=snapshot.seconds))throw new LedgerFault('invalid');
  if(snapshot.action==='capture')identifier(snapshot.attemptId as string);
  else if(snapshot.attemptId!==undefined){if(protocol!==3||!hasResolution)throw new LedgerFault('invalid');identifier(snapshot.attemptId);}
  else if(hasResolution||capturedSeconds!==undefined)throw new LedgerFault('invalid');
}
const outboxSnapshotKeys=['jobId','accountId','provider','identityKey','reservationId','seconds','action','attemptId','settlementProtocol','capturedSeconds','resolutionKind','evidenceSha256'] as const;
/** Scheduling/review metadata that lives on the stored `billingOutbox` document next to the settlement tuple. It is never part of the tuple itself. */
export const OUTBOX_METADATA_KEYS=['id','snapshotVersion','state','attempts','generation','nextAttemptAt','createdAtMs','settledAtMs','lastErrorCode','lastAttemptAtMs',
  'reviewIncidentId','updatedAtMs','leaseToken','leaseOwner','leaseUntil'] as const;
/** Pick the settlement fields of a stored outbox row into the validated tuple, or null when the shape is not a legal v1/v3 row. */
export function pickOutboxSnapshot(value:unknown):ExternalBillingOutboxSnapshot|null{
  try{
    if(!value||typeof value!=='object'||Array.isArray(value))return null;const row=value as Record<string,unknown>;
    const expected={jobId:row.jobId,accountId:row.accountId,provider:row.provider,identityKey:row.identityKey,reservationId:row.reservationId,seconds:row.seconds,action:row.action,
      ...(row.attemptId!==undefined?{attemptId:row.attemptId}:{}),...(row.settlementProtocol!==undefined?{settlementProtocol:row.settlementProtocol}:{}),
      ...(row.capturedSeconds!==undefined?{capturedSeconds:row.capturedSeconds}:{}),...(row.resolutionKind!==undefined?{resolutionKind:row.resolutionKind}:{}),
      ...(row.evidenceSha256!==undefined?{evidenceSha256:row.evidenceSha256}:{})} as ExternalBillingOutboxSnapshot;
    validOutboxSnapshot(expected);return expected;
  }catch{return null;}
}
/** Strict copy for a settlement snapshot: an unknown field is never carried. A stored row may pass its documented metadata keys explicitly. */
export function copyOutboxSnapshot(value:unknown,metadataKeys:readonly string[]=[]):ExternalBillingOutboxSnapshot|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const allowed:readonly string[]=[...outboxSnapshotKeys,...metadataKeys];
  if(Object.keys(value as Record<string,unknown>).some(key=>!allowed.includes(key)))return null;
  return pickOutboxSnapshot(value);
}
export function matchesOutboxSnapshot(value:unknown,expected:ExternalBillingOutboxSnapshot){
  if(!value||typeof value!=='object')return false;const row=value as Partial<ExternalBillingOutboxSnapshot>;
  // An unexpected key on a stored row is never silently ignored: it is a shape error, not a field to skip.
  const allowed:readonly string[]=[...outboxSnapshotKeys,...OUTBOX_METADATA_KEYS];
  if(Object.keys(row as Record<string,unknown>).some(key=>!allowed.includes(key)))return false;
  if(!(row.jobId===expected.jobId&&row.accountId===expected.accountId&&row.action===expected.action&&row.attemptId===expected.attemptId&&matchesExternalBilling(row,expected)))return false;
  // GLM hardening: the protocol shape is asserted in both directions. A v1 tuple matches only a row with NO protocol-3 field at all (a row silently
  // rewritten from v1 to v3 must not pass), and a v3 tuple matches only the row that carries the fields exactly, including their absence.
  if(expected.settlementProtocol!==3)
    return row.settlementProtocol===undefined&&row.capturedSeconds===undefined&&row.resolutionKind===undefined&&row.evidenceSha256===undefined;
  return row.settlementProtocol===3&&row.capturedSeconds===expected.capturedSeconds&&row.resolutionKind===expected.resolutionKind&&row.evidenceSha256===expected.evidenceSha256;
}
function outboxVersion(doc:DocumentSnapshot){
  const time=doc.updateTime;if(!time||!Number.isSafeInteger(time.seconds)||time.seconds<0||!Number.isSafeInteger(time.nanoseconds)||time.nanoseconds<0||time.nanoseconds>=1_000_000_000)return null;
  return `${time.seconds}:${String(time.nanoseconds).padStart(9,'0')}`;
}
/** LV-019.B: the shared growing wait of every billing retry, `min(15 min, 1 s * 2^min(attempts,10))`. */
function billingAttemptDelay(attempts:number){return Math.min(15*60_000,1000*2**Math.min(attempts,10));}
/** At most `limit` items taken alternately from `first` and `second` (starting with `first`); when one runs out the other fills the rest. */
function interleave<T>(first:readonly T[],second:readonly T[],limit:number):T[]{
  const out:T[]=[];
  for(let i=0;out.length<limit&&(i<first.length||i<second.length);i++){
    if(i<first.length)out.push(first[i]);
    if(i<second.length&&out.length<limit)out.push(second[i]);
  }
  return out;
}
function hasIntentLease(row:Record<string,unknown>){return ['leaseToken','leaseOwner','leaseUntil'].some(field=>Object.hasOwn(row,field));}
function validUnleasedBillingMetadata(row:Record<string,unknown>){
  const validCounter=(value:unknown)=>value===undefined||Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<Number.MAX_SAFE_INTEGER;
  return validCounter(row.generation)&&validCounter(row.attempts);
}
function sameIntentLease(row:Record<string,unknown>,lease:ExternalBillingIntentLease){
  return row.leaseToken===lease.leaseToken&&row.leaseOwner===lease.leaseOwner&&row.generation===lease.generation&&row.leaseUntil===lease.leaseUntil;
}
function externalHold(accountId:string,identityKey:string,sourceKind:'intent'|'outbox',sourceId:string):ExternalBillingHold{
  identifier(accountId);if(typeof identityKey!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(identityKey)||typeof sourceId!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(sourceId)||!['intent','outbox'].includes(sourceKind))throw new LedgerFault('invalid');
  return {id:hash(['account-hold-v1',sourceKind,sourceId]),accountId,identityKey,sourceKind,sourceId};
}
function matchesHold(value:unknown,expected:ExternalBillingHold){
  if(!value||typeof value!=='object')return false;const row=value as Partial<ExternalBillingHold>;
  return row.id===expected.id&&row.accountId===expected.accountId&&row.identityKey===expected.identityKey&&row.sourceKind===expected.sourceKind&&row.sourceId===expected.sourceId;
}
function safeOutboxAudit(value:unknown){
  const row=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const safeId=(v:unknown)=>typeof v==='string'&&uuid.test(v)?v:null;
  return {jobId:safeId(row.jobId),attemptId:safeId(row.attemptId),accountId:safeId(row.accountId),provider:row.provider==='account_seconds'?row.provider:null,
    identityKey:typeof row.identityKey==='string'&&/^[a-f0-9]{64}$/.test(row.identityKey)?row.identityKey:null,
    reservationId:typeof row.reservationId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(row.reservationId)?row.reservationId:null,
    seconds:Number.isSafeInteger(row.seconds)&&Number(row.seconds)>=1&&Number(row.seconds)<=600?row.seconds:null,
    action:row.action==='capture'||row.action==='release'?row.action:null};
}
function balance(value: Balance): Balance {
  for (const field of ['credited','available','reserved','consumed','active'] as const) integer(value[field]);
  if (value.credited !== value.available + value.reserved + value.consumed) throw new LedgerFault('invariant');
  return {credited:value.credited,available:value.available,reserved:value.reserved,consumed:value.consumed,active:value.active};
}
export type AiArtifactRecord={accountId:string;inputId:string;jobId:string;plan:AiArtifactPlan;planHash:string;sourceGeneration:string;inputSha256:string;revision:number;snapshotSha256:string;expiresAtMs:number;state:'pending'|'staged'|'ready'|'purging'|'purged';quotaMode:'reserved'|'committed'|'none';quotaHeld:number;entries:AiArtifactReceipt[];attemptId:string|null;nextAttemptAt:number;callReceiptHash?:string|null;callKeys?:string[]};
const draftSha=(draft:string)=>createHash('sha256').update(draft).digest('hex');
const requestFingerprint=(inputId:string,operation:string,revision:number|null,profile?:typeof AI_CATALOG_VERSION)=>hash(profile?[inputId,operation,revision,profile]:[inputId,operation,revision]);
/**
 * No existing narration job has an integrated, independently verified binding
 * from a structured review through reservation and provider dispatch. Until
 * that protocol is implemented and audited, all narration is fenced. This is
 * not a determination that a provider call or charge did or did not happen.
 */
export function narrationRequiresReview(operation:unknown){return typeof operation==='string'&&operation.startsWith('narration:');}
/**
 * LV-019.B step 1.2: how long an `unknown` job stays quarantined before the automatic resolver releases it
 * (design `LV-019-B-cancelacion-y-unknown-diseno.md`, sections 3 and 4). It must exceed Account's
 * `UNKNOWN_RESOLUTION_MIN_AGE_MS` floor, otherwise every automatic release would be refused as `too_early`. The value is a
 * starting point, adjustable with real data: a configuration decision, not a policy one.
 */
export const UNKNOWN_REVIEW_WINDOW_MS=6*60*60*1000;
/** Tolerance for a `quarantinedAtMs` written slightly ahead of the resolver's injected clock (clock skew between writers). */
export const UNKNOWN_CLOCK_SKEW_MS=10*60*1000;
/**
 * Test-only override of the review window: no production caller passes it and no HTTP route can reach it. It may only
 * SHORTEN the real window, so it is validated as a safe integer in [this floor, UNKNOWN_REVIEW_WINDOW_MS]; a longer window
 * would delay a release the six-hour policy already allows.
 */
const MIN_TEST_UNKNOWN_WINDOW_MS=1_000;
/** Test-only `skewMs` ceiling: one hour. A larger tolerance could mask a genuinely future `quarantinedAtMs`. */
const MAX_TEST_UNKNOWN_SKEW_MS=3_600_000;
/** A cursor is a document id read back into a path: bounded, no separator, no control character, no `.`/`..`, not a Firestore reserved id. */
const MAX_CURSOR_BYTES=1500,RESERVED_DOC_ID=/^__.*__$/;
const plainDocumentId=(value:unknown):value is string=>typeof value==='string'&&value.length>=1&&Buffer.byteLength(value,'utf8')<=MAX_CURSOR_BYTES&&!RESERVED_DOC_ID.test(value)&&!/[\/\u0000-\u001f\u007f]/.test(value)&&value!=='.'&&value!=='..';
/** The evidence string of an expired unknown: reproducible from stored data alone; `none` stands in for the attempt when the row carried no admission. */
export function unknownExpiredEvidence(jobId:string,unknownAttemptId:string|null,quarantinedAtMs:number){
  return `unknown_expired:v1:${jobId}:${unknownAttemptId??'none'}:${quarantinedAtMs}`;
}
export type UnknownQuarantineVerdict={state:'not_due'}|{state:'invalid';field:'quarantinedAtMs'|'unknownAttemptId'}|{state:'expired';evidence:string;evidenceSha256:string};
/**
 * Classify one unknown row's quarantine BEFORE deciding it is due. Validation comes first: `quarantinedAtMs` must be a safe
 * integer >= 0 and not in the future beyond the tolerated skew (a bad value can never silently read as not-due), and, only
 * when the row carries an admission, `unknownAttemptId` must be a UUID (without it `settle` would throw on every pass and the
 * reservation would stay retained forever). `windowMs`/`skewMs` are test-only overrides with their own bounds (a longer
 * window or a wider skew is refused). Pure: no I/O, no clock.
 */
export function classifyUnknownQuarantine(row:{quarantinedAtMs?:unknown;unknownAttemptId?:unknown},options:{jobId:string;admitted:boolean;now:number;windowMs?:number;skewMs?:number}):UnknownQuarantineVerdict{
  // Only `undefined` selects the production default, matching the drain lease module: a `null` override is a bad parameter,
  // not an omitted one, so it falls into the bounds check below and is refused.
  const windowMs=options.windowMs===undefined?UNKNOWN_REVIEW_WINDOW_MS:options.windowMs,skewMs=options.skewMs===undefined?UNKNOWN_CLOCK_SKEW_MS:options.skewMs,quarantinedAtMs=row.quarantinedAtMs;
  // A test-only override may only SHORTEN the window and only within the documented skew ceiling. A value outside those
  // bounds (including NaN, Infinity or a negative) is refused outright instead of silently changing the policy: the caller
  // must never be able to buy a longer wait or a larger tolerance with a bad number.
  if(!Number.isSafeInteger(windowMs)||windowMs<MIN_TEST_UNKNOWN_WINDOW_MS||windowMs>UNKNOWN_REVIEW_WINDOW_MS)throw new LedgerFault('invalid');
  if(!Number.isSafeInteger(skewMs)||skewMs<0||skewMs>MAX_TEST_UNKNOWN_SKEW_MS)throw new LedgerFault('invalid');
  if(typeof quarantinedAtMs!=='number'||!Number.isSafeInteger(quarantinedAtMs)||quarantinedAtMs<0||quarantinedAtMs>options.now+skewMs)return {state:'invalid',field:'quarantinedAtMs'};
  if(options.admitted&&(typeof row.unknownAttemptId!=='string'||!uuid.test(row.unknownAttemptId)))return {state:'invalid',field:'unknownAttemptId'};
  if(quarantinedAtMs>options.now-windowMs)return {state:'not_due'};
  const evidence=unknownExpiredEvidence(options.jobId,options.admitted?row.unknownAttemptId as string:null,quarantinedAtMs);
  return {state:'expired',evidence,evidenceSha256:textHash(evidence)};
}
interface Context { accountRef: DocumentReference; jobRef: DocumentReference; inputRef: DocumentReference;
  terminalRef: DocumentReference; account: Balance; job: Job; input: Input; terminalExists: boolean;rawAccountData:Record<string,unknown>;artifactRef?:DocumentReference;artifact?:AiArtifactRecord;providerReceipts?:Array<{id:string;data:Record<string,unknown>}> }

export class FirestoreBackend {
  private readonly unverifiedTestInputs:boolean;
  constructor(private readonly db: Firestore, private readonly root: DocumentReference,
    options:{allowUnverifiedInputsForTests?:true}={}) {
    this.unverifiedTestInputs=options.allowUnverifiedInputsForTests===true;
    if(this.unverifiedTestInputs&&(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185'||
      !/^vistavo_(backend_test|transport_test|grpc_control)\/[a-f0-9-]{36}$/.test(root.path)))throw new LedgerFault('invalid');
  }
  private usable(input:Input,inputId:string,job?:Job){
    return !input.deleted&&input.expiresAtMs>Date.now()&&
      (this.unverifiedTestInputs||readyPrivateInput(input,inputId))&&(!job||input.sha256===job.inputSha256&&
        (this.unverifiedTestInputs||input.storage?.generation===job.inputStorage?.generation));
  }
  private ref(collection: string, id: string) { return this.root.collection(collection).doc(id); }
  private directObservationRefs(witness:ExternalBillingIntentWitness):Record<DirectDocumentName,DocumentReference>{
    const key=witness.intentId,seal=intentTerminalKey(key,'seal'),release=intentTerminalKey(key,'release');
    return {account:this.ref('accounts',witness.accountId),identity:this.ref('identities',witness.identityKey),input:this.ref('inputs',witness.inputId),project:this.ref('projects',witness.inputId),intent:this.ref('billingIntents',key),origin:this.ref('billingIntentWitnesses',key),guard:this.ref('billingGuards',witness.accountId),intentGuard:this.ref('billingIntentAdmissionGuards',key),request:this.ref('requests',key),jobMarker:this.ref('billingIntentJobMarkers',key),sealWitness:this.ref('billingIntentTerminalWitnesses',seal),sealRecovery:this.ref('billingIntentTerminalRecovery',seal),releaseWitness:this.ref('billingIntentTerminalWitnesses',release),releaseRecovery:this.ref('billingIntentTerminalRecovery',release)};
  }
  private async directObservationDocs(tx:Transaction,witness:ExternalBillingIntentWitness){
    const refs=this.directObservationRefs(witness),docs=await tx.getAll(...directDocumentNames.map(name=>refs[name]));
    return Object.fromEntries(directDocumentNames.map((name,index)=>[name,docs[index]])) as Record<DirectDocumentName,DocumentSnapshot>;
  }
  private validDirectObservationDocs(d:Record<DirectDocumentName,DocumentSnapshot>,witness:ExternalBillingIntentWitness,requestKey:string,source:DirectObservationSnapshot['source'],allowClosed=false){
    const uid=d.identity.get('uid');
    if(!d.account.exists||!d.identity.exists||d.identity.get('accountId')!==witness.accountId||typeof uid!=='string'||!uid||uid.length>128||hash(['firebase',uid])!==witness.identityKey||!d.input.exists||d.input.get('accountId')!==witness.accountId||d.project.exists&&d.project.get('accountId')!==witness.accountId||!validTerminalRecoveryOrigin(d.origin,witness)||!validClearIntentAdmissionGuard(d.intentGuard,witness.intentId)||d.request.exists||d.jobMarker.exists)return false;
    try{
      if(this.billingBlocked(d.guard,witness.accountId))return false;
      const row=this.billingIntent(d.intent,witness.accountId,requestKey,witness);
      if(row.inputId!==witness.inputId||row.operation!==witness.operation||row.revision!==witness.revision||row.jobId||!(allowClosed&&row.state==='closed'||source==='status'&&['reserve_pending','release_pending'].includes(row.state)||source!=='status'&&row.state==='release_pending'))return false;
      if(row.state!=='closed')externalIntentTransitionDue(d.intent);
      const marker=d.origin.get('terminalRecovery');
      return !!marker&&(source==='status'||marker[source==='seal'?'sealPrepared':'releasePrepared']===true)&&validInitialReaderPair(marker.sealPrepared,d.sealWitness,d.sealRecovery,witness,'seal')&&validInitialReaderPair(marker.releasePrepared,d.releaseWitness,d.releaseRecovery,witness,'release');
    }catch(error){if(error instanceof LedgerFault)return false;throw error;}
  }
  private matchingDirectObservation(snapshot:DirectObservationSnapshot,d:Record<DirectDocumentName,DocumentSnapshot>,witness:ExternalBillingIntentWitness,requestKey:string,source:DirectObservationSnapshot['source']){
    return snapshot.source===source&&sameIntentWitness(snapshot.witness,witness)&&this.validDirectObservationDocs(d,witness,requestKey,source)&&directDocumentNames.every(name=>sameTerminalDocumentVersion(d[name],snapshot.versions[name]));
  }
  /**
   * Preserve a returned read whose original local history changed. This is not a
   * financial ACK, nor an authenticated capability, and never moves balance.
   * All reads, attribution and the incident write belong to the caller's transaction.
   */
  private async preserveDirectUncertainty(tx:Transaction,d:Record<DirectDocumentName,DocumentSnapshot>,witness:ExternalBillingIntentWitness,requestKey:string,snapshot:DirectObservationSnapshot,observed:{state:'not_found'|'reserved'|'captured'|'released'|'sealed';seconds:number|null}){
    if(!sameIntentWitness(snapshot.witness,witness)||hash([witness.accountId,requestKey])!==witness.intentId||
      !['status','seal'].includes(snapshot.source)||!['not_found','reserved','captured','released','sealed'].includes(observed.state)||
      (observed.state==='not_found'?snapshot.source!=='status'||observed.seconds!==null:!Number.isSafeInteger(observed.seconds)||Number(observed.seconds)<1))throw new LedgerFault('invalid');
    const key=witness.intentId,incidentId=hash(['direct-status-uncertainty-v1',key,snapshot.attemptId,snapshot.source,observed.state,observed.seconds]),
      incident=this.ref('billingIntentObservationIncidents',incidentId),review=this.ref('billingReviewIncidents',key),hold=externalHold(witness.accountId,witness.identityKey,'intent',key),holdRef=this.ref('billingHoldOutbox',hold.id);
    const [oldIncident,oldReview,oldHold]=await tx.getAll(incident,review,holdRef);
    if(oldIncident.exists){
      if(!sameIntentWitness(oldIncident.data(),witness)||oldIncident.get('source')!==snapshot.source||oldIncident.get('observedState')!==observed.state||oldIncident.get('observedSeconds')!==observed.seconds||oldIncident.get('directSnapshotHash')!==directSnapshotHash(snapshot))throw new LedgerFault('invariant');
      if(validClearIntentAdmissionGuard(d.intentGuard,key))tx.update(d.intentGuard.ref,{state:'needs_review',incidentId,updatedAtMs:Date.now()});
      return;
    }
    const uid=d.identity.get('uid'),guardValid=!d.guard.exists||d.guard.get('accountId')===witness.accountId&&typeof d.guard.get('blocked')==='boolean';
    let owner=d.account.exists&&d.identity.exists&&d.identity.get('accountId')===witness.accountId&&typeof uid==='string'&&!!uid&&uid.length<=128&&hash(['firebase',uid])===witness.identityKey&&d.input.exists&&d.input.get('accountId')===witness.accountId&&validStoredIntentWitness(d.origin,witness)&&guardValid;
    let row:ExternalBillingIntent|undefined;
    if(d.intent.exists){try{row=this.billingIntent(d.intent,witness.accountId,requestKey,witness);if(row.inputId!==witness.inputId||row.operation!==witness.operation||row.revision!==witness.revision)owner=false;}catch(error){if(!(error instanceof LedgerFault))throw error;owner=false;}}
    if(d.request.exists||d.jobMarker.exists||row?.jobId){
      if(!d.request.exists||!d.jobMarker.exists||!row)owner=false;
      else{
        try{
          const jobId=await this.verifiedExternalJob(tx,d.request,witness.accountId,witness.inputId,requestKey,witness.operation,witness.revision,witness);
          if(row.jobId!==jobId||!['job_created','needs_review'].includes(row.state)||!sameIntentWitness(d.jobMarker.data(),witness)||d.jobMarker.get('jobId')!==jobId||d.jobMarker.get('historyProtocol')!==1)owner=false;
        }catch(error){if(!(error instanceof LedgerFault))throw error;owner=false;}
      }
    }
    const reviewValid=!oldReview.exists||oldReview.get('accountId')===witness.accountId&&oldReview.get('identityKey')===witness.identityKey&&oldReview.get('intentId')===key&&oldReview.get('reservationId')===witness.reservationId&&oldReview.get('expectedSeconds')===witness.seconds;
    const holdValid=!oldHold.exists||matchesHold(oldHold.data(),hold)&&['pending','applied','needs_review'].includes(oldHold.get('state'));
    const now=Date.now(),attributed=!!owner;
    tx.create(incident,{...witness,state:'needs_review',kind:'direct_status_uncertainty',source:snapshot.source,observedState:observed.state,observedSeconds:observed.seconds,directObservationSnapshot:snapshot,directSnapshotHash:directSnapshotHash(snapshot),attribution:attributed?'verified':'unverified',ownerBlocked:attributed,createdAtMs:now,updatedAtMs:now});
    // An absent or incompatible marker remains unresolved and is never backfilled.
    if(validClearIntentAdmissionGuard(d.intentGuard,key))tx.update(d.intentGuard.ref,{state:'needs_review',incidentId,updatedAtMs:now});
    if(attributed){
      if(reviewValid&&!oldReview.exists)tx.create(review,{accountId:witness.accountId,intentId:key,inputId:witness.inputId,operation:witness.operation,revision:witness.revision,identityKey:witness.identityKey,reservationId:witness.reservationId,expectedSeconds:witness.seconds,reason:'direct_status_uncertain',firstObserved:{source:snapshot.source,state:observed.state,seconds:observed.seconds,atMs:now},createdAtMs:now,updatedAtMs:now});
      if(reviewValid&&holdValid&&!oldHold.exists)tx.create(holdRef,{...hold,state:'pending',attempts:0,nextAttemptAt:now,createdAtMs:now});
      tx.set(d.guard.ref,{accountId:witness.accountId,blocked:true,lastIncidentId:key,updatedAtMs:now},{merge:true});
      if(row&&!row.jobId&&['reserve_pending','release_pending'].includes(row.state))tx.update(d.intent.ref,{state:'needs_review',reviewReason:'direct_status_uncertain',reviewIncidentId:key,updatedAtMs:now});
    }
  }
  /** One synthetic/local call snapshot. It does not persist an attempt or authenticate Account. */
  async captureDirectObservation(witness:ExternalBillingIntentWitness,requestKey:string,source:DirectObservationSnapshot['source']):Promise<DirectObservationSnapshot|null>{
    validIntentWitness(witness);witness=copyIntentWitness(witness);validIntentWitness(witness);text(requestKey);
    if(hash([witness.accountId,requestKey])!==witness.intentId||!['status','seal','release'].includes(source))throw new LedgerFault('invalid');
    const attemptId=randomUUID();return this.db.runTransaction(async tx=>{
      const docs=await this.directObservationDocs(tx,witness);if(!this.validDirectObservationDocs(docs,witness,requestKey,source))return null;
      const versions={} as Record<DirectDocumentName,TerminalRecoveryDocumentVersion>;
      for(const name of directDocumentNames){const version=terminalDocumentVersion(docs[name]);if(!version)return null;versions[name]=version;}
      return copyDirectObservationSnapshot({attemptId,source,witness,versions});
    });
  }
  /** Preserve uncertainty from a read-only reserved status; never admit work or move balance. */
  async recordReservedStatusUncertainty(witnessInput:ExternalBillingIntentWitness,requestKey:string,snapshotInput:unknown):Promise<'unchanged'|'needs_review'>{
    text(requestKey);const snapshot=copyDirectObservationSnapshot(snapshotInput);
    if(!snapshot||snapshot.source!=='status'||!sameIntentWitness(witnessInput,snapshot.witness)||hash([snapshot.witness.accountId,requestKey])!==snapshot.witness.intentId)throw new LedgerFault('invalid');
    const witness=copyIntentWitness(snapshot.witness);validIntentWitness(witness);
    return this.db.runTransaction(async tx=>{
      const docs=await this.directObservationDocs(tx,witness);
      if(this.matchingDirectObservation(snapshot,docs,witness,requestKey,'status'))return 'unchanged';
      await this.preserveDirectUncertainty(tx,docs,witness,requestKey,snapshot,{state:'reserved',seconds:witness.seconds});
      return 'needs_review';
    });
  }
  private billingBlocked(doc:DocumentSnapshot,accountId:string){
    if(!doc.exists)return false;
    if(doc.get('accountId')!==accountId||typeof doc.get('blocked')!=='boolean')throw new LedgerFault('invariant');
    return doc.get('blocked')===true;
  }
  private billingIntent(doc:DocumentSnapshot,accountId:string,requestKey:string,billing:ExternalVideoBilling):ExternalBillingIntent{
    if(!doc.exists)throw new LedgerFault('not_found');
    const row=doc.data() as ExternalBillingIntent;
    if(row.id!==hash([accountId,requestKey])||row.accountId!==accountId||row.requestKey!==requestKey||
      typeof row.inputId!=='string'||!uuid.test(row.inputId)||typeof row.operation!=='string'||!row.operation.trim()||row.operation.length>200||
      !Number.isSafeInteger(row.revision)||row.revision<1||!['reserve_pending','release_pending','needs_review','job_created','insufficient','closed'].includes(row.state))throw new LedgerFault('invariant');
    if(!matchesExternalBilling(row,billing))throw new LedgerFault('conflict');
    return row;
  }
  /** A retry may read a prior job even while the account is blocked; never trust a dangling request. */
  private async verifiedExternalJob(tx:Transaction,prior:DocumentSnapshot,accountId:string,inputId:string,requestKey:string,operation:string,revision:number,billing:ExternalVideoBilling){
    if(prior.get('accountId')!==accountId||prior.get('requestFingerprint')!==requestFingerprint(inputId,operation,revision,AI_CATALOG_VERSION))throw new LedgerFault('conflict');
    const jobId=prior.get('jobId');if(typeof jobId!=='string'||!uuid.test(jobId))throw new LedgerFault('invariant');
    const job=(await tx.get(this.ref('jobs',jobId))).data() as Job|undefined;
    if(!job||job.accountId!==accountId||job.inputId!==inputId||job.requestKey!==requestKey||job.operation!==operation||job.revision!==revision||
      job.aiProfile!==AI_CATALOG_VERSION||job.price!==billing.seconds||!matchesExternalBilling(job.externalBilling,billing))throw new LedgerFault('invariant');
    return jobId;
  }
  /** Classification and reserve evidence are durable; absence is never proof of simulation. */
  async jobAccounting(tx:Transaction,jobId:string,job:Job):Promise<JobAccountingMode>{
    try{
      identifier(jobId);identifier(job.accountId);identifier(job.inputId);text(job.requestKey);text(job.operation);integer(job.price,true);
      if(job.revision!==null)integer(job.revision,true);
      if(job.aiProfile!==undefined&&job.aiProfile!==AI_CATALOG_VERSION)throw new LedgerFault('invalid');
      const [classification,reserve,outbox]=await tx.getAll(this.ref('jobAccounting',jobId),this.ref('movements','reserve:'+jobId),this.ref('billingOutbox',jobId)),row=classification.data();
      if(!row||row.protocol!==1||row.jobId!==jobId||row.accountId!==job.accountId||row.inputId!==job.inputId||row.requestKey!==job.requestKey||row.operation!==job.operation||row.revision!==job.revision||row.price!==job.price||row.profile!==(job.aiProfile??null)||!Number.isSafeInteger(row.createdAtMs)||row.createdAtMs<0)return 'unverified';
      const common=['protocol','jobId','accountId','inputId','requestKey','operation','revision','price','profile','mode','createdAtMs'];
      if(row.mode==='simulation'){
        if(Object.keys(row).length!==common.length||common.some(field=>!Object.hasOwn(row,field))||job.externalBilling!==undefined||outbox.exists||!reserve.exists||reserve.get('accountId')!==job.accountId||reserve.get('reference')!==jobId||reserve.get('kind')!=='reserve'||reserve.get('credits')!==job.price)return 'unverified';
        return 'simulation';
      }
      if(row.mode!=='account_seconds'||Object.keys(row).length!==common.length+4||[...common,'provider','identityKey','reservationId','seconds'].some(field=>!Object.hasOwn(row,field))||!job.externalBilling||reserve.exists)return 'unverified';
      validExternalBilling(job.externalBilling);
      if(!matchesExternalBilling(row,job.externalBilling)||row.seconds!==job.price)return 'unverified';
      if(outbox.exists&&(!matchesExternalBilling(outbox.data(),job.externalBilling)||outbox.get('accountId')!==job.accountId||outbox.get('jobId')!==jobId||!['capture','release'].includes(outbox.get('action'))))return 'unverified';
      return 'account_seconds';
    }catch(error){if(error instanceof LedgerFault)return 'unverified';throw error;}
  }
  private async externalJobLinksAllowed(tx:Transaction,jobId:string,job:Job,requireOpenAccount:boolean){
    const mode=await this.jobAccounting(tx,jobId,job);if(mode==='unverified')return false;if(mode==='simulation')return true;
    try{
      identifier(jobId);identifier(job.accountId);identifier(job.inputId);text(job.requestKey);text(job.operation);
      if(!Number.isSafeInteger(job.revision)||Number(job.revision)<1||job.aiProfile!==AI_CATALOG_VERSION)throw new LedgerFault('invalid');
      const billing=job.externalBilling!;validExternalBilling(billing);if(job.price!==billing.seconds)throw new LedgerFault('invalid');
      const witness=intentWitness(job.accountId,job.inputId,job.requestKey,job.operation,job.revision!,billing),key=witness.intentId;
      const [guard,intentGuard,intent,origin,request,marker,identity]=await tx.getAll(this.ref('billingGuards',job.accountId),this.ref('billingIntentAdmissionGuards',key),this.ref('billingIntents',key),this.ref('billingIntentWitnesses',key),this.ref('requests',key),this.ref('billingIntentJobMarkers',key),this.ref('identities',billing.identityKey));
      if(requireOpenAccount&&this.billingBlocked(guard,job.accountId)||!validClearIntentAdmissionGuard(intentGuard,key)||!validStoredIntentWitness(origin,witness))return false;
      const row=this.billingIntent(intent,job.accountId,job.requestKey,billing),uid=identity.get('uid');
      return row.state==='job_created'&&row.jobId===jobId&&row.inputId===job.inputId&&row.operation===job.operation&&row.revision===job.revision&&
        request.exists&&request.get('accountId')===job.accountId&&request.get('jobId')===jobId&&request.get('requestFingerprint')===requestFingerprint(job.inputId,job.operation,job.revision!,AI_CATALOG_VERSION)&&
        sameIntentWitness(marker.data(),witness)&&marker.get('jobId')===jobId&&marker.get('historyProtocol')===1&&
        identity.exists&&identity.get('accountId')===job.accountId&&typeof uid==='string'&&!!uid&&uid.length<=128&&hash(['firebase',uid])===billing.identityKey;
    }catch(error){if(error instanceof LedgerFault)return false;throw error;}
  }
  /** For new processing; cannot revoke an already-sent request. */
  async externalJobAdmissionAllowed(tx:Transaction,jobId:string,job:Job){
    if(narrationRequiresReview(job.operation))return false;
    return this.externalJobLinksAllowed(tx,jobId,job,true);
  }
  /** For an authorized result read. The caller must separately verify owner and settled capture. */
  async externalJobResultAllowed(tx:Transaction,jobId:string,job:Job){return this.externalJobLinksAllowed(tx,jobId,job,false);}
  /** Attribute a corrupt outbox only through a consistent job, identity, request and intent. */
  private async verifiedOutboxOwner(tx:Transaction,jobId:string,jobDoc:DocumentSnapshot,expected?:ExternalBillingOutboxSnapshot){
    const job=jobDoc.data() as Job|undefined;
    if(!job||typeof job.accountId!=='string'||!uuid.test(job.accountId)||typeof job.inputId!=='string'||!uuid.test(job.inputId)||
      typeof job.requestKey!=='string'||!job.requestKey.trim()||job.requestKey.length>200||typeof job.operation!=='string'||!job.operation.trim()||job.operation.length>200||
      !Number.isSafeInteger(job.revision)||job.revision!<1||job.aiProfile!==AI_CATALOG_VERSION||!job.externalBilling)return null;
    const billing=job.externalBilling;try{validExternalBilling(billing);}catch(error){if(error instanceof LedgerFault)return null;throw error;}
    if(job.price!==billing.seconds||expected&&(expected.jobId!==jobId||expected.accountId!==job.accountId||!matchesExternalBilling(expected,billing)))return null;
    const accountId=job.accountId,key=hash([accountId,job.requestKey]),account=this.ref('accounts',accountId),identity=this.ref('identities',billing.identityKey),
      request=this.ref('requests',key),intent=this.ref('billingIntents',key),guard=this.ref('billingGuards',accountId);
    const [a,identityDoc,prior,intentDoc,guardDoc]=await tx.getAll(account,identity,request,intent,guard);
    const uid=identityDoc.get('uid');
    if(!a.exists||!identityDoc.exists||identityDoc.get('accountId')!==accountId||typeof uid!=='string'||!uid||uid.length>128||hash(['firebase',uid])!==billing.identityKey||
      !prior.exists||prior.get('accountId')!==accountId||prior.get('jobId')!==jobId||prior.get('requestFingerprint')!==requestFingerprint(job.inputId,job.operation,job.revision,AI_CATALOG_VERSION))return null;
    let row:ExternalBillingIntent;try{row=this.billingIntent(intentDoc,accountId,job.requestKey,billing);}catch(error){if(error instanceof LedgerFault)return null;throw error;}
    if(row.inputId!==job.inputId||row.operation!==job.operation||row.revision!==job.revision||row.jobId!==jobId||!['job_created','needs_review'].includes(row.state))return null;
    let guardBlocked:boolean;try{guardBlocked=this.billingBlocked(guardDoc,accountId);}catch(error){if(error instanceof LedgerFault)return null;throw error;}
    return {accountId,guard,intent,intentState:row.state,guardBlocked,job,billing};
  }
  /** uid comes exclusively from a verified Firebase identity, never the request body. */
  async accountForUid(uid: string) {
    if (typeof uid !== 'string' || !uid || uid.length > 128) throw new LedgerFault('invalid');
    const accountId = randomUUID(), identity = this.ref('identities', hash(['firebase', uid]));
    return diagnosticTransaction('identity',this.db,async tx => {
      const prior = await diagnosticStage('identity.read',()=>tx.get(identity));
      if (prior.exists) return prior.get('accountId') as string;
      tx.create(identity, { accountId, uid });
      tx.create(this.ref('accounts', accountId), { credited: 0, available: 0, reserved: 0, consumed: 0, active: 0 });
      return accountId;
    });
  }
  private validateProjectWrite(accountId: string, inputId: string, expectedRevision: number, draft: string) {
    identifier(accountId); identifier(inputId); integer(expectedRevision);
    if (typeof draft !== 'string' || Buffer.byteLength(draft) > 65536) throw new LedgerFault('invalid');
  }
  private async saveProjectInTransaction(tx:Transaction,accountId:string,inputId:string,expectedRevision:number,draft:string) {
    const projectRef=this.ref('projects',inputId);
    const [input,previous]=await tx.getAll(this.ref('inputs',inputId),projectRef);
    if(!input.exists||input.get('accountId')!==accountId||input.get('deleted')||input.get('expiresAtMs')<=Date.now()||
      (previous.exists&&(previous.get('accountId')!==accountId||previous.get('inputId')!==inputId)))throw new LedgerFault('not_found');
    const revision=previous.exists?previous.get('revision') as number:0;
    if(revision!==expectedRevision)throw new LedgerFault('conflict');
    const nextRevision=revision+1;integer(nextRevision,true);
    const project={accountId,inputId,revision:nextRevision,draft,updatedAtMs:Date.now(),reviewedTextRevision:nextRevision,reviewedTextSha256:draftSha(draft),reviewedAtMs:Date.now()};
    tx.set(projectRef,project);return project;
  }
  /** Trusted internal path; requests must use saveProjectForUid. */
  async saveProject(accountId:string,inputId:string,expectedRevision:number,draft:string) {
    this.validateProjectWrite(accountId,inputId,expectedRevision,draft);
    return this.db.runTransaction(tx=>this.saveProjectInTransaction(tx,accountId,inputId,expectedRevision,draft));
  }
  /** uid is taken from a verified Firebase token, not the request body. */
  async saveProjectForUid(accountId:string,inputId:string,expectedRevision:number,draft:string,uid:string) {
    this.validateProjectWrite(accountId,inputId,expectedRevision,draft);
    return this.db.runTransaction(async tx=>{
      if(!await verifiedUidAccountInTransaction(tx,this.root,accountId,uid))throw new LedgerFault('not_found');
      return this.saveProjectInTransaction(tx,accountId,inputId,expectedRevision,draft);
    });
  }
  private async readProjectInTransaction(tx:Transaction,accountId:string,inputId:string) {
    const [input,project]=await diagnosticStage('project.read',()=>tx.getAll(this.ref('inputs',inputId),this.ref('projects',inputId)));
    if(!input.exists||input.get('accountId')!==accountId||input.get('deleted')||input.get('expiresAtMs')<=Date.now()||
      !project.exists||project.get('accountId')!==accountId||project.get('inputId')!==inputId)throw new LedgerFault('not_found');
    return project.data()!;
  }
  /** Trusted internal path; requests must use readProjectForUid. */
  async readProject(accountId:string,inputId:string) {
    identifier(accountId);identifier(inputId);
    return diagnosticTransaction('project',this.db,tx=>this.readProjectInTransaction(tx,accountId,inputId));
  }
  /** Firebase token verification precedes this transaction and is not atomic with it. */
  async readProjectForUid(accountId:string,inputId:string,uid:string) {
    identifier(accountId);identifier(inputId);
    return diagnosticTransaction('project',this.db,async tx=>{
      if(!await verifiedUidAccountInTransaction(tx,this.root,accountId,uid))throw new LedgerFault('not_found');
      return this.readProjectInTransaction(tx,accountId,inputId);
    });
  }
  async priorRequest(accountId: string, inputId: string, requestKey: string, operation: string, expectedRevision: number,aiProfile?:typeof AI_CATALOG_VERSION) {
    if(aiProfile!==undefined&&aiProfile!==AI_CATALOG_VERSION)throw new LedgerFault('invalid');
    identifier(accountId); identifier(inputId); text(requestKey); text(operation); integer(expectedRevision,true);
    const prior = await diagnosticStage('request.lookup',()=>this.ref('requests',hash([accountId,requestKey])).get());
    if (!prior.exists) return null;
    if (prior.get('requestFingerprint') !== requestFingerprint(inputId,operation,expectedRevision,aiProfile)) throw new LedgerFault('conflict');
    return prior.get('jobId') as string;
  }
  /** Generic customer replay: verified UID and the full prior-job linkage share one transaction. */
  async priorRequestForUid(accountId:string,inputId:string,requestKey:string,operation:string,expectedRevision:number,uid:string) {
    identifier(accountId);identifier(inputId);text(requestKey);text(operation);integer(expectedRevision,true);
    if(typeof uid!=='string'||!uid||uid.length>128)throw new LedgerFault('not_found');
    return this.db.runTransaction(async tx=>{
      if(!await verifiedUidAccountInTransaction(tx,this.root,accountId,uid))throw new LedgerFault('not_found');
      const [account,prior]=await tx.getAll(this.ref('accounts',accountId),this.ref('requests',hash([accountId,requestKey])));
      if(!account.exists)throw new LedgerFault('not_found');if(!prior.exists)return null;
      const jobId=prior.get('jobId');
      if(prior.get('accountId')!==accountId||prior.get('requestFingerprint')!==requestFingerprint(inputId,operation,expectedRevision)||typeof jobId!=='string'||!uuid.test(jobId))throw new LedgerFault('conflict');
      const job=(await tx.get(this.ref('jobs',jobId))).data() as Job|undefined;
      if(!job||job.accountId!==accountId||job.inputId!==inputId||job.requestKey!==requestKey||job.operation!==operation||job.revision!==expectedRevision||job.aiProfile!==undefined||await this.jobAccounting(tx,jobId,job)!=='simulation')throw new LedgerFault('conflict');
      return jobId;
    });
  }
  async priorSimulatedRequestForEnqueue(accountId:string,inputId:string,requestKey:string,operation:string,expectedRevision:number,aiProfile:typeof AI_CATALOG_VERSION){
    if(aiProfile!==AI_CATALOG_VERSION)throw new LedgerFault('invalid');identifier(accountId);identifier(inputId);text(requestKey);text(operation);integer(expectedRevision,true);
    return this.db.runTransaction(async tx=>{
      const prior=await tx.get(this.ref('requests',hash([accountId,requestKey])));if(!prior.exists)return null;
      const jobId=prior.get('jobId');if(prior.get('accountId')!==accountId||prior.get('requestFingerprint')!==requestFingerprint(inputId,operation,expectedRevision,aiProfile)||typeof jobId!=='string'||!uuid.test(jobId))throw new LedgerFault('conflict');
      const jobDoc=await tx.get(this.ref('jobs',jobId)),job=jobDoc.data() as Job|undefined;
      if(!job||job.accountId!==accountId||job.inputId!==inputId||job.requestKey!==requestKey||job.operation!==operation||job.revision!==expectedRevision||job.aiProfile!==aiProfile||await this.jobAccounting(tx,jobId,job)!=='simulation')throw new LedgerFault('conflict');
      return jobId;
    });
  }
  /** Customer replay for simulated AI; identity, account and job evidence share one transaction. */
  async priorSimulatedRequestForEnqueueForUid(accountId:string,inputId:string,requestKey:string,operation:string,expectedRevision:number,aiProfile:typeof AI_CATALOG_VERSION,uid:string){
    if(aiProfile!==AI_CATALOG_VERSION)throw new LedgerFault('invalid');identifier(accountId);identifier(inputId);text(requestKey);text(operation);integer(expectedRevision,true);
    if(typeof uid!=='string'||!uid||uid.length>128)throw new LedgerFault('not_found');
    return this.db.runTransaction(async tx=>{
      if(!await verifiedUidAccountInTransaction(tx,this.root,accountId,uid))throw new LedgerFault('not_found');
      const [account,prior]=await tx.getAll(this.ref('accounts',accountId),this.ref('requests',hash([accountId,requestKey])));
      if(!account.exists)throw new LedgerFault('not_found');
      if(account.get('aiPilot')!==true||account.get('simulationOnly')!==true)throw new LedgerFault('conflict');
      if(!prior.exists)return null;
      const jobId=prior.get('jobId');if(prior.get('accountId')!==accountId||prior.get('requestFingerprint')!==requestFingerprint(inputId,operation,expectedRevision,aiProfile)||typeof jobId!=='string'||!uuid.test(jobId))throw new LedgerFault('conflict');
      const job=(await tx.get(this.ref('jobs',jobId))).data() as Job|undefined;
      if(!job||job.accountId!==accountId||job.inputId!==inputId||job.requestKey!==requestKey||job.operation!==operation||job.revision!==expectedRevision||job.aiProfile!==aiProfile||await this.jobAccounting(tx,jobId,job)!=='simulation')throw new LedgerFault('conflict');
      return jobId;
    });
  }
  /** Enqueue is an admission, not the separate read-only lookup of an existing job. */
  async priorExternalRequestForEnqueue(accountId:string,inputId:string,requestKey:string,operation:string,expectedRevision:number,aiProfile:typeof AI_CATALOG_VERSION,requesterUid:string){
    if(aiProfile!==AI_CATALOG_VERSION)throw new LedgerFault('invalid');identifier(accountId);identifier(inputId);text(requestKey);text(operation);integer(expectedRevision,true);
    if(typeof requesterUid!=='string'||!requesterUid||requesterUid.length>128)throw new LedgerFault('not_found');
    const key=hash([accountId,requestKey]);return this.db.runTransaction(async tx=>{
      if(!await verifiedUidAccountInTransaction(tx,this.root,accountId,requesterUid))throw new LedgerFault('not_found');
      const [account,prior,blocked,intent,origin,jobMarker,intentGuard,input]=await tx.getAll(this.ref('accounts',accountId),this.ref('requests',key),this.ref('billingGuards',accountId),this.ref('billingIntents',key),this.ref('billingIntentWitnesses',key),this.ref('billingIntentJobMarkers',key),this.ref('billingIntentAdmissionGuards',key),this.ref('inputs',inputId));
      if(!account.exists)throw new LedgerFault('not_found');
      if(account.get('aiPilot')!==true||account.get('simulationOnly')!==true)throw new LedgerFault('conflict');
      if(this.billingBlocked(blocked,accountId))throw new LedgerFault('conflict');
      if(prior.exists||intent.exists||origin.exists||jobMarker.exists){if(!validClearIntentAdmissionGuard(intentGuard,key))throw new LedgerFault('conflict');}
      else if(intentGuard.exists)throw new LedgerFault('conflict');
      if(!prior.exists)return null;
      if(!intent.exists||!input.exists||input.get('accountId')!==accountId)throw new LedgerFault('conflict');
      const stored=intent.data() as ExternalBillingIntent;validExternalBilling(stored);
      const row=this.billingIntent(intent,accountId,requestKey,stored),witness=intentWitness(accountId,inputId,requestKey,operation,expectedRevision,stored);
      if(row.state!=='job_created'||row.inputId!==inputId||row.operation!==operation||row.revision!==expectedRevision||!validStoredIntentWitness(origin,witness))throw new LedgerFault('conflict');
      const identity=await tx.get(this.ref('identities',stored.identityKey)),uid=identity.get('uid');
      if(!identity.exists||identity.get('accountId')!==accountId||typeof uid!=='string'||!uid||uid.length>128||hash(['firebase',uid])!==stored.identityKey||uid!==requesterUid)throw new LedgerFault('conflict');
      const jobId=await this.verifiedExternalJob(tx,prior,accountId,inputId,requestKey,operation,expectedRevision,stored);
      if(row.jobId!==jobId||!sameIntentWitness(jobMarker.data(),witness)||jobMarker.get('jobId')!==jobId||jobMarker.get('historyProtocol')!==1)throw new LedgerFault('conflict');
      const current=(await tx.get(this.ref('jobs',jobId))).data() as Job|undefined;
      if(!current||await this.jobAccounting(tx,jobId,current)!=='account_seconds')throw new LedgerFault('conflict');
      return jobId;
    });
  }
  /** Persist cross-database recovery data before reserving in the account service. */
  async beginExternalBillingIntent(accountId:string,inputId:string,requestKey:string,operation:string,revision:number,billing:ExternalVideoBilling){
    identifier(accountId);identifier(inputId);text(requestKey);text(operation);integer(revision,true);
    validExternalBilling(billing);billing=copyExternalBilling(billing);validExternalBilling(billing);const witness=intentWitness(accountId,inputId,requestKey,operation,revision,billing);
    const id=witness.intentId,a=this.ref('accounts',accountId),i=this.ref('inputs',inputId),p=this.ref('projects',inputId),r=this.ref('requests',id),intent=this.ref('billingIntents',id),guard=this.ref('billingGuards',accountId),identity=this.ref('identities',billing.identityKey),origin=this.ref('billingIntentWitnesses',id),jobMarker=this.ref('billingIntentJobMarkers',id),intentGuard=this.ref('billingIntentAdmissionGuards',id);
    return this.db.runTransaction(async tx=>{
      const [account,input,project,prior,old,blocked,owner,storedWitness,storedJobMarker,storedIntentGuard]=await tx.getAll(a,i,p,r,intent,guard,identity,origin,jobMarker,intentGuard);
      if(!account.exists)throw new LedgerFault('not_found');
      if(this.billingBlocked(blocked,accountId))throw new LedgerFault('conflict');
      if(prior.exists||old.exists||storedWitness.exists||storedJobMarker.exists){if(!validClearIntentAdmissionGuard(storedIntentGuard,id))throw new LedgerFault('conflict');}
      else if(storedIntentGuard.exists)throw new LedgerFault('conflict');
      if(prior.exists){
        const jobId=await this.verifiedExternalJob(tx,prior,accountId,inputId,requestKey,operation,revision,billing);
        if(old.exists){const row=this.billingIntent(old,accountId,requestKey,billing);if(row.inputId!==inputId||row.operation!==operation||row.revision!==revision||row.jobId&&row.jobId!==jobId)throw new LedgerFault('invariant');}
        return jobId;
      }
      if(!input.exists||input.get('accountId')!==accountId||input.get('deleted')||input.get('expiresAtMs')<=Date.now()||!project.exists||project.get('accountId')!==accountId||project.get('revision')!==revision)throw new LedgerFault('not_found');
      const uid=owner.get('uid');if(!owner.exists||owner.get('accountId')!==accountId||typeof uid!=='string'||!uid||uid.length>128||hash(['firebase',uid])!==billing.identityKey)throw new LedgerFault('conflict');
      if(old.exists){const row=this.billingIntent(old,accountId,requestKey,billing);if(row.inputId!==inputId||row.operation!==operation||row.revision!==revision)throw new LedgerFault('conflict');
        // A legacy active intent cannot be adopted from today's absence of a request/job.
        if(!validStoredIntentWitness(storedWitness,witness)||storedJobMarker.exists)throw new LedgerFault('conflict');
        if(row.state==='job_created'||row.jobId)throw new LedgerFault('invariant');
        if(['release_pending','needs_review','closed'].includes(row.state))throw new LedgerFault('conflict');
        const nextAttemptAt=externalIntentTransitionDue(old);
        if(row.state==='insufficient'){const attempts=old.get('attempts')??0;integer(attempts);tx.update(intent,{state:'reserve_pending',updatedAtMs:Date.now(),nextAttemptAt,lastErrorCode:null,attempts:attempts+1});}
        else tx.update(intent,{updatedAtMs:Date.now()});
      }else{
        if(storedWitness.exists||storedJobMarker.exists)throw new LedgerFault('invariant');
        const now=Date.now();tx.create(origin,{intentId:witness.intentId,accountId:witness.accountId,inputId:witness.inputId,operation:witness.operation,
          revision:witness.revision,profile:witness.profile,provider:witness.provider,identityKey:witness.identityKey,
          reservationId:witness.reservationId,seconds:witness.seconds,historyProtocol:1,baseline:'before_reservation',createdAtMs:now,
          terminalRecovery:{protocol:1,sealPrepared:false,releasePrepared:false}});
        tx.create(intent,{id,accountId,inputId,requestKey,operation,revision,...copyExternalBilling(billing),state:'reserve_pending',createdAtMs:now,updatedAtMs:now,nextAttemptAt:now,attempts:1});
        tx.create(intentGuard,{protocol:1,intentId:id,state:'clear',createdAtMs:now});
      }
      return null;
    });
  }
  /** The origin is created with the intent, before Account is contacted; never backfill it from a current absence. */
  async externalIntentWitness(accountId:string,requestKey:string,billing:ExternalVideoBilling):Promise<ExternalBillingIntentWitness>{
    identifier(accountId);text(requestKey);validExternalBilling(billing);billing=copyExternalBilling(billing);validExternalBilling(billing);const key=hash([accountId,requestKey]);
    return this.db.runTransaction(async tx=>{
      const [account,identity,intent,origin]=await tx.getAll(this.ref('accounts',accountId),this.ref('identities',billing.identityKey),this.ref('billingIntents',key),this.ref('billingIntentWitnesses',key));
      if(!account.exists)throw new LedgerFault('not_found');const row=this.billingIntent(intent,accountId,requestKey,billing),uid=identity.get('uid');
      const witness=intentWitness(accountId,row.inputId,requestKey,row.operation,row.revision,billing),input=await tx.get(this.ref('inputs',row.inputId));
      if(!identity.exists||identity.get('accountId')!==accountId||typeof uid!=='string'||!uid||uid.length>128||hash(['firebase',uid])!==billing.identityKey||!input.exists||input.get('accountId')!==accountId||!validStoredIntentWitness(origin,witness))throw new LedgerFault('conflict');
      return witness;
    });
  }
  /** Read one correlated terminal witness; never adopt extra document fields or mutate state. */
  async terminalWitnessForRecovery(terminalId:string):Promise<{witness:ExternalBillingIntentWitness;action:'seal'|'release';snapshot:TerminalRecoveryReadSnapshot}|null>{
    if(typeof terminalId!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(terminalId))throw new LedgerFault('invalid');
    return this.db.runTransaction(async tx=>{
      const terminal=await tx.get(this.ref('billingIntentTerminalWitnesses',terminalId)),row=terminal.data();
      if(!terminal.exists||!row||!['seal','release'].includes(row.action)||row.historyProtocol!==1||row.stage!=='prepared'||!Number.isSafeInteger(row.createdAtMs)||row.createdAtMs<0)return null;
      const witness:ExternalBillingIntentWitness={intentId:row.intentId,accountId:row.accountId,inputId:row.inputId,operation:row.operation,revision:row.revision,profile:row.profile,provider:row.provider,identityKey:row.identityKey,reservationId:row.reservationId,seconds:row.seconds};
      try{validIntentWitness(witness);}catch(error){if(error instanceof LedgerFault)return null;throw error;}
      const action=row.action as 'seal'|'release';if(terminalId!==intentTerminalKey(witness.intentId,action))return null;
      const sealId=intentTerminalKey(witness.intentId,'seal'),releaseId=intentTerminalKey(witness.intentId,'release');
      const [account,identity,input,origin,sealWitness,sealRecovery,releaseWitness,releaseRecovery]=await tx.getAll(
        this.ref('accounts',witness.accountId),this.ref('identities',witness.identityKey),this.ref('inputs',witness.inputId),this.ref('billingIntentWitnesses',witness.intentId),
        this.ref('billingIntentTerminalWitnesses',sealId),this.ref('billingIntentTerminalRecovery',sealId),
        this.ref('billingIntentTerminalWitnesses',releaseId),this.ref('billingIntentTerminalRecovery',releaseId));
      const uid=identity.get('uid');
      if(!account.exists||!identity.exists||identity.get('accountId')!==witness.accountId||typeof uid!=='string'||!uid||uid.length>128||hash(['firebase',uid])!==witness.identityKey||!input.exists||input.get('accountId')!==witness.accountId||!validTerminalRecoveryOrigin(origin,witness))return null;
      const marker=origin.get('terminalRecovery');
      if(!marker[action==='seal'?'sealPrepared':'releasePrepared']||
        !validInitialReaderPair(marker.sealPrepared,sealWitness,sealRecovery,witness,'seal')||
        !validInitialReaderPair(marker.releasePrepared,releaseWitness,releaseRecovery,witness,'release'))return null;
      const selectedVersion=terminalDocumentVersion(terminal);
      if(!selectedVersion||!sameTerminalDocumentVersion(action==='seal'?sealWitness:releaseWitness,selectedVersion))return null;
      const snapshot=copyTerminalRecoveryReadSnapshot({intentId:witness.intentId,action,origin:terminalDocumentVersion(origin),sealWitness:terminalDocumentVersion(sealWitness),sealRecovery:terminalDocumentVersion(sealRecovery),releaseWitness:terminalDocumentVersion(releaseWitness),releaseRecovery:terminalDocumentVersion(releaseRecovery)});
      return snapshot?{witness,action,snapshot}:null;
    });
  }
  /**
   * Capture before a remote operation; callers must never refresh this after an
   * error and treat the new snapshot as evidence of the old operation.
   * A claimed lease is usable only with its independently held exact tuple.
   */
  async captureExternalBillingIntentFailureEvidence(witness:ExternalBillingIntentWitness,requestKey:string,expectedVersion?:string,lease?:ExternalBillingIntentLease):Promise<ExternalBillingIntentFailureEvidence|null>{
    validIntentWitness(witness);text(requestKey);if(hash([witness.accountId,requestKey])!==witness.intentId)throw new LedgerFault('invalid');
    if(expectedVersion!==undefined&&!/^\d{1,15}:\d{9}(?![\s\S])/.test(expectedVersion))return null;
    return this.db.runTransaction(async tx=>{
      const [account,identity,input,origin,intent,request,marker,guard,intentGuard]=await tx.getAll(this.ref('accounts',witness.accountId),this.ref('identities',witness.identityKey),this.ref('inputs',witness.inputId),this.ref('billingIntentWitnesses',witness.intentId),this.ref('billingIntents',witness.intentId),this.ref('requests',witness.intentId),this.ref('billingIntentJobMarkers',witness.intentId),this.ref('billingGuards',witness.accountId),this.ref('billingIntentAdmissionGuards',witness.intentId));
      const version=outboxVersion(intent),intentGuardVersion=outboxVersion(intentGuard),uid=identity.get('uid');
      if(!version||!intentGuardVersion||expectedVersion!==undefined&&version!==expectedVersion||!account.exists||!identity.exists||identity.get('accountId')!==witness.accountId||
        typeof uid!=='string'||!uid||uid.length>128||hash(['firebase',uid])!==witness.identityKey||!input.exists||input.get('accountId')!==witness.accountId||!validStoredIntentWitness(origin,witness)||!validClearIntentAdmissionGuard(intentGuard,witness.intentId)||request.exists||marker.exists||this.billingBlocked(guard,witness.accountId))return null;
      const row=this.billingIntent(intent,witness.accountId,requestKey,witness);
      if(row.inputId!==witness.inputId||row.operation!==witness.operation||row.revision!==witness.revision||row.jobId||!['reserve_pending','release_pending'].includes(row.state))return null;
      externalIntentTransitionDue(intent);const raw=intent.data()!,base={snapshotVersion:version,intentGuardVersion,state:row.state as 'reserve_pending'|'release_pending',witness};
      if(!hasIntentLease(raw))return lease?null:{...base,mode:'unleased'};
      // The current drainer holds no lease. Do not infer ownership from the row.
      if(!lease||!sameIntentLease(raw,lease)||lease.leaseUntil<=Date.now())return null;
      return {...base,mode:'leased',leaseToken:lease.leaseToken,leaseOwner:lease.leaseOwner,generation:lease.generation,leaseUntil:lease.leaseUntil};
    });
  }
  /** Create the action witness and recovery task without overwriting either on this path.
   * Privileged writers can still modify or delete these documents; reconciliation must detect that. */
  async prepareExternalIntentTerminal(witness:ExternalBillingIntentWitness,requestKey:string,action:'release'|'seal'):Promise<{state:'ready'}|{state:'job_created';jobId:string}>{
    validIntentWitness(witness);witness=copyIntentWitness(witness);validIntentWitness(witness);text(requestKey);if(!['release','seal'].includes(action)||hash([witness.accountId,requestKey])!==witness.intentId)throw new LedgerFault('invalid');
    const key=witness.intentId,terminalId=intentTerminalKey(key,action),actionRef=this.ref('billingIntentTerminalWitnesses',terminalId),recoveryRef=this.ref('billingIntentTerminalRecovery',terminalId);
    return this.db.runTransaction(async tx=>{
      const [account,identity,input,intent,origin,request,jobMarker,guard,terminal,intentGuard]=await tx.getAll(this.ref('accounts',witness.accountId),this.ref('identities',witness.identityKey),this.ref('inputs',witness.inputId),this.ref('billingIntents',key),this.ref('billingIntentWitnesses',key),this.ref('requests',key),this.ref('billingIntentJobMarkers',key),this.ref('billingGuards',witness.accountId),actionRef,this.ref('billingIntentAdmissionGuards',key));
      const uid=identity.get('uid');if(!account.exists||!identity.exists||identity.get('accountId')!==witness.accountId||typeof uid!=='string'||!uid||uid.length>128||hash(['firebase',uid])!==witness.identityKey||!input.exists||input.get('accountId')!==witness.accountId||!validStoredIntentWitness(origin,witness))throw new LedgerFault('conflict');
      const row=this.billingIntent(intent,witness.accountId,requestKey,witness);
      if(row.inputId!==witness.inputId||row.operation!==witness.operation||row.revision!==witness.revision)throw new LedgerFault('conflict');
      if(!validClearIntentAdmissionGuard(intentGuard,key)||this.billingBlocked(guard,witness.accountId))throw new LedgerFault('conflict');
      if(request.exists){const jobId=await this.verifiedExternalJob(tx,request,witness.accountId,witness.inputId,requestKey,witness.operation,witness.revision,witness);return {state:'job_created',jobId};}
      if(jobMarker.exists||row.jobId||row.state!=='release_pending'||this.billingBlocked(guard,witness.accountId))throw new LedgerFault('conflict');
      externalIntentTransitionDue(intent);
      if(!validTerminalRecoveryOrigin(origin,witness))throw new LedgerFault('invariant');
      const markerField=action==='seal'?'sealPrepared':'releasePrepared',prepared=origin.get('terminalRecovery')[markerField] as boolean;
      const recovery=await tx.get(recoveryRef);
      if(prepared!==terminal.exists||prepared!==recovery.exists)throw new LedgerFault('invariant');
      if(prepared){
        const value=terminal.data()!;
        const fields=['intentId','accountId','inputId','operation','revision','profile','provider','identityKey','reservationId','seconds','action','historyProtocol','stage','createdAtMs'];
        if(Object.keys(value).length!==fields.length||fields.some(field=>!Object.hasOwn(value,field))||
          !sameIntentWitness(value,witness)||terminal.get('action')!==action||terminal.get('historyProtocol')!==1||
          terminal.get('stage')!=='prepared'||!Number.isSafeInteger(terminal.get('createdAtMs'))||terminal.get('createdAtMs')<0||
          !validInitialTerminalRecovery(recovery.data(),terminalId,terminal.get('createdAtMs')))throw new LedgerFault('invariant');
      }else{
        const now=Date.now();if(!Number.isSafeInteger(now)||now<0)throw new LedgerFault('invariant');
        tx.create(actionRef,{intentId:witness.intentId,accountId:witness.accountId,inputId:witness.inputId,operation:witness.operation,
          revision:witness.revision,profile:witness.profile,provider:witness.provider,identityKey:witness.identityKey,
          reservationId:witness.reservationId,seconds:witness.seconds,action,historyProtocol:1,stage:'prepared',createdAtMs:now});
        tx.create(recoveryRef,{terminalId,protocol:1,state:'pending',generation:0,attempts:0,createdAtMs:now,nextAttemptAt:now});
        tx.update(origin.ref,{[`terminalRecovery.${markerField}`]:true});
      }
      return {state:'ready'};
    });
  }
  /** Compare the original read and fence/prepare in one transaction. */
  async prepareTerminalFromDirectObservation(witness:ExternalBillingIntentWitness,requestKey:string,action:'release'|'seal',reason:'status_not_found'|'status_reserved'|'seal_reserved',snapshotInput:unknown):Promise<{state:'ready'}|{state:'changed'}|{state:'job_created';jobId:string}>{
    validIntentWitness(witness);witness=copyIntentWitness(witness);validIntentWitness(witness);text(requestKey);
    const snapshot=copyDirectObservationSnapshot(snapshotInput),source=reason==='seal_reserved'?'seal':'status';
    if(!snapshot||hash([witness.accountId,requestKey])!==witness.intentId||!['status_not_found','status_reserved','seal_reserved'].includes(reason)||action!==(reason==='status_not_found'?'seal':'release')||snapshot.source!==source||!sameIntentWitness(snapshot.witness,witness))return {state:'changed'};
    return this.db.runTransaction(async tx=>{
      const d=await this.directObservationDocs(tx,witness);
      if(!this.matchingDirectObservation(snapshot,d,witness,requestKey,source)){
        await this.preserveDirectUncertainty(tx,d,witness,requestKey,snapshot,{state:reason==='status_not_found'?'not_found':'reserved',seconds:reason==='status_not_found'?null:witness.seconds});
        return {state:'changed'};
      }
      const marker=d.origin.get('terminalRecovery'),prepared=marker[action==='seal'?'sealPrepared':'releasePrepared'] as boolean;
      const selected=action==='seal'?d.sealWitness:d.releaseWitness,recovery=action==='seal'?d.sealRecovery:d.releaseRecovery;
      if(d.intent.get('state')==='reserve_pending')tx.update(d.intent.ref,{state:'release_pending',updatedAtMs:Date.now(),nextAttemptAt:externalIntentTransitionDue(d.intent)});
      if(!prepared){
        const now=Date.now(),terminalId=intentTerminalKey(witness.intentId,action);if(!Number.isSafeInteger(now)||now<0)throw new LedgerFault('invariant');
        tx.create(selected.ref,{intentId:witness.intentId,accountId:witness.accountId,inputId:witness.inputId,operation:witness.operation,revision:witness.revision,profile:witness.profile,provider:witness.provider,identityKey:witness.identityKey,reservationId:witness.reservationId,seconds:witness.seconds,action,historyProtocol:1,stage:'prepared',createdAtMs:now});
        tx.create(recovery.ref,{terminalId,protocol:1,state:'pending',generation:0,attempts:0,createdAtMs:now,nextAttemptAt:now});
        tx.update(d.origin.ref,{[`terminalRecovery.${action==='seal'?'sealPrepared':'releasePrepared'}`]:true});
      }
      return {state:'ready'};
    });
  }
  /**
   * Last local check before contacting the account service. This is not a distributed
   * fence: the guard may change after this transaction and before the remote call.
   * In-flight reservations still require reconciliation; production acceptance remains open.
   */
  async recheckExternalBillingAdmission(accountId:string,requestKey:string,billing:ExternalVideoBilling):Promise<ExternalBillingAdmission>{
    identifier(accountId);text(requestKey);if(!billing||typeof billing!=='object')throw new LedgerFault('invalid');
    const authorizedBilling=copyExternalBilling(billing);validExternalBilling(authorizedBilling);
    const key=hash([accountId,requestKey]),account=this.ref('accounts',accountId),guard=this.ref('billingGuards',accountId),intent=this.ref('billingIntents',key),request=this.ref('requests',key),intentGuard=this.ref('billingIntentAdmissionGuards',key);
    return this.db.runTransaction(async tx=>{
      const [a,blocked,d,prior,admission]=await tx.getAll(account,guard,intent,request,intentGuard);
      if(!a.exists)throw new LedgerFault('not_found');
      if(this.billingBlocked(blocked,accountId)||!validClearIntentAdmissionGuard(admission,key))throw new LedgerFault('conflict');
      const row=this.billingIntent(d,accountId,requestKey,authorizedBilling);
      if(prior.exists){
        const jobId=await this.verifiedExternalJob(tx,prior,accountId,row.inputId,requestKey,row.operation,row.revision,authorizedBilling);
        if(!['job_created','needs_review'].includes(row.state)||row.jobId!==jobId)throw new LedgerFault('invariant');
        return {state:'job_created',jobId};
      }
      if(row.state==='job_created'||row.jobId)throw new LedgerFault('invariant');
      if(row.state!=='reserve_pending')throw new LedgerFault('conflict');
      return {state:'permitted'};
    });
  }
  async settleExternalBillingIntent(accountId:string,requestKey:string,state:'insufficient'|'closed'){
    text(requestKey);identifier(accountId);if(!['insufficient','closed'].includes(state))throw new LedgerFault('invalid');const key=hash([accountId,requestKey]),ref=this.ref('billingIntents',key),request=this.ref('requests',key);
    return this.db.runTransaction(async tx=>{const [d,prior]=await tx.getAll(ref,request);if(!d.exists)return false;if(d.get('accountId')!==accountId||d.get('requestKey')!==requestKey||prior.exists)return false;
      if(d.get('state')===state)return true;
      // Closure of a held reservation requires a release fence and an observed remote release.
      if(state!=='insufficient'||d.get('state')!=='reserve_pending')return false;
      externalIntentTransitionDue(d);tx.update(ref,{state,updatedAtMs:Date.now()});return true;
    });
  }
  /** Fence job creation in video Firestore before a separately authorized remote release. */
  async fenceExternalBillingRelease(accountId:string,requestKey:string,billing:ExternalVideoBilling):Promise<ExternalBillingReleaseFence>{
    identifier(accountId);text(requestKey);if(!billing||typeof billing!=='object')throw new LedgerFault('invalid');
    const authorizedBilling=copyExternalBilling(billing);validExternalBilling(authorizedBilling);
    const key=hash([accountId,requestKey]),account=this.ref('accounts',accountId),intent=this.ref('billingIntents',key),request=this.ref('requests',key),guard=this.ref('billingGuards',accountId),intentGuard=this.ref('billingIntentAdmissionGuards',key);
    return this.db.runTransaction(async tx=>{
      const [a,d,prior,blocked,admission]=await tx.getAll(account,intent,request,guard,intentGuard);if(!a.exists)throw new LedgerFault('not_found');
      if(this.billingBlocked(blocked,accountId)||!validClearIntentAdmissionGuard(admission,key))throw new LedgerFault('conflict');
      const row=this.billingIntent(d,accountId,requestKey,authorizedBilling);
      if(prior.exists){const jobId=await this.verifiedExternalJob(tx,prior,accountId,row.inputId,requestKey,row.operation,row.revision,authorizedBilling);if(row.jobId&&row.jobId!==jobId)throw new LedgerFault('invariant');return {state:'job_created',jobId};}
      if(row.state==='job_created'||row.jobId)throw new LedgerFault('invariant');
      if(row.state==='release_pending'){externalIntentTransitionDue(d);return {state:'release_pending'};}
      if(row.state!=='reserve_pending')throw new LedgerFault('conflict');
      const nextAttemptAt=externalIntentTransitionDue(d);
      tx.update(intent,{state:'release_pending',updatedAtMs:Date.now(),nextAttemptAt});return {state:'release_pending'};
    });
  }
  /** Preserve an anomalous external observation without issuing a refund or capture. */
  async recordExternalBillingReview(accountId:string,requestKey:string,billing:ExternalVideoBilling,observed:ExternalBillingObservation,snapshotInput?:unknown):Promise<ExternalBillingReviewResult>{
    identifier(accountId);text(requestKey);validExternalBilling(billing);billing=copyExternalBilling(billing);validExternalBilling(billing);
    if(!observed||typeof observed!=='object')throw new LedgerFault('invalid');observed={reservationId:observed.reservationId,state:observed.state,seconds:observed.seconds};
    if(!observed||observed.reservationId!==billing.reservationId||!['reserved','captured','released'].includes(observed.state)||!Number.isSafeInteger(observed.seconds)||observed.seconds<1)throw new LedgerFault('invalid');
    const snapshot=snapshotInput===undefined?undefined:copyDirectObservationSnapshot(snapshotInput);
    if(snapshotInput!==undefined&&(!snapshot||!['status','seal'].includes(snapshot.source)))throw new LedgerFault('invalid');
    const key=hash([accountId,requestKey]),hold=externalHold(accountId,billing.identityKey,'intent',key),account=this.ref('accounts',accountId),intent=this.ref('billingIntents',key),request=this.ref('requests',key),guard=this.ref('billingGuards',accountId),incident=this.ref('billingReviewIncidents',key),holdRef=this.ref('billingHoldOutbox',hold.id),intentGuard=this.ref('billingIntentAdmissionGuards',key);
    return this.db.runTransaction(async tx=>{
      const [a,d,prior,blocked,existing,holdDoc,admission]=await tx.getAll(account,intent,request,guard,incident,holdRef,intentGuard);
      if(snapshot){
        const witness=snapshot.witness;
        if(witness.accountId!==accountId||witness.intentId!==key||!matchesExternalBilling(witness,billing))throw new LedgerFault('invalid');
        const docs=await this.directObservationDocs(tx,witness);
        if(!this.matchingDirectObservation(snapshot,docs,witness,requestKey,snapshot.source)){
          await this.preserveDirectUncertainty(tx,docs,witness,requestKey,snapshot,{state:observed.state,seconds:observed.seconds});
          return {state:'needs_review',reason:'direct_status_uncertain'};
        }
      }
      if(!a.exists)throw new LedgerFault('not_found');
      const row=this.billingIntent(d,accountId,requestKey,billing);this.billingBlocked(blocked,accountId);
      const mismatch=observed.seconds!==billing.seconds;
      let jobId:string|undefined,confirmedJobId:string|undefined,detected:ExternalBillingReviewReason|undefined;
      if(prior.exists){
        const candidate=prior.get('jobId');
        if(typeof candidate!=='string'||!uuid.test(candidate))detected='intent_job_mismatch';
        else{
          jobId=candidate;
          const [job,outbox,terminal,artifact]=await tx.getAll(this.ref('jobs',jobId),this.ref('billingOutbox',jobId),this.ref('movements','terminal:'+jobId),this.ref('artifacts',jobId));
          const j=job.data() as Job|undefined,b=outbox.data(),t=terminal.data(),ar=artifact.data(),ext=j?.externalBilling;
          const linked=prior.get('accountId')===accountId&&prior.get('requestFingerprint')===requestFingerprint(row.inputId,row.operation,row.revision,AI_CATALOG_VERSION)&&
            row.jobId===jobId&&['job_created','needs_review'].includes(row.state)&&!!j&&j.accountId===accountId&&j.inputId===row.inputId&&
            j.requestKey===requestKey&&j.operation===row.operation&&j.revision===row.revision&&j.aiProfile===AI_CATALOG_VERSION&&
            ext?.provider===billing.provider&&ext.identityKey===billing.identityKey&&ext.reservationId===billing.reservationId;
          if(linked)confirmedJobId=jobId;
          if(!linked)detected='intent_job_mismatch';
          else if(mismatch||j!.price!==billing.seconds||ext!.seconds!==billing.seconds)detected='seconds_mismatch';
          else if(observed.state==='captured'&&j!.state!=='succeeded')detected='capture_before_success';
          else if(observed.state==='released'&&!['failed','cancelled'].includes(j!.state))detected='release_before_failure';
          else if(observed.state==='captured'||observed.state==='released'){
            const action=observed.state==='captured'?'capture':'release';
            const validOutbox=!!b&&['pending','retry_wait','settled'].includes(b.state)&&b.accountId===accountId&&b.jobId===jobId&&
              b.provider===billing.provider&&b.identityKey===billing.identityKey&&b.reservationId===billing.reservationId&&b.seconds===billing.seconds&&b.action===action&&
              (action==='capture'?typeof j!.completedAttemptId==='string'&&uuid.test(j!.completedAttemptId)&&b.attemptId===j!.completedAttemptId:b.attemptId===undefined);
            const validTerminal=!!t&&t.accountId===accountId&&t.reference===jobId&&t.credits===billing.seconds&&t.kind==='external_'+action;
            const validArtifact=!!ar&&ar.accountId===accountId&&ar.jobId===jobId&&ar.inputId===row.inputId&&(action!=='capture'||ar.attemptId===j!.completedAttemptId);
            if(!validOutbox||!validTerminal||!validArtifact)detected='outbox_mismatch';
            else if(row.state==='job_created'&&!existing.exists)return {state:'job_created',jobId};
          }
        }
      }else if(row.state==='job_created'||row.jobId)detected='intent_job_mismatch';
      else if(mismatch)detected='seconds_mismatch';
      else if(observed.state==='captured')detected='captured_without_job';
      if(!detected&&!existing.exists)throw new LedgerFault('invalid');
      const now=Date.now(),old=existing.data();
      if(existing.exists&&(old?.accountId!==accountId||old?.intentId!==key||old?.identityKey!==billing.identityKey||old?.reservationId!==billing.reservationId||old?.expectedSeconds!==billing.seconds))throw new LedgerFault('invariant');
      const reason:ExternalBillingReviewReason=existing.exists?old!.reason:detected!;
      if(!['captured_without_job','seconds_mismatch','intent_job_mismatch','capture_before_success','release_before_failure','outbox_mismatch','remote_ack_intent_mismatch','remote_ack_closure_unverified','direct_status_uncertain'].includes(reason))throw new LedgerFault('invariant');
      const invalidHold=holdDoc.exists&&(!matchesHold(holdDoc.data(),hold)||!['pending','applied','needs_review'].includes(holdDoc.get('state')));
      if(!existing.exists)tx.create(incident,{accountId,intentId:key,inputId:row.inputId,requestKey,operation:row.operation,revision:row.revision,identityKey:billing.identityKey,reservationId:billing.reservationId,expectedSeconds:billing.seconds,reason,firstObserved:{...observed,atMs:now},lastObserved:{...observed,atMs:now},createdAtMs:now,updatedAtMs:now,...(invalidHold?{holdProblem:'invalid_existing_event'}:{}),...(confirmedJobId?{jobId:confirmedJobId}:{})});
      else tx.update(incident,{lastObserved:{...observed,atMs:now},updatedAtMs:now,...(invalidHold?{holdProblem:'invalid_existing_event'}:{})});
      if(!holdDoc.exists)tx.create(holdRef,{...hold,state:'pending',attempts:0,nextAttemptAt:now,createdAtMs:now});
      tx.set(guard,{accountId,blocked:true,lastIncidentId:key,updatedAtMs:now},{merge:true});
      tx.update(intent,{state:'needs_review',reviewReason:reason,reviewIncidentId:key,updatedAtMs:now});
      if(validClearIntentAdmissionGuard(admission,key))tx.update(intentGuard,{state:'needs_review',incidentId:key,updatedAtMs:now});
      return {state:'needs_review',reason};
    });
  }
  /** A confirmed observation may close only the same history or be preserved for review. */
  private async resolveConfirmedIntentObservation(witness:ExternalBillingIntentWitness,observed:ExternalBillingConfirmedIntentObservation,recordReview:boolean,snapshotInput?:unknown):Promise<ExternalBillingIntentObservationResult>{
    if(!witness||typeof witness!=='object'||!observed||typeof observed!=='object')throw new LedgerFault('invalid');
    witness=copyIntentWitness(witness);observed=copyIntentObservation(observed);validIntentObservation(witness,observed);
    const key=witness.intentId,terminalAction=observed.source==='resolution_status'?observed.terminalAction:observed.source==='seal_status'?'seal':observed.action;
    // This snapshot is an internal consistency proof, not authenticated authority.
    // Copy it before awaiting Firestore so later caller mutations cannot change it.
    const isRecovery=observed.source==='resolution_status',snapshot=isRecovery?copyTerminalRecoveryReadSnapshot(snapshotInput):null;
    const direct=isRecovery?null:copyDirectObservationSnapshot(snapshotInput),directSource=observed.source==='status'?'status':observed.source==='release_ack'?'release':'seal';
    const snapshotBound=isRecovery?!!snapshot&&snapshot.intentId===key&&snapshot.action===terminalAction:!!direct&&direct.source===directSource&&sameIntentWitness(direct.witness,witness);
    const directReceipt=direct&&snapshotBound?hash(['direct-observation-receipt-v1',directSnapshotHash(direct),observed.source,observed.action,observed.state,observed.reservationId,observed.seconds]):null;
    const incidentId=hash(['billing-intent-observation-v1',key,observed.action,witness.accountId,witness.inputId,witness.operation,witness.revision,witness.identityKey,witness.reservationId,witness.seconds,...(observed.source==='resolution_status'?[observed.source,observed.terminalAction]:[observed.source,direct?.attemptId??'unbound'])]);
    const hold=externalHold(witness.accountId,witness.identityKey,'intent',key),intent=this.ref('billingIntents',key),review=this.ref('billingReviewIncidents',key),guard=this.ref('billingGuards',witness.accountId),holdRef=this.ref('billingHoldOutbox',hold.id),incident=this.ref('billingIntentObservationIncidents',incidentId);
    return this.db.runTransaction(async tx=>{
      const extra=isRecovery?[this.ref('billingIntentTerminalWitnesses',intentTerminalKey(key,'seal')),this.ref('billingIntentTerminalRecovery',intentTerminalKey(key,'seal')),this.ref('billingIntentTerminalWitnesses',intentTerminalKey(key,'release')),this.ref('billingIntentTerminalRecovery',intentTerminalKey(key,'release'))]:[];
      const [account,identity,input,origin,current,request,jobMarker,blocked,admission,terminal,oldReview,oldHold,oldIncident,...history]=await tx.getAll(this.ref('accounts',witness.accountId),this.ref('identities',witness.identityKey),this.ref('inputs',witness.inputId),this.ref('billingIntentWitnesses',key),intent,this.ref('requests',key),this.ref('billingIntentJobMarkers',key),guard,this.ref('billingIntentAdmissionGuards',key),this.ref('billingIntentTerminalWitnesses',intentTerminalKey(key,terminalAction)),review,holdRef,incident,...extra);
      const directDocs=!isRecovery?await this.directObservationDocs(tx,witness):null;
      const uid=identity.get('uid'),owner=account.exists&&identity.exists&&identity.get('accountId')===witness.accountId&&typeof uid==='string'&&!!uid&&uid.length<=128&&hash(['firebase',uid])===witness.identityKey&&input.exists&&input.get('accountId')===witness.accountId&&validStoredIntentWitness(origin,witness);
      const compatible=observed.source!=='resolution_status'||observed.action==='release'||observed.terminalAction==='seal';
      const actionProven=observed.source==='status'||compatible&&terminal.exists&&sameIntentWitness(terminal.data(),witness)&&terminal.get('action')===terminalAction&&terminal.get('historyProtocol')===1&&terminal.get('stage')==='prepared'&&Number.isSafeInteger(terminal.get('createdAtMs'))&&terminal.get('createdAtMs')>=0;
      let historyMatched=false;
      if(isRecovery&&snapshotBound&&snapshot&&history.length===4&&validTerminalRecoveryOrigin(origin,witness)){
        const [sealWitness,sealRecovery,releaseWitness,releaseRecovery]=history,marker=origin.get('terminalRecovery');
        historyMatched=!!marker[terminalAction==='seal'?'sealPrepared':'releasePrepared']&&validInitialReaderPair(marker.sealPrepared,sealWitness,sealRecovery,witness,'seal')&&validInitialReaderPair(marker.releasePrepared,releaseWitness,releaseRecovery,witness,'release')&&
          sameTerminalDocumentVersion(origin,snapshot.origin)&&sameTerminalDocumentVersion(sealWitness,snapshot.sealWitness)&&sameTerminalDocumentVersion(sealRecovery,snapshot.sealRecovery)&&sameTerminalDocumentVersion(releaseWitness,snapshot.releaseWitness)&&sameTerminalDocumentVersion(releaseRecovery,snapshot.releaseRecovery);
      }
      const row=current.data(),requestKey=row?.requestKey;
      const same=!!row&&row.id===key&&row.accountId===witness.accountId&&typeof requestKey==='string'&&!!requestKey.trim()&&requestKey.length<=200&&hash([witness.accountId,requestKey])===key&&row.inputId===witness.inputId&&row.operation===witness.operation&&row.revision===witness.revision&&matchesExternalBilling(row,witness);
      const jobless=!request.exists&&!jobMarker.exists&&!row?.jobId;
      const guardValid=!blocked.exists||blocked.get('accountId')===witness.accountId&&typeof blocked.get('blocked')==='boolean',guarded=blocked.exists&&blocked.get('blocked')===true;
      const identicalClosed=same&&row!.state==='closed'&&(observed.action==='release'?row!.releaseConfirmed===true&&row!.releaseReservationId===witness.reservationId&&row!.releaseSeconds===witness.seconds&&row!.sealConfirmed!==true:row!.sealConfirmed===true&&row!.sealReservationId===witness.reservationId&&row!.sealSeconds===witness.seconds&&row!.releaseConfirmed!==true);
      if(!isRecovery&&direct&&snapshotBound&&directDocs&&typeof requestKey==='string'){
        historyMatched=this.matchingDirectObservation(direct,directDocs,witness,requestKey,directSource);
      }
      // A direct close changes intent.updateTime. Its receipt hash identifies an attempt,
      // but cannot prove that this was the only subsequent write to that document.
      // Until a provable post-commit version is available, even an apparently identical
      // direct retry goes to review. Recovery-status has its own different snapshot rules.
      if(isRecovery&&owner&&actionProven&&jobless&&guardValid&&!guarded&&identicalClosed&&historyMatched)return {state:'already_closed',ownerBlocked:false};
      const canClose=owner&&actionProven&&historyMatched&&same&&jobless&&guardValid&&!guarded&&(row!.state==='release_pending'||row!.state==='reserve_pending'&&observed.source==='status');
      if(canClose){const now=Date.now();tx.update(intent,{state:'closed',...(observed.action==='release'?{releaseConfirmed:true,releaseReservationId:witness.reservationId,releaseSeconds:witness.seconds,releaseObservationSource:observed.source}:{sealConfirmed:true,sealReservationId:witness.reservationId,sealSeconds:witness.seconds,sealObservationSource:observed.source}),...(!isRecovery&&direct&&directReceipt?{directObservationReceiptHash:directReceipt,directObservationAttemptId:direct.attemptId}:{}),updatedAtMs:now});return {state:'closed',ownerBlocked:false};}
      if(!recordReview)return {state:'needs_review',ownerBlocked:false};
      const now=Date.now(),reviewReason=(!isRecovery&&identicalClosed?'remote_ack_closure_unverified':'remote_ack_intent_mismatch') as ExternalBillingReviewReason,reviewValid=!oldReview.exists||oldReview.get('accountId')===witness.accountId&&oldReview.get('identityKey')===witness.identityKey&&oldReview.get('intentId')===key&&oldReview.get('reservationId')===witness.reservationId&&oldReview.get('expectedSeconds')===witness.seconds;
      const holdValid=!oldHold.exists||matchesHold(oldHold.data(),hold)&&['pending','applied','needs_review'].includes(oldHold.get('state'));
      if(oldIncident.exists&&(!sameIntentWitness(oldIncident.data(),witness)||oldIncident.get('action')!==observed.action||oldIncident.get('observedState')!==observed.state))throw new LedgerFault('invariant');
      const attributed=!!owner&&guardValid&&snapshotBound,problem=!guardValid?'invalid_guard':!reviewValid?'invalid_review':!holdValid?'invalid_hold':null;
      if(!oldIncident.exists)tx.create(incident,{...witness,state:'needs_review',action:observed.action,observedState:observed.state,source:observed.source,...(observed.source==='resolution_status'?{terminalAction:observed.terminalAction,historySnapshot:snapshotBound?snapshot:null,historySnapshotState:!snapshotBound?'missing_or_invalid':historyMatched?'matched':'changed'}:{directObservationSnapshot:snapshotBound?direct:null,directSnapshotState:!snapshotBound?'missing_or_invalid':historyMatched?'matched':'changed'}),attribution:attributed?'verified':'unverified',ownerBlocked:attributed,...(problem?{holdProblem:problem}:{}),createdAtMs:now,updatedAtMs:now});
      else tx.update(incident,{lastSource:observed.source,lastAttribution:attributed?'verified':'unverified',lastOwnerBlocked:attributed,...(problem?{lastHoldProblem:problem}:{}),updatedAtMs:now});
      if(validClearIntentAdmissionGuard(admission,key))tx.update(admission.ref,{state:'needs_review',incidentId,updatedAtMs:now});
      if(attributed){
        if(reviewValid&&!oldReview.exists)tx.create(review,{accountId:witness.accountId,intentId:key,inputId:witness.inputId,operation:witness.operation,revision:witness.revision,identityKey:witness.identityKey,reservationId:witness.reservationId,expectedSeconds:witness.seconds,reason:reviewReason,firstConfirmedObservation:{...observed,atMs:now},createdAtMs:now,updatedAtMs:now});
        if(reviewValid&&holdValid&&!oldHold.exists)tx.create(holdRef,{...hold,state:'pending',attempts:0,nextAttemptAt:now,createdAtMs:now});
        tx.set(guard,{accountId:witness.accountId,blocked:true,lastIncidentId:key,updatedAtMs:now},{merge:true});
        if(same&&row!.state!=='closed')tx.update(intent,{state:'needs_review',reviewReason:'remote_ack_intent_mismatch',reviewIncidentId:key,updatedAtMs:now});
      }
      return {state:'needs_review',ownerBlocked:attributed,incidentId};
    });
  }
  /** Re-read current state before writing an incident; a timeout is not a confirmed observation. */
  async recordConfirmedIntentObservation(witness:ExternalBillingIntentWitness,observed:ExternalBillingConfirmedIntentObservation,snapshot?:unknown){return this.resolveConfirmedIntentObservation(witness,observed,true,snapshot);}
  async finishExternalBillingRelease(accountId:string,requestKey:string,billing:ExternalVideoBilling,observed:ExternalBillingObservation,witness?:ExternalBillingIntentWitness,source:'status'|'release_ack'|'seal_status'='release_ack',snapshot?:unknown):Promise<boolean>{
    identifier(accountId);text(requestKey);validExternalBilling(billing);if(!witness||witness.accountId!==accountId||witness.intentId!==hash([accountId,requestKey])||!matchesExternalBilling(witness,billing))return false;
    const result=await this.resolveConfirmedIntentObservation(witness,{action:'release',source,reservationId:observed.reservationId,seconds:observed.seconds,state:observed.state as 'released'},false,snapshot);return result.state==='closed'||result.state==='already_closed';
  }
  async finishExternalBillingSeal(accountId:string,requestKey:string,billing:ExternalVideoBilling,observed:{reservationId:string;state:string;seconds:number},witness?:ExternalBillingIntentWitness,snapshot?:unknown):Promise<boolean>{
    identifier(accountId);text(requestKey);validExternalBilling(billing);if(!witness||witness.accountId!==accountId||witness.intentId!==hash([accountId,requestKey])||!matchesExternalBilling(witness,billing))return false;
    const result=await this.resolveConfirmedIntentObservation(witness,{action:'seal',source:'seal_ack',reservationId:observed.reservationId,seconds:observed.seconds,state:observed.state as 'sealed'},false,snapshot);return result.state==='closed'||result.state==='already_closed';
  }
  /**
   * Due intents, at most `limit`. A date that is not a safe integer counts as due. Each kind is read in document-id order, scanning PAST rows that are
   * not due yet (the 2026-11-18 incident: `limit(100)` applied before the date filter let 100 not-yet-due rows hide a due one), and the two kinds are
   * served alternately, releases first, so neither can starve the other.
   */
  async pendingExternalBillingIntents(limit=25,afterId?:string|null){
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new LedgerFault('invalid');
    const now=Date.now(),due=(d:DocumentSnapshot)=>!Number.isSafeInteger(d.get('nextAttemptAt'))||d.get('nextAttemptAt')<=now;
    const [reserves,releases]=await Promise.all([this.dueRows('billingIntents','reserve_pending',limit,due,afterId),this.dueRows('billingIntents','release_pending',limit,due,afterId)]);
    return interleave(releases,reserves,limit).map(d=>({...d.data(),id:d.id,snapshotVersion:outboxVersion(d)}));
  }
  /**
   * Rows of one `state` that satisfy `due`, in document-id order, scanning pages (equality + id order: automatic index) until `limit` are found or the state is exhausted.
   * An `afterId` that names a row of this collection makes the read ROTATE: it starts strictly AFTER it and, when that tail is shorter than `limit`, wraps to the beginning
   * and stops before the cursor, so one rotation serves each due row at most once. An `afterId` that is not a row of this collection (or `null`/absent) reads from the
   * beginning; without it the query is exactly the plain equality+id one.
   */
  private async dueRows(collection:string,state:string,limit:number,due:(d:DocumentSnapshot)=>boolean,afterId?:string|null){
    if(!afterId||!(await this.root.collection(collection).doc(afterId).get()).exists)return this.scanDueRows(collection,state,limit,due,null,null);
    const out=await this.scanDueRows(collection,state,limit,due,afterId,null);
    if(out.length<limit)for(const d of await this.scanDueRows(collection,state,limit-out.length,due,null,afterId))out.push(d);
    return out;
  }
  /** One bounded scan of a `state` in document-id order, with a first-page exclusive `startAfterId` and an exclusive `stopBeforeId`. */
  private async scanDueRows(collection:string,state:string,limit:number,due:(d:DocumentSnapshot)=>boolean,startAfterId:string|null,stopBeforeId:string|null){
    const out:DocumentSnapshot[]=[];let last:DocumentSnapshot|undefined,first=true;
    for(;;){
      let query=this.root.collection(collection).where('state','==',state).orderBy(FieldPath.documentId()).limit(100);
      if(first&&startAfterId)query=query.startAfter(this.root.collection(collection).doc(startAfterId));else if(last)query=query.startAfter(last);
      first=false;
      const page=await query.get();
      let crossed=false;
      for(const d of page.docs){
        if(stopBeforeId!==null&&d.id>=stopBeforeId){crossed=true;break;}
        if(due(d)){out.push(d);if(out.length>=limit)return out;}
      }
      if(crossed||page.docs.length<100)return out;
      last=page.docs[page.docs.length-1];
    }
  }
  /** These events are new-format only; existing incidents require a separate audited backfill. */
  async pendingExternalHolds(limit=25){
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new LedgerFault('invalid');
    const rows=await this.root.collection('billingHoldOutbox').where('state','==','pending').where('nextAttemptAt','<=',Date.now()).orderBy('nextAttemptAt').limit(limit).get();
    return rows.docs.map(d=>({...d.data(),id:d.id,snapshotVersion:outboxVersion(d)}));
  }
  /** Never send a hold for an owner inferred solely from a potentially corrupt outbox row. */
  async authorizeExternalHold(row:Record<string,unknown>):Promise<{state:'eligible';hold:ExternalBillingHold}|{state:'changed'}|{state:'needs_review'}>{
    if(!row||typeof row.id!=='string'||!/^[a-f0-9]{64}$/.test(row.id)||typeof row.snapshotVersion!=='string'||!/^\d{1,15}:\d{9}$/.test(row.snapshotVersion))throw new LedgerFault('invalid');
    const ref=this.ref('billingHoldOutbox',row.id);
    return this.db.runTransaction(async tx=>{
      const doc=await tx.get(ref);if(!doc.exists||doc.get('state')!=='pending'||outboxVersion(doc)!==row.snapshotVersion)return {state:'changed'};
      // This legacy drainer has not claimed a billing lease and must not adopt one.
      if(hasIntentLease(doc.data()!))return {state:'changed'};
      if(!validUnleasedBillingMetadata(doc.data()!)){tx.update(ref,{state:'needs_review',reviewReason:'invalid_scheduling_metadata',updatedAtMs:Date.now()});return {state:'needs_review'};}
      if(!Number.isSafeInteger(doc.get('nextAttemptAt'))||doc.get('nextAttemptAt')<0){tx.update(ref,{state:'needs_review',reviewReason:'invalid_due',updatedAtMs:Date.now()});return {state:'needs_review'};}
      let expected:ExternalBillingHold|undefined;
      try{expected=externalHold(row.accountId as string,row.identityKey as string,row.sourceKind as 'intent'|'outbox',row.sourceId as string);}catch(error){if(!(error instanceof LedgerFault))throw error;}
      if(!expected||expected.id!==row.id||!matchesHold(doc.data(),expected)){tx.update(ref,{state:'needs_review',reviewReason:'invalid_event',updatedAtMs:Date.now()});return {state:'needs_review'};}
      const source=expected.sourceKind==='intent'?'billingReviewIncidents':'billingOutboxReviewIncidents';
      const [account,identity,guard,incident]=await tx.getAll(this.ref('accounts',expected.accountId),this.ref('identities',expected.identityKey),this.ref('billingGuards',expected.accountId),this.ref(source,expected.sourceId));
      const uid=identity.get('uid'),sourceMatches=expected.sourceKind==='intent'?incident.get('intentId')===expected.sourceId:incident.get('attribution')==='verified'&&incident.get('ownerBlocked')===true;
      if(!account.exists||!identity.exists||identity.get('accountId')!==expected.accountId||typeof uid!=='string'||!uid||uid.length>128||hash(['firebase',uid])!==expected.identityKey||!guard.exists||guard.get('accountId')!==expected.accountId||guard.get('blocked')!==true||!incident.exists||incident.get('accountId')!==expected.accountId||incident.get('identityKey')!==expected.identityKey||!sourceMatches){
        tx.update(ref,{state:'needs_review',reviewReason:'owner_or_incident_unverified',updatedAtMs:Date.now()});return {state:'needs_review'};
      }
      return {state:'eligible',hold:expected};
    });
  }
  async markExternalHoldApplied(expected:ExternalBillingHold){
    const verified=externalHold(expected.accountId,expected.identityKey,expected.sourceKind,expected.sourceId);if(verified.id!==expected.id)throw new LedgerFault('invalid');
    return this.db.runTransaction(async tx=>{
      const ref=this.ref('billingHoldOutbox',expected.id),[doc,guard]=await tx.getAll(ref,this.ref('billingGuards',expected.accountId));
      if(!doc.exists||!matchesHold(doc.data(),expected)||!guard.exists||guard.get('accountId')!==expected.accountId||guard.get('blocked')!==true)return false;
      if(doc.get('state')==='applied')return true;if(doc.get('state')!=='pending')return false;
      tx.update(ref,{state:'applied',appliedAtMs:Date.now(),lastErrorCode:null});return true;
    });
  }
  async recordExternalHoldFailure(expected:ExternalBillingHold,code:string,snapshotVersion?:string){
    const verified=externalHold(expected.accountId,expected.identityKey,expected.sourceKind,expected.sourceId);if(verified.id!==expected.id)throw new LedgerFault('invalid');
    if(typeof snapshotVersion!=='string'||!/^\d{1,15}:\d{9}(?![\s\S])/.test(snapshotVersion))return false;
    if(!/^(unavailable|conflict|invalid|not_found|forbidden)$/.test(code))code='unavailable';
    return this.db.runTransaction(async tx=>{
      const source=expected.sourceKind==='intent'?'billingReviewIncidents':'billingOutboxReviewIncidents',ref=this.ref('billingHoldOutbox',expected.id);
      const [doc,account,identity,guard,incident]=await tx.getAll(ref,this.ref('accounts',expected.accountId),this.ref('identities',expected.identityKey),this.ref('billingGuards',expected.accountId),this.ref(source,expected.sourceId));
      if(!doc.exists||doc.get('state')!=='pending'||outboxVersion(doc)!==snapshotVersion||!matchesHold(doc.data(),expected)||hasIntentLease(doc.data()!)||!validUnleasedBillingMetadata(doc.data()!)||!Number.isSafeInteger(doc.get('nextAttemptAt'))||doc.get('nextAttemptAt')<0)return false;
      const uid=identity.get('uid'),sourceMatches=expected.sourceKind==='intent'?incident.get('intentId')===expected.sourceId:incident.get('attribution')==='verified'&&incident.get('ownerBlocked')===true;
      if(!account.exists||!identity.exists||identity.get('accountId')!==expected.accountId||typeof uid!=='string'||!uid||uid.length>128||hash(['firebase',uid])!==expected.identityKey||!guard.exists||guard.get('accountId')!==expected.accountId||guard.get('blocked')!==true||!incident.exists||incident.get('accountId')!==expected.accountId||incident.get('identityKey')!==expected.identityKey||!sourceMatches)return false;
      const previous=doc.get('attempts')??0;if(!Number.isSafeInteger(previous)||previous<0||previous>=Number.MAX_SAFE_INTEGER)throw new LedgerFault('invariant');
      const attempts=Number(previous)+1,delay=Math.min(15*60_000,1000*2**Math.min(attempts,10)),now=Date.now();
      tx.update(ref,{attempts,lastErrorCode:code,nextAttemptAt:now+delay,lastAttemptAtMs:now});return true;
    });
  }
  /** Preserve a confirmed Account hold if the local event cannot be matched after its ACK. */
  async recordExternalHoldAckMismatch(expected:ExternalBillingHold){
    const verified=externalHold(expected.accountId,expected.identityKey,expected.sourceKind,expected.sourceId);if(verified.id!==expected.id)throw new LedgerFault('invalid');
    return this.db.runTransaction(async tx=>{
      const ref=this.ref('billingHoldAckIncidents',expected.id),doc=await tx.get(ref);
      if(doc.exists){if(!matchesHold(doc.data(),expected))throw new LedgerFault('invariant');return false;}
      tx.create(ref,{...expected,state:'needs_review',reason:'hold_ack_local_event_changed',createdAtMs:Date.now()});return true;
    });
  }
  async createAccount() {
    const id = randomUUID();
    await this.ref('accounts', id).create({ credited: 0, available: 0, reserved: 0, consumed: 0, active: 0 });
    return id;
  }
  async readBalance(accountId: string) {
    identifier(accountId); const doc = await this.ref('accounts', accountId).get();
    if (!doc.exists) throw new LedgerFault('not_found');
    return balance(doc.data() as Balance);
  }
  /** Customer read: the identity and the balance belong to the same Firestore snapshot. */
  async readBalanceForUid(accountId:string,uid:string,requirePilot=false) {
    identifier(accountId);
    if(typeof uid!=='string'||!uid||uid.length>128)throw new LedgerFault('not_found');
    return this.db.runTransaction(async tx=>{
      if(!await verifiedUidAccountInTransaction(tx,this.root,accountId,uid))throw new LedgerFault('not_found');
      const doc=await tx.get(this.ref('accounts',accountId));
      if(!doc.exists||requirePilot&&(doc.get('aiPilot')!==true||doc.get('simulationOnly')!==true))throw new LedgerFault('not_found');
      return balance(doc.data() as Balance);
    });
  }
  /** Caller must have verified the provider capture. No provider IO occurs here. */
  async creditVerifiedPurchase(accountId: string, captureId: string, credits: number, amountCents: number, merchantId: string, environment: 'sandbox' | 'live') {
    identifier(accountId); text(captureId); text(merchantId); integer(credits, true); integer(amountCents, true);
    if (!['sandbox', 'live'].includes(environment)) throw new LedgerFault('invalid');
    const receiptId = hash(['paypal:' + environment, captureId]);
    const fingerprint = hash([accountId, captureId, credits, amountCents, 'usd', merchantId]);
    return this.db.runTransaction(async tx => {
      const a = this.ref('accounts', accountId), p = this.ref('purchases', receiptId), m = this.ref('movements', 'credit:' + receiptId);
      const [account, prior, movement] = await tx.getAll(a, p, m);
      if (!account.exists) throw new LedgerFault('not_found');
      if (prior.exists) { if (prior.get('fingerprint') !== fingerprint) throw new LedgerFault('conflict'); return false; }
      if (movement.exists) throw new LedgerFault('invariant');
      const current = balance(account.data() as Balance);
      const next = balance({ ...current, available: current.available + credits, credited: current.credited + credits });
      tx.update(a, next); tx.create(p, { accountId, fingerprint, captureId, credits, amountCents, currency: 'usd', merchantId });
      tx.create(m, { accountId, kind: 'credit', credits, reference: receiptId }); return true;
    });
  }
  async addInput(accountId: string, expiresAtMs: number, sha256: string) {
    if(!this.unverifiedTestInputs)throw new LedgerFault('invalid');
    identifier(accountId); integer(expiresAtMs, true);
    if (expiresAtMs <= Date.now() || !/^[a-f0-9]{64}$/.test(sha256)) throw new LedgerFault('invalid');
    const id = randomUUID();
    await this.db.runTransaction(async tx => {
      if (!(await tx.get(this.ref('accounts', accountId))).exists) throw new LedgerFault('not_found');
      tx.create(this.ref('inputs', id), { accountId, expiresAtMs, sha256, deleted: false, unknownCount: 0 });
    }); return id;
  }
  /** Trusted internal reservation; the generic customer route must use reserveForUid. */
  async reserve(accountId: string, inputId: string, requestKey: string, price: number, operation: string,
    expectedRevision?: number,aiProfile?:typeof AI_CATALOG_VERSION,externalBilling?:ExternalVideoBilling,statusSnapshotInput?:unknown,requesterUid?:string) {
    if(externalBilling&&(typeof requesterUid!=='string'||!requesterUid||requesterUid.length>128))throw new LedgerFault('not_found');
    return this.reserveAs(accountId,inputId,requestKey,price,operation,expectedRevision,aiProfile,externalBilling,statusSnapshotInput,requesterUid);
  }
  /** UID is obtained from the verified token, never the request body. */
  async reserveForUid(accountId:string,inputId:string,requestKey:string,price:number,operation:string,expectedRevision:number,uid:string) {
    if(typeof uid!=='string'||!uid||uid.length>128)throw new LedgerFault('not_found');
    integer(expectedRevision,true);
    return this.reserveAs(accountId,inputId,requestKey,price,operation,expectedRevision,undefined,undefined,undefined,uid);
  }
  /** Customer AI admission with simulated ledger only; external Account remains separate. */
  async reserveSimulatedAiForUid(accountId:string,inputId:string,requestKey:string,price:number,operation:string,expectedRevision:number,uid:string) {
    if(typeof uid!=='string'||!uid||uid.length>128)throw new LedgerFault('not_found');integer(expectedRevision,true);
    return this.reserveAs(accountId,inputId,requestKey,price,operation,expectedRevision,AI_CATALOG_VERSION,undefined,undefined,uid);
  }
  private async reserveAs(accountId: string, inputId: string, requestKey: string, price: number, operation: string,
    expectedRevision?: number,aiProfile?:typeof AI_CATALOG_VERSION,externalBilling?:ExternalVideoBilling,statusSnapshotInput?:unknown,requesterUid?:string) {
    if(aiProfile!==undefined&&aiProfile!==AI_CATALOG_VERSION)throw new LedgerFault('invalid');
    if(aiProfile&&expectedRevision===undefined)throw new LedgerFault('invalid');
    identifier(accountId); identifier(inputId); text(requestKey); text(operation); integer(price, true);
    if (expectedRevision !== undefined) integer(expectedRevision, true);
    if(externalBilling){validExternalBilling(externalBilling);externalBilling=copyExternalBilling(externalBilling);validExternalBilling(externalBilling);if(price!==externalBilling.seconds||!aiProfile)throw new LedgerFault('invalid');
      if(typeof requesterUid!=='string'||!requesterUid||requesterUid.length>128||hash(['firebase',requesterUid])!==externalBilling.identityKey)throw new LedgerFault('not_found');}
    const statusSnapshot=statusSnapshotInput===undefined?undefined:copyDirectObservationSnapshot(statusSnapshotInput);
    if(statusSnapshotInput!==undefined&&(!statusSnapshot||statusSnapshot.source!=='status'||!externalBilling))throw new LedgerFault('invalid');
    const statusWitness=statusSnapshot&&externalBilling?intentWitness(accountId,inputId,requestKey,operation,expectedRevision!,externalBilling):undefined;
    if(statusSnapshot&&(!statusWitness||!sameIntentWitness(statusSnapshot.witness,statusWitness)))throw new LedgerFault('invalid');
    const jobId = randomUUID(), requestId = hash([accountId, requestKey]);
    const fingerprint = hash([inputId, price, operation, expectedRevision ?? null]);
    const outcome=await diagnosticTransaction<string|null>('reserve',this.db,async tx => {
      if(requesterUid!==undefined&&!await verifiedUidAccountInTransaction(tx,this.root,accountId,requesterUid))throw new LedgerFault('not_found');
      const a = this.ref('accounts', accountId), i = this.ref('inputs', inputId), r = this.ref('requests', requestId);
      const intentRef=externalBilling?this.ref('billingIntents',requestId):null,originRef=externalBilling?this.ref('billingIntentWitnesses',requestId):null,markerRef=externalBilling?this.ref('billingIntentJobMarkers',requestId):null;
      const readRefs=[a,i,r,this.ref('projects',inputId),this.ref('billingGuards',accountId),...(externalBilling?[intentRef!,originRef!,markerRef!,this.ref('identities',externalBilling.identityKey),this.ref('billingIntentAdmissionGuards',requestId)]:[])];
      const [account, input, prior, project, guard, intentDoc,originDoc,markerDoc,identityDoc,intentGuard] = await diagnosticStage('reserve.read',()=>tx.getAll(...readRefs));
      if(statusSnapshot&&statusWitness){
        const direct=await this.directObservationDocs(tx,statusWitness);
        if(!this.matchingDirectObservation(statusSnapshot,direct,statusWitness,requestKey,'status')){
          await this.preserveDirectUncertainty(tx,direct,statusWitness,requestKey,statusSnapshot,{state:'reserved',seconds:statusWitness.seconds});
          return null;
        }
        // Even a matching status observation is not a reserve ACK and cannot
        // authorize creating or replaying a job. No compensating release here.
        return null;
      }
      if (!account.exists) throw new LedgerFault('not_found');
      if(externalBilling&&(!intentGuard||!validClearIntentAdmissionGuard(intentGuard,requestId)||this.billingBlocked(guard,accountId)))throw new LedgerFault('conflict');
      if(aiProfile&&(account.get('aiPilot')!==true||account.get('simulationOnly')!==true))throw new LedgerFault('conflict');
      if (prior.exists) {
        if (prior.get('requestFingerprint') !== requestFingerprint(inputId,operation,expectedRevision??null,aiProfile)) throw new LedgerFault('conflict');
        const existingId=prior.get('jobId');if(typeof existingId!=='string'||!uuid.test(existingId))throw new LedgerFault('conflict');
        const existingJob=(await tx.get(this.ref('jobs',existingId))).data() as Job|undefined;
        if(!existingJob||await this.jobAccounting(tx,existingId,existingJob)!==(externalBilling?'account_seconds':'simulation'))throw new LedgerFault('conflict');
        if(requesterUid!==undefined&&(prior.get('accountId')!==accountId||existingJob.accountId!==accountId||existingJob.inputId!==inputId||existingJob.requestKey!==requestKey||existingJob.operation!==operation||existingJob.revision!==expectedRevision||existingJob.aiProfile!==aiProfile))throw new LedgerFault('conflict');
        if(externalBilling){const existing=await this.verifiedExternalJob(tx,prior,accountId,inputId,requestKey,operation,expectedRevision!,externalBilling);
          if(intentDoc?.exists){const row=this.billingIntent(intentDoc,accountId,requestKey,externalBilling);if(row.inputId!==inputId||row.operation!==operation||row.revision!==expectedRevision||row.jobId&&row.jobId!==existing)throw new LedgerFault('invariant');}
          return existing;
        }
        return prior.get('jobId') as string;
      }
      if(this.billingBlocked(guard,accountId))throw new LedgerFault('conflict');
      if (!input.exists || input.get('accountId') !== accountId) throw new LedgerFault('not_found');
      if (expectedRevision !== undefined && (!project.exists || project.get('accountId') !== accountId || project.get('revision') !== expectedRevision)) throw new LedgerFault('conflict');
      const asset = input.data() as Input;
      if (!this.usable(asset,inputId)) throw new LedgerFault('not_found');
      if (asset.unknownCount > 0) throw new LedgerFault('conflict');
      const current = balance(account.data() as Balance);
      const plan=aiProfile?artifactPlan(jobId,inputId,operation as any):undefined;
      if(aiProfile){
        if(!asset.metadata||price!==(externalBilling?Math.ceil(asset.metadata.duration):simulatedAiPrice(operation as any,asset.metadata.duration)))throw new LedgerFault('invalid');
        if(operation.startsWith('narration:')&&(typeof project.get('draft')!=='string'||!project.get('draft').trim()||project.get('reviewedTextRevision')!==expectedRevision||project.get('reviewedTextSha256')!==draftSha(project.get('draft'))))throw new LedgerFault('invalid');
      }
      if(externalBilling){
        if(!intentDoc||!originDoc||!markerDoc||!identityDoc)throw new LedgerFault('invariant');
        const intent=this.billingIntent(intentDoc,accountId,requestKey,externalBilling),witness=intentWitness(accountId,inputId,requestKey,operation,expectedRevision!,externalBilling),uid=identityDoc.get('uid');
        if(intent.state!=='reserve_pending'||intent.inputId!==inputId||intent.operation!==operation||intent.revision!==expectedRevision||intent.jobId||!validStoredIntentWitness(originDoc,witness)||markerDoc.exists||!identityDoc.exists||identityDoc.get('accountId')!==accountId||typeof uid!=='string'||!uid||uid.length>128||hash(['firebase',uid])!==externalBilling.identityKey)throw new LedgerFault('conflict');
        externalIntentTransitionDue(intentDoc);
      }
      const quota=plan?storageQuota(account.data(),plan.budgetBytes,0):undefined;
      if (!externalBilling&&current.available < price) throw new LedgerFault('insufficient');
      if (current.active >= 3) throw new LedgerFault('conflict');
      const next = balance(externalBilling?{...current,active:current.active+1}:{ ...current, available: current.available - price, reserved: current.reserved + price, active: current.active + 1 });
      const job: Job = { accountId, inputId, price, operation, revision: expectedRevision ?? null,...(externalBilling?{externalBilling:copyExternalBilling(externalBilling)}:{}),...(aiProfile?{aiProfile,snapshotSha256:draftSha(project.get('draft'))}:{}),
        inputStorage: asset.storage??null,
        snapshot: expectedRevision === undefined ? null : project.data() as ProjectSnapshot,
        state: 'queued', inputSha256: asset.sha256,
        attemptId: null, leaseUntil: null, unknownAttemptId: null, requestKey, invocationPhase: null };
      tx.update(a, {...next,...quota}); tx.create(r, { accountId, fingerprint, requestFingerprint: requestFingerprint(inputId,operation,expectedRevision ?? null,aiProfile), jobId }); tx.create(this.ref('jobs', jobId), job);
      tx.create(this.ref('jobAccounting',jobId),{protocol:1,jobId,accountId,inputId,requestKey,operation,revision:expectedRevision??null,price,profile:aiProfile??null,mode:externalBilling?'account_seconds':'simulation',createdAtMs:Date.now(),...(externalBilling?copyExternalBilling(externalBilling):{})});
      if(plan)tx.create(this.ref('artifacts',jobId),{accountId,inputId,jobId,plan,planHash:artifactPlanHash(plan),sourceGeneration:asset.storage!.generation,inputSha256:asset.sha256,revision:expectedRevision!,snapshotSha256:draftSha(project.get('draft')),expiresAtMs:asset.expiresAtMs,state:'pending',quotaMode:'reserved',quotaHeld:plan.budgetBytes,entries:[],attemptId:null,nextAttemptAt:Date.now()} satisfies AiArtifactRecord);
      tx.create(this.ref('outbox', jobId), {accountId, jobId, ...(aiProfile?{aiProfile}:{}), state: 'pending', nextAttemptAt: Date.now(), dispatchAttempt: null, leaseUntil: null});
      if(externalBilling){tx.create(markerRef!,{...intentWitness(accountId,inputId,requestKey,operation,expectedRevision!,externalBilling),jobId,historyProtocol:1,createdAtMs:Date.now()});tx.update(intentRef!,{state:'job_created',jobId,updatedAtMs:Date.now()});}
      if(!externalBilling)tx.create(this.ref('movements', 'reserve:' + jobId), { accountId, kind: 'reserve', credits: price, reference: jobId });
      diagnosticMark('reserve.writes_staged');
      return jobId;
    });
    if(outcome===null)throw new LedgerFault('conflict');
    return outcome;
  }
  private async context(tx: Transaction, accountId: string, jobId: string,loadProviderReceipts:boolean|'text'=false): Promise<Context> {
    identifier(accountId); identifier(jobId);
    const accountRef = this.ref('accounts', accountId), jobRef = this.ref('jobs', jobId);
    // Every money-changing operation acquires the account before other records.
    const [account, jobDoc] = await tx.getAll(accountRef, jobRef);
    if (!jobDoc.exists || jobDoc.get('accountId') !== accountId) throw new LedgerFault('not_found');
    const job = jobDoc.data() as Job;
    if(await this.jobAccounting(tx,jobId,job)==='unverified')throw new LedgerFault('conflict');
    const inputRef = this.ref('inputs', job.inputId), terminalRef = this.ref('movements', 'terminal:' + jobId);
    const [input, terminal, artifactDoc] = await tx.getAll(inputRef, terminalRef,...(job.aiProfile?[this.ref('artifacts',jobId)]:[]));
    if (!account.exists || !input.exists || input.get('accountId') !== accountId) throw new LedgerFault('not_found');
    const asset = input.data() as Input; integer(asset.unknownCount); integer(job.price, true);
    const artifact=artifactDoc?.data() as AiArtifactRecord|undefined;
    if(job.aiProfile){if(job.aiProfile!==AI_CATALOG_VERSION||!artifact||artifact.accountId!==accountId||artifact.inputId!==job.inputId||artifact.jobId!==jobId||artifact.planHash!==artifactPlanHash(artifact.plan)||artifact.plan.jobId!==jobId||artifact.plan.inputId!==job.inputId||artifact.plan.operation!==job.operation||artifact.sourceGeneration!==job.inputStorage?.generation||artifact.inputSha256!==job.inputSha256||artifact.revision!==job.revision||artifact.snapshotSha256!==job.snapshotSha256||(job.snapshot!==null&&artifact.snapshotSha256!==draftSha(job.snapshot.draft)))throw new LedgerFault('invariant');}
    const calls=job.aiProfile&&(loadProviderReceipts===true||loadProviderReceipts==='text'&&job.operation==='translation:en')?await tx.get(this.root.collection('providerCalls').where('jobId','==',jobId)):undefined;
    return { accountRef, jobRef, inputRef, terminalRef, account: balance(account.data() as Balance),rawAccountData:account.data()!,...(calls?{providerReceipts:calls.docs.map(doc=>({id:doc.id,data:doc.data()}))}:{}),
      job, input: asset, terminalExists: terminal.exists,...(artifact?{artifactRef:this.ref('artifacts',jobId),artifact}:{}) };
  }
  private aiInvocationEnabled(c:Context){return !c.artifact||(c.rawAccountData.aiPilot===true&&c.rawAccountData.simulationOnly===true&&c.artifact.state==='pending'&&c.artifact.quotaMode==='reserved'&&c.artifact.quotaHeld===c.artifact.plan.budgetBytes);}
  private verifiedProviderReceipt(c:Context){
    if(!c.artifact||!c.providerReceipts||!c.job.snapshot)throw new LedgerFault('conflict');
    const voice=c.job.operation.startsWith('narration:'),duration=c.input.metadata?.duration;
    if(!voice&&(!Number.isFinite(duration)||duration!<=0||duration!>AI_TEXT_MAX_DURATION_MS/1000))throw new LedgerFault('conflict');
    const count=voice?narrationChunks(c.job.snapshot.draft).length:Math.ceil(Math.floor(duration!*1000)/AI_TEXT_WINDOW_MS);
    if(count<1||count>1000||c.providerReceipts.length!==count)throw new LedgerFault('conflict');
    const expected=Array.from({length:count},(_,i)=>(voice?'voice-chunk:':'text-window:')+String(i).padStart(4,'0'));
    const model=voice?VOICE_MODEL:textModel,attemptId=c.job.attemptId??c.job.unknownAttemptId??(c.job.state==='succeeded'&&c.artifact.state==='ready'?c.artifact.attemptId:null);
    const sorted=c.providerReceipts.map(row=>({...row.data,id:row.id} as Record<string,unknown>&{id:string})).sort((a,b)=>String(a.callKey).localeCompare(String(b.callKey)));
    const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical((value as Record<string,unknown>)[k])])):value;
    for(let index=0;index<sorted.length;index++){
      const call=sorted[index],usage=call.usage;
      if(call.id!==c.jobRef.id+'-'+expected[index].replace(':','-')||call.callKey!==expected[index]||call.jobId!==c.jobRef.id||call.accountId!==c.job.accountId||call.attemptId!==attemptId||call.model!==model||call.state!=='received'||call.httpStatus!==200||
        typeof call.requestSha256!=='string'||!/^[a-f0-9]{64}$/.test(call.requestSha256)||typeof call.responseSha256!=='string'||!/^[a-f0-9]{64}$/.test(call.responseSha256)||
        !(call.responseId===null||typeof call.responseId==='string'&&call.responseId.length>0&&call.responseId.length<=200)||!usage||typeof usage!=='object'||Array.isArray(usage)||Object.values(usage).some(v=>!Number.isSafeInteger(v)||Number(v)<0))throw new LedgerFault('conflict');
    }
    return {keys:expected,hash:hash(canonical(sorted.map(call=>[call.callKey,call.requestSha256,call.responseSha256,call.responseId,call.usage])))};
  }
  private publishableManifest(c:Context){
    const a=c.artifact;if(!a||a.state!=='staged'||!a.attemptId||a.attemptId!==(c.job.attemptId??c.job.unknownAttemptId))throw new LedgerFault('invariant');
    const receipt=this.verifiedProviderReceipt(c);if(a.callReceiptHash!==receipt.hash||JSON.stringify(a.callKeys)!==JSON.stringify(receipt.keys))throw new LedgerFault('conflict');
    return validateArtifactManifest(a.plan,a.entries);
  }
  /** Trusted worker receipt only: object bytes/hash/generation are verified before calling this method. */
  async stageArtifactReceipt(accountId:string,jobId:string,attemptId:string,entries:readonly AiArtifactReceipt[]){
    identifier(attemptId);return this.db.runTransaction(async tx=>{
      const c=await this.context(tx,accountId,jobId,true);if(!c.artifact)throw new LedgerFault('invalid');
      if(narrationRequiresReview(c.job.operation))return false;
      const normalized=validateArtifactManifest(c.artifact.plan,entries);
      if(c.rawAccountData.aiPilot!==true||c.rawAccountData.simulationOnly!==true){if(c.job.state==='running'&&c.job.attemptId===attemptId&&c.job.invocationPhase==='invoking')this.unknown(tx,c);return false;}
      const replayReady=c.job.state==='succeeded'&&c.artifact.state==='ready'&&c.artifact.attemptId===attemptId;
      if(!replayReady&&(c.job.state!=='running'||c.job.attemptId!==attemptId||c.job.invocationPhase!=='invoking'||!c.job.leaseUntil||c.job.leaseUntil<=Date.now()||!this.usable(c.input,c.job.inputId,c.job)||c.input.unknownCount>0||c.artifact.expiresAtMs<=Date.now()||!['pending','staged'].includes(c.artifact.state)))return false;
      const receipt=this.verifiedProviderReceipt(c);
      if(replayReady){if(c.artifact.callReceiptHash===receipt.hash&&hash(normalized)===hash(validateArtifactManifest(c.artifact.plan,c.artifact.entries)))return true;throw new LedgerFault('conflict');}
      if(c.artifact.state==='staged'){if(c.artifact.attemptId!==attemptId||c.artifact.callReceiptHash!==receipt.hash||hash(normalized)!==hash(validateArtifactManifest(c.artifact.plan,c.artifact.entries)))throw new LedgerFault('conflict');return true;}
      tx.update(c.artifactRef!,{state:'staged',entries:normalized,attemptId,callReceiptHash:receipt.hash,callKeys:receipt.keys});return true;
    });
  }
  /** No provider call was admitted. Releases money while physical output quota awaits barrier cleanup. */
  async failBeforeInvocation(accountId:string,jobId:string,attemptId:string){
    identifier(attemptId);return this.db.runTransaction(async tx=>{const c=await this.context(tx,accountId,jobId,'text');
      if(narrationRequiresReview(c.job.operation))return false;
      if(c.job.state!=='running'||c.job.attemptId!==attemptId||c.job.invocationPhase!=='not_started')return false;
      if(this.textAi(c)&&!this.cleanPendingPreprovider(c)){this.preproviderUnknown(tx,c);return false;}
      this.settle(tx,c,'failed');return true;});
  }
  private textAi(c:Context){return !!c.job.aiProfile&&c.job.operation==='translation:en';}
  private cleanPendingPreprovider(c:Context){
    const a=c.artifact;
    return !!c.providerReceipts&&c.providerReceipts.length===0&&!c.terminalExists&&!!a&&a.state==='pending'&&a.entries.length===0&&a.attemptId===null&&
      !Object.hasOwn(a,'callReceiptHash')&&!Object.hasOwn(a,'callKeys')&&a.quotaMode==='reserved'&&a.quotaHeld===a.plan.budgetBytes;
  }
  private preproviderUnknown(tx:Transaction,c:Context){
    this.unknown(tx,c);tx.update(this.ref('outbox',c.jobRef.id),{state:'sent',leaseUntil:null});
  }
  private sameDigitalSource(c:Context,binding:PrivateInputBinding){
    const source=c.job.inputStorage,current=c.input.storage;
    return !!source&&!!current&&['bucket','key','generation','size','sha256'].every(key=>source[key as keyof PrivateInputBinding]===binding[key as keyof PrivateInputBinding]&&current[key as keyof PrivateInputBinding]===binding[key as keyof PrivateInputBinding])&&binding.sha256===c.job.inputSha256;
  }
  private localTextCurrent(c:Context,attemptId:string){
    return this.textAi(c)&&c.job.state==='running'&&c.job.attemptId===attemptId&&c.job.invocationPhase==='local_check';
  }
  private localTextFences(c:Context){
    return !!c.job.leaseUntil&&c.job.leaseUntil>Date.now()&&this.usable(c.input,c.job.inputId,c.job)&&c.input.unknownCount===0&&this.aiInvocationEnabled(c)&&!!c.artifact&&c.artifact.expiresAtMs>Date.now()&&this.cleanPendingPreprovider(c);
  }
  /** Only confirmed nonzero/multiple-track inspection may leave the durable local fence. */
  async resumeTextAfterLocalCheck(accountId:string,jobId:string,attemptId:string,binding:PrivateInputBinding,decision:'nonzero'|'multiple_audio_tracks'){
    identifier(attemptId);if(decision!=='nonzero'&&decision!=='multiple_audio_tracks')throw new LedgerFault('invalid');
    return this.db.runTransaction(async tx=>{
      const c=await this.context(tx,accountId,jobId,true);if(!this.localTextCurrent(c,attemptId))return false;
      if(!await this.externalJobAdmissionAllowed(tx,jobId,c.job))return false;
      const tracks=c.input.metadata?.audioTracks,coherent=decision==='nonzero'?tracks===1:Number.isInteger(tracks)&&tracks!>1;
      if(!this.localTextFences(c)||!this.sameDigitalSource(c,binding)||!coherent){this.preproviderUnknown(tx,c);return false;}
      tx.update(c.jobRef,{invocationPhase:'not_started'});return true;
    });
  }
  /** A worker-only certificate; never a customer assertion or generic technical refund. */
  async completeDigitalSilence(accountId:string,jobId:string,attemptId:string,value:unknown){
    identifier(attemptId);const proof=validateDigitalSilenceProof(value),proofHash=digitalSilenceProofHash(proof);
    return this.db.runTransaction(async tx=>{
      const c=await this.context(tx,accountId,jobId,true);if(!this.localTextCurrent(c,attemptId))return false;
      if(!await this.externalJobAdmissionAllowed(tx,jobId,c.job))return false;
      const binding:PrivateInputBinding={bucket:proof.sourceBucket,key:proof.sourceKey,generation:proof.sourceGeneration,size:proof.sourceSize,sha256:proof.sourceSha256};
      if(!this.localTextFences(c)||!this.sameDigitalSource(c,binding)||c.input.metadata?.audioTracks!==1){this.preproviderUnknown(tx,c);return false;}
      this.settle(tx,c,'failed','digital-zero:'+proofHash);
      tx.update(c.jobRef,{failureCode:'no_speech',noSpeechSubtype:'digital_zero',digitalSilenceProof:proof,digitalSilenceProofHash:proofHash,digitalSilenceAttemptId:attemptId});return true;
    });
  }
  /** ACK recovery confirms the full terminal proof and release together, never just failed. */
  async confirmedDigitalSilence(accountId:string,jobId:string,attemptId:string,value:unknown){
    identifier(attemptId);const proof=validateDigitalSilenceProof(value),proofHash=digitalSilenceProofHash(proof);
    return this.db.runTransaction(async tx=>{
      const c=await this.context(tx,accountId,jobId,true),data=(await tx.get(c.jobRef)).data()!,movement=await tx.get(c.terminalRef);
      let durableHash;try{durableHash=digitalSilenceProofHash(data.digitalSilenceProof);}catch{return false;}
      if(c.job.state!=='failed'||data.failureCode!=='no_speech'||data.noSpeechSubtype!=='digital_zero'||data.digitalSilenceAttemptId!==attemptId||data.digitalSilenceProofHash!==proofHash||durableHash!==proofHash||data.reconciliationRef!=='digital-zero:'+proofHash||!c.providerReceipts||c.providerReceipts.length!==0)return false;
      const binding:PrivateInputBinding={bucket:proof.sourceBucket,key:proof.sourceKey,generation:proof.sourceGeneration,size:proof.sourceSize,sha256:proof.sourceSha256};
      return this.sameDigitalSource(c,binding)&&!!c.artifact&&['purging','purged'].includes(c.artifact.state)&&c.artifact.entries.length===0&&c.artifact.attemptId===null&&!Object.hasOwn(c.artifact,'callReceiptHash')&&!Object.hasOwn(c.artifact,'callKeys')&&movement.exists&&movement.get('accountId')===accountId&&movement.get('reference')===jobId&&movement.get('credits')===c.job.price&&movement.get('kind')===(c.job.externalBilling?'external_release':'release');
    });
  }
  /**
   * LV-019.B C2a: any failure/cancellation of an externally billed job that already has admitted provider calls (a provider call row is the durable admission
   * proof) is a release WITH a claim: the admission (`jobId`, `attemptId`) plus the caller's resolution. Without admitted calls it stays the plain release. Either
   * way the row is protocol 3. `resolution` is only ever supplied by the two callers that can observe admitted calls (`completeNoSpeech`, `reconcile`).
   */
  private settle(tx: Transaction, c: Context, state: 'succeeded' | 'failed' | 'cancelled', evidence: string | null = null, resolution?:VideoResolution) {
    if (c.terminalExists) throw new LedgerFault('invariant');
    const capture = state === 'succeeded', price = c.job.price;
    const capturedAttempt=capture&&c.job.externalBilling?c.job.attemptId:undefined;
    if(capture&&c.job.externalBilling&&(!capturedAttempt||!uuid.test(capturedAttempt)))throw new LedgerFault('invariant');
    const admitted=!capture&&!!c.job.externalBilling&&!!c.providerReceipts&&c.providerReceipts.length>0;
    const releasedAttempt=admitted?c.job.attemptId??c.job.unknownAttemptId:null;
    // GLM reachability: today only text with external billing can reach `admitted`, and both callers that do (`completeNoSpeech`, `reconcile`) always pass
    // the resolution. Every other money path that could load provider receipts is fenced first: `finish`/`complete`/`quarantine` refuse a
    // non-`invoking` phase, `cancel` and the claim path run `cleanPendingPreprovider`, and voice (`narration:`) is refused outright. The guard is kept as
    // defence in depth: a future caller that admitted calls without a resolution fails CLOSED with `invariant`, and no balance is moved.
    if(admitted&&(!resolution||!validResolution(resolution)))throw new LedgerFault('invariant');
    if(admitted&&(!releasedAttempt||!uuid.test(releasedAttempt)))throw new LedgerFault('invariant');
    let quota:ReturnType<typeof storageQuota>|undefined;
    if(c.artifact){
      if(capture){const entries=this.publishableManifest(c);const bytes=entries.reduce((n,e)=>n+e.size,0);if(c.artifact.quotaMode!=='reserved'||c.artifact.quotaHeld!==c.artifact.plan.budgetBytes)throw new LedgerFault('invariant');quota=storageQuota(c.rawAccountData,-c.artifact.quotaHeld,bytes);}
      else if(c.artifact.state!=='purged')tx.update(c.artifactRef!,{state:'purging',nextAttemptAt:Date.now()});
    }
    const next = balance(c.job.externalBilling?{...c.account,active:c.account.active-1}:{ ...c.account, reserved: c.account.reserved - price,
      available: c.account.available + (capture ? 0 : price), consumed: c.account.consumed + (capture ? price : 0), active: c.account.active - 1 });
    const unknownCount = c.input.unknownCount - (c.job.state === 'unknown' ? 1 : 0); integer(unknownCount);
    tx.update(c.accountRef, {...next,...quota});
    if(c.artifact&&capture)tx.update(c.artifactRef!,{state:'ready',quotaMode:'committed',quotaHeld:c.artifact.entries.reduce((n,e)=>n+e.size,0),nextAttemptAt:Date.now()});
    tx.update(c.jobRef, { state, attemptId: null, leaseUntil: null, reconciliationRef: evidence,...(capturedAttempt?{completedAttemptId:capturedAttempt}:{}) });
    tx.update(c.inputRef, { unknownCount });
    tx.update(this.ref('outbox', c.jobRef.id), {state: 'sent', leaseUntil: null});
    tx.create(c.terminalRef, { accountId: c.job.accountId, reference: c.jobRef.id, credits: price, kind: c.job.externalBilling?`external_${capture?'capture':'release'}`:capture ? 'capture' : 'release' });
    if(c.job.externalBilling)tx.create(this.ref('billingOutbox',c.jobRef.id),{accountId:c.job.accountId,jobId:c.jobRef.id,...copyExternalBilling(c.job.externalBilling),action:capture?'capture':'release',
      ...(capturedAttempt?{attemptId:capturedAttempt}:admitted?{attemptId:releasedAttempt!}:{}),settlementProtocol:3,
      ...(admitted?{resolutionKind:resolution!.kind,evidenceSha256:resolution!.evidenceSha256}:{}),state:'pending',createdAtMs:Date.now(),attempts:0,nextAttemptAt:Date.now()});
  }

  /**
   * Settlement rows, at most `limit`: `pending` rows whatever their date, and `retry_wait` rows only with a numeric date that is due (one without it is never
   * selected). Each kind is read in document-id order past rows that are not due, and the two are served alternately, pending first.
   */
  async pendingExternalBilling(limit=25,afterId?:string|null){
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new LedgerFault('invalid');
    const now=Date.now();
    const [pending,retry]=await Promise.all([this.dueRows('billingOutbox','pending',limit,()=>true,afterId),this.dueRows('billingOutbox','retry_wait',limit,d=>typeof d.get('nextAttemptAt')==='number'&&d.get('nextAttemptAt')<=now,afterId)]);
    return interleave(pending,retry,limit).map(d=>({...d.data(),id:d.id,snapshotVersion:outboxVersion(d)}));
  }
  async recordExternalBillingFailure(jobId:string,code:string,expected?:ExternalBillingOutboxFailureEvidence){
    identifier(jobId);if(!expected)return false;validOutboxSnapshot(expected.outbox);
    if(expected.outbox.jobId!==jobId||typeof expected.snapshotVersion!=='string'||!/^\d{1,15}:\d{9}(?![\s\S])/.test(expected.snapshotVersion)||!['pending','retry_wait'].includes(expected.state))throw new LedgerFault('invalid');
    // LV-019.B C2a: `too_early` is an early refusal of an unknown-expired release; it must be preserved, must not consume an attempt, and reschedules for later.
    const tooEarly=code==='too_early';
    if(!tooEarly&&!/^(unavailable|insufficient|conflict|invalid|quota|not_found|forbidden)$/.test(code))code='unavailable';const ref=this.ref('billingOutbox',jobId);
    return this.db.runTransaction(async tx=>{
      const [d,job,terminal,artifact]=await tx.getAll(ref,this.ref('jobs',jobId),this.ref('movements','terminal:'+jobId),this.ref('artifacts',jobId));
      if(!d.exists||d.get('state')!==expected.state||outboxVersion(d)!==expected.snapshotVersion||!matchesOutboxSnapshot(d.data(),expected.outbox)||hasIntentLease(d.data()!)||!validUnleasedBillingMetadata(d.data()!)||!Number.isSafeInteger(d.get('nextAttemptAt'))||d.get('nextAttemptAt')<0)return false;
      const owner=await this.verifiedOutboxOwner(tx,jobId,job,expected.outbox),t=terminal.data(),a=artifact.data();
      if(!owner||owner.guardBlocked||owner.intentState!=='job_created'||(expected.outbox.action==='capture'?owner.job.state!=='succeeded'||owner.job.completedAttemptId!==expected.outbox.attemptId||a?.attemptId!==expected.outbox.attemptId:!['failed','cancelled'].includes(owner.job.state))||
        t?.accountId!==owner.accountId||t.reference!==jobId||t.credits!==expected.outbox.seconds||t.kind!=='external_'+expected.outbox.action||a?.accountId!==owner.accountId||a.jobId!==jobId||a.inputId!==owner.job.inputId)return false;
      const previous=d.get('attempts')??0;if(!Number.isSafeInteger(previous)||previous<0||previous>=Number.MAX_SAFE_INTEGER)throw new LedgerFault('invariant');
      const now=Date.now();
      if(tooEarly){tx.update(ref,{state:'retry_wait',lastErrorCode:'too_early',nextAttemptAt:now+UNKNOWN_RESOLUTION_MIN_AGE_MS,lastAttemptAtMs:now});return true;}
      const attempts=Number(previous)+1,delay=Math.min(15*60_000,1000*2**Math.min(attempts,10));
      // LV-019.B C2a: every permanent refusal shares one bound, so no row can retry forever. The row becomes `needs_review` (reported by
      // `readPendingReport`, alerted by `raisePendingAlerts`) and is never retried again; the owner is not blocked, so no hold and no guard are set.
      // Only `unavailable` is exempt: it is transient infrastructure and step 1.6 bounds it by the periodic runner's maximum age.
      if(code!=='unavailable'&&attempts>=EXTERNAL_BILLING_ATTEMPT_LIMIT){tx.update(ref,{state:'needs_review',attempts,lastErrorCode:code,lastAttemptAtMs:now});return true;}
      tx.update(ref,{state:'retry_wait',attempts,lastErrorCode:code,nextAttemptAt:now+delay,lastAttemptAtMs:now});return true;
    });
  }
  /** An error/timeout is not an ACK; stale evidence cannot write or release a lease. */
  async recordExternalBillingIntentFailure(accountId:string,requestKey:string,code:string,expected?:ExternalBillingIntentFailureEvidence){
    identifier(accountId);text(requestKey);if(!expected)return false;
    if(!['unleased','leased'].includes(expected.mode)||!/^\d{1,15}:\d{9}(?![\s\S])/.test(expected.snapshotVersion)||typeof expected.intentGuardVersion!=='string'||!/^\d{1,15}:\d{9}(?![\s\S])/.test(expected.intentGuardVersion)||!['reserve_pending','release_pending'].includes(expected.state))throw new LedgerFault('invalid');
    const witness=expected.witness;validIntentWitness(witness);
    if(witness.accountId!==accountId||witness.intentId!==hash([accountId,requestKey]))throw new LedgerFault('invalid');
    if(expected.mode==='leased'&&(typeof expected.leaseToken!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/i.test(expected.leaseToken)||
      typeof expected.leaseOwner!=='string'||!/^[a-z0-9][a-z0-9._:-]{0,127}(?![\s\S])/i.test(expected.leaseOwner)||!Number.isSafeInteger(expected.generation)||expected.generation<1||!Number.isSafeInteger(expected.leaseUntil)||expected.leaseUntil<0))throw new LedgerFault('invalid');
    if(!/^(unavailable|insufficient|conflict|invalid|quota|not_found|forbidden|reserved_unconfirmed)$/.test(code))code='unavailable';
    const ref=this.ref('billingIntents',witness.intentId);
    return this.db.runTransaction(async tx=>{
      const [d,account,identity,input,origin,request,marker,guard,intentGuard]=await tx.getAll(ref,this.ref('accounts',accountId),this.ref('identities',witness.identityKey),this.ref('inputs',witness.inputId),this.ref('billingIntentWitnesses',witness.intentId),this.ref('requests',witness.intentId),this.ref('billingIntentJobMarkers',witness.intentId),this.ref('billingGuards',accountId),this.ref('billingIntentAdmissionGuards',witness.intentId));
      if(!d.exists||outboxVersion(d)!==expected.snapshotVersion||d.get('state')!==expected.state)return false;
      const uid=identity.get('uid');
      if(!account.exists||!identity.exists||identity.get('accountId')!==accountId||typeof uid!=='string'||!uid||uid.length>128||hash(['firebase',uid])!==witness.identityKey||
        !input.exists||input.get('accountId')!==accountId||!validStoredIntentWitness(origin,witness)||!validClearIntentAdmissionGuard(intentGuard,witness.intentId)||outboxVersion(intentGuard)!==expected.intentGuardVersion||request.exists||marker.exists||this.billingBlocked(guard,accountId))return false;
      let row:ExternalBillingIntent;try{row=this.billingIntent(d,accountId,requestKey,witness);}catch(error){if(error instanceof LedgerFault)return false;throw error;}
      if(row.inputId!==witness.inputId||row.operation!==witness.operation||row.revision!==witness.revision||row.jobId)return false;
      externalIntentTransitionDue(d);const raw=d.data()!,now=Date.now();
      if(expected.mode==='unleased'?hasIntentLease(raw):!hasIntentLease(raw)||!sameIntentLease(raw,expected)||expected.leaseUntil<=now)return false;
      const previous=d.get('attempts')??0;if(!Number.isSafeInteger(previous)||previous<0||previous>=Number.MAX_SAFE_INTEGER)throw new LedgerFault('invariant');
      const attempts=Number(previous)+1;
      tx.update(ref,{attempts,lastErrorCode:code,nextAttemptAt:now+billingAttemptDelay(attempts),lastAttemptAtMs:now,...(expected.mode==='leased'?{leaseToken:FieldValue.delete(),leaseOwner:FieldValue.delete(),leaseUntil:FieldValue.delete()}:{})});return true;
    });
  }
  /**
   * LV-019.B step 1.6c (design 3.4): the DRAIN's three evidence-less intent routes must still leave a trace of an attempt.
   * Those routes have no `snapshotVersion`, no failure evidence and no status snapshot, so nothing can be fenced against a
   * stale read: this method takes NO evidence on purpose. It only advances SCHEDULING metadata (attempts, growing wait,
   * lastErrorCode, lastAttemptAtMs) inside ONE transaction that re-reads the row and requires it to still be
   * `reserve_pending` or `release_pending`, unleased and with valid scheduling metadata. At EXTERNAL_BILLING_ATTEMPT_LIMIT
   * the intent moves to `needs_review` with an alert and WITHOUT blocking the owner, exactly like the outbox recorder. It
   * never moves balance, never touches a hold, a guard or a witness, and never creates an incident.
   */
  async recordExternalBillingIntentStall(accountId:string,requestKey:string,code:string){
    identifier(accountId);text(requestKey);
    if(!/^(unavailable|insufficient|conflict|invalid|quota|not_found|forbidden|reserved_unconfirmed)$/.test(code))code='unavailable';
    const ref=this.ref('billingIntents',hash([accountId,requestKey]));
    return this.db.runTransaction(async tx=>{
      const d=await tx.get(ref);
      if(!d.exists)return false;
      const row=d.data() as ExternalBillingIntent;
      // The row is re-read here: only a still-pending, unleased, well-formed row is rescheduled.
      if(row.accountId!==accountId||row.requestKey!==requestKey||!['reserve_pending','release_pending'].includes(row.state)||hasIntentLease(d.data()!)||!validUnleasedBillingMetadata(d.data()!)||!Number.isSafeInteger(d.get('nextAttemptAt'))||d.get('nextAttemptAt')<0||d.get('nextAttemptAt')>Date.now())return false;
      const previous=d.get('attempts')??0;if(!Number.isSafeInteger(previous)||previous<0||previous>=Number.MAX_SAFE_INTEGER)throw new LedgerFault('invariant');
      const attempts=Number(previous)+1,now=Date.now();
      // Every permanent refusal shares one bound, so no row can retry forever; the owner is never blocked (no hold, no guard).
      if(attempts>=EXTERNAL_BILLING_ATTEMPT_LIMIT){tx.update(ref,{state:'needs_review',attempts,lastErrorCode:code,lastAttemptAtMs:now,updatedAtMs:now});return true;}
      tx.update(ref,{attempts,lastErrorCode:code,nextAttemptAt:now+billingAttemptDelay(attempts),lastAttemptAtMs:now,updatedAtMs:now});return true;
    });
  }
  /**
   * LV-019.B step 1.6c (design 3.4): MAXIMUM AGE. Non-terminal billing rows older than `maxAgeMs` move to `needs_review`
   * with `reviewReason:'max_age'`, even when the reason is infrastructure, so a row that never advances cannot linger
   * forever (the A2 sweep already alerts on `needs_review`). The clock is the injected `now`: no wall clock decides. Each
   * row runs in its OWN transaction that re-reads the state and only escalates a row that is still non-terminal, so a row
   * that changed between the page read and its transaction is never overwritten. A missing, non-numeric, negative or
   * future `createdAtMs` is a counted failure and the row is left intact (never guessed at). It moves no balance, touches
   * no hold and blocks no owner. The cursor and limit follow the expired-unknown resolver: rows are read in document-id
   * order from `after`, and `next` is the last row attended (or `null` on a full wrap).
   */
  async escalateStaleBillingRows(options:{now:number;maxAgeMs?:number;limit:number;after?:string|null;shouldContinue?:()=>boolean|Promise<boolean>}){
    const now=options?.now,limit=options?.limit,after=options?.after??null,maxAgeMs=options?.maxAgeMs===undefined?EXTERNAL_BILLING_MAX_AGE_MS:options.maxAgeMs,shouldContinue=options?.shouldContinue;
    if(!Number.isSafeInteger(now)||(now as number)<0)throw new LedgerFault('invalid');
    if(!Number.isSafeInteger(limit)||(limit as number)<1||(limit as number)>100)throw new LedgerFault('invalid');
    if(!Number.isSafeInteger(maxAgeMs)||(maxAgeMs as number)<1)throw new LedgerFault('invalid');
    if(after!==null&&!plainDocumentId(after))throw new LedgerFault('invalid');
    if(shouldContinue!==undefined&&typeof shouldContinue!=='function')throw new LedgerFault('invalid');
    // The three sources and only their NON-terminal states; a terminal row is never a candidate.
    const sources=[{collection:'billingIntents',states:['reserve_pending','release_pending']},{collection:'billingOutbox',states:['pending','retry_wait']},{collection:'billingHoldOutbox',states:['pending']}] as const;
    const candidates:Array<{collection:string;id:string;state:string}>=[];
    for(const source of sources)for(const state of source.states)for(const d of await this.staleScan(source.collection,state,after,limit as number))
      candidates.push({collection:source.collection,id:d.id,state});
    // Order by (id, collection), NOT (collection, id): the cursor `after` is a single id shared by every collection, so
    // ordering by id keeps it monotone and one rotation visits each row once. Ties on the same id are broken by
    // collection only to keep the order stable.
    candidates.sort((a,b)=>a.id===b.id?(a.collection<b.collection?-1:a.collection>b.collection?1:0):(a.id<b.id?-1:1));
    // The cut never splits a group of rows that share the last selected id: `after` is only an id, so every row with that
    // id must travel in the same page or the next pass (which reads strictly after it) would lose the ones left behind.
    const selected=candidates.slice(0,limit as number);
    if(selected.length===limit){
      const cutId=selected[selected.length-1].id;
      for(const candidate of candidates.slice(limit))if(candidate.id===cutId)selected.push(candidate);
    }
    // Cursor and limit follow the expired-unknown resolver: `next` is the last row attended only when the page was FULL,
    // and `null` otherwise (a short tail ends the rotation, so the next pass starts over from the beginning).
    const report={scanned:selected.length,escalated:0,failed:0,next:(selected.length>=limit?selected[selected.length-1]?.id??null:null) as string|null,stopped:false};
    // On a stop the cursor may only advance past ids whose WHOLE tie group was attended: fter is a single id, so
    // stopping inside a group would make the next pass read strictly after it and lose the rows left in that group.
    let completed:string|null=null;
    for(let index=0;index<selected.length;index++){
      const candidate=selected[index];
      if(shouldContinue!==undefined){
        let proceed=false;
        try{proceed=!!(await shouldContinue());}catch{proceed=false;}
        if(!proceed){report.stopped=true;report.next=completed??after;break;}
      }
      let outcome:'escalated'|'skipped'|'failed';
      try{
        outcome=await this.db.runTransaction(async tx=>{
          const ref=this.ref(candidate.collection,candidate.id);
          const doc=await tx.get(ref);
          if(!doc.exists)return 'skipped' as const;
          const state=doc.get('state');
          const nonTerminal=sources.find(source=>source.collection===candidate.collection)!.states as readonly string[];
          // The state must be EXACTLY the one the scan saw: a row that advanced to another non-terminal state is left for
          // the next rotation rather than escalated on a stale view.
          if(typeof state!=='string'||!nonTerminal.includes(state)||state!==candidate.state)return 'skipped' as const;
          const createdAtMs=doc.get('createdAtMs');
          const clock=now as number,limitAge=maxAgeMs as number;
          if(typeof createdAtMs!=='number'||!Number.isSafeInteger(createdAtMs)||createdAtMs<0||createdAtMs>clock)return 'failed' as const;
          if(clock-createdAtMs<=limitAge)return 'skipped' as const;
          // An active lease means someone is working the row right now: it is seen again in the next rotation.
          const leaseUntil=doc.get('leaseUntil');
          if(Number.isSafeInteger(leaseUntil)&&Number(leaseUntil)>clock)return 'skipped' as const;
          // A dangling or expired lease must not survive on a reviewed row; the audited release (1.4b) reopens it.
          const clearLease=hasIntentLease(doc.data()!)?{leaseToken:FieldValue.delete(),leaseOwner:FieldValue.delete(),leaseUntil:FieldValue.delete()}:{};
          tx.update(ref,{state:'needs_review',reviewReason:'max_age',updatedAtMs:clock,...clearLease});return 'escalated' as const;
        });
      }catch{outcome='failed';}
      if(outcome==='escalated')report.escalated++;else if(outcome==='failed')report.failed++;
      // An id becomes a safe cursor only once no later selected candidate shares it.
      if(index===selected.length-1||selected[index+1].id!==candidate.id)completed=candidate.id;
    }
    return report;
  }
  /**
   * One bounded read of a state in document-id order strictly after `after`, for the age escalation. A single query of
   * `limit` rows is enough: the `limit` smallest global ids all lie inside the first `limit` rows of every
   * collection/state, ties included, so no page loop is needed and a pass costs at most one query per source.
   */
  private async staleScan(collection:string,state:string,after:string|null,limit:number){
    let query=this.root.collection(collection).where('state','==',state).orderBy(FieldPath.documentId()).limit(limit);
    if(after!==null)query=query.startAfter(this.root.collection(collection).doc(after));
    const page=await query.get();
    return page.docs;
  }
  /** Read inside the transaction that authorizes the POST; snapshots alone are not authority. */
  async captureExternalBillingSettlement(tx:Transaction,expected:ExternalBillingOutboxSnapshot,intentId:string):Promise<ExternalBillingSettlementReadSnapshot|null>{
    validOutboxSnapshot(expected);if(typeof intentId!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(intentId))return null;
    const refs=[this.ref('accounts',expected.accountId),this.ref('billingOutbox',expected.jobId),this.ref('jobs',expected.jobId),this.ref('movements','terminal:'+expected.jobId),
      this.ref('artifacts',expected.jobId),this.ref('jobAccounting',expected.jobId),this.ref('movements','reserve:'+expected.jobId),this.ref('identities',expected.identityKey),
      this.ref('requests',intentId),this.ref('billingIntents',intentId),this.ref('billingGuards',expected.accountId),this.ref('billingIntentAdmissionGuards',intentId),
      this.ref('billingIntentWitnesses',intentId),this.ref('billingIntentJobMarkers',intentId)];
    const docs=await tx.getAll(...refs),job=docs[2].data() as Job|undefined;
    if(!job||job.accountId!==expected.accountId||typeof job.requestKey!=='string'||hash([expected.accountId,job.requestKey])!==intentId||
      typeof job.inputId!=='string'||typeof job.operation!=='string'||!Number.isSafeInteger(job.revision)||!job.externalBilling||!matchesExternalBilling(job.externalBilling,expected))return null;
    let witness:ExternalBillingIntentWitness;try{witness=intentWitness(expected.accountId,job.inputId,job.requestKey,job.operation,job.revision!,expected);}catch(error){if(error instanceof LedgerFault)return null;throw error;}
    if(!validStoredIntentWitness(docs[12],witness)||!sameIntentWitness(docs[13].data(),witness)||docs[13].get('historyProtocol')!==1||docs[13].get('jobId')!==expected.jobId)return null;
    const versions={} as Record<SettlementDocumentName,TerminalRecoveryDocumentVersion>;
    for(let index=0;index<settlementDocumentNames.length;index++){const version=terminalDocumentVersion(docs[index]);if(!version)return null;versions[settlementDocumentNames[index]]=version;}
    return copyExternalBillingSettlementReadSnapshot({expected,intentId,versions});
  }
  /** Compare the original pre-POST read in the same transaction as the local settlement. */
  async markExternalBillingSettled(expectedInput:ExternalBillingOutboxSnapshot,snapshotInput:ExternalBillingSettlementReadSnapshot){
    const expected=copyOutboxSnapshot(expectedInput);if(!expected)return false;
    const snapshot=copyExternalBillingSettlementReadSnapshot(snapshotInput);if(!snapshot||!matchesOutboxSnapshot(snapshot.expected,expected))return false;
    return this.db.runTransaction(async tx=>{
      const current=await this.captureExternalBillingSettlement(tx,expected,snapshot.intentId);
      if(!current||JSON.stringify(current)!==JSON.stringify(snapshot))return false;
      const ref=this.ref('billingOutbox',expected.jobId),[row,job]=await tx.getAll(ref,this.ref('jobs',expected.jobId));
      const classified=job.data() as Job|undefined;
      if(!row.exists||!matchesOutboxSnapshot(row.data(),expected)||!classified||await this.jobAccounting(tx,expected.jobId,classified)!=='account_seconds'||!['pending','retry_wait'].includes(row.get('state')))return false;
      tx.update(ref,{state:'settled',settledAtMs:Date.now(),lastErrorCode:null});return true;
    });
  }
  /** Quarantine only a current observation, or preserve an authenticated remote ACK discrepancy. */
  async quarantineExternalBillingOutbox(outboxId:string,options:ExternalBillingOutboxQuarantine):Promise<ExternalBillingOutboxQuarantineResult>{
    if(typeof outboxId!=='string'||!outboxId||Buffer.byteLength(outboxId)>1500||outboxId==='.'||outboxId==='..'||/[\/\x00-\x1f\x7f]/.test(outboxId)||!options||!['before_ack','after_ack'].includes(options.phase))throw new LedgerFault('invalid');
    const phase=options.phase,rawVersion=options.snapshotVersion,version=typeof rawVersion==='string'&&/^\d{1,15}:\d{9}$/.test(rawVersion)?rawVersion:null;
    if(phase==='before_ack'&&!version)return {state:'changed',ownerBlocked:false};
    let after:{expected:ExternalBillingOutboxSnapshot;ack:ExternalBillingObservation;settlementSnapshot:ExternalBillingSettlementReadSnapshot|null}|null=null;
    if(options.phase==='after_ack'){
      const expected=copyOutboxSnapshot(options.expected);if(!expected)throw new LedgerFault('invalid');
      const observation=options.ack;if(!observation)throw new LedgerFault('invalid');
      const ack={reservationId:observation.reservationId,state:observation.state,seconds:observation.seconds};
      if(ack.reservationId!==expected.reservationId||ack.seconds!==expected.seconds||ack.state!==(expected.action==='capture'?'captured':'released'))throw new LedgerFault('invalid');
      const snapshot=copyExternalBillingSettlementReadSnapshot(options.settlementSnapshot);
      after={expected,ack,settlementSnapshot:snapshot&&matchesOutboxSnapshot(snapshot.expected,expected)?snapshot:null};
    }
    const key=hash(['billing-outbox-review-v1',outboxId,phase,version,after?safeOutboxAudit(after.expected):null]);
    const outbox=this.ref('billingOutbox',outboxId),incident=this.ref('billingOutboxReviewIncidents',key),holdRef=this.ref('billingHoldOutbox',hash(['account-hold-v1','outbox',key])),job=uuid.test(outboxId)?this.ref('jobs',outboxId):null;
    return this.db.runTransaction(async tx=>{
      const [current,existing,holdDoc,...jobDocs]=await tx.getAll(outbox,incident,holdRef,...(job?[job]:[])),jobDoc=jobDocs[0];
      const currentVersion=current.exists?outboxVersion(current):null;
      // LV-019.B double ACK (docs/specs/LV-019-B-doble-ack-liquidacion.md): another drainer already settled this exact row (same document: its createTime is the one
      // read before the POST, only its updateTime moved), and the 13 other documents this POST validated still have their pre-POST versions, so the ACK confirms
      // that same settlement. Nothing is written; any other case is reviewed below.
      if(after?.settlementSnapshot&&current.exists&&current.get('state')==='settled'&&matchesOutboxSnapshot(current.data(),after.expected)){
        const reread=await this.captureExternalBillingSettlement(tx,after.expected,after.settlementSnapshot.intentId),before=after.settlementSnapshot.versions.outbox,row=reread?.versions.outbox;
        if(reread&&before.exists&&row?.exists&&before.createTime===row.createTime&&settlementDocumentNames.every(name=>name==='outbox'||JSON.stringify(reread.versions[name])===JSON.stringify(after.settlementSnapshot!.versions[name])))return {state:'already_settled',ownerBlocked:false};
      }
      if(phase==='before_ack'&&(!current.exists||!currentVersion||currentVersion!==version))return {state:'changed',ownerBlocked:false};
      // A settled row with the same tuple alone does not prove its history was unchanged.
      if(phase==='before_ack'&&current.get('state')==='settled')return {state:'changed',ownerBlocked:false};
      const owner=jobDoc?await this.verifiedOutboxOwner(tx,outboxId,jobDoc,after?.expected):null;
      // A related document may have been repaired even while the outbox version stayed fixed.
      if(phase==='before_ack'&&owner&&!owner.guardBlocked&&owner.intentState==='job_created'&&['pending','retry_wait'].includes(current.get('state'))){
        const raw=current.data()!,candidate=raw as ExternalBillingOutboxSnapshot;
        // A row with an unexpected key is never a clean repair; only an exact v1/v3 tuple with its documented metadata may take the `changed` fast path.
        let valid=!!copyOutboxSnapshot(raw,OUTBOX_METADATA_KEYS);if(valid)try{validOutboxSnapshot(candidate);}catch(error){if(error instanceof LedgerFault)valid=false;else throw error;}
        if(valid&&!hasIntentLease(raw)&&validUnleasedBillingMetadata(raw)&&Number.isSafeInteger(raw.nextAttemptAt)&&raw.nextAttemptAt>=0&&candidate.jobId===outboxId&&candidate.accountId===owner.accountId&&matchesExternalBilling(candidate,owner.billing)){
          const [terminal,artifact]=await tx.getAll(this.ref('movements','terminal:'+outboxId),this.ref('artifacts',outboxId)),t=terminal.data(),a=artifact.data();
          const stateValid=candidate.action==='capture'?owner.job.state==='succeeded':['failed','cancelled'].includes(owner.job.state);
          if(stateValid&&(candidate.action!=='capture'||candidate.attemptId===owner.job.completedAttemptId&&candidate.attemptId===a?.attemptId)&&t?.accountId===owner.accountId&&t.reference===outboxId&&t.credits===candidate.seconds&&t.kind==='external_'+candidate.action&&
            a?.accountId===owner.accountId&&a.jobId===outboxId&&a.inputId===owner.job.inputId)return {state:'changed',ownerBlocked:false};
        }
      }
      const idHash=hash(['billing-outbox-id',outboxId]),now=Date.now(),hold=owner?externalHold(owner.accountId,owner.billing.identityKey,'outbox',key):null;
      const invalidHold=!!hold&&holdDoc.exists&&(!matchesHold(holdDoc.data(),hold)||!['pending','applied','needs_review'].includes(holdDoc.get('state')));
      if(existing.exists&&(existing.get('outboxIdHash')!==idHash||existing.get('phase')!==phase))throw new LedgerFault('invariant');
      const audit={state:'needs_review',phase,reason:after?'remote_ack_outbox_changed':'invalid_outbox',outboxId:uuid.test(outboxId)?outboxId:null,outboxIdHash:idHash,
        snapshotVersion:version,currentVersion,expected:safeOutboxAudit(after?after.expected:current.data()),
        current:safeOutboxAudit(current.data()),outboxPresent:current.exists,attribution:owner?'verified':'unverified',ownerBlocked:!!owner,...(owner?{accountId:owner.accountId,identityKey:owner.billing.identityKey}:{}),...(invalidHold?{holdProblem:'invalid_existing_event'}:{}),
        ...(after?{remoteAck:after.ack,settlementSnapshot:after.settlementSnapshot}:{})};
      if(!existing.exists)tx.create(incident,{...audit,createdAtMs:now,updatedAtMs:now});
      else tx.update(incident,{lastObservation:audit,updatedAtMs:now});
      // A terminal row is evidence and must not be rewritten even when it conflicts with this ACK.
      if(current.exists&&current.get('state')!=='settled')tx.update(outbox,{state:'needs_review',reviewIncidentId:key,updatedAtMs:now});
      if(owner){
        if(hold&&!holdDoc.exists)tx.create(holdRef,{...hold,state:'pending',attempts:0,nextAttemptAt:now,createdAtMs:now});
        tx.set(owner.guard,{accountId:owner.accountId,blocked:true,lastOutboxIncidentId:key,updatedAtMs:now},{merge:true});
        if(owner.intentState==='job_created')tx.update(owner.intent,{state:'needs_review',reviewReason:'outbox_mismatch',reviewOutboxIncidentId:key,updatedAtMs:now});
      }
      return {state:'needs_review',ownerBlocked:!!owner,incidentId:key};
    });
  }
  private unknown(tx: Transaction, c: Context) {
    integer(c.input.unknownCount + 1);
    tx.update(c.jobRef, { state: 'unknown', unknownAttemptId: c.job.attemptId, quarantinedAtMs: Date.now(), attemptId: null, leaseUntil: null });
    tx.update(c.inputRef, { unknownCount: c.input.unknownCount + 1 });
    if(c.artifact&&c.artifact.state!=='purged')tx.update(c.artifactRef!,{state:'purging',nextAttemptAt:Date.now()});
  }
  async claim(accountId: string, jobId: string) {
    const attemptId = randomUUID();
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,'text');
      if (c.job.state !== 'queued') return null;
      if(!await this.externalJobAdmissionAllowed(tx,jobId,c.job))return null;
      if(this.textAi(c)&&!this.cleanPendingPreprovider(c)){this.preproviderUnknown(tx,c);return null;}
      if (!this.usable(c.input,c.job.inputId,c.job)||!this.aiInvocationEnabled(c)) { this.settle(tx, c, 'failed'); return null; }
      if (c.input.unknownCount > 0) return null;
      const leaseUntil = Date.now() + 30_000;
      tx.update(c.jobRef, { state: 'running', attemptId, leaseUntil, invocationPhase: this.textAi(c)?'local_check':'not_started' });
      tx.update(this.ref('outbox', jobId), {state: 'sent', leaseUntil: null});
      return { attemptId, leaseUntil };
    });
  }
  /** Durable permission to invoke. A lost acknowledgement requires inspection, never a new attempt. */
  async beginInvocation(accountId: string, jobId: string, attemptId: string) {
    identifier(attemptId);
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,'text');
      if (c.job.state !== 'running' || c.job.attemptId !== attemptId || c.job.invocationPhase !== 'not_started' ||
          !c.job.leaseUntil || c.job.leaseUntil <= Date.now()) return false;
      if(!await this.externalJobAdmissionAllowed(tx,jobId,c.job))return false;
      if(this.textAi(c)&&!this.cleanPendingPreprovider(c)){this.preproviderUnknown(tx,c);return false;}
      if (!this.usable(c.input,c.job.inputId,c.job)||!this.aiInvocationEnabled(c)) {this.settle(tx,c,'failed');return false;}
      if (c.input.unknownCount > 0) {this.unknown(tx,c);return false;}
      tx.update(c.jobRef,{invocationPhase:'invoking'});return true;
    });
  }
  async heartbeat(accountId: string, jobId: string, attemptId: string) {
    identifier(attemptId);
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,'text');
      if(narrationRequiresReview(c.job.operation))return false;
      if (c.job.state !== 'running' || c.job.attemptId !== attemptId) return false;
      if(this.textAi(c)&&c.job.invocationPhase!=='invoking'){
        if(!this.cleanPendingPreprovider(c)){this.preproviderUnknown(tx,c);return false;}
        if(c.job.invocationPhase==='local_check'&&(!c.job.leaseUntil||c.job.leaseUntil<=Date.now()||!this.usable(c.input,c.job.inputId,c.job)||c.input.unknownCount>0||!this.aiInvocationEnabled(c))){this.preproviderUnknown(tx,c);return false;}
      }
      if (!c.job.leaseUntil || c.job.leaseUntil <= Date.now()) {if(c.artifact&&c.job.invocationPhase==='not_started')this.requeueBeforeInvocation(tx,c);else this.unknown(tx,c);return false;}
      if (!this.usable(c.input,c.job.inputId,c.job) || c.input.unknownCount > 0 || c.artifact&&(c.rawAccountData.aiPilot!==true||c.rawAccountData.simulationOnly!==true)) {if(c.artifact&&c.job.invocationPhase==='not_started')this.settle(tx,c,'failed');else this.unknown(tx, c);return false;}
      tx.update(c.jobRef, { leaseUntil: Date.now() + 30_000 }); return true;
    });
  }
  private requeueBeforeInvocation(tx:Transaction,c:Context){
    tx.update(c.jobRef,{state:'queued',attemptId:null,leaseUntil:null,invocationPhase:null});
    tx.update(this.ref('outbox',c.jobRef.id),{state:'pending',nextAttemptAt:Date.now(),leaseUntil:null,dispatchAttempt:null});
  }
  /** Recovery does not replay a provider whose running lease expired. */
  async recover(accountId: string, jobId: string) {
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,'text');
      if(narrationRequiresReview(c.job.operation))return false;
      if (c.job.state !== 'running' || (c.job.leaseUntil !== null && c.job.leaseUntil > Date.now())) return false;
      if(this.textAi(c)&&c.job.invocationPhase!=='invoking'&&(c.job.invocationPhase==='local_check'||!this.cleanPendingPreprovider(c))){this.preproviderUnknown(tx,c);return true;}
      if (c.job.invocationPhase === 'not_started') {
        this.requeueBeforeInvocation(tx,c);
        return true;
      }
      this.unknown(tx, c); return true;
    });
  }
  /** Dispatcher claims are independent from provider attempt fencing. */
  async claimDispatch(jobId: string) {
    identifier(jobId); const attempt = randomUUID();
    const result=await this.db.runTransaction(async tx => {
      const ref=this.ref('outbox',jobId),[doc,job]=await tx.getAll(ref,this.ref('jobs',jobId));
      if(!doc.exists||doc.get('state')==='sent'||doc.get('nextAttemptAt')>Date.now()||doc.get('leaseUntil')>Date.now())return null;
      const ownAi=doc.get('aiProfile')===AI_CATALOG_VERSION,defer=()=>tx.update(ref,{nextAttemptAt:Date.now()+300000,leaseUntil:null,dispatchAttempt:null});
      if(!job.exists||job.get('accountId')!==doc.get('accountId')||ownAi&&job.get('aiProfile')!==AI_CATALOG_VERSION){if(ownAi){defer();return 'invalid' as const;}return null;}
      if(job.get('state')!=='queued'){if(ownAi)defer();return null;}
      if(narrationRequiresReview(job.get('operation'))){defer();return null;}
      if(await this.jobAccounting(tx,jobId,job.data() as Job)==='unverified'){defer();return null;}
      if(job.get('aiProfile')===AI_CATALOG_VERSION){
        if(!ownAi)return null;
        const [input,account]=await tx.getAll(this.ref('inputs',job.get('inputId')),this.ref('accounts',job.get('accountId')));
        if(!input.exists||input.get('accountId')!==job.get('accountId')||!account.exists){defer();return 'invalid' as const;}
        if(input.get('unknownCount')>0||account.get('aiPilot')!==true||account.get('simulationOnly')!==true){defer();return null;}
        if(!await this.externalJobAdmissionAllowed(tx,jobId,job.data() as Job)){defer();return null;}
      }
      const until=Date.now()+30000;tx.update(ref,{dispatchAttempt:attempt,leaseUntil:until,nextAttemptAt:until});
      return {jobId,accountId:doc.get('accountId') as string,dispatchAttempt:attempt};
    });
    if(result==='invalid')throw new LedgerFault('invariant'); // After commit: do not roll back durable deferral.
    return result;
  }

  async acknowledgeDispatch(jobId: string, attempt: string) {
    identifier(jobId); identifier(attempt);
    return this.db.runTransaction(async tx => {
      const ref = this.ref('outbox', jobId), doc = await tx.get(ref);
      if (!doc.exists || doc.get('state') === 'sent' || doc.get('dispatchAttempt') !== attempt || doc.get('leaseUntil') <= Date.now()) return false;
      // Transport acceptance is not proof the worker started. Redeliver until claim.
      tx.update(ref, {leaseUntil: null, nextAttemptAt: Date.now() + 60_000}); return true;
    });
  }
  async pendingDispatches(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new LedgerFault('invalid');
    const docs = await this.root.collection('outbox').where('state', '==', 'pending')
      .where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt').limit(limit).get();
    return docs.docs.filter(doc => doc.get('nextAttemptAt') <= Date.now() && !(doc.get('leaseUntil') > Date.now())).map(doc => doc.id);
  }
  /** Select this worker before LIMIT so another profile can never occupy its page. */
  async pendingAiDispatches(limit=30){
    if(!Number.isSafeInteger(limit)||limit<1||limit>30)throw new LedgerFault('invalid');
    const docs=await this.root.collection('outbox').where('aiProfile','==',AI_CATALOG_VERSION).where('state','==','pending')
      .where('nextAttemptAt','<=',Date.now()).orderBy('nextAttemptAt').limit(limit).get();
    return docs.docs.filter(doc=>!(doc.get('leaseUntil')>Date.now())).map(doc=>doc.id);
  }
  /** Operator migration only: annotate an already-pending, verified AI row; never create or claim work. */
  async backfillAiDispatchProfile(jobId:string){
    identifier(jobId);return this.db.runTransaction(async tx=>{
      const ref=this.ref('outbox',jobId),[outbox,job]=await tx.getAll(ref,this.ref('jobs',jobId));
      if(!outbox.exists||outbox.get('state')!=='pending')return false;
      if(outbox.get('aiProfile')!==undefined){if(outbox.get('aiProfile')!==AI_CATALOG_VERSION&&job.exists&&job.get('aiProfile')===AI_CATALOG_VERSION)throw new LedgerFault('invariant');return false;}
      if(outbox.get('jobId')!==jobId||!job.exists)throw new LedgerFault('invariant');
      if(job.get('aiProfile')!==AI_CATALOG_VERSION)return false; // A known foreign/legacy worker is never annotated.
      if(job.get('accountId')!==outbox.get('accountId')||!['queued','running','unknown','succeeded','failed','cancelled'].includes(job.get('state')))throw new LedgerFault('invariant');
      const [account,input]=await tx.getAll(this.ref('accounts',job.get('accountId')),this.ref('inputs',job.get('inputId')));
      if(!account.exists||!input.exists||input.get('accountId')!==job.get('accountId'))throw new LedgerFault('invariant');
      // Classification does not grant permission: disabled accounts remain blocked at dispatch and paid fences.
      tx.update(ref,{aiProfile:AI_CATALOG_VERSION});return true;
    });
  }

  /** Read eligibility and durably defer known blocked work, without changing its Job or money. */
  async aiDispatchEligible(jobId:string){
    identifier(jobId);const result=await this.db.runTransaction(async tx=>{
      const ref=this.ref('outbox',jobId),[outbox,job]=await tx.getAll(ref,this.ref('jobs',jobId));
      if(!outbox.exists||outbox.get('state')!=='pending'||outbox.get('aiProfile')!==AI_CATALOG_VERSION||outbox.get('nextAttemptAt')>Date.now()||outbox.get('leaseUntil')>Date.now())return 'deferred' as const;
      const defer=()=>tx.update(ref,{nextAttemptAt:Date.now()+300000,leaseUntil:null,dispatchAttempt:null});
      if(!job.exists||job.get('aiProfile')!==AI_CATALOG_VERSION||job.get('accountId')!==outbox.get('accountId')){defer();return 'invalid' as const;}
      if(job.get('state')!=='queued'){defer();return 'deferred' as const;}
      const [input,account]=await tx.getAll(this.ref('inputs',job.get('inputId')),this.ref('accounts',job.get('accountId')));
      if(!input.exists||input.get('accountId')!==job.get('accountId')||!account.exists){defer();return 'invalid' as const;}
      if(input.get('unknownCount')>0||account.get('aiPilot')!==true||account.get('simulationOnly')!==true){defer();return 'deferred' as const;}
      if(!await this.externalJobAdmissionAllowed(tx,jobId,job.data() as Job)){defer();return 'deferred' as const;}
      return 'eligible' as const;
    });
    if(result==='invalid')throw new LedgerFault('invariant'); // Report only after the deferral was committed.
    return result==='eligible';
  }

  async recoverExpiredLeasesReport(limit=50){
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new LedgerFault('invalid');
    // Rotating trusted cursor changes no Job lease/deadline/money, even for malformed rows.
    const cursorRef=this.root.collection('maintenanceCursors').doc('expiredJobRecovery'),cursorSnapshot=await cursorRef.get(),cursor=cursorSnapshot.data();
    const opaqueId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&!value.includes('/')&&Buffer.byteLength(value,'utf8')<=1500;
    const validCursor=cursor?.kind==='expired-job-recovery-v1'&&typeof cursor.leaseUntil==='number'&&Number.isFinite(cursor.leaseUntil)&&opaqueId(cursor.jobId);
    if(cursorSnapshot.exists&&!validCursor)throw new LedgerFault('invariant');
    const base=this.root.collection('jobs').where('state','==','running').where('leaseUntil','<=',Date.now()).orderBy('leaseUntil').orderBy(FieldPath.documentId());
    // Query exceptions intentionally propagate unchanged. At most two bounded queries/wrap.
    const first=await (validCursor?base.startAfter(cursor.leaseUntil,cursor.jobId):base).limit(limit).get();
    const rows=[...first.docs];
    if(validCursor&&rows.length<limit){const wrapped=await base.endAt(cursor.leaseUntil,cursor.jobId).limit(limit-rows.length).get();rows.push(...wrapped.docs);}
    const report={scanned:rows.length,recovered:0,failures:[] as {jobId:string|null;stage:'recover';code:number|'UNCLASSIFIED'|'INVALID_ID'}[]};
    for(const doc of rows){
      if(!uuid.test(doc.id)){report.failures.push({jobId:null,stage:'recover',code:'INVALID_ID'});continue;}
      try{if(await this.recover(doc.get('accountId'),doc.id))report.recovered++;}catch(error){const raw=(error as {code?:unknown})?.code;report.failures.push({jobId:doc.id,stage:'recover',code:typeof raw==='number'&&Number.isSafeInteger(raw)?raw:'UNCLASSIFIED'});}
    }
    const last=rows.at(-1);if(last){
      const leaseUntil=last.get('leaseUntil');if(typeof leaseUntil!=='number'||!Number.isFinite(leaseUntil)||!opaqueId(last.id))throw new LedgerFault('invariant');
      await this.db.runTransaction(async tx=>{
        const current=await tx.get(cursorRef);
        if(current.exists!==cursorSnapshot.exists||current.exists&&!current.updateTime?.isEqual(cursorSnapshot.updateTime!))return;
        tx.set(cursorRef,{kind:'expired-job-recovery-v1',leaseUntil,jobId:last.id,updatedAtMs:Date.now()});
      });
    }
    return report;
  }

  async recoverExpiredLeases(limit=50){
    const report=await this.recoverExpiredLeasesReport(limit);
    if(report.failures.length){const error=new LedgerFault('invariant');Object.assign(error,{recoveryReport:report});throw error;}
    return report.recovered;
  }

  async quarantine(accountId: string, jobId: string, attemptId: string) {
    identifier(attemptId);
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId);
      if(narrationRequiresReview(c.job.operation))return false;
      if (c.job.state !== 'running' || c.job.attemptId !== attemptId) return false;
      if(c.job.invocationPhase==='local_check'||this.textAi(c)&&c.job.invocationPhase==='not_started'){this.preproviderUnknown(tx,c);return true;}
      if(c.job.invocationPhase!=='invoking')return false;
      this.unknown(tx, c); return true;
    });
  }
  /** Trusted worker decoder evidence only; no HTTP route exposes this terminal release. */
  async completeNoSpeech(accountId:string,jobId:string,attemptId:string,proof:readonly {readonly callKey:string;readonly responseSha256:string}[]){
    identifier(attemptId);
    if(!Array.isArray(proof)||proof.length<1||proof.length>AI_TEXT_MAX_WINDOWS)throw new LedgerFault('invalid');
    const validatedProof:{callKey:string;responseSha256:string}[]=[];
    for(let index=0;index<proof.length;index++){
      const row=proof[index];if(!Object.hasOwn(proof,index)||!row||Object.keys(row).sort().join(',')!=='callKey,responseSha256'||
        typeof row.callKey!=='string'||!/^text-window:\d{4}$/.test(row.callKey)||typeof row.responseSha256!=='string'||!/^[a-f0-9]{64}$/.test(row.responseSha256))throw new LedgerFault('invalid');
      validatedProof.push({callKey:row.callKey,responseSha256:row.responseSha256});
    }
    return this.db.runTransaction(async tx=>{
      const c=await this.context(tx,accountId,jobId,true);
      if(c.job.state!=='running'||c.job.attemptId!==attemptId||c.job.invocationPhase!=='invoking')return false;
      if(!c.artifact||c.job.operation!=='translation:en'||c.artifact.state!=='pending'||c.artifact.entries.length!==0||
        c.artifact.quotaMode!=='reserved'||c.artifact.quotaHeld!==c.artifact.plan.budgetBytes)throw new LedgerFault('conflict');
      // Invalid/expired fences do not refund. The worker retains UNKNOWN if this release is refused or the SDK outcome stays unconfirmed.
      if(!c.job.leaseUntil||c.job.leaseUntil<=Date.now()||!this.usable(c.input,c.job.inputId,c.job)||c.input.unknownCount!==0||
        c.rawAccountData.aiPilot!==true||c.rawAccountData.simulationOnly!==true||c.artifact.expiresAtMs<=Date.now())return false;
      const receipt=this.verifiedProviderReceipt(c);
      if(validatedProof.length!==receipt.keys.length||validatedProof.some((row,index)=>row.callKey!==receipt.keys[index]||
        row.responseSha256!==c.providerReceipts!.find(call=>call.data.callKey===row.callKey)?.data.responseSha256))throw new LedgerFault('conflict');
      // LV-019.B C2a: the release claim is derived from data written in this same transaction: the already-computed receipt hash of the admitted calls.
      this.settle(tx,c,'failed','no-speech:'+hash(validatedProof),{kind:'no_speech',evidenceSha256:receipt.hash});
      tx.update(c.jobRef,{failureCode:'no_speech',noSpeechReceiptHash:receipt.hash});
      return true;
    });
  }
  async finish(accountId: string, jobId: string, attemptId: string, success: boolean) {
    identifier(attemptId); if (typeof success !== 'boolean') throw new LedgerFault('invalid');
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,true);
      if(narrationRequiresReview(c.job.operation))return false;
      if (c.job.state !== 'running' || c.job.attemptId !== attemptId) return false;
      if (c.job.invocationPhase !== 'invoking') return false;
      if (c.input.unknownCount > 0) {this.unknown(tx,c);return false;}
      if (!c.job.leaseUntil || c.job.leaseUntil <= Date.now()) { this.unknown(tx, c); return false; }
      if(c.artifact){
        if(!success||!this.usable(c.input,c.job.inputId,c.job)||c.rawAccountData.aiPilot!==true||c.rawAccountData.simulationOnly!==true){this.unknown(tx,c);return false;}
        try{this.publishableManifest(c);}catch{this.unknown(tx,c);return false;}
        this.settle(tx,c,'succeeded');return true;
      }
      this.settle(tx, c, success && this.usable(c.input,c.job.inputId,c.job) ? 'succeeded' : 'failed'); return true;
    });
  }
  private async cancelInTransaction(tx:Transaction,accountId:string,jobId:string) {
    const c = await this.context(tx, accountId, jobId,'text');
    if(narrationRequiresReview(c.job.operation))return false;
    if(this.textAi(c)&&(c.job.state==='queued'||c.job.state==='running'&&c.job.invocationPhase!=='invoking')){
      if(c.job.invocationPhase==='local_check'||!this.cleanPendingPreprovider(c)){this.preproviderUnknown(tx,c);return true;}
    }
    if (c.job.state === 'queued') { this.settle(tx, c, 'cancelled'); return true; }
    if (c.job.state === 'running') {
      if (c.job.invocationPhase === 'not_started') this.settle(tx,c,'cancelled');
      else this.unknown(tx, c);
      return true;
    }
    return false;
  }
  /** Trusted internal cancellation; customer routes must use cancelForUid. */
  async cancel(accountId: string, jobId: string) {
    return this.db.runTransaction(tx=>this.cancelInTransaction(tx,accountId,jobId));
  }
  /** UID must come from the verified token, never from the request body. */
  async cancelForUid(accountId:string,jobId:string,uid:string) {
    identifier(accountId);identifier(jobId);
    return this.db.runTransaction(async tx=>{
      if(!await verifiedUidAccountInTransaction(tx,this.root,accountId,uid))throw new LedgerFault('not_found');
      return this.cancelInTransaction(tx,accountId,jobId);
    });
  }
  /** Trusted reconciliation only. Never expose as a customer mutation. */
  async reconcile(accountId: string, jobId: string, outcome: 'failed' | 'succeeded', evidence: string) {
    if (!['failed','succeeded'].includes(outcome) || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 500) throw new LedgerFault('invalid');
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,outcome==='succeeded'?true:'text');
      if(narrationRequiresReview(c.job.operation))return false;
      if (c.job.state !== 'unknown') return false;
      if(this.textAi(c)&&c.job.invocationPhase!=='invoking'){
        const a=c.artifact;
        if(outcome!=='failed'||!c.providerReceipts||c.providerReceipts.length||c.terminalExists||!a||!['pending','purging','purged'].includes(a.state)||a.entries.length||a.attemptId!==null||Object.hasOwn(a,'callReceiptHash')||Object.hasOwn(a,'callKeys'))throw new LedgerFault('conflict');
      }
      // AI success recovery is allowed only via staged re-read before UNKNOWN/purge, never resurrection afterward.
      if(c.artifact&&outcome==='succeeded')throw new LedgerFault('conflict');
      const failed=!(outcome === 'succeeded' && this.usable(c.input,c.job.inputId,c.job));
      // LV-019.B C2a: a failed reconcile with admitted calls releases with the `not_delivered` claim; the evidence hash is over the raw evidence string.
      this.settle(tx, c, failed?'failed':'succeeded', evidence, failed?{kind:'not_delivered',evidenceSha256:textHash(evidence)}:undefined); return true;
    });
  }
  async job(accountId: string, jobId: string) {
    identifier(accountId); identifier(jobId); const doc = await this.ref('jobs', jobId).get();
    if (!doc.exists || doc.get('accountId') !== accountId) throw new LedgerFault('not_found'); return doc.data() as Job;
  }
  /**
   * LV-019.B step 1.2: release `unknown` jobs whose review window has elapsed, at most `limit` per pass, in document-id order
   * from `after` (null starts over). The clock is the injected `now`; no wall clock decides expiry. Each row runs in its own
   * transaction and its own try/catch: one malformed or failing row counts `failed` and never stops the pass, and an already
   * released row is a no-op. Voice (`narration:`) rows are never eligible: they keep their own proportional-charge policy
   * (C2/C3) and are counted not-due. This resolver NEVER captures; it only ever releases. `windowMs`/`skewMs` are TEST-ONLY
   * overrides, validated below, never passed by a production caller and unreachable from any HTTP route. The cursor advances
   * over every row read and wraps to null at the end; the counts carry no ids and no content. `shouldContinue` is consulted BEFORE
   * each row: `false` or a throw ends the pass cleanly (`stopped:true`, never propagated), the rows after it stay
   * untouched and `next` is the last row attended, so the next pass resumes right after it. Design: sections 3 and 4.
   */
  async resolveExpiredUnknown(options:{now:number;limit:number;after?:string|null;windowMs?:number;skewMs?:number;shouldContinue?:()=>boolean|Promise<boolean>}){
    const now=options?.now,limit=options?.limit,after=options?.after??null,windowMs=options?.windowMs,skewMs=options?.skewMs,shouldContinue=options?.shouldContinue;
    if(!Number.isSafeInteger(now)||(now as number)<0)throw new LedgerFault('invalid');
    if(!Number.isSafeInteger(limit)||(limit as number)<1||(limit as number)>100)throw new LedgerFault('invalid');
    if(after!==null&&!plainDocumentId(after))throw new LedgerFault('invalid');
    // Test-only overrides: `windowMs` may only SHORTEN the window, `skewMs` must stay within its ceiling. Anything else
    // (non-number, NaN, Infinity, negative or out of range) is a bad parameter, not a policy change.
    if(windowMs!==undefined&&(!Number.isSafeInteger(windowMs)||(windowMs as number)<MIN_TEST_UNKNOWN_WINDOW_MS||(windowMs as number)>UNKNOWN_REVIEW_WINDOW_MS))throw new LedgerFault('invalid');
    if(skewMs!==undefined&&(!Number.isSafeInteger(skewMs)||(skewMs as number)<0||(skewMs as number)>MAX_TEST_UNKNOWN_SKEW_MS))throw new LedgerFault('invalid');
    if(shouldContinue!==undefined&&typeof shouldContinue!=='function')throw new LedgerFault('invalid');
    // The page read is the first database access, so a rejected argument never reaches the runner (validated above).
    const page=await this.db.runTransaction(async tx=>{
      let query=this.root.collection('jobs').where('state','==','unknown').orderBy(FieldPath.documentId()).limit(limit as number);
      if(after!==null)query=query.startAfter(after);
      return (await tx.get(query)).docs.map(doc=>doc.id);
    });
    const report={scanned:page.length,resolved:0,notDue:0,failed:0,next:(page.length===limit?page[page.length-1]:null) as string|null,stopped:false};
    let lastAttended:string|null=null;
    for(const jobId of page){
      if(shouldContinue!==undefined){
        let proceed=false;
        try{proceed=!!(await shouldContinue());}catch{proceed=false;}
        if(!proceed){report.stopped=true;report.next=lastAttended??after;break;}
      }
      let outcome:'resolved'|'not_due'|'failed'|'skipped';
      try{
        outcome=await this.db.runTransaction(async tx=>{
          const doc=await tx.get(this.ref('jobs',jobId));
          if(!doc.exists||doc.get('state')!=='unknown')return 'skipped' as const;
          // Voice has its own proportional-charge policy and recovery (C2/C3): releasing a narration here with K=0 would
          // contradict the owner's policy, so a voice row is never eligible. It is counted not-due and left untouched.
          if(narrationRequiresReview(doc.get('operation')))return 'not_due' as const;
          const accountId=doc.get('accountId');
          if(typeof accountId!=='string')return 'failed' as const;
          const c=await this.context(tx,accountId,jobId,true);
          if(c.job.state!=='unknown')return 'skipped' as const;
          const admitted=!!c.providerReceipts&&c.providerReceipts.length>0;
          const verdict=classifyUnknownQuarantine({quarantinedAtMs:c.job.quarantinedAtMs,unknownAttemptId:c.job.unknownAttemptId},{jobId,admitted,now:now as number,...(windowMs!==undefined?{windowMs}:{}),...(skewMs!==undefined?{skewMs}:{})});
          if(verdict.state==='invalid')return 'failed' as const;
          if(verdict.state==='not_due')return 'not_due' as const;
          if(admitted)this.settle(tx,c,'failed',verdict.evidence,{kind:'unknown_expired',evidenceSha256:verdict.evidenceSha256});
          else this.settle(tx,c,'failed',verdict.evidence);
          tx.update(c.jobRef,{resolvedAs:'unknown_expired'});
          return 'resolved' as const;
        });
      }catch{outcome='failed';}
      lastAttended=jobId;
      if(outcome==='resolved')report.resolved++;
      else if(outcome==='not_due')report.notDue++;
      else if(outcome==='failed')report.failed++;
    }
    return report;
  }
  /** Customer status must recheck identity and job ownership in the same transaction. */
  async jobForUid(accountId:string,jobId:string,uid:string) {
    identifier(accountId);identifier(jobId);
    return this.db.runTransaction(async tx=>{
      if(!await verifiedUidAccountInTransaction(tx,this.root,accountId,uid))throw new LedgerFault('not_found');
      const doc=await tx.get(this.ref('jobs',jobId));
      if(!doc.exists||doc.get('accountId')!==accountId)throw new LedgerFault('not_found');return doc.data() as Job;
    });
  }
}
