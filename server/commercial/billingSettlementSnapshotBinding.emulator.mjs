import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';import {Readable} from 'node:stream';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
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
afterEach(async()=>{for(const c of contexts.splice(0)){try{assert.match(c.root.path,/^vistavo_ai_integration_test\/[a-f0-9-]{36}$/);if(c.server){c.server.closeAllConnections();await new Promise(r=>c.server.close(r));}await c.db.recursiveDelete(c.root);assert.equal((await c.root.listCollections()).length,0);console.log(JSON.stringify({event:'synthetic-result-cleanup',project:'demo-vistavo-ledger',allAbsent:true}));}finally{await c.db.terminate();await deleteApp(c.app);}}});
async function fixture(){
 const app=initializeApp({projectId:'demo-vistavo-ledger'},'lv-ai-test-'+randomUUID()),db=getFirestore(app),root=db.collection('vistavo_ai_integration_test').doc(randomUUID()),backend=new FirestoreBackend(db,root),objects=new MemoryObjects();
 const ai=new FirestoreAi(db,root,backend,objects),files=new FirestoreFiles(db,root,objects,{chunkBytes:4},(account,input)=>ai.purgeInput(account,input));
 const uid='fixture-ai-owner-'+randomUUID(),foreignUid='fixture-ai-foreign-'+randomUUID(),account=await backend.accountForUid(uid),foreign=await backend.accountForUid(foreignUid);
 const c={app,db,root,backend,objects,ai,files,uid,foreignUid,account,foreign};contexts.push(c);
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

before(()=>{
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE','K_JOB','FUNCTION_TARGET','GAE_ENV'])assert.ok(!process.env[name]);
 for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])assert.ok(!process.env[name]||process.env[name]==='demo-vistavo-ledger');
});
async function received(c,jobId,attemptId){
 const callKey='text-window:0000',model='gemini-3.8-flash';
 await ref(c,'providerCalls',jobId+'-'+callKey.replace(':','-')).create({jobId,accountId:c.account,attemptId,callKey,model,state:'received',requestSha256:'b'.repeat(64),responseSha256:'c'.repeat(64),responseId:'synthetic-emulator-receipt',httpStatus:200,startedAtMs:Date.now()-100,finishedAtMs:Date.now(),usage:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},fixtureOnly:true});
}
async function publish(c,id){
 const attempt=await c.backend.claim(c.account,id);assert.ok(attempt);const job=await c.backend.job(c.account,id);
 if(job.invocationPhase==='local_check')assert.equal(await c.backend.resumeTextAfterLocalCheck(c.account,id,attempt.attemptId,job.inputStorage,'nonzero'),true);
 assert.equal(await c.backend.beginInvocation(c.account,id,attempt.attemptId),true);await received(c,id,attempt.attemptId);
 await c.ai.uploadResults(c.account,id,attempt.attemptId,outputs());assert.equal(await c.backend.finish(c.account,id,attempt.attemptId,true),true);
}
async function settlementFixture(){
 const c=await fixture(),calls=[];let waitForCapture,releaseCapture;
 const entered=new Promise(resolve=>waitForCapture=resolve),resume=new Promise(resolve=>releaseCapture=resolve);
 let pause=false;
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);
  if(path.endsWith('/capture')&&pause){waitForCapture();await resume;}
  return {data:{state:path.endsWith('/capture')?'captured':'reserved',reservationId:request.data.reservationId??path.split('/').at(-2),seconds:request.data.seconds??2}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const id=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await publish(c,id);
 return {c,ai,id,calls,entered,releaseCapture,enablePause:()=>pause=true};
}
async function expectedAndSnapshot(c,id){
 const job=await c.backend.job(c.account,id),outbox=(await ref(c,'billingOutbox',id).get()).data();
 const expected={jobId:id,accountId:c.account,provider:'account_seconds',identityKey:job.externalBilling.identityKey,reservationId:job.externalBilling.reservationId,seconds:job.externalBilling.seconds,action:outbox.action,...(outbox.action==='capture'?{attemptId:outbox.attemptId}:{})};
 const intentId=sha(JSON.stringify([c.account,job.requestKey])),snapshot=await c.db.runTransaction(tx=>c.backend.captureExternalBillingSettlement(tx,expected,intentId));assert.ok(snapshot);return {expected,snapshot};
}
test('one job snapshot cannot settle a different job or carry an unrelated observation',{timeout:30000},async()=>{
 const {c,ai,id:first}=await settlementFixture(),second=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await publish(c,second);
 const a=await expectedAndSnapshot(c,first),b=await expectedAndSnapshot(c,second);
 assert.equal(await c.backend.markExternalBillingSettled(b.expected,a.snapshot),false);assert.equal((await ref(c,'billingOutbox',second).get()).get('state'),'pending');
 const result=await c.backend.quarantineExternalBillingOutbox(second,{phase:'after_ack',snapshotVersion:(await ref(c,'billingOutbox',second).get()).updateTime.seconds+':'+String((await ref(c,'billingOutbox',second).get()).updateTime.nanoseconds).padStart(9,'0'),expected:b.expected,ack:{reservationId:b.expected.reservationId,seconds:b.expected.seconds,state:'captured'},settlementSnapshot:a.snapshot});
 const incident=await c.root.collection('billingOutboxReviewIncidents').doc(result.incidentId).get();assert.equal(incident.get('settlementSnapshot'),null);assert.equal(incident.get('remoteAck.state'),'captured');
});
test('missing or throwing snapshots cannot settle',{timeout:30000},async()=>{
 const {c,id}=await settlementFixture(),{expected,snapshot}=await expectedAndSnapshot(c,id);
 assert.equal(await c.backend.markExternalBillingSettled(expected,undefined),false);
 const broken={...snapshot,get versions(){throw Error('synthetic getter');}};assert.equal(await c.backend.markExternalBillingSettled(expected,broken),false);
 assert.equal((await ref(c,'billingOutbox',id).get()).get('state'),'pending');
});
test('snapshot values are copied before asynchronous transaction work',{timeout:30000},async()=>{
 const {c,id}=await settlementFixture(),{expected,snapshot}=await expectedAndSnapshot(c,id),pending=c.backend.markExternalBillingSettled(expected,snapshot);
 snapshot.expected.reservationId=randomUUID();snapshot.versions.identity={exists:false};
 // Internal-only call; this test makes no assertion that Account processed a real capture.
 assert.equal(await pending,true);assert.equal((await ref(c,'billingOutbox',id).get()).get('state'),'settled');
});// LV-019.B doble ACK (docs/specs/LV-019-B-doble-ack-liquidacion.md): a second ACK for a row another drainer already settled is recognized only when
// the pre-POST history is intact; any other case keeps the conservative incident.
const ackFor=expected=>({reservationId:expected.reservationId,seconds:expected.seconds,state:expected.action==='capture'?'captured':'released'});
const versionOf=async(c,id)=>{const s=await ref(c,'billingOutbox',id).get();return s.updateTime.seconds+':'+String(s.updateTime.nanoseconds).padStart(9,'0');};
async function settledThenSecondAck(c,id,mutate,snapshotOverride){
 const {expected,snapshot}=await expectedAndSnapshot(c,id),version=await versionOf(c,id),job=await c.backend.job(c.account,id),intentId=sha(JSON.stringify([c.account,job.requestKey]));
 assert.equal(await c.backend.markExternalBillingSettled(expected,snapshot),true);
 const settledVersion=await versionOf(c,id);if(mutate)await mutate({c,expected,intentId,job});
 const result=await c.backend.quarantineExternalBillingOutbox(id,{phase:'after_ack',snapshotVersion:version,expected,ack:ackFor(expected),settlementSnapshot:snapshotOverride===undefined?snapshot:snapshotOverride});
 const incidents=await c.root.collection('billingOutboxReviewIncidents').get(),guard=await ref(c,'billingGuards',c.account).get(),intent=await ref(c,'billingIntents',intentId).get();
 return {result,incidents,guard,intent,outbox:await ref(c,'billingOutbox',id).get(),settledVersion,intentId,expected,snapshot};
}
test('a second ACK for a row already settled with intact history is the same settlement: no incident and the owner is not blocked',{timeout:30000},async()=>{
 const {c,id}=await settlementFixture(),r=await settledThenSecondAck(c,id);
 assert.deepEqual(r.result,{state:'already_settled',ownerBlocked:false});
 assert.equal(r.incidents.size,0);assert.notEqual(r.guard.get('blocked'),true);assert.equal(r.intent.get('state'),'job_created');
 assert.equal(r.outbox.get('state'),'settled');assert.equal(await versionOf(c,id),r.settledVersion);
 assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
});
const mutations={
 account:async({c})=>ref(c,'accounts',c.account).update({aiPilot:false}),
 // An unrelated field keeps the job witness valid, so only the version comparison can notice it; a new revision also invalidates the witness.
 job:async({c,expected})=>ref(c,'jobs',expected.jobId).update({reviewNote:'changed'}),
 jobRevision:async({c,expected})=>ref(c,'jobs',expected.jobId).update({revision:2}),
 terminal:async({c,expected})=>ref(c,'movements','terminal:'+expected.jobId).update({credits:3}),
 artifact:async({c,expected})=>ref(c,'artifacts',expected.jobId).update({revision:2}),
 classification:async({c,expected})=>ref(c,'jobAccounting',expected.jobId).update({mode:'simulation'}),
 simulatedReserve:async({c,expected})=>ref(c,'movements','reserve:'+expected.jobId).create({accountId:c.account,kind:'reserve',reference:expected.jobId,credits:2}),
 identity:async({c,expected})=>{const identity=ref(c,'identities',expected.identityKey);await identity.update({accountId:c.foreign});await identity.update({accountId:c.account});},
 request:async({c,intentId})=>ref(c,'requests',intentId).update({accountId:c.foreign}),
 intent:async({c,intentId})=>ref(c,'billingIntents',intentId).update({reviewNote:'changed'}),
 guard:async({c})=>ref(c,'billingGuards',c.account).set({accountId:c.account,blocked:false},{merge:true}),
 intentGuard:async({c,intentId})=>ref(c,'billingIntentAdmissionGuards',intentId).set({touched:true},{merge:true}),
 origin:async({c,intentId})=>ref(c,'billingIntentWitnesses',intentId).update({baseline:'changed'}),
 jobMarker:async({c,intentId})=>ref(c,'billingIntentJobMarkers',intentId).update({jobId:randomUUID()}),
 // Same content, new document: the witness stays valid, so only the version comparison can notice it.
 originReplaced:async({c,intentId})=>{const doc=ref(c,'billingIntentWitnesses',intentId),data=(await doc.get()).data();await doc.delete();await doc.create(data);},
 jobMarkerReplaced:async({c,intentId})=>{const doc=ref(c,'billingIntentJobMarkers',intentId),data=(await doc.get()).data();await doc.delete();await doc.create(data);},
 // T3 (DeepSeek): the settled row itself must be the same document that was read before the POST, not a recreated one with the same tuple.
 outboxRecreated:async({c,expected})=>{const doc=ref(c,'billingOutbox',expected.jobId),data=(await doc.get()).data();await doc.delete();await doc.create(data);},
};
for(const [field,mutate] of Object.entries(mutations))test(`a second ACK after ${field} changed since the POST keeps the incident`,{timeout:30000},async()=>{
 const {c,id}=await settlementFixture(),r=await settledThenSecondAck(c,id,mutate);
 assert.equal(r.result.state,'needs_review');assert.equal(r.incidents.size,1);assert.equal(r.incidents.docs[0].get('remoteAck.state'),'captured');assert.equal(r.outbox.get('state'),'settled');
});
test('a second ACK for a settled row with a different tuple, no snapshot, or a row not yet settled keeps the incident',{timeout:30000},async()=>{
 const one=await settlementFixture(),different=await settledThenSecondAck(one.c,one.id,async({c,expected})=>ref(c,'billingOutbox',expected.jobId).update({attemptId:randomUUID()}));
 assert.equal(different.result.state,'needs_review');assert.equal(different.incidents.size,1);
 const two=await settlementFixture(),missing=await settledThenSecondAck(two.c,two.id,undefined,null);
 assert.equal(missing.result.state,'needs_review');assert.equal(missing.incidents.size,1);
 const three=await settlementFixture(),{expected,snapshot}=await expectedAndSnapshot(three.c,three.id),version=await versionOf(three.c,three.id);
 const pending=await three.c.backend.quarantineExternalBillingOutbox(three.id,{phase:'after_ack',snapshotVersion:version,expected,ack:ackFor(expected),settlementSnapshot:snapshot});
 assert.equal(pending.state,'needs_review');assert.equal((await ref(three.c,'billingOutbox',three.id).get()).get('state'),'needs_review');
});
