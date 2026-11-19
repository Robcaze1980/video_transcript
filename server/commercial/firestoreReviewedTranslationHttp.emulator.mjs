// Isolated synthetic end-to-end route fixture. It must only run through the
// reviewed launcher against demo Firestore on 127.0.0.1:8185. Requests and
// responses are in memory; Firebase identity and object storage are simulated.
// It does not prove real Firebase auth, IAM, cloud routing or real billing.
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
import {FirestoreReviewedTranslation} from './firestoreReviewedTranslation.ts';
import {firestoreHttp} from './firestoreHttp.ts';
import {AI_CATALOG_VERSION} from './aiContracts.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {encodeTextBundle} from './pipelineTextCodec.ts';
import {textModel} from './pipelineTextProvider.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_review_http_synthetic',testCount=7;
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');let verifiedCleanups=0;
const ref=(c,name,id)=>c.root.collection(name).doc(id);
function assertSafeEnvironment(){
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');assert.equal(process.env.LV_REVIEW_HTTP_CONTRACT,'1');
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const name of ['HOME','CODEX_HOME','NODE_OPTIONS'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','FIREBASE_CONFIG','K_SERVICE','K_REVISION','FUNCTION_TARGET'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 assert.ok(process.env.USERPROFILE);assert.equal(process.env.USERPROFILE,process.env.APPDATA);assert.equal(process.env.USERPROFILE,process.env.LOCALAPPDATA);
 const profile=resolve(process.env.USERPROFILE),base=resolve('outputs/lv019-b-review-http-runs'),parts=relative(base,profile).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(profile).toLowerCase(),profile.toLowerCase());assert.equal(existsSync(join(profile,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(db){
 assert.equal(db.projectId,project);assert.equal(db.databaseId,'(default)');assert.equal(db._settings?.projectId,project);
 assert.equal(db._settings?.servicePath,'127.0.0.1');assert.equal(db._settings?.port,8185);assert.equal(db._settings?.ssl,false);assert.equal(db._settings?.preferRest,false);
 for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(db._settings?.[key],undefined);
}
function assertSafeRoot(c){assert.match(c.root.id,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(c.root.path,collection+'/'+c.root.id);}
async function descendants(document,found=[]){for(const group of await document.listCollections())for(const child of await group.listDocuments()){found.push(child.path);await descendants(child,found);}return found;}

class SyntheticResponse extends Writable{
 constructor(){super();this.headers={};this.statusCode=200;this.headersSent=false;this.parts=[];}
 setHeader(name,value){this.headers[name.toLowerCase()]=String(value);}
 writeHead(status,headers={}){this.statusCode=status;this.headersSent=true;for(const [key,value] of Object.entries(headers))this.setHeader(key,value);return this;}
 _write(chunk,_encoding,callback){this.parts.push(Buffer.from(chunk));callback();}
 get body(){return Buffer.concat(this.parts);}
}
class FakeObjects{
 data=new Map();reads=0;
 async read(object){this.reads++;const entry=this.data.get(object.key);assert.ok(entry);assert.equal(entry.generation,object.generation);assert.equal(entry.bytes.length,object.size);return Readable.from([Buffer.from(entry.bytes)]);}
}
function makeClient(c,{includeAi=true,includeReview=true,service=c.service}={}){
 const handler=firestoreHttp({origin:'http://127.0.0.1',backend:c.backend,...(includeAi?{ai:c.ai}:{}),...(includeReview?{reviewedTranslation:service}:{}),identity:{async verifyIdToken(token,checkRevoked){
  assert.equal(checkRevoked,true);c.tokenChecks++;
  if(token==='synthetic-owner')return {uid:c.uid,email_verified:true};
  if(token==='synthetic-other')return {uid:c.otherUid,email_verified:true};
  if(token==='synthetic-unverified')return {uid:c.uid,email_verified:false};
  throw Error('Synthetic invalid token');
 }}});
 return async(path,{method='GET',token='synthetic-owner',data}={})=>{
  const bytes=data===undefined?null:Buffer.from(JSON.stringify(data));
  const req=Readable.from(bytes?[bytes]:[]);req.url=path;req.method=method;
  req.headers={origin:'http://127.0.0.1',authorization:'Bearer '+token,...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{})};
  const res=new SyntheticResponse();await handler(req,res);await finished(res);return res;
 };
}
function assertNoContent(response,c){
 const body=response.body.toString('utf8');
 const parsed=JSON.parse(body);assert.deepEqual(Object.keys(parsed),['error']);assert.ok(['request_rejected','not_found','invalid'].includes(parsed.error));
 for(const value of [...c.cues.flatMap(cue=>[cue.es,cue.en]),...c.edits.map(edit=>edit.en),'00:00:00,000','synthetic video'])assert.equal(body.includes(value),false,'Denied response exposed synthetic content');
 assert.equal(response.headers['cache-control'],'no-store');
}
function reviewPath(c){return `/api/cloud/ai/jobs/${c.jobId}/review`;}
function readPath(c){return `${reviewPath(c)}?inputId=${c.input}`;}
function downloadPath(c,format='txt'){return `${reviewPath(c)}/download?inputId=${c.input}&revision=2&format=${format}`;}
function body(c,overrides={}){return {inputId:c.input,expectedRevision:1,requestKey:randomUUID(),edits:c.edits,...overrides};}

before(async()=>{assertSafeEnvironment();assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
 assertSafeEnvironment();assertSafeClient(c.db);assertSafeRoot(c);
 if(!c.markerConfirmed){console.error(`Synthetic review HTTP root preserved: unconfirmed marker ${c.root.path}`);throw Error('Refusing cleanup without a confirmed synthetic marker');}
 const marker=await c.root.get(),data=marker.data();
 if(!marker.exists||!data||Object.keys(data).sort().join(',')!=='nonce,project,purpose'||data.nonce!==c.marker.nonce||data.project!==c.marker.project||data.purpose!==c.marker.purpose){console.error(`Synthetic review HTTP root preserved: changed marker ${c.root.path}`);throw Error('Refusing cleanup after synthetic marker changed');}
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await descendants(c.root),[]);
 verifiedCleanups++;console.log(`Synthetic review HTTP cleanup verified ${verifiedCleanups}/${testCount}`);
 }finally{await c.db.terminate();}}});
after(()=>{assert.equal(verifiedCleanups,testCount,'Every synthetic root must be removed and verified');console.log(`Synthetic review HTTP cleanup total: ${verifiedCleanups}/${testCount}`);});

async function fixture(){
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});assertSafeClient(db);
 const root=db.collection(collection).doc(randomUUID()),backend=new FirestoreBackend(db,root),uid='synthetic-owner-'+randomUUID(),otherUid='synthetic-other-'+randomUUID();
 const c={db,root,backend,uid,otherUid,tokenChecks:0,markerConfirmed:false,marker:{purpose:'vistavo-review-http-synthetic',project,nonce:randomUUID()}};assertSafeRoot(c);contexts.push(c);
 assert.equal((await root.get()).exists,false,'Synthetic root must start absent');assert.deepEqual(await descendants(root),[],'Synthetic root must have no descendants');
 await root.create(c.marker);const marker=await root.get();assert.ok(marker.exists);assert.deepEqual(marker.data(),c.marker);assert.deepEqual(await descendants(root),[]);c.markerConfirmed=true;
 const account=await backend.accountForUid(uid),other=await backend.accountForUid(otherUid),input=randomUUID(),sourceSha=sha('synthetic video');
 Object.assign(c,{account,other,input,identityId:sha(JSON.stringify(['firebase',uid]))});
 const objects=new FakeObjects(),ai=new FirestoreAi(db,root,backend,objects),service=new FirestoreReviewedTranslation(db,root,backend,objects);Object.assign(c,{objects,ai,service});
 for(const who of [account,other])await ref(c,'accounts',who).update({aiPilot:true,simulationOnly:true});
 await backend.creditVerifiedPurchase(account,'synthetic-review-http-'+randomUUID(),10,1,'synthetic-only','sandbox');
 await ref(c,'inputs',input).create({accountId:account,expiresAtMs:Date.now()+3600000,sha256:sourceSha,deleted:false,ready:true,unknownCount:0,metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:'candidate-files-v1/'+input+'/video.mp4',generation:'9007199254740993',size:100,sha256:sourceSha}});
 await backend.saveProject(account,input,0,'');
 const jobId=await backend.reserve(account,input,randomUUID(),2,'translation:en',1,AI_CATALOG_VERSION);c.jobId=jobId;
 const attempt=await backend.claim(account,jobId);assert.ok(attempt);const job=await backend.job(account,jobId);
 assert.equal(await backend.resumeTextAfterLocalCheck(account,jobId,attempt.attemptId,job.inputStorage,'nonzero'),true);
 assert.equal(await backend.beginInvocation(account,jobId,attempt.attemptId),true);
 await ref(c,'providerCalls',`${jobId}-text-window-0000`).create({jobId,accountId:account,attemptId:attempt.attemptId,callKey:'text-window:0000',model:textModel,state:'received',httpStatus:200,requestSha256:'a'.repeat(64),responseSha256:'b'.repeat(64),responseId:'synthetic-review-http',usage:{totalTokenCount:1},fixtureOnly:true});
 const bundle=encodeTextBundle(jobId,2000,{detectedLanguage:'es',hasSpeech:true,cues:[
  {startMs:0,endMs:900,es:'El técnico revisa la bomba.',en:'The technician checks the pump.'},
  {startMs:1000,endMs:1800,es:'Mide cinco centímetros.',en:'It measures five centimeters.'},
 ]});
 const buffers=new Map([['transcript-es.txt',bundle.es.txtBytes],['transcript-es.srt',bundle.es.srtBytes],['translation-en.txt',bundle.en.txtBytes],['translation-en.srt',bundle.en.srtBytes],['cues.json',Buffer.from(JSON.stringify({durationMs:bundle.durationMs,cues:bundle.cues}))]]);
 const plan=(await ref(c,'artifacts',jobId).get()).get('plan');
 const entries=plan.artifacts.map((spec,index)=>{const bytes=buffers.get(spec.name),generation=String(9007199254741000n+BigInt(index));assert.ok(bytes);objects.data.set(spec.key,{generation,bytes:Buffer.from(bytes)});return {name:spec.name,key:spec.key,mimeType:spec.mimeType,generation,size:bytes.length,sha256:sha(bytes)};});
 assert.equal(await backend.stageArtifactReceipt(account,jobId,attempt.attemptId,entries),true);assert.equal(await backend.finish(account,jobId,attempt.attemptId,true),true);
 c.cues=bundle.cues;c.cuesEntry=entries.find(entry=>entry.name==='cues.json');
 c.edits=[{id:bundle.cues[0].id,en:'The technician checks the water pump.'},{id:bundle.cues[1].id,en:'It measures 5 cm.'}];
 c.expectedTxt='The technician checks the water pump.\nIt measures 5 cm.\n';
 c.expectedSrt='1\n00:00:00,000 --> 00:00:00,900\nThe technician checks the water pump.\n\n2\n00:00:01,000 --> 00:00:01,800\nIt measures 5 cm.\n\n';
 c.call=makeClient(c);c.baseline=await financialState(c);return c;
}

async function financialState(c){
 const rows={};
 for(const name of ['movements','requests','jobAccounting','providerCalls','outbox','billingIntents','billingIntentWitnesses','billingIntentJobMarkers','billingGuards','billingOutbox']){
  const docs=await c.root.collection(name).orderBy('__name__').get();rows[name]=docs.docs.map(doc=>({id:doc.id,data:doc.data()}));
 }
 return {balance:await c.backend.readBalance(c.account),rows};
}
async function state(c){
 const docs={};
 for(const name of ['projects','reviewedTranslations','reviewRequests']){const q=await c.root.collection(name).orderBy('__name__').get();docs[name]=q.docs.map(doc=>({id:doc.id,data:doc.data()}));}
 return {financial:await financialState(c),docs};
}
async function ownerSaved(c){const response=await c.call(reviewPath(c),{method:'PUT',data:body(c)});assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body.toString()).committedRevision,2);}
function gate(){let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),resume=new Promise(resolve=>{release=resolve;});return {entered,resume,enter,release};}
async function waitForBarrier(barrier,pending){let timer;try{await Promise.race([barrier.entered,pending.then(()=>{throw Error('Route ended before synthetic identity barrier');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic identity barrier timed out')),10000);})]);}finally{clearTimeout(timer);}}

test('default off: both optional review service and AI are required',async()=>{
 const c=await fixture(),before=await state(c),reads=c.objects.reads;
 for(const config of [{includeReview:false},{includeAi:false}]){
  const call=makeClient(c,config);
  for(const [url,options] of [[readPath(c),{}],[reviewPath(c),{method:'PUT',data:body(c)}],[downloadPath(c),{}]]){
   const response=await call(url,options);assert.equal(response.statusCode,404);assertNoContent(response,c);
  }
 }
 assert.equal(c.objects.reads,reads);assert.deepEqual(await state(c),before);
});

test('verified owner edits, saves, reopens and downloads matching reviewed TXT and SRT',async()=>{
 const c=await fixture(),first=await c.call(readPath(c));assert.equal(first.statusCode,200);assert.equal(first.headers['cache-control'],'no-store');
 const source=JSON.parse(first.body.toString());assert.equal(source.status,'original');assert.equal(source.projectRevision,1);assert.deepEqual(source.cues.map(cue=>cue.id),c.cues.map(cue=>cue.id));
 await ownerSaved(c);const object=c.objects.data.get(c.cuesEntry.key);assert.ok(object);c.objects.data.delete(c.cuesEntry.key);
 const reads=c.objects.reads,reopenedService=new FirestoreReviewedTranslation(c.db,c.root,c.backend,c.objects),call=makeClient(c,{service:reopenedService});
 const reopened=await call(readPath(c));assert.equal(reopened.statusCode,200);const content=JSON.parse(reopened.body.toString());assert.equal(content.status,'reviewed');assert.equal(content.projectRevision,2);assert.deepEqual(content.cues.map(cue=>({id:cue.id,en:cue.en})),c.edits);
 for(const [format,expected,mime] of [['txt',c.expectedTxt,'text/plain; charset=utf-8'],['srt',c.expectedSrt,'application/x-subrip; charset=utf-8']]){
  const response=await call(downloadPath(c,format));assert.equal(response.statusCode,200);assert.equal(response.headers['content-type'],mime);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['x-content-type-options'],'nosniff');assert.equal(response.headers['x-vistavo-revision'],'2');assert.equal(response.body.toString('utf8'),expected);
 }
 const head=await call(downloadPath(c),{method:'HEAD'});assert.equal(head.statusCode,200);assert.equal(head.body.length,0);assert.equal(head.headers['content-length'],String(Buffer.byteLength(c.expectedTxt)));
 assert.equal(c.objects.reads,reads,'Reopening/downloads must use the saved revision');assert.deepEqual(await financialState(c),c.baseline);
});

test('another account cannot read, edit or download the owner review',async()=>{
 const c=await fixture();await ownerSaved(c);const before=await state(c),reads=c.objects.reads;
 for(const [url,options] of [[readPath(c),{}],[reviewPath(c),{method:'PUT',data:body(c,{expectedRevision:2})}],[downloadPath(c,'txt'),{}],[downloadPath(c,'srt'),{}]]){
  const response=await c.call(url,{...options,token:'synthetic-other'});assert.equal(response.statusCode,404);assertNoContent(response,c);
 }
 assert.equal(c.objects.reads,reads);assert.deepEqual(await state(c),before);
});

test('invalid or unverified tokens and forged body identities fail without content',async()=>{
 const c=await fixture(),before=await state(c),reads=c.objects.reads;
 for(const [token,status] of [['synthetic-invalid',401],['synthetic-unverified',403]]){
  const response=await c.call(readPath(c),{token});assert.equal(response.statusCode,status);assertNoContent(response,c);
 }
 const forged=await c.call(reviewPath(c),{method:'PUT',data:body(c,{uid:c.otherUid,accountId:c.other})});assert.equal(forged.statusCode,400);assertNoContent(forged,c);
 assert.equal(c.objects.reads,reads);assert.deepEqual(await state(c),before);
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} after routing denies read, save and download without disclosure`,async()=>{
 const c=await fixture();await ownerSaved(c);const before=await state(c),reads=c.objects.reads,identity=ref(c,'identities',c.identityId);
 for(const operation of [
  {name:'readSource',url:readPath(c),options:{}},
  {name:'saveReview',url:reviewPath(c),options:{method:'PUT',data:body(c,{expectedRevision:2})}},
  {name:'downloadReview',url:downloadPath(c),options:{}},
 ]){
  const barrier=gate(),original=c.service[operation.name];let calls=0;
  c.service[operation.name]=async function(...args){calls++;assert.deepEqual(args[0],{accountId:c.account,uid:c.uid});barrier.enter();await barrier.resume;return original.apply(this,args);};
  const pending=c.call(operation.url,operation.options);
  try{
   await waitForBarrier(barrier,pending);
   if(mutation==='removed')await identity.delete();else if(mutation==='reassigned')await identity.update({accountId:c.other});else await identity.update({uid:c.otherUid});
   barrier.release();const response=await pending;assert.equal(response.statusCode,404);assertNoContent(response,c);assert.equal(calls,1);
  }finally{barrier.release();c.service[operation.name]=original;await identity.set({accountId:c.account,uid:c.uid});}
 }
 assert.equal(c.objects.reads,reads);assert.deepEqual(await state(c),before);
});
