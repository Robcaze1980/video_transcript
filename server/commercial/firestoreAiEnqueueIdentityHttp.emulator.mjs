// Synthetic AI quote/enqueue identity races. Only the reviewed launcher may run
// it against demo Firestore at 127.0.0.1:8185. HTTP and token verification are
// in memory; no Account service, object storage, AI provider or real charge is
// contacted. This does not test an external reservation/ACK or reconciliation.
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
import {FirestoreAi} from './firestoreAi.ts';
import {firestoreHttp} from './firestoreHttp.ts';
import {privateBucket} from './privateObjectPlan.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_ai_enqueue_identity_synthetic',testCount=12;
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');let verifiedCleanups=0;
const ref=(c,name,id)=>c.root.collection(name).doc(id);
function assertSafeEnvironment(){
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');assert.equal(process.env.LV_AI_ENQUEUE_IDENTITY_CONTRACT,'1');
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const name of ['HOME','CODEX_HOME','NODE_OPTIONS'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','FIREBASE_CONFIG','K_SERVICE','K_REVISION','FUNCTION_TARGET'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 assert.ok(process.env.USERPROFILE);assert.equal(process.env.USERPROFILE,process.env.APPDATA);assert.equal(process.env.USERPROFILE,process.env.LOCALAPPDATA);
 const profile=resolve(process.env.USERPROFILE),base=resolve('outputs/lv019-b-ai-enqueue-identity-http-runs'),parts=relative(base,profile).split(sep);
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
 const handler=firestoreHttp({origin:'http://127.0.0.1',backend:c.backend,ai:c.ai,identity:{async verifyIdToken(token,checkRevoked){
  assert.equal(checkRevoked,true);c.tokenChecks++;
  if(token==='synthetic-owner')return {uid:c.uid,email_verified:true};
  if(token==='synthetic-other')return {uid:c.otherUid,email_verified:true};
  throw Error('Synthetic invalid token');
 }}});
 return async(path,{method='GET',token='synthetic-owner',data}={})=>{
  const bytes=data===undefined?null:Buffer.from(JSON.stringify(data)),req=Readable.from(bytes?[bytes]:[]);req.url=path;req.method=method;
  req.headers={origin:'http://127.0.0.1',authorization:'Bearer '+token,...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{})};
  const res=new SyntheticResponse();await handler(req,res);await finished(res);return res;
 };
}
function request(c,requestKey=randomUUID()){return {inputId:c.input,requestKey,operation:'translation:en',expectedRevision:1};}
const quotePath=c=>`/api/cloud/ai/quote?inputId=${c.input}&operation=translation%3Aen&revision=1`;
const submit=(c,data,token='synthetic-owner')=>c.call('/api/cloud/ai/jobs',{method:'POST',data,token});
function assertSafeDenial(response){
 assert.ok([401,403,404].includes(response.statusCode));assert.equal(response.headers['cache-control'],'no-store');
 const payload=JSON.parse(response.body.toString('utf8'));assert.deepEqual(Object.keys(payload),['error']);assert.ok(['request_rejected','not_found'].includes(payload.error));
 assert.equal(response.body.includes(Buffer.from('Synthetic project draft')),false);
}

before(async()=>{assertSafeEnvironment();assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
 assertSafeEnvironment();assertSafeClient(c.db);assertSafeRoot(c);
 if(!c.markerConfirmed){console.error(`Synthetic AI enqueue root preserved: unconfirmed marker ${c.root.path}`);throw Error('Refusing cleanup without a confirmed synthetic marker');}
 const marker=await c.root.get(),data=marker.data();
 if(!marker.exists||!data||Object.keys(data).sort().join(',')!=='nonce,project,purpose'||data.nonce!==c.marker.nonce||data.project!==c.marker.project||data.purpose!==c.marker.purpose){console.error(`Synthetic AI enqueue root preserved: changed marker ${c.root.path}`);throw Error('Refusing cleanup after synthetic marker changed');}
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await descendants(c.root),[]);
 verifiedCleanups++;console.log(`Synthetic AI enqueue identity cleanup verified ${verifiedCleanups}/${testCount}`);
 }finally{await c.db.terminate();}}});
after(()=>{assert.equal(verifiedCleanups,testCount,'Every synthetic root must be removed and verified');console.log(`Synthetic AI enqueue identity cleanup total: ${verifiedCleanups}/${testCount}`);});

async function fixture({credits=10}={}){
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});assertSafeClient(db);
 const root=db.collection(collection).doc(randomUUID()),backend=new FirestoreBackend(db,root),uid='synthetic-owner-'+randomUUID(),otherUid='synthetic-other-'+randomUUID();
 const c={db,root,backend,uid,otherUid,tokenChecks:0,markerConfirmed:false,marker:{purpose:'vistavo-ai-enqueue-identity-synthetic',project,nonce:randomUUID()}};assertSafeRoot(c);contexts.push(c);
 assert.equal((await root.get()).exists,false,'Synthetic root must start absent');assert.deepEqual(await descendants(root),[],'Synthetic root must have no descendants');
 await root.create(c.marker);const marker=await root.get();assert.ok(marker.exists);assert.deepEqual(marker.data(),c.marker);assert.deepEqual(await descendants(root),[]);c.markerConfirmed=true;
 const account=await backend.accountForUid(uid),other=await backend.accountForUid(otherUid),input=randomUUID(),sourceSha=sha('synthetic video');
 Object.assign(c,{account,other,input,identityId:sha(JSON.stringify(['firebase',uid]))});
 for(const owner of [account,other])await ref(c,'accounts',owner).update({aiPilot:true,simulationOnly:true});
 const objects={calls:0,async read(){this.calls++;throw Error('Unexpected synthetic object read');},async putOnce(){this.calls++;throw Error('Unexpected synthetic object write');},async composeOnce(){this.calls++;throw Error('Unexpected synthetic object compose');},async barrier(){this.calls++;throw Error('Unexpected synthetic object barrier');}};
 c.objects=objects;c.ai=new FirestoreAi(db,root,backend,objects);
 if(credits)await backend.creditVerifiedPurchase(account,'synthetic-enqueue-'+randomUUID(),credits,1,'synthetic-only','sandbox');
 await ref(c,'inputs',input).create({accountId:account,expiresAtMs:Date.now()+3600000,sha256:sourceSha,deleted:false,ready:true,unknownCount:0,
  metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:'candidate-files-v1/'+input+'/video.mp4',generation:'9007199254740993',size:100,sha256:sourceSha}});
 await backend.saveProject(account,input,0,'');c.call=makeClient(c);return c;
}
async function state(c){
 const rows={};for(const name of ['identities','accounts','inputs','projects','requests','jobs','jobAccounting','outbox','movements','artifacts','billingIntents','billingOutbox','billingGuards','billingIntentWitnesses','billingIntentJobMarkers','providerCalls']){
  const docs=await c.root.collection(name).orderBy('__name__').get();rows[name]=docs.docs.map(doc=>({id:doc.id,data:doc.data()}));
 }
 return {rows,objectCalls:c.objects.calls};
}
async function mutateIdentity(c,mutation){const identity=ref(c,'identities',c.identityId);if(mutation==='removed')await identity.delete();else if(mutation==='reassigned')await identity.update({accountId:c.other});else await identity.update({uid:c.otherUid});}
async function restoreIdentity(c){await ref(c,'identities',c.identityId).set({accountId:c.account,uid:c.uid});}
function describeUnsafe(response,before,after){
 let payload={};try{payload=JSON.parse(response.body.toString('utf8'));}catch{}
 return `status=${response.statusCode} returnedId=${typeof payload.id==='string'} returnedQuote=${Object.hasOwn(payload,'units')} jobsBefore=${before.rows.jobs.length} jobsAfter=${after.rows.jobs.length} outboxBefore=${before.rows.outbox.length} outboxAfter=${after.rows.outbox.length} accountsChanged=${!isDeepStrictEqual(before.rows.accounts,after.rows.accounts)}`;
}
function assertUnchangedDenial(response,before,after,scenario){
 const safe=[401,403,404].includes(response.statusCode),same=isDeepStrictEqual(before,after);
 assert.ok(safe&&same,`IDENTITY_RACE_UNSAFE ${scenario}: ${describeUnsafe(response,before,after)}`);
 assertSafeDenial(response);
}

test('control: owner receives a quote and a single synthetic AI job on replay',async()=>{
 const c=await fixture(),data=request(c),before=await state(c),quote=await c.call(quotePath(c));assert.equal(quote.statusCode,200);assert.equal(JSON.parse(quote.body.toString()).units,2);
 const first=await submit(c,data);assert.equal(first.statusCode,202);const jobId=JSON.parse(first.body.toString()).id;assert.match(jobId,/^[a-f0-9-]{36}$/);
 const after=await state(c);assert.equal(after.rows.jobs.length,before.rows.jobs.length+1);assert.equal(after.rows.outbox.length,before.rows.outbox.length+1);assert.equal(after.rows.requests.length,before.rows.requests.length+1);
 assert.equal((await c.backend.readBalance(c.account)).available,8);assert.equal((await c.backend.readBalance(c.account)).reserved,2);
 const replay=await submit(c,data);assert.equal(replay.statusCode,202);assert.equal(JSON.parse(replay.body.toString()).id,jobId);assert.deepEqual(await state(c),after);assert.equal(c.objects.calls,0);
});

test('control: another account cannot quote or obtain the owner AI job',async()=>{
 const c=await fixture(),data=request(c),first=await submit(c,data);assert.equal(first.statusCode,202);const before=await state(c);
 assertSafeDenial(await c.call(quotePath(c),{token:'synthetic-other'}));assertSafeDenial(await submit(c,data,'synthetic-other'));assert.deepEqual(await state(c),before);assert.equal(c.objects.calls,0);
});

test('control: no synthetic balance permits quoting but not creating an AI job',async()=>{
 const c=await fixture({credits:0}),before=await state(c),quote=await c.call(quotePath(c));assert.equal(quote.statusCode,200);
 const response=await submit(c,request(c));assert.equal(response.statusCode,402);assert.deepEqual(await state(c),before);assert.equal(c.objects.calls,0);
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} before AI quote must not disclose the quote`,async()=>{
 const c=await fixture(),before=await state(c),barrier=gate(),original=c.ai.quoteForUid;let calls=0;
 c.ai.quoteForUid=async function(...args){calls++;assert.equal(args[0],c.account);assert.equal(args[1],c.input);assert.equal(args.at(-1),c.uid);barrier.enter();await barrier.resume;return original.apply(this,args);};
 const pending=c.call(quotePath(c));
 try{
  await waitForBarrier(barrier,pending);await mutateIdentity(c,mutation);barrier.release();const response=await pending;
  await restoreIdentity(c);const after=await state(c);assert.equal(calls,1);assertUnchangedDenial(response,before,after,`quote-${mutation}`);
 }finally{barrier.release();c.ai.quoteForUid=original;await restoreIdentity(c);}
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} before AI replay must not disclose the previous job`,async()=>{
 const c=await fixture(),data=request(c),first=await submit(c,data);assert.equal(first.statusCode,202);const jobId=JSON.parse(first.body.toString()).id,before=await state(c);
 const barrier=gate(),method='priorSimulatedRequestForEnqueueForUid',original=c.backend[method];let calls=0;
 c.backend[method]=async function(...args){calls++;assert.equal(args[0],c.account);assert.equal(args[1],c.input);assert.equal(args.at(-1),c.uid);barrier.enter();await barrier.resume;return original.apply(this,args);};
 const pending=submit(c,data);
 try{
  await waitForBarrier(barrier,pending);await mutateIdentity(c,mutation);barrier.release();const response=await pending;
  await restoreIdentity(c);const after=await state(c);assert.equal(calls,1);assertUnchangedDenial(response,before,after,`replay-${mutation}`);assert.equal(response.body.includes(Buffer.from(jobId)),false);
 }finally{barrier.release();c.backend[method]=original;await restoreIdentity(c);}
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} after AI quote must not reserve or create a simulated job`,async()=>{
 const c=await fixture(),before=await state(c),barrier=gate(),originalQuote=c.ai.quoteForUid,originalReserve=c.backend.reserveSimulatedAiForUid;let quoteCalls=0,reserveCalls=0;
 c.ai.quoteForUid=async function(...args){quoteCalls++;assert.equal(args[0],c.account);assert.equal(args[1],c.input);assert.equal(args.at(-1),c.uid);return originalQuote.apply(this,args);};
 c.backend.reserveSimulatedAiForUid=async function(...args){reserveCalls++;assert.equal(args[0],c.account);assert.equal(args[1],c.input);assert.equal(args.at(-1),c.uid);assert.equal(quoteCalls,1);barrier.enter();await barrier.resume;return originalReserve.apply(this,args);};
 const pending=submit(c,request(c));
 try{
  await waitForBarrier(barrier,pending);await mutateIdentity(c,mutation);barrier.release();const response=await pending;
  await restoreIdentity(c);const after=await state(c);assert.equal(quoteCalls,1);assert.equal(reserveCalls,1);assertUnchangedDenial(response,before,after,`sim-reserve-${mutation}`);
 }finally{barrier.release();c.ai.quoteForUid=originalQuote;c.backend.reserveSimulatedAiForUid=originalReserve;await restoreIdentity(c);}
});
