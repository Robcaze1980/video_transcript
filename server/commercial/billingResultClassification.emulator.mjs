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
test('a missing external billing field cannot expose pending results or affect another captured job',{timeout:30000},async()=>{
 const c=await fixture(),calls=[];let pendingReservation='';
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname,id=request.data.reservationId??path.split('/').at(-2);calls.push(path);
  if(path.endsWith('/capture')&&id===pendingReservation)throw Object.assign(Error('synthetic unsettled capture'),{response:{status:503}});
  return {data:{state:path.endsWith('/capture')?'captured':'reserved',reservationId:id,seconds:request.data.seconds??2}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const keyA=randomUUID(),keyB=randomUUID(),first=await ai.enqueue(c.account,c.input,'translation:en',1,keyA,c.uid),second=await ai.enqueue(c.account,c.input,'translation:en',1,keyB,c.uid);
 pendingReservation=(await c.backend.job(c.account,first)).externalBilling.reservationId;
 await publish(c,first);await publish(c,second);
 const drain=await ai.drainExternalBilling();assert.equal(drain.settled,1);assert.equal(drain.failed,1);
 assert.equal((await ai.status(c.account,first,c.uid)).billingState,'pending');assert.deepEqual((await ai.status(c.account,first,c.uid)).results,[]);
 await assert.rejects(()=>ai.download(c.account,first,'translation-en.txt',c.uid),error=>error.code==='not_found');
 assert.equal((await ai.status(c.account,second,c.uid)).billingState,'settled');assert.equal((await ai.status(c.account,second,c.uid)).results.length,5);
 await ref(c,'jobs',first).update({externalBilling:FieldValue.delete()});
 const invalid=await ai.status(c.account,first,c.uid),other=await ai.status(c.account,second,c.uid);
 const leaked=await ai.download(c.account,first,'translation-en.txt',c.uid).then(()=>true,error=>{if(error.code==='not_found')return false;throw error;});
 console.log(JSON.stringify({event:'synthetic-missing-billing-results',invalidBilling:invalid.billingState,invalidResults:invalid.results.length,leaked,otherBilling:other.billingState,otherResults:other.results.length}));
 assert.equal(invalid.billingState,'review');assert.deepEqual(invalid.results,[]);assert.equal(leaked,false);
 assert.equal(other.billingState,'settled');assert.equal(other.results.length,5);assert.equal((await ai.download(c.account,second,'translation-en.txt',c.uid)).entry.name,'translation-en.txt');
 await assert.rejects(()=>ai.download(c.foreign,second,'translation-en.txt',c.foreignUid),error=>error.code==='not_found');
});
test('a missing external billing field cannot make a paid job invoke without Account admission',{timeout:30000},async()=>{
 const c=await fixture(),accountCalls=[],billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;accountCalls.push(path);return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:request.data.seconds}};
 }}),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing);
 const external=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid),simulated=await c.ai.enqueue(c.account,c.input,'translation:en',1,randomUUID());
 const simAttempt=await c.backend.claim(c.account,simulated);assert.ok(simAttempt,'a genuinely simulated job remains claimable');
 await ref(c,'jobs',external).update({externalBilling:FieldValue.delete()});
 const claimed=await c.backend.claim(c.account,external).then(value=>({value}),error=>({error})),attempt=claimed.value;let providerCalls=0,invokeResult;
 if(attempt){
  const job=await c.backend.job(c.account,external);
  if(job.invocationPhase==='local_check')await c.backend.resumeTextAfterLocalCheck(c.account,external,attempt.attemptId,job.inputStorage,'nonzero');
  await c.backend.beginInvocation(c.account,external,attempt.attemptId);
  const original=globalThis.fetch;globalThis.fetch=async()=>{providerCalls++;throw Error('synthetic provider blocked by test');};
  try{invokeResult=await ai.invoke(c.account,external,attempt.attemptId,'synthetic-key')('text-window:0000','gemini-3.8-flash',{},new AbortController().signal).then(()=>({}),error=>({code:error.code}));}finally{globalThis.fetch=original;}
 }
 console.log(JSON.stringify({event:'synthetic-missing-billing-processing',externalClaimed:!!attempt,claimError:claimed.error?.code,providerCalls,accountAdmissions:accountCalls.filter(path=>path.endsWith('/admit')).length,invokeResult}));
 assert.ok(attempt===null||claimed.error?.code==='conflict','a job whose accounting class is uncertain must not start');assert.equal((await c.backend.job(c.account,external)).state,'queued');assert.equal(providerCalls,0);
});
test('a genuine simulated job with its simulated capture remains downloadable',{timeout:30000},async()=>{
 const c=await fixture(),id=await c.ai.enqueue(c.account,c.input,'translation:en',1,randomUUID());await publish(c,id);
 const status=await c.ai.status(c.account,id,c.uid);assert.equal(status.billingState,'simulated');assert.equal(status.results.length,5);assert.equal((await c.ai.download(c.account,id,'translation-en.txt',c.uid)).entry.name,'translation-en.txt');
});
