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
const sha=value=>createHash('sha256').update(value).digest('hex'),contexts=[],expectedTests=7;
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
 const absolute=resolve(profile),base=resolve('outputs/lv019-b-voice-runs'),parts=relative(base,absolute).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(c){
 assertSafeEnvironment();assert.match(c.root.path,/^vistavo_voice_review_synthetic\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 assert.equal(c.db.projectId,'demo-vistavo-ledger');assert.equal(c.db.databaseId,'(default)');const s=c.db._settings;
 assert.equal(s?.projectId,'demo-vistavo-ledger');assert.equal(s?.servicePath,'127.0.0.1');assert.equal(s?.port,8185);assert.equal(s?.ssl,false);assert.equal(s?.preferRest,false);
 for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(s?.[key],undefined);
}
async function descendants(document,found=[]){for(const collection of await document.listCollections())for(const child of await collection.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{assertSafeEnvironment();assert.equal((await fetch('http://127.0.0.1:8185/',{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){globalThis.fetch=c.originalFetch;try{
 assertSafeClient(c);const marker=await c.root.get();
 if(!c.confirmed){assert.equal(marker.exists,false,'Unconfirmed root must not be deleted');assert.deepEqual(await c.root.listCollections(),[]);continue;}
 assert.equal(marker.exists,true);assert.equal(marker.get('marker'),c.marker);assert.equal(marker.get('purpose'),'voice-review-synthetic-v1');
 const known=await descendants(c.root);for(const document of known)assert.ok(document.path.startsWith(`${c.root.path}/`));
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await c.root.listCollections(),[]);
 for(const document of known){assert.equal((await document.get()).exists,false);assert.deepEqual(await document.listCollections(),[]);}
 verifiedCleanups++;console.log(`Synthetic voice cleanup verified ${verifiedCleanups}/${expectedTests}`);
 }finally{await c.db.terminate();}}});
after(()=>{console.log(`Synthetic voice cleanup total: ${verifiedCleanups}/${expectedTests}`);assert.equal(verifiedCleanups,expectedTests);});
async function fixture(){
 assertSafeEnvironment();
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:false}),root=db.collection('vistavo_voice_review_synthetic').doc(randomUUID()),backend=new FirestoreBackend(db,root),objects=new MemoryObjects(),marker=randomUUID();
 assert.equal(db.projectId,'demo-vistavo-ledger');assert.equal(db.databaseId,'(default)');assert.equal(db._settings?.servicePath,'127.0.0.1');assert.equal(db._settings?.port,8185);assert.equal(db._settings?.ssl,false);
 const ai=new FirestoreAi(db,root,backend,objects),files=new FirestoreFiles(db,root,objects,{chunkBytes:4},(account,input)=>ai.purgeInput(account,input));
 const c={db,root,backend,objects,ai,files,marker,confirmed:false,originalFetch:globalThis.fetch};contexts.push(c);
 assertSafeClient(c);
 // This guard covers fetch only; it is not an OS firewall for native modules.
 globalThis.fetch=async(request,init)=>{const raw=request instanceof Request?request.url:String(request),url=new URL(raw);if(url.hostname!=='127.0.0.1'||url.port!=='8185')throw Error('synthetic fixture blocks outbound fetch');return c.originalFetch(request,init);};
 assert.equal((await root.get()).exists,false);assert.deepEqual(await root.listCollections(),[]);await root.create({marker,purpose:'voice-review-synthetic-v1'});assert.equal((await root.get()).get('marker'),marker);c.confirmed=true;
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
 const textJob=await c.ai.enqueue(c.account,c.input,'translation:en',2,randomUUID()),attempt=await c.backend.claim(c.account,textJob);assert.ok(attempt);
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
 return {c,textJob,review:reviews.docs[0].ref,receipt:receipts.docs[0].ref,principal,revision:3};
}
function fakeAccount(c,pauses={}){
 const calls=[];let enter,release;const entered=new Promise(r=>enter=r),resume=new Promise(r=>release=r);
 const billing=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;calls.push(path);
  if((pauses.reserve&&path.endsWith('/reservations'))||(pauses.admit&&path.endsWith('/admit'))){enter();await resume;}
  if(path.endsWith('/reservations'))return {data:{state:'reserved',reservationId:request.data.reservationId,seconds:request.data.seconds}};
  if(path.endsWith('/admit'))return {data:{...request.data,reservationId:path.split('/').at(-2),created:true,receiptOnly:false}};
  throw Error('unexpected synthetic account request');
 }});
 return {ai:new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,billing),calls,entered,release};
}
const voiceCount=async c=>(await c.root.collection('jobs').get()).docs.filter(d=>String(d.get('operation')).startsWith('narration:')).length;
const voiceBody=(text,voice)=>({contents:[{parts:[{text,speech_metadata:{style:VOICE_NARRATION_STYLE}}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{voice}}}});
async function observedVoice(promise){return promise.then(value=>({value}),error=>({error}));}
async function waitReached(entered,pending){let timer;try{await Promise.race([entered,pending.then(()=>{throw Error('operation ended before synthetic barrier');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('synthetic barrier timed out')),10000);})]);}finally{clearTimeout(timer);}}

test('plain draft without a captured reviewed translation cannot reserve voice',{timeout:30000},async()=>{
 const c=await fixture(),before=await c.backend.readBalance(c.account),prior=await voiceCount(c);
 const outcome=await observedVoice(c.ai.enqueue(c.account,c.input,'narration:en:male',1,randomUUID(),c.uid));
 const after=await c.backend.readBalance(c.account),created=await voiceCount(c);
 console.log(JSON.stringify({event:'synthetic-voice-plain-draft',accepted:!!outcome.value,voiceJobs:created-prior,balanceChanged:JSON.stringify(after)!==JSON.stringify(before)}));
 assert.ok(outcome.error);assert.equal(created,prior);assert.deepEqual(after,before);
});

test('missing structured receipt cannot issue a new voice reservation',{timeout:30000},async()=>{
 const {c,receipt,revision}=await reviewedVoiceFixture(),account=fakeAccount(c),before=await voiceCount(c);await receipt.delete();
 const outcome=await observedVoice(account.ai.enqueue(c.account,c.input,'narration:en:female',revision,randomUUID(),c.uid)),calls=account.calls.filter(x=>x.endsWith('/reservations')).length,after=await voiceCount(c);
 console.log(JSON.stringify({event:'synthetic-voice-missing-receipt',accepted:!!outcome.value,reserveCalls:calls,voiceJobs:after-before}));
 assert.ok(outcome.error);assert.equal(calls,0);assert.equal(after,before);
});

test('changing review while Account reservation is in flight does not create a voice job',{timeout:30000},async()=>{
 const {c,review,revision}=await reviewedVoiceFixture(),account=fakeAccount(c,{reserve:true}),key=randomUUID(),before=await voiceCount(c);
 const pending=observedVoice(account.ai.enqueue(c.account,c.input,'narration:en:male',revision,key,c.uid));
 try{await waitReached(account.entered,pending);await review.delete();account.release();const outcome=await pending,after=await voiceCount(c);
  const intent=(await ref(c,'billingIntents',sha(JSON.stringify([c.account,key]))).get()).data(),calls=account.calls.filter(x=>x.endsWith('/reservations')).length;
  console.log(JSON.stringify({event:'synthetic-voice-reservation-race',accepted:!!outcome.value,reserveCalls:calls,voiceJobs:after-before,intentState:intent?.state}));
  assert.ok(outcome.error);assert.equal(calls,1);assert.equal(after,before);assert.ok(intent&&['reserve_pending','release_pending','needs_review'].includes(intent.state));
 }finally{account.release();}
});

test('losing the reviewed receipt before a voice provider call blocks the provider',{timeout:30000},async()=>{
 const {c,receipt,revision}=await reviewedVoiceFixture(),voice=await c.ai.enqueue(c.account,c.input,'narration:en:female',revision,randomUUID(),c.uid);
 const attempt=await c.backend.claim(c.account,voice);assert.ok(attempt);assert.equal(await c.backend.beginInvocation(c.account,voice,attempt.attemptId),true);await receipt.delete();
 const fetchBefore=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({usageMetadata:{totalTokenCount:1},candidates:[]}));};
 const draft=(await c.backend.readProject(c.account,c.input)).draft,body=voiceBody(narrationChunks(draft)[0],'Kore');
 try{const outcome=await observedVoice(c.ai.invoke(c.account,voice,attempt.attemptId,'synthetic-only')('voice-chunk:0000',VOICE_MODEL,body,new AbortController().signal));
  console.log(JSON.stringify({event:'synthetic-voice-missing-receipt-provider',providerCalls:calls,accepted:!!outcome.value}));assert.ok(outcome.error);assert.equal(calls,0);
 }finally{globalThis.fetch=fetchBefore;}
});

test('a changed review during Account admission cannot start a new voice provider call',{timeout:30000},async()=>{
 const {c,review,revision}=await reviewedVoiceFixture(),account=fakeAccount(c,{admit:true}),voice=await account.ai.enqueue(c.account,c.input,'narration:en:male',revision,randomUUID(),c.uid);
 const attempt=await c.backend.claim(c.account,voice);assert.ok(attempt);assert.equal(await c.backend.beginInvocation(c.account,voice,attempt.attemptId),true);
 const fetchBefore=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({usageMetadata:{totalTokenCount:1},candidates:[]}));};
 const draft=(await c.backend.readProject(c.account,c.input)).draft,body=voiceBody(narrationChunks(draft)[0],'Charon');
 const pending=observedVoice(account.ai.invoke(c.account,voice,attempt.attemptId,'synthetic-only')('voice-chunk:0000',VOICE_MODEL,body,new AbortController().signal));
 try{await waitReached(account.entered,pending);await review.delete();account.release();const outcome=await pending;
  console.log(JSON.stringify({event:'synthetic-voice-admission-race',providerCalls:calls,admitCalls:account.calls.filter(x=>x.endsWith('/admit')).length,accepted:!!outcome.value}));
  assert.ok(outcome.error);assert.equal(calls,0);assert.equal(account.calls.filter(x=>x.endsWith('/admit')).length,1);
 }finally{account.release();globalThis.fetch=fetchBefore;}
});

test('a different voice payload cannot be admitted or sent on a reviewed job',{timeout:30000},async()=>{
 const {c,revision}=await reviewedVoiceFixture(),account=fakeAccount(c),voice=await account.ai.enqueue(c.account,c.input,'narration:en:male',revision,randomUUID(),c.uid);
 const attempt=await c.backend.claim(c.account,voice);assert.ok(attempt);assert.equal(await c.backend.beginInvocation(c.account,voice,attempt.attemptId),true);
 const fetchBefore=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({usageMetadata:{totalTokenCount:1},candidates:[]}));};
 try{const outcome=await observedVoice(account.ai.invoke(c.account,voice,attempt.attemptId,'synthetic-only')('voice-chunk:0000',VOICE_MODEL,voiceBody('Different synthetic text','Kore'),new AbortController().signal));
  console.log(JSON.stringify({event:'synthetic-voice-wrong-body',providerCalls:calls,admitCalls:account.calls.filter(x=>x.endsWith('/admit')).length,accepted:!!outcome.value}));
  assert.ok(outcome.error);assert.equal(calls,0);assert.equal(account.calls.filter(x=>x.endsWith('/admit')).length,0);
 }finally{globalThis.fetch=fetchBefore;}
});

test('a valid reviewed text, approved voice and matching body reach the synthetic provider',{timeout:30000},async()=>{
 const {c,revision}=await reviewedVoiceFixture(),account=fakeAccount(c),voice=await account.ai.enqueue(c.account,c.input,'narration:en:male',revision,randomUUID(),c.uid);
 const attempt=await c.backend.claim(c.account,voice);assert.ok(attempt);assert.equal(await c.backend.beginInvocation(c.account,voice,attempt.attemptId),true);
 const draft=(await c.backend.readProject(c.account,c.input)).draft,fetchBefore=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({usageMetadata:{totalTokenCount:1},candidates:[]}));};
 try{const result=await account.ai.invoke(c.account,voice,attempt.attemptId,'synthetic-only')('voice-chunk:0000',VOICE_MODEL,voiceBody(narrationChunks(draft)[0],'Charon'),new AbortController().signal);
  assert.ok(result);assert.equal(calls,1);assert.equal(account.calls.filter(x=>x.endsWith('/admit')).length,1);
 }finally{globalThis.fetch=fetchBefore;}
});
