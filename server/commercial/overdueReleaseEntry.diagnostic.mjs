// Opt-in characterization for LV-019.B. RED cases express requirements whose proof is missing.
// Uses production methods with two independent in-memory stores. No SDK, emulator or transport.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { AccountStore } from '../account/backend.ts';
import { FirestoreBackend, EXTERNAL_BILLING_MAX_AGE_MS } from './firestoreBackend.ts';
import { stub } from './billingFirestoreStub.ts';
import { privateBucket } from './privateObjectPlan.ts';
import { videoReservationId } from './videoReservationId.ts';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const duration = 3;
const operation = 'translation:en';

function fixture() {
  const video = stub(), account = stub();
  const backend = new FirestoreBackend(video.db, video.root);
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
