// LV-019.B fenced unblock seam: isolated Firestore Emulator prototype (node:test, not vitest).
// Contract: backend.ts runFencedUnblock / fenced_v1, docs/specs/LV-019-B-bloqueos-y-cierres-diseno.md.
// Real AccountStore against the fixed loopback emulator. Fictional data only.
// The anchor and grant are SEEDED here to stand in for a protected, previously authorized enrollment:
// they emulate prior authorization and do NOT prove that real authority exists.
// Every fixture is deleted in the finally cleanup.
import assert from 'node:assert/strict';
import {prepareFinancialOwnedRoot,deleteFinancialOwnedRoot} from '../commercial/financialOwnedRootGuard.mjs';
import {test,before,afterEach} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {AccountStore} from './backend.ts';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8198')throw Error('Dedicated loopback emulator required, no fallback');
if(process.env.NODE_ENV!=='test')throw Error('NODE_ENV=test required: the fenced unblock seam is closed outside tests');
const fixtures=[];
before(async()=>{assert.equal((await fetch('http://127.0.0.1:8198/')).status,200);});
afterEach(async()=>{for(const f of fixtures.splice(0))try{await deleteFinancialOwnedRoot(f.db,f.root,f.marker);}finally{await f.db.terminate();await deleteApp(f.app);}});
const hash=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex64=(value)=>createHash('sha256').update(String(value)).digest('hex');
// Real emulator createTime/updateTime versions, in the exact '<seconds>:<nanoseconds>' shape the runtime pins.
const stampVersion=(doc,field)=>{const s=doc[field];return s&&Number.isSafeInteger(s.seconds)&&Number.isSafeInteger(s.nanoseconds)&&s.nanoseconds<1_000_000_000?s.seconds+':'+s.nanoseconds:null;};
const reject=(promise,code)=>assert.rejects(promise,error=>error.code===code,'expected '+code);
const dataOf=async(ref)=>{const snap=await ref.get();return snap.exists?snap.data():undefined;};
// Injectable clock: the guard `createdAtMs` is the discriminator a stale unblock must miss.
async function fixture(){
 const app=initializeApp({projectId:'demo-vistavo-financial'},'unblock-'+randomUUID());
 const db=getFirestore(app);
 const root=db.collection('vistavo_account_test').doc(randomUUID());
 const f={app,db,root,time:1_800_000_000_000,marker:{project:'demo-vistavo-financial',purpose:'account-unblock-synthetic',nonce:randomUUID()}};
 f.store=new AccountStore(db,root,()=>f.time);
 fixtures.push(f);
 await prepareFinancialOwnedRoot(db,root,f.marker);
 return f;
}
const guardRef=(f,accountId)=>f.root.collection('videoBillingGuards').doc(accountId);
const incidentRef=(f,accountId,incidentId)=>f.root.collection('videoBillingIncidents').doc(hash([accountId,incidentId]));
const anchorRef=(f,accountId,incidentId)=>f.root.collection('videoBillingUnblockAttempts').doc(hash([accountId,incidentId]));
const unblockRef=(f,accountId,incidentId)=>f.root.collection('videoBillingUnblocks').doc(hash([accountId,incidentId,'unblock']));
const grantRef=(f,accountId,incidentId,reconcileId)=>f.root.collection('videoBillingUnblockReconciliationGrants').doc(hash([accountId,incidentId,reconcileId]));
// Data-only root snapshot (no updateTime) so a replay can be proven to write nothing without time-variable noise.
async function signature(f){
 const rows=[];
 for(const name of ['accounts','videoBillingGuards','videoBillingIncidents','videoBillingUnblocks','videoBillingUnblockAttempts','videoBillingUnblockReconciliationGrants']){
  const snap=await f.root.collection(name).get();
  for(const doc of snap.docs)rows.push([doc.ref.path,JSON.stringify(doc.data()),stampVersion(doc,'updateTime')]);
 }
 return rows.sort((a,b)=>a[0]<b[0]?-1:1);
}
const credited=20,reserved=3,available=17;
// Fictional balance booked through the real reserveVideo path; guard + active incident; seeded anchor/grant.
async function seedAccount(f,label,{fence=true}={}){
 const uid='synthetic-fence-'+label;
 const boot=await f.store.bootstrap(uid);
 const accountId=boot.account.id,identityKey=AccountStore.identityKey(uid),incidentId=hex64('incident:'+label);
 const account=f.root.collection('accounts').doc(accountId);
 await account.update({credited,available:credited});
 // One real reservation of 3 seconds through the production method, before any block exists.
 const reservationId=randomUUID();
 await f.store.reserveVideo(identityKey,reservationId,reserved);
 const reservation=f.root.collection('videoReservations').doc(hash([accountId,reservationId]));
 const booked=await dataOf(account);
 assert.equal(booked.credited,credited);
 assert.equal(booked.available,available);
 assert.equal(booked.reserved,reserved);
 assert.equal(booked.consumed,0);
 assert.equal(booked.active,1);
 const held=await dataOf(reservation);
 assert.ok(held,'real reservation document required');
 assert.equal(held.ownerAccountId,accountId);
 assert.equal(held.state,'reserved');
 assert.equal(held.seconds,reserved);
 const ledgerRows=(await f.root.collection('ledgerEntries').where('ownerAccountId','==',accountId).get()).docs;
 assert.ok(ledgerRows.length>=1,'the real reservation books at least one ledger row');
 const epoch=1,createdAtMs=5,incidentCount=1,reviewRef='synthetic-evidence-'+label;
 const guard=guardRef(f,accountId),incident=incidentRef(f,accountId,incidentId),anchor=anchorRef(f,accountId,incidentId);
 await guard.set({ownerAccountId:accountId,identityKey,incidentId,blocked:true,incidentCount,epoch,createdAtMs,updatedAtMs:createdAtMs});
 await incident.set({ownerAccountId:accountId,identityKey,incidentId,unblockProtocol:'fenced_v1',state:'active',createdAtMs});
 const identityVersion=stampVersion(await f.root.collection('identities').doc(identityKey).get(),'updateTime');
 const incidentVersion=stampVersion(await incident.get(),'createTime');
 const guardVersion=stampVersion(await guard.get(),'createTime');
 assert.ok(identityVersion&&incidentVersion&&guardVersion,'real Firestore versions required');
 const authorizationSha256=hash(['operator-decision',label]);
 const original={ownerAccountId:accountId,identityKey,incidentId,unblockProtocol:'fenced_v1',createdAtMs,reviewRef,authorizationSha256,identityVersion,incidentVersion,guardVersion};
 const attemptId=randomUUID(),successorAttemptId=randomUUID(),reconcileId=randomUUID();
 // Seeded only in test: stand-in for a protected, previously authorized enrollment (contract shape).
 await anchor.set({...original,initialAttemptId:attemptId,initialEpoch:epoch});
 if(fence)await grantRef(f,accountId,incidentId,reconcileId).set({...original,previousAttemptId:attemptId,previousEpoch:epoch,reconcileId,attemptId:successorAttemptId,epoch});
 const initial={incidentId,attemptId,epoch,createdAtMs,reviewRef,authorizationSha256};
 const successor={...initial,attemptId:successorAttemptId};
 const change={...successor,previousAttemptId:attemptId,previousEpoch:epoch,reconcileId};
 return {uid,accountId,identityKey,incidentId,epoch,createdAtMs,reviewRef,authorizationSha256,original,attemptId,successorAttemptId,reconcileId,initial,successor,change,guard,incident,anchor,reservation};
}
async function economicState(f,a,b){
 const ledgerRows=async(accountId)=>(await f.root.collection('ledgerEntries').where('ownerAccountId','==',accountId).get()).docs
  .map(doc=>[doc.ref.path,doc.data()]).sort((x,y)=>x[0]<y[0]?-1:1);
 return {
  account:await dataOf(f.root.collection('accounts').doc(a.accountId)),
  reservation:await dataOf(a.reservation),
  ledger:await ledgerRows(a.accountId),
  rivalAccount:await dataOf(f.root.collection('accounts').doc(b.accountId)),
  rivalReservation:await dataOf(b.reservation),
  rivalLedger:await ledgerRows(b.accountId),
  rivalGuard:await dataOf(b.guard),
  rivalIncident:await dataOf(b.incident),
  rivalAnchor:await dataOf(b.anchor),
  rivalGrant:await dataOf(grantRef(f,b.accountId,b.incidentId,b.reconcileId)),
 };
}
const receiptsOf=async(f)=>f.root.collection('videoBillingUnblocks').get();

test('Fenced predecessor before reconciliation',async()=>{
 const f=await fixture();
 const a=await seedAccount(f,'a'),b=await seedAccount(f,'b');
 const money=await economicState(f,a,b);
 assert.equal((await dataOf(f.root.collection('accounts').doc(a.accountId))).available,available);
 assert.equal((await dataOf(a.reservation)).seconds,reserved);
 const incidentBefore=await a.incident.get();
 // The predecessor commit succeeds, but the already-resolved result is discarded (lost ACK).
 const discarded=await f.store.confirmFencedVideoBillingUnblockAttempt(a.identityKey,a.initial);
 assert.equal(discarded.state,'confirmed');
 assert.equal(discarded.replayed,false);
 assert.equal(discarded.blocked,false);
 // The incident mark is versioned by createTime; the confirming update only advances updateTime.
 const incidentAfter=await a.incident.get();
 assert.equal(stampVersion(incidentAfter,'createTime'),stampVersion(incidentBefore,'createTime'));
 assert.notEqual(stampVersion(incidentAfter,'updateTime'),stampVersion(incidentBefore,'updateTime'));
 assert.equal(a.original.incidentVersion,stampVersion(incidentAfter,'createTime'));
 const anchor=await dataOf(a.anchor);
 assert.equal(anchor.reconcileId,undefined);
 assert.equal(anchor.successorAttemptId,undefined);
 assert.equal((await receiptsOf(f)).size,1);
 // Reconciliation recovers the stored receipt and writes nothing: no successor, no duplicate.
 const noop=await signature(f);
 const recovered=await f.store.reconcileVideoBillingUnblockAttempt(a.identityKey,a.change);
 assert.equal(recovered.state,'confirmed');
 assert.equal(recovered.attemptId,a.attemptId);
 assert.equal(recovered.replayed,true);
 assert.equal(recovered.blocked,false);
 assert.deepEqual(await signature(f),noop);
 assert.equal((await receiptsOf(f)).size,1);
 assert.equal((await dataOf(a.anchor)).reconcileId,undefined);
 const receipt=await dataOf(unblockRef(f,a.accountId,a.incidentId));
 assert.equal(receipt.attemptId,a.attemptId);
 assert.equal(receipt.unblockedAtMs,f.time);
 const incident=await dataOf(a.incident);
 assert.equal(incident.state,'reviewed');
 assert.equal(incident.unblockAttemptId,a.attemptId);
 assert.deepEqual(await economicState(f,a,b),money);
});

test('Fenced reconciliation before late predecessor',async()=>{
 const f=await fixture();
 const a=await seedAccount(f,'a'),b=await seedAccount(f,'b');
 const money=await economicState(f,a,b);
 // First reconciliation commits the fence but the caller discards the resolved response (lost ACK).
 const first=await f.store.reconcileVideoBillingUnblockAttempt(a.identityKey,a.change);
 assert.equal(first.state,'permitted');
 assert.equal(first.attemptId,a.successorAttemptId);
 assert.equal(first.reconcileId,a.reconcileId);
 assert.equal(first.replayed,false);
 // Repeating the same reconciliation is idempotent and never re-fences.
 const again=await f.store.reconcileVideoBillingUnblockAttempt(a.identityKey,a.change);
 assert.equal(again.state,'permitted');
 assert.equal(again.attemptId,a.successorAttemptId);
 assert.equal(again.replayed,true);
 const anchor=await dataOf(a.anchor);
 assert.equal(anchor.successorAttemptId,a.successorAttemptId);
 assert.equal(anchor.reconcileId,a.reconcileId);
 assert.equal((await receiptsOf(f)).size,0);
 // A late predecessor confirm is rejected.
 await reject(f.store.confirmFencedVideoBillingUnblockAttempt(a.identityKey,a.initial),'conflict');
 // The successor is confirmed exactly once.
 const confirmed=await f.store.confirmFencedVideoBillingUnblockAttempt(a.identityKey,a.successor);
 assert.equal(confirmed.state,'confirmed');
 assert.equal(confirmed.attemptId,a.successorAttemptId);
 assert.equal(confirmed.replayed,false);
 assert.equal(confirmed.blocked,false);
 const receipts=await receiptsOf(f);
 assert.equal(receipts.size,1);
 assert.equal(receipts.docs[0].data().attemptId,a.successorAttemptId);
 // Replays write nothing.
 const noop=await signature(f);
 const replay=await f.store.confirmFencedVideoBillingUnblockAttempt(a.identityKey,a.successor);
 assert.equal(replay.state,'confirmed');
 assert.equal(replay.replayed,true);
 const settled=await f.store.reconcileVideoBillingUnblockAttempt(a.identityKey,a.change);
 assert.equal(settled.state,'confirmed');
 assert.equal(settled.attemptId,a.successorAttemptId);
 assert.equal(settled.replayed,true);
 assert.deepEqual(await signature(f),noop);
 assert.equal((await receiptsOf(f)).size,1);
 // The predecessor stays rejected after the fence settles.
 await reject(f.store.confirmFencedVideoBillingUnblockAttempt(a.identityKey,a.initial),'conflict');
 assert.deepEqual(await economicState(f,a,b),money);
});

test('Fenced simultaneous predecessor and reconciliation',async()=>{
 const f=await fixture();
 const a=await seedAccount(f,'a'),b=await seedAccount(f,'b');
 const money=await economicState(f,a,b);
 // No assumed order: accept whichever serialized outcome the emulator commits.
 const settled=await Promise.allSettled([
  f.store.confirmFencedVideoBillingUnblockAttempt(a.identityKey,a.initial),
  f.store.reconcileVideoBillingUnblockAttempt(a.identityKey,a.change),
 ]);
 const [confirmJob,reconcileJob]=settled;
 for(const job of settled)if(job.status==='rejected')assert.equal(job.reason.code,'conflict','only conflict may reject');
 if(confirmJob.status==='fulfilled'){
  assert.equal(confirmJob.value.state,'confirmed');
  assert.equal(confirmJob.value.attemptId,a.attemptId);
  assert.equal(confirmJob.value.replayed,false);
 }
 if(reconcileJob.status==='fulfilled'){
  const v=reconcileJob.value;
  const valid=(v.state==='permitted'&&v.attemptId===a.successorAttemptId&&v.replayed===false)||
              (v.state==='confirmed'&&v.attemptId===a.attemptId&&v.replayed===true);
  assert.ok(valid,'reconciliation must serialize to exactly one valid outcome');
 }
 const receipts=await receiptsOf(f);
 assert.ok(receipts.size<=1,'never two receipts');
 const fenced=(await dataOf(a.anchor)).reconcileId!==undefined;
 // Exactly one movement: either the predecessor receipt (anchor unfenced) or the fence (no receipt).
 assert.notEqual(receipts.size===1,fenced,'a receipt may never coexist with a fence');
 if(receipts.size===1){
  assert.equal(receipts.docs[0].data().attemptId,a.attemptId);
  assert.equal((await dataOf(a.incident)).state,'reviewed');
  assert.equal(await dataOf(a.guard),undefined);
 }else{
  assert.equal(fenced,true);
  assert.equal((await dataOf(a.incident)).state,'active');
  assert.equal((await dataOf(a.guard)).blocked,true);
 }
 assert.deepEqual(await economicState(f,a,b),money);
});
