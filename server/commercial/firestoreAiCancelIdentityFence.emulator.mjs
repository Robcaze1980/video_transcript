// Synthetic local cancellation race tests. A fake verified identity enters the
// real HTTP handler; Firestore is the local emulator and no provider is called.
// This test does not verify a real Firebase token, IAM, or deployed resources.
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
import {AI_CATALOG_VERSION} from './aiContracts.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_cancel_identity_synthetic';
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');let verifiedCleanups=0;
const ref=(c,name,id)=>c.root.collection(name).doc(id);
function assertSafeEnvironment(){
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_IDENTITY_FENCE,'1');
 assert.equal(process.env.LV_REVIEW_CONTRACT,'1');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','FIREBASE_CONFIG','K_SERVICE'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 assert.ok(process.env.USERPROFILE);assert.equal(process.env.USERPROFILE,process.env.APPDATA);assert.equal(process.env.USERPROFILE,process.env.LOCALAPPDATA);
 const profile=resolve(process.env.USERPROFILE),base=resolve('outputs/lv019-b-cancel-identity-fence-runs'),parts=relative(base,profile).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(profile).toLowerCase(),profile.toLowerCase());assert.equal(existsSync(join(profile,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(db){
 assert.equal(db.projectId,project);assert.equal(db.databaseId,'(default)');
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
function syntheticHandler(c){
 const handler=firestoreHttp({origin:'http://127.0.0.1',backend:c.backend,ai:c.ai,identity:{async verifyIdToken(token,checkRevoked){
  assert.equal(checkRevoked,true);c.tokenChecks++;
  if(token==='synthetic-owner')return {uid:c.uid,email_verified:true};
  if(token==='synthetic-other')return {uid:c.otherUid,email_verified:true};
  throw Error('Synthetic invalid token');
 }}});
 return async(path,method='GET',token='synthetic-owner',headers={})=>{
  const req=Readable.from([]);req.url=path;req.method=method;req.headers={origin:'http://127.0.0.1',authorization:'Bearer '+token,...headers};
  const res=new SyntheticResponse();await handler(req,res);await finished(res);return res;
 };
}
before(async()=>{assertSafeEnvironment();assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
 assertSafeRoot(c);if(!c.markerConfirmed){console.error(`Synthetic identity root preserved: unconfirmed marker ${c.root.path}`);throw Error('Refusing cleanup without a confirmed synthetic marker');}
 const marker=await c.root.get(),data=marker.data();if(!marker.exists||!data||Object.keys(data).sort().join(',')!=='nonce,project,purpose'||data.nonce!==c.marker.nonce||data.project!==c.marker.project||data.purpose!==c.marker.purpose){console.error(`Synthetic identity root preserved: changed marker ${c.root.path}`);throw Error('Refusing cleanup after synthetic marker changed');}
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await descendants(c.root),[]);verifiedCleanups++;console.log(`Synthetic cancel identity cleanup verified ${verifiedCleanups}/14`);
 }finally{await c.db.terminate();}}});
after(()=>{assert.equal(verifiedCleanups,14,'Every synthetic root must be removed and verified');console.log('Synthetic cancel identity cleanup total: 14/14');});

async function fixture(){
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});assertSafeClient(db);
 const root=db.collection(collection).doc(randomUUID()),backend=new FirestoreBackend(db,root),uid='synthetic-owner-'+randomUUID(),otherUid='synthetic-other-'+randomUUID();
 const c={db,root,backend,uid,otherUid,tokenChecks:0,markerConfirmed:false,marker:{purpose:'vistavo-cancel-identity-synthetic',project,nonce:randomUUID()}};assertSafeRoot(c);contexts.push(c);
 assert.equal((await root.get()).exists,false,'Synthetic root must start absent');assert.deepEqual(await descendants(root),[],'Synthetic root must start without descendants');
 await root.create(c.marker);const marker=await root.get();assert.ok(marker.exists);assert.deepEqual(marker.data(),c.marker);assert.deepEqual(await descendants(root),[]);c.markerConfirmed=true;
 const account=await backend.accountForUid(uid),other=await backend.accountForUid(otherUid),input=randomUUID(),sourceSha=sha('synthetic video');
 Object.assign(c,{account,other,input,identityId:sha(JSON.stringify(['firebase',uid]))});
 const objects={reads:0,data:new Map(),async read(object,range){this.reads++;const entry=this.data.get(object.key);assert.ok(entry);assert.equal(entry.generation,object.generation);return Readable.from(range?entry.bytes.subarray(range.start,range.end+1):entry.bytes);}};
 const ai=new FirestoreAi(db,root,backend,objects);Object.assign(c,{objects,ai});
 for(const who of [account,other])await ref(c,'accounts',who).update({aiPilot:true,simulationOnly:true});
 await backend.creditVerifiedPurchase(account,'synthetic-fixture-'+randomUUID(),10,1,'synthetic-only','sandbox');
 await ref(c,'inputs',input).create({accountId:account,expiresAtMs:Date.now()+3600000,sha256:sourceSha,deleted:false,ready:true,unknownCount:0,metadata:{duration:2,audioTracks:1},storage:{bucket:'vistavo-prod-107404655346-media',key:'candidate-files-v1/'+input+'/video.mp4',generation:'9007199254740993',size:100,sha256:sourceSha}});
 await backend.saveProject(account,input,0,'Synthetic private text.');
 c.jobId=await backend.reserve(account,input,'synthetic-identity-race',2,'translation:en',1,AI_CATALOG_VERSION);
 assert.equal((await backend.job(account,c.jobId)).state,'queued');
 assert.equal((await ref(c,'identities',c.identityId).get()).get('accountId'),account);c.call=syntheticHandler(c);return c;
}
const path=c=>'/api/cloud/ai/jobs/'+c.jobId;
const genericPath=c=>'/api/cloud/jobs/'+c.jobId;
const cancelMethod=c=>typeof c.backend.cancelForUid==='function'?'cancelForUid':'cancel';
const jobMethod=c=>typeof c.backend.jobForUid==='function'?'jobForUid':'job';
async function snapshot(c){
 const refs=[['account',ref(c,'accounts',c.account)],['job',ref(c,'jobs',c.jobId)],['input',ref(c,'inputs',c.input)],['artifact',ref(c,'artifacts',c.jobId)],['reserve',ref(c,'movements','reserve:'+c.jobId)],['terminal',ref(c,'movements','terminal:'+c.jobId)],['outbox',ref(c,'outbox',c.jobId)],['billingOutbox',ref(c,'billingOutbox',c.jobId)]];
 const docs=await c.db.getAll(...refs.map(([,value])=>value));return Object.fromEntries(docs.map((doc,index)=>[refs[index][0],{exists:doc.exists,data:doc.exists?JSON.parse(JSON.stringify(doc.data())):null}]));
}

test('control: verified owner can cancel the queued synthetic job',async()=>{
 const c=await fixture(),before=await snapshot(c),response=await c.call(path(c),'DELETE'),after=await snapshot(c);
 assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body.toString()).state,'cancelled');assert.equal(before.job.data.state,'queued');assert.equal(after.job.data.state,'cancelled');
 assert.equal(after.account.data.available,before.account.data.available+2);assert.equal(after.account.data.reserved,before.account.data.reserved-2);assert.equal(after.terminal.data.kind,'release');assert.equal(c.objects.reads,0);assert.equal(c.tokenChecks,1);
});

test('control: another account cannot cancel and changes no synthetic records',async()=>{
 const c=await fixture(),before=await snapshot(c),method=cancelMethod(c),original=c.backend[method].bind(c.backend);let calls=0;
 c.backend[method]=async(...args)=>{calls++;return original(...args);};
 try{const response=await c.call(path(c),'DELETE','synthetic-other');assert.equal(response.statusCode,404);assert.equal(calls,0);assert.deepEqual(await snapshot(c),before);assert.equal(c.objects.reads,0);assert.equal(c.tokenChecks,1);}finally{c.backend[method]=original;}
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} before cancellation must not change the job or balance`,async()=>{
 const c=await fixture(),before=await snapshot(c),method=cancelMethod(c),original=c.backend[method].bind(c.backend),originalStatus=c.ai.status.bind(c.ai);let enter,release,entries=0,statusChecks=0;
 const entered=new Promise(resolve=>{enter=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 c.ai.status=async(...args)=>{const result=await originalStatus(...args);assert.equal(args[2],c.uid);statusChecks++;return result;};
 c.backend[method]=async(...args)=>{entries++;assert.equal(args[0],c.account);assert.equal(args[1],c.jobId);if(method==='cancelForUid')assert.equal(args[2],c.uid);assert.equal(statusChecks,1);enter();await resume;return original(...args);};
 const pending=c.call(path(c),'DELETE','synthetic-owner');
 try{
  await Promise.race([entered,pending.then(()=>{throw Error('The synthetic route bypassed the transaction barrier');})]);
  const identity=ref(c,'identities',c.identityId);
  if(mutation==='removed')await identity.delete();else if(mutation==='reassigned')await identity.update({accountId:c.other});else await identity.update({uid:c.otherUid});
  release();const response=await pending;
  const after=await snapshot(c);assert.ok([401,403,404].includes(response.statusCode),`Expected a clean denial after ${mutation}; got ${response.statusCode}`);
  assert.deepEqual({state:after.job.data.state,available:after.account.data.available,reserved:after.account.data.reserved,terminal:after.terminal.exists},{state:before.job.data.state,available:before.account.data.available,reserved:before.account.data.reserved,terminal:before.terminal.exists},`Synthetic cancellation changed state or balance after ${mutation}`);
  assert.deepEqual(after,before);assert.equal(c.objects.reads,0);assert.equal(entries,1);assert.equal(statusChecks,1);assert.equal(c.tokenChecks,1);
 }finally{release();c.backend[method]=original;c.ai.status=originalStatus;}
});

test('generic control: verified owner can cancel the queued synthetic job',async()=>{
 const c=await fixture(),before=await snapshot(c),response=await c.call(genericPath(c),'DELETE'),after=await snapshot(c);
 assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body.toString()).state,'cancelled');assert.equal(before.job.data.state,'queued');assert.equal(after.job.data.state,'cancelled');
 assert.equal(after.account.data.available,before.account.data.available+2);assert.equal(after.account.data.reserved,before.account.data.reserved-2);assert.equal(after.terminal.data.kind,'release');assert.equal(c.objects.reads,0);assert.equal(c.tokenChecks,1);
});

test('generic control: another account cannot cancel and changes no synthetic records',async()=>{
 const c=await fixture(),before=await snapshot(c),response=await c.call(genericPath(c),'DELETE','synthetic-other');
 assert.equal(response.statusCode,404);assert.deepEqual(await snapshot(c),before);assert.equal(c.objects.reads,0);assert.equal(c.tokenChecks,1);
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`generic identity ${mutation} before cancellation must not change the job or balance`,async()=>{
 const c=await fixture(),before=await snapshot(c),method=cancelMethod(c),original=c.backend[method].bind(c.backend);let enter,release,entries=0;
 const entered=new Promise(resolve=>{enter=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 c.backend[method]=async(...args)=>{entries++;assert.equal(args[0],c.account);assert.equal(args[1],c.jobId);if(method==='cancelForUid')assert.equal(args[2],c.uid);enter();await resume;return original(...args);};
 const pending=c.call(genericPath(c),'DELETE','synthetic-owner');
 try{
  await Promise.race([entered,pending.then(()=>{throw Error('The synthetic route bypassed the transaction barrier');})]);
  const identity=ref(c,'identities',c.identityId);
  if(mutation==='removed')await identity.delete();else if(mutation==='reassigned')await identity.update({accountId:c.other});else await identity.update({uid:c.otherUid});
  release();const response=await pending,after=await snapshot(c);
  assert.ok([401,403,404].includes(response.statusCode),`Expected a clean generic denial after ${mutation}; got ${response.statusCode}`);
  assert.deepEqual({state:after.job.data.state,available:after.account.data.available,reserved:after.account.data.reserved,terminal:after.terminal.exists},{state:before.job.data.state,available:before.account.data.available,reserved:before.account.data.reserved,terminal:before.terminal.exists},`Synthetic generic cancellation changed state or balance after ${mutation}`);
  assert.deepEqual(after,before);assert.equal(c.objects.reads,0);assert.equal(entries,1);assert.equal(c.tokenChecks,1);
 }finally{release();c.backend[method]=original;}
});

test('generic control: owner may read status while another account is denied',async()=>{
 const c=await fixture(),before=await snapshot(c),owner=await c.call(genericPath(c)),other=await c.call(genericPath(c),'GET','synthetic-other');
 assert.equal(owner.statusCode,200);assert.equal(JSON.parse(owner.body.toString()).id,c.jobId);assert.equal(JSON.parse(owner.body.toString()).state,'queued');
 assert.equal(other.statusCode,404);assert.deepEqual(await snapshot(c),before);assert.equal(c.tokenChecks,2);assert.equal(c.objects.reads,0);
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`generic identity ${mutation} before status read must not disclose the job`,async()=>{
 const c=await fixture(),before=await snapshot(c),method=jobMethod(c),original=c.backend[method].bind(c.backend);let enter,release,entries=0;
 const entered=new Promise(resolve=>{enter=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 c.backend[method]=async(...args)=>{entries++;assert.equal(args[0],c.account);assert.equal(args[1],c.jobId);if(method==='jobForUid')assert.equal(args[2],c.uid);enter();await resume;return original(...args);};
 const pending=c.call(genericPath(c),'GET','synthetic-owner');
 try{
  await Promise.race([entered,pending.then(()=>{throw Error('The synthetic route bypassed the read barrier');})]);
  const identity=ref(c,'identities',c.identityId);
  if(mutation==='removed')await identity.delete();else if(mutation==='reassigned')await identity.update({accountId:c.other});else await identity.update({uid:c.otherUid});
  release();const response=await pending;
  assert.ok([401,403,404].includes(response.statusCode),`Expected generic status denial after ${mutation}; got ${response.statusCode}`);
  assert.equal(response.body.includes(Buffer.from(c.jobId)),false);assert.deepEqual(await snapshot(c),before);assert.equal(c.objects.reads,0);assert.equal(entries,1);assert.equal(c.tokenChecks,1);
 }finally{release();c.backend[method]=original;}
});
