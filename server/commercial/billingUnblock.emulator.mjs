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
import {AccountStore} from '../account/backend.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {ALERT_COLLECTION,alertKey,raisePendingAlerts} from './billingPendingAlerts.ts';
import {readPendingReport} from './billingPendingReport.ts';
import {acquireDrainLease,DRAIN_LEASE_COLLECTION,DRAIN_LEASE_DOC_ID} from './billingDrainLease.ts';
import {blockedState,unblockBillingAccount,UnblockFault,UNBLOCK_AUDIT_COLLECTION,UNBLOCK_CONTINUITY_COLLECTION,UNBLOCK_WRITER_CUT_ID,unblockAuditId} from './billingUnblock.ts';
import {accountHoldId} from './billingHoldIdentity.ts';

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
  bodies=[];
  constructor(store){this.store=store;}
  async request(request){
    const pathname=new URL(request.url).pathname,body=request.data??{};this.bodies.push({pathname,data:copy(body)});
    const parts=pathname.split('/'),reservationId=parts.at(-2);
    const httpFault=(status,code)=>Object.assign(Error('Synthetic Account refusal'),{response:{status,data:{error:code}}});
    const guard=async action=>{try{return {data:await action()};}catch(error){if(error?.response)throw error;throw httpFault(accountStatus[error?.code]??503,error?.code??'invariant');}};
    if(pathname==='/api/internal/video/billing-holds/unblock')return guard(()=>this.store.unblockVideoBilling(body.identityKey,{incidentId:body.incidentId,epoch:body.epoch,createdAtMs:body.createdAtMs,reviewRef:body.reviewRef}));
    if(pathname==='/api/internal/video/billing-holds/unblock-receipt')return guard(()=>this.store.videoBillingUnblockReceipt(body.identityKey,body.incidentId,body.reviewRef));
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
test('11 resume: an audited request only resumes on the SAME guard generation, operator and payload',{timeout:90000},async()=>{
  const blocked=await blockedAccount('unblock_resume_drift'),c=blocked.c,requestBody=await request(c,blocked);let calls=0;
  const fail=async()=>{calls++;throw Object.assign(new Error('synthetic'),{code:'unavailable'});};
  const failing={db:c.db,root:c.root,accountBilling:{unblock:fail,unblockReceipt:fail}};
  await assert.rejects(unblockBillingAccount(failing,c.account,requestBody,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  assert.equal(calls,1);const before=withoutGuard(c,await signatures(c.root));
  for(const [name,body,who] of [['another operator',requestBody,'operator-bob'],['another evidence',{...requestBody,evidenceRef:'ticket-other'},'operator-ana'],['another note',{...requestBody,note:'another note'},'operator-ana']])
    await assert.rejects(unblockBillingAccount(failing,c.account,body,who,9_000_001_000),error=>error instanceof UnblockFault&&error.code==='conflict',name);
  const original=(await guardOf(c).get()).data();
  await guardOf(c).delete();
  await assert.rejects(unblockBillingAccount(failing,c.account,requestBody,'operator-ana',9_000_002_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  await guardOf(c).set(original);
  for(const [name,change] of [['epoch',{epoch:original.epoch+1}],['createdAtMs',{createdAtMs:original.createdAtMs+1}],['incident',{lastOutboxIncidentId:sha('another incident')}],['account',{accountId:randomUUID()}]]){
    await guardOf(c).update(change);
    await assert.rejects(unblockBillingAccount(failing,c.account,requestBody,'operator-ana',9_000_002_000),error=>error instanceof UnblockFault&&error.code==='conflict',name);
    await guardOf(c).set(original);
  }
  assert.equal(calls,1,'a refused repeat never reaches Account');assert.deepEqual(withoutGuard(c,await signatures(c.root)),before,'a refused repeat writes nothing');
  const resumed=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_003_000);
  assert.equal(resumed.videoBlocked,false);assert.equal((await guardOf(c).get()).exists,false);
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
test('11 the completion records name the Account generation that the confirmed call actually used, not only the first attempt',{timeout:60000},async()=>{
  const blocked=await blockedAccount('unblock_account_generation_trace'),c=blocked.c,requestBody=await request(c,blocked);
  const failing={db:c.db,root:c.root,accountBilling:{unblock:async()=>{throw Object.assign(new Error('synthetic'),{code:'unavailable'});}}};
  const first={...requestBody,accountEpoch:requestBody.accountEpoch+7,accountCreatedAtMs:requestBody.accountCreatedAtMs+7};
  await assert.rejects(unblockBillingAccount(failing,c.account,first,'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict');
  const requested=await ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblock_requested',blocked.guard.epoch,blocked.guard.createdAtMs)).get();
  assert.equal(requested.get('accountEpoch'),first.accountEpoch,'the first attempt is recorded as the operator supplied it');
  const done=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_001_000);
  assert.equal(done.videoBlocked,false);
  const record=await ref(c.root,UNBLOCK_AUDIT_COLLECTION,unblockAuditId(blocked.incident,'unblocked',blocked.guard.epoch,blocked.guard.createdAtMs)).get();
  assert.equal(record.get('accountEpoch'),requestBody.accountEpoch,'the completion record carries the Account epoch the confirmed call used');
  assert.equal(record.get('accountCreatedAtMs'),requestBody.accountCreatedAtMs);
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
test('the rows of the account are read through the transaction in phase 0 and in phase 3, never outside it',{timeout:60000},async()=>{
  const blocked=await blockedAccount('unblock_tx_reads'),c=blocked.c,requestBody=await request(c,blocked);
  const originalRun=c.db.runTransaction.bind(c.db);let queryReads=0;
  c.db.runTransaction=(fn,...rest)=>originalRun(tx=>fn(new Proxy(tx,{get(target,prop){
    const value=Reflect.get(target,prop);
    if(typeof value!=='function')return value;
    if(prop==='get')return (arg,...more)=>{if(arg&&typeof arg.where==='function')queryReads++;return value.call(target,arg,...more);};
    return value.bind(target);
  }})),...rest);
  const result=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_000);
  c.db.runTransaction=originalRun;
  assert.equal(result.videoBlocked,false);
  assert.equal(queryReads,12,'six collections in phase 0 and six in phase 3, all through the transaction');
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
test('12 a stale epoch or createdAtMs is refused and the current generation applies',{timeout:40000},async()=>{
  const blocked=await blockedAccount('unblock_stale'),c=blocked.c,requestBody=await request(c,blocked);
  // Epoch 0 is not a generation at all: it is rejected by validation (`invalid`) before anything is read or written.
  await assert.rejects(unblockBillingAccount(deps(c),c.account,{...requestBody,epoch:0},'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&(error.code==='invalid'||error.code==='conflict'),'epoch 0 is not a generation');
  const changes=[{epoch:requestBody.epoch+1},...(requestBody.epoch>1?[{epoch:requestBody.epoch-1}]:[]),{createdAtMs:requestBody.createdAtMs+1},{createdAtMs:requestBody.createdAtMs-1},{updatedAtMs:requestBody.updatedAtMs+1},{updatedAtMs:requestBody.updatedAtMs-1},{accountEpoch:requestBody.accountEpoch+1},{accountCreatedAtMs:requestBody.accountCreatedAtMs+1}];
  for(const change of changes){
    await assert.rejects(unblockBillingAccount(deps(c),c.account,{...requestBody,...change},'operator-ana',9_000_000_000),error=>error instanceof UnblockFault&&error.code==='conflict',JSON.stringify(change));
  }
  assert.equal((await guardOf(c).get()).get('blocked'),true);assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).exists,true);
  const applied=await unblockBillingAccount(deps(c),c.account,requestBody,'operator-ana',9_000_000_001);
  assert.equal(applied.unblocked,true);assert.equal((await guardOf(c).get()).exists,false);
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
  // A second, FOREIGN identity is blocked too, to prove neither attempt touches another account.
  const foreignUid='synthetic-retry-generation-foreign-'+randomUUID(),foreignBoot=await c.store.bootstrap(foreignUid);
  assert.equal((await c.accountBilling.block(accountIdentityKey(foreignUid),accountHoldId('outbox',randomUUID(),1,1))).created,true);
  const foreignGuardBefore=(await ref(c.accountRoot,'videoBillingGuards',foreignBoot.account.id).get()).data();
  // (1) Account refuses the OLD generation EXPLICITLY: no Account receipt and no Video closure record are created
  // (this attempt's `unblock_requested` WAS already written by phase 0 -- the ONLY Video write so far).
  await assert.rejects(unblockBillingAccount(deps(c),c.account,oldBody,'operator-ana',9_000_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  assert.equal((await guardOf(c).get()).get('blocked'),true,'Video stays blocked: Account refused the stale generation');
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get()).get('epoch'),g1.epoch,'the refusal does not move the Account guard');
  const requestedRows=await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get();
  assert.equal(requestedRows.size,1);assert.equal(requestedRows.docs[0].get('action'),'unblock_requested');
  assert.equal((await c.root.collection(UNBLOCK_AUDIT_COLLECTION).where('action','==','unblocked').get()).size,0,'no completion record for the refused attempt');
  assert.equal((await c.accountRoot.collection('videoBillingUnblocks').get()).size,0,'a refused generation leaves NO Account receipt');
  // (2) The LEGITIMATE retry names the NEW Account generation. Account confirms the incident; because the second Account
  // incident is still unreviewed, Account keeps its guard and Video keeps its own (partial result).
  const retryBody={...oldBody,accountEpoch:g1.epoch,accountCreatedAtMs:g1.createdAtMs};
  const retry=await unblockBillingAccount(deps(c),c.account,retryBody,'operator-ana',9_000_010_000);
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
  // A: the OLD generation is refused; this attempt's `unblock_requested` (accountEpoch = g0) stays durable in Video.
  await assert.rejects(unblockBillingAccount(deps(c),c.account,oldBody,'operator-ana',9_000_000_000),
    error=>error instanceof UnblockFault&&error.code==='conflict'&&error.stage==='account');
  // B: Account commits the g1 receipt, but the response never reaches Video.
  const retryBody={...oldBody,accountEpoch:g1.epoch,accountCreatedAtMs:g1.createdAtMs};
  const originalUnblock=c.accountBilling.unblock.bind(c.accountBilling);
  c.accountBilling.unblock=async(...args)=>{await originalUnblock(...args);throw new Error('synthetic lost response after Account committed');};
  await assert.rejects(unblockBillingAccount(deps(c),c.account,retryBody,'operator-ana',9_000_010_000),
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
  await assert.rejects(unblockBillingAccount(deps(c),c.account,oldBody,'operator-ana',9_000_035_000),
    error=>error instanceof UnblockFault&&error.stage==='account');
  c.accountBilling.unblockReceipt=readReceipt;
  assert.deepEqual(await signatures(c.root),videoBefore,'an unavailable receipt writes nothing in Video');
  assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock')).length,postsBefore+2,'an unavailable receipt never triggers a mutation');
  // Video recovers g1 from the original g0 request and keeps its guard because the other Account incidents are open.
  const readsBefore=c.transport.bodies.filter(body=>body.pathname.endsWith('/unblock-receipt')).length;
  const recovered=await unblockBillingAccount(deps(c),c.account,oldBody,'operator-ana',9_000_040_000);
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
  const repeat=await unblockBillingAccount(deps(c),c.account,oldBody,'operator-ana',9_000_050_000);
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
