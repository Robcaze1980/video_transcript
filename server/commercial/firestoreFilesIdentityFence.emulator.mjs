// Synthetic local race tests through the real HTTP handler with in-memory
// request/response streams. No listening port, real token, cloud or real data.
import assert from 'node:assert/strict';
import {after, afterEach, before, test} from 'node:test';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, realpathSync} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';
import {Readable, Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import {isDeepStrictEqual} from 'node:util';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreFiles} from './firestoreFiles.ts';
import {firestoreHttp} from './firestoreHttp.ts';
import {objectPlan, privateBucket} from './privateObjectPlan.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_files_identity_fence_synthetic';
const expectedTests=6,contexts=[];
const sha=value=>createHash('sha256').update(value).digest('hex');
const ref=(c,name,id)=>c.root.collection(name).doc(id);
let verifiedCleanups=0;

function assertSafeEnvironment(){
 assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');
 assert.equal(process.env.LV_FILES_IDENTITY_FENCE,'1');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);
 assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN',
  'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY',
  'GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY',
  'VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN',
  'GOOGLE_CLOUD_QUOTA_PROJECT','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','K_SERVICE','K_REVISION',
  'K_CONFIGURATION','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV','HOME','CODEX_HOME','NODE_OPTIONS']){
  assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 }
 const profile=process.env.APPDATA;
 assert.ok(profile && profile===process.env.USERPROFILE && profile===process.env.LOCALAPPDATA);
 const resolved=resolve(profile),base=resolve('outputs/lv019-b-files-identity-fence-runs'),parts=relative(base,resolved).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(resolved).toLowerCase(),resolved.toLowerCase());
 assert.equal(existsSync(join(resolved,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(db){
 assert.equal(db.projectId,project);assert.equal(db.databaseId,'(default)');
 assert.equal(db._settings?.projectId,project);assert.equal(db._settings?.servicePath,'127.0.0.1');
 assert.equal(db._settings?.port,8185);assert.equal(db._settings?.ssl,false);assert.equal(db._settings?.preferRest,false);
 for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(db._settings?.[key],undefined);
}
function assertSafeRoot(c){
 assert.match(c.root.id,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 assert.equal(c.root.path,collection+'/'+c.root.id);
}
async function descendants(document,found=[]){
 for(const group of await document.listCollections())for(const child of await group.listDocuments()){
  assert(child.path.startsWith(document.path+'/'));found.push(child.path);assert(found.length<500);
  await descendants(child,found);
 }
 return found;
}

class SyntheticResponse extends Writable{
 constructor(){super();this.headers={};this.statusCode=200;this.headersSent=false;this.parts=[];}
 setHeader(name,value){this.headers[name.toLowerCase()]=String(value);}
 writeHead(status,headers={}){this.statusCode=status;this.headersSent=true;for(const [key,value] of Object.entries(headers))this.setHeader(key,value);return this;}
 _write(chunk,_encoding,callback){this.parts.push(Buffer.from(chunk));callback();}
 get body(){return Buffer.concat(this.parts);}
}
function syntheticHandler(c){
 const handler=firestoreHttp({origin:'http://127.0.0.1',backend:c.backend,files:c.files,
  nudgeFile:async()=>{c.nudges++;},identity:{async verifyIdToken(token,checkRevoked){
   assert.equal(checkRevoked,true);c.tokenChecks++;
   if(token==='synthetic-owner')return {uid:c.uid,email_verified:true};
   if(token==='synthetic-other')return {uid:c.otherUid,email_verified:true};
   throw Error('Synthetic invalid token');
  }}});
 return async(pathname,method='GET',token='synthetic-owner')=>{
  const req=Readable.from([]);req.url=pathname;req.method=method;
  req.headers={origin:'http://127.0.0.1',authorization:'Bearer '+token};
  const res=new SyntheticResponse();await handler(req,res);await finished(res);return res;
 };
}

before(async()=>{assertSafeEnvironment();const r=await fetch('http://127.0.0.1:8185/',{signal:AbortSignal.timeout(5000),redirect:'error'});assert.equal(r.status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
 assertSafeEnvironment();assertSafeClient(c.db);assertSafeRoot(c);
 if(!c.markerConfirmed)throw Error('Refusing cleanup without a confirmed synthetic marker');
 const marker=await c.root.get();
 if(!marker.exists||!isDeepStrictEqual(marker.data(),c.marker))throw Error('Refusing cleanup after synthetic marker changed');
 const paths=await descendants(c.root);for(const value of paths)assert(value.startsWith(c.root.path+'/'));
 for(const known of c.knownRefs)assert(known.path.startsWith(c.root.path+'/'));
 await c.db.recursiveDelete(c.root);
 assert.equal((await c.root.get()).exists,false);assert.deepEqual(await descendants(c.root),[]);
 for(const known of c.knownRefs){assert.equal((await known.get()).exists,false);assert.deepEqual(await known.listCollections(),[]);}
 verifiedCleanups++;console.log(`Synthetic files identity cleanup verified ${verifiedCleanups}/${expectedTests}`);
 }finally{await c.db.terminate();}}});
after(()=>{assert.equal(verifiedCleanups,expectedTests,'Every synthetic root must be removed and verified');console.log(`Synthetic files identity cleanup total: ${verifiedCleanups}/${expectedTests}`);});

async function fixture(){
 assertSafeEnvironment();const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});assertSafeClient(db);
 const root=db.collection(collection).doc(randomUUID()),backend=new FirestoreBackend(db,root);
 const c={db,root,backend,knownRefs:[],markerConfirmed:false,marker:{purpose:'vistavo-files-identity-fence-synthetic',project,nonce:randomUUID()},
  uid:'synthetic-files-owner-'+randomUUID(),otherUid:'synthetic-files-other-'+randomUUID(),tokenChecks:0,nudges:0};
 assertSafeRoot(c);contexts.push(c);
 assert.equal((await root.get()).exists,false);assert.deepEqual(await descendants(root),[]);
 await root.create(c.marker);const marker=await root.get();assert(marker.exists);assert.deepEqual(marker.data(),c.marker);assert.deepEqual(await descendants(root),[]);c.markerConfirmed=true;
 c.account=await backend.accountForUid(c.uid);c.other=await backend.accountForUid(c.otherUid);
 c.identityId=sha(JSON.stringify(['firebase',c.uid]));c.otherIdentityId=sha(JSON.stringify(['firebase',c.otherUid]));
 c.knownRefs.push(ref(c,'accounts',c.account),ref(c,'accounts',c.other),ref(c,'identities',c.identityId),ref(c,'identities',c.otherIdentityId));
 const bytes=Buffer.from('Synthetic private video bytes.'),size=bytes.length,contentSha=sha(bytes),inputId=randomUUID(),plan=objectPlan(inputId,size,size);
 const generation='9007199254740993',object={key:plan.final,generation,size},video={duration:2,width:320,height:180,audioTracks:1},expiry=Date.now()+3600000;
 const objects={reads:0,barriers:0,data:new Map([[object.key,{generation,bytes:Buffer.from(bytes)}]]),
  async read(requested,range){this.reads++;const entry=this.data.get(requested.key);assert(entry);assert.equal(entry.generation,requested.generation);
   return Readable.from([range?entry.bytes.subarray(range.start,range.end+1):entry.bytes]);},
  async barrier(){this.barriers++;throw Error('Unexpected synthetic object barrier');},
  async metadata(){throw Error('Unexpected synthetic object metadata');},
  async putOnce(){throw Error('Unexpected synthetic object write');},
  async composeOnce(){throw Error('Unexpected synthetic object compose');},
 };
 const files=new FirestoreFiles(db,root,objects,{chunkBytes:size});
 Object.assign(c,{inputId,bytes,objects,files});
 const upload=ref(c,'uploads',inputId),input=ref(c,'inputs',inputId),outbox=ref(c,'fileOutbox',inputId);
 c.knownRefs.push(upload,input,outbox);
 await upload.create({id:inputId,accountId:c.account,name:'synthetic.mp4',size,expectedSha:contentSha,expiresAtMs:expiry,
  chunkBytes:size,plan,state:'ready',offset:size,chunks:[{index:0,size,sha256:contentSha,generation:'2'}],manifestSha:sha('synthetic manifest'),
  quotaHeld:size,quotaMode:'committed',activeHeld:false,leaseToken:null,leaseUntil:null,attempts:1,
  receipt:{object,sha256:contentSha,video,manifestSha:sha('synthetic manifest')},failure:null,purgeState:'pending'});
 await input.create({accountId:c.account,expiresAtMs:expiry,sha256:contentSha,deleted:false,ready:true,unknownCount:0,
  storage:{bucket:privateBucket,key:plan.final,generation,size,sha256:contentSha},metadata:video});
 await outbox.create({state:'done',nextAttemptAt:0,dispatchToken:null,dispatchLeaseUntil:null});
 c.call=syntheticHandler(c);return c;
}
const target=c=>'/api/cloud/uploads/'+c.inputId;
async function state(c){
 const [input,upload,outbox,account]=await Promise.all([ref(c,'inputs',c.inputId).get(),ref(c,'uploads',c.inputId).get(),ref(c,'fileOutbox',c.inputId).get(),ref(c,'accounts',c.account).get()]);
 const objects=[...c.objects.data].map(([key,value])=>({key,generation:value.generation,size:value.bytes.length,sha:sha(value.bytes)})).sort((a,b)=>a.key.localeCompare(b.key));
 return {input:input.data(),upload:upload.data(),outbox:outbox.data(),account:account.data(),objects};
}
async function waitAtGate(entered,pending){
 let timer;
 try{await Promise.race([entered,pending.then(()=>{throw Error('Synthetic route bypassed barrier');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic barrier timed out')),10000);})]);}
 finally{clearTimeout(timer);}
}

test('control: owner can download and a different account cannot',async()=>{
 const c=await fixture(),before=await state(c),foreign=await c.call(target(c)+'/content','GET','synthetic-other');
 assert.equal(foreign.statusCode,404);assert.equal(c.objects.reads,0);assert(isDeepStrictEqual(await state(c),before));
 const owner=await c.call(target(c)+'/content');assert.equal(owner.statusCode,200);assert.deepEqual(owner.body,c.bytes);
 assert.equal(owner.headers['cache-control'],'no-store');assert.equal(c.objects.reads,1);assert.equal(c.tokenChecks,2);
});
test('control: owner can remove and a different account cannot',async()=>{
 const c=await fixture(),before=await state(c),foreign=await c.call(target(c),'DELETE','synthetic-other');
 assert.equal(foreign.statusCode,404);assert(isDeepStrictEqual(await state(c),before));assert.equal(c.nudges,0);
 const owner=await c.call(target(c),'DELETE');assert.equal(owner.statusCode,202);
 const after=await state(c);assert.equal(after.input.deleted,true);assert.equal(after.input.ready,false);assert.equal(after.upload.state,'deleting');
 assert.equal(after.outbox.state,'pending');assert.equal(c.nudges,1);assert.equal(c.objects.reads,0);assert.equal(c.objects.barriers,0);
 assert(isDeepStrictEqual(after.objects,before.objects));assert.equal(c.tokenChecks,2);
});

for(const mutation of ['removed','reassigned'])for(const operation of ['download','remove']){
 test(`identity ${mutation} before ${operation} transaction must deny the original requester`,async()=>{
  const c=await fixture(),method=operation+'ForUid',original=c.files[method].bind(c.files),before=await state(c);let enter,release,entries=0;
  const entered=new Promise(resolve=>{enter=resolve;}),resume=new Promise(resolve=>{release=resolve;});
  c.files[method]=async(...args)=>{entries++;assert.equal(args[0],c.account);assert.equal(args[1],c.inputId);assert.equal(args[2],c.uid);enter();await resume;return original(...args);};
  const pending=c.call(target(c)+(operation==='download'?'/content':''),operation==='download'?'GET':'DELETE');
  try{
   await waitAtGate(entered,pending);const identity=ref(c,'identities',c.identityId);
   if(mutation==='removed')await identity.delete();else await identity.update({accountId:c.other});
   release();const response=await pending,after=await state(c);
   const observed={denied:[401,403,404].includes(response.statusCode),noObjectRead:c.objects.reads===0,noBarrier:c.objects.barriers===0,
    noNudge:c.nudges===0,inputUnchanged:isDeepStrictEqual(after.input,before.input),uploadUnchanged:isDeepStrictEqual(after.upload,before.upload),
    outboxUnchanged:isDeepStrictEqual(after.outbox,before.outbox),accountUnchanged:isDeepStrictEqual(after.account,before.account),
    objectsUnchanged:isDeepStrictEqual(after.objects,before.objects),noContent:!response.body.includes(c.bytes),oneEntry:entries===1,oneTokenCheck:c.tokenChecks===1};
   const safe=Object.fromEntries(Object.keys(observed).map(key=>[key,true]));
   assert.deepEqual(observed,safe,`Expected safe denial after ${mutation} before ${operation}`);
  }finally{release();c.files[method]=original;await pending.catch(()=>undefined);}
 });
}
