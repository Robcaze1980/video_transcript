import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {WitnessQueueFixture,syntheticTerminalKey} from './witnessRecoveryQueueFixture.mjs';

function pair(action='seal'){
  const intent=randomBytes(32).toString('hex');
  return {intent,id:syntheticTerminalKey(intent,action)};
}

async function fixture(run){
  const a=await WitnessQueueFixture.create();
  const b=await WitnessQueueFixture.attach(a.runId);
  try{return await run(a,b);}
  finally{a.enableForSyntheticTests();await a.cleanup();await b.close();await a.close();}
}

test('synthetic terminal IDs follow the real intent-plus-action hash format',()=>{
  const intent='a'.repeat(64);
  assert.equal(syntheticTerminalKey(intent,'seal'),'adeff7134634caef01627346f55dacfc0fd9ba952cd1fe636e643ea8b2e222df');
  assert.equal(syntheticTerminalKey(intent,'release'),'a585b76955a67e3850c4acced1f742c85b225c16fa2471599218c14353f10d53');
  assert.throws(()=>syntheticTerminalKey('A'.repeat(64),'seal'),/invalid_id/);
  assert.throws(()=>syntheticTerminalKey(intent,'capture'),/invalid_action/);
});

test('fixture starts disabled and refuses a changed emulator boundary',async()=>fixture(async(a,b)=>{
  const {intent,id}=pair();
  await assert.rejects(a.createPair(intent,'seal',1000),/fixture_disabled/);
  a.enableForSyntheticTests();
  await assert.rejects(b.createPair(intent,'seal',1000),/fixture_disabled/);
  const prior=process.env.FIRESTORE_EMULATOR_HOST;
  try{
    process.env.FIRESTORE_EMULATOR_HOST='localhost:8185';
    await assert.rejects(a.createPair(intent,'seal',1000),/emulator_boundary/);
    await assert.rejects(WitnessQueueFixture.create(),/emulator_boundary/);
  }finally{process.env.FIRESTORE_EMULATOR_HOST=prior;}
  assert.deepEqual(await a.snapshot(id),{witness:null,task:null,incidents:[]});
}));

test('witness and recovery task are atomic; replay preserves a single pair',async()=>fixture(async(a)=>{
  a.enableForSyntheticTests();const {intent,id}=pair();
  await assert.rejects(a.createPair(intent,'seal',1000,{failAfterWitnessStaged:true}),/synthetic_crash/);
  assert.deepEqual(await a.snapshot(id),{witness:null,task:null,incidents:[]});
  assert.equal(await a.createPair(intent,'seal',1000),'created');
  const before=await a.snapshot(id);
  assert.equal(before.witness.stage,'prepared');assert.equal(before.task.state,'pending');
  assert.equal(before.task.nextAttemptAt,1000);assert.equal(before.task.generation,0);
  assert.equal(await a.createPair(intent,'seal',2000),'already_exists');
  assert.deepEqual(await a.snapshot(id),before);
}));

test('an inconsistent preexisting task is rejected without overwrite',async()=>fixture(async(a)=>{
  a.enableForSyntheticTests();const {intent,id}=pair();
  await a.createPair(intent,'seal',1000);
  await a.corruptTaskActionForSyntheticTest(id,'release');
  const corrupt=await a.snapshot(id);
  await assert.rejects(a.createPair(intent,'seal',1000),/task_inconsistent/);
  assert.deepEqual(await a.snapshot(id),corrupt);
}));

test('an unexpected field in a preexisting task fails closed without resetting it',async()=>fixture(async(a)=>{
  a.enableForSyntheticTests();const {intent,id}=pair();
  await a.createPair(intent,'seal',1000);
  await a.addExtraTaskFieldForSyntheticTest(id);
  const corrupt=await a.snapshot(id);
  await assert.rejects(a.createPair(intent,'seal',1000),/task_inconsistent/);
  assert.deepEqual(await a.snapshot(id),corrupt);
}));

test('a witness whose intent no longer hashes to its terminal ID fails closed',async()=>fixture(async(a)=>{
  a.enableForSyntheticTests();const {intent,id}=pair();
  await a.createPair(intent,'seal',1000);
  const other=intent==='b'.repeat(64)?'c'.repeat(64):'b'.repeat(64);
  await a.corruptWitnessIntentForSyntheticTest(id,other);
  const before=await a.snapshot(id);
  await assert.rejects(a.createPair(intent,'seal',1000),/witness_inconsistent/);
  await assert.rejects(a.claimNext('worker-a',1000,100),/witness_inconsistent/);
  assert.deepEqual(await a.snapshot(id),before);
}));

test('generation cannot overflow the safe integer when claiming a task',async()=>fixture(async(a)=>{
  a.enableForSyntheticTests();const {intent,id}=pair();
  await a.createPair(intent,'seal',1000);
  await a.corruptTaskNumberForSyntheticTest(id,'generation',Number.MAX_SAFE_INTEGER);
  const before=await a.snapshot(id);
  await assert.rejects(a.claimNext('worker-a',1000,100),/generation_exhausted/);
  assert.deepEqual(await a.snapshot(id),before);
}));

test('pending task with five attempts is inconsistent and cannot claim or advance',async()=>fixture(async(a)=>{
  a.enableForSyntheticTests();const {intent,id}=pair();
  await a.createPair(intent,'seal',1000);
  await a.corruptTaskNumberForSyntheticTest(id,'attempts',5);
  const before=await a.snapshot(id);
  await assert.rejects(a.claimNext('worker-a',1000,100),/task_inconsistent/);
  assert.deepEqual(await a.snapshot(id),before);
}));

test('a 404 retry that exceeds the synthetic clock range does not change the lease',async()=>fixture(async(a)=>{
  a.enableForSyntheticTests();const {intent,id}=pair();
  await a.createPair(intent,'seal',999_999_998);
  const claim=await a.claimNext('worker-a',999_999_998,2);
  const before=await a.snapshot(id);
  await assert.rejects(a.finish(claim,'not_found',999_999_999),/invalid_clock/);
  assert.deepEqual(await a.snapshot(id),before);
}));

test('two workers contending for one due task admit only one current lease',async()=>fixture(async(a,b)=>{
  a.enableForSyntheticTests();b.enableForSyntheticTests();const {intent,id}=pair();
  await a.createPair(intent,'seal',1000);
  const claims=await Promise.all([a.claimNext('worker-a',1000,100),b.claimNext('worker-b',1000,100)]);
  assert.equal(claims.filter(Boolean).length,1);
  const current=(await a.snapshot(id)).task;
  assert.equal(current.generation,1);assert.equal(current.lease.token,claims.find(Boolean).token);
  assert.equal(await b.claimNext('worker-b',1099,100),null);
}));

test('expired lease can be reclaimed and an old response cannot change the new lease',async()=>fixture(async(a,b)=>{
  a.enableForSyntheticTests();b.enableForSyntheticTests();const {intent,id}=pair('release');
  await a.createPair(intent,'release',1000);
  const old=await a.claimNext('worker-a',1000,100);
  const current=await b.claimNext('worker-b',1100,100);
  assert.equal(old.generation,1);assert.equal(current.generation,2);assert.notEqual(old.token,current.token);
  const before=await b.snapshot(id);
  assert.equal(await a.finish(old,'unverified',1101),'stale');
  assert.deepEqual(await b.snapshot(id),before);
  assert.equal(await b.finish(current,'unverified',1101),'needs_review');
  assert.equal(await a.finish(old,'captured',1102),'stale');
  const state=await b.snapshot(id);
  assert.equal(state.task.state,'needs_review');assert.equal(state.incidents.length,1);
  assert.equal(state.incidents[0].kind,'unverified');
}));

test('unverified creates one durable incident without an account assertion',async()=>fixture(async(a)=>{
  a.enableForSyntheticTests();const {intent,id}=pair();
  await a.createPair(intent,'seal',1000);
  const claim=await a.claimNext('worker-a',1000,100);
  assert.equal(await a.finish(claim,'unverified',1001),'needs_review');
  const before=await a.snapshot(id);
  assert.equal(before.incidents.length,1);assert.equal(before.incidents[0].terminalId,id);
  assert.equal(before.incidents[0].state,'open');assert.equal(before.incidents[0].kind,'unverified');
  assert.equal(before.incidents[0].id,id+'--unverified');
  assert.equal(Object.hasOwn(before.incidents[0],'accountId'),false);
  assert.equal(await a.finish(claim,'unverified',1002),'already_applied');
  assert.deepEqual(await a.snapshot(id),before);
  await assert.rejects(a.finish(claim,'captured',1002),/completion_conflict/);
}));

test('five synthetic 404 results back off, then create a durable unresolved incident',async()=>fixture(async(a)=>{
  a.enableForSyntheticTests();const {intent,id}=pair('release');
  await a.createPair(intent,'release',1000);let now=1000,last;
  for(let attempt=1;attempt<=5;attempt++){
    const claim=await a.claimNext('worker-a',now,5000);assert.ok(claim);
    const result=await a.finish(claim,'not_found',now+1);
    assert.equal(result,attempt===5?'needs_review':'retry');
    const state=await a.snapshot(id);assert.equal(state.task.attempts,attempt);
    assert.equal(state.incidents.length,attempt===5?1:0);
    assert.equal(await a.finish(claim,'not_found',now+2),'already_applied');
    if(attempt<5){assert.equal(await a.claimNext('worker-a',state.task.nextAttemptAt-1,5000),null);now=state.task.nextAttemptAt;}
    last=state;
  }
  assert.equal(last.task.state,'needs_review');assert.equal(last.incidents[0].kind,'not_found');
  assert.equal(last.incidents[0].id,id+'--not_found');
  assert.equal(last.incidents[0].state,'open');assert.equal(await a.claimNext('worker-a',now+100000,5000),null);
}));

test('a crash after staging a captured incident leaves lease and incident unchanged; retry records it once',async()=>fixture(async(a)=>{
  a.enableForSyntheticTests();const {intent,id}=pair();
  await a.createPair(intent,'seal',1000);const claim=await a.claimNext('worker-a',1000,1000);
  const before=await a.snapshot(id);
  await assert.rejects(a.finish(claim,'captured',1001,{failAfterIncidentStaged:true}),/synthetic_crash/);
  assert.deepEqual(await a.snapshot(id),before);
  assert.equal(await a.finish(claim,'captured',1002),'needs_review');
  const after=await a.snapshot(id);assert.equal(after.incidents.length,1);
  assert.equal(after.incidents[0].priority,'critical');assert.equal(after.incidents[0].state,'open');
  assert.equal(after.incidents[0].id,id+'--captured');
  assert.equal(await a.finish(claim,'captured',1003),'already_applied');
  assert.deepEqual(await a.snapshot(id),after);
  assert.equal(await a.createPair(intent,'seal',1004),'already_exists');
  assert.deepEqual(await a.snapshot(id),after);
}));

test('a malformed existing incident prevents completing or overwriting the leased task',async()=>fixture(async(a)=>{
  a.enableForSyntheticTests();const {intent,id}=pair();
  await a.createPair(intent,'seal',1000);const claim=await a.claimNext('worker-a',1000,1000);
  await a.injectBadIncidentForSyntheticTest(id,'captured');
  const before=await a.snapshot(id);
  await assert.rejects(a.finish(claim,'captured',1001),/incident_inconsistent/);
  assert.deepEqual(await a.snapshot(id),before);
  assert.equal(before.task.state,'pending');assert.equal(before.task.lease.token,claim.token);
}));

test('a damaged incident prevents treating a repeated terminal pair as verified',async()=>fixture(async(a)=>{
  a.enableForSyntheticTests();const {intent,id}=pair();
  await a.createPair(intent,'seal',1000);const claim=await a.claimNext('worker-a',1000,1000);
  await a.finish(claim,'captured',1001);
  await a.corruptExistingIncidentForSyntheticTest(id,'captured');
  const before=await a.snapshot(id);
  await assert.rejects(a.createPair(intent,'seal',1002),/incident_inconsistent/);
  await assert.rejects(a.finish(claim,'captured',1002),/incident_inconsistent/);
  assert.deepEqual(await a.snapshot(id),before);
}));
