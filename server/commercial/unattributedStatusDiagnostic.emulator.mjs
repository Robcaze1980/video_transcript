// One diagnostic: real local uncertainty path with a deliberately corrupted
// synthetic witness, synthetic AccountStore and an in-memory provider response.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,openSync,realpathSync,writeSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountStore} from '../account/backend.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {objectPlan,privateBucket} from './privateObjectPlan.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_unattributed_status_synthetic',expectedTests=1;
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');let cleanups=0,rootLog;
function rootEvent(event){assert.notEqual(rootLog,undefined);writeSync(rootLog,JSON.stringify(event)+'\n');fsyncSync(rootLog);}
function assertSafeEnvironment(){
 assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');
 assert.equal(process.env.LV_UNATTRIBUTED_STATUS,'1');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const key of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN',
  'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY',
  'GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY','VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID',
  'VISTAVO_AI_ENABLED','VISTAVO_FILES_MODE','VISTAVO_LOCAL_CLOUD','VISTAVO_ACCOUNT_ID','VISTAVO_JOB_ID','VISTAVO_GEMINI_KEY','K_SERVICE','K_REVISION',
  'K_CONFIGURATION','K_JOB','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.equal(process.env[key],undefined,`Unexpected ${key}`);
 const profile=process.env.USERPROFILE;assert.ok(profile&&profile===process.env.APPDATA&&profile===process.env.LOCALAPPDATA);
 const absolute=resolve(profile),base=resolve('outputs/lv019-b-unattributed-status-runs'),parts=relative(base,absolute).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(c){
 assertSafeEnvironment();assert.match(c.root.path,/^vistavo_unattributed_status_synthetic\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
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
 cleanups++;console.log(`Synthetic unattributed status cleanup verified ${cleanups}/${expectedTests}`);
 }finally{await c.db.terminate();}}});
after(()=>{try{console.log(`Synthetic unattributed status cleanup total: ${cleanups}/${expectedTests}`);assert.equal(cleanups,expectedTests);}
 finally{if(rootLog!==undefined){closeSync(rootLog);rootLog=undefined;}}});

// Diagnostic only: both stores are distinct synthetic subtrees in ONE local
// emulator. The provider is an in-memory Response; no real account is used.
async function fixture(scope){
 assertSafeEnvironment();
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false}),root=db.collection(collection).doc(randomUUID());
 const c={scope,db,root,backend:new FirestoreBackend(db,root),marker:{project,purpose:'unattributed-status-synthetic-v1',nonce:randomUUID()},confirmed:false,originalFetch:globalThis.fetch,events:[],unexpected:[],outcomes:[],providerCalls:0};
 contexts.push(c);assertSafeClient(c);rootEvent({event:'allocated',scope,path:root.path,marker:c.marker});
 globalThis.fetch=async(request,init)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.hostname!=='127.0.0.1'||url.port!=='8185')throw Error('Unexpected provider network');return c.originalFetch(request,init);};
 assert.equal((await root.get()).exists,false);assert.deepEqual(await root.listCollections(),[]);rootEvent({event:'root_absent',scope,path:root.path,marker:c.marker});
 await root.create(c.marker);assert.deepEqual((await root.get()).data(),c.marker);rootEvent({event:'root_confirmed',scope,path:root.path,marker:c.marker});c.confirmed=true;
 const accountRoot=root.collection('synthetic_services').doc('account');await accountRoot.create({fixture:'account-authority-demo'});
 const authority=new AccountStore(db,accountRoot);
 let reached,release;const statusReached=new Promise(resolve=>{reached=resolve;}),statusResume=new Promise(resolve=>{release=resolve;});
 const client=new AccountBillingClient(undefined,{request:async request=>{
  const url=new URL(request.url),path=url.pathname,body=request.data;
  if(request.method!=='POST'||url.origin!=='https://vistavo-account-api-v5lc7z6dyq-uc.a.run.app'){c.unexpected.push('invalid_account_transport');throw Error('Unexpected account request');}
  if(path==='/api/internal/video/reservations'){
   const value=await authority.reserveVideo(body.identityKey,body.reservationId,body.seconds);c.events.push({kind:'reserve',identityKey:body.identityKey,reservationId:body.reservationId,created:value.created});
   if(body.identityKey===c.dropAckFor&&!c.ackDropped){c.ackDropped=true;throw Error('Synthetic reserve ACK lost after commit');}
   return {data:{reservationId:body.reservationId,seconds:value.seconds,state:value.state}};
  }
  const match=/^\/api\/internal\/video\/reservations\/([a-f0-9-]+)\/(status|admit)$/.exec(path);
  if(!match){c.unexpected.push('unexpected_account_path');throw Error('Unexpected account path');}
  const reservationId=match[1];
  if(match[2]==='status'){
   const value=await authority.videoReservation(body.identityKey,reservationId);c.events.push({kind:'status',identityKey:body.identityKey,reservationId});
   if(body.identityKey===c.dropAckFor&&!c.statusPaused){c.statusPaused=true;reached();await statusResume;}
   return {data:value};
  }
  const value=await authority.admitVideoCall(body.identityKey,reservationId,body.seconds,body.jobId,body.attemptId,body.callKey,body.model,body.requestSha256);
  c.events.push({kind:'admit',identityKey:body.identityKey,reservationId,created:value.created,receiptOnly:value.receiptOnly});return {data:value};
 }});
 const ai=new FirestoreAi(db,root,c.backend,{},undefined,client),record=c.backend.recordReservedStatusUncertainty.bind(c.backend);
 c.backend.recordReservedStatusUncertainty=async(...args)=>{const value=await record(...args);c.outcomes.push(value);return value;};
 async function owner(){
  const uid='synthetic-owner-'+randomUUID(),account=await c.backend.accountForUid(uid),boot=await authority.bootstrap(uid),identityKey=accountIdentityKey(uid),inputId=randomUUID(),digest='a'.repeat(64);
  await root.collection('accounts').doc(account).update({aiPilot:true,simulationOnly:true,credited:30,available:30});
  await accountRoot.collection('accounts').doc(boot.account.id).update({credited:30,available:30});
  await root.collection('inputs').doc(inputId).create({accountId:account,deleted:false,expiresAtMs:Date.now()+300000,ready:true,sha256:digest,unknownCount:0,metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:objectPlan(inputId,12).final,generation:'1',size:12,sha256:digest}});
  await root.collection('projects').doc(inputId).create({accountId:account,inputId,revision:1,draft:'synthetic'});
  return {uid,account,accountServiceId:boot.account.id,identityKey,inputId};
 }
 Object.assign(c,{accountRoot,authority,ai,owner,statusReached,releaseStatus:release});return c;
}

async function invokeSynthetic(c,o,job){
 const attempt=await c.backend.claim(o.account,job);assert.ok(attempt);const row=await c.backend.job(o.account,job);
 if(row.invocationPhase==='local_check')assert.equal(await c.backend.resumeTextAfterLocalCheck(o.account,job,attempt.attemptId,row.inputStorage,'nonzero'),true);
 assert.equal(await c.backend.beginInvocation(o.account,job,attempt.attemptId),true);
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;c.providerCalls++;return new Response(JSON.stringify({responseId:'synthetic',usageMetadata:{totalTokenCount:1}}),{status:200,headers:{'Content-Type':'application/json'}});};
 try{await c.ai.invoke(o.account,job,attempt.attemptId,'synthetic-not-a-key')('text-window:0000','gemini-3.8-flash',{contents:[]},new AbortController().signal);}finally{globalThis.fetch=original;}
 return calls;
}

test('unattributed status and later independent reservation are observable',{timeout:240000},async()=>{
 const c=await fixture('unattributed'),owner=await c.owner(),other=await c.owner(),requestKey=randomUUID(),intentId=sha(JSON.stringify([owner.account,requestKey]));
 c.dropAckFor=owner.identityKey;
 const beforeOther=await c.authority.videoBalance(other.identityKey),pending=c.ai.enqueue(owner.account,owner.inputId,'translation:en',1,requestKey,owner.uid);
 let timer;
 try{
  await Promise.race([c.statusReached,pending.then(()=>{throw Error('No synthetic status gate');},()=>{throw Error('Request failed before status gate');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic status gate timed out')),30000);})]);
  clearTimeout(timer);
  const origin=c.root.collection('billingIntentWitnesses').doc(intentId),guard=c.root.collection('billingIntentAdmissionGuards').doc(intentId),beforeOrigin=await origin.get();
  assert.equal(beforeOrigin.get('inputId'),owner.inputId);assert.equal((await guard.get()).get('state'),'clear');
  assert.equal((await c.authority.videoBalance(owner.identityKey)).reserved,2);assert.deepEqual(await c.authority.videoBalance(other.identityKey),beforeOther);
  assert.equal((await c.root.collection('jobs').get()).size,0);assert.equal(c.events.filter(e=>e.kind==='status').length,1);
  // Deliberately alter only J1's synthetic origin history while status is in flight.
  // Do not write either admission or account guard; the real code handles the change.
  const differentInput=randomUUID();await origin.update({inputId:differentInput});assert.equal((await origin.get()).get('inputId'),differentInput);
  c.releaseStatus();await assert.rejects(pending,error=>error.code==='unknown');
  assert.deepEqual(c.outcomes,['needs_review']);
  const incidents=await c.root.collection('billingIntentObservationIncidents').get();assert.equal(incidents.size,1);
  const incident=incidents.docs[0],intent=await c.root.collection('billingIntents').doc(intentId).get(),reviewGuard=await guard.get();
  assert.equal(incident.get('attribution'),'unverified');assert.equal(incident.get('ownerBlocked'),false);assert.equal(incident.get('observedState'),'reserved');
  assert.equal(reviewGuard.get('state'),'needs_review');assert.equal(reviewGuard.get('incidentId'),incident.id);assert.equal(intent.get('state'),'reserve_pending');
  assert.equal((await c.root.collection('billingGuards').doc(owner.account).get()).exists,false);
  assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);
  assert.deepEqual(await c.authority.videoBillingHold(owner.identityKey,incident.id),{blocked:false,recorded:false});
  assert.equal((await c.root.collection('jobs').get()).size,0);assert.deepEqual(await c.authority.videoBalance(other.identityKey),beforeOther);
  const firstReservation=c.events.find(e=>e.kind==='reserve');assert.ok(firstReservation?.created);assert.equal(firstReservation.identityKey,owner.identityKey);
  assert.deepEqual(await c.authority.videoReservation(owner.identityKey,firstReservation.reservationId),{reservationId:firstReservation.reservationId,seconds:2,state:'reserved'});
  const second=await c.ai.enqueue(owner.account,owner.inputId,'translation:en',1,randomUUID(),owner.uid),secondCalls=await invokeSynthetic(c,owner,second);
  const otherJob=await c.ai.enqueue(other.account,other.inputId,'translation:en',1,randomUUID(),other.uid),otherCalls=await invokeSynthetic(c,other,otherJob);
  await assert.rejects(()=>c.ai.status(other.account,second,other.uid),error=>error.code==='not_found');
  const ownerBalance=await c.authority.videoBalance(owner.identityKey),otherBalance=await c.authority.videoBalance(other.identityKey),ledger=await c.accountRoot.collection('ledgerEntries').get();
  const admissions=c.events.filter(e=>e.kind==='admit'),reserves=c.events.filter(e=>e.kind==='reserve');
  assert.equal(reserves.length,3);assert.ok(reserves.every(e=>e.created===true));assert.equal(admissions.length,2);assert.ok(admissions.every(e=>e.created===true&&e.receiptOnly===false));
  assert.equal(admissions.filter(e=>e.identityKey===owner.identityKey).length,1);assert.equal(admissions.filter(e=>e.identityKey===other.identityKey).length,1);
  assert.equal(secondCalls,1);assert.equal(otherCalls,1);assert.equal(c.providerCalls,2);
  assert.equal(ownerBalance.reserved,4);assert.equal(ownerBalance.consumed,0);assert.equal(otherBalance.reserved,2);assert.equal(otherBalance.consumed,0);
  assert.equal(ledger.docs.filter(d=>d.get('kind')==='video_reserve').length,3);assert.equal(ledger.docs.filter(d=>d.get('kind')!=='video_reserve').length,0);
  const firstAccountReservation=c.accountRoot.collection('videoReservations').doc(sha(JSON.stringify([owner.accountServiceId,firstReservation.reservationId])));
  assert.equal((await firstAccountReservation.collection('providerCalls').get()).size,0);assert.equal((await c.root.collection('jobs').get()).size,2);
  assert.equal((await guard.get()).get('state'),'needs_review');assert.equal((await c.root.collection('billingGuards').doc(owner.account).get()).exists,false);
  assert.deepEqual(await c.authority.videoBillingHold(owner.identityKey,incident.id),{blocked:false,recorded:false});
  assert.deepEqual(c.unexpected,[]);
  console.log('# UNATTRIBUTED_DIAGNOSTIC '+JSON.stringify({event:'unattributed_status',originOnlyChanged:true,guardWrittenByFixture:false,outcome:c.outcomes[0],attribution:incident.get('attribution'),ownerBlocked:incident.get('ownerBlocked'),intentGuard:reviewGuard.get('state'),globalVideoHold:false,accountHold:false,holdOutbox:0,j1Job:false,j1ProviderCalls:0,j2Reserved:true,j2Admitted:true,j2SyntheticProviderCalls:secondCalls,otherReserved:true,otherAdmitted:true,otherSyntheticProviderCalls:otherCalls,ownerReserved:ownerBalance.reserved,otherReservedSeconds:otherBalance.reserved,captures:0,crossAccountDenied:true,unexpected:0}));
 }finally{clearTimeout(timer);c.releaseStatus();await pending.catch(()=>undefined);}
});

