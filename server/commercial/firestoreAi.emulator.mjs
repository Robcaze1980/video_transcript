import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';import {Readable} from 'node:stream';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {drainCloudAi} from './cloudAiDispatch.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {FirestoreFiles} from './firestoreFiles.ts';
import {firestoreHttp} from './firestoreHttp.ts';
import {processOnDemand} from './firestoreWorker.ts';
import {ObjectFault} from './gcsObjects.ts';
import {AI_TEXT_BUDGET,AI_CATALOG_VERSION} from './aiContracts.ts';
const sha=value=>createHash('sha256').update(value).digest('hex'),contexts=[];
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
afterEach(async()=>{for(const c of contexts.splice(0)){if(c.server){c.server.closeAllConnections();await new Promise(r=>c.server.close(r));}await c.db.recursiveDelete(c.root);await c.db.terminate();}});
async function fixture(){
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:true}),root=db.collection('vistavo_ai_integration_test').doc(randomUUID()),backend=new FirestoreBackend(db,root),objects=new MemoryObjects();
 const ai=new FirestoreAi(db,root,backend,objects),files=new FirestoreFiles(db,root,objects,{chunkBytes:4},(account,input)=>ai.purgeInput(account,input));
 const uid='fixture-ai-owner-'+randomUUID(),foreignUid='fixture-ai-foreign-'+randomUUID(),account=await backend.accountForUid(uid),foreign=await backend.accountForUid(foreignUid);
 const c={db,root,backend,objects,ai,files,uid,foreignUid,account,foreign};contexts.push(c);
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
async function received(c,jobId,attemptId,operation='translation:en'){
 const callKey=operation==='translation:en'?'text-window:0000':'voice-chunk:0000',model=operation==='translation:en'?'gemini-3.8-flash':'gemini-3.8-flash-tts';
 await ref(c,'providerCalls',jobId+'-'+callKey.replace(':','-')).create({jobId,accountId:c.account,attemptId,callKey,model,state:'received',requestSha256:'b'.repeat(64),responseSha256:'c'.repeat(64),responseId:'synthetic-emulator-receipt',httpStatus:200,startedAtMs:Date.now()-100,finishedAtMs:Date.now(),usage:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},fixtureOnly:true});
}
async function enqueue(c,key=randomUUID()){return c.ai.enqueue(c.account,c.input,'translation:en',1,key);}
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
async function server(c){let nudges=0;c.server=createServer(firestoreHttp({backend:c.backend,files:c.files,ai:c.ai,origin:'http://127.0.0.1',identity:{verifyIdToken:async(token,checkRevoked)=>{assert.equal(checkRevoked,true);if(token==='owner')return {uid:c.uid,email_verified:true};if(token==='foreign')return {uid:c.foreignUid,email_verified:true};throw Error('synthetic revoked/invalid token');}},nudgeAi:async()=>{nudges++;await new Promise(()=>{});}}));await new Promise(r=>c.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+c.server.address().port;
 return {nudges:()=>nudges,call:async(path,method='GET',body,token='owner',headers={})=>fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)})};
}

test('unexpected reservation failure logs only bounded type and numeric SDK code while client sees internal',async()=>{
 const c=await fixture(),s=await server(c),sentinel='SYNTHETIC_SECRET_MUST_NEVER_APPEAR',originalReserve=c.backend.reserve,originalError=console.error,logs=[];
 c.backend.reserve=async()=>{const error=new Error(sentinel);error.code=10;error.stack=sentinel+' STACK';error.authorization=sentinel;throw error;};
 console.error=(...args)=>logs.push(args);
 try{
  const response=await s.call('/api/cloud/ai/jobs','POST',{inputId:c.input,operation:'narration:en:female',expectedRevision:1,requestKey:'sanitized-observability'});
  assert.equal(response.status,500);assert.deepEqual(await response.json(),{error:'internal'});
  assert.equal((await s.call('/api/cloud/me','GET',undefined,null)).status,401);
  assert.equal((await s.call('/api/cloud/not-found')).status,404);
  assert.equal(logs.length,1);assert.equal(logs[0].length,1);const log=JSON.parse(logs[0][0]);assert.deepEqual({event:log.event,type:log.type,code:log.code},{event:'cloud-http-internal',type:'Error',code:10});assert.match(log.traceId,/^[a-f0-9-]{36}$/);assert.equal(log.status,500);assert.ok(Number.isFinite(log.durationMs)&&log.durationMs>=0);assert.ok(log.stages&&typeof log.stages==='object');assert.ok(log.attempts&&typeof log.attempts==='object');assert.equal(JSON.stringify(logs).includes(sentinel),false);
  assert.equal((await c.root.collection('jobs').get()).size,0);assert.equal((await c.root.collection('providerCalls').get()).size,0);assert.equal((await c.backend.readBalance(c.account)).reserved,0);
 }finally{console.error=originalError;c.backend.reserve=originalReserve;}
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
 await assert.rejects(c.ai.download(c.account,id,'translation-en.txt'),e=>e.code==='not_found');c.objects.failBarrier=true;await assert.rejects(c.ai.purgeResult(id),e=>e.code==='remote');assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),AI_TEXT_BUDGET);
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
 await assert.rejects(c.ai.download(c.account,id,'translation-en.txt'),e=>e.code==='not_found');assert.equal(await c.backend.finish(c.account,id,attempt.attemptId,true),false);assert.equal(await c.backend.reconcile(c.account,id,'failed','synthetic-no-provider-retry-after-delete'),true);assert.equal((await c.backend.readBalance(c.account)).available,100);
});

test('TTL of ready AI results immediately denies downloads and maintenance purges every key without reversing captured money',async()=>{
 const c=await fixture(),id=await enqueue(c),{entries}=await publish(c,id);
 assert.equal((await c.ai.download(c.account,id,'translation-en.txt')).entry.sha256,entries.find(e=>e.name==='translation-en.txt').sha256);
 const captured=await c.backend.readBalance(c.account);assert.equal(captured.consumed,2);assert.equal(captured.reserved,0);
 const upload=(await ref(c,'uploads',c.input).get()).data(),artifact=(await ref(c,'artifacts',id).get()).data(),expired=Date.now()-1000;
 const keys=[...upload.plan.chunks,...upload.plan.groups,upload.plan.final,...artifact.plan.artifacts.map(a=>a.key)];
 await ref(c,'inputs',c.input).update({expiresAtMs:expired});await ref(c,'uploads',c.input).update({expiresAtMs:expired});await ref(c,'artifacts',id).update({expiresAtMs:expired});
 await assert.rejects(c.ai.download(c.account,id,'translation-en.txt'),e=>e.code==='not_found');
 const status=await c.ai.status(c.account,id);assert.equal(status.state,'succeeded');assert.deepEqual(status.results,[]);
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
  for(const [key,model]of [['text-window:0000','gemini-3.8-flash-tts'],['voice-chunk:0000','gemini-3.8-flash'],['text-window:0001','gemini-3.8-flash']]){
   await assert.rejects(c.ai.invoke(c.account,id,attempt.attemptId,'synthetic-not-a-key')(key,model,{contents:[]},new AbortController().signal),e=>e.code==='invalid');
   assert.equal((await c.root.collection('providerCalls').get()).size,0);assert.equal(providerRequests,0);
  }
 }finally{globalThis.fetch=original;}
});

test('actual cloud worker voice path fences one mocked paid request, stores private WAV and captures once',async()=>{
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

for(const lostAck of ['stage','finish'])test('actual cloud worker recovers lost '+lostAck+' ACK without repeating provider, object write or capture',async()=>{
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

test('actual cloud worker records ambiguous mocked provider rejection as UNKNOWN and never repeats that request',async()=>{
 const c=await fixture(),id=await c.ai.enqueue(c.account,c.input,'narration:en:male',1,'worker-provider-rejected'),{processCloudAi}=await import('./cloudAiWorker.ts');
 const original=globalThis.fetch;let providerRequests=0;globalThis.fetch=async(input,init)=>{
  if(String(input).startsWith('https://generativelanguage.googleapis.com/')){providerRequests++;return new Response(JSON.stringify({error:{message:'synthetic-rejection'}}),{status:503,headers:{'Content-Type':'application/json'}});}return original(input,init);
 };
 try{assert.equal(await processCloudAi(c.ai,c.account,id,'synthetic-not-a-key'),'unknown');assert.equal(providerRequests,1);assert.equal(await processCloudAi(c.ai,c.account,id,'synthetic-not-a-key'),'not_claimed');assert.equal(providerRequests,1);}finally{globalThis.fetch=original;}
 const call=(await ref(c,'providerCalls',id+'-voice-chunk-0000').get()).data();assert.equal(call.state,'ambiguous');assert.equal(call.httpStatus,503);assert.equal((await c.backend.readBalance(c.account)).reserved,1);assert.equal((await ref(c,'artifacts',id).get()).get('state'),'purging');
 await assert.rejects(c.ai.download(c.account,id,'narration-en.wav'),e=>e.code==='not_found');assert.equal((await ref(c,'movements','terminal:'+id).get()).exists,false);
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
