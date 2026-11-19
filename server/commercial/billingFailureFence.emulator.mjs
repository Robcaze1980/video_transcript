// RED specification for a future failure fence. Only the test passes this
// provisional evidence; the current three-argument backend ignores it.
// There is no Account API, selector integration or external financial action.
import assert from 'node:assert/strict';
import {before,afterEach,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {accountIdentityKey,AccountBillingClient} from './accountBillingClient.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {objectPlan,privateBucket} from './privateObjectPlan.ts';
import {AI_CATALOG_VERSION} from './aiContracts.ts';

const host='127.0.0.1:8185',project='demo-vistavo-ledger',rootName='vistavo_billing_failure_fence_test',fixtures=[];
before(async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host,'requires the loopback emulator');
 assert.notEqual(process.env.NODE_ENV,'production');
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE','K_JOB','FUNCTION_TARGET','GAE_ENV'])assert.ok(!process.env[name],`${name} must be absent`);
 for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])assert.ok(!process.env[name]||process.env[name]===project,`${name} must be demo only`);
 assert.equal((await fetch(`http://${host}/`)).status,200);
});
afterEach(async()=>{
 for(const f of fixtures.splice(0)){await f.db.recursiveDelete(f.root);await f.db.terminate();await deleteApp(f.app);}
});

async function fixture({begin=true}={}){
 const id=randomUUID(),app=initializeApp({projectId:project},`billing-failure-fence-${id}`),db=getFirestore(app);
 db.settings({host,ssl:false,preferRest:true});const root=db.collection(rootName).doc(id);
 assert.equal(app.options.projectId,project);assert.equal(root.path,`${rootName}/${id}`);
 assert.equal(db._settings.servicePath,'127.0.0.1');assert.equal(db._settings.port,8185);assert.equal(db._settings.ssl,false);
 const backend=new FirestoreBackend(db,root),f={app,db,root,backend};fixtures.push(f);
 const uid=`synthetic-failure-fence-${id}`,account=await backend.accountForUid(uid),inputId=randomUUID(),requestKey=randomUUID();
 const billing={provider:'account_seconds',identityKey:accountIdentityKey(uid),reservationId:randomUUID(),seconds:2};
 await root.collection('accounts').doc(account).update({aiPilot:true,simulationOnly:true});
 const sha='a'.repeat(64);
 await root.collection('inputs').doc(inputId).create({accountId:account,deleted:false,expiresAtMs:Date.now()+300000,ready:true,sha256:sha,unknownCount:0,metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:objectPlan(inputId,12).final,generation:'1',size:12,sha256:sha}});
 await root.collection('projects').doc(inputId).create({accountId:account,inputId,revision:1,draft:'synthetic'});
 if(!begin)return {...f,uid,account,inputId,requestKey,billing};
 await backend.beginExternalBillingIntent(account,inputId,requestKey,'translation:en',1,billing);
 const matches=await root.collection('billingIntents').where('requestKey','==',requestKey).get();assert.equal(matches.size,1);
 const intent=matches.docs[0].ref,witness=await backend.externalIntentWitness(account,requestKey,billing);
 return {...f,uid,account,inputId,requestKey,billing,intent,witness};
}

// Proposed evidence is captured before a remote attempt. It is intentionally
// provisional until the independent design review chooses the final contract.
async function evidence(f,mode='unleased'){
 const doc=await f.intent.get(),at=doc.updateTime,admission=await f.root.collection('billingIntentAdmissionGuards').doc(f.witness.intentId).get(),guardAt=admission.updateTime;
 assert.ok(at);assert.ok(Number.isSafeInteger(at.seconds));assert.ok(Number.isSafeInteger(at.nanoseconds));
 assert.ok(guardAt);const base={mode,snapshotVersion:`${at.seconds}:${String(at.nanoseconds).padStart(9,'0')}`,intentGuardVersion:`${guardAt.seconds}:${String(guardAt.nanoseconds).padStart(9,'0')}`,state:doc.get('state'),witness:f.witness};
 if(mode==='unleased'){
  assert.equal(doc.get('leaseToken'),undefined);assert.equal(doc.get('leaseOwner'),undefined);assert.equal(doc.get('leaseUntil'),undefined);
  return base;
 }
 return {...base,leaseToken:doc.get('leaseToken'),leaseOwner:doc.get('leaseOwner'),generation:doc.get('generation'),leaseUntil:doc.get('leaseUntil')};
}

// A synthetic, transactional claim models a future selector; it does not call
// providers, the Account API, or the real drainer.
async function claim(f,now,leaseMs=120000){
 const token=randomUUID();return f.db.runTransaction(async tx=>{
  const d=await tx.get(f.intent),row=d.data();assert.equal(row.state,'reserve_pending');
  assert.ok(row.nextAttemptAt<=now);assert.ok(row.leaseUntil===undefined||row.leaseUntil<=now);
  const lease={leaseToken:token,leaseOwner:'synthetic-worker-b',generation:(row.generation??0)+1,leaseUntil:now+leaseMs};
  tx.update(f.intent,{...lease,nextAttemptAt:lease.leaseUntil});return lease;
 });
}

test('an unleased error cannot reschedule a lease acquired after its snapshot',async()=>{
 const f=await fixture(),before=await evidence(f),lease=await claim(f,Date.now()),claimed=(await f.intent.get()).data(),balance=await f.backend.readBalance(f.account);
 await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',before);
 const result=(await f.intent.get()).data();
 assert.deepEqual(result,claimed,'an old error must leave the new token, deadline, due time and counter untouched');
 assert.equal(result.leaseToken,lease.leaseToken);assert.equal(result.nextAttemptAt,lease.leaseUntil);assert.deepEqual(await f.backend.readBalance(f.account),balance);
});

test('an expired worker error cannot reschedule its replacement lease',async()=>{
 const f=await fixture(),past=Date.now()-3000;await f.intent.update({nextAttemptAt:past});
 const old=await claim(f,past,1000),before=await evidence(f,'leased');assert.ok(old.leaseUntil<Date.now());
 const replacement=await claim(f,Date.now()),claimed=(await f.intent.get()).data(),balance=await f.backend.readBalance(f.account);
 assert.notEqual(replacement.leaseToken,old.leaseToken);assert.equal(replacement.generation,old.generation+1);
 await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',before);
 assert.deepEqual((await f.intent.get()).data(),claimed,'a stale lease holder must not modify the replacement');
 assert.deepEqual(await f.backend.readBalance(f.account),balance);
});

test('retrying one failure with the same old snapshot does not increment or reschedule twice',async()=>{
 const f=await fixture(),before=await evidence(f),original=(await f.intent.get()).data();
 await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',before);
 const recorded=(await f.intent.get()).data();assert.equal(recorded.attempts,original.attempts+1);
 await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',before);
 assert.deepEqual((await f.intent.get()).data(),recorded,'duplicate evidence must not apply another failure');
});

test('an unleased error with unchanged evidence keeps existing retry scheduling',async()=>{
 const f=await fixture(),before=await evidence(f),original=(await f.intent.get()).data(),balance=await f.backend.readBalance(f.account),at=Date.now();
 await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',before);
 const recorded=(await f.intent.get()).data();assert.equal(recorded.state,original.state);assert.equal(recorded.attempts,original.attempts+1);
 assert.equal(recorded.lastErrorCode,'unavailable');assert.ok(Number.isSafeInteger(recorded.nextAttemptAt));assert.ok(recorded.nextAttemptAt>=at);
 assert.equal(recorded.leaseToken,undefined);assert.deepEqual(await f.backend.readBalance(f.account),balance);
});
test('a late failure cannot reschedule after the admission guard version changes',async()=>{
 const f=await fixture(),proof=await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey),admission=f.root.collection('billingIntentAdmissionGuards').doc(f.witness.intentId),before=(await f.intent.get()).data();assert.ok(proof);
 const original=await admission.get();await admission.update({createdAtMs:original.get('createdAtMs')+1});
 assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',proof),false);assert.deepEqual((await f.intent.get()).data(),before);
});

test('a matching current lease atomically records one backoff and releases only its own turn',async()=>{
 const f=await fixture(),lease=await claim(f,Date.now()),proof=await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey,undefined,lease);
 assert.ok(proof);assert.equal(proof.mode,'leased');const original=(await f.intent.get()).data(),at=Date.now();
 assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',proof),true);
 const row=(await f.intent.get()).data();assert.equal(row.state,'reserve_pending');assert.equal(row.generation,lease.generation);assert.equal(row.attempts,original.attempts+1);
 assert.equal(row.leaseToken,undefined);assert.equal(row.leaseOwner,undefined);assert.equal(row.leaseUntil,undefined);assert.ok(row.nextAttemptAt>=at);
 assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',proof),false);assert.deepEqual((await f.intent.get()).data(),row);
});

test('an expired lease is not released or rescheduled even if its snapshot still matches',async()=>{
 const f=await fixture(),past=Date.now()-3000;await f.intent.update({nextAttemptAt:past});
 const lease=await claim(f,past,1000),proof=await evidence(f,'leased'),before=(await f.intent.get()).data();assert.ok(lease.leaseUntil<Date.now());
 assert.equal(await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey,undefined,lease),null);
 assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',proof),false);assert.deepEqual((await f.intent.get()).data(),before);
});

test('changed evidence or financial tuple cannot release the current lease or move the balance',async()=>{
 const f=await fixture(),lease=await claim(f,Date.now()),proof=await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey,undefined,lease);assert.ok(proof);
 const before=(await f.intent.get()).data(),balance=await f.backend.readBalance(f.account);
 const altered=[
  {...proof,leaseToken:randomUUID()}, {...proof,leaseOwner:'synthetic-other'}, {...proof,generation:lease.generation+1}, {...proof,leaseUntil:lease.leaseUntil+1},
  {...proof,state:'release_pending'}, {...proof,snapshotVersion:'1:000000000'},
  {...proof,witness:{...proof.witness,reservationId:randomUUID()}}, {...proof,witness:{...proof.witness,seconds:proof.witness.seconds+1}},
  {...proof,witness:{...proof.witness,identityKey:'b'.repeat(64)}}, {...proof,witness:{...proof.witness,inputId:randomUUID()}},
 ];
 for(const changed of altered){assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',changed),false);assert.deepEqual((await f.intent.get()).data(),before);}
 assert.deepEqual(await f.backend.readBalance(f.account),balance);
});

test('extra lease properties cannot overwrite evidence fields',async()=>{
 const f=await fixture(),lease=await claim(f,Date.now()),baseline=await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey,undefined,lease),before=(await f.intent.get()).data();
 assert.ok(baseline);assert.equal(baseline.mode,'leased');
 const extras=[
  {snapshotVersion:'1:000000000'}, {intentGuardVersion:'1:000000000'}, {state:'release_pending'}, {witness:{...f.witness,reservationId:randomUUID()}}, {mode:'unleased'},
 ];
 for(const extra of extras){
  const proof=await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey,undefined,{...lease,...extra});
  assert.deepEqual(proof,baseline);assert.deepEqual((await f.intent.get()).data(),before);
 }
 assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',baseline),true);
});

// This checks accidental/forged extra properties only. Evidence is not an
// authenticated capability against an internal caller with arbitrary DB access.
test('a lease cannot mint failure evidence for another synthetic account through extra properties',async()=>{
 const f=await fixture(),lease=await claim(f,Date.now()),uid=`synthetic-other-${randomUUID()}`,otherAccount=await f.backend.accountForUid(uid),inputId=randomUUID(),requestKey=randomUUID();
 await f.root.collection('inputs').doc(inputId).create({accountId:otherAccount,deleted:false,expiresAtMs:Date.now()+300000});
 await f.root.collection('projects').doc(inputId).create({accountId:otherAccount,inputId,revision:1,draft:'synthetic'});
 const billing={provider:'account_seconds',identityKey:accountIdentityKey(uid),reservationId:randomUUID(),seconds:2};
 await f.backend.beginExternalBillingIntent(otherAccount,inputId,requestKey,'translation:en',1,billing);
 const otherWitness=await f.backend.externalIntentWitness(otherAccount,requestKey,billing),otherRef=f.root.collection('billingIntents').doc(otherWitness.intentId),otherDoc=await otherRef.get(),at=otherDoc.updateTime;
 const sourceBefore=(await f.intent.get()).data(),otherBefore=otherDoc.data(),sourceBalance=await f.backend.readBalance(f.account),otherBalance=await f.backend.readBalance(otherAccount);
 const attempted=await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey,undefined,{...lease,mode:'unleased',state:'reserve_pending',witness:otherWitness,snapshotVersion:`${at.seconds}:${String(at.nanoseconds).padStart(9,'0')}`});
 assert.ok(attempted);assert.equal(attempted.mode,'leased');assert.deepEqual(attempted.witness,f.witness);
 await assert.rejects(()=>f.backend.recordExternalBillingIntentFailure(otherAccount,requestKey,'unavailable',attempted),error=>error.code==='invalid');
 assert.deepEqual((await f.intent.get()).data(),sourceBefore);assert.deepEqual((await otherRef.get()).data(),otherBefore);
 assert.deepEqual(await f.backend.readBalance(f.account),sourceBalance);assert.deepEqual(await f.backend.readBalance(otherAccount),otherBalance);
 assert.equal((await f.root.collection('billingGuards').get()).size,0);assert.equal((await f.root.collection('billingHoldOutbox').get()).size,0);
});

test('a financial tuple modified after capture is not rescheduled or attributed to another owner',async()=>{
 for(const change of [
  {accountId:randomUUID()}, {identityKey:'c'.repeat(64)}, {reservationId:randomUUID()}, {seconds:3}, {operation:'narration:en:male'}, {inputId:randomUUID()},
 ]){
  const f=await fixture(),proof=await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey),balance=await f.backend.readBalance(f.account);
  assert.ok(proof);await f.intent.update(change);const changed=(await f.intent.get()).data();
  assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',proof),false);
  assert.deepEqual((await f.intent.get()).data(),changed);assert.deepEqual(await f.backend.readBalance(f.account),balance);
  assert.equal((await f.root.collection('billingGuards').get()).size,0);assert.equal((await f.root.collection('billingHoldOutbox').get()).size,0);
 }
});

test('a selected stale snapshot cannot be recaptured as evidence for that older operation',async()=>{
 const f=await fixture(),proof=await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey);assert.ok(proof);
 await f.intent.update({updatedAtMs:Date.now()+1});
 assert.equal(await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey,proof.snapshotVersion),null);
});

test('missing or corrupt evidence and an unverified owner do not mutate or assign a hold',async()=>{
 const f=await fixture(),before=(await f.intent.get()).data(),proof=await evidence(f),balance=await f.backend.readBalance(f.account);
 assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable'),false);
 await assert.rejects(()=>f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',{...proof,snapshotVersion:'broken'}),error=>error?.code==='invalid');
 assert.deepEqual((await f.intent.get()).data(),before);
 await f.intent.update({leaseToken:randomUUID()});const corrupted=(await f.intent.get()).data(),corruptProof=await evidence(f,'leased');
 await assert.rejects(()=>f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey),error=>error?.code==='invariant');
 await assert.rejects(()=>f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',corruptProof),error=>error?.code==='invalid');
 assert.deepEqual((await f.intent.get()).data(),corrupted);
 await f.root.collection('identities').doc(f.billing.identityKey).update({accountId:randomUUID()});
 assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',proof),false);
 assert.equal((await f.root.collection('billingGuards').get()).size,0);assert.equal((await f.root.collection('billingHoldOutbox').get()).size,0);assert.deepEqual(await f.backend.readBalance(f.account),balance);
});

test('a transition invalidates the old failure evidence; a later independent attempt can capture fresh evidence',async()=>{
 const f=await fixture(),proof=await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey);assert.ok(proof);
 assert.deepEqual(await f.backend.fenceExternalBillingRelease(f.account,f.requestKey,f.billing),{state:'release_pending'});
 const transitioned=(await f.intent.get()).data();assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',proof),false);
 assert.deepEqual((await f.intent.get()).data(),transitioned);
 // This is a new attempt before a new Account operation, not adoption after the old error.
 const fresh=await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey);assert.ok(fresh);assert.equal(fresh.state,'release_pending');
 assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',fresh),true);
});

test('a failed Firestore write does not invent a recorded backoff',async()=>{
 const f=await fixture(),proof=await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey),before=(await f.intent.get()).data(),original=f.db.runTransaction;
 try{f.db.runTransaction=async()=>{throw Error('synthetic unavailable before transaction');};await assert.rejects(()=>f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',proof),/synthetic unavailable/);}
 finally{f.db.runTransaction=original;}
 assert.deepEqual((await f.intent.get()).data(),before);
});

test('a lost local commit response cannot count the same error a second time',async()=>{
 const f=await fixture(),proof=await f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey),original=f.db.runTransaction.bind(f.db);
 try{f.db.runTransaction=async(callback,...options)=>{await original(callback,...options);throw Error('synthetic lost local response after commit');};
  await assert.rejects(()=>f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',proof),/lost local response/);
 }finally{f.db.runTransaction=original;}
 const committed=(await f.intent.get()).data();assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',proof),false);assert.deepEqual((await f.intent.get()).data(),committed);
});

test('a late synthetic ACK after replacement is retained for review while the old error is ignored',async()=>{
 const f=await fixture(),past=Date.now()-3000;await f.intent.update({nextAttemptAt:past});
 const old=await claim(f,past,1000),proof=await evidence(f,'leased');
 assert.deepEqual(await f.backend.fenceExternalBillingRelease(f.account,f.requestKey,f.billing),{state:'release_pending'});
 assert.deepEqual(await f.backend.prepareExternalIntentTerminal(f.witness,f.requestKey,'release'),{state:'ready'});
 const snapshot=await f.backend.captureDirectObservation(f.witness,f.requestKey,'release');assert.ok(snapshot);
 // This synthetic claim reflects the later release lane; there is no actual selector connection.
 const replacement={leaseToken:randomUUID(),leaseOwner:'synthetic-worker-c',generation:old.generation+1,leaseUntil:Date.now()+120000};
 await f.intent.update({...replacement,nextAttemptAt:replacement.leaseUntil});const current=(await f.intent.get()).data();
 assert.equal(await f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',proof),false);assert.deepEqual((await f.intent.get()).data(),current);
 const ack={reservationId:f.billing.reservationId,seconds:f.billing.seconds,state:'released'};
 assert.equal(await f.backend.finishExternalBillingRelease(f.account,f.requestKey,f.billing,ack,f.witness,'release_ack',snapshot),false);
 const recorded=await f.backend.recordConfirmedIntentObservation(f.witness,{action:'release',source:'release_ack',...ack},snapshot);assert.equal(recorded.state,'needs_review');assert.equal(recorded.ownerBlocked,true);
 const row=await f.intent.get();assert.equal(row.get('state'),'needs_review');assert.equal(row.get('releaseConfirmed'),undefined);assert.equal(row.get('leaseToken'),replacement.leaseToken);
 assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,1);
});

test('enqueue captures its unleased evidence before Account and a late error cannot disturb a new claim',async()=>{
 const f=await fixture({begin:false});let entered,resume,calls=0;
 const started=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{resume=resolve;});
 const client=new AccountBillingClient(undefined,{request:async request=>{
  calls++;if(new URL(request.url).pathname.endsWith('/reservations')){entered();await wait;}
  throw Object.assign(Error('synthetic Account unavailable'),{response:{status:503}});
 }}),ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,client);
 const task=ai.enqueue(f.account,f.inputId,'translation:en',1,f.requestKey,f.uid).then(value=>({value}),error=>({error}));
 try{
  await started;const docs=await f.root.collection('billingIntents').get();assert.equal(docs.size,1);f.intent=docs.docs[0].ref;
  const lease=await claim(f,Date.now()),claimed=(await f.intent.get()).data(),balance=await f.backend.readBalance(f.account);
  resume();const result=await task;assert.equal(result.error?.code,'unavailable');assert.equal(calls,2);
  assert.deepEqual((await f.intent.get()).data(),claimed);assert.equal(claimed.leaseToken,lease.leaseToken);assert.deepEqual(await f.backend.readBalance(f.account),balance);
 }finally{resume();await task;}
});

test('enqueue never sends reserve when the intent is already fenced at evidence capture',async()=>{
 const f=await fixture({begin:false});let calls=0,capturedState;
 const capture=f.backend.captureExternalBillingIntentFailureEvidence.bind(f.backend);
 f.backend.captureExternalBillingIntentFailureEvidence=async(witness,key,...rest)=>{
  assert.deepEqual(await f.backend.fenceExternalBillingRelease(f.account,key,witness),{state:'release_pending'});
  const result=await capture(witness,key,...rest);capturedState=result?.state;return result;
 };
 const client=new AccountBillingClient(undefined,{request:async()=>{calls++;throw Error('must not call synthetic Account');}}),ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,client);
 await assert.rejects(()=>ai.enqueue(f.account,f.inputId,'translation:en',1,f.requestKey,f.uid),error=>error.code==='unknown');
 assert.equal(capturedState,'release_pending');assert.equal(calls,0);assert.equal((await f.root.collection('jobs').get()).size,0);
 assert.equal((await f.root.collection('billingIntents').get()).docs[0].get('state'),'release_pending');
});

test('the unleased drainer error cannot overwrite a turn acquired during Account status',async()=>{
 const f=await fixture();let entered,resume,calls=0;
 const started=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{resume=resolve;});
 const client=new AccountBillingClient(undefined,{request:async request=>{
  calls++;assert.ok(new URL(request.url).pathname.endsWith('/status'));entered();await wait;
  throw Object.assign(Error('synthetic Account unavailable'),{response:{status:503}});
 }}),ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,client),task=ai.drainExternalBilling();
 try{
  await started;const lease=await claim(f,Date.now()),claimed=(await f.intent.get()).data();
  resume();const result=await task;assert.equal(result.intentsFailed,1);assert.equal(calls,1);
  assert.deepEqual((await f.intent.get()).data(),claimed);assert.equal(claimed.leaseToken,lease.leaseToken);
 }finally{resume();await task;}
});

test('a failed terminal call after the drainer own fence skips stale backoff and recovers on the next pass',async()=>{
 const f=await fixture();let seals=0;
 const client=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith('/status'))throw Object.assign(Error('synthetic missing status'),{response:{status:404}});
  if(path.endsWith('/seal')){seals++;if(seals===1)throw Object.assign(Error('synthetic timeout'),{response:{status:503}});
   return {data:{reservationId:f.billing.reservationId,seconds:f.billing.seconds,state:'sealed',created:true}};}
  throw Error('unexpected synthetic request');
 }}),ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,client),original=(await f.intent.get()).data();
 const first=await ai.drainExternalBilling();assert.equal(first.intentsFailed,1);const pending=(await f.intent.get()).data();
 assert.equal(pending.state,'release_pending');assert.equal(pending.attempts,original.attempts);assert.equal(pending.nextAttemptAt,0);assert.equal(pending.sealConfirmed,undefined);
 const second=await ai.drainExternalBilling();assert.equal(second.intentsRecovered,1);assert.equal(seals,2);
 const closed=await f.intent.get();assert.equal(closed.get('state'),'closed');assert.equal(closed.get('sealConfirmed'),true);
});

test('an observed synthetic terminal ACK with failed local persistence is not recorded as an ordinary error',async()=>{
 const f=await fixture();let errorRecords=0;
 const client=new AccountBillingClient(undefined,{request:async request=>{
  assert.ok(new URL(request.url).pathname.endsWith('/status'));
  return {data:{reservationId:f.billing.reservationId,seconds:f.billing.seconds,state:'released'}};
 }}),ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,client);
 const finish=f.backend.finishExternalBillingRelease,record=f.backend.recordConfirmedIntentObservation,failure=f.backend.recordExternalBillingIntentFailure,before=(await f.intent.get()).data();
 try{
  f.backend.finishExternalBillingRelease=async()=>{throw Error('synthetic Firestore outage');};
  f.backend.recordConfirmedIntentObservation=async()=>{throw Error('synthetic Firestore outage');};
  f.backend.recordExternalBillingIntentFailure=async(...args)=>{errorRecords++;return failure.apply(f.backend,args);};
  const result=await ai.drainExternalBilling();assert.equal(result.intentsFailed,1);assert.equal(errorRecords,0);
  assert.deepEqual((await f.intent.get()).data(),before);assert.equal((await f.root.collection('billingIntentWitnesses').get()).size,1);
 }finally{f.backend.finishExternalBillingRelease=finish;f.backend.recordConfirmedIntentObservation=record;f.backend.recordExternalBillingIntentFailure=failure;}
});

test('missing or invalid unleased due dates stop scheduling and Account calls without normalization',async()=>{
 const invalid=[FieldValue.delete(),'corrupt',null,-1,1.5];
 for(const due of invalid){
  const f=await fixture();await f.intent.update({nextAttemptAt:due});const before=(await f.intent.get()).data(),proof=await evidence(f),balance=await f.backend.readBalance(f.account);let calls=0;
  const client=new AccountBillingClient(undefined,{request:async()=>{calls++;throw Error('must not contact synthetic Account');}}),ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,client);
  await assert.rejects(()=>f.backend.captureExternalBillingIntentFailureEvidence(f.witness,f.requestKey),error=>error.code==='invariant');
  await assert.rejects(()=>f.backend.recordExternalBillingIntentFailure(f.account,f.requestKey,'unavailable',proof),error=>error.code==='invariant');
  await assert.rejects(()=>f.backend.beginExternalBillingIntent(f.account,f.inputId,f.requestKey,'translation:en',1,f.billing),error=>error.code==='invariant');
  await assert.rejects(()=>f.backend.fenceExternalBillingRelease(f.account,f.requestKey,f.billing),error=>error.code==='invariant');
  await assert.rejects(()=>f.backend.settleExternalBillingIntent(f.account,f.requestKey,'insufficient'),error=>error.code==='invariant');
  await assert.rejects(()=>f.backend.reserve(f.account,f.inputId,f.requestKey,2,'translation:en',1,AI_CATALOG_VERSION,f.billing,undefined,f.uid),error=>error.code==='invariant');
  const drained=await ai.drainExternalBilling();assert.equal(drained.intentsFailed,1);assert.equal(calls,0);
  assert.deepEqual((await f.intent.get()).data(),before);assert.deepEqual(await f.backend.readBalance(f.account),balance);
  assert.equal((await f.root.collection('jobs').get()).size,0);assert.equal((await f.root.collection('billingGuards').get()).size,0);assert.equal((await f.root.collection('billingHoldOutbox').get()).size,0);
 }
});

test('an invalid due date blocks preparing a new terminal POST but a confirmed ACK is still retained',async()=>{
 const f=await fixture();assert.deepEqual(await f.backend.fenceExternalBillingRelease(f.account,f.requestKey,f.billing),{state:'release_pending'});
 assert.deepEqual(await f.backend.prepareExternalIntentTerminal(f.witness,f.requestKey,'release'),{state:'ready'});
 const snapshot=await f.backend.captureDirectObservation(f.witness,f.requestKey,'release');assert.ok(snapshot);
 await f.intent.update({nextAttemptAt:'corrupt'});const before=(await f.intent.get()).data();
 await assert.rejects(()=>f.backend.prepareExternalIntentTerminal(f.witness,f.requestKey,'release'),error=>error.code==='invariant');
 assert.deepEqual((await f.intent.get()).data(),before);
 const ack={reservationId:f.billing.reservationId,seconds:f.billing.seconds,state:'released'};
 assert.equal(await f.backend.finishExternalBillingRelease(f.account,f.requestKey,f.billing,ack,f.witness,'release_ack',snapshot),false);
 const recorded=await f.backend.recordConfirmedIntentObservation(f.witness,{action:'release',source:'release_ack',...ack},snapshot);assert.equal(recorded.state,'needs_review');assert.equal(recorded.ownerBlocked,true);
 const reviewed=await f.intent.get();assert.equal(reviewed.get('state'),'needs_review');assert.equal(reviewed.get('releaseConfirmed'),undefined);assert.equal(reviewed.get('nextAttemptAt'),'corrupt');
 assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,1);
});
