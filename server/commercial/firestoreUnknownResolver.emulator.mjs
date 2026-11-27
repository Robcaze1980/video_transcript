// Synthetic-only LV-019.B step 1.2 fixture: client cancellation and UNKNOWN jobs. It runs a real `AccountStore` behind a
// local adapter of `AccountBillingClient`, against the fixed demo emulator at 127.0.0.1:8198. No cloud service,
// credential, HTTP route or real media is touched. Execute only through a reviewed launcher with the fixed demo
// environment. Cleanup always runs `db.terminate()` on every fixture root.
//
// Every scenario states the behaviour step 1.2 must reach (docs/specs/LV-019-B-cancelacion-y-unknown-diseno.md,
// sections 3, 4 and 5). The resolver scenarios are written to fail TODAY for the missing `resolveExpiredUnknown`
// ("resolveExpiredUnknown is not a function"), never for a syntax or mount error. The scenarios whose behaviour already
// exists today are named "(caracterizacion)" and must be green.
import assert from 'node:assert/strict';
import {prepareFinancialOwnedRoot,assertFinancialOwnedRoot,deleteFinancialOwnedRoot} from './financialOwnedRootGuard.mjs';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {Firestore,FieldValue} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {AI_CATALOG_VERSION} from './aiContracts.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {ALERT_COLLECTION} from './billingPendingAlerts.ts';
import {AUDIT_COLLECTION} from './billingPendingAudit.ts';
import {runPendingSweep} from './billingPendingSweep.ts';
import {UNKNOWN_RESOLUTION_MIN_AGE_MS} from '../account/settlementContract.ts';

const project='demo-vistavo-financial',host='127.0.0.1:8198';
const videoCollection='vistavo_video_unknown_resolver_video_synthetic',accountCollection='vistavo_video_unknown_resolver_ledger_synthetic';
// The window the resolver compares against, mirrored from the design: six hours, with a ten-minute tolerated future skew.
const WINDOW=6*60*60*1000,SKEW=10*60*1000;
const sha=value=>createHash('sha256').update(value).digest('hex');
const unknownEvidence=(jobId,attempt,quarantinedAtMs)=>`unknown_expired:v1:${jobId}:${attempt}:${quarantinedAtMs}`;
const contexts=[];
let cleanups=0,fixturesCreated=0;
const ref=(root,collection,id)=>root.collection(collection).doc(id);
const reservationDocId=(accountId,reservationId)=>sha(JSON.stringify([accountId,reservationId]));
const field=(snapshot,name,key)=>(snapshot.get(name)??{})[key];

function assertSafeEnvironment(){
  // LV_REVIEW_CONTRACT/METADATA_SERVER_DETECTION are review markers, not credentials; a reviewed launcher sets them, but a
  // bare `node --test` invocation gets them here so the harness never aborts before its afterEach cleanup.
  if(!process.env.LV_REVIEW_CONTRACT)process.env.LV_REVIEW_CONTRACT='1';
  if(!process.env.METADATA_SERVER_DETECTION)process.env.METADATA_SERVER_DETECTION='none';
  assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
  for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN',
    'GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY','VERTEX_API_KEY','OPENROUTER_API_KEY',
    'AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID',
    'VISTAVO_AI_ENABLED','VISTAVO_FILES_MODE','VISTAVO_LOCAL_CLOUD','VISTAVO_ACCOUNT_ID','VISTAVO_JOB_ID','VISTAVO_GEMINI_KEY','K_SERVICE','K_REVISION','K_CONFIGURATION',
    'K_JOB','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.equal(process.env[key],undefined,`Unexpected ${key}`);
}
function assertSafeClient(c){
  assertSafeEnvironment();
  assert.match(c.root.path,new RegExp(`^${videoCollection}/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`));
  assert.match(c.accountRoot.path,new RegExp(`^${accountCollection}/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`));
  assert.notEqual(c.root.path,c.accountRoot.path);assert.equal(c.db.projectId,project);assert.equal(c.db.databaseId,'(default)');
  const settings=c.db._settings;assert.equal(settings?.projectId,project);assert.equal(settings?.servicePath,'127.0.0.1');assert.equal(settings?.port,8198);
  assert.equal(settings?.ssl,false);assert.equal(settings?.preferRest,false);
  for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(settings?.[key],undefined);
}
async function descendants(document,found=[]){for(const group of await document.listCollections())for(const child of await group.listDocuments()){found.push(child);await descendants(child,found);}return found;}
// Every document under a root, keyed by path: lets a scenario prove exactly which collections were written.
async function tree(document,found=new Map()){
  const snap=await document.get();if(snap.exists)found.set(document.path,JSON.stringify(snap.data()));
  for(const group of await document.listCollections())for(const child of await group.listDocuments())await tree(child,found);
  return found;
}
before(async()=>{
  assertSafeEnvironment();
  assert.equal((await fetch(`http://${host}/`,{signal:AbortSignal.timeout(5000)})).status,200);
});
afterEach(async()=>{
  for(const c of contexts.splice(0)){
    try{
      assertSafeClient(c);
      for(const entry of c.roots){await assertFinancialOwnedRoot(c.db,entry.root,entry.marker);
        assert.deepEqual((await entry.root.get()).data(),entry.marker);
        const known=await descendants(entry.root);for(const document of known)assert.ok(document.path.startsWith(entry.root.path+'/'));
        await deleteFinancialOwnedRoot(c.db,entry.root,entry.marker);
        assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);
        for(const document of known){assert.equal((await document.get()).exists,false);assert.deepEqual(await document.listCollections(),[]);}
      }
      cleanups++;console.log(`Synthetic unknown-resolver cleanup verified ${cleanups}/${fixturesCreated}`);
    }finally{await c.db.terminate();}
  }
});
after(()=>{try{console.log(`Synthetic unknown-resolver cleanup total: ${cleanups}/${fixturesCreated}`);assert.equal(cleanups,fixturesCreated);}
  catch(error){console.error('Synthetic unknown-resolver cleanup total mismatch',error);throw error;}});

const accountStatus={invalid:400,not_found:404,account_not_provisioned:404,conflict:409,deleted:410,quota:429,insufficient:402,invariant:503,too_early:409,forbidden:403};
/**
 * Local stand-in for the Account HTTP edge: it forwards the exact whitelisted body to a real `AccountStore` and maps
 * `AccountFault` codes back to the HTTP shape `AccountBillingClient` expects. The flags let a scenario force a remote
 * observation without a second Account implementation.
 */
class LocalAccountTransport{
  bodies=[];events=[];lastRelease=null;forceReleaseCode=null;
  constructor(store){this.store=store;}
  async request(request){
    const pathname=new URL(request.url).pathname,body=request.data;
    this.bodies.push({pathname,data:{...body}});
    const parts=pathname.split('/'),reservationId=parts.at(-2);
    const httpFault=(status,code)=>Object.assign(Error('Synthetic Account refusal'),{response:{status,data:{error:code}}});
    const guard=async action=>{try{return {data:await action()};}catch(error){if(error?.response)throw error;throw httpFault(accountStatus[error?.code]??503,error?.code??'invariant');}};
    if(pathname==='/api/internal/video/reservations'){this.events.push('reserve');return guard(async()=>({...await this.store.reserveVideo(body.identityKey,body.reservationId,body.seconds),reservationId:body.reservationId}));}
    if(pathname.endsWith('/status')){this.events.push('status');return guard(()=>this.store.videoReservation(body.identityKey,reservationId));}
    if(pathname.endsWith('/resolution')){this.events.push('resolution');return guard(()=>this.store.videoReservationResolution(body.identityKey,reservationId,body.seconds));}
    if(pathname.endsWith('/admit')){this.events.push('admit');return guard(()=>this.store.admitVideoCall(body.identityKey,reservationId,body.seconds,body.jobId,body.attemptId,body.callKey,body.model,body.requestSha256));}
    if(pathname.endsWith('/seal')){this.events.push('seal');return guard(()=>this.store.sealVideoReservation(body.identityKey,reservationId,body.seconds));}
    if(pathname.endsWith('/release')||pathname.endsWith('/capture')){
      const action=pathname.endsWith('/release')?'release':'capture';this.events.push(action);
      if(action==='release'&&this.forceReleaseCode)throw httpFault(accountStatus[this.forceReleaseCode]??503,this.forceReleaseCode);
      const admission=body.jobId!==undefined?{jobId:body.jobId,attemptId:body.attemptId}:undefined;
      const options=body.resolutionKind!==undefined?{resolution:{kind:body.resolutionKind,evidenceSha256:body.evidenceSha256}}:body.capturedSeconds!==undefined?{capturedSeconds:body.capturedSeconds}:undefined;
      return guard(async()=>{const result=await this.store.settleVideo(body.identityKey,reservationId,action,body.seconds,admission,options);
        if(action==='release')this.lastRelease=result;
        return {...result,reservationId};});
    }
    throw httpFault(404,'not_found');
  }
}

// Create one owner: a fresh Video account plus its real Account (40 credits) and a caller-owned clock shared by all owners.
async function addOwner(c){
  const uid='synthetic-unknown-owner-'+randomUUID();
  const account=await c.backend.accountForUid(uid);
  await ref(c.root,'accounts',account).update({aiPilot:true,simulationOnly:true});
  const boot=await c.store.bootstrap(uid);const accountOwner=boot.account.id;
  await ref(c.accountRoot,'accounts',accountOwner).update({credited:40,available:40});
  const identity=accountIdentityKey(uid);assert.equal(identity,AccountStore.identityKey(uid));
  return {uid,account,accountOwner,identity};
}
async function fixture(scope){
  assertSafeEnvironment();
  const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
  const root=db.collection(videoCollection).doc(randomUUID()),accountRoot=db.collection(accountCollection).doc(randomUUID());
  const c={scope,db,root,accountRoot,roots:[root,accountRoot].map(document=>({root:document,marker:{project,purpose:'unknown-resolver-synthetic-v1',nonce:randomUUID()}}))};
  contexts.push(c);fixturesCreated++;assertSafeClient(c);
  for(const entry of c.roots){assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);}
  for(const entry of c.roots){await entry.root.create(entry.marker);assert.deepEqual((await entry.root.get()).data(),entry.marker);}
  c.backend=new FirestoreBackend(db,root);
  // Account runs with a caller-owned clock so a scenario can age an admission past the 15-minute floor without sleeping.
  c.accountClock=Date.now();
  c.store=new AccountStore(db,accountRoot,()=>c.accountClock);
  c.owner0=await addOwner(c);
  // The primary owner mirrors `c.account`/`c.identity` so single-owner scenarios read naturally.
  c.uid=c.owner0.uid;c.account=c.owner0.account;c.accountOwner=c.owner0.accountOwner;c.identity=c.owner0.identity;
  c.transport=new LocalAccountTransport(c.store);
  const objects={async putArtifactOnce(){throw Error('Unexpected synthetic artifact write');},async read(){throw Error('Unexpected synthetic object read');}};
  c.ai=new FirestoreAi(db,root,c.backend,objects,undefined,new AccountBillingClient(undefined,c.transport));
  return c;
}
// Create one fresh input (a private, ready video) and its project at revision 1 for an owner; returns its id.
async function addInput(c,label,owner=null){owner=owner??c.owner0;
  const input=randomUUID(),source=Buffer.from('synthetic source placeholder; not a decodable video '+label),sourceSha=sha(source);
  const storage={bucket:privateBucket,key:`candidate-files-v1/${input}/video.mp4`,generation:'1',size:source.length,sha256:sourceSha};
  await ref(c.root,'inputs',input).create({accountId:owner.account,expiresAtMs:Date.now()+3600000,sha256:sourceSha,deleted:false,ready:true,unknownCount:0,
    metadata:{duration:2,audioTracks:1},storage});
  await c.backend.saveProject(owner.account,input,0,'Synthetic input only.');
  return input;
}
const outbox=(c,jobId)=>ref(c.root,'billingOutbox',jobId);
const reservationDoc=(c,job)=>ref(c.accountRoot,'videoReservations',reservationDocId(job.owner.accountOwner,job.reservationId));

// Enqueue one text job on a fresh input for an owner (Account reserve included) and return its handle.
async function newJob(c,label='job',owner=null){
  owner=owner??c.owner0;
  const input=await addInput(c,label,owner);
  const requestKey=randomUUID(),id=await c.ai.enqueue(owner.account,input,'translation:en',1,requestKey,owner.uid);
  const row=await c.backend.job(owner.account,id);
  assert.equal(row.aiProfile,AI_CATALOG_VERSION);assert.equal(row.price,2);
  assert.deepEqual(await c.store.videoReservation(owner.identity,row.externalBilling.reservationId),{reservationId:row.externalBilling.reservationId,seconds:2,state:'reserved'});
  return {id,input,requestKey,reservationId:row.externalBilling.reservationId,attempt:null,owner};
}
// Take a queued job to `invoking` in the real Video backend (local check passes, then the durable invocation permit).
async function advanceToInvoking(c,job){
  const attempt=await c.backend.claim(job.owner.account,job.id);assert.ok(attempt,'the job must be claimable');
  const row=await c.backend.job(job.owner.account,job.id);
  if(row.invocationPhase==='local_check')assert.equal(await c.backend.resumeTextAfterLocalCheck(job.owner.account,job.id,attempt.attemptId,row.inputStorage,'nonzero'),true);
  assert.equal(await c.backend.beginInvocation(job.owner.account,job.id,attempt.attemptId),true);
  job.attempt=attempt;return attempt;
}
// Admit one provider call in the real Account and write the matching `providerCalls` receipt row (state `received`).
async function admitCall(c,job){
  const attempt=await advanceToInvoking(c,job);
  const requestSha256='b'.repeat(64),responseSha256='c'.repeat(64);
  await c.store.admitVideoCall(job.owner.identity,job.reservationId,2,job.id,attempt.attemptId,'text-window:0000','gemini-3.8-flash',requestSha256);
  await ref(c.root,'providerCalls',`${job.id}-text-window-0000`).create({jobId:job.id,accountId:job.owner.account,attemptId:attempt.attemptId,callKey:'text-window:0000',
    model:'gemini-3.8-flash',state:'received',requestSha256,responseSha256,responseId:'synthetic-unknown-receipt',httpStatus:200,
    startedAtMs:Date.now()-50,finishedAtMs:Date.now(),usage:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},fixtureOnly:true});
  return attempt;
}
// Seal a job into UNKNOWN through the client cancellation path; `admit` decides whether an Account admission exists.
async function sealUnknown(c,job,{admit=true,providerCall='received'}={}){
  if(admit)await admitCall(c,job);
  else{
    const attempt=await advanceToInvoking(c,job);
    if(providerCall)await ref(c.root,'providerCalls',`${job.id}-text-window-0000`).create({jobId:job.id,accountId:job.owner.account,attemptId:attempt.attemptId,callKey:'text-window:0000',
      model:'gemini-3.8-flash',state:providerCall,fixtureOnly:true});
  }
  assert.equal(await c.backend.cancel(job.owner.account,job.id),true,'the invoking job must seal into unknown');
  const row=await c.backend.job(job.owner.account,job.id);
  assert.equal(row.state,'unknown');
  assert.equal(row.attemptId,null,'the lease attempt is cleared on quarantine');
  assert.equal(row.unknownAttemptId,job.attempt.attemptId);
  assert.ok(Number.isSafeInteger(row.quarantinedAtMs));
  return row;
}
const resolve=(c,options)=>c.backend.resolveExpiredUnknown(options);
async function expectBalance(c,expected,owner=null){assert.deepEqual(await c.store.videoBalance((owner??c.owner0).identity),{unit:'video_seconds',...expected});}
const restored={credited:40,available:40,reserved:0,consumed:0,active:0};
const reserved={credited:40,available:38,reserved:2,consumed:0,active:1};
async function expectReserved(c,owner=null){await expectBalance(c,reserved,owner);}
// Documents the drain can move: terminal movement, outbox row, provider call rows and balance for one job.
async function accounting(c,job){
  const [terminal,row,calls,balance]=await Promise.all([ref(c.root,'movements','terminal:'+job.id).get(),outbox(c,job.id).get(),
    c.root.collection('providerCalls').where('jobId','==',job.id).get(),c.store.videoBalance(job.owner.identity)]);
  return {terminal:terminal.exists?terminal.data():null,outbox:row.exists?row.data():null,providerCalls:calls.size,balance};
}

// ---------------------------------------------------------------------------------------------------------------
// Characterisation: behaviour that already exists today must stay green (it fixes the ground the resolver builds on).
// ---------------------------------------------------------------------------------------------------------------

test('(caracterizacion) cancelling before the provider is contacted releases everything and clears active',async()=>{
  const c=await fixture('c1_cancel_before_send'),job=await newJob(c);
  assert.equal(await c.backend.cancel(c.account,job.id),true);
  const after=await c.backend.job(c.account,job.id);
  assert.equal(after.state,'cancelled');assert.equal(after.attemptId,null);
  assert.equal((await ref(c.root,'inputs',job.input).get()).get('unknownCount'),0,'a plain cancellation never quarantines the input');
  const result=await c.ai.drainExternalBilling();
  assert.equal(result.settled,1);assert.equal(result.failed,0);
  const reservation=await reservationDoc(c,job).get();
  assert.equal(reservation.get('state'),'released');
  assert.equal(field(reservation,'resolution','kind'),undefined,'a release before contact sends no resolution');
  await expectBalance(c,restored);
});

test('(caracterizacion) cancelling after the provider was contacted seals unknown, keeps the reservation and never captures',async()=>{
  const c=await fixture('c2_cancel_after_send'),job=await newJob(c);
  const sealed=await sealUnknown(c,job,{admit:true});
  assert.ok((sealed.quarantinedAtMs??0)>0);
  assert.equal((await ref(c.root,'inputs',job.input).get()).get('unknownCount'),1,'the entry lock rises with the quarantine');
  assert.equal((await ref(c.root,'artifacts',job.id).get()).get('state'),'purging');
  assert.deepEqual(await c.store.videoReservation(c.identity,job.reservationId),{reservationId:job.reservationId,seconds:2,state:'reserved'});
  await expectReserved(c);
  const result=await c.ai.drainExternalBilling();
  assert.deepEqual({settled:result.settled,failed:result.failed},{settled:0,failed:0},'an unknown job has nothing to drain');
  assert.equal((await ref(c.root,'movements','terminal:'+job.id).get()).exists,false,'an unknown job has no terminal movement');
  assert.equal((await outbox(c,job.id).get()).exists,false,'the settlement row only appears when money is finally resolved');
  await expectReserved(c);
});

test('(caracterizacion) the per-entry lock refuses a second job on an input that already has an unknown',async()=>{
  const c=await fixture('c3_entry_lock'),job=await newJob(c);
  await sealUnknown(c,job,{admit:true});
  await assert.rejects(()=>c.ai.enqueue(c.account,job.input,'translation:en',1,randomUUID(),c.uid),error=>{
    assert.ok(['conflict','quota'].includes(error?.code),`unexpected refusal code ${error?.code}`);return true;});
  const jobs=await c.root.collection('jobs').where('inputId','==',job.input).get();
  assert.equal(jobs.size,1,'the locked entry keeps its single job');
});

test('(caracterizacion) three distinct unknown jobs exhaust the account and the fourth enqueue is refused',async()=>{
  const c=await fixture('c4_account_limit');
  const jobs=[await newJob(c,'a'),await newJob(c,'b'),await newJob(c,'c')];
  for(const job of jobs)await sealUnknown(c,job,{admit:true});
  await expectBalance(c,{credited:40,available:34,reserved:6,consumed:0,active:3});
  const fourth=await addInput(c,'d');
  let refused=null;
  try{await c.ai.enqueue(c.account,fourth,'translation:en',1,randomUUID(),c.uid);}catch(error){refused=error;}
  assert.ok(refused,'the fourth active job must be refused');
  // The external path is refused by Account with quota (HTTP 429) before Video's own active>=3 check can answer conflict.
  assert.equal(refused.code,'quota',`unexpected refusal code ${refused.code}`);
  await expectBalance(c,{credited:40,available:34,reserved:6,consumed:0,active:3});
});

test('(caracterizacion) a sweep raises one unknown_age alert for a seeded unknown and writes only to billingPendingAlerts',async()=>{
  const c=await fixture('c5_sweep_alert'),job=await newJob(c);
  await sealUnknown(c,job,{admit:true});
  const nowMs=Date.now();
  const before=await tree(c.root);
  const first=await runPendingSweep(c.db,c.root,nowMs);
  const second=await runPendingSweep(c.db,c.root,nowMs+1000);
  assert.equal(first.ok,true);assert.equal(second.ok,true);
  const alerts=await c.root.collection(ALERT_COLLECTION).get();
  const forJob=alerts.docs.filter(d=>d.get('kind')==='job_unknown'&&d.get('rowId')===job.id);
  assert.equal(forJob.length,1,'a repeated sweep keeps exactly one alert for the same unknown row');
  assert.deepEqual({state:forJob[0].get('state'),reason:forJob[0].get('reason'),status:forJob[0].get('status')},{state:'unknown',reason:'unknown_age',status:'open'});
  assert.equal(second.created,0,'the repeat raises nothing new');
  const after=await tree(c.root);
  const allowed=[`${ALERT_COLLECTION}/`,`${AUDIT_COLLECTION}/`];
  for(const path of new Set([...after.keys(),...before.keys()]))if(!allowed.some(prefix=>path.includes(prefix)))
    assert.equal(after.get(path),before.get(path),`the sweep must not touch ${path}`);
});

test('(caracterizacion) worker finish, stage and heartbeat over an unknown job are rejected and change nothing',async()=>{
  const c=await fixture('c6_worker_rejected_on_unknown'),job=await newJob(c);
  await sealUnknown(c,job,{admit:true});
  const snapshot=async()=>({job:await c.backend.job(c.account,job.id),artifact:(await ref(c.root,'artifacts',job.id).get()).data(),
    balance:await c.store.videoBalance(c.identity),terminal:(await ref(c.root,'movements','terminal:'+job.id).get()).exists,row:(await outbox(c,job.id).get()).data()});
  const before=await snapshot();
  assert.equal(await c.backend.heartbeat(c.account,job.id,job.attempt.attemptId),false);
  assert.equal(await c.backend.finish(c.account,job.id,job.attempt.attemptId,true),false);
  assert.equal(await c.backend.finish(c.account,job.id,job.attempt.attemptId,false),false);
  await assert.rejects(()=>c.backend.stageArtifactReceipt(c.account,job.id,job.attempt.attemptId,[{name:'transcript-es.txt',key:'x',mimeType:'text/plain; charset=utf-8',generation:'1',size:1,sha256:'a'.repeat(64)}]));
  assert.deepEqual(await snapshot(),before,'a rejected worker call must not move a single document');
});

// ---------------------------------------------------------------------------------------------------------------
// The resolver: every scenario below fails today because FirestoreBackend.resolveExpiredUnknown does not exist.
// "resolveExpiredUnknown is not a function" is the correct, expected failure.
// ---------------------------------------------------------------------------------------------------------------

test('(rojo) before the deadline the resolver touches nothing: fields and balance are byte-identical',async()=>{
  const c=await fixture('r1_before_deadline'),job=await newJob(c);
  const sealed=await sealUnknown(c,job,{admit:true});
  const now=sealed.quarantinedAtMs+WINDOW-1;
  const before=await accounting(c,job);
  const result=await resolve(c,{now,limit:10});
  assert.deepEqual({scanned:result.scanned,resolved:result.resolved,notDue:result.notDue,failed:result.failed},{scanned:1,resolved:0,notDue:1,failed:0});
  assert.equal((await c.backend.job(c.account,job.id)).state,'unknown');
  assert.deepEqual(await accounting(c,job),before,'an unexpired unknown must not move a single field');
});

test('(rojo) exactly at quarantinedAtMs plus the window the resolver releases, one millisecond earlier it does not',async()=>{
  const c=await fixture('r2_exact_limit');
  const job=await newJob(c,'job');
  const sealed=await sealUnknown(c,job,{admit:true});
  const early=await resolve(c,{now:sealed.quarantinedAtMs+WINDOW-1,limit:10});
  assert.equal(early.resolved,0);
  assert.equal((await c.backend.job(c.account,job.id)).state,'unknown');
  const atLimit=await resolve(c,{now:sealed.quarantinedAtMs+WINDOW,limit:10});
  assert.equal(atLimit.resolved,1,'at the limit the window closes and the release is sent');
  assert.equal(atLimit.failed,0);
  assert.equal((await c.backend.job(c.account,job.id)).state,'failed');
});

test('(rojo) with an admission the resolver sends unknown_expired and the real Account frees the reservation, never capturing',async()=>{
  const c=await fixture('r3_admission_release'),job=await newJob(c);
  const sealed=await sealUnknown(c,job,{admit:true});
  const evidence=unknownEvidence(job.id,job.attempt.attemptId,sealed.quarantinedAtMs);
  const result=await resolve(c,{now:sealed.quarantinedAtMs+WINDOW,limit:10});
  assert.equal(result.resolved,1);assert.equal(result.failed,0);
  const done=await c.backend.job(c.account,job.id);
  assert.equal(done.state,'failed');assert.equal(done.reconciliationRef,evidence);assert.equal(done.resolvedAs,'unknown_expired');
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('action'),'release');assert.equal(row.get('resolutionKind'),'unknown_expired');
  assert.equal(row.get('evidenceSha256'),sha(evidence));assert.equal(row.get('attemptId'),job.attempt.attemptId);
  assert.equal(row.get('settlementProtocol'),3);
  c.accountClock+=UNKNOWN_RESOLUTION_MIN_AGE_MS+60_000;
  const drain=await c.ai.drainExternalBilling();
  assert.equal(drain.settled,1);assert.equal(drain.failed,0);
  const reservation=await reservationDoc(c,job).get();
  assert.equal(reservation.get('state'),'released');
  assert.equal(field(reservation,'resolution','kind'),'unknown_expired');
  assert.equal(field(reservation,'releaseAdmission','attemptId'),job.attempt.attemptId);
  await expectBalance(c,restored);
  assert.equal((await ref(c.root,'movements','terminal:'+job.id).get()).get('kind'),'external_release','the resolver never captures');
});

test('(rojo) without an admission the resolver frees with a plain release and the evidence names none',async()=>{
  const c=await fixture('r4_plain_release'),job=await newJob(c);
  const sealed=await sealUnknown(c,job,{admit:false,providerCall:null});
  const evidence=unknownEvidence(job.id,'none',sealed.quarantinedAtMs);
  const result=await resolve(c,{now:sealed.quarantinedAtMs+WINDOW,limit:10});
  assert.equal(result.resolved,1);
  const done=await c.backend.job(c.account,job.id);
  assert.equal(done.state,'failed');assert.equal(done.reconciliationRef,evidence);assert.equal(done.resolvedAs,'unknown_expired');
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('action'),'release');
  assert.equal(row.get('resolutionKind'),undefined,'a release before contact carries no resolution');
  assert.equal(row.get('attemptId'),undefined);
  const drain=await c.ai.drainExternalBilling();
  assert.equal(drain.settled,1);
  assert.equal(c.transport.lastRelease.admitted,false);
  assert.equal((await reservationDoc(c,job).get()).get('state'),'released');
  await expectBalance(c,restored);
});

test('(rojo) an admission divergence (provider call row without a stored Account admission) releases and stays stable',async()=>{
  const c=await fixture('r5_admission_divergence'),job=await newJob(c);
  // The call row is written `intent` BEFORE Account admits (Video's order), but here Account never registers it.
  const sealed=await sealUnknown(c,job,{admit:false,providerCall:'intent'});
  assert.equal((await c.root.collection('providerCalls').where('jobId','==',job.id).get()).size,1,'Video sees a provider call');
  assert.equal((await reservationDoc(c,job).get()).get('providerAdmission'),undefined,'Account stored no admission');
  const result=await resolve(c,{now:sealed.quarantinedAtMs+WINDOW,limit:10});
  assert.equal(result.resolved,1,'the presence of providerCalls is a safe superset of the Account admission');
  assert.equal((await outbox(c,job.id).get()).get('resolutionKind'),'unknown_expired');
  const drain=await c.ai.drainExternalBilling();
  assert.equal(drain.settled,1);
  const reservation=await reservationDoc(c,job).get();
  assert.equal(reservation.get('state'),'released');
  assert.equal(reservation.get('releaseAdmission'),undefined,'Account ignored the claim: it stored no release admission');
  assert.equal(field(reservation,'resolution','kind'),'unknown_expired');
  await expectBalance(c,restored);
  const again=await c.ai.drainExternalBilling();
  assert.deepEqual({settled:again.settled,failed:again.failed},{settled:0,failed:0},'the retry of the same drain is stable');
  await expectBalance(c,restored);
});

test('(rojo) two concurrent resolvers leave exactly one terminal movement and one release row',async()=>{
  const c=await fixture('r6_two_resolvers'),job=await newJob(c);
  const sealed=await sealUnknown(c,job,{admit:true});
  const now=sealed.quarantinedAtMs+WINDOW;
  const [a,b]=await Promise.all([resolve(c,{now,limit:10}),resolve(c,{now,limit:10})]);
  assert.equal((a.resolved??a)+(b.resolved??b),1,'exactly one concurrent resolver wins');
  assert.equal((await c.root.collection('movements').where('reference','==',job.id).get()).size,1,'one terminal movement');
  assert.equal((await c.root.collection('billingOutbox').where('jobId','==',job.id).get()).size,1,'one release row');
  assert.equal((await c.backend.job(c.account,job.id)).state,'failed');
});

test('(rojo) a resolver racing a manual reconcile: one wins, the other reports false or zero',async()=>{
  const c=await fixture('r6b_resolver_vs_reconcile'),job=await newJob(c);
  const sealed=await sealUnknown(c,job,{admit:true});
  const now=sealed.quarantinedAtMs+WINDOW;
  const [resolver,manual]=await Promise.allSettled([resolve(c,{now,limit:10}),Promise.resolve(c.backend.reconcile(c.account,job.id,'failed','manual-'+randomUUID()))]);
  const resolverResolved=resolver.status==='fulfilled'?(resolver.value.resolved??0):0;
  const manualWon=manual.status==='fulfilled'&&manual.value===true;
  assert.equal(resolverResolved+(manualWon?1:0),1,'exactly one of the resolver and the manual reconcile wins');
  assert.equal((await c.backend.job(c.account,job.id)).state,'failed');
  assert.equal((await c.root.collection('movements').where('reference','==',job.id).get()).size,1);
});

test('(rojo) a late provider answer after the release changes no artifact, no movement and no output row',async()=>{
  const c=await fixture('r7_late_answer'),job=await newJob(c);
  const sealed=await sealUnknown(c,job,{admit:true});
  await resolve(c,{now:sealed.quarantinedAtMs+WINDOW,limit:10});
  const settled=await accounting(c,job);
  assert.equal((await ref(c.root,'artifacts',job.id).get()).get('state'),'purging','the artifact is not downloadable');
  assert.equal(await c.backend.finish(c.account,job.id,job.attempt.attemptId,true),false);
  assert.equal(await c.backend.finish(c.account,job.id,job.attempt.attemptId,false),false);
  assert.equal(await c.backend.heartbeat(c.account,job.id,job.attempt.attemptId),false);
  await assert.rejects(()=>c.backend.stageArtifactReceipt(c.account,job.id,job.attempt.attemptId,[{name:'transcript-es.txt',key:'x',mimeType:'text/plain; charset=utf-8',generation:'1',size:1,sha256:'a'.repeat(64)}]));
  assert.deepEqual(await accounting(c,job),settled,'a late answer moves nothing after the release');
});

test('(rojo) the id cursor resolves more than one pass of expired rows without repeating or skipping',async()=>{
  const c=await fixture('r8_cursor_passes');
  const jobs=[await newJob(c,'a'),await newJob(c,'b'),await newJob(c,'c')];
  const sealed=[];
  for(const job of jobs)sealed.push(await sealUnknown(c,job,{admit:true}));
  const now=Math.max(...sealed.map(s=>s.quarantinedAtMs))+WINDOW;
  const first=await resolve(c,{now,limit:2});
  assert.equal(first.scanned,2);assert.equal(first.resolved,2);assert.ok(first.next,'the cursor advances to the second row read');
  const second=await resolve(c,{now,limit:2,after:first.next});
  assert.equal(second.resolved,1);assert.equal(second.next,null,'reaching the end wraps the cursor to null');
  const third=await resolve(c,{now,limit:2,after:second.next});
  assert.equal(third.resolved,0);assert.equal(third.scanned,0,'an empty tail scans nothing');
  for(const job of jobs)assert.equal((await c.backend.job(c.account,job.id)).state,'failed');
  assert.equal((await c.root.collection('movements').where('kind','==','external_release').get()).size,3,'each row resolved exactly once');
});

test('(rojo) a not-yet-due row at the front does not clog the pass, and a row that expires after the cursor is caught on the wrap',async()=>{
  const c=await fixture('r8b_cursor_wrap');
  const fresh=await newJob(c,'fresh'),due=await newJob(c,'due');
  const sealedDue=await sealUnknown(c,due,{admit:true});
  const sealedFresh=await sealUnknown(c,fresh,{admit:true});
  // Pin the fresh row's quarantine to just after the due row's, so it is provably NOT due at the first pass's clock
  // (still within the tolerated future skew of that clock).
  const now=sealedDue.quarantinedAtMs+WINDOW;
  await ref(c.root,'jobs',fresh.id).update({quarantinedAtMs:now-1});
  const pass=await resolve(c,{now,limit:10});
  assert.equal((await c.backend.job(due.owner.account,due.id)).state,'failed','a due row beside a fresh one is still resolved');
  assert.equal((await c.backend.job(fresh.owner.account,fresh.id)).state,'unknown','the fresh row waits for its own window');
  assert.equal(pass.notDue,1,'the fresh row is counted not due, letting the pass continue');
  // Now let the fresh row expire and resolve it from a wrapped cursor, without resolving the due row twice.
  const wrap=await resolve(c,{now:now+WINDOW,limit:10,after:null});
  assert.equal(wrap.resolved,1);
  assert.equal((await c.backend.job(fresh.owner.account,fresh.id)).state,'failed');
  assert.equal((await c.root.collection('movements').where('kind','==','external_release').get()).size,2);
});

test('(rojo) the incoming cursor is honored: a second pass continues past the first without re-reading it',async()=>{
  const c=await fixture('r8c_cursor_honored');
  const jobs=[await newJob(c,'a'),await newJob(c,'b'),await newJob(c,'c')];
  const sealed=[];
  for(const job of jobs)sealed.push(await sealUnknown(c,job,{admit:true}));
  // Every row is left open (the clock is at or before each row's own quarantine instant), so all three stay `unknown` and
  // the ONLY thing that keeps the second pass from re-reading the first two rows is the cursor passed back in.
  const now=Math.min(...sealed.map(row=>row.quarantinedAtMs));
  const first=await resolve(c,{now,limit:2});
  assert.equal(first.scanned,2);assert.equal(first.notDue,2);assert.equal(first.resolved,0);
  assert.ok(first.next,'the first full page hands back the last id read');
  const second=await resolve(c,{now,limit:2,after:first.next});
  assert.equal(second.scanned,1,'the second pass reads only the rows after the cursor, never the two already seen');
  assert.equal(second.notDue,1);
  assert.equal(second.next,null,'reaching the tail wraps the cursor to null');
  for(const job of jobs)assert.equal((await c.backend.job(job.owner.account,job.id)).state,'unknown','no row is due yet');
});

test('(rojo) a corrupt quarantine field counts failed, leaves the row untouched and never stops the pass',async()=>{
  const c=await fixture('r9_corrupt_rows');
  // Six corrupt rows across two owners: each owner may only hold three active jobs, so the corpus is split in two.
  const owners=[c.owner0,await addOwner(c)];
  const jobs=[await newJob(c,'good',owners[0]),await newJob(c,'missing',owners[0]),await newJob(c,'text',owners[0]),
    await newJob(c,'negative',owners[1]),await newJob(c,'future',owners[1]),await newJob(c,'badattempt',owners[1])];
  const [good,missing,text,negative,future,badAttempt]=jobs;
  const sealedGood=await sealUnknown(c,good,{admit:true});
  for(const job of [missing,text,negative,future,badAttempt])await sealUnknown(c,job,{admit:true});
  // Corrupt each row exactly as the design enumerates: absent, text, negative, in the future beyond the skew, and a non-UUID attempt.
  await ref(c.root,'jobs',missing.id).update({quarantinedAtMs:FieldValue.delete()});
  await ref(c.root,'jobs',text.id).update({quarantinedAtMs:'1000'});
  await ref(c.root,'jobs',negative.id).update({quarantinedAtMs:-1});
  const resolverNow=sealedGood.quarantinedAtMs+WINDOW+1;
  await ref(c.root,'jobs',future.id).update({quarantinedAtMs:resolverNow+SKEW+60_000});
  await ref(c.root,'jobs',badAttempt.id).update({unknownAttemptId:'not-a-uuid'});
  const rejectedJobs=[missing,text,negative,future,badAttempt];
  const beforeRejected=await Promise.all(rejectedJobs.map(job=>c.backend.job(job.owner.account,job.id)));
  const result=await resolve(c,{now:resolverNow,limit:10});
  assert.equal(result.failed>=5,true,`the five corrupt rows must count failed (got ${result.failed})`);
  assert.equal((await c.backend.job(good.owner.account,good.id)).state,'failed','the healthy row in the same pass is still resolved');
  for(const [index,job] of rejectedJobs.entries()){
    assert.equal((await c.backend.job(job.owner.account,job.id)).state,'unknown',`${job.id} must stay unknown`);
    assert.deepEqual(await c.backend.job(job.owner.account,job.id),beforeRejected[index],`${job.id} must not be touched`);
  }
});

test('(rojo) a settlement exception counts failed and the other rows in the same pass still resolve',async()=>{
  const c=await fixture('r9b_settle_exception');
  const healthy=await newJob(c,'healthy'),poisoned=await newJob(c,'poisoned');
  const sealedHealthy=await sealUnknown(c,healthy,{admit:true});
  const sealedPoisoned=await sealUnknown(c,poisoned,{admit:true});
  // Seed a terminal movement for one row so any settle must fail closed with an invariant, exercising the per-row catch.
  await ref(c.root,'movements','terminal:'+poisoned.id).create({accountId:c.account,kind:'external_release',reference:poisoned.id,credits:2,fixtureOnly:true});
  const result=await resolve(c,{now:Math.max(sealedHealthy.quarantinedAtMs,sealedPoisoned.quarantinedAtMs)+WINDOW,limit:10});
  assert.equal(result.failed,1,'the poisoned row counts failed');
  assert.equal(result.resolved,1,'the healthy row is still resolved in the same pass');
  assert.equal((await c.backend.job(c.account,healthy.id)).state,'failed');
  assert.equal((await c.backend.job(c.account,poisoned.id)).state,'unknown','the poisoned row is untouched');
});

test('(rojo) unknown_expired before the Account floor returns too_early and the output row reschedules without counting an attempt',async()=>{
  const c=await fixture('r10_too_early'),job=await newJob(c);
  const sealed=await sealUnknown(c,job,{admit:true});
  // A short review window lets the row expire while Account still holds the 15-minute floor from the admission.
  const result=await resolve(c,{now:sealed.quarantinedAtMs+1_000,limit:10,windowMs:1_000});
  assert.equal(result.resolved,1);
  c.accountClock+=UNKNOWN_RESOLUTION_MIN_AGE_MS-60_000;
  const before=Date.now(),drain=await c.ai.drainExternalBilling();
  assert.equal(drain.failed,1);assert.equal(drain.settled,0);
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('state'),'retry_wait');assert.equal(row.get('lastErrorCode'),'too_early');
  assert.equal(row.get('attempts')??0,0,'too_early must never consume an attempt');
  assert.ok(row.get('nextAttemptAt')>before,'the row is rescheduled for later');
  assert.equal((await reservationDoc(c,job).get()).get('state'),'reserved','the reservation stays held');
  await expectReserved(c);
});

test('(rojo) resolving one unknown frees the account slot so the next enqueue is admitted, and the stale alert stays open',async()=>{
  const c=await fixture('r11_slot_freed_and_alert_limit');
  const jobs=[await newJob(c,'a'),await newJob(c,'b'),await newJob(c,'c')];
  const sealed=[];
  for(const job of jobs)sealed.push(await sealUnknown(c,job,{admit:true}));
  // Sweep while the jobs are still unknown so the unknown_age alerts exist before any resolution.
  await runPendingSweep(c.db,c.root,Date.now());
  const raised=await c.root.collection(ALERT_COLLECTION).get();
  const openWhileUnknown=raised.docs.filter(d=>d.get('kind')==='job_unknown'&&jobs.some(j=>j.id===d.get('rowId')));
  assert.equal(openWhileUnknown.length,3,'a seeded unknown raises one alert each');
  // Resolve exactly one row (limit 1); the Account slot only frees once the release reaches Account.
  const now=Math.max(...sealed.map(s=>s.quarantinedAtMs))+WINDOW;
  const result=await resolve(c,{now,limit:1});
  assert.equal(result.resolved,1,'only one row is resolved with limit 1');
  assert.equal(result.next!==null,true,'the cursor advances past the one row attended');
  c.accountClock+=UNKNOWN_RESOLUTION_MIN_AGE_MS+60_000;
  const drain=await c.ai.drainExternalBilling();
  assert.equal(drain.settled,1);assert.equal(drain.failed,0);
  await expectBalance(c,{credited:40,available:36,reserved:4,consumed:0,active:2});
  // One resolved, so a fourth distinct job is admitted again.
  const input=await addInput(c,'d');
  const id=await c.ai.enqueue(c.account,input,'translation:en',1,randomUUID(),c.uid);
  assert.ok(id,'after one resolution the fourth distinct job is admitted');
  await expectBalance(c,{credited:40,available:34,reserved:6,consumed:0,active:3});
  // Declared limit: the alert of a resolved unknown stays open (jobs have no verifiable terminal set).
  const alerts=await c.root.collection(ALERT_COLLECTION).get();
  const forJobs=alerts.docs.filter(d=>d.get('kind')==='job_unknown'&&jobs.some(j=>j.id===d.get('rowId')));
  assert.ok(forJobs.length>=1,'the unknown_age alerts remain');
  for(const alert of forJobs)assert.equal(alert.get('status'),'open','an alert of a resolved unknown is never closed automatically');
});

test('(rojo) a voice unknown is never eligible: an expired narration is left intact while a text row of the same pass resolves',async()=>{
  const c=await fixture('r12_voice_not_eligible');
  const voice=await newJob(c,'voice'),text=await newJob(c,'text');
  // A narration cannot be sealed or cancelled through the normal path (both refuse voice), so it is seeded as a text job
  // and only then labelled as narration: the resolver reads `doc.get('operation')` straight from the job document.
  const sealedVoice=await sealUnknown(c,voice,{admit:true});
  await ref(c.root,'jobs',voice.id).update({operation:'narration:en'});
  const sealedText=await sealUnknown(c,text,{admit:true});
  const now=Math.max(sealedVoice.quarantinedAtMs,sealedText.quarantinedAtMs)+WINDOW;
  const before=await accounting(c,voice);
  const voiceJobBefore=await c.backend.job(c.account,voice.id);
  const balanceBefore=await c.store.videoBalance(c.identity);
  const result=await resolve(c,{now,limit:10});
  // The text row is due and resolves; the voice row is counted not-due, never failed, and is not modified at all.
  assert.equal(result.resolved,1,'the expired text row of the same pass is resolved');
  assert.equal(result.failed,0,'a voice row is never counted failed');
  assert.equal(result.notDue,1,'the expired voice row is reported as not due');
  assert.equal((await c.backend.job(c.account,text.id)).state,'failed','the text row really settled');
  assert.equal((await c.backend.job(c.account,voice.id)).state,'unknown','the voice row stays quarantined');
  assert.deepEqual(await c.backend.job(c.account,voice.id),voiceJobBefore,'not one job field of the voice row changes');
  assert.deepEqual(await accounting(c,voice),before,'no movement, outbox row, provider call or balance moves for the voice row');
  // The resolver only writes Video; the Account reservation moves when the outbox drains, which has not happened yet.
  assert.deepEqual(await c.store.videoBalance(c.identity),balanceBefore,'the resolver pass leaves Account untouched');
});
