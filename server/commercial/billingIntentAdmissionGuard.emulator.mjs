// RED integration checks for direct Account observations. Account is an in-memory fake.
// No network, real billing, provider calls, scheduler or production configuration is used.
import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingFault,accountIdentityKey} from './accountBillingClient.ts';
import {objectPlan,privateBucket} from './privateObjectPlan.ts';
import {AI_CATALOG_VERSION} from './aiContracts.ts';

const host='127.0.0.1:8185',project='demo-vistavo-ledger',collection='vistavo_direct_observation_synthetic',fixtures=[];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminalId=(intentId,action)=>hash(['billing-intent-terminal-v1',intentId,action]);
function reservationFor(account,identity,input,requestKey){
 const bytes=createHash('sha256').update(JSON.stringify(['vistavo-video-reservation-v1',account,identity,input,'translation:en',1,requestKey])).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

before(async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host,'requires loopback Firestore emulator');
 assert.equal(process.env.NODE_ENV,'test','requires NODE_ENV=test');
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE','K_JOB','FUNCTION_TARGET','GAE_ENV'])assert.ok(!process.env[name],`${name} must be absent`);
 for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])assert.ok(!process.env[name]||process.env[name]===project,`${name} must be the demo project`);
 assert.equal((await fetch(`http://${host}/`)).status,200);
});

afterEach(async()=>{
 for(const f of fixtures.splice(0)){
  try{
   const root=await f.root.get();
   if(root.exists){
    assert.equal(f.root.path,`${collection}/${f.id}`);assert.equal(root.get('fixture'),'direct-observation-v1');assert.equal(root.get('runId'),f.id);
    await f.db.recursiveDelete(f.root);
   }
   assert.equal((await f.root.get()).exists,false,'synthetic root must be absent after cleanup');
   if(f.tracked.length){const docs=await f.db.getAll(...f.tracked);assert.equal(docs.every(doc=>!doc.exists),true,'tracked synthetic documents must be absent');}
   assert.equal((await f.root.listCollections()).length,0,'synthetic subcollections must be empty');
   console.log(JSON.stringify({event:'direct-observation-cleanup',project,runId:f.id,tracked:f.tracked.length,allAbsent:true}));
  }finally{await f.db.terminate();await deleteApp(f.app);}
 }
});

async function fixture(){
 const id=randomUUID(),app=initializeApp({projectId:project},`direct-observation-${id}`),db=getFirestore(app);
 db.settings({host,ssl:false,preferRest:true});const root=db.collection(collection).doc(id),backend=new FirestoreBackend(db,root);
 assert.equal(app.options.projectId,project);assert.equal(root.path,`${collection}/${id}`);
 assert.equal(db._settings.servicePath,'127.0.0.1');assert.equal(db._settings.port,8185);assert.equal(db._settings.ssl,false);
 const f={id,app,db,root,backend,tracked:[]};fixtures.push(f);await root.create({fixture:'direct-observation-v1',runId:id});
 const uid=`synthetic-direct-owner-${id}`,foreignUid=`synthetic-direct-foreign-${id}`,account=await backend.accountForUid(uid),foreign=await backend.accountForUid(foreignUid);
 const inputId=randomUUID(),requestKey=randomUUID(),identityKey=accountIdentityKey(uid),billing={provider:'account_seconds',identityKey,reservationId:randomUUID(),seconds:2};
 const ref=(name,key)=>root.collection(name).doc(key),sha='a'.repeat(64);
 await ref('accounts',account).update({aiPilot:true,simulationOnly:true});
 await ref('inputs',inputId).create({accountId:account,deleted:false,expiresAtMs:Date.now()+300000,ready:true,sha256:sha,unknownCount:0,metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:objectPlan(inputId,12).final,generation:'1',size:12,sha256:sha}});
 await ref('projects',inputId).create({accountId:account,inputId,revision:1,draft:'synthetic'});
 await backend.beginExternalBillingIntent(account,inputId,requestKey,'translation:en',1,billing);
 const witness=await backend.externalIntentWitness(account,requestKey,billing),pairFor=action=>{const id=terminalId(witness.intentId,action);return {id,terminal:ref('billingIntentTerminalWitnesses',id),task:ref('billingIntentTerminalRecovery',id)};};
 Object.assign(f,{uid,foreignUid,account,foreign,inputId,requestKey,billing,witness,ref,origin:ref('billingIntentWitnesses',witness.intentId),intent:ref('billingIntents',witness.intentId),identity:ref('identities',identityKey),seal:pairFor('seal'),release:pairFor('release')});
 f.tracked.push(ref('accounts',account),ref('accounts',foreign),ref('identities',identityKey),ref('identities',accountIdentityKey(foreignUid)),ref('inputs',inputId),ref('projects',inputId),f.origin,f.intent,f.seal.terminal,f.seal.task,f.release.terminal,f.release.task,ref('requests',witness.intentId),ref('billingIntentJobMarkers',witness.intentId),ref('billingGuards',account),ref('billingGuards',foreign));
 return f;
}

async function createExternalJob(){
 const f=await fixture(),jobId=await f.backend.reserve(f.account,f.inputId,f.requestKey,2,'translation:en',1,AI_CATALOG_VERSION,f.billing,undefined,f.uid);
 f.tracked.push(f.ref('jobs',jobId),f.ref('outbox',jobId),f.ref('artifacts',jobId));
 const guard=f.ref('billingIntentAdmissionGuards',f.witness.intentId);f.tracked.push(guard);
 assert.deepEqual(Object.keys((await guard.get()).data()).sort(),['createdAtMs','intentId','protocol','state']);
 assert.equal((await guard.get()).get('state'),'clear');return {f,jobId,guard};
}
async function alterGuard(guard,mode){
 if(mode==='missing')return guard.delete();
 if(mode==='review')return guard.update({state:'needs_review',incidentId:'b'.repeat(64),updatedAtMs:Date.now()});
 if(mode==='malformed')return guard.update({extra:'unexpected'});
 if(mode==='future')return guard.update({protocol:2});
 throw Error('unknown synthetic mode');
}
for(const mode of ['review','missing','malformed','future']){
 test('admission '+mode+' blocks enqueue and dispatch while preserving lookup',async()=>{
  const {f,jobId,guard}=await createExternalJob(),before=(await f.ref('jobs',jobId).get()).data(),balance=await f.backend.readBalance(f.account);await alterGuard(guard,mode);
  const calls=[],account={reserve:async()=>{calls.push('reserve');throw Error('must not call Account');},status:async()=>{calls.push('status');throw Error('must not call Account');}};
  const ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,account);
  await assert.rejects(()=>ai.enqueue(f.account,f.inputId,'translation:en',1,f.requestKey,f.uid),error=>error.code==='conflict');
  const status=await ai.status(f.account,jobId,f.uid);assert.equal(status.state,'queued');assert.equal(status.billingState,'review');assert.deepEqual(status.results,[]);
  await assert.rejects(()=>ai.download(f.account,jobId,'translation-en.txt',f.uid),error=>error.code==='not_found');
  await f.ref('accounts',f.foreign).update({aiPilot:true,simulationOnly:true});
  await assert.rejects(()=>ai.status(f.foreign,jobId,f.foreignUid),error=>error.code==='not_found');
  assert.equal(await f.backend.priorRequest(f.account,f.inputId,f.requestKey,'translation:en',1,AI_CATALOG_VERSION),jobId);
  assert.equal((await f.backend.job(f.account,jobId)).state,'queued');await assert.rejects(()=>f.backend.job(f.foreign,jobId),error=>error.code==='not_found');
  assert.equal(await f.backend.aiDispatchEligible(jobId),false);
  await f.ref('outbox',jobId).update({nextAttemptAt:0,leaseUntil:null,dispatchAttempt:null});
  assert.equal(await f.backend.claimDispatch(jobId),null);assert.equal(await f.backend.claim(f.account,jobId),null);
  assert.deepEqual(calls,[]);assert.deepEqual((await f.ref('jobs',jobId).get()).data(),before);assert.deepEqual(await f.backend.readBalance(f.account),balance);
 });
 test('admission '+mode+' blocks status and each new provider call after job claim',async()=>{
  const {f,jobId,guard}=await createExternalJob(),attempt=await f.backend.claim(f.account,jobId);assert.ok(attempt);
  await f.ref('jobs',jobId).update({invocationPhase:'invoking'});const job=await f.backend.job(f.account,jobId);await alterGuard(guard,mode);
  const calls=[],account={status:async()=>{calls.push('status');return {reservationId:f.billing.reservationId,state:'reserved',seconds:2};},admit:async()=>{calls.push('admit');throw Error('must not admit');}};
  const ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,account);
  await assert.rejects(()=>ai.assertExternalReservation(job,jobId),error=>error.code==='conflict');
  const original=globalThis.fetch;let providerCalls=0;globalThis.fetch=async()=>{providerCalls++;throw Error('must not call provider');};
  try{await assert.rejects(()=>ai.invoke(f.account,jobId,attempt.attemptId,'synthetic-key')('text-window:0000','gemini-3.8-flash',{},new AbortController().signal),error=>error.code==='conflict');}finally{globalThis.fetch=original;}
  assert.deepEqual(calls,[]);assert.equal(providerCalls,0);assert.equal((await f.root.collection('providerCalls').get()).size,0);
 });
}
test('clear guard allows ordinary claim and Account status with a correlated job',async()=>{
 const {f,jobId}=await createExternalJob();assert.equal(await f.backend.aiDispatchEligible(jobId),true);
 const attempt=await f.backend.claim(f.account,jobId);assert.ok(attempt);const job=await f.backend.job(f.account,jobId),calls=[];
 const ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,{status:async()=>{calls.push('status');return {reservationId:f.billing.reservationId,state:'reserved',seconds:2};}});
 await ai.assertExternalReservation(job,jobId);assert.deepEqual(calls,['status']);
});
test('concurrent intent creators use one deterministic clear guard',async()=>{
 const f=await fixture(),requestKey=randomUUID(),billing={...f.billing,reservationId:randomUUID()},intentId=hash([f.account,requestKey]);
 f.tracked.push(f.ref('billingIntents',intentId),f.ref('billingIntentWitnesses',intentId),f.ref('billingIntentAdmissionGuards',intentId));
 const results=await Promise.all([f.backend.beginExternalBillingIntent(f.account,f.inputId,requestKey,'translation:en',1,billing),f.backend.beginExternalBillingIntent(f.account,f.inputId,requestKey,'translation:en',1,billing)]);
 assert.deepEqual(results,[null,null]);const [intent,origin,guard]=await Promise.all([f.ref('billingIntents',intentId).get(),f.ref('billingIntentWitnesses',intentId).get(),f.ref('billingIntentAdmissionGuards',intentId).get()]);
 assert.equal(intent.exists,true);assert.equal(origin.exists,true);assert.deepEqual(guard.data(),{protocol:1,intentId,state:'clear',createdAtMs:intent.get('createdAtMs')});
});
test('an interrupted transaction cannot create only part of the intent origin and guard',async()=>{
 const f=await fixture(),requestKey=randomUUID(),billing={...f.billing,reservationId:randomUUID()},intentId=hash([f.account,requestKey]),original=f.db.runTransaction.bind(f.db);
 const refs=['billingIntents','billingIntentWitnesses','billingIntentAdmissionGuards'].map(name=>f.ref(name,intentId));f.tracked.push(...refs);
 try{f.db.runTransaction=async(callback,...args)=>original(async tx=>{await callback(tx);throw Error('synthetic interruption before commit');},...args);
  await assert.rejects(()=>f.backend.beginExternalBillingIntent(f.account,f.inputId,requestKey,'translation:en',1,billing),/synthetic interruption before commit/);
 }finally{f.db.runTransaction=original;}
 assert.equal((await f.db.getAll(...refs)).every(doc=>!doc.exists),true);
});
test('a lost creation response reuses the committed intent origin and guard',async()=>{
 const f=await fixture(),requestKey=randomUUID(),billing={...f.billing,reservationId:randomUUID()},intentId=hash([f.account,requestKey]),original=f.db.runTransaction.bind(f.db);
 const refs=['billingIntents','billingIntentWitnesses','billingIntentAdmissionGuards'].map(name=>f.ref(name,intentId));f.tracked.push(...refs);
 try{f.db.runTransaction=async(callback,...args)=>{await original(callback,...args);throw Error('synthetic lost creation response');};
  await assert.rejects(()=>f.backend.beginExternalBillingIntent(f.account,f.inputId,requestKey,'translation:en',1,billing),/synthetic lost creation response/);
 }finally{f.db.runTransaction=original;}
 const before=await f.db.getAll(...refs);assert.equal(before.every(doc=>doc.exists),true);
 assert.equal(await f.backend.beginExternalBillingIntent(f.account,f.inputId,requestKey,'translation:en',1,billing),null);
 const after=await f.db.getAll(...refs);assert.ok(after[1].createTime.isEqual(before[1].createTime));assert.ok(after[2].createTime.isEqual(before[2].createTime));assert.deepEqual(after[2].data(),before[2].data());
});
test('a legacy intent missing its guard is not adopted or automatically reconstructed',async()=>{
 const f=await fixture(),guard=f.ref('billingIntentAdmissionGuards',f.witness.intentId),before=(await f.intent.get()).data(),balance=await f.backend.readBalance(f.account),calls=[];f.tracked.push(guard);await guard.delete();
 const account={status:async()=>{calls.push('status');throw Error('must not contact Account');}},ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,account);
 assert.equal(await f.backend.captureDirectObservation(f.witness,f.requestKey,'status'),null);
 await assert.rejects(()=>f.backend.beginExternalBillingIntent(f.account,f.inputId,f.requestKey,'translation:en',1,f.billing),error=>error.code==='conflict');
 await assert.rejects(()=>f.backend.recheckExternalBillingAdmission(f.account,f.requestKey,f.billing),error=>error.code==='conflict');
 await assert.rejects(()=>f.backend.reserve(f.account,f.inputId,f.requestKey,2,'translation:en',1,AI_CATALOG_VERSION,f.billing,undefined,f.uid),error=>error.code==='conflict');
 assert.equal((await ai.drainExternalBilling()).intentsFailed,1);assert.deepEqual(calls,[]);assert.equal((await guard.get()).exists,false);
 assert.deepEqual((await f.intent.get()).data(),before);assert.deepEqual(await f.backend.readBalance(f.account),balance);
});
test('a status already in flight is not cancelled, but the changed guard stops the next step',async()=>{
 const {f,jobId,guard}=await createExternalJob(),attempt=await f.backend.claim(f.account,jobId);assert.ok(attempt);
 const job=await f.backend.job(f.account,jobId);let entered,resume,timer;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{resume=resolve;}),calls=[];
 const ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,{status:async()=>{calls.push('status');entered();await gate;return {reservationId:f.billing.reservationId,state:'reserved',seconds:2};}});
 const pending=ai.assertExternalReservation(job,jobId).then(value=>({value}),error=>({error}));
 try{await Promise.race([started,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('synthetic status timeout')),10000);})]);await alterGuard(guard,'review');}finally{clearTimeout(timer);resume();}
 const result=await pending;assert.deepEqual(calls,['status']);assert.equal(result.error?.code,'conflict');assert.equal((await f.ref('jobs',jobId).get()).get('state'),'running');
});
test('an Account admission already in flight is retained while a changed guard prevents the provider request',async()=>{
 const {f,jobId,guard}=await createExternalJob(),attempt=await f.backend.claim(f.account,jobId);assert.ok(attempt);await f.ref('jobs',jobId).update({invocationPhase:'invoking'});
 let entered,resume,timer,providerCalls=0;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{resume=resolve;}),calls=[];
 const ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,{admit:async()=>{calls.push('admit');entered();await gate;return {created:true,receiptOnly:false};}}),original=globalThis.fetch;
 globalThis.fetch=async()=>{providerCalls++;throw Error('must not call provider');};
 try{
  const pending=ai.invoke(f.account,jobId,attempt.attemptId,'synthetic-key')('text-window:0000','gemini-3.8-flash',{},new AbortController().signal).then(value=>({value}),error=>({error}));
  try{await Promise.race([started,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('synthetic admit timeout')),10000);})]);await alterGuard(guard,'review');}finally{clearTimeout(timer);resume();}
  const result=await pending;assert.equal(result.error?.code,'conflict');assert.deepEqual(calls,['admit']);assert.equal(providerCalls,0);
  const receipts=await f.root.collection('providerCalls').get();assert.equal(receipts.size,1);assert.equal(receipts.docs[0].get('state'),'intent');
  assert.equal((await f.ref('jobs',jobId).get()).get('state'),'running');
 }finally{globalThis.fetch=original;}
});
