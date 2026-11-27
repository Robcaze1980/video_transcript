// Characterization only. The existing financial guard is NOT the proposed admission guard.
// The guard is created from a deliberately synthetic observation, never an attributed overdue refund.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {videoReservationId} from './videoReservationId.ts';

const host='127.0.0.1:8197',project='demo-vistavo-admission';
const collections=['vistavo_entry_video_synthetic','vistavo_entry_account_synthetic'];
const fixtures=[];
let created=0,cleaned=0;
const ref=(root,collection,id)=>root.collection(collection).doc(id);
const sha=value=>createHash('sha256').update(value).digest('hex');
const oneBalance=(available,reserved,consumed,active)=>({unit:'video_seconds',credited:20,available,reserved,consumed,active});
function assertEnvironment(){
  assert.equal(process.platform,'win32');
  assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');
  assert.equal(process.env.LV_FINANCIAL_REGRESSION,'1');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);
  assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
  for(const name of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
    'CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN',
    'GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY',
    'VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT',
    'GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID','K_SERVICE','K_REVISION','K_CONFIGURATION','K_JOB',
    'FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.ok(!process.env[name]);
  assert.ok(process.env.APPDATA&&process.env.APPDATA===process.env.USERPROFILE&&process.env.APPDATA===process.env.LOCALAPPDATA);
  const profile=resolve(process.env.APPDATA),expected=resolve('outputs/admission-isolated/profile');
  assert.equal(profile.toLowerCase(),expected.toLowerCase());assert.equal(realpathSync(profile).toLowerCase(),expected.toLowerCase());
  assert.equal(existsSync(join(profile,'gcloud','application_default_credentials.json')),false);
}
function assertRoot(c,entry){
  assertEnvironment();assert.ok(collections.includes(entry.collection));
  assert.match(entry.root.path,new RegExp(`^${entry.collection}/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`));
  const settings=c.db._settings;
  assert.equal(c.db.projectId,project);assert.equal(c.db.databaseId,'(default)');assert.equal(settings.projectId,project);
  assert.equal(settings.servicePath,'127.0.0.1');assert.equal(settings.port,8197);
  assert.equal(settings.ssl,false);assert.equal(settings.preferRest,false);
  for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(settings[key],undefined);
}
before(async()=>{assertEnvironment();assert.equal((await fetch(`http://${host}/`,{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{
  for(const c of fixtures.splice(0))try{
    for(const entry of c.roots){
      assertRoot(c,entry);
      const root=await entry.root.get();
      if(!entry.confirmed){assert.equal(root.exists,false);assert.deepEqual(await entry.root.listCollections(),[]);continue;}
      assert.equal(root.get('purpose'),'entry-continuity-synthetic-v1');assert.equal(root.get('marker'),entry.marker);
      await c.db.recursiveDelete(entry.root);
      assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);
    }
    cleaned++;
  }finally{await c.db.terminate();}
});
after(()=>{assert.equal(cleaned,created);console.log(`Synthetic fixture cleanup verified: ${cleaned}/${created}`);});

class LocalAccountTransport{
  bodies=[];
  constructor(store){this.store=store;}
  async request(request){
    const pathname=new URL(request.url).pathname,body=request.data??{};
    this.bodies.push({path:pathname,identityKey:body.identityKey});
    const status={invalid:400,not_found:404,conflict:409,quota:429,insufficient:402,invariant:503};
    try{
      if(pathname==='/api/internal/video/reservations')return {data:{...await this.store.reserveVideo(body.identityKey,body.reservationId,body.seconds),reservationId:body.reservationId}};
      if(pathname.endsWith('/release')){
        const reservationId=pathname.split('/').at(-2);
        const admission=body.jobId?{jobId:body.jobId,attemptId:body.attemptId}:undefined;
        const options=body.resolutionKind?{resolution:{kind:body.resolutionKind,evidenceSha256:body.evidenceSha256}}:undefined;
        return {data:{...await this.store.settleVideo(body.identityKey,reservationId,'release',body.seconds,admission,options),reservationId}};
      }
      throw Object.assign(new Error('unexpected synthetic operation'),{response:{status:404}});
    }catch(error){if(error?.response)throw error;throw Object.assign(new Error('synthetic account fault'),{response:{status:status[error?.code]??503}});}
  }
}
async function fixture(){
  assertEnvironment();
  const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
  const roots=collections.map(collection=>({collection,root:db.collection(collection).doc(randomUUID()),marker:randomUUID(),confirmed:false}));
  const c={db,roots,video:roots[0].root,account:roots[1].root};fixtures.push(c);created++;
  for(const entry of roots){
    assertRoot(c,entry);assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);
    await entry.root.create({purpose:'entry-continuity-synthetic-v1',marker:entry.marker});
    const row=await entry.root.get();assert.equal(row.get('marker'),entry.marker);entry.confirmed=true;
  }
  c.backend=new FirestoreBackend(db,c.video);c.store=new AccountStore(db,c.account);
  c.transport=new LocalAccountTransport(c.store);
  c.ai=new FirestoreAi(db,c.video,c.backend,{},undefined,new AccountBillingClient(undefined,c.transport));
  c.person=async()=>{
    const uid='synthetic-entry-'+randomUUID(),videoId=await c.backend.accountForUid(uid),identityKey=accountIdentityKey(uid);
    await ref(c.video,'accounts',videoId).update({aiPilot:true,simulationOnly:true,credited:20,available:20});
    const boot=await c.store.bootstrap(uid),accountId=boot.account.id;
    await ref(c.account,'accounts',accountId).update({credited:20,available:20});
    const inputId=randomUUID(),digest=sha('synthetic entry video'),storage={bucket:privateBucket,
      key:`candidate-files-v1/${inputId}/video.mp4`,generation:'1',size:21,sha256:digest};
    await ref(c.video,'inputs',inputId).create({accountId:videoId,expiresAtMs:Date.now()+3600000,sha256:digest,
      deleted:false,ready:true,unknown:false,unknownCount:0,metadata:{duration:3,audioTracks:1},storage});
    await c.backend.saveProject(videoId,inputId,0,'synthetic source');
    return {uid,videoId,identityKey,accountId,inputId,storage};
  };
  return c;
}
const enqueue=(c,p,key)=>c.ai.enqueue(p.videoId,p.inputId,'translation:en',1,key,p.uid);
const prior=(c,p,key)=>c.backend.priorExternalRequestForEnqueue(p.videoId,p.inputId,key,'translation:en',1,'ai-candidate-v1',p.uid);

test('existing Video financial guard stops the next step and external replay; a second account and an unrelated refund continue',{timeout:60000},async()=>{
  const c=await fixture(),a=await c.person(),b=await c.person(),key=randomUUID(),refund=randomUUID();
  const job=await enqueue(c,a,key);
  assert.equal(await prior(c,a,key),job);
  const attempt=await c.backend.claim(a.videoId,job);assert.ok(attempt);
  assert.equal((await ref(c.video,'jobs',job).get()).get('invocationPhase'),'local_check');
  await c.store.reserveVideo(a.identityKey,refund,3);

  const incidentKey=randomUUID(),billing={provider:'account_seconds',identityKey:a.identityKey,
    reservationId:videoReservationId(a.videoId,a.identityKey,a.inputId,'translation:en',1,incidentKey),seconds:3};
  await c.backend.beginExternalBillingIntent(a.videoId,a.inputId,incidentKey,'translation:en',1,billing);
  await c.backend.recordExternalBillingReview(a.videoId,incidentKey,billing,{reservationId:billing.reservationId,state:'captured',seconds:3});
  assert.equal((await ref(c.video,'billingGuards',a.videoId).get()).get('blocked'),true);
  assert.equal((await c.video.collection('billingHoldOutbox').get()).size,1);
  assert.equal((await ref(c.account,'videoBillingGuards',a.accountId).get()).exists,false);
  await assert.rejects(()=>prior(c,a,key),{code:'conflict'});
  assert.equal(await c.backend.resumeTextAfterLocalCheck(a.videoId,job,attempt.attemptId,a.storage,'nonzero'),false);
  assert.equal((await ref(c.video,'jobs',job).get()).get('invocationPhase'),'local_check');
  assert.equal((await c.video.collection('providerCalls').get()).size,0);
  const beforeA=c.transport.bodies.filter(row=>row.identityKey===a.identityKey).length;
  await assert.rejects(()=>enqueue(c,a,randomUUID()),{code:'conflict'});
  assert.equal(c.transport.bodies.filter(row=>row.identityKey===a.identityKey).length,beforeA);

  const otherJob=await enqueue(c,b,randomUUID()),otherAttempt=await c.backend.claim(b.videoId,otherJob);
  assert.ok(otherAttempt);
  assert.equal(await c.backend.resumeTextAfterLocalCheck(b.videoId,otherJob,otherAttempt.attemptId,b.storage,'nonzero'),true);
  assert.equal((await ref(c.video,'jobs',otherJob).get()).get('invocationPhase'),'not_started');
  assert.equal((await c.store.settleVideo(a.identityKey,refund,'release',3)).settled,true);
  assert.equal((await c.store.settleVideo(a.identityKey,refund,'release',3)).settled,false);
  assert.deepEqual(await c.store.videoBalance(a.identityKey),oneBalance(17,3,0,1));
  assert.deepEqual(await c.store.videoBalance(b.identityKey),oneBalance(17,3,0,1));
  const releases=await c.account.collection('ledgerEntries').where('ownerAccountId','==',a.accountId).where('kind','==','video_release').get();
  assert.equal(releases.size,1);
  assert.equal((await c.video.collection('jobs').get()).size,2);
});

test('already admitted external no-speech finishes in Video, but the financial guard stops its refund; B settles',{timeout:60000},async()=>{
  const c=await fixture(),a=await c.person(),b=await c.person(),keyA=randomUUID(),keyB=randomUUID();
  const jobA=await enqueue(c,a,keyA),jobB=await enqueue(c,b,keyB);
  const row=await c.backend.job(a.videoId,jobA),attempt=await c.backend.claim(a.videoId,jobA);
  assert.ok(attempt);
  assert.equal(await c.backend.resumeTextAfterLocalCheck(a.videoId,jobA,attempt.attemptId,a.storage,'nonzero'),true);
  assert.equal(await c.backend.beginInvocation(a.videoId,jobA,attempt.attemptId),true);
  const requestSha256='b'.repeat(64),responseSha256='c'.repeat(64),callKey='text-window:0000';
  assert.equal((await c.store.admitVideoCall(a.identityKey,row.externalBilling.reservationId,3,jobA,attempt.attemptId,callKey,'gemini-3.8-flash',requestSha256)).created,true);
  // The provider response is a deliberately synthetic worker receipt; no provider is called.
  await ref(c.video,'providerCalls',`${jobA}-text-window-0000`).create({jobId:jobA,accountId:a.videoId,attemptId:attempt.attemptId,
    callKey,model:'gemini-3.8-flash',state:'received',requestSha256,responseSha256,responseId:'synthetic-no-speech',httpStatus:200,
    startedAtMs:Date.now()-50,finishedAtMs:Date.now(),usage:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},fixtureOnly:true});
  const incidentKey=randomUUID(),billing={provider:'account_seconds',identityKey:a.identityKey,
    reservationId:videoReservationId(a.videoId,a.identityKey,a.inputId,'translation:en',1,incidentKey),seconds:3};
  await c.backend.beginExternalBillingIntent(a.videoId,a.inputId,incidentKey,'translation:en',1,billing);
  await c.backend.recordExternalBillingReview(a.videoId,incidentKey,billing,{reservationId:billing.reservationId,state:'captured',seconds:3});
  assert.equal((await ref(c.account,'videoBillingGuards',a.accountId).get()).exists,false);
  assert.equal(await c.backend.completeNoSpeech(a.videoId,jobA,attempt.attemptId,[{callKey,responseSha256}]),true);
  assert.equal(await c.backend.completeNoSpeech(a.videoId,jobA,attempt.attemptId,[{callKey,responseSha256}]),false);
  assert.equal((await ref(c.video,'jobs',jobA).get()).get('state'),'failed');
  assert.equal((await ref(c.video,'billingOutbox',jobA).get()).get('state'),'pending');
  assert.equal(await c.backend.cancel(b.videoId,jobB),true);
  const result=await c.ai.drainExternalBilling();
  assert.equal(result.settled,1);assert.equal(result.failed,1);
  assert.equal((await ref(c.video,'billingOutbox',jobA).get()).get('state'),'pending');
  assert.equal((await ref(c.video,'billingOutbox',jobB).get()).get('state'),'settled');
  assert.equal(c.transport.bodies.filter(entry=>entry.path.endsWith('/release')&&entry.identityKey===a.identityKey).length,0);
  assert.equal(c.transport.bodies.filter(entry=>entry.path.endsWith('/release')&&entry.identityKey===b.identityKey).length,1);
  assert.deepEqual(await c.store.videoBalance(a.identityKey),oneBalance(17,3,0,1));
  assert.deepEqual(await c.store.videoBalance(b.identityKey),oneBalance(20,0,0,0));
  assert.equal((await c.store.videoReservation(a.identityKey,row.externalBilling.reservationId)).state,'reserved');
});

test('a conflicting observation about the same reservation keeps the financial guard and prevents release; B settles',{timeout:60000},async()=>{
  const c=await fixture(),a=await c.person(),b=await c.person(),keyA=randomUUID();
  const jobA=await enqueue(c,a,keyA),jobB=await enqueue(c,b,randomUUID());
  const row=await c.backend.job(a.videoId,jobA);
  assert.equal(await c.backend.cancel(a.videoId,jobA),true);
  assert.equal(await c.backend.cancel(b.videoId,jobB),true);
  // A synthetic contradictory observation makes the SAME reservation uncertain.
  // Account itself still says reserved: neither observation is treated here as a basis to move it.
  const review=await c.backend.recordExternalBillingReview(a.videoId,keyA,row.externalBilling,
    {reservationId:row.externalBilling.reservationId,state:'captured',seconds:3});
  assert.deepEqual(review,{state:'needs_review',reason:'capture_before_success'});
  assert.equal((await ref(c.video,'billingGuards',a.videoId).get()).get('blocked'),true);
  assert.equal((await ref(c.account,'videoBillingGuards',a.accountId).get()).exists,false);
  const result=await c.ai.drainExternalBilling();
  assert.equal(result.settled,1);assert.equal(result.failed,1);
  assert.equal((await ref(c.video,'billingOutbox',jobA).get()).get('state'),'pending');
  assert.equal((await ref(c.video,'billingOutbox',jobB).get()).get('state'),'settled');
  assert.equal(c.transport.bodies.filter(entry=>entry.path.endsWith('/release')&&entry.identityKey===a.identityKey).length,0);
  assert.equal(c.transport.bodies.filter(entry=>entry.path.endsWith('/release')&&entry.identityKey===b.identityKey).length,1);
  assert.equal((await c.store.videoReservation(a.identityKey,row.externalBilling.reservationId)).state,'reserved');
  assert.deepEqual(await c.store.videoBalance(a.identityKey),oneBalance(17,3,0,1));
  assert.deepEqual(await c.store.videoBalance(b.identityKey),oneBalance(20,0,0,0));
});

test('Account hold prevents refund until its audited removal; retry and foreign account stay isolated',{timeout:60000},async()=>{
  const c=await fixture(),a=await c.person(),b=await c.person(),reservation=randomUUID(),other=randomUUID(),incident=randomUUID();
  await c.store.reserveVideo(a.identityKey,reservation,3);
  await c.store.reserveVideo(b.identityKey,other,3);
  assert.equal((await c.store.blockVideoBilling(a.identityKey,incident)).created,true);
  await assert.rejects(()=>c.store.settleVideo(a.identityKey,reservation,'release',3),{code:'conflict'});
  await assert.rejects(()=>c.store.settleVideo(b.identityKey,reservation,'release',3),{code:'not_found'});
  assert.equal((await c.store.settleVideo(b.identityKey,other,'release',3)).settled,true);
  assert.deepEqual(await c.store.videoBalance(a.identityKey),oneBalance(17,3,0,1));
  const guard=await ref(c.account,'videoBillingGuards',a.accountId).get();
  const request={incidentId:incident,epoch:guard.get('epoch'),createdAtMs:guard.get('createdAtMs'),reviewRef:'synthetic-evidence'};
  assert.deepEqual(await c.store.unblockVideoBilling(a.identityKey,request),{unblocked:true,replayed:false,blocked:false});
  assert.deepEqual(await c.store.unblockVideoBilling(a.identityKey,request),{unblocked:true,replayed:true,blocked:false});
  const settled=await Promise.all([c.store.settleVideo(a.identityKey,reservation,'release',3),c.store.settleVideo(a.identityKey,reservation,'release',3)]);
  assert.equal(settled.filter(row=>row.settled).length,1);
  assert.deepEqual(await c.store.videoBalance(a.identityKey),oneBalance(20,0,0,0));
  assert.deepEqual(await c.store.videoBalance(b.identityKey),oneBalance(20,0,0,0));
  const releases=await c.account.collection('ledgerEntries').where('ownerAccountId','==',a.accountId).where('kind','==','video_release').get();
  assert.equal(releases.size,1);
});
