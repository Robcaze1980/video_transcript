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
const fakeAccount=()=>new AccountBillingClient(undefined,{request:async request=>({data:{state:'reserved',reservationId:request.data.reservationId,seconds:request.data.seconds}})});
test('corruption after claim stops before Account admission and provider',{timeout:30000},async()=>{
 const c=await fixture(),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,fakeAccount()),id=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid),attempt=await c.backend.claim(c.account,id);assert.ok(attempt);
 const job=await c.backend.job(c.account,id);assert.equal(await c.backend.resumeTextAfterLocalCheck(c.account,id,attempt.attemptId,job.inputStorage,'nonzero'),true);assert.equal(await c.backend.beginInvocation(c.account,id,attempt.attemptId),true);
 await ref(c,'jobs',id).update({externalBilling:FieldValue.delete()});let providerCalls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{providerCalls++;throw Error('no provider');};
 try{await assert.rejects(()=>ai.invoke(c.account,id,attempt.attemptId,'synthetic-key')('text-window:0000','gemini-3.8-flash',{},new AbortController().signal),error=>error.code==='conflict');}finally{globalThis.fetch=original;}
 assert.equal(providerCalls,0);assert.equal((await c.root.collection('providerCalls').get()).size,0);assert.equal((await c.backend.job(c.account,id)).state,'running');
});
for(const change of ['missing-classification','corrupt-reserve','foreign-outbox']){
 test('synthetic simulation fails closed for '+change,async()=>{
  const c=await fixture(),id=await c.ai.enqueue(c.account,c.input,'translation:en',1,randomUUID()),marker=ref(c,'jobAccounting',id),reserve=ref(c,'movements','reserve:'+id),outbox=ref(c,'billingOutbox',id),before=await c.backend.readBalance(c.account);
  assert.equal((await marker.get()).get('mode'),'simulation');
  if(change==='missing-classification')await marker.delete();
  if(change==='corrupt-reserve')await reserve.update({credits:3});
  if(change==='foreign-outbox')await outbox.create({synthetic:true});
  const result=await c.backend.claim(c.account,id).then(value=>({value}),error=>({error})),status=await c.ai.status(c.account,id,c.uid);
  assert.ok(result.value===null||result.error?.code==='conflict');assert.equal((await c.backend.job(c.account,id)).state,'queued');assert.equal(status.billingState,'review');assert.deepEqual(status.results,[]);assert.deepEqual(await c.backend.readBalance(c.account),before);
 });
}
test('losing external billing and AI profile cannot pass generic dispatch',async()=>{
 const c=await fixture(),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,fakeAccount()),id=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);
 await ref(c,'jobs',id).update({externalBilling:FieldValue.delete(),aiProfile:FieldValue.delete()});await ref(c,'outbox',id).update({aiProfile:FieldValue.delete()});
 assert.equal(await c.backend.claimDispatch(id),null);const claim=await c.backend.claim(c.account,id).then(value=>({value}),error=>({error}));assert.ok(claim.value===null||claim.error?.code==='conflict');
 assert.equal((await c.backend.job(c.account,id)).state,'queued');
});
test('corrupted external cancellation cannot release a different simulated reservation',async()=>{
 const c=await fixture(),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,fakeAccount()),external=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid),simulated=await c.ai.enqueue(c.account,c.input,'translation:en',1,randomUUID()),before=await c.backend.readBalance(c.account);
 assert.equal(before.reserved,2);await ref(c,'jobs',external).update({externalBilling:FieldValue.delete()});
 await assert.rejects(()=>c.backend.cancel(c.account,external),error=>error.code==='conflict');
 assert.deepEqual(await c.backend.readBalance(c.account),before);assert.equal((await c.backend.job(c.account,external)).state,'queued');assert.equal((await c.backend.job(c.account,simulated)).state,'queued');
 assert.equal((await ref(c,'billingOutbox',external).get()).exists,false);assert.equal((await ref(c,'movements','terminal:'+external).get()).exists,false);
});
test('corruption after claim cannot settle an external job as simulated',async()=>{
 const c=await fixture(),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,fakeAccount()),external=await ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid),simulated=await c.ai.enqueue(c.account,c.input,'translation:en',1,randomUUID()),attempt=await c.backend.claim(c.account,external),before=await c.backend.readBalance(c.account);assert.ok(attempt);
 await ref(c,'jobs',external).update({externalBilling:FieldValue.delete()});
 await assert.rejects(()=>c.backend.finish(c.account,external,attempt.attemptId,false),error=>error.code==='conflict');
 assert.deepEqual(await c.backend.readBalance(c.account),before);assert.equal((await c.backend.job(c.account,external)).state,'running');assert.equal((await c.backend.job(c.account,simulated)).state,'queued');
 assert.equal((await ref(c,'billingOutbox',external).get()).exists,false);assert.equal((await ref(c,'movements','terminal:'+external).get()).exists,false);
});
for(const phase of ['before-commit','after-commit']){
 test('job and classification remain atomic on '+phase,async()=>{
  const c=await fixture(),key=randomUUID(),original=c.db.runTransaction.bind(c.db),before=await c.backend.readBalance(c.account);
  try{
   c.db.runTransaction=phase==='before-commit'?async(callback,...args)=>original(async tx=>{await callback(tx);throw Error('synthetic before commit');},...args):async(callback,...args)=>{await original(callback,...args);throw Error('synthetic after commit');};
   await assert.rejects(()=>c.backend.reserve(c.account,c.input,key,2,'translation:en',1,AI_CATALOG_VERSION),/synthetic (before|after) commit/);
  }finally{c.db.runTransaction=original;}
  const jobs=await c.root.collection('jobs').get(),markers=await c.root.collection('jobAccounting').get(),movements=await c.root.collection('movements').where('kind','==','reserve').get();
  if(phase==='before-commit'){assert.equal(jobs.size,0);assert.equal(markers.size,0);assert.equal(movements.size,0);assert.deepEqual(await c.backend.readBalance(c.account),before);}
  else{assert.equal(jobs.size,1);assert.equal(markers.size,1);assert.equal(movements.size,1);assert.equal(markers.docs[0].id,jobs.docs[0].id);assert.equal(await c.backend.priorRequest(c.account,c.input,key,'translation:en',1,AI_CATALOG_VERSION),jobs.docs[0].id);}
 });
}
