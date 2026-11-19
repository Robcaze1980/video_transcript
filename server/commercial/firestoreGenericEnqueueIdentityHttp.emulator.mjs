// Synthetic generic POST identity race fixture. Only the reviewed launcher may
// run it against demo Firestore at 127.0.0.1:8185. HTTP, token verification and
// quotation are in memory; no Account service, AI provider or real charge occurs.
// Tests describe an expected denial; a RED run demonstrates the current race.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,realpathSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {Readable,Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import {isDeepStrictEqual} from 'node:util';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {firestoreHttp} from './firestoreHttp.ts';
import {privateBucket} from './privateObjectPlan.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_generic_enqueue_identity_synthetic',testCount=13;
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');let verifiedCleanups=0;
const ref=(c,name,id)=>c.root.collection(name).doc(id);
function assertSafeEnvironment(){
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');assert.equal(process.env.LV_GENERIC_ENQUEUE_IDENTITY_CONTRACT,'1');
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const name of ['HOME','CODEX_HOME','NODE_OPTIONS'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','FIREBASE_CONFIG','K_SERVICE','K_REVISION','FUNCTION_TARGET'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 assert.ok(process.env.USERPROFILE);assert.equal(process.env.USERPROFILE,process.env.APPDATA);assert.equal(process.env.USERPROFILE,process.env.LOCALAPPDATA);
 const profile=resolve(process.env.USERPROFILE),base=resolve('outputs/lv019-b-generic-enqueue-identity-http-runs'),parts=relative(base,profile).split(sep);
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
async function waitForBarrier(barrier,pending){let timer;try{await Promise.race([barrier.entered,pending.then(()=>{throw Error('Route ended before synthetic enqueue barrier');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic enqueue barrier timed out')),10000);})]);}finally{clearTimeout(timer);}}

class SyntheticResponse extends Writable{
 constructor(){super();this.headers={};this.statusCode=200;this.headersSent=false;this.parts=[];}
 setHeader(name,value){this.headers[name.toLowerCase()]=String(value);}
 writeHead(status,headers={}){this.statusCode=status;this.headersSent=true;for(const [key,value] of Object.entries(headers))this.setHeader(key,value);return this;}
 _write(chunk,_encoding,callback){this.parts.push(Buffer.from(chunk));callback();}
 get body(){return Buffer.concat(this.parts);}
}
function makeClient(c){
 const handler=firestoreHttp({origin:'http://127.0.0.1',backend:c.backend,quote:async(...args)=>{
  c.quoteCalls++;assert.deepEqual(args,[c.account,c.input,'transcript:es']);
  if(c.quoteGate){const barrier=c.quoteGate;c.quoteGate=null;barrier.enter();await barrier.resume;}
  return 2;
 },identity:{async verifyIdToken(token,checkRevoked){
  assert.equal(checkRevoked,true);c.tokenChecks++;
  if(token==='synthetic-owner')return {uid:c.uid,email_verified:true};
  if(token==='synthetic-other')return {uid:c.otherUid,email_verified:true};
  throw Error('Synthetic invalid token');
 }}});
 return async(data,token='synthetic-owner')=>{
  const bytes=Buffer.from(JSON.stringify(data)),req=Readable.from([bytes]);req.url='/api/cloud/jobs';req.method='POST';
  req.headers={origin:'http://127.0.0.1',authorization:'Bearer '+token,'content-type':'application/json','content-length':String(bytes.length)};
  const res=new SyntheticResponse();await handler(req,res);await finished(res);return res;
 };
}
function request(c,requestKey=randomUUID()){return {inputId:c.input,requestKey,operation:'transcript:es',expectedRevision:1};}
function assertSafeDenial(response){
 assert.ok([401,403,404].includes(response.statusCode));assert.equal(response.headers['cache-control'],'no-store');
 const payload=JSON.parse(response.body.toString('utf8'));assert.deepEqual(Object.keys(payload),['error']);assert.ok(['request_rejected','not_found'].includes(payload.error));
 assert.equal(response.body.includes(Buffer.from('Synthetic project draft')),false);
}

before(async()=>{assertSafeEnvironment();assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
 assertSafeEnvironment();assertSafeClient(c.db);assertSafeRoot(c);
 if(!c.markerConfirmed){console.error(`Synthetic generic enqueue root preserved: unconfirmed marker ${c.root.path}`);throw Error('Refusing cleanup without a confirmed synthetic marker');}
 const marker=await c.root.get(),data=marker.data();
 if(!marker.exists||!data||Object.keys(data).sort().join(',')!=='nonce,project,purpose'||data.nonce!==c.marker.nonce||data.project!==c.marker.project||data.purpose!==c.marker.purpose){console.error(`Synthetic generic enqueue root preserved: changed marker ${c.root.path}`);throw Error('Refusing cleanup after synthetic marker changed');}
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await descendants(c.root),[]);
 verifiedCleanups++;console.log(`Synthetic generic enqueue identity cleanup verified ${verifiedCleanups}/${testCount}`);
 }finally{await c.db.terminate();}}});
after(()=>{assert.equal(verifiedCleanups,testCount,'Every synthetic root must be removed and verified');console.log(`Synthetic generic enqueue identity cleanup total: ${verifiedCleanups}/${testCount}`);});

async function fixture({credits=10}={}){
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});assertSafeClient(db);
 const root=db.collection(collection).doc(randomUUID()),backend=new FirestoreBackend(db,root),uid='synthetic-owner-'+randomUUID(),otherUid='synthetic-other-'+randomUUID();
 const c={db,root,backend,uid,otherUid,quoteCalls:0,quoteGate:null,tokenChecks:0,markerConfirmed:false,marker:{purpose:'vistavo-generic-enqueue-identity-synthetic',project,nonce:randomUUID()}};assertSafeRoot(c);contexts.push(c);
 assert.equal((await root.get()).exists,false,'Synthetic root must start absent');assert.deepEqual(await descendants(root),[],'Synthetic root must have no descendants');
 await root.create(c.marker);const marker=await root.get();assert.ok(marker.exists);assert.deepEqual(marker.data(),c.marker);assert.deepEqual(await descendants(root),[]);c.markerConfirmed=true;
 const account=await backend.accountForUid(uid),other=await backend.accountForUid(otherUid),input=randomUUID(),sourceSha=sha('synthetic video');
 Object.assign(c,{account,other,input,identityId:sha(JSON.stringify(['firebase',uid]))});
 if(credits)await backend.creditVerifiedPurchase(account,'synthetic-enqueue-'+randomUUID(),credits,1,'synthetic-only','sandbox');
 await ref(c,'inputs',input).create({accountId:account,expiresAtMs:Date.now()+3600000,sha256:sourceSha,deleted:false,ready:true,unknownCount:0,
  metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:'candidate-files-v1/'+input+'/video.mp4',generation:'9007199254740993',size:100,sha256:sourceSha}});
 await backend.saveProject(account,input,0,'Synthetic project draft');c.call=makeClient(c);return c;
}
async function state(c){
 const rows={};for(const name of ['identities','accounts','inputs','projects','requests','jobs','jobAccounting','outbox','movements','artifacts','billingIntents','billingOutbox','billingGuards','billingIntentWitnesses','billingIntentJobMarkers','providerCalls']){
  const docs=await c.root.collection(name).orderBy('__name__').get();rows[name]=docs.docs.map(doc=>({id:doc.id,data:doc.data()}));
 }
 return rows;
}
async function mutateIdentity(c,mutation){const identity=ref(c,'identities',c.identityId);if(mutation==='removed')await identity.delete();else if(mutation==='reassigned')await identity.update({accountId:c.other});else await identity.update({uid:c.otherUid});}
async function restoreIdentity(c){await ref(c,'identities',c.identityId).set({accountId:c.account,uid:c.uid});}
function describeUnsafe(response,before,after){
 let payload={};try{payload=JSON.parse(response.body.toString('utf8'));}catch{}
 return `status=${response.statusCode} returnedId=${typeof payload.id==='string'} jobsBefore=${before.jobs.length} jobsAfter=${after.jobs.length} outboxBefore=${before.outbox.length} outboxAfter=${after.outbox.length} accountsChanged=${!isDeepStrictEqual(before.accounts,after.accounts)}`;
}
function assertUnchangedDenial(response,before,after,scenario){
 const safe=[401,403,404].includes(response.statusCode),same=isDeepStrictEqual(before,after);
 assert.ok(safe&&same,`IDENTITY_RACE_UNSAFE ${scenario}: ${describeUnsafe(response,before,after)}`);
 assertSafeDenial(response);
}

test('control: owner starts once and replay returns the same synthetic job',async()=>{
 const c=await fixture(),data=request(c),before=await state(c),first=await c.call(data);assert.equal(first.statusCode,202);
 const jobId=JSON.parse(first.body.toString()).id;assert.match(jobId,/^[a-f0-9-]{36}$/);const after=await state(c);
 assert.equal(after.jobs.length,before.jobs.length+1);assert.equal(after.outbox.length,before.outbox.length+1);assert.equal(after.requests.length,before.requests.length+1);
 assert.equal((await c.backend.readBalance(c.account)).available,8);assert.equal((await c.backend.readBalance(c.account)).reserved,2);
 const replay=await c.call(data);assert.equal(replay.statusCode,202);assert.equal(JSON.parse(replay.body.toString()).id,jobId);assert.deepEqual(await state(c),after);assert.equal(c.quoteCalls,1);
});

test('control: another account cannot reserve or obtain the owner job',async()=>{
 const c=await fixture(),data=request(c),first=await c.call(data);assert.equal(first.statusCode,202);const before=await state(c),quotes=c.quoteCalls;
 const denied=await c.call(data,'synthetic-other');assertSafeDenial(denied);assert.equal(c.quoteCalls,quotes);assert.deepEqual(await state(c),before);
});

test('control: insufficient synthetic balance does not create a job or outbox',async()=>{
 const c=await fixture({credits:0}),before=await state(c),response=await c.call(request(c));assert.equal(response.statusCode,402);
 assert.deepEqual(await state(c),before);assert.equal(c.quoteCalls,1);
});

test('missing account must not disclose a previous job',async()=>{
 const c=await fixture(),data=request(c),first=await c.call(data);assert.equal(first.statusCode,202);const jobId=JSON.parse(first.body.toString()).id;
 await ref(c,'accounts',c.account).delete();const before=await state(c),quotes=c.quoteCalls,response=await c.call(data),after=await state(c);
 assertUnchangedDenial(response,before,after,'missing-account');assert.equal(response.body.includes(Buffer.from(jobId)),false);assert.equal(c.quoteCalls,quotes);
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} before prior lookup must not disclose a previous job`,async()=>{
 const c=await fixture(),data=request(c),first=await c.call(data);assert.equal(first.statusCode,202);const jobId=JSON.parse(first.body.toString()).id,before=await state(c);
 const barrier=gate(),method=typeof c.backend.priorRequestForUid==='function'?'priorRequestForUid':'priorRequest',original=c.backend[method];let calls=0;
 c.backend[method]=async function(...args){calls++;assert.equal(args[0],c.account);assert.equal(args[1],c.input);barrier.enter();await barrier.resume;return original.apply(this,args);};
 const pending=c.call(data);
 try{
  await waitForBarrier(barrier,pending);await mutateIdentity(c,mutation);barrier.release();const response=await pending;
  await restoreIdentity(c);const after=await state(c);assert.equal(calls,1);
  assertUnchangedDenial(response,before,after,`replay-${mutation}`);assert.equal(response.body.includes(Buffer.from(jobId)),false);
 }finally{barrier.release();c.backend[method]=original;await restoreIdentity(c);}
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} during quote must not reserve or create a job`,async()=>{
 const c=await fixture(),before=await state(c),barrier=gate();c.quoteGate=barrier;const pending=c.call(request(c));
 try{
  await waitForBarrier(barrier,pending);await mutateIdentity(c,mutation);barrier.release();const response=await pending;
  await restoreIdentity(c);const after=await state(c);assert.equal(c.quoteCalls,1);assertUnchangedDenial(response,before,after,`quote-${mutation}`);
 }finally{barrier.release();await restoreIdentity(c);}
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} inside reservation before first read must not reserve or create a job`,async()=>{
 const c=await fixture(),before=await state(c),barrier=gate(),method=typeof c.backend.reserveForUid==='function'?'reserveForUid':'reserve',original=c.backend[method],originalTransaction=c.db.runTransaction;let calls=0,transactions=0;
 c.backend[method]=async function(...args){
  calls++;assert.equal(args[0],c.account);assert.equal(args[1],c.input);
  // The handler has already resolved the account and entered reservation. Pause
  // the transaction callback before its first read, so identity changes can win
  // without holding an emulator document lock while the test changes it.
  c.db.runTransaction=function(callback,...options){return originalTransaction.call(this,async tx=>{transactions++;barrier.enter();await barrier.resume;return callback(tx);},...options);};
  try{return await original.apply(this,args);}finally{c.db.runTransaction=originalTransaction;}
 };
 const pending=c.call(request(c));
 try{
  await waitForBarrier(barrier,pending);await mutateIdentity(c,mutation);barrier.release();const response=await pending;
  await restoreIdentity(c);const after=await state(c);assert.equal(calls,1);assert.equal(transactions,1);assert.equal(c.quoteCalls,1);assertUnchangedDenial(response,before,after,`reserve-${mutation}`);
 }finally{barrier.release();c.backend[method]=original;c.db.runTransaction=originalTransaction;await restoreIdentity(c);}
});
