import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { AccountFault,AccountStore } from '../account/backend';
import { terminalDocumentVersion } from './billingPendingReport';
import type { FirestoreBackend } from './firestoreBackend';
import type { FirestoreReviewedTranslation, ReviewedTranslationPrincipal } from './firestoreReviewedTranslation';
import { isLocalVoiceC2FixtureTarget, isMarkedLocalVoiceRoot } from './localVoiceFixture';
import { createReviewedVoiceFragmentMemoryBridge, type SyntheticFragmentCall } from './reviewedVoiceFragment.memory';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const fragment='voice-chunk:0000';
type AccountRead=NonNullable<Awaited<ReturnType<typeof accountReservationInTransaction>>>;

export function localVoiceC2AccountRoot(root:DocumentReference) {
  return root.collection('syntheticAccountStores').doc(root.id);
}

async function accountReservationInTransaction(tx:Transaction,root:DocumentReference,uid:string,identityKey:string,reservationId:string) {
  if(AccountStore.identityKey(uid)!==identityKey)return null;
  const identity=await tx.get(root.collection('identities').doc(identityKey));
  const ownerAccountId=identity.get('accountId');
  if(identity.get('uid')!==uid||typeof ownerAccountId!=='string'||!uuid.test(ownerAccountId))return null;
  const id=hash([ownerAccountId,reservationId]);
  const [account,reservation,tomb,guard]=await tx.getAll(root.collection('accounts').doc(ownerAccountId),
    root.collection('videoReservations').doc(id),root.collection('videoReservationTombstones').doc(id),
    root.collection('videoBillingGuards').doc(ownerAccountId));
  if(account.get('identityKey')!==identityKey||account.get('schemaVersion')!==1||account.get('unit')!=='video_seconds'||
    reservation.get('ownerAccountId')!==ownerAccountId||reservation.get('identityKey')!==identityKey||
    reservation.get('reservationId')!==reservationId||reservation.get('admissionProtocol')!==2||
    tomb.exists||guard.exists)return null;
  return {ownerAccountId,identity,account,reservation,guard};
}

function accountHistory(root:DocumentSnapshot,current:AccountRead) {
  return {ownerAccountId:current.ownerAccountId,root:terminalDocumentVersion(root),
    identity:terminalDocumentVersion(current.identity),account:terminalDocumentVersion(current.account),
    guard:terminalDocumentVersion(current.guard),reservationCreated:terminalDocumentVersion(current.reservation)};
}

async function admissionDocuments(tx:Transaction,reservation:DocumentSnapshot) {
  const ref=reservation.ref;
  return tx.getAll(ref.collection('providerCalls').doc(hash(['provider-call-v2',fragment])),
    ref.collection('providerCallFences').doc('first'));
}

async function admissionMatches(tx:Transaction,reservation:DocumentSnapshot,ownerAccountId:string,identityKey:string,call:SyntheticFragmentCall) {
  if(call.callKey!==fragment)return false;
  const expected={admissionProtocol:2,ownerAccountId,identityKey,...call};
  const [receipt,fence]=await admissionDocuments(tx,reservation);
  const admittedAtMs=receipt.get('admittedAtMs');
  const first={jobId:call.jobId,attemptId:call.attemptId,firstCallKey:call.callKey,firstModel:call.model,
    firstRequestSha256:call.requestSha256,admittedAtMs};
  return Number.isSafeInteger(admittedAtMs)&&admittedAtMs>=0&&receipt.createTime?.isEqual(reservation.updateTime!)&&
    fence.createTime?.isEqual(receipt.createTime)&&receipt.updateTime?.isEqual(receipt.createTime)&&fence.updateTime?.isEqual(fence.createTime)&&
    isDeepStrictEqual(receipt.data(),{...expected,admittedAtMs})&&isDeepStrictEqual(fence.data(),receipt.data())&&
    isDeepStrictEqual(reservation.get('providerAdmission'),first);
}

/**
 * The trusted fixture uses one AccountStore at the path derived from its
 * marked Video root. The local ticket exists only if this harness observed the
 * fresh reserve from that store and C1 committed its job. Prior or copied C1
 * evidence cannot create a ticket. Both roots use the same emulator client.
 */
export function createReviewedVoiceFragmentLocalFixture(root:DocumentReference,backend:FirestoreBackend,service:FirestoreReviewedTranslation) {
  const db=root.firestore,accountRoot=localVoiceC2AccountRoot(root);
  const enabled=()=>isLocalVoiceC2FixtureTarget(db,root)&&backend.usesLocalVoiceFragmentFixture(root,service);
  const tickets=new Map<string,{uid:string;identityKey:string;reservationId:string;seconds:number;history:ReturnType<typeof accountHistory>}>();

  async function reserve(principal:ReviewedTranslationPrincipal,inputId:string,revision:number,requestKey:string,operation:string) {
    if(!enabled())throw Error('synthetic_voice_c2_disabled');
    const caller=Object.freeze({accountId:principal.accountId,uid:principal.uid});
    const marked=await root.get();
    if(!isMarkedLocalVoiceRoot(marked)||!enabled())throw Error('synthetic_voice_c2_disabled');
    const store=new AccountStore(db,accountRoot);
    let ticket:Parameters<typeof tickets.set>[1]|undefined;
    const jobId=await backend.reserveReviewedVoiceLocally(service,async(identityKey,reservationId,seconds)=>{
      if(!enabled()||identityKey!==AccountStore.identityKey(caller.uid))throw Error('synthetic_voice_c2_disabled');
      let reply;
      try{reply=await store.reserveVideo(identityKey,reservationId,seconds);}
      catch(error){
        if(error instanceof AccountFault&&error.code==='insufficient')return {state:'insufficient'};
        throw error;
      }
      if(!reply.created||reply.state!=='reserved'||reply.seconds!==seconds)throw Error('synthetic_voice_c2_unverified_reservation');
      const history=await db.runTransaction(async tx=>{
        const mark=await tx.get(root),current=await accountReservationInTransaction(tx,accountRoot,caller.uid,identityKey,reservationId);
        if(!isMarkedLocalVoiceRoot(mark)||!isDeepStrictEqual(terminalDocumentVersion(mark),terminalDocumentVersion(marked))||
          !current||current.reservation.get('state')!=='reserved'||current.reservation.get('seconds')!==seconds||
          current.reservation.get('providerAdmission')!==undefined)return null;
        const snapshot=accountHistory(mark,current);
        return snapshot.identity?.exists&&snapshot.account?.exists&&snapshot.guard&&snapshot.reservationCreated?.exists?snapshot:null;
      },{readOnly:true});
      if(!history)throw Error('synthetic_voice_c2_unverified_reservation');
      ticket={uid:caller.uid,identityKey,reservationId,seconds,history};
      return {reservationId,seconds,state:'reserved'};
    },caller,inputId,revision,requestKey,operation);
    if(ticket)tickets.set(jobId,ticket);
    return jobId;
  }

  function receiver() {
    const store=new AccountStore(db,accountRoot);
    return createReviewedVoiceFragmentMemoryBridge({
      async readVerifiedC1(request,admitted) {
        if(!enabled())return null;
        const ticket=tickets.get(request.jobId);
        if(!ticket||ticket.uid!==request.principal.uid)return null;
        return db.runTransaction(async tx=>{
          const mark=await tx.get(root);
          if(!enabled()||!isMarkedLocalVoiceRoot(mark))return null;
          const source=await backend.readLocalVoiceFragmentSource(tx,root,service,request.principal,request.jobId,request.operation);
          if(!source||source.identityKey!==ticket.identityKey||source.reservationId!==ticket.reservationId||source.seconds!==ticket.seconds)return null;
          const voice=await accountReservationInTransaction(tx,accountRoot,ticket.uid,ticket.identityKey,ticket.reservationId);
          const text=await accountReservationInTransaction(tx,accountRoot,ticket.uid,ticket.identityKey,source.textBilling.reservationId);
          if(!voice||!text||text.ownerAccountId!==voice.ownerAccountId||text.reservation.get('state')!=='captured'||
            text.reservation.get('seconds')!==source.textBilling.seconds||
            voice.reservation.get('state')!=='reserved'||voice.reservation.get('seconds')!==ticket.seconds)return null;
          const history=accountHistory(mark,voice);
          const {reservationCreated:original,...originalOwner}=ticket.history,{reservationCreated:current,...currentOwner}=history;
          if(!isDeepStrictEqual(originalOwner,currentOwner)||!original?.exists||!current?.exists||original.createTime!==current.createTime)return null;
          if(admitted){
            if(admitted.jobId!==source.jobId||admitted.reservationId!==source.reservationId||admitted.seconds!==source.seconds||
              !await admissionMatches(tx,voice.reservation,voice.ownerAccountId,ticket.identityKey,admitted))return null;
          }else if(!isDeepStrictEqual(original,current)||voice.reservation.get('providerAdmission')!==undefined||
            (await admissionDocuments(tx,voice.reservation)).some(doc=>doc.exists))return null;
          const textVersion=terminalDocumentVersion(text.reservation);
          if(!textVersion?.exists)return null;
          const provenanceSha256=hash([source.videoHistorySha256,originalOwner,textVersion]);
          return {...source,provenanceSha256};
        },{readOnly:true});
      },
      async admitForTest(identityKey,call) {
        if(!enabled())return undefined;
        const {reservationId,seconds,jobId,attemptId,callKey,model,requestSha256}=call;
        return store.admitVideoCall(identityKey,reservationId,seconds,jobId,attemptId,callKey,model,requestSha256);
      },
    });
  }

  return {reserve,receiver};
}
