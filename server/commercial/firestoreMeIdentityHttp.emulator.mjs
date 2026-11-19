// Synthetic /me identity races against demo Firestore at 127.0.0.1:8185 only.
// HTTP, Firebase token verification and the Account response are in memory.
// The Account fake cannot contact any service and its response is never stored.
// This is not a proof of real Firebase revocation, IAM or Account behavior.
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
import {AccountBillingFault} from './accountBillingClient.ts';
import {firestoreHttp} from './firestoreHttp.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_me_identity_synthetic',testCount=15;
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');let verifiedCleanups=0;
const ref=(c,name,id)=>c.root.collection(name).doc(id);
function assertSafeEnvironment(){
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');assert.equal(process.env.LV_ME_IDENTITY_CONTRACT,'1');
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const name of ['HOME','CODEX_HOME','NODE_OPTIONS'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','FIREBASE_CONFIG','K_SERVICE','K_REVISION','FUNCTION_TARGET'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 assert.ok(process.env.USERPROFILE);assert.equal(process.env.USERPROFILE,process.env.APPDATA);assert.equal(process.env.USERPROFILE,process.env.LOCALAPPDATA);
 const profile=resolve(process.env.USERPROFILE),base=resolve('outputs/lv019-b-me-identity-http-runs'),parts=relative(base,profile).split(sep);
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
async function waitForBarrier(barrier,pending){let timer;try{await Promise.race([barrier.entered,pending.then(()=>{throw Error('Route ended before synthetic balance barrier');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic balance barrier timed out')),10000);})]);}finally{clearTimeout(timer);}}

class SyntheticResponse extends Writable{
 constructor(){super();this.headers={};this.statusCode=200;this.headersSent=false;this.parts=[];}
 setHeader(name,value){this.headers[name.toLowerCase()]=String(value);}
 writeHead(status,headers={}){this.statusCode=status;this.headersSent=true;for(const [key,value] of Object.entries(headers))this.setHeader(key,value);return this;}
 _write(chunk,_encoding,callback){this.parts.push(Buffer.from(chunk));callback();}
 get body(){return Buffer.concat(this.parts);}
}
class FakeAccountBalance{
 calls=[];mode='ok';pendingGate=null;
 constructor(ownerUid,otherUid){this.ownerKey=sha(JSON.stringify(['firebase',ownerUid]));this.otherKey=sha(JSON.stringify(['firebase',otherUid]));}
 pauseNext(){assert.equal(this.pendingGate,null);const barrier=gate();this.pendingGate=barrier;return barrier;}
 async balance(identityKey){
  assert.ok([this.ownerKey,this.otherKey].includes(identityKey));this.calls.push(identityKey);
  const barrier=this.pendingGate;this.pendingGate=null;if(barrier){barrier.enter();await barrier.resume;}
  if(this.mode==='unavailable')throw new AccountBillingFault('unavailable');if(this.mode==='null')return null;
  if(this.mode==='zero')return {unit:'video_seconds',credited:0,available:0,reserved:0,consumed:0,active:0};
  return identityKey===this.ownerKey?{unit:'video_seconds',credited:20,available:13,reserved:5,consumed:2,active:1}:{unit:'video_seconds',credited:4,available:4,reserved:0,consumed:0,active:0};
 }
}
function makeClient(c,{remote=true}={}){
 const handler=firestoreHttp({origin:'http://127.0.0.1',backend:c.backend,requirePilotBalance:true,...(remote?{ai:c.ai}:{}),identity:{async verifyIdToken(token,checkRevoked){
  assert.equal(checkRevoked,true);c.tokenChecks++;
  if(token==='synthetic-owner')return {uid:c.uid,email_verified:true};
  if(token==='synthetic-other')return {uid:c.otherUid,email_verified:true};
  if(token==='synthetic-unverified')return {uid:c.uid,email_verified:false};
  throw Error('Synthetic invalid token');
 }}});
 return async(token='synthetic-owner')=>{
  const req=Readable.from([]);req.url='/api/cloud/me';req.method='GET';req.headers={origin:'http://127.0.0.1',authorization:'Bearer '+token};
  const res=new SyntheticResponse();await handler(req,res);await finished(res);return res;
 };
}
function assertDenied(response,statuses=[401,403,404]){
 assert.ok(statuses.includes(response.statusCode),`Unexpected status ${response.statusCode}`);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['x-content-type-options'],'nosniff');
 const payload=JSON.parse(response.body.toString('utf8'));assert.deepEqual(Object.keys(payload),['error']);assert.ok(['request_rejected','not_found','unavailable'].includes(payload.error));
 for(const value of ['"available":','"reserved":','"credited":','"consumed":','video_seconds'])assert.equal(response.body.includes(Buffer.from(value)),false,'Denied response disclosed a synthetic balance');
}

before(async()=>{assertSafeEnvironment();assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
 assertSafeEnvironment();assertSafeClient(c.db);assertSafeRoot(c);
 if(!c.markerConfirmed){console.error(`Synthetic me identity root preserved: unconfirmed marker ${c.root.path}`);throw Error('Refusing cleanup without a confirmed synthetic marker');}
 const marker=await c.root.get(),data=marker.data();
 if(!marker.exists||!data||Object.keys(data).sort().join(',')!=='nonce,project,purpose'||data.nonce!==c.marker.nonce||data.project!==c.marker.project||data.purpose!==c.marker.purpose){console.error(`Synthetic me identity root preserved: changed marker ${c.root.path}`);throw Error('Refusing cleanup after synthetic marker changed');}
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await descendants(c.root),[]);
 verifiedCleanups++;console.log(`Synthetic me identity cleanup verified ${verifiedCleanups}/${testCount}`);
 }finally{await c.db.terminate();}}});
after(()=>{assert.equal(verifiedCleanups,testCount,'Every synthetic root must be removed and verified');console.log(`Synthetic me identity cleanup total: ${verifiedCleanups}/${testCount}`);});

async function fixture(){
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});assertSafeClient(db);
 const root=db.collection(collection).doc(randomUUID()),backend=new FirestoreBackend(db,root),uid='synthetic-owner-'+randomUUID(),otherUid='synthetic-other-'+randomUUID();
 const c={db,root,backend,uid,otherUid,tokenChecks:0,markerConfirmed:false,marker:{purpose:'vistavo-me-identity-synthetic',project,nonce:randomUUID()}};assertSafeRoot(c);contexts.push(c);
 assert.equal((await root.get()).exists,false,'Synthetic root must start absent');assert.deepEqual(await descendants(root),[],'Synthetic root must have no descendants');
 await root.create(c.marker);const marker=await root.get();assert.ok(marker.exists);assert.deepEqual(marker.data(),c.marker);assert.deepEqual(await descendants(root),[]);c.markerConfirmed=true;
 const account=await backend.accountForUid(uid),other=await backend.accountForUid(otherUid);Object.assign(c,{account,other,identityId:sha(JSON.stringify(['firebase',uid]))});
 for(const owner of [account,other])await ref(c,'accounts',owner).update({aiPilot:true,simulationOnly:true});
 await backend.creditVerifiedPurchase(account,'synthetic-me-'+randomUUID(),10,1,'synthetic-only','sandbox');
 const remote=new FakeAccountBalance(uid,otherUid),objects=new Proxy({},{get(){throw Error('Synthetic balance must not access objects');}}),ai=new FirestoreAi(db,root,backend,objects,undefined,remote);
 Object.assign(c,{remote,ai});c.call=makeClient(c);c.local=makeClient(c,{remote:false});return c;
}
async function state(c){
 const rows=[];
 async function walk(document){for(const group of await document.listCollections())for(const child of await group.listDocuments()){
  const snapshot=await child.get();rows.push({path:child.path,exists:snapshot.exists,data:snapshot.exists?snapshot.data():null});await walk(child);
 }}
 await walk(c.root);rows.sort((a,b)=>a.path.localeCompare(b.path));return {marker:(await c.root.get()).data(),rows};
}
async function mutateIdentity(c,mutation){const identity=ref(c,'identities',c.identityId);if(mutation==='removed')await identity.delete();else if(mutation==='reassigned')await identity.update({accountId:c.other});else await identity.update({uid:c.otherUid});}
async function restoreIdentity(c){await ref(c,'identities',c.identityId).set({accountId:c.account,uid:c.uid});}

test('control: authorized local and simulated Account balances remain separate',async()=>{
 const c=await fixture(),before=await state(c),local=await c.local();assert.equal(local.statusCode,200);const l=JSON.parse(local.body.toString());assert.equal(l.id,c.account);assert.equal(l.balance.available,10);assert.equal(c.remote.calls.length,0);
 const remote=await c.call();assert.equal(remote.statusCode,200);const r=JSON.parse(remote.body.toString());assert.equal(r.id,c.account);assert.equal(r.balance.unit,'video_seconds');assert.equal(r.balance.available,13);assert.deepEqual(c.remote.calls,[c.remote.ownerKey]);
 const other=await c.call('synthetic-other');assert.equal(other.statusCode,200);const o=JSON.parse(other.body.toString());assert.equal(o.id,c.other);assert.equal(o.balance.available,4);assert.deepEqual(c.remote.calls,[c.remote.ownerKey,c.remote.otherKey]);
 assert.deepEqual(await state(c),before);
});

test('control: invalid or unverified token never queries simulated Account',async()=>{
 const c=await fixture(),before=await state(c);assertDenied(await c.call('synthetic-invalid'),[401]);assertDenied(await c.call('synthetic-unverified'),[403]);
 assert.equal(c.remote.calls.length,0);assert.deepEqual(await state(c),before);
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} before balance read denies without Account call`,async()=>{
 const c=await fixture(),before=await state(c),barrier=gate(),original=c.backend.readBalanceForUid;let calls=0;
 c.backend.readBalanceForUid=async function(...args){calls++;assert.equal(args[0],c.account);assert.equal(args[1],c.uid);assert.equal(args[2],true);barrier.enter();await barrier.resume;return original.apply(this,args);};
 const pending=c.call();
 try{await waitForBarrier(barrier,pending);await mutateIdentity(c,mutation);barrier.release();const response=await pending;assertDenied(response);assert.equal(calls,1);assert.equal(c.remote.calls.length,0);}
 finally{barrier.release();c.backend.readBalanceForUid=original;await restoreIdentity(c);}
 assert.deepEqual(await state(c),before);
});

for(const mutation of ['removed','reassigned','uid_changed'])test(`identity ${mutation} while Account response is pending denies disclosure`,async()=>{
 const c=await fixture(),before=await state(c),barrier=c.remote.pauseNext(),pending=c.call();
 try{await waitForBarrier(barrier,pending);assert.deepEqual(c.remote.calls,[c.remote.ownerKey]);await mutateIdentity(c,mutation);barrier.release();assertDenied(await pending);}
 finally{barrier.release();await restoreIdentity(c);}
 assert.deepEqual(await state(c),before);
});

for(const stage of ['before_read','during_remote'])for(const flag of ['aiPilot','simulationOnly'])test(`pilot ${flag} revoked ${stage} denies balance`,async()=>{
 const c=await fixture(),before=await state(c),account=ref(c,'accounts',c.account);let barrier,original;
 if(stage==='before_read'){
  barrier=gate();original=c.backend.readBalanceForUid;c.backend.readBalanceForUid=async function(...args){assert.equal(args[0],c.account);assert.equal(args[1],c.uid);assert.equal(args[2],true);barrier.enter();await barrier.resume;return original.apply(this,args);};
 }else barrier=c.remote.pauseNext();
 const pending=c.call();
 try{await waitForBarrier(barrier,pending);await account.update({[flag]:false});barrier.release();assertDenied(await pending);assert.equal(c.remote.calls.length,stage==='before_read'?0:1);}
 finally{barrier.release();if(original)c.backend.readBalanceForUid=original;await account.update({[flag]:true});}
 assert.deepEqual(await state(c),before);
});

for(const mode of ['unavailable','null'])test(`Account ${mode} never falls back to local balance`,async()=>{
 const c=await fixture(),before=await state(c);c.remote.mode=mode;const response=await c.call();assertDenied(response,[503]);assert.equal(JSON.parse(response.body.toString()).error,'unavailable');
 assert.deepEqual(c.remote.calls,[c.remote.ownerKey]);assert.deepEqual(await state(c),before);
});

test('a zero simulated Account balance is returned as zero, not local balance',async()=>{
 const c=await fixture(),before=await state(c);c.remote.mode='zero';const response=await c.call();assert.equal(response.statusCode,200);
 assert.equal(JSON.parse(response.body.toString()).balance.available,0);assert.deepEqual(c.remote.calls,[c.remote.ownerKey]);assert.deepEqual(await state(c),before);
});
