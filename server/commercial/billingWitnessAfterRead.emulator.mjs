// Synthetic post-resolution checks. No actual Account API, provider or cloud.
// These tests address resolution_status, not the separate direct-status path.
import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {FirestoreBackend,copyTerminalRecoveryReadSnapshot} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';

const host='127.0.0.1:8185',project='demo-vistavo-ledger',collection='vistavo_witness_after_read_synthetic',fixtures=[];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminalId=(intentId,action)=>hash(['billing-intent-terminal-v1',intentId,action]);
const timestamp=value=>value?`${value.seconds}:${String(value.nanoseconds).padStart(9,'0')}`:null;

before(async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host,'requires loopback Firestore Emulator');
 assert.equal(process.env.NODE_ENV,'test','requires synthetic NODE_ENV=test');
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE','K_JOB','FUNCTION_TARGET','GAE_ENV'])assert.ok(!process.env[name],`${name} must be absent`);
 for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])assert.ok(!process.env[name]||process.env[name]===project,`${name} must be the demo project`);
 assert.equal((await fetch(`http://${host}/`)).status,200);
});

afterEach(async()=>{
 for(const f of fixtures.splice(0)){
  try{
   const root=await f.root.get();
   assert.equal(f.root.path,`${collection}/${f.id}`);assert.equal(root.get('fixture'),'witness-after-read-v1');assert.equal(root.get('runId'),f.id);
   await f.db.recursiveDelete(f.root);
   assert.equal((await f.root.get()).exists,false,'synthetic root must be removed');
   if(f.tracked.length){const docs=await f.db.getAll(...f.tracked);assert.equal(docs.every(doc=>!doc.exists),true,'tracked synthetic documents must be removed');}
   assert.equal((await f.root.listCollections()).length,0,'synthetic subcollections must be empty');
   console.log(JSON.stringify({event:'witness-after-read-cleanup',project,runId:f.id,tracked:f.tracked.length,allAbsent:true}));
  }finally{await f.db.terminate();await deleteApp(f.app);}
 }
});

async function fixture(action,{both=true}={}){
 const id=randomUUID(),app=initializeApp({projectId:project},`witness-after-read-${id}`),db=getFirestore(app);
 db.settings({host,ssl:false,preferRest:true});const root=db.collection(collection).doc(id),backend=new FirestoreBackend(db,root);
 assert.equal(app.options.projectId,project);assert.equal(root.path,`${collection}/${id}`);
 assert.equal(db._settings.servicePath,'127.0.0.1');assert.equal(db._settings.port,8185);assert.equal(db._settings.ssl,false);
 const f={id,app,db,root,backend,tracked:[]};fixtures.push(f);await root.create({fixture:'witness-after-read-v1',runId:id});
 const uid=`synthetic-after-read-${id}`,foreignUid=`synthetic-after-read-foreign-${id}`,account=await backend.accountForUid(uid),foreign=await backend.accountForUid(foreignUid),inputId=randomUUID(),requestKey=randomUUID();
 const billing={provider:'account_seconds',identityKey:accountIdentityKey(uid),reservationId:randomUUID(),seconds:2};
 const ref=(name,key)=>root.collection(name).doc(key);
 await ref('inputs',inputId).create({accountId:account,deleted:false,expiresAtMs:Date.now()+300000});
 await ref('projects',inputId).create({accountId:account,inputId,revision:1,draft:'synthetic'});
 await backend.beginExternalBillingIntent(account,inputId,requestKey,'translation:en',1,billing);
 const witness=await backend.externalIntentWitness(account,requestKey,billing);
 assert.deepEqual(await backend.fenceExternalBillingRelease(account,requestKey,billing),{state:'release_pending'});
 assert.deepEqual(await backend.prepareExternalIntentTerminal(witness,requestKey,action),{state:'ready'});
 const otherAction=action==='seal'?'release':'seal';
 if(both)assert.deepEqual(await backend.prepareExternalIntentTerminal(witness,requestKey,otherAction),{state:'ready'});
 const pairFor=a=>{const key=terminalId(witness.intentId,a);return {id:key,terminal:ref('billingIntentTerminalWitnesses',key),task:ref('billingIntentTerminalRecovery',key)};};
 const pair=pairFor(action),other=pairFor(otherAction),origin=ref('billingIntentWitnesses',witness.intentId),intent=ref('billingIntents',witness.intentId),identity=ref('identities',billing.identityKey);
 Object.assign(f,{uid,foreignUid,account,foreign,inputId,requestKey,billing,witness,action,otherAction,pair,other,origin,intent,identity});
 f.tracked.push(ref('accounts',account),ref('accounts',foreign),identity,ref('inputs',inputId),ref('projects',inputId),origin,intent,pair.terminal,pair.task,other.terminal,other.task,ref('billingGuards',account),ref('billingGuards',foreign));
 return f;
}

function simulatedResolution(f,state,{pause=false}={}){
 let calls=0,entered,release;const reached=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 const client=new AccountBillingClient(undefined,{request:async request=>{
  calls++;assert.ok(new URL(request.url).pathname.endsWith('/resolution'));
  assert.equal(request.data.identityKey,f.witness.identityKey);assert.equal(request.data.seconds,f.witness.seconds);
  entered();if(pause)await resume;
  if(state==='not_found')throw Object.assign(Error('synthetic not found'),{response:{status:404}});
  return {data:{reservationId:f.witness.reservationId,seconds:f.witness.seconds,state}};
 }});
 return {ai:new FirestoreAi(f.db,f.root,f.backend,{},undefined,client),reached,resume:()=>release(),calls:()=>calls};
}

async function raceAfterPreRead(f,change,{ownerUnverified=false}={}){
 const terminalState=f.action==='seal'?'sealed':'released',sim=simulatedResolution(f,terminalState,{pause:true});
 const task=sim.ai.recoverTerminalObservation(f.pair.id).then(result=>({result}),error=>({error}));
 try{
  const phase=await Promise.race([sim.reached.then(()=> 'at_account'),task.then(()=> 'finished')]);
  assert.equal(phase,'at_account','the complete pre-read must finish before synthetic Account pauses');
  await change(f);sim.resume();const outcome=await task;
  assert.equal(outcome.error,undefined);assert.equal(outcome.result?.state,'needs_review','changed pre-read evidence must not close');
  assert.notEqual((await f.intent.get()).get('state'),'closed');
  const incidents=await f.root.collection('billingIntentObservationIncidents').get();assert.equal(incidents.size,1,'the confirmed synthetic observation must be preserved when Firestore is available');
  const incident=incidents.docs[0];assert.equal(incident.get('source'),'resolution_status');assert.equal(incident.get('observedState'),terminalState);
  assert.equal((await f.root.collection('billingGuards').doc(f.foreign).get()).exists,false,'never block the other synthetic owner');
  if(ownerUnverified){
   assert.equal(outcome.result.ownerBlocked,false);assert.equal((await f.root.collection('billingGuards').doc(f.account).get()).exists,false);
   assert.equal((await f.root.collection('billingHoldOutbox').get()).size,0);
  }
  assert.equal(sim.calls(),1);
 }finally{sim.resume();await task;}
}

for(const action of ['seal','release']){
 const terminalState=action==='seal'?'sealed':'released';
 test(`coherent ${action} resolution closes once and its replay is idempotent`,{timeout:20000},async()=>{
  const f=await fixture(action),sim=simulatedResolution(f,terminalState);
  assert.equal((await sim.ai.recoverTerminalObservation(f.pair.id)).state,'closed');
  assert.equal((await sim.ai.recoverTerminalObservation(f.pair.id)).state,'already_closed');
  assert.equal(sim.calls(),2);assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,0);
 });

 const changes=[
  ['selected origin marker changed',async f=>f.origin.update({[`terminalRecovery.${action}Prepared`]:false})],
  ['origin marker removed',async f=>f.origin.update({terminalRecovery:FieldValue.delete()})],
  ['origin extra field added',async f=>f.origin.update({unexpected:'synthetic-corruption'})],
  ['selected task deleted',async f=>f.pair.task.delete()],
  ['selected task changed',async f=>f.pair.task.update({state:'leased',generation:1})],
  ['selected witness gains a field',async f=>f.pair.terminal.update({unexpected:'synthetic-corruption'})],
  ['opposite witness deleted',async f=>f.other.terminal.delete()],
  ['opposite task deleted',async f=>f.other.task.delete()],
  ['opposite marker changed',async f=>f.origin.update({[`terminalRecovery.${f.otherAction}Prepared`]:false})],
  ['job marker added',async f=>f.root.collection('billingIntentJobMarkers').doc(f.witness.intentId).create({jobId:randomUUID()})],
 ];
 for(const [name,change] of changes)test(`${action} observation requires review when ${name} after pre-read`,{timeout:20000},async()=>{
  const f=await fixture(action);await raceAfterPreRead(f,change);
 });

 test(`${action} observation requires review after selected task is deleted and recreated at the same ID`,{timeout:20000},async()=>{
  const f=await fixture(action);await raceAfterPreRead(f,async()=>{
   const first=await f.pair.task.get(),data=first.data(),created=timestamp(first.createTime);
   await f.pair.task.delete();await f.pair.task.create(data);const replaced=await f.pair.task.get();
   assert.notEqual(timestamp(replaced.createTime),created,'the emulator must expose the observed replacement for this test');
  });
 });

 test(`${action} observation requires review after task data is changed then restored`,{timeout:20000},async()=>{
  const f=await fixture(action);await raceAfterPreRead(f,async()=>{
   const first=await f.pair.task.get(),version=timestamp(first.updateTime);await f.pair.task.update({attempts:1});await f.pair.task.update({attempts:0});
   const restored=await f.pair.task.get();assert.deepEqual(restored.data(),first.data());assert.notEqual(timestamp(restored.updateTime),version,'the emulator must expose the changed version');
  });
 });

 test(`${action} observation cannot silently close when the opposite pair appears after pre-read`,{timeout:20000},async()=>{
  const f=await fixture(action,{both:false});await raceAfterPreRead(f,async()=>{
   assert.deepEqual(await f.backend.prepareExternalIntentTerminal(f.witness,f.requestKey,f.otherAction),{state:'ready'});
  });
 });

 test(`${action} observation after identity changes does not block either owner`,{timeout:20000},async()=>{
  const f=await fixture(action);await raceAfterPreRead(f,async()=>f.identity.update({accountId:f.foreign}),{ownerUnverified:true});
 });
}

for(const state of ['not_found','reserved','captured'])test(`${state} resolution remains unresolved without inventing a terminal receipt`,{timeout:20000},async()=>{
 const f=await fixture('seal'),before=(await f.intent.get()).data(),sim=simulatedResolution(f,state);
 assert.deepEqual(await sim.ai.recoverTerminalObservation(f.pair.id),{state:'unresolved',reason:state});assert.equal(sim.calls(),1);
 assert.deepEqual((await f.intent.get()).data(),before);assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,0);
 assert.equal((await f.root.collection('billingGuards').get()).size,0);assert.equal((await f.root.collection('billingHoldOutbox').get()).size,0);
});

for(const invalid of [
 ['missing',()=>undefined], ['null',()=>null], ['empty',()=>({})],
 ['malformed origin version',snapshot=>({...snapshot,origin:{exists:true,createTime:'bad',updateTime:'bad'}})],
 ['inherited timestamp fields',snapshot=>({...snapshot,origin:Object.assign(Object.create({createTime:snapshot.origin.createTime,updateTime:snapshot.origin.updateTime}),{exists:true,decoyA:true,decoyB:true})})],
 ['different intent',snapshot=>({...snapshot,intentId:'f'.repeat(64)})],
 ['different action',snapshot=>({...snapshot,action:'release'})],
 ['unexpected snapshot field',snapshot=>({...snapshot,unexpected:true})],
])test(`resolution with ${invalid[0]} snapshot cannot close or block an unverified owner`,{timeout:20000},async()=>{
 const f=await fixture('seal'),candidate=await f.backend.terminalWitnessForRecovery(f.pair.id);assert.ok(candidate);
 const observed={action:'seal',source:'resolution_status',terminalAction:'seal',state:'sealed',reservationId:f.witness.reservationId,seconds:f.witness.seconds};
 const result=await f.backend.recordConfirmedIntentObservation(f.witness,observed,invalid[1](candidate.snapshot));
 assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,false);assert.notEqual((await f.intent.get()).get('state'),'closed');
 const incidents=await f.root.collection('billingIntentObservationIncidents').get();assert.equal(incidents.size,1);assert.equal(incidents.docs[0].get('historySnapshotState'),'missing_or_invalid');
 assert.equal((await f.root.collection('billingGuards').get()).size,0);assert.equal((await f.root.collection('billingHoldOutbox').get()).size,0);
});

test('resolution with an inherited absence flag cannot close or block an unverified owner',{timeout:20000},async()=>{
 const f=await fixture('seal',{both:false}),candidate=await f.backend.terminalWitnessForRecovery(f.pair.id);assert.ok(candidate);
 const snapshot={...candidate.snapshot,releaseWitness:Object.assign(Object.create({exists:false}),{decoy:true})};
 const observed={action:'seal',source:'resolution_status',terminalAction:'seal',state:'sealed',reservationId:f.witness.reservationId,seconds:f.witness.seconds};
 const result=await f.backend.recordConfirmedIntentObservation(f.witness,observed,snapshot);
 assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,false);assert.notEqual((await f.intent.get()).get('state'),'closed');
 assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,1);assert.equal((await f.root.collection('billingGuards').get()).size,0);
});

test('a missing resolution snapshot cannot claim already_closed or discard its observation',{timeout:20000},async()=>{
 const f=await fixture('seal'),sim=simulatedResolution(f,'sealed');assert.equal((await sim.ai.recoverTerminalObservation(f.pair.id)).state,'closed');
 const observed={action:'seal',source:'resolution_status',terminalAction:'seal',state:'sealed',reservationId:f.witness.reservationId,seconds:f.witness.seconds};
 const result=await f.backend.recordConfirmedIntentObservation(f.witness,observed);assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,false);
 const closed=await f.intent.get();assert.equal(closed.get('state'),'closed');assert.equal(closed.get('sealConfirmed'),true);
 assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,1);assert.equal((await f.root.collection('billingGuards').get()).size,0);
});

test('resolution snapshots are copied before the closing transaction awaits',{timeout:20000},async()=>{
 const f=await fixture('seal'),candidate=await f.backend.terminalWitnessForRecovery(f.pair.id);assert.ok(candidate);
 const snapshot=candidate.snapshot,observed={action:'seal',source:'resolution_status',terminalAction:'seal',state:'sealed',reservationId:f.witness.reservationId,seconds:f.witness.seconds};
 let entered,release;const reached=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;}),original=f.db.runTransaction.bind(f.db);
 f.db.runTransaction=(callback,...options)=>original(async tx=>{entered();await resume;return callback(tx);},...options);
 const task=f.backend.recordConfirmedIntentObservation(f.witness,observed,snapshot).then(result=>({result}),error=>({error}));
 try{
  await reached;snapshot.intentId='f'.repeat(64);snapshot.action='release';snapshot.origin.updateTime='1:000000000';snapshot.sealWitness.exists=false;
  release();const outcome=await task;assert.equal(outcome.error,undefined);assert.equal(outcome.result.state,'closed');
  assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,0);
 }finally{release();await task;f.db.runTransaction=original;}
});

test('recovery copies witness and snapshot before waiting for the Account response',{timeout:20000},async()=>{
 const f=await fixture('seal'),original=f.backend.terminalWitnessForRecovery.bind(f.backend);let shared;
 f.backend.terminalWitnessForRecovery=async(...args)=>{shared=await original(...args);return shared;};
 const sim=simulatedResolution(f,'sealed',{pause:true}),task=sim.ai.recoverTerminalObservation(f.pair.id).then(result=>({result}),error=>({error}));
 try{
  const phase=await Promise.race([sim.reached.then(()=> 'at_account'),task.then(()=> 'finished')]);assert.equal(phase,'at_account');
  shared.witness.accountId=f.foreign;shared.witness.reservationId=randomUUID();shared.snapshot.intentId='f'.repeat(64);shared.snapshot.origin.updateTime='1:000000000';shared.action='release';
  sim.resume();const outcome=await task;assert.equal(outcome.error,undefined);assert.equal(outcome.result.state,'closed');assert.equal(sim.calls(),1);
  assert.equal((await f.root.collection('billingGuards').doc(f.foreign).get()).exists,false);
 }finally{sim.resume();await task;f.backend.terminalWitnessForRecovery=original;}
});

// Internal synthetic objects only: these tests do not demonstrate a web path or
// turn a snapshot into an authenticated capability.
for(const field of ['intentId','action','origin','sealWitness','sealRecovery','releaseWitness','releaseRecovery','exists','createTime','updateTime'])test(`snapshot captures changing ${field} getter exactly once`,{timeout:20000},async()=>{
 const f=await fixture('seal'),candidate=await f.backend.terminalWitnessForRecovery(f.pair.id);assert.ok(candidate);
 const supplied={...candidate.snapshot,origin:{...candidate.snapshot.origin}},target=['exists','createTime','updateTime'].includes(field)?supplied.origin:supplied;
 const initial=target[field],changed={intentId:'not-a-valid-intent',action:'release',origin:null,sealWitness:null,sealRecovery:null,releaseWitness:null,releaseRecovery:null,exists:false,createTime:'invalid',updateTime:'invalid'}[field];let reads=0;
 Object.defineProperty(target,field,{enumerable:true,configurable:true,get(){reads++;return reads===1?initial:changed;}});
 const copied=copyTerminalRecoveryReadSnapshot(supplied);
 assert.deepEqual(copied,candidate.snapshot,'validation and output must use the first captured value');assert.equal(reads,1);
});

test('a changing internal action getter cannot retarget resolution to the other witness',{timeout:20000},async()=>{
 const f=await fixture('seal'),candidate=await f.backend.terminalWitnessForRecovery(f.pair.id);assert.ok(candidate);
 const supplied={...candidate.snapshot};let reads=0;
 Object.defineProperty(supplied,'action',{enumerable:true,configurable:true,get(){reads++;return reads===1?'seal':'release';}});
 const observed={action:'release',source:'resolution_status',terminalAction:'release',state:'released',reservationId:f.witness.reservationId,seconds:f.witness.seconds};
 const result=await f.backend.recordConfirmedIntentObservation(f.witness,observed,supplied);
 assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,false);assert.equal(reads,1);assert.notEqual((await f.intent.get()).get('state'),'closed');
 assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,1);assert.equal((await f.root.collection('billingGuards').get()).size,0);
});

test('a throwing snapshot getter preserves an unattributed observation without closing',{timeout:20000},async()=>{
 const f=await fixture('seal'),candidate=await f.backend.terminalWitnessForRecovery(f.pair.id);assert.ok(candidate);
 const supplied={...candidate.snapshot,origin:{...candidate.snapshot.origin}};let reads=0;
 Object.defineProperty(supplied.origin,'updateTime',{enumerable:true,configurable:true,get(){reads++;throw Error('synthetic getter failure');}});
 const observed={action:'seal',source:'resolution_status',terminalAction:'seal',state:'sealed',reservationId:f.witness.reservationId,seconds:f.witness.seconds};
 const result=await f.backend.recordConfirmedIntentObservation(f.witness,observed,supplied);
 assert.equal(reads,1);assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,false);assert.notEqual((await f.intent.get()).get('state'),'closed');
 const incidents=await f.root.collection('billingIntentObservationIncidents').get();assert.equal(incidents.size,1);assert.equal(incidents.docs[0].get('attribution'),'unverified');
 assert.equal((await f.root.collection('billingGuards').doc(f.account).get()).exists,false);assert.equal((await f.root.collection('billingGuards').doc(f.foreign).get()).exists,false);assert.equal((await f.root.collection('billingHoldOutbox').get()).size,0);
});

test('a throwing snapshot getter before Account leaves recovery unverified without inventing a receipt',{timeout:20000},async()=>{
 const f=await fixture('seal'),original=f.backend.terminalWitnessForRecovery.bind(f.backend),sim=simulatedResolution(f,'sealed');let reads=0;
 f.backend.terminalWitnessForRecovery=async(...args)=>{
  const candidate=await original(...args);assert.ok(candidate);const snapshot={...candidate.snapshot,origin:{...candidate.snapshot.origin}};
  Object.defineProperty(snapshot.origin,'updateTime',{enumerable:true,configurable:true,get(){reads++;throw Error('synthetic getter failure');}});return {...candidate,snapshot};
 };
 try{
  assert.deepEqual(await sim.ai.recoverTerminalObservation(f.pair.id),{state:'unverified'});assert.equal(reads,1);assert.equal(sim.calls(),0);
  assert.notEqual((await f.intent.get()).get('state'),'closed');assert.equal((await f.root.collection('billingIntentObservationIncidents').get()).size,0);
 }finally{f.backend.terminalWitnessForRecovery=original;}
});
