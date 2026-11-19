// Emulator checks for the pre-Account recovery reader. No real Account or provider calls.
// Post-Account version revalidation and durable queue handling are a later phase.
import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {accountIdentityKey} from './accountBillingClient.ts';

const host='127.0.0.1:8185',project='demo-vistavo-ledger',collection='vistavo_witness_reader_synthetic',fixtures=[];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminalId=(intentId,action)=>hash(['billing-intent-terminal-v1',intentId,action]);

before(async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host,'requires the loopback Firestore emulator');
 assert.equal(process.env.NODE_ENV,'test','the synthetic reader test requires NODE_ENV=test');
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE','K_JOB','FUNCTION_TARGET','GAE_ENV'])assert.ok(!process.env[name],`${name} must be absent`);
 for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])assert.ok(!process.env[name]||process.env[name]===project,`${name} must be the demo project`);
 assert.equal((await fetch(`http://${host}/`)).status,200);
});

afterEach(async()=>{
 for(const f of fixtures.splice(0)){
  try{
   const root=await f.root.get();
   if(root.exists){
    assert.equal(f.root.path,`${collection}/${f.id}`);assert.equal(root.get('fixture'),'witness-reader-v1');assert.equal(root.get('runId'),f.id);
    await f.db.recursiveDelete(f.root);
   }
   assert.equal((await f.root.get()).exists,false,'synthetic root must be removed');
   if(f.tracked.length){const remaining=await f.db.getAll(...f.tracked);assert.equal(remaining.every(doc=>!doc.exists),true,'tracked synthetic documents must be removed');}
   assert.equal((await f.root.listCollections()).length,0,'synthetic subcollections must be empty');
   console.log(JSON.stringify({event:'witness-reader-cleanup',project,runId:f.id,tracked:f.tracked.length,allAbsent:true}));
  }finally{await f.db.terminate();await deleteApp(f.app);}
 }
});

async function fixture(action){
 const id=randomUUID(),app=initializeApp({projectId:project},`witness-reader-${id}`),db=getFirestore(app);
 db.settings({host,ssl:false,preferRest:true});const root=db.collection(collection).doc(id),backend=new FirestoreBackend(db,root);
 assert.equal(app.options.projectId,project);assert.equal(root.path,`${collection}/${id}`);
 assert.equal(db._settings.servicePath,'127.0.0.1');assert.equal(db._settings.port,8185);assert.equal(db._settings.ssl,false);
 const f={id,app,db,root,backend,tracked:[]};fixtures.push(f);await root.create({fixture:'witness-reader-v1',runId:id});
 const uid=`synthetic-witness-reader-${id}`,account=await backend.accountForUid(uid),inputId=randomUUID(),requestKey=randomUUID();
 const billing={provider:'account_seconds',identityKey:accountIdentityKey(uid),reservationId:randomUUID(),seconds:2};
 const ref=(name,key)=>root.collection(name).doc(key);
 await ref('inputs',inputId).create({accountId:account,deleted:false,expiresAtMs:Date.now()+300000});
 await ref('projects',inputId).create({accountId:account,inputId,revision:1,draft:'synthetic'});
 await backend.beginExternalBillingIntent(account,inputId,requestKey,'translation:en',1,billing);
 const witness=await backend.externalIntentWitness(account,requestKey,billing);
 await backend.fenceExternalBillingRelease(account,requestKey,billing);
 assert.deepEqual(await backend.prepareExternalIntentTerminal(witness,requestKey,action),{state:'ready'});
 const pairFor=a=>{const id=terminalId(witness.intentId,a);return {id,terminal:ref('billingIntentTerminalWitnesses',id),task:ref('billingIntentTerminalRecovery',id)};};
 const pair=pairFor(action),otherAction=action==='seal'?'release':'seal',other=pairFor(otherAction),origin=ref('billingIntentWitnesses',witness.intentId),intent=ref('billingIntents',witness.intentId);
 Object.assign(f,{uid,account,inputId,requestKey,billing,witness,action,pair,otherAction,other,origin,intent});
 f.tracked.push(ref('accounts',account),ref('identities',billing.identityKey),ref('inputs',inputId),ref('projects',inputId),origin,intent,pair.terminal,pair.task,other.terminal,other.task);
 return f;
}

async function snapshot(refs){
 return Promise.all(refs.map(async ref=>{const doc=await ref.get(),at=doc.updateTime;return {exists:doc.exists,data:doc.data(),version:at?`${at.seconds}:${at.nanoseconds}`:null};}));
}

async function rejectedWithoutAccount(f,scenario){
 const refs=[f.origin,f.intent,f.pair.terminal,f.pair.task,f.other.terminal,f.other.task],before=await snapshot(refs);
 const candidate=await f.backend.terminalWitnessForRecovery(f.pair.id);let calls=0;
 const simulatedAccount={resolution:async()=>{calls++;return {reservationId:f.witness.reservationId,seconds:f.witness.seconds,state:'reserved'};}};
 const ai=new FirestoreAi(f.db,f.root,f.backend,{},undefined,simulatedAccount);
 const result=await ai.recoverTerminalObservation(f.pair.id),after=await snapshot(refs);
 console.log(JSON.stringify({event:'witness-reader-case',action:f.action,scenario,candidateReturned:candidate!==null,simulatedAccountCalls:calls,result:result.state}));
 assert.deepEqual(after,before,'a rejected reader must not mutate the synthetic history');
 assert.equal(calls,0,'an unverified history must not consult even simulated Account');
 assert.equal(candidate,null,'an unverified history must not yield a recovery candidate');
 assert.deepEqual(result,{state:'unverified'});
}

for(const action of ['seal','release']){
 test(`coherent ${action} pair remains readable`,async()=>{
  const f=await fixture(action),before=await snapshot([f.origin,f.pair.terminal,f.pair.task]);
  const candidate=await f.backend.terminalWitnessForRecovery(f.pair.id);assert.ok(candidate);assert.deepEqual({witness:candidate.witness,action:candidate.action},{witness:f.witness,action});assert.equal(candidate.snapshot.origin.exists,true);assert.equal(candidate.snapshot[action+'Witness'].exists,true);assert.equal(candidate.snapshot[action+'Recovery'].exists,true);
  assert.deepEqual(await snapshot([f.origin,f.pair.terminal,f.pair.task]),before);
 });
 test(`coherent ${action} remains readable when the other action also has a pair`,async()=>{
  const f=await fixture(action);assert.deepEqual(await f.backend.prepareExternalIntentTerminal(f.witness,f.requestKey,f.otherAction),{state:'ready'});
  const candidate=await f.backend.terminalWitnessForRecovery(f.pair.id);assert.ok(candidate);assert.deepEqual({witness:candidate.witness,action:candidate.action},{witness:f.witness,action});assert.equal(candidate.snapshot.sealWitness.exists,true);assert.equal(candidate.snapshot.releaseWitness.exists,true);
 });
 const markerCases=[
  ['legacy marker absent',()=>FieldValue.delete()],
  ['null marker',()=>null],
  ['array marker',()=>[]],
  ['unknown protocol',()=>({protocol:2,sealPrepared:action==='seal',releasePrepared:action==='release'})],
  ['non-boolean marker',()=>({protocol:1,sealPrepared:action==='seal',releasePrepared:null})],
  ['extra marker field',()=>({protocol:1,sealPrepared:action==='seal',releasePrepared:action==='release',unexpected:true})],
 ];
 for(const [scenario,value] of markerCases)test(`${action} rejects ${scenario}`,async()=>{
  const f=await fixture(action);await f.origin.update({terminalRecovery:value()});await rejectedWithoutAccount(f,scenario);
 });
 test(`${action} rejects a false marker with its pair present`,async()=>{
  const f=await fixture(action);await f.origin.update({[`terminalRecovery.${action}Prepared`]:false});await rejectedWithoutAccount(f,'false marker with pair');
 });
 test(`${action} rejects a true marker with its task missing`,async()=>{
  const f=await fixture(action);await f.pair.task.delete();await rejectedWithoutAccount(f,'task missing');
 });
 test(`${action} rejects a true marker with its witness missing`,async()=>{
  const f=await fixture(action);await f.pair.terminal.delete();await rejectedWithoutAccount(f,'witness missing');
 });
 test(`${action} rejects a true marker with both documents missing`,async()=>{
  const f=await fixture(action),batch=f.db.batch();batch.delete(f.pair.terminal);batch.delete(f.pair.task);await batch.commit();await rejectedWithoutAccount(f,'both documents missing');
 });
 test(`${action} rejects an absent origin`,async()=>{
  const f=await fixture(action);await f.origin.delete();await rejectedWithoutAccount(f,'origin missing');
 });
 test(`${action} rejects an unexpected origin field`,async()=>{
  const f=await fixture(action);await f.origin.update({unexpected:'synthetic-corruption'});await rejectedWithoutAccount(f,'extra origin field');
 });
 test(`${action} rejects an extra field in the witness`,async()=>{
  const f=await fixture(action);await f.pair.terminal.update({unexpected:'synthetic-corruption'});await rejectedWithoutAccount(f,'extra witness field');
 });
 const taskCases=[
  ['unsupported task protocol',base=>({...base,protocol:2})],
  ['future leased task',base=>({...base,state:'leased',generation:1})],
  ['pending task with unexpected generation',base=>({...base,generation:1})],
  ['pending task with unexpected attempts',base=>({...base,attempts:1})],
  ['wrong task identifier',base=>({...base,terminalId:'f'.repeat(64)})],
  ['different creation time',base=>({...base,createdAtMs:base.createdAtMs+1})],
  ['extra task field',base=>({...base,unexpected:true})],
 ];
 for(const [scenario,change] of taskCases)test(`${action} rejects ${scenario}`,async()=>{
  const f=await fixture(action),base=(await f.pair.task.get()).data();await f.pair.task.set(change(base));await rejectedWithoutAccount(f,scenario);
 });
 const otherCases=[
  ['other task missing',async f=>f.other.task.delete()],
  ['other witness missing',async f=>f.other.terminal.delete()],
  ['other witness corrupt',async f=>f.other.terminal.update({historyProtocol:2})],
  ['other witness with wrong reservation',async f=>f.other.terminal.update({reservationId:randomUUID()})],
  ['other witness with wrong seconds',async f=>f.other.terminal.update({seconds:3})],
  ['other pair missing',async f=>{const batch=f.db.batch();batch.delete(f.other.terminal);batch.delete(f.other.task);await batch.commit();}],
  ['other false marker with pair',async f=>f.origin.update({[`terminalRecovery.${f.otherAction}Prepared`]:false})],
  ['other false marker with only witness',async f=>{await f.origin.update({[`terminalRecovery.${f.otherAction}Prepared`]:false});await f.other.task.delete();}],
  ['other false marker with only task',async f=>{await f.origin.update({[`terminalRecovery.${f.otherAction}Prepared`]:false});await f.other.terminal.delete();}],
  ['other task future state',async f=>f.other.task.update({state:'leased',generation:1})],
 ];
 for(const [scenario,change] of otherCases)test(`${action} rejects ${scenario}`,async()=>{
  const f=await fixture(action);assert.deepEqual(await f.backend.prepareExternalIntentTerminal(f.witness,f.requestKey,f.otherAction),{state:'ready'});
  await change(f);await rejectedWithoutAccount(f,scenario);
 });
}
