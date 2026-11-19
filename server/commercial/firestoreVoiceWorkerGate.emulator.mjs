// Synthetic-only worker/admission fence. Run exclusively with the reviewed
// launcher against demo-vistavo-ledger on 127.0.0.1:8185; no real Account,
// provider, cloud storage, credentials, customer data, or network service.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,realpathSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {Readable,Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {firestoreHttp} from './firestoreHttp.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {VOICE_MODEL,VOICE_NARRATION_STYLE} from './pipelineVoiceProvider.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_voice_worker_gate_synthetic',testCount=13;
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');let cleanups=0;
const ref=(c,name,id)=>c.root.collection(name).doc(id);

function assertSafeEnvironment(){
  assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');
  assert.equal(process.env.LV_VOICE_WORKER_GATE_CONTRACT,'1');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
  for(const key of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN',
    'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY',
    'GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY','VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID',
    'VISTAVO_AI_ENABLED','VISTAVO_FILES_MODE','VISTAVO_LOCAL_CLOUD','VISTAVO_ACCOUNT_ID','VISTAVO_JOB_ID','VISTAVO_GEMINI_KEY','K_SERVICE','K_REVISION',
    'K_CONFIGURATION','K_JOB','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.equal(process.env[key],undefined,`Unexpected ${key}`);
  const profile=process.env.USERPROFILE;assert.ok(profile&&profile===process.env.APPDATA&&profile===process.env.LOCALAPPDATA);
  const absolute=resolve(profile),base=resolve('outputs/lv019-b-voice-worker-gate-runs'),parts=relative(base,absolute).split(sep);
  assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
  assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(c){
  assertSafeEnvironment();assert.match(c.root.path,/^vistavo_voice_worker_gate_synthetic\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(c.db.projectId,project);assert.equal(c.db.databaseId,'(default)');const settings=c.db._settings;
  assert.equal(settings?.projectId,project);assert.equal(settings?.servicePath,'127.0.0.1');assert.equal(settings?.port,8185);
  assert.equal(settings?.ssl,false);assert.equal(settings?.preferRest,false);
  for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(settings?.[key],undefined);
}
async function descendants(document,found=[]){for(const group of await document.listCollections())for(const child of await group.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{assertSafeEnvironment();assert.equal((await fetch(`http://${host}/`,{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
  assertSafeClient(c);if(!c.confirmed)throw Error('Unconfirmed synthetic root retained for audit');
  const marker=await c.root.get();assert.equal(marker.exists,true);assert.deepEqual(marker.data(),c.marker);
  const known=await descendants(c.root);for(const document of known)assert.ok(document.path.startsWith(c.root.path+'/'));
  await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await c.root.listCollections(),[]);
  for(const document of known){assert.equal((await document.get()).exists,false);assert.deepEqual(await document.listCollections(),[]);}
  cleanups++;console.log(`Synthetic voice worker cleanup verified ${cleanups}/${testCount}`);
 }finally{await c.db.terminate();}}});
after(()=>{console.log(`Synthetic voice worker cleanup total: ${cleanups}/${testCount}`);assert.equal(cleanups,testCount);});

class SyntheticObjects {
  rows=new Map();puts=0;reads=0;
  async putArtifactOnce(){this.puts++;throw Error('Unexpected synthetic output put');}
  async read(object){this.reads++;const row=this.rows.get(object.key);assert.ok(row&&row.generation===object.generation);return Readable.from([row.bytes]);}
}
class SyntheticResponse extends Writable {
  constructor(){super();this.headers={};this.statusCode=200;this.parts=[];}
  setHeader(name,value){this.headers[name.toLowerCase()]=String(value);return this;}
  writeHead(status,headers={}){this.statusCode=status;for(const [name,value] of Object.entries(headers))this.setHeader(name,value);return this;}
  _write(chunk,_encoding,callback){this.parts.push(Buffer.from(chunk));callback();}
}
async function fixture(){
  assertSafeEnvironment();const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
  const root=db.collection(collection).doc(randomUUID()),backend=new FirestoreBackend(db,root),objects=new SyntheticObjects();
  const c={db,root,backend,objects,confirmed:false,marker:{project,purpose:'voice-worker-gate-synthetic-v1',nonce:randomUUID()},tokenChecks:0};contexts.push(c);
  assertSafeClient(c);assert.equal((await root.get()).exists,false);assert.deepEqual(await root.listCollections(),[]);
  await root.create(c.marker);assert.deepEqual((await root.get()).data(),c.marker);c.confirmed=true;
  c.uid='synthetic-voice-owner-'+randomUUID();c.otherUid='synthetic-voice-other-'+randomUUID();
  c.account=await backend.accountForUid(c.uid);c.other=await backend.accountForUid(c.otherUid);
  for(const account of [c.account,c.other])await ref(c,'accounts',account).update({aiPilot:true,simulationOnly:true});
  await backend.creditVerifiedPurchase(c.account,'synthetic-voice-'+randomUUID(),100,1,'synthetic-only','sandbox');
  c.input=randomUUID();const inputSha=sha('synthetic video');
  await ref(c,'inputs',c.input).create({accountId:c.account,expiresAtMs:Date.now()+3600000,sha256:inputSha,deleted:false,ready:true,unknownCount:0,
    metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:`candidate-files-v1/${c.input}/video.mp4`,generation:'1',size:100,sha256:inputSha}});
  await backend.saveProject(c.account,c.input,0,'Synthetic flat English text.');c.ai=new FirestoreAi(db,root,backend,objects);
  const handler=firestoreHttp({origin:'http://127.0.0.1',backend,ai:c.ai,identity:{async verifyIdToken(token,revoked){
    c.tokenChecks++;assert.equal(revoked,true);if(token==='synthetic-owner')return {uid:c.uid,email_verified:true};
    if(token==='synthetic-other')return {uid:c.otherUid,email_verified:true};throw Error('Invalid synthetic token');}}});
  c.call=async(path,{method='GET',data,token='synthetic-owner'}={})=>{
    const bytes=data===undefined?undefined:Buffer.from(JSON.stringify(data)),req=Readable.from(bytes?[bytes]:[]);req.url=path;req.method=method;
    req.headers={origin:'http://127.0.0.1',authorization:'Bearer '+token,...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{})};
    const res=new SyntheticResponse();await handler(req,res);await finished(res);return {status:res.statusCode,body:JSON.parse(Buffer.concat(res.parts).toString('utf8'))};
  };
  return c;
}
async function state(c,job){
  const rows={};for(const name of ['accounts','inputs','projects','jobs','requests','jobAccounting','movements','billingOutbox','providerCalls','artifacts']){
    const snapshot=await c.root.collection(name).orderBy('__name__').get();rows[name]=snapshot.docs.map(doc=>({id:doc.id,data:doc.data()}));
  }
  return {rows,puts:c.objects.puts,reads:c.objects.reads,...(job?{outbox:(await ref(c,'outbox',job).get()).data()}: {})};
}
async function seed(c,operation,generic=false){
  const key=randomUUID(),price=operation==='translation:en'?2:1;
  return generic?c.backend.reserveForUid(c.account,c.input,key,price,operation,1,c.uid):
    c.backend.reserveSimulatedAiForUid(c.account,c.input,key,price,operation,1,c.uid);
}
function withoutSchedule(value){const copy={...value};delete copy.nextAttemptAt;return copy;}
function assertDeferred(before,after){assert.deepEqual(withoutSchedule(after),withoutSchedule(before));assert.equal(after.state,'pending');
  assert.equal(after.leaseUntil,null);assert.equal(after.dispatchAttempt,null);assert.ok(after.nextAttemptAt>=before.nextAttemptAt);assert.ok(after.nextAttemptAt<=Date.now()+301000);}
async function compareWithoutOutbox(c,job,before){const after=await state(c,job);assert.deepEqual(after.rows,before.rows);assert.equal(after.puts,before.puts);assert.equal(after.reads,before.reads);return after.outbox;}

test('control: a text job remains eligible and can be taken without a provider call',async()=>{
  const c=await fixture(),job=await seed(c,'translation:en');assert.equal(await c.backend.aiDispatchEligible(job),true);
  const dispatch=await c.backend.claimDispatch(job);assert.ok(dispatch);const attempt=await c.backend.claim(c.account,job);assert.ok(attempt);
  assert.equal((await ref(c,'jobs',job).get()).get('invocationPhase'),'local_check');assert.equal(c.objects.puts,0);
  assert.equal((await c.root.collection('providerCalls').get()).size,0);
});

for(const sex of ['female','male']){
  const operation=`narration:en:${sex}`;
  test(`voice ${sex}: admission and quote are blocked through service and HTTP`,async()=>{
    const c=await fixture(),before=await state(c),key=randomUUID();
    await assert.rejects(c.ai.quoteForUid(c.account,c.input,operation,1,c.uid),error=>error.code==='disabled');
    await assert.rejects(c.ai.enqueueForUid(c.account,c.input,operation,1,key,c.uid),error=>error.code==='disabled');
    assert.deepEqual(await c.call(`/api/cloud/ai/quote?inputId=${c.input}&operation=${encodeURIComponent(operation)}&revision=1`),{status:503,body:{error:'disabled'}});
    assert.deepEqual(await c.call('/api/cloud/ai/jobs',{method:'POST',data:{inputId:c.input,operation,expectedRevision:1,requestKey:key}}),{status:503,body:{error:'disabled'}});
    assert.deepEqual(await state(c),before);assert.equal(c.tokenChecks,2);
  });
  test(`voice ${sex}: queued AI work is deferred without a reservation change`,async()=>{
    const c=await fixture(),job=await seed(c,operation),before=await state(c,job);
    assert.equal(await c.backend.aiDispatchEligible(job),false);let outbox=await compareWithoutOutbox(c,job,before);assertDeferred(before.outbox,outbox);
    await ref(c,'outbox',job).update({nextAttemptAt:0});const directBefore=await state(c,job);
    assert.equal(await c.backend.claimDispatch(job),null);outbox=await compareWithoutOutbox(c,job,directBefore);assertDeferred(directBefore.outbox,outbox);
    const fixed=await state(c,job);assert.equal(await c.backend.claim(c.account,job),null);assert.deepEqual(await state(c,job),fixed);
    const status=await c.ai.status(c.account,job,c.uid);assert.equal(status.billingState,'review');assert.deepEqual(status.results,[]);
  });
  test(`voice ${sex}: old generic work cannot dispatch or be claimed`,async()=>{
    const c=await fixture(),job=await seed(c,operation,true),before=await state(c,job);
    assert.equal(await c.backend.claimDispatch(job),null);const outbox=await compareWithoutOutbox(c,job,before);assertDeferred(before.outbox,outbox);
    const fixed=await state(c,job);assert.equal(await c.backend.claim(c.account,job),null);assert.deepEqual(await state(c,job),fixed);
  });
  test(`voice ${sex}: contradictory receipt prevents recovery cancellation and release`,async()=>{
    const c=await fixture(),job=await seed(c,operation),attempt=randomUUID();
    await ref(c,'jobs',job).update({state:'running',attemptId:attempt,leaseUntil:Date.now()+60000,invocationPhase:'not_started'});
    await ref(c,'outbox',job).update({state:'sent',leaseUntil:null});
    await ref(c,'providerCalls',`${job}-voice-chunk-0000`).create({jobId:job,accountId:c.account,attemptId:attempt,callKey:'voice-chunk:0000',
      model:VOICE_MODEL,requestSha256:'a'.repeat(64),state:'intent',startedAtMs:1});
    const active=await state(c,job);assert.equal(await c.backend.beginInvocation(c.account,job,attempt),false);assert.deepEqual(await state(c,job),active);
    await ref(c,'jobs',job).update({leaseUntil:Date.now()-1000});const before=await state(c,job);assert.equal(await c.backend.heartbeat(c.account,job,attempt),false);
    assert.equal(await c.backend.recover(c.account,job),false);assert.equal(await c.backend.failBeforeInvocation(c.account,job,attempt),false);
    assert.equal(await c.backend.cancelForUid(c.account,job,c.uid),false);assert.deepEqual(await state(c,job),before);
  });
  test(`voice ${sex}: in-flight legacy work retains receipt and does not start another effect`,async()=>{
    const c=await fixture(),job=await seed(c,operation),attempt=randomUUID();
    await ref(c,'jobs',job).update({state:'running',attemptId:attempt,leaseUntil:Date.now()+60000,invocationPhase:'invoking'});
    await ref(c,'outbox',job).update({state:'sent',leaseUntil:null});const before=await state(c,job);
    const body={contents:[{parts:[{text:'Synthetic flat English text.',speech_metadata:{style:VOICE_NARRATION_STYLE}}]}],
      generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{voice:sex==='female'?'Kore':'Charon'}}}};
    await assert.rejects(c.ai.invoke(c.account,job,attempt,'synthetic-only')('voice-chunk:0000',VOICE_MODEL,body,new AbortController().signal),error=>error.code==='conflict');
    await assert.rejects(c.ai.uploadResults(c.account,job,attempt,new Map([['narration-en.wav',Buffer.from('synthetic audio')]])),error=>error.code==='disabled');
    assert.equal(await c.backend.stageArtifactReceipt(c.account,job,attempt,[]),false);assert.equal(await c.backend.finish(c.account,job,attempt,true),false);
    assert.equal(await c.backend.quarantine(c.account,job,attempt),false);assert.equal(await c.backend.cancelForUid(c.account,job,c.uid),false);
    assert.deepEqual(await state(c,job),before);assert.equal(c.objects.puts,0);
    await ref(c,'providerCalls',`${job}-voice-chunk-0000`).create({jobId:job,accountId:c.account,attemptId:attempt,callKey:'voice-chunk:0000',model:VOICE_MODEL,
      requestSha256:'a'.repeat(64),responseSha256:'b'.repeat(64),responseId:'synthetic',state:'received',httpStatus:200,usage:{totalTokenCount:1}});
    await ref(c,'jobs',job).update({state:'unknown',unknownAttemptId:attempt,attemptId:null,leaseUntil:null});await ref(c,'inputs',c.input).update({unknownCount:1});
    const uncertain=await state(c,job);assert.equal(await c.backend.reconcile(c.account,job,'failed','synthetic generic reason'),false);
    assert.deepEqual(await state(c,job),uncertain);
  });
  test(`voice ${sex}: a previously completed result remains readable only by its owner`,async()=>{
    const c=await fixture(),job=await seed(c,operation),row=(await ref(c,'jobs',job).get()).data(),artifact=(await ref(c,'artifacts',job).get()).data();
    const bytes=Buffer.from('synthetic audio'),spec=artifact.plan.artifacts[0],entry={name:spec.name,key:spec.key,mimeType:spec.mimeType,generation:'2',size:bytes.length,sha256:sha(bytes)};
    c.objects.rows.set(spec.key,{generation:'2',bytes});const batch=c.db.batch();
    batch.update(ref(c,'artifacts',job),{state:'ready',entries:[entry],quotaMode:'committed',quotaHeld:bytes.length});
    batch.update(ref(c,'jobs',job),{state:'succeeded',attemptId:null,leaseUntil:null});
    const account=(await ref(c,'accounts',c.account).get()).data();
    batch.update(ref(c,'accounts',c.account),{reserved:account.reserved-row.price,consumed:account.consumed+row.price,active:account.active-1,
      storageReservedBytes:0,storageCommittedBytes:bytes.length});
    batch.create(ref(c,'movements',`terminal:${job}`),{accountId:c.account,reference:job,credits:row.price,kind:'capture'});await batch.commit();
    const result=await c.ai.status(c.account,job,c.uid);assert.equal(result.state,'succeeded');assert.equal(result.billingState,'simulated');
    assert.deepEqual(result.results.map(item=>item.name),['narration-en.wav']);const read=await c.ai.download(c.account,job,'narration-en.wav',c.uid);
    const pieces=[];for await(const chunk of await c.objects.read(read.object))pieces.push(chunk);assert.deepEqual(Buffer.concat(pieces),bytes);
    await assert.rejects(c.ai.download(c.account,job,'narration-en.wav',c.otherUid),error=>error.code==='not_found');
  });
}
