import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';import {Readable} from 'node:stream';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {Firestore,getFirestore,FieldValue} from 'firebase-admin/firestore';
import {FirestoreBackend,LedgerFault} from './firestoreBackend.ts';
import {drainCloudAi} from './cloudAiDispatch.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {FirestoreFiles} from './firestoreFiles.ts';
import {firestoreHttp} from './firestoreHttp.ts';
import {processOnDemand} from './firestoreWorker.ts';
import {ObjectFault} from './gcsObjects.ts';
import {AI_TEXT_BUDGET,AI_CATALOG_VERSION} from './aiContracts.ts';
import {AccountBillingClient,AccountBillingFault,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {prepareFinancialFixture,cleanupFinancialFixture} from './financialFixtureSafety.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex'),contexts=[];
function reservationFor(account,identity,input,operation,revision,key){const bytes=createHash('sha256').update(JSON.stringify(['vistavo-video-reservation-v1',account,identity,input,operation,revision,key])).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
const ref=(c,col,id)=>c.root.collection(col).doc(id);
class MemoryObjects{
 data=new Map();next=9007199254740993n;puts=0;failPutAt=0;failBarrier=false;pause;
 meta(key){const x=this.data.get(key);return x?{key,generation:x.generation,size:x.bytes.length,...(x.marker?{marker:true}:{})}:null;}
 async metadata(key){return this.meta(key);}
 save(key,bytes,marker=false){this.data.set(key,{generation:String(this.next++),bytes:Buffer.from(bytes),marker});return this.meta(key);}
 async putOnce(key,bytes){const existing=this.data.get(key);if(existing){if(existing.marker||!existing.bytes.equals(bytes))throw new ObjectFault('conflict');return this.meta(key);}return this.save(key,bytes);}
 async putArtifactOnce(key,bytes){this.puts++;if(this.failPutAt===this.puts)throw new ObjectFault('remote');
  // Like a GCS call paused after its metadata GET and before ifGenerationMatch=0 creation.
  const prior=this.data.get(key);if(prior){if(prior.marker||!prior.bytes.equals(bytes))throw new ObjectFault('conflict');return this.meta(key);}
  if(this.pause){const waiting=this.pause;this.pause=null;waiting.enter();await waiting.resume;}
  return this.putOnce(key,bytes);
 }
 async composeOnce(key,sources,size){const old=this.meta(key);if(old){assert.equal(old.size,size);return old;}const parts=sources.map(s=>{const x=this.data.get(s.key);if(!x||x.generation!==s.generation)throw new ObjectFault('missing');return x.bytes;});const bytes=Buffer.concat(parts);assert.equal(bytes.length,size);return this.save(key,bytes);}
 async read(object,range){const x=this.data.get(object.key);if(!x||x.generation!==object.generation)throw new ObjectFault('missing');return Readable.from(range?x.bytes.subarray(range.start,range.end+1):x.bytes);}
 async barrier(key){if(this.failBarrier){this.failBarrier=false;throw new ObjectFault('remote');}const old=this.meta(key);return old?.marker?old:this.save(key,Buffer.alloc(0),true);}
}
before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185','No native cloud fallback');assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0))try{if(c.server){c.server.closeAllConnections();await new Promise(r=>c.server.close(r));}await cleanupFinancialFixture(c,'vistavo_ai_integration_test');}finally{await c.db.terminate();if(c.app)await deleteApp(c.app);}});
async function fixture(){
 const app=process.env.LV_FINANCIAL_REGRESSION==='1'?null:initializeApp({projectId:'demo-vistavo-ledger'},'lv-ai-test-'+randomUUID()),db=app?getFirestore(app):new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:false}),root=db.collection('vistavo_ai_integration_test').doc(randomUUID()),backend=new FirestoreBackend(db,root),objects=new MemoryObjects();
 const ai=new FirestoreAi(db,root,backend,objects),files=new FirestoreFiles(db,root,objects,{chunkBytes:4},(account,input)=>ai.purgeInput(account,input));
 const c={app,db,root,backend,objects,ai,files};contexts.push(c);await prepareFinancialFixture(c,'vistavo_ai_integration_test');
 const uid='fixture-ai-owner-'+randomUUID(),foreignUid='fixture-ai-foreign-'+randomUUID(),account=await backend.accountForUid(uid),foreign=await backend.accountForUid(foreignUid);
 Object.assign(c,{uid,foreignUid,account,foreign});
 for(const who of [account,foreign])await ref(c,'accounts',who).update({aiPilot:true,simulationOnly:true});
 await backend.creditVerifiedPurchase(account,'fixture-'+randomUUID(),100,1,'synthetic-ai-integration','sandbox');
 const source=Buffer.from('abcdefghijkl'),u=await files.begin(account,'synthetic-emulator.mp4',source.length,sha(source),randomUUID());
 for(let at=0;at<source.length;at+=4)await files.append(account,u.id,at,source.subarray(at,at+4));await files.complete(account,u.id);
 await files.work(u.id,'validate',{inspect:async()=>({sha256:sha(source),video:{duration:2,width:320,height:180,audioTracks:1}})});await files.work(u.id,'cleanup');
 c.input=u.id;c.source=source;await backend.saveProject(account,u.id,0,'The water pump is twelve inches wide.');return c;
}
const outputs=()=>new Map([
 ['transcript-es.txt',Buffer.from('La bomba mide doce pulgadas.')],['transcript-es.srt',Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nLa bomba mide doce pulgadas.\n')],
 ['translation-en.txt',Buffer.from('The water pump is twelve inches wide.')],['translation-en.srt',Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nThe water pump is twelve inches wide.\n')],['cues.json',Buffer.from(JSON.stringify({durationMs:2000,cues:[{startMs:0,endMs:2000,es:'La bomba mide doce pulgadas.',en:'The water pump is twelve inches wide.'}]}))],
]);
async function fencedIntent(c){
 const requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=reservationFor(c.account,identityKey,c.input,'translation:en',1,requestKey),billing={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,billing);
 const witness=await c.backend.externalIntentWitness(c.account,requestKey,billing);await c.backend.fenceExternalBillingRelease(c.account,requestKey,billing);
 return {requestKey,identityKey,reservationId,billing,witness};
}
async function preparedIntent(c,action='release'){
 const p=await fencedIntent(c),{witness,requestKey}=p;
 assert.deepEqual(await c.backend.prepareExternalIntentTerminal(witness,requestKey,action),{state:'ready'});
 return p;
}
const terminalId=(p,action)=>sha(JSON.stringify(['billing-intent-terminal-v1',p.witness.intentId,action]));
async function terminalSnapshot(c,p,action){const candidate=await c.backend.terminalWitnessForRecovery(terminalId(p,action));assert.ok(candidate);return candidate.snapshot;}
async function directSnapshot(c,p,source){const snapshot=await c.backend.captureDirectObservation(p.witness,p.requestKey,source);assert.ok(snapshot);return snapshot;}
function terminalPair(c,p,action){
 const id=terminalId(p,action);
 return {id,terminal:ref(c,'billingIntentTerminalWitnesses',id),recovery:ref(c,'billingIntentTerminalRecovery',id)};
}
const originFor=(c,p)=>ref(c,'billingIntentWitnesses',p.witness.intentId);
async function snapshots(refs){return Promise.all(refs.map(async r=>{const s=await r.get();return {exists:s.exists,data:s.data(),version:s.updateTime?.toMillis()+':'+s.updateTime?.nanoseconds};}));}

test('billing extras cannot change a validated intent, job, marker or outbox identity',async()=>{
 const c=await fixture(),requestKey=randomUUID(),billing={provider:'account_seconds',identityKey:accountIdentityKey(c.uid),reservationId:randomUUID(),seconds:2};
 const poison={...billing,accountId:c.foreign,inputId:randomUUID(),intentId:'f'.repeat(64),id:'synthetic-id',requestKey:'synthetic-other-request',operation:'narration:en',revision:99,profile:'synthetic-profile',jobId:randomUUID(),unexpected:'synthetic-extra'};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,poison);
 const id=sha(JSON.stringify([c.account,requestKey])),witness=await c.backend.externalIntentWitness(c.account,requestKey,poison);
 assert.deepEqual(witness,{intentId:id,accountId:c.account,inputId:c.input,operation:'translation:en',revision:1,profile:AI_CATALOG_VERSION,...billing});
 const origin=await originFor(c,{witness}).get(),intent=await ref(c,'billingIntents',id).get();
 assert.equal(origin.get('accountId'),c.account);assert.equal(origin.get('inputId'),c.input);assert.equal(origin.get('intentId'),id);
 assert.deepEqual(Object.keys(intent.data()).sort(),['accountId','attempts','createdAtMs','id','identityKey','inputId','nextAttemptAt','operation','provider','requestKey','reservationId','revision','seconds','state','updatedAtMs']);
 assert.equal(intent.get('accountId'),c.account);assert.equal(intent.get('inputId'),c.input);assert.equal(intent.get('id'),id);assert.equal(intent.get('requestKey'),requestKey);
 const jobId=await c.backend.reserve(c.account,c.input,requestKey,2,'translation:en',1,AI_CATALOG_VERSION,poison,undefined,c.uid);
 assert.deepEqual((await ref(c,'jobs',jobId).get()).get('externalBilling'),billing);
 const marker=await ref(c,'billingIntentJobMarkers',id).get();assert.equal(marker.get('jobId'),jobId);assert.equal(marker.get('accountId'),c.account);assert.equal(marker.get('inputId'),c.input);assert.equal(marker.get('unexpected'),undefined);
 await c.backend.cancel(c.account,jobId);const outbox=await ref(c,'billingOutbox',jobId).get();
 assert.equal(outbox.get('jobId'),jobId);assert.equal(outbox.get('accountId'),c.account);assert.equal(outbox.get('unexpected'),undefined);
 assert.equal(outbox.get('identityKey'),billing.identityKey);assert.equal(outbox.get('reservationId'),billing.reservationId);assert.equal(outbox.get('seconds'),billing.seconds);
});

test('an extra field already stored in synthetic job billing cannot overwrite the outbox identity',async()=>{
 const c=await fixture(),requestKey=randomUUID(),billing={provider:'account_seconds',identityKey:accountIdentityKey(c.uid),reservationId:randomUUID(),seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,billing);
 const jobId=await c.backend.reserve(c.account,c.input,requestKey,2,'translation:en',1,AI_CATALOG_VERSION,billing,undefined,c.uid);
 await ref(c,'jobs',jobId).update({'externalBilling.accountId':c.foreign,'externalBilling.jobId':randomUUID(),'externalBilling.unexpected':'synthetic-old-field'});
 await c.backend.cancel(c.account,jobId);const outbox=await ref(c,'billingOutbox',jobId).get();
 assert.equal(outbox.get('jobId'),jobId);assert.equal(outbox.get('accountId'),c.account);assert.equal(outbox.get('unexpected'),undefined);
 assert.equal(outbox.get('identityKey'),billing.identityKey);assert.equal(outbox.get('reservationId'),billing.reservationId);assert.equal(outbox.get('seconds'),billing.seconds);
});

test('billing and terminal witness are snapshotted before asynchronous transaction reads',async()=>{
 const c=await fixture(),requestKey=randomUUID(),clean={provider:'account_seconds',identityKey:accountIdentityKey(c.uid),reservationId:randomUUID(),seconds:2};
 function paused(){let release;const barrier=new Promise(resolve=>{release=resolve;});return {backend:new FirestoreBackend({runTransaction:async callback=>{await barrier;return c.db.runTransaction(callback);}},c.root),release};}
 const corrupt=value=>Object.assign(value,{provider:'synthetic-mutated',identityKey:'f'.repeat(64),reservationId:randomUUID(),seconds:3,accountId:c.foreign,inputId:randomUUID(),intentId:'e'.repeat(64),jobId:randomUUID()});
 let mutable={...clean},gate=paused(),pending=gate.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,mutable);
 corrupt(mutable);gate.release();await pending;
 const id=sha(JSON.stringify([c.account,requestKey]));assert.equal((await ref(c,'billingIntents',id).get()).get('identityKey'),clean.identityKey);
 mutable={...clean};gate=paused();pending=gate.backend.externalIntentWitness(c.account,requestKey,mutable);
 corrupt(mutable);gate.release();const witness=await pending;assert.equal(witness.reservationId,clean.reservationId);assert.equal(witness.inputId,c.input);
 mutable={...clean};gate=paused();pending=gate.backend.reserve(c.account,c.input,requestKey,2,'translation:en',1,AI_CATALOG_VERSION,mutable,undefined,c.uid);
 corrupt(mutable);gate.release();const jobId=await pending;assert.deepEqual((await ref(c,'jobs',jobId).get()).get('externalBilling'),clean);
 const p=await fencedIntent(c),pair=terminalPair(c,p,'seal'),presented={...p.witness};gate=paused();pending=gate.backend.prepareExternalIntentTerminal(presented,p.requestKey,'seal');
 corrupt(presented);gate.release();assert.deepEqual(await pending,{state:'ready'});
 const terminal=await pair.terminal.get();assert.equal(terminal.get('accountId'),c.account);assert.equal(terminal.get('inputId'),c.input);assert.equal(terminal.get('reservationId'),p.reservationId);
});

test('a new pre-account origin has only allowed witness fields and both action markers false',async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),billing={provider:'account_seconds',identityKey,reservationId:randomUUID(),seconds:2,unexpected:'synthetic-untrusted'};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,billing);
 const witness=await c.backend.externalIntentWitness(c.account,requestKey,billing),origin=await originFor(c,{witness}).get();
 assert.deepEqual(Object.keys(origin.data()).sort(),['accountId','baseline','createdAtMs','historyProtocol','identityKey','inputId','intentId','operation','profile','provider','reservationId','revision','seconds','terminalRecovery']);
 assert.deepEqual(origin.get('terminalRecovery'),{protocol:1,sealPrepared:false,releasePrepared:false});
 assert.equal(origin.get('unexpected'),undefined);assert.equal(origin.get('baseline'),'before_reservation');
 assert.equal((await ref(c,'billingIntents',witness.intentId).get()).exists,true);
 assert.equal((await c.root.collection('billingIntentTerminalWitnesses').get()).size,0);
 assert.equal((await c.root.collection('billingIntentTerminalRecovery').get()).size,0);
});

for(const action of ['seal','release'])test('terminal '+action+' creates and replays the same witness and recovery task atomically',async()=>{
 const c=await fixture(),p=await preparedIntent(c,action),pair=terminalPair(c,p,action),origin=await originFor(c,p).get(),w=await pair.terminal.get(),q=await pair.recovery.get();
 assert.equal(w.exists,true);assert.equal(q.exists,true);assert.equal(w.id,pair.id);assert.equal(q.id,pair.id);
 assert.deepEqual(origin.get('terminalRecovery'),{protocol:1,sealPrepared:action==='seal',releasePrepared:action==='release'});
 assert.deepEqual(q.data(),{terminalId:pair.id,protocol:1,state:'pending',generation:0,attempts:0,createdAtMs:w.get('createdAtMs'),nextAttemptAt:w.get('createdAtMs')});
 assert.deepEqual(Object.keys(q.data()).sort(),['attempts','createdAtMs','generation','nextAttemptAt','protocol','state','terminalId']);
 assert.equal(w.get('action'),action);assert.equal(w.get('stage'),'prepared');assert.equal(w.get('intentId'),p.witness.intentId);
 assert.deepEqual(await c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,action),{state:'ready'});
 const againWitness=await pair.terminal.get(),againTask=await pair.recovery.get();
 const againOrigin=await originFor(c,p).get();assert.deepEqual(againOrigin.data(),origin.data());assert.ok(againOrigin.updateTime.isEqual(origin.updateTime));
 assert.deepEqual(againWitness.data(),w.data());assert.deepEqual(againTask.data(),q.data());
 assert.ok(againWitness.updateTime.isEqual(w.updateTime));assert.ok(againTask.updateTime.isEqual(q.updateTime));
 assert.equal((await c.root.collection('billingIntentTerminalWitnesses').get()).size,1);
 assert.equal((await c.root.collection('billingIntentTerminalRecovery').get()).size,1);
});

for(const action of ['seal','release'])for(const missing of ['terminal','recovery','both'])test(action+' preparation rejects missing '+missing+' without recreating it',async()=>{
 const c=await fixture(),p=await preparedIntent(c,action),pair=terminalPair(c,p,action),origin=originFor(c,p),intent=ref(c,'billingIntents',p.witness.intentId);
 if(missing==='both'){const batch=c.db.batch();batch.delete(pair.terminal);batch.delete(pair.recovery);await batch.commit();}else await pair[missing].delete();
 const beforeWitness=await pair.terminal.get(),beforeTask=await pair.recovery.get();
 const before=await snapshots([origin,intent,pair.terminal,pair.recovery]);
 await assert.rejects(c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,action),error=>error.code==='invariant');
 assert.deepEqual(await snapshots([origin,intent,pair.terminal,pair.recovery]),before);
 const afterWitness=await pair.terminal.get(),afterTask=await pair.recovery.get();
 assert.equal(afterWitness.exists,beforeWitness.exists);assert.equal(afterTask.exists,beforeTask.exists);
 if(beforeWitness.exists){assert.deepEqual(afterWitness.data(),beforeWitness.data());assert.ok(afterWitness.updateTime.isEqual(beforeWitness.updateTime));}
 if(beforeTask.exists){assert.deepEqual(afterTask.data(),beforeTask.data());assert.ok(afterTask.updateTime.isEqual(beforeTask.updateTime));}
});

for(const action of ['seal','release'])for(const present of ['terminal','recovery','both'])test(action+' with a false marker rejects preexisting '+present+' without overwriting',async()=>{
 const c=await fixture(),p=await preparedIntent(c,action),pair=terminalPair(c,p,action),origin=originFor(c,p),intent=ref(c,'billingIntents',p.witness.intentId);
 await origin.update({[`terminalRecovery.${action}Prepared`]:false});
 if(present==='terminal')await pair.recovery.delete();if(present==='recovery')await pair.terminal.delete();
 const before=await snapshots([origin,intent,pair.terminal,pair.recovery]);
 await assert.rejects(c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,action),error=>error.code==='invariant');
 assert.deepEqual(await snapshots([origin,intent,pair.terminal,pair.recovery]),before);
});

for(const action of ['seal','release'])test(action+' rejects legacy or malformed origin markers without creating or repairing anything',async()=>{
 const c=await fixture(),p=await fencedIntent(c),pair=terminalPair(c,p,action),origin=originFor(c,p),intent=ref(c,'billingIntents',p.witness.intentId);
 const base={protocol:1,sealPrepared:false,releasePrepared:false};
 const cases=[FieldValue.delete(),null,[],{...base,protocol:2},{...base,protocol:'1'},
  {protocol:1,sealPrepared:false},{protocol:1,releasePrepared:false},{...base,sealPrepared:'false'},
  {...base,releasePrepared:null},{...base,unexpected:true}];
 for(const terminalRecovery of cases){
  await origin.update({terminalRecovery});const before=await snapshots([origin,intent,pair.terminal,pair.recovery]);
  await assert.rejects(c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,action),error=>error.code==='invariant');
  assert.deepEqual(await snapshots([origin,intent,pair.terminal,pair.recovery]),before);
 }
});

for(const action of ['seal','release'])test(action+' rejects a missing or altered origin and an altered intent without creating a pair',async()=>{
 const c=await fixture(),p=await fencedIntent(c),pair=terminalPair(c,p,action),origin=originFor(c,p),intent=ref(c,'billingIntents',p.witness.intentId),baseOrigin=(await origin.get()).data(),baseIntent=(await intent.get()).data();
 for(const change of [{intentId:'f'.repeat(64)},{accountId:c.foreign},{inputId:randomUUID()},{baseline:'unknown'},{historyProtocol:2},{createdAtMs:-1},{unexpected:true}]){
  await origin.set({...baseOrigin,...change});const before=await snapshots([origin,intent,pair.terminal,pair.recovery]);
  await assert.rejects(c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,action),error=>['conflict','invariant'].includes(error.code));
  assert.deepEqual(await snapshots([origin,intent,pair.terminal,pair.recovery]),before);
 }
 await origin.delete();let before=await snapshots([origin,intent,pair.terminal,pair.recovery]);
 await assert.rejects(c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,action),error=>error.code==='conflict');
 assert.deepEqual(await snapshots([origin,intent,pair.terminal,pair.recovery]),before);
 await origin.set(baseOrigin);await intent.set({...baseIntent,inputId:randomUUID()});before=await snapshots([origin,intent,pair.terminal,pair.recovery]);
 await assert.rejects(c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,action),error=>['conflict','invariant'].includes(error.code));
 assert.deepEqual(await snapshots([origin,intent,pair.terminal,pair.recovery]),before);
});

test('terminal preparation rejects every inconsistent or future recovery shape without resetting it',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),pair=terminalPair(c,p,'seal'),base=(await pair.recovery.get()).data();
 const invalid=[
  {terminalId:'f'.repeat(64)},{protocol:2},{state:'leased'},{state:'needs_review'},{state:'closed'},
  {generation:1},{attempts:1},{createdAtMs:base.createdAtMs+1},{nextAttemptAt:base.nextAttemptAt+1},
  {createdAtMs:'invalid'},{nextAttemptAt:'invalid'},{unexpected:'not-supported'},
 ];
 for(const changes of invalid){
  await pair.recovery.set({...base,...changes});const before=await pair.recovery.get(),w=await pair.terminal.get();
  await assert.rejects(c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,'seal'),error=>error.code==='invariant');
  const after=await pair.recovery.get(),afterWitness=await pair.terminal.get();
  assert.deepEqual(after.data(),before.data());assert.ok(after.updateTime.isEqual(before.updateTime));
  assert.deepEqual(afterWitness.data(),w.data());assert.ok(afterWitness.updateTime.isEqual(w.updateTime));
 }
 const {protocol,...missing}=base;await pair.recovery.set(missing);const before=await pair.recovery.get();
 await assert.rejects(c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,'seal'),error=>error.code==='invariant');
 assert.deepEqual((await pair.recovery.get()).data(),before.data());
});

test('terminal preparation rejects a corrupted witness while preserving its paired task',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),pair=terminalPair(c,p,'seal'),base=(await pair.terminal.get()).data();
 for(const changes of [{action:'release'},{stage:'closed'},{historyProtocol:2},{createdAtMs:base.createdAtMs+1},{intentId:'f'.repeat(64)},{unexpected:'not-supported'}]){
  await pair.terminal.set({...base,...changes});const before=await pair.terminal.get(),q=await pair.recovery.get();
  await assert.rejects(c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,'seal'),error=>error.code==='invariant');
  const after=await pair.terminal.get(),afterTask=await pair.recovery.get();
  assert.deepEqual(after.data(),before.data());assert.ok(after.updateTime.isEqual(before.updateTime));
  assert.deepEqual(afterTask.data(),q.data());assert.ok(afterTask.updateTime.isEqual(q.updateTime));
 }
 const {stage,...missing}=base;await pair.terminal.set(missing);const before=await pair.terminal.get(),q=await pair.recovery.get();
 await assert.rejects(c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,'seal'),error=>error.code==='invariant');
 assert.deepEqual((await pair.terminal.get()).data(),before.data());assert.deepEqual((await pair.recovery.get()).data(),q.data());
});

test('new terminal witness excludes fields supplied outside the validated witness contract',async()=>{
 const c=await fixture(),p=await fencedIntent(c),pair=terminalPair(c,p,'seal');
 await c.backend.prepareExternalIntentTerminal({...p.witness,unexpected:'synthetic-untrusted'},p.requestKey,'seal');
 assert.equal((await pair.terminal.get()).get('unexpected'),undefined);
 assert.equal((await pair.recovery.get()).get('unexpected'),undefined);
});

test('terminal preparation never commits a partial pair when the transaction fails after staging the witness',async()=>{
 const c=await fixture(),p=await fencedIntent(c),pair=terminalPair(c,p,'seal');let injected=false;
 const db={runTransaction:callback=>c.db.runTransaction(tx=>callback(new Proxy(tx,{get(target,key){
  if(key==='create')return (...args)=>{const result=target.create(...args);if(!injected){injected=true;throw Error('synthetic transaction interruption');}return result;};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }})))};
 const backend=new FirestoreBackend(db,c.root);
 await assert.rejects(backend.prepareExternalIntentTerminal(p.witness,p.requestKey,'seal'),/synthetic transaction interruption/);
 assert.equal(injected,true);assert.equal((await pair.terminal.get()).exists,false);assert.equal((await pair.recovery.get()).exists,false);
 assert.deepEqual((await originFor(c,p).get()).get('terminalRecovery'),{protocol:1,sealPrepared:false,releasePrepared:false});
 assert.deepEqual(await c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,'seal'),{state:'ready'});
 assert.equal((await pair.terminal.get()).exists,true);assert.equal((await pair.recovery.get()).exists,true);
});

test('terminal preparation rolls back both documents and marker if interrupted after staging all writes',async()=>{
 const c=await fixture(),p=await fencedIntent(c),pair=terminalPair(c,p,'seal'),origin=originFor(c,p);let injected=false;
 const db={runTransaction:callback=>c.db.runTransaction(tx=>callback(new Proxy(tx,{get(target,key){
  if(key==='update')return (...args)=>{const result=target.update(...args);if(args[0].path===origin.path){injected=true;throw Error('synthetic interruption after all writes staged');}return result;};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }})))};
 const before=await snapshots([origin,pair.terminal,pair.recovery]);
 await assert.rejects(new FirestoreBackend(db,c.root).prepareExternalIntentTerminal(p.witness,p.requestKey,'seal'),/synthetic interruption after all writes staged/);
 assert.equal(injected,true);assert.deepEqual(await snapshots([origin,pair.terminal,pair.recovery]),before);
 assert.deepEqual(await c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,'seal'),{state:'ready'});
});

for(const action of ['seal','release'])test(action+' replays an already committed pair after a lost local transaction response',async()=>{
 const c=await fixture(),p=await fencedIntent(c),pair=terminalPair(c,p,action),origin=originFor(c,p);let committed=false;
 const db={runTransaction:async callback=>{await c.db.runTransaction(callback);committed=true;throw Error('synthetic lost local transaction response');}};
 await assert.rejects(new FirestoreBackend(db,c.root).prepareExternalIntentTerminal(p.witness,p.requestKey,action),/synthetic lost local transaction response/);
 assert.equal(committed,true);assert.deepEqual((await origin.get()).get('terminalRecovery'),{protocol:1,sealPrepared:action==='seal',releasePrepared:action==='release'});
 const before=await snapshots([origin,pair.terminal,pair.recovery]);assert.equal(before[1].exists,true);assert.equal(before[2].exists,true);
 assert.deepEqual(await c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,action),{state:'ready'});
 assert.deepEqual(await snapshots([origin,pair.terminal,pair.recovery]),before);
});

for(const action of ['seal','release'])for(const failure of ['joint loss','legacy origin'])test(action+' does not send a terminal action to simulated Account after '+failure,async()=>{
 const c=await fixture(),p=await preparedIntent(c,action),pair=terminalPair(c,p,action),origin=originFor(c,p),calls=[];
 if(failure==='joint loss'){const batch=c.db.batch();batch.delete(pair.terminal);batch.delete(pair.recovery);await batch.commit();}
 else await origin.update({terminalRecovery:FieldValue.delete()});
 const before=await snapshots([origin,pair.terminal,pair.recovery]);
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);
  if(path.endsWith('/status')){
   if(action==='seal')throw Object.assign(Error('synthetic missing'),{response:{status:404}});
   return {data:{state:'reserved',reservationId:p.reservationId,seconds:2}};
  }
  throw Error('synthetic terminal action must not be sent');
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const result=await ai.drainExternalBilling();assert.equal(result.intentsFailed,1);
 assert.equal(calls.length,0,'invalid local history prevents even the status request');
 assert.equal(calls.some(path=>path.endsWith('/seal')||path.endsWith('/release')),false);
 assert.deepEqual(await snapshots([origin,pair.terminal,pair.recovery]),before);
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('state'),'release_pending');
});

test('concurrent terminal preparations converge on one correlated pair',async()=>{
 const c=await fixture(),p=await fencedIntent(c),pair=terminalPair(c,p,'release');let reads=0,overlapped=false,timedOut=false,release;
 const barrier=new Promise(resolve=>{release=resolve;}),timer=setTimeout(()=>{timedOut=true;release();},5000);
 const db={runTransaction:callback=>c.db.runTransaction(tx=>callback(new Proxy(tx,{get(target,key){
  if(key==='get')return async(...args)=>{const value=await target.get(...args);if(args[0].path===pair.recovery.path){const ordinal=++reads;if(ordinal===2&&!timedOut){overlapped=true;clearTimeout(timer);release();}if(ordinal<=2)await barrier;}return value;};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }})))};
 const first=new FirestoreBackend(db,c.root),second=new FirestoreBackend(db,c.root);let calls;
 try{calls=await Promise.all([
  first.prepareExternalIntentTerminal(p.witness,p.requestKey,'release'),
  second.prepareExternalIntentTerminal(p.witness,p.requestKey,'release'),
 ]);}finally{clearTimeout(timer);release();}
 console.log(JSON.stringify({event:'synthetic-terminal-race',bothRecoveryReadsBeforeRelease:overlapped,timedOut,reads}));
 assert.equal(overlapped,true,'Both transactions must read the recovery task before either prepares the pair');
 assert.equal(timedOut,false,'The concurrency barrier must not release on its timeout');
 assert.deepEqual(calls,[{state:'ready'},{state:'ready'}]);
 const witness=await pair.terminal.get(),recovery=await pair.recovery.get();
 assert.equal(witness.exists,true);assert.equal(recovery.exists,true);assert.equal(recovery.get('terminalId'),pair.id);
 assert.equal(witness.get('createdAtMs'),recovery.get('createdAtMs'));
 assert.equal((await c.root.collection('billingIntentTerminalWitnesses').get()).size,1);
 assert.equal((await c.root.collection('billingIntentTerminalRecovery').get()).size,1);
});

for(const firstAction of ['seal','release'])test('sequential terminal actions preserve both markers when '+firstAction+' is prepared first',async()=>{
 const c=await fixture(),p=await fencedIntent(c),secondAction=firstAction==='seal'?'release':'seal',origin=originFor(c,p);
 assert.deepEqual(await c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,firstAction),{state:'ready'});
 assert.deepEqual((await origin.get()).get('terminalRecovery'),{protocol:1,sealPrepared:firstAction==='seal',releasePrepared:firstAction==='release'});
 const firstPair=terminalPair(c,p,firstAction),before=await snapshots([firstPair.terminal,firstPair.recovery]);
 assert.deepEqual(await c.backend.prepareExternalIntentTerminal(p.witness,p.requestKey,secondAction),{state:'ready'});
 assert.deepEqual((await origin.get()).get('terminalRecovery'),{protocol:1,sealPrepared:true,releasePrepared:true});
 assert.deepEqual(await snapshots([firstPair.terminal,firstPair.recovery]),before);
});

for(const firstAction of ['seal','release'])test('concurrent seal and release preserve both markers when '+firstAction+' starts first',async()=>{
 const c=await fixture(),p=await fencedIntent(c),secondAction=firstAction==='seal'?'release':'seal';
 const firstPair=terminalPair(c,p,firstAction),secondPair=terminalPair(c,p,secondAction),seen=new Set();
 let overlap=false,timedOut=false,releaseBarrier;
 const barrier=new Promise(resolve=>{releaseBarrier=resolve;});
 const timer=setTimeout(()=>{timedOut=true;releaseBarrier();},12000);
 const db={runTransaction:callback=>c.db.runTransaction(tx=>callback(new Proxy(tx,{get(target,key){
  if(key==='get')return async(...args)=>{
   const value=await target.get(...args),path=args[0].path;
   if((path===firstPair.recovery.path||path===secondPair.recovery.path)&&!seen.has(path)){
    seen.add(path);if(seen.size===2&&!timedOut){overlap=true;clearTimeout(timer);releaseBarrier();}await barrier;
   }
   return value;
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }})))};
 const backend=new FirestoreBackend(db,c.root),order=[];let results;
 try{
  const first=backend.prepareExternalIntentTerminal(p.witness,p.requestKey,firstAction).then(value=>{order.push(firstAction);return value;});
  const second=backend.prepareExternalIntentTerminal(p.witness,p.requestKey,secondAction).then(value=>{order.push(secondAction);return value;});
  results=await Promise.all([first,second]);
 }finally{clearTimeout(timer);releaseBarrier();}
 console.log(JSON.stringify({event:'synthetic-two-action-race',firstAction,overlap,timedOut,order}));
 assert.equal(overlap,true);assert.equal(timedOut,false);assert.deepEqual([...order].sort(),[firstAction,secondAction].sort());
 assert.deepEqual(results,[{state:'ready'},{state:'ready'}]);
 assert.deepEqual((await originFor(c,p).get()).get('terminalRecovery'),{protocol:1,sealPrepared:true,releasePrepared:true});
 for(const [action,pair] of [[firstAction,firstPair],[secondAction,secondPair]]){
  const w=await pair.terminal.get(),q=await pair.recovery.get();assert.equal(w.exists,true);assert.equal(q.exists,true);
  assert.equal(w.get('action'),action);assert.equal(q.get('terminalId'),pair.id);assert.equal(q.get('createdAtMs'),w.get('createdAtMs'));
 }
 assert.notEqual(firstPair.id,secondPair.id);
});

test('job-created branch preserves its result without requiring a terminal pair',async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid);
 const billing={provider:'account_seconds',identityKey,reservationId:randomUUID(),seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,billing);
 const witness=await c.backend.externalIntentWitness(c.account,requestKey,billing);
 const jobId=await c.backend.reserve(c.account,c.input,requestKey,2,'translation:en',1,AI_CATALOG_VERSION,billing,undefined,c.uid);
 const pair=terminalPair(c,{witness},'seal');await pair.recovery.create({unexpected:'existing-corrupt-task'});
 const before=await pair.recovery.get();let recoveryReads=0;
 const db={runTransaction:callback=>c.db.runTransaction(tx=>callback(new Proxy(tx,{get(target,key){
  if(key==='get'||key==='getAll')return async(...args)=>{if(args.some(ref=>ref.path===pair.recovery.path)){recoveryReads++;throw Error('job-created branch read recovery task');}return target[key](...args);};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }})))};
 const backend=new FirestoreBackend(db,c.root);
 const origin=originFor(c,{witness});
 for(const marker of [FieldValue.delete(),{protocol:2,sealPrepared:'unknown'}]){
  await origin.update({terminalRecovery:marker});const beforeOrigin=await origin.get();
  assert.deepEqual(await backend.prepareExternalIntentTerminal(witness,requestKey,'seal'),{state:'job_created',jobId});
  const afterOrigin=await origin.get();assert.deepEqual(afterOrigin.data(),beforeOrigin.data());assert.ok(afterOrigin.updateTime.isEqual(beforeOrigin.updateTime));
 }
 assert.equal(recoveryReads,0);
 const after=await pair.recovery.get();assert.deepEqual(after.data(),before.data());assert.ok(after.updateTime.isEqual(before.updateTime));
 assert.equal((await pair.terminal.get()).exists,false);
});
async function received(c,jobId,attemptId,operation='translation:en'){
 const callKey=operation==='translation:en'?'text-window:0000':'voice-chunk:0000',model=operation==='translation:en'?'gemini-3.8-flash':'gemini-3.8-flash-tts';
 await ref(c,'providerCalls',jobId+'-'+callKey.replace(':','-')).create({jobId,accountId:c.account,attemptId,callKey,model,state:'received',requestSha256:'b'.repeat(64),responseSha256:'c'.repeat(64),responseId:'synthetic-emulator-receipt',httpStatus:200,startedAtMs:Date.now()-100,finishedAtMs:Date.now(),usage:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},fixtureOnly:true});
}
async function enqueue(c,key=randomUUID()){return c.ai.enqueue(c.account,c.input,'translation:en',1,key);}
test('insufficient real account seconds rejects before a video job, outbox or provider call exists',async()=>{
 const c=await fixture(),billing=new AccountBillingClient(undefined,{request:async()=>{throw Object.assign(Error('synthetic'),{response:{status:402}});}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 await assert.rejects(ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid),error=>error instanceof AccountBillingFault&&error.code==='insufficient');
 assert.equal((await c.root.collection('jobs').get()).size,0);assert.equal((await c.root.collection('outbox').get()).size,0);assert.equal((await c.root.collection('providerCalls').get()).size,0);
 assert.equal((await c.backend.readBalance(c.account)).available,100);
});

test('synthetic account replay remains unknown and cancellation creates durable release without changing simulated credits',async()=>{
 const c=await fixture(),calls=[],billing=new AccountBillingClient(undefined,{request:async request=>{calls.push(request);const path=new URL(request.url).pathname, state=path.endsWith('/release')?'released':path.endsWith('/capture')?'captured':'reserved';return {data:{state,reservationId:request.data.reservationId??path.split("/").at(-2),seconds:request.data.seconds??2}};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),requestKey=randomUUID();
 const id=await ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);
 await assert.rejects(ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid),error=>error?.code==='unknown');
 assert.equal(calls.filter(x=>x.url.endsWith('/reservations')).length,1);assert.equal((await c.root.collection('jobs').get()).size,1);
 assert.equal((await ai.status(c.account,id,c.uid)).id,id);
 assert.deepEqual((await c.backend.readBalance(c.account)),{credited:100,available:100,reserved:0,consumed:0,active:1});
 assert.equal((await c.backend.job(c.account,id)).externalBilling.seconds,2);await c.backend.cancel(c.account,id);assert.equal((await c.backend.job(c.account,id)).state,'cancelled',JSON.stringify({job:await c.backend.job(c.account,id),artifact:(await ref(c,'artifacts',id).get()).data(),providerCalls:(await c.root.collection('providerCalls').where('jobId','==',id).get()).size}));
 const billingRows=await c.root.collection('billingOutbox').get();assert.equal(billingRows.size,1,JSON.stringify({rows:billingRows.docs.map(d=>d.data()),job:await c.backend.job(c.account,id)}));assert.equal((await c.backend.pendingExternalBilling()).length,1);assert.equal((await ai.status(c.account,id,c.uid)).billingState,'pending');assert.equal(await ai.drainExternalBilling().then(x=>x.settled),1);assert.equal((await c.backend.pendingExternalBilling()).length,0);assert.equal((await ai.status(c.account,id,c.uid)).billingState,'settled');
 assert.equal(calls.filter(x=>x.url.endsWith('/release')).length,1);assert.equal(calls.filter(x=>x.url.endsWith('/capture')).length,0);
 assert.equal((await c.backend.readBalance(c.account)).available,100);
});

test('a captured reservation without a job remains visible for reconciliation and blocks a new paid intent',async()=>{
 const c=await fixture(),requestKey=randomUUID(),reservationId=randomUUID(),identityKey=accountIdentityKey(c.uid);
 const billingData={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,billingData);
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;
  assert.ok(path.endsWith('/status'),'must not compensate or create another reservation automatically');
  return {data:{state:'captured',reservationId:path.split('/').at(-2),seconds:2}};
 }});
 const ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 await ai.drainExternalBilling();
 const intents=await c.root.collection('billingIntents').get();assert.equal(intents.size,1);
 const row=intents.docs[0].data();assert.equal(row.state,'needs_review');assert.equal(row.reservationId,reservationId);assert.equal(row.seconds,2);
 assert.equal((await c.root.collection('requests').get()).size,0);assert.equal((await c.root.collection('jobs').get()).size,0);
 await assert.rejects(c.backend.beginExternalBillingIntent(c.account,c.input,randomUUID(),'translation:en',1,{...billingData,reservationId:randomUUID()}),error=>error.code==='conflict');
 assert.equal((await c.root.collection('billingIntents').get()).size,1);
});

test('a concurrent quota response cannot hide another committed reservation for the same request',{timeout:15000},async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=reservationFor(c.account,identityKey,c.input,'translation:en',1,requestKey);
 let calls=0,entered,release;const firstAtAccount=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith('/reservations')){calls++;if(calls===1){entered();await resume;return {data:{state:'reserved',reservationId,seconds:2}};}throw Object.assign(Error('synthetic quota'),{response:{status:429}});}
  if(path.endsWith('/status'))return {data:{state:'reserved',reservationId,seconds:2}};
  throw Error('unexpected account operation');
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const first=ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid).then(id=>({id}),error=>({error}));
 try{
  await firstAtAccount;const second=await ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid).then(id=>({id}),error=>({error}));
  release();const original=await first;const jobs=await c.root.collection('jobs').get(),intents=await c.root.collection('billingIntents').get();
  assert.equal(jobs.size,1,'the committed reservation must remain recoverable as one job');
  assert.ok(original.id||second.id);assert.equal(intents.docs[0].get('state'),'job_created');
 }finally{release();await first;}
});

test('a guard activated after intent creation blocks reservation before its admission recheck',{timeout:15000},async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),otherKey=randomUUID(),otherReservation=randomUUID();let accountCalls=0,entered,release;
 const begun=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;}),originalBegin=c.backend.beginExternalBillingIntent.bind(c.backend);
 c.backend.beginExternalBillingIntent=async(...args)=>{const result=await originalBegin(...args);if(args[2]===requestKey){entered();await resume;}return result;};
 const billing=new AccountBillingClient(undefined,{request:async request=>{accountCalls++;return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const first=ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid).then(id=>({id}),error=>({error}));
 try{
  await begun;const other={provider:'account_seconds',identityKey,reservationId:otherReservation,seconds:2};
  await originalBegin(c.account,c.input,otherKey,'translation:en',1,other);
  await c.backend.recordExternalBillingReview(c.account,otherKey,other,{reservationId:otherReservation,state:'captured',seconds:2});
  release();const result=await first;assert.ok(result.error);assert.equal(accountCalls,0);assert.equal((await c.root.collection('jobs').get()).size,0);
 }finally{release();await first;c.backend.beginExternalBillingIntent=originalBegin;}
});

test('recovery cannot release a reservation after a concurrent request has created its job',{timeout:15000},async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=reservationFor(c.account,identityKey,c.input,'translation:en',1,requestKey),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);
 let remoteState='reserved',entered,release;const atRelease=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith('/release')){entered();await resume;remoteState='released';}
  return {data:{state:remoteState,reservationId:request.data.reservationId??path.split('/').at(-2),seconds:2}};
 }});
 const ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),originalReserve=c.backend.reserve.bind(c.backend);let first=true;
 c.backend.reserve=async(...args)=>{if(first){first=false;throw new LedgerFault('invalid');}return originalReserve(...args);};
 const draining=ai.drainExternalBilling();
 try{
  const phase=await Promise.race([atRelease.then(()=> 'releasing'),draining.then(()=> 'deferred')]);
  if(phase==='deferred'){assert.equal(remoteState,'reserved');assert.equal((await c.root.collection('jobs').get()).size,0);return;}
  let jobId;try{jobId=await ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);}catch(error){assert.ok(['conflict','invalid','unavailable'].includes(error.code),String(error));}
  release();await draining;
  const jobs=await c.root.collection('jobs').get();
  if(jobId){assert.equal(jobs.size,1);assert.equal(remoteState,'reserved','a created job must never lose its reservation to recovery');}
  else{assert.equal(jobs.size,0);assert.equal(remoteState,'released');}
 }finally{release();await draining.catch(()=>undefined);c.backend.reserve=originalReserve;}
});

test('recovery defers reserved status without an admission receipt, a job or a release',{timeout:60000},async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=reservationFor(c.account,identityKey,c.input,'translation:en',1,requestKey),data={provider:'account_seconds',identityKey,reservationId,seconds:2},calls=[];let returnedStatuses=0;
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);
 const intentId=sha(JSON.stringify([c.account,requestKey])),intent=ref(c,'billingIntents',intentId),origin=ref(c,'billingIntentWitnesses',intentId);
 const beforeIntent=(await intent.get()).data(),beforeOrigin=(await origin.get()).data(),beforeBalance=await c.backend.readBalance(c.account),beforeForeign=await c.backend.readBalance(c.foreign);
 assert.equal(beforeIntent.state,'reserve_pending');assert.equal(beforeOrigin.baseline,'before_reservation');
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);
  assert.equal(path,`/api/internal/video/reservations/${reservationId}/status`,'a synthetic reserved status must not trigger another Account operation');
  returnedStatuses++;
  return {data:{state:'reserved',reservationId,seconds:2}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const result=await ai.drainExternalBilling();
 assert.deepEqual(calls,[`/api/internal/video/reservations/${reservationId}/status`]);assert.equal(returnedStatuses,1);assert.equal(result.intentsRecovered,0);assert.equal(result.intentsFailed,1);
 const intents=await c.root.collection('billingIntents').get();assert.equal(intents.size,1);assert.equal(intents.docs[0].get('state'),'reserve_pending');
 assert.ok(Number.isSafeInteger(intents.docs[0].get('attempts'))&&Number.isSafeInteger(intents.docs[0].get('nextAttemptAt')));
 assert.deepEqual((await origin.get()).data(),beforeOrigin);assert.equal((await intent.get()).get('id'),intentId);
 assert.deepEqual(await c.backend.readBalance(c.account),beforeBalance);assert.deepEqual(await c.backend.readBalance(c.foreign),beforeForeign);
 assert.equal((await ref(c,'billingGuards',c.account).get()).exists,false);assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
 assert.equal((await c.root.collection('jobs').get()).size,0);assert.equal((await c.root.collection('billingIntentTerminalWitnesses').get()).size,0);
});

test('a job created before the 404 recovery fence prevents seal and release',{timeout:60000},async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=reservationFor(c.account,identityKey,c.input,'translation:en',1,requestKey),data={provider:'account_seconds',identityKey,reservationId,seconds:2},calls=[];
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);
 let entered,release;const atFence=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);
  if(path===`/api/internal/video/reservations/${reservationId}/status`)throw Object.assign(Error('synthetic status not found'),{response:{status:404}});
  throw Error('unexpected synthetic Account operation');
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),originalPrepare=c.backend.prepareTerminalFromDirectObservation.bind(c.backend);
 c.backend.prepareTerminalFromDirectObservation=async(...args)=>{assert.equal(args[2],'seal');assert.equal(args[3],'status_not_found');entered();await resume;return originalPrepare(...args);};
 const draining=ai.drainExternalBilling();
 try{
  await Promise.race([atFence,draining.then(()=>{throw Error('synthetic recovery finished before the fence');})]);
  // Models a concurrent trusted internal writer; this does not prove a remote ACK.
  const id=await c.backend.reserve(c.account,c.input,requestKey,2,'translation:en',1,AI_CATALOG_VERSION,data,undefined,c.uid);
  const before=(await ref(c,'jobs',id).get()).data();release();const result=await draining;
  assert.deepEqual(calls,[`/api/internal/video/reservations/${reservationId}/status`]);assert.equal(result.intentsRecovered,0);assert.equal(result.intentsFailed,1);
  assert.deepEqual((await ref(c,'jobs',id).get()).data(),before);assert.equal((await c.backend.job(c.account,id)).state,'queued');
  const incidents=await c.root.collection('billingIntentObservationIncidents').get();assert.equal(incidents.size,1);
  assert.equal(incidents.docs[0].get('source'),'status');assert.equal(incidents.docs[0].get('observedState'),'not_found');
  assert.equal((await c.root.collection('billingIntentTerminalWitnesses').get()).size,0);
 }finally{release();await draining.catch(()=>undefined);c.backend.prepareTerminalFromDirectObservation=originalPrepare;}
});

test('job creation and the release fence exclude each other in either commit order',{timeout:60000},async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=reservationFor(c.account,identityKey,c.input,'translation:en',1,requestKey),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);
 let entered,release;const atFence=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 const pausedBackend=new FirestoreBackend({runTransaction:async callback=>{entered();await resume;return c.db.runTransaction(callback);}},c.root);
 const fencing=pausedBackend.fenceExternalBillingRelease(c.account,requestKey,data);
 try{
  await atFence;
  // The synthetic job stands in for a previously admitted trusted writer, not an Account ACK.
  const id=await c.backend.reserve(c.account,c.input,requestKey,2,'translation:en',1,AI_CATALOG_VERSION,data,undefined,c.uid);
  release();assert.deepEqual(await fencing,{state:'job_created',jobId:id});assert.equal((await c.backend.job(c.account,id)).state,'queued');
 }finally{release();await fencing.catch(()=>undefined);}
 const d=await fixture(),otherKey=randomUUID(),otherIdentity=accountIdentityKey(d.uid),otherReservation=reservationFor(d.account,otherIdentity,d.input,'translation:en',1,otherKey),other={provider:'account_seconds',identityKey:otherIdentity,reservationId:otherReservation,seconds:2};
 await d.backend.beginExternalBillingIntent(d.account,d.input,otherKey,'translation:en',1,other);
 const otherIntent=ref(d,'billingIntents',sha(JSON.stringify([d.account,otherKey]))),beforeOwner=await d.backend.readBalance(d.account),beforeForeign=await d.backend.readBalance(d.foreign),beforeMovements=await d.root.collection('movements').get();
 assert.equal((await otherIntent.get()).get('state'),'reserve_pending');assert.equal((await ref(d,'billingGuards',d.account).get()).exists,false);
 const ownerIdentity=await ref(d,'identities',otherIdentity).get();assert.equal(ownerIdentity.get('uid'),d.uid);assert.equal(ownerIdentity.get('accountId'),d.account);
 assert.equal((await ref(d,'billingIntentAdmissionGuards',otherIntent.id).get()).get('state'),'clear');
 assert.deepEqual(await d.backend.fenceExternalBillingRelease(d.account,otherKey,other),{state:'release_pending'});
 assert.equal((await otherIntent.get()).get('state'),'release_pending');
 await assert.rejects(d.backend.reserve(d.account,d.input,otherKey,2,'translation:en',1,AI_CATALOG_VERSION,other,undefined,d.uid),error=>error.code==='conflict');
 assert.equal((await otherIntent.get()).get('state'),'release_pending');assert.deepEqual(await d.backend.readBalance(d.account),beforeOwner);assert.deepEqual(await d.backend.readBalance(d.foreign),beforeForeign);
 assert.equal((await ref(d,'billingGuards',d.account).get()).exists,false);assert.equal((await ref(d,'billingIntentAdmissionGuards',otherIntent.id).get()).get('state'),'clear');
 const afterMovements=await d.root.collection('movements').get();assert.deepEqual(afterMovements.docs.map(doc=>({id:doc.id,data:doc.data()})),beforeMovements.docs.map(doc=>({id:doc.id,data:doc.data()})));
 assert.equal((await d.root.collection('jobs').get()).size,0);
});

async function syntheticReleaseAccount(c,identityKey,reservationId,failureMode){
 assert.ok(['after_apply','before_apply'].includes(failureMode));
 const root=c.root.collection('syntheticAccountService').doc(randomUUID());await root.create({purpose:'synthetic-release-recovery-v1'});
 const store=new AccountStore(c.db,root),owner=await store.bootstrap(c.uid),foreign=await store.bootstrap(c.foreignUid);
 await root.collection('accounts').doc(owner.account.id).update({credited:20,available:20});
 await root.collection('accounts').doc(foreign.account.id).update({credited:7,available:7});
 await store.reserveVideo(identityKey,reservationId,2);
 const statusPath=`/api/internal/video/reservations/${reservationId}/status`,releasePath=`/api/internal/video/reservations/${reservationId}/release`,calls=[],unexpected=[];
 let releases=0,applied=0;
 const beforeForeign=(await store.me(c.foreignUid)).balance;
 const client=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);
  if(path!==statusPath&&path!==releasePath){unexpected.push('path');throw Error('unexpected synthetic Account operation');}
  const data=request.data,expectedKeys=path===statusPath?'identityKey':'identityKey,seconds';
  if(request.method!=='POST'||!data||Object.keys(data).sort().join(',')!==expectedKeys||data.identityKey!==identityKey||(path===releasePath&&data.seconds!==2)){
   unexpected.push('request');throw Error('invalid synthetic Account request');
  }
  if(path===statusPath)return {data:await store.videoReservation(identityKey,reservationId)};
  releases++;
  if(failureMode==='before_apply'&&releases===1)throw Error('synthetic release failed before commit');
  const result=await store.settleVideo(identityKey,reservationId,'release',2);if(result.settled)applied++;
  if(failureMode==='after_apply'&&releases===1)throw Error('synthetic lost release acknowledgement');
  return {data:{reservationId,state:result.state,seconds:result.seconds}};
 }});
 return {root,store,owner:owner.account.id,beforeForeign,statusPath,releasePath,calls,unexpected,client,releases:()=>releases,applied:()=>applied};
}
async function assertSyntheticRelease(c,remote){
 assert.deepEqual((await remote.store.me(c.uid)).balance,{unit:'video_seconds',credited:20,available:20,reserved:0,consumed:0,active:0});
 assert.deepEqual((await remote.store.me(c.foreignUid)).balance,remote.beforeForeign);
 const ledger=await remote.root.collection('ledgerEntries').get(),releaseRows=ledger.docs.filter(doc=>doc.get('kind')==='video_release');
 assert.equal(releaseRows.length,1);assert.equal(releaseRows[0].get('ownerAccountId'),remote.owner);assert.equal(releaseRows[0].get('seconds'),2);
 assert.equal(remote.applied(),1);assert.deepEqual(remote.unexpected,[]);
}

test('a lost release acknowledgement is recovered by status without releasing twice',{timeout:60000},async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=reservationFor(c.account,identityKey,c.input,'translation:en',1,requestKey),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);
 assert.deepEqual(await c.backend.fenceExternalBillingRelease(c.account,requestKey,data),{state:'release_pending'});
 const remote=await syntheticReleaseAccount(c,identityKey,reservationId,'after_apply'),beforeLocal=await c.backend.readBalance(c.account),beforeForeign=await c.backend.readBalance(c.foreign);
 const ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,remote.client);
 {
  assert.equal((await ai.drainExternalBilling()).intentsFailed,1);
  const docs=await c.root.collection('billingIntents').get();assert.equal(docs.size,1);assert.equal(docs.docs[0].get('state'),'release_pending');
  assert.equal((await c.root.collection('billingIntentWitnesses').get()).size,1);
  const terminalWitnesses=await c.root.collection('billingIntentTerminalWitnesses').get();assert.equal(terminalWitnesses.size,1);assert.equal(terminalWitnesses.docs[0].get('stage'),'prepared');
  assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);assert.equal(docs.docs[0].get('releaseConfirmed'),undefined);
  assert.deepEqual(remote.calls,[remote.statusPath,remote.releasePath]);assert.equal(remote.releases(),1);assert.equal(remote.applied(),1);
  await docs.docs[0].ref.update({nextAttemptAt:0});
  assert.equal((await ai.drainExternalBilling()).intentsFailed,0);
  const closed=await docs.docs[0].ref.get();assert.equal(closed.get('state'),'closed');assert.equal(closed.get('releaseObservationSource'),'status');
  assert.deepEqual(remote.calls,[remote.statusPath,remote.releasePath,remote.statusPath]);assert.equal(remote.releases(),1);await assertSyntheticRelease(c,remote);
  await ai.drainExternalBilling();assert.deepEqual(remote.calls,[remote.statusPath,remote.releasePath,remote.statusPath]);
  assert.deepEqual(await c.backend.readBalance(c.account),beforeLocal);assert.deepEqual(await c.backend.readBalance(c.foreign),beforeForeign);
  assert.equal((await c.root.collection('jobs').get()).size,0);
 }
});

test('a release failure before commit is retried with exactly one ledger movement',{timeout:60000},async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=reservationFor(c.account,identityKey,c.input,'translation:en',1,requestKey),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);
 assert.deepEqual(await c.backend.fenceExternalBillingRelease(c.account,requestKey,data),{state:'release_pending'});
 const remote=await syntheticReleaseAccount(c,identityKey,reservationId,'before_apply'),beforeLocal=await c.backend.readBalance(c.account),beforeForeign=await c.backend.readBalance(c.foreign);
 const ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,remote.client);
 assert.equal((await ai.drainExternalBilling()).intentsFailed,1);
 const docs=await c.root.collection('billingIntents').get();assert.equal(docs.size,1);assert.equal(docs.docs[0].get('state'),'release_pending');
 assert.deepEqual(remote.calls,[remote.statusPath,remote.releasePath]);assert.equal(remote.releases(),1);assert.equal(remote.applied(),0);
 assert.equal((await remote.store.videoReservation(identityKey,reservationId)).state,'reserved');
 const beforeLedger=await remote.root.collection('ledgerEntries').get();assert.equal(beforeLedger.docs.filter(doc=>doc.get('kind')==='video_release').length,0);
 await docs.docs[0].ref.update({nextAttemptAt:0});
 assert.equal((await ai.drainExternalBilling()).intentsFailed,0);
 const closed=await docs.docs[0].ref.get();assert.equal(closed.get('state'),'closed');assert.equal(closed.get('releaseObservationSource'),'release_ack');
 assert.deepEqual(remote.calls,[remote.statusPath,remote.releasePath,remote.statusPath,remote.releasePath]);assert.equal(remote.releases(),2);await assertSyntheticRelease(c,remote);
 await ai.drainExternalBilling();assert.deepEqual(remote.calls,[remote.statusPath,remote.releasePath,remote.statusPath,remote.releasePath]);
 assert.deepEqual(await c.backend.readBalance(c.account),beforeLocal);assert.deepEqual(await c.backend.readBalance(c.foreign),beforeForeign);
 assert.equal((await c.root.collection('jobs').get()).size,0);
});

test('concurrent direct releases close exactly once and the identical replay is already_closed',async()=>{
 const c=await fixture(),p=await preparedIntent(c),observation={action:'release',source:'release_ack',reservationId:p.reservationId,seconds:2,state:'released'};
 const snapshot=await directSnapshot(c,p,'release');
 const results=await Promise.all([c.backend.finishExternalBillingRelease(c.account,p.requestKey,p.billing,observation,p.witness,'release_ack',snapshot),c.backend.finishExternalBillingRelease(c.account,p.requestKey,p.billing,observation,p.witness,'release_ack',snapshot)]);
 // LV-019.B E-3: both callers learn the same close (idempotent), and the intent records that close exactly once.
 assert.deepEqual(results.sort(),[true,true]);
 const closed=await ref(c,'billingIntents',p.witness.intentId).get();assert.equal(closed.get('state'),'closed');assert.equal(closed.get('releaseConfirmed'),true);assert.equal(closed.get('sealConfirmed'),undefined);
 const repeated=await c.backend.recordConfirmedIntentObservation(p.witness,observation,snapshot);assert.equal(repeated.state,'already_closed');assert.equal(repeated.ownerBlocked,false);
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0,'no incident for the exact close');
 assert.notEqual((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
});

function pauseObservationTransaction(c){
 let release;const barrier=new Promise(resolve=>{release=resolve;});
 return {backend:new FirestoreBackend({runTransaction:async callback=>{await barrier;return c.db.runTransaction(callback);}},c.root),release};
}

test('a later source mutation cannot turn an unwitnessed release ACK into status',async()=>{
 const c=await fixture(),requestKey=randomUUID(),billing={provider:'account_seconds',identityKey:accountIdentityKey(c.uid),reservationId:randomUUID(),seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,billing);
 const witness=await c.backend.externalIntentWitness(c.account,requestKey,billing),gate=pauseObservationTransaction(c);
 const observed={action:'release',source:'release_ack',state:'released',reservationId:billing.reservationId,seconds:2};
 const waiting=gate.backend.recordConfirmedIntentObservation(witness,observed);observed.source='status';gate.release();
 const result=await waiting,doc=await ref(c,'billingIntents',witness.intentId).get();
 assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,false);assert.equal(doc.get('state'),'reserve_pending');assert.equal(doc.get('releaseConfirmed'),undefined);
 assert.equal((await c.root.collection('billingIntentTerminalWitnesses').get()).size,0);
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).docs[0].get('source'),'release_ack');
 assert.equal((await ref(c,'billingReviewIncidents',witness.intentId).get()).exists,false);
 assert.equal((await ref(c,'billingGuards',c.account).get()).exists,false);
});

test('confirmed observation snapshots witness and permitted fields before the transaction',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'release'),snapshot=await directSnapshot(c,p,'release'),gate=pauseObservationTransaction(c);
 const witness={...p.witness,unexpected:'synthetic-extra-witness'},observed={action:'release',source:'release_ack',state:'released',reservationId:p.reservationId,seconds:2,terminalAction:'seal',unexpected:'synthetic-extra-observation'};
 const waiting=gate.backend.recordConfirmedIntentObservation(witness,observed,snapshot);
 Object.assign(witness,{accountId:c.foreign,inputId:randomUUID(),identityKey:'f'.repeat(64),reservationId:randomUUID(),seconds:7,intentId:'e'.repeat(64),operation:'changed',revision:2});
 Object.assign(observed,{action:'seal',source:'status',state:'sealed',reservationId:randomUUID(),seconds:7,terminalAction:'release'});await terminalPair(c,p,'release').terminal.delete();gate.release();
 const result=await waiting;assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,true);
 const incidents=await c.root.collection('billingIntentObservationIncidents').get();assert.equal(incidents.size,1);
 const incident=incidents.docs[0],review=await ref(c,'billingReviewIncidents',p.witness.intentId).get(),recorded=review.get('firstConfirmedObservation');
 assert.equal(incident.get('accountId'),c.account);assert.equal(incident.get('identityKey'),p.witness.identityKey);assert.equal(incident.get('source'),'release_ack');
 assert.equal(incident.get('unexpected'),undefined);assert.equal(incident.get('terminalAction'),undefined);
 assert.deepEqual(Object.keys(recorded).sort(),['action','atMs','reservationId','seconds','source','state']);
 assert.equal(recorded.action,'release');assert.equal(recorded.source,'release_ack');assert.equal(recorded.state,'released');assert.equal(recorded.reservationId,p.reservationId);assert.equal(recorded.seconds,2);
 assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);
});

for(const action of ['release','seal'])test('confirmed '+action+' wrapper snapshots a mutable witness and observation',async()=>{
 const c=await fixture(),p=await preparedIntent(c,action),snapshot=await directSnapshot(c,p,action),gate=pauseObservationTransaction(c),witness={...p.witness,unexpected:'synthetic-extra'},observed={reservationId:p.reservationId,seconds:2,state:action==='release'?'released':'sealed',unexpected:'synthetic-extra'};
 const waiting=action==='release'?gate.backend.finishExternalBillingRelease(c.account,p.requestKey,p.billing,observed,witness,'release_ack',snapshot):gate.backend.finishExternalBillingSeal(c.account,p.requestKey,p.billing,observed,witness,snapshot);
 Object.assign(witness,{accountId:c.foreign,inputId:randomUUID(),identityKey:'f'.repeat(64),reservationId:randomUUID(),seconds:7,intentId:'e'.repeat(64)});
 Object.assign(observed,{reservationId:randomUUID(),seconds:7,state:'reserved'});gate.release();assert.equal(await waiting,true);
 const closed=await ref(c,'billingIntents',p.witness.intentId).get();assert.equal(closed.get('state'),'closed');assert.equal(closed.get(action==='release'?'releaseConfirmed':'sealConfirmed'),true);
 assert.equal(closed.get(action==='release'?'releaseObservationSource':'sealObservationSource'),action==='release'?'release_ack':'seal_ack');
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);
});

for(const scenario of [
 {source:'status',action:'release'},
 {source:'release_ack',action:'release',prepared:'release'},
 {source:'seal_status',action:'release',prepared:'seal'},
 {source:'seal_ack',action:'seal',prepared:'seal'},
 {source:'resolution_status',action:'release',prepared:'release',terminalAction:'release'},
 {source:'resolution_status',action:'release',prepared:'seal',terminalAction:'seal'},
 {source:'resolution_status',action:'seal',prepared:'seal',terminalAction:'seal'},
])test('confirmed observation preserves valid source '+scenario.source+' '+scenario.action+' '+(scenario.terminalAction??''),async()=>{
 const c=await fixture(),p=scenario.prepared?await preparedIntent(c,scenario.prepared):await fencedIntent(c);
 const observed={action:scenario.action,source:scenario.source,state:scenario.action==='seal'?'sealed':'released',reservationId:p.reservationId,seconds:2,...(scenario.terminalAction?{terminalAction:scenario.terminalAction}:{})};
 const snapshot=scenario.source==='resolution_status'?await terminalSnapshot(c,p,scenario.terminalAction):await directSnapshot(c,p,scenario.source==='status'?'status':scenario.source==='release_ack'?'release':'seal');
 const result=await c.backend.recordConfirmedIntentObservation(p.witness,observed,snapshot);assert.equal(result.state,'closed');
 const closed=await ref(c,'billingIntents',p.witness.intentId).get();assert.equal(closed.get(scenario.action==='seal'?'sealObservationSource':'releaseObservationSource'),scenario.source);
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);assert.equal((await ref(c,'billingGuards',c.account).get()).exists,false);
});

test('resolution-status review retains terminalAction while discarding extra fields',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'release'),snapshot=await terminalSnapshot(c,p,'release'),observed={action:'release',source:'resolution_status',terminalAction:'release',state:'released',reservationId:p.reservationId,seconds:2,unexpected:'synthetic-extra'};
 await terminalPair(c,p,'release').terminal.delete();
 const result=await c.backend.recordConfirmedIntentObservation({...p.witness,unexpected:'synthetic-extra'},observed,snapshot);assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,true);
 const recorded=(await ref(c,'billingReviewIncidents',p.witness.intentId).get()).get('firstConfirmedObservation');
 assert.deepEqual(Object.keys(recorded).sort(),['action','atMs','reservationId','seconds','source','state','terminalAction']);assert.equal(recorded.terminalAction,'release');
});

test('concurrent direct seals close exactly once and the identical replay is already_closed',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),observation={action:'seal',source:'seal_ack',reservationId:p.reservationId,seconds:2,state:'sealed'};
 const snapshot=await directSnapshot(c,p,'seal');
 const results=await Promise.all([c.backend.finishExternalBillingSeal(c.account,p.requestKey,p.billing,observation,p.witness,snapshot),c.backend.finishExternalBillingSeal(c.account,p.requestKey,p.billing,observation,p.witness,snapshot)]);
 assert.deepEqual(results.sort(),[true,true]);
 const repeated=await c.backend.recordConfirmedIntentObservation(p.witness,observation,snapshot);assert.equal(repeated.state,'already_closed');assert.equal(repeated.ownerBlocked,false);
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0,'no incident for the exact close');
 assert.notEqual((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
 const closed=await ref(c,'billingIntents',p.witness.intentId).get();assert.equal(closed.get('sealConfirmed'),true);assert.equal(closed.get('releaseConfirmed'),undefined);
});

test('resolution status closes a witnessed seal once without creating a new Account action',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),observed={action:'seal',source:'resolution_status',terminalAction:'seal',reservationId:p.reservationId,seconds:2,state:'sealed'};
 const snapshot=await terminalSnapshot(c,p,'seal');
 const results=await Promise.all([c.backend.recordConfirmedIntentObservation(p.witness,observed,snapshot),c.backend.recordConfirmedIntentObservation(p.witness,observed,snapshot)]);
 assert.deepEqual(results.map(v=>v.state).sort(),['already_closed','closed']);
 const closed=await ref(c,'billingIntents',p.witness.intentId).get();assert.equal(closed.get('sealConfirmed'),true);assert.equal(closed.get('sealObservationSource'),'resolution_status');
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);assert.equal((await ref(c,'billingGuards',c.account).get()).exists,false);
});

for(const terminalAction of ['release','seal'])test('resolution status closes a witnessed release after '+terminalAction,async()=>{
 const c=await fixture(),p=await preparedIntent(c,terminalAction),observed={action:'release',source:'resolution_status',terminalAction,reservationId:p.reservationId,seconds:2,state:'released'};
 const snapshot=await terminalSnapshot(c,p,terminalAction);
 assert.equal((await c.backend.recordConfirmedIntentObservation(p.witness,observed,snapshot)).state,'closed');
 const closed=await ref(c,'billingIntents',p.witness.intentId).get();assert.equal(closed.get('releaseConfirmed'),true);assert.equal(closed.get('releaseObservationSource'),'resolution_status');
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
});

test('a sealed resolution with only a release witness requires review instead of closing',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'release'),observed={action:'seal',source:'resolution_status',terminalAction:'release',reservationId:p.reservationId,seconds:2,state:'sealed'};
 const snapshot=await terminalSnapshot(c,p,'release');
 const result=await c.backend.recordConfirmedIntentObservation(p.witness,observed,snapshot);assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,true);
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('sealConfirmed'),undefined);
 assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
});

test('resolution status without the named witness or with malformed fields cannot close normally',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),snapshot=await terminalSnapshot(c,p,'seal'),terminal=await c.root.collection('billingIntentTerminalWitnesses').get();assert.equal(terminal.size,1);await terminal.docs[0].ref.delete();
 const observed={action:'seal',source:'resolution_status',terminalAction:'seal',reservationId:p.reservationId,seconds:2,state:'sealed'};
 for(const bad of [{...observed,terminalAction:'invalid'},{...observed,terminalAction:undefined},{...observed,state:'reserved'},{...observed,seconds:3}])await assert.rejects(c.backend.recordConfirmedIntentObservation(p.witness,bad,snapshot),error=>error.code==='invalid');
 const result=await c.backend.recordConfirmedIntentObservation(p.witness,observed,snapshot);assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,true);
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('sealConfirmed'),undefined);
});

test('resolution status with a changed owner never blocks either unrelated account',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),snapshot=await terminalSnapshot(c,p,'seal'),identity=ref(c,'identities',p.witness.identityKey);
 await identity.update({accountId:c.foreign});
 const observed={action:'seal',source:'resolution_status',terminalAction:'seal',reservationId:p.reservationId,seconds:2,state:'sealed'};
 const result=await c.backend.recordConfirmedIntentObservation(p.witness,observed,snapshot);assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,false);
 assert.equal((await ref(c,'billingGuards',c.account).get()).exists,false);assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);
 assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).docs[0].get('attribution'),'unverified');
});

test('resolution status does not overwrite a malformed guard or claim verified attribution',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),snapshot=await terminalSnapshot(c,p,'seal'),guard=ref(c,'billingGuards',c.account);
 await guard.set({accountId:c.account,blocked:'corrupt'});
 const observed={action:'seal',source:'resolution_status',terminalAction:'seal',reservationId:p.reservationId,seconds:2,state:'sealed'};
 const result=await c.backend.recordConfirmedIntentObservation(p.witness,observed,snapshot);assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,false);
 assert.equal((await guard.get()).get('blocked'),'corrupt');assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).docs[0].get('attribution'),'unverified');
});

test('terminal recovery accepts a clean witness and rejects injected fields or a changed owner',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get();assert.equal(docs.size,1);const terminal=docs.docs[0].ref;
 const candidate=await c.backend.terminalWitnessForRecovery(terminal.id);assert.ok(candidate);assert.deepEqual({witness:candidate.witness,action:candidate.action},{witness:p.witness,action:'seal'});assert.equal(candidate.snapshot.origin.exists,true);assert.equal(candidate.snapshot.sealWitness.exists,true);assert.equal(candidate.snapshot.sealRecovery.exists,true);
 await terminal.update({extraField:'synthetic-untrusted-field'});
 assert.equal(await c.backend.terminalWitnessForRecovery(terminal.id),null);
 await terminal.update({extraField:FieldValue.delete(),accountId:c.foreign});assert.equal(await c.backend.terminalWitnessForRecovery(terminal.id),null);
 assert.equal((await ref(c,'billingGuards',c.account).get()).exists,false);assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);
});

test('terminal recovery obtains Account resolution and records only a correlated terminal observation',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get(),paths=[];
 const billing=new AccountBillingClient(undefined,{request:async request=>{const path=new URL(request.url).pathname;paths.push(path);assert.ok(path.endsWith('/resolution'));return {data:{reservationId:p.reservationId,seconds:2,state:'sealed'}};}});
 const ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 assert.equal((await ai.recoverTerminalObservation(docs.docs[0].id)).state,'closed');
 assert.equal((await ai.recoverTerminalObservation(docs.docs[0].id)).state,'already_closed');
 assert.equal(paths.length,2);assert.ok(paths.every(path=>path.endsWith('/resolution')));
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('sealObservationSource'),'resolution_status');
});

for(const action of ['seal','release'])test('terminal recovery observes an Account release after a prepared '+action,async()=>{
 const c=await fixture(),p=await preparedIntent(c,action),docs=await c.root.collection('billingIntentTerminalWitnesses').get(),paths=[];
 const billing=new AccountBillingClient(undefined,{request:async request=>{paths.push(new URL(request.url).pathname);return {data:{reservationId:p.reservationId,seconds:2,state:'released'}};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 assert.equal((await ai.recoverTerminalObservation(docs.docs[0].id)).state,'closed');
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('releaseObservationSource'),'resolution_status');assert.equal(paths.length,1);assert.ok(paths[0].endsWith('/resolution'));
});

test('terminal recovery reviews a seal observed for a release-only witness',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'release'),docs=await c.root.collection('billingIntentTerminalWitnesses').get();
 const billing=new AccountBillingClient(undefined,{request:async()=>({data:{reservationId:p.reservationId,seconds:2,state:'sealed'}})}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const result=await ai.recoverTerminalObservation(docs.docs[0].id);assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,true);
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('sealConfirmed'),undefined);
});

test('terminal recovery rejects an Account response with different seconds',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get();
 const billing=new AccountBillingClient(undefined,{request:async()=>({data:{reservationId:p.reservationId,seconds:3,state:'sealed'}})}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 await assert.rejects(ai.recoverTerminalObservation(docs.docs[0].id),error=>error.code==='unavailable');
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('state'),'release_pending');
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
});

for(const state of ['not_found','reserved','captured'])test('terminal recovery leaves '+state+' unresolved without issuing a financial action',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get(),paths=[];
 const billing=new AccountBillingClient(undefined,{request:async request=>{const path=new URL(request.url).pathname;paths.push(path);assert.ok(path.endsWith('/resolution'));if(state==='not_found')throw Object.assign(Error('synthetic missing'),{response:{status:404}});return {data:{reservationId:p.reservationId,seconds:2,state}};}});
 const ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),result=await ai.recoverTerminalObservation(docs.docs[0].id);
 assert.deepEqual(result,{state:'unresolved',reason:state});assert.equal(paths.length,1);
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('state'),'release_pending');
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
});

test('terminal recovery rechecks witness and owner after reading Account',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get(),terminal=docs.docs[0].ref;
 const billing=new AccountBillingClient(undefined,{request:async()=>{await terminal.delete();return {data:{reservationId:p.reservationId,seconds:2,state:'sealed'}};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const result=await ai.recoverTerminalObservation(terminal.id);assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,true);
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('sealConfirmed'),undefined);
 assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);
});

test('terminal recovery does not block another account when owner changes during the read',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get();
 const billing=new AccountBillingClient(undefined,{request:async()=>{await ref(c,'identities',p.identityKey).update({accountId:c.foreign});return {data:{reservationId:p.reservationId,seconds:2,state:'sealed'}};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const result=await ai.recoverTerminalObservation(docs.docs[0].id);assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,false);
 assert.equal((await ref(c,'billingGuards',c.account).get()).exists,false);assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);
 assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
});

test('terminal recovery never queries Account for an unverified witness',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get(),terminal=docs.docs[0].ref;await ref(c,'billingIntentWitnesses',p.witness.intentId).delete();let calls=0;
 const billing=new AccountBillingClient(undefined,{request:async()=>{calls++;throw Error('must not be called');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 assert.deepEqual(await ai.recoverTerminalObservation(terminal.id),{state:'unverified'});assert.equal(calls,0);
});

test('terminal recovery refuses a copied witness at a different document ID',async()=>{
 const c=await fixture();await preparedIntent(c,'seal');const docs=await c.root.collection('billingIntentTerminalWitnesses').get(),wrong=ref(c,'billingIntentTerminalWitnesses','f'.repeat(64));
 await wrong.set(docs.docs[0].data());let calls=0;
 const billing=new AccountBillingClient(undefined,{request:async()=>{calls++;throw Error('must not be called');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 assert.deepEqual(await ai.recoverTerminalObservation(wrong.id),{state:'unverified'});assert.equal(calls,0);
});

test('terminal recovery keeps a missing result pending and can read a later seal',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get();let reads=0;
 const billing=new AccountBillingClient(undefined,{request:async()=>{if(++reads===1)throw Object.assign(Error('synthetic missing'),{response:{status:404}});return {data:{reservationId:p.reservationId,seconds:2,state:'sealed'}};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 assert.deepEqual(await ai.recoverTerminalObservation(docs.docs[0].id),{state:'unresolved',reason:'not_found'});
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('state'),'release_pending');
 assert.equal((await ai.recoverTerminalObservation(docs.docs[0].id)).state,'closed');assert.equal(reads,2);
});

test('terminal recovery detects a job marker added during the Account read',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get();
 const billing=new AccountBillingClient(undefined,{request:async()=>{await ref(c,'billingIntentJobMarkers',p.witness.intentId).create({jobId:randomUUID()});return {data:{reservationId:p.reservationId,seconds:2,state:'sealed'}};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const result=await ai.recoverTerminalObservation(docs.docs[0].id);assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,true);
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('sealConfirmed'),undefined);
});

test('terminal recovery reads an actual AccountStore emulator seal without another Account write',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get(),accountRoot=c.root.collection('syntheticAccount').doc('ledger'),account=new AccountStore(c.db,accountRoot);
 await account.bootstrap(c.uid);await account.sealVideoReservation(p.identityKey,p.reservationId,2);
 const tombstones=accountRoot.collection('videoReservationTombstones'),before=await tombstones.get();assert.equal(before.size,1);let reads=0;
 const billing=new AccountBillingClient(undefined,{request:async request=>{assert.ok(new URL(request.url).pathname.endsWith('/resolution'));reads++;return {data:await account.videoReservationResolution(request.data.identityKey,p.reservationId,request.data.seconds)};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 assert.equal((await ai.recoverTerminalObservation(docs.docs[0].id)).state,'closed');assert.equal(reads,1);
 const after=await tombstones.get();assert.equal(after.size,1);assert.equal(after.docs[0].updateTime.toMillis(),before.docs[0].updateTime.toMillis());
});

test('terminal recovery retries the read after a local Firestore failure without claiming an ACK',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get(),terminal=docs.docs[0].ref;let reads=0;
 const billing=new AccountBillingClient(undefined,{request:async()=>{reads++;return {data:{reservationId:p.reservationId,seconds:2,state:'sealed'}};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),original=c.backend.recordConfirmedIntentObservation.bind(c.backend);
 c.backend.recordConfirmedIntentObservation=async()=>{throw Error('synthetic Firestore outage');};
 try{await assert.rejects(ai.recoverTerminalObservation(terminal.id),/synthetic Firestore outage/);}finally{c.backend.recordConfirmedIntentObservation=original;}
 assert.equal((await terminal.get()).exists,true);assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('state'),'release_pending');
 assert.equal((await ai.recoverTerminalObservation(terminal.id)).state,'closed');assert.equal(reads,2);
});

test('terminal recovery re-reads an already committed close after its response is lost',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get(),terminal=docs.docs[0].ref;let reads=0;
 const billing=new AccountBillingClient(undefined,{request:async()=>{reads++;return {data:{reservationId:p.reservationId,seconds:2,state:'sealed'}};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),original=c.backend.recordConfirmedIntentObservation.bind(c.backend);
 c.backend.recordConfirmedIntentObservation=async(...args)=>{assert.equal((await original(...args)).state,'closed');throw Error('synthetic lost local ACK');};
 try{await assert.rejects(ai.recoverTerminalObservation(terminal.id),/synthetic lost local ACK/);}finally{c.backend.recordConfirmedIntentObservation=original;}
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('state'),'closed');
 assert.equal((await ai.recoverTerminalObservation(terminal.id)).state,'already_closed');assert.equal(reads,2);
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
});

test('terminal recovery with the witness already absent reports unverified without inventing an incident',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),docs=await c.root.collection('billingIntentTerminalWitnesses').get(),terminal=docs.docs[0].ref;let reads=0;
 await terminal.delete();const billing=new AccountBillingClient(undefined,{request:async()=>{reads++;throw Error('must not be called');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 assert.deepEqual(await ai.recoverTerminalObservation(terminal.id),{state:'unverified'});assert.equal(reads,0);
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('state'),'release_pending');
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
});

test('a locally committed release with a lost response is recognized as the same close on the retry: already_closed, no block',async()=>{
 const c=await fixture(),p=await preparedIntent(c),original=c.backend.finishExternalBillingRelease.bind(c.backend);let releases=0;
 c.backend.finishExternalBillingRelease=async(...args)=>{assert.equal(await original(...args),true);throw Error('synthetic lost local response');};
 const billing=new AccountBillingClient(undefined,{request:async request=>{const path=new URL(request.url).pathname;if(path.endsWith('/status'))return {data:{state:'reserved',reservationId:p.reservationId,seconds:2}};
  if(path.endsWith('/release')){releases++;return {data:{state:'released',reservationId:p.reservationId,seconds:2}};}throw Error('unexpected operation');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 try{const result=await ai.drainExternalBilling();
  // LV-019.B E-3 (design v2 3.2): the identical direct close the retry re-reads is accepted as already_closed; the drain counts it recovered, not failed.
  assert.equal(result.intentsRecovered,1);assert.equal(result.intentsFailed,0);assert.equal(releases,1);
  assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('state'),'closed');
  assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0,'no incident for the exact close');
  assert.notEqual((await ref(c,'billingGuards',c.account).get()).get('blocked'),true,'the owner is not blocked');
 }finally{c.backend.finishExternalBillingRelease=original;}
});

test('a locally committed seal with a lost response is recognized as the same close on the retry: already_closed, no block',async()=>{
 const c=await fixture(),p=await preparedIntent(c,'seal'),original=c.backend.finishExternalBillingSeal.bind(c.backend);let seals=0;
 c.backend.finishExternalBillingSeal=async(...args)=>{assert.equal(await original(...args),true);throw Error('synthetic lost local response');};
 const billing=new AccountBillingClient(undefined,{request:async request=>{const path=new URL(request.url).pathname;
  if(path.endsWith('/status'))throw Object.assign(Error('synthetic missing'),{response:{status:404}});
  if(path.endsWith('/seal')){seals++;return {data:{state:'sealed',reservationId:p.reservationId,seconds:2,created:true}};}throw Error('unexpected operation');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 try{const result=await ai.drainExternalBilling();
  assert.equal(result.intentsRecovered,1);assert.equal(result.intentsFailed,0);assert.equal(seals,1);
  const closed=await ref(c,'billingIntents',p.witness.intentId).get();assert.equal(closed.get('state'),'closed');assert.equal(closed.get('sealConfirmed'),true);
  assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0,'no incident for the exact close');
  assert.notEqual((await ref(c,'billingGuards',c.account).get()).get('blocked'),true,'the owner is not blocked');
 }finally{c.backend.finishExternalBillingSeal=original;}
});

test('a confirmed release whose local tuple changed is recorded and blocks only the proven owner',async()=>{
 const c=await fixture(),p=await preparedIntent(c),intent=ref(c,'billingIntents',p.witness.intentId);let releases=0;
 const billing=new AccountBillingClient(undefined,{request:async request=>{const path=new URL(request.url).pathname;if(path.endsWith('/status'))return {data:{state:'reserved',reservationId:p.reservationId,seconds:2}};
  if(path.endsWith('/release')){releases++;assert.equal((await c.root.collection('billingIntentTerminalWitnesses').get()).size,1);await intent.update({seconds:3});return {data:{state:'released',reservationId:p.reservationId,seconds:2}};}throw Error('unexpected operation');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const result=await ai.drainExternalBilling();assert.equal(result.intentsFailed,1);assert.equal(releases,1);
 const incidents=await c.root.collection('billingIntentObservationIncidents').get();assert.equal(incidents.size,1);assert.equal(incidents.docs[0].get('source'),'release_ack');assert.equal(incidents.docs[0].get('seconds'),2);assert.equal(incidents.docs[0].get('observedState'),'released');
 assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);assert.equal((await intent.get()).get('seconds'),3);
 const replay=await c.backend.recordConfirmedIntentObservation(p.witness,{action:'release',source:'release_ack',reservationId:p.reservationId,seconds:2,state:'released'},incidents.docs[0].get('directObservationSnapshot'));
 assert.equal(replay.state,'needs_review');assert.equal(replay.incidentId,incidents.docs[0].id);assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,1);assert.equal((await c.root.collection('billingHoldOutbox').get()).size,1);
});

test('a released status observed during enqueue survives a changed intent without inventing a release POST',async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=reservationFor(c.account,identityKey,c.input,'translation:en',1,requestKey),key=sha(JSON.stringify([c.account,requestKey]));let releases=0;
 const billing=new AccountBillingClient(undefined,{request:async request=>{const path=new URL(request.url).pathname;
  if(path.endsWith('/reservations'))throw Object.assign(Error('synthetic conflict'),{response:{status:409}});
  if(path.endsWith('/status')){assert.equal((await ref(c,'billingIntentWitnesses',key).get()).exists,true);await ref(c,'billingIntents',key).update({seconds:3});return {data:{state:'released',reservationId,seconds:2}};}
  if(path.endsWith('/release')){releases++;throw Error('must not release');}throw Error('unexpected operation');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 await assert.rejects(ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid),error=>error.code==='conflict');assert.equal(releases,0);
 const incidents=await c.root.collection('billingIntentObservationIncidents').get();assert.equal(incidents.size,1);assert.equal(incidents.docs[0].get('source'),'status');assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
});

test('a confirmed seal with an unverifiable owner creates a global incident without blocking another account',async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);let sealCalls=0;
 const billing=new AccountBillingClient(undefined,{request:async request=>{const path=new URL(request.url).pathname;
  if(path.endsWith('/status'))throw Object.assign(Error('synthetic missing'),{response:{status:404}});
  if(path.endsWith('/seal')){sealCalls++;assert.equal((await c.root.collection('billingIntentTerminalWitnesses').get()).size,1);await ref(c,'identities',identityKey).update({accountId:c.foreign});return {data:{state:'sealed',reservationId,seconds:2,created:true}};}throw Error('unexpected operation');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const result=await ai.drainExternalBilling();assert.equal(result.intentsFailed,1);assert.equal(sealCalls,1);
 const incidents=await c.root.collection('billingIntentObservationIncidents').get();assert.equal(incidents.size,1);assert.equal(incidents.docs[0].get('attribution'),'unverified');assert.equal(incidents.docs[0].get('observedState'),'sealed');
 assert.equal((await ref(c,'billingGuards',c.account).get()).exists,false);assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);
});

test('a confirmed seal with a missing intent preserves the observation and blocks the verified owner',async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2},key=sha(JSON.stringify([c.account,requestKey]));
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);
 const billing=new AccountBillingClient(undefined,{request:async request=>{const path=new URL(request.url).pathname;
  if(path.endsWith('/status'))throw Object.assign(Error('synthetic missing'),{response:{status:404}});
  if(path.endsWith('/seal')){await ref(c,'billingIntents',key).delete();return {data:{state:'sealed',reservationId,seconds:2,created:true}};}throw Error('unexpected operation');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 assert.equal((await ai.drainExternalBilling()).intentsFailed,1);const incidents=await c.root.collection('billingIntentObservationIncidents').get();assert.equal(incidents.size,1);
 assert.equal(incidents.docs[0].get('attribution'),'verified');assert.equal(incidents.docs[0].get('observedState'),'sealed');assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);assert.equal((await ref(c,'billingIntents',key).get()).exists,false);
});

test('a missing terminal witness cannot turn a confirmed response into an ordinary close',async()=>{
 const c=await fixture(),p=await preparedIntent(c),snapshot=await directSnapshot(c,p,'release'),terminal=await c.root.collection('billingIntentTerminalWitnesses').get();assert.equal(terminal.size,1);await terminal.docs[0].ref.delete();
 const observation={action:'release',source:'release_ack',reservationId:p.reservationId,seconds:2,state:'released'};
 assert.equal(await c.backend.finishExternalBillingRelease(c.account,p.requestKey,p.billing,observation,p.witness,'release_ack',snapshot),false);
 const recorded=await c.backend.recordConfirmedIntentObservation(p.witness,observation,snapshot);assert.equal(recorded.state,'needs_review');assert.equal(recorded.ownerBlocked,true);
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('state'),'needs_review');
});

test('a historic job marker prevents closing even if the job and request are missing',async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);const witness=await c.backend.externalIntentWitness(c.account,requestKey,data),snapshot=await c.backend.captureDirectObservation(witness,requestKey,'status');assert.ok(snapshot);
 const jobId=await c.backend.reserve(c.account,c.input,requestKey,2,'translation:en',1,AI_CATALOG_VERSION,data,undefined,c.uid),marker=ref(c,'billingIntentJobMarkers',witness.intentId);
 assert.equal((await marker.get()).get('jobId'),jobId);await ref(c,'requests',witness.intentId).delete();await ref(c,'jobs',jobId).delete();
 await ref(c,'billingIntents',witness.intentId).update({state:'release_pending',jobId:FieldValue.delete()});
 const observed={action:'release',source:'status',reservationId,seconds:2,state:'released'};
 assert.equal(await c.backend.finishExternalBillingRelease(c.account,requestKey,data,observed,witness,'status',snapshot),false);
 const result=await c.backend.recordConfirmedIntentObservation(witness,observed,snapshot);assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,true);
 assert.equal((await marker.get()).exists,true);assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
});

test('an invalid observation and a legacy intent without its original witness do not create receipts',async()=>{
 const c=await fixture(),p=await preparedIntent(c),bad={action:'release',source:'release_ack',reservationId:p.reservationId,seconds:3,state:'released'};
 await assert.rejects(c.backend.recordConfirmedIntentObservation(p.witness,bad),error=>error.code==='invalid');assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
 for(const invalid of [{...bad,seconds:2,state:'reserved'},{...bad,seconds:2,state:'sealed'},{...bad,seconds:2,source:'seal_ack'},{...bad,seconds:2,action:'seal',state:'released'}]){
  await assert.rejects(c.ai.confirmedIntentObservation(p.witness,p.requestKey,invalid),error=>error.code==='invalid');
 }
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('state'),'release_pending');assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
 await ref(c,'billingIntentWitnesses',p.witness.intentId).delete();let calls=0;
 const billing=new AccountBillingClient(undefined,{request:async()=>{calls++;throw Error('must not contact Account');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 assert.equal((await ai.drainExternalBilling()).intentsFailed,1);assert.equal(calls,0);assert.equal((await ref(c,'billingIntentWitnesses',p.witness.intentId).get()).exists,false);
 assert.equal((await ref(c,'billingIntents',p.witness.intentId).get()).get('releaseConfirmed'),undefined);
});

test('an outage after a remote ACK leaves the prior witness for recovery by status',async()=>{
 const c=await fixture(),p=await preparedIntent(c),originalFinish=c.backend.finishExternalBillingRelease.bind(c.backend),originalRecord=c.backend.recordConfirmedIntentObservation.bind(c.backend);let state='reserved',calls=0;
 const billing=new AccountBillingClient(undefined,{request:async request=>{const path=new URL(request.url).pathname;if(path.endsWith('/status'))return {data:{state,reservationId:p.reservationId,seconds:2}};
  if(path.endsWith('/release')){calls++;state='released';return {data:{state,reservationId:p.reservationId,seconds:2}};}throw Error('unexpected operation');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 c.backend.finishExternalBillingRelease=async()=>{throw Error('synthetic Firestore outage');};c.backend.recordConfirmedIntentObservation=async()=>{throw Error('synthetic Firestore outage');};
 try{assert.equal((await ai.drainExternalBilling()).intentsFailed,1);const intent=ref(c,'billingIntents',p.witness.intentId);assert.equal((await intent.get()).get('state'),'release_pending');
  assert.equal((await ref(c,'billingIntentWitnesses',p.witness.intentId).get()).exists,true);assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
  c.backend.finishExternalBillingRelease=originalFinish;c.backend.recordConfirmedIntentObservation=originalRecord;await intent.update({nextAttemptAt:0});
  assert.equal((await ai.drainExternalBilling()).intentsFailed,0);const closed=await intent.get();assert.equal(closed.get('state'),'closed');assert.equal(closed.get('releaseObservationSource'),'status');assert.equal(calls,1);
 }finally{c.backend.finishExternalBillingRelease=originalFinish;c.backend.recordConfirmedIntentObservation=originalRecord;}
});

test('a mismatched external reservation is retained for review and blocks a second request',async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);let settlements=0;
 const billing=new AccountBillingClient(undefined,{request:async request=>{const path=new URL(request.url).pathname;if(!path.endsWith('/status'))settlements++;return {data:{state:'reserved',reservationId:path.split('/').at(-2),seconds:3}};}});
 const ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);assert.equal((await ai.drainExternalBilling()).intentsFailed,1);
 const docs=await c.root.collection('billingIntents').get();assert.equal(docs.docs[0].get('state'),'needs_review');assert.equal(docs.docs[0].get('reviewReason'),'seconds_mismatch');assert.equal(settlements,0);
 await assert.rejects(c.backend.beginExternalBillingIntent(c.account,c.input,randomUUID(),'translation:en',1,{...data,reservationId:randomUUID()}),error=>error.code==='conflict');
});

for(const unexpectedState of ['captured','released'])test('an unexpected '+unexpectedState+' reservation with a queued job blocks new account intents',async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=reservationFor(c.account,identityKey,c.input,'translation:en',1,requestKey),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 const billing=new AccountBillingClient(undefined,{request:async request=>({data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}})}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const id=await ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);assert.equal((await c.backend.job(c.account,id)).state,'queued');
 const result=await c.backend.recordExternalBillingReview(c.account,requestKey,data,{reservationId,state:unexpectedState,seconds:2});
 assert.equal(result.state,'needs_review');
 await assert.rejects(c.backend.beginExternalBillingIntent(c.account,c.input,randomUUID(),'translation:en',1,{...data,reservationId:randomUUID()}),error=>error.code==='conflict');
});

test('an orphaned billing outbox never captures or releases an account reservation',async()=>{
 const c=await fixture(),jobId=randomUUID(),reservationId=randomUUID(),identityKey=accountIdentityKey(c.uid);let calls=0;
 await ref(c,'billingOutbox',jobId).create({jobId,accountId:c.account,provider:'account_seconds',identityKey,reservationId,seconds:2,action:'capture',state:'pending',attempts:0,nextAttemptAt:0});
 const billing=new AccountBillingClient(undefined,{request:async request=>{calls++;const path=new URL(request.url).pathname;return {data:{state:'captured',reservationId:path.split('/').at(-2),seconds:2}};}});
 const ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);await ai.drainExternalBilling();
 assert.equal(calls,0,'an orphaned outbox must never call the account billing service');
 assert.equal((await ref(c,'billingOutbox',jobId).get()).get('state'),'needs_review');assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,1);
 assert.equal((await ref(c,'billingGuards',c.account).get()).exists,false,'an unverified owner must not be blocked from an orphan row');
});

test('a conflicting terminal outbox raises an account review barrier before any account movement',async()=>{
 const c=await fixture(),calls=[],billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const id=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await c.backend.cancel(c.account,id);
 await ref(c,'billingOutbox',id).update({action:'capture'});const result=await ai.drainExternalBilling();
 assert.equal(result.failed,1);assert.equal(calls.filter(path=>path.endsWith('/capture')).length,0);
 assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
 assert.equal((await ref(c,'billingOutbox',id).get()).get('state'),'needs_review');
});

test('a corrupted outbox cannot block a different account named in its payload',async()=>{
 const c=await fixture(),calls=[],billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const id=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await c.backend.cancel(c.account,id);
 await ref(c,'billingOutbox',id).update({accountId:c.foreign});assert.equal((await ai.drainExternalBilling()).failed,1);
 assert.equal(calls.filter(path=>path.endsWith('/release')||path.endsWith('/capture')).length,0);
 assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
});

test('video without any audio track is rejected before reservation while narration from reviewed text remains quotable',async()=>{
 const c=await fixture(),balance=await c.backend.readBalance(c.account),movements=(await c.root.collection('movements').get()).size;
 await ref(c,'inputs',c.input).update({'metadata.audioTracks':0});
 await assert.rejects(enqueue(c,'no-audio-no-reserve'),error=>error.code==='invalid');
 assert.equal((await c.ai.quote(c.account,c.input,'narration:en:female',1)).operation,'narration:en:female');
 assert.deepEqual(await c.backend.readBalance(c.account),balance);assert.equal((await c.root.collection('movements').get()).size,movements);
 for(const name of ['jobs','outbox','artifacts','providerCalls'])assert.equal((await c.root.collection(name).get()).size,0);
});
// Publisher/recovery fixtures simulate nonzero inspection; decoder and local-check fences have separate real negatives.
async function claimAfterNonzeroInspection(c,id,account=c.account){const a=await c.backend.claim(account,id);assert.ok(a);const job=await c.backend.job(account,id);if(job.invocationPhase==='local_check')assert.equal(await c.backend.resumeTextAfterLocalCheck(account,id,a.attemptId,job.inputStorage,'nonzero'),true);return a;}
async function start(c,id){const a=await claimAfterNonzeroInspection(c,id);assert.equal(await c.backend.beginInvocation(c.account,id,a.attemptId),true);return a;}
async function publish(c,id){const attempt=await start(c,id);await received(c,id,attempt.attemptId);const entries=await c.ai.uploadResults(c.account,id,attempt.attemptId,outputs());assert.equal(await c.backend.finish(c.account,id,attempt.attemptId,true),true);return {attempt,entries};}
test('a successful job with mismatched outbox seconds is quarantined before capture',async()=>{
 const c=await fixture(),calls=[],billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const id=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await publish(c,id);
 await ref(c,'billingOutbox',id).update({seconds:3});assert.equal((await ai.drainExternalBilling()).failed,1);
 assert.equal(calls.filter(path=>path.endsWith('/capture')).length,0);assert.equal((await ref(c,'billingOutbox',id).get()).get('state'),'needs_review');
 assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
});
test('a stale second drainer does not report a settled outbox as a failure',{timeout:15000},async()=>{
 const c=await fixture(),calls=[],billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);return {data:{state:path.endsWith('/capture')?'captured':'reserved',reservationId:request.data.reservationId??path.split('/').at(-2),seconds:2}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const id=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await publish(c,id);
 const original=c.backend.pendingExternalBilling.bind(c.backend);let first=true,entered,release;const selected=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 c.backend.pendingExternalBilling=async(...args)=>{const rows=await original(...args);if(first){first=false;entered();await resume;}return rows;};
 const stale=ai.drainExternalBilling();
 try{await selected;assert.equal((await ai.drainExternalBilling()).settled,1);release();const result=await stale;assert.equal(result.failed,0);assert.equal(calls.filter(path=>path.endsWith('/capture')).length,1);}
 finally{release();await stale.catch(()=>undefined);c.backend.pendingExternalBilling=original;}
});
test('a settlement acknowledgement cannot mark a changed outbox as settled',async()=>{
 const c=await fixture();let id;
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith('/capture')){await ref(c,'billingOutbox',id).update({action:'release'});return {data:{state:'captured',reservationId:path.split('/').at(-2),seconds:2}};}
  return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 id=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await publish(c,id);
 const result=await ai.drainExternalBilling();assert.equal(result.settled,0);assert.equal(result.failed,1);
 assert.equal((await ref(c,'billingOutbox',id).get()).get('state'),'needs_review');assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
});
for(const action of ['capture','release'])test('a coherent '+action+' observation for an existing terminal job does not block the account',async()=>{
 const c=await fixture(),requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=reservationFor(c.account,identityKey,c.input,'translation:en',1,requestKey),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 const billing=new AccountBillingClient(undefined,{request:async request=>({data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}})}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const id=await ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);
 if(action==='capture')await publish(c,id);else await c.backend.cancel(c.account,id);
 const result=await c.backend.recordExternalBillingReview(c.account,requestKey,data,{reservationId,state:action==='capture'?'captured':'released',seconds:2});
 assert.deepEqual(result,{state:'job_created',jobId:id});assert.equal((await ref(c,'billingGuards',c.account).get()).exists,false);
});
test('a coherent successful external billing outbox captures once and unlocks results',async()=>{
 const c=await fixture(),calls=[],billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);
  return {data:{state:path.endsWith('/capture')?'captured':'reserved',reservationId:request.data.reservationId??path.split('/').at(-2),seconds:2}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const id=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await publish(c,id);
 assert.equal((await ai.status(c.account,id,c.uid)).billingState,'pending');assert.deepEqual((await ai.status(c.account,id,c.uid)).results,[]);
 assert.equal((await ai.drainExternalBilling()).settled,1);const completed=await ai.status(c.account,id,c.uid);
 assert.equal(completed.billingState,'settled');assert.equal(completed.results.length,5);assert.equal(calls.filter(path=>path.endsWith('/capture')).length,1);
});

test('account admission precedes provider and binds a single successful capture to its job and attempt',async()=>{
 const c=await fixture(),accountRoot=c.root.collection('account_service_fixture').doc('root'),store=new AccountStore(c.db,accountRoot),boot=await store.bootstrap(c.uid),identityKey=AccountStore.identityKey(c.uid),events=[];
 await accountRoot.collection('accounts').doc(boot.account.id).update({credited:20,available:20});
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname,parts=path.split('/'),reservationId=parts.at(-2),body=request.data;
  if(path.endsWith('/reservations')){events.push('reserve');return {data:{...await store.reserveVideo(body.identityKey,body.reservationId,body.seconds),reservationId:body.reservationId}};}
  if(path.endsWith('/admit')){events.push('admit');return {data:await store.admitVideoCall(body.identityKey,reservationId,body.seconds,body.jobId,body.attemptId,body.callKey,body.model,body.requestSha256)};}
  if(path.endsWith('/capture')){events.push('capture');return {data:{...await store.settleVideo(body.identityKey,reservationId,'capture',body.seconds,{jobId:body.jobId,attemptId:body.attemptId}),reservationId}};}
  throw Error('unexpected synthetic account path '+path);
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const jobId=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid),attempt=await start(c,jobId),original=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{
  if(String(input).startsWith('https://generativelanguage.googleapis.com/')){events.push('provider');return new Response(JSON.stringify({responseId:'synthetic',usageMetadata:{totalTokenCount:1}}),{status:200,headers:{'Content-Type':'application/json'}});}
  return original(input,init);
 };
 try{
  await ai.invoke(c.account,jobId,attempt.attemptId,'fixture-key')('text-window:0000','gemini-3.8-flash',{contents:[]},new AbortController().signal);
  assert.deepEqual(events,['reserve','admit','provider']);
  await ai.uploadResults(c.account,jobId,attempt.attemptId,outputs());assert.equal(await c.backend.finish(c.account,jobId,attempt.attemptId,true),true);
  const outbox=await ref(c,'billingOutbox',jobId).get();assert.equal(outbox.get('attemptId'),attempt.attemptId);assert.equal((await ai.status(c.account,jobId,c.uid)).billingState,'pending');
  const first=await ai.drainExternalBilling(),second=await ai.drainExternalBilling();assert.equal(first.settled,1);assert.equal(second.settled,0);assert.deepEqual(events,['reserve','admit','provider','capture']);
  assert.deepEqual(await store.videoBalance(identityKey),{unit:'video_seconds',credited:20,available:18,reserved:0,consumed:2,active:0});
  assert.equal((await store.ledger(c.uid)).items.filter(x=>x.kind==='video_capture').length,1);assert.equal((await ai.status(c.account,jobId,c.uid)).results.length,5);
 }finally{globalThis.fetch=original;}
});

for(const mode of ['receipt_only','ack_lost'])test('provider is never called when account admission is '+mode,async()=>{
 const c=await fixture(),calls=[],billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);
  if(path.endsWith('/reservations'))return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};
  if(path.endsWith('/admit')){if(mode==='ack_lost')throw Error('synthetic lost admission ACK');return {data:{reservationId:path.split('/').at(-2),seconds:2,jobId:request.data.jobId,attemptId:request.data.attemptId,callKey:request.data.callKey,model:request.data.model,requestSha256:request.data.requestSha256,created:false,receiptOnly:true}};}
  throw Error('unexpected synthetic path');
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const jobId=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid),attempt=await start(c,jobId),original=globalThis.fetch;let providerCalls=0;
 globalThis.fetch=async(input,init)=>{if(String(input).startsWith('https://generativelanguage.googleapis.com/')){providerCalls++;throw Error('provider must not run');}return original(input,init);};
 try{
  const invoke=()=>ai.invoke(c.account,jobId,attempt.attemptId,'fixture-key')('text-window:0000','gemini-3.8-flash',{contents:[]},new AbortController().signal);
  await assert.rejects(invoke());await assert.rejects(invoke(),error=>error.code==='unknown');
  assert.equal(providerCalls,0);assert.equal(calls.filter(path=>path.endsWith('/admit')).length,1);
  assert.equal((await ref(c,'providerCalls',jobId+'-text-window-0000').get()).get('state'),'intent');
 }finally{globalThis.fetch=original;}
});

for(const mode of ['held','open'])test('a '+mode+' account separately admits each provider window',async()=>{
 const c=await fixture(),accountRoot=c.root.collection('account_service_fixture').doc('root'),store=new AccountStore(c.db,accountRoot),boot=await store.bootstrap(c.uid),identityKey=AccountStore.identityKey(c.uid),events=[];
 await accountRoot.collection('accounts').doc(boot.account.id).update({credited:100,available:100});await ref(c,'inputs',c.input).update({'metadata.duration':31});
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname,reservationId=path.split('/').at(-2),body=request.data;
  if(path.endsWith('/reservations'))return {data:{...await store.reserveVideo(body.identityKey,body.reservationId,body.seconds),reservationId:body.reservationId}};
  if(path.endsWith('/admit')){events.push('admit');const method=store.admitVideoCall??store.admitVideoProvider;return {data:await method.call(store,body.identityKey,reservationId,body.seconds,body.jobId,body.attemptId,body.callKey,body.model,body.requestSha256)};}
  throw Error('unexpected synthetic account path');
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const jobId=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid),attempt=await start(c,jobId),original=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{if(String(input).startsWith('https://generativelanguage.googleapis.com/')){events.push('provider');return new Response(JSON.stringify({responseId:'synthetic'}),{status:200,headers:{'Content-Type':'application/json'}});}return original(input,init);};
 try{
  const invoke=ai.invoke(c.account,jobId,attempt.attemptId,'fixture-key'),signal=new AbortController().signal;
  await invoke('text-window:0000','gemini-3.8-flash',{contents:['first']},signal);
  if(mode==='held')await store.blockVideoBilling(identityKey,randomUUID());
  const next=invoke('text-window:0001','gemini-3.8-flash',{contents:['second']},signal);
  if(mode==='held')await assert.rejects(next);else await next;
  assert.equal(events.filter(x=>x==='admit').length,2,'each window must ask Account for a new admission');
  assert.equal(events.filter(x=>x==='provider').length,mode==='held'?1:2,'a held account must not authorize the next window');
 }finally{globalThis.fetch=original;}
});

test('a changed capture attempt is quarantined and never sent to Account',async()=>{
 const c=await fixture(),calls=[],billing=new AccountBillingClient(undefined,{request:async request=>{const path=new URL(request.url).pathname;calls.push(path);return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const jobId=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await publish(c,jobId);await ref(c,'billingOutbox',jobId).update({attemptId:randomUUID()});
 const outcome=await ai.drainExternalBilling();assert.equal(outcome.failed,1);assert.equal(calls.filter(path=>path.endsWith('/capture')).length,0);
 assert.equal((await ref(c,'billingOutbox',jobId).get()).get('state'),'needs_review');assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
});

test('a settled capture cannot unlock downloads if a correlated billing or terminal field changes',async()=>{
 const c=await fixture(),billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;return {data:{state:path.endsWith('/capture')?'captured':'reserved',reservationId:request.data.reservationId??path.split('/').at(-2),seconds:2}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const jobId=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await publish(c,jobId);assert.equal((await ai.drainExternalBilling()).settled,1);
 assert.equal((await ai.status(c.account,jobId,c.uid)).results.length,5);
 const terminal=ref(c,'movements','terminal:'+jobId),outbox=ref(c,'billingOutbox',jobId);
 for(const [doc,field,altered] of [[terminal,'accountId',c.foreign],[terminal,'reference',randomUUID()],[terminal,'credits',3],[terminal,'kind','external_release'],[outbox,'identityKey',accountIdentityKey(c.foreignUid)],[outbox,'reservationId',randomUUID()],[outbox,'provider','other'],[outbox,'seconds',3]]){
  const previous=(await doc.get()).get(field);await doc.update({[field]:altered});
  const status=await ai.status(c.account,jobId,c.uid);assert.equal(status.billingState,doc===outbox?'review':'pending',field);assert.deepEqual(status.results,[],field);
  await assert.rejects(ai.download(c.account,jobId,'translation-en.txt',c.uid),error=>error.code==='not_found');await doc.update({[field]:previous});
 }
 assert.equal((await ai.status(c.account,jobId,c.uid)).results.length,5);
});

test('a captured observation cannot conceal an outbox with a different provider attempt',async()=>{
 const c=await fixture(),billing=new AccountBillingClient(undefined,{request:async request=>({data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}})}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),requestKey=randomUUID();
 const jobId=await ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);await publish(c,jobId);const job=await c.backend.job(c.account,jobId);
 await ref(c,'billingOutbox',jobId).update({attemptId:randomUUID()});
 const outcome=await c.backend.recordExternalBillingReview(c.account,requestKey,job.externalBilling,{reservationId:job.externalBilling.reservationId,state:'captured',seconds:job.externalBilling.seconds});
 assert.deepEqual(outcome,{state:'needs_review',reason:'outbox_mismatch'});assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
});

test('a durable incident propagates the account hold and recovers a lost acknowledgement',async()=>{
 const c=await fixture(),accountRoot=c.root.collection('account_service_fixture').doc('root'),store=new AccountStore(c.db,accountRoot),boot=await store.bootstrap(c.uid),identityKey=AccountStore.identityKey(c.uid),requestKey=randomUUID(),reservationId=randomUUID();
 await accountRoot.collection('accounts').doc(boot.account.id).update({credited:20,available:20});
 const data={provider:'account_seconds',identityKey,reservationId,seconds:2};await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);
 await c.backend.recordExternalBillingReview(c.account,requestKey,data,{reservationId,state:'captured',seconds:2});
 let lost=true,calls=0;const billing=new AccountBillingClient(undefined,{request:async request=>{
  assert.ok(new URL(request.url).pathname.endsWith('/billing-holds'));calls++;const result=await store.blockVideoBilling(request.data.identityKey,request.data.incidentId);
  if(lost){lost=false;throw Error('synthetic committed hold with lost ACK');}return {data:result};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const first=await ai.drainExternalHolds();assert.deepEqual(first,{applied:0,failed:1,review:0});
 const rows=await c.root.collection('billingHoldOutbox').get();assert.equal(rows.size,1);assert.equal(rows.docs[0].get('state'),'pending');
 assert.deepEqual(await store.videoBillingHold(identityKey,rows.docs[0].id),{blocked:true,recorded:true});
 await assert.rejects(store.reserveVideo(identityKey,randomUUID(),1),error=>error.code==='conflict');
 await rows.docs[0].ref.update({nextAttemptAt:0});assert.deepEqual(await ai.drainExternalHolds(),{applied:1,failed:0,review:0});
 assert.equal((await rows.docs[0].ref.get()).get('state'),'applied');assert.equal(calls,2);assert.equal((await accountRoot.collection('videoBillingIncidents').get()).size,1);
 assert.deepEqual(await store.videoBalance(identityKey),{unit:'video_seconds',credited:20,available:20,reserved:0,consumed:0,active:0});
});

test('a hold event with an unverified owner is quarantined without contacting Account',async()=>{
 const c=await fixture(),identityKey=accountIdentityKey(c.uid),requestKey=randomUUID(),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);await c.backend.recordExternalBillingReview(c.account,requestKey,data,{reservationId,state:'captured',seconds:2});
 const rows=await c.root.collection('billingHoldOutbox').get();await rows.docs[0].ref.update({identityKey:accountIdentityKey(c.foreignUid)});let calls=0;
 const billing=new AccountBillingClient(undefined,{request:async()=>{calls++;throw Error('must not contact account');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 assert.deepEqual(await ai.drainExternalHolds(),{applied:0,failed:0,review:1});assert.equal(calls,0);assert.equal((await rows.docs[0].ref.get()).get('state'),'needs_review');
 assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);
});

test('a confirmed Account hold with a changed local event leaves a durable acknowledgement incident',async()=>{
 const c=await fixture(),accountRoot=c.root.collection('account_service_fixture').doc('root'),store=new AccountStore(c.db,accountRoot),boot=await store.bootstrap(c.uid),identityKey=AccountStore.identityKey(c.uid),requestKey=randomUUID(),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await accountRoot.collection('accounts').doc(boot.account.id).update({credited:20,available:20});await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);await c.backend.recordExternalBillingReview(c.account,requestKey,data,{reservationId,state:'captured',seconds:2});
 const rows=await c.root.collection('billingHoldOutbox').get(),billing=new AccountBillingClient(undefined,{request:async request=>{const result=await store.blockVideoBilling(request.data.identityKey,request.data.incidentId);await rows.docs[0].ref.update({identityKey:accountIdentityKey(c.foreignUid)});return {data:result};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 assert.deepEqual(await ai.drainExternalHolds(),{applied:0,failed:1,review:0});assert.equal((await c.root.collection('billingHoldAckIncidents').get()).size,1);
 assert.deepEqual(await store.videoBillingHold(identityKey,rows.docs[0].id),{blocked:true,recorded:true});
});

for(const mode of ['sealed','ack_lost','reserve_won'])test('a missing reservation is reconciled through Account seal: '+mode,async()=>{
 const c=await fixture(),accountRoot=c.root.collection('account_service_fixture').doc('root'),store=new AccountStore(c.db,accountRoot),boot=await store.bootstrap(c.uid),identityKey=AccountStore.identityKey(c.uid),requestKey=randomUUID(),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await accountRoot.collection('accounts').doc(boot.account.id).update({credited:20,available:20});await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);
 let lose=mode==='ack_lost',race=mode==='reserve_won',sealCalls=0;
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith('/status')){try{return {data:await store.videoReservation(identityKey,reservationId)};}catch(error){if(error.code==='not_found')throw Object.assign(Error('synthetic not found'),{response:{status:404}});throw error;}}
  if(path.endsWith('/seal')){sealCalls++;if(race){race=false;await store.reserveVideo(identityKey,reservationId,2);}const result=await store.sealVideoReservation(identityKey,reservationId,2);if(lose){lose=false;throw Error('synthetic lost seal ACK');}return {data:result};}
  if(path.endsWith('/release'))return {data:{...await store.settleVideo(identityKey,reservationId,'release',2),reservationId}};
  throw Error('unexpected synthetic account operation');
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const first=await ai.drainExternalBilling(),intents=await c.root.collection('billingIntents').get();assert.equal(intents.size,1);
 if(mode==='ack_lost'){
  assert.equal(first.intentsFailed,1);assert.equal(intents.docs[0].get('state'),'release_pending');await intents.docs[0].ref.update({nextAttemptAt:0});
  assert.equal((await ai.drainExternalBilling()).intentsFailed,0);assert.equal(sealCalls,2);
 }
 const intent=await intents.docs[0].ref.get();assert.equal(intent.get('state'),'closed');assert.equal((await c.root.collection('jobs').get()).size,0);
 if(mode==='reserve_won'){assert.equal(intent.get('releaseConfirmed'),true);assert.equal((await store.videoReservation(identityKey,reservationId)).state,'released');}
 else{assert.equal(intent.get('sealConfirmed'),true);await assert.rejects(store.reserveVideo(identityKey,reservationId,2),error=>error.code==='conflict');}
 assert.deepEqual(await store.videoBalance(identityKey),{unit:'video_seconds',credited:20,available:20,reserved:0,consumed:0,active:0});
});
test('a release settlement never unlocks successful private results that require capture',async()=>{
 const c=await fixture(),billing=new AccountBillingClient(undefined,{request:async request=>({data:{state:'reserved',reservationId:request.data.reservationId,seconds:request.data.seconds}})}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const id=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await publish(c,id);
 await ref(c,'billingOutbox',id).update({state:'settled',action:'release'});
 const blocked=await ai.status(c.account,id,c.uid);assert.equal(blocked.billingState,'pending');assert.deepEqual(blocked.results,[]);
 await assert.rejects(ai.download(c.account,id,'translation-en.txt',c.uid),error=>error.code==='not_found');
 await ref(c,'billingOutbox',id).update({action:'capture'});
 const captured=await ai.status(c.account,id,c.uid);assert.equal(captured.billingState,'settled');assert.equal(captured.results.length,5);
 assert.equal((await ai.download(c.account,id,'translation-en.txt',c.uid)).entry.name,'translation-en.txt');
});
async function server(c){let nudges=0;c.server=createServer(firestoreHttp({backend:c.backend,files:c.files,ai:c.ai,origin:'http://127.0.0.1',identity:{verifyIdToken:async(token,checkRevoked)=>{assert.equal(checkRevoked,true);if(token==='owner')return {uid:c.uid,email_verified:true};if(token==='foreign')return {uid:c.foreignUid,email_verified:true};throw Error('synthetic revoked/invalid token');}},nudgeAi:async()=>{nudges++;await new Promise(()=>{});}}));await new Promise(r=>c.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+c.server.address().port;
 return {nudges:()=>nudges,call:async(path,method='GET',body,token='owner',headers={})=>fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)})};
}

test('unexpected reservation failure logs only bounded type and numeric SDK code while client sees internal',async()=>{
 const c=await fixture(),s=await server(c),sentinel='SYNTHETIC_SECRET_MUST_NEVER_APPEAR',originalReserve=c.backend.reserveSimulatedAiForUid,originalError=console.error,logs=[];let reserveCalls=0;
 c.backend.reserveSimulatedAiForUid=async(accountId,inputId,requestKey,price,operation,revision,uid)=>{reserveCalls++;assert.equal(accountId,c.account);assert.equal(inputId,c.input);assert.equal(requestKey,'sanitized-observability');assert.equal(price,2);assert.equal(operation,'translation:en');assert.equal(revision,1);assert.equal(uid,c.uid);const error=new Error(sentinel);error.code=10;error.stack=sentinel+' STACK';error.authorization=sentinel;throw error;};
 console.error=(...args)=>logs.push(args);
 try{
  const response=await s.call('/api/cloud/ai/jobs','POST',{inputId:c.input,operation:'translation:en',expectedRevision:1,requestKey:'sanitized-observability'});
  assert.equal(reserveCalls,1);assert.equal(response.status,500);assert.deepEqual(await response.json(),{error:'internal'});
  assert.equal((await s.call('/api/cloud/me','GET',undefined,null)).status,401);
  assert.equal((await s.call('/api/cloud/not-found')).status,404);
  assert.equal(logs.length,1);assert.equal(logs[0].length,1);const log=JSON.parse(logs[0][0]);assert.deepEqual({event:log.event,type:log.type,code:log.code},{event:'cloud-http-internal',type:'Error',code:10});assert.match(log.traceId,/^[a-f0-9-]{36}$/);assert.equal(log.status,500);assert.ok(Number.isFinite(log.durationMs)&&log.durationMs>=0);assert.ok(log.stages&&typeof log.stages==='object');assert.ok(log.attempts&&typeof log.attempts==='object');assert.equal(JSON.stringify(logs).includes(sentinel),false);
  assert.equal((await c.root.collection('jobs').get()).size,0);assert.equal((await c.root.collection('providerCalls').get()).size,0);assert.equal((await c.backend.readBalance(c.account)).reserved,0);
 }finally{console.error=originalError;c.backend.reserveSimulatedAiForUid=originalReserve;}
});

test('private AI HTTP keeps simulation flags, quotes and replay stable after edits while old processing routes stay disabled',async()=>{
 const c=await fixture(),s=await server(c),base='/api/cloud/ai/jobs';
 const quote=await s.call('/api/cloud/ai/quote?inputId='+c.input+'&operation=translation:en&revision=1');assert.equal(quote.status,200);assert.deepEqual((await quote.json()).billing,{mode:'simulation',unit:'test-unit'});
 const req={inputId:c.input,operation:'translation:en',expectedRevision:1,requestKey:'http-idempotent'};
 const created=await s.call(base,'POST',req);assert.equal(created.status,202);const id=(await created.json()).id;assert.equal(s.nudges(),0);assert.equal((await ref(c,'outbox',id).get()).get('state'),'pending');
 await c.backend.saveProject(c.account,c.input,1,'A changed project sentence.');const replay=await s.call(base,'POST',req);assert.equal(replay.status,202);assert.equal((await replay.json()).id,id);assert.equal((await c.root.collection('jobs').get()).size,1);assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),AI_TEXT_BUDGET);
 assert.equal(s.nudges(),0);const cancelled=await s.call(base+'/'+id,'DELETE');assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).state,'cancelled');assert.equal(s.nudges(),0);
 assert.equal((await s.call('/api/cloud/jobs','POST',req)).status,503);assert.equal((await s.call(base,'POST',{...req,requestKey:'injected-price',price:0})).status,400);
 await ref(c,'accounts',c.account).update({simulationOnly:false});assert.equal((await s.call(base+'/'+id)).status,503);await ref(c,'accounts',c.account).update({simulationOnly:true});
 for(const token of [undefined,'revoked'])assert.equal((await s.call(base+'/'+id,'GET',undefined,token??'')).status,401);
});

test('cancelled job cannot be dispatch-claimed even when a stale outbox is forced pending',async()=>{
 const c=await fixture(),id=await enqueue(c);await c.backend.cancel(c.account,id);
 const before=await c.backend.readBalance(c.account),movements=(await c.root.collection('movements').get()).size;
 await ref(c,'outbox',id).set({accountId:c.account,state:'pending',nextAttemptAt:0,leaseUntil:null},{merge:true});
 const legacy=(await ref(c,'outbox',id).get()).data();delete legacy.aiProfile;await ref(c,'outbox',id).set(legacy);assert.equal(await c.backend.backfillAiDispatchProfile(id),true);const boxBefore=(await ref(c,'outbox',id).get()).data();assert.ok((await c.backend.pendingDispatches()).includes(id));
 assert.equal(await c.backend.claimDispatch(id),null);
 const boxAfter=(await ref(c,'outbox',id).get()).data();assert.equal(boxAfter.state,boxBefore.state);assert.ok(boxAfter.nextAttemptAt>Date.now());assert.equal(boxAfter.leaseUntil,null);assert.equal((await c.backend.job(c.account,id)).state,'cancelled');
 assert.deepEqual(await c.backend.readBalance(c.account),before);assert.equal((await c.root.collection('movements').get()).size,movements);
 assert.equal((await c.root.collection('providerCalls').get()).size,0);assert.equal((await ref(c,'movements','terminal:'+id).get()).get('kind'),'release');
});

test('real emulator commit publishes immutable output manifest and capture together, with stale revision and private HTTP Range/HEAD',async()=>{
 const c=await fixture(),id=await enqueue(c),{entries}=await publish(c,id);await c.backend.saveProject(c.account,c.input,1,'New reviewed text.');const s=await server(c),path='/api/cloud/ai/jobs/'+id+'/results/translation-en.txt',data=outputs().get('translation-en.txt');
 const status=await s.call('/api/cloud/ai/jobs/'+id);assert.equal(status.status,200);const dto=await status.json();assert.equal(dto.state,'succeeded');assert.equal(dto.stale,true);assert.equal(dto.revision,1);assert.equal(dto.results.length,5);assert.equal(dto.results.some(x=>'key'in x||'generation'in x),false);
 const full=await s.call(path);assert.equal(full.status,200);assert.equal(full.headers.get('cache-control'),'no-store');assert.equal(full.headers.get('x-content-type-options'),'nosniff');assert.equal(full.headers.get('x-vistavo-revision'),'1');assert.deepEqual(Buffer.from(await full.arrayBuffer()),data);
 const range=await s.call(path,'GET',undefined,'owner',{Range:'bytes=4-12'});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 4-12/'+data.length);assert.deepEqual(Buffer.from(await range.arrayBuffer()),data.subarray(4,13));
 const suffix=await s.call(path,'GET',undefined,'owner',{Range:'bytes=-5'});assert.equal(suffix.status,206);assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),data.subarray(data.length-5));
 const head=await s.call(path,'HEAD');assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(data.length));assert.equal((await head.arrayBuffer()).byteLength,0);
 for(const value of ['bytes='+data.length+'-','bytes=1-0','bytes=-0','bytes=1-2,4-5'])assert.equal((await s.call(path,'GET',undefined,'owner',{Range:value})).status,416);
 const account=(await ref(c,'accounts',c.account).get()).data();assert.equal(account.storageReservedBytes,0);assert.equal(account.storageCommittedBytes,c.source.length+entries.reduce((n,e)=>n+e.size,0));assert.equal((await c.backend.readBalance(c.account)).consumed,2);assert.equal((await ref(c,'artifacts',id).get()).get('state'),'ready');assert.equal((await ref(c,'movements','terminal:'+id).get()).get('kind'),'capture');
 for(const p of ['/api/cloud/ai/jobs/'+id,path])assert.equal((await s.call(p,'GET',undefined,'foreign')).status,404);assert.equal((await s.call('/api/cloud/ai/jobs/'+id,'DELETE',undefined,'foreign')).status,404);
 assert.equal((await s.call(path.replace('translation-en.txt','missing.txt'))).status,404);
});

test('partial output write becomes UNKNOWN without another processor call, holding quota until real marker cleanup while money stays held',async()=>{
 const c=await fixture(),id=await enqueue(c);c.objects.failPutAt=2;let invoked=0;
 // The generic processor is a ledger fixture, not the real decoder worker. Model its
 // successful nonzero inspection explicitly without weakening any admission fence.
 const claim=c.backend.claim.bind(c.backend);c.backend.claim=async(account,jobId)=>{const attempt=await claim(account,jobId);if(attempt){const job=await c.backend.job(account,jobId);if(job.invocationPhase==='local_check')assert.equal(await c.backend.resumeTextAfterLocalCheck(account,jobId,attempt.attemptId,job.inputStorage,'nonzero'),true);}return attempt;};
 const processor={process:async message=>{invoked++;await received(c,id,message.attemptId);await c.ai.uploadResults(c.account,id,message.attemptId,outputs());return 'succeeded';}};
 assert.equal(await processOnDemand(c.backend,{accountId:c.account,jobId:id},processor),'unknown');assert.equal(invoked,1);assert.equal(await processOnDemand(c.backend,{accountId:c.account,jobId:id},processor),'not_claimed');assert.equal(invoked,1);
 const a=(await ref(c,'artifacts',id).get()).data();assert.equal(a.state,'purging');assert.equal((await c.backend.readBalance(c.account)).reserved,2);assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),AI_TEXT_BUDGET);
 await assert.rejects(c.ai.download(c.account,id,'translation-en.txt',c.uid),e=>e.code==='not_found');c.objects.failBarrier=true;await assert.rejects(c.ai.purgeResult(id),e=>e.code==='remote');assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),AI_TEXT_BUDGET);
 assert.equal(await c.ai.purgeResult(id),true);assert.equal(await c.ai.purgeResult(id),true);for(const spec of a.plan.artifacts)assert.equal((await c.objects.metadata(spec.key)).marker,true);
 assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),0);assert.equal((await ref(c,'accounts',c.account).get()).get('storageCommittedBytes'),c.source.length);assert.equal((await c.backend.readBalance(c.account)).reserved,2);assert.equal((await ref(c,'movements','terminal:'+id).get()).exists,false);
});

test('a generic processor cannot bypass the durable AI local check or release its reservation',async()=>{
 const c=await fixture(),id=await enqueue(c);let invoked=0;const processor={process:async()=>{invoked++;return 'succeeded';}};
 assert.equal(await processOnDemand(c.backend,{accountId:c.account,jobId:id},processor),'not_claimed');assert.equal(invoked,0);
 const job=await c.backend.job(c.account,id);assert.equal(job.state,'running');assert.equal(job.invocationPhase,'local_check');assert.equal((await c.backend.readBalance(c.account)).reserved,2);
 await ref(c,'jobs',id).update({leaseUntil:0});assert.equal(await c.backend.recover(c.account,id),true);assert.equal((await c.backend.job(c.account,id)).state,'unknown');assert.equal((await ref(c,'movements','terminal:'+id).get()).exists,false);assert.equal((await c.root.collection('providerCalls').get()).size,0);
});

test('source deletion fences every planned result including absent keys while a write is paused; late publication cannot revive outputs',async()=>{
 const c=await fixture(),id=await enqueue(c),attempt=await start(c,id);await received(c,id,attempt.attemptId);const plan=(await ref(c,'artifacts',id).get()).get('plan');
 let enter,release;const entered=new Promise(r=>enter=r),resume=new Promise(r=>release=r);c.objects.pause={enter,resume};const writing=c.ai.uploadResults(c.account,id,attempt.attemptId,outputs()),observed=writing.then(()=>({success:true}),error=>({error}));await entered;
 await c.files.remove(c.account,c.input);assert.equal(await c.files.work(c.input,'cleanup'),'deleted');release();const result=await observed;assert.equal(result.success,undefined);assert.equal(result.error.code,'conflict');
 for(const spec of plan.artifacts){const marker=await c.objects.metadata(spec.key);assert.equal(marker.marker,true);assert.equal(marker.size,0);}
 await c.backend.quarantine(c.account,id,attempt.attemptId);assert.equal((await c.backend.job(c.account,id)).state,'unknown');assert.equal((await c.backend.job(c.account,id)).snapshot,null);assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),0);assert.equal((await ref(c,'accounts',c.account).get()).get('storageCommittedBytes'),0);assert.equal((await c.backend.readBalance(c.account)).reserved,2);assert.equal((await ref(c,'inputs',c.input).get()).get('unknownCount'),1);
 await assert.rejects(c.ai.download(c.account,id,'translation-en.txt',c.uid),e=>e.code==='not_found');assert.equal(await c.backend.finish(c.account,id,attempt.attemptId,true),false);assert.equal(await c.backend.reconcile(c.account,id,'failed','synthetic-no-provider-retry-after-delete'),true);assert.equal((await c.backend.readBalance(c.account)).available,100);
});

test('TTL of ready AI results immediately denies downloads and maintenance purges every key without reversing captured money',async()=>{
 const c=await fixture(),id=await enqueue(c),{entries}=await publish(c,id);
 assert.equal((await c.ai.download(c.account,id,'translation-en.txt',c.uid)).entry.sha256,entries.find(e=>e.name==='translation-en.txt').sha256);
 const captured=await c.backend.readBalance(c.account);assert.equal(captured.consumed,2);assert.equal(captured.reserved,0);
 const upload=(await ref(c,'uploads',c.input).get()).data(),artifact=(await ref(c,'artifacts',id).get()).data(),expired=Date.now()-1000;
 const keys=[...upload.plan.chunks,...upload.plan.groups,upload.plan.final,...artifact.plan.artifacts.map(a=>a.key)];
 await ref(c,'inputs',c.input).update({expiresAtMs:expired});await ref(c,'uploads',c.input).update({expiresAtMs:expired});await ref(c,'artifacts',id).update({expiresAtMs:expired});
 await assert.rejects(c.ai.download(c.account,id,'translation-en.txt',c.uid),e=>e.code==='not_found');
 const status=await c.ai.status(c.account,id,c.uid);assert.equal(status.state,'succeeded');assert.deepEqual(status.results,[]);
 assert.ok((await c.files.maintenance()).includes(c.input));assert.equal((await ref(c,'uploads',c.input).get()).get('state'),'deleting');assert.equal((await ref(c,'fileOutbox',c.input).get()).get('state'),'pending');
 assert.equal(await c.files.work(c.input,'cleanup'),'deleted');
 for(const key of keys){const marker=await c.objects.metadata(key);assert.equal(marker.marker,true);assert.equal(marker.size,0);}
 const purged=(await ref(c,'artifacts',id).get()).data();assert.equal(purged.state,'purged');assert.equal(purged.quotaHeld,0);assert.equal(purged.quotaMode,'none');assert.deepEqual(purged.entries,[]);
 const quota=(await ref(c,'accounts',c.account).get()).data();assert.equal(quota.storageReservedBytes,0);assert.equal(quota.storageCommittedBytes,0);assert.equal(quota.activeUploads,0);
 assert.deepEqual(await c.backend.readBalance(c.account),captured);assert.equal((await ref(c,'movements','terminal:'+id).get()).get('kind'),'capture');assert.equal((await c.root.collection('movements').where('kind','==','capture').get()).size,1);assert.equal((await c.backend.job(c.account,id)).snapshot,null);
});

test('durable provider-call intent rejects a repeated paid call before any provider network request',async()=>{
 const c=await fixture(),id=await enqueue(c),attempt=await start(c,id);await ref(c,'providerCalls',id+'-text-window-0000').create({accountId:c.account,jobId:id,attemptId:attempt.attemptId,callKey:'text-window:0000',state:'intent',fixtureOnly:true});
 const original=globalThis.fetch;let external=0;globalThis.fetch=async(input,init)=>{if(String(input).startsWith('https://generativelanguage.googleapis.com/')){external++;throw Error('External provider forbidden in emulator test');}return original(input,init);};
 try{await assert.rejects(c.ai.invoke(c.account,id,attempt.attemptId,'synthetic-not-a-key')('text-window:0000','gemini-3.8-flash',{contents:[]},new AbortController().signal),e=>e.code==='unknown');assert.equal(external,0);}finally{globalThis.fetch=original;}
});

test('revoking either pilot flag after invocation begins blocks intent and every paid HTTP request',async()=>{
 const c=await fixture(),id=await enqueue(c),attempt=await start(c,id);
 const original=globalThis.fetch;let providerRequests=0;globalThis.fetch=async(input,init)=>{
  if(String(input).startsWith('https://generativelanguage.googleapis.com/')){providerRequests++;throw Error('External provider forbidden in emulator test');}return original(input,init);
 };
 try{
  for(const flag of ['aiPilot','simulationOnly']){
   await ref(c,'accounts',c.account).update({aiPilot:true,simulationOnly:true,[flag]:false});
   await assert.rejects(c.ai.invoke(c.account,id,attempt.attemptId,'synthetic-not-a-key')('text-window:0000','gemini-3.8-flash',{contents:[]},new AbortController().signal),e=>e.code==='disabled');
   assert.equal((await c.root.collection('providerCalls').get()).size,0);assert.equal(providerRequests,0);
  }
 }finally{globalThis.fetch=original;}
 assert.equal((await c.backend.readBalance(c.account)).reserved,2);assert.equal((await ref(c,'movements','terminal:'+id).get()).exists,false);
});

test('intent rejects wrong model, call family and ordinal before provider receipt or HTTP',async()=>{
 const c=await fixture(),id=await enqueue(c),attempt=await start(c,id),original=globalThis.fetch;let providerRequests=0;
 globalThis.fetch=async(input,init)=>{if(String(input).startsWith('https://generativelanguage.googleapis.com/')){providerRequests++;throw Error('External provider forbidden');}return original(input,init);};
 try{
  for(const [key,model]of [['text-window:0000','gemini-3.8-flash-tts'],['voice-chunk:0000','gemini-3.8-flash'],['text-window:0001','gemini-3.8-flash'],['text-window:0000\n','gemini-3.8-flash']]){
   await assert.rejects(c.ai.invoke(c.account,id,attempt.attemptId,'synthetic-not-a-key')(key,model,{contents:[]},new AbortController().signal),e=>e.code==='invalid');
   assert.equal((await c.root.collection('providerCalls').get()).size,0);assert.equal(providerRequests,0);
  }
 }finally{globalThis.fetch=original;}
});

const VOICE_CLOSED='Paused: voice stays closed until reconciliation and privacy are closed (LV-019-B). Success/ACK code is kept for the future reviewed-text integration; closed-voice rejection is covered by the "closed voice:" tests.';
test('actual cloud worker voice path fences one mocked paid request, stores private WAV and captures once',{skip:VOICE_CLOSED},async()=>{
 const c=await fixture(),id=await c.ai.enqueue(c.account,c.input,'narration:en:female',1,'worker-voice-fixture');
 const {processCloudAi}=await import('./cloudAiWorker.ts'),{buildWavRiff,validateWavRiff}=await import('./pipelineVoiceWav.ts');
 const pcm=Buffer.alloc(4800);for(let sample=0;sample<2400;sample++)pcm.writeInt16LE(Math.round(2000*Math.sin(sample/12)),sample*2);const wav=buildWavRiff(pcm);
 const original=globalThis.fetch;let providerRequests=0;globalThis.fetch=async(input,init)=>{
  if(String(input).startsWith('https://generativelanguage.googleapis.com/')){providerRequests++;assert.equal(init.method,'POST');return new Response(JSON.stringify({responseId:'synthetic-worker-voice-response',usageMetadata:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'audio/wav',data:wav.toString('base64')}}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});}
  return original(input,init);
 };
 try{assert.equal(await processCloudAi(c.ai,c.account,id,'synthetic-not-a-key'),'succeeded');assert.equal(providerRequests,1);assert.equal(await processCloudAi(c.ai,c.account,id,'synthetic-not-a-key'),'not_claimed');assert.equal(providerRequests,1);}finally{globalThis.fetch=original;}
 const artifact=(await ref(c,'artifacts',id).get()).data();assert.equal(artifact.state,'ready');assert.equal(artifact.entries.length,1);assert.equal(artifact.entries[0].name,'narration-en.wav');assert.equal(artifact.entries[0].size,wav.length);
 const call=(await ref(c,'providerCalls',id+'-voice-chunk-0000').get()).data();assert.equal(call.state,'received');assert.equal(call.model,'gemini-3.8-flash-tts');assert.equal(call.httpStatus,200);assert.equal(call.responseId,'synthetic-worker-voice-response');
 assert.equal((await c.backend.readBalance(c.account)).consumed,1);assert.equal((await c.backend.readBalance(c.account)).reserved,0);assert.equal((await ref(c,'accounts',c.account).get()).get('storageCommittedBytes'),c.source.length+wav.length);
 const s=await server(c),response=await s.call('/api/cloud/ai/jobs/'+id+'/results/narration-en.wav');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');assert.equal(validateWavRiff(Buffer.from(await response.arrayBuffer())).durationMs,100);
});

for(const lostAck of ['stage','finish'])test('actual cloud worker recovers lost '+lostAck+' ACK without repeating provider, object write or capture',{skip:VOICE_CLOSED},async()=>{
 const c=await fixture(),id=await c.ai.enqueue(c.account,c.input,'narration:en:female',1,'lost-'+lostAck+'-ack');
 const {processCloudAi}=await import('./cloudAiWorker.ts'),{buildWavRiff}=await import('./pipelineVoiceWav.ts'),wav=buildWavRiff(Buffer.alloc(4800));
 const method=lostAck==='stage'?'stageArtifactReceipt':'finish',originalMethod=c.backend[method].bind(c.backend);let ackLost=false;
 c.backend[method]=async(...args)=>{const result=await originalMethod(...args);if(!ackLost){ackLost=true;throw Error('Synthetic acknowledgement lost after durable commit');}return result;};
 const original=globalThis.fetch;let providerRequests=0;globalThis.fetch=async(input,init)=>{
  if(String(input).startsWith('https://generativelanguage.googleapis.com/')){
   providerRequests++;return new Response(JSON.stringify({responseId:'synthetic-lost-'+lostAck+'-ack',...(lostAck==='stage'?{usageMetadata:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2}}:{}),candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'audio/wav',data:wav.toString('base64')}}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  }return original(input,init);
 };
 try{
  assert.equal(await processCloudAi(c.ai,c.account,id,'synthetic-not-a-key'),'succeeded');assert.equal(ackLost,true);assert.equal(providerRequests,1);assert.equal(c.objects.puts,1);
  const artifact=(await ref(c,'artifacts',id).get()).data(),entry=artifact.entries[0];assert.equal(artifact.state,'ready');assert.equal(artifact.entries.length,1);assert.equal(entry.sha256,sha(wav));assert.equal(entry.size,wav.length);
  const stored=await c.objects.metadata(entry.key);assert.equal(stored.generation,entry.generation);assert.equal(stored.marker,undefined);
  assert.equal(await processCloudAi(c.ai,c.account,id,'synthetic-not-a-key'),'not_claimed');assert.equal(providerRequests,1);assert.equal(c.objects.puts,1);assert.deepEqual(await c.objects.metadata(entry.key),stored);
  assert.equal((await ref(c,'movements','terminal:'+id).get()).get('kind'),'capture');assert.equal((await c.root.collection('movements').where('kind','==','capture').get()).size,1);
  assert.equal((await c.backend.readBalance(c.account)).consumed,1);assert.equal((await c.backend.readBalance(c.account)).reserved,0);assert.equal((await ref(c,'inputs',c.input).get()).get('unknownCount'),0);
  const receipt=(await ref(c,'providerCalls',id+'-voice-chunk-0000').get()).data();assert.equal(receipt.state,'received');assert.equal(receipt.usageUnavailable,lostAck==='finish');assert.deepEqual(receipt.usage,lostAck==='finish'?{}:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2});
 }finally{globalThis.fetch=original;}
});

test('actual cloud worker records ambiguous mocked provider rejection as UNKNOWN and never repeats that request',{skip:VOICE_CLOSED},async()=>{
 const c=await fixture(),id=await c.ai.enqueue(c.account,c.input,'narration:en:male',1,'worker-provider-rejected'),{processCloudAi}=await import('./cloudAiWorker.ts');
 const original=globalThis.fetch;let providerRequests=0;globalThis.fetch=async(input,init)=>{
  if(String(input).startsWith('https://generativelanguage.googleapis.com/')){providerRequests++;return new Response(JSON.stringify({error:{message:'synthetic-rejection'}}),{status:503,headers:{'Content-Type':'application/json'}});}return original(input,init);
 };
 try{assert.equal(await processCloudAi(c.ai,c.account,id,'synthetic-not-a-key'),'unknown');assert.equal(providerRequests,1);assert.equal(await processCloudAi(c.ai,c.account,id,'synthetic-not-a-key'),'not_claimed');assert.equal(providerRequests,1);}finally{globalThis.fetch=original;}
 const call=(await ref(c,'providerCalls',id+'-voice-chunk-0000').get()).data();assert.equal(call.state,'ambiguous');assert.equal(call.httpStatus,503);assert.equal((await c.backend.readBalance(c.account)).reserved,1);assert.equal((await ref(c,'artifacts',id).get()).get('state'),'purging');
 await assert.rejects(c.ai.download(c.account,id,'narration-en.wav',c.uid),e=>e.code==='not_found');assert.equal((await ref(c,'movements','terminal:'+id).get()).exists,false);
});

test('expired lease recovery isolates a persistent first-row fault and continues healthy neighbors on repeated passes',async()=>{
 const c=await fixture(),ids=[await enqueue(c),await enqueue(c),await enqueue(c)],original=c.backend.recover.bind(c.backend),attempted=[];
 for(let n=0;n<ids.length;n++){await claimAfterNonzeroInspection(c,ids[n]);await ref(c,'jobs',ids[n]).update({leaseUntil:n});}
 const before=await c.backend.readBalance(c.account);
 c.backend.recover=async(account,id)=>{attempted.push(id);if(id===ids[0])throw Error('synthetic bad lease');return original(account,id);};
 const first=await c.backend.recoverExpiredLeasesReport(3);assert.equal(first.recovered,2);assert.deepEqual(first.failures,[{jobId:ids[0],stage:'recover',code:'UNCLASSIFIED'}]);assert.deepEqual(attempted,ids);
 for(let n=1;n<ids.length;n++){assert.equal((await c.backend.job(c.account,ids[n])).state,'queued');await claimAfterNonzeroInspection(c,ids[n]);await ref(c,'jobs',ids[n]).update({leaseUntil:n});}
 attempted.length=0;await assert.rejects(c.backend.recoverExpiredLeases(3),e=>e.recoveryReport?.recovered===2&&e.recoveryReport?.failures?.[0]?.jobId===ids[0]);assert.deepEqual(attempted,ids);
 assert.deepEqual(await c.backend.readBalance(c.account),before);assert.equal((await c.root.collection('providerCalls').get()).size,0);
});

test('AI query filters profile before its limit and dispatches behind ten unchanged older foreign outboxes',async()=>{
 const c=await fixture(),foreign=[];
 for(let n=0;n<10;n++){const id=randomUUID(),data={accountId:c.foreign,jobId:id,state:'pending',nextAttemptAt:n,dispatchAttempt:null,leaseUntil:null};await ref(c,'jobs',id).create({accountId:c.foreign,state:'queued',aiProfile:'foreign-worker'});await ref(c,'outbox',id).create(data);foreign.push({id,data});}
 const id=await enqueue(c),starts=[];assert.equal((await ref(c,'outbox',id).get()).get('aiProfile'),AI_CATALOG_VERSION);
 const legacy=(await ref(c,'outbox',id).get()).data();delete legacy.aiProfile;await ref(c,'outbox',id).set(legacy);assert.deepEqual(await c.backend.pendingAiDispatches(30),[]);
 for(const row of foreign)assert.equal(await c.backend.backfillAiDispatchProfile(row.id),false);
 await ref(c,'accounts',c.account).update({aiPilot:false});assert.equal(await c.backend.backfillAiDispatchProfile(id),true);assert.deepEqual(await c.backend.pendingAiDispatches(30),[id]);
 assert.equal(await c.backend.claimDispatch(id),null);assert.ok((await ref(c,'outbox',id).get()).get('nextAttemptAt')>Date.now());await ref(c,'outbox',id).update({nextAttemptAt:0});assert.equal(await c.backend.aiDispatchEligible(id),false);
 await ref(c,'accounts',c.account).update({aiPilot:true});await ref(c,'outbox',id).update({nextAttemptAt:0});assert.equal(await c.backend.aiDispatchEligible(id),true);assert.equal(await c.backend.backfillAiDispatchProfile(id),false);
 const result=await drainCloudAi({recover:async()=>0,pending:limit=>c.backend.pendingAiDispatches(limit),eligible:job=>c.backend.aiDispatchEligible(job),claim:job=>c.backend.claimDispatch(job),acknowledge:(job,attempt)=>c.backend.acknowledgeDispatch(job,attempt),pendingPurges:async()=>[],claimPurge:async()=>false,start:async(_kind,job)=>{starts.push(job);}});
 assert.deepEqual(starts,[id]);assert.equal(result.startsAccepted,1);for(const row of foreign)assert.deepEqual((await ref(c,'outbox',row.id).get()).data(),row.data);
 assert.equal((await c.root.collection('providerCalls').get()).size,0);
});

test('UNKNOWN sibling is deferred before infrastructure and atomic claim while an independent queued job dispatches',async()=>{
 const c=await fixture(),a=await enqueue(c),b=await enqueue(c),input=randomUUID(),source=(await ref(c,'inputs',c.input).get()).data();
 source.storage={...source.storage,key:'candidate-files-v1/'+input+'/video.mp4'};await ref(c,'inputs',input).create(source);await c.backend.saveProject(c.account,input,0,'An independent English project.');
 const valid=await c.backend.reserve(c.account,input,'independent',2,'translation:en',1,AI_CATALOG_VERSION),attempt=await start(c,a);await c.backend.quarantine(c.account,a,attempt.attemptId);
 const before=await c.backend.readBalance(c.account),aBefore=await c.backend.job(c.account,a),bBefore=await c.backend.job(c.account,b),moves=(await c.root.collection('movements').get()).size;
 assert.equal(await c.backend.claimDispatch(b),null);assert.ok((await ref(c,'outbox',b).get()).get('nextAttemptAt')>Date.now());
 await ref(c,'outbox',b).update({nextAttemptAt:0});await ref(c,'outbox',valid).update({nextAttemptAt:1});const starts=[];
 const result=await drainCloudAi({recover:async()=>0,pending:limit=>c.backend.pendingAiDispatches(limit),eligible:job=>c.backend.aiDispatchEligible(job),claim:job=>c.backend.claimDispatch(job),acknowledge:(job,token)=>c.backend.acknowledgeDispatch(job,token),pendingPurges:async()=>[],claimPurge:async()=>false,start:async(_kind,job)=>{starts.push(job);}});
 assert.deepEqual(starts,[valid]);assert.equal(result.skipped,1);assert.ok((await ref(c,'outbox',b).get()).get('nextAttemptAt')>Date.now());
 assert.deepEqual(await c.backend.readBalance(c.account),before);assert.deepEqual(await c.backend.job(c.account,a),aBefore);assert.deepEqual(await c.backend.job(c.account,b),bBefore);assert.equal((await c.root.collection('movements').get()).size,moves);assert.equal((await c.root.collection('providerCalls').get()).size,0);
});

test('a full poison recovery page rotates durably to a valid fourth job without rewriting poison leases or money',async()=>{
 const c=await fixture(),poison=[await enqueue(c),await enqueue(c),await enqueue(c)],otherInput=randomUUID(),source=(await ref(c,'inputs',c.input).get()).data();source.accountId=c.foreign;source.storage={...source.storage,key:'candidate-files-v1/'+otherInput+'/video.mp4'};
 await ref(c,'inputs',otherInput).create(source);await c.backend.saveProject(c.foreign,otherInput,0,'A valid independent recovery project.');await c.backend.creditVerifiedPurchase(c.foreign,'foreign-recovery',10,1,'synthetic','sandbox');
 const healthy=await c.backend.reserve(c.foreign,otherInput,'healthy-fourth',2,'translation:en',1,AI_CATALOG_VERSION),ids=[...poison,healthy];
 for(let n=0;n<ids.length;n++){await claimAfterNonzeroInspection(c,ids[n],n===3?c.foreign:c.account);await ref(c,'jobs',ids[n]).update({leaseUntil:n});}
 const beforePoison=await Promise.all(poison.map(id=>c.backend.job(c.account,id))),before=[await c.backend.readBalance(c.account),await c.backend.readBalance(c.foreign)],moves=(await c.root.collection('movements').get()).size,original=c.backend.recover.bind(c.backend);
 c.backend.recover=async(account,id)=>{if(poison.includes(id)){const e=new Error('synthetic poison');e.code=14;throw e;}return original(account,id);};
 const first=await c.backend.recoverExpiredLeasesReport(3);assert.equal(first.recovered,0);assert.equal(first.failures.length,3);assert.ok(first.failures.every(x=>x.code===14));assert.equal((await c.backend.job(c.foreign,healthy)).state,'running');
 const cursor=(await c.root.collection('maintenanceCursors').doc('expiredJobRecovery').get()).data();assert.equal(cursor.jobId,poison[2]);
 const reloaded=new FirestoreBackend(c.db,c.root);reloaded.recover=c.backend.recover;const second=await reloaded.recoverExpiredLeasesReport(3);assert.equal(second.recovered,1);assert.equal((await c.backend.job(c.foreign,healthy)).state,'queued');assert.ok(second.scanned<=3);
 assert.deepEqual(await Promise.all(poison.map(id=>c.backend.job(c.account,id))),beforePoison);assert.deepEqual([await c.backend.readBalance(c.account),await c.backend.readBalance(c.foreign)],before);assert.equal((await c.root.collection('movements').get()).size,moves);assert.equal((await c.root.collection('providerCalls').get()).size,0);
});

test('thirty stale owned AI outboxes are deferred and a valid thirty-first dispatches on the next bounded pass',async()=>{
 const c=await fixture(),stale=[],jobsBefore=[];
 for(let n=0;n<30;n++){const id=randomUUID(),box={accountId:c.account,jobId:id,aiProfile:AI_CATALOG_VERSION,state:'pending',nextAttemptAt:n,leaseUntil:null,dispatchAttempt:null};await ref(c,'outbox',id).create(box);
  if(n%2===0){const job={accountId:c.account,inputId:c.input,aiProfile:AI_CATALOG_VERSION,state:n%4===0?'cancelled':'running'};await ref(c,'jobs',id).create(job);jobsBefore.push({id,job});}stale.push(id);}
 const valid=await enqueue(c),starts=[],before=await c.backend.readBalance(c.account),moves=(await c.root.collection('movements').get()).size;
 const deps={recover:async()=>0,pending:limit=>c.backend.pendingAiDispatches(limit),eligible:id=>c.backend.aiDispatchEligible(id),claim:id=>c.backend.claimDispatch(id),acknowledge:(id,a)=>c.backend.acknowledgeDispatch(id,a),pendingPurges:async()=>[],claimPurge:async()=>false,start:async(_kind,id)=>{starts.push(id);}};
 const first=await drainCloudAi(deps);assert.equal(first.skipped,15);assert.equal(first.failures.length,15);assert.deepEqual(starts,[]);for(const id of stale)assert.ok((await ref(c,'outbox',id).get()).get('nextAttemptAt')>Date.now());
 const second=await drainCloudAi(deps);assert.equal(second.startsAccepted,1);assert.deepEqual(starts,[valid]);
 const target=stale[0];await ref(c,'outbox',target).update({nextAttemptAt:0});assert.equal(await c.backend.claimDispatch(target),null);assert.ok((await ref(c,'outbox',target).get()).get('nextAttemptAt')>Date.now());
 for(const row of jobsBefore)assert.deepEqual((await ref(c,'jobs',row.id).get()).data(),row.job);assert.deepEqual(await c.backend.readBalance(c.account),before);assert.equal((await c.root.collection('movements').get()).size,moves);assert.equal((await c.root.collection('providerCalls').get()).size,0);
});

test('a delayed recovery checkpoint cannot overwrite a cursor already advanced by another maintenance call',async()=>{
 const c=await fixture(),ids=[randomUUID(),randomUUID()];for(let n=0;n<2;n++)await ref(c,'jobs',ids[n]).create({accountId:c.account,state:'running',leaseUntil:n});
 const before=await Promise.all(ids.map(async id=>(await ref(c,'jobs',id).get()).data()));let enter,release;const entered=new Promise(r=>enter=r),paused=new Promise(r=>release=r);
 c.backend.recover=async()=>{enter();await paused;return false;};const delayed=c.backend.recoverExpiredLeasesReport(1);await entered;
 const other=new FirestoreBackend(c.db,c.root);other.recover=async()=>false;await other.recoverExpiredLeasesReport(2);
 const cursor=c.root.collection('maintenanceCursors').doc('expiredJobRecovery');assert.equal((await cursor.get()).get('jobId'),ids[1]);release();await delayed;
 assert.equal((await cursor.get()).get('jobId'),ids[1]);assert.deepEqual(await Promise.all(ids.map(async id=>(await ref(c,'jobs',id).get()).data())),before);
});

test('migration reports ambiguous missing or inconsistent legacy AI rows without adopting or changing them',async()=>{
 const c=await fixture(),missing=randomUUID(),mismatch=randomUUID(),missingInput=randomUUID();
 for(const id of [missing,mismatch,missingInput])await ref(c,'outbox',id).create({accountId:c.account,jobId:id,state:'pending',nextAttemptAt:0,leaseUntil:null});
 await ref(c,'jobs',mismatch).create({accountId:c.foreign,inputId:c.input,aiProfile:AI_CATALOG_VERSION,state:'queued'});
 await ref(c,'jobs',missingInput).create({accountId:c.account,inputId:randomUUID(),aiProfile:AI_CATALOG_VERSION,state:'running'});
 for(const id of [missing,mismatch,missingInput]){const before=(await ref(c,'outbox',id).get()).data();await assert.rejects(c.backend.backfillAiDispatchProfile(id),e=>e.code==='invariant');assert.deepEqual((await ref(c,'outbox',id).get()).data(),before);}
 await ref(c,'outbox',mismatch).update({aiProfile:'foreign-worker'});const conflict=(await ref(c,'outbox',mismatch).get()).data();await assert.rejects(c.backend.backfillAiDispatchProfile(mismatch),e=>e.code==='invariant');assert.deepEqual((await ref(c,'outbox',mismatch).get()).data(),conflict);
 const before=await c.backend.readBalance(c.account);await ref(c,'outbox',missing).update({aiProfile:AI_CATALOG_VERSION});await assert.rejects(c.backend.claimDispatch(missing),e=>e.code==='invariant');assert.ok((await ref(c,'outbox',missing).get()).get('nextAttemptAt')>Date.now());assert.deepEqual(await c.backend.readBalance(c.account),before);assert.equal((await c.root.collection('providerCalls').get()).size,0);
});

test('a full page of non-UUID poison IDs rotates internally without leaking arbitrary IDs or starving a valid job',async()=>{
 const c=await fixture(),bad=['opaque-invalid-one','opaque-invalid-two','opaque-invalid-three'];
 for(let n=0;n<3;n++)await ref(c,'jobs',bad[n]).create({accountId:c.account,state:'running',leaseUntil:n});
 const healthy=await enqueue(c);await claimAfterNonzeroInspection(c,healthy);await ref(c,'jobs',healthy).update({leaseUntil:3});const before=await c.backend.readBalance(c.account),poisonBefore=await Promise.all(bad.map(async id=>(await ref(c,'jobs',id).get()).data()));
 const first=await c.backend.recoverExpiredLeasesReport(3);assert.equal(first.failures.length,3);assert.ok(first.failures.every(x=>x.jobId===null&&x.code==='INVALID_ID'));assert.ok(bad.every(id=>!JSON.stringify(first).includes(id)));
 assert.equal((await c.root.collection('maintenanceCursors').doc('expiredJobRecovery').get()).get('jobId'),bad[2]);
 const reloaded=new FirestoreBackend(c.db,c.root),second=await reloaded.recoverExpiredLeasesReport(3);assert.equal(second.recovered,1);assert.equal((await c.backend.job(c.account,healthy)).state,'queued');assert.deepEqual(await Promise.all(bad.map(async id=>(await ref(c,'jobs',id).get()).data())),poisonBefore);assert.deepEqual(await c.backend.readBalance(c.account),before);assert.equal((await c.root.collection('providerCalls').get()).size,0);
});

test('an existing corrupt recovery cursor fails visibly before recovering and preserves cursor Jobs leases and money',async()=>{
 const c=await fixture(),job=await enqueue(c);assert.ok(await c.backend.claim(c.account,job));await ref(c,'jobs',job).update({leaseUntil:0});
 const cursor=c.root.collection('maintenanceCursors').doc('expiredJobRecovery'),beforeJob=await c.backend.job(c.account,job),beforeBalance=await c.backend.readBalance(c.account),beforeMovements=(await c.root.collection('movements').get()).size;
 let recoverCalls=0;c.backend.recover=async()=>{recoverCalls++;return true;};
 const base={kind:'expired-job-recovery-v1',leaseUntil:0,jobId:job},bad=[{...base,kind:'other'},{...base,leaseUntil:NaN},{...base,leaseUntil:Infinity},{...base,leaseUntil:'invalid'},{...base,jobId:''},{...base,jobId:'bad/id'}];
 for(const value of bad){await cursor.set(value);const before=(await cursor.get()).data();await assert.rejects(c.backend.recoverExpiredLeasesReport(3),e=>e.code==='invariant');assert.equal(recoverCalls,0);assert.deepEqual((await cursor.get()).data(),before);assert.deepEqual(await c.backend.job(c.account,job),beforeJob);assert.deepEqual(await c.backend.readBalance(c.account),beforeBalance);assert.equal((await c.root.collection('movements').get()).size,beforeMovements);}
 assert.equal((await c.root.collection('providerCalls').get()).size,0);
});

test('an old outbox error cannot change a newer synthetic turn',async()=>{
 const c=await fixture(),requestKey=randomUUID();let enter,release,calls=0;
 const sent=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith('/reservations'))return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};
  if(path.endsWith('/release')){calls++;enter();await resume;throw Object.assign(Error('synthetic unavailable'),{response:{status:503}});}
  throw Error('unexpected synthetic request');
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const job=await ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);assert.equal(await c.backend.cancel(c.account,job),true);
 const outbox=ref(c,'billingOutbox',job),draining=ai.drainExternalBilling();
 try{
  await sent;const until=Date.now()+120000;await outbox.update({leaseToken:randomUUID(),leaseOwner:'synthetic-worker',generation:1,leaseUntil:until,nextAttemptAt:until});
  const expected=(await outbox.get()).data();release();const result=await draining;
  assert.equal(result.failed,1);assert.equal(calls,1);assert.deepEqual((await outbox.get()).data(),expected);
 }finally{release();await draining.catch(()=>undefined);}
});

test('an unchanged outbox failure schedules once and rejects a repeated old observation',async()=>{
 const c=await fixture(),requestKey=randomUUID();
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith('/reservations'))return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};
  if(path.endsWith('/release'))throw Object.assign(Error('synthetic unavailable'),{response:{status:503}});
  throw Error('unexpected synthetic request');
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const job=await ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);assert.equal(await c.backend.cancel(c.account,job),true);
 const [row]=await c.backend.pendingExternalBilling(1),outbox={jobId:row.jobId,accountId:row.accountId,provider:row.provider,identityKey:row.identityKey,reservationId:row.reservationId,seconds:row.seconds,action:row.action};
 assert.equal((await ai.drainExternalBilling()).failed,1);const saved=(await ref(c,'billingOutbox',job).get()).data();
 assert.equal(saved.state,'retry_wait');assert.equal(saved.attempts,1);assert.ok(saved.nextAttemptAt>Date.now());
 assert.equal(await c.backend.recordExternalBillingFailure(job,'unavailable',{snapshotVersion:row.snapshotVersion,state:row.state,outbox}),false);
 assert.deepEqual((await ref(c,'billingOutbox',job).get()).data(),saved);
});

test('an old hold error cannot change a newer synthetic turn',async()=>{
 const c=await fixture(),identityKey=accountIdentityKey(c.uid),requestKey=randomUUID(),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);await c.backend.recordExternalBillingReview(c.account,requestKey,data,{reservationId,state:'captured',seconds:2});
 const rows=await c.root.collection('billingHoldOutbox').get(),event=rows.docs[0].ref;let enter,release,calls=0;
 const sent=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});
 const billing=new AccountBillingClient(undefined,{request:async request=>{assert.ok(new URL(request.url).pathname.endsWith('/billing-holds'));calls++;enter();await resume;throw Object.assign(Error('synthetic unavailable'),{response:{status:503}});}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),draining=ai.drainExternalHolds();
 try{
  await sent;const until=Date.now()+120000;await event.update({leaseToken:randomUUID(),leaseOwner:'synthetic-worker',generation:1,leaseUntil:until,nextAttemptAt:until});
  const expected=(await event.get()).data();release();const result=await draining;
  assert.equal(result.failed,1);assert.equal(calls,1);assert.deepEqual((await event.get()).data(),expected);
 }finally{release();await draining.catch(()=>undefined);}
});

test('an unchanged hold failure schedules once and rejects a repeated old observation',async()=>{
 const c=await fixture(),identityKey=accountIdentityKey(c.uid),requestKey=randomUUID(),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);await c.backend.recordExternalBillingReview(c.account,requestKey,data,{reservationId,state:'captured',seconds:2});
 const [row]=await c.backend.pendingExternalHolds(1),authorized=await c.backend.authorizeExternalHold(row);assert.equal(authorized.state,'eligible');
 const billing=new AccountBillingClient(undefined,{request:async()=>{throw Object.assign(Error('synthetic unavailable'),{response:{status:503}});}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 assert.equal((await ai.drainExternalHolds()).failed,1);const event=ref(c,'billingHoldOutbox',row.id),saved=(await event.get()).data();
 assert.equal(saved.state,'pending');assert.equal(saved.attempts,1);assert.ok(saved.nextAttemptAt>Date.now());
 assert.equal(await c.backend.recordExternalHoldFailure(authorized.hold,'unavailable',row.snapshotVersion),false);
 assert.deepEqual((await event.get()).data(),saved);
});

test('a corrupt outbox generation is recorded for review without calling Account',async()=>{
 const c=await fixture(),requestKey=randomUUID();let calls=0;
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith('/reservations'))return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};
  calls++;throw Object.assign(Error('synthetic unavailable'),{response:{status:503}});
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const job=await ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);assert.equal(await c.backend.cancel(c.account,job),true);
 const event=ref(c,'billingOutbox',job);await event.update({generation:'corrupt'});
 const result=await ai.drainExternalBilling(),after=(await event.get()).data();assert.equal(calls,0);assert.equal(result.failed,1);assert.equal(after.state,'needs_review');assert.equal(after.generation,'corrupt');assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,1);const holds=await c.root.collection('billingHoldOutbox').get();assert.equal(holds.size,1);assert.equal(holds.docs[0].get('accountId'),c.account);assert.equal(holds.docs[0].get('state'),'pending');
});

test('a corrupt hold generation is recorded for review without calling Account',async()=>{
 const c=await fixture(),identityKey=accountIdentityKey(c.uid),requestKey=randomUUID(),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);await c.backend.recordExternalBillingReview(c.account,requestKey,data,{reservationId,state:'captured',seconds:2});
 const rows=await c.root.collection('billingHoldOutbox').get(),event=rows.docs[0].ref;await event.update({generation:'corrupt'});let calls=0;
 const billing=new AccountBillingClient(undefined,{request:async()=>{calls++;throw Error('unexpected synthetic account call');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const result=await ai.drainExternalHolds(),after=(await event.get()).data();assert.equal(calls,0);assert.equal(result.review,1);assert.equal(after.state,'needs_review');assert.equal(after.reviewReason,'invalid_scheduling_metadata');assert.equal(after.generation,'corrupt');
});

test('a matching synthetic settlement acknowledgement is retained for review after a newer turn',async()=>{
 const c=await fixture(),requestKey=randomUUID();let enter,release,calls=0;
 const sent=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;
  if(path.endsWith('/reservations'))return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};
  if(path.endsWith('/release')){calls++;enter();await resume;return {data:{state:'released',reservationId:path.split('/').at(-2),seconds:2}};}
  throw Error('unexpected synthetic request');
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const job=await ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);assert.equal(await c.backend.cancel(c.account,job),true);
 const event=ref(c,'billingOutbox',job),draining=ai.drainExternalBilling();
 try{
  await sent;const leaseToken=randomUUID(),until=Date.now()+120000;await event.update({leaseToken,leaseOwner:'synthetic-worker',generation:1,leaseUntil:until,nextAttemptAt:until});
  release();const result=await draining,saved=(await event.get()).data();
  assert.equal(result.settled,0);assert.equal(result.failed,1);assert.equal(calls,1);assert.equal(saved.state,'needs_review');assert.equal(saved.leaseToken,leaseToken);
  const incidents=await c.root.collection('billingOutboxReviewIncidents').get();assert.equal(incidents.size,1);assert.equal(incidents.docs[0].get('remoteAck.state'),'released');
 }finally{release();await draining.catch(()=>undefined);}
});

test('a matching synthetic hold acknowledgement survives a newer turn',async()=>{
 const c=await fixture(),identityKey=accountIdentityKey(c.uid),requestKey=randomUUID(),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);await c.backend.recordExternalBillingReview(c.account,requestKey,data,{reservationId,state:'captured',seconds:2});
 const rows=await c.root.collection('billingHoldOutbox').get(),event=rows.docs[0].ref;let enter,release,calls=0;
 const sent=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});
 const billing=new AccountBillingClient(undefined,{request:async request=>{assert.ok(new URL(request.url).pathname.endsWith('/billing-holds'));calls++;enter();await resume;return {data:{blocked:true,recorded:true,created:true}};}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),draining=ai.drainExternalHolds();
 try{
  await sent;const leaseToken=randomUUID(),until=Date.now()+120000;await event.update({leaseToken,leaseOwner:'synthetic-worker',generation:1,leaseUntil:until,nextAttemptAt:until});
  release();const result=await draining,saved=(await event.get()).data();
  assert.equal(result.applied,1);assert.equal(calls,1);assert.equal(saved.state,'applied');assert.equal(saved.leaseToken,leaseToken);
 }finally{release();await draining.catch(()=>undefined);}
});

for(const [field,value] of [['generation',Number.MAX_SAFE_INTEGER],['attempts','corrupt'],['attempts',Number.MAX_SAFE_INTEGER]]){
 test(`invalid outbox ${field} ${String(value)} prevents the synthetic account call`,async()=>{
  const c=await fixture(),requestKey=randomUUID();let calls=0;
  const billing=new AccountBillingClient(undefined,{request:async request=>{
   const path=new URL(request.url).pathname;
   if(path.endsWith('/reservations'))return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};
   calls++;throw Object.assign(Error('synthetic unavailable'),{response:{status:503}});
  }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
  const job=await ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);assert.equal(await c.backend.cancel(c.account,job),true);
  const event=ref(c,'billingOutbox',job);await event.update({[field]:value});
  const result=await ai.drainExternalBilling(),after=(await event.get()).data();assert.equal(calls,0);assert.equal(result.failed,1);assert.equal(after.state,'needs_review');assert.equal(after[field],value);assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,1);
 });
 test(`invalid hold ${field} ${String(value)} prevents the synthetic account call`,async()=>{
  const c=await fixture(),identityKey=accountIdentityKey(c.uid),requestKey=randomUUID(),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
  await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);await c.backend.recordExternalBillingReview(c.account,requestKey,data,{reservationId,state:'captured',seconds:2});
  const rows=await c.root.collection('billingHoldOutbox').get(),event=rows.docs[0].ref;await event.update({[field]:value});let calls=0;
  const billing=new AccountBillingClient(undefined,{request:async()=>{calls++;throw Error('unexpected synthetic account call');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
  const result=await ai.drainExternalHolds(),after=(await event.get()).data();assert.equal(calls,0);assert.equal(result.review,1);assert.equal(after.state,'needs_review');assert.equal(after.reviewReason,'invalid_scheduling_metadata');assert.equal(after[field],value);
 });
}

test('a corrupt orphaned outbox does not block the account named only in that event',async()=>{
 const c=await fixture(),jobId=randomUUID(),identityKey=accountIdentityKey(c.foreignUid),reservationId=randomUUID(),event=ref(c,'billingOutbox',jobId);let calls=0;
 await event.create({jobId,accountId:c.foreign,provider:'account_seconds',identityKey,reservationId,seconds:2,action:'release',state:'pending',nextAttemptAt:0,attempts:0,generation:'corrupt'});
 const billing=new AccountBillingClient(undefined,{request:async()=>{calls++;throw Error('unexpected synthetic account call');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const result=await ai.drainExternalBilling(),incidents=await c.root.collection('billingOutboxReviewIncidents').get();
 assert.equal(calls,0);assert.equal(result.failed,1);assert.equal((await event.get()).get('state'),'needs_review');assert.equal(incidents.size,1);assert.equal(incidents.docs[0].get('attribution'),'unverified');assert.equal(incidents.docs[0].get('ownerBlocked'),false);assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
});

test('a corrupt unverified hold does not block the account named only in that event',async()=>{
 const c=await fixture(),identityKey=accountIdentityKey(c.uid),requestKey=randomUUID(),reservationId=randomUUID(),data={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);await c.backend.recordExternalBillingReview(c.account,requestKey,data,{reservationId,state:'captured',seconds:2});
 const rows=await c.root.collection('billingHoldOutbox').get(),event=rows.docs[0].ref;await event.update({accountId:c.foreign,identityKey:accountIdentityKey(c.foreignUid),generation:'corrupt'});let calls=0;
 const billing=new AccountBillingClient(undefined,{request:async()=>{calls++;throw Error('unexpected synthetic account call');}}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const result=await ai.drainExternalHolds();assert.equal(calls,0);assert.equal(result.review,1);assert.equal((await event.get()).get('state'),'needs_review');assert.equal((await ref(c,'billingGuards',c.foreign).get()).exists,false);assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
});

// Added 2026-11-19: new rejection checks for the deliberately closed voice path. The older voice
// success/ACK tests above are intentionally preserved for the future reviewed-text integration.
test('closed voice: a voice job is never claimed by the worker, never reaches the provider and never moves balance',async()=>{
 const c=await fixture(),id=await c.ai.enqueue(c.account,c.input,'narration:en:female',1,'closed-voice-worker');
 const {processCloudAi}=await import('./cloudAiWorker.ts'),before=await c.backend.readBalance(c.account),movements=(await c.root.collection('movements').get()).size;
 const original=globalThis.fetch;let providerRequests=0;globalThis.fetch=async(input,init)=>{if(String(input).startsWith('https://generativelanguage.googleapis.com/')){providerRequests++;throw Error('closed voice must not call the provider');}return original(input,init);};
 try{assert.equal(await processCloudAi(c.ai,c.account,id,'synthetic-not-a-key'),'not_claimed');assert.equal(await processCloudAi(c.ai,c.account,id,'synthetic-not-a-key'),'not_claimed');}finally{globalThis.fetch=original;}
 assert.equal(providerRequests,0);assert.equal((await c.root.collection('providerCalls').get()).size,0);
 assert.deepEqual(await c.backend.readBalance(c.account),before);assert.equal((await c.root.collection('movements').get()).size,movements);
});

test('closed voice: client quote and job creation for both voices are rejected and create no job, reservation or outbox entry',async()=>{
 const c=await fixture(),s=await server(c),before=await c.backend.readBalance(c.account);
 {
  for(const operation of ['narration:en:female','narration:en:male']){
   const quote=await s.call('/api/cloud/ai/quote?inputId='+c.input+'&operation='+operation+'&revision=1');assert.ok(quote.status>=400,operation+' quote must be rejected, got '+quote.status);
   const created=await s.call('/api/cloud/ai/jobs','POST',{inputId:c.input,operation,expectedRevision:1,requestKey:'closed-voice-'+operation.slice(-6)});assert.ok(created.status>=400,operation+' creation must be rejected, got '+created.status);
  }
 }
 for(const col of ['jobs','outbox','artifacts','providerCalls'])assert.equal((await c.root.collection(col).get()).size,0,col);
 assert.deepEqual(await c.backend.readBalance(c.account),before);
});
