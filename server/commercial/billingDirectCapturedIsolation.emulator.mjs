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

for(const scenario of [
 {name:'deleted intent',change:'intent',state:'captured',seconds:2},
 {name:'changed identity',change:'identity',state:'captured',seconds:2,unverified:true},
 {name:'deleted origin',change:'origin',state:'reserved',seconds:3,unverified:true},
 {name:'deleted intent and changed identity',change:'both',state:'reserved',seconds:3,unverified:true},
 {name:'status timeout',change:'identity',timeout:true,unverified:true},
]){
 test('direct anomalous observation with '+scenario.name,{timeout:30000},async()=>{
  const f=await fixture();let enter,resume,timer;
  const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{resume=resolve;}),calls=[];
  const account={status:async(identityKey,reservationId)=>{
   calls.push('status');assert.equal(identityKey,f.billing.identityKey);assert.equal(reservationId,f.billing.reservationId);
   enter();await gate;
   if(scenario.timeout)throw new AccountBillingFault('unavailable');
   return {reservationId,state:scenario.state,seconds:scenario.seconds};
  },seal:async()=>{calls.push('seal');throw Error('unexpected synthetic action');},settle:async()=>{calls.push('settle');throw Error('unexpected synthetic action');}};
  const ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,account),pending=ai.drainExternalBilling();
  try{
   await Promise.race([entered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('synthetic status barrier timed out')),10000);})]);
   if(['intent','both'].includes(scenario.change))await f.intent.delete();
   if(['identity','both'].includes(scenario.change))await f.identity.update({accountId:f.foreign});
   if(scenario.change==='origin')await f.origin.delete();
  }finally{clearTimeout(timer);resume();}
  const result=await pending,review=await f.root.collection('billingReviewIncidents').get(),observations=await f.root.collection('billingIntentObservationIncidents').get();
  const ownerGuard=await f.ref('billingGuards',f.account).get(),foreignGuard=await f.ref('billingGuards',f.foreign).get();
  console.log(JSON.stringify({event:'direct-anomalous-isolation',scenario:scenario.name,calls,intentsFailed:result.intentsFailed,review:review.size,observations:observations.size,ownerGuard:ownerGuard.exists,foreignGuard:foreignGuard.exists}));
  assert.deepEqual(calls,['status']);assert.equal(result.intentsFailed,1);assert.equal(foreignGuard.exists,false);
  if(scenario.timeout){assert.equal(review.size+observations.size,0,'a timeout is not an observation');assert.equal(ownerGuard.exists,false);return;}
  assert.ok(review.size+observations.size>=1,'a returned anomalous observation must be retained');
  assert.equal(observations.size,1);assert.equal(observations.docs[0].get('source'),'status');assert.equal(observations.docs[0].get('observedState'),scenario.state);assert.equal(observations.docs[0].get('observedSeconds'),scenario.seconds);
  if(scenario.unverified){
   assert.equal(ownerGuard.exists,false,'an unverified owner must not receive a guard');
   assert.equal(review.size,0,'unverified observation must not be written as an attributed review');
   assert.equal(observations.size,1);assert.equal(observations.docs[0].get('attribution'),'unverified');
  }
 });
}
