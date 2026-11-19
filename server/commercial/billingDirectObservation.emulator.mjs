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

function mockAccount(f,scenario,pauseAt){
 const calls=[];let entered,open;
 const enteredPromise=new Promise(resolve=>{entered=resolve;}),openPromise=new Promise(resolve=>{open=resolve;});
 async function at(kind,identityKey,reservationId,seconds){
  calls.push(kind);assert.equal(identityKey,f.billing.identityKey);assert.equal(reservationId,f.billing.reservationId);
  if(seconds!==undefined)assert.equal(seconds,f.billing.seconds);
  if(kind===pauseAt){assert.equal(calls.filter(value=>value===kind).length,1,'the barrier may be entered only once');entered();await openPromise;}
 }
 const account={
  status:async(identityKey,reservationId)=>{await at('status',identityKey,reservationId);
   if(['seal-sealed','seal-released','seal-reserved'].includes(scenario))throw new AccountBillingFault('not_found');
   return {state:scenario==='status-released'?'released':'reserved',reservationId,seconds:f.billing.seconds};},
  seal:async(identityKey,reservationId,seconds)=>{await at('seal',identityKey,reservationId,seconds);
   assert.ok(['seal-sealed','seal-released','seal-reserved'].includes(scenario));const state=scenario==='seal-sealed'?'sealed':scenario==='seal-released'?'released':'reserved';
   return {state,reservationId,seconds,created:state==='sealed'};},
  settle:async(identityKey,reservationId,action,seconds)=>{await at(action,identityKey,reservationId,seconds);
   assert.equal(action,'release');assert.ok(['release-released','seal-reserved'].includes(scenario));return {state:'released',reservationId,seconds};},
 };
 return {account,calls,entered:enteredPromise,open};
}

async function withPausedResponse(f,scenario,pauseAt,mutate=async()=>{}){
 const mock=mockAccount(f,scenario,pauseAt),ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,mock.account);
 const draining=ai.drainExternalBilling();let timer,arrived=false;
 const boundary=await Promise.race([
  mock.entered.then(()=>{arrived=true;return 'entered';}),
  draining.then(()=> 'finished-before-barrier',()=> 'failed-before-barrier'),
  new Promise(resolve=>{timer=setTimeout(()=>resolve('timeout'),12000);}),
 ]);
 try{
  assert.equal(boundary,'entered','the selected fake Account call must pause before the mutation');
  assert.equal(arrived,true);assert.equal(mock.calls.filter(call=>call===pauseAt).length,1);
  await mutate();
 }catch(error){mock.open();clearTimeout(timer);await draining.catch(()=>undefined);throw error;}
 mock.open();clearTimeout(timer);const result=await draining;
 return {result,calls:mock.calls,barrierEntered:arrived};
}

async function facts(f){
 const [intent,origin,sealTask,releaseTask,incidents]=await Promise.all([f.intent.get(),f.origin.get(),f.seal.task.get(),f.release.task.get(),f.root.collection('billingIntentObservationIncidents').get()]);
 return {intentState:intent.get('state'),releaseConfirmed:intent.get('releaseConfirmed')??false,sealConfirmed:intent.get('sealConfirmed')??false,
  source:intent.get('releaseObservationSource')??intent.get('sealObservationSource')??null,marker:origin.get('terminalRecovery')??null,
  sealTaskExists:sealTask.exists,releaseTaskExists:releaseTask.exists,incidents:incidents.size,incidentRows:incidents.docs.map(doc=>({source:doc.get('source'),observedState:doc.get('observedState'),attribution:doc.get('attribution'),ownerBlocked:doc.get('ownerBlocked')}))};
}

const scenarios=[
 {name:'status-released',pause:'status',source:'status',action:'release',calls:['status']},
 {name:'seal-sealed',pause:'seal',source:'seal_ack',action:'seal',calls:['status','seal']},
 {name:'seal-released',pause:'seal',source:'seal_status',action:'release',calls:['status','seal']},
 {name:'release-released',pause:'release',source:'release_ack',action:'release',calls:['status','release']},
];

test('preflight restricts the fixture to the loopback demo and creates a synthetic root',async()=>{
 const f=await fixture();assert.equal((await f.root.get()).get('fixture'),'direct-observation-v1');
 assert.deepEqual((await f.origin.get()).get('terminalRecovery'),{protocol:1,sealPrepared:false,releasePrepared:false});
 assert.equal((await f.seal.terminal.get()).exists,false);assert.equal((await f.release.terminal.get()).exists,false);
});

for(const scenario of scenarios){
 test(`control ${scenario.name} closes only the verified synthetic intent`,{timeout:30000},async()=>{
  const f=await fixture();if(scenario.name==='release-released')await f.backend.fenceExternalBillingRelease(f.account,f.requestKey,f.billing);
  const run=await withPausedResponse(f,scenario.name,scenario.pause),actual=await facts(f);
  console.log(JSON.stringify({event:'direct-observation-control',scenario:scenario.name,barrierEntered:run.barrierEntered,calls:run.calls,...actual}));
  assert.deepEqual(run.calls,scenario.calls);assert.equal(run.result.intentsFailed,0);assert.equal(run.result.intentsRecovered,1);
  assert.equal(actual.intentState,'closed');assert.equal(actual.source,scenario.source);assert.equal(actual.incidents,0);
  assert.equal(actual[scenario.action==='seal'?'sealConfirmed':'releaseConfirmed'],true);
  if(scenario.name==='status-released'){assert.equal(actual.sealTaskExists,false);assert.equal(actual.releaseTaskExists,false);}
 });
 test(`changed history during ${scenario.name} cannot close and retains a review incident`,{timeout:30000},async()=>{
  const f=await fixture();if(scenario.name==='release-released')await f.backend.fenceExternalBillingRelease(f.account,f.requestKey,f.billing);
  const run=await withPausedResponse(f,scenario.name,scenario.pause,async()=>{
   if(scenario.name==='status-released')await f.origin.update({'terminalRecovery.sealPrepared':true});
   else{const pair=scenario.name.startsWith('seal')?f.seal:f.release;assert.equal((await pair.task.get()).exists,true);await pair.task.delete();}
  });
  const actual=await facts(f);
  console.log(JSON.stringify({event:'direct-observation-changed',scenario:scenario.name,barrierEntered:run.barrierEntered,calls:run.calls,...actual}));
  assert.deepEqual(run.calls,scenario.calls,'no additional financial action may follow the stale result');
  assert.deepEqual({closed:actual.intentState==='closed',incidents:actual.incidents},{closed:false,incidents:1},'changed history must not close and the observed result needs review');
  assert.equal(actual.incidentRows[0].source,scenario.source);
  assert.equal(actual.incidentRows[0].observedState,scenario.action==='seal'?'sealed':'released');
 });
}

test('a changed owner during direct status produces an unverified incident without blocking another account',{timeout:30000},async()=>{
 const f=await fixture(),run=await withPausedResponse(f,'status-released','status',async()=>f.identity.update({accountId:f.foreign})),actual=await facts(f);
 console.log(JSON.stringify({event:'direct-observation-owner-changed',barrierEntered:run.barrierEntered,calls:run.calls,...actual}));
 assert.deepEqual(run.calls,['status']);assert.notEqual(actual.intentState,'closed');assert.equal(actual.incidents,1);
 assert.equal(actual.incidentRows[0].source,'status');assert.equal(actual.incidentRows[0].attribution,'unverified');assert.equal(actual.incidentRows[0].ownerBlocked,false);
 assert.equal((await f.ref('billingGuards',f.account).get()).exists,false);assert.equal((await f.ref('billingGuards',f.foreign).get()).exists,false);
});

test('a job created during direct status is retained and the observed release needs review',{timeout:30000},async()=>{
 const f=await fixture();let jobId,jobBefore;
 const run=await withPausedResponse(f,'status-released','status',async()=>{
  jobId=await f.backend.reserve(f.account,f.inputId,f.requestKey,2,'translation:en',1,AI_CATALOG_VERSION,f.billing,undefined,f.uid);
  f.tracked.push(f.ref('jobs',jobId),f.ref('outbox',jobId),f.ref('artifacts',jobId));jobBefore=await f.ref('jobs',jobId).get();
 });
 const actual=await facts(f),jobAfter=await f.ref('jobs',jobId).get();
 console.log(JSON.stringify({event:'direct-observation-job-created',barrierEntered:run.barrierEntered,calls:run.calls,jobState:jobAfter.get('state'),...actual}));
 assert.deepEqual(run.calls,['status']);assert.equal(jobAfter.exists,true);assert.equal(jobAfter.get('state'),'queued');
 assert.deepEqual(jobAfter.data(),jobBefore.data());assert.ok(jobAfter.updateTime.isEqual(jobBefore.updateTime));
 assert.equal((await f.ref('billingIntentJobMarkers',f.witness.intentId).get()).get('jobId'),jobId);
 assert.notEqual(actual.intentState,'closed');assert.equal(actual.incidents,1);assert.equal(actual.incidentRows[0].source,'status');
});

test('a stale reserved status must not send release after the other action task changes',{timeout:30000},async()=>{
 const f=await fixture();await f.backend.fenceExternalBillingRelease(f.account,f.requestKey,f.billing);
 assert.deepEqual(await f.backend.prepareExternalIntentTerminal(f.witness,f.requestKey,'seal'),{state:'ready'});
 const run=await withPausedResponse(f,'release-released','status',async()=>f.seal.task.update({state:'leased',generation:1})),actual=await facts(f);
 console.log(JSON.stringify({event:'direct-observation-stale-reserved',barrierEntered:run.barrierEntered,calls:run.calls,...actual}));
 assert.deepEqual(run.calls,['status'],'a status based on changed history must not send release');
 assert.notEqual(actual.intentState,'closed');
});

test('a stale not-found status must not send seal after the other action task changes',{timeout:30000},async()=>{
 const f=await fixture();await f.backend.fenceExternalBillingRelease(f.account,f.requestKey,f.billing);
 assert.deepEqual(await f.backend.prepareExternalIntentTerminal(f.witness,f.requestKey,'release'),{state:'ready'});
 const run=await withPausedResponse(f,'seal-sealed','status',async()=>f.release.task.update({state:'leased',generation:1})),actual=await facts(f);
 console.log(JSON.stringify({event:'direct-observation-stale-not-found',barrierEntered:run.barrierEntered,calls:run.calls,...actual}));
 assert.deepEqual(run.calls,['status'],'a not-found status based on changed history must not send seal');
 assert.notEqual(actual.intentState,'closed');
});

test('a stale reserved seal response must not send release after its task changes',{timeout:30000},async()=>{
 const f=await fixture(),run=await withPausedResponse(f,'seal-reserved','seal',async()=>{
  assert.equal((await f.seal.task.get()).exists,true);await f.seal.task.update({state:'leased',generation:1});
 }),actual=await facts(f);
 console.log(JSON.stringify({event:'direct-observation-stale-seal-reserved',barrierEntered:run.barrierEntered,calls:run.calls,...actual}));
 assert.deepEqual(run.calls,['status','seal'],'a seal result based on changed history must not send release');
 assert.notEqual(actual.intentState,'closed');
});

async function enqueueWithPausedStatus(f,mutate=async()=>{}){
 const requestKey=randomUUID(),intentId=hash([f.account,requestKey]),reservationId=reservationFor(f.account,f.billing.identityKey,f.inputId,requestKey);
 const origin=f.ref('billingIntentWitnesses',intentId),intent=f.ref('billingIntents',intentId),calls=[];f.tracked.push(origin,intent,f.ref('requests',intentId),f.ref('billingIntentJobMarkers',intentId));
 let entered,open,timer,arrived=false;const enteredPromise=new Promise(resolve=>{entered=resolve;}),openPromise=new Promise(resolve=>{open=resolve;});
 const account={
  reserve:async(identityKey,id,seconds)=>{calls.push('reserve');assert.equal(identityKey,f.billing.identityKey);assert.equal(id,reservationId);assert.equal(seconds,2);throw new AccountBillingFault('conflict');},
  status:async(identityKey,id)=>{calls.push('status');assert.equal(identityKey,f.billing.identityKey);assert.equal(id,reservationId);entered();await openPromise;return {state:'released',reservationId,seconds:2};},
  seal:async()=>{calls.push('seal');throw Error('unexpected synthetic seal');},
  settle:async()=>{calls.push('settle');throw Error('unexpected synthetic settle');},
 };
 const ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,account),pending=ai.enqueue(f.account,f.inputId,'translation:en',1,requestKey,f.uid).then(value=>({value}),error=>({error}));
 const boundary=await Promise.race([enteredPromise.then(()=>{arrived=true;return 'entered';}),pending.then(()=> 'finished-before-barrier'),new Promise(resolve=>{timer=setTimeout(()=>resolve('timeout'),12000);})]);
 try{assert.equal(boundary,'entered','the synthetic status call must be paused');assert.equal(arrived,true);await mutate(origin,intent);}catch(error){open();clearTimeout(timer);await pending;throw error;}
 open();clearTimeout(timer);const result=await pending,doc=await intent.get(),orig=await origin.get(),allIncidents=await f.root.collection('billingIntentObservationIncidents').get(),incidents=allIncidents.docs.filter(row=>row.get('intentId')===intentId);
 return {result,calls,arrived,state:doc.get('state'),source:doc.get('releaseObservationSource')??null,marker:orig.get('terminalRecovery'),incidents:incidents.length};
}

test('enqueue control accepts released status without inventing a terminal pair',{timeout:30000},async()=>{
 const f=await fixture(),actual=await enqueueWithPausedStatus(f);
 console.log(JSON.stringify({event:'enqueue-status-control',barrierEntered:actual.arrived,calls:actual.calls,state:actual.state,source:actual.source,marker:actual.marker,incidents:actual.incidents}));
 assert.deepEqual(actual.calls,['reserve','status']);assert.equal(actual.result.error?.code,'conflict');assert.equal(actual.state,'closed');assert.equal(actual.source,'status');assert.equal(actual.incidents,0);
 assert.deepEqual(actual.marker,{protocol:1,sealPrepared:false,releasePrepared:false});
});

test('enqueue cannot close a released status after its origin changes',{timeout:30000},async()=>{
 const f=await fixture(),actual=await enqueueWithPausedStatus(f,async origin=>origin.update({'terminalRecovery.sealPrepared':true}));
 console.log(JSON.stringify({event:'enqueue-status-changed',barrierEntered:actual.arrived,calls:actual.calls,state:actual.state,source:actual.source,marker:actual.marker,incidents:actual.incidents}));
 assert.deepEqual(actual.calls,['reserve','status']);assert.equal(actual.result.value,undefined);
 assert.deepEqual({closed:actual.state==='closed',incidents:actual.incidents},{closed:false,incidents:1},'a stale status needs review and cannot close');
});
