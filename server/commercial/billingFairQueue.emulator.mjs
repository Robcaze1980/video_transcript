// Synthetic-only integration: no cloud credentials, Account API or provider calls.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {BillingFairQueueFixture} from './billingFairQueue.ts';

process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8185';
process.env.VISTAVO_BILLING_FAIR_EMULATOR_ONLY='1';
process.env.NODE_ENV='test';

async function fixture(run){
 const first=await BillingFairQueueFixture.create(),second=await BillingFairQueueFixture.attach(first.runId);
 try{return await run(first,second);}finally{await second.close();await first.cleanupSynthetic();await first.close();}
}
// Deliberately malformed input for this emulator test; never accepts an injected client or path.
async function seedNonNumericDue(runId){
 const boundary=()=>{
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');
  assert.equal(process.env.VISTAVO_BILLING_FAIR_EMULATOR_ONLY,'1');
  assert.notEqual(process.env.NODE_ENV,'production');
  assert.match(runId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE','K_JOB','FUNCTION_TARGET','GAE_ENV'])assert.ok(!process.env[name]);
  for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])assert.ok(!process.env[name]||process.env[name]==='demo-vistavo-ledger');
 };
 boundary();
 const app=initializeApp({projectId:'demo-vistavo-ledger'},'lv-fair-malformed-test-'+randomUUID());
 const db=getFirestore(app);db.settings({preferRest:true});
 const root=db.collection('vistavo_billing_fair_queue_test').doc('run-'+runId);
 try{
  assert.equal(app.options.projectId,'demo-vistavo-ledger');
  assert.equal(root.path,'vistavo_billing_fair_queue_test/run-'+runId);
  const record=await root.get();
  assert.equal(record.get('fixture'),'billing-fair-synthetic-v1');assert.equal(record.get('runId'),runId);
  boundary();
  await root.collection('intents').doc('fixture-reserve-999998').create({fixture:'billing-fair-synthetic-v1',lane:'reserve',state:'reserve_pending',generation:0,nextAttemptAt:'not-a-number'});
 }finally{await db.terminate();await deleteApp(app);}
}
const workerA='fixture-worker-a',workerB='fixture-worker-b';
const laneNames=['reserve','release','pending','retry','hold'];

test('selector is disabled on each worker and rejects missing emulator boundary',async()=>fixture(async(first,second)=>{
 assert.throws(()=>new BillingFairQueueFixture(Symbol('forged'),{},{},{},first.runId),/constructor boundary/);
 assert.equal(first.db,undefined);assert.equal(first.root,undefined);assert.equal(BillingFairQueueFixture.openClient,undefined);
 await assert.rejects(first.claimSyntheticBatch(workerA,1,1000,100),/disabled/);
 first.enableForSyntheticTests();await assert.rejects(second.claimSyntheticBatch(workerB,1,1000,100),/disabled/);
 process.env.VISTAVO_BILLING_FAIR_EMULATOR_ONLY='0';
 try{first.guard=()=>{};await assert.rejects(BillingFairQueueFixture.create(),/boundary/);await assert.rejects(first.claimSyntheticBatch(workerA,1,1000,100),/boundary/);}
 finally{process.env.VISTAVO_BILLING_FAIR_EMULATOR_ONLY='1';}
 const priorHost=process.env.FIRESTORE_EMULATOR_HOST,priorProject=process.env.GCLOUD_PROJECT,priorCreds=process.env.GOOGLE_APPLICATION_CREDENTIALS;
 try{
  process.env.FIRESTORE_EMULATOR_HOST='localhost:8185';await assert.rejects(BillingFairQueueFixture.create(),/boundary/);process.env.FIRESTORE_EMULATOR_HOST=priorHost;
  process.env.GCLOUD_PROJECT='vistavo-prod';await assert.rejects(BillingFairQueueFixture.create(),/boundary/);if(priorProject===undefined)delete process.env.GCLOUD_PROJECT;else process.env.GCLOUD_PROJECT=priorProject;
  process.env.GOOGLE_APPLICATION_CREDENTIALS='synthetic-not-a-path';await assert.rejects(BillingFairQueueFixture.create(),/boundary/);
 }finally{
  process.env.FIRESTORE_EMULATOR_HOST=priorHost;if(priorProject===undefined)delete process.env.GCLOUD_PROJECT;else process.env.GCLOUD_PROJECT=priorProject;
  if(priorCreds===undefined)delete process.env.GOOGLE_APPLICATION_CREDENTIALS;else process.env.GOOGLE_APPLICATION_CREDENTIALS=priorCreds;
 }
}));

test('eligible time is filtered before the limit even after 120 earlier-ID future rows',async()=>fixture(async(first)=>{
 first.enableForSyntheticTests();
 const future=Array.from({length:120},(_,ordinal)=>({lane:'pending',ordinal,dueAt:9000}));
 await first.seedSynthetic([...future,{lane:'pending',ordinal:999999,dueAt:1000}]);
 const [claimed]=await first.claimSyntheticBatch(workerA,1,1000,500);
 assert.equal(claimed.kind,'claimed');assert.equal(claimed.lane,'pending');assert.equal(claimed.id,'fixture-pending-999999');
 assert.equal((await first.claimSyntheticBatch(workerA,1,1000,500)).length,0);
}));

test('durable rotation gives all five lanes turns with limit one and continuous other arrivals',async()=>fixture(async(first,second)=>{
 first.enableForSyntheticTests();second.enableForSyntheticTests();
 await first.seedSynthetic(laneNames.flatMap(lane=>Array.from({length:4},(_,ordinal)=>({lane,ordinal,dueAt:1000}))));
 const observed=[];
 for(let i=0;i<15;i++){
  const queue=i%2?second:first;
  const [event]=await queue.claimSyntheticBatch(i%2?workerB:workerA,1,1000,5000);
  assert.equal(event.kind,'claimed');observed.push(event.lane);
  await queue.seedSynthetic([{lane:'reserve',ordinal:100+i,dueAt:1000},{lane:'pending',ordinal:100+i,dueAt:1000}]);
 }
 assert.deepEqual(observed,[...laneNames,...laneNames,...laneNames]);
}));

test('two workers cannot claim the same active lease; expired worker ACK is only an observation',async()=>fixture(async(first,second)=>{
 first.enableForSyntheticTests();second.enableForSyntheticTests();await first.seedSynthetic([{lane:'release',ordinal:0,dueAt:1000}]);
 const claims=await Promise.all([first.claimSyntheticBatch(workerA,1,1000,100),second.claimSyntheticBatch(workerB,1,1000,100)]);
 const flat=claims.flat();assert.equal(flat.length,1);const old=flat[0];assert.equal(old.kind,'claimed');
 assert.equal((await second.claimSyntheticBatch(workerB,1,1099,100)).length,0);
 const [fresh]=await second.claimSyntheticBatch(workerB,1,1100,100);assert.equal(fresh.kind,'claimed');assert.equal(fresh.id,old.id);assert.notEqual(fresh.token,old.token);assert.equal(fresh.generation,old.generation+1);
 assert.equal(await first.acknowledgeSynthetic(old,1101),'late_observation');assert.equal(await first.deferSynthetic(old,1101,1201),false);
 assert.equal((await first.inspectSynthetic('release',0)).leaseToken,fresh.token);
 assert.equal(await second.acknowledgeSynthetic(fresh,1101),'fixture_done');
 assert.equal(await first.acknowledgeSynthetic(old,1102),'late_observation');assert.equal(await first.observationCount(),1);
}));

test('simultaneous expiry-boundary ACK and reclaim preserve the new lease and durable observation',async()=>fixture(async(first,second)=>{
 first.enableForSyntheticTests();second.enableForSyntheticTests();
 for(let ordinal=0;ordinal<4;ordinal++){
  const start=1000+ordinal*1000;
  await first.seedSynthetic([{lane:'pending',ordinal,dueAt:start}]);
  const [old]=await first.claimSyntheticBatch(workerA,1,start,100);assert.equal(old.kind,'claimed');
  const expiry=old.leaseUntil;
  // Same synthetic time and alternating invocation order, without claiming forced DB commit orders.
  let ack,reclaim;
  if(ordinal%2===0){ack=first.acknowledgeSynthetic(old,expiry);reclaim=second.claimSyntheticBatch(workerB,1,expiry,100);}
  else{reclaim=second.claimSyntheticBatch(workerB,1,expiry,100);ack=first.acknowledgeSynthetic(old,expiry);}
  const [outcome,events]=await Promise.all([ack,reclaim]);
  assert.equal(outcome,'late_observation');assert.equal(events.length,1);
  const [fresh]=events;assert.equal(fresh.kind,'claimed');assert.equal(fresh.id,old.id);
  assert.notEqual(fresh.token,old.token);assert.equal(fresh.generation,old.generation+1);assert.equal(fresh.leaseUntil,expiry+100);
  const stored=await first.inspectSynthetic('pending',ordinal);
  assert.equal(stored.state,'pending');assert.equal(stored.leaseToken,fresh.token);assert.equal(stored.leaseOwner,workerB);
  assert.equal(stored.leaseUntil,fresh.leaseUntil);assert.equal(stored.nextAttemptAt,fresh.leaseUntil);assert.equal(stored.generation,fresh.generation);
  assert.equal(await second.observationCount(),ordinal+1);
  assert.equal(await first.acknowledgeSynthetic(old,expiry),'late_observation');
  assert.equal(await second.observationCount(),ordinal+1);
  assert.equal(await second.acknowledgeSynthetic(fresh,expiry+1),'fixture_done');
 }
 const reopened=await BillingFairQueueFixture.attach(first.runId);
 try{assert.equal(await reopened.observationCount(),4);}finally{await reopened.close();}
}));

test('simultaneous selectors rotate durably across different lanes',async()=>fixture(async(first,second)=>{
 first.enableForSyntheticTests();second.enableForSyntheticTests();
 await first.seedSynthetic(laneNames.map(lane=>({lane,ordinal:0,dueAt:1000})));
 const concurrent=(await Promise.all([first.claimSyntheticBatch(workerA,1,1000,500),second.claimSyntheticBatch(workerB,1,1000,500)])).flat();
 assert.equal(concurrent.length,2);assert.deepEqual(new Set(concurrent.map(x=>x.lane)),new Set(['reserve','release']));
 const remaining=[];for(let i=0;i<3;i++)remaining.push(...await first.claimSyntheticBatch(workerA,1,1000,500));
 assert.deepEqual(remaining.map(x=>x.lane),['pending','retry','hold']);
}));

test('more than 100 active leases do not hide a later eligible row',async()=>fixture(async(first,second)=>{
 first.enableForSyntheticTests();second.enableForSyntheticTests();
 await first.seedSynthetic(Array.from({length:121},(_,ordinal)=>({lane:'pending',ordinal,dueAt:1000})));
 for(let i=0;i<4;i++)assert.equal((await first.claimSyntheticBatch(workerA,25,1000,5000)).length,25);
 const [next]=await second.claimSyntheticBatch(workerB,1,1000,5000);
 assert.equal(next.kind,'claimed');assert.equal(next.id,'fixture-pending-000100');
}));

test('transient failure defers its row and permits other lanes to progress',async()=>fixture(async(first,second)=>{
 first.enableForSyntheticTests();second.enableForSyntheticTests();
 await first.seedSynthetic([...laneNames.map(lane=>({lane,ordinal:0,dueAt:1000})),{lane:'reserve',ordinal:1,dueAt:1000}]);
 const [reserve]=await first.claimSyntheticBatch(workerA,1,1000,500);assert.equal(reserve.lane,'reserve');
 assert.equal(await first.deferSynthetic(reserve,1001,2000),true);
 for(const expected of laneNames.slice(1)){
  const [event]=await second.claimSyntheticBatch(workerB,1,1001,500);assert.equal(event.lane,expected);
  assert.equal(await second.acknowledgeSynthetic(event,1002),'fixture_done');
 }
 const [otherReserve]=await second.claimSyntheticBatch(workerB,1,1002,500);assert.equal(otherReserve.lane,'reserve');assert.notEqual(otherReserve.id,reserve.id);
 assert.equal(await second.acknowledgeSynthetic(otherReserve,1003),'fixture_done');
 assert.deepEqual(await first.claimSyntheticBatch(workerA,1,1999,500),[]);
 const [retry]=await first.claimSyntheticBatch(workerA,1,2000,500);assert.equal(retry.lane,'reserve');assert.equal(retry.id,reserve.id);
}));

test('an invalid row creates durable review and cannot hide valid rows or trigger financial effects',async()=>fixture(async(first,second)=>{
 first.enableForSyntheticTests();second.enableForSyntheticTests();
 await first.seedSynthetic([{lane:'hold',ordinal:0,dueAt:1000,invalid:true},{lane:'hold',ordinal:1,dueAt:1000},{lane:'release',ordinal:0,dueAt:1000}]);
 const events=[];
 for(let i=0;i<3;i++)events.push(...await first.claimSyntheticBatch(workerA,1,1000,500));
 const invalid=events.find(event=>event.kind==='needs_review');assert.ok(invalid);assert.equal(invalid.lane,'hold');
 assert.equal((await second.inspectSynthetic('hold',0)).state,'needs_review');assert.equal(await second.reviewCount(),1);
 assert.ok(events.some(event=>event.kind==='claimed'&&event.lane==='release'));
 assert.ok(events.some(event=>event.kind==='claimed'&&event.lane==='hold'));
 // The fixture has no account/provider client or method that can move money.
}));

test('missing or nonnumeric due times can be invisible and are not automatically quarantined',async()=>fixture(async(first)=>{
 first.enableForSyntheticTests();await first.seedLegacySynthetic('reserve',0);
 await seedNonNumericDue(first.runId);await first.seedSynthetic([{lane:'reserve',ordinal:1,dueAt:1000}]);
 const [valid]=await first.claimSyntheticBatch(workerA,1,1000,500);
 assert.equal(valid.kind,'claimed');assert.equal(valid.id,'fixture-reserve-000001');
 assert.deepEqual(await first.claimSyntheticBatch(workerA,1,1000,500),[]);
 const missing=await first.inspectSynthetic('reserve',0),bad=await first.inspectSynthetic('reserve',999998);
 assert.equal(missing.state,'reserve_pending');assert.ok(!Object.hasOwn(missing,'nextAttemptAt'));
 assert.equal(bad.state,'reserve_pending');assert.equal(bad.nextAttemptAt,'not-a-number');
 assert.equal(await first.reviewCount(),0);
}));
