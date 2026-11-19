// Integration test for a future queue, using actual intent transitions.
// It does not connect the synthetic selector to the current drainer or perform
// any remote financial action. All records and lease fields here are synthetic.
import assert from 'node:assert/strict';
import {test, before, afterEach} from 'node:test';
import {randomUUID} from 'node:crypto';
import {initializeApp, deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {accountIdentityKey} from './accountBillingClient.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185';
const fixtureRoot='vistavo_billing_fair_integration_test',fixtures=[];

before(async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host,'This test is restricted to the loopback Firestore emulator');
 assert.notEqual(process.env.NODE_ENV,'production');
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE','K_JOB','FUNCTION_TARGET','GAE_ENV'])assert.ok(!process.env[name],`${name} must be absent`);
 for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])assert.ok(!process.env[name]||process.env[name]===project,`${name} must be demo only`);
 assert.equal((await fetch(`http://${host}/`)).status,200);
});

afterEach(async()=>{
 for(const f of fixtures.splice(0)){
  await f.db.recursiveDelete(f.root);
  await f.db.terminate();
  await deleteApp(f.app);
 }
});

async function fixture(){
 const id=randomUUID(),app=initializeApp({projectId:project},`billing-fair-integration-${id}`),db=getFirestore(app);
 db.settings({host,ssl:false,preferRest:true});
 const root=db.collection(fixtureRoot).doc(id);
 assert.equal(app.options.projectId,project);
 assert.equal(root.path,`${fixtureRoot}/${id}`);
 assert.equal(db._settings.servicePath,'127.0.0.1');
 assert.equal(db._settings.port,8185);
 assert.equal(db._settings.ssl,false);
 const backend=new FirestoreBackend(db,root),f={app,db,root,backend};
 fixtures.push(f);
 const uid=`synthetic-fair-${id}`,account=await backend.accountForUid(uid),inputId=randomUUID();
 await root.collection('inputs').doc(inputId).create({accountId:account,deleted:false,expiresAtMs:Date.now()+300000});
 await root.collection('projects').doc(inputId).create({accountId:account,inputId,revision:1,draft:'synthetic'});
 return {...f,uid,account,inputId};
}

async function createIntent(f){
 const requestKey=randomUUID(),billing={provider:'account_seconds',identityKey:accountIdentityKey(f.uid),reservationId:randomUUID(),seconds:2};
 await f.backend.beginExternalBillingIntent(f.account,f.inputId,requestKey,'translation:en',1,billing);
 const docs=await f.root.collection('billingIntents').where('requestKey','==',requestKey).get();
 assert.equal(docs.size,1);
 return {requestKey,billing,ref:docs.docs[0].ref};
}

// This small transactional claim is a test double, not the production drainer.
async function claimSyntheticIntent(f,intent,state,now,leaseMs=120000){
 const leaseToken=randomUUID();
 return f.db.runTransaction(async tx=>{
  const d=await tx.get(intent.ref),row=d.data();
  if(!row||row.state!==state||row.nextAttemptAt>now||(row.leaseUntil??0)>now)return null;
  const lease={leaseToken,leaseOwner:'synthetic-worker-a',leaseUntil:now+leaseMs,generation:(row.generation??0)+1};
  tx.update(intent.ref,{...lease,nextAttemptAt:lease.leaseUntil});return lease;
 });
}

async function assertLeaseDoesNotHideReadyIntent(t,f,leased,ready,state,now,lease){
 const row=await leased.ref.get();
 assert.equal(row.get('state'),state);
 assert.deepEqual({leaseToken:row.get('leaseToken'),leaseOwner:row.get('leaseOwner'),leaseUntil:row.get('leaseUntil'),generation:row.get('generation')},lease);
 // This query illustrates a proposed due-time selection, not the real drainer.
 const due=await f.root.collection('billingIntents').where('state','==',state).where('nextAttemptAt','<=',now).orderBy('nextAttemptAt').limit(1).get();
 const first=due.docs[0]?.id??null;
 t.diagnostic(`synthetic leaseUntil=${lease.leaseUntil}; nextAttemptAt=${row.get('nextAttemptAt')}; first query row is ${first===leased.ref.id?'leased':first===ready.ref.id?'ready':'other/none'}`);
 // One assertion preserves both symptoms in the red diff: an active lease must
 // retain its due time and an actually eligible row must remain visible.
 assert.deepEqual({nextAttemptAt:row.get('nextAttemptAt'),first},{nextAttemptAt:lease.leaseUntil,first:ready.ref.id},'An active synthetic lease must not reappear before expiry or hide a ready row');
}

test('release fence keeps an existing synthetic turn out of a due-time query',async t=>{
 const f=await fixture(),leased=await createIntent(f),ready=await createIntent(f),now=Date.now();
 const lease=await claimSyntheticIntent(f,leased,'reserve_pending',now);assert.ok(lease);
 assert.deepEqual(await f.backend.fenceExternalBillingRelease(f.account,ready.requestKey,ready.billing),{state:'release_pending'});
 await ready.ref.update({nextAttemptAt:now-1000});
 assert.deepEqual(await f.backend.fenceExternalBillingRelease(f.account,leased.requestKey,leased.billing),{state:'release_pending'});
 await assertLeaseDoesNotHideReadyIntent(t,f,leased,ready,'release_pending',now,lease);
});

test('reopening insufficient keeps an existing synthetic turn out of a due-time query',async t=>{
 const f=await fixture(),leased=await createIntent(f),ready=await createIntent(f),now=Date.now();
 const lease=await claimSyntheticIntent(f,leased,'reserve_pending',now);assert.ok(lease);
 assert.equal(await f.backend.settleExternalBillingIntent(f.account,leased.requestKey,'insufficient'),true);
 const insufficient=await leased.ref.get();
 assert.equal(insufficient.get('state'),'insufficient');
 assert.equal(insufficient.get('leaseUntil'),lease.leaseUntil);
 await ready.ref.update({nextAttemptAt:now-1000});
 assert.equal(await f.backend.beginExternalBillingIntent(f.account,f.inputId,leased.requestKey,'translation:en',1,leased.billing),null);
 await assertLeaseDoesNotHideReadyIntent(t,f,leased,ready,'reserve_pending',now,lease);
});

test('a release transition that wins first can subsequently be claimed for that new state',async()=>{
 const f=await fixture(),intent=await createIntent(f);
 assert.deepEqual(await f.backend.fenceExternalBillingRelease(f.account,intent.requestKey,intent.billing),{state:'release_pending'});
 assert.equal((await intent.ref.get()).get('nextAttemptAt'),0,'valid no-lease behavior remains unchanged');
 assert.equal(await claimSyntheticIntent(f,intent,'reserve_pending',Date.now()),null);
 const lease=await claimSyntheticIntent(f,intent,'release_pending',Date.now());assert.ok(lease);
 const row=await intent.ref.get();assert.equal(row.get('state'),'release_pending');assert.equal(row.get('nextAttemptAt'),lease.leaseUntil);assert.equal(row.get('leaseToken'),lease.leaseToken);
});

test('reopening insufficient before a claim preserves no-lease behavior and the claim sees the new state',async()=>{
 const f=await fixture(),intent=await createIntent(f);
 assert.equal(await f.backend.settleExternalBillingIntent(f.account,intent.requestKey,'insufficient'),true);
 await intent.ref.update({generation:0,nextAttemptAt:Date.now()});
 assert.equal(await f.backend.beginExternalBillingIntent(f.account,f.inputId,intent.requestKey,'translation:en',1,intent.billing),null);
 assert.equal((await intent.ref.get()).get('nextAttemptAt'),0,'valid no-lease behavior remains unchanged');
 const lease=await claimSyntheticIntent(f,intent,'reserve_pending',Date.now());assert.ok(lease);
 const row=await intent.ref.get();assert.equal(row.get('state'),'reserve_pending');assert.equal(row.get('nextAttemptAt'),lease.leaseUntil);assert.equal(row.get('leaseToken'),lease.leaseToken);
});

for(const transition of ['release','reopen'])test(`${transition} preserves an expired lease until a new claim replaces it`,async()=>{
 const f=await fixture(),intent=await createIntent(f),past=Date.now()-3000;
 await intent.ref.update({nextAttemptAt:past});
 const old=await claimSyntheticIntent(f,intent,'reserve_pending',past,1000);assert.ok(old);assert.ok(old.leaseUntil<Date.now());
 if(transition==='release')assert.deepEqual(await f.backend.fenceExternalBillingRelease(f.account,intent.requestKey,intent.billing),{state:'release_pending'});
 else{assert.equal(await f.backend.settleExternalBillingIntent(f.account,intent.requestKey,'insufficient'),true);assert.equal(await f.backend.beginExternalBillingIntent(f.account,f.inputId,intent.requestKey,'translation:en',1,intent.billing),null);}
 const row=await intent.ref.get();assert.equal(row.get('nextAttemptAt'),old.leaseUntil);assert.equal(row.get('leaseToken'),old.leaseToken);
 const fresh=await claimSyntheticIntent(f,intent,transition==='release'?'release_pending':'reserve_pending',Date.now());assert.ok(fresh);assert.notEqual(fresh.leaseToken,old.leaseToken);assert.equal(fresh.generation,old.generation+1);
});

const invalidLeaseCases=[
 ['missing token',{leaseToken:FieldValue.delete()}],
 ['missing owner',{leaseOwner:FieldValue.delete()}],
 ['missing deadline',{leaseUntil:FieldValue.delete()}],
 ['missing generation',{generation:FieldValue.delete()}],
 ['null token',{leaseToken:null}],
 ['empty owner',{leaseOwner:''}],
 ['owner final newline',{leaseOwner:'synthetic-worker-a\n'}],
 ['token final newline',{leaseToken:'00000000-0000-4000-8000-000000000000\n'}],
 ['non-UUID token',{leaseToken:'not-a-uuid'}],
 ['wrong UUID version',{leaseToken:'00000000-0000-1000-8000-000000000000'}],
 ['negative generation',{generation:-1}],
 ['zero generation',{generation:0}],
 ['unsafe generation',{generation:Number.MAX_SAFE_INTEGER+1}],
 ['negative deadline',{leaseUntil:-1}],
 ['invalid due date',{nextAttemptAt:'invalid'}],
 ['missing due date',{nextAttemptAt:FieldValue.delete()}],
 ['discordant due date',{nextAttemptAt:0}],
];

for(const transition of ['release','reopen'])test(`${transition} rejects partial or corrupt lease tuples without changing intent or balance`,async()=>{
 const f=await fixture();
 for(const [name,corruption] of invalidLeaseCases){
  const intent=await createIntent(f);
  if(transition==='reopen')assert.equal(await f.backend.settleExternalBillingIntent(f.account,intent.requestKey,'insufficient'),true);
  const until=Date.now()+120000;
  await intent.ref.update({leaseToken:randomUUID(),leaseOwner:'synthetic-worker-a',leaseUntil:until,generation:1,nextAttemptAt:until,...corruption});
  const before=(await intent.ref.get()).data(),balanceBefore=await f.backend.readBalance(f.account);
  const action=transition==='release'?()=>f.backend.fenceExternalBillingRelease(f.account,intent.requestKey,intent.billing):()=>f.backend.beginExternalBillingIntent(f.account,f.inputId,intent.requestKey,'translation:en',1,intent.billing);
  await assert.rejects(action,error=>error?.code==='invariant',`${name} must fail closed`);
  assert.deepEqual((await intent.ref.get()).data(),before,`${name} must leave the entire intent unchanged`);
  assert.deepEqual(await f.backend.readBalance(f.account),balanceBefore,`${name} must not change balance`);
 }
});

test('an invalid lease cannot transition to insufficient or mutate the account',async()=>{
 const f=await fixture(),intent=await createIntent(f);
 await intent.ref.update({leaseToken:randomUUID()});
 const before=(await intent.ref.get()).data(),balanceBefore=await f.backend.readBalance(f.account);
 await assert.rejects(()=>f.backend.settleExternalBillingIntent(f.account,intent.requestKey,'insufficient'),error=>error?.code==='invariant');
 assert.deepEqual((await intent.ref.get()).data(),before);assert.deepEqual(await f.backend.readBalance(f.account),balanceBefore);
});

test('ordinary retries reject corrupt scheduling metadata even when the state already matches',async()=>{
 const f=await fixture(),reserve=await createIntent(f),release=await createIntent(f);
 assert.deepEqual(await f.backend.fenceExternalBillingRelease(f.account,release.requestKey,release.billing),{state:'release_pending'});
 for(const [intent,run] of [
  [reserve,()=>f.backend.beginExternalBillingIntent(f.account,f.inputId,reserve.requestKey,'translation:en',1,reserve.billing)],
  [release,()=>f.backend.fenceExternalBillingRelease(f.account,release.requestKey,release.billing)],
 ]){
  await intent.ref.update({generation:-1});
  const before=(await intent.ref.get()).data(),balanceBefore=await f.backend.readBalance(f.account);
  await assert.rejects(run,error=>error?.code==='invariant');
  assert.deepEqual((await intent.ref.get()).data(),before);assert.deepEqual(await f.backend.readBalance(f.account),balanceBefore);
 }
});

test('a late release acknowledgement after another claim is retained for review',async()=>{
 const f=await fixture(),intent=await createIntent(f),past=Date.now()-3000;
 const witness=await f.backend.externalIntentWitness(f.account,intent.requestKey,intent.billing);
 await intent.ref.update({nextAttemptAt:past});
 const old=await claimSyntheticIntent(f,intent,'reserve_pending',past,1000);assert.ok(old);
 assert.deepEqual(await f.backend.fenceExternalBillingRelease(f.account,intent.requestKey,intent.billing),{state:'release_pending'});
 assert.deepEqual(await f.backend.prepareExternalIntentTerminal(witness,intent.requestKey,'release'),{state:'ready'});
 const snapshot=await f.backend.captureDirectObservation(witness,intent.requestKey,'release');assert.ok(snapshot);
 const fresh=await claimSyntheticIntent(f,intent,'release_pending',Date.now());assert.ok(fresh);assert.notEqual(fresh.leaseToken,old.leaseToken);
 // The response is synthetic; this checks only local tuple and receipt handling.
 const ack={reservationId:intent.billing.reservationId,state:'released',seconds:intent.billing.seconds};
 assert.equal(await f.backend.finishExternalBillingRelease(f.account,intent.requestKey,intent.billing,ack,witness,'release_ack',snapshot),false);
 const recorded=await f.backend.recordConfirmedIntentObservation(witness,{action:'release',source:'release_ack',...ack},snapshot);assert.equal(recorded.state,'needs_review');assert.equal(recorded.ownerBlocked,true);
 const row=await intent.ref.get();assert.equal(row.get('state'),'needs_review');assert.equal(row.get('releaseConfirmed'),undefined);assert.equal(row.get('leaseToken'),fresh.leaseToken);
 assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,1);
});
