// Synthetic local race tests. A fake verified identity enters the real HTTP
// handler; Firestore is the local emulator, object bytes are in memory.
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

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_identity_fence_synthetic';
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');let verifiedCleanups=0;
const ref=(c,name,id)=>c.root.collection(name).doc(id);
function assertSafeEnvironment(){
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_IDENTITY_FENCE,'1');
 assert.equal(process.env.LV_REVIEW_CONTRACT,'1');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','FIREBASE_CONFIG','K_SERVICE'])assert.equal(process.env[name],undefined,`Unexpected ${name}`);
 assert.ok(process.env.USERPROFILE);assert.equal(process.env.USERPROFILE,process.env.APPDATA);assert.equal(process.env.USERPROFILE,process.env.LOCALAPPDATA);
 const profile=resolve(process.env.USERPROFILE),base=resolve('outputs/lv019-b-identity-fence-runs'),parts=relative(base,profile).split(sep);
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
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await descendants(c.root),[]);verifiedCleanups++;console.log(`Synthetic identity cleanup verified ${verifiedCleanups}/13`);
 }finally{await c.db.terminate();}}});
after(()=>{assert.equal(verifiedCleanups,13,'Every synthetic root must be removed and verified');console.log('Synthetic identity cleanup total: 13/13');});

async function fixture(){
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});assertSafeClient(db);
 const root=db.collection(collection).doc(randomUUID()),backend=new FirestoreBackend(db,root),uid='synthetic-owner-'+randomUUID(),otherUid='synthetic-other-'+randomUUID();
 const c={db,root,backend,uid,otherUid,tokenChecks:0,markerConfirmed:false,marker:{purpose:'vistavo-identity-fence-synthetic',project,nonce:randomUUID()}};assertSafeRoot(c);contexts.push(c);
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
 const attempt=await backend.claim(account,c.jobId);assert.ok(attempt);const claimed=await backend.job(account,c.jobId);
 assert.equal(await backend.resumeTextAfterLocalCheck(account,c.jobId,attempt.attemptId,claimed.inputStorage,'nonzero'),true);
 assert.equal(await backend.beginInvocation(account,c.jobId,attempt.attemptId),true);
 await ref(c,'providerCalls',c.jobId+'-text-window-0000').create({jobId:c.jobId,accountId:account,attemptId:attempt.attemptId,callKey:'text-window:0000',model:'gemini-3.8-flash',state:'received',httpStatus:200,requestSha256:'a'.repeat(64),responseSha256:'b'.repeat(64),responseId:'synthetic-only',usage:{totalTokenCount:1},fixtureOnly:true});
 const artifact=(await ref(c,'artifacts',c.jobId).get()).data();assert.ok(artifact);
 const entries=artifact.plan.artifacts.map((spec,index)=>{const bytes=Buffer.from('Synthetic private result '+index),generation=String(9007199254741000n+BigInt(index));objects.data.set(spec.key,{generation,bytes});return {name:spec.name,key:spec.key,mimeType:spec.mimeType,generation,size:bytes.length,sha256:sha(bytes)};});
 assert.equal(await backend.stageArtifactReceipt(account,c.jobId,attempt.attemptId,entries),true);assert.equal(await backend.finish(account,c.jobId,attempt.attemptId,true),true);
 assert.equal((await ref(c,'identities',c.identityId).get()).get('accountId'),account);c.call=syntheticHandler(c);return c;
}
const path=c=>'/api/cloud/ai/jobs/'+c.jobId;
const routes=[
 {name:'status',method:'GET',suffix:'',headers:{},entry:'status'},
 {name:'download',method:'GET',suffix:'/results/translation-en.txt',headers:{},entry:'download'},
 {name:'head',method:'HEAD',suffix:'/results/translation-en.txt',headers:{},entry:'download'},
 {name:'range',method:'GET',suffix:'/results/translation-en.txt',headers:{range:'bytes=0-3'},entry:'download'},
];

test('control: verified owner can query and download while another account is denied',async()=>{
 const c=await fixture();const status=await c.call(path(c));assert.equal(status.statusCode,200);assert.ok(JSON.parse(status.body.toString()).results.length>0);
 const download=await c.call(path(c)+'/results/translation-en.txt');assert.equal(download.statusCode,200);assert.equal(download.body.toString(),'Synthetic private result 2');
 for(const suffix of ['','/results/translation-en.txt']){const foreign=await c.call(path(c)+suffix,'GET','synthetic-other');assert.equal(foreign.statusCode,404);assert.ok(!foreign.body.toString().includes('Synthetic private result'));}
 assert.equal(c.objects.reads,1);assert.equal(c.tokenChecks,4);
});

for(const mutation of ['removed','reassigned','uid_changed'])for(const route of routes)test(`identity ${mutation} before ${route.name} transaction must deny the original requester`,async()=>{
 const c=await fixture(),original=c.ai[route.entry].bind(c.ai);let enter,release,entries=0;
 const entered=new Promise(resolve=>{enter=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 c.ai[route.entry]=async(...args)=>{entries++;assert.equal(args[0],c.account);assert.equal(args[1],c.jobId);assert.equal(args[route.entry==='status'?2:3],c.uid);enter();await resume;return original(...args);};
 const pending=c.call(path(c)+route.suffix,route.method,'synthetic-owner',route.headers);
 try{
  await Promise.race([entered,pending.then(()=>{throw Error('The synthetic route bypassed the transaction barrier');})]);
  const identity=ref(c,'identities',c.identityId);
  if(mutation==='removed')await identity.delete();else if(mutation==='reassigned')await identity.update({accountId:c.other});else await identity.update({uid:c.otherUid});
  release();const response=await pending;
  assert.ok([401,403,404].includes(response.statusCode),`Expected a clean denial after ${mutation}; got ${response.statusCode}; synthetic object reads=${c.objects.reads}`);
  assert.equal(c.objects.reads,0);assert.ok(!response.body.toString().includes('Synthetic private result'));assert.equal(entries,1);assert.equal(c.tokenChecks,1);
 }finally{release();c.ai[route.entry]=original;}
});
