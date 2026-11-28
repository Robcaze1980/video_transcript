import assert from 'node:assert/strict';
import {prepareFinancialOwnedRoot,deleteFinancialOwnedRoot} from './financialOwnedRootGuard.mjs';
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
before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8198','No native cloud fallback');assert.equal((await fetch('http://127.0.0.1:8198/')).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){try{assert.match(c.root.path,/^vistavo_ai_integration_test\/[a-f0-9-]{36}$/);if(c.server){c.server.closeAllConnections();await new Promise(r=>c.server.close(r));}await deleteFinancialOwnedRoot(c.db,c.root,c.marker);assert.equal((await c.root.listCollections()).length,0);console.log(JSON.stringify({event:'synthetic-result-cleanup',project:'demo-vistavo-financial',allAbsent:true}));}finally{await c.db.terminate();await deleteApp(c.app);}}});
async function fixture(){
 const app=initializeApp({projectId:'demo-vistavo-financial'},'lv-ai-test-'+randomUUID()),db=getFirestore(app),root=db.collection('vistavo_ai_integration_test').doc(randomUUID()),backend=new FirestoreBackend(db,root),objects=new MemoryObjects();
 const ai=new FirestoreAi(db,root,backend,objects),files=new FirestoreFiles(db,root,objects,{chunkBytes:4},(account,input)=>ai.purgeInput(account,input));
 const c={app,db,root,backend,objects,ai,files,marker:{project:'demo-vistavo-financial',purpose:'settlement-history-synthetic',nonce:randomUUID()}};contexts.push(c);
 await prepareFinancialOwnedRoot(db,root,c.marker);
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

before(()=>{
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8198');
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE','K_JOB','FUNCTION_TARGET','GAE_ENV'])assert.ok(!process.env[name]);
 for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])assert.ok(!process.env[name]||process.env[name]==='demo-vistavo-financial');
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
for(const field of ['account','outbox','job','terminal','artifact','classification','simulatedReserve','request','origin','jobMarker','restoreIdentity','replaceIdentity'])test(`changed ${field} after capture send is retained for review`,{timeout:30000},async()=>{
 const {c,ai,id,entered,releaseCapture,enablePause}=await settlementFixture(),job=await c.backend.job(c.account,id),intentId=sha(JSON.stringify([c.account,job.requestKey]));
 const identity=ref(c,'identities',job.externalBilling.identityKey),originalIdentity=(await identity.get()).data();
 enablePause();const draining=ai.drainExternalBilling();await entered;
 if(field==='account')await ref(c,'accounts',c.account).update({aiPilot:false});
 if(field==='outbox')await ref(c,'billingOutbox',id).update({nextAttemptAt:Date.now()+120000});
 if(field==='job')await ref(c,'jobs',id).update({revision:2});
 if(field==='terminal')await ref(c,'movements','terminal:'+id).update({credits:3});
 if(field==='artifact')await ref(c,'artifacts',id).update({revision:2});
 if(field==='classification')await ref(c,'jobAccounting',id).update({mode:'simulation'});
 if(field==='simulatedReserve')await ref(c,'movements','reserve:'+id).create({accountId:c.account,kind:'reserve',reference:id,credits:2});
 if(field==='request')await ref(c,'requests',intentId).update({accountId:c.foreign});
 if(field==='origin')await ref(c,'billingIntentWitnesses',intentId).update({baseline:'changed'});
 if(field==='jobMarker')await ref(c,'billingIntentJobMarkers',intentId).update({jobId:randomUUID()});
 if(field==='restoreIdentity'){await identity.update({accountId:c.foreign});await identity.update({accountId:c.account});}
 if(field==='replaceIdentity'){await identity.delete();await identity.create(originalIdentity);}
 releaseCapture();const result=await draining,outbox=await ref(c,'billingOutbox',id).get(),incidents=await c.root.collection('billingOutboxReviewIncidents').get();
 const captured=incidents.docs.find(d=>d.get('remoteAck.state')==='captured'),foreign=await ref(c,'billingGuards',c.foreign).get();
 console.log(JSON.stringify({event:'synthetic-settlement-history-race',field,state:outbox.get('state'),result,captured:!!captured,attribution:captured?.get('attribution'),foreignBlocked:foreign.get('blocked')===true}));
 assert.equal(result.settled,0);assert.notEqual(outbox.get('state'),'settled');assert.notEqual(foreign.get('blocked'),true);
 if(field==='outbox'){
  // Step 1.4a (Codex): a benign write to the outbox row ITSELF (same tuple, every other document intact) is a TRANSIENT local failure, not a demonstrated
  // divergence (design 3.1): the row is rescheduled with no incident and no owner block, and the next pass re-sends the idempotent capture.
  assert.equal(outbox.get('state'),'retry_wait');assert.equal(incidents.size,0);assert.notEqual((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
 }else assert.ok(captured);
});
test('a timeout after send is not reported as a confirmed Account ACK',{timeout:30000},async()=>{
 const c=await fixture(),calls=[];const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);if(path.endsWith('/capture'))throw Object.assign(Error('synthetic timeout'),{response:{status:503}});
  return {data:{state:'reserved',reservationId:request.data.reservationId??path.split('/').at(-2),seconds:request.data.seconds??2}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),id=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await publish(c,id);
 const result=await ai.drainExternalBilling(),outbox=await ref(c,'billingOutbox',id).get(),incidents=await c.root.collection('billingOutboxReviewIncidents').get();
 assert.equal(result.settled,0);assert.equal(result.failed,1);assert.equal(calls.filter(x=>x.endsWith('/capture')).length,1);assert.notEqual(outbox.get('state'),'settled');assert.equal(incidents.docs.some(d=>d.get('remoteAck')),false);
});
// LV-019.B doble ACK: with the pre-POST history intact the duplicate is the same settlement (docs/specs/LV-019-B-doble-ack-liquidacion.md);
// the snapshot-binding fixture covers every case where it must still be an incident.
test('two concurrent synthetic ACKs settle once and the duplicate is recognized without an incident or a block',{timeout:30000},async()=>{
 const c=await fixture();let calls=0,enter,release;const entered=new Promise(r=>enter=r),resume=new Promise(r=>release=r);
 const billing=new AccountBillingClient(undefined,{request:async request=>{const path=new URL(request.url).pathname;
  if(path.endsWith('/capture')){calls++;if(calls===2)enter();await resume;return {data:{state:'captured',reservationId:path.split('/').at(-2),seconds:2}};}
  return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:2}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),id=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);await publish(c,id);
 const first=ai.drainExternalBilling(),second=ai.drainExternalBilling();await entered;release();const outcomes=await Promise.all([first,second]);
 const outbox=await ref(c,'billingOutbox',id).get(),incidents=await c.root.collection('billingOutboxReviewIncidents').get();
 console.log(JSON.stringify({event:'synthetic-settlement-two-acks',calls,outcomes,state:outbox.get('state'),incidents:incidents.size}));
 const guard=await ref(c,'billingGuards',c.account).get(),job=await c.backend.job(c.account,id),intent=await ref(c,'billingIntents',sha(JSON.stringify([c.account,job.requestKey]))).get();
 assert.equal(calls,2);assert.equal(outcomes.reduce((n,x)=>n+x.settled,0),1);assert.equal(outcomes.reduce((n,x)=>n+x.failed,0),0);assert.equal(outbox.get('state'),'settled');
 assert.equal(incidents.size,0);assert.notEqual(guard.get('blocked'),true);assert.equal(intent.get('state'),'job_created');
});
