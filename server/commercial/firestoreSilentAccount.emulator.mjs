// Synthetic-only local ledger integration; no real media decoder or HTTP route.
// A trusted accumulator supplies zero PCM bound to a synthetic source placeholder.
// Execute only through the reviewed launcher against the fixed demo emulator.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,openSync,realpathSync,writeSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {createDigitalSilenceAccumulator,digitalSilenceProof} from './digitalSilence.ts';
import {privateBucket} from './privateObjectPlan.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',testCount=5;
const videoCollection='vistavo_silent_account_video_synthetic',accountCollection='vistavo_silent_account_ledger_synthetic';
const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex');let cleanups=0,rootLog;
const ref=(root,name,id)=>root.collection(name).doc(id);
const sinceStart=()=>Math.round(performance.now());
function emit(event){writeSync(1,`# LV_SYNTHETIC ${JSON.stringify(event)}\n`);}
function rootEvent(event){assert.notEqual(rootLog,undefined);writeSync(rootLog,JSON.stringify(event)+'\n');fsyncSync(rootLog);}
async function stage(scope,name,work){
  const start=performance.now();emit({event:'stage_start',scope,name,atMs:sinceStart()});let status='failed';
  try{const value=await work();status='ok';return value;}
  finally{emit({event:'stage_end',scope,name,status,elapsedMs:Math.round(performance.now()-start),atMs:sinceStart()});}
}

function assertSafeEnvironment(){
  assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');
  assert.equal(process.env.LV_SILENT_ACCOUNT_CONTRACT,'1');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
  for(const key of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN',
    'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY',
    'GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY','VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID',
    'VISTAVO_AI_ENABLED','VISTAVO_FILES_MODE','VISTAVO_LOCAL_CLOUD','VISTAVO_ACCOUNT_ID','VISTAVO_JOB_ID','VISTAVO_GEMINI_KEY','K_SERVICE','K_REVISION',
    'K_CONFIGURATION','K_JOB','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.equal(process.env[key],undefined,`Unexpected ${key}`);
  const profile=process.env.USERPROFILE;assert.ok(profile&&profile===process.env.APPDATA&&profile===process.env.LOCALAPPDATA);
  const absolute=resolve(profile),base=resolve('outputs/lv019-b-silent-account-runs'),parts=relative(base,absolute).split(sep);
  assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
  assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(c){
  assertSafeEnvironment();assert.match(c.video.path,new RegExp(`^${videoCollection}/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`));
  assert.match(c.accountRoot.path,new RegExp(`^${accountCollection}/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`));
  assert.notEqual(c.video.path,c.accountRoot.path);assert.equal(c.db.projectId,project);assert.equal(c.db.databaseId,'(default)');
  const settings=c.db._settings;assert.equal(settings?.projectId,project);assert.equal(settings?.servicePath,'127.0.0.1');assert.equal(settings?.port,8185);
  assert.equal(settings?.ssl,false);assert.equal(settings?.preferRest,false);
  for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(settings?.[key],undefined);
}
async function descendants(document,found=[]){for(const group of await document.listCollections())for(const child of await group.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{assertSafeEnvironment();const taskDirectory=dirname(realpathSync(process.env.USERPROFILE));
  rootLog=openSync(join(taskDirectory,'synthetic-roots.jsonl'),'wx');
  await stage('setup','emulator_health',async()=>assert.equal((await fetch(`http://${host}/`,{signal:AbortSignal.timeout(5000)})).status,200));});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
  assertSafeClient(c);
  for(const entry of c.roots){
    await stage(c.scope,entry.root===c.video?'cleanup_video':'cleanup_account',async()=>{
      if(!entry.confirmed)throw Error('Unconfirmed synthetic root retained for audit');
      assert.deepEqual((await entry.root.get()).data(),entry.marker);
      const known=await descendants(entry.root);for(const document of known)assert.ok(document.path.startsWith(entry.root.path+'/'));
      await c.db.recursiveDelete(entry.root);assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);
      for(const document of known){assert.equal((await document.get()).exists,false);assert.deepEqual(await document.listCollections(),[]);}
      rootEvent({event:'cleanup_verified',scope:c.scope,path:entry.root.path,marker:entry.marker});
    });
  }
  cleanups++;console.log(`Synthetic silent Account cleanup verified ${cleanups}/${testCount}`);
 }finally{await stage(c.scope,'terminate_client',()=>c.db.terminate());}}});
after(()=>{try{console.log(`Synthetic silent Account cleanup total: ${cleanups}/${testCount}`);assert.equal(cleanups,testCount);}
  finally{if(rootLog!==undefined){closeSync(rootLog);rootLog=undefined;}}});

class MemoryAccountTransport{
  events=[];lostReleaseAck=false;
  constructor(c){this.c=c;}
  async request(request){
    const c=this.c;assertSafeClient(c);assert.equal(request.method,'POST');
    const pathname=new URL(request.url).pathname,body=request.data,parts=pathname.split('/');
    assert.ok(pathname.startsWith('/api/internal/video/reservations'));const reservationId=parts.at(-2);
    if(pathname==='/api/internal/video/reservations'){
      this.events.push('reserve');const result=await c.store.reserveVideo(body.identityKey,body.reservationId,body.seconds);
      return {data:{...result,reservationId:body.reservationId}};
    }
    if(pathname.endsWith('/status')){this.events.push('status');return {data:await c.store.videoReservation(body.identityKey,reservationId)};}
    if(pathname.endsWith('/release')){
      this.events.push('release');let result;
      try{result=await c.store.settleVideo(body.identityKey,reservationId,'release',body.seconds);}
      catch(error){throw Object.assign(Error('Synthetic account release failed'),{response:{status:error?.code==='conflict'?409:503}});}
      if(this.lostReleaseAck){this.lostReleaseAck=false;throw Error('Synthetic ACK lost after commit');}
      return {data:{...result,reservationId}};
    }
    this.events.push('unexpected');throw Error('Unexpected Account action');
  }
}
async function fixture(scope){
  assertSafeEnvironment();const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
  const video=db.collection(videoCollection).doc(randomUUID()),accountRoot=db.collection(accountCollection).doc(randomUUID());
  const c={scope,db,video,accountRoot,roots:[video,accountRoot].map(root=>({root,confirmed:false,marker:{project,purpose:'silent-account-synthetic-v1',nonce:randomUUID()}}))};
  contexts.push(c);assertSafeClient(c);
  // Persist allocations and random expected markers before the first Firestore
  // write. An interrupted/uncertain creation must be inspected, never assumed.
  rootEvent({event:'allocated',scope,roots:c.roots.map(entry=>({path:entry.root.path,marker:entry.marker}))});
  await stage(scope,'roots_absent',async()=>{for(const entry of c.roots){assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);}});
  rootEvent({event:'roots_absent',scope,roots:c.roots.map(entry=>({path:entry.root.path,marker:entry.marker}))});
  await stage(scope,'roots_create',async()=>{for(const entry of c.roots){
    await entry.root.create(entry.marker);assert.deepEqual((await entry.root.get()).data(),entry.marker);
    rootEvent({event:'root_confirmed',scope,path:entry.root.path,marker:entry.marker});entry.confirmed=true;}});
  c.backend=new FirestoreBackend(db,video);c.store=new AccountStore(db,accountRoot);c.uid='synthetic-silent-owner-'+randomUUID();c.otherUid='synthetic-silent-other-'+randomUUID();
  await stage(scope,'accounts_setup',async()=>{
    c.account=await c.backend.accountForUid(c.uid);c.otherVideo=await c.backend.accountForUid(c.otherUid);
    for(const account of [c.account,c.otherVideo])await ref(video,'accounts',account).update({aiPilot:true,simulationOnly:true});
    const owner=await c.store.bootstrap(c.uid),other=await c.store.bootstrap(c.otherUid);c.accountOwner=owner.account.id;c.accountOther=other.account.id;
    assert.notEqual(c.account,c.accountOwner);assert.notEqual(c.accountOwner,c.accountOther);
    await ref(accountRoot,'accounts',c.accountOwner).update({credited:40,available:40});await ref(accountRoot,'accounts',c.accountOther).update({credited:17,available:17});
    c.identity=accountIdentityKey(c.uid);c.otherIdentity=accountIdentityKey(c.otherUid);c.otherReservation=randomUUID();
    await c.store.reserveVideo(c.otherIdentity,c.otherReservation,3);c.otherBalance=await c.store.videoBalance(c.otherIdentity);
  });
  c.input=randomUUID();const source=Buffer.from('synthetic source placeholder; not a decodable video'),sourceSha=sha(source);
  c.storage={bucket:privateBucket,key:`candidate-files-v1/${c.input}/video.mp4`,generation:'1',size:source.length,sha256:sourceSha};
  await stage(scope,'input_setup',async()=>{await ref(video,'inputs',c.input).create({accountId:c.account,expiresAtMs:Date.now()+3600000,sha256:sourceSha,deleted:false,ready:true,unknownCount:0,
    metadata:{duration:2,audioTracks:1},storage:c.storage});await c.backend.saveProject(c.account,c.input,0,'Synthetic input only.');});
  c.transport=new MemoryAccountTransport(c);const client=new AccountBillingClient(undefined,c.transport);
  const objects={async putArtifactOnce(){throw Error('Unexpected synthetic artifact');},async read(){throw Error('Unexpected synthetic object read');}};
  c.ai=new FirestoreAi(db,video,c.backend,objects,undefined,client);
  await stage(scope,'reserve_and_enqueue',async()=>{c.job=await c.ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);c.jobRow=await c.backend.job(c.account,c.job);
    assert.equal(c.jobRow.externalBilling.identityKey,c.identity);c.reservationId=c.jobRow.externalBilling.reservationId;
    assert.deepEqual(await c.store.videoReservation(c.identity,c.reservationId),{reservationId:c.reservationId,seconds:2,state:'reserved'});});
  await stage(scope,'claim',async()=>{c.attempt=await c.backend.claim(c.account,c.job);assert.ok(c.attempt);assert.equal((await c.backend.job(c.account,c.job)).invocationPhase,'local_check');});
  const accumulator=createDigitalSilenceAccumulator(c.storage,{audioTracks:1,channels:2,sampleRate:48000});
  assert.equal(accumulator.write(Buffer.alloc(32)),true);c.proof=digitalSilenceProof(accumulator.sealComplete());
  return c;
}
async function expectOtherUntouched(c){assert.deepEqual(await c.store.videoBalance(c.otherIdentity),c.otherBalance);assert.deepEqual(await c.store.videoReservation(c.otherIdentity,c.otherReservation),{reservationId:c.otherReservation,seconds:3,state:'reserved'});}
async function expectNoProviderOrCapture(c){
  assert.equal((await c.video.collection('providerCalls').get()).size,0);
  assert.equal(c.transport.events.filter(event=>event==='unexpected').length,0);
  const ownerLedger=await c.accountRoot.collection('ledgerEntries').where('ownerAccountId','==',c.accountOwner).get();
  assert.equal(ownerLedger.docs.filter(doc=>doc.get('kind')==='video_capture').length,0);
  return ownerLedger;
}
async function expectReleasedOnce(c){
  assert.deepEqual(await c.store.videoReservation(c.identity,c.reservationId),{reservationId:c.reservationId,seconds:2,state:'released'});
  assert.deepEqual(await c.store.videoBalance(c.identity),{unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0});
  const outbox=await ref(c.video,'billingOutbox',c.job).get();assert.equal(outbox.get('state'),'settled');assert.equal(outbox.get('action'),'release');
  assert.equal(outbox.get('identityKey'),c.identity);assert.equal(outbox.get('reservationId'),c.reservationId);assert.equal(outbox.get('seconds'),2);
  const ledger=await expectNoProviderOrCapture(c);assert.equal(ledger.docs.filter(doc=>doc.get('kind')==='video_release').length,1);
  assert.equal((await ref(c.video,'movements','terminal:'+c.job).get()).get('kind'),'external_release');await expectOtherUntouched(c);
}

test('digital zero releases original synthetic Account exactly once',async()=>{
  const c=await fixture('control');assert.equal(await stage(c.scope,'complete_local',()=>c.backend.completeDigitalSilence(c.account,c.job,c.attempt.attemptId,c.proof)),true);
  assert.equal(await stage(c.scope,'confirm_local',()=>c.backend.confirmedDigitalSilence(c.account,c.job,c.attempt.attemptId,c.proof)),true);
  await stage(c.scope,'pending_checks',async()=>{assert.equal((await ref(c.video,'billingOutbox',c.job).get()).get('state'),'pending');
    assert.equal((await c.ai.status(c.account,c.job,c.uid)).billingState,'pending');});
  assert.equal((await stage(c.scope,'drain_first',()=>c.ai.drainExternalBilling())).settled,1);
  await stage(c.scope,'released_checks',async()=>{await expectReleasedOnce(c);assert.equal((await c.ai.status(c.account,c.job,c.uid)).billingState,'settled');});
  assert.equal(await stage(c.scope,'complete_replay',()=>c.backend.completeDigitalSilence(c.account,c.job,c.attempt.attemptId,c.proof)),false);
  assert.equal((await stage(c.scope,'drain_replay',()=>c.ai.drainExternalBilling())).settled,0);
  await stage(c.scope,'replay_checks',()=>expectReleasedOnce(c));
});
test('lost release ACK retries without a second synthetic movement',async()=>{
  const c=await fixture('lost_ack');assert.equal(await stage(c.scope,'complete_local',()=>c.backend.completeDigitalSilence(c.account,c.job,c.attempt.attemptId,c.proof)),true);
  c.transport.lostReleaseAck=true;
  const first=await stage(c.scope,'drain_lost_ack',()=>c.ai.drainExternalBilling());assert.equal(first.settled,0);assert.equal(first.failed,1);
  const due=await stage(c.scope,'retry_checks',async()=>{
    assert.equal((await c.store.videoReservation(c.identity,c.reservationId)).state,'released');
    const row=await ref(c.video,'billingOutbox',c.job).get();assert.equal(row.get('state'),'retry_wait');assert.equal(row.get('attempts'),1);
    assert.equal(row.get('lastErrorCode'),'unavailable');const last=row.get('lastAttemptAtMs'),next=row.get('nextAttemptAt');
    assert.ok(Number.isSafeInteger(last)&&Number.isSafeInteger(next));assert.equal(next-last,2000);return next;
  });
  const waitMs=Math.max(0,due-Date.now()+50);assert.ok(waitMs<=5000,'Synthetic first retry wait must be bounded');
  await stage(c.scope,'wait_real_retry',()=>delay(waitMs));assert.ok(Date.now()>=due,'Retry was attempted before its due time');
  const second=await stage(c.scope,'drain_retry',()=>c.ai.drainExternalBilling());assert.equal(second.settled,1);
  await stage(c.scope,'released_checks',async()=>{assert.equal(c.transport.events.filter(event=>event==='release').length,2);await expectReleasedOnce(c);});
  assert.equal((await stage(c.scope,'drain_replay',()=>c.ai.drainExternalBilling())).settled,0);
  await stage(c.scope,'replay_checks',()=>expectReleasedOnce(c));
});
test('changed source proof retains the original synthetic reservation',async()=>{
  const c=await fixture('source_changed'),changed={...c.proof,sourceGeneration:'2'};
  assert.equal(await stage(c.scope,'complete_changed',()=>c.backend.completeDigitalSilence(c.account,c.job,c.attempt.attemptId,changed)),false);
  await stage(c.scope,'retention_checks',async()=>{assert.equal((await c.backend.job(c.account,c.job)).state,'unknown');assert.equal((await ref(c.video,'billingOutbox',c.job).get()).exists,false);
    assert.equal((await c.store.videoReservation(c.identity,c.reservationId)).state,'reserved');});
  assert.equal((await stage(c.scope,'drain',()=>c.ai.drainExternalBilling())).settled,0);
  await stage(c.scope,'isolation_checks',async()=>{assert.equal(c.transport.events.filter(event=>event==='release').length,0);await expectNoProviderOrCapture(c);await expectOtherUntouched(c);});
});
test('foreign identity in outbox never releases either synthetic account',async()=>{
  const c=await fixture('foreign_outbox');assert.equal(await stage(c.scope,'complete_local',()=>c.backend.completeDigitalSilence(c.account,c.job,c.attempt.attemptId,c.proof)),true);
  await stage(c.scope,'change_outbox',()=>ref(c.video,'billingOutbox',c.job).update({identityKey:c.otherIdentity}));
  assert.equal((await stage(c.scope,'drain',()=>c.ai.drainExternalBilling())).settled,0);
  await stage(c.scope,'isolation_checks',async()=>{assert.equal((await c.store.videoReservation(c.identity,c.reservationId)).state,'reserved');
    assert.equal(c.transport.events.filter(event=>event==='release').length,0);await expectNoProviderOrCapture(c);await expectOtherUntouched(c);});
});
test('prior Account admission prevents automatic release',async()=>{
  const c=await fixture('prior_admission');await stage(c.scope,'synthetic_admission',()=>c.store.admitVideoCall(c.identity,c.reservationId,2,c.job,c.attempt.attemptId,'text-window:0000','gemini-3.8-flash','a'.repeat(64)));
  assert.equal(await stage(c.scope,'complete_local',()=>c.backend.completeDigitalSilence(c.account,c.job,c.attempt.attemptId,c.proof)),true);
  const result=await stage(c.scope,'drain',()=>c.ai.drainExternalBilling());assert.equal(result.settled,0);assert.equal(result.failed,1);
  await stage(c.scope,'isolation_checks',async()=>{assert.equal((await c.store.videoReservation(c.identity,c.reservationId)).state,'reserved');
    assert.notEqual((await ref(c.video,'billingOutbox',c.job).get()).get('state'),'settled');
    const ledger=await expectNoProviderOrCapture(c);assert.equal(ledger.docs.filter(doc=>doc.get('kind')==='video_release').length,0);await expectOtherUntouched(c);});
});
