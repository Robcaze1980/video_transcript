// Local synthetic upload identity races. Run only through the reviewed launcher
// against demo Firestore at 127.0.0.1:8185. Requests, identity verification and
// object storage are in memory. An in-flight write may survive UID revocation;
// this fixture does not prove cloud object cleanup, quota release, IAM or auth.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,realpathSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {Readable,Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreFiles} from './firestoreFiles.ts';
import {firestoreHttp} from './firestoreHttp.ts';
import {ObjectFault} from './gcsObjects.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_upload_identity_synthetic',testCount=11;
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');let verifiedCleanups=0;
const ref=(c,name,id)=>c.root.collection(name).doc(id);
function assertSafeEnvironment(){
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');assert.equal(process.env.LV_UPLOAD_IDENTITY_CONTRACT,'1');
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const name of ['HOME','CODEX_HOME','NODE_OPTIONS'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','FIREBASE_CONFIG','K_SERVICE','K_REVISION','FUNCTION_TARGET'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 assert.ok(process.env.USERPROFILE);assert.equal(process.env.USERPROFILE,process.env.APPDATA);assert.equal(process.env.USERPROFILE,process.env.LOCALAPPDATA);
 const profile=resolve(process.env.USERPROFILE),base=resolve('outputs/lv019-b-upload-identity-http-runs'),parts=relative(base,profile).split(sep);
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
function gate(){let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),resume=new Promise(resolve=>{release=resolve;});return {entered,resume,enter,release};}
async function waitForBarrier(barrier,pending){let timer;try{await Promise.race([barrier.entered,pending.then(()=>{throw Error('Route ended before synthetic upload barrier');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic upload barrier timed out')),10000);})]);}finally{clearTimeout(timer);}}

class SyntheticResponse extends Writable{
 constructor(){super();this.headers={};this.statusCode=200;this.headersSent=false;this.parts=[];}
 setHeader(name,value){this.headers[name.toLowerCase()]=String(value);}
 writeHead(status,headers={}){this.statusCode=status;this.headersSent=true;for(const [key,value] of Object.entries(headers))this.setHeader(key,value);return this;}
 _write(chunk,_encoding,callback){this.parts.push(Buffer.from(chunk));callback();}
 get body(){return Buffer.concat(this.parts);}
}
class MemoryObjects{
 data=new Map();next=0;putCalls=0;pendingGate=null;
 meta(key){const item=this.data.get(key);return item?{key,generation:item.generation,size:item.bytes.length,...(item.marker?{marker:true}:{})}:null;}
 async metadata(key){return this.meta(key);}
 pauseNextPut(stage){assert.ok(!this.pendingGate);assert.ok(['before_write','after_write'].includes(stage));const barrier=gate();this.pendingGate={stage,barrier};return barrier;}
 async putOnce(key,bytes){
  this.putCalls++;const scheduled=this.pendingGate;this.pendingGate=null;
  if(scheduled?.stage==='before_write'){scheduled.barrier.enter();await scheduled.barrier.resume;}
  const prior=this.data.get(key);
  if(prior){if(prior.marker||!prior.bytes.equals(bytes))throw new ObjectFault('conflict');}
  else this.data.set(key,{generation:String(++this.next),bytes:Buffer.from(bytes),marker:false});
  if(scheduled?.stage==='after_write'){scheduled.barrier.enter();await scheduled.barrier.resume;}
  return this.meta(key);
 }
 async composeOnce(){throw Error('Synthetic upload identity test does not compose');}
 async read(){throw Error('Synthetic upload identity test does not read objects');}
 async barrier(){throw Error('Synthetic upload identity test does not claim object cleanup');}
 snapshot(){return [...this.data.entries()].map(([key,item])=>({key,generation:item.generation,size:item.bytes.length,sha256:sha(item.bytes),marker:item.marker})).sort((a,b)=>a.key.localeCompare(b.key));}
}
function makeClient(c){
 const handler=firestoreHttp({origin:'http://127.0.0.1',backend:c.backend,files:c.files,nudgeFile:async(id,role)=>{c.nudges.push({id,role});},identity:{async verifyIdToken(token,checkRevoked){
  assert.equal(checkRevoked,true);c.tokenChecks++;
  if(token==='synthetic-owner')return {uid:c.uid,email_verified:true};
  if(token==='synthetic-other')return {uid:c.otherUid,email_verified:true};
  if(token==='synthetic-unverified')return {uid:c.uid,email_verified:false};
  throw Error('Synthetic invalid token');
 }}});
 return async(path,{method='GET',token='synthetic-owner',data,bytes}={})=>{
  assert.ok(data===undefined||bytes===undefined);const body=bytes!==undefined?Buffer.from(bytes):data!==undefined?Buffer.from(JSON.stringify(data)):null;
  const req=Readable.from(body?[body]:[]);req.url=path;req.method=method;req.headers={origin:'http://127.0.0.1',authorization:'Bearer '+token,
   ...(body?{'content-type':bytes!==undefined?'application/octet-stream':'application/json','content-length':String(body.length)}:{})};
  const res=new SyntheticResponse();await handler(req,res);await finished(res);return res;
 };
}
function assertDenied(response,status=404){
 assert.equal(response.statusCode,status);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['x-content-type-options'],'nosniff');
 const payload=JSON.parse(response.body.toString('utf8'));assert.deepEqual(Object.keys(payload),['error']);assert.ok(['request_rejected','not_found','invalid','conflict'].includes(payload.error));
 for(const value of ['synthetic-private.mp4','ABCD','WXYZ'])assert.equal(response.body.includes(Buffer.from(value)),false,'Denied response disclosed synthetic upload data');
}
const uploads='/api/cloud/uploads',item=id=>`${uploads}/${id}`,chunk=id=>`${item(id)}/chunks?offset=0`,complete=id=>`${item(id)}/complete`;
const video=Buffer.from('ABCD');
function beginBody(){return {name:'synthetic-private.mp4',size:video.length,sha256:sha(video),requestKey:randomUUID()};}
async function create(c){const response=await c.call(uploads,{method:'POST',data:beginBody()});assert.equal(response.statusCode,201);const result=JSON.parse(response.body.toString());assert.ok(result.id);return result;}
async function put(c,id,bytes=video){return c.call(chunk(id),{method:'PUT',bytes});}

before(async()=>{assertSafeEnvironment();assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
 assertSafeEnvironment();assertSafeClient(c.db);assertSafeRoot(c);
 if(!c.markerConfirmed){console.error(`Synthetic upload identity root preserved: unconfirmed marker ${c.root.path}`);throw Error('Refusing cleanup without a confirmed synthetic marker');}
 const marker=await c.root.get(),data=marker.data();
 if(!marker.exists||!data||Object.keys(data).sort().join(',')!=='nonce,project,purpose'||data.nonce!==c.marker.nonce||data.project!==c.marker.project||data.purpose!==c.marker.purpose){console.error(`Synthetic upload identity root preserved: changed marker ${c.root.path}`);throw Error('Refusing cleanup after synthetic marker changed');}
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await descendants(c.root),[]);
 verifiedCleanups++;console.log(`Synthetic upload identity cleanup verified ${verifiedCleanups}/${testCount}`);
 }finally{await c.db.terminate();}}});
after(()=>{assert.equal(verifiedCleanups,testCount,'Every synthetic root must be removed and verified');console.log(`Synthetic upload identity cleanup total: ${verifiedCleanups}/${testCount}`);});

async function fixture(){
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});assertSafeClient(db);
 const root=db.collection(collection).doc(randomUUID()),backend=new FirestoreBackend(db,root),uid='synthetic-owner-'+randomUUID(),otherUid='synthetic-other-'+randomUUID();
 const c={db,root,backend,uid,otherUid,tokenChecks:0,nudges:[],markerConfirmed:false,marker:{purpose:'vistavo-upload-identity-synthetic',project,nonce:randomUUID()}};assertSafeRoot(c);contexts.push(c);
 assert.equal((await root.get()).exists,false,'Synthetic root must start absent');assert.deepEqual(await descendants(root),[],'Synthetic root must have no descendants');
 await root.create(c.marker);const marker=await root.get();assert.ok(marker.exists);assert.deepEqual(marker.data(),c.marker);assert.deepEqual(await descendants(root),[]);c.markerConfirmed=true;
 const account=await backend.accountForUid(uid),other=await backend.accountForUid(otherUid),objects=new MemoryObjects(),files=new FirestoreFiles(db,root,objects,{chunkBytes:4});
 Object.assign(c,{account,other,objects,files,identityId:sha(JSON.stringify(['firebase',uid]))});c.call=makeClient(c);return c;
}
async function state(c){
 const rows={};for(const name of ['identities','accounts','uploads','fileRequests','fileOutbox','inputs','projects','requests','movements','billingIntents','billingOutbox','billingGuards','providerCalls']){
  const docs=await c.root.collection(name).orderBy('__name__').get();rows[name]=docs.docs.map(doc=>({id:doc.id,data:doc.data()}));
 }
 return {rows,objects:c.objects.snapshot(),nudges:[...c.nudges]};
}
async function mutateIdentity(c,mutation){const identity=ref(c,'identities',c.identityId);if(mutation==='removed')await identity.delete();else if(mutation==='reassigned')await identity.update({accountId:c.other});else await identity.update({uid:c.otherUid});}
async function restoreIdentity(c){await ref(c,'identities',c.identityId).set({accountId:c.account,uid:c.uid});}

test('owner can start, inspect, append and complete a synthetic upload',async()=>{
 const c=await fixture(),upload=await create(c);assert.equal(upload.name,'synthetic-private.mp4');assert.equal(upload.size,video.length);assert.equal(upload.offset,0);
 const status=await c.call(item(upload.id));assert.equal(status.statusCode,200);assert.equal(JSON.parse(status.body.toString()).offset,0);
 const first=await put(c,upload.id);assert.equal(first.statusCode,200);assert.equal(JSON.parse(first.body.toString()).offset,video.length);
 const metadata=(await ref(c,'uploads',upload.id).get()).data();assert.equal(metadata.offset,video.length);assert.equal(metadata.chunks.length,1);
 assert.equal(c.objects.snapshot()[0].sha256,sha(video));const replay=await put(c,upload.id);assert.equal(replay.statusCode,200);assert.equal(c.objects.putCalls,1);
 const different=await put(c,upload.id,Buffer.from('WXYZ'));assertDenied(different,409);
 const done=await c.call(complete(upload.id),{method:'POST',data:{}});assert.equal(done.statusCode,202);assert.equal(JSON.parse(done.body.toString()).state,'queued');
 assert.deepEqual(c.nudges,[{id:upload.id,role:'validate'}]);assert.equal((await ref(c,'uploads',upload.id).get()).get('state'),'queued');
});

test('another account and invalid credentials cannot inspect or alter a private upload',async()=>{
 const c=await fixture(),upload=await create(c),before=await state(c);
 for(const [url,options] of [[item(upload.id),{}],[`${item(upload.id)}/content`,{}],[chunk(upload.id),{method:'PUT',bytes:video}],[complete(upload.id),{method:'POST',data:{}}]])assertDenied(await c.call(url,{...options,token:'synthetic-other'}));
 assertDenied(await c.call(item(upload.id),{token:'synthetic-invalid'}),401);assertDenied(await c.call(item(upload.id),{token:'synthetic-unverified'}),403);
 assertDenied(await c.call(uploads,{method:'POST',data:{...beginBody(),accountId:c.other,uid:c.otherUid}}),400);assert.deepEqual(await state(c),before);
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} before transaction denies start, status, chunk and complete`,async()=>{
 const c=await fixture(),pendingUpload=await create(c),fullUpload=await create(c),uploaded=await put(c,fullUpload.id);assert.equal(uploaded.statusCode,200);
 const before=await state(c);
 for(const operation of [
  {name:'beginForUid',url:uploads,options:{method:'POST',data:beginBody()}},
  {name:'statusForUid',url:item(pendingUpload.id),options:{}},
  {name:'appendForUid',url:chunk(pendingUpload.id),options:{method:'PUT',bytes:video}},
  {name:'completeForUid',url:complete(fullUpload.id),options:{method:'POST',data:{}}},
 ]){
  const barrier=gate(),original=c.files[operation.name];assert.equal(typeof original,'function',`Missing protected ${operation.name}`);let calls=0;
  c.files[operation.name]=async function(...args){calls++;assert.equal(args[0],c.account);assert.equal(args.at(-1),c.uid);barrier.enter();await barrier.resume;return original.apply(this,args);};
  const pending=c.call(operation.url,operation.options);
  try{await waitForBarrier(barrier,pending);await mutateIdentity(c,mutation);barrier.release();assertDenied(await pending);assert.equal(calls,1);}
  finally{barrier.release();c.files[operation.name]=original;await restoreIdentity(c);}
  assert.deepEqual(await state(c),before);
 }
});

for(const stage of ['before_write','after_write'])for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} while object write is ${stage} never confirms the chunk`,async()=>{
 const c=await fixture(),upload=await create(c),beforeAccount=(await ref(c,'accounts',c.account).get()).data(),barrier=c.objects.pauseNextPut(stage),pending=put(c,upload.id);
 try{
  await waitForBarrier(barrier,pending);
  const halfway=(await ref(c,'uploads',upload.id).get()).data();assert.equal(halfway.offset,0);assert.deepEqual(halfway.chunks,[]);assert.equal(halfway.manifestSha,null);
  if(stage==='before_write')assert.equal(c.objects.snapshot().length,0);else assert.equal(c.objects.snapshot().length,1);
  await mutateIdentity(c,mutation);barrier.release();assertDenied(await pending);
  const denied=(await ref(c,'uploads',upload.id).get()).data();assert.equal(denied.state,'uploading');assert.equal(denied.offset,0);assert.deepEqual(denied.chunks,[]);assert.equal(denied.manifestSha,null);
  assert.equal((await ref(c,'fileOutbox',upload.id).get()).exists,false);
  assert.deepEqual(c.nudges,[]);assert.deepEqual((await ref(c,'accounts',c.account).get()).data(),beforeAccount);
  const written=c.objects.snapshot();assert.equal(written.length,1,'Already-started synthetic write is allowed to persist');assert.equal(written[0].sha256,sha(video));
  // Recovery is deliberately simulated: restore identity and make the local
  // lease expire. A real abandoned object/lease needs durable cleanup policy.
  await restoreIdentity(c);if(denied.leaseToken)await ref(c,'uploads',upload.id).update({leaseUntil:Date.now()-1});
  const retry=await put(c,upload.id);assert.equal(retry.statusCode,200);assert.equal(JSON.parse(retry.body.toString()).offset,video.length);
  const committed=(await ref(c,'uploads',upload.id).get()).data();assert.equal(committed.offset,video.length);assert.equal(committed.chunks.length,1);assert.equal(committed.chunks[0].generation,written[0].generation);
  const beforeReplay=await state(c),putCalls=c.objects.putCalls;assert.equal((await put(c,upload.id)).statusCode,200);assert.equal(c.objects.putCalls,putCalls);
  assertDenied(await put(c,upload.id,Buffer.from('WXYZ')),409);assert.deepEqual(await state(c),beforeReplay);assert.deepEqual(c.nudges,[]);
 }finally{barrier.release();await restoreIdentity(c);}
});
