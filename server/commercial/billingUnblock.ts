/**
 * LV-019.B step 1.4b piece 2: the audited reopening of a blocked Video account (phases 0, 1 and 3; phase 2 is Account).
 *
 * What it is NOT: it never moves balance, never captures and never edits a reservation. It never takes the drain lease
 * (design 2.8) and it never implements the exit of a blocked account's reservations (piece 3).
 * What it IS: an operator names ONE incident and the exact guard generation (epoch + createdAtMs) plus the durable
 * evidence, and this module (0) proves the state, (1) writes an immutable `unblock_requested` record, (2) lets the
 * caller ask Account first and only then (3) releases the Video guard and advances exactly the rows of that incident.
 *
 * ORDER. Account goes first: if Video failed after Account confirmed, Video stays blocked, which is the conservative
 * side, and a repeat can recover the decision by receipt. A dispatch claim is never permission to resend. Every phase
 * re-reads the guard generation, so a block that lands in between aborts the attempt instead of being overwritten.
 *
 * PRECONDITIONS for any endpoint (this module is a library, wired to no route): `authorizedBy` must come from an
 * authenticated principal on the allowlist, never from the request body, and `nowMs` must be the server clock; nothing
 * here can verify either. The authenticated operator tool supplies the Account guard generation for a new mutation.
 * Fresh dispatch is closed unless a trusted writer cut predates the guard. This module never certifies that cut.
 * On a repeat, Account can confirm the generation already accepted for this exact audited request.
 *
 * `AccountBillingClient.unblock` returns `blocked:true` when OTHER Account incidents remain: `unblocked:true` never
 * means the account is open, so the Video guard is only released when Account reports `blocked:false` AND Video has no
 * other unresolved row.
 *
 * Design: docs/specs/LV-019-B-bloqueos-y-cierres-diseno.md (v2, 2.4/2.5/2.8, 3.3, 3.4, 3.6)
 */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {FieldValue,type DocumentReference,type DocumentSnapshot,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {ALERT_COLLECTION,alertIdentity} from './billingPendingAlerts';
import {hasInvalidGuardReference} from './billingPendingReport';
import {accountHoldId,legacyHoldId} from './billingHoldIdentity';
import type {AccountBillingClient} from './accountBillingClient';
import {accountIdentityKey} from './accountBillingClient';
import {stableStringify} from './pipelineContracts';

/** Immutable Video records of one audited unblock; one document per (incident, action). */
export const UNBLOCK_AUDIT_COLLECTION='billingUnblockAudit';
export const UNBLOCK_CONTINUITY_COLLECTION='billingUnblockContinuity';
export const UNBLOCK_WRITER_CUT_ID='verified-writer-cut-v1';
/** Immutable Video record of the ONE successor attempt a reconciliation grant authorises for an uncertain request. */
export const UNBLOCK_SUCCESSOR_COLLECTION='billingUnblockSuccessors';
/** The only endpoint the successor seam may ever run against. */
export const UNBLOCK_EMULATOR_PROJECT='demo-vistavo-financial';
export const UNBLOCK_EMULATOR_HOST='127.0.0.1';
export const UNBLOCK_EMULATOR_PORT=8198;
export type UnblockAction='unblock_requested'|'unblocked'|'video_released';
export class UnblockFault extends Error{constructor(readonly code:'invalid'|'not_found'|'conflict'|'corrupt'|'unresolved'){super(code);}}

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[a-f0-9]{12}$/i;
const hex64=/^[a-f0-9]{64}$/;
const digest=(value:unknown):value is string=>typeof value==='string'&&hex64.test(value);
const actorPattern=/^[a-z0-9][a-z0-9._:-]{0,63}$/i;
const evidencePattern=/^[^\u0000-\u001f\u007f]{1,200}$/;
const notePattern=/^[^\u0000-\u001f\u007f]{1,500}$/;
const whole=(value:unknown,minimum=0):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=minimum;

/**
 * The deterministic id of one audited step of one OCCURRENCE: a repeat of the same step of the same guard generation
 * is the same document. An intent's incident key is the intent id, which does not change when the row diverges again,
 * so the guard generation (epoch + createdAtMs) is part of the id: without it a second occurrence would find the
 * `unblocked` record of the first and answer as a replay/conflict forever.
 */
export function unblockAuditId(incidentKey:string,action:UnblockAction,epoch:number,createdAtMs:number):string{
  return hash(['billing-unblock-v2',incidentKey,epoch,createdAtMs,action]);
}
/**
 * The hold document id AND Account's incident id of one OCCURRENCE of a Video incident. Both sides use ONE value (the
 * drainer sends `hold.id` as the incident id), and it already carries the guard generation, which is exactly what
 * changes between two occurrences of the same row -- the reason a re-block after an unblock is accepted by Account.
 */
export function videoHoldId(kind:'intent'|'outbox',incidentKey:string,epoch:number,createdAtMs:number):string{
  return accountHoldId(kind,incidentKey,epoch,createdAtMs);
}

export interface UnblockRequest{
  /** The Video incident key the guard names (`lastIncidentId` or `lastOutboxIncidentId`). */
  incidentId:string;
  /** The open `guard` alert of that account and generation. */
  alertKey:string;
  /** The guard generation the operator read: an old one cannot clear a newer block. */
  epoch:number;createdAtMs:number;updatedAtMs:number;
  /** Account's own guard generation (trusted: supplied by the authenticated operator tool, never by the identity body). */
  accountEpoch:number;accountCreatedAtMs:number;
  /** Durable reference to the evidence the operator reviewed (also Account's `reviewRef`). */
  evidenceRef:string;note?:string;
}
export interface UnblockReceipt{
  unblocked:true;replayed:boolean;
  /** Account still holds this owner because other incidents remain unreviewed. */
  accountBlocked:boolean;
  /** Whether the Video guard still blocks after this call. */
  videoBlocked:boolean;
  /** Rows handed back by this call (Video side). */
  advanced:string[];
  auditId:string;
}
export interface SuccessorAttempt{
  previousAttemptId:string;previousEpoch:number;
  reconcileId:string;
  attemptId:string;epoch:number;
  authorizationSha256:string;
}
type PendingReceipt={state:'pending';attemptId:string;epoch:number;createdAtMs:number};
type ConfirmedReceipt={state:'confirmed';attemptId:string;epoch:number;createdAtMs:number;blocked:boolean;replayed:boolean};
export type SuccessorReceipt=PendingReceipt|ConfirmedReceipt;
export type SuccessorDecision=
  |ConfirmedReceipt
  |{state:'permitted';reconcileId:string;attemptId:string;epoch:number;createdAtMs:number;replayed:boolean};
type AccountReceipt=
  |{state:'pending';attemptId:null;epoch:null;createdAtMs:null}
  |{state:'confirmed';attemptId:null;epoch:number;createdAtMs:number;blocked:boolean;replayed:boolean}
  |SuccessorReceipt;
export interface SuccessorBilling{
  attestation:unknown;
  attempt:SuccessorAttempt;
  accountCreatedAtMs:number;
  receipt(input:{identityKey:string;incidentId:string;reviewRef:string}):Promise<unknown>;
  reconcile(input:{identityKey:string;incidentId:string;reviewRef:string}):Promise<unknown>;
  confirm(input:{identityKey:string;incidentId:string;reviewRef:string;attempt:'previous'|'successor'}):Promise<unknown>;
}
export interface UnblockDeps{
  db:Firestore;root:DocumentReference;
  accountBilling:Pick<AccountBillingClient,'unblock'|'unblockReceipt'>;
  successor?:SuccessorBilling;
  // SOLO seam de emulador: raíz de Cuenta en la MISMA instancia Firestore.
  // Nunca se define en producción. Con `successor` y sin ella, se falla cerrado.
  localAccountRoot?:DocumentReference;
}

type Clean={incidentKey:string;alertKey:string;epoch:number;createdAtMs:number;updatedAtMs:number;accountEpoch:number;accountCreatedAtMs:number;evidenceRef:string;note:string|null};
type PlannedRow={collection:string;id:string;state:string|null;reviewField?:string;to:string|null;toReviewField?:string|null;exitState?:string};
type AccountRow={accountId:string;state:string|null;reviewedAtMs:number|null};
type UnblockObservation={
  guard:DocumentSnapshot;requested:DocumentSnapshot;done:DocumentSnapshot;
  witness:DocumentSnapshot;dispatch:DocumentSnapshot;cut:DocumentSnapshot;
};

function cleanRequest(request:unknown):Clean{
  if(!request||typeof request!=='object'||Array.isArray(request))throw new UnblockFault('invalid');
  const r=request as Record<string,unknown>;
  const allowed=['incidentId','alertKey','epoch','createdAtMs','updatedAtMs','accountEpoch','accountCreatedAtMs','evidenceRef','note'];
  if(Object.keys(r).some(key=>!allowed.includes(key)))throw new UnblockFault('invalid');
  const {incidentId,alertKey,epoch,createdAtMs,updatedAtMs,accountEpoch,accountCreatedAtMs,evidenceRef}=r,note=r.note??null;
  if(!digest(incidentId)||!digest(alertKey))throw new UnblockFault('invalid');
  if(!whole(epoch,1)||!whole(createdAtMs)||!whole(updatedAtMs)||!whole(accountEpoch,1)||!whole(accountCreatedAtMs))throw new UnblockFault('invalid');
  if(typeof evidenceRef!=='string'||!evidencePattern.test(evidenceRef))throw new UnblockFault('invalid');
  if(note!==null&&(typeof note!=='string'||!notePattern.test(note)))throw new UnblockFault('invalid');
  return {incidentKey:incidentId as string,alertKey:alertKey as string,epoch:epoch as number,createdAtMs:createdAtMs as number,updatedAtMs:updatedAtMs as number,accountEpoch:accountEpoch as number,accountCreatedAtMs:accountCreatedAtMs as number,evidenceRef,note:note as string|null};
}
/**
 * The `state` a `guard` report row carries (`billingPendingReport.ts`): the guard generation. The epoch restarts at 1 after
 * the guard is deleted, so the creation mark is required too, or an old alert would answer for a newer block.
 */
export function blockedState(epoch:number,createdAtMs:number,incidentKey:string):string{return 'blocked:'+epoch+':'+createdAtMs+':'+incidentKey;}
/** The guard generation, with the declared legacy rule: no `epoch` is epoch 1, but no `createdAtMs` cannot be named. */
function generation(doc:DocumentSnapshot):{epoch:number;createdAtMs:number;updatedAtMs:number}{
  if(hasInvalidGuardReference(doc.data()??{}))throw new UnblockFault('corrupt');
  const stored=doc.get('epoch'),createdAtMs=doc.get('createdAtMs'),updatedAtMs=doc.get('updatedAtMs');
  if(stored!==undefined&&(!whole(stored,1)))throw new UnblockFault('corrupt');
  if(!whole(createdAtMs)||!whole(updatedAtMs))throw new UnblockFault('corrupt');
  return {epoch:stored===undefined?1:stored,createdAtMs,updatedAtMs};
}
function sameGuard(guard:DocumentSnapshot,accountId:string,clean:Clean):boolean{
  if(!guard.exists||guard.get('blocked')!==true||guard.get('accountId')!==accountId)return false;
  const current=generation(guard);
  const intent=guard.get('lastIncidentId')===clean.incidentKey,outbox=guard.get('lastOutboxIncidentId')===clean.incidentKey;
  return current.epoch===clean.epoch&&current.createdAtMs===clean.createdAtMs&&intent!==outbox;
}
function sameOpenAlert(alert:DocumentSnapshot,accountId:string,clean:Clean):boolean{
  const identity=alert.exists?alertIdentity(alert):null;
  return !!identity&&identity.kind==='guard'&&identity.rowId===accountId&&identity.status==='open'&&
    identity.state===blockedState(clean.epoch,clean.createdAtMs,clean.incidentKey);
}

// Compare versions of the same document at two Video reads, never clocks across databases.
function sameVersion(previous:DocumentSnapshot,current:DocumentSnapshot):boolean{
  return !!previous.updateTime&&!!current.updateTime&&previous.updateTime.isEqual(current.updateTime);
}

function immutable(doc:DocumentSnapshot):boolean{
  return !!doc.createTime&&!!doc.updateTime&&doc.createTime.isEqual(doc.updateTime);
}
function guardBornAfterWriterCut(guard:DocumentSnapshot,cut:DocumentSnapshot):boolean{
  if(!immutable(cut)||!isDeepStrictEqual(cut.data(),{v:1,purpose:'unblock-writer-cut'}))return false;
  const created=guard.createTime,start=cut.createTime;
  return !!created&&!!start&&(created.seconds>start.seconds||
    created.seconds===start.seconds&&created.nanoseconds>start.nanoseconds);
}
function exactKeys(value:Record<string,unknown>,keys:readonly string[]):boolean{
  const own=Object.keys(value);
  return own.length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
}
interface EmulatorEvidence{project:string;servicePath:string;port:number;ssl:boolean;preferRest:boolean}
const attestedEmulatorPairs=new WeakSet<object>();
export function emulatorEvidence(db:Firestore):EmulatorEvidence{
  const settings=(db as unknown as {_settings?:Record<string,unknown>})._settings;
  if(!settings)throw new UnblockFault('invalid');
  const {projectId,servicePath,port,ssl,preferRest}=settings;
  if(projectId!==UNBLOCK_EMULATOR_PROJECT||servicePath!==UNBLOCK_EMULATOR_HOST||
    port!==UNBLOCK_EMULATOR_PORT||ssl!==false||preferRest!==false)throw new UnblockFault('invalid');
  return {project:UNBLOCK_EMULATOR_PROJECT,servicePath:UNBLOCK_EMULATOR_HOST,
    port:UNBLOCK_EMULATOR_PORT,ssl:false,preferRest:false};
}
export function attestLocalEmulatorPair(videoDb:Firestore,accountDb:Firestore){
  if(process.env.NODE_ENV!=='test'||
    process.env.FIRESTORE_EMULATOR_HOST!==UNBLOCK_EMULATOR_HOST+':'+UNBLOCK_EMULATOR_PORT)
    throw new UnblockFault('invalid');
  const video=emulatorEvidence(videoDb),account=emulatorEvidence(accountDb);
  if(JSON.stringify(video)!==JSON.stringify(account))throw new UnblockFault('invalid');
  const token=Object.freeze({kind:'lv019b-local-emulator-pair' as const,video,account});
  attestedEmulatorPairs.add(token);
  return token;
}
function attestedLocalEmulatorPair(db:Firestore,value:unknown):boolean{
  if(process.env.NODE_ENV!=='test'||!value||typeof value!=='object'||!attestedEmulatorPairs.has(value))return false;
  try{return JSON.stringify(emulatorEvidence(db))===JSON.stringify((value as {video?:unknown}).video);}
  catch{return false;}
}
const attestedAccountRoots=new WeakMap<object,{path:string;firestore:Firestore}>();

export function attestLocalEmulatorPairWithAccountRoot(videoDb:Firestore,accountDb:Firestore,accountRoot:DocumentReference){
  if(videoDb!==accountDb)throw new UnblockFault('invalid');
  const token=attestLocalEmulatorPair(videoDb,accountDb);
  if(accountRoot.firestore!==videoDb)throw new UnblockFault('invalid');
  attestedAccountRoots.set(token,{path:accountRoot.path,firestore:accountRoot.firestore});
  return token;
}

function attestedAccountRoot(token:unknown,root:DocumentReference):boolean{
  if(typeof token!=='object'||token===null)return false;
  const bound=attestedAccountRoots.get(token);
  return !!bound&&bound.path===root.path&&bound.firestore===root.firestore;
}
async function videoIdentityOf(tx:Transaction,root:DocumentReference,accountId:string){
  const page=await tx.get(root.collection('identities').where('accountId','==',accountId).limit(2));
  const docs=page.docs.filter(doc=>doc.get('accountId')===accountId&&typeof doc.get('uid')==='string');
  if(docs.length!==1)throw Object.assign(new UnblockFault('conflict'),{stage:'video_identity_ambiguous'});
  const doc=docs[0],uid=doc.get('uid') as string;
  if(!digest(doc.id))throw Object.assign(new UnblockFault('conflict'),{stage:'video_identity_digest'});
  let key:string;
  try{key=accountIdentityKey(uid);}catch{throw Object.assign(new UnblockFault('conflict'),{stage:'video_identity_key'});}
  if(doc.id!==key)throw Object.assign(new UnblockFault('conflict'),{stage:'video_identity_key'});
  return {doc,identityKey:doc.id,uid};
}

type GuardResolution={kind:'legacy'}|{kind:'resolved';guardRef:DocumentReference;identityKey:string;accountIdCuenta:string};

async function resolveAccountGuard(tx:Transaction,deps:UnblockDeps,videoAccountId:string):Promise<GuardResolution>{
  const seam=deps.successor;
  if(!seam)return {kind:'legacy'};
  const accountRoot=deps.localAccountRoot;
  if(!accountRoot)throw Object.assign(new UnblockFault('unresolved'),{stage:'account_root_unaccredited'});
  if(accountRoot.firestore!==deps.db)throw Object.assign(new UnblockFault('invalid'),{stage:'account_root_firestore'});
  if(!attestedLocalEmulatorPair(deps.db,seam.attestation))throw new UnblockFault('invalid');
  if(!attestedAccountRoot(seam.attestation,accountRoot))throw Object.assign(new UnblockFault('invalid'),{stage:'account_root_substituted'});
  const video=await videoIdentityOf(tx,deps.root,videoAccountId);
  const accountIdentity=await tx.get(accountRoot.collection('identities').doc(video.identityKey));
  if(!accountIdentity.exists)throw Object.assign(new UnblockFault('conflict'),{stage:'account_identity_missing'});
  if(accountIdentity.get('uid')!==video.uid)throw Object.assign(new UnblockFault('conflict'),{stage:'account_identity_uid'});
  const accountIdCuenta=accountIdentity.get('accountId');
  if(typeof accountIdCuenta!=='string'||!uuid.test(accountIdCuenta))throw Object.assign(new UnblockFault('conflict'),{stage:'account_identity_account'});
  return {kind:'resolved',guardRef:accountRoot.collection('videoBillingGuards').doc(accountIdCuenta),identityKey:video.identityKey,accountIdCuenta};
}

// Si NO existe, `tx.get(ref)` deja la referencia en el read set (creación concurrente detectada).
// Si existe y no cuadra con `billingHold`, falla cerrado.
async function readAccountGuard(tx:Transaction,resolution:GuardResolution):Promise<boolean>{
  if(resolution.kind!=='resolved')return false;
  const guard=await tx.get(resolution.guardRef);
  if(!guard.exists)return false;
  if(guard.get('ownerAccountId')!==resolution.accountIdCuenta||guard.get('identityKey')!==resolution.identityKey||
    guard.get('blocked')!==true||!whole(guard.get('incidentCount'),1)||!whole(guard.get('epoch'),1)||
    !whole(guard.get('createdAtMs'),0)||!whole(guard.get('updatedAtMs'),0))
    throw Object.assign(new UnblockFault('conflict'),{stage:'account_guard_shape'});
  return true;
}

function successorOf(deps:UnblockDeps):SuccessorBilling|null{
  const seam=deps.successor;
  if(!seam)return null;
  if(!attestedLocalEmulatorPair(deps.db,seam.attestation))throw new UnblockFault('invalid');
  const a=seam.attempt;
  if(!a||typeof a!=='object'||!uuid.test(a.previousAttemptId)||!uuid.test(a.reconcileId)||
    !uuid.test(a.attemptId)||a.attemptId===a.previousAttemptId||!whole(a.previousEpoch,1)||
    !whole(a.epoch,a.previousEpoch)||!digest(a.authorizationSha256)||!whole(seam.accountCreatedAtMs)||
    typeof seam.receipt!=='function'||typeof seam.reconcile!=='function'||typeof seam.confirm!=='function')
    throw new UnblockFault('invalid');
  return seam;
}
function successorClaimId(accountId:string,requestId:string,a:SuccessorAttempt):string{
  return hash(['billing-unblock-successor-v1',accountId,requestId,a.previousAttemptId,a.previousEpoch,
    a.reconcileId,a.attemptId,a.epoch]);
}
function sameSuccessorClaim(doc:DocumentSnapshot,expected:Record<string,unknown>):boolean{
  return doc.exists&&immutable(doc)&&isDeepStrictEqual(doc.data(),expected);
}
function decisionReceipt(value:unknown):SuccessorReceipt{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new UnblockFault('corrupt');
  const row=value as Record<string,unknown>;
  if(exactKeys(row,['state','attemptId','epoch','createdAtMs'])&&row.state==='pending'&&
    typeof row.attemptId==='string'&&uuid.test(row.attemptId)&&whole(row.epoch,1)&&whole(row.createdAtMs))
    return {state:'pending',attemptId:row.attemptId,epoch:row.epoch,createdAtMs:row.createdAtMs};
  if(exactKeys(row,['state','attemptId','epoch','createdAtMs','blocked','replayed'])&&row.state==='confirmed'&&
    typeof row.attemptId==='string'&&uuid.test(row.attemptId)&&whole(row.epoch,1)&&whole(row.createdAtMs)&&
    typeof row.blocked==='boolean'&&typeof row.replayed==='boolean')
    return {state:'confirmed',attemptId:row.attemptId,epoch:row.epoch,createdAtMs:row.createdAtMs,
      blocked:row.blocked,replayed:row.replayed};
  throw new UnblockFault('corrupt');
}
function successorDecision(value:unknown):SuccessorDecision{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new UnblockFault('corrupt');
  const row=value as Record<string,unknown>;
  if(exactKeys(row,['state','attemptId','epoch','createdAtMs','blocked','replayed'])&&row.state==='confirmed'&&
    typeof row.attemptId==='string'&&uuid.test(row.attemptId)&&whole(row.epoch,1)&&whole(row.createdAtMs)&&
    typeof row.blocked==='boolean'&&typeof row.replayed==='boolean')
    return {state:'confirmed',attemptId:row.attemptId,epoch:row.epoch,createdAtMs:row.createdAtMs,
      blocked:row.blocked,replayed:row.replayed};
  if(exactKeys(row,['state','reconcileId','attemptId','epoch','createdAtMs','replayed'])&&row.state==='permitted'&&
    typeof row.reconcileId==='string'&&uuid.test(row.reconcileId)&&typeof row.attemptId==='string'&&
    uuid.test(row.attemptId)&&whole(row.epoch,1)&&whole(row.createdAtMs)&&typeof row.replayed==='boolean')
    return {state:'permitted',reconcileId:row.reconcileId,attemptId:row.attemptId,epoch:row.epoch,
      createdAtMs:row.createdAtMs,replayed:row.replayed};
  throw new UnblockFault('corrupt');
}
function confirmedResult(value:unknown){
  const decision=successorDecision(value);
  if(decision.state!=='confirmed')throw new UnblockFault('corrupt');
  return decision;
}
/** Classifies Account answers: invariant -> corrupt; explicit conflict -> conflict; transport -> unresolved. */
async function successorCall<T>(stage:string,operation:()=>Promise<T>):Promise<T>{
  try{return await operation();}
  catch(cause){
    const code=(cause as {code?:unknown})?.code;
    if(code==='invariant')throw Object.assign(new UnblockFault('corrupt'),{stage,cause});
    if(code==='unavailable'||code==='not_found')throw Object.assign(new UnblockFault('unresolved'),{stage,cause});
    throw Object.assign(new UnblockFault('conflict'),{stage,cause});
  }
}
/** Claim payload derives ONLY from the durable `unblock_requested`, never from the `done` close. */
function successorClaimFromRequest(requested:DocumentSnapshot,accountId:string,holdId:string,
  attempt:SuccessorAttempt,accountCreatedAtMs:number):Record<string,unknown>{
  const data=requested.data();
  if(!requested.exists||!data||data.action!=='unblock_requested'||data.accountId!==accountId||
    typeof data.incidentKey!=='string'||typeof data.alertKey!=='string'||
    (data.kind!=='intent'&&data.kind!=='outbox')||!whole(data.epoch,1)||!whole(data.createdAtMs)||
    typeof data.evidenceRef!=='string'||typeof data.authorizedBy!=='string'||!whole(data.recordedAtMs))
    throw new UnblockFault('corrupt');
  return {v:1,kind:'successor',requestId:requested.id,
    accountId,incidentKey:data.incidentKey,alertKey:data.alertKey,
    videoKind:data.kind,videoEpoch:data.epoch,videoCreatedAtMs:data.createdAtMs,
    holdId,accountCreatedAtMs,
    previousAttemptId:attempt.previousAttemptId,previousEpoch:attempt.previousEpoch,
    reconcileId:attempt.reconcileId,attemptId:attempt.attemptId,epoch:attempt.epoch,
    reviewRef:data.evidenceRef,authorizationSha256:attempt.authorizationSha256,
    authorizedBy:data.authorizedBy,recordedAtMs:data.recordedAtMs};
}

function continuityRecord(requestId:string,record:Record<string,unknown>,kind:'request'|'dispatch'){
  const requestSha256=createHash('sha256').update('billing-unblock-continuity-v1\0').update(stableStringify(record)).digest('hex');
  return {v:1,kind,requestId,requestSha256};
}
function continuousRequest(requested:DocumentSnapshot,witness:DocumentSnapshot,dispatch:DocumentSnapshot):boolean{
  const created=requested.createTime,original=requested.data();
  if(!created||!original||!immutable(requested)||!immutable(witness)||!immutable(dispatch)||
    !created.isEqual(witness.createTime!)||!created.isEqual(dispatch.createTime!))return false;
  try{
    return isDeepStrictEqual(witness.data(),continuityRecord(requested.id,original,'request'))&&
      isDeepStrictEqual(dispatch.data(),continuityRecord(requested.id,original,'dispatch'));
  }catch{return false;}
}

async function accountPhase<T>(operation:()=>Promise<T>):Promise<T>{
  try{return await operation();}
  catch(cause){throw Object.assign(new UnblockFault('conflict'),{stage:'account',cause});}
}

/**
 * Every row of the account that still needs attention, read with one equality per collection on `accountId` (served by
 * the automatic single-field index; no composite index). A row that belongs to the incident being unblocked is kept
 * apart: everything else must be resolved before any guard is released (design 3.3, phase 0).
 */
async function accountRows(tx:Transaction,root:DocumentReference,accountId:string){
  // Read through the caller's transaction: a rival row that commits between this read and the release makes the
  // transaction retry (or abort), instead of slipping past a non-transactional snapshot. Every caller runs these reads
  // before its first write, as Firestore requires.
  const read=async(collection:string)=>{
    const page=await tx.get(root.collection(collection).where('accountId','==',accountId));
    return page.docs.map(doc=>({id:doc.id,data:doc.data() as Record<string,unknown>}));
  };
  const intents=await read('billingIntents'),outboxes=await read('billingOutbox'),holds=await read('billingHoldOutbox'),
    reviews=await read('billingReviewIncidents'),outboxIncidents=await read('billingOutboxReviewIncidents'),observationIncidents=await read('billingIntentObservationIncidents');
  return {intents,outboxes,holds,reviews,outboxIncidents,observationIncidents};
}
function unresolvedRows(rows:Awaited<ReturnType<typeof accountRows>>,owned:Set<string>){
  const out:string[]=[];
  const add=(collection:string,doc:{id:string;data:Record<string,unknown>})=>{const path=collection+'/'+doc.id;if(!owned.has(path))out.push(path);};
  for(const doc of rows.intents)if(doc.data.state==='needs_review')add('billingIntents',doc);
  for(const doc of rows.outboxes)if(doc.data.state==='needs_review')add('billingOutbox',doc);
  for(const doc of rows.holds)if(doc.data.state==='pending'||doc.data.state==='needs_review')add('billingHoldOutbox',doc);
  for(const doc of rows.reviews)if(!whole(doc.data.reviewedAtMs))add('billingReviewIncidents',doc);
  for(const doc of rows.outboxIncidents)if(!whole(doc.data.reviewedAtMs))add('billingOutboxReviewIncidents',doc);
  for(const doc of rows.observationIncidents)if(!whole(doc.data.reviewedAtMs))add('billingIntentObservationIncidents',doc);
  return out.sort();
}

/** Which incident the guard names, and the rows that belong to it. */
function incidentOf(guard:DocumentSnapshot,rows:Awaited<ReturnType<typeof accountRows>>,incidentKey:string,generation:{epoch:number;createdAtMs:number}){
  const intentKey=guard.get('lastIncidentId'),outboxKey=guard.get('lastOutboxIncidentId');
  const intent=intentKey===incidentKey,outbox=outboxKey===incidentKey;
  if(intent===outbox)return null; // neither names it, or both do (corrupt)
  const kind:'intent'|'outbox'=intent?'intent':'outbox',
    // The hold of this occurrence is named after the guard generation the operator read; a legacy guard (no generation)
    // still has its hold under the pre-1.4b id, and that row is accepted only as a legacy row.
    holdId=videoHoldId(kind,incidentKey,generation.epoch,generation.createdAtMs),legacyId=legacyHoldId(kind,incidentKey);
  const owned=new Set<string>(['billingHoldOutbox/'+holdId,'billingHoldOutbox/'+legacyId]);
  const planned:PlannedRow[]=[];
  const hold=rows.holds.find(doc=>doc.id===holdId&&(doc.data.epoch===undefined||doc.data.epoch===generation.epoch&&doc.data.createdAtMs===generation.createdAtMs))
    ??rows.holds.find(doc=>doc.id===legacyId&&doc.data.epoch===undefined);
  if(hold&&(hold.data.state==='pending'||hold.data.state==='needs_review')){planned.push({collection:'billingHoldOutbox',id:hold.id,state:String(hold.data.state),to:'applied'});}
  if(kind==='intent'){
    owned.add('billingReviewIncidents/'+incidentKey);
    const review=rows.reviews.find(doc=>doc.id===incidentKey);
    if(review&&!whole(review.data.reviewedAtMs))planned.push({collection:'billingReviewIncidents',id:incidentKey,state:null,to:null});
    for(const doc of rows.observationIncidents)if(doc.data.intentId===incidentKey&&!whole(doc.data.reviewedAtMs)){owned.add('billingIntentObservationIncidents/'+doc.id);planned.push({collection:'billingIntentObservationIncidents',id:doc.id,state:String(doc.data.state??'needs_review'),to:'reviewed'});}
    const intentRow=rows.intents.find(doc=>doc.id===incidentKey);
    if(intentRow){owned.add('billingIntents/'+incidentKey);
      if(intentRow.data.state==='needs_review')planned.push({collection:'billingIntents',id:incidentKey,state:'needs_review',reviewField:typeof intentRow.data.reviewIncidentId==='string'?'reviewIncidentId':'reviewOutboxIncidentId',to:null,toReviewField:null});
    }
  }else{
    owned.add('billingOutboxReviewIncidents/'+incidentKey);
    const incident=rows.outboxIncidents.find(doc=>doc.id===incidentKey);
    if(incident){
      if(!whole(incident.data.reviewedAtMs))planned.push({collection:'billingOutboxReviewIncidents',id:incidentKey,state:String(incident.data.state??'needs_review'),to:'reviewed'});
      const outboxId=incident.data.outboxId;
      if(typeof outboxId==='string'){owned.add('billingOutbox/'+outboxId);
        const row=rows.outboxes.find(doc=>doc.id===outboxId);
        if(row&&row.data.state==='needs_review')planned.push({collection:'billingOutbox',id:outboxId,state:'needs_review',reviewField:'reviewIncidentId',to:'retry_wait',toReviewField:null});
      }
      // The outbox incident does not store the intent id: the intent is the row this incident named, read back through
      // its own review pointer. Only an intent that points at THIS incident is owned and advanced.
      for(const intentRow of rows.intents)if(intentRow.data.reviewOutboxIncidentId===incidentKey||intentRow.data.reviewIncidentId===incidentKey){
        const field=intentRow.data.reviewOutboxIncidentId===incidentKey?'reviewOutboxIncidentId':'reviewIncidentId';
        owned.add('billingIntents/'+intentRow.id);
        if(intentRow.data.state==='needs_review')planned.push({collection:'billingIntents',id:intentRow.id,state:'needs_review',reviewField:field,to:null,toReviewField:null});
      }
    }
  }
  return {kind,holdId,owned,planned};
}
/**
 * An intent incident closes its intent's admission: `billingIntentAdmissionGuards/<intentId>` goes to `needs_review` with
 * `incidentId` + `updatedAtMs` (firestoreBackend.ts). Many paths demand the EXACT 4-field `clear` shape, so an unblock
 * that hands the intent back must also restore it, or the intent can never be admitted again. Only a guard that names
 * THIS incident (or one of the observation incidents this unblock already hands back) belongs to it; never an outbox
 * incident, and never a guard that is absent or already clear.
 */
function intentAdmissionRow(admission:DocumentSnapshot,incidentKey:string,planned:PlannedRow[]):PlannedRow|null{
  if(!admission.exists||admission.get('state')!=='needs_review')return null;
  const named=admission.get('incidentId');
  if(named!==incidentKey&&!planned.some(row=>row.collection==='billingIntentObservationIncidents'&&row.id===named))return null;
  return {collection:'billingIntentAdmissionGuards',id:incidentKey,state:'needs_review',to:'clear'};
}

/**
 * The audited unblock. Look up the Account receipt before a fresh dispatch. Then prove the local state and reserve
 * the single send in the same transaction as the audit request. A repeat only recovers the Account receipt.
 * An identical, completed call is a local replay without writes.
 */
export async function unblockBillingAccount(deps:UnblockDeps,accountId:string,request:UnblockRequest,authorizedBy:string,nowMs:number):Promise<UnblockReceipt>{
  if(!deps||typeof deps!=='object'||!deps.db||!deps.root||!deps.accountBilling)throw new UnblockFault('invalid');
  if(!uuid.test(accountId))throw new UnblockFault('invalid');
  if(typeof authorizedBy!=='string'||!actorPattern.test(authorizedBy))throw new UnblockFault('invalid');
  if(!whole(nowMs))throw new UnblockFault('invalid');
  const clean=cleanRequest(request);
  const {db,root}=deps,guardRef=root.collection('billingGuards').doc(accountId),alertRef=root.collection(ALERT_COLLECTION).doc(clean.alertKey);
  const requestedRef=root.collection(UNBLOCK_AUDIT_COLLECTION).doc(unblockAuditId(clean.incidentKey,'unblock_requested',clean.epoch,clean.createdAtMs));
  const doneRef=root.collection(UNBLOCK_AUDIT_COLLECTION).doc(unblockAuditId(clean.incidentKey,'unblocked',clean.epoch,clean.createdAtMs));
  const releasedRef=root.collection(UNBLOCK_AUDIT_COLLECTION).doc(unblockAuditId(clean.incidentKey,'video_released',clean.epoch,clean.createdAtMs));
  const continuity=root.collection(UNBLOCK_CONTINUITY_COLLECTION),witnessRef=continuity.doc(requestedRef.id),
    dispatchRef=continuity.doc('dispatch-'+requestedRef.id),cutRef=continuity.doc(UNBLOCK_WRITER_CUT_ID);
  const payload={incidentKey:clean.incidentKey,alertKey:clean.alertKey,epoch:clean.epoch,createdAtMs:clean.createdAtMs,updatedAtMs:clean.updatedAtMs,evidenceRef:clean.evidenceRef,note:clean.note,authorizedBy};

  const samePayload=(data:Record<string,unknown>|undefined)=>data?.accountId===accountId&&
    Object.entries(payload).every(([key,value])=>key==='authorizedBy'||data[key]===value);
  const sameOperator=(data:Record<string,unknown>|undefined)=>!!data&&data.authorizedBy===authorizedBy;

  async function freshRecord(tx:Transaction,guard:DocumentSnapshot,alert:DocumentSnapshot):Promise<Record<string,unknown>>{
    if(!alert.exists)throw Object.assign(new UnblockFault('not_found'),{stage:'alert_missing'});
    const identity=alertIdentity(alert);
    if(!identity)throw Object.assign(new UnblockFault('corrupt'),{stage:'alert_identity'});
    if(identity.kind!=='guard'||identity.rowId!==accountId)throw Object.assign(new UnblockFault('conflict'),{stage:'alert_owner'});
    if(identity.status!=='open')throw Object.assign(new UnblockFault('conflict'),{stage:'alert_status'});
    // The alert is per account AND generation: an alert of another epoch (or of a guard recreated with the same epoch
    // after a delete) is not this block.
    if(identity.state!==blockedState(clean.epoch,clean.createdAtMs,clean.incidentKey))throw Object.assign(new UnblockFault('conflict'),{stage:'alert_state:'+identity.state});
    if(!guard.exists||guard.get('blocked')!==true||guard.get('accountId')!==accountId)throw Object.assign(new UnblockFault('conflict'),{stage:'guard_shape'});
    const current=generation(guard);
    if(current.epoch!==clean.epoch||current.createdAtMs!==clean.createdAtMs||current.updatedAtMs!==clean.updatedAtMs)throw Object.assign(new UnblockFault('conflict'),{stage:'generation:'+JSON.stringify([current,clean.epoch,clean.createdAtMs,clean.updatedAtMs])});
    // The operator-selected incident must be the one the guard names.
    const rows=await accountRows(tx,root,accountId);
    const incident=incidentOf(guard,rows,clean.incidentKey,current);
    if(!incident)throw Object.assign(new UnblockFault('conflict'),{stage:'incident:keys:'+JSON.stringify([guard.get('lastIncidentId'),guard.get('lastOutboxIncidentId'),clean.incidentKey])});
    const rivals=unresolvedRows(rows,incident.owned);
    if(rivals.length)throw Object.assign(new UnblockFault('unresolved'),{stage:'rivals:'+rivals.join(',')});
    // Read (still before this transaction's first write) the intent's admission guard. It carries no `accountId`, so it
    // never appears in `accountRows`; an intent incident of THIS occurrence must return it to its `clear` shape.
    if(incident.kind==='intent'){
      const admission=await tx.get(root.collection('billingIntentAdmissionGuards').doc(clean.incidentKey));
      const admissionRow=intentAdmissionRow(admission,clean.incidentKey,incident.planned);
      if(admissionRow){incident.planned.push(admissionRow);incident.owned.add('billingIntentAdmissionGuards/'+clean.incidentKey);}
    }
    return {auditId:requestedRef.id,action:'unblock_requested',...payload,kind:incident.kind,accountId,holdId:incident.holdId,
      accountEpoch:clean.accountEpoch,accountCreatedAtMs:clean.accountCreatedAtMs,
      planned:incident.planned,reviewedRivals:rivals,recordedAtMs:nowMs};
  }

  // Phase 0 probes the local state before the receipt lookup. A fresh writer must
  // prove the same state again when the audit and the dispatch claim are created.
  const seam=successorOf(deps);
  if(seam)await db.runTransaction(async tx=>{
    await readAccountGuard(tx,await resolveAccountGuard(tx,deps,accountId));
  });

  const opened=await db.runTransaction(async tx=>{
    const [guard,alert,requested,done,released,witness,dispatch,cut]=await tx.getAll(guardRef,alertRef,requestedRef,doneRef,releasedRef,witnessRef,dispatchRef,cutRef);
    const observed={guard,requested,done,witness,dispatch,cut};
    // The caller is authenticated BEFORE this module: `authorizedBy` is its verified identity, not payload. Re-using an
    // audited unblock with a different principal is not a replay of the same request, so it is a conflict (an argument
    // mismatch), not a second operator's write; the same principal repeating the call is the replay.
    // An audited record only answers while it still describes the CURRENT guard: the epoch restarts at 1 when the guard
    // is deleted, so a record of another generation must not replay as success over a newer block.
    // The generation alone is not enough: the epoch restarts at 1 when the guard is deleted, and the creation mark can
    // repeat in the same millisecond, so a record also has to name the SAME incident the live guard names.
    // A partial release already finished (Account had no other incident and Video released): a pure replay, checked
    // BEFORE any Account call so a third identical request writes nothing and never asks Account again.
    if(released.exists){
      const data=released.data() as Record<string,unknown>|undefined;
      if(!samePayload(data)||!sameOperator(data))throw new UnblockFault('conflict');
      // `video_released` was created in the same transaction that deleted the guard, so a live BLOCKED guard is a NEWER
      // block (another incident on the same row) and never the generation this record released. Answering `replayed`
      // here would tell the operator the account is open while another incident blocks it.
      if(guard.exists&&guard.get('blocked')===true)throw new UnblockFault('conflict');
      return {replayed:true as const,record:data!,videoReleased:true as const};
    }
    if(done.exists){
      const data=done.data() as Record<string,unknown>|undefined;
      if(!samePayload(data)||!sameOperator(data))throw new UnblockFault('conflict');
      if(guard.exists&&guard.get('blocked')===true){
        // `unblocked` is created in the SAME transaction that deletes the guard, so a live guard here is the PARTIAL
        // result: Account still had other incidents and the Video guard survived. It is not a newer block unless the
        // generation moved; the epoch restarts at 1 after a delete, so the creation mark is what distinguishes them.
        if(!sameGuard(guard,accountId,clean)||!sameOpenAlert(alert,accountId,clean))throw new UnblockFault('conflict');
        // Same occurrence: the repeat can read Account's receipt and may finish the release.
        return {replayed:false as const,record:data!,partial:true as const,observed};
      }
      return {replayed:true as const,record:data!};
    }
    // Surviving evidence of an earlier dispatch cannot authorize a replacement request.
    if(!requested.exists&&(witness.exists||dispatch.exists))throw new UnblockFault('conflict');
    if(requested.exists){
      const data=requested.data() as Record<string,unknown>|undefined;
      if(!samePayload(data))throw new UnblockFault('conflict');
      if(authorizedBy!==data.authorizedBy)throw new UnblockFault('conflict');
      if(!sameGuard(guard,accountId,clean)||!sameOpenAlert(alert,accountId,clean))throw new UnblockFault('conflict');
      return {replayed:false as const,record:data!,observed};
    }
    const record=await freshRecord(tx,guard,alert);
    return {replayed:false as const,record,fresh:true as const,observed};
  });
  if(opened.replayed)return {unblocked:true,replayed:true,accountBlocked:Boolean(opened.record.accountBlocked),
    videoBlocked:'videoReleased' in opened?false:Boolean(opened.record.videoBlocked),
    advanced:Array.isArray(opened.record.advanced)?opened.record.advanced.map(String):[],auditId:String(opened.record.auditId)};

  const record=opened.record,planned=record.planned as PlannedRow[];
  const kind=opened.observed.guard.get('lastIncidentId')===clean.incidentKey?'intent':'outbox';
  const holdId=videoHoldId(kind,clean.incidentKey,clean.epoch,clean.createdAtMs);
  if(record.kind!==kind||record.holdId!==holdId)throw new UnblockFault('conflict');

  async function recheck(tx:Transaction,observed:UnblockObservation,
    pin?:{ref:DocumentReference;data:Record<string,unknown>}){
    const [guard,alert,requested,done,released,witness,dispatch,cut]=await tx.getAll(guardRef,alertRef,requestedRef,doneRef,releasedRef,witnessRef,dispatchRef,cutRef);
    const requestData=requested.data();
    if(!sameGuard(guard,accountId,clean)||!sameOpenAlert(alert,accountId,clean))throw new UnblockFault('conflict');
    const guardKind=guard.get('lastIncidentId')===clean.incidentKey?'intent':'outbox';
    const sameRequest=observed.requested.exists?sameVersion(observed.requested,requested):isDeepStrictEqual(requestData,record);
    const sameContinuity=observed.requested.exists?
      sameVersion(observed.witness,witness)&&sameVersion(observed.dispatch,dispatch):
      sameVersion(observed.cut,cut)&&guardBornAfterWriterCut(guard,cut);
    if(!samePayload(requestData)||!sameOperator(requestData)||requestData?.auditId!==requestedRef.id||
      requestData.action!=='unblock_requested'||requestData.kind!==guardKind||kind!==guardKind||
      requestData.holdId!==holdId||holdId!==videoHoldId(guardKind,clean.incidentKey,clean.epoch,clean.createdAtMs)||
      !sameVersion(observed.guard,guard)||!sameRequest||!sameContinuity||!continuousRequest(requested,witness,dispatch)||released.exists||
      (observed.done.exists?!sameVersion(observed.done,done):done.exists))throw new UnblockFault('conflict');
    // Read before any write of this transaction: a missing/changed claim aborts the whole advance.
    if(pin&&!sameSuccessorClaim(await tx.get(pin.ref),pin.data))throw new UnblockFault('conflict');
    return {guard,requested,done,witness,dispatch,cut};
  }

  let observed=opened.observed;
  let accepted={epoch:clean.accountEpoch,createdAtMs:clean.accountCreatedAtMs};
    let acceptedAttemptId:string|null=null;
  let account:{replayed:boolean;blocked:boolean};
  const identityKey=await accountPhase(()=>identityKeyOf(root,accountId));
  const granted=seam?.attempt??null;
  const claimRef=seam&&granted?root.collection(UNBLOCK_SUCCESSOR_COLLECTION)
    .doc(successorClaimId(accountId,requestedRef.id,granted)):null;
  let cachedClaim:Record<string,unknown>|null=null;
  const claimRecord=()=>{
    if(!seam||!granted||!claimRef)throw new UnblockFault('conflict');
    if(!observed.requested.exists)throw new UnblockFault('conflict');
    cachedClaim??=successorClaimFromRequest(observed.requested,accountId,holdId,granted,seam.accountCreatedAtMs);
    return cachedClaim;
  };
  let pin:{ref:DocumentReference;data:Record<string,unknown>}|null=null;
  const requireClaim=async()=>{
    if(!claimRef)throw new UnblockFault('conflict');
    const data=claimRecord(),snap=await claimRef.get();
    if(!sameSuccessorClaim(snap,data))throw new UnblockFault('conflict');
    pin={ref:claimRef,data};
  };
  const activeTuple=(state:{attemptId:string;epoch:number})=>!!granted&&
    ((state.attemptId===granted.previousAttemptId&&state.epoch===granted.previousEpoch)||
     (state.attemptId===granted.attemptId&&state.epoch===granted.epoch));

  let receipt:AccountReceipt;
  if(seam){
    const value=decisionReceipt(await successorCall('account',()=>seam.receipt({identityKey,incidentId:holdId,reviewRef:clean.evidenceRef})));
    if(value.createdAtMs!==seam.accountCreatedAtMs||!activeTuple(value))throw new UnblockFault('conflict');
    receipt=value;
  }else{
    const raw=await accountPhase(()=>deps.accountBilling.unblockReceipt(identityKey,holdId,clean.evidenceRef));
    if(raw?.state==='pending')receipt={state:'pending',attemptId:null,epoch:null,createdAtMs:null};
    else if(raw?.state==='confirmed'&&whole(raw.epoch,1)&&whole(raw.createdAtMs)&&typeof raw.blocked==='boolean')
      receipt={state:'confirmed',attemptId:null,epoch:raw.epoch,createdAtMs:raw.createdAtMs,blocked:raw.blocked,replayed:true};
    else throw new UnblockFault('conflict');
  }

  if(receipt.state==='confirmed'){
    if('fresh' in opened)throw new UnblockFault('conflict');
    if(seam){
      if(!granted||!receipt.attemptId)throw new UnblockFault('corrupt');
      if(receipt.createdAtMs!==seam.accountCreatedAtMs)throw new UnblockFault('corrupt');
      if(receipt.attemptId===granted.previousAttemptId){
        if(receipt.epoch!==granted.previousEpoch)throw new UnblockFault('corrupt');
      }else if(receipt.attemptId===granted.attemptId){
        if(receipt.epoch!==granted.epoch)throw new UnblockFault('corrupt');
        await requireClaim();
      }else throw new UnblockFault('corrupt');
    }
    accepted={epoch:receipt.epoch,createdAtMs:receipt.createdAtMs};
    acceptedAttemptId=receipt.attemptId;
    account={replayed:receipt.replayed,blocked:receipt.blocked};
  }else if('fresh' in opened){
    if(!guardBornAfterWriterCut(observed.guard,observed.cut))throw new UnblockFault('conflict');
    if(seam){
      if(!granted||receipt.attemptId!==granted.previousAttemptId||receipt.epoch!==granted.previousEpoch||
        clean.accountEpoch!==granted.previousEpoch||clean.accountCreatedAtMs!==seam.accountCreatedAtMs)
        throw Object.assign(new UnblockFault('conflict'),{stage:'initial_tuple'});
    }
    await db.runTransaction(async tx=>{
      const [guard,alert,requested,done,released,witness,dispatch,cut]=await tx.getAll(
        guardRef,alertRef,requestedRef,doneRef,releasedRef,witnessRef,dispatchRef,cutRef);
      if(requested.exists||done.exists||released.exists||witness.exists||dispatch.exists||
        !sameVersion(observed.guard,guard)||!sameVersion(observed.cut,cut)||!guardBornAfterWriterCut(guard,cut)||
        !isDeepStrictEqual(await freshRecord(tx,guard,alert),record))throw new UnblockFault('conflict');
      tx.create(requestedRef,record);
      tx.create(witnessRef,continuityRecord(requestedRef.id,record,'request'));
      tx.create(dispatchRef,continuityRecord(requestedRef.id,record,'dispatch'));
    });
    observed=await db.runTransaction(tx=>recheck(tx,observed));
    if(seam){
      const result=confirmedResult(await successorCall('account',()=>seam.confirm({identityKey,incidentId:holdId,reviewRef:clean.evidenceRef,attempt:'previous'})));
      if(!granted||result.attemptId!==granted.previousAttemptId||result.epoch!==granted.previousEpoch||
        result.createdAtMs!==seam.accountCreatedAtMs)throw new UnblockFault('conflict');
      accepted={epoch:result.epoch,createdAtMs:result.createdAtMs};
      acceptedAttemptId=granted.previousAttemptId;
      account={replayed:result.replayed,blocked:result.blocked};
    }else{
      account=await accountPhase(()=>deps.accountBilling.unblock(identityKey,{incidentId:holdId,...accepted,reviewRef:clean.evidenceRef}));
    }
  }else if(seam&&!('partial' in opened)){
    if(!granted||clean.accountCreatedAtMs!==seam.accountCreatedAtMs)throw new UnblockFault('conflict');
    // BEFORE Account: verify Video authorization and the trusted cut.
    await db.runTransaction(tx=>recheck(tx,observed));
    const decision=successorDecision(await successorCall('account',()=>seam.reconcile({identityKey,incidentId:holdId,reviewRef:clean.evidenceRef})));
    if(decision.createdAtMs!==seam.accountCreatedAtMs)throw new UnblockFault('corrupt');
    if(decision.state==='confirmed'){
      if(decision.attemptId===granted.previousAttemptId){
        if(decision.epoch!==granted.previousEpoch)throw new UnblockFault('corrupt');
        // Previous attempt won the race: close by receipt; no claim, no send.
      }else if(decision.attemptId===granted.attemptId){
        if(decision.epoch!==granted.epoch)throw new UnblockFault('corrupt');
        await requireClaim();
      }else throw new UnblockFault('corrupt');
      accepted={epoch:decision.epoch,createdAtMs:decision.createdAtMs};
      acceptedAttemptId=decision.attemptId;
      account={replayed:true,blocked:decision.blocked};
    }else{
      if(decision.reconcileId!==granted.reconcileId||decision.attemptId!==granted.attemptId||
        decision.epoch!==granted.epoch)throw Object.assign(new UnblockFault('conflict'),{stage:'successor_permitted_tuple'});
      const data=claimRecord();
      // AFTER the fence: prove Video again and create the ONE claim in that same transaction.
      const claim=await db.runTransaction(async tx=>{
        const current=await recheck(tx,observed);
        if(!guardBornAfterWriterCut(current.guard,current.cut))throw new UnblockFault('conflict');
        const existing=await tx.get(claimRef!);
        if(existing.exists){
          if(!sameSuccessorClaim(existing,data))throw new UnblockFault('conflict');
          return {created:false as const};
        }
        tx.create(claimRef!,data);
        return {created:true as const};
      });
      pin={ref:claimRef!,data};
      if(claim.created){
        const result=confirmedResult(await successorCall('account',()=>seam.confirm({identityKey,incidentId:holdId,reviewRef:clean.evidenceRef,attempt:'successor'})));
        if(result.attemptId!==granted.attemptId||result.epoch!==granted.epoch||
          result.createdAtMs!==seam.accountCreatedAtMs)throw new UnblockFault('conflict');
        accepted={epoch:result.epoch,createdAtMs:result.createdAtMs};
        acceptedAttemptId=granted.attemptId;
        account={replayed:result.replayed,blocked:result.blocked};
      }else{
        // Somebody already holds this claim: its POST may be in flight. Never send a second one.
        const again=decisionReceipt(await successorCall('account',()=>seam.receipt({identityKey,incidentId:holdId,reviewRef:clean.evidenceRef})));
        if(again.state!=='confirmed')throw Object.assign(new UnblockFault('unresolved'),{stage:'successor_in_flight'});
        if(again.attemptId!==granted.attemptId||again.epoch!==granted.epoch||
          again.createdAtMs!==seam.accountCreatedAtMs)throw new UnblockFault('conflict');
        accepted={epoch:again.epoch,createdAtMs:again.createdAtMs};
        acceptedAttemptId=again.attemptId;
        account={replayed:true,blocked:again.blocked};
      }
    }
  }else{
    throw new UnblockFault('conflict');
  }

  if(seam&&acceptedAttemptId&&!account.blocked){
    // Deliberate revalidation of the Account decision immediately before Video may clear its guard. The first
    // receipt is a snapshot; a newer Account incident can land after it. This narrows the cross-database window.
    // Without a real versioned Account endpoint it cannot eliminate a change after this second read.
    const fresh=decisionReceipt(await successorCall('account',()=>seam.receipt({
      identityKey,incidentId:holdId,reviewRef:clean.evidenceRef})));
    if(fresh.state!=='confirmed'||fresh.attemptId!==acceptedAttemptId||fresh.epoch!==accepted.epoch||
      fresh.createdAtMs!==accepted.createdAtMs)
      throw Object.assign(new UnblockFault('unresolved'),{stage:'stale_account_decision'});
    if(fresh.blocked)account={...account,blocked:true};
  }

  if('partial' in opened){
    if(record.accountEpoch!==accepted.epoch||record.accountCreatedAtMs!==accepted.createdAtMs)throw new UnblockFault('conflict');
    const releasePin=pin;
    return db.runTransaction(async tx=>{
      await recheck(tx,observed,releasePin??undefined);
      const resolution=await resolveAccountGuard(tx,deps,accountId);
      const localAccountBlocked=await readAccountGuard(tx,resolution);
      if(account.blocked||localAccountBlocked)return {unblocked:true as const,replayed:true as const,accountBlocked:true,videoBlocked:true,
        advanced:Array.isArray(record.advanced)?record.advanced.map(String):[],auditId:String(record.auditId)};
      const rivals=unresolvedRows(await accountRows(tx,root,accountId),new Set());
      if(rivals.length)return {unblocked:true as const,replayed:true as const,accountBlocked:false,videoBlocked:true as const,
        advanced:Array.isArray(record.advanced)?record.advanced.map(String):[],auditId:String(record.auditId)};
      tx.delete(guardRef);
      tx.update(alertRef,{status:'dispositioned',dispositionedAtMs:nowMs,dispositionedBy:authorizedBy,dispositionAuditId:unblockAuditId(clean.incidentKey,'video_released',clean.epoch,clean.createdAtMs)});
      const releasedId=unblockAuditId(clean.incidentKey,'video_released',clean.epoch,clean.createdAtMs);
      tx.set(root.collection('billingReleaseReopenings').doc(accountId),{accountId,auditId:releasedId});
      tx.create(releasedRef,{auditId:releasedId,action:'video_released',...payload,kind,accountId,holdId,
        accountEpoch:accepted.epoch,accountCreatedAtMs:accepted.createdAtMs,
        advanced:[],accountBlocked:false,videoRivals:rivals,recordedAtMs:nowMs});
      return {unblocked:true as const,replayed:false as const,accountBlocked:false,videoBlocked:false as const,advanced:[],auditId:releasedId};
    });
  }

  return db.runTransaction(async tx=>{
    await recheck(tx,observed,pin??undefined);
    const resolution=await resolveAccountGuard(tx,deps,accountId);
    const localAccountBlocked=await readAccountGuard(tx,resolution);
    const rows:Array<{planned:PlannedRow;snap:DocumentSnapshot;exit?:string}>=[];
    for(const row of planned){
      const snap=await tx.get(root.collection(row.collection).doc(row.id));
      // A planned row that vanished between the audited read and this release is not silently skipped: the
      // audited tuple no longer describes the account, so the whole transaction aborts without writing.
      if(!snap.exists)throw new UnblockFault('conflict');
      const data=snap.data() as Record<string,unknown>;
      // Only a row whose reread still matches the audited tuple is advanced; anything else aborts untouched.
      // A hold is not owned by this unblock the way an outbox row is: the drainer may deliver it (`applied`) or the
      // authorizer may send it to `needs_review` after the audited read, and none of those settle the guard. Accepting
      // those two extra states keeps a retry from being stranded forever on a frozen `planned` tuple; anything else is
      // still a conflict.
      const holdSettled=row.collection==='billingHoldOutbox';
      if(row.state!==null&&data.state!==row.state&&!(holdSettled&&(data.state==='applied'||data.state==='needs_review')))throw new UnblockFault('conflict');
      // Even an already-applied row must still belong to the account in this decision.
      // Only the admission guard has no `accountId`.
      if(row.collection!=='billingIntentAdmissionGuards'&&data.accountId!==accountId)throw new UnblockFault('conflict');
      if(holdSettled&&data.state==='applied')continue;
      if(row.reviewField&&data[row.reviewField]!==clean.incidentKey)throw new UnblockFault('conflict');
      // Phase 3 re-reads state and owner of every audited row, but the RELATION that made a row belong to this incident
      // can drift too: an observation incident's `intentId` or an admission guard's `incidentId` can be re-pointed while
      // Account is being asked. An observation incident must still name this incident as its intent; an admission guard
      // must still name this incident or an observation incident this same unblock hands back. A relation that no longer
      // holds aborts the whole transaction without writing.
      if(row.collection==='billingIntentObservationIncidents'&&data.intentId!==clean.incidentKey)throw new UnblockFault('conflict');
      if(row.collection==='billingIntentAdmissionGuards'&&data.incidentId!==clean.incidentKey
        &&!planned.some(candidate=>candidate.collection==='billingIntentObservationIncidents'&&candidate.id===data.incidentId))throw new UnblockFault('conflict');
      if(row.collection==='billingIntents'){
        const [intent,witness]=await tx.getAll(snap.ref,root.collection('billingIntentWitnesses').doc(row.id));
        rows.push({planned:row,snap,exit:intentExit(intent,witness)});
      }else rows.push({planned:row,snap});
    }
    // Account says whether OTHER Account incidents remain; Video checks its own side again, because an incident could have
    // landed after the audited read. Either one keeps the guard blocked: `unblocked:true` never means the account is open.
    const rivals=unresolvedRows(await accountRows(tx,root,accountId),new Set(rows.map(row=>row.planned.collection+'/'+row.planned.id)));
    const clear=!account.blocked&&rivals.length===0&&!localAccountBlocked;
    const advanced:string[]=[];
    for(const {planned:row,snap,exit} of rows){
      const auditId=unblockAuditId(clean.incidentKey,'unblocked',clean.epoch,clean.createdAtMs);
      if(row.collection==='billingReviewIncidents'||row.collection==='billingOutboxReviewIncidents')tx.update(snap.ref,{state:'reviewed',reviewedAtMs:nowMs,unblockAuditId:auditId});
      else if(row.collection==='billingIntentObservationIncidents')tx.update(snap.ref,{state:'reviewed',reviewedAtMs:nowMs,unblockAuditId:auditId});
      else if(row.collection==='billingHoldOutbox')tx.update(snap.ref,{state:'applied',appliedAtMs:nowMs,lastErrorCode:null});
      else if(row.collection==='billingOutbox')tx.update(snap.ref,{state:'retry_wait',reviewIncidentId:FieldValue.delete(),nextAttemptAt:nowMs,updatedAtMs:nowMs});
      else if(row.collection==='billingIntentAdmissionGuards')tx.update(snap.ref,{state:'clear',incidentId:FieldValue.delete(),updatedAtMs:FieldValue.delete()});
      else tx.update(snap.ref,{state:exit,reviewReason:FieldValue.delete(),reviewIncidentId:FieldValue.delete(),reviewOutboxIncidentId:FieldValue.delete(),updatedAtMs:nowMs});
      advanced.push(row.collection+'/'+row.id);
    }
    if(clear){
      tx.delete(guardRef);
      tx.update(alertRef,{status:'dispositioned',dispositionedAtMs:nowMs,dispositionedBy:authorizedBy,dispositionAuditId:unblockAuditId(clean.incidentKey,'unblocked',clean.epoch,clean.createdAtMs)});
    }
    const auditId=unblockAuditId(clean.incidentKey,'unblocked',clean.epoch,clean.createdAtMs);
    if(clear)tx.set(root.collection('billingReleaseReopenings').doc(accountId),{accountId,auditId});
    tx.create(doneRef,{auditId,action:'unblocked',...payload,kind,accountId,holdId,advanced,accountBlocked:account.blocked||localAccountBlocked,videoBlocked:!clear,videoRivals:rivals,accountReplayed:account.replayed,accountEpoch:accepted.epoch,accountCreatedAtMs:accepted.createdAtMs,recordedAtMs:nowMs});
    return {unblocked:true as const,replayed:false as const,accountBlocked:account.blocked||localAccountBlocked,videoBlocked:!clear,advanced,auditId};
  });
}

/** The identity key of the account's owner, read from the account's own identity document (never from the request). */
async function identityKeyOf(root:DocumentReference,accountId:string):Promise<string>{
  const page=await root.collection('identities').where('accountId','==',accountId).limit(2).get();
  const keys=page.docs.filter(doc=>doc.get('accountId')===accountId&&typeof doc.get('uid')==='string').map(doc=>doc.id);
  if(keys.length!==1||!digest(keys[0]))throw new UnblockFault('conflict');
  return keys[0];
}
/**
 * Where a reviewed intent goes back to. An intent that already owns a work keeps its head state for that work (the
 * drainer reads `job_created` as the pre-dispatch state of an admitted job, and sending it to `reserve_pending` would
 * re-reserve work that exists); otherwise it resumes the release it had prepared, and only otherwise its reservation.
 */
function intentExit(intent:DocumentSnapshot,witness:DocumentSnapshot):string{
  if(intent.exists&&(intent.get('state')==='job_created'||typeof intent.get('jobId')==='string'))return 'job_created';
  return witness.exists&&witness.get('terminalRecovery')?.releasePrepared===true?'release_pending':'reserve_pending';
}
type FirebaseFirestoreTransaction=Parameters<Parameters<Firestore['runTransaction']>[0]>[0];
