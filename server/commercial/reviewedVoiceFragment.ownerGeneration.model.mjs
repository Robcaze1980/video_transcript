// Executable design model. All fixtures and transactions are in memory.
// Run explicitly with node --test. No application module imports this file.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const namespace='synthetic-video-service';
const identityKey='synthetic-identity';
const reservationId='synthetic-reservation';
const scopeA=Object.freeze({ref:'account-origin-a',namespace,owner:'account-a',videoOwner:'video-a',
  identityKey,bindingGeneration:4,reservationId,reservationGeneration:'reservation-a-1',
  videoIntentId:'intent-a',seconds:3});
const scopeB=Object.freeze({...scopeA,ref:'account-origin-b',owner:'account-b',videoOwner:'video-b',
  bindingGeneration:5,reservationGeneration:'reservation-b-1',videoIntentId:'intent-b'});
const requestA=Object.freeze({originRef:scopeA.ref,videoOwner:scopeA.videoOwner,videoIntentId:scopeA.videoIntentId,
  identityKey,reservationId,seconds:3,jobId:'voice-job-a',attemptId:'attempt-a',
  callKey:'voice-chunk:0000',model:'gemini-3.8-flash-tts',requestSha256:'a'.repeat(64)});
const reserveKey=(owner,id)=>JSON.stringify([owner,id]);
const callId=(originRef,callKey)=>JSON.stringify([originRef,callKey]);

function fixture() {
  const reservation=scope=>({state:'reserved',owner:scope.owner,identityKey:scope.identityKey,
    reservationId:scope.reservationId,seconds:scope.seconds,originRef:scope.ref,
    generation:scope.reservationGeneration});
  return {
    // Both account rows can be compatible, as in the original counterexample.
    accounts:new Map([['account-a',{identityKey,available:17,reserved:3}],['account-b',{identityKey,available:27,reserved:3}]]),
    binding:{owner:scopeA.owner,videoOwner:scopeA.videoOwner,generation:scopeA.bindingGeneration,active:true},
    origins:new Map([[scopeA.ref,scopeA],[scopeB.ref,scopeB]]),
    reservations:new Map([[reserveKey(scopeA.owner,reservationId),reservation(scopeA)],
      [reserveKey(scopeB.owner,reservationId),reservation(scopeB)]]),
    receipts:new Map(),attempts:new Map(),holds:new Set(),movements:[],
  };
}

function handoff(state,scope,generation) {
  state.binding={owner:scope.owner,videoOwner:scope.videoOwner,generation,active:true};
}

// One synchronous reference transition stands for one Account commit. The
// service namespace is taken from the verified caller context in the design.
function admit(state,authenticatedNamespace,request) {
  if(!/^voice-chunk:0[0-9]{3}$/.test(request.callKey)||request.model!=='gemini-3.8-flash-tts'||
    !/^[a-f0-9]{64}$/.test(request.requestSha256))return 'conflict';
  const origin=state.origins.get(request.originRef);
  const live=state.binding;
  if(!origin||origin.ref!==request.originRef||origin.namespace!==authenticatedNamespace||
    origin.videoOwner!==request.videoOwner||origin.videoIntentId!==request.videoIntentId||
    origin.identityKey!==request.identityKey||origin.reservationId!==request.reservationId||origin.seconds!==request.seconds||
    !live.active||live.owner!==origin.owner||live.videoOwner!==origin.videoOwner||
    live.generation!==origin.bindingGeneration||state.accounts.get(origin.owner)?.identityKey!==origin.identityKey)return 'conflict';
  const reservation=state.reservations.get(reserveKey(origin.owner,origin.reservationId));
  if(!reservation||reservation.owner!==origin.owner||reservation.identityKey!==origin.identityKey||
    reservation.reservationId!==origin.reservationId||reservation.seconds!==origin.seconds||
    reservation.originRef!==origin.ref||reservation.generation!==origin.reservationGeneration)return 'conflict';
  const attempt={jobId:request.jobId,attemptId:request.attemptId,model:request.model};
  const first=state.attempts.get(origin.ref);
  if(first&&(first.jobId!==attempt.jobId||first.attemptId!==attempt.attemptId||first.model!==attempt.model))return 'conflict';
  const key=callId(origin.ref,request.callKey);
  const receipt=state.receipts.get(key);
  if(receipt)return receipt.requestSha256===request.requestSha256?'receiptOnly':'conflict';
  if(reservation.state!=='reserved'||state.holds.has(origin.owner))return 'conflict';
  if(!first)state.attempts.set(origin.ref,attempt);
  state.receipts.set(key,{...attempt,owner:origin.owner,bindingGeneration:origin.bindingGeneration,
    reservationGeneration:origin.reservationGeneration,requestSha256:request.requestSha256});
  return 'created';
}

function expectNoWrites(state,request=requestA,actor=namespace) {
  const before=structuredClone(state);
  assert.equal(admit(state,actor,request),'conflict');
  assert.deepEqual(state,before);
}

test('a compatible B reservation selected by the current UID cannot replace the A origin',()=>{
  const state=fixture();
  handoff(state,scopeB,5);
  const byCurrentOwner=state.reservations.get(reserveKey(state.binding.owner,reservationId));
  assert.equal(byCurrentOwner.owner,scopeB.owner);
  assert.equal(byCurrentOwner.seconds,requestA.seconds);
  assert.equal(byCurrentOwner.identityKey,requestA.identityKey);
  expectNoWrites(state,requestA);
  expectNoWrites(state,{...requestA,ownerAccountId:scopeB.owner});
  expectNoWrites(state,{...requestA,originRef:scopeB.ref});
  // B can still use a grant issued for B's own independently verified work.
  const requestB={...requestA,originRef:scopeB.ref,videoOwner:scopeB.videoOwner,videoIntentId:scopeB.videoIntentId,
    jobId:'voice-job-b',attemptId:'attempt-b'};
  assert.equal(admit(state,namespace,requestB),'created');
  assert.equal(state.receipts.size,1);
  assert.equal([...state.receipts.values()][0].owner,scopeB.owner);
});

test('the A-to-B-to-A round trip must fail against the original binding generation',()=>{
  const state=fixture();
  handoff(state,scopeB,5);
  handoff(state,scopeA,6);
  assert.equal(state.binding.owner,scopeA.owner);
  assert.equal(state.binding.videoOwner,scopeA.videoOwner);
  expectNoWrites(state);
});

test('recreating the same reservation ID and balance cannot recover the original generation',()=>{
  const state=fixture(),path=reserveKey(scopeA.owner,reservationId);
  state.reservations.set(path,{...state.reservations.get(path),generation:'reservation-a-2'});
  expectNoWrites(state);
});

test('an unknown issuer, revoked binding and legacy row cannot acquire a scope on admission',()=>{
  const state=fixture();
  expectNoWrites(state,requestA,'another-video-service');
  expectNoWrites(state,{...requestA,originRef:'not-issued-by-account'});
  state.binding.active=false;
  expectNoWrites(state);
  state.binding.active=true;
  state.origins.delete(scopeA.ref);
  expectNoWrites(state);
});

test('a valid original attempt keeps exact replay and independent ordinals, with one owner',()=>{
  const state=fixture(),balances=structuredClone(state.accounts);
  assert.notEqual(scopeA.owner,scopeA.videoOwner);
  assert.equal(admit(state,namespace,requestA),'created');
  const original=structuredClone(state);
  assert.equal(admit(state,namespace,requestA),'receiptOnly');
  assert.deepEqual(state,original);
  expectNoWrites(state,{...requestA,requestSha256:'b'.repeat(64)});
  expectNoWrites(state,{...requestA,attemptId:'another-attempt'});
  expectNoWrites(state,{...requestA,videoIntentId:scopeB.videoIntentId});
  expectNoWrites(state,{...requestA,callKey:'text-window:0001'});
  assert.equal(admit(state,namespace,{...requestA,callKey:'voice-chunk:0001',requestSha256:'b'.repeat(64)}),'created');
  assert.equal(state.receipts.size,2);
  assert.equal(state.attempts.size,1);
  assert.ok([...state.receipts.values()].every(receipt=>receipt.owner===scopeA.owner));
  assert.deepEqual(state.accounts,balances);
  assert.deepEqual(state.movements,[]);
});

test('if admission commits first, handoff preserves only the original historical receipt',()=>{
  const state=fixture();
  assert.equal(admit(state,namespace,requestA),'created');
  const historical=structuredClone(state.receipts);
  handoff(state,scopeB,5);
  expectNoWrites(state,requestA);
  expectNoWrites(state,{...requestA,callKey:'voice-chunk:0001',requestSha256:'b'.repeat(64)});
  assert.deepEqual(state.receipts,historical);
  assert.equal([...historical.values()][0].owner,scopeA.owner);
  assert.deepEqual(state.movements,[]);
});

test('an effective hold or terminal reservation fences new calls while an exact receipt remains readable',()=>{
  const state=fixture(),next={...requestA,callKey:'voice-chunk:0001',requestSha256:'b'.repeat(64)};
  assert.equal(admit(state,namespace,requestA),'created');
  state.holds.add(scopeA.owner);
  expectNoWrites(state,next);
  assert.equal(admit(state,namespace,requestA),'receiptOnly');
  state.holds.delete(scopeA.owner);
  state.reservations.get(reserveKey(scopeA.owner,reservationId)).state='released';
  expectNoWrites(state,next);
  assert.equal(admit(state,namespace,requestA),'receiptOnly');
  assert.equal(state.receipts.size,1);
  assert.deepEqual(state.movements,[]);
});
