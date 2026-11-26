// LV-019.B step 1.4b piece 2: the audited, Video-side unblock against a REAL AccountStore.
// Contract: docs/specs/LV-019-B-bloqueos-y-cierres-diseno.md v2 (decisions 4, 5, 8; 3.3; 3.4; 3.6; tests 11, 12, 12b, 13)
// and docs/evidence/lv019-b-t3-codificacion-1-4b-20261123/RECIBO-pieza-1.md.
// Synthetic only: the fixed loopback emulator and Account running in this process. No cloud, no credentials, no deploy.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {FieldValue,Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend,LedgerFault,validClearIntentAdmissionGuard} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {ObjectFault} from './gcsObjects.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {ALERT_COLLECTION,alertKey,alertIdentity,clearResolvedAlerts,raisePendingAlerts} from './billingPendingAlerts.ts';
import {readPendingReport} from './billingPendingReport.ts';
import {acquireDrainLease,DRAIN_LEASE_COLLECTION,DRAIN_LEASE_DOC_ID} from './billingDrainLease.ts';
import {blockedState,unblockBillingAccount,UnblockFault,UNBLOCK_AUDIT_COLLECTION,unblockAuditId} from './billingUnblock.ts';
import {recordDisposition} from './billingPendingAudit.ts';
import {accountHoldId} from './billingHoldIdentity.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185';
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
  const settings=c.db._settings;assert.equal(settings?.servicePath,'127.0.0.1');assert.equal(settings?.port,8185);assert.equal(settings?.ssl,false);assert.equal(settings?.preferRest,false);
}
async function descendants(document,found=[]){for(const group of await document.listCollections())for(const child of await group.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{assertSafeEnvironment();assert.equal((await fetch(`http://${host}/`,{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{
  for(const c of contexts.splice(0)){
    try{
      for(const entry of c.roots){assertSafeClient(c);const marker=await entry.root.get();assert.deepEqual(marker.data(),entry.marker);const known=await descendants(entry.root);await c.db.recursiveDelete(entry.root);assert.equal((await entry.root.get()).exists,false);for(const doc of known)assert.equal((await doc.get()).exists,false);}
      cleaned++;
    }finally{await c.db.terminate();}
  }
});
after(()=>{console.log(`Synthetic alert contract cleanup total: ${cleaned}/${created}`);assert.equal(cleaned,created);assert.equal(created,9);});

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
  for(const entry of c.roots)await entry.root.create(entry.marker);
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
async function blockedAccount(scope,options={}){
  const c=await fixture(scope),job=await captureJob(c);
  // Extra captured jobs are prepared BEFORE the block: a blocked account refuses new work, which is the point of the guard.
  const extras=[];for(let n=0;n<(options.extraJobs??0);n++)extras.push(await captureJob(c));
  const releases=[];for(let n=0;n<(options.extraReleases??0);n++)releases.push(await releaseJob(c));
  const {expected,snapshot}=await expectedAndSnapshot(c,job.id),version=await versionOf(c,job.id);
  const outcome=await c.backend.quarantineExternalBillingOutbox(job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
  assert.equal(outcome.state,'needs_review');assert.equal(outcome.ownerBlocked,true);
  const guard=(await guardOf(c).get()).data();
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
  const guard=(await guardOf(c).get()).data();
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


const unblockPath='/api/internal/video/billing-holds/unblock';
const receiptPath='/api/internal/video/billing-holds/unblock-receipt';
const actor='fixture-operator';
const timeLimit={timeout:90000};
const paths=(c,start)=>c.transport.bodies.slice(start).map(call=>call.pathname);
const perform=(b,p)=>unblockBillingAccount(deps(b.c),b.c.account,p,actor,Date.now());
const damage=b=>guardOf(b.c).update({lastOutboxIncidentId:42});
const repair=b=>guardOf(b.c).update({lastOutboxIncidentId:FieldValue.delete()});
const auditActions=async c=>(await c.root.collection(UNBLOCK_AUDIT_COLLECTION).get()).docs.map(doc=>doc.get('action')).sort();
const corrupt=error=>error instanceof UnblockFault&&error.code==='corrupt';
async function realReceipt(b,p){
  return b.c.store.videoBillingUnblockReceipt(b.c.identity,b.hold,p.evidenceRef);
}
async function assertPendingVideo(b){
  assert.equal((await guardOf(b.c).get()).get('blocked'),true);
  assert.equal((await ref(b.c.root,ALERT_COLLECTION,b.alertKey).get()).get('status'),'open');
  assert.deepEqual(await auditActions(b.c),['unblock_requested']);
}

test('alert contract damaged source refuses before Account and isolates a second owner',timeLimit,async()=>{
  const b=await blockedIntentAccount('damaged-source'),c=b.c,p=await request(c,b);
  const uid='synthetic-second-'+randomUUID(),identity=accountIdentityKey(uid);
  const videoOwner=await c.backend.accountForUid(uid),owner=(await c.store.bootstrap(uid)).account.id;
  assert.notEqual(videoOwner,c.account);assert.notEqual(owner,c.accountOwner);
  await ref(c.accountRoot,'accounts',owner).update({credited:40,available:40});
  await damage(b);
  const before={account:await signatures(c.accountRoot),video:await signatures(c.root),calls:c.transport.bodies.length};
  await assert.rejects(()=>perform(b,p),corrupt);
  assert.deepEqual(await signatures(c.accountRoot),before.account);
  assert.deepEqual(await signatures(c.root),before.video);
  assert.deepEqual(paths(c,before.calls),[]);
  assert.deepEqual(await auditActions(c),[]);
  assert.equal((await realReceipt(b,p)).state,'pending');
  assert.equal((await ref(c.root,'billingGuards',videoOwner).get()).exists,false);
  assert.equal((await ref(c.accountRoot,'videoBillingGuards',owner).get()).exists,false);
  const second=await c.store.reserveVideo(identity,randomUUID(),2);
  assert.deepEqual([second.created,second.state,second.seconds],[true,'reserved',2]);
  assert.equal((await guardOf(c).get()).get('blocked'),true);
});

test('alert contract damage during confirmed response recovers the exact receipt without a second mutation',timeLimit,async()=>{
  const b=await blockedIntentAccount('confirmed-response'),c=b.c,p=await request(c,b);
  const original=c.accountBilling.unblock.bind(c.accountBilling),start=c.transport.bodies.length;
  c.accountBilling.unblock=async(...args)=>{
    const response=await original(...args);
    assert.deepEqual([response.replayed,response.blocked],[false,false]);
    await damage(b);
    return response;
  };
  await assert.rejects(()=>perform(b,p),corrupt);
  assert.deepEqual(paths(c,start),[unblockPath]);
  await assertPendingVideo(b);
  const result=await realReceipt(b,p);
  assert.deepEqual([result.state,result.incidentId,result.reviewRef,result.epoch,result.createdAtMs],
    ['confirmed',b.hold,p.evidenceRef,p.accountEpoch,p.accountCreatedAtMs]);
  assert.equal(await accountGuard(c),null);
  const durableAccount=await signatures(c.accountRoot);
  await assert.rejects(()=>perform(b,p),corrupt);
  assert.deepEqual(paths(c,start),[unblockPath]);
  await repair(b);
  assert.equal((await perform(b,p)).videoBlocked,false);
  assert.equal((await guardOf(c).get()).exists,false);
  assert.deepEqual(await auditActions(c),['unblock_requested','unblocked']);
  assert.equal((await ref(c.root,ALERT_COLLECTION,b.alertKey).get()).get('status'),'dispositioned');
  const finishedVideo=await signatures(c.root);
  assert.equal((await perform(b,p)).replayed,true);
  assert.deepEqual(paths(c,start),[unblockPath,receiptPath]);
  assert.deepEqual(await signatures(c.accountRoot),durableAccount);
  assert.deepEqual(await signatures(c.root),finishedVideo);
});

test('alert contract pending receipt in flight loses local authority before a new mutation',timeLimit,async()=>{
  const b=await blockedIntentAccount('pending-receipt'),c=b.c,p=await request(c,b);
  const original=c.accountBilling.unblock.bind(c.accountBilling),start=c.transport.bodies.length;
  // A proven local pre-transport failure leaves a genuine Video request and no Account decision.
  c.accountBilling.unblock=async()=>{throw Error('synthetic failure before local transport');};
  await assert.rejects(()=>perform(b,p),error=>error instanceof UnblockFault&&error.stage==='account');
  assert.deepEqual(paths(c,start),[]);
  await assertPendingVideo(b);
  assert.equal((await realReceipt(b,p)).state,'pending');
  c.accountBilling.unblock=original;
  const read=c.accountBilling.unblockReceipt.bind(c.accountBilling);
  c.accountBilling.unblockReceipt=async(...args)=>{
    const response=await read(...args);assert.equal(response.state,'pending');
    await damage(b);return response;
  };
  const account=await signatures(c.accountRoot);
  await assert.rejects(()=>perform(b,p),error=>error instanceof UnblockFault);
  await assertPendingVideo(b);
  assert.deepEqual({calls:paths(c,start),receipt:(await realReceipt(b,p)).state,accountUnchanged:JSON.stringify(Object.entries(await signatures(c.accountRoot)).sort())===JSON.stringify(Object.entries(account).sort())},
    {calls:[receiptPath],receipt:'pending',accountUnchanged:true});
});

test('alert contract already partial done refuses a damaged live guard before consulting Account',timeLimit,async()=>{
  const b=await blockedIntentAccount('already-partial'),c=b.c,other=await addAccountIncident(c),p=await request(c,b);
  const first=await perform(b,p);assert.deepEqual([first.accountBlocked,first.videoBlocked],[true,true]);
  await damage(b);
  const video=await signatures(c.root),account=await signatures(c.accountRoot),start=c.transport.bodies.length;
  await assert.rejects(()=>perform(b,p),corrupt);assert.deepEqual(paths(c,start),[]);
  assert.deepEqual(await signatures(c.root),video);assert.deepEqual(await signatures(c.accountRoot),account);
  await repair(b);await reviewOtherAccountIncident(c,other);
  const recovery=c.transport.bodies.length;
  assert.equal((await perform(b,p)).videoBlocked,false);
  assert.deepEqual(paths(c,recovery),[receiptPath]);
  assert.deepEqual(await auditActions(c),['unblock_requested','unblocked','video_released']);
});

test('alert contract partial done with rival and damage during the confirmed receipt keeps reconciliation visible',timeLimit,async()=>{
  const b=await blockedIntentAccount('partial-receipt'),c=b.c;
  await addAccountIncident(c);const p=await request(c,b);
  assert.equal((await perform(b,p)).videoBlocked,true);
  const start=c.transport.bodies.length,account=await signatures(c.accountRoot);
  const read=c.accountBilling.unblockReceipt.bind(c.accountBilling);
  c.accountBilling.unblockReceipt=async(...args)=>{
    const receipt=await read(...args);assert.equal(receipt.state,'confirmed');assert.equal(receipt.blocked,true);
    await damage(b);return receipt;
  };
  const outcome=await perform(b,p).then(()=> 'replayed',err=>err instanceof UnblockFault?err.code:Promise.reject(err));
  assert.deepEqual(paths(c,start),[receiptPath]);
  assert.deepEqual(await auditActions(c),['unblock_requested','unblocked']);
  assert.deepEqual(await signatures(c.accountRoot),account);
  assert.equal((await guardOf(c).get()).get('blocked'),true);
  assert.equal((await ref(c.root,ALERT_COLLECTION,b.alertKey).get()).get('status'),'open');
  assert.equal(outcome,'corrupt','a diagnostic replay must expose the now-damaged source');
});

test('alert contract unknown category or reason cannot clear or disposition a stored warning',timeLimit,async()=>{
  const c=await fixture('enum-contract'),row=randomUUID();
  await ref(c.root,'billingOutbox',row).create({state:'settled'});
  const alerts=[];
  for(const [kind,reason] of [['future-kind','needs_review'],['outbox','future-reason']]){
    const key=alertKey(kind,row,'needs_review',reason),doc=ref(c.root,ALERT_COLLECTION,key);
    await doc.create({alertKey:key,kind,rowId:row,state:'needs_review',reason,accountId:null,status:'open',seenCount:1,firstSeenAtMs:5,lastSeenAtMs:6});
    alerts.push(doc);
  }
  const before=await signatures(c.root),account=await signatures(c.accountRoot),start=c.transport.bodies.length;
  const now=Date.now(),report=await readPendingReport(c.root,now);
  const clear=await clearResolvedAlerts(c.db,c.root,report,now);
  assert.deepEqual([clear.corrupt,clear.cleared],[2,0]);
  for(const doc of alerts){
    assert.equal(alertIdentity(await doc.get()),null);
    await assert.rejects(()=>recordDisposition(c.db,c.root,doc.id,'resolve',{authorizedBy:actor,evidenceRef:'synthetic-enum-proof'},now),{code:'corrupt'});
  }
  assert.deepEqual(await signatures(c.root),before);assert.deepEqual(await signatures(c.accountRoot),account);
  assert.deepEqual(paths(c,start),[]);
});

for(const alteration of ['different evidence','restored evidence','intact']){
  test('alert contract confirmed nonpartial receipt and '+alteration+' at local commit',timeLimit,async()=>{
    const b=await blockedIntentAccount('confirmed-audit-history'),c=b.c,p=await request(c,b);
    const start=c.transport.bodies.length;
    const send=c.accountBilling.unblock.bind(c.accountBilling);
    c.accountBilling.unblock=async(...args)=>{
      const decision=await send(...args);
      assert.equal(decision.blocked,false);
      throw Error('synthetic delivery failure after confirming Account transaction');
    };
    await assert.rejects(()=>perform(b,p),error=>error instanceof UnblockFault&&error.stage==='account');
    await assertPendingVideo(b);
    assert.deepEqual(paths(c,start),[unblockPath]);
    assert.equal((await realReceipt(b,p)).state,'confirmed');
    const durableAccount=await signatures(c.accountRoot);
    const id=unblockAuditId(b.incident,'unblock_requested',p.epoch,p.createdAtMs);
    const requested=ref(c.root,UNBLOCK_AUDIT_COLLECTION,id),original=await requested.get();
    const read=c.accountBilling.unblockReceipt.bind(c.accountBilling);
    let beforeCompletion;
    c.accountBilling.unblockReceipt=async(...args)=>{
      const receipt=await read(...args);
      assert.deepEqual([receipt.state,receipt.blocked],['confirmed',false]);
      if(alteration!=='intact'){
        // Synthetic privileged writes simulate corruption of an immutable audit.
        await requested.update({evidenceRef:'different synthetic evidence'});
        if(alteration==='restored evidence')await requested.update({evidenceRef:original.get('evidenceRef')});
        const rewritten=await requested.get();
        assert.equal(original.updateTime.isEqual(rewritten.updateTime),false);
        if(alteration==='restored evidence')assert.deepEqual(rewritten.data(),original.data());
      }
      beforeCompletion=await signatures(c.root);
      return receipt;
    };
    const outcome=await perform(b,p).then(result=>result.videoBlocked?'blocked':'closed',error=>{
      if(error instanceof UnblockFault)return error.code;
      throw error;
    });
    assert.deepEqual(paths(c,start),[unblockPath,receiptPath]);
    assert.deepEqual(await signatures(c.accountRoot),durableAccount);
    if(alteration==='intact'){
      assert.equal(outcome,'closed');
      assert.deepEqual(await auditActions(c),['unblock_requested','unblocked']);
      assert.equal((await guardOf(c).get()).exists,false);
      const complete=await signatures(c.root);
      assert.equal((await perform(b,p)).replayed,true);
      assert.deepEqual(await signatures(c.root),complete);
      assert.deepEqual(paths(c,start),[unblockPath,receiptPath]);
    }else{
      assert.equal(outcome,'conflict');await assertPendingVideo(b);
      assert.deepEqual(await signatures(c.root),beforeCompletion);
    }
  });
}
