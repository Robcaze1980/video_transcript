import assert from 'node:assert/strict';
import {test,before,after,afterEach} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {existsSync,realpathSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {FirestoreFiles} from './firestoreFiles.ts';
import {ObjectFault} from './gcsObjects.ts';
import {AccountBillingClient} from './accountBillingClient.ts';
const sha=value=>createHash('sha256').update(value).digest('hex'),contexts=[],expectedTests=12;
let verifiedCleanups=0;
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
function assertSafeEnvironment(){
 assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');assert.equal(process.env.LV_VOICE_CONTRACT,'1');
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,'demo-vistavo-ledger');assert.equal(process.env.GCLOUD_PROJECT,'demo-vistavo-ledger');
 for(const name of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY','VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID','VISTAVO_AI_ENABLED','VISTAVO_FILES_MODE','VISTAVO_LOCAL_CLOUD','VISTAVO_ACCOUNT_ID','VISTAVO_JOB_ID','VISTAVO_GEMINI_KEY','K_SERVICE','K_REVISION','K_CONFIGURATION','K_JOB','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.ok(!process.env[name],`Unexpected synthetic environment: ${name}`);
 const profile=process.env.APPDATA;assert.ok(profile&&profile===process.env.USERPROFILE&&profile===process.env.LOCALAPPDATA);
 const absolute=resolve(profile),base=resolve('outputs/lv019-b-voice-recovery-runs'),parts=relative(base,absolute).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(c){
 assertSafeEnvironment();assert.match(c.root.path,/^vistavo_voice_recovery_synthetic\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 assert.equal(c.db.projectId,'demo-vistavo-ledger');assert.equal(c.db.databaseId,'(default)');const s=c.db._settings;
 assert.equal(s?.projectId,'demo-vistavo-ledger');assert.equal(s?.servicePath,'127.0.0.1');assert.equal(s?.port,8185);assert.equal(s?.ssl,false);assert.equal(s?.preferRest,false);
 for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(s?.[key],undefined);
}
async function descendants(document,found=[]){for(const collection of await document.listCollections())for(const child of await collection.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{assertSafeEnvironment();assert.equal((await fetch('http://127.0.0.1:8185/',{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){globalThis.fetch=c.originalFetch;try{
 assertSafeClient(c);const marker=await c.root.get();
 if(!c.confirmed){assert.equal(marker.exists,false,'Unconfirmed root must not be deleted');assert.deepEqual(await c.root.listCollections(),[]);continue;}
 assert.equal(marker.exists,true);assert.equal(marker.get('marker'),c.marker);assert.equal(marker.get('purpose'),'voice-recovery-synthetic-v1');
 const known=await descendants(c.root);for(const document of known)assert.ok(document.path.startsWith(`${c.root.path}/`));
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await c.root.listCollections(),[]);
 for(const document of known){assert.equal((await document.get()).exists,false);assert.deepEqual(await document.listCollections(),[]);}
 verifiedCleanups++;console.log(`Synthetic voice cleanup verified ${verifiedCleanups}/${expectedTests}`);
 }finally{await c.db.terminate();}}});
after(()=>{console.log(`Synthetic voice cleanup total: ${verifiedCleanups}/${expectedTests}`);assert.equal(verifiedCleanups,expectedTests);});
async function fixture(){
 assertSafeEnvironment();
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:false}),root=db.collection('vistavo_voice_recovery_synthetic').doc(randomUUID()),backend=new FirestoreBackend(db,root),objects=new MemoryObjects(),marker=randomUUID();
 assert.equal(db.projectId,'demo-vistavo-ledger');assert.equal(db.databaseId,'(default)');assert.equal(db._settings?.servicePath,'127.0.0.1');assert.equal(db._settings?.port,8185);assert.equal(db._settings?.ssl,false);
 const ai=new FirestoreAi(db,root,backend,objects),files=new FirestoreFiles(db,root,objects,{chunkBytes:4},(account,input)=>ai.purgeInput(account,input));
 const c={db,root,backend,objects,ai,files,marker,confirmed:false,originalFetch:globalThis.fetch};contexts.push(c);
 assertSafeClient(c);
 // This guard covers fetch only; it is not an OS firewall for native modules.
 globalThis.fetch=async(request,init)=>{const raw=request instanceof Request?request.url:String(request),url=new URL(raw);if(url.hostname!=='127.0.0.1'||url.port!=='8185')throw Error('synthetic fixture blocks outbound fetch');return c.originalFetch(request,init);};
 assert.equal((await root.get()).exists,false);assert.deepEqual(await root.listCollections(),[]);await root.create({marker,purpose:'voice-recovery-synthetic-v1'});assert.equal((await root.get()).get('marker'),marker);c.confirmed=true;
 const uid='fixture-ai-owner-'+randomUUID(),foreignUid='fixture-ai-foreign-'+randomUUID(),account=await backend.accountForUid(uid),foreign=await backend.accountForUid(foreignUid);
 Object.assign(c,{uid,foreignUid,account,foreign});
 for(const who of [account,foreign])await ref(c,'accounts',who).update({aiPilot:true,simulationOnly:true});
 await backend.creditVerifiedPurchase(account,'fixture-'+randomUUID(),100,1,'synthetic-ai-integration','sandbox');
 const source=Buffer.from('abcdefghijkl'),u=await files.begin(account,'synthetic-emulator.mp4',source.length,sha(source),randomUUID());
 for(let at=0;at<source.length;at+=4)await files.append(account,u.id,at,source.subarray(at,at+4));await files.complete(account,u.id);
 await files.work(u.id,'validate',{inspect:async()=>({sha256:sha(source),video:{duration:2,width:320,height:180,audioTracks:1}})});await files.work(u.id,'cleanup');
 c.input=u.id;c.source=source;await backend.saveProject(account,u.id,0,'The water pump is twelve inches wide.');return c;
}
async function received(c,jobId,attemptId){
 const callKey='text-window:0000',model='gemini-3.8-flash';
 await ref(c,'providerCalls',jobId+'-'+callKey.replace(':','-')).create({jobId,accountId:c.account,attemptId,callKey,model,state:'received',requestSha256:'b'.repeat(64),responseSha256:'c'.repeat(64),responseId:'synthetic-emulator-receipt',httpStatus:200,startedAtMs:Date.now()-100,finishedAtMs:Date.now(),usage:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},fixtureOnly:true});
}
import { FirestoreReviewedTranslation } from './firestoreReviewedTranslation.ts';
import { VOICE_MODEL, VOICE_NARRATION_STYLE, narrationChunks } from './pipelineVoiceProvider.ts';
import { encodeTextBundle } from './pipelineTextCodec.ts';

// Planned negative tests. Every Account and provider response here is synthetic;
// no route is registered and no real balance, provider or customer file is used.
async function reviewedVoiceFixture(){
 const c=await fixture();await c.backend.saveProject(c.account,c.input,1,'');
 const textJob=await c.ai.enqueue(c.account,c.input,'translation:en',2,randomUUID(),c.uid),attempt=await c.backend.claim(c.account,textJob);assert.ok(attempt);
 const job=await c.backend.job(c.account,textJob);if(job.invocationPhase==='local_check')assert.equal(await c.backend.resumeTextAfterLocalCheck(c.account,textJob,attempt.attemptId,job.inputStorage,'nonzero'),true);
 assert.equal(await c.backend.beginInvocation(c.account,textJob,attempt.attemptId),true);await received(c,textJob,attempt.attemptId);
 const bundle=encodeTextBundle(textJob,2000,{detectedLanguage:'es',hasSpeech:true,cues:[{startMs:0,endMs:1800,es:'La bomba mide doce pulgadas.',en:'The pump is twelve inches wide.'}]});
 const files=new Map([['transcript-es.txt',bundle.es.txtBytes],['transcript-es.srt',bundle.es.srtBytes],['translation-en.txt',bundle.en.txtBytes],['translation-en.srt',bundle.en.srtBytes],['cues.json',Buffer.from(JSON.stringify({durationMs:bundle.durationMs,cues:bundle.cues}))]]);
 await c.ai.uploadResults(c.account,textJob,attempt.attemptId,files);assert.equal(await c.backend.finish(c.account,textJob,attempt.attemptId,true),true);
 const service=new FirestoreReviewedTranslation(c.db,c.root,c.backend,c.objects),principal={accountId:c.account,uid:c.uid};
 const source=await service.readSource(principal,c.input,textJob);assert.equal(source.status,'original');
 const edits=source.cues.map(cue=>({id:cue.id,en:cue.en}));
 assert.equal((await service.saveReview(principal,{inputId:c.input,jobId:textJob,expectedRevision:2,requestKey:randomUUID(),edits})).committedRevision,3);
 const reviews=await c.root.collection('reviewedTranslations').get(),receipts=await c.root.collection('reviewRequests').get();assert.equal(reviews.size,1);assert.equal(receipts.size,1);
 return {c,service,textJob,review:reviews.docs[0].ref,receipt:receipts.docs[0].ref,principal,revision:3};
}

// This is a deterministic in-memory Account double. Its map records a simulated
// remote effect independently of whether a response reached the caller; it is
// not the real Account implementation or evidence of a real financial effect.
function fakeRecoveryAccount(c){
 const calls=[],reservations=new Map(),admissions=new Map(),paused=new Map();
 const options={loseReserveAck:false,statusUnavailable:false,loseAdmitAck:false};
 const pause=(kind)=>{
  assert.equal(paused.has(kind),false);let enter,release;
  const entered=new Promise(resolve=>{enter=resolve;}),resume=new Promise(resolve=>{release=resolve;});
  paused.set(kind,{enter,resume});return {entered,release};
 };
 const reach=async kind=>{const gate=paused.get(kind);if(gate){paused.delete(kind);gate.enter();await gate.resume;}};
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname,data={...request.data};calls.push({path,data});
  if(path.endsWith('/reservations')){
   const existing=reservations.get(data.reservationId);
   if(existing&&(existing.identityKey!==data.identityKey||existing.seconds!==data.seconds))throw {response:{status:409}};
   if(!existing)reservations.set(data.reservationId,{identityKey:data.identityKey,seconds:data.seconds,state:'reserved'});
   await reach('reserve');if(options.loseReserveAck)throw Error('synthetic reservation response lost');
   return {data:{reservationId:data.reservationId,seconds:data.seconds,state:'reserved'}};
  }
  const reservationId=path.split('/').at(-2),reservation=reservations.get(reservationId);
  if(path.endsWith('/status')){
   if(options.statusUnavailable)throw Error('synthetic status unavailable');
   if(!reservation||reservation.identityKey!==data.identityKey)throw {response:{status:404}};
   return {data:{reservationId,seconds:reservation.seconds,state:reservation.state}};
  }
  if(path.endsWith('/admit')){
   if(!reservation||reservation.state!=='reserved'||reservation.identityKey!==data.identityKey||reservation.seconds!==data.seconds)throw {response:{status:409}};
   const key=[reservationId,data.jobId,data.attemptId,data.callKey].join(':'),before=admissions.get(key);
   if(before&&(before.model!==data.model||before.requestSha256!==data.requestSha256))throw {response:{status:409}};
   if(!before)admissions.set(key,{...data,reservationId});
   await reach('admit');if(options.loseAdmitAck)throw Error('synthetic admission response lost');
   return {data:{...data,reservationId,created:!before,receiptOnly:!!before}};
  }
  // Deliberately no fake release or seal: a test cannot accidentally claim a
  // refund merely because an unimplemented fake endpoint was called.
  throw Error('unexpected synthetic Account operation');
 }});
 return {ai:new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),calls,reservations,admissions,options,pause};
}
const countCalls=(account,suffix)=>account.calls.filter(call=>call.path.endsWith(suffix)).length;
const voiceCount=async c=>(await c.root.collection('jobs').get()).docs.filter(doc=>String(doc.get('operation')).startsWith('narration:')).length;
const voiceBody=(text,voice)=>({contents:[{parts:[{text,speech_metadata:{style:VOICE_NARRATION_STYLE}}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{voice}}}});
const observed=promise=>promise.then(value=>({value}),error=>({error}));
const sourceBinding=({c,service,textJob,principal,revision})=>c.db.runTransaction(tx=>service.voiceBindingInTransaction(tx,principal,c.input,textJob,revision));
async function waitReached(entered,pending){let timer;try{await Promise.race([entered,pending.then(()=>{throw Error('operation ended before synthetic barrier');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('synthetic barrier timed out')),10000);})]);}finally{clearTimeout(timer);}}
async function startVoice(f,account,requestKey=randomUUID(),operation='narration:en:male'){
 const job=await account.ai.enqueue(f.c.account,f.c.input,operation,f.revision,requestKey,f.c.uid);
 return {job,requestKey};
}
async function invokingVoice(f,account,requestKey=randomUUID(),operation='narration:en:male'){
 const result=await startVoice(f,account,requestKey,operation),attempt=await f.c.backend.claim(f.c.account,result.job);assert.ok(attempt);
 assert.equal(await f.c.backend.beginInvocation(f.c.account,result.job,attempt.attemptId),true);
 return {...result,attemptId:attempt.attemptId};
}
function stubProvider(c,{loseResponse=false}={}){
 const prior=globalThis.fetch,calls=[];
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  assert.equal(url.origin,'https://generativelanguage.googleapis.com');assert.equal(init?.method,'POST');assert.equal(typeof init?.body,'string');
  calls.push({body:init.body});if(loseResponse)throw Error('synthetic provider response lost');
  return new Response(JSON.stringify({usageMetadata:{totalTokenCount:1},candidates:[]}));
 };
 return {calls,restore:()=>{globalThis.fetch=prior;}};
}

test('an identical reviewed voice retry reuses its job and synthetic reservation',{timeout:60000},async()=>{
 const f=await reviewedVoiceFixture(),account=fakeRecoveryAccount(f.c),key=randomUUID();
 const first=await startVoice(f,account,key),second=await startVoice(f,account,key);
 assert.equal(first.job,second.job);assert.equal(countCalls(account,'/reservations'),1);assert.equal(account.reservations.size,1);
});

test('a retry cannot accept a job after its reviewed receipt is removed',{timeout:60000},async()=>{
 const f=await reviewedVoiceFixture(),account=fakeRecoveryAccount(f.c),key=randomUUID(),first=await startVoice(f,account,key);
 await f.receipt.delete();const retry=await observed(startVoice(f,account,key));
 assert.ok(retry.error);assert.equal(await voiceCount(f.c),1);assert.equal(countCalls(account,'/reservations'),1);
 assert.equal((await account.ai.status(f.c.account,first.job,f.c.uid)).id,first.job);
});

test('review binding rejects nested values and returns only frozen scalar records',{timeout:60000},async()=>{
 const f=await reviewedVoiceFixture(),first=await sourceBinding(f),reviewBefore=(await f.review.get()).data(),receiptBefore=(await f.receipt.get()).data();
 for(const row of [first.canonicalEvidence.review,first.canonicalEvidence.receipt]){
  assert.equal(Object.isFrozen(row),true);for(const value of Object.values(row))assert.ok(['string','number'].includes(typeof value));
 }
 for(const [document,field,value,restore] of [[f.review,'payload',{nested:['synthetic']},reviewBefore],
  [f.review,'createdAtMs',[1],reviewBefore],[f.review,'bindingHash',{x:1},reviewBefore],
  [f.receipt,'baseHash',['synthetic'],receiptBefore],[f.receipt,'committedRevision',{x:1},receiptBefore]]){
  await document.update({[field]:value});assert.ok((await observed(sourceBinding(f))).error);await document.set(restore);
 }
 assert.equal((await sourceBinding(f)).reviewId,first.reviewId);
});

test('a coherent synthetic base-hash rewrite exposes the provenance limit',{timeout:60000},async()=>{
 const f=await reviewedVoiceFixture(),before=await sourceBinding(f),replacement='f'.repeat(64);
 assert.notEqual(before.canonicalEvidence.review.baseHash,replacement);
 await f.review.update({baseHash:replacement});await f.receipt.update({baseHash:replacement});
 // Observational control: acceptance does NOT validate a historical base or
 // authorize voice. Both rows are controlled synthetic privileged writes.
 const after=await sourceBinding(f);assert.equal(after.canonicalEvidence.review.baseHash,replacement);
 assert.equal(after.canonicalEvidence.receipt.baseHash,replacement);
});

test('a review changed and restored during reservation cannot create a voice job',{timeout:60000},async()=>{
 const f=await reviewedVoiceFixture(),account=fakeRecoveryAccount(f.c),gate=account.pause('reserve'),key=randomUUID(),before=await voiceCount(f.c);
 const pending=observed(startVoice(f,account,key));
 try{
  await waitReached(gate.entered,pending);const original=(await f.review.get()).data();
  await f.review.update({bindingHash:'e'.repeat(64)});await f.review.set(original);gate.release();
  const result=await pending;assert.ok(result.error);assert.equal(await voiceCount(f.c),before);
  assert.equal(account.reservations.size,1);assert.equal(countCalls(account,'/reservations'),1);assert.equal(countCalls(account,'/release'),0);
 }finally{gate.release();}
});

test('identity reassignment during reservation cannot create a voice job or fence another account',{timeout:60000},async()=>{
 const f=await reviewedVoiceFixture(),account=fakeRecoveryAccount(f.c),gate=account.pause('reserve'),key=randomUUID(),before=await voiceCount(f.c);
 const identity=ref(f.c,'identities',sha(JSON.stringify(['firebase',f.c.uid]))),foreignGuard=ref(f.c,'billingGuards',f.c.foreign),foreignBefore=(await foreignGuard.get()).data();
 const pending=observed(startVoice(f,account,key));
 try{
  await waitReached(gate.entered,pending);await identity.update({accountId:f.c.foreign});gate.release();const result=await pending;
  assert.ok(result.error);assert.equal(await voiceCount(f.c),before);assert.equal(account.reservations.size,1);
  assert.deepEqual((await foreignGuard.get()).data(),foreignBefore);assert.equal(countCalls(account,'/release'),0);
 }finally{gate.release();}
});

test('a lost reservation response cannot be recovered into voice after the receipt is removed',{timeout:60000},async()=>{
 const f=await reviewedVoiceFixture(),account=fakeRecoveryAccount(f.c),key=randomUUID(),before=await voiceCount(f.c);
 account.options.loseReserveAck=true;account.options.statusUnavailable=true;
 const first=await observed(startVoice(f,account,key));assert.ok(first.error);assert.equal(account.reservations.size,1);
 const intent=ref(f.c,'billingIntents',sha(JSON.stringify([f.c.account,key])));assert.equal((await intent.get()).exists,true);
 await f.receipt.delete();account.options.loseReserveAck=false;account.options.statusUnavailable=false;
 // Only synthetic time/backoff is accelerated; this does not create an ACK.
 await intent.update({nextAttemptAt:0});const drained=await account.ai.drainExternalBilling(10);
 assert.equal(await voiceCount(f.c),before);assert.equal(countCalls(account,'/reservations'),1);
 assert.equal(countCalls(account,'/release'),0);assert.equal(drained.intentsRecovered,0);
});

test('a review changed and restored during admission cannot send the provider request',{timeout:60000},async()=>{
 const f=await reviewedVoiceFixture(),account=fakeRecoveryAccount(f.c),voice=await invokingVoice(f,account),gate=account.pause('admit');
 const provider=stubProvider(f.c),draft=(await f.c.backend.readProject(f.c.account,f.c.input)).draft;
 const pending=observed(account.ai.invoke(f.c.account,voice.job,voice.attemptId,'synthetic')('voice-chunk:0000',VOICE_MODEL,voiceBody(narrationChunks(draft)[0],'Charon'),new AbortController().signal));
 try{
  await waitReached(gate.entered,pending);const original=(await f.review.get()).data();
  await f.review.update({bindingHash:'e'.repeat(64)});await f.review.set(original);gate.release();
  assert.ok((await pending).error);assert.equal(account.admissions.size,1);assert.equal(provider.calls.length,0);
 }finally{gate.release();provider.restore();}
});

test('removing the receipt between voice fragments blocks the next admission and provider call',{timeout:60000},async()=>{
 const f=await reviewedVoiceFixture(),source=await f.service.readSource(f.principal,f.c.input,f.textJob),long='pump '.repeat(80).trim();
 await f.service.saveReview(f.principal,{inputId:f.c.input,jobId:f.textJob,expectedRevision:f.revision,requestKey:randomUUID(),edits:source.cues.map(cue=>({id:cue.id,en:long}))});
 f.revision++;const newest=(await f.c.root.collection('reviewedTranslations').get()).docs.find(doc=>doc.get('revision')===f.revision);assert.ok(newest);
 f.receipt=ref(f.c,'reviewRequests',newest.get('receiptId'));
 const account=fakeRecoveryAccount(f.c),voice=await invokingVoice(f,account),provider=stubProvider(f.c),draft=(await f.c.backend.readProject(f.c.account,f.c.input)).draft;
 const chunks=narrationChunks(draft);assert.ok(chunks.length>=2);
 try{
  await account.ai.invoke(f.c.account,voice.job,voice.attemptId,'synthetic')('voice-chunk:0000',VOICE_MODEL,voiceBody(chunks[0],'Charon'),new AbortController().signal);
  assert.equal(provider.calls.length,1);assert.equal(countCalls(account,'/admit'),1);await f.receipt.delete();
  const result=await observed(account.ai.invoke(f.c.account,voice.job,voice.attemptId,'synthetic')('voice-chunk:0001',VOICE_MODEL,voiceBody(chunks[1],'Charon'),new AbortController().signal));
  assert.ok(result.error);assert.equal(provider.calls.length,1);assert.equal(countCalls(account,'/admit'),1);
 }finally{provider.restore();}
});

test('a lost provider response does not authorize a duplicate provider call',{timeout:60000},async()=>{
 const f=await reviewedVoiceFixture(),account=fakeRecoveryAccount(f.c),voice=await invokingVoice(f,account),provider=stubProvider(f.c,{loseResponse:true});
 const draft=(await f.c.backend.readProject(f.c.account,f.c.input)).draft,body=voiceBody(narrationChunks(draft)[0],'Charon');
 const invoke=()=>account.ai.invoke(f.c.account,voice.job,voice.attemptId,'synthetic')('voice-chunk:0000',VOICE_MODEL,body,new AbortController().signal);
 try{assert.ok((await observed(invoke())).error);assert.ok((await observed(invoke())).error);
  assert.equal(provider.calls.length,1);assert.equal(countCalls(account,'/admit'),1);assert.equal(countCalls(account,'/release'),0);
 }finally{provider.restore();}
});

test('an existing Account admission receipt alone cannot start a provider call',{timeout:60000},async()=>{
 const f=await reviewedVoiceFixture(),account=fakeRecoveryAccount(f.c),voice=await invokingVoice(f,account),provider=stubProvider(f.c);
 const draft=(await f.c.backend.readProject(f.c.account,f.c.input)).draft,body=voiceBody(narrationChunks(draft)[0],'Charon');
 const [reservationId,reservation]=[...account.reservations.entries()][0],callKey='voice-chunk:0000',requestSha256=sha(JSON.stringify(body));
 account.admissions.set([reservationId,voice.job,voice.attemptId,callKey].join(':'),{identityKey:reservation.identityKey,seconds:reservation.seconds,
  reservationId,jobId:voice.job,attemptId:voice.attemptId,callKey,model:VOICE_MODEL,requestSha256});
 try{const result=await observed(account.ai.invoke(f.c.account,voice.job,voice.attemptId,'synthetic')(callKey,VOICE_MODEL,body,new AbortController().signal));
  assert.ok(result.error);assert.equal(countCalls(account,'/admit'),1);assert.equal(provider.calls.length,0);
 }finally{provider.restore();}
});

test('a valid reviewed voice reaches the synthetic provider with its exact body',{timeout:60000},async()=>{
 const f=await reviewedVoiceFixture(),account=fakeRecoveryAccount(f.c),voice=await invokingVoice(f,account),provider=stubProvider(f.c);
 const draft=(await f.c.backend.readProject(f.c.account,f.c.input)).draft,body=voiceBody(narrationChunks(draft)[0],'Charon');
 try{const result=await account.ai.invoke(f.c.account,voice.job,voice.attemptId,'synthetic')('voice-chunk:0000',VOICE_MODEL,body,new AbortController().signal);
  assert.ok(result);assert.equal(countCalls(account,'/reservations'),1);assert.equal(countCalls(account,'/admit'),1);
  assert.equal(provider.calls.length,1);assert.equal(provider.calls[0].body,JSON.stringify(body));
 }finally{provider.restore();}
});
