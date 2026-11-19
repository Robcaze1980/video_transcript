// Green replay of the RED and unchanged control, plus synthetic stale/race checks.
// Synthetic Firestore Emulator and in-memory Account only; no provider call.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,openSync,realpathSync,writeSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {privateBucket} from './privateObjectPlan.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_reserved_poll_green_synthetic',expectedTests=5;
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
 assert.equal(process.env.LV_RESERVED_POLL_BACKOFF_GREEN,'1');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const key of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN',
  'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY',
  'GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY','VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID',
  'VISTAVO_AI_ENABLED','VISTAVO_FILES_MODE','VISTAVO_LOCAL_CLOUD','VISTAVO_ACCOUNT_ID','VISTAVO_JOB_ID','VISTAVO_GEMINI_KEY','K_SERVICE','K_REVISION',
  'K_CONFIGURATION','K_JOB','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.equal(process.env[key],undefined,`Unexpected ${key}`);
 const profile=process.env.USERPROFILE;assert.ok(profile&&profile===process.env.APPDATA&&profile===process.env.LOCALAPPDATA);
 const absolute=resolve(profile),base=resolve('outputs/lv019-b-reserved-poll-green-runs'),parts=relative(base,absolute).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(c){
 assertSafeEnvironment();assert.match(c.root.path,/^vistavo_reserved_poll_green_synthetic\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 assert.equal(c.db.projectId,project);assert.equal(c.db.databaseId,'(default)');const s=c.db._settings;
 assert.equal(s?.projectId,project);assert.equal(s?.servicePath,'127.0.0.1');assert.equal(s?.port,8185);assert.equal(s?.ssl,false);assert.equal(s?.preferRest,false);
 for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(s?.[key],undefined);
}
async function descendants(document,found=[]){for(const col of await document.listCollections())for(const child of await col.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{
 assertSafeEnvironment();rootLog=openSync(join(dirname(process.env.USERPROFILE),'synthetic-roots.jsonl'),'wx');
 assert.equal((await fetch('http://127.0.0.1:8185/',{signal:AbortSignal.timeout(5000)})).status,200);
});
afterEach(async()=>{for(const c of contexts.splice(0)){globalThis.fetch=c.originalFetch;try{
 assertSafeClient(c);const marker=await c.root.get();
 if(!c.confirmed){assert.equal(marker.exists,false,'Unconfirmed root is preserved');assert.deepEqual(await c.root.listCollections(),[]);continue;}
 assert.deepEqual(marker.data(),c.marker);const known=await descendants(c.root);
 for(const document of known)assert.ok(document.path.startsWith(`${c.root.path}/`));
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await c.root.listCollections(),[]);
 for(const document of known){assert.equal((await document.get()).exists,false);assert.deepEqual(await document.listCollections(),[]);}
 rootEvent({event:'cleanup_verified',scope:c.scope,path:c.root.path,marker:c.marker});
 cleanups++;console.log(`Synthetic reserved poll cleanup verified ${cleanups}/${expectedTests}`);
 }finally{await c.db.terminate();}}});
after(()=>{try{console.log(`Synthetic reserved poll cleanup total: ${cleanups}/${expectedTests}`);assert.equal(cleanups,expectedTests);}
 finally{if(rootLog!==undefined){closeSync(rootLog);rootLog=undefined;}}});

async function fixture(scope){
 assertSafeEnvironment();const db=new Firestore({projectId:project,host,ssl:false,preferRest:false}),root=db.collection(collection).doc(randomUUID());
 const c={scope,db,root,backend:new FirestoreBackend(db,root),marker:{project,purpose:'reserved-poll-green-synthetic-v1',nonce:randomUUID()},confirmed:false,providerCalls:0,originalFetch:globalThis.fetch};
 contexts.push(c);assertSafeClient(c);rootEvent({event:'allocated',scope,path:root.path,marker:c.marker});
 globalThis.fetch=async(request,init)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.hostname!=='127.0.0.1'||url.port!=='8185'){c.providerCalls++;throw Error('synthetic provider network blocked');}return c.originalFetch(request,init);};
 assert.equal((await root.get()).exists,false);assert.deepEqual(await root.listCollections(),[]);rootEvent({event:'root_absent',scope,path:root.path,marker:c.marker});
 await root.create(c.marker);assert.deepEqual((await root.get()).data(),c.marker);rootEvent({event:'root_confirmed',scope,path:root.path,marker:c.marker});c.confirmed=true;
 const uid=`synthetic-owner-${randomUUID()}`,foreignUid=`synthetic-foreign-${randomUUID()}`,account=await c.backend.accountForUid(uid),foreign=await c.backend.accountForUid(foreignUid);
 Object.assign(c,{uid,foreignUid,account,foreign});
 for(const id of [account,foreign])await ref(c,'accounts',id).update({aiPilot:true,simulationOnly:true});
 await c.backend.creditVerifiedPurchase(account,'synthetic-'+randomUUID(),100,1,'synthetic-reserved-poll','sandbox');
 await c.backend.creditVerifiedPurchase(foreign,'synthetic-'+randomUUID(),37,1,'synthetic-reserved-poll','sandbox');
 const inputId=randomUUID(),requestKey=randomUUID(),bytes=Buffer.from('synthetic placeholder'),digest=sha(bytes),identityKey=accountIdentityKey(uid);
 const storage={bucket:privateBucket,key:`candidate-files-v1/${inputId}/video.mp4`,generation:'1',size:bytes.length,sha256:digest};
 await ref(c,'inputs',inputId).create({accountId:account,expiresAtMs:Date.now()+3600000,sha256:digest,deleted:false,ready:true,unknownCount:0,metadata:{duration:2,audioTracks:1},storage});
 await c.backend.saveProject(account,inputId,0,'Synthetic draft.');
 const reservationId=reservationFor(account,identityKey,inputId,'translation:en',1,requestKey),billing={provider:'account_seconds',identityKey,reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(account,inputId,requestKey,'translation:en',1,billing);
 const intentId=sha(JSON.stringify([account,requestKey])),intent=ref(c,'billingIntents',intentId),requests=[],unexpected=[];
 const remoteBalance={owner:{credited:20,available:18,reserved:2,consumed:0},foreign:{credited:7,available:7,reserved:0,consumed:0}},remoteMovements=[];
 const beforeRemote=structuredClone(remoteBalance),beforeMovements=structuredClone(remoteMovements);
 const statusPath=`/api/internal/video/reservations/${reservationId}/status`;
 const client=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname;requests.push({method:request.method,path});
  if(request.method!=='POST'||path!==statusPath||!request.data||Object.keys(request.data).join(',')!=='identityKey'||request.data.identityKey!==identityKey){unexpected.push('unexpected_request');throw Error('unexpected synthetic Account operation');}
  return {data:{reservationId,seconds:2,state:'reserved'}};
 }});
 const ai=new FirestoreAi(db,root,c.backend,{},undefined,client);
 Object.assign(c,{intentId,intent,inputId,requestKey,billing,identityKey,requests,unexpected,remoteBalance,remoteMovements,beforeRemote,beforeMovements,statusPath,ai});
 c.beforeOwner=await c.backend.readBalance(account);c.beforeForeign=await c.backend.readBalance(foreign);
 const movements=await root.collection('movements').get();c.beforeLedger=movements.docs.map(doc=>({id:doc.id,data:doc.data()}));
 return c;
}
async function assertNoEffects(c){
 assert.deepEqual(await c.backend.readBalance(c.account),c.beforeOwner);assert.deepEqual(await c.backend.readBalance(c.foreign),c.beforeForeign);
 const movements=await c.root.collection('movements').get();assert.deepEqual(movements.docs.map(doc=>({id:doc.id,data:doc.data()})),c.beforeLedger);
 assert.deepEqual(c.remoteBalance,c.beforeRemote);assert.deepEqual(c.remoteMovements,c.beforeMovements);
 assert.equal((await c.root.collection('jobs').get()).size,0);assert.equal((await c.root.collection('providerCalls').get()).size,0);
 assert.equal((await c.root.collection('billingOutbox').get()).size,0);assert.equal(c.providerCalls,0);assert.deepEqual(c.unexpected,[]);
}

test('reserved status must defer the next immediate drain',async()=>{
 const c=await fixture('repeat_due'),before=(await c.intent.get()).data();assert.equal(before.state,'reserve_pending');assert.ok(before.nextAttemptAt<=Date.now());
 const first=await c.ai.drainExternalBilling(),afterFirst=(await c.intent.get()).data();
 assert.equal(afterFirst.attempts,before.attempts+1);assert.equal(afterFirst.lastErrorCode,'reserved_unconfirmed');assert.ok(afterFirst.nextAttemptAt>Date.now());
 const second=await c.ai.drainExternalBilling(),afterSecond=(await c.intent.get()).data();
 await assertNoEffects(c);assert.equal(first.intentsRecovered,0);assert.equal(second.intentsRecovered,0);assert.equal(first.intentsFailed,1);assert.equal(second.intentsFailed,0);
 assert.equal(afterSecond.attempts,afterFirst.attempts);assert.equal(afterSecond.nextAttemptAt,afterFirst.nextAttemptAt);
 const statuses=c.requests.filter(x=>x.method==='POST'&&x.path===c.statusPath).length;
 const e={event:'reserved_immediate_poll',statuses,totalPosts:c.requests.length,unexpected:c.unexpected.length,
  attemptsBefore:before.attempts,attemptsAfterFirst:afterFirst.attempts,attemptsAfterSecond:afterSecond.attempts,
  nextBefore:before.nextAttemptAt,nextAfterFirst:afterFirst.nextAttemptAt,nextAfterSecond:afterSecond.nextAttemptAt,
  firstStillDue:afterFirst.nextAttemptAt<=Date.now(),secondStillDue:afterSecond.nextAttemptAt<=Date.now(),
  firstFailed:first.intentsFailed,secondFailed:second.intentsFailed,noFundsMoved:true,noJobs:true,otherAccountUnchanged:true};
 console.log('# RESERVED_POLL_EVIDENCE '+JSON.stringify(e));
 assert.equal(statuses,1,'Reserved status must be deferred before the next immediate drain');
});

test('a future-due reserved intent is not polled',async()=>{
 const c=await fixture('future_due'),future=Date.now()+120000;await c.intent.update({nextAttemptAt:future});
 const first=await c.ai.drainExternalBilling(),second=await c.ai.drainExternalBilling(),after=(await c.intent.get()).data();
 assert.equal(first.intentsFailed,0);assert.equal(second.intentsFailed,0);assert.equal(c.requests.length,0);assert.equal(after.nextAttemptAt,future);assert.equal(after.state,'reserve_pending');
 await assertNoEffects(c);
});

function gate(){let entered,release;const reached=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});return {reached,resume,enter:entered,release};}
async function waitForGate(g,pending){let timer;try{await Promise.race([g.reached,pending.then(()=>{throw Error('Synthetic drain completed before the gate');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic gate timed out')),20000);})]);}finally{clearTimeout(timer);}}

test('stale intent evidence cannot overwrite a newer schedule',async()=>{
 const c=await fixture('stale_intent'),before=(await c.intent.get()).data(),g=gate(),original=c.backend.recordExternalBillingIntentFailure.bind(c.backend),outcomes=[];
 c.backend.recordExternalBillingIntentFailure=async(...args)=>{g.enter();await g.resume;const result=await original(...args);outcomes.push(result);return result;};
 const pending=c.ai.drainExternalBilling();
 try{
  await waitForGate(g,pending);assert.equal(c.requests.length,1);
  await c.intent.update({attempts:before.attempts+5,nextAttemptAt:Date.now()+120000,lastErrorCode:'quota'});
  const newer=(await c.intent.get()).data();g.release();const result=await pending;
  assert.equal(result.intentsFailed,1);assert.deepEqual(outcomes,[false]);assert.deepEqual((await c.intent.get()).data(),newer);
  assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);await assertNoEffects(c);
 }finally{g.release();await pending.catch(()=>undefined);c.backend.recordExternalBillingIntentFailure=original;}
});

test('changed intent during status preserves review instead of rescheduling',async()=>{
 const c=await fixture('changed_state'),before=(await c.intent.get()).data(),g=gate(),originalStatus=c.ai.accountBilling.status.bind(c.ai.accountBilling),originalSchedule=c.backend.recordExternalBillingIntentFailure.bind(c.backend);let scheduleCalls=0;
 c.ai.accountBilling.status=async(...args)=>{const result=await originalStatus(...args);g.enter();await g.resume;return result;};
 c.backend.recordExternalBillingIntentFailure=async(...args)=>{scheduleCalls++;return originalSchedule(...args);};
 const pending=c.ai.drainExternalBilling();
 try{
  await waitForGate(g,pending);assert.deepEqual(await c.backend.fenceExternalBillingRelease(c.account,c.requestKey,c.billing),{state:'release_pending'});
  const fenced=(await c.intent.get()).data();g.release();const result=await pending,after=(await c.intent.get()).data();
  assert.equal(result.intentsFailed,1);assert.equal(scheduleCalls,0);assert.equal(after.state,'needs_review');
  assert.equal(after.attempts,before.attempts);assert.equal(after.nextAttemptAt,fenced.nextAttemptAt);
  const incidents=await c.root.collection('billingIntentObservationIncidents').get();assert.equal(incidents.size,1);assert.equal(incidents.docs[0].get('observedState'),'reserved');
  assert.equal((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);assert.equal((await c.root.collection('billingHoldOutbox').get()).size,1);
  assert.equal(c.requests.length,1);await assertNoEffects(c);
 }finally{g.release();await pending.catch(()=>undefined);c.ai.accountBilling.status=originalStatus;c.backend.recordExternalBillingIntentFailure=originalSchedule;}
});

test('reassigned identity cannot reschedule the prior account intent',async()=>{
 const c=await fixture('changed_identity'),before=(await c.intent.get()).data(),g=gate(),original=c.backend.recordExternalBillingIntentFailure.bind(c.backend),outcomes=[];
 c.backend.recordExternalBillingIntentFailure=async(...args)=>{g.enter();await g.resume;const result=await original(...args);outcomes.push(result);return result;};
 const pending=c.ai.drainExternalBilling();
 try{
  await waitForGate(g,pending);const identity=ref(c,'identities',c.identityKey);assert.equal((await identity.get()).get('accountId'),c.account);
  await identity.update({accountId:c.foreign});g.release();const result=await pending;
  assert.equal(result.intentsFailed,1);assert.deepEqual(outcomes,[false]);assert.deepEqual((await c.intent.get()).data(),before);
  assert.equal((await identity.get()).get('accountId'),c.foreign);assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
  assert.equal(c.requests.length,1);await assertNoEffects(c);
 }finally{g.release();await pending.catch(()=>undefined);c.backend.recordExternalBillingIntentFailure=original;}
});
