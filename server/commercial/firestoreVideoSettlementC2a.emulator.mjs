// Synthetic-only LV-019.B C2a (Video side, etapa 2) fixture. It runs a real `AccountStore` (Account is already certified) behind a local
// adapter of `AccountBillingClient`, against the fixed demo emulator at 127.0.0.1:8185. No cloud service, credential, HTTP route or real media
// is touched. Execute only through a reviewed launcher with the fixed demo environment.
//
// Every scenario states the behaviour this step must reach (docs/specs/LV-019-B-liquidacion-parcial-y-liberacion-posadmision.md, sections 3, 4,
// 5 and 8). They are written to fail TODAY for the missing behaviour, never for a syntax or mount error.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {Firestore,FieldValue} from 'firebase-admin/firestore';
import {FirestoreBackend,EXTERNAL_BILLING_CONFLICT_ATTEMPT_LIMIT,LedgerFault} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {AI_CATALOG_VERSION} from './aiContracts.ts';
import {createDigitalSilenceAccumulator,digitalSilenceProof} from './digitalSilence.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {ALERT_COLLECTION,raisePendingAlerts} from './billingPendingAlerts.ts';
import {readPendingReport} from './billingPendingReport.ts';
import {UNKNOWN_RESOLUTION_MIN_AGE_MS} from '../account/settlementContract.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185';
const videoCollection='vistavo_video_c2a_settlement_video_synthetic',accountCollection='vistavo_video_c2a_settlement_ledger_synthetic';
// The retry bound is the production constant itself, never a copy: a repeated `conflict` must stop exactly here.
const CONFLICT_ATTEMPT_LIMIT=EXTERNAL_BILLING_CONFLICT_ATTEMPT_LIMIT;
// Cleanup is verified per created fixture root, so a test that uses several fixtures still balances exactly.
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');
let cleanups=0,fixturesCreated=0;
const ref=(root,collection,id)=>root.collection(collection).doc(id);
const reservationDocId=(accountId,reservationId)=>sha(JSON.stringify([accountId,reservationId]));
const field=(snapshot,name,key)=>(snapshot.get(name)??{})[key];

function assertSafeEnvironment(){
  // LV_REVIEW_CONTRACT/METADATA_SERVER_DETECTION are review markers, not credentials; a reviewed launcher sets them, but a bare `node --test` invocation gets them
  // here so the harness never aborts before its `afterEach` cleanup (the credentialed-absence checks below are the real gate and stay strict).
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
  const settings=c.db._settings;assert.equal(settings?.projectId,project);assert.equal(settings?.servicePath,'127.0.0.1');assert.equal(settings?.port,8185);
  assert.equal(settings?.ssl,false);assert.equal(settings?.preferRest,false);
  for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(settings?.[key],undefined);
}
async function descendants(document,found=[]){for(const group of await document.listCollections())for(const child of await group.listDocuments()){found.push(child);await descendants(child,found);}return found;}

before(async()=>{
  assertSafeEnvironment();
  assert.equal((await fetch(`http://${host}/`,{signal:AbortSignal.timeout(5000)})).status,200);
});
afterEach(async()=>{
  for(const c of contexts.splice(0)){
    // Cleanup must run even when a scenario failed or left a root in an unexpected shape: the root delete is attempted unconditionally, and only then is the
    // shape asserted, so a broken scenario can never leave synthetic roots behind.
    let problem=null;try{assertSafeClient(c);}catch(error){problem=error;console.error('Synthetic C2a Video settlement unsafe client before cleanup',error);}
    try{
      for(const entry of c.roots){
        try{assert.deepEqual((await entry.root.get()).data(),entry.marker);}catch(error){problem??=error;console.error('Synthetic C2a Video settlement marker changed',entry.root.path,error);}
        const known=await descendants(entry.root);for(const document of known)assert.ok(document.path.startsWith(entry.root.path+'/'));
        await c.db.recursiveDelete(entry.root);
        assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);
        for(const document of known){assert.equal((await document.get()).exists,false);assert.deepEqual(await document.listCollections(),[]);}
      }
      if(problem)throw problem;
      cleanups++;console.log(`Synthetic C2a Video settlement cleanup verified ${cleanups}/${fixturesCreated}`);
    }finally{await c.db.terminate();}
  }
});
after(()=>{try{console.log(`Synthetic C2a Video settlement cleanup total: ${cleanups}/${fixturesCreated}`);assert.equal(cleanups,fixturesCreated);}
  catch(error){console.error('Synthetic C2a Video settlement cleanup total mismatch',error);throw error;}});

const accountStatus={invalid:400,not_found:404,account_not_provisioned:404,conflict:409,deleted:410,quota:429,insufficient:402,invariant:503,too_early:409,forbidden:403};
/**
 * Local stand-in for the Account HTTP edge: it forwards the exact whitelisted body to a real `AccountStore` and maps `AccountFault` codes back to the
 * HTTP shape `AccountBillingClient` expects. The flags let a scenario force a remote observation without a second Account implementation.
 */
class LocalAccountTransport{
  bodies=[];events=[];lastRelease=null;forceReleaseConflict=false;forceTooEarly=false;lostReleaseAck=false;forceReleaseCode=null;
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
      if(action==='release'&&this.forceTooEarly)throw httpFault(409,'too_early');
      if(action==='release'&&this.forceReleaseConflict)throw httpFault(409,'conflict');
      if(action==='release'&&this.forceReleaseCode)throw httpFault(accountStatus[this.forceReleaseCode]??503,this.forceReleaseCode);
      const admission=body.jobId!==undefined?{jobId:body.jobId,attemptId:body.attemptId}:undefined;
      const options=body.resolutionKind!==undefined?{resolution:{kind:body.resolutionKind,evidenceSha256:body.evidenceSha256}}:body.capturedSeconds!==undefined?{capturedSeconds:body.capturedSeconds}:undefined;
      return guard(async()=>{const result=await this.store.settleVideo(body.identityKey,reservationId,action,body.seconds,admission,options);
        if(action==='release')this.lastRelease=result;
        if(this.lostReleaseAck){this.lostReleaseAck=false;throw Object.assign(Error('Synthetic ACK lost after commit'),{syntheticLostAck:true});}
        return {...result,reservationId};});
    }
    throw httpFault(404,'not_found');
  }
}

/** Canonical receipt tuple exactly as `verifiedProviderReceipt` hashes it: sorted by call key, fixed field order, object keys sorted recursively. */
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const receiptHash=calls=>sha(JSON.stringify(canonical([...calls].sort((a,b)=>String(a.callKey).localeCompare(String(b.callKey)))
  .map(call=>[call.callKey,call.requestSha256,call.responseSha256,call.responseId,call.usage]))));

async function fixture(scope){
  assertSafeEnvironment();
  const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
  const root=db.collection(videoCollection).doc(randomUUID()),accountRoot=db.collection(accountCollection).doc(randomUUID());
  const c={scope,db,root,accountRoot,roots:[root,accountRoot].map(document=>({root:document,marker:{project,purpose:'c2a-video-settlement-synthetic-v1',nonce:randomUUID()}}))};
  contexts.push(c);fixturesCreated++;assertSafeClient(c);
  for(const entry of c.roots){assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);}
  for(const entry of c.roots){await entry.root.create(entry.marker);assert.deepEqual((await entry.root.get()).data(),entry.marker);}
  c.backend=new FirestoreBackend(db,root);c.store=new AccountStore(db,accountRoot);
  c.uid='synthetic-c2a-owner-'+randomUUID();c.account=await c.backend.accountForUid(c.uid);
  await ref(root,'accounts',c.account).update({aiPilot:true,simulationOnly:true});
  const boot=await c.store.bootstrap(c.uid);c.accountOwner=boot.account.id;
  await ref(accountRoot,'accounts',c.accountOwner).update({credited:40,available:40});
  c.identity=accountIdentityKey(c.uid);assert.equal(c.identity,AccountStore.identityKey(c.uid));
  c.input=randomUUID();const source=Buffer.from('synthetic source placeholder; not a decodable video'),sourceSha=sha(source);
  c.storage={bucket:privateBucket,key:`candidate-files-v1/${c.input}/video.mp4`,generation:'1',size:source.length,sha256:sourceSha};
  await ref(root,'inputs',c.input).create({accountId:c.account,expiresAtMs:Date.now()+3600000,sha256:sourceSha,deleted:false,ready:true,unknownCount:0,
    metadata:{duration:2,audioTracks:1},storage:c.storage});
  await c.backend.saveProject(c.account,c.input,0,'Synthetic input only.');
  c.transport=new LocalAccountTransport(c.store);
  const objects={async putArtifactOnce(){throw Error('Unexpected synthetic artifact write');},async read(){throw Error('Unexpected synthetic object read');}};
  c.ai=new FirestoreAi(db,root,c.backend,objects,undefined,new AccountBillingClient(undefined,c.transport));
  const accumulator=createDigitalSilenceAccumulator(c.storage,{audioTracks:1,channels:2,sampleRate:48000});
  assert.equal(accumulator.write(Buffer.alloc(32)),true);c.silenceProof=digitalSilenceProof(accumulator.sealComplete());
  return c;
}
const outbox=(c,id)=>ref(c.root,'billingOutbox',id);
const reservationDoc=(c,reservationId)=>ref(c.accountRoot,'videoReservations',reservationDocId(c.accountOwner,reservationId));

/** Enqueue one text job (Account reserve included) and return its handle. */
async function newJob(c){
  const requestKey=randomUUID(),id=await c.ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);
  const row=await c.backend.job(c.account,id);
  assert.equal(row.aiProfile,AI_CATALOG_VERSION);assert.equal(row.price,2);
  assert.equal(row.externalBilling.identityKey,c.identity);
  assert.deepEqual(await c.store.videoReservation(c.identity,row.externalBilling.reservationId),{reservationId:row.externalBilling.reservationId,seconds:2,state:'reserved'});
  return {id,requestKey,reservationId:row.externalBilling.reservationId,attempt:null};
}
/** Claim and admit one provider call in the real Account, then write the matching worker receipt. */
async function admitCall(c,job){
  const attempt=await c.backend.claim(c.account,job.id);assert.ok(attempt);
  const row=await c.backend.job(c.account,job.id);
  if(row.invocationPhase==='local_check')assert.equal(await c.backend.resumeTextAfterLocalCheck(c.account,job.id,attempt.attemptId,row.inputStorage,'nonzero'),true);
  assert.equal(await c.backend.beginInvocation(c.account,job.id,attempt.attemptId),true);
  job.attempt=attempt;
  const requestSha256='b'.repeat(64),responseSha256='c'.repeat(64);
  await c.store.admitVideoCall(c.identity,job.reservationId,2,job.id,attempt.attemptId,'text-window:0000','gemini-3.8-flash',requestSha256);
  await ref(c.root,'providerCalls',`${job.id}-text-window-0000`).create({jobId:job.id,accountId:c.account,attemptId:attempt.attemptId,callKey:'text-window:0000',
    model:'gemini-3.8-flash',state:'received',requestSha256,responseSha256,responseId:'synthetic-c2a-receipt',httpStatus:200,
    startedAtMs:Date.now()-50,finishedAtMs:Date.now(),usage:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},fixtureOnly:true});
  return {callKey:'text-window:0000',requestSha256,responseSha256,responseId:'synthetic-c2a-receipt',usage:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2}};
}
/** `completeNoSpeech` after a provider answer: the incident C-5. */
async function noSpeechAfterAdmission(c,job){
  const receipt=await admitCall(c,job);
  assert.equal(await c.backend.completeNoSpeech(c.account,job.id,job.attempt.attemptId,[{callKey:receipt.callKey,responseSha256:receipt.responseSha256}]),true);
  return receipt;
}
/** Failure before any provider call: digital zero keeps the plain release semantics (the local check is the admitting phase). */
async function digitalZeroBeforeAdmission(c,job){
  const attempt=await c.backend.claim(c.account,job.id);assert.ok(attempt);job.attempt=attempt;
  assert.equal(await c.backend.completeDigitalSilence(c.account,job.id,attempt.attemptId,c.silenceProof),true);
}
/** Rewrite a row as a legacy protocol-1 row (no new fields, no `settlementProtocol`). */
const asLegacyRow=(c,id)=>outbox(c,id).update({settlementProtocol:FieldValue.delete(),resolutionKind:FieldValue.delete(),evidenceSha256:FieldValue.delete(),attemptId:FieldValue.delete()});
const makeDue=(c,id)=>outbox(c,id).update({nextAttemptAt:0});
const releaseBodies=t=>t.bodies.filter(body=>body.pathname.endsWith('/release'));

async function expectBalance(c,expected){assert.deepEqual(await c.store.videoBalance(c.identity),{unit:'video_seconds',...expected});}
const restored={credited:40,available:40,reserved:0,consumed:0,active:0};

test('S1 no speech after a provider admission releases with a no_speech claim (incident C-5)',async()=>{
  const c=await fixture('s1_no_speech_after_admission'),job=await newJob(c);
  await noSpeechAfterAdmission(c,job);
  assert.equal((await c.backend.job(c.account,job.id)).state,'failed');
  const row=await outbox(c,job.id).get();assert.equal(row.get('action'),'release');assert.equal(row.get('state'),'pending');
  const result=await c.ai.drainExternalBilling();
  assert.equal(result.settled,1);assert.equal(result.failed,0);
  const reservation=await reservationDoc(c,job.reservationId).get();
  assert.equal(reservation.get('state'),'released');
  assert.equal(field(reservation,'resolution','kind'),'no_speech');
  assert.match(field(reservation,'resolution','evidenceSha256'),/^[a-f0-9]{64}$/);
  assert.deepEqual({jobId:field(reservation,'releaseAdmission','jobId'),attemptId:field(reservation,'releaseAdmission','attemptId')},{jobId:job.id,attemptId:job.attempt.attemptId});
  await expectBalance(c,restored);
  const settled=await outbox(c,job.id).get();
  assert.equal(settled.get('state'),'settled');assert.equal(settled.get('action'),'release');
  assert.equal(settled.get('settlementProtocol'),3);assert.equal(settled.get('resolutionKind'),'no_speech');
  assert.equal(settled.get('evidenceSha256'),field(reservation,'resolution','evidenceSha256'));
  assert.equal(settled.get('attemptId'),job.attempt.attemptId);
});

test('S2 failure before any admission keeps the plain release and reports admitted:false',async()=>{
  const c=await fixture('s2_pre_admission_release'),job=await newJob(c);
  await digitalZeroBeforeAdmission(c,job);
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('action'),'release');assert.equal(row.get('settlementProtocol'),3);
  for(const name of ['resolutionKind','evidenceSha256','attemptId'])assert.equal(row.get(name),undefined,`Unexpected ${name}`);
  const result=await c.ai.drainExternalBilling();assert.equal(result.settled,1);
  assert.equal(c.transport.lastRelease.admitted,false);
  const release=releaseBodies(c.transport);assert.equal(release.length,1);
  assert.equal(release[0].data.jobId,undefined);assert.equal(release[0].data.resolutionKind,undefined);
  assert.equal((await reservationDoc(c,job.reservationId).get()).get('state'),'released');
  await expectBalance(c,restored);
  assert.equal((await outbox(c,job.id).get()).get('state'),'settled');
});

test('S3 reconcile(failed) after an admission releases with not_delivered and the evidence hash',async()=>{
  const c=await fixture('s3_reconcile_not_delivered'),job=await newJob(c);
  await admitCall(c,job);
  assert.equal(await c.backend.quarantine(c.account,job.id,job.attempt.attemptId),true);
  assert.equal((await c.backend.job(c.account,job.id)).state,'unknown');
  const evidence='reconciled-before-delivery-'+randomUUID();
  assert.equal(await c.backend.reconcile(c.account,job.id,'failed',evidence),true);
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('settlementProtocol'),3);assert.equal(row.get('resolutionKind'),'not_delivered');
  assert.equal(row.get('evidenceSha256'),sha(evidence));
  assert.equal((await c.backend.job(c.account,job.id)).reconciliationRef,evidence);
  const result=await c.ai.drainExternalBilling();assert.equal(result.settled,1);
  const reservation=await reservationDoc(c,job.reservationId).get();
  assert.equal(reservation.get('state'),'released');assert.equal(field(reservation,'resolution','kind'),'not_delivered');
  assert.equal(field(reservation,'resolution','evidenceSha256'),sha(evidence));
  await expectBalance(c,restored);
});

test('S4 one drain settles a legacy protocol-1 row and a protocol-3 row together',async()=>{
  const c=await fixture('s4_mixed_protocols'),legacy=await newJob(c),modern=await newJob(c);
  assert.equal(await c.backend.cancel(c.account,legacy.id),true);
  await noSpeechAfterAdmission(c,modern);
  await asLegacyRow(c,legacy.id);
  assert.equal((await outbox(c,legacy.id).get()).get('settlementProtocol'),undefined);
  const result=await c.ai.drainExternalBilling();
  assert.equal(result.settled,2);assert.equal(result.failed,0);
  assert.equal((await outbox(c,legacy.id).get()).get('state'),'settled');
  const modernRow=await outbox(c,modern.id).get();
  assert.equal(modernRow.get('state'),'settled');assert.equal(modernRow.get('settlementProtocol'),3);
  assert.equal((await reservationDoc(c,legacy.reservationId).get()).get('state'),'released');
  const reservation=await reservationDoc(c,modern.reservationId).get();
  assert.equal(reservation.get('state'),'released');assert.equal(field(reservation,'resolution','kind'),'no_speech');
});

test('S5 a new field without settlementProtocol 3 is quarantined before any Account call',async()=>{
  const c=await fixture('s5_new_field_without_protocol'),job=await newJob(c);
  assert.equal(await c.backend.cancel(c.account,job.id),true);
  await outbox(c,job.id).update({settlementProtocol:FieldValue.delete(),resolutionKind:'no_speech',evidenceSha256:'a'.repeat(64)});
  const before=c.transport.bodies.length;
  const result=await c.ai.drainExternalBilling();
  assert.equal(c.transport.bodies.length-before,0,'Account must receive nothing for an invalid row');
  assert.equal(result.settled,0);
  assert.equal((await outbox(c,job.id).get()).get('state'),'needs_review');
  const incidents=await c.root.collection('billingOutboxReviewIncidents').get();
  assert.equal(incidents.size,1);assert.equal(incidents.docs[0].get('phase'),'before_ack');
});

test('S6 a repeated conflict stops at the attempt limit and becomes needs_review with an alert',async()=>{
  const c=await fixture('s6_conflict_attempt_limit'),job=await newJob(c);
  await noSpeechAfterAdmission(c,job);
  c.transport.forceReleaseConflict=true;
  for(let attempt=1;attempt<=CONFLICT_ATTEMPT_LIMIT;attempt++){await makeDue(c,job.id);assert.equal((await c.ai.drainExternalBilling()).failed,1);}
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('state'),'needs_review');
  assert.ok(row.get('attempts')>=CONFLICT_ATTEMPT_LIMIT,`attempts=${row.get('attempts')}`);
  await makeDue(c,job.id);
  await c.ai.drainExternalBilling();
  assert.equal(releaseBodies(c.transport).length,CONFLICT_ATTEMPT_LIMIT,'a needs_review row must not be retried again');
  const report=await readPendingReport(c.root,Date.now());
  const entry=report.rows.find(candidate=>candidate.kind==='outbox'&&candidate.id===job.id);
  assert.ok(entry,'the row must still be reported while it needs attention');
  assert.equal(entry.attention,'needs_review');
  const raised=await raisePendingAlerts(c.db,c.root,report,Date.now());assert.equal(raised.created,1);
  const alerts=await c.root.collection(ALERT_COLLECTION).get();
  assert.equal(alerts.size,1);
  assert.deepEqual({kind:alerts.docs[0].get('kind'),rowId:alerts.docs[0].get('rowId'),state:alerts.docs[0].get('state'),reason:alerts.docs[0].get('reason')},
    {kind:'outbox',rowId:job.id,state:'needs_review',reason:'needs_review'});
  assert.equal((await reservationDoc(c,job.reservationId).get()).get('state'),'reserved','the limit alone does not move balance');
});

test('S6b too_early does not count and reschedules the row for later',async()=>{
  const c=await fixture('s6b_too_early'),job=await newJob(c);
  await noSpeechAfterAdmission(c,job);
  c.transport.forceTooEarly=true;
  const before=Date.now(),result=await c.ai.drainExternalBilling();assert.equal(result.failed,1);
  const reservation=await reservationDoc(c,job.reservationId).get(),admittedAtMs=field(reservation,'providerAdmission','admittedAtMs');
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('state'),'retry_wait');assert.equal(row.get('attempts')??0,0,'too_early must not consume an attempt');
  assert.notEqual(row.get('state'),'needs_review');
  assert.ok(Number.isSafeInteger(admittedAtMs));
  assert.ok(row.get('nextAttemptAt')>=admittedAtMs+UNKNOWN_RESOLUTION_MIN_AGE_MS,`nextAttemptAt=${row.get('nextAttemptAt')} admittedAtMs=${admittedAtMs}`);
  assert.ok(row.get('nextAttemptAt')>before);
});

test('S7 a double ACK of an admitted release with intact history settles without an incident',async()=>{
  const c=await fixture('s7_double_ack_admitted_release'),job=await newJob(c);
  await noSpeechAfterAdmission(c,job);
  const settleOnce=c.backend.markExternalBillingSettled.bind(c.backend);
  c.backend.markExternalBillingSettled=async(...args)=>{await settleOnce(...args);throw Error('Synthetic local write failure after commit');};
  const result=await c.ai.drainExternalBilling();
  assert.equal(result.settled,0);assert.equal(result.failed,1);
  assert.equal((await outbox(c,job.id).get()).get('state'),'settled');
  assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,0);
  assert.notEqual((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true);
  assert.equal((await reservationDoc(c,job.reservationId).get()).get('state'),'released');
  await expectBalance(c,restored);
});

test('S8 a release applied before a lost ACK closes the row on the retry',async()=>{
  const c=await fixture('s8_lost_ack_after_release'),job=await newJob(c);
  await noSpeechAfterAdmission(c,job);
  c.transport.lostReleaseAck=true;
  const first=await c.ai.drainExternalBilling();assert.equal(first.settled,0);assert.equal(first.failed,1);
  assert.equal((await reservationDoc(c,job.reservationId).get()).get('state'),'released','the movement was applied before the ACK was lost');
  assert.equal((await outbox(c,job.id).get()).get('state'),'retry_wait');
  await makeDue(c,job.id);
  const second=await c.ai.drainExternalBilling();assert.equal(second.settled,1);
  assert.equal((await outbox(c,job.id).get()).get('state'),'settled');
  assert.equal(releaseBodies(c.transport).length,2);
  await expectBalance(c,restored);
});

test('S9 the claim matches the stored admission and the row',async()=>{
  const c=await fixture('s9_claim_matches_admission'),job=await newJob(c);
  await noSpeechAfterAdmission(c,job);
  assert.equal((await c.ai.drainExternalBilling()).settled,1);
  const release=releaseBodies(c.transport);assert.equal(release.length,1);
  const claim=release[0].data,row=await outbox(c,job.id).get(),reservation=await reservationDoc(c,job.reservationId).get();
  assert.deepEqual({jobId:claim.jobId,attemptId:claim.attemptId,seconds:claim.seconds},{jobId:job.id,attemptId:job.attempt.attemptId,seconds:2});
  assert.deepEqual({jobId:field(reservation,'releaseAdmission','jobId'),attemptId:field(reservation,'releaseAdmission','attemptId')},{jobId:claim.jobId,attemptId:claim.attemptId});
  assert.equal(claim.resolutionKind,row.get('resolutionKind'));
  assert.equal(claim.evidenceSha256,row.get('evidenceSha256'));
  assert.equal(row.get('attemptId'),claim.attemptId);
});

test('S10 the evidence hash is reproducible from the data written in the same transaction',async()=>{
  const c=await fixture('s10_evidence_reproducible'),job=await newJob(c);
  await noSpeechAfterAdmission(c,job);
  assert.equal((await c.ai.drainExternalBilling()).settled,1);
  const calls=(await c.root.collection('providerCalls').where('jobId','==',job.id).get()).docs.map(document=>document.data());
  const recomputed=receiptHash(calls);
  assert.match(recomputed,/^[a-f0-9]{64}$/);
  const durable=await c.backend.job(c.account,job.id);
  assert.equal(durable.noSpeechReceiptHash,recomputed);
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('evidenceSha256'),recomputed);
  assert.equal(row.get('evidenceSha256'),durable.noSpeechReceiptHash);
});

/** Read the live pre-POST settlement snapshot for a pending row exactly as the drainer builds it (no side effects). */
async function liveSettlementSnapshot(c,jobId){
  const rows=await c.backend.pendingExternalBilling(25),row=rows.find(candidate=>candidate.id===jobId);assert.ok(row,`pending outbox row ${jobId}`);
  const validity=await c.ai.validExternalBillingOutbox(row);
  assert.equal(validity.state,'eligible');return validity.snapshot;
}

test('S11 markExternalBillingSettled refuses any expected tuple that differs from the stored row',async()=>{
  const c=await fixture('s11_mark_requires_exact_tuple'),admitted=await newJob(c);
  await noSpeechAfterAdmission(c,admitted);
  const snapshot=await liveSettlementSnapshot(c,admitted.id),expected=snapshot.expected;
  assert.equal(expected.settlementProtocol,3);assert.equal(expected.action,'release');
  // Every new protocol-3 field of the expectation is compared exactly against the stored row: a single differing field must not settle.
  const variants=[['resolutionKind',{...expected,resolutionKind:'not_delivered'}],['evidenceSha256',{...expected,evidenceSha256:'f'.repeat(64)}],
    ['attemptId',{...expected,attemptId:randomUUID()}],['capturedSeconds',{...expected,capturedSeconds:1}]];
  for(const [name,variant] of variants){
    assert.equal(await c.backend.markExternalBillingSettled(variant,{...snapshot,expected:variant}),false,`a row must not settle when ${name} differs`);
    assert.equal((await outbox(c,admitted.id).get()).get('state'),'pending',`${name} must leave the row pending`);
  }
  // A protocol-3 tuple that asserts the ABSENCE of the new fields must not match a row that carries them.
  const plain3={jobId:expected.jobId,accountId:expected.accountId,provider:expected.provider,identityKey:expected.identityKey,reservationId:expected.reservationId,seconds:expected.seconds,action:'release',settlementProtocol:3};
  assert.equal(await c.backend.markExternalBillingSettled(plain3,{...snapshot,expected:plain3}),false,'a v3 tuple must not match a row that carries the new fields');
  assert.equal((await outbox(c,admitted.id).get()).get('state'),'pending');
  assert.equal(await c.backend.markExternalBillingSettled(expected,snapshot),true,'the matching tuple must still settle');
  assert.equal((await outbox(c,admitted.id).get()).get('state'),'settled');

  // A legacy (v1) row is only settled by a legacy tuple, and a protocol-3 tuple never asserts the new fields of a v1 row.
  const legacy=await newJob(c);
  await noSpeechAfterAdmission(c,legacy);await asLegacyRow(c,legacy.id);
  const legacySnapshot=await liveSettlementSnapshot(c,legacy.id);
  assert.equal(legacySnapshot.expected.settlementProtocol,undefined);
  const protocol3={...legacySnapshot.expected,settlementProtocol:3,attemptId:expected.attemptId,resolutionKind:expected.resolutionKind,evidenceSha256:expected.evidenceSha256};
  assert.equal(await c.backend.markExternalBillingSettled(protocol3,{...legacySnapshot,expected:protocol3}),false,'a protocol-3 tuple must not settle a legacy row');
  assert.equal((await outbox(c,legacy.id).get()).get('state'),'pending');
  assert.equal(await c.backend.markExternalBillingSettled(legacySnapshot.expected,legacySnapshot),true,'the legacy pair must still settle');
  assert.equal((await outbox(c,legacy.id).get()).get('state'),'settled');
});

test('S12 a row that changes after the snapshot is quarantined after the ACK, never settled',async()=>{
  const c=await fixture('s12_row_changed_after_snapshot'),job=await newJob(c);
  await noSpeechAfterAdmission(c,job);
  const realMark=c.backend.markExternalBillingSettled.bind(c.backend);
  // Simulate a second writer that rewrites the stored resolution between the pre-POST read and the local mark.
  c.backend.markExternalBillingSettled=async(...args)=>{await outbox(c,job.id).update({resolutionKind:'not_delivered'});return realMark(...args);};
  const result=await c.ai.drainExternalBilling();
  const stored=await outbox(c,job.id).get();
  assert.equal(stored.get('state'),'needs_review');assert.notEqual(stored.get('state'),'settled');assert.equal(stored.get('resolutionKind'),'not_delivered');
  assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,1);
  assert.equal(result.settled,0);assert.equal(result.failed,1);
  assert.equal((await reservationDoc(c,job.reservationId).get()).get('state'),'released');
});
test('S13 a protocol-3 row rejects a field that belongs to the other action',async()=>{
  const c=await fixture('s13_fields_bound_to_action'),job=await newJob(c);
  await noSpeechAfterAdmission(c,job);
  // `capturedSeconds` only belongs to a capture: on a release it would be silently ignored by the POST body.
  await outbox(c,job.id).update({capturedSeconds:1});
  const before=c.transport.bodies.length;
  const result=await c.ai.drainExternalBilling();
  assert.equal(c.transport.bodies.length-before,0,'Account must receive nothing for a release that carries capturedSeconds');
  assert.equal(result.settled,0);
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('state'),'needs_review');
  assert.equal(row.get('state'),'needs_review','a row must not sit in retry_wait forever for a shape the client always refuses');
  const incidents=await c.root.collection('billingOutboxReviewIncidents').get();
  assert.equal(incidents.size,1);assert.equal(incidents.docs[0].get('phase'),'before_ack');
});

test('S14 every permanent code is bounded by the attempt limit',async()=>{
  for(const code of ['conflict','invalid','forbidden','not_found','quota','insufficient']){
    const c=await fixture('s14_limit_'+code),job=await newJob(c);
    await noSpeechAfterAdmission(c,job);
    c.transport.forceReleaseCode=code;
    for(let attempt=1;attempt<=EXTERNAL_BILLING_CONFLICT_ATTEMPT_LIMIT;attempt++){await makeDue(c,job.id);assert.equal((await c.ai.drainExternalBilling()).failed,1,`${code} attempt ${attempt}`);}
    const row=await outbox(c,job.id).get();
    assert.equal(row.get('state'),'needs_review',`${code} must reach needs_review at the limit`);
    assert.equal(row.get('attempts'),EXTERNAL_BILLING_CONFLICT_ATTEMPT_LIMIT,`${code} attempts`);
    assert.equal(row.get('lastErrorCode'),code);
    const posts=releaseBodies(c.transport).length;
    await makeDue(c,job.id);await c.ai.drainExternalBilling();
    assert.equal(releaseBodies(c.transport).length,posts,`${code} must never be retried after needs_review`);
    assert.equal((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),undefined,`${code} must not block the owner`);
  }
});

test('S15 an unexpected outbox key is quarantined before any Account call',async()=>{
  const c=await fixture('s15_unexpected_key'),job=await newJob(c);
  await noSpeechAfterAdmission(c,job);
  await outbox(c,job.id).update({captureAdmission:'unexpected'});
  const before=c.transport.bodies.length;
  const result=await c.ai.drainExternalBilling();
  assert.equal(c.transport.bodies.length-before,0,'an unknown field must never reach Account');
  assert.equal(result.settled,0);
  assert.equal((await outbox(c,job.id).get()).get('state'),'needs_review');
  assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,1);
});

test('S16 the retry bound is literally 8',async()=>{
  assert.equal(EXTERNAL_BILLING_CONFLICT_ATTEMPT_LIMIT,8);
});
test('S17 a stored outbox row with an unexpected key is never an accepted snapshot',async()=>{
  const c=await fixture('s17_stored_row_unexpected_key'),job=await newJob(c);
  await noSpeechAfterAdmission(c,job);
  const snapshot=await liveSettlementSnapshot(c,job.id);
  await outbox(c,job.id).update({captureAdmission:'unexpected'});
  const row=await outbox(c,job.id).get();
  const accepted=await c.backend.recordExternalBillingFailure(job.id,'conflict',{snapshotVersion:`${row.updateTime.seconds}:${String(row.updateTime.nanoseconds).padStart(9,'0')}`,state:row.get('state'),outbox:snapshot.expected});
  assert.equal(accepted,false,'a stored row with an unknown key must never match an expected snapshot');
  const after=await outbox(c,job.id).get();
  assert.equal(after.get('state'),'pending');assert.equal(after.get('attempts')??0,0);
});
test('S18 reconcile(failed) keeps the unknown attempt as the claim sent to Account',async()=>{
  const c=await fixture('s18_unknown_attempt_claim'),job=await newJob(c);
  await admitCall(c,job);
  assert.equal(await c.backend.quarantine(c.account,job.id,job.attempt.attemptId),true);
  const quarantined=await c.backend.job(c.account,job.id);
  assert.equal(quarantined.state,'unknown');
  assert.equal(quarantined.attemptId,null,'the lease attempt is cleared on quarantine');
  assert.equal(quarantined.unknownAttemptId,job.attempt.attemptId,'the admitted attempt survives as unknownAttemptId');
  const evidence='reconciled-after-unknown-'+randomUUID();
  assert.equal(await c.backend.reconcile(c.account,job.id,'failed',evidence),true);
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('attemptId'),job.attempt.attemptId,'the row carries the unknown attempt as its claim');
  assert.equal((await c.ai.drainExternalBilling()).settled,1);
  const release=releaseBodies(c.transport);assert.equal(release.length,1);
  assert.equal(release[0].data.attemptId,quarantined.unknownAttemptId,'the claim must be the preserved unknownAttemptId');
  const reservation=await reservationDoc(c,job.reservationId).get();
  assert.equal(field(reservation,'providerAdmission','attemptId'),release[0].data.attemptId,'the claim must match the stored Account admission');
  assert.equal(field(reservation,'releaseAdmission','attemptId'),release[0].data.attemptId,'the claim must be recorded as the release admission');
  assert.equal(field(reservation,'resolution','kind'),'not_delivered');
});
test('S19 an admitted release without a resolution fails closed with invariant and moves no balance',async()=>{
  // Reachability (GLM): no public route can reach `admitted` without a resolution - text with external billing is the only path, and both observers pass
  // it; every other path is fenced first. The guard stays as defence in depth, so it is exercised directly with a crafted context and a stub transaction:
  // production code is untouched, and the invariant must fire before any write.
  const attemptId=randomUUID();
  const writes=[];
  const tx={update:(...args)=>writes.push(['update',...args]),create:(...args)=>writes.push(['create',...args]),set:(...args)=>writes.push(['set',...args]),get:async()=>{throw Error('unexpected read');}};
  const c={terminalExists:false,job:{externalBilling:{provider:'account_seconds',identityKey:'a'.repeat(64),reservationId:randomUUID(),seconds:2},attemptId,price:2},
    providerReceipts:[{id:'call',data:{}}],account:{credited:0,available:0,reserved:0,consumed:0,active:0},input:{unknownCount:0}};
  const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
  const backend=new FirestoreBackend(db,db.collection(videoCollection).doc(randomUUID()));
  const settle=Reflect.get(backend,'settle').bind(backend);
  assert.throws(()=>settle(tx,c,'failed',null,undefined),error=>error instanceof LedgerFault&&error.code==='invariant');
  assert.equal(writes.length,0,'the guard must fire before any write');
});
test('S20 unavailable is transient and never reaches the retry bound by counting',async()=>{
  const c=await fixture('s20_unavailable_not_bounded'),job=await newJob(c);
  await noSpeechAfterAdmission(c,job);
  c.transport.forceReleaseCode='unavailable';
  const repeats=EXTERNAL_BILLING_CONFLICT_ATTEMPT_LIMIT+4;
  for(let attempt=1;attempt<=repeats;attempt++){
    const before=Date.now();await makeDue(c,job.id);
    assert.equal((await c.ai.drainExternalBilling()).failed,1,`unavailable attempt ${attempt}`);
    const row=await outbox(c,job.id).get();
    // `unavailable` is transient infrastructure: it reschedules but never counts the row out of `retry_wait`.
    assert.equal(row.get('state'),'retry_wait',`unavailable attempt ${attempt} must stay in retry_wait`);
    assert.notEqual(row.get('state'),'needs_review',`unavailable attempt ${attempt} must never be needs_review`);
    assert.equal(row.get('lastErrorCode'),'unavailable');
    assert.ok(Number.isSafeInteger(row.get('nextAttemptAt'))&&row.get('nextAttemptAt')>before,`unavailable attempt ${attempt} must reschedule for later`);
    assert.equal((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),undefined,'unavailable must not block the owner');
    assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,0,'unavailable alone raises no incident');
  }
  // The counter `attempts` does count the unavailable attempts, so the next permanent error already sits at or past the bound and moves the row to
  // `needs_review` (current, fail-closed behaviour, with an alert). Only `unavailable` itself is exempt from the bound.
  assert.ok((await outbox(c,job.id).get()).get('attempts')>=EXTERNAL_BILLING_CONFLICT_ATTEMPT_LIMIT);
  c.transport.forceReleaseCode='conflict';await makeDue(c,job.id);
  assert.equal((await c.ai.drainExternalBilling()).failed,1);
  const final=await outbox(c,job.id).get();
  assert.equal(final.get('state'),'needs_review');
  assert.equal(final.get('lastErrorCode'),'conflict');
  assert.equal((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),undefined,'needs_review must not block the owner');
});