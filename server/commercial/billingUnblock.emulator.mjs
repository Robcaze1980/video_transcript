// LV-019.B step 1.4b piece 2: the audited, Video-side unblock against a REAL AccountStore.
// Contract: docs/specs/LV-019-B-bloqueos-y-cierres-diseno.md v2 (decisions 4, 5, 8; 3.3; 3.4; 3.6; tests 11, 12, 12b, 13)
// and docs/evidence/lv019-b-t3-codificacion-1-4b-20261123/RECIBO-pieza-1.md.
// Synthetic only: the fixed loopback emulator and Account running in this process. No cloud, no credentials, no deploy.
import assert from 'node:assert/strict';
import {prepareFinancialOwnedRoot,assertFinancialOwnedRoot,deleteFinancialOwnedRoot} from './financialOwnedRootGuard.mjs';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend,LedgerFault,validClearIntentAdmissionGuard} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {ObjectFault} from './gcsObjects.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountFault,AccountStore} from '../account/backend.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {ALERT_COLLECTION,alertKey,raisePendingAlerts} from './billingPendingAlerts.ts';
import {readPendingReport} from './billingPendingReport.ts';
import {acquireDrainLease,DRAIN_LEASE_COLLECTION,DRAIN_LEASE_DOC_ID} from './billingDrainLease.ts';
import {blockedState,unblockBillingAccount,UnblockFault,UNBLOCK_AUDIT_COLLECTION,UNBLOCK_CONTINUITY_COLLECTION,UNBLOCK_WRITER_CUT_ID,unblockAuditId} from './billingUnblock.ts';
import {accountHoldId} from './billingHoldIdentity.ts';
import {attestLocalEmulatorPair,attestLocalEmulatorPairWithAccountRoot,UNBLOCK_SUCCESSOR_COLLECTION} from './billingUnblock.ts';

const project='demo-vistavo-financial',host='127.0.0.1:8198';
const videoCollection='vistavo_unblock_video_synthetic',accountCollection='vistavo_unblock_ledger_synthetic';
const sha=value=>createHash('sha256').update(String(value)).digest('hex');
const ref=(root,collection,id)=>root.collection(collection).doc(id);
const outbox=(c,id)=>ref(c.root,'billingOutbox',id);
const guardOf=(c)=>ref(c.root,'billingGuards',c.account);
const copy=data=>JSON.parse(JSON.stringify(data));
const contexts=[];let created=0,cleaned=0;

function assertSafeEnvironment(){
  if(!process.env.LV_REVIEW_CONTRACT)process.env.LV_REVIEW_CONTRACT='1';
  if(!process.env.METADATA_SERVER_DETECTION)process.env.METADATA_SERVER_DETECTION='none';
  assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
  for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE','K_JOB','FUNCTION_TARGET','GAE_ENV','GEMINI_API_KEY','OPENROUTER_API_KEY'])assert.equal(process.env[key],undefined,`Unexpected ${key}`);
}
function assertSafeClient(c){
  assertSafeEnvironment();
  assert.match(c.root.path,new RegExp(`^${videoCollection}/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`));
  assert.match(c.accountRoot.path,new RegExp(`^${accountCollection}/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`));
  const settings=c.db._settings;assert.equal(settings?.servicePath,'127.0.0.1');assert.equal(settings?.port,8198);assert.equal(settings?.ssl,false);assert.equal(settings?.preferRest,false);
}
async function descendants(document,found=[]){for(const group of await document.listCollections())for(const child of await group.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{assertSafeEnvironment();assert.equal((await fetch(`http://${host}/`,{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{
  for(const c of contexts.splice(0)){
    try{
      for(const entry of c.roots){await assertFinancialOwnedRoot(c.db,entry.root,entry.marker);const known=await descendants(entry.root);await deleteFinancialOwnedRoot(c.db,entry.root,entry.marker);assert.equal((await entry.root.get()).exists,false);for(const doc of known)assert.equal((await doc.get()).exists,false);}
      cleaned++;
    }finally{await c.db.terminate();}
  }
});
after(()=>{console.log(`Synthetic unblock-1.4b cleanup total: ${cleaned}/${created}`);assert.equal(cleaned,created);});

const accountStatus={invalid:400,not_found:404,account_not_provisioned:404,conflict:409,deleted:410,quota:429,insufficient:402,invariant:503,too_early:409,forbidden:403};
class LocalAccountTransport{
  bodies=[];fenced=null;lastFenced=null;
  constructor(store){this.store=store;}
  async request(request){
    const pathname=new URL(request.url).pathname,body=request.data??{};this.bodies.push({pathname,data:copy(body)});
    const parts=pathname.split('/'),reservationId=parts.at(-2);
    const httpFault=(status,code)=>Object.assign(Error('Synthetic Account refusal'),{response:{status,data:{error:code}}});
    const guard=async action=>{try{return {data:await action()};}catch(error){if(error?.response)throw error;throw httpFault(accountStatus[error?.code]??503,error?.code??'invariant');}};
    if(pathname==='/api/internal/video/billing-holds/unblock'){
      if(this.fenced&&body.incidentId===this.fenced.incidentId)return guard(()=>this.fencedConfirm(body));
      return guard(()=>this.store.unblockVideoBilling(body.identityKey,{incidentId:body.incidentId,epoch:body.epoch,createdAtMs:body.createdAtMs,reviewRef:body.reviewRef}));
    }
    if(pathname==='/api/internal/video/billing-holds/unblock-receipt'){
      if(this.fenced&&body.incidentId===this.fenced.incidentId)return guard(()=>this.fencedReceipt(body));
      return guard(()=>this.store.videoBillingUnblockReceipt(body.identityKey,body.incidentId,body.reviewRef));
    }
    if(pathname==='/api/internal/video/billing-holds/status')return guard(()=>this.store.videoBillingHold(body.identityKey,body.incidentId));
    if(pathname==='/api/internal/video/billing-holds')return guard(()=>this.store.blockVideoBilling(body.identityKey,body.incidentId));
    if(pathname==='/api/internal/video/reservations')return guard(async()=>({...await this.store.reserveVideo(body.identityKey,body.reservationId,body.seconds),reservationId:body.reservationId}));
    if(pathname==='/api/internal/video/balance')return guard(()=>this.store.videoBalance(body.identityKey));
    if(pathname.endsWith('/status'))return guard(()=>this.store.videoReservation(body.identityKey,reservationId));
    if(pathname.endsWith('/resolution'))return guard(()=>this.store.videoReservationResolution(body.identityKey,reservationId,body.seconds));
    if(pathname.endsWith('/admit'))return guard(()=>this.store.admitVideoCall(body.identityKey,reservationId,body.seconds,body.jobId,body.attemptId,body.callKey,body.model,body.requestSha256));
    if(pathname.endsWith('/seal'))return guard(()=>this.store.sealVideoReservation(body.identityKey,reservationId,body.seconds));
    if(pathname.endsWith('/release')||pathname.endsWith('/capture')){
      const action=pathname.endsWith('/release')?'release':'capture';
      const admission=body.jobId!==undefined?{jobId:body.jobId,attemptId:body.attemptId}:undefined;
      const options=body.resolutionKind!==undefined?{resolution:{kind:body.resolutionKind,evidenceSha256:body.evidenceSha256}}:body.capturedSeconds!==undefined?{capturedSeconds:body.capturedSeconds}:undefined;
      return guard(async()=>({...await this.store.settleVideo(body.identityKey,reservationId,action,body.seconds,admission,options),reservationId}));
    }
    throw httpFault(404,'not_found');
  }
  async fencedConfirm(body){
    const f=this.fenced;
    const attemptId=body.epoch===f.successorEpoch&&body.epoch!==f.previousEpoch?f.successorAttemptId:
      body.epoch===f.previousEpoch&&body.epoch!==f.successorEpoch?f.previousAttemptId:null;
    if(!attemptId)throw Object.assign(new Error('ambiguous fenced confirm epoch'),{code:'conflict'});
    const result=await this.store.confirmFencedVideoBillingUnblockAttempt(body.identityKey,{
      incidentId:body.incidentId,attemptId,epoch:body.epoch,createdAtMs:body.createdAtMs,
      reviewRef:body.reviewRef,authorizationSha256:f.authorizationSha256});
    if(result.state!=='confirmed'||result.attemptId!==attemptId||result.epoch!==body.epoch)
      throw Object.assign(new Error('unexpected fenced confirm'),{code:'conflict'});
    return {unblocked:true,replayed:result.replayed,blocked:result.blocked};
  }
  async fencedReceipt(body){
    const result=await fencedReceiptProbe(this.store,this.fenced,{
      identityKey:body.identityKey,incidentId:body.incidentId,reviewRef:body.reviewRef});
    this.lastFenced=result;
    if(result.state==='pending')return {state:'pending',incidentId:body.incidentId,reviewRef:body.reviewRef};
    return {state:'confirmed',incidentId:body.incidentId,reviewRef:body.reviewRef,
      epoch:result.epoch,createdAtMs:result.createdAtMs,blocked:result.blocked};
  }
}
class MemoryObjects{
  data=new Map();next=9007199254740993n;
  meta(key){const x=this.data.get(key);return x?{key,generation:x.generation,size:x.bytes.length,...(x.marker?{marker:true}:{})}:null;}
  async metadata(key){return this.meta(key);}
  save(key,bytes,marker=false){this.data.set(key,{generation:String(this.next++),bytes:Buffer.from(bytes),marker});return this.meta(key);}
  async putOnce(key,bytes){const existing=this.data.get(key);if(existing){if(existing.marker||!existing.bytes.equals(bytes))throw new ObjectFault('conflict');return this.meta(key);}return this.save(key,bytes);}
  async putArtifactOnce(key,bytes){return this.putOnce(key,bytes);}
  async composeOnce(key,sources,size){const old=this.meta(key);if(old){assert.equal(old.size,size);return old;}const parts=sources.map(s=>{const x=this.data.get(s.key);if(!x||x.generation!==s.generation)throw new ObjectFault('missing');return x.bytes;});const bytes=Buffer.concat(parts);assert.equal(bytes.length,size);return this.save(key,bytes);}
  async read(object,range){const x=this.data.get(object.key);if(!x||x.generation!==object.generation)throw new ObjectFault('missing');return Readable.from(range?x.bytes.subarray(range.start,range.end+1):x.bytes);}
  async barrier(key){const old=this.meta(key);return old?.marker?old:this.save(key,Buffer.alloc(0),true);}
}
async function fixture(scope){
  assertSafeEnvironment();
  const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
  const root=db.collection(videoCollection).doc(randomUUID()),accountRoot=db.collection(accountCollection).doc(randomUUID());
  const c={scope,db,root,accountRoot,roots:[root,accountRoot].map(document=>({root:document,marker:{project,purpose:'unblock-1.4b-synthetic-v1',nonce:randomUUID()}}))};
  contexts.push(c);created++;assertSafeClient(c);
  for(const entry of c.roots)await prepareFinancialOwnedRoot(c.db,entry.root,entry.marker);
  // Test-only: the isolated root has no older writers; install the immutable cut before creating guards.
  await assertFinancialOwnedRoot(c.db,c.root,c.roots[0].marker);
  c.writerCut=ref(c.root,UNBLOCK_CONTINUITY_COLLECTION,UNBLOCK_WRITER_CUT_ID);
  await c.writerCut.create({v:1,purpose:'unblock-writer-cut'});
  const cut=await c.writerCut.get();
  assert.deepEqual(cut.data(),{v:1,purpose:'unblock-writer-cut'});
  assert.ok(cut.createTime&&cut.updateTime&&cut.createTime.isEqual(cut.updateTime),'the writer cut is immutable');
  c.backend=new FirestoreBackend(db,root);c.store=new AccountStore(db,accountRoot);
  c.uid='synthetic-unblock-owner-'+randomUUID();c.account=await c.backend.accountForUid(c.uid);
  await ref(root,'accounts',c.account).update({aiPilot:true,simulationOnly:true});
  const boot=await c.store.bootstrap(c.uid);c.accountOwner=boot.account.id;
  await ref(accountRoot,'accounts',c.accountOwner).update({credited:40,available:40});
  c.identity=accountIdentityKey(c.uid);
  c.input=randomUUID();const source=Buffer.from('synthetic source placeholder; not a decodable video'),sourceSha=sha(source);
  c.objects=new MemoryObjects();
  await ref(root,'inputs',c.input).create({accountId:c.account,expiresAtMs:Date.now()+3600000,sha256:sourceSha,deleted:false,ready:true,unknownCount:0,metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:`candidate-files-v1/${c.input}/video.mp4`,generation:'1',size:source.length,sha256:sourceSha}});
  await c.backend.saveProject(c.account,c.input,0,'Synthetic input only.');
  c.transport=new LocalAccountTransport(c.store);
  c.accountBilling=new AccountBillingClient(undefined,c.transport);
  c.ai=new FirestoreAi(db,root,c.backend,c.objects,undefined,c.accountBilling);
  return c;
}
async function newJob(c){
  const requestKey=randomUUID(),id=await c.ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);
  return {id,requestKey,reservationId:(await c.backend.job(c.account,id)).externalBilling.reservationId,attempt:null};
}
async function admitCall(c,job){
  const attempt=await c.backend.claim(c.account,job.id);assert.ok(attempt);
  const row=await c.backend.job(c.account,job.id);
  if(row.invocationPhase==='local_check')assert.equal(await c.backend.resumeTextAfterLocalCheck(c.account,job.id,attempt.attemptId,row.inputStorage,'nonzero'),true);
  assert.equal(await c.backend.beginInvocation(c.account,job.id,attempt.attemptId),true);
  job.attempt=attempt;
  const requestSha256='b'.repeat(64),responseSha256='c'.repeat(64);
  await c.store.admitVideoCall(c.identity,job.reservationId,2,job.id,attempt.attemptId,'text-window:0000','gemini-3.8-flash',requestSha256);
  await ref(c.root,'providerCalls',`${job.id}-text-window-0000`).create({jobId:job.id,accountId:c.account,attemptId:attempt.attemptId,callKey:'text-window:0000',model:'gemini-3.8-flash',state:'received',requestSha256,responseSha256,responseId:'synthetic-unblock-receipt',httpStatus:200,startedAtMs:Date.now()-50,finishedAtMs:Date.now(),usage:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},fixtureOnly:true});
}
const outputs=()=>new Map([
  ['transcript-es.txt',Buffer.from('La bomba mide doce pulgadas.')],['transcript-es.srt',Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nLa bomba mide doce pulgadas.\n')],
  ['translation-en.txt',Buffer.from('The water pump is twelve inches wide.')],['translation-en.srt',Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nThe water pump is twelve inches wide.\n')],['cues.json',Buffer.from(JSON.stringify({durationMs:2000,cues:[{startMs:0,endMs:2000,es:'La bomba mide doce pulgadas.',en:'The water pump is twelve inches wide.'}]}))],
]);
async function captureJob(c){
  const job=await newJob(c);await admitCall(c,job);
  await c.ai.uploadResults(c.account,job.id,job.attempt.attemptId,outputs());
  assert.equal(await c.backend.finish(c.account,job.id,job.attempt.attemptId,true),true);
  return job;
}
async function releaseJob(c){
  const job=await newJob(c);await admitCall(c,job);
  assert.equal(await c.backend.completeNoSpeech(c.account,job.id,job.attempt.attemptId,[{callKey:'text-window:0000',responseSha256:'c'.repeat(64)}]),true);
  return job;
}
async function expectedAndSnapshot(c,id){
  const job=await c.backend.job(c.account,id),row=(await outbox(c,id).get()).data();
  const expected={jobId:id,accountId:c.account,provider:'account_seconds',identityKey:job.externalBilling.identityKey,reservationId:job.externalBilling.reservationId,seconds:job.externalBilling.seconds,action:row.action,...(row.attemptId!==undefined?{attemptId:row.attemptId}:{}),...(row.settlementProtocol!==undefined?{settlementProtocol:row.settlementProtocol}:{}),...(row.capturedSeconds!==undefined?{capturedSeconds:row.capturedSeconds}:{}),...(row.resolutionKind!==undefined?{resolutionKind:row.resolutionKind}:{}),...(row.evidenceSha256!==undefined?{evidenceSha256:row.evidenceSha256}:{})};
  const intentId=sha(JSON.stringify([c.account,job.requestKey])),snapshot=await c.db.runTransaction(tx=>c.backend.captureExternalBillingSettlement(tx,expected,intentId));
  assert.ok(snapshot);return {expected,snapshot};
}
const versionOf=async(c,id)=>{const s=await outbox(c,id).get();return s.updateTime.seconds+':'+String(s.updateTime.nanoseconds).padStart(9,'0');};

/**
 * Produce a genuinely blocked account: an outbox row goes to needs_review with a divergent ACK, which writes the
 * incident, the hold and the guard through the REAL writer, and then Account is blocked through the real drainer path
 * (the hold id IS Account's incident id). Returns the guard generation the operator must name.
 */
async function fixtureGuardAfterWriterCut(c){
  const [guard,cut]=await Promise.all([guardOf(c).get(),c.writerCut.get()]);
  assert.deepEqual(cut.data(),{v:1,purpose:'unblock-writer-cut'});
  assert.ok(cut.createTime&&cut.updateTime&&cut.createTime.isEqual(cut.updateTime));
  const a=guard.createTime,b=cut.createTime;
  assert.ok(a&&b&&(a.seconds>b.seconds||a.seconds===b.seconds&&a.nanoseconds>b.nanoseconds),'the guard must be created strictly after the synthetic cut');
  return guard.data();
}
async function blockedAccount(scope,options={}){
  const c=await fixture(scope),job=await captureJob(c);
  // Extra captured jobs are prepared BEFORE the block: a blocked account refuses new work, which is the point of the guard.
  const extras=[];for(let n=0;n<(options.extraJobs??0);n++)extras.push(await captureJob(c));
  const releases=[];for(let n=0;n<(options.extraReleases??0);n++)releases.push(await releaseJob(c));
  const {expected,snapshot}=await expectedAndSnapshot(c,job.id),version=await versionOf(c,job.id);
  const outcome=await c.backend.quarantineExternalBillingOutbox(job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
  assert.equal(outcome.state,'needs_review');assert.equal(outcome.ownerBlocked,true);
  const guard=await fixtureGuardAfterWriterCut(c);
  const holds=await c.root.collection('billingHoldOutbox').where('state','==','pending').get();
  assert.equal(holds.size,1,'the real writer leaves exactly one pending hold');
  const hold=holds.docs[0].get('id');
  const receipt=await c.accountBilling.block(c.identity,hold);
  assert.equal(receipt.created,true);
  await ref(c.root,'billingHoldOutbox',hold).update({state:'applied',appliedAtMs:Date.now()});
  const report=await readPendingReport(c.root,Date.now()),raised=await raisePendingAlerts(c.db,c.root,report,Date.now());
  const alert=(await c.root.collection(ALERT_COLLECTION).get()).docs.find(doc=>doc.get('kind')==='guard');
  assert.ok(alert,'the guard raises a D-4 alert');assert.equal(raised.created>=1,true);
  // The occurrence named by the guard: the incident key of the outbox review, never the hold id (which also carries the generation).
  const incident=guard.lastOutboxIncidentId??guard.lastIncidentId;
  return {c,job,extras,releases,guard,hold,incident,alertKey:alert.id,accountRoot:c.accountRoot};
}
/**
 * The INTENT-kind twin of `blockedAccount`: a captured reservation whose review row is written by the real
 * `recordExternalBillingReview` (the guard names `lastIncidentId`, the hold is named after that generation).
 */
async function blockedIntentAccount(scope){
  const c=await fixture(scope),requestKey=randomUUID(),reservationId=randomUUID(),data={provider:'account_seconds',identityKey:c.identity,reservationId,seconds:2};
  await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,data);
  await c.backend.recordExternalBillingReview(c.account,requestKey,data,{reservationId,state:'captured',seconds:2});
  const guard=await fixtureGuardAfterWriterCut(c);
  const holds=await c.root.collection('billingHoldOutbox').where('state','==','pending').get();
  assert.equal(holds.size,1,'the real writer leaves exactly one pending hold');
  const hold=holds.docs[0].get('id');
  assert.equal((await c.accountBilling.block(c.identity,hold)).created,true);
  await ref(c.root,'billingHoldOutbox',hold).update({state:'applied',appliedAtMs:Date.now()});
  const report=await readPendingReport(c.root,Date.now());await raisePendingAlerts(c.db,c.root,report,Date.now());
  const alert=(await c.root.collection(ALERT_COLLECTION).get()).docs.find(doc=>doc.get('kind')==='guard');
  assert.ok(alert,'the guard raises a D-4 alert');assert.ok(guard.lastIncidentId&&!guard.lastOutboxIncidentId,'an intent incident is named by lastIncidentId');
  return {c,guard,hold,incident:guard.lastIncidentId,alertKey:alert.id,accountRoot:c.accountRoot,requestKey,reservationId,data};
}
/** Read Account's own guard generation (test only: the production caller gets it from the operator tool of step 3.5). */
async function accountGuard(c){
  const doc=await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get();
  return doc.exists?{epoch:doc.get('epoch'),createdAtMs:doc.get('createdAtMs')}:null;
}
async function addAccountIncident(c){
  const incidentId=accountHoldId('outbox',randomUUID(),1,1);
  assert.equal((await c.accountBilling.block(c.identity,incidentId)).created,true);
  return incidentId;
}
async function reviewOtherAccountIncident(c,incidentId){
  const generation=await accountGuard(c);
  const receipt=await c.accountBilling.unblock(c.identity,{incidentId,...generation,reviewRef:'synthetic separate review'});
  assert.equal(receipt.blocked,false,'both Account incidents have been reviewed');
}
async function request(c,blocked,overrides={}){
  const current=await guardOf(c).get();
  const account=await accountGuard(c);
  return {
    incidentId:blocked.incident,alertKey:blocked.alertKey,
    epoch:current.get('epoch'),createdAtMs:current.get('createdAtMs'),updatedAtMs:current.get('updatedAtMs'),
    accountEpoch:account?.epoch??current.get('epoch'),accountCreatedAtMs:account?.createdAtMs??current.get('createdAtMs'),
    evidenceRef:'ticket-LV-019B-unblock-01',note:'Account sees the reservation terminal; the ACK did not match.',
    ...overrides,
  };
}
const deps=c=>({db:c.db,root:c.root,accountBilling:c.accountBilling});
const hashJson=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Account's EXACT version shape (server/account/backend.ts:52): seconds + ':' + nanoseconds, NO padding.
const stampNoPad=(doc,field)=>{const s=doc[field];
  return s&&Number.isSafeInteger(s.seconds)&&Number.isSafeInteger(s.nanoseconds)&&s.nanoseconds<1_000_000_000?
    s.seconds+':'+s.nanoseconds:null;};

/**
 * Uses the REAL AccountStore.fencedVideoBillingUnblockReceipt. The anchor chooses the ACTIVE attempt:
 * unfenced -> previous; fenced -> successor. The first probe is authoritative; a conflict means the other
 * attempt is active. No Firestore document is read or interpreted here.
 */
async function fencedReceiptProbe(store,seeded,input){
  const base={incidentId:input.incidentId,createdAtMs:seeded.accountCreatedAtMs,
    reviewRef:input.reviewRef,authorizationSha256:seeded.authorizationSha256};
  try{
    return await store.fencedVideoBillingUnblockReceipt(input.identityKey,
      {...base,attemptId:seeded.previousAttemptId,epoch:seeded.previousEpoch});
  }catch(error){
    if(error?.code!=='conflict')throw error;
    return store.fencedVideoBillingUnblockReceipt(input.identityKey,
      {...base,attemptId:seeded.successorAttemptId,epoch:seeded.successorEpoch});
  }
}
async function seedFencedSuccessor(c,blocked,options={}){
  const accountId=c.accountOwner;
  const incidentId=options.anchorIncidentId??blocked.hold;
  const identityKey=options.identityKey??c.identity;
  const reviewRef=options.reviewRef??'ticket-LV-019B-unblock-01';
  const guardDoc=ref(c.accountRoot,'videoBillingGuards',accountId),guard=await guardDoc.get();
  assert.equal(guard.exists,true,'the real Account guard is required');
  const liveEpoch=guard.get('epoch'),accountCreatedAtMs=guard.get('createdAtMs');
  assert.ok(Number.isSafeInteger(liveEpoch)&&liveEpoch>=1);assert.ok(Number.isSafeInteger(accountCreatedAtMs));
  const incidentDoc=ref(c.accountRoot,'videoBillingIncidents',hashJson([accountId,incidentId]));
  const existing=await incidentDoc.get();assert.equal(existing.exists,true,'the real Account incident is required');
  if(existing.get('unblockProtocol')===undefined)await incidentDoc.update({unblockProtocol:'fenced_v1'});
  const incident=await incidentDoc.get(),identity=await ref(c.accountRoot,'identities',identityKey).get();
  assert.equal(identity.exists,true,'the real Account identity is required');
  const original={ownerAccountId:accountId,identityKey,incidentId,unblockProtocol:'fenced_v1',
    createdAtMs:accountCreatedAtMs,reviewRef,
    authorizationSha256:options.authorizationSha256??hashJson(['synthetic-grant',identityKey,incidentId]),
    identityVersion:stampNoPad(identity,'updateTime'),
    incidentVersion:stampNoPad(incident,'createTime'),
    guardVersion:stampNoPad(guard,'createTime')};
  assert.ok(original.identityVersion&&original.incidentVersion&&original.guardVersion,'real versions are required');
  assert.equal(original.guardVersion,guard.createTime.seconds+':'+guard.createTime.nanoseconds,'unpadded guard version');
  assert.equal(original.incidentVersion,incident.createTime.seconds+':'+incident.createTime.nanoseconds,'unpadded incident version');
  const previousAttemptId=options.previousAttemptId??randomUUID();
  const successorAttemptId=options.successorAttemptId??randomUUID();
  const reconcileId=options.reconcileId??randomUUID();
  const previousEpoch=options.previousEpoch??liveEpoch;
  const successorEpoch=options.successorEpoch??liveEpoch;
  assert.notEqual(previousAttemptId,successorAttemptId);
  const anchor=ref(c.accountRoot,'videoBillingUnblockAttempts',hashJson([accountId,incidentId]));
  await anchor.create({...original,initialAttemptId:previousAttemptId,initialEpoch:previousEpoch});
  const grant=options.grant===false?null:ref(c.accountRoot,'videoBillingUnblockReconciliationGrants',
    hashJson([accountId,incidentId,reconcileId]));
  if(grant)await grant.create({...original,previousAttemptId,previousEpoch,reconcileId,
    attemptId:successorAttemptId,epoch:successorEpoch});
  const seededAnchor=await anchor.get();
  assert.ok(seededAnchor.createTime.isEqual(seededAnchor.updateTime),'the seeded anchor is immutable');
  if(grant){const g=await grant.get();assert.ok(g.createTime.isEqual(g.updateTime),'the seeded grant is immutable');}
  c.transport.fenced={accountRoot:c.accountRoot,accountId,identityKey:c.identity,incidentId,
    previousAttemptId,previousEpoch,successorAttemptId,successorEpoch,
    accountCreatedAtMs,authorizationSha256:original.authorizationSha256};
  return {accountId,incidentId,identityKey:c.identity,reviewRef,accountCreatedAtMs,liveEpoch,original,
    previousAttemptId,previousEpoch,successorAttemptId,successorEpoch,reconcileId,
    authorizationSha256:original.authorizationSha256,anchor,grant};
}
function fencedDeps(c,seeded){
  const attestation=attestLocalEmulatorPairWithAccountRoot(c.db,c.db,c.accountRoot);
  const seam={
    attestation,
    attempt:{previousAttemptId:seeded.previousAttemptId,previousEpoch:seeded.previousEpoch,
      reconcileId:seeded.reconcileId,attemptId:seeded.successorAttemptId,epoch:seeded.successorEpoch,
      authorizationSha256:seeded.authorizationSha256},
    accountCreatedAtMs:seeded.accountCreatedAtMs,
    async receipt(input){
      const value=await c.accountBilling.unblockReceipt(input.identityKey,input.incidentId,input.reviewRef);
      const fenced=c.transport.lastFenced;
      if(!fenced)throw new UnblockFault('corrupt');
      if(value.state==='pending'){
        if(fenced.state!=='pending')throw new UnblockFault('corrupt');
        return {state:'pending',attemptId:fenced.attemptId,epoch:fenced.epoch,createdAtMs:fenced.createdAtMs};
      }
      if(value.state!=='confirmed'||fenced.state!=='confirmed')throw new UnblockFault('corrupt');
      return {state:'confirmed',attemptId:fenced.attemptId,epoch:value.epoch,createdAtMs:value.createdAtMs,
        blocked:value.blocked,replayed:true};
    },
    async reconcile({identityKey,incidentId,reviewRef}){
      return c.store.reconcileVideoBillingUnblockAttempt(identityKey,{
        incidentId,attemptId:seeded.successorAttemptId,epoch:seeded.successorEpoch,
        createdAtMs:seeded.accountCreatedAtMs,reviewRef,authorizationSha256:seeded.authorizationSha256,
        previousAttemptId:seeded.previousAttemptId,previousEpoch:seeded.previousEpoch,
        reconcileId:seeded.reconcileId});
    },
    async confirm({identityKey,incidentId,reviewRef,attempt}){
      const tuple=attempt==='previous'?
        {attemptId:seeded.previousAttemptId,epoch:seeded.previousEpoch}:
        {attemptId:seeded.successorAttemptId,epoch:seeded.successorEpoch};
      if(seeded.previousEpoch===seeded.successorEpoch)
        return c.store.confirmFencedVideoBillingUnblockAttempt(identityKey,{
          incidentId,attemptId:tuple.attemptId,epoch:tuple.epoch,createdAtMs:seeded.accountCreatedAtMs,
          reviewRef,authorizationSha256:seeded.authorizationSha256});
      const value=await c.accountBilling.unblock(identityKey,{
        incidentId,epoch:tuple.epoch,createdAtMs:seeded.accountCreatedAtMs,reviewRef});
      return {state:'confirmed',attemptId:tuple.attemptId,epoch:tuple.epoch,
        createdAtMs:seeded.accountCreatedAtMs,blocked:value.blocked,replayed:value.replayed};
    },
  };
  return {db:c.db,root:c.root,accountBilling:c.accountBilling,successor:seam,localAccountRoot:c.accountRoot};
}

async function signatures(root){
  const out={};
  for(const name of await root.listCollections()){
    for(const doc of (await name.get()).docs)out[doc.ref.path]=doc.updateTime.seconds+':'+String(doc.updateTime.nanoseconds).padStart(9,'0')+'|'+(doc.get('state')??'');
  }
  return out;
}

test('a block during reserve keeps the Account confirmation without creating or capturing work',{timeout:120000},async()=>{
  const c=await fixture('block_during_reserve'),requestKey=randomUUID(),now=Date.now(),original=c.transport.request.bind(c.transport);
  c.transport.request=async call=>{
    if(new URL(call.url).pathname==='/api/internal/video/reservations'){
      await guardOf(c).create({accountId:c.account,blocked:true,epoch:1,createdAtMs:now,updatedAtMs:now,lastIncidentId:sha('synthetic concurrent incident')});
    }
    return original(call);
  };
  await assert.rejects(c.ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid));
  c.transport.request=original;
  const intentId=sha(JSON.stringify([c.account,requestKey])),intent=ref(c.root,'billingIntents',intentId);
  const row=(await intent.get()).data();
  assert.equal(row.state,'reserve_pending');
  assert.equal((await c.root.collection('jobs').get()).size,0);
  assert.equal((await c.root.collection('billingOutbox').get()).size,0);
  const acks=await c.root.collection('billingReserveAckObservations').get();
  assert.equal(acks.size,1,'the successful Account confirmation survives without a job');
  assert.equal(acks.docs[0].get('attribution'),'unverified');
  assert.deepEqual(await c.store.videoBalance(c.identity),{unit:'video_seconds',credited:40,available:38,reserved:2,consumed:0,active:1});
  const witness=await c.backend.externalIntentWitness(c.account,requestKey,{
    provider:'account_seconds',identityKey:c.identity,reservationId:row.reservationId,seconds:2,
  });
  assert.equal(await c.backend.captureDirectObservation(witness,requestKey,'status'),null);
  assert.equal(c.transport.bodies.some(x=>x.pathname.endsWith('/capture')),false);

  const incidentId=sha('synthetic-account-review');
  await c.accountBilling.block(c.identity,incidentId);
  const generation=await accountGuard(c);
  assert.equal((await c.accountBilling.unblock(c.identity,{incidentId,...generation,reviewRef:'synthetic reviewed incident'})).blocked,false);
  await guardOf(c).delete();
  await intent.update({createdAtMs:Date.now()-30*60*1000,nextAttemptAt:0});
  await c.ai.drainExternalBilling();
  await c.ai.drainExternalBilling();
  assert.equal((await intent.get()).get('state'),'closed');
  assert.deepEqual(await c.store.videoBalance(c.identity),{unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0});
  assert.equal(c.transport.bodies.filter(x=>x.pathname.endsWith('/release')).length,1);
  assert.equal(c.transport.bodies.some(x=>x.pathname.endsWith('/capture')),false);
});

test('a capture already authorized by Video reaches Account before a concurrent hold propagates',{timeout:120000},async()=>{
  const c=await fixture('capture_before_hold_propagation'),job=await captureJob(c);
  const capturePath=`/api/internal/video/reservations/${job.reservationId}/capture`;
  const accountGuardRef=ref(c.accountRoot,'videoBillingGuards',c.accountOwner);
  const initialBalance={unit:'video_seconds',credited:40,available:38,reserved:2,consumed:0,active:1};
  assert.equal((await c.backend.job(c.account,job.id)).state,'succeeded');
  const settlement=(await outbox(c,job.id).get()).data();
  assert.equal(settlement.action,'capture');
  assert.equal(settlement.state,'pending');
  assert.equal((await guardOf(c).get()).exists,false);
  assert.equal((await accountGuardRef.get()).exists,false);
  assert.deepEqual(await c.store.videoBalance(c.identity),initialBalance);

  const original=c.transport.request.bind(c.transport);
  const start=c.transport.bodies.length;
  const concurrentRequestKey=randomUUID();
  const concurrentIncidentId=sha(JSON.stringify([c.account,concurrentRequestKey]));
  c.transport.request=async call=>{
    if(new URL(call.url).pathname===capturePath){
      // The drain has passed Video validation. Publish a separate incident before dispatching this POST to Account.
      const reservationId=randomUUID();
      const billing={provider:'account_seconds',identityKey:c.identity,reservationId,seconds:2};
      await c.backend.beginExternalBillingIntent(c.account,c.input,concurrentRequestKey,'translation:en',1,billing);
      const review=await c.backend.recordExternalBillingReview(c.account,concurrentRequestKey,billing,{reservationId,seconds:2,state:'captured'});
      assert.equal(review.state,'needs_review');
      assert.equal((await guardOf(c).get()).get('blocked'),true);
      assert.equal((await c.root.collection('billingHoldOutbox').where('state','==','pending').get()).size,1);
      assert.equal((await accountGuardRef.get()).exists,false);
      assert.deepEqual(await c.store.videoBalance(c.identity),initialBalance);
    }
    return original(call);
  };
  await c.ai.drainExternalBilling();
  c.transport.request=original;

  const calls=c.transport.bodies.slice(start);
  const captures=calls.filter(call=>call.pathname===capturePath);
  assert.equal(captures.length,1,'one capture POST reached the real AccountStore');
  assert.equal(captures[0].data.identityKey,c.identity);
  assert.equal(captures[0].data.seconds,2);
  assert.equal(calls.some(call=>call.pathname==='/api/internal/video/billing-holds'),false);
  const guard=(await guardOf(c).get()).data();
  assert.equal(guard.blocked,true);
  assert.equal(guard.lastIncidentId,concurrentIncidentId);
  assert.equal((await accountGuardRef.get()).exists,false);
  assert.equal((await c.store.videoReservation(c.identity,job.reservationId)).state,'captured');
  const capturedBalance={...initialBalance,reserved:0,consumed:2,active:0};
  assert.deepEqual(await c.store.videoBalance(c.identity),capturedBalance);
  const captured=await c.accountRoot.collection('ledgerEntries').where('kind','==','video_capture').get();
  assert.equal(captured.size,1);
  assert.equal(captured.docs[0].get('seconds'),2);

  const row=await outbox(c,job.id).get();
  assert.equal(row.get('state'),'needs_review');
  assert.equal(row.get('action'),'capture');
  assert.equal(row.get('reservationId'),job.reservationId);
  const ackIncidentId=row.get('reviewIncidentId');
  assert.equal(guard.lastOutboxIncidentId,ackIncidentId);
  assert.notEqual(ackIncidentId,concurrentIncidentId);
  const ackIncident=await ref(c.root,'billingOutboxReviewIncidents',ackIncidentId).get();
  assert.equal(ackIncident.get('state'),'needs_review');
  assert.equal(ackIncident.get('phase'),'after_ack');
  assert.equal(ackIncident.get('reason'),'remote_ack_outbox_changed');
  assert.equal(ackIncident.get('outboxId'),job.id);
  assert.equal(ackIncident.get('accountId'),c.account);
  assert.equal(ackIncident.get('attribution'),'verified');
  assert.deepEqual(ackIncident.get('remoteAck'),{reservationId:job.reservationId,seconds:2,state:'captured'});
  const concurrentIncident=await ref(c.root,'billingReviewIncidents',concurrentIncidentId).get();
  assert.equal(concurrentIncident.get('reason'),'captured_without_job');

  const holds=await c.root.collection('billingHoldOutbox').get();
  assert.equal(holds.size,2);
  assert.ok(holds.docs.some(doc=>doc.get('sourceKind')==='intent'&&doc.get('sourceId')===concurrentIncidentId&&doc.get('state')==='pending'));
  const ackHold=holds.docs.find(doc=>doc.id===accountHoldId('outbox',ackIncidentId,guard.epoch,guard.createdAtMs));
  assert.ok(ackHold);
  assert.equal(ackHold.get('sourceKind'),'outbox');
  assert.equal(ackHold.get('sourceId'),ackIncidentId);
  assert.equal(ackHold.get('accountId'),c.account);
  assert.equal(ackHold.get('state'),'pending');

  const beforeReplay=await signatures(c.root),callsBeforeReplay=c.transport.bodies.length;
  await c.ai.drainExternalBilling();
  assert.equal(c.transport.bodies.length,callsBeforeReplay,'the next drain sends no second capture');
  assert.deepEqual(await signatures(c.root),beforeReplay,'the next drain preserves both incidents and holds');
  assert.deepEqual(await c.store.videoBalance(c.identity),capturedBalance);
  assert.equal((await c.accountRoot.collection('ledgerEntries').where('kind','==','video_capture').get()).size,1);
});

test('a blocked account keeps due release outboxes unchanged and releases them once after the audited unblock',{timeout:120000},async()=>{
  const blocked=await blockedAccount('blocked_release_outbox',{extraReleases:2}),{c,releases}=blocked;
  const pending=outbox(c,releases[0].id),retrying=outbox(c,releases[1].id);
  const old=Date.now()-3*24*60*60*1000;
  await pending.update({state:'pending',attempts:7,nextAttemptAt:0,createdAtMs:old});
  await retrying.update({state:'retry_wait',attempts:7,nextAttemptAt:0,createdAtMs:old});
  const foreignUid='synthetic-foreign-'+randomUUID(),foreign=await c.store.bootstrap(foreignUid),foreignIdentity=accountIdentityKey(foreignUid);
  await ref(c.accountRoot,'accounts',foreign.account.id).update({credited:10,available:10});
  const foreignReservation=randomUUID();await c.store.reserveVideo(foreignIdentity,foreignReservation,3);
  const foreignBefore=await c.store.videoBalance(foreignIdentity);
  const before=await Promise.all([pending.get(),retrying.get()]);
  const balanceBefore=await c.store.videoBalance(c.identity),postsBefore=c.transport.bodies.length;
  assert.deepEqual(balanceBefore,{unit:'video_seconds',credited:40,available:34,reserved:6,consumed:0,active:3});

  for(let i=0;i<9;i++)await c.ai.drainExternalBilling();
  const during=await Promise.all([pending.get(),retrying.get()]);
  for(let i=0;i<2;i++){
    assert.deepEqual(during[i].data(),before[i].data(),'a blocked release retains all scheduling fields');
    assert.equal(during[i].updateTime.isEqual(before[i].updateTime),true,'a blocked release writes no document');
  }
  assert.deepEqual(await c.store.videoBalance(c.identity),balanceBefore);
  assert.deepEqual(await c.store.videoBalance(foreignIdentity),foreignBefore);
  assert.equal(c.transport.bodies.slice(postsBefore).filter(x=>x.pathname.endsWith('/release')||x.pathname.endsWith('/capture')).length,0);
  const report=await readPendingReport(c.root,Date.now()+60000);
  for(const job of releases)assert.ok(report.rows.some(row=>row.kind==='outbox'&&row.id===job.id));
  const alerts=await raisePendingAlerts(c.db,c.root,report,Date.now()+60000,{ageThresholdMs:1});
  assert.ok(alerts.created>=2);
  const alertsAgain=await raisePendingAlerts(c.db,c.root,report,Date.now()+60001,{ageThresholdMs:1});
  assert.equal(alertsAgain.created,0,'repeat sweep does not duplicate alerts');

  const unblockRequest=await request(c,blocked);
  const result=await unblockBillingAccount(deps(c),c.account,unblockRequest,'operator-ana',9_000_000_000);
  assert.equal(result.videoBlocked,false);
  // Neither aged refund was visited by the age cursor while blocked. The reopening and its receipt protect both.
  await c.backend.escalateStaleBillingRows({now:Date.now(),limit:25});
  assert.equal((await pending.get()).get('state'),'pending');
  assert.equal((await retrying.get()).get('state'),'retry_wait');
  const start=c.transport.bodies.length;
  await c.ai.drainExternalBilling();
  await c.ai.drainExternalBilling();
  for(const job of releases){
    const sent=c.transport.bodies.slice(start).filter(x=>x.pathname.endsWith('/release')&&x.pathname.includes(job.reservationId));
    assert.equal(sent.length,1,'each due reservation has one release request');
    assert.equal((await c.store.videoReservation(c.identity,job.reservationId)).state,'released');
    assert.equal((await outbox(c,job.id).get()).get('state'),'settled');
  }
  const balanceAfter=await c.store.videoBalance(c.identity);
  assert.equal(balanceAfter.reserved,0);
  assert.equal(balanceAfter.available-balanceBefore.available,4,'both two-second reservations return to available balance');
  assert.equal(balanceAfter.consumed,2,'only the independently completed job is captured');
  assert.equal(balanceAfter.active,0);
  assert.deepEqual(await c.store.videoBalance(foreignIdentity),foreignBefore,'the other account is untouched');
});

for(const missing of ['billingIntentWitnesses','billingIntentJobMarkers','billingIntentAdmissionGuards']){
 test(`an aged refund with missing ${missing} goes to review despite the account guard`,{timeout:120000},async()=>{
  const {c,releases}=await blockedAccount('unverified_refund_age',{extraReleases:1}),job=releases[0];
  const intentId=createHash('sha256').update(JSON.stringify([c.account,job.requestKey])).digest('hex');
  const row=outbox(c,job.id),guard=await guardOf(c).get(),balanceBefore=await c.store.videoBalance(c.identity),calls=c.transport.bodies.length,now=Date.now();
  await row.update({createdAtMs:now-3*24*60*60*1000});
  const history=ref(c.root,missing,intentId);assert.equal((await history.get()).exists,true);await history.delete();
  assert.equal((await c.backend.escalateStaleBillingRows({now,limit:25})).escalated,1);
  assert.equal((await row.get()).get('state'),'needs_review');
  const report=await readPendingReport(c.root,now);await raisePendingAlerts(c.db,c.root,report,now);
  const alert=await ref(c.root,ALERT_COLLECTION,alertKey('outbox',job.id,'needs_review','needs_review')).get();
  assert.equal(alert.get('status'),'open');
  assert.equal((await guardOf(c).get()).updateTime.isEqual(guard.updateTime),true);
  assert.equal(c.transport.bodies.length,calls);
  assert.deepEqual(await c.store.videoBalance(c.identity),balanceBefore);
 });
}
// ---------------------------------------------------------------------------
// 1.4b piece 1 (guard accounting): every writer creates epoch 1 + createdAtMs and grows the epoch on a re-block.
// ---------------------------------------------------------------------------
test('guard accounting: the real outbox writer creates epoch 1 with createdAtMs and a re-block grows the epoch',{timeout:30000},async()=>{
  const {c,guard,hold,extras}=await blockedAccount('guard_epoch',{extraJobs:1});
  assert.equal(guard.epoch,1,'a new guard starts at epoch 1');assert.ok(Number.isSafeInteger(guard.createdAtMs)&&guard.createdAtMs>0,'a new guard carries createdAtMs');
  assert.equal(guard.blocked,true);assert.equal(guard.lastOutboxIncidentId!==undefined,true);
  const second=extras[0];const {expected,snapshot}=await expectedAndSnapshot(c,second.id),version=await versionOf(c,second.id);
  await c.backend.quarantineExternalBillingOutbox(second.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
  const grown=(await guardOf(c).get()).data();
  assert.equal(grown.epoch,2,'adding an incident to a blocked guard increments the epoch');assert.equal(grown.createdAtMs,guard.createdAtMs,'the generation keeps its creation mark');
  assert.notEqual(grown.lastOutboxIncidentId,guard.lastOutboxIncidentId);
  assert.equal(hold.length,64);
});
test('guard accounting: a legacy guard without createdAtMs is refused, and a missing epoch is read as 1 only when the mark exists',{timeout:40000},async()=>{
  // Declared migration: real bases are empty, so a guard that cannot name its generation aborts instead of being adopted.
  for(const [scope,legacy] of [['guard_legacy_no_mark',{accountId:null,blocked:true,lastOutboxIncidentId:'inc-old'}],['guard_legacy_epoch_no_mark',{accountId:null,blocked:true,lastOutboxIncidentId:'inc-old',epoch:3}]]){
    const {c,extras}=await blockedAccount(scope,{extraJobs:1});
    const patch={...legacy,accountId:c.account};
    await guardOf(c).set(patch);
    const second=extras[0],{expected,snapshot}=await expectedAndSnapshot(c,second.id),version=await versionOf(c,second.id);
    await assert.rejects(c.backend.quarantineExternalBillingOutbox(second.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot}),error=>error instanceof LedgerFault&&error.code==='invariant',scope);
    assert.equal((await guardOf(c).get()).get('epoch'),patch.epoch??undefined,'the legacy guard is untouched');
  }
  // A guard with a mark but no epoch IS epoch 1 (the only field the old writers could not write is the mark).
  const {c,guard,extras}=await blockedAccount('guard_legacy_epoch_default',{extraJobs:1});
  await guardOf(c).set({accountId:c.account,blocked:true,lastOutboxIncidentId:guard.lastOutboxIncidentId,createdAtMs:guard.createdAtMs});
  const second=extras[0],{expected,snapshot}=await expectedAndSnapshot(c,second.id),version=await versionOf(c,second.id);
  await c.backend.quarantineExternalBillingOutbox(second.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
  const grown=(await guardOf(c).get()).data();
  assert.equal(grown.epoch,2,'a missing epoch is 1, so a new incident is 2');assert.equal(grown.createdAtMs,guard.createdAtMs);
});

test('guard accounting: the guard predicate still tolerates blocked:false and refuses to invent a value for a missing flag',{timeout:30000},async()=>{
  const c=await fixture('guard_predicate');
  await guardOf(c).create({accountId:c.account,blocked:false});
  assert.equal(typeof await c.ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid),'string');
  const missing=await fixture('guard_flag_missing');
  await ref(missing.root,'billingGuards',missing.account).set({accountId:missing.account});
  await assert.rejects(missing.ai.enqueue(missing.account,missing.input,'translation:en',1,randomUUID(),missing.uid),error=>error instanceof LedgerFault&&error.code==='invariant');
});

// ---------------------------------------------------------------------------
// 11. Full unblock: audit -> Account deletes the guard -> Video releases and advances ONLY this incident's rows.
// ---------------------------------------------------------------------------
test('11 full unblock leaves a Video audit, deletes Account guard, clears the Video guard and revives Account',{timeout:40000},async()=>{
  const blocked=await blockedAccount('unblock_full'),c=blocked.c;
  const intentBefore=await ref(c.root,'billingIntents',sha(JSON.stringify([c.account,blocked.job.requestKey]))).get();
  const rowBefore=await outbox(c,blocked.job.id).get();
  const requestBody=await request(c,blocked);
 const result=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000).catch(error=>{console.log(JSON.stringify({stage:error.stage,code:error.code}));throw error;});
  assert.equal(result.unblocked,true);assert.equal(result.replayed,false);assert.equal(result.accountBlocked,false);
  assert.equal(result.videoBlocked,false);
  // Video audit: two immutable records, deterministic ids, the operator and the evidence.
  const audit=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get();
  assert.equal(audit.size,2);
  const byAction=Object.fromEntries(audit.docs.map(doc=>[doc.get('action'),doc.data()]));
  assert.ok(byAction.unblock_requested&&byAction.unblocked);
  assert.equal(byAction.unblock_requested.auditId,unblockAuditId(blocked.incident,'unblock_requested',blocked.guard.epoch,blocked.guard.createdAtMs));
  assert.equal(byAction.unblocked.auditId,unblockAuditId(blocked.incident,'unblocked',blocked.guard.epoch,blocked.guard.createdAtMs));
  for(const record of Object.values(byAction)){
    assert.equal(record.authorizedBy,'operator-ana');assert.equal(record.evidenceRef,'ticket-LV-019B-unblock-01');
    assert.equal(record.epoch,requestBody.epoch);assert.equal(record.createdAtMs,requestBody.createdAtMs);
    assert.ok(Number.isSafeInteger(record.recordedAtMs));
  }
  assert.equal(byAction.unblocked.accountBlocked,false);
  // Account really deleted its guard.
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,false);
  // Video released the guard and advanced ONLY this incident's rows.
  const guard=await guardOf(c).get();assert.equal(guard.exists,false,'with no other incident the Video guard is deleted');
  const intentAfter=await ref(c.root,'billingIntents',sha(JSON.stringify([c.account,blocked.job.requestKey]))).get();
  assert.equal(intentAfter.get('state'),'job_created','the intent keeps its pre-review state for this job');
  assert.equal(intentAfter.get('reviewIncidentId'),undefined);
  const row=await outbox(c,blocked.job.id).get();
  assert.equal(row.get('state'),'retry_wait','the outbox row is handed back to the drainer');
  assert.equal(row.get('reviewIncidentId'),undefined);
  assert.notEqual(rowBefore.get('state'),row.get('state'));
  const holds=await c.root.collection('billingHoldOutbox').get();
  assert.equal(holds.docs.filter(doc=>doc.get('state')==='needs_review').length,0);
  assert.equal(holds.docs[0].get('state'),'applied');
  assert.ok(intentBefore.exists);
  // Every pointer of the review is cleared, the retry is scheduled and the audit marks are exact (mutation round 2).
  assert.equal(intentBefore.get('reviewOutboxIncidentId'),blocked.incident,'the intent pointed at this incident before');
  assert.equal(intentAfter.get('reviewReason'),undefined);assert.equal(intentAfter.get('reviewOutboxIncidentId'),undefined);
  assert.equal(row.get('nextAttemptAt'),9_000_000_000);assert.equal(row.get('updatedAtMs'),9_000_000_000);
  const incidentRow=await ref(c.root,'billingOutboxReviewIncidents',blocked.incident).get();
  assert.equal(incidentRow.get('state'),'reviewed');assert.equal(incidentRow.get('reviewedAtMs'),9_000_000_000);assert.equal(incidentRow.get('unblockAuditId'),unblockAuditId(blocked.incident,'unblocked',blocked.guard.epoch,blocked.guard.createdAtMs));
  const alertAfter=await ref(c.root,ALERT_COLLECTION,blocked.alertKey).get();
  assert.equal(alertAfter.get('status'),'dispositioned');assert.equal(alertAfter.get('dispositionedBy'),'operator-ana');assert.equal(alertAfter.get('dispositionedAtMs'),9_000_000_000);assert.equal(alertAfter.get('dispositionAuditId'),unblockAuditId(blocked.incident,'unblocked',blocked.guard.epoch,blocked.guard.createdAtMs));
  // Account is usable again: reserve, admit and settle work end to end.
  const reservationId=randomUUID();
  await c.store.reserveVideo(c.identity,reservationId,3);
  const jobId=randomUUID(),attemptId=randomUUID();
  await c.store.admitVideoCall(c.identity,reservationId,3,jobId,attemptId,'text-window:0001','gemini-3.8-flash','d'.repeat(64));
  await c.store.settleVideo(c.identity,reservationId,'release',3,{jobId,attemptId},{resolution:{kind:'no_speech',evidenceSha256:'e'.repeat(64)}});
  const balance=await c.store.videoBalance(c.identity);
  // The new reservation is admitted and released; the trapped 2 s of the divergent ACK stay reserved because the exit of
  // a blocked account's reservations is PIECE 3 (this operation never moves balance). What matters here: Account accepts
  // reserve, admit and settle again, which is exactly what `blocked:false`/deleted guard must restore.
  assert.equal(balance.reserved,2,'the trapped 2 s stay reserved: their exit is PIECE 3, not this one');
  assert.equal(balance.active,1,'the trapped reservation still holds its cupo until piece 3');
  assert.equal(balance.consumed,0,'this piece never captures');
});

test('11 replay: an identical repeat is replayed without a single write; a different payload is a conflict',{timeout:40000},async()=>{
  const blocked=await blockedAccount('unblock_replay'),c=blocked.c,requestBody=await request(c,blocked);
  const first=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_100);
  assert.equal(first.replayed,false);
  const before={video:await signatures(c.root),account:await signatures(c.accountRoot),posts:c.transport.bodies.length};
  const again=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_999);
  assert.equal(again.replayed,true);assert.equal(again.unblocked,true);
  assert.ok(first.advanced.length>0);assert.deepEqual(again.advanced,first.advanced,'a replay reports what the original call advanced');
  assert.deepEqual(await signatures(c.root),before.video,'an identical replay writes nothing in Video');
  assert.deepEqual(await signatures(c.accountRoot),before.account,'an identical replay writes nothing in Account');
  assert.equal(c.transport.bodies.length,before.posts,'an already-applied unblock does not call Account again');
  for(const change of [{evidenceRef:'ticket-other'},{note:'another note'},{incidentId:sha(JSON.stringify(['another-incident']))}]){
    await assert.rejects(unblockBillingAccount(deps(c),c.account,{...requestBody,...change},'operator-ana',9_000_001_000),error=>error instanceof UnblockFault&&error.code==='conflict',JSON.stringify(change));
  }
  // The identity NEVER travels in the body: a body field named `authorizedBy` is an invalid request, not a second operator.
  await assert.rejects(unblockBillingAccount(deps(c),c.account,{...requestBody,authorizedBy:'operator-bob'},'operator-bob',9_000_001_000),error=>error instanceof UnblockFault&&error.code==='invalid');
  // A DIFFERENT authenticated principal naming the same audited incident is a conflict: one unblock, one author.
  await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-bob',9_000_001_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.deepEqual(await signatures(c.root),before.video,'a conflict writes nothing');
});

// ---------------------------------------------------------------------------
// 11 negatives.
// ---------------------------------------------------------------------------
test('11 negative: a missing, empty or control-character evidenceRef is invalid and writes nothing',{timeout:30000},async()=>{
  const blocked=await blockedAccount('unblock_no_evidence'),c=blocked.c,requestBody=await request(c,blocked),before=await signatures(c.root);
  for(const evidenceRef of [undefined,null,'','x'.repeat(201),'ticket\u0000line','ti\tcket']){
    const body={...requestBody};if(evidenceRef===undefined||evidenceRef===null)delete body.evidenceRef;else body.evidenceRef=evidenceRef;
    await assert.rejects(unblockBillingAccount(deps(c),c.account,body,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='invalid',String(evidenceRef));
  }
  for(const [name,body,who,account] of [['Account epoch 0',{...requestBody,accountEpoch:0},'operator-ana',c.account],['Account createdAtMs negative',{...requestBody,accountCreatedAtMs:-1},'operator-ana',c.account],
    ['empty operator',requestBody,'',c.account],['operator with a space',requestBody,'operator ana',c.account],['operator too long',requestBody,'a'.repeat(65),c.account],['operator not a string',requestBody,5,c.account],['account is not a uuid',requestBody,'operator-ana','not-a-uuid']])
    await assert.rejects(unblockBillingAccount(deps(c),account,body,who,9_000_000_000),error=>error instanceof UnblockFault&&error.code==='invalid',name);
  assert.deepEqual(await signatures(c.root),before,'nothing was written');
  assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length,0,'no Account call');
  assert.equal((await guardOf(c).get()).get('blocked'),true);
});
test('11 negative: an absent alert or one that is not open never unblocks',{timeout:30000},async()=>{
  const blocked=await blockedAccount('unblock_alert_state'),c=blocked.c,requestBody=await request(c,blocked);
  await assert.rejects(unblockBillingAccount(deps(c),c.account,{...requestBody,alertKey:randomUUID().replace(/-/g,'')+'0'.repeat(32)},'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='not_found');
  await ref(c.root,ALERT_COLLECTION,blocked.alertKey).update({status:'dispositioned'});
  await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,true,'Account was never asked');
  assert.equal((await guardOf(c).get()).get('blocked'),true);
});
test('11 negative: an unresolved needs_review row that this incident did not name stops the unblock',{timeout:30000},async()=>{
  const blocked=await blockedAccount('unblock_stray_row'),c=blocked.c,requestBody=await request(c,blocked);
  // A hold that belongs to another incident and still needs review: the operator would be unblocking over a divergence.
  const stray=sha(JSON.stringify(['account-hold-v1','outbox',sha(JSON.stringify(['stray']))]));
  await ref(c.root,'billingHoldOutbox',stray).create({id:stray,accountId:c.account,identityKey:c.identity,sourceKind:'outbox',sourceId:sha(JSON.stringify(['stray'])),state:'needs_review',reviewReason:'invalid_event',createdAtMs:Date.now()});
  const before=await signatures(c.root);
  await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='unresolved');
  assert.deepEqual(await signatures(c.root),before,'no audit record and no release');
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,true);
  assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length,0);
});
test('11 negative: a second incident arriving between the read and the write aborts and is never overwritten',{timeout:40000},async()=>{
  // A blocked account refuses new work, so the second incident is prepared BEFORE the block (a captured job is enough:
  // committing its divergent ACK after the block is the interleaving under test).
  const blocked=await blockedAccount('unblock_concurrent',{extraJobs:1}),c=blocked.c,requestBody=await request(c,blocked),second=blocked.extras[0];
  // Another incident lands on the same guard right before the transaction that releases it: its block is what matters.
  const originalUnblock=c.accountBilling.unblock.bind(c.accountBilling);let fired=false,secondId=null;
  c.accountBilling.unblock=async(...args)=>{
    if(!fired){
      fired=true;
      const {expected,snapshot}=await expectedAndSnapshot(c,second.id),version=await versionOf(c,second.id);
      const outcome=await c.backend.quarantineExternalBillingOutbox(second.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
      assert.equal(outcome.state,'needs_review');secondId=second.id;
    }
    return originalUnblock(...args);
  };
  await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  const guard=await guardOf(c).get();assert.equal(guard.get('blocked'),true,'the newer block is not overwritten');assert.equal(guard.get('epoch'),2);
  assert.ok(secondId);
});
test('11 negative: a rival row that lands between phase 0 and phase 3 keeps the Video guard blocked',{timeout:40000},async()=>{
  const blocked=await blockedAccount('unblock_phase3_rival'),c=blocked.c,requestBody=await request(c,blocked);
  const stray=sha(JSON.stringify(['account-hold-v1','outbox',sha(JSON.stringify(['phase3-stray']))]));
  const originalUnblock=c.accountBilling.unblock.bind(c.accountBilling);
  c.accountBilling.unblock=async(...args)=>{
    // A rival hold of the SAME account, unrelated to this incident: it does not touch the guard, so the generation this
    // request audited is still the live one. Only the phase-3 re-scan can see it.
    await ref(c.root,'billingHoldOutbox',stray).create({id:stray,accountId:c.account,identityKey:c.identity,sourceKind:'outbox',sourceId:sha(JSON.stringify(['phase3-stray'])),state:'needs_review',reviewReason:'invalid_event',createdAtMs:Date.now()});
    return originalUnblock(...args);
  };
  const result=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
  assert.equal(result.unblocked,true);assert.equal(result.videoBlocked,true,'a rival row keeps the Video guard');
  assert.equal(result.accountBlocked,false);
  const guard=await guardOf(c).get();
  assert.equal(guard.exists,true);assert.equal(guard.get('blocked'),true);
  assert.equal((await outbox(c,blocked.job.id).get()).get('state'),'retry_wait','this incident is still advanced');
  assert.equal((await ref(c.root,'billingHoldOutbox',stray).get()).get('state'),'needs_review','the rival row is untouched');
  const done=await ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblocked',blocked.guard.epoch,blocked.guard.createdAtMs)).get();
  assert.equal(done.get('videoBlocked'),true);assert.deepEqual(done.get('videoRivals'),['billingHoldOutbox/'+stray]);
});
test('11 negative: a guard whose createdAtMs moves between phase 0 and phase 3 is refused even at the same epoch',{timeout:40000},async()=>{
  const blocked=await blockedAccount('unblock_phase3_mark'),c=blocked.c,requestBody=await request(c,blocked);
  const originalUnblock=c.accountBilling.unblock.bind(c.accountBilling);
  c.accountBilling.unblock=async(...args)=>{
    // Same epoch, same incident, same alert: only the creation mark of the live guard moves. The audited tuple no longer
    // names the guard phase 3 is about to release, so it must abort (the epoch alone would accept it).
    await guardOf(c).update({createdAtMs:requestBody.createdAtMs+1});
    return originalUnblock(...args);
  };
  await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  const guard=await guardOf(c).get();
  assert.equal(guard.exists,true,'the moved guard is not released');
  assert.equal(guard.get('createdAtMs'),requestBody.createdAtMs+1);
  assert.equal((await outbox(c,blocked.job.id).get()).get('state'),'needs_review','no row was advanced');
});
test('11 partial: Account keeps its guard because other incidents remain, so Video keeps its own but advances this incident',{timeout:40000},async()=>{
  const blocked=await blockedAccount('unblock_account_partial'),c=blocked.c;
  await addAccountIncident(c);
  const requestBody=await request(c,blocked);
  const result=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
  assert.equal(result.unblocked,true);assert.equal(result.videoBlocked,true,'the Video guard survives for the partial result');
  assert.equal((await guardOf(c).get()).get('blocked'),true);
  assert.equal((await outbox(c,blocked.job.id).get()).get('state'),'retry_wait','this incident\'s row is still handed back');
  const done=await ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblocked',blocked.guard.epoch,blocked.guard.createdAtMs)).get();
  assert.equal(done.get('accountBlocked'),true);assert.equal(done.get('videoBlocked'),true);
});

// Codex (certification of piece 2): the partial result is a state the operator can be in for days. The repeat of the SAME request once
// Account no longer holds the owner must finish the job (release the Video guard and the alert) instead of crashing or staying blocked.
test('11 partial then repeat: once Account has no other incident, the identical repeat releases the Video guard and the alert',{timeout:60000},async()=>{
  const blocked=await blockedAccount('unblock_partial_repeat'),c=blocked.c,other=await addAccountIncident(c),requestBody=await request(c,blocked);
  const first=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
  assert.equal(first.videoBlocked,true);assert.equal((await guardOf(c).get()).get('blocked'),true);
  await reviewOtherAccountIncident(c,other);
  const requestCount=c.transport.bodies.length;
  const repeat=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_005_000);
  assert.deepEqual(c.transport.bodies.slice(requestCount).map(call=>call.pathname),['/api/internal/video/billing-holds/unblock-receipt']);
  assert.equal(repeat.unblocked,true);assert.equal(repeat.accountBlocked,false);assert.equal(repeat.videoBlocked,false,'the repeat releases the Video guard');
  assert.equal((await guardOf(c).get()).exists,false);
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,false);
  const alert=await ref(c.root,ALERT_COLLECTION,blocked.alertKey).get();assert.equal(alert.get('status'),'dispositioned');
  // And a third identical call is a pure replay: no writes, no Account call.
  const before={video:await signatures(c.root),account:await signatures(c.accountRoot),posts:c.transport.bodies.length};
  const third=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_009_000);
  assert.equal(third.replayed,true);assert.equal(third.videoBlocked,false);
  assert.deepEqual(await signatures(c.root),before.video);assert.deepEqual(await signatures(c.accountRoot),before.account);assert.equal(c.transport.bodies.length,before.posts);
  // The release is attributed to the same operator and to its own immutable record; another principal cannot reuse it.
  assert.equal(alert.get('dispositionedBy'),'operator-ana');assert.equal(alert.get('dispositionAuditId'),unblockAuditId(blocked.incident,'video_released',blocked.guard.epoch,blocked.guard.createdAtMs));
  const releasedRecord=await ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'video_released',blocked.guard.epoch,blocked.guard.createdAtMs)).get();
  assert.equal(releasedRecord.get('accountEpoch'),requestBody.accountEpoch,'the release record names the Account generation of the confirmed call');assert.equal(releasedRecord.get('accountCreatedAtMs'),requestBody.accountCreatedAtMs);
  await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-bob',9_000_009_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  await assert.rejects(unblockBillingAccount(deps(c),c.account,{...requestBody,evidenceRef:'ticket-other'},'operator-ana',9_000_009_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.deepEqual(await signatures(c.root),before.video);
});

test('11 negative: a row that is re-blocked during the partial repeat is refused and the newer guard survives',{timeout:60000},async()=>{
  const blocked=await blockedAccount('unblock_partial_reblock'),c=blocked.c,other=await addAccountIncident(c),requestBody=await request(c,blocked);
  const first=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
  assert.equal(first.videoBlocked,true);assert.equal((await guardOf(c).get()).get('epoch'),requestBody.epoch);
  await reviewOtherAccountIncident(c,other);
  // Between the audited read and the release the SAME row diverges again: the real writer creates a NEW occurrence (new
  // hold, new incident, epoch + 1) and the alert of the old epoch stays `open`. Account reports nothing pending for the
  // OLD incident, which is exactly the state that must not release the newer guard.
  const {expected,snapshot}=await expectedAndSnapshot(c,blocked.job.id),version=await versionOf(c,blocked.job.id);
  const originalReceipt=c.accountBilling.unblockReceipt.bind(c.accountBilling);
  c.accountBilling.unblockReceipt=async(...args)=>{
    const receipt=await originalReceipt(...args);
    await c.backend.quarantineExternalBillingOutbox(blocked.job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
    return receipt;
  };
  await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_005_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  const guard=await guardOf(c).get();
  assert.equal(guard.exists,true,'the newer guard is not released by an older audited tuple');
  assert.equal(guard.get('blocked'),true);assert.equal(guard.get('epoch'),requestBody.epoch+1);
  const released=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','video_released').get();
  assert.equal(released.size,0,'no release record is written for the refused repeat');
  const alert=await ref(c.root,ALERT_COLLECTION,blocked.alertKey).get();assert.equal(alert.get('status'),'open','the old alert is not dispositioned');
});
// Codex (certification of piece 2): a `video_released` record answers only while it still describes the CURRENT guard, exactly like the
// `unblocked` record does (the epoch restarts at 1 after the guard is deleted). Replaying the old request over a NEWER block would tell the
// operator the account is open (`videoBlocked:false`) while a different incident blocks it.
test('11 negative: after a partial release, the old request cannot replay as success over a NEWER block',{timeout:60000},async()=>{
  const blocked=await blockedAccount('unblock_released_reblock'),c=blocked.c,other=await addAccountIncident(c),requestBody=await request(c,blocked);
  assert.equal((await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000)).videoBlocked,true);
  await reviewOtherAccountIncident(c,other);
  const released=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_005_000);
  assert.equal(released.videoBlocked,false);assert.equal((await guardOf(c).get()).exists,false);
  // The SAME row diverges again: a NEW guard generation (epoch 1 again, new creation mark) now blocks the account.
  const {expected,snapshot}=await expectedAndSnapshot(c,blocked.job.id),version=await versionOf(c,blocked.job.id);
  await c.backend.quarantineExternalBillingOutbox(blocked.job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
  assert.equal((await guardOf(c).get()).get('blocked'),true,'the account is blocked again');
  const before={video:await signatures(c.root),account:await signatures(c.accountRoot),posts:c.transport.bodies.length};
  await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_009_000),error=>error instanceof UnblockFault&&error.code==='conflict','the old request is not a replay over a newer block');
  assert.deepEqual(await signatures(c.root),before.video);assert.deepEqual(await signatures(c.accountRoot),before.account);assert.equal(c.transport.bodies.length,before.posts);
  assert.equal((await guardOf(c).get()).get('blocked'),true,'the newer guard is untouched');
});
// GLM review of piece 2: the operator can ask BEFORE the drainer has delivered the hold (Account then answers `not_found`). The audited
// `planned` row is frozen in `unblock_requested`; if the drainer applies the hold (or the authorizer sends it to review) before the repeat,
// phase 3 must not abort forever on `state !== planned.state`, or the account could never be released and no payload could change that.
for(const between of ['applied','needs_review']){
  test('11 resume: a hold that moved to '+between+' between the audited read and the release does not strand the unblock',{timeout:60000},async()=>{
    const blocked=await blockedAccount('unblock_hold_between_'+between),c=blocked.c;
    await ref(c.root,'billingHoldOutbox',blocked.hold).update({state:'pending',nextAttemptAt:Date.now()});
    const requestBody=await request(c,blocked);
    // Account receives exactly one real unblock on the local double: it commits, then the reply is lost before Video learns the outcome.
    let posts=0,receipts=0;
    const billing={
      unblockReceipt:async(...args)=>{receipts++;return c.accountBilling.unblockReceipt(...args);},
      unblock:async(...args)=>{posts++;const result=await c.accountBilling.unblock(...args);if(posts===1)throw new Error('synthetic lost reply after Account commit');return result;},
    };
    const isolated={db:c.db,root:c.root,accountBilling:billing};
    await assert.rejects(unblockBillingAccount(isolated,c.account,requestBody,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict');
    assert.equal(posts,1,'the lost-reply path sends exactly one POST to Account');
    assert.equal(receipts,1,'the first attempt reads the receipt once');
    assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1,'Account committed exactly one unblock receipt');
    const requested=await ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblock_requested',blocked.guard.epoch,blocked.guard.createdAtMs)).get();
    assert.equal(requested.exists,true,'the audited request stays visible');
    assert.equal(requested.get('planned').find(row=>row.collection==='billingHoldOutbox')?.state,'pending','the hold was pending when audited');
    // The drainer (or the authorizer) moves the hold after the audit; recovery must go through the receipt and never resend the POST.
    await ref(c.root,'billingHoldOutbox',blocked.hold).update(between==='applied'?{state:'applied',appliedAtMs:Date.now()}:{state:'needs_review'});
    const result=await unblockBillingAccount(isolated,c.account,requestBody,'operator-ana',9_000_005_000);
    assert.equal(result.unblocked,true);assert.equal(result.videoBlocked,false,'the repeat completes the release');
    assert.equal(posts,1,'recovery uses the receipt and never resends the POST');
    assert.equal(receipts,2,'recovery reads the receipt exactly twice in total');
    assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1,'recovery writes no second Account receipt');
    assert.equal((await guardOf(c).get()).exists,false);
    assert.equal((await ref(c.root,'billingHoldOutbox',blocked.hold).get()).get('state'),'applied','the hold ends applied');
    const alert=await ref(c.root,ALERT_COLLECTION,blocked.alertKey).get();assert.equal(alert.get('status'),'dispositioned');
  });
}
// ---------------------------------------------------------------------------
// Codex mutation round 2 (certification of piece 2): behavior the first mutation run showed was not pinned by any test.
// ---------------------------------------------------------------------------
const withoutGuard=(c,all)=>Object.fromEntries(Object.entries(all).filter(([path])=>!path.endsWith('/billingGuards/'+c.account)));
test('11 negative: every kind of unresolved row of the account stops the unblock, and rows of OTHER accounts never do',{timeout:90000},async()=>{
  const blocked=await blockedAccount('unblock_rival_kinds'),c=blocked.c,requestBody=await request(c,blocked),other=randomUUID();
  const kinds=[['billingIntents',{state:'needs_review'}],['billingOutbox',{state:'needs_review'}],['billingHoldOutbox',{state:'pending'}],['billingHoldOutbox',{state:'needs_review'}],
    ['billingReviewIncidents',{}],['billingOutboxReviewIncidents',{}],['billingIntentObservationIncidents',{}]];
  const before=await signatures(c.root);
  for(const [collection,fields] of kinds){
    const doc=ref(c.root,collection,sha('rival|'+collection+'|'+JSON.stringify(fields)));
    await doc.create({accountId:c.account,...fields});
    const withRival=await signatures(c.root);
    await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='unresolved',collection+JSON.stringify(fields));
    assert.deepEqual(await signatures(c.root),withRival,'a rival writes no audit record and moves nothing');
    await doc.delete();
  }
  assert.deepEqual(await signatures(c.root),before);assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length,0,'Account was never asked');
  // The very same unresolved rows, but of ANOTHER account, are not this account's business.
  for(const [collection,fields] of kinds)await ref(c.root,collection,sha('foreign|'+collection+'|'+JSON.stringify(fields))).create({accountId:other,...fields});
  const result=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_001_000);
  assert.equal(result.unblocked,true);assert.equal(result.videoBlocked,false);assert.equal((await guardOf(c).get()).exists,false);
  assert.equal((await ref(c.root,'billingOutbox',sha('foreign|billingOutbox|'+JSON.stringify({state:'needs_review'}))).get()).get('state'),'needs_review','a foreign row is never advanced');
});
test('11 resume: a pending claim on the SAME guard generation, operator and payload keeps the Video block and never sends twice',{timeout:90000},async()=>{
  const blocked=await blockedAccount('unblock_resume_drift'),c=blocked.c,requestBody=await request(c,blocked);
  let unblockCalls=0,receiptReads=0;
  const client=c.accountBilling;
  const failing={...deps(c),accountBilling:{
    unblock:async()=>{unblockCalls++;throw Object.assign(new Error('synthetic uncertain POST'),{code:'unavailable'});},
    unblockReceipt:async(...args)=>{receiptReads++;return client.unblockReceipt(...args);}}};
  const balanceBefore=await c.store.videoBalance(c.identity);
  await assert.rejects(unblockBillingAccount(failing,c.account,requestBody,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.equal(unblockCalls,1,'the first attempt is the only POST to Account');
  assert.ok(receiptReads>=1,'the write is preceded by a receipt read');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'the pending claim keeps the Video block');
  const requested=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get();
  assert.equal(requested.size,1,'the audited request is durable after the uncertain POST');
  assert.equal(requested.docs[0].get('action'),'unblock_requested');
  const before=withoutGuard(c,await signatures(c.root));
  for(const [name,body,who] of [['another operator',requestBody,'operator-bob'],['another evidence',{...requestBody,evidenceRef:'ticket-other'},'operator-ana'],['another note',{...requestBody,note:'another note'},'operator-ana']]){
    await assert.rejects(unblockBillingAccount(failing,c.account,body,who,9_000_001_000),error=>error instanceof UnblockFault&&error.code==='conflict',name);
  }
  assert.equal(unblockCalls,1,'operator and payload drift are refused without a new mutation to Account');
  const original=(await guardOf(c).get()).data();
  for(const [name,change] of [['epoch',{epoch:original.epoch+1}],['createdAtMs',{createdAtMs:original.createdAtMs+1}],['incident',{lastOutboxIncidentId:sha('another incident')}],['account',{accountId:randomUUID()}]]){
    await guardOf(c).update(change);
    await assert.rejects(unblockBillingAccount(failing,c.account,requestBody,'operator-ana',9_000_002_000),error=>error instanceof UnblockFault&&error.code==='conflict',name);
    await guardOf(c).set(original);
  }
  assert.equal(unblockCalls,1,'guard field drift is refused without a new mutation to Account');
  assert.deepEqual((await guardOf(c).get()).data(),original,'the same guard document is restored to its original fields');
  const readsBeforeRepeat=receiptReads;
  await assert.rejects(unblockBillingAccount(failing,c.account,requestBody,'operator-ana',9_000_003_000),error=>error instanceof UnblockFault&&error.code==='conflict','an identical repeat over a pending claim is refused too');
  assert.equal(unblockCalls,1,'a refused repeat never sends another POST to Account');
  assert.ok(receiptReads>readsBeforeRepeat,'the identical repeat consults the receipt');
  assert.deepEqual(withoutGuard(c,await signatures(c.root)),before,'a refused repeat writes nothing');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'pending conserves the Video block');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,0,'no completion while the claim stays pending');
  assert.deepEqual(await c.store.videoBalance(c.identity),balanceBefore,'the balance is untouched');
});
test('retry generation missing: a claim left by an uncertain POST still refuses a later call after the guard document is gone',{timeout:90000},async()=>{
  const blocked=await blockedAccount('unblock_missing_guard_claim'),c=blocked.c,requestBody=await request(c,blocked);
  let unblockCalls=0;
  const client=c.accountBilling;
  const failing={...deps(c),accountBilling:{
    unblock:async()=>{unblockCalls++;throw Object.assign(new Error('synthetic uncertain POST'),{code:'unavailable'});},
    unblockReceipt:async(...args)=>client.unblockReceipt(...args)}};
  const balanceBefore=await c.store.videoBalance(c.identity);
  await assert.rejects(unblockBillingAccount(failing,c.account,requestBody,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.equal(unblockCalls,1,'the claim is left by the only POST, which fails uncertainly');
  const requested=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get();
  assert.equal(requested.size,1,'the audited request is durable after the uncertain POST');
  assert.equal(requested.docs[0].get('action'),'unblock_requested');
  await guardOf(c).delete();
  const before=await signatures(c.root);
  assert.equal((await guardOf(c).get()).exists,false,'the guard document is gone for this fixture');
  // The refusal below is the guard check over a claim already on disk; it does NOT prove
  // that the claim alone refuses, and no generation continuity is asserted for the deleted guard.
  await assert.rejects(unblockBillingAccount(failing,c.account,requestBody,'operator-ana',9_000_001_000),error=>error instanceof UnblockFault&&error.code==='conflict','a missing guard does not resurrect the send');
  assert.equal(unblockCalls,1,'no second POST to Account');
  assert.equal((await guardOf(c).get()).exists,false,'the refused call does not recreate the guard');
  assert.deepEqual(await signatures(c.root),before,'the refused call writes nothing');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,0,'no completion is written');
  assert.deepEqual(await c.store.videoBalance(c.identity),balanceBefore,'the balance is untouched');
});
test('11 partial: the repeat only resumes on the SAME guard generation and never asks Account when the guard drifted',{timeout:90000},async()=>{
  const blocked=await blockedAccount('unblock_partial_drift'),c=blocked.c;
  await addAccountIncident(c);
  const requestBody=await request(c,blocked);
  const first=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
  assert.equal(first.videoBlocked,true);assert.equal(first.accountBlocked,true,'the receipt says Account still holds the owner');
  let calls=0;const fail=async()=>{calls++;throw new Error('unexpected Account request');};
  const counting={db:c.db,root:c.root,accountBilling:{unblock:fail,unblockReceipt:fail}};
  const before=withoutGuard(c,await signatures(c.root)),original=(await guardOf(c).get()).data();
  for(const [name,change] of [['epoch',{epoch:original.epoch+1}],['createdAtMs',{createdAtMs:original.createdAtMs+1}],['incident',{lastOutboxIncidentId:sha('another incident')}],['account',{accountId:randomUUID()}]]){
    await guardOf(c).update(change);
    await assert.rejects(unblockBillingAccount(counting,c.account,requestBody,'operator-ana',9_000_001_000),error=>error instanceof UnblockFault&&error.code==='conflict',name);
    await guardOf(c).set(original);
  }
  await assert.rejects(unblockBillingAccount(counting,c.account,requestBody,'operator-bob',9_000_001_000),error=>error instanceof UnblockFault&&error.code==='conflict','another operator');
  assert.equal(calls,0,'a drifted guard never reaches Account');assert.deepEqual(withoutGuard(c,await signatures(c.root)),before);
});
test('11 partial: a repeat while Account still holds the owner, or while Video has a rival row, writes nothing and keeps the guard',{timeout:90000},async()=>{
  const blocked=await blockedAccount('unblock_partial_stays'),c=blocked.c,other=await addAccountIncident(c),requestBody=await request(c,blocked);
  await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
  const before=await signatures(c.root);
  const again=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_001_000);
  assert.equal(again.replayed,true);assert.equal(again.accountBlocked,true);assert.equal(again.videoBlocked,true);
  assert.deepEqual(await signatures(c.root),before,'no write while Account still holds the owner');assert.equal((await guardOf(c).get()).get('blocked'),true);
  // Account is now clear, but a rival row of the same account keeps the Video guard.
  await reviewOtherAccountIncident(c,other);
  const strayId=sha(JSON.stringify(['partial-stray']));
  await ref(c.root,'billingHoldOutbox',strayId).create({id:strayId,accountId:c.account,identityKey:c.identity,sourceKind:'outbox',sourceId:strayId,state:'needs_review',reviewReason:'invalid_event',createdAtMs:Date.now()});
  const withRival=await signatures(c.root);
  const kept=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_002_000);
  assert.equal(kept.videoBlocked,true);assert.equal(kept.accountBlocked,false);assert.equal(kept.replayed,true);
  assert.deepEqual(await signatures(c.root),withRival,'a rival row keeps the Video guard and writes nothing');assert.equal((await guardOf(c).get()).get('blocked'),true);
  assert.equal((await ref(c.root,ALERT_COLLECTION,blocked.alertKey).get()).get('status'),'open');
  await ref(c.root,'billingHoldOutbox',strayId).delete();
  const released=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_003_000);
  assert.equal(released.videoBlocked,false);assert.equal((await guardOf(c).get()).exists,false);
});
test('11 negative: the audited rows and the alert are re-read in phase 3, and any drift aborts without advancing anything',{timeout:120000},async()=>{
  const blocked=await blockedAccount('unblock_phase3_drift'),c=blocked.c,requestBody=await request(c,blocked);
  const alertRef=ref(c.root,ALERT_COLLECTION,blocked.alertKey),row=outbox(c,blocked.job.id),real=c.accountBilling.unblock.bind(c.accountBilling);
  const readReceipt=c.accountBilling.unblockReceipt.bind(c.accountBilling);
  for(const [name,tamper,restore,expectedRowState] of [
    ['the alert is no longer open',()=>alertRef.update({status:'superseded'}),()=>alertRef.update({status:'open'}),'needs_review'],
    ['an audited row changed state',()=>row.update({state:'pending'}),()=>row.update({state:'needs_review'}),'pending'],
    ['an audited row points at another incident',()=>row.update({reviewIncidentId:sha('another incident')}),()=>row.update({reviewIncidentId:blocked.incident}),'needs_review'],
    ['an audited outbox row is already "applied" (a state only a hold may settle in)',()=>row.update({state:'applied'}),()=>row.update({state:'needs_review'}),'applied'],
  ]){
    c.accountBilling.unblock=async(...args)=>{await tamper();return real(...args);};
    c.accountBilling.unblockReceipt=async(...args)=>{const receipt=await readReceipt(...args);await tamper();return receipt;};
    await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict',name);
    c.accountBilling.unblock=real;c.accountBilling.unblockReceipt=readReceipt;
    assert.equal((await guardOf(c).get()).get('blocked'),true,name+': the guard stays');assert.equal((await row.get()).get('state'),expectedRowState,name+': nothing was advanced');
    assert.equal((await ref(c.root,'billingHoldOutbox',blocked.hold).get()).get('state'),'applied');
    assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,0,name+': no completion record');
    await restore();
  }
  const done=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_001_000);
  assert.equal(done.videoBlocked,false);assert.equal((await row.get()).get('state'),'retry_wait');
});
// Local review of piece 2 by another Codex session (25 nov 2026, docs/reviews/LV-019-B-1-4b-p2-revision-local-2026-11-25.md), findings 2 and 3:
// an audited row that VANISHES, or that changes OWNER, between the audit and the release must abort phase 3 (fail closed), never be skipped.
for(const [name,tamper] of [
  ['an audited row that no longer exists',row=>row.delete()],
  ['an audited row that now belongs to another account',row=>row.update({accountId:randomUUID()})],
]){
  test('11 negative: '+name+' in phase 3 aborts the release and the guard survives',{timeout:60000},async()=>{
    const blocked=await blockedAccount('unblock_row_drift_'+name.replace(/[^a-z]+/g,'_')),c=blocked.c,requestBody=await request(c,blocked);
    const row=outbox(c,blocked.job.id),real=c.accountBilling.unblock.bind(c.accountBilling);
    c.accountBilling.unblock=async(...args)=>{await tamper(row);return real(...args);};
    await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict',name);
    c.accountBilling.unblock=real;
    assert.equal((await guardOf(c).get()).get('blocked'),true,'the guard survives');
    assert.equal((await ref(c.root,ALERT_COLLECTION,blocked.alertKey).get()).get('status'),'open','the alert stays open');
    assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,0,'no completion record');
    assert.notEqual((await ref(c.root,'billingHoldOutbox',blocked.hold).get()).get('state'),'pending');
  });
}
// Same review, finding 1: the Account generation the operator tool supplied is NOT part of the compared payload (Account's own guard
// moves legitimately between retries), so the record of what was actually USED must carry it, or the audit trail could not tell which
// Account generation the confirmed call named.
test('11 the completion records name the Account generation that the confirmed call actually used, not only the first attempt',{timeout:120000},async()=>{
  const blocked=await blockedAccount('unblock_account_generation_trace'),c=blocked.c;
  const oldBody=await request(c,blocked);
  const g0={epoch:oldBody.accountEpoch,createdAtMs:oldBody.accountCreatedAtMs};
  // A REAL previous generation: add a second Account incident, review it while the original stays open.
  const support=accountHoldId('outbox',randomUUID(),1,1);
  assert.equal((await c.accountBilling.block(c.identity,support)).created,true);
  const g1=await accountGuard(c);assert.equal(g1.epoch,g0.epoch+1);
  const supportReview=await c.accountBilling.unblock(c.identity,{incidentId:support,...g1,reviewRef:'synthetic review of the supporting hold'});
  assert.equal(supportReview.blocked,true,'the original hold still blocks Account');
  const g1After=await accountGuard(c);assert.equal(g1After.epoch,g1.epoch);assert.equal(g1After.createdAtMs,g1.createdAtMs);
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).get('reviewedCount'),1);
  // First attempt records epoch 1 and fails BEFORE Account commits.
  let failedDeliveries=0;
  const failing={db:c.db,root:c.root,accountBilling:{
    unblock:async()=>{failedDeliveries++;throw Object.assign(new Error('synthetic delivery failure'),{code:'unavailable'});},
    unblockReceipt:async()=>({state:'pending'})}};
  await assert.rejects(unblockBillingAccount(failing,c.account,oldBody,'operator-ana',9_000_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  assert.equal(failedDeliveries,1);
  const requestedRef=ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblock_requested',blocked.guard.epoch,blocked.guard.createdAtMs));
  const requested=await requestedRef.get();
  assert.equal(requested.get('accountEpoch'),g0.epoch,'the first attempt is recorded as the operator supplied it');
  assert.equal(requested.get('accountCreatedAtMs'),g0.createdAtMs);
  const requestVersion=stampNoPad(requested,'updateTime');assert.ok(requestVersion);
  // TEST-ONLY anchor/grant: previous=1, successor=2.
  const seeded=await seedFencedSuccessor(c,blocked,{previousEpoch:g0.epoch,successorEpoch:g1.epoch});
  const base=fencedDeps(c,seeded);
  let successorSends=0,receiptCalls=0;
  const fenced={...base,successor:{...base.successor,
    async receipt(input){receiptCalls++;return base.successor.receipt(input);},
    async confirm(input){if(input.attempt==='successor')successorSends++;return base.successor.confirm(input);}}};
  // A second, foreign identity is blocked too; neither attempt may touch it.
  const foreignUid='synthetic-trace-foreign-'+randomUUID(),foreign=await c.store.bootstrap(foreignUid),foreignIdentity=accountIdentityKey(foreignUid);
  assert.equal((await c.accountBilling.block(foreignIdentity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
  const foreignGuardBefore=(await ref(c.accountRoot,'videoBillingGuards',foreign.account.id).get()).data();
  const postsBefore=c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length;
  const retryBody={...oldBody,accountEpoch:g1.epoch,accountCreatedAtMs:g1.createdAtMs};
  const done=await unblockBillingAccount(fenced,c.account,retryBody,'operator-ana',9_000_001_000);
  assert.equal(done.videoBlocked,false);
  assert.equal(successorSends,1,'one successor dispatch');
  assert.equal(receiptCalls,2,'one snapshot receipt and one pre-release revalidation');
  assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length,postsBefore+1,'one new mutation');
  assert.equal(stampNoPad(await requestedRef.get(),'updateTime'),requestVersion,'the original request is unchanged');
  assert.equal((await requestedRef.get()).get('accountEpoch'),g0.epoch,'the durable request keeps the FIRST Account generation');
  const record=await ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblocked',blocked.guard.epoch,blocked.guard.createdAtMs)).get();
  assert.equal(record.get('accountEpoch'),retryBody.accountEpoch,'the completion record carries the Account epoch the confirmed call used');
  assert.equal(record.get('accountCreatedAtMs'),retryBody.accountCreatedAtMs);
  const doneRows=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get();
  assert.equal(doneRows.size,2,'one request and one completion');
  assert.equal(doneRows.docs.filter(doc=>doc.get('action')==='unblock_requested').length,1);
  assert.equal(doneRows.docs.filter(doc=>doc.get('action')==='unblocked').length,1);
  const receipts=await c.accountRoot.collection('videoBillingUnblocks').get();
  assert.equal(receipts.size,2,'one receipt for the supporting hold and one for the original incident');
  const originalReceipts=receipts.docs.filter(doc=>doc.get('incidentId')===blocked.hold);
  assert.equal(originalReceipts.length,1);
  assert.equal(originalReceipts[0].get('epoch'),g1.epoch);
  assert.equal(originalReceipts[0].get('createdAtMs'),g1.createdAtMs);
  assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,1);
  assert.deepEqual((await ref(c.accountRoot,'videoBillingGuards',foreign.account.id).get()).data(),foreignGuardBefore,'another account is untouched');
});

test('11 the completion records the Account generation the confirmed call actually used, not a different one presented on resume',{timeout:90000},async()=>{
  const blocked=await blockedAccount('unblock_account_generation_trace_lost_ack'),c=blocked.c,requestBody=await request(c,blocked);
  assert.equal(typeof c.accountBilling.unblockReceipt,'function','the receipt route must exist');
  const accepted={epoch:requestBody.accountEpoch,createdAtMs:requestBody.accountCreatedAtMs};
  const posts=()=>c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length;
  const postsBefore=posts();
  const originalUnblock=c.accountBilling.unblock.bind(c.accountBilling);
  c.accountBilling.unblock=async(...args)=>{await originalUnblock(...args);throw new Error('synthetic lost response after Account committed');};
  await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  c.accountBilling.unblock=originalUnblock;
  assert.equal(posts(),postsBefore+1,'exactly one mutation left Video');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Video stays blocked after the lost ACK');
  const receipts=await c.accountRoot.collection('videoBillingUnblocks').get();
  assert.equal(receipts.size,1,'Account committed exactly one receipt');
  assert.equal(receipts.docs[0].get('epoch'),accepted.epoch);
  assert.equal(receipts.docs[0].get('createdAtMs'),accepted.createdAtMs);
  const requestedRef2=ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblock_requested',blocked.guard.epoch,blocked.guard.createdAtMs));
  assert.equal((await requestedRef2.get()).get('accountEpoch'),accepted.epoch,'the durable request names the mutation generation');
  const wrong={...requestBody,accountEpoch:requestBody.accountEpoch+7,accountCreatedAtMs:requestBody.accountCreatedAtMs+7};
  const done=await unblockBillingAccount(deps(c),c.account,wrong,'operator-ana',9_000_001_000);
  assert.equal(done.videoBlocked,false);
  assert.equal(posts(),postsBefore+1,'the resume never re-sends');
  const record=await ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblocked',blocked.guard.epoch,blocked.guard.createdAtMs)).get();
  assert.equal(record.get('accountEpoch'),accepted.epoch,'the completion carries the Account ACCEPTED epoch, not the one presented on resume');
  assert.equal(record.get('accountCreatedAtMs'),accepted.createdAtMs);
});
test('11 negative: an alert of another kind or account, and an ambiguous owner identity, never unblock',{timeout:60000},async()=>{
  const blocked=await blockedAccount('unblock_alert_owner'),c=blocked.c,requestBody=await request(c,blocked);
  const alert=(await ref(c.root,ALERT_COLLECTION,blocked.alertKey).get()).data();
  for(const [change,expectedCode] of [[{kind:'hold'},'conflict'],[{rowId:randomUUID()},'corrupt']]){
    const fields={...alert,...change},key=alertKey(fields.kind,fields.rowId,fields.state,fields.reason);
    await ref(c.root,ALERT_COLLECTION,key).create({...fields,alertKey:key});
    await assert.rejects(unblockBillingAccount(deps(c),c.account,{...requestBody,alertKey:key},'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code===expectedCode,JSON.stringify(change));
  }
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get()).size,0,'no audit record for a foreign alert');
  // Two identities claim the same account: Account is never asked for either of them.
  await ref(c.root,'identities',sha('second owner')).create({accountId:c.account,uid:'synthetic-second-owner'});
  await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_001_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length,0,'Account was never asked');
  assert.equal((await guardOf(c).get()).get('blocked'),true);assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,true);
});
// The existing positive case covers an admission guard that names the incident directly. Phase 3 re-reads state and
// owner of every audited row, but the RELATION that made a row belong to this incident (an observation incident's
// `intentId`, an admission guard's `incidentId`) can drift while Account is being asked. Each synthetic test below is
// self-contained: it uses the real `blockedIntentAccount` writer, changes ONLY the relation in the window between the
// audited read and phase 3, and checks the guard, the alert, the rows and the absence of a completion record. Nothing
// here asserts full production integrity; the negatives prove the drift aborts an otherwise confirmed release, and the
// third positive proves the legitimate 'guard names an observation of the same incident' relation is still accepted.
for(const [name,row,field,drifted,tamper] of [
  ['an observation incident that now names another intent',(c,blocked,obs)=>obs,'intentId',sha('another intent'),(c,blocked,obs)=>obs.update({intentId:sha('another intent')})],
  ['an admission guard that now names another incident',(c,blocked)=>ref(c.root,'billingIntentAdmissionGuards',blocked.incident),'incidentId',sha('another incident'),(c,blocked)=>ref(c.root,'billingIntentAdmissionGuards',blocked.incident).update({incidentId:sha('another incident')})],
]){
  test('11 negative: '+name+' in phase 3 aborts the release and the guard survives',{timeout:90000},async()=>{
    const blocked=await blockedIntentAccount('unblock_relation_drift_'+name.replace(/[^a-z]+/g,'_')),c=blocked.c;
    const obs=ref(c.root,'billingIntentObservationIncidents',sha('observation|'+blocked.incident));
    await obs.create({accountId:c.account,intentId:blocked.incident,state:'needs_review'});
    const admissionRef=ref(c.root,'billingIntentAdmissionGuards',blocked.incident);
    assert.equal((await obs.get()).get('intentId'),blocked.incident,'the observation names this incident before');
    assert.equal((await admissionRef.get()).get('incidentId'),blocked.incident,'the admission guard names this incident before');
    const requestBody=await request(c,blocked),real=c.accountBilling.unblock.bind(c.accountBilling);
    let tamperCount=0,accountConfirmed=false;const order=[];
    c.accountBilling.unblock=async(...args)=>{
      order.push('account:request');
      tamperCount+=1;await tamper(c,blocked,obs);order.push('relation:changed');
      const confirmation=await real(...args);accountConfirmed=true;order.push('account:confirmed');
      return confirmation;
    };
    let fault=null;
    try{await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);}catch(error){fault=error;}
    c.accountBilling.unblock=real;order.push('video:rejected');
    assert.ok(fault instanceof UnblockFault&&fault.code==='conflict',name);
    assert.equal(tamperCount,1,'the relation was changed exactly once, inside the audited window');
    assert.equal(order.filter(event=>event==='account:request').length,1,'the synthetic AccountStore was asked exactly once');
    assert.equal(accountConfirmed,true,'the synthetic AccountStore confirmed the order before Video rejected it');
    assert.ok(order.indexOf('account:confirmed')<order.indexOf('video:rejected'),'Account confirmed before Video rejects: the drift is only seen in phase 3');
    assert.ok(order.indexOf('relation:changed')<order.indexOf('account:confirmed'),'the relation drifted before Account confirmed, so the conflict is not a pre-account one');
    assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length,1,'exactly one unblock order reached Account');
    assert.equal((await guardOf(c).get()).get('blocked'),true,'the guard survives');
    assert.equal((await ref(c.root,ALERT_COLLECTION,blocked.alertKey).get()).get('status'),'open','the alert stays open');
    assert.equal((await obs.get()).get('state'),'needs_review','the observation incident is not marked reviewed');
    assert.equal((await admissionRef.get()).get('state'),'needs_review','the admission guard is not reopened');
    assert.equal((await row(c,blocked,obs).get()).get(field),drifted,'the drifted relation is left exactly as it was, unclosed');
    assert.equal((await row(c,blocked,obs).get()).get('reviewedAtMs'),undefined,'the drifted row is not closed');
    assert.equal((await ref(c.root,'billingReviewIncidents',blocked.incident).get()).get('reviewedAtMs'),undefined,'the review row is not closed');
    assert.equal((await ref(c.root,'billingIntents',blocked.incident).get()).get('state'),'needs_review','the intent is not handed back');
    assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,0,'no completion record');
  });
}
// Positive: an admission guard whose `incidentId` names an observation incident of THIS incident is still a legitimate
// owner at release time. The unblock must complete and hand back BOTH the observation and the guard.
test('11 an INTENT unblock completes when the admission guard names an observation incident of the same incident',{timeout:90000},async()=>{
  const blocked=await blockedIntentAccount('unblock_intent_admission_names_observation'),c=blocked.c,intentRef=ref(c.root,'billingIntents',blocked.incident);
  const obs=ref(c.root,'billingIntentObservationIncidents',sha('observation|'+blocked.incident));
  await obs.create({accountId:c.account,intentId:blocked.incident,state:'needs_review'});
  const admissionRef=ref(c.root,'billingIntentAdmissionGuards',blocked.incident);
  await admissionRef.update({incidentId:obs.id});
  assert.equal((await admissionRef.get()).get('state'),'needs_review','the admission guard is closed');
  assert.equal((await admissionRef.get()).get('incidentId'),obs.id,'the admission guard names the observation of the same incident');
  assert.equal((await obs.get()).get('intentId'),blocked.incident,'the observation belongs to this incident');
  const result=await unblockBillingAccount(deps(c),c.account,await request(c,blocked),'operator-ana',9_000_000_000);
  assert.equal(result.unblocked,true);assert.equal(result.videoBlocked,false);assert.equal((await guardOf(c).get()).exists,false,'the video guard is released');
  const observation=await obs.get();assert.equal(observation.get('state'),'reviewed');assert.equal(observation.get('reviewedAtMs'),9_000_000_000);assert.equal(observation.get('unblockAuditId'),unblockAuditId(blocked.incident,'unblocked',blocked.guard.epoch,blocked.guard.createdAtMs));
  assert.equal(validClearIntentAdmissionGuard(await admissionRef.get(),blocked.incident),true,'the guard that named the observation is back to the exact clear shape');
  assert.ok(result.advanced.includes('billingIntentAdmissionGuards/'+blocked.incident),'the admission guard is advanced');
  assert.ok(result.advanced.includes('billingIntentObservationIncidents/'+obs.id),'the observation incident is advanced');
  assert.equal((await intentRef.get()).get('state'),'reserve_pending','the intent resumes its reservation');
});
// --> the existing positive INTENT test ('11 an INTENT incident is unblocked too...') follows at this insertion point.
test('11 an INTENT incident is unblocked too: its review row, its observation incidents, the intent and the hold are all handed back',{timeout:60000},async()=>{
  const blocked=await blockedIntentAccount('unblock_intent_kind'),c=blocked.c,intentRef=ref(c.root,'billingIntents',blocked.incident);
  const obs=ref(c.root,'billingIntentObservationIncidents',sha('observation|'+blocked.incident));
  await obs.create({accountId:c.account,intentId:blocked.incident,state:'needs_review'});
  const intentBefore=(await intentRef.get()).data();assert.equal(intentBefore.state,'needs_review','the real writer put the intent in review');
  const admissionRef=ref(c.root,'billingIntentAdmissionGuards',blocked.incident);
  assert.equal((await admissionRef.get()).get('state'),'needs_review','the real writer closed the admission of this intent');
  assert.equal(intentBefore.reviewIncidentId,blocked.incident,'the intent pointed at this incident before');
  assert.equal((await ref(c.root,'billingReviewIncidents',blocked.incident).get()).exists,true);
  const requestBody=await request(c,blocked),result=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
  assert.equal(result.unblocked,true);assert.equal(result.videoBlocked,false);assert.equal((await guardOf(c).get()).exists,false);
  const review=await ref(c.root,'billingReviewIncidents',blocked.incident).get();
  assert.equal(review.get('reviewedAtMs'),9_000_000_000,'the review row is marked reviewed');
  const observation=await obs.get();assert.equal(observation.get('state'),'reviewed');assert.equal(observation.get('reviewedAtMs'),9_000_000_000);assert.equal(observation.get('unblockAuditId'),unblockAuditId(blocked.incident,'unblocked',blocked.guard.epoch,blocked.guard.createdAtMs));
  const intent=await intentRef.get();assert.equal(intent.get('state'),'reserve_pending','an intent with no work of its own resumes its reservation');
  assert.equal(validClearIntentAdmissionGuard(await admissionRef.get(),blocked.incident),true,'the reviewed intent can be admitted again: its admission guard is back to the exact clear shape');
  assert.equal(intent.get('reviewReason'),undefined);assert.equal(intent.get('reviewIncidentId'),undefined);
  assert.equal((await ref(c.root,'billingHoldOutbox',blocked.hold).get()).get('state'),'applied');
  assert.deepEqual(result.advanced.filter(path=>!path.startsWith('billingHoldOutbox/')).sort(),['billingIntentAdmissionGuards/'+blocked.incident,'billingIntentObservationIncidents/'+obs.id,'billingIntents/'+blocked.incident,'billingReviewIncidents/'+blocked.incident].sort());
  const done=await ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblocked',blocked.guard.epoch,blocked.guard.createdAtMs)).get();assert.equal(done.get('kind'),'intent');
});
// An admission guard that names ANOTHER incident (or none) does not belong to this unblock: it is left exactly as it is.
for(const variant of ['names another incident','is already clear']){
  test('11 an INTENT unblock leaves alone an admission guard that '+variant,{timeout:60000},async()=>{
    const {FieldValue}=await import('firebase-admin/firestore');
    const blocked=await blockedIntentAccount('unblock_intent_admission_'+variant.replace(/ /g,'_')),c=blocked.c,admissionRef=ref(c.root,'billingIntentAdmissionGuards',blocked.incident);
    await admissionRef.update(variant==='names another incident'?{incidentId:sha('another incident')}:{state:'clear',incidentId:FieldValue.delete(),updatedAtMs:FieldValue.delete()});
    const before=(await admissionRef.get()).data();
    const result=await unblockBillingAccount(deps(c),c.account,await request(c,blocked),'operator-ana',9_000_000_000);
    assert.equal(result.unblocked,true);assert.ok(!result.advanced.includes('billingIntentAdmissionGuards/'+blocked.incident));
    assert.deepEqual((await admissionRef.get()).data(),before,'a guard that '+variant+' is untouched');
  });
}
// DeepSeek (final review 3 of piece 2): the emulator cannot inject a write between a read and its commit, so the contract that serializes
// the unblock against a rival row is pinned structurally: the six account collections are read THROUGH the transaction of phase 0 and of
// phase 3 (12 query reads), never with a plain `.get()` that a concurrent writer could slip past.
test('the rows of the account are read through each required transaction and never through a direct read',{timeout:120000},async()=>{
  const blocked=await blockedAccount('unblock_tx_reads'),c=blocked.c,requestBody=await request(c,blocked);
  const SIX=['billingIntents','billingOutbox','billingHoldOutbox','billingReviewIncidents','billingOutboxReviewIncidents','billingIntentObservationIncidents'];
  const TAG=Symbol('collection');
  const direct={query:[],collection:[],document:[]};
  const originalRootCollection=c.root.collection.bind(c.root);
  const tag=(obj,name,kind)=>{Object.defineProperty(obj,TAG,{value:{name,kind},configurable:true});};
  const instrumentQuery=(query,name)=>{
    tag(query,name,'query');
    const originalGet=query.get.bind(query);
    query.get=(...a)=>{direct.query.push(name);return originalGet(...a);};
    return query;
  };
  const instrumentDocument=(doc,name)=>{
    tag(doc,name,'document');
    const originalGet=doc.get.bind(doc);
    doc.get=(...a)=>{direct.document.push(name);return originalGet(...a);};
    return doc;
  };
  const instrumentCollection=(ref,name)=>{
    tag(ref,name,'collection');
    const originalGet=ref.get.bind(ref);
    ref.get=(...a)=>{direct.collection.push(name);return originalGet(...a);};
    const originalWhere=ref.where.bind(ref);
    ref.where=(...args)=>instrumentQuery(originalWhere(...args),name);
    const originalDoc=ref.doc.bind(ref);
    ref.doc=(...args)=>instrumentDocument(originalDoc(...args),name);
    return ref;
  };
  c.root.collection=(name,...rest)=>{
    const ref=originalRootCollection(name,...rest);
    return SIX.includes(name)?instrumentCollection(ref,name):ref;
  };
  // Fases distintas por transición observable: fin de unblockReceipt (probe->claim) y fin de unblock (claim->closure).
  let phase='probe';
  const originalUnblockReceipt=c.accountBilling.unblockReceipt.bind(c.accountBilling);
  const originalUnblock=c.accountBilling.unblock.bind(c.accountBilling);
  c.accountBilling.unblockReceipt=async(...a)=>{try{return await originalUnblockReceipt(...a);}finally{phase='claim';}};
  c.accountBilling.unblock=async(...a)=>{try{return await originalUnblock(...a);}finally{phase='closure';}};
  const originalRun=c.db.runTransaction.bind(c.db),perRun=[];
  c.db.runTransaction=(fn,...rest)=>originalRun(async tx=>{
    const runPhase=phase,seen=new Map();
    const record=arg=>{const t=arg?.[TAG];if(t&&SIX.includes(t.name)&&t.kind!=='document')seen.set(t.name,(seen.get(t.name)??0)+1);};
    const proxy=new Proxy(tx,{get(target,prop){
      const value=Reflect.get(target,prop);
      if(typeof value!=='function')return value;
      if(prop==='get')return (arg,...more)=>{record(arg);return value.call(target,arg,...more);};
      if(prop==='getAll')return (...args)=>{for(const arg of args)record(arg);return value.call(target,...args);};
      return value.bind(target);
    }});
    try{return await fn(proxy);}finally{perRun.push({phase:runPhase,seen:[...seen.entries()]});}
  },...rest);
  let result;
  try{
    // (A) Calibración real: si un tx.get de query/collection/documento dispara los `.get()` públicos, el detector no es fiable.
    direct.query.length=0;direct.collection.length=0;direct.document.length=0;
    await originalRun(async tx=>{
      await tx.get(instrumentQuery(originalRootCollection('billingIntents').where('accountId','==',c.account),'billingIntents'));
      await tx.get(instrumentCollection(originalRootCollection('billingOutbox'),'billingOutbox'));
      await tx.get(instrumentDocument(originalRootCollection('billingHoldOutbox').doc('synthetic-calibration'),'billingHoldOutbox'));
    });
    const reliable=direct.query.length===0&&direct.collection.length===0&&direct.document.length===0;
    direct.query.length=0;direct.collection.length=0;direct.document.length=0;
    // (B) Controles negativos directos: cada forma debe registrarse y no escribe nada.
    const cleanBefore=await signatures(c.root);
    await instrumentCollection(originalRootCollection('billingIntents'),'billingIntents').get();
    await instrumentQuery(originalRootCollection('billingOutbox').where('accountId','==',c.account),'billingOutbox').get();
    await instrumentDocument(originalRootCollection('billingHoldOutbox').doc('synthetic-negative'),'billingHoldOutbox').get();
    assert.ok(direct.collection.includes('billingIntents'),'direct collection.get is recorded');
    assert.ok(direct.query.includes('billingOutbox'),'direct query.get is recorded');
    assert.ok(direct.document.includes('billingHoldOutbox'),'direct document.get is recorded');
    assert.deepEqual(await signatures(c.root),cleanBefore,'the direct-read controls write nothing');
    direct.query.length=0;direct.collection.length=0;direct.document.length=0;
    // (C) Si el detector no distingue, FALLA: no se aprueba cobertura ausente.
    assert.ok(reliable,'detector limit: a transactional get invokes the public .get(), so direct reads cannot be distinguished');
    result=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
  }finally{
    c.db.runTransaction=originalRun;
    c.root.collection=originalRootCollection;
    c.accountBilling.unblockReceipt=originalUnblockReceipt;
    c.accountBilling.unblock=originalUnblock;
  }
  assert.equal(result.videoBlocked,false);
  assert.deepEqual(direct.query,[],'no direct query reads of the six account collections');
  assert.deepEqual(direct.collection,[],'no direct collection reads of the six account collections');
  assert.deepEqual(direct.document,[],'no direct document reads of the six account collections');
  // Fases distintas; los reintentos de una fase no sustituyen a otra fase.
  for(const name of ['probe','claim','closure']){
    const runs=perRun.filter(run=>run.phase===name);
    assert.ok(runs.length>=1,`phase ${name} must run at least one transaction`);
    const readers=runs.filter(run=>run.seen.length>0);
    assert.ok(readers.length>=1,`phase ${name} must read the account rows through a transaction`);
    for(const run of readers){
      const counts=Object.fromEntries(run.seen);
      assert.deepEqual(Object.keys(counts).sort(),[...SIX].sort(),`phase ${name}: a transaction that reads the account rows reads all six`);
      for(const collection of SIX)assert.equal(counts[collection],1,`phase ${name}: ${collection} is read exactly once through the transaction`);
    }
  }
});
// DeepSeek (final review 2 of piece 2): the hold row is written with `...hold` and then `createdAtMs:now`, which overwrote the guard
// creation mark that the hold id names. For the first incident `now` IS the mark; for a SECOND incident on a live guard it is not, so the
// drainer recomputed another id and sent the row to review: Account never recorded that incident.
test('12b a SECOND incident on a live guard stores its hold with the guard generation, so the drainer authorizes it and Account records it',{timeout:90000},async()=>{
  const blocked=await blockedAccount('unblock_second_hold',{extraJobs:1}),c=blocked.c,second=blocked.extras[0];
  const {expected,snapshot}=await expectedAndSnapshot(c,second.id),version=await versionOf(c,second.id);
  const outcome=await c.backend.quarantineExternalBillingOutbox(second.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
  assert.equal(outcome.state,'needs_review');
  const guard=(await guardOf(c).get()).data();assert.equal(guard.epoch,2,'the second incident grows the epoch of the live guard');
  const pending=await c.backend.pendingExternalHolds(10);assert.equal(pending.length,1,'the second incident left exactly one pending hold');
  const row=pending[0];
  assert.equal(row.epoch,2);assert.equal(row.createdAtMs,guard.createdAtMs,'the stored hold carries the guard creation mark its id names, not its own creation time');
  assert.equal(row.id,accountHoldId('outbox',guard.lastOutboxIncidentId,guard.epoch,guard.createdAtMs));
  assert.equal((await c.backend.authorizeExternalHold(row)).state,'eligible');
  assert.equal((await c.accountBilling.block(c.identity,row.id)).created,true,'Account records the second incident');
});
// DeepSeek (final review of piece 2): the audit ids of an INTENT incident must be per OCCURRENCE. An intent's incident key is its
// own id, so it is the same on the second divergence; only the guard generation (and the hold id it names) changes.
test('11 an INTENT that diverges AGAIN after its unblock can be unblocked again: audit records are per occurrence',{timeout:90000},async()=>{
  const blocked=await blockedIntentAccount('unblock_intent_reblock'),c=blocked.c;
  const firstBody=await request(c,blocked),first=await unblockBillingAccount(deps(c),c.account,firstBody,'operator-ana',9_000_000_000);
  assert.equal(first.videoBlocked,false);assert.equal((await guardOf(c).get()).exists,false);
  // The same intent diverges a second time: a NEW guard generation (epoch 1 again, new creation mark) and a NEW hold id.
  await c.backend.recordExternalBillingReview(c.account,blocked.requestKey,blocked.data,{reservationId:blocked.reservationId,state:'captured',seconds:2});
  const guard=(await guardOf(c).get()).data();assert.equal(guard.blocked,true);assert.equal(guard.lastIncidentId,blocked.incident,'the same intent id names the second occurrence');
  const holds=await c.root.collection('billingHoldOutbox').where('state','==','pending').get();assert.equal(holds.size,1);
  const newHold=holds.docs[0].get('id');assert.notEqual(newHold,blocked.hold,'a new occurrence has a new hold id');
  assert.equal((await c.accountBilling.block(c.identity,newHold)).created,true);
  await ref(c.root,'billingHoldOutbox',newHold).update({state:'applied',appliedAtMs:Date.now()});
  const alertId=await currentGuardAlert(c);assert.notEqual(alertId,blocked.alertKey,'a new generation raises a new alert');
  const secondBody=await request(c,{...blocked,alertKey:alertId});
  assert.notEqual(secondBody.createdAtMs,firstBody.createdAtMs);
  const second=await unblockBillingAccount(deps(c),c.account,secondBody,'operator-ana',9_000_010_000);
  assert.equal(second.unblocked,true);assert.equal(second.replayed,false,'the second occurrence is a NEW unblock, never a replay of the first');
  assert.equal(second.videoBlocked,false);assert.equal((await guardOf(c).get()).exists,false);
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,2,'one immutable record per occurrence');
  assert.equal(validClearIntentAdmissionGuard(await ref(c.root,'billingIntentAdmissionGuards',blocked.incident).get(),blocked.incident),true);
  // The FIRST request is still a pure replay of the FIRST occurrence (nothing is blocked now).
  const before=await signatures(c.root),again=await unblockBillingAccount(deps(c),c.account,firstBody,'operator-ana',9_000_020_000);
  assert.equal(again.replayed,true);assert.deepEqual(await signatures(c.root),before);
});
test('11 a hold that needed review when audited is handed back as applied, and a clear row is never touched twice',{timeout:60000},async()=>{
  const blocked=await blockedAccount('unblock_hold_review_audited'),c=blocked.c;
  await ref(c.root,'billingHoldOutbox',blocked.hold).update({state:'needs_review'});
  const requestBody=await request(c,blocked),result=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
  assert.equal(result.videoBlocked,false);
  assert.equal((await ref(c.root,'billingHoldOutbox',blocked.hold).get()).get('state'),'applied');
  assert.ok(result.advanced.includes('billingHoldOutbox/'+blocked.hold),'the hold is reported as advanced');
});
// A pending hold whose stored generation disagrees with the generation its id names is corrupt: the unblock does not adopt it
// (it never advances it), and phase 3 then sees it as an unresolved row of the account, so the Video guard FAILS CLOSED. The
// drainer's own validation sends such a row to review. (There is no resolution path for a corrupt row yet: tracked as 1.4c.)
for(const [field,value] of [['epoch',99],['createdAtMs',1]]){
  test('11 a corrupt pending hold whose stored '+field+' disagrees with its id is never adopted, and keeps the Video guard',{timeout:60000},async()=>{
    const blocked=await blockedAccount('unblock_corrupt_hold_'+field),c=blocked.c,holdRef=ref(c.root,'billingHoldOutbox',blocked.hold);
    await holdRef.update({state:'pending',[field]:value});
    const requestBody=await request(c,blocked),result=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
    assert.equal(result.videoBlocked,true,'a corrupt row of the account keeps the Video guard');assert.equal(result.accountBlocked,false);
    const hold=await holdRef.get();
    assert.equal(hold.get('state'),'pending','the corrupt hold is not advanced');assert.equal(hold.get(field),value);
    assert.ok(!result.advanced.includes('billingHoldOutbox/'+blocked.hold));
    assert.equal((await guardOf(c).get()).get('blocked'),true);
  });
}
for(const [exitState,prepared] of [['release_pending',true],['reserve_pending',false]]){
  test('11 an intent with no work of its own exits to '+exitState+(prepared?' when its release was prepared':' otherwise'),{timeout:60000},async()=>{
    const blocked=await blockedAccount('unblock_exit_'+exitState),c=blocked.c,intentId=sha(JSON.stringify([c.account,blocked.job.requestKey]));
    const {FieldValue}=await import('firebase-admin/firestore');
    await ref(c.root,'billingIntents',intentId).update({jobId:FieldValue.delete()});
    if(prepared)await ref(c.root,'billingIntentWitnesses',intentId).set({terminalRecovery:{releasePrepared:true}},{merge:true});
    const requestBody=await request(c,blocked),result=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
    assert.equal(result.videoBlocked,false);
    const intent=await ref(c.root,'billingIntents',intentId).get();
    assert.equal(intent.get('state'),exitState);assert.equal(intent.get('reviewReason'),undefined);assert.equal(intent.get('reviewOutboxIncidentId'),undefined);
  });
}
test('11 negative: a failed Account phase leaves Video blocked and its rows untouched',{timeout:120000},async()=>{
  const blocked=await blockedAccount('unblock_account_fails'),c=blocked.c,requestBody=await request(c,blocked);
  const ownerBefore=await c.store.videoBalance(c.identity);
  let posts=0,receipts=0;
  const billing={
    unblockReceipt:async(...args)=>{receipts++;return c.accountBilling.unblockReceipt(...args);},
    // Delivery is unknown to Video: Account records no receipt, so the durable claim is the only evidence.
    unblock:async(...args)=>{posts++;throw new Error('synthetic uncertain delivery before Account mutation');},
  };
  const isolated={db:c.db,root:c.root,accountBilling:billing};
  await assert.rejects(unblockBillingAccount(isolated,c.account,requestBody,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  assert.equal(posts,1);assert.equal(receipts,1);
  // Account is asked BEFORE any Video row is advanced: the only Video record is the audited request of phase 1.
  const audits=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get();
  assert.equal(audits.size,1);assert.equal(audits.docs[0].get('action'),'unblock_requested');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'the guard is untouched');
  const guardData=(await guardOf(c).get()).data();
  assert.equal(guardData.epoch,requestBody.epoch);assert.equal(guardData.updatedAtMs,requestBody.updatedAtMs);
  assert.equal((await outbox(c,blocked.job.id).get()).get('state'),'needs_review');
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,true);
  const videoAfterFirst=await signatures(c.root),accountAfterFirst=await signatures(c.accountRoot);
  // The receipt stays pending, so the existing claim never authorizes a second POST: the resume is rejected.
  await assert.rejects(unblockBillingAccount(isolated,c.account,requestBody,'operator-ana',9_000_001_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.equal(posts,1,'pending receipt does not authorize another POST');assert.equal(receipts,2);
  assert.deepEqual(await signatures(c.root),videoAfterFirst);assert.deepEqual(await signatures(c.accountRoot),accountAfterFirst);
  const auditsAfter=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get();
  assert.equal(auditsAfter.size,1,'a single audited request is kept');
  await c.ai.drainExternalBilling();await c.ai.drainExternalBilling();
  assert.equal((await guardOf(c).get()).get('blocked'),true,'the guard is still untouched');
  const guardDataAfter=(await guardOf(c).get()).data();
  assert.equal(guardDataAfter.epoch,requestBody.epoch);assert.equal(guardDataAfter.updatedAtMs,requestBody.updatedAtMs);
  assert.equal((await outbox(c,blocked.job.id).get()).get('state'),'needs_review');
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,true);
  assert.deepEqual(await c.store.videoBalance(c.identity),ownerBefore);
});
test('11 negative: a Video failure after Account confirmed leaves Video blocked, and the repeat completes it',{timeout:40000},async()=>{
  const blocked=await blockedAccount('unblock_video_fails'),c=blocked.c,requestBody=await request(c,blocked);
  // Fail the FIRST Video transaction that follows the Account confirmation: Account already deleted its guard, Video cannot finish.
  const originalUnblock=c.accountBilling.unblock.bind(c.accountBilling),originalRun=c.db.runTransaction.bind(c.db);let confirmed=false;
  c.accountBilling.unblock=async(...args)=>{const receipt=await originalUnblock(...args);confirmed=true;return receipt;};
  c.db.runTransaction=async function(fn){if(confirmed){confirmed=false;throw new Error('synthetic Video crash after the Account confirmation');}return originalRun(fn);};
  // The transport records every request before processing it: /api/internal/video/billing-holds/unblock is the only mutating route,
  // and /api/internal/video/billing-holds/unblock-receipt is a distinct read route that must never stand in for it.
  const unblockPosts=()=>c.transport.bodies.filter(entry=>entry.pathname==='/api/internal/video/billing-holds/unblock').length;
  const receiptReads=()=>c.transport.bodies.filter(entry=>entry.pathname==='/api/internal/video/billing-holds/unblock-receipt').length;
  assert.equal(unblockPosts(),0,'no Video unblock request exists before the first attempt');
  await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000),/synthetic Video crash/);
  assert.equal(unblockPosts(),1,'the first attempt sent exactly one Video unblock request');
  const receiptReadsBeforeResume=receiptReads();
  c.accountBilling.unblock=originalUnblock;c.db.runTransaction=originalRun;
  // Account already deleted its guard; Video is the conservative side and is still blocked.
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,false);
  assert.equal((await guardOf(c).get()).get('blocked'),true);
  assert.equal((await outbox(c,blocked.job.id).get()).get('state'),'needs_review');
  const audits=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get();
  assert.equal(audits.size,1,'only the unblock_requested record exists');assert.equal(audits.docs[0].get('action'),'unblock_requested');
  const resumed=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_002_000);
  assert.equal(resumed.replayed,false);assert.equal(resumed.accountBlocked,false);assert.equal((await guardOf(c).get()).exists,false);
  assert.equal((await outbox(c,blocked.job.id).get()).get('state'),'retry_wait');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get()).size,2);
  // The recovery must read the receipt route instead of re-sending the mutating unblock route.
  assert.equal(unblockPosts(),1,'the Video unblock request count is still exactly one after resuming');
  assert.ok(receiptReads()>receiptReadsBeforeResume,'resuming the unblock reads the distinct /api/internal/video/billing-holds/unblock-receipt route');
});
// ---------------------------------------------------------------------------
// 12. Stale generation refused; the current one applies. 12b. One alert per account and epoch.
// ---------------------------------------------------------------------------
test('12 a stale Video epoch/createdAtMs/updatedAtMs is refused before any send, and the current generation applies',{timeout:60000},async()=>{
  const blocked=await blockedAccount('unblock_stale'),c=blocked.c,requestBody=await request(c,blocked);
  const posts=()=>c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length;
  const postsBefore=posts();
  await assert.rejects(unblockBillingAccount(deps(c),c.account,{...requestBody,epoch:0},'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&(error.code==='invalid'||error.code==='conflict'),'epoch 0 is not a generation');
  const videoChanges=[{epoch:requestBody.epoch+1},...(requestBody.epoch>1?[{epoch:requestBody.epoch-1}]:[]),{createdAtMs:requestBody.createdAtMs+1},{createdAtMs:requestBody.createdAtMs-1},{updatedAtMs:requestBody.updatedAtMs+1},{updatedAtMs:requestBody.updatedAtMs-1}];
  for(const change of videoChanges){
    await assert.rejects(unblockBillingAccount(deps(c),c.account,{...requestBody,...change},'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict',JSON.stringify(change));
  }
  assert.equal(posts(),postsBefore,'a stale Video generation never sends');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get()).size,0,'a stale Video generation writes no audit');
  assert.equal((await guardOf(c).get()).get('blocked'),true);assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,true);
  const applied=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_001);
  assert.equal(applied.unblocked,true);assert.equal((await guardOf(c).get()).exists,false);
  assert.equal(posts(),postsBefore+1,'exactly one mutation, from the valid application');
});

test('12 a wrong Account generation is refused per variation: one claim, one refused POST, guard retained, never re-sent',{timeout:120000},async()=>{
  const variations=[
    {name:'accountEpoch',mutate:body=>{body.accountEpoch=body.accountEpoch+1;}},
    {name:'accountCreatedAtMs',mutate:body=>{body.accountCreatedAtMs=body.accountCreatedAtMs+1;}},
  ];
  for(const variation of variations){
    // Fixture propia por variación: nunca se reutiliza un reclamo incierto de otro caso.
    const blocked=await blockedAccount('unblock_stale_account_'+variation.name),c=blocked.c,requestBody=await request(c,blocked);
    variation.mutate(requestBody);
    const posts=()=>c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length;
    const postsBefore=posts();
    // La variación errónea pasa fase 0 fresh, crea el reclamo y efectúa UN POST que Cuenta rechaza.
    await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000),
      error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account',variation.name);
    assert.equal(posts(),postsBefore+1,`${variation.name}: the claim posts to Account exactly once`);
    const requestedRows=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get();
    assert.equal(requestedRows.size,1,`${variation.name}: exactly one durable request`);
    assert.equal(requestedRows.docs[0].get('action'),'unblock_requested');
    assert.equal(requestedRows.docs[0].get('accountEpoch'),requestBody.accountEpoch,`${variation.name}: the audit stores the supplied Account epoch`);
    assert.equal(requestedRows.docs[0].get('accountCreatedAtMs'),requestBody.accountCreatedAtMs,`${variation.name}: the audit stores the supplied Account creation mark`);
    assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,0,`${variation.name}: a refused generation leaves NO Account receipt`);
    assert.equal((await guardOf(c).get()).get('blocked'),true,`${variation.name}: Video stays blocked`);
    assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,true,`${variation.name}: the Account guard is retained`);
    // Repetir la misma solicitud pinada no reenvía: el reclamo incierto no confiere un segundo envío.
    await assert.rejects(unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_001_000),
      error=>error instanceof UnblockFault&&error.code==='conflict',`${variation.name}: repeat`);
    assert.equal(posts(),postsBefore+1,`${variation.name}: the pinned request is never re-sent`);
    assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get()).size,1,`${variation.name}: one durable request, kept for a safe recovery`);
    assert.equal((await guardOf(c).get()).get('blocked'),true,`${variation.name}: still blocked after the repeat`);
    assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,true,`${variation.name}: Account guard still retained after the repeat`);
  }
});
test('12 epoch 1 again after a delete and a re-block is refused by createdAtMs, never by the epoch alone',{timeout:40000},async()=>{
  const blocked=await blockedAccount('unblock_epoch_reset'),c=blocked.c,firstBody=await request(c,blocked);
  const first=await unblockBillingAccount(deps(c),c.account,firstBody,'operator-ana',9_000_000_000);assert.equal(first.unblocked,true);
  // A NEW incident re-blocks the same row: the guard restarts at epoch 1 with a new createdAtMs.
  const {expected,snapshot}=await expectedAndSnapshot(c,blocked.job.id),version=await versionOf(c,blocked.job.id);
  await c.backend.quarantineExternalBillingOutbox(blocked.job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
  // The second OCCURRENCE is posted to Account with its own hold id, exactly as the drainer does.
  const reHolds=await c.root.collection('billingHoldOutbox').where('state','==','pending').get();
  assert.equal(reHolds.size,1);const reHold=reHolds.docs[0].get('id');
  assert.equal((await c.accountBilling.block(c.identity,reHold)).created,true);
  const guard=(await guardOf(c).get()).data();assert.equal(guard.epoch,1);assert.ok(guard.createdAtMs>=firstBody.createdAtMs);
  // The state also differs by the creation mark even in the same millisecond, and the OLD alert cannot answer for it.
  assert.notEqual('blocked:1:'+guard.createdAtMs,'blocked:1:'+firstBody.createdAtMs);
  // The OLD request (epoch 1, old createdAtMs) cannot clear the new block.
  await assert.rejects(unblockBillingAccount(deps(c),c.account,firstBody,'operator-ana',9_000_003_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.equal((await guardOf(c).get()).get('blocked'),true);
  // The FRESH request must name the NEW incident: the re-block is a different occurrence of the same row.
  const reblocked=guard,fresh=await request(c,{...blocked,incident:reblocked.lastOutboxIncidentId??reblocked.lastIncidentId,alertKey:(await currentGuardAlert(c))});
  const second=await unblockBillingAccount(deps(c),c.account,fresh,'operator-ana',9_000_004_000);
  assert.equal(second.unblocked,true);assert.equal((await guardOf(c).get()).exists,false);
});
async function currentGuardAlert(c){
  const report=await readPendingReport(c.root,Date.now());await raisePendingAlerts(c.db,c.root,report,Date.now());
  const guard=report.rows.find(row=>row.kind==='guard');
  return alertKey('guard',guard.id,guard.state,'needs_review');
}
test('12b a re-block after an unblock is a NEW guard epoch, a new alert, and the sweep never duplicates either',{timeout:40000},async()=>{
  const blocked=await blockedAccount('unblock_alert_epoch'),c=blocked.c;
  const firstRow=(await readPendingReport(c.root,Date.now())).rows.find(row=>row.kind==='guard');
  assert.equal(firstRow.state,blockedState(1,blocked.guard.createdAtMs,blocked.incident));
  await raisePendingAlerts(c.db,c.root,await readPendingReport(c.root,Date.now()),Date.now());
  const again=await raisePendingAlerts(c.db,c.root,await readPendingReport(c.root,Date.now()),Date.now()+1000);
  assert.equal(again.created,0,'the sweep never duplicates a guard alert');
  assert.equal((await c.root.collection(ALERT_COLLECTION).get()).docs.filter(doc=>doc.get('kind')==='guard').length,1);
  const body=await request(c,blocked);
  await unblockBillingAccount(deps(c),c.account,body,'operator-ana',9_000_000_000);
  // Re-block: a new incident on the same account must be a new alert, not the old one reopened.
  const {expected,snapshot}=await expectedAndSnapshot(c,blocked.job.id),version=await versionOf(c,blocked.job.id);
  await c.backend.quarantineExternalBillingOutbox(blocked.job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
  const rows=(await readPendingReport(c.root,Date.now())).rows.filter(row=>row.kind==='guard');
  assert.equal(rows.length,1);
  // A re-block of an account whose guard was deleted starts a NEW generation at epoch 1, but its createdAtMs is new, so the
  // alert key differs. Here the guard was deleted and a new incident landed, so the state is the new generation.
  assert.notEqual(alertKey('guard',rows[0].id,rows[0].state,'needs_review'),blocked.alertKey,'a re-block is a different key');
  const raised=await raisePendingAlerts(c.db,c.root,await readPendingReport(c.root,Date.now()),Date.now()+2000);
  assert.equal(raised.created>=1,true);
  const alerts=(await c.root.collection(ALERT_COLLECTION).get()).docs.filter(doc=>doc.get('kind')==='guard');
  assert.equal(alerts.length,2,'one alert per account and generation, including the re-block');
});
test('12b the alert state carries the REAL epoch, so a second incident on a live block is a new alert',{timeout:40000},async()=>{
  const blocked=await blockedAccount('unblock_alert_epoch2',{extraJobs:1}),c=blocked.c,second=blocked.extras[0];
  const {expected,snapshot}=await expectedAndSnapshot(c,second.id),version=await versionOf(c,second.id);
  await c.backend.quarantineExternalBillingOutbox(second.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
  const rows=(await readPendingReport(c.root,Date.now())).rows.filter(row=>row.kind==='guard');
  assert.equal(rows.length,1);
  const liveGuard=(await guardOf(c).get()).data();
  assert.equal(rows[0].state,blockedState(2,liveGuard.createdAtMs,liveGuard.lastOutboxIncidentId??liveGuard.lastIncidentId),'the state is the real generation, never seeded by hand');
  await raisePendingAlerts(c.db,c.root,await readPendingReport(c.root,Date.now()),Date.now());
  const alerts=(await c.root.collection(ALERT_COLLECTION).get()).docs.filter(doc=>doc.get('kind')==='guard');
  assert.equal(alerts.length,2,'epoch 1 and epoch 2 are two alerts for one account');
});
// ---------------------------------------------------------------------------
// 13. The drain lease is never required.
// ---------------------------------------------------------------------------
test('13 the unblock works while another holder owns billingDrainLease/current and never takes it',{timeout:40000},async()=>{
  const blocked=await blockedAccount('unblock_lease_held'),c=blocked.c,requestBody=await request(c,blocked),now=Date.now();
  const lease=await acquireDrainLease({db:c.db,root:c.root,holderId:'drain-other',now,ttlMs:600_000});
  assert.equal(lease.acquired,true);
  const before=(await ref(c.root,DRAIN_LEASE_COLLECTION,DRAIN_LEASE_DOC_ID).get()).data();
  const result=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
  assert.equal(result.unblocked,true);assert.equal((await guardOf(c).get()).exists,false);
  const after=(await ref(c.root,DRAIN_LEASE_COLLECTION,DRAIN_LEASE_DOC_ID).get()).data();
  assert.deepEqual(after,before,'the lease is untouched');
});
// ---------------------------------------------------------------------------
// Re-blocking the SAME row after an unblock needs a NEW Account incident id and can be unblocked again.
// ---------------------------------------------------------------------------
test('re-block after unblock: the same row diverges again with a NEW Account incident id, the old id is never resent, and it unblocks again',{timeout:60000},async()=>{
  const blocked=await blockedAccount('unblock_reblock'),c=blocked.c,oldIncident=blocked.hold,oldBody=await request(c,blocked);
  const first=await unblockBillingAccount(deps(c),c.account,oldBody,'operator-ana',9_000_000_000);assert.equal(first.unblocked,true);
  const {expected,snapshot}=await expectedAndSnapshot(c,blocked.job.id),version=await versionOf(c,blocked.job.id);
  await c.backend.quarantineExternalBillingOutbox(blocked.job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
  const holds=await c.root.collection('billingHoldOutbox').where('state','==','pending').get();
  assert.equal(holds.size,1);const newHold=holds.docs[0].get('id');
  assert.notEqual(newHold,oldIncident,'a new occurrence of the same row must never reuse the reviewed Account incident id');
  const receipt=await c.accountBilling.block(c.identity,newHold);assert.equal(receipt.created,true);
  await ref(c.root,'billingHoldOutbox',newHold).update({state:'applied',appliedAtMs:Date.now()});
  const alertId=await currentGuardAlert(c),reblocked=(await guardOf(c).get()).data();
  const secondIncident=reblocked.lastOutboxIncidentId??reblocked.lastIncidentId;
  assert.notEqual(secondIncident,blocked.incident,'the re-block names a NEW incident, not the reviewed one');
  const second=await unblockBillingAccount(deps(c),c.account,await request(c,{...blocked,incident:secondIncident,hold:newHold,alertKey:alertId}),'operator-ana',9_000_010_000);
  assert.equal(second.unblocked,true);assert.equal((await guardOf(c).get()).exists,false);
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,false);
  const accountBodies=c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).map(body=>body.data.incidentId);
  assert.deepEqual(accountBodies,[oldIncident,newHold],'the reviewed incident id is never resent');
});

// ---------------------------------------------------------------------------
// retry-generation (GLM + DeepSeek, final reviews of piece 2). When Account's guard
// generation moves between a refused request and an ACK that is lost, a new mutation needs the current Account
// generation. Recovery of an accepted request uses the generation from the durable Account receipt.
//
// REACHABILITY (declared limitation). The extra Account incidents below are recorded through the REAL AccountStore by
// the normal `blockVideoBilling` route (the same call the drainer makes, served by LocalAccountTransport), with ids in
// the exact 64-hex shape the drainer sends. They have NO mirrored new Video row: a second incident that ALSO moves
// Video own guard would make phase 0 refuse first (the alert state and the guard generation would no longer match the
// audited request), so a single Video request cannot reach the "Account moved, Video incident unchanged" state. That
// state is therefore CONSTRUCTED here from the Account side, not proven reachable end to end from one request.
// ---------------------------------------------------------------------------
test('retry-generation A: an Account generation that moved refuses the old request, and the retry with the new generation is confirmed once',{timeout:90000},async()=>{
  const blocked=await blockedAccount('retry_generation_refused'),c=blocked.c,oldBody=await request(c,blocked);
  const g0={epoch:oldBody.accountEpoch,createdAtMs:oldBody.accountCreatedAtMs};
  // A SECOND Account incident on the same owner moves the Account guard generation (real route: blockVideoBilling).
  assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
  const g1=await accountGuard(c);assert.equal(g1.epoch,g0.epoch+1,'the second Account incident grows the Account guard epoch');
  const seeded=await seedFencedSuccessor(c,blocked,{previousEpoch:g0.epoch,successorEpoch:g1.epoch});
  const base=fencedDeps(c,seeded),seen=[];
  const depsA={...base,successor:{...base.successor,receipt:async input=>{
    const result=await base.successor.receipt(input);seen.push(result);return result;}}};
  // A second, FOREIGN identity is blocked too, to prove neither attempt touches another account.
  const foreignUid='synthetic-retry-generation-foreign-'+randomUUID(),foreignBoot=await c.store.bootstrap(foreignUid);
  assert.equal((await c.accountBilling.block(accountIdentityKey(foreignUid),accountHoldId('outbox',randomUUID(),1,1))).created,true);
  const foreignGuardBefore=(await ref(c.accountRoot,'videoBillingGuards',foreignBoot.account.id).get()).data();
  // (1) Account refuses the OLD generation EXPLICITLY: no Account receipt and no Video closure record are created
  // (this attempt's `unblock_requested` WAS already written by phase 0 -- the ONLY Video write so far).
  await assert.rejects(unblockBillingAccount(depsA,c.account,oldBody,'operator-ana',9_000_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  assert.equal(seen[0]?.state,'pending','the REAL fenced receipt observes pending despite live g1');
  assert.equal(seen[0].attemptId,seeded.previousAttemptId);
  assert.equal(seen[0].epoch,g0.epoch);
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Video stays blocked: Account refused the stale generation');
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).get('epoch'),g1.epoch,'the refusal does not move the Account guard');
  const requestedRows=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get();
  assert.equal(requestedRows.size,1);assert.equal(requestedRows.docs[0].get('action'),'unblock_requested');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,0,'no completion record for the refused attempt');
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,0,'a refused generation leaves NO Account receipt');
  // (2) The LEGITIMATE retry names the NEW Account generation. Account confirms the incident; because the second Account
  // incident is still unreviewed, Account keeps its guard and Video keeps its own (partial result).
  const retryBody={...oldBody,accountEpoch:g1.epoch,accountCreatedAtMs:g1.createdAtMs};
  const retry=await unblockBillingAccount(depsA,c.account,retryBody,'operator-ana',9_000_010_000);
  assert.equal(retry.unblocked,true);assert.equal(retry.replayed,false);
  assert.equal(retry.accountBlocked,true,'the account still holds the other unreviewed incident');
  assert.equal(retry.videoBlocked,true);assert.equal((await guardOf(c).get()).get('blocked'),true);
  const doneRows=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get();
  assert.equal(doneRows.size,2,'one unblock_requested and one unblocked, reusing the SAME request record');
  assert.equal(doneRows.docs.filter(doc=>doc.get('action')==='unblock_requested').length,1);
  assert.equal(doneRows.docs.filter(doc=>doc.get('action')==='unblocked').length,1);
  const receipts=await c.accountRoot.collection('videoBillingUnblocks').get();
  assert.equal(receipts.size,1,'exactly ONE accepted Account receipt, from the retry only');
  assert.equal(receipts.docs[0].get('incidentId'),blocked.hold);
  assert.equal(receipts.docs[0].get('epoch'),g1.epoch);assert.equal(receipts.docs[0].get('createdAtMs'),g1.createdAtMs);
  // The refusal never moved the Video guard generation, so the retry resumed the SAME unblock_requested record, which
  // still names the FIRST Account generation (the compared payload deliberately excludes the Account generation).
  const requested=await ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblock_requested',blocked.guard.epoch,blocked.guard.createdAtMs)).get();
  assert.equal(requested.get('accountEpoch'),g0.epoch,'the durable request keeps the FIRST Account generation, not the one that succeeded');
  assert.deepEqual((await ref(c.accountRoot,'videoBillingGuards',foreignBoot.account.id).get()).data(),foreignGuardBefore,'another account is untouched');
});

test('retry-generation B: a lost confirmation is recovered from its receipt while a newer Account block survives',{timeout:120000},async()=>{
  const blocked=await blockedAccount('retry_generation_lost_ack'),c=blocked.c,oldBody=await request(c,blocked);
  const g0={epoch:oldBody.accountEpoch,createdAtMs:oldBody.accountCreatedAtMs};
  assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
  const g1=await accountGuard(c);assert.equal(g1.epoch,g0.epoch+1);
  const seeded=await seedFencedSuccessor(c,blocked,{previousEpoch:g0.epoch,successorEpoch:g1.epoch});
  const fenced=fencedDeps(c,seeded);
  // A: the OLD generation is refused; this attempt's `unblock_requested` (accountEpoch = g0) stays durable in Video.
  await assert.rejects(unblockBillingAccount(fenced,c.account,oldBody,'operator-ana',9_000_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  // B: Account commits the g1 receipt, but the response never reaches Video.
  const retryBody={...oldBody,accountEpoch:g1.epoch,accountCreatedAtMs:g1.createdAtMs};
  const originalUnblock=c.accountBilling.unblock.bind(c.accountBilling);
  c.accountBilling.unblock=async(...args)=>{await originalUnblock(...args);throw new Error('synthetic lost response after Account committed');};
  await assert.rejects(unblockBillingAccount(fenced,c.account,retryBody,'operator-ana',9_000_010_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  c.accountBilling.unblock=originalUnblock;
  // Account committed: ONE accepted receipt (epoch g1), the incident is reviewed, and the guard survives the other incident.
  const receiptsAfterCommit=await c.accountRoot.collection('videoBillingUnblocks').get();
  assert.equal(receiptsAfterCommit.size,1);assert.equal(receiptsAfterCommit.docs[0].get('epoch'),g1.epoch);
  const guardAfterCommit=await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get();
  assert.equal(guardAfterCommit.exists,true);assert.equal(guardAfterCommit.get('epoch'),g1.epoch);assert.equal(guardAfterCommit.get('reviewedCount'),1);
  // Video lost the response: it is still blocked and has no completion record.
  assert.equal((await guardOf(c).get()).get('blocked'),true);
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,0);
  // A THIRD Account incident moves the Account guard AGAIN to g2, so the generation the receipt named (g1) is no longer live.
  assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
  const g2=await accountGuard(c);assert.equal(g2.epoch,g1.epoch+1);
  const receiptBefore=(await c.accountRoot.collection('videoBillingUnblocks').get()).docs[0].data();
  const incidentsBefore=(await c.accountRoot.collection('videoBillingIncidents').get()).docs.map(doc=>[doc.id,doc.get('state'),doc.get('reviewedAtMs')]);
  // Signatures captured BEFORE any further attempt: both negatives below must leave every document exactly as it is.
  const videoBefore=await signatures(c.root),accountBefore=await signatures(c.accountRoot),postsBefore=c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length;
  // Neither the old nor the live generation can replay the mutation that accepted g1.
  for(const generation of [g0,g2]){
    await assert.rejects(c.accountBilling.unblock(c.identity,{incidentId:blocked.hold,...generation,reviewRef:oldBody.evidenceRef}),
      error=>error?.code==='conflict');
  }
  // Neither negative duplicated the receipt, lifted the block, or wrote anything at all.
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Video keeps its own guard after both refusals');
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).get('epoch'),g2.epoch);
  assert.deepEqual((await c.accountRoot.collection('videoBillingUnblocks').get()).docs[0].data(),receiptBefore,'the accepted receipt is untouched');
  assert.deepEqual((await c.accountRoot.collection('videoBillingIncidents').get()).docs.map(doc=>[doc.id,doc.get('state'),doc.get('reviewedAtMs')]),incidentsBefore);
  assert.deepEqual(await signatures(c.root),videoBefore,'a refused retry writes nothing in Video');
  assert.deepEqual(await signatures(c.accountRoot),accountBefore,'a refused retry writes nothing in Account');
  assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length,postsBefore+2,'both refusals asked Account and nothing else');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,0,'still no completion record');
  await assert.rejects(c.accountBilling.unblockReceipt(c.identity,blocked.hold,'another evidence reference'),error=>error?.code==='conflict');
  const readReceipt=c.accountBilling.unblockReceipt.bind(c.accountBilling);
  c.accountBilling.unblockReceipt=async()=>{throw Object.assign(new Error('synthetic unavailable receipt route'),{code:'not_found'});};
  await assert.rejects(unblockBillingAccount(fenced,c.account,oldBody,'operator-ana',9_000_035_000),
    error=>error instanceof UnblockFault&&error.stage==='account');
  c.accountBilling.unblockReceipt=readReceipt;
  assert.deepEqual(await signatures(c.root),videoBefore,'an unavailable receipt writes nothing in Video');
  assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length,postsBefore+2,'an unavailable receipt never triggers a mutation');
  // Video recovers g1 from the original g0 request and keeps its guard because the other Account incidents are open.
  const readsBefore=c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock-receipt')).length;
  const recovered=await unblockBillingAccount(fenced,c.account,oldBody,'operator-ana',9_000_040_000);
  assert.equal(recovered.unblocked,true);assert.equal(recovered.replayed,false);
  assert.equal(recovered.accountBlocked,true);assert.equal(recovered.videoBlocked,true);
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Account still holds the other incident, so Video stays blocked');
  const doneAfterRecovery=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get();
  assert.equal(doneAfterRecovery.size,1,'the pending phase 3 is completed ONCE');
  assert.equal(doneAfterRecovery.docs[0].get('accountReplayed'),true);
  assert.equal(doneAfterRecovery.docs[0].get('accountEpoch'),g1.epoch);
  assert.equal(doneAfterRecovery.docs[0].get('accountCreatedAtMs'),g1.createdAtMs);
  assert.equal(doneAfterRecovery.docs[0].get('accountBlocked'),true);assert.equal(doneAfterRecovery.docs[0].get('videoBlocked'),true);
  assert.deepEqual((await c.accountRoot.collection('videoBillingUnblocks').get()).docs[0].data(),receiptBefore,'the receipt is recovered, never duplicated');
  assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length,postsBefore+2,'recovery never sends a mutation');
  assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock-receipt')).length,readsBefore+1,'recovery makes one receipt read');
  // A further identical call adds no second completion or receipt and still keeps the block.
  const doneCount=doneAfterRecovery.size,receiptCount=(await c.accountRoot.collection('videoBillingUnblocks').get()).size;
  const repeat=await unblockBillingAccount(fenced,c.account,oldBody,'operator-ana',9_000_050_000);
  assert.equal(repeat.unblocked,true);assert.equal(repeat.replayed,true);assert.equal(repeat.videoBlocked,true);
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,doneCount,'never a second completion record');
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,receiptCount,'never a second Account receipt');
  assert.equal((await guardOf(c).get()).get('blocked'),true);
  assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length,postsBefore+2);
  assert.deepEqual(await signatures(c.accountRoot),accountBefore,'receipt recovery does not change anything in Account');
  // The recovery records the accepted generation in a new completion, leaving the original intent immutable.
  const requested=await ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblock_requested',blocked.guard.epoch,blocked.guard.createdAtMs)).get();
  assert.equal(requested.get('accountEpoch'),g0.epoch,'the Video durable request records the FIRST Account generation, never the accepted one');
  assert.equal(requested.get('accountCreatedAtMs'),g0.createdAtMs);
  assert.equal(receiptBefore.epoch,g1.epoch,'Account IS the durable authority for the generation the accepted receipt used');
});

test('retry-generation C: a lost confirmation is recovered from its receipt while a newer Account block survives',{timeout:120000},async()=>{
  const blocked=await blockedAccount('retry_generation_lost_ack_recovery'),c=blocked.c;
  const postCount=()=>c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length;
  const receiptReadCount=()=>c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock-receipt')).length;
  // Incidente de sostenimiento ANTES de la mutación: el guard de Cuenta sobrevive la revisión del incidente revisado.
  assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
  const body=await request(c,blocked); // nombra la generación Account vigente (incluye el incidente de sostenimiento)
  const accepted={epoch:body.accountEpoch,createdAtMs:body.accountCreatedAtMs};
  const requestRef=ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblock_requested',blocked.guard.epoch,blocked.guard.createdAtMs));
  // (1) La PRIMERA y ÚNICA mutación usa la generación vigente; Cuenta confirma y la ACK se pierde.
  const postsBefore=postCount();
  const originalUnblock=c.accountBilling.unblock.bind(c.accountBilling);
  c.accountBilling.unblock=async(...args)=>{await originalUnblock(...args);throw new Error('synthetic lost response after Account committed');};
  await assert.rejects(unblockBillingAccount(deps(c),c.account,body,'operator-ana',9_000_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  c.accountBilling.unblock=originalUnblock;
  assert.equal(postCount(),postsBefore+1,'exactly one initial mutation POST');
  const postsAfterMutation=postCount();
  // La solicitud original durable conserva sus valores y su versión.
  const requestedAfterMutation=await requestRef.get();
  assert.equal(requestedAfterMutation.get('accountEpoch'),accepted.epoch);
  assert.equal(requestedAfterMutation.get('accountCreatedAtMs'),accepted.createdAtMs);
  const requestVersion=`${requestedAfterMutation.updateTime.seconds}:${String(requestedAfterMutation.updateTime.nanoseconds).padStart(9,'0')}`;
  // Un único recibo aceptado, con la generación aceptada y el incidente correcto.
  const receiptBefore=(await c.accountRoot.collection('videoBillingUnblocks').get()).docs;
  assert.equal(receiptBefore.length,1);assert.equal(receiptBefore[0].get('epoch'),accepted.epoch);assert.equal(receiptBefore[0].get('incidentId'),blocked.hold);
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Video lost the response and stays blocked');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,0,'no completion yet');
  // (2) Un bloqueo MÁS NUEVO mueve el guard de Cuenta por encima de la generación aceptada.
  assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
  const newer=await accountGuard(c);assert.ok(newer.epoch>accepted.epoch,'the Account guard moved to a newer generation');
  const receiptSnapshot=(await c.accountRoot.collection('videoBillingUnblocks').get()).docs[0].data();
  const incidentsBefore=(await c.accountRoot.collection('videoBillingIncidents').get()).docs.map(d=>[d.id,d.get('state'),d.get('reviewedAtMs')]);
  const videoBefore=await signatures(c.root),accountBefore=await signatures(c.accountRoot);
  // (3) DOS controles NEGATIVOS manuales, contados aparte: ni la aceptada ni la nueva reproducen la mutación.
  const postsBeforeNegatives=postCount();
  for(const generation of [{epoch:accepted.epoch-1,createdAtMs:accepted.createdAtMs},{epoch:newer.epoch,createdAtMs:newer.createdAtMs}]){
    await assert.rejects(c.accountBilling.unblock(c.identity,{incidentId:blocked.hold,...generation,reviewRef:body.evidenceRef}),error=>error?.code==='conflict');
  }
  assert.equal(postCount(),postsBeforeNegatives+2,'the two manual refusals ask Account exactly twice');
  const postsAfterRefusals=postCount();
  assert.equal(postsAfterRefusals,postsAfterMutation+2,'nothing else was sent to Account beyond the two refusals');
  assert.deepEqual(await signatures(c.root),videoBefore,'a refused retry writes nothing in Video');
  assert.deepEqual(await signatures(c.accountRoot),accountBefore,'a refused retry writes nothing in Account');
  // (4) Lectura de recibo no disponible: no escribe nada y nunca muta.
  await assert.rejects(c.accountBilling.unblockReceipt(c.identity,blocked.hold,'another evidence reference'),error=>error?.code==='conflict');
  const readReceipt=c.accountBilling.unblockReceipt.bind(c.accountBilling);
  c.accountBilling.unblockReceipt=async()=>{throw Object.assign(new Error('synthetic unavailable receipt route'),{code:'not_found'});};
  await assert.rejects(unblockBillingAccount(deps(c),c.account,body,'operator-ana',9_000_035_000),error=>error instanceof UnblockFault&&error.stage==='account');
  c.accountBilling.unblockReceipt=readReceipt;
  assert.deepEqual(await signatures(c.root),videoBefore,'an unavailable receipt writes nothing in Video');
  assert.equal(postCount(),postsAfterRefusals,'an unavailable receipt never triggers a mutation');
  // (5) Recuperación por recibo pese a la nueva generación, sin segundo envío desde Video.
  const readsBefore=receiptReadCount();
  const recovered=await unblockBillingAccount(deps(c),c.account,body,'operator-ana',9_000_040_000);
  assert.equal(recovered.unblocked,true);assert.equal(recovered.replayed,false);
  assert.equal(recovered.accountBlocked,true);assert.equal(recovered.videoBlocked,true);
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Account still holds the newer incident, so Video stays blocked');
  // La solicitud original conserva valores Y versión tras la recuperación.
  const requestedAfterRecovery=await requestRef.get();
  assert.equal(requestedAfterRecovery.get('accountEpoch'),accepted.epoch,'the durable request keeps its original Account epoch');
  assert.equal(requestedAfterRecovery.get('accountCreatedAtMs'),accepted.createdAtMs);
  assert.equal(`${requestedAfterRecovery.updateTime.seconds}:${String(requestedAfterRecovery.updateTime.nanoseconds).padStart(9,'0')}`,requestVersion,'the durable request version is unchanged by recovery');
  // El guard de Cuenta sigue en la generación NUEVA tras la recuperación.
  const guardAfterRecovery=await accountGuard(c);
  assert.equal(guardAfterRecovery.epoch,newer.epoch,'the Account guard stays at the newer generation after recovery');
  assert.equal(guardAfterRecovery.createdAtMs,newer.createdAtMs);
  // Un único cierre, con la generación ACEPTADA; el recibo se recupera, nunca se duplica.
  const doneAfterRecovery=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get();
  assert.equal(doneAfterRecovery.size,1,'the pending phase 3 is completed ONCE');
  assert.equal(doneAfterRecovery.docs[0].get('accountReplayed'),true);
  assert.equal(doneAfterRecovery.docs[0].get('accountEpoch'),accepted.epoch,'the closure carries the ACCEPTED generation, not the newer one');
  assert.equal(doneAfterRecovery.docs[0].get('accountCreatedAtMs'),accepted.createdAtMs);
  assert.equal(doneAfterRecovery.docs[0].get('accountBlocked'),true);assert.equal(doneAfterRecovery.docs[0].get('videoBlocked'),true);
  assert.deepEqual((await c.accountRoot.collection('videoBillingUnblocks').get()).docs[0].data(),receiptSnapshot,'the receipt is recovered, never duplicated');
  assert.equal(postCount(),postsAfterRefusals,'recovery never sends a mutation');
  assert.equal(receiptReadCount(),readsBefore+1,'recovery makes one receipt read');
  // Una llamada idéntica adicional no añade un segundo cierre ni un segundo recibo y mantiene el bloqueo.
  const doneCount=doneAfterRecovery.size,receiptCount=(await c.accountRoot.collection('videoBillingUnblocks').get()).size;
  const repeat=await unblockBillingAccount(deps(c),c.account,body,'operator-ana',9_000_050_000);
  assert.equal(repeat.unblocked,true);assert.equal(repeat.replayed,true);assert.equal(repeat.videoBlocked,true);
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,doneCount,'never a second completion record');
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,receiptCount,'never a second receipt');
  assert.deepEqual((await c.accountRoot.collection('videoBillingIncidents').get()).docs.map(d=>[d.id,d.get('state'),d.get('reviewedAtMs')]),incidentsBefore,'the other incidents are untouched');
  assert.deepEqual(await signatures(c.accountRoot),accountBefore,'receipt recovery does not change anything in Account');
});

// Isolated regression candidates: the Account mutation is never resent after an uncertain reply.
// These cases use only the fresh synthetic roots and the in-process AccountStore above.
test('an uncertain Account unblock with no receipt preserves reservations and never sends a second POST',{timeout:120000},async()=>{
  const blocked=await blockedAccount('uncertain_unblock_no_receipt',{extraReleases:2}),{c,releases}=blocked;
  for(const job of releases)await outbox(c,job.id).update({state:'pending',nextAttemptAt:0});
  const foreignUid='synthetic-foreign-'+randomUUID(),foreign=await c.store.bootstrap(foreignUid),foreignIdentity=accountIdentityKey(foreignUid);
  await ref(c.accountRoot,'accounts',foreign.account.id).update({credited:10,available:10});
  await c.store.reserveVideo(foreignIdentity,randomUUID(),3);
  const ownerBefore=await c.store.videoBalance(c.identity),foreignBefore=await c.store.videoBalance(foreignIdentity);
  assert.deepEqual(ownerBefore,{unit:'video_seconds',credited:40,available:34,reserved:6,consumed:0,active:3});
  const releaseBefore=await Promise.all(releases.map(job=>outbox(c,job.id).get()));
  let posts=0,receipts=0;
  const billing={
    unblockReceipt:async(...args)=>{receipts++;return c.accountBilling.unblockReceipt(...args);},
    // Simulate delivery that is unknown to Video: Account has not recorded a receipt.
    unblock:async(...args)=>{posts++;if(posts===1)throw new Error('synthetic uncertain delivery before Account mutation');return c.accountBilling.unblock(...args);},
  };
  const body=await request(c,blocked),isolated={db:c.db,root:c.root,accountBilling:billing};
  await assert.rejects(unblockBillingAccount(isolated,c.account,body,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  assert.equal(posts,1);assert.equal(receipts,1);
  assert.equal((await guardOf(c).get()).get('blocked'),true);
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,true);
  const videoAfterFirst=await signatures(c.root),accountAfterFirst=await signatures(c.accountRoot);
  await assert.rejects(unblockBillingAccount(isolated,c.account,body,'operator-ana',9_000_001_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.equal(posts,1,'pending receipt does not authorize another POST');assert.equal(receipts,2);
  assert.deepEqual(await signatures(c.root),videoAfterFirst);assert.deepEqual(await signatures(c.accountRoot),accountAfterFirst);
  await c.ai.drainExternalBilling();await c.ai.drainExternalBilling();
  const releaseAfter=await Promise.all(releases.map(job=>outbox(c,job.id).get()));
  for(let i=0;i<releases.length;i++){assert.deepEqual(releaseAfter[i].data(),releaseBefore[i].data());assert.equal(releaseAfter[i].updateTime.isEqual(releaseBefore[i].updateTime),true);}
  assert.deepEqual(await c.store.videoBalance(c.identity),ownerBefore);
  assert.deepEqual(await c.store.videoBalance(foreignIdentity),foreignBefore);
  await c.store.reserveVideo(foreignIdentity,randomUUID(),2);
  assert.deepEqual(await c.store.videoBalance(foreignIdentity),{unit:'video_seconds',credited:10,available:5,reserved:5,consumed:0,active:2});
  assert.deepEqual(await c.store.videoBalance(c.identity),ownerBefore,'a different account can reserve without changing the blocked owner');
});

test('a confirmed lost unblock reply recovers by receipt and returns both reservations exactly once',{timeout:120000},async()=>{
  const blocked=await blockedAccount('uncertain_unblock_confirmed_receipt',{extraReleases:2}),{c,releases}=blocked;
  for(const job of releases)await outbox(c,job.id).update({state:'pending',nextAttemptAt:0});
  const foreignUid='synthetic-foreign-'+randomUUID(),foreign=await c.store.bootstrap(foreignUid),foreignIdentity=accountIdentityKey(foreignUid);
  await ref(c.accountRoot,'accounts',foreign.account.id).update({credited:10,available:10});
  await c.store.reserveVideo(foreignIdentity,randomUUID(),3);
  const ownerBefore=await c.store.videoBalance(c.identity),foreignBefore=await c.store.videoBalance(foreignIdentity);
  assert.deepEqual(ownerBefore,{unit:'video_seconds',credited:40,available:34,reserved:6,consumed:0,active:3});
  let posts=0,receipts=0;
  const billing={
    unblockReceipt:async(...args)=>{receipts++;return c.accountBilling.unblockReceipt(...args);},
    unblock:async(...args)=>{posts++;const result=await c.accountBilling.unblock(...args);if(posts===1)throw new Error('synthetic lost reply after Account commit');return result;},
  };
  const body=await request(c,blocked),isolated={db:c.db,root:c.root,accountBilling:billing};
  await assert.rejects(unblockBillingAccount(isolated,c.account,body,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  assert.equal(posts,1);assert.equal(receipts,1);
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1,'Account has one confirmed receipt');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Video remains blocked while the reply is unknown');
  assert.deepEqual(await c.store.videoBalance(c.identity),ownerBefore);
  const recovered=await unblockBillingAccount(isolated,c.account,body,'operator-ana',9_000_001_000);
  assert.equal(recovered.videoBlocked,false);assert.equal(posts,1,'recovery uses the receipt and never resends the POST');assert.equal(receipts,2);
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1);
  const start=c.transport.bodies.length;
  await c.ai.drainExternalBilling();await c.ai.drainExternalBilling();
  for(const job of releases){
    assert.equal(c.transport.bodies.slice(start).filter(call=>call.pathname.endsWith('/release')&&call.pathname.includes(job.reservationId)).length,1);
    assert.equal((await c.store.videoReservation(c.identity,job.reservationId)).state,'released');
    assert.equal((await outbox(c,job.id).get()).get('state'),'settled');
  }
  assert.deepEqual(await c.store.videoBalance(c.identity),{unit:'video_seconds',credited:40,available:38,reserved:0,consumed:2,active:0});
  assert.deepEqual(await c.store.videoBalance(foreignIdentity),foreignBefore,'the other account is unchanged');
});

for(const cutState of ['missing','modified','recreated']){
  test(`a ${cutState} writer cut cannot authorize an Account unblock`,{timeout:60000},async()=>{
    const blocked=await blockedAccount('negative_writer_cut_'+cutState),c=blocked.c;
    const ownerBefore=await c.store.videoBalance(c.identity);
    // Every deletion is preceded by the exact marker check for this fresh synthetic root.
    if(cutState==='missing'||cutState==='recreated'){
      await assertFinancialOwnedRoot(c.db,c.root,c.roots[0].marker);
      await c.writerCut.delete();
    }
    if(cutState==='modified')await c.writerCut.update({purpose:'synthetic-invalid-cut'});
    if(cutState==='recreated'){
      await c.writerCut.create({v:1,purpose:'unblock-writer-cut'});
      const [guard,cut]=await Promise.all([guardOf(c).get(),c.writerCut.get()]),a=guard.createTime,b=cut.createTime;
      assert.ok(a&&b&&(b.seconds>a.seconds||b.seconds===a.seconds&&b.nanoseconds>a.nanoseconds),'the recreated cut must be newer than the guard');
    }
    const videoBefore=await signatures(c.root),accountBefore=await signatures(c.accountRoot),body=await request(c,blocked);
    let posts=0;const states=[];
    const billing={
      unblockReceipt:async(...args)=>{const receipt=await c.accountBilling.unblockReceipt(...args);states.push(receipt.state);return receipt;},
      unblock:async(...args)=>{posts++;return c.accountBilling.unblock(...args);},
    };
    await assert.rejects(unblockBillingAccount({db:c.db,root:c.root,accountBilling:billing},c.account,body,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict');
    assert.deepEqual(states,['pending']);assert.equal(posts,0);
    assert.deepEqual(await signatures(c.root),videoBefore);assert.deepEqual(await signatures(c.accountRoot),accountBefore);
    assert.deepEqual(await c.store.videoBalance(c.identity),ownerBefore);
    assert.equal((await guardOf(c).get()).get('blocked'),true);
  });
}

// LV-019.B: isolated, test-only integration of the REAL Video unblock (`unblockBillingAccount`) with the REAL
// fenced AccountStore methods (`confirmFencedVideoBillingUnblockAttempt` / `fencedVideoBillingUnblockReceipt`),
// both on the fixed loopback emulator, THROUGH the real `AccountBillingClient` over a fictitious transport.
// Scope: CONFIRMATION-FIRST ONLY. It does NOT exercise a successor, does NOT install a real writer cut, does NOT
// prove authority, and does NOT disable the older `unblockVideoBilling` writer. The seeded `fenced_v1` anchor and
// the incident protocol mark are a TEST HYPOTHESIS over the emulator, not a production guarantee. The real
// fenced/IAM/writer-cut route does not exist here and this test does not accredit it. No real API is changed and
// no production safety is claimed.

const docVersion=(doc,field)=>{const s=doc[field];return s&&Number.isSafeInteger(s.seconds)&&Number.isSafeInteger(s.nanoseconds)&&s.nanoseconds<1_000_000_000?s.seconds+':'+s.nanoseconds:null;};

async function seedFencedHypothesis(c,blocked,reviewRef,authorizationSha256){
  const accountId=c.accountOwner,incidentId=blocked.hold;
  const accountGuard=await ref(c.accountRoot,'videoBillingGuards',accountId).get();
  assert.equal(accountGuard.exists,true,'the real Account guard exists');
  const epoch=accountGuard.get('epoch'),createdAtMs=accountGuard.get('createdAtMs');
  assert.ok(Number.isSafeInteger(epoch)&&epoch>=1,'the Account guard epoch is an integer >= 1');
  assert.ok(Number.isSafeInteger(createdAtMs),'the Account guard createdAtMs is an integer');
  const identity=await ref(c.accountRoot,'identities',c.identity).get();
  assert.equal(identity.exists,true,'the real Account identity exists');
  const identityVersion=docVersion(identity,'updateTime'),guardVersion=docVersion(accountGuard,'createTime');
  assert.ok(identityVersion&&guardVersion,'real Firestore versions are required');
  const incidentRef=ref(c.accountRoot,'videoBillingIncidents',hashJson([accountId,incidentId]));
  assert.equal((await incidentRef.get()).exists,true,'the real Account incident exists');
  // TEST HYPOTHESIS ONLY: mark the real incident with the fenced protocol and seed the anchor.
  await incidentRef.update({unblockProtocol:'fenced_v1'});
  const incident=await incidentRef.get(),incidentVersion=docVersion(incident,'createTime');
  assert.ok(incidentVersion,'the real incident createTime is required');
  const attemptId=randomUUID();
  const original={ownerAccountId:accountId,identityKey:c.identity,incidentId,unblockProtocol:'fenced_v1',
    createdAtMs,reviewRef,authorizationSha256,identityVersion,incidentVersion,guardVersion};
  await ref(c.accountRoot,'videoBillingUnblockAttempts',hashJson([accountId,incidentId]))
    .set({...original,initialAttemptId:attemptId,initialEpoch:epoch});
  return {attemptId,epoch,createdAtMs,authorizationSha256,reviewRef,incidentId};
}

/**
 * A fictitious transport for the REAL `AccountBillingClient`. It maps the two client paths to the REAL fenced
 * AccountStore methods and counts LOCAL transport invocations (not real HTTP). The client does not send
 * `attemptId`/`authorizationSha256`; the transport injects them from the test anchor, standing in for the
 * server-side anchor lookup the real endpoint would perform. The response echoes `incidentId`/`reviewRef`
 * because the real client validates them.
 */
function fencedTransport(c,anchor,counters){
  return {
    async request(call){
      const pathname=new URL(call.url).pathname,body=call.data??{};
      if(pathname==='/api/internal/video/billing-holds/unblock'){
        counters.unblock++;
        assert.deepEqual(Object.keys(body).sort(),['createdAtMs','epoch','identityKey','incidentId','reviewRef'],'the client sends the exact unblock body');
        assert.equal(body.incidentId,anchor.incidentId,'the client preserves the holdId');
        assert.equal(body.reviewRef,anchor.reviewRef);
        assert.equal(body.epoch,anchor.epoch);
        assert.equal(body.createdAtMs,anchor.createdAtMs);
        const result=await c.store.confirmFencedVideoBillingUnblockAttempt(body.identityKey,{
          incidentId:body.incidentId,attemptId:anchor.attemptId,epoch:body.epoch,createdAtMs:body.createdAtMs,
          reviewRef:body.reviewRef,authorizationSha256:anchor.authorizationSha256});
        if(result.state!=='confirmed')throw Object.assign(new Error('unexpected fenced confirm state: '+result.state),{response:{status:409,data:{error:'conflict'}}});
        // Lose the ACK AFTER the Account commit: the receipt is durable, the caller never sees it.
        if(counters.unblock===1)throw Object.assign(new Error('synthetic lost reply after Account fence commit'),{response:{status:503,data:{error:'unavailable'}}});
        return {data:{unblocked:true,replayed:result.replayed,blocked:result.blocked}};
      }
      if(pathname==='/api/internal/video/billing-holds/unblock-receipt'){
        counters.receipt++;
        assert.deepEqual(Object.keys(body).sort(),['identityKey','incidentId','reviewRef'],'the client sends the exact receipt body');
        assert.equal(body.incidentId,anchor.incidentId,'the client preserves the holdId');
        assert.equal(body.reviewRef,anchor.reviewRef);
        const result=await c.store.fencedVideoBillingUnblockReceipt(body.identityKey,{
          incidentId:body.incidentId,attemptId:anchor.attemptId,epoch:anchor.epoch,createdAtMs:anchor.createdAtMs,
          reviewRef:body.reviewRef,authorizationSha256:anchor.authorizationSha256});
        if(result.state==='confirmed')return {data:{state:'confirmed',incidentId:body.incidentId,reviewRef:body.reviewRef,epoch:result.epoch,createdAtMs:result.createdAtMs,blocked:result.blocked}};
        if(result.state==='pending')return {data:{state:'pending',incidentId:body.incidentId,reviewRef:body.reviewRef}};
        throw Object.assign(new Error('unexpected fenced receipt state: '+result.state),{response:{status:409,data:{error:'conflict'}}});
      }
      throw Object.assign(new Error('unexpected path '+pathname),{response:{status:404,data:{error:'not_found'}}});
    },
  };
}

test('a fenced confirmation-first unblock recovers by receipt and returns both reservations exactly once',{timeout:120000},async()=>{
  const blocked=await blockedAccount('fenced_confirmation_first',{extraReleases:2}),{c,guard,releases}=blocked;
  assert.equal(blocked.hold,accountHoldId('outbox',blocked.incident,guard.epoch,guard.createdAtMs),'the hold id is derived by videoHoldId');
  for(const job of releases)await outbox(c,job.id).update({state:'pending',nextAttemptAt:0});
  const foreignUid='synthetic-foreign-'+randomUUID(),foreign=await c.store.bootstrap(foreignUid),foreignIdentity=accountIdentityKey(foreignUid);
  await ref(c.accountRoot,'accounts',foreign.account.id).update({credited:10,available:10});
  const foreignReservationId=randomUUID();
  await c.store.reserveVideo(foreignIdentity,foreignReservationId,3);
  const foreignReservationRef=ref(c.accountRoot,'videoReservations',hashJson([foreign.account.id,foreignReservationId]));
  const foreignReservationBefore=(await foreignReservationRef.get()).data();
  const foreignLedger=()=>c.accountRoot.collection('ledgerEntries').where('ownerAccountId','==',foreign.account.id).get().then(page=>page.docs.map(doc=>[doc.ref.path,doc.data()]).sort((x,y)=>x[0]<y[0]?-1:1));
  const foreignLedgerBefore=await foreignLedger();
  const ownerBefore=await c.store.videoBalance(c.identity),foreignBefore=await c.store.videoBalance(foreignIdentity);
  assert.deepEqual(ownerBefore,{unit:'video_seconds',credited:40,available:34,reserved:6,consumed:0,active:3});
  const body=await request(c,blocked);
  const authorizationSha256=sha(['fenced-hypothesis',blocked.hold]);
  const anchor=await seedFencedHypothesis(c,blocked,body.evidenceRef,authorizationSha256);
  const counters={unblock:0,receipt:0};
  const client=new AccountBillingClient(undefined,fencedTransport(c,anchor,counters));
  const isolated={db:c.db,root:c.root,accountBilling:client};
  await assert.rejects(unblockBillingAccount(isolated,c.account,body,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  assert.equal(counters.unblock,1,'exactly one local transport mutation was sent');
  assert.equal(counters.receipt,1);
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1,'Account has one confirmed receipt');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Video remains blocked while the reply is unknown');
  assert.deepEqual(await c.store.videoBalance(c.identity),ownerBefore);
  // The lost ACK still left exactly one durable claim: requested + witness + dispatch.
  const requestedId=unblockAuditId(blocked.incident,'unblock_requested',body.epoch,body.createdAtMs);
  const requestedRef=ref(c.root,UNBLOCK_AUDIT_COLLECTION,requestedId);
  const witnessRef=ref(c.root,UNBLOCK_CONTINUITY_COLLECTION,requestedId);
  const dispatchRef=ref(c.root,UNBLOCK_CONTINUITY_COLLECTION,'dispatch-'+requestedId);
  const requestedBefore=await requestedRef.get(),witnessBefore=await witnessRef.get(),dispatchBefore=await dispatchRef.get();
  assert.equal(requestedBefore.exists,true,'exactly one unblock_requested claim');
  assert.equal(witnessBefore.exists,true,'its witness is durable');
  assert.equal(dispatchBefore.exists,true,'its dispatch is durable');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblock_requested').get()).size,1);
  assert.ok(requestedBefore.createTime.isEqual(requestedBefore.updateTime),'the claim is immutable');
  const claimVersions=[docVersion(requestedBefore,'updateTime'),docVersion(witnessBefore,'updateTime'),docVersion(dispatchBefore,'updateTime')];
  assert.ok(claimVersions.every(Boolean));
  const recovered=await unblockBillingAccount(isolated,c.account,body,'operator-ana',9_000_001_000);
  assert.equal(recovered.replayed,false,'the recovery is a first closure, not a replay');
  assert.equal(recovered.videoBlocked,false,'Video is closed after the receipt');
  assert.equal(recovered.accountBlocked,false);
  assert.equal(counters.unblock,1,'recovery uses the receipt and never resends the mutation');
  assert.equal(counters.receipt,2);
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1);
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,1,'Video writes exactly one unblocked audit');
  assert.equal((await guardOf(c).get()).exists,false,'the Video guard is released');
  // The durable claim and its continuity records survive the recovery unchanged.
  assert.deepEqual([docVersion(await requestedRef.get(),'updateTime'),docVersion(await witnessRef.get(),'updateTime'),docVersion(await dispatchRef.get(),'updateTime')],claimVersions,'the claim versions are preserved after recovery');
  const repeated=await unblockBillingAccount(isolated,c.account,body,'operator-ana',9_000_002_000);
  assert.equal(repeated.replayed,true,'a final repetition is a replay');
  assert.equal(repeated.videoBlocked,false);
  assert.equal(counters.unblock,1,'the replay sends no mutation');
  assert.equal(counters.receipt,2,'the replay reads no second receipt');
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1);
  const start=c.transport.bodies.length;
  await c.ai.drainExternalBilling();await c.ai.drainExternalBilling();
  for(const job of releases){
    assert.equal(c.transport.bodies.slice(start).filter(call=>call.pathname.endsWith('/release')&&call.pathname.includes(job.reservationId)).length,1);
    assert.equal((await c.store.videoReservation(c.identity,job.reservationId)).state,'released');
    assert.equal((await outbox(c,job.id).get()).get('state'),'settled');
  }
  assert.deepEqual(await c.store.videoBalance(c.identity),{unit:'video_seconds',credited:40,available:38,reserved:0,consumed:2,active:0});
  assert.deepEqual(await c.store.videoBalance(foreignIdentity),foreignBefore,'the other account balance is unchanged');
  assert.deepEqual((await foreignReservationRef.get()).data(),foreignReservationBefore,'the other account reservation is unchanged');
  assert.deepEqual(await foreignLedger(),foreignLedgerBefore,'the other account ledger is unchanged');
});

test('a fenced receipt naming a different incident is refused without writes',{timeout:120000},async()=>{
  const blocked=await blockedAccount('fenced_receipt_negative'),{c}=blocked;
  const body=await request(c,blocked);
  const anchor=await seedFencedHypothesis(c,blocked,body.evidenceRef,sha(['fenced-negative',blocked.hold]));
  const before=await signatures(c.accountRoot);
  const foreignIncident=accountHoldId('outbox',randomUUID(),1,1);
  const transport={async request(call){
    const pathname=new URL(call.url).pathname;
    if(pathname==='/api/internal/video/billing-holds/unblock-receipt')
      return {data:{state:'confirmed',incidentId:foreignIncident,reviewRef:call.data.reviewRef,epoch:anchor.epoch,createdAtMs:anchor.createdAtMs,blocked:false}};
    throw Object.assign(new Error('unexpected path '+pathname),{response:{status:404,data:{error:'not_found'}}});
  }};
  const client=new AccountBillingClient(undefined,transport);
  await assert.rejects(client.unblockReceipt(c.identity,anchor.incidentId,body.evidenceRef),error=>error?.code==='unavailable');
  assert.deepEqual(await signatures(c.accountRoot),before,'a mismatched receipt writes nothing');
});

test('successor real receipt: g0->g1 observes pending, closes by ONE successor claim, drains once and leaves the other account intact',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_real_receipt',{extraReleases:2}),{c,guard,releases}=blocked;
  assert.equal(blocked.hold,accountHoldId('outbox',blocked.incident,guard.epoch,guard.createdAtMs));
  for(const job of releases)await outbox(c,job.id).update({state:'pending',nextAttemptAt:0});
  const oldBody=await request(c,blocked); // names g0, BEFORE the supporting incident
  assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
  const g1=await accountGuard(c);assert.equal(g1.epoch,oldBody.accountEpoch+1);
  const seeded=await seedFencedSuccessor(c,blocked,{previousEpoch:oldBody.accountEpoch,successorEpoch:g1.epoch});
  const base=fencedDeps(c,seeded),seen=[];
  const deps={...base,successor:{...base.successor,receipt:async input=>{
    const result=await base.successor.receipt(input);seen.push(result);return result;}}};
  // Foreign account: real reservation and ledger.
  const foreignUid='synthetic-successor-foreign-'+randomUUID(),foreign=await c.store.bootstrap(foreignUid),foreignIdentity=accountIdentityKey(foreignUid);
  await ref(c.accountRoot,'accounts',foreign.account.id).update({credited:10,available:10});
  const foreignReservationId=randomUUID();await c.store.reserveVideo(foreignIdentity,foreignReservationId,3);
  const foreignReservationRef=ref(c.accountRoot,'videoReservations',hashJson([foreign.account.id,foreignReservationId]));
  const foreignReservationBefore=(await foreignReservationRef.get()).data();
  const foreignLedger=()=>c.accountRoot.collection('ledgerEntries').where('ownerAccountId','==',foreign.account.id).get()
    .then(page=>page.docs.map(doc=>[doc.ref.path,doc.data()]).sort((x,y)=>x[0]<y[0]?-1:1));
  const foreignLedgerBefore=await foreignLedger(),foreignBalanceBefore=await c.store.videoBalance(foreignIdentity);
  const ownerBefore=await c.store.videoBalance(c.identity);
  assert.deepEqual(ownerBefore,{unit:'video_seconds',credited:40,available:34,reserved:6,consumed:0,active:3});
  // (1) Fresh attempt names g0 while the live Account guard is g1: real fenced receipt returns pending; Account refuses the old generation.
  await assert.rejects(unblockBillingAccount(deps,c.account,oldBody,'operator-ana',9_300_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  assert.equal(seen[0]?.state,'pending','the REAL fenced receipt returned pending');
  assert.equal(seen[0].attemptId,seeded.previousAttemptId);assert.equal(seen[0].epoch,oldBody.accountEpoch);
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,0);
  assert.deepEqual(await c.store.videoBalance(c.identity),ownerBefore);
  // (2) Successor closes the incident; the supporting Account incident keeps both guards blocked.
  const retryBody={...oldBody,accountEpoch:g1.epoch,accountCreatedAtMs:g1.createdAtMs};
  const partial=await unblockBillingAccount(deps,c.account,retryBody,'operator-ana',9_300_001_000);
  assert.equal(partial.accountBlocked,true);assert.equal(partial.videoBlocked,true);
  assert.equal((await guardOf(c).get()).get('blocked'),true);
  const claims=await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get();
  assert.equal(claims.size,1);assert.equal(claims.docs[0].get('holdId'),blocked.hold,'the claim names the holdId');
  assert.equal(claims.docs[0].get('previousAttemptId'),seeded.previousAttemptId);
  assert.equal(claims.docs[0].get('attemptId'),seeded.successorAttemptId);
  assert.ok(claims.docs[0].createTime.isEqual(claims.docs[0].updateTime),'the claim is immutable');
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1);
  assert.deepEqual(await c.store.videoBalance(c.identity),ownerBefore,'no balance moved while Video remains blocked');
  assert.deepEqual(await c.store.videoBalance(foreignIdentity),foreignBalanceBefore);
  assert.deepEqual((await foreignReservationRef.get()).data(),foreignReservationBefore);
  assert.deepEqual(await foreignLedger(),foreignLedgerBefore);
  // (3) The other Account incident is reviewed; the partial close resumes and releases only the audited rows.
  const other=(await c.accountRoot.collection('videoBillingIncidents').get()).docs
    .find(doc=>doc.get('incidentId')!==blocked.hold&&doc.get('state')==='active');
  assert.ok(other,'the supporting incident exists');
  await reviewOtherAccountIncident(c,other.get('incidentId'));
  const released=await unblockBillingAccount(deps,c.account,retryBody,'operator-ana',9_300_002_000);
  assert.equal(released.replayed,false);assert.equal(released.accountBlocked,false);assert.equal(released.videoBlocked,false);
  assert.equal((await guardOf(c).get()).exists,false);
  const start=c.transport.bodies.length;
  await c.ai.drainExternalBilling();await c.ai.drainExternalBilling();
  for(const job of releases){
    assert.equal(c.transport.bodies.slice(start).filter(call=>call.pathname.endsWith('/release')&&call.pathname.includes(job.reservationId)).length,1);
    assert.equal((await c.store.videoReservation(c.identity,job.reservationId)).state,'released');
    assert.equal((await outbox(c,job.id).get()).get('state'),'settled');
  }
  assert.deepEqual(await c.store.videoBalance(c.identity),{unit:'video_seconds',credited:40,available:38,reserved:0,consumed:2,active:0});
  assert.deepEqual(await c.store.videoBalance(foreignIdentity),foreignBalanceBefore,'the other account balance is unchanged');
  assert.deepEqual((await foreignReservationRef.get()).data(),foreignReservationBefore);
  assert.deepEqual(await foreignLedger(),foreignLedgerBefore);
});

test('successor parallel: two recoverers create ONE claim and dispatch once',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_parallel'),c=blocked.c,oldBody=await request(c,blocked);
  assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
  const g1=await accountGuard(c);
  const seeded=await seedFencedSuccessor(c,blocked,{previousEpoch:oldBody.accountEpoch,successorEpoch:g1.epoch});
  const base=fencedDeps(c,seeded);
  await assert.rejects(unblockBillingAccount(base,c.account,oldBody,'operator-ana',9_310_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  const before=await c.store.videoBalance(c.identity);
  let arrived=0,release;const gate=new Promise(resolve=>{release=resolve;});
  let confirms=0;
  const racing={...base,successor:{...base.successor,
    async reconcile(input){if(++arrived===2)release();await gate;return base.successor.reconcile(input);},
    async confirm(input){confirms++;return base.successor.confirm(input);}}};
  const body={...oldBody,accountEpoch:g1.epoch,accountCreatedAtMs:g1.createdAtMs};
  const results=await Promise.allSettled([
    unblockBillingAccount(racing,c.account,body,'operator-ana',9_310_001_000),
    unblockBillingAccount(racing,c.account,body,'operator-ana',9_310_001_001),
  ]);
  assert.equal(arrived,2);assert.equal(confirms,1,'only the claim creator dispatched');
  assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,1);
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1);
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,1);
  assert.ok(results.filter(result=>result.status==='fulfilled').length>=1);
  for(const result of results.filter(result=>result.status==='rejected'))
    assert.ok(['unresolved','conflict'].includes(result.reason?.code),'the loser fails closed');
  assert.equal((await guardOf(c).get()).get('blocked'),true);
  assert.deepEqual(await c.store.videoBalance(c.identity),before);
});

test('successor lost reconcile ACK: same tuple, ONE claim and ONE send',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_lost_reconcile'),c=blocked.c,oldBody=await request(c,blocked);
  assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
  const g1=await accountGuard(c);
  const seeded=await seedFencedSuccessor(c,blocked,{previousEpoch:oldBody.accountEpoch,successorEpoch:g1.epoch});
  const base=fencedDeps(c,seeded);
  await assert.rejects(unblockBillingAccount(base,c.account,oldBody,'operator-ana',9_320_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  const before=await c.store.videoBalance(c.identity);
  let reconciles=0,confirms=0;
  const deps={...base,successor:{...base.successor,
    async reconcile(input){const answer=await base.successor.reconcile(input);
      if(++reconciles===1)throw Object.assign(new Error('synthetic lost reconcile reply'),{code:'unavailable'});
      return answer;},
    async confirm(input){confirms++;return base.successor.confirm(input);}}};
  const body={...oldBody,accountEpoch:g1.epoch,accountCreatedAtMs:g1.createdAtMs};
  await assert.rejects(unblockBillingAccount(deps,c.account,body,'operator-ana',9_320_001_000),
    error=>error instanceof UnblockFault&&error.code==='unresolved'&&error.stage==='account');
  assert.equal(confirms,0,'no send without an observed permitted answer');
  assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,0);
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,0);
  assert.deepEqual(await c.store.videoBalance(c.identity),before);
  const anchor=await seeded.anchor.get();assert.equal(anchor.get('successorAttemptId'),seeded.successorAttemptId,'Account fence is durable');
  const recovered=await unblockBillingAccount(deps,c.account,body,'operator-ana',9_320_002_000);
  assert.equal(reconciles,2);assert.equal(confirms,1);
  assert.equal(recovered.accountBlocked,true);assert.equal(recovered.videoBlocked,true);
  assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,1);
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1);
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,1);
  assert.deepEqual(await c.store.videoBalance(c.identity),before);
});

test('successor lost confirm ACK: recover the active receipt, never resend',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_lost_confirm'),c=blocked.c,oldBody=await request(c,blocked);
  assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
  const g1=await accountGuard(c);
  const seeded=await seedFencedSuccessor(c,blocked,{previousEpoch:oldBody.accountEpoch,successorEpoch:g1.epoch});
  const base=fencedDeps(c,seeded);
  await assert.rejects(unblockBillingAccount(base,c.account,oldBody,'operator-ana',9_330_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  const before=await c.store.videoBalance(c.identity);
  let confirms=0;
  const deps={...base,successor:{...base.successor,confirm:async input=>{
    const answer=await base.successor.confirm(input);
    if(input.attempt==='successor'&&++confirms===1)
      throw Object.assign(new Error('synthetic lost confirm reply'),{code:'unavailable'});
    return answer;}}};
  const body={...oldBody,accountEpoch:g1.epoch,accountCreatedAtMs:g1.createdAtMs};
  await assert.rejects(unblockBillingAccount(deps,c.account,body,'operator-ana',9_330_001_000),
    error=>error instanceof UnblockFault&&error.code==='unresolved');
  assert.equal(confirms,1,'one dispatch left Video');
  assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,1);
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1);
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,0);
  assert.deepEqual(await c.store.videoBalance(c.identity),before);
  const recovered=await unblockBillingAccount(deps,c.account,body,'operator-ana',9_330_002_000);
  assert.equal(confirms,1,'recovery never resends');
  assert.equal(recovered.accountBlocked,true);assert.equal(recovered.videoBlocked,true);
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,1);
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1);
  assert.deepEqual(await c.store.videoBalance(c.identity),before);
});

test('successor claim missing/tampered: the confirmed successor receipt cannot close',{timeout:240000},async()=>{
  for(const mode of ['missing','tampered']){
    const blocked=await blockedAccount('successor_claim_'+mode),c=blocked.c,oldBody=await request(c,blocked);
    assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
    const g1=await accountGuard(c);
    const seeded=await seedFencedSuccessor(c,blocked,{previousEpoch:oldBody.accountEpoch,successorEpoch:g1.epoch});
    const base=fencedDeps(c,seeded);
    await assert.rejects(unblockBillingAccount(base,c.account,oldBody,'operator-ana',9_340_000_000),
      error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
    const before=await c.store.videoBalance(c.identity);
    let confirms=0;
    const deps={...base,successor:{...base.successor,confirm:async input=>{
      const answer=await base.successor.confirm(input);
      if(input.attempt==='successor'&&++confirms===1)
        throw Object.assign(new Error('synthetic lost confirm reply'),{code:'unavailable'});
      return answer;}}};
    const body={...oldBody,accountEpoch:g1.epoch,accountCreatedAtMs:g1.createdAtMs};
    await assert.rejects(unblockBillingAccount(deps,c.account,body,'operator-ana',9_340_001_000));
    const claims=await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get();
    assert.equal(claims.size,1);
    if(mode==='missing')await claims.docs[0].ref.delete();
    else await claims.docs[0].ref.update({authorizationSha256:hashJson('tampered-authority')});
    const videoBefore=await signatures(c.root),accountBefore=await signatures(c.accountRoot);
    const doneBefore=(await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size;
    await assert.rejects(unblockBillingAccount(deps,c.account,body,'operator-ana',9_340_002_000),
      error=>error instanceof UnblockFault&&error.code==='conflict');
    assert.equal(confirms,1,'no second dispatch');
    assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,doneBefore);
    assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1);
    assert.equal((await guardOf(c).get()).get('blocked'),true);
    assert.deepEqual(await c.store.videoBalance(c.identity),before);
    assert.deepEqual(await signatures(c.root),videoBefore);
    assert.deepEqual(await signatures(c.accountRoot),accountBefore);
  }
});

test('successor invalid authority: missing cut/grant, wrong tuple and wrong identity write nothing',{timeout:240000},async()=>{
  { // cut absent
    const blocked=await blockedAccount('successor_no_cut'),c=blocked.c,body=await request(c,blocked);
    const seeded=await seedFencedSuccessor(c,blocked),deps=fencedDeps(c,seeded);
    await c.writerCut.delete();
    const videoBefore=await signatures(c.root),accountBefore=await signatures(c.accountRoot);
    await assert.rejects(unblockBillingAccount(deps,c.account,body,'operator-ana',9_350_000_000),
      error=>error instanceof UnblockFault&&error.code==='conflict');
    assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get()).size,0);
    assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,0);
    assert.deepEqual(await signatures(c.root),videoBefore);
    assert.deepEqual(await signatures(c.accountRoot),accountBefore);
  }
  { // grant absent, uncertain attempt
    const blocked=await blockedAccount('successor_no_grant'),c=blocked.c,body=await request(c,blocked);
    const seeded=await seedFencedSuccessor(c,blocked,{grant:false}),base=fencedDeps(c,seeded);
    let attempts=0;
    const lost={...base,successor:{...base.successor,confirm:async()=>{
      attempts++;throw Object.assign(new Error('lost before Account'),{code:'unavailable'});}}};
    await assert.rejects(unblockBillingAccount(lost,c.account,body,'operator-ana',9_350_100_000),
      error=>error instanceof UnblockFault&&error.code==='unresolved'&&error.stage==='account');
    assert.equal(attempts,1);
    const videoBefore=await signatures(c.root),accountBefore=await signatures(c.accountRoot);
    await assert.rejects(unblockBillingAccount(base,c.account,body,'operator-ana',9_350_101_000),
      error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
    assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,0);
    assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,0);
    assert.deepEqual(await signatures(c.root),videoBefore);
    assert.deepEqual(await signatures(c.accountRoot),accountBefore);
  }
  { // wrong tuple: grant does not name the presented successor epoch
    const blocked=await blockedAccount('successor_wrong_tuple'),c=blocked.c,body=await request(c,blocked);
    assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
    const g1=await accountGuard(c);
    const seeded=await seedFencedSuccessor(c,blocked,{previousEpoch:body.accountEpoch,successorEpoch:g1.epoch});
    const base=fencedDeps(c,seeded);
    const wrong={...base,successor:{...base.successor,
      attempt:{...base.successor.attempt,epoch:g1.epoch+5},
      reconcile:({identityKey,incidentId,reviewRef})=>c.store.reconcileVideoBillingUnblockAttempt(identityKey,{
        incidentId,attemptId:seeded.successorAttemptId,epoch:g1.epoch+5,createdAtMs:seeded.accountCreatedAtMs,
        reviewRef,authorizationSha256:seeded.authorizationSha256,previousAttemptId:seeded.previousAttemptId,
        previousEpoch:seeded.previousEpoch,reconcileId:seeded.reconcileId})}};
    const accountBefore=await signatures(c.accountRoot);
    await assert.rejects(unblockBillingAccount(wrong,c.account,body,'operator-ana',9_350_200_000),
      error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
    assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,0);
    assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,0);
    assert.deepEqual(await signatures(c.accountRoot),accountBefore);
  }
  { // wrong identity in the anchor: a REAL identity owned by a different account
    const blocked=await blockedAccount('successor_wrong_identity'),c=blocked.c,body=await request(c,blocked);
    const otherUid='synthetic-wrong-identity-'+randomUUID();
    const otherAccount=await c.store.bootstrap(otherUid),otherIdentity=accountIdentityKey(otherUid);
    assert.notEqual(otherIdentity,c.identity,'the anchor identity must differ from the request identity');
    assert.notEqual(otherAccount.account.id,c.accountOwner,'the anchor identity must belong to another account');
    const seeded=await seedFencedSuccessor(c,blocked,{identityKey:otherIdentity});
    const deps=fencedDeps(c,seeded),videoBefore=await signatures(c.root),accountBefore=await signatures(c.accountRoot);
    await assert.rejects(unblockBillingAccount(deps,c.account,body,'operator-ana',9_350_300_000),
      error=>error instanceof UnblockFault&&error.code==='conflict');
    assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,0);
    assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,0,
      'a wrong anchor identity must not write an Account unblock');
    assert.deepEqual(await signatures(c.root),videoBefore);
    assert.deepEqual(await signatures(c.accountRoot),accountBefore);
  }
});

test('successor partial resume uses the DONE accepted epoch and the original durable request for the claim',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_partial'),c=blocked.c,oldBody=await request(c,blocked);
  const other=await addAccountIncident(c),g1=await accountGuard(c);
  const seeded=await seedFencedSuccessor(c,blocked,{previousEpoch:oldBody.accountEpoch,successorEpoch:g1.epoch});
  const deps=fencedDeps(c,seeded);
  await assert.rejects(unblockBillingAccount(deps,c.account,oldBody,'operator-ana',9_360_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  const retryBody={...oldBody,accountEpoch:g1.epoch,accountCreatedAtMs:g1.createdAtMs};
  const partial=await unblockBillingAccount(deps,c.account,retryBody,'operator-ana',9_360_001_000);
  assert.equal(partial.accountBlocked,true);assert.equal(partial.videoBlocked,true);
  const claim=await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get();
  assert.equal(claim.size,1);
  const claimData=claim.docs[0].data(),claimVersion=stampNoPad(claim.docs[0],'updateTime');
  assert.equal(claimData.recordedAtMs,(await ref(c.root,UNBLOCK_AUDIT_COLLECTION,
    unblockAuditId(blocked.incident,'unblock_requested',blocked.guard.epoch,blocked.guard.createdAtMs)).get()).get('recordedAtMs'),
    'the claim carries the REQUEST time, not the done close time');
  // Resuming with the OLD body (g0) must compare the DONE epoch (g1) with the receipt (g1), not with the request.
  const replay=await unblockBillingAccount(deps,c.account,oldBody,'operator-ana',9_360_002_000);
  assert.equal(replay.replayed,true);assert.equal(replay.videoBlocked,true);
  assert.equal(stampNoPad(claim.docs[0],'updateTime'),claimVersion,'the claim is unchanged by the partial replay');
  await reviewOtherAccountIncident(c,other);
  const released=await unblockBillingAccount(deps,c.account,oldBody,'operator-ana',9_360_003_000);
  assert.equal(released.replayed,false);assert.equal(released.videoBlocked,false);
  assert.equal((await guardOf(c).get()).exists,false);
  assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,1,'the same claim, never a second');
});

async function seedEqualEpoch(c,blocked,body){
  const seeded=await seedFencedSuccessor(c,blocked,{previousEpoch:body.accountEpoch,successorEpoch:body.accountEpoch});
  const base=fencedDeps(c,seeded);
  let attempts=0;
  const lost={...base,successor:{...base.successor,confirm:async()=>{
    attempts++;throw Object.assign(new Error('lost before Account'),{code:'unavailable'});}}};
  await assert.rejects(unblockBillingAccount(lost,c.account,body,'operator-ana',9_370_000_000),
    error=>error instanceof UnblockFault&&error.code==='unresolved'&&error.stage==='account');
  assert.equal(attempts,1);
  return {seeded,base};
}

test('successor race order A: previous confirms between receipt and reconcile; close by receipt, no claim/send',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_race_previous'),c=blocked.c,body=await request(c,blocked);
  const {seeded,base}=await seedEqualEpoch(c,blocked,body);
  const before=await c.store.videoBalance(c.identity);
  let pendingSeenResolve,previousCommittedResolve;
  const pendingSeen=new Promise(r=>pendingSeenResolve=r),previousCommitted=new Promise(r=>previousCommittedResolve=r);
  let confirms=0;
  const deps={...base,successor:{...base.successor,
    async receipt(input){const result=await base.successor.receipt(input);
      if(result.state==='pending'){pendingSeenResolve();await previousCommitted;}return result;},
    async confirm(input){confirms++;return base.successor.confirm(input);}}};
  const call=unblockBillingAccount(deps,c.account,body,'operator-ana',9_370_100_000);
  await pendingSeen;
  const previous=await c.store.confirmFencedVideoBillingUnblockAttempt(c.identity,{
    incidentId:seeded.incidentId,attemptId:seeded.previousAttemptId,epoch:seeded.previousEpoch,
    createdAtMs:seeded.accountCreatedAtMs,reviewRef:seeded.reviewRef,authorizationSha256:seeded.authorizationSha256});
  assert.equal(previous.state,'confirmed');assert.equal(previous.replayed,false);
  previousCommittedResolve();
  const result=await call;
  assert.equal(result.videoBlocked,false);assert.equal(result.accountBlocked,false);
  assert.equal(confirms,0,'no successor dispatch');
  assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,0,'no claim');
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1,'ONE receipt');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,1);
  assert.deepEqual(await c.store.videoBalance(c.identity),before);
});

test('successor race order B: reconcile fences first; previous is refused and the successor dispatches once',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_race_successor'),c=blocked.c,body=await request(c,blocked);
  const {seeded,base}=await seedEqualEpoch(c,blocked,body);
  const before=await c.store.videoBalance(c.identity);
  let permittedResolve,externalTriedResolve;
  const permitted=new Promise(r=>permittedResolve=r),externalTried=new Promise(r=>externalTriedResolve=r);
  let confirms=0,externalError=null;
  const deps={...base,successor:{...base.successor,
    async reconcile(input){const decision=await base.successor.reconcile(input);
      assert.equal(decision.state,'permitted');permittedResolve();await externalTried;return decision;},
    async confirm(input){confirms++;return base.successor.confirm(input);}}};
  const call=unblockBillingAccount(deps,c.account,body,'operator-ana',9_370_200_000);
  await permitted;
  try{
    await c.store.confirmFencedVideoBillingUnblockAttempt(c.identity,{
      incidentId:seeded.incidentId,attemptId:seeded.previousAttemptId,epoch:seeded.previousEpoch,
      createdAtMs:seeded.accountCreatedAtMs,reviewRef:seeded.reviewRef,authorizationSha256:seeded.authorizationSha256});
    assert.fail('the previous attempt must be refused after the fence');
  }catch(error){externalError=error;}
  externalTriedResolve();
  const result=await call;
  assert.equal(externalError?.code,'conflict');
  assert.equal(confirms,1,'only the successor dispatched');
  assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,1);
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1);
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,1);
  assert.equal(result.videoBlocked,false);
  assert.deepEqual(await c.store.videoBalance(c.identity),before);
});

test('successor environment gate: non-emulator settings and a forged attestation write nothing',{timeout:60000},async()=>{
  const fake={_settings:{projectId:'real-project',servicePath:'firestore.googleapis.com',port:443,ssl:true,preferRest:false}};
  assert.throws(()=>attestLocalEmulatorPair(fake,fake),error=>error instanceof UnblockFault&&error.code==='invalid');
  const blocked=await blockedAccount('successor_forged_attestation'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked),base=fencedDeps(c,seeded);
  assert.ok(base.successor.attestation,'the real local pair is attested');
  const forged={...base,successor:{...base.successor,attestation:{kind:'lv019b-local-emulator-pair'}}};
  const videoBefore=await signatures(c.root),accountBefore=await signatures(c.accountRoot);
  await assert.rejects(unblockBillingAccount(forged,c.account,body,'operator-ana',9_380_000_000),
    error=>error instanceof UnblockFault&&error.code==='invalid');
  assert.deepEqual(await signatures(c.root),videoBefore);
  assert.deepEqual(await signatures(c.accountRoot),accountBefore);
});

test('successor pending is not permission: no grant path never dispatches',{timeout:120000},async()=>{
  const blocked=await blockedAccount('successor_pending_only'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked,{grant:false}),base=fencedDeps(c,seeded);
  let confirms=0;
  const lost={...base,successor:{...base.successor,confirm:async()=>{
    confirms++;throw Object.assign(new Error('lost before Account'),{code:'unavailable'});}}};
  await assert.rejects(unblockBillingAccount(lost,c.account,body,'operator-ana',9_390_000_000),
    error=>error instanceof UnblockFault&&error.code==='unresolved'&&error.stage==='account');
  const before=await c.store.videoBalance(c.identity);
  await assert.rejects(unblockBillingAccount(base,c.account,body,'operator-ana',9_390_001_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  assert.equal(confirms,1,'only the first, uncertain dispatch was attempted');
  assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,0);
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,0);
  assert.deepEqual(await c.store.videoBalance(c.identity),before);
});

test('guard corruption: an invalid reviewedCount fails the fenced receipt before pending and writes nothing',{timeout:120000},async()=>{
  const blocked=await blockedAccount('fenced_corrupt_reviewed_count'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const guardRef=ref(c.accountRoot,'videoBillingGuards',c.accountOwner);
  await guardRef.update({reviewedCount:-1});
  const input={incidentId:blocked.hold,attemptId:seeded.previousAttemptId,
    epoch:seeded.previousEpoch,createdAtMs:seeded.accountCreatedAtMs,reviewRef:body.evidenceRef,
    authorizationSha256:seeded.authorizationSha256};
  let receiptRejected=false,receiptError,receiptValue;
  try{receiptValue=await c.store.fencedVideoBillingUnblockReceipt(c.identity,input);}
  catch(error){receiptRejected=true;receiptError=error;}
  console.log(receiptRejected
    ?'DIAG fenced receipt rejected: '+JSON.stringify({name:receiptError?.name??null,
      constructor:receiptError?.constructor?.name??null,code:receiptError?.code??null,
      isAccountFault:receiptError instanceof AccountFault})
    :'DIAG fenced receipt RESOLVED without error: state='+String(receiptValue?.state??null));
  assert.equal(receiptRejected,true,'a corrupt reviewedCount must not be masked by pending');
  assert.ok(receiptError instanceof AccountFault,
    'the refusal must be an AccountFault, saw '+(receiptError?.constructor?.name??String(receiptError)));
  assert.ok(receiptError.code==='invariant'||receiptError.code==='conflict',
    'the AccountFault code must be invariant or conflict, saw '+String(receiptError.code));
  const fenced=fencedDeps(c,seeded);
  const videoBefore=await signatures(c.root),accountBefore=await signatures(c.accountRoot);
  await assert.rejects(unblockBillingAccount(fenced,c.account,body,'operator-ana',9_400_000_000),
    error=>error instanceof UnblockFault&&(error.code==='unresolved'||error.code==='corrupt'||error.code==='conflict'));
  assert.deepEqual(await signatures(c.root),videoBefore,'no Video write on a corrupt guard');
  assert.deepEqual(await signatures(c.accountRoot),accountBefore,'no Account write on a corrupt guard');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get()).size,0);
  assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,0);
});

test('successor partial resume derives the claim from the durable request, not from the done close',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_partial_request'),c=blocked.c;
  const oldBody=await request(c,blocked);
  const support=accountHoldId('outbox',randomUUID(),1,1);
  assert.equal((await c.accountBilling.block(c.identity,support)).created,true);
  const g1=await accountGuard(c);
  const failing={db:c.db,root:c.root,accountBilling:{
    unblock:async()=>{throw Object.assign(new Error('synthetic delivery failure'),{code:'unavailable'});},
    unblockReceipt:async()=>({state:'pending'})}};
  await assert.rejects(unblockBillingAccount(failing,c.account,oldBody,'operator-ana',9_600_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  const requestedRef=ref(c.root,UNBLOCK_AUDIT_COLLECTION,
    unblockAuditId(blocked.incident,'unblock_requested',blocked.guard.epoch,blocked.guard.createdAtMs));
  const requested=await requestedRef.get(),requestRecordedAt=requested.get('recordedAtMs');
  const seeded=await seedFencedSuccessor(c,blocked,{previousEpoch:oldBody.accountEpoch,successorEpoch:g1.epoch});
  const deps=fencedDeps(c,seeded);
  const partial=await unblockBillingAccount(deps,c.account,oldBody,'operator-ana',9_600_001_000);
  assert.equal(partial.accountBlocked,true);assert.equal(partial.videoBlocked,true);
  const claims=await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get();
  assert.equal(claims.size,1);
  const claim=claims.docs[0],claimData=claim.data(),claimVersion=stampNoPad(claim,'updateTime');
  assert.equal(claimData.requestId,requested.id);
  assert.equal(claimData.recordedAtMs,requestRecordedAt,'the claim carries the REQUEST time, not the done close time');
  const doneRecord=await ref(c.root,UNBLOCK_AUDIT_COLLECTION,
    unblockAuditId(blocked.incident,'unblocked',blocked.guard.epoch,blocked.guard.createdAtMs)).get();
  assert.notEqual(claimData.recordedAtMs,doneRecord.get('recordedAtMs'));
  const replay=await unblockBillingAccount(deps,c.account,oldBody,'operator-ana',9_600_002_000);
  assert.equal(replay.replayed,true);assert.equal(replay.videoBlocked,true);
  assert.equal(stampNoPad(claims.docs[0],'updateTime'),claimVersion,'the claim is untouched by the replay');
  const supportReview=await c.accountBilling.unblock(c.identity,{incidentId:support,...await accountGuard(c),reviewRef:'synthetic review of the supporting hold'});
  assert.equal(supportReview.blocked,false);
  const released=await unblockBillingAccount(deps,c.account,oldBody,'operator-ana',9_600_003_000);
  assert.equal(released.replayed,false);assert.equal(released.videoBlocked,false);
  assert.equal((await guardOf(c).get()).exists,false);
  assert.equal((await c.root.collection(UNBLOCK_SUCCESSOR_COLLECTION).get()).size,1,'the same claim, never a second');
});

test('successor stale Account clear: a newer incident between receipt and release keeps the Video guard',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_stale_clear'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);
  let confirms=0;
  const lossy={...base,successor:{...base.successor,confirm:async input=>{
    const value=await base.successor.confirm(input);
    if(input.attempt==='previous'&&++confirms===1)
      throw Object.assign(new Error('lost ACK after Account commit'),{code:'unavailable'});
    return value;}}};
  await assert.rejects(unblockBillingAccount(lossy,c.account,body,'operator-ana',9_500_000_000),
    error=>error instanceof UnblockFault&&error.code==='unresolved');
  assert.equal(confirms,1,'the first confirmation committed in Account');
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,1);
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Video lost the ACK and stays blocked');
  const before=await c.store.videoBalance(c.identity);
  let receiptCalls=0;
  const stale={...base,successor:{...base.successor,async receipt(input){
    const value=await base.successor.receipt(input);receiptCalls++;
    if(value.state==='confirmed'&&receiptCalls===1){
      // A NEW Account incident lands after the snapshot said blocked:false.
      assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
    }
    return value;
  }}};
  const result=await unblockBillingAccount(stale,c.account,body,'operator-ana',9_500_001_000);
  assert.equal(receiptCalls,2,'one snapshot and one pre-release revalidation');
  assert.equal(result.videoBlocked,true,'the stale clear never releases Video');
  assert.equal(result.accountBlocked,true);
  assert.equal((await guardOf(c).get()).get('blocked'),true,'the Video guard survives');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','video_released').get()).size,0);
  const done=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get();
  assert.equal(done.size,1);assert.equal(done.docs[0].get('videoBlocked'),true);
  assert.deepEqual(await c.store.videoBalance(c.identity),before,'no balance moved');
});

test('successor: an incident AFTER the last receipt and BEFORE the release keeps the Video guard',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_post_read_clear'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);
  let receiptCalls=0,confirms=0;
  const stale={...base,successor:{...base.successor,
    async receipt(input){
      const value=await base.successor.receipt(input);receiptCalls++;
      if(receiptCalls===2)
        assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
      return value;
    },
    async confirm(input){confirms++;return base.successor.confirm(input);}}};
  const before=await c.store.videoBalance(c.identity);
  const result=await unblockBillingAccount(stale,c.account,body,'operator-ana',9_500_002_000);
  assert.equal(receiptCalls,2,'one snapshot and one pre-release revalidation');
  assert.equal(confirms,1,'exactly one confirm is sent');
  assert.equal(result.videoBlocked,true,'the post-read incident never releases Video');
  assert.equal(result.accountBlocked,true,'the result must not claim the account is clear');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'the Video guard survives');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','video_released').get()).size,0);
  const done=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get();
  assert.equal(done.size,1);
  assert.equal(done.docs[0].get('videoBlocked'),true);
  assert.equal(done.docs[0].get('accountBlocked'),true,'the audit is coherent');
  assert.deepEqual(await c.store.videoBalance(c.identity),before,'no balance moved');
});

async function rootSignature(root,names){
  const out={};
  for(const name of names){
    const snap=await root.collection(name).get();
    out[name]=snap.docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  }
  return out;
}
const VIDEO_ROOT_COLLECTIONS=['billingGuards',UNBLOCK_AUDIT_COLLECTION,'billingReleaseReopenings'];
const ACCOUNT_ROOT_COLLECTIONS=['videoBillingGuards','videoBillingIncidents','videoBillingUnblocks','identities','videoBillingUnblockAttempts','videoBillingUnblockReconciliationGrants'];

test('successor partial replay: a real partial closure, rival review, then a post-read incident keeps Video closed',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_partial_post_read'),c=blocked.c;
  const rivalIncidentId=await addAccountIncident(c);
  const body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);

  const first=await unblockBillingAccount(base,c.account,body,'operator-ana',9_500_003_000);
  assert.equal(first.videoBlocked,true,'partial: Video stays closed while the rival is active');
  assert.equal(first.accountBlocked,true,'the first confirmation uses the live generation');
  const doneSnap=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get();
  assert.equal(doneSnap.size,1);
  const doneBefore=doneSnap.docs[0].data();
  assert.equal(doneBefore.videoBlocked,true);
  assert.equal(doneBefore.accountBlocked,true);
  assert.equal((await guardOf(c).get()).get('blocked'),true,'the Video guard survives the partial closure');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','video_released').get()).size,0);

  await reviewOtherAccountIncident(c,rivalIncidentId);

  let receiptCalls=0;
  const stale={...base,successor:{...base.successor,async receipt(input){
    const value=await base.successor.receipt(input);receiptCalls++;
    if(receiptCalls===2)
      assert.equal((await c.accountBilling.block(c.identity,accountHoldId('outbox',randomUUID(),1,1))).created,true);
    return value;
  }}};
  const before=await c.store.videoBalance(c.identity);
  const result=await unblockBillingAccount(stale,c.account,body,'operator-ana',9_500_003_500);
  assert.equal(receiptCalls,2,'one snapshot and one pre-release revalidation');
  assert.equal(result.replayed,true);
  assert.equal(result.videoBlocked,true,'the post-read incident never releases Video on replay');
  assert.equal(result.accountBlocked,true,'the result must not claim the account is clear');
  assert.equal((await guardOf(c).get()).get('blocked'),true);
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','video_released').get()).size,0);
  const doneAfterSnap=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get();
  assert.equal(doneAfterSnap.size,1);
  assert.deepEqual(doneAfterSnap.docs[0].data(),doneBefore,'the historical done is never mutated on replay');
  assert.deepEqual(await c.store.videoBalance(c.identity),before,'no balance moved');
});

test('successor: a lost ACK alone creates no done',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_lost_ack_only'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);
  let confirms=0;
  const lossy={...base,successor:{...base.successor,confirm:async input=>{
    const value=await base.successor.confirm(input);
    if(input.attempt==='previous'&&++confirms===1)
      throw Object.assign(new Error('lost ACK after Account commit'),{code:'unavailable'});
    return value;}}};
  await assert.rejects(unblockBillingAccount(lossy,c.account,body,'operator-ana',9_500_009_000),
    error=>error instanceof UnblockFault&&error.code==='unresolved');
  assert.equal(confirms,1,'the first confirmation committed in Account');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,0,'no done from a lost ACK alone');
  assert.equal((await guardOf(c).get()).get('blocked'),true);
});

test('successor: a mutated Account identity rejects without writes',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_wrong_identity'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);
  await c.accountRoot.collection('identities').doc(c.identity).update({uid:'uid-of-another-account'});
  const videoBefore=await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS);
  const accountBefore=await rootSignature(c.accountRoot,ACCOUNT_ROOT_COLLECTIONS);
    const allVideoBefore=await signatures(c.root),allAccountBefore=await signatures(c.accountRoot);
  await assert.rejects(unblockBillingAccount(base,c.account,body,'operator-ana',9_500_004_000),
    error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.deepEqual(await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS),videoBefore,'no Video write');
  assert.deepEqual(await rootSignature(c.accountRoot,ACCOUNT_ROOT_COLLECTIONS),accountBefore,'no Account write');
    assert.deepEqual(await signatures(c.root),allVideoBefore,'no Video root writes');
    assert.deepEqual(await signatures(c.accountRoot),allAccountBefore,'no Account root writes');
  assert.equal((await guardOf(c).get()).get('blocked'),true);
});

test('successor: an empty or oversized Video uid rejects without writes',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_bad_uid'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);
  const videoIdentity=(await c.root.collection('identities').where('accountId','==',c.account).limit(2).get()).docs[0];
  for(const badUid of ['','x'.repeat(129)]){
    await videoIdentity.ref.update({uid:badUid});
    const videoBefore=await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS);
    const accountBefore=await rootSignature(c.accountRoot,ACCOUNT_ROOT_COLLECTIONS);
    const allVideoBefore=await signatures(c.root),allAccountBefore=await signatures(c.accountRoot);
    await assert.rejects(unblockBillingAccount(base,c.account,body,'operator-ana',9_500_004_500),
      error=>error instanceof UnblockFault&&error.code==='conflict');
    assert.deepEqual(await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS),videoBefore,'no Video write');
    assert.deepEqual(await rootSignature(c.accountRoot,ACCOUNT_ROOT_COLLECTIONS),accountBefore,'no Account write');
    assert.deepEqual(await signatures(c.root),allVideoBefore,'no Video root writes');
    assert.deepEqual(await signatures(c.accountRoot),allAccountBefore,'no Account root writes');
  }
});

test('successor: a substituted Account root rejects without writes',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_wrong_root'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);
  const wrong={...base,localAccountRoot:c.root};
  const videoBefore=await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS);
  const accountBefore=await rootSignature(c.accountRoot,ACCOUNT_ROOT_COLLECTIONS);
    const allVideoBefore=await signatures(c.root),allAccountBefore=await signatures(c.accountRoot);
  await assert.rejects(unblockBillingAccount(wrong,c.account,body,'operator-ana',9_500_005_000),
    error=>error instanceof UnblockFault&&error.code==='invalid');
  assert.deepEqual(await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS),videoBefore,'no Video write');
  assert.deepEqual(await rootSignature(c.accountRoot,ACCOUNT_ROOT_COLLECTIONS),accountBefore,'no Account write');
    assert.deepEqual(await signatures(c.root),allVideoBefore,'no Video root writes');
    assert.deepEqual(await signatures(c.accountRoot),allAccountBefore,'no Account root writes');
  assert.equal((await guardOf(c).get()).get('blocked'),true);
});

test('successor: a missing accredited root fails closed before any write',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_unaccredited'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const {localAccountRoot,...unaccredited}=fencedDeps(c,seeded);
  const videoBefore=await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS);
  const accountBefore=await rootSignature(c.accountRoot,ACCOUNT_ROOT_COLLECTIONS);
    const allVideoBefore=await signatures(c.root),allAccountBefore=await signatures(c.accountRoot);
  await assert.rejects(unblockBillingAccount(unaccredited,c.account,body,'operator-ana',9_500_006_000),
    error=>error instanceof UnblockFault&&error.code==='unresolved');
  assert.deepEqual(await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS),videoBefore,'no Video write');
  assert.deepEqual(await rootSignature(c.accountRoot,ACCOUNT_ROOT_COLLECTIONS),accountBefore,'no Account write');
    assert.deepEqual(await signatures(c.root),allVideoBefore,'no Video root writes');
    assert.deepEqual(await signatures(c.accountRoot),allAccountBefore,'no Account root writes');
  assert.equal((await guardOf(c).get()).get('blocked'),true);
});

test('successor: an unblock of account A writes nothing to account B in the same AccountStore and B keeps operating',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_isolation_a'),c=blocked.c;
  const uidOtro='synthetic-other-uid';
  const boot=await c.store.bootstrap(uidOtro);
  const accountIdOtro=boot.account.id;
  const identityKeyOtro=accountIdentityKey(uidOtro);
  await ref(c.accountRoot,'accounts',accountIdOtro).update({credited:120,available:120});

  const reservationOtro=await c.store.reserveVideo(identityKeyOtro,randomUUID(),60);
  assert.ok(reservationOtro,'B reserves 60s before A acts');

  const bBalanceBefore=await c.store.videoBalance(identityKeyOtro);
  const bReservationsBefore=(await c.accountRoot.collection('videoReservations').where('ownerAccountId','==',accountIdOtro).get())
    .docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  const bLedgerBefore=(await c.accountRoot.collection('ledgerEntries').where('ownerAccountId','==',accountIdOtro).get())
    .docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  assert.ok(bReservationsBefore.length>=1,'B has its reservation');
  assert.ok(bLedgerBefore.length>=1,'B has its ledger entry');

  const aSeeded=await seedFencedSuccessor(c,blocked),aBase=fencedDeps(c,aSeeded);
  const aBody=await request(c,blocked);
  const aResult=await unblockBillingAccount(aBase,c.account,aBody,'operator-ana',9_500_007_000);
  assert.equal(aResult.videoBlocked,false,'account A releases normally');

  assert.deepEqual(await c.store.videoBalance(identityKeyOtro),bBalanceBefore,'B balance untouched by A');
  assert.deepEqual((await c.accountRoot.collection('videoReservations').where('ownerAccountId','==',accountIdOtro).get())
    .docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),bReservationsBefore,'B reservations untouched by A');
  assert.deepEqual((await c.accountRoot.collection('ledgerEntries').where('ownerAccountId','==',accountIdOtro).get())
    .docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),bLedgerBefore,'B ledger untouched by A');

  const reservationOtro2=await c.store.reserveVideo(identityKeyOtro,randomUUID(),30);
  assert.ok(reservationOtro2,'B can create another 30s reservation after A was processed');
});

test('successor: swapping identity A to account B after the last receipt rejects, keeps Video blocked and leaves B untouched',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_account_swap'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);

  // B lives in the SAME AccountStore.
  const uidOtro='synthetic-swap-other-uid';
  const boot=await c.store.bootstrap(uidOtro);
  const accountIdOtro=boot.account.id;
  await ref(c.accountRoot,'accounts',accountIdOtro).update({credited:120,available:120});
  const identityKeyOtro=accountIdentityKey(uidOtro);
  const reservationOtro=await c.store.reserveVideo(identityKeyOtro,randomUUID(),60);
  assert.ok(reservationOtro,'B reserves 60s before the sabotage');

  const bBalanceBefore=await c.store.videoBalance(identityKeyOtro);
  const bReservationsBefore=(await c.accountRoot.collection('videoReservations').where('ownerAccountId','==',accountIdOtro).get())
    .docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  const bLedgerBefore=(await c.accountRoot.collection('ledgerEntries').where('ownerAccountId','==',accountIdOtro).get())
    .docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);

  let receiptCalls=0,confirms=0,videoAtSabotage=null;
  const swap={...base,successor:{...base.successor,
    async receipt(input){
      const value=await base.successor.receipt(input);receiptCalls++;
      if(receiptCalls===2){
        // Baseline at the sabotage point: the Phase 0 audit/dispatch writes and the Account confirmation already
        // happened BEFORE this read, so they belong to the legitimate prior state, not to the release.
        videoAtSabotage=await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS);
        // Sabotage AFTER the last receipt and BEFORE the Video transaction: point identity A at account B, keeping A's uid.
        await c.accountRoot.collection('identities').doc(c.identity).update({accountId:accountIdOtro});
      }
      return value;
    },
    async confirm(input){confirms++;return base.successor.confirm(input);}}};

  // Mutations of A that already happened BEFORE the sabotage (documented, not asserted as unchanged):
  //   - Phase 0 may have created the `unblock_requested` audit and continuity rows;
  //   - the Account receipt/confirm path may have advanced Account A's incident/guard bookkeeping.
  // Only the outcome AFTER the sabotage is asserted.
  const videoGuardBefore=await guardOf(c).get();

  await assert.rejects(unblockBillingAccount(swap,c.account,body,'operator-ana',9_500_010_000),
    error=>error instanceof UnblockFault&&error.code==='conflict');

  assert.ok(videoAtSabotage,'the sabotage ran during the pre-release revalidation');
  assert.equal(receiptCalls,2,'one snapshot and one pre-release revalidation');
  assert.equal(confirms,1,'no second confirm is sent');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Video A stays blocked');
  assert.equal((await guardOf(c).get()).get('blocked'),videoGuardBefore.get('blocked'));
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','video_released').get()).size,0,'no release');
  assert.deepEqual(await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS),videoAtSabotage,'no Video write after the sabotage');

  assert.deepEqual(await c.store.videoBalance(identityKeyOtro),bBalanceBefore,'B balance untouched');
  assert.deepEqual((await c.accountRoot.collection('videoReservations').where('ownerAccountId','==',accountIdOtro).get())
    .docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),bReservationsBefore,'B reservations untouched');
  assert.deepEqual((await c.accountRoot.collection('ledgerEntries').where('ownerAccountId','==',accountIdOtro).get())
    .docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),bLedgerBefore,'B ledger untouched');
});

test('successor: an identity already pointing at another account rejects before any write',{timeout:180000},async()=>{
  const blocked=await blockedAccount('successor_pre_swap'),c=blocked.c,body=await request(c,blocked);
  const seeded=await seedFencedSuccessor(c,blocked);
  const base=fencedDeps(c,seeded);
  const uidOtro='synthetic-pre-swap-other-uid';
  const boot=await c.store.bootstrap(uidOtro);
  await ref(c.accountRoot,'accounts',boot.account.id).update({credited:120,available:120});
  // Alter identity A BEFORE the call: it now points at account B while keeping A's uid.
  await c.accountRoot.collection('identities').doc(c.identity).update({accountId:boot.account.id});
  const videoBefore=await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS);
  const accountBefore=await rootSignature(c.accountRoot,ACCOUNT_ROOT_COLLECTIONS);
  await assert.rejects(unblockBillingAccount(base,c.account,body,'operator-ana',9_500_011_000),
    error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.deepEqual(await rootSignature(c.root,VIDEO_ROOT_COLLECTIONS),videoBefore,'no Video write');
  assert.deepEqual(await rootSignature(c.accountRoot,ACCOUNT_ROOT_COLLECTIONS),accountBefore,'no Account write');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Video stays blocked');
});
