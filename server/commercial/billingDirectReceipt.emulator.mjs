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

test('an apparently identical direct replay is accepted as the same close it already wrote',async()=>{
 const f=await fixture();
 const snapshot=await f.backend.captureDirectObservation(f.witness,f.requestKey,'status');
 assert.ok(snapshot);
 const ack={reservationId:f.billing.reservationId,seconds:f.billing.seconds,state:'released'};
 assert.equal(await f.backend.finishExternalBillingRelease(f.account,f.requestKey,f.billing,ack,f.witness,'status',snapshot),true);
 const closed=await f.intent.get();
 assert.equal(closed.get('state'),'closed');
 // LV-019.B E-3: the identical re-close is the same close it already wrote, so it is accepted, not refused.
 assert.equal(await f.backend.finishExternalBillingRelease(f.account,f.requestKey,f.billing,ack,f.witness,'status',snapshot),true);
 const result=await f.backend.recordConfirmedIntentObservation(f.witness,{action:'release',source:'status',state:'released',reservationId:f.billing.reservationId,seconds:f.billing.seconds},snapshot);
 assert.equal(result.state,'already_closed');assert.equal(result.ownerBlocked,false);
 assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,0,'no incident for the exact close');
 assert.equal((await f.root.collection('billingReviewIncidents').doc(f.witness.intentId).get()).exists,false);
});

test('a direct replay over a closed intent with a changed tuple, or a missing confirmation, stays under review',async()=>{
 const changed=await fixture();
 const changedSnapshot=await changed.backend.captureDirectObservation(changed.witness,changed.requestKey,'status');
 const changedAck={reservationId:changed.billing.reservationId,seconds:changed.billing.seconds,state:'released'};
 assert.equal(await changed.backend.finishExternalBillingRelease(changed.account,changed.requestKey,changed.billing,changedAck,changed.witness,'status',changedSnapshot),true);
 // The stored confirmation no longer matches the observation: not the identical close.
 await changed.intent.update({releaseReservationId:randomUUID()});
 const different=await changed.backend.recordConfirmedIntentObservation(changed.witness,{action:'release',source:'status',state:'released',reservationId:changed.billing.reservationId,seconds:changed.billing.seconds},changedSnapshot);
 assert.equal(different.state,'needs_review');
 assert.equal((await changed.root.collection('billingIntentObservationIncidents').get()).size,1);
 const missing=await fixture();
 const missingSnapshot=await missing.backend.captureDirectObservation(missing.witness,missing.requestKey,'status');
 const missingAck={reservationId:missing.billing.reservationId,seconds:missing.billing.seconds,state:'released'};
 assert.equal(await missing.backend.finishExternalBillingRelease(missing.account,missing.requestKey,missing.billing,missingAck,missing.witness,'status',missingSnapshot),true);
 const data=(await missing.intent.get()).data();delete data.releaseConfirmed;delete data.releaseReservationId;delete data.releaseSeconds;
 await missing.intent.set(data);
 const absent=await missing.backend.recordConfirmedIntentObservation(missing.witness,{action:'release',source:'status',state:'released',reservationId:missing.billing.reservationId,seconds:missing.billing.seconds},missingSnapshot);
 assert.equal(absent.state,'needs_review');
});

test('an unrelated later field write on the closed intent is not a demonstrated divergence under the E-3 identity rule',async()=>{
 const f=await fixture();
 const snapshot=await f.backend.captureDirectObservation(f.witness,f.requestKey,'status');
 assert.ok(snapshot);
 const ack={reservationId:f.billing.reservationId,seconds:f.billing.seconds,state:'released'};
 assert.equal(await f.backend.finishExternalBillingRelease(f.account,f.requestKey,f.billing,ack,f.witness,'status',snapshot),true);
 await f.intent.update({syntheticLaterMutation:'after-close'});
 const before=await f.intent.get();
 // LV-019.B E-3 (design v2 3.2): the intent is compared by identity (same document, same confirmation), not by version, because the close itself
 // moved `intent.updateTime`. A later unrelated field write is therefore not a demonstrated divergence; only a changed tuple or a recreated
 // document is (covered by the neighboring tests).
 assert.equal(await f.backend.finishExternalBillingRelease(f.account,f.requestKey,f.billing,ack,f.witness,'status',snapshot),true);
 const after=await f.intent.get();
 assert.ok(after.updateTime.isEqual(before.updateTime));
 assert.deepEqual(after.data(),before.data());
 const result=await f.backend.recordConfirmedIntentObservation(f.witness,{action:'release',source:'status',state:'released',reservationId:f.billing.reservationId,seconds:f.billing.seconds},snapshot);
 assert.equal(result.state,'already_closed');
 assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,0);
});

test('a recreated closed intent cannot pass as the original close',async()=>{
 const f=await fixture();
 const snapshot=await f.backend.captureDirectObservation(f.witness,f.requestKey,'status');
 assert.ok(snapshot);
 const ack={reservationId:f.billing.reservationId,seconds:f.billing.seconds,state:'released'};
 assert.equal(await f.backend.finishExternalBillingRelease(f.account,f.requestKey,f.billing,ack,f.witness,'status',snapshot),true);
 const before=await f.intent.get(), data=before.data();
 await f.intent.delete();
 await f.intent.create(data);
 const recreated=await f.intent.get();
 assert.notEqual(recreated.createTime.toMillis(),before.createTime.toMillis());
 assert.equal(await f.backend.finishExternalBillingRelease(f.account,f.requestKey,f.billing,ack,f.witness,'status',snapshot),false);
 const result=await f.backend.recordConfirmedIntentObservation(f.witness,{action:'release',source:'status',state:'released',reservationId:f.billing.reservationId,seconds:f.billing.seconds},snapshot);
 assert.equal(result.state,'needs_review');
});
