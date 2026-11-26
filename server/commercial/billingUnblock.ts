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
 * side, and a repeat resumes the pending phase. Every phase re-reads the guard generation, so a block that lands in
 * between aborts the attempt instead of being overwritten.
 *
 * PRECONDITIONS for any endpoint (this module is a library, wired to no route): `authorizedBy` must come from an
 * authenticated principal on the allowlist, never from the request body, and `nowMs` must be the server clock; nothing
 * here can verify either. The authenticated operator tool supplies the Account guard generation for a new mutation.
 * On a repeat, Account can confirm the generation already accepted for this exact audited request.
 *
 * `AccountBillingClient.unblock` returns `blocked:true` when OTHER Account incidents remain: `unblocked:true` never
 * means the account is open, so the Video guard is only released when Account reports `blocked:false` AND Video has no
 * other unresolved row.
 *
 * Design: docs/specs/LV-019-B-bloqueos-y-cierres-diseno.md (v2, 2.4/2.5/2.8, 3.3, 3.4, 3.6)
 */
import {createHash} from 'node:crypto';
import {FieldValue,type DocumentReference,type DocumentSnapshot,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {ALERT_COLLECTION,alertIdentity} from './billingPendingAlerts';
import {hasInvalidGuardReference} from './billingPendingReport';
import {accountHoldId,legacyHoldId} from './billingHoldIdentity';
import type {AccountBillingClient} from './accountBillingClient';

/** Immutable Video records of one audited unblock; one document per (incident, action). */
export const UNBLOCK_AUDIT_COLLECTION='billingUnblockAudit';
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
export interface UnblockDeps{
  db:Firestore;root:DocumentReference;
  accountBilling:Pick<AccountBillingClient,'unblock'|'unblockReceipt'>;
}

type Clean={incidentKey:string;alertKey:string;epoch:number;createdAtMs:number;updatedAtMs:number;accountEpoch:number;accountCreatedAtMs:number;evidenceRef:string;note:string|null};
type PlannedRow={collection:string;id:string;state:string|null;reviewField?:string;to:string|null;toReviewField?:string|null;exitState?:string};
type AccountRow={accountId:string;state:string|null;reviewedAtMs:number|null};

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
 * The audited unblock. Phases: (A) prove the state and record `unblock_requested` in one transaction, (B) ask Account,
 * (C) re-read the same generation and release. A repeat resumes the pending phase; an identical, completed call is a
 * replay without writes; any different payload for the same incident is a conflict.
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
  const payload={incidentKey:clean.incidentKey,alertKey:clean.alertKey,epoch:clean.epoch,createdAtMs:clean.createdAtMs,updatedAtMs:clean.updatedAtMs,evidenceRef:clean.evidenceRef,note:clean.note,authorizedBy};

  const samePayload=(data:Record<string,unknown>|undefined)=>data?.accountId===accountId&&
    Object.entries(payload).every(([key,value])=>key==='authorizedBy'||data[key]===value);
  const sameOperator=(data:Record<string,unknown>|undefined)=>!!data&&data.authorizedBy===authorizedBy;

  // Phase 0 + 1: the read and the first immutable record share one transaction, so the audited state is the proven one.
  const opened=await db.runTransaction(async tx=>{
    const [guard,alert,requested,done,released]=await tx.getAll(guardRef,alertRef,requestedRef,doneRef,releasedRef);
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
        return {replayed:false as const,record:data!,partial:true as const,observed:{guard,requested,done}};
      }
      return {replayed:true as const,record:data!};
    }
    if(requested.exists){
      const data=requested.data() as Record<string,unknown>|undefined;
      if(!samePayload(data))throw new UnblockFault('conflict');
      if(authorizedBy!==data.authorizedBy)throw new UnblockFault('conflict');
      if(!sameGuard(guard,accountId,clean)||!sameOpenAlert(alert,accountId,clean))throw new UnblockFault('conflict');
      return {replayed:false as const,record:data!,resume:true as const,observed:{guard,requested,done}};
    }
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
    const auditId=unblockAuditId(clean.incidentKey,'unblock_requested',clean.epoch,clean.createdAtMs);
    tx.create(requestedRef,{auditId,action:'unblock_requested',...payload,kind:incident.kind,accountId,holdId:incident.holdId,
      accountEpoch:clean.accountEpoch,accountCreatedAtMs:clean.accountCreatedAtMs,
      planned:incident.planned,reviewedRivals:rivals,recordedAtMs:nowMs});
    return {replayed:false as const,record:{planned:incident.planned,kind:incident.kind,holdId:incident.holdId} as Record<string,unknown>,resume:false as const};
  });
  if(opened.replayed)return {unblocked:true,replayed:true,accountBlocked:Boolean(opened.record.accountBlocked),
    videoBlocked:'videoReleased' in opened?false:Boolean(opened.record.videoBlocked),
    advanced:Array.isArray(opened.record.advanced)?opened.record.advanced.map(String):[],auditId:String(opened.record.auditId)};

  const record=opened.record,planned=record.planned as PlannedRow[];
  const kind=String(record.kind) as 'intent'|'outbox',holdId=String(record.holdId);
  // A receipt lookup can outlive the Video authorization it started with. A
  // read-only recheck narrows this window; it cannot fence a later Account POST.
  async function recheck(tx:Transaction){
    const observed=opened.observed;
    if(!observed)throw new UnblockFault('conflict');
    const [guard,alert,requested,done,released]=await tx.getAll(guardRef,alertRef,requestedRef,doneRef,releasedRef);
    const requestData=requested.data();
    if(!sameGuard(guard,accountId,clean)||!sameOpenAlert(alert,accountId,clean))throw new UnblockFault('conflict');
    const guardKind=guard.get('lastIncidentId')===clean.incidentKey?'intent':'outbox';
    if(!samePayload(requestData)||!sameOperator(requestData)||requestData?.auditId!==requestedRef.id||
      requestData.action!=='unblock_requested'||requestData.kind!==guardKind||kind!==guardKind||
      requestData.holdId!==holdId||holdId!==videoHoldId(guardKind,clean.incidentKey,clean.epoch,clean.createdAtMs)||
      !sameVersion(observed.guard,guard)||!sameVersion(observed.requested,requested)||released.exists||
      (observed.done.exists?!sameVersion(observed.done,done):done.exists))throw new UnblockFault('conflict');
  }

  let accepted={epoch:clean.accountEpoch,createdAtMs:clean.accountCreatedAtMs};
  let account:{replayed:boolean;blocked:boolean};
  const identityKey=await accountPhase(()=>identityKeyOf(root,accountId));
  const needsReceipt='partial' in opened||opened.resume;
  const receipt=needsReceipt?await accountPhase(()=>deps.accountBilling.unblockReceipt(identityKey,holdId,clean.evidenceRef)):null;
  if(receipt?.state==='confirmed'){
    accepted={epoch:receipt.epoch,createdAtMs:receipt.createdAtMs};
    account={replayed:true,blocked:receipt.blocked};
  }else{
    if('partial' in opened||needsReceipt&&receipt?.state!=='pending')throw new UnblockFault('conflict');
    if(needsReceipt)await db.runTransaction(recheck);
    account=await accountPhase(()=>deps.accountBilling.unblock(identityKey,{incidentId:holdId,...accepted,reviewRef:clean.evidenceRef}));
  }

  // These rows have already advanced. A matching receipt and the absence of other incidents permit just the release.
  if('partial' in opened){
    if(record.accountEpoch!==accepted.epoch||record.accountCreatedAtMs!==accepted.createdAtMs)throw new UnblockFault('conflict');
    return db.runTransaction(async tx=>{
      await recheck(tx);
      if(account.blocked)return {unblocked:true as const,replayed:true as const,accountBlocked:true,videoBlocked:true,
        advanced:Array.isArray(record.advanced)?record.advanced.map(String):[],auditId:String(record.auditId)};
      // The incident's rows were advanced by the first call; only a RIVAL row keeps the guard, and then nothing is written.
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

  // Phase 3: only after Account confirmed, re-read the SAME generation and advance exactly the audited rows.
  return db.runTransaction(async tx=>{
    // Every read of this transaction happens before its first write: the guard generation, the alert, the audited rows
    // and, for an intent, the state its exit depends on.
    const [guard,alert]=await tx.getAll(guardRef,alertRef);
    if(!sameGuard(guard,accountId,clean)||!sameOpenAlert(alert,accountId,clean))throw new UnblockFault('conflict');
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
      if(holdSettled&&data.state==='applied')continue;
      if(row.reviewField&&data[row.reviewField]!==clean.incidentKey)throw new UnblockFault('conflict');
      // A row handed to another account between phases must not be advanced: only the admission guard has no `accountId`.
      if(row.collection!=='billingIntentAdmissionGuards'&&data.accountId!==accountId)throw new UnblockFault('conflict');
      if(row.collection==='billingIntents'){
        const [intent,witness]=await tx.getAll(snap.ref,root.collection('billingIntentWitnesses').doc(row.id));
        rows.push({planned:row,snap,exit:intentExit(intent,witness)});
      }else rows.push({planned:row,snap});
    }
    // Account says whether OTHER Account incidents remain; Video checks its own side again, because an incident could have
    // landed after the audited read. Either one keeps the guard blocked: `unblocked:true` never means the account is open.
    const rivals=unresolvedRows(await accountRows(tx,root,accountId),new Set(rows.map(row=>row.planned.collection+'/'+row.planned.id)));
    const clear=!account.blocked&&rivals.length===0;
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
    tx.create(doneRef,{auditId,action:'unblocked',...payload,kind,accountId,holdId,advanced,accountBlocked:account.blocked,videoBlocked:!clear,videoRivals:rivals,accountReplayed:account.replayed,accountEpoch:accepted.epoch,accountCreatedAtMs:accepted.createdAtMs,recordedAtMs:nowMs});
    return {unblocked:true as const,replayed:false as const,accountBlocked:account.blocked,videoBlocked:!clear,advanced,auditId};
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
