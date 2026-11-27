// Opt-in characterization for LV-019.B. RED cases express requirements whose proof is missing.
// Uses production methods with two independent in-memory stores. No SDK, emulator or transport.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { AccountStore } from '../account/backend.ts';
import { FirestoreBackend, EXTERNAL_BILLING_MAX_AGE_MS } from './firestoreBackend.ts';
import { stub } from './billingFirestoreStub.ts';
import { ALERT_COLLECTION, alertKey, raisePendingAlerts } from './billingPendingAlerts.ts';
import { readPendingReport } from './billingPendingReport.ts';
import { privateBucket } from './privateObjectPlan.ts';
import { videoReservationId } from './videoReservationId.ts';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const duration = 3;
const operation = 'translation:en';

function fixture() {
  const video = stub(), account = stub();
  // The real financial-guard writer uses merge-set and the snapshot's reference.
  // Stage creation/merge through the existing stub transaction, including rollback.
  const videoDb={runTransaction:work=>video.db.runTransaction(tx=>{
    const read=async ref=>({...await tx.get(ref),ref});
    return work({...tx,get:read,getAll:(...refs)=>Promise.all(refs.map(read)),
      set(ref,data,options){
        if (!video.store.has(ref.path)) return tx.create(ref,data);
        assert.equal(options?.merge,true,'the fixture only supports merge on an existing document');
        return tx.update(ref,data);
      },
    });
  })};
  const backend = new FirestoreBackend(videoDb, video.root);
  // Account's settlement transaction reads a fence under the reservation document.
  // Resolve nested references to paths in the Account store, independent of Video.
  function accountCollection(name) {
    return {doc(id) {
      const ref = account.root.collection(name).doc(id);
      return {...ref, collection:child => accountCollection(ref.path + '/' + child)};
    }};
  }
  const store = new AccountStore(account.db, {collection:accountCollection});
  function person() {
    const uid = 'synthetic-' + randomUUID(), identityKey = AccountStore.identityKey(uid);
    const videoId = randomUUID(), accountId = randomUUID(), inputId = randomUUID();
    const fields = {credited:20, available:20, consumed:0, reserved:0, active:0};
    const sha256 = hash(['synthetic input', inputId]);
    video.store.set('identities/' + identityKey, {uid, accountId:videoId});
    video.store.set('accounts/' + videoId, {...fields, simulationOnly:true, aiPilot:true});
    video.store.set('projects/' + inputId, {accountId:videoId, inputId, revision:1});
    video.store.set('inputs/' + inputId, {
      accountId:videoId, expiresAtMs:Date.now() + 4 * EXTERNAL_BILLING_MAX_AGE_MS,
      sha256, deleted:false, ready:true, unknownCount:0, metadata:{duration, audioTracks:1},
      storage:{bucket:privateBucket, key:`candidate-files-v1/${inputId}/video.mp4`, generation:'1', size:100, sha256},
    });
    account.store.set('identities/' + identityKey, {uid, accountId});
    account.store.set('accounts/' + accountId, {...fields, identityKey, schemaVersion:1,
      unit:'video_seconds', activeProjectCount:0, createdAtMs:1});
    return {uid, identityKey, videoId, accountId, inputId};
  }

  async function begin(owner, key = randomUUID()) {
    const reservationId = videoReservationId(owner.videoId, owner.identityKey, owner.inputId, operation, 1, key);
    const billing = {provider:'account_seconds', identityKey:owner.identityKey, reservationId, seconds:duration};
    await backend.beginExternalBillingIntent(owner.videoId, owner.inputId, key, operation, 1, billing);
    return {billing, key, intentPath:'billingIntents/' + hash([owner.videoId, key])};
  }

  async function overdue(owner) {
    const pending = await begin(owner);
    const reserved = await store.reserveVideo(owner.identityKey, pending.billing.reservationId, duration);
    assert.equal(reserved.created, true);
    assert.equal(reserved.account.id, owner.accountId);
    const fenced = await backend.claimExternalBillingRelease(owner.videoId, pending.key, pending.billing);
    assert.deepEqual(fenced, {state:'release_pending', transitioned:true});
    const created = video.store.get(pending.intentPath).createdAtMs;
    const sweep = await backend.escalateStaleBillingRows({now:created + EXTERNAL_BILLING_MAX_AGE_MS + 1, limit:15});
    assert.equal(sweep.failed, 0);
    assert.equal(sweep.escalated, 1);
    assert.equal(video.store.get(pending.intentPath).reviewReason, 'max_age');
    return pending;
  }
  const genericJob = (owner, key = randomUUID()) =>
    backend.reserveForUid(owner.videoId, owner.inputId, key, 2, 'fixture-operation', 1, owner.uid);
  return {video, account, backend, store, a:person(), b:person(), begin, overdue, genericJob};
}

test('review characterization: an observation alone currently allows new synthetic work for A and B', async () => {
  const f=fixture(),aged=await f.overdue(f.a);
  const a=await f.begin(f.a),b=await f.begin(f.b);
  assert.equal(f.video.store.get(a.intentPath).state,'reserve_pending');
  assert.equal(f.video.store.get(b.intentPath).state,'reserve_pending');
  const jobA=await f.genericJob(f.a),jobB=await f.genericJob(f.b);
  assert.equal(f.video.store.get('jobs/'+jobA).accountId,f.a.videoId);
  assert.equal(f.video.store.get('jobs/'+jobB).accountId,f.b.videoId);
  assert.ok(f.video.store.get(aged.intentPath).ageObservationId);
  assert.equal([...f.video.store.keys()].some(path=>path.startsWith('billingGuards/')),false);
});

test('review compatibility: age observation does not enter the origin witness or prevent release preparation after a synthetic reopen', async () => {
  const f=fixture(),p=await f.begin(f.a);
  const before=await f.backend.externalIntentWitness(f.a.videoId,p.key,p.billing);
  assert.equal((await f.store.reserveVideo(f.a.identityKey,p.billing.reservationId,duration)).created,true);
  assert.equal((await f.backend.claimExternalBillingRelease(f.a.videoId,p.key,p.billing)).transitioned,true);
  const created=f.video.store.get(p.intentPath).createdAtMs;
  assert.equal((await f.backend.escalateStaleBillingRows({now:created+EXTERNAL_BILLING_MAX_AGE_MS+1,limit:15})).escalated,1);
  const during=await f.backend.externalIntentWitness(f.a.videoId,p.key,p.billing);
  assert.deepEqual(during,before);assert.equal(Object.hasOwn(during,'ageObservationId'),false);
  // This privileged synthetic perturbation exercises compatibility, not a legal or authorized reopening.
  f.video.store.set(p.intentPath,{...f.video.store.get(p.intentPath),state:'release_pending'});
  const reopened=await f.backend.externalIntentWitness(f.a.videoId,p.key,p.billing);
  assert.deepEqual(reopened,before);
  assert.deepEqual(await f.backend.prepareExternalIntentTerminal(reopened,p.key,'release'),{state:'ready'});
});

test('RED: overdue A denies a new external reserve intent while B can still open one', async () => {
  const f = fixture();
  await f.overdue(f.a);
  const b = await f.begin(f.b);
  assert.equal(f.video.store.get(b.intentPath).state, 'reserve_pending');
  await assert.rejects(() => f.begin(f.a), {code:'conflict'});
});

test('RED: overdue A denies a new job commit, preserving prior authorized replay and B', async () => {
  const f = fixture(), key = randomUUID();
  const prior = await f.genericJob(f.a, key);
  await f.overdue(f.a);
  assert.equal(await f.genericJob(f.a, key), prior);
  const jobB = await f.genericJob(f.b);
  assert.equal(f.video.store.get('jobs/' + jobB).accountId, f.b.videoId);
  await assert.rejects(() => f.genericJob(f.a), {code:'conflict'});
});

test('ownership proof limit: Account status and resolution cannot distinguish stable A from A to B to A', async () => {
  const f = fixture(), pending = await f.overdue(f.a);
  const id = pending.billing.reservationId;
  const read = async () => [
    await f.store.videoReservation(f.a.identityKey, id),
    await f.store.videoReservationResolution(f.a.identityKey, id, duration),
  ];
  const original = await read();
  const path = 'identities/' + f.a.identityKey;
  const authorized = structuredClone(f.account.store.get(path));
  const videoBefore = structuredClone(f.video.store);
  f.account.store.set(path, {...authorized, accountId:f.b.accountId});
  await assert.rejects(() => f.store.videoReservation(f.a.identityKey, id), {code:'not_found'});
  await assert.rejects(() => f.store.videoReservationResolution(f.a.identityKey, id, duration), {code:'invariant'});
  f.account.store.set(path, authorized);
  assert.deepEqual(await read(), original);
  assert.deepEqual(f.video.store, videoBefore);
});

test('an observed Account response cannot attest a later Video commit after revocation', async () => {
  const f = fixture(), pending = await f.overdue(f.a);
  const id = pending.billing.reservationId;
  const before = await f.store.videoReservationResolution(f.a.identityKey, id, duration);
  f.account.store.delete('identities/' + f.a.identityKey);
  assert.deepEqual(before, {reservationId:id, seconds:duration, state:'reserved'});
  await assert.rejects(() => f.store.videoReservationResolution(f.a.identityKey, id, duration), {code:'account_not_provisioned'});
  assert.equal(f.video.store.get('identities/' + f.a.identityKey).accountId, f.a.videoId);
  assert.equal(f.video.store.get(pending.intentPath).state, 'needs_review');
});

test('a fallible owner hint in a legacy row does not close B', async () => {
  const f = fixture(), pending = await f.begin(f.a);
  await f.backend.claimExternalBillingRelease(f.a.videoId, pending.key, pending.billing);
  const row = f.video.store.get(pending.intentPath);
  f.video.store.set(pending.intentPath, {...row, accountId:f.b.videoId});
  const sweep = await f.backend.escalateStaleBillingRows({now:row.createdAtMs + EXTERNAL_BILLING_MAX_AGE_MS + 1, limit:10});
  assert.equal(sweep.escalated, 1);
  assert.equal(f.video.store.get(pending.intentPath).state, 'needs_review');
  const b = await f.begin(f.b);
  assert.equal(f.video.store.get(b.intentPath).state, 'reserve_pending');
  assert.deepEqual(f.account.writes, []);
});

test('an independent Account hold permits consultation but prevents an ordinary release; B still reserves', async () => {
  const f = fixture(), pending = await f.overdue(f.a);
  const holdId = randomUUID(), reservationId = pending.billing.reservationId;
  const hold = await f.store.blockVideoBilling(f.a.identityKey, holdId);
  assert.deepEqual(hold, {blocked:true, recorded:true, created:true});
  const afterHold = structuredClone(f.account.store);
  assert.equal((await f.store.videoReservationResolution(f.a.identityKey, reservationId, duration)).state, 'reserved');
  // This synthetic reservation has no earlier release dispatch. Call exactly once to observe the hold.
  await assert.rejects(() => f.store.settleVideo(f.a.identityKey, reservationId, 'release', duration), {code:'conflict'});
  assert.deepEqual(f.account.store, afterHold);
  assert.equal(f.video.store.get(pending.intentPath).state, 'needs_review');
  const b = await f.begin(f.b);
  assert.equal((await f.store.reserveVideo(f.b.identityKey, b.billing.reservationId, duration)).created, true);
  assert.equal((await f.store.videoBalance(f.a.identityKey)).reserved, duration);
  assert.equal((await f.store.videoBalance(f.b.identityKey)).reserved, duration);
});

async function escalateAndReadAlert(f,pending,now) {
  const swept=await f.backend.escalateStaleBillingRows({now,limit:15});
  assert.deepEqual([swept.escalated,swept.failed],[1,0]);
  const report=await readPendingReport(f.video.root,now);
  const raised=await raisePendingAlerts(f.video.db,f.video.root,report,now);
  assert.deepEqual([raised.created,raised.seen],[1,0]);
  const id=pending.intentPath.split('/')[1];
  const alert=await f.video.root.collection(ALERT_COLLECTION).doc(alertKey('intent',id,'needs_review','needs_review')).get();
  assert.equal(alert.exists,true);assert.equal(alert.data().status,'open');
  return alert.data();
}

test('entry authority: previously indistinguishable reserve and refund histories now retain their prior states',async context=>{
  const reserve=fixture(),refund=fixture(),a=reserve.a;
  const pending=await reserve.begin(a);
  const reservation=await reserve.store.reserveVideo(a.identityKey,pending.billing.reservationId,duration);
  assert.equal(reservation.created,true);
  // Fork one legitimate persisted preimage into independent in-memory stores.
  // The refund branch alone invokes the real transition. Neither leg edits a row by hand.
  for(const name of ['video','account']){
    const destination=refund[name].store;
    destination.clear();
    for(const [key,value] of reserve[name].store) destination.set(key,structuredClone(value));
  }
  assert.deepEqual(await refund.backend.claimExternalBillingRelease(a.videoId,pending.key,pending.billing),
    {state:'release_pending',transitioned:true});
  assert.equal(reserve.video.store.get(pending.intentPath).state,'reserve_pending');
  assert.equal(refund.video.store.get(pending.intentPath).state,'release_pending');
  // The release fence resets its due date. An ordinary failed status read can
  // legitimately reschedule either state. Apply the same stall at the same fixture
  // clock so retry timing cannot accidentally distinguish the two histories.
  const stalledAt=reserve.video.store.get(pending.intentPath).createdAtMs+1000;
  context.mock.method(Date,'now',()=>stalledAt);
  for(const f of [reserve,refund])assert.equal(await f.backend.recordExternalBillingIntentStall(a.videoId,pending.key,'unavailable'),true);
  const now=reserve.video.store.get(pending.intentPath).createdAtMs+EXTERNAL_BILLING_MAX_AGE_MS+1;
  const first=await escalateAndReadAlert(reserve,pending,now);
  const second=await escalateAndReadAlert(refund,pending,now);
  assert.deepEqual(first,second);assert.equal(first.accountId,a.videoId);
  const observation=f=>{
    const id=f.video.store.get(pending.intentPath).ageObservationId;
    assert.match(id,/^[0-9a-f-]{36}$/);
    const entry=f.video.store.get('billingIntentAgeObservations/'+id);
    assert.equal(entry.intentId,pending.intentPath.split('/')[1]);
    assert.equal(entry.reason,'max_age');
    assert.equal(Object.hasOwn(entry,'accountId'),false);
    return entry;
  };
  assert.equal(observation(reserve).priorState,'reserve_pending');
  assert.equal(observation(refund).priorState,'release_pending');
  // Other original evidence is still identical; the new observations alone
  // establish which state each transaction actually reread.
  const withoutAgeObservation=f=>{
    const entries=[...f.video.store].filter(([path])=>!path.startsWith('billingIntentAgeObservations/'));
    return new Map(entries.map(([path,value])=>{
      const copy=structuredClone(value);if(path===pending.intentPath)delete copy.ageObservationId;
      return [path,copy];
    }));
  };
  assert.deepEqual(withoutAgeObservation(reserve),withoutAgeObservation(refund));
  assert.deepEqual(reserve.account.store,refund.account.store);
  const read=f=>f.store.videoReservationResolution(a.identityKey,pending.billing.reservationId,duration);
  assert.deepEqual(await read(reserve),await read(refund));
});

test('entry authority: a normally emitted open alert can inherit the wrong owner hint despite a genuine A origin',async()=>{
  const f=fixture(),p=await f.begin(f.a);
  const reserved=await f.store.reserveVideo(f.a.identityKey,p.billing.reservationId,duration);
  assert.equal(reserved.account.id,f.a.accountId);
  await f.backend.claimExternalBillingRelease(f.a.videoId,p.key,p.billing);
  const row=f.video.store.get(p.intentPath);
  const origin=f.video.store.get('billingIntentWitnesses/'+row.id);
  assert.equal(origin.accountId,f.a.videoId);assert.equal(origin.identityKey,f.a.identityKey);
  // Explicit corruption of a legacy row in the test double, not an authenticated user operation.
  f.video.store.set(p.intentPath,{...row,accountId:f.b.videoId});
  const alert=await escalateAndReadAlert(f,p,row.createdAtMs+EXTERNAL_BILLING_MAX_AGE_MS+1);
  assert.equal(alert.accountId,f.b.videoId);
  const observationId=f.video.store.get(p.intentPath).ageObservationId;
  const observation=f.video.store.get('billingIntentAgeObservations/'+observationId);
  assert.equal(observation.priorState,'release_pending');
  assert.equal(Object.hasOwn(observation,'accountId'),false);
  assert.equal(Object.hasOwn(observation,'identityKey'),false);
  assert.equal((await f.store.videoReservation(f.a.identityKey,p.billing.reservationId)).state,'reserved');
  assert.equal(f.video.store.has('billingGuards/'+f.b.videoId),false);
  const bJob=await f.genericJob(f.b);assert.equal(f.video.store.get('jobs/'+bJob).accountId,f.b.videoId);
});

test('entry authority: a financial guard written by the review flow rejects only new A work',async()=>{
  const f=fixture(),key=randomUUID(),prior=await f.genericJob(f.a,key);
  const p=await f.begin(f.a);
  await f.backend.recordExternalBillingReview(f.a.videoId,p.key,p.billing,
    {reservationId:p.billing.reservationId,state:'captured',seconds:duration});
  const guard=f.video.store.get('billingGuards/'+f.a.videoId);
  assert.equal(guard.blocked,true);assert.equal(guard.accountId,f.a.videoId);
  assert.equal(await f.genericJob(f.a,key),prior);
  await assert.rejects(()=>f.genericJob(f.a),{code:'conflict'});
  await assert.rejects(()=>f.begin(f.a),{code:'conflict'});
  const bJob=await f.genericJob(f.b);assert.equal(f.video.store.get('jobs/'+bJob).accountId,f.b.videoId);
  assert.equal(f.video.store.has('billingGuards/'+f.b.videoId),false);
});

test('entry continuity: an already invoking simulated job completes once while the Video financial guard is active',async()=>{
  const f=fixture(),key=randomUUID(),job=await f.genericJob(f.a,key);
  const attempt=await f.backend.claim(f.a.videoId,job);
  assert.ok(attempt);
  assert.equal(await f.backend.beginInvocation(f.a.videoId,job,attempt.attemptId),true);
  const incident=await f.begin(f.a);
  // Deliberately synthetic observation, to exercise the existing writer; this is not
  // an overdue refund or proof that this financial guard is an admission-only guard.
  await f.backend.recordExternalBillingReview(f.a.videoId,incident.key,incident.billing,
    {reservationId:incident.billing.reservationId,state:'captured',seconds:duration});
  assert.equal(f.video.store.get('billingGuards/'+f.a.videoId).blocked,true);
  assert.equal(await f.backend.finish(f.a.videoId,job,attempt.attemptId,true),true);
  assert.equal(await f.backend.finish(f.a.videoId,job,attempt.attemptId,true),false);
  assert.equal(await f.genericJob(f.a,key),job);
  await assert.rejects(()=>f.genericJob(f.a),{code:'conflict'});
  const other=await f.genericJob(f.b);
  assert.equal(f.video.store.get('jobs/'+other).accountId,f.b.videoId);
  assert.equal(f.video.store.get('jobs/'+job).state,'succeeded');
  assert.equal(f.video.store.get('movements/terminal:'+job).kind,'capture');
  assert.deepEqual((({available,reserved,consumed,active})=>({available,reserved,consumed,active}))(f.video.store.get('accounts/'+f.a.videoId)),
    {available:18,reserved:0,consumed:2,active:0});
  assert.equal(f.video.writes.filter(write=>write==='create:movements/terminal:'+job).length,1);
  assert.deepEqual(f.account.writes,[]);
});

test('entry continuity: Video guard alone does not prevent independent Account capture, refund or their receipts',async()=>{
  const f=fixture(),completed=randomUUID(),refund=randomUUID(),other=randomUUID(),admission={jobId:randomUUID(),attemptId:randomUUID()};
  const call=[f.a.identityKey,completed,duration,admission.jobId,admission.attemptId,'text-window:0000','gemini-3.8-flash','a'.repeat(64)];
  await f.store.reserveVideo(f.a.identityKey,completed,duration);
  await f.store.reserveVideo(f.a.identityKey,refund,duration);
  await f.store.reserveVideo(f.b.identityKey,other,duration);
  assert.equal((await f.store.admitVideoCall(...call)).created,true);
  const incident=await f.begin(f.a);
  await f.backend.recordExternalBillingReview(f.a.videoId,incident.key,incident.billing,
    {reservationId:incident.billing.reservationId,state:'captured',seconds:duration});
  assert.equal(f.video.store.get('billingGuards/'+f.a.videoId).blocked,true);
  assert.equal([...f.video.store.keys()].filter(path=>path.startsWith('billingHoldOutbox/')).length,1);
  assert.equal(f.account.store.has('videoBillingGuards/'+f.a.accountId),false);
  assert.equal((await f.store.admitVideoCall(...call)).receiptOnly,true);
  assert.equal((await f.store.settleVideo(f.a.identityKey,completed,'capture',duration,admission)).settled,true);
  assert.equal((await f.store.settleVideo(f.a.identityKey,completed,'capture',duration,admission)).settled,false);
  assert.equal((await f.store.settleVideo(f.a.identityKey,refund,'release',duration)).settled,true);
  assert.equal((await f.store.settleVideo(f.a.identityKey,refund,'release',duration)).settled,false);
  const beforeCross=structuredClone(f.account.store);
  await assert.rejects(()=>f.store.settleVideo(f.b.identityKey,refund,'release',duration),{code:'not_found'});
  await assert.rejects(()=>f.store.settleVideo(f.a.identityKey,refund,'release',duration+1),{code:'conflict'});
  assert.deepEqual(f.account.store,beforeCross);
  assert.equal((await f.store.settleVideo(f.b.identityKey,other,'release',duration)).settled,true);
  assert.deepEqual(await f.store.videoBalance(f.a.identityKey),
    {unit:'video_seconds',credited:20,available:17,reserved:0,consumed:3,active:0});
  assert.deepEqual(await f.store.videoBalance(f.b.identityKey),
    {unit:'video_seconds',credited:20,available:20,reserved:0,consumed:0,active:0});
  const entries=[...f.account.store.entries()].filter(([path])=>path.startsWith('ledgerEntries/')).map(([,row])=>row);
  assert.equal(entries.filter(row=>row.ownerAccountId===f.a.accountId&&row.kind==='video_capture').length,1);
  assert.equal(entries.filter(row=>row.ownerAccountId===f.a.accountId&&row.kind==='video_release').length,1);
  assert.equal(entries.filter(row=>row.ownerAccountId===f.b.accountId&&row.kind==='video_release').length,1);
});

test('entry continuity: a separately applied Account hold blocks new settlement and admissions, not receipt replays or B',async()=>{
  const f=fixture(),reservation=randomUUID(),other=randomUUID(),incident=randomUUID(),admission={jobId:randomUUID(),attemptId:randomUUID()};
  await f.store.reserveVideo(f.a.identityKey,reservation,duration);
  const call=[f.a.identityKey,reservation,duration,admission.jobId,admission.attemptId,'text-window:0000','gemini-3.8-flash','a'.repeat(64)];
  assert.equal((await f.store.admitVideoCall(...call)).created,true);
  assert.equal((await f.store.blockVideoBilling(f.a.identityKey,incident)).created,true);
  const before=structuredClone(f.account.store);
  assert.equal((await f.store.admitVideoCall(...call)).receiptOnly,true);
  await assert.rejects(()=>f.store.admitVideoCall(...call.slice(0,5),'text-window:0001',call[6],call[7]),{code:'conflict'});
  await assert.rejects(()=>f.store.settleVideo(f.a.identityKey,reservation,'capture',duration,admission),{code:'conflict'});
  await assert.rejects(()=>f.store.settleVideo(f.a.identityKey,reservation,'release',duration,admission,
    {resolution:{kind:'no_speech',evidenceSha256:'b'.repeat(64)}}),{code:'conflict'});
  assert.deepEqual(f.account.store,before);
  assert.equal((await f.store.reserveVideo(f.b.identityKey,other,duration)).created,true);
  assert.equal((await f.store.settleVideo(f.b.identityKey,other,'release',duration)).settled,true);
  assert.deepEqual(await f.store.videoBalance(f.a.identityKey),
    {unit:'video_seconds',credited:20,available:17,reserved:3,consumed:0,active:1});
  assert.deepEqual(await f.store.videoBalance(f.b.identityKey),
    {unit:'video_seconds',credited:20,available:20,reserved:0,consumed:0,active:0});
});
