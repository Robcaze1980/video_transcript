// Synthetic project-identity HTTP fixture. Only the reviewed launcher may run it
// against demo Firestore on 127.0.0.1:8185. HTTP requests/responses and token
// verification are in memory; real Firebase, cloud IAM and user data are absent.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,realpathSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {Readable,Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {firestoreHttp} from './firestoreHttp.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_project_identity_synthetic',testCount=7;
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');let verifiedCleanups=0;
const ref=(c,name,id)=>c.root.collection(name).doc(id);
function assertSafeEnvironment(){
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');assert.equal(process.env.LV_PROJECT_IDENTITY_CONTRACT,'1');
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const name of ['HOME','CODEX_HOME','NODE_OPTIONS'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','FIREBASE_CONFIG','K_SERVICE','K_REVISION','FUNCTION_TARGET'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 assert.ok(process.env.USERPROFILE);assert.equal(process.env.USERPROFILE,process.env.APPDATA);assert.equal(process.env.USERPROFILE,process.env.LOCALAPPDATA);
 const profile=resolve(process.env.USERPROFILE),base=resolve('outputs/lv019-b-project-identity-http-runs'),parts=relative(base,profile).split(sep);
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
function makeClient(c){
 const handler=firestoreHttp({origin:'http://127.0.0.1',backend:c.backend,identity:{async verifyIdToken(token,checkRevoked){
  assert.equal(checkRevoked,true);c.tokenChecks++;
  if(token==='synthetic-owner')return {uid:c.uid,email_verified:true};
  if(token==='synthetic-other')return {uid:c.otherUid,email_verified:true};
  if(token==='synthetic-unverified')return {uid:c.uid,email_verified:false};
  throw Error('Synthetic invalid token');
 }}});
 return async(path,{method='GET',token='synthetic-owner',data}={})=>{
  const bytes=data===undefined?null:Buffer.from(JSON.stringify(data));const req=Readable.from(bytes?[bytes]:[]);req.url=path;req.method=method;
  req.headers={origin:'http://127.0.0.1',authorization:'Bearer '+token,...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{})};
  const res=new SyntheticResponse();await handler(req,res);await finished(res);return res;
 };
}
function assertDenied(response,status=404){
 assert.equal(response.statusCode,status);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['x-content-type-options'],'nosniff');
 const payload=JSON.parse(response.body.toString('utf8'));assert.deepEqual(Object.keys(payload),['error']);
 assert.ok(['request_rejected','not_found','invalid'].includes(payload.error));
 for(const sensitive of ['Synthetic owner project','Synthetic foreign project','Synthetic new text','Synthetic foreign-only text'])assert.equal(response.body.includes(Buffer.from(sensitive)),false,'Denied response disclosed a project');
}
const projectPath=id=>`/api/cloud/projects/${id}`;
const update=(draft='Synthetic new text',expectedRevision=1)=>({expectedRevision,draft});

before(async()=>{assertSafeEnvironment();assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
 assertSafeEnvironment();assertSafeClient(c.db);assertSafeRoot(c);
 if(!c.markerConfirmed){console.error(`Synthetic project identity root preserved: unconfirmed marker ${c.root.path}`);throw Error('Refusing cleanup without a confirmed synthetic marker');}
 const marker=await c.root.get(),data=marker.data();
 if(!marker.exists||!data||Object.keys(data).sort().join(',')!=='nonce,project,purpose'||data.nonce!==c.marker.nonce||data.project!==c.marker.project||data.purpose!==c.marker.purpose){console.error(`Synthetic project identity root preserved: changed marker ${c.root.path}`);throw Error('Refusing cleanup after synthetic marker changed');}
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await descendants(c.root),[]);
 verifiedCleanups++;console.log(`Synthetic project identity cleanup verified ${verifiedCleanups}/${testCount}`);
 }finally{await c.db.terminate();}}});
after(()=>{assert.equal(verifiedCleanups,testCount,'Every synthetic root must be removed and verified');console.log(`Synthetic project identity cleanup total: ${verifiedCleanups}/${testCount}`);});

async function fixture(){
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});assertSafeClient(db);
 const root=db.collection(collection).doc(randomUUID()),backend=new FirestoreBackend(db,root),uid='synthetic-owner-'+randomUUID(),otherUid='synthetic-other-'+randomUUID();
 const c={db,root,backend,uid,otherUid,tokenChecks:0,markerConfirmed:false,marker:{purpose:'vistavo-project-identity-synthetic',project,nonce:randomUUID()}};assertSafeRoot(c);contexts.push(c);
 assert.equal((await root.get()).exists,false,'Synthetic root must start absent');assert.deepEqual(await descendants(root),[],'Synthetic root must have no descendants');
 await root.create(c.marker);const marker=await root.get();assert.ok(marker.exists);assert.deepEqual(marker.data(),c.marker);assert.deepEqual(await descendants(root),[]);c.markerConfirmed=true;
 const account=await backend.accountForUid(uid),other=await backend.accountForUid(otherUid),input=randomUUID(),foreignInput=randomUUID(),newInput=randomUUID();
 Object.assign(c,{account,other,input,foreignInput,newInput,identityId:sha(JSON.stringify(['firebase',uid]))});
 for(const [id,owner] of [[input,account],[foreignInput,other],[newInput,account]])await ref(c,'inputs',id).create({accountId:owner,deleted:false,expiresAtMs:Date.now()+3600000});
 await backend.saveProject(account,input,0,'Synthetic owner project');await backend.saveProject(other,foreignInput,0,'Synthetic foreign project');
 c.call=makeClient(c);return c;
}
async function state(c){
 const rows={};for(const name of ['identities','accounts','inputs','projects','requests','movements','billingIntents','billingOutbox','billingGuards','providerCalls']){
  const docs=await c.root.collection(name).orderBy('__name__').get();rows[name]=docs.docs.map(doc=>({id:doc.id,data:doc.data()}));
 }
 return rows;
}
function gate(){let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),resume=new Promise(resolve=>{release=resolve;});return {entered,resume,enter,release};}
async function waitForBarrier(barrier,pending){let timer;try{await Promise.race([barrier.entered,pending.then(()=>{throw Error('Route ended before synthetic project identity barrier');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic identity barrier timed out')),10000);})]);}finally{clearTimeout(timer);}}

test('owner reads, updates and creates their own synthetic project',async()=>{
 const c=await fixture(),initial=await c.call(projectPath(c.input));assert.equal(initial.statusCode,200);assert.equal(JSON.parse(initial.body.toString()).draft,'Synthetic owner project');
 const changed=await c.call(projectPath(c.input),{method:'PUT',data:update()});assert.equal(changed.statusCode,200);assert.equal(JSON.parse(changed.body.toString()).revision,2);
 const reopened=await c.call(projectPath(c.input));assert.equal(reopened.statusCode,200);assert.equal(JSON.parse(reopened.body.toString()).draft,'Synthetic new text');
 const created=await c.call(projectPath(c.newInput),{method:'PUT',data:update('Synthetic new text',0)});assert.equal(created.statusCode,200);assert.equal(JSON.parse(created.body.toString()).revision,1);
 const fresh=await c.call(projectPath(c.newInput));assert.equal(fresh.statusCode,200);assert.equal(JSON.parse(fresh.body.toString()).draft,'Synthetic new text');
});

test('another account cannot read or update either owner project',async()=>{
 const c=await fixture(),before=await state(c);
 for(const [input,token] of [[c.input,'synthetic-other'],[c.foreignInput,'synthetic-owner']]){
  assertDenied(await c.call(projectPath(input),{token}));assertDenied(await c.call(projectPath(input),{method:'PUT',token,data:update()}));
 }
 assert.deepEqual(await state(c),before);
});

test('an existing project attributed to another owner is neither disclosed nor overwritten',async()=>{
 const c=await fixture(),anomalousInput=randomUUID();
 await ref(c,'inputs',anomalousInput).create({accountId:c.account,deleted:false,expiresAtMs:Date.now()+3600000});
 await ref(c,'projects',anomalousInput).create({accountId:c.other,inputId:anomalousInput,revision:1,draft:'Synthetic foreign-only text',updatedAtMs:Date.now()});
 const before=await state(c);assertDenied(await c.call(projectPath(anomalousInput)));assertDenied(await c.call(projectPath(anomalousInput),{method:'PUT',data:update()}));assert.deepEqual(await state(c),before);
});

test('invalid and unverified tokens or forged UID bodies do not read or change a project',async()=>{
 const c=await fixture(),before=await state(c);
 assertDenied(await c.call(projectPath(c.input),{token:'synthetic-invalid'}),401);assertDenied(await c.call(projectPath(c.input),{token:'synthetic-unverified'}),403);
 assertDenied(await c.call(projectPath(c.input),{method:'PUT',data:{...update(),uid:c.otherUid,accountId:c.other}}),400);assert.deepEqual(await state(c),before);
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} after account resolution denies project read and write`,async()=>{
 const c=await fixture(),before=await state(c),identity=ref(c,'identities',c.identityId);
 for(const operation of [
  {name:'readProjectForUid',options:{},uidIndex:2},
  {name:'saveProjectForUid',options:{method:'PUT',data:update()},uidIndex:4},
 ]){
  const barrier=gate(),original=c.backend[operation.name];let calls=0;
  c.backend[operation.name]=async function(...args){calls++;assert.equal(args[0],c.account);assert.equal(args[1],c.input);assert.equal(args[operation.uidIndex],c.uid);barrier.enter();await barrier.resume;return original.apply(this,args);};
  const pending=c.call(projectPath(c.input),operation.options);
  try{
   await waitForBarrier(barrier,pending);
   if(mutation==='removed')await identity.delete();else if(mutation==='reassigned')await identity.update({accountId:c.other});else await identity.update({uid:c.otherUid});
   barrier.release();assertDenied(await pending);assert.equal(calls,1);
  }finally{barrier.release();c.backend[operation.name]=original;await identity.set({accountId:c.account,uid:c.uid});}
  assert.deepEqual(await state(c),before);
 }
});
