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

async function changedFixture(){
 const f=await fixture(),snapshot=await f.backend.captureDirectObservation(f.witness,f.requestKey,'status');
 assert.ok(snapshot);const balance=await f.backend.readBalance(f.account);await f.intent.update({syntheticStatusRace:true});
 const observed={reservationId:f.billing.reservationId,state:'captured',seconds:f.billing.seconds};
 return {f,snapshot,balance,observed};
}
async function assertPreserved(f,observed,balance){
 const incidents=await f.root.collection('billingIntentObservationIncidents').get(),holds=await f.root.collection('billingHoldOutbox').get();
 assert.equal(incidents.size,1);assert.equal(holds.size,1);assert.equal(incidents.docs[0].get('observedState'),observed.state);
 assert.equal(incidents.docs[0].get('observedSeconds'),observed.seconds);assert.equal((await f.ref('billingGuards',f.account).get()).get('blocked'),true);
 const admission=await f.ref('billingIntentAdmissionGuards',f.witness.intentId).get();assert.equal(admission.get('state'),'needs_review');assert.equal(admission.get('incidentId'),incidents.docs[0].id);
 assert.equal((await f.ref('billingGuards',f.foreign).get()).exists,false);assert.deepEqual(await f.backend.readBalance(f.account),balance);
 return incidents.docs[0];
}
test('an identical anomalous observation is persisted idempotently',async()=>{
 const {f,snapshot,balance,observed}=await changedFixture();
 assert.equal((await f.backend.recordExternalBillingReview(f.account,f.requestKey,f.billing,observed,snapshot)).state,'needs_review');
 const first=await assertPreserved(f,observed,balance),prior=first.data(),version=first.updateTime;
 assert.equal((await f.backend.recordExternalBillingReview(f.account,f.requestKey,f.billing,observed,snapshot)).state,'needs_review');
 const after=await first.ref.get();assert.deepEqual(after.data(),prior);assert.ok(after.updateTime.isEqual(version));await assertPreserved(f,observed,balance);
});
test('concurrent identical anomalous observations create one incident and hold',async()=>{
 const {f,snapshot,balance,observed}=await changedFixture();
 const results=await Promise.all([f.backend.recordExternalBillingReview(f.account,f.requestKey,f.billing,observed,snapshot),f.backend.recordExternalBillingReview(f.account,f.requestKey,f.billing,observed,snapshot)]);
 assert.deepEqual(results.map(value=>value.state),['needs_review','needs_review']);await assertPreserved(f,observed,balance);
});
test('distinct observations remain separate while the guard keeps its first incident link',async()=>{
 const {f,snapshot,balance,observed}=await changedFixture(),other={reservationId:f.billing.reservationId,state:'reserved',seconds:3};
 const results=await Promise.all([f.backend.recordExternalBillingReview(f.account,f.requestKey,f.billing,observed,snapshot),f.backend.recordExternalBillingReview(f.account,f.requestKey,f.billing,other,snapshot)]);
 assert.deepEqual(results.map(value=>value.state),['needs_review','needs_review']);
 const rows=await f.root.collection('billingIntentObservationIncidents').get(),guard=await f.ref('billingIntentAdmissionGuards',f.witness.intentId).get();
 assert.equal(rows.size,2);assert.deepEqual(rows.docs.map(row=>row.get('observedState')).sort(),['captured','reserved']);
 assert.equal(guard.get('state'),'needs_review');assert.ok(rows.docs.some(row=>row.id===guard.get('incidentId')));
 assert.equal((await f.root.collection('billingHoldOutbox').get()).size,1);assert.deepEqual(await f.backend.readBalance(f.account),balance);
});
test('a lost local response after incident commit does not duplicate it',async()=>{
 const {f,snapshot,balance,observed}=await changedFixture(),original=f.db.runTransaction.bind(f.db);
 try{
  f.db.runTransaction=async(callback,...args)=>{await original(callback,...args);throw Error('synthetic lost local response');};
  await assert.rejects(()=>f.backend.recordExternalBillingReview(f.account,f.requestKey,f.billing,observed,snapshot),/synthetic lost local response/);
 }finally{f.db.runTransaction=original;}
 const first=await assertPreserved(f,observed,balance),version=first.updateTime;
 assert.equal((await f.backend.recordExternalBillingReview(f.account,f.requestKey,f.billing,observed,snapshot)).state,'needs_review');
 const after=await first.ref.get();assert.ok(after.updateTime.isEqual(version));await assertPreserved(f,observed,balance);
});
test('a Firestore failure before incident commit is not treated as preserved',async()=>{
 const {f,snapshot,balance,observed}=await changedFixture(),original=f.db.runTransaction.bind(f.db);
 try{
  f.db.runTransaction=async()=>{throw Error('synthetic Firestore failure before commit');};
  await assert.rejects(()=>f.backend.recordExternalBillingReview(f.account,f.requestKey,f.billing,observed,snapshot),/synthetic Firestore failure before commit/);
 }finally{f.db.runTransaction=original;}
 assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,0);assert.equal((await f.ref('billingGuards',f.account).get()).exists,false);
 assert.equal((await f.ref('billingIntentAdmissionGuards',f.witness.intentId).get()).get('state'),'clear');
 assert.deepEqual(await f.backend.readBalance(f.account),balance);
 assert.equal((await f.backend.recordExternalBillingReview(f.account,f.requestKey,f.billing,observed,snapshot)).state,'needs_review');
 await assertPreserved(f,observed,balance);
});
