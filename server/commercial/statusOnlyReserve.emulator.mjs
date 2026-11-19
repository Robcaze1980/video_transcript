// RED candidate: a local status snapshot is not an Account reserve ACK.
// Synthetic Firestore Emulator only; Account status is a local in-memory reply.
// This fixture creates no HTTP server and never contacts an AI provider.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,openSync,realpathSync,writeSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AI_CATALOG_VERSION} from './aiContracts.ts';
import {privateBucket} from './privateObjectPlan.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_status_only_reserve_synthetic',expectedTests=6;
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');let cleanups=0,rootLog;
const ref=(c,name,id)=>c.root.collection(name).doc(id);
function reservationFor(account,identity,input,operation,revision,key){
 const bytes=createHash('sha256').update(JSON.stringify(['vistavo-video-reservation-v1',account,identity,input,operation,revision,key])).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function rootEvent(event){assert.notEqual(rootLog,undefined);writeSync(rootLog,JSON.stringify(event)+'\n');fsyncSync(rootLog);}
function assertSafeEnvironment(){
 assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');
 assert.equal(process.env.LV_STATUS_ONLY_RESERVE,'1');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const key of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN',
  'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY',
  'GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY','VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID',
  'VISTAVO_AI_ENABLED','VISTAVO_FILES_MODE','VISTAVO_LOCAL_CLOUD','VISTAVO_ACCOUNT_ID','VISTAVO_JOB_ID','VISTAVO_GEMINI_KEY','K_SERVICE','K_REVISION',
  'K_CONFIGURATION','K_JOB','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.equal(process.env[key],undefined,`Unexpected ${key}`);
 const profile=process.env.USERPROFILE;assert.ok(profile&&profile===process.env.APPDATA&&profile===process.env.LOCALAPPDATA);
 const absolute=resolve(profile),base=resolve('outputs/lv019-b-status-only-reserve-runs'),parts=relative(base,absolute).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(c){
 assertSafeEnvironment();assert.match(c.root.path,new RegExp(`^${collection}/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`));
 assert.equal(c.db.projectId,project);assert.equal(c.db.databaseId,'(default)');const s=c.db._settings;
 assert.equal(s?.projectId,project);assert.equal(s?.servicePath,'127.0.0.1');assert.equal(s?.port,8185);assert.equal(s?.ssl,false);assert.equal(s?.preferRest,false);
 for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(s?.[key],undefined);
}
async function descendants(document,found=[]){for(const group of await document.listCollections())for(const child of await group.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{assertSafeEnvironment();rootLog=openSync(join(dirname(realpathSync(process.env.USERPROFILE)),'synthetic-roots.jsonl'),'wx');
 assert.equal((await fetch(`http://${host}/`,{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
 assertSafeClient(c);if(!c.confirmed)throw Error('Unconfirmed synthetic root retained for audit');
 assert.deepEqual((await c.root.get()).data(),c.marker);
 const known=await descendants(c.root);for(const document of known)assert.ok(document.path.startsWith(c.root.path+'/'));
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await c.root.listCollections(),[]);
 for(const document of known){assert.equal((await document.get()).exists,false);assert.deepEqual(await document.listCollections(),[]);}
 rootEvent({event:'cleanup_verified',scope:c.scope,path:c.root.path,marker:c.marker});
 cleanups++;console.log(`Synthetic status-only reserve cleanup verified ${cleanups}/${expectedTests}`);
 }finally{await c.db.terminate();}}});
after(()=>{try{console.log(`Synthetic status-only reserve cleanup total: ${cleanups}/${expectedTests}`);assert.equal(cleanups,expectedTests);}
 finally{if(rootLog!==undefined){closeSync(rootLog);rootLog=undefined;}}});

async function fixture(scope){
 assertSafeEnvironment();const db=new Firestore({projectId:project,host,ssl:false,preferRest:false}),root=db.collection(collection).doc(randomUUID());
 const c={scope,db,root,backend:new FirestoreBackend(db,root),confirmed:false,marker:{project,purpose:'status-only-reserve-synthetic-v1',nonce:randomUUID()},statusReads:0,posts:0};
 contexts.push(c);assertSafeClient(c);rootEvent({event:'allocated',scope,path:root.path,marker:c.marker});
 assert.equal((await root.get()).exists,false);assert.deepEqual(await root.listCollections(),[]);rootEvent({event:'root_absent',scope,path:root.path,marker:c.marker});
 await root.create(c.marker);assert.deepEqual((await root.get()).data(),c.marker);rootEvent({event:'root_confirmed',scope,path:root.path,marker:c.marker});c.confirmed=true;
 c.owner=await participant(c,'owner');c.other=await participant(c,'other');
 c.otherAccountBefore=(await ref(c,'accounts',c.other.account).get()).data();
 c.otherIntentBefore=(await ref(c,'billingIntents',c.other.witness.intentId).get()).data();
 return c;
}
async function participant(c,label){
 const uid=`synthetic-${label}-${randomUUID()}`,account=await c.backend.accountForUid(uid),inputId=randomUUID(),requestKey=randomUUID();
 await ref(c,'accounts',account).update({aiPilot:true,simulationOnly:true});
 const bytes=Buffer.from('synthetic placeholder; no video or provider'),digest=sha(bytes);
 const storage={bucket:privateBucket,key:`candidate-files-v1/${inputId}/video.mp4`,generation:'1',size:bytes.length,sha256:digest};
 await ref(c,'inputs',inputId).create({accountId:account,expiresAtMs:Date.now()+3600000,sha256:digest,deleted:false,ready:true,unknownCount:0,metadata:{duration:2,audioTracks:1},storage});
 await c.backend.saveProject(account,inputId,0,'Synthetic draft.');
 const identityKey=accountIdentityKey(uid),billing={provider:'account_seconds',identityKey,reservationId:reservationFor(account,identityKey,inputId,'translation:en',1,requestKey),seconds:2};
 await c.backend.beginExternalBillingIntent(account,inputId,requestKey,'translation:en',1,billing);
 const witness=await c.backend.externalIntentWitness(account,requestKey,billing);
 const snapshot=await c.backend.captureDirectObservation(witness,requestKey,'status');assert.ok(snapshot);
 return {uid,account,inputId,requestKey,billing,witness,snapshot};
}
async function controls(c,{expectedPosts=0,requireNoAcks=true}={}){
 assert.equal((await c.root.collection('providerCalls').get()).size,0);
 if(requireNoAcks)assert.equal((await c.root.collection('billingReserveAckObservations').get()).size,0);
 assert.deepEqual((await ref(c,'accounts',c.other.account).get()).data(),c.otherAccountBefore);
 assert.deepEqual((await ref(c,'billingIntents',c.other.witness.intentId).get()).data(),c.otherIntentBefore);
 assert.equal((await ref(c,'billingGuards',c.other.account).get()).exists,false);assert.equal(c.posts,expectedPosts);
}
function reserve(c,owner,snapshot){return c.backend.reserve(owner.account,owner.inputId,owner.requestKey,2,'translation:en',1,AI_CATALOG_VERSION,owner.billing,snapshot,owner.uid);}
async function verifyOwnerUid(c){
 const {owner,other}=c;
 assert.equal(await c.backend.priorExternalRequestForEnqueue(owner.account,owner.inputId,owner.requestKey,'translation:en',1,AI_CATALOG_VERSION,owner.uid),null);
 await assert.rejects(c.backend.priorExternalRequestForEnqueue(owner.account,owner.inputId,owner.requestKey,'translation:en',1,AI_CATALOG_VERSION,other.uid));
}

test('reserved status without reserve ACK must not create a job',async()=>{
 const c=await fixture('reserved_status');await verifyOwnerUid(c);
 // This is a fake read-only response, not an Account reservation or POST ACK.
 const fakeAccount={status:async()=>{c.statusReads++;return {reservationId:c.owner.billing.reservationId,seconds:2,state:'reserved'};},reserve:async()=>{c.posts++;throw Error('unexpected POST');}};
 const status=await fakeAccount.status();assert.equal(status.state,'reserved');assert.equal(status.seconds,2);
 const result=await reserve(c,c.owner,c.owner.snapshot).then(value=>({value}),error=>({error}));
 const jobs=await c.root.collection('jobs').get();await controls(c);
 const evidence={event:'status_without_ack',reservedStatus:true,statusReads:c.statusReads,accountPosts:c.posts,reserveAcks:0,
  providerCalls:(await c.root.collection('providerCalls').get()).size,otherAccountUnchanged:true,jobCount:jobs.size,returnedJob:typeof result.value==='string'};
 console.log('# STATUS_ONLY_EVIDENCE '+JSON.stringify(evidence));
 assert.equal(jobs.size,0,'A status observation is not authorization to create a job without a reserve ACK');
 assert.equal(result.value,undefined);
});
test('valid UID and synthetic reserve ACK can create exactly one job',async()=>{
 const c=await fixture('valid_ack');await verifyOwnerUid(c);let acknowledgements=0;
 const account={reserve:async(identityKey,reservationId,seconds)=>{
  c.posts++;assert.equal(identityKey,c.owner.billing.identityKey);assert.equal(reservationId,c.owner.billing.reservationId);assert.equal(seconds,2);
  acknowledgements++;return {reservationId,seconds,state:'reserved'};
 }};
 const ai=new FirestoreAi(c.db,c.root,c.backend,{},undefined,account);
 const job=await ai.enqueue(c.owner.account,c.owner.inputId,'translation:en',1,c.owner.requestKey,c.owner.uid);
 assert.equal(typeof job,'string');assert.equal(acknowledgements,1);assert.equal((await c.root.collection('jobs').get()).size,1);
 assert.equal((await ref(c,'jobs',job).get()).get('accountId'),c.owner.account);await controls(c,{expectedPosts:1,requireNoAcks:false});
});
test('invalid Account status reply is rejected by the client',async()=>{
 const c=await fixture('invalid_remote');const client=new AccountBillingClient(undefined,{request:async()=>{c.statusReads++;return {data:{reservationId:c.owner.billing.reservationId,seconds:2,state:'invalid'}};}});
 await assert.rejects(client.status(c.owner.billing.identityKey,c.owner.billing.reservationId),error=>error.code==='unavailable');
 assert.equal(c.statusReads,1);assert.equal((await c.root.collection('jobs').get()).size,0);await controls(c);
});
test('snapshot with a non-status source is rejected',async()=>{
 const c=await fixture('wrong_source');await assert.rejects(reserve(c,c.owner,{...c.owner.snapshot,source:'release'}));
 assert.equal((await c.root.collection('jobs').get()).size,0);await controls(c);
});
test('another account snapshot cannot authorize the owner job',async()=>{
 const c=await fixture('wrong_account');await assert.rejects(reserve(c,c.owner,c.other.snapshot));
 assert.equal((await c.root.collection('jobs').get()).size,0);await controls(c);
});
test('stale identity snapshot cannot create a job or alter another account',async()=>{
 const c=await fixture('stale_identity');await ref(c,'identities',c.owner.billing.identityKey).update({accountId:c.other.account});
 await assert.rejects(reserve(c,c.owner,c.owner.snapshot));assert.equal((await c.root.collection('jobs').get()).size,0);await controls(c);
});
