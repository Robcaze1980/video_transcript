// LV-019.B paso 1.4a (mitad C-3/E-3/D-4). Sintetico: emulador fijo 127.0.0.1:8185 y una Cuenta
// REAL (AccountStore) tras un transporte HTTP local. Sin nube, sin credenciales, sin desplegar.
// Cada prueba afirma el comportamiento que este paso debe alcanzar; se escriben para fallar HOY
// por el motivo correcto (C-3 no reintenta y bloquea, 3b silencia el ACK divergente, E-3 no acepta
// el cierre identico, D-4 no lee el guard), nunca por un error de montaje.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {Firestore,FieldValue} from 'firebase-admin/firestore';
import {FirestoreBackend,EXTERNAL_BILLING_ATTEMPT_LIMIT,LedgerFault} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {ObjectFault} from './gcsObjects.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {ALERT_COLLECTION,raisePendingAlerts} from './billingPendingAlerts.ts';
import {readPendingReport} from './billingPendingReport.ts';
import {blockedState} from './billingUnblock.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185';
const videoCollection='vistavo_blocks_a_video_synthetic',accountCollection='vistavo_blocks_a_ledger_synthetic';
const sha=value=>createHash('sha256').update(String(value)).digest('hex');
const ref=(root,collection,id)=>root.collection(collection).doc(id);
const reservationFor=(account,identity,input,requestKey)=>{const bytes=createHash('sha256').update(JSON.stringify(['vistavo-video-reservation-v1',account,identity,input,'translation:en',1,requestKey])).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const contexts=[];let cleanups=0,created=0;

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
  const settings=c.db._settings;assert.equal(settings?.servicePath,'127.0.0.1');assert.equal(settings?.port,8185);assert.equal(settings?.ssl,false);
}
async function descendants(document,found=[]){for(const group of await document.listCollections())for(const child of await group.listDocuments()){found.push(child);await descendants(child,found);}return found;}

before(async()=>{assertSafeEnvironment();assert.equal((await fetch(`http://${host}/`,{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{
  for(const c of contexts.splice(0)){
    try{
      for(const entry of c.roots){const known=await descendants(entry.root);await c.db.recursiveDelete(entry.root);assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);for(const document of known)assert.equal((await document.get()).exists,false);}
      cleanups++;
    }finally{await c.db.terminate();}
  }
});
after(()=>{console.log(`Synthetic blocks-1.4a cleanup total: ${cleanups}/${created}`);assert.equal(cleanups,created);});

const accountStatus={invalid:400,not_found:404,account_not_provisioned:404,conflict:409,deleted:410,quota:429,insufficient:402,invariant:503,too_early:409,forbidden:403};
class LocalAccountTransport{
  bodies=[];events=[];forceReleaseCode=null;forceReleaseState=null;
  constructor(store){this.store=store;}
  async request(request){
    const pathname=new URL(request.url).pathname,body=request.data;this.bodies.push({pathname,data:{...body}});
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
        if(this.forceReleaseState)return {...result,reservationId,state:this.forceReleaseState};
        return {...result,reservationId};});
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
  const c={scope,db,root,accountRoot,roots:[root,accountRoot].map(document=>({root:document,marker:{project,purpose:'blocks-1.4a-synthetic-v1',nonce:randomUUID()}}))};
  contexts.push(c);created++;assertSafeClient(c);
  for(const entry of c.roots)await entry.root.create(entry.marker);
  c.backend=new FirestoreBackend(db,root);c.store=new AccountStore(db,accountRoot);
  c.uid='synthetic-blocks-owner-'+randomUUID();c.account=await c.backend.accountForUid(c.uid);
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
const outbox=(c,id)=>ref(c.root,'billingOutbox',id);
const reservationDoc=(c,reservationId)=>ref(c.accountRoot,'videoReservations',sha(JSON.stringify([c.accountOwner,reservationId])));
const makeDue=(c,id)=>outbox(c,id).update({nextAttemptAt:0});
const releaseBodies=t=>t.bodies.filter(body=>body.pathname.endsWith('/release'));
const restored={credited:40,available:40,reserved:0,consumed:0,active:0};
const expectBalance=async(c,expected)=>assert.deepEqual(await c.store.videoBalance(c.identity),{unit:'video_seconds',...expected});

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
  await ref(c.root,'providerCalls',`${job.id}-text-window-0000`).create({jobId:job.id,accountId:c.account,attemptId:attempt.attemptId,callKey:'text-window:0000',model:'gemini-3.8-flash',state:'received',requestSha256,responseSha256,responseId:'synthetic-blocks-receipt',httpStatus:200,startedAtMs:Date.now()-50,finishedAtMs:Date.now(),usage:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},fixtureOnly:true});
}
const outputs=()=>new Map([
  ['transcript-es.txt',Buffer.from('La bomba mide doce pulgadas.')],['transcript-es.srt',Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nLa bomba mide doce pulgadas.\n')],
  ['translation-en.txt',Buffer.from('The water pump is twelve inches wide.')],['translation-en.srt',Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nThe water pump is twelve inches wide.\n')],['cues.json',Buffer.from(JSON.stringify({durationMs:2000,cues:[{startMs:0,endMs:2000,es:'La bomba mide doce pulgadas.',en:'The water pump is twelve inches wide.'}]}))],
]);
/** A capture row: admitted provider call, published results, job succeeded. */
async function captureJob(c){
  const job=await newJob(c);await admitCall(c,job);
  await c.ai.uploadResults(c.account,job.id,job.attempt.attemptId,outputs());
  assert.equal(await c.backend.finish(c.account,job.id,job.attempt.attemptId,true),true);
  return job;
}
/** A release row: a release after a provider admission (no_speech), the C-5 incident. */
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
const ackFor=expected=>({reservationId:expected.reservationId,seconds:expected.seconds,state:expected.action==='capture'?'captured':'released'});
const versionOf=async(c,id)=>{const s=await outbox(c,id).get();return s.updateTime.seconds+':'+String(s.updateTime.nanoseconds).padStart(9,'0');};
// ---------------------------------------------------------------------------
// C-3
// ---------------------------------------------------------------------------
test('1 after_ack with intact history and no settled row retries bounded without an incident or a block',{timeout:30000},async()=>{
  const c=await fixture('c3_transient'),job=await releaseJob(c);
  const {expected,snapshot}=await expectedAndSnapshot(c,job.id),version=await versionOf(c,job.id),before=(await outbox(c,job.id).get()).get('attempts')??0;
  const now=Date.now();
  const result=await c.backend.quarantineExternalBillingOutbox(job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:ackFor(expected),settlementSnapshot:snapshot});
  assert.deepEqual(result,{state:'retry_wait',ownerBlocked:false});
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('state'),'retry_wait');assert.equal(row.get('attempts'),before+1);
  assert.ok(row.get('nextAttemptAt')>now,'nextAttemptAt must be in the future');
  assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,0,'no incident for a transient failure');
  assert.notEqual((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true,'the owner must not be blocked');
  assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
});
test('1 negative: one of the 13 documents changed since the POST keeps the incident and the block',{timeout:30000},async()=>{
  const c=await fixture('c3_divergence'),job=await releaseJob(c);
  const {expected,snapshot}=await expectedAndSnapshot(c,job.id),version=await versionOf(c,job.id);
  await ref(c.root,'jobs',job.id).update({reviewNote:'changed'});
  const result=await c.backend.quarantineExternalBillingOutbox(job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:ackFor(expected),settlementSnapshot:snapshot});
  assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,true);
  assert.equal((await outbox(c,job.id).get()).get('state'),'needs_review');
  const incidents=await c.root.collection('billingOutboxReviewIncidents').get();assert.equal(incidents.size,1);assert.equal(incidents.docs[0].get('remoteAck.state'),'released');
  assert.equal((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true);
  assert.equal((await c.root.collection('billingHoldOutbox').get()).size,1);
});
test('2 exhausting the attempt limit with intact history becomes needs_review with an alert and no block, and is never retried',{timeout:30000},async()=>{
  const c=await fixture('c3_limit'),job=await releaseJob(c);
  const {expected,snapshot}=await expectedAndSnapshot(c,job.id);
  for(let round=1;round<=EXTERNAL_BILLING_ATTEMPT_LIMIT;round++){
    const version=await versionOf(c,job.id);
    const result=await c.backend.quarantineExternalBillingOutbox(job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:ackFor(expected),settlementSnapshot:snapshot});
    assert.equal(result.ownerBlocked,false);
    assert.equal(result.state,round<EXTERNAL_BILLING_ATTEMPT_LIMIT?'retry_wait':'needs_review',`round ${round}`);
  }
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('state'),'needs_review');assert.ok(row.get('attempts')>=EXTERNAL_BILLING_ATTEMPT_LIMIT);
  assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,0,'the limit alone raises no incident');
  assert.notEqual((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true,'the limit must not block the owner');
  const report=await readPendingReport(c.root,Date.now()),raised=await raisePendingAlerts(c.db,c.root,report,Date.now());
  const entry=report.rows.find(r=>r.kind==='outbox'&&r.id===job.id);
  assert.ok(entry&&entry.attention==='needs_review');assert.ok(raised.created>=1);
  assert.equal((await reservationDoc(c,job.reservationId).get()).get('state'),'reserved','the limit alone must not move balance');
  await makeDue(c,job.id);assert.equal((await c.ai.drainExternalBilling()).settled,0);
  assert.equal(releaseBodies(c.transport).length,0,'a needs_review capture row is not re-posted');
});
test('3 after_commit (the write committed, the response was lost) settles with no incident and no block',{timeout:30000},async()=>{
  const c=await fixture('c3_after_commit'),job=await releaseJob(c);
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
test('3b a divergent ACK is never silenced: the incident is recorded once and no row is left pending',{timeout:30000},async()=>{
  const c=await fixture('c3b_divergent_ack'),job=await captureJob(c);
  const {expected,snapshot}=await expectedAndSnapshot(c,job.id),version=await versionOf(c,job.id);
  // The ACK names another reservation and the wrong state for a capture: a demonstrated divergence, not a shape error.
  const divergent={reservationId:randomUUID(),seconds:expected.seconds,state:'released'};
  const result=await c.backend.quarantineExternalBillingOutbox(job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:divergent,settlementSnapshot:snapshot});
  assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,true);
  const outboxState=(await outbox(c,job.id).get()).get('state');
  assert.notEqual(outboxState,'pending','a divergent ACK must never leave the row pending without an incident');
  assert.equal(outboxState,'needs_review');
  const incidents=await c.root.collection('billingOutboxReviewIncidents').get();
  assert.equal(incidents.size,1,'exactly one incident');assert.equal(incidents.docs[0].get('remoteAck.state'),'released');
  assert.equal((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true);
  const posts=c.transport.bodies.length;
  await c.backend.quarantineExternalBillingOutbox(job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:divergent,settlementSnapshot:snapshot});
  assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,1);
  assert.equal(c.transport.bodies.length,posts,'no new Account call');
});
test('3b via the drain: a capture whose Account reservation answers as released records one incident and is never left pending without an alert',{timeout:30000},async()=>{
  const c=await fixture('c3b_drain_divergent'),job=await captureJob(c);
  // The capture POST succeeds but Account answers with the opposite state: the ACK does not correspond to the action.
  const realSettle=c.accountBilling.settle.bind(c.accountBilling);
  c.accountBilling.settle=async(...args)=>{const real=await realSettle(...args);return {...real,state:real.state==='captured'?'released':'captured'};};
  c.backend.markExternalBillingSettled=async()=>false;
  const before=c.transport.bodies.length;
  const result=await c.ai.drainExternalBilling();
  assert.equal(result.failed>=1,true);
  assert.equal((await outbox(c,job.id).get()).get('state'),'needs_review','the divergent ACK must never be silenced into a pending row');
  const incidents=await c.root.collection('billingOutboxReviewIncidents').get();
  assert.equal(incidents.size,1,'exactly one incident for the divergent ACK');
  assert.equal((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true,'the proven owner is blocked');
  assert.equal(c.transport.bodies.length-before,1,'exactly one POST, no new capture or release');
});
test('3b negative: when the quarantine write itself throws, the drain still records one incident and blocks the owner instead of leaving the row pending with no alert',{timeout:30000},async()=>{
  const c=await fixture('c3b_quarantine_throws'),job=await captureJob(c);
  // The exact hole 3b closes: the local settlement did not commit AND the quarantine write fails while the
  // drain holds a divergent ACK. The row would otherwise stay pending with no incident and no alert.
  const realSettle=c.accountBilling.settle.bind(c.accountBilling);
  c.accountBilling.settle=async(...args)=>{const real=await realSettle(...args);return {...real,state:real.state==='captured'?'released':'captured'};};
  c.backend.markExternalBillingSettled=async()=>false;
  const quarantineOnce=c.backend.quarantineExternalBillingOutbox.bind(c.backend);let quarantineCalls=0;
  c.backend.quarantineExternalBillingOutbox=async(...args)=>{quarantineCalls++;throw new LedgerFault('invalid');};
  const before=c.transport.bodies.length;
  let result;
  try{result=await c.ai.drainExternalBilling();}finally{c.backend.quarantineExternalBillingOutbox=quarantineOnce;}
  assert.ok(quarantineCalls>=1,'the drain must still consult the quarantine');
  assert.equal(result.failed>=1,true);
  // The fallback records the durable review incident, so the owner is blocked and a human sees it.
  const incidents=await c.root.collection('billingReviewIncidents').get();
  assert.equal(incidents.size,1,'exactly one incident even when the quarantine throws');
  assert.equal((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true,'the proven owner is blocked');
  assert.equal(job.id.length>0,true);
  assert.equal(c.transport.bodies.length-before,1,'exactly one POST, no new capture or release');
});
test('3c unavailable never reaches the bound; a permanent error does at the eighth attempt',{timeout:30000},async()=>{
  const c=await fixture('c3c_unavailable'),job=await releaseJob(c);
  c.transport.forceReleaseCode='unavailable';
  const repeats=EXTERNAL_BILLING_ATTEMPT_LIMIT+4;
  for(let attempt=1;attempt<=repeats;attempt++){
    await makeDue(c,job.id);
    assert.equal((await c.ai.drainExternalBilling()).failed,1,`attempt ${attempt}`);
    const row=await outbox(c,job.id).get();
    assert.equal(row.get('state'),'retry_wait',`unavailable attempt ${attempt} must stay retry_wait`);
    assert.equal(row.get('lastErrorCode'),'unavailable');
    assert.equal((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),undefined);
    assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,0);
  }
  c.transport.forceReleaseCode='conflict';await makeDue(c,job.id);
  assert.equal((await c.ai.drainExternalBilling()).failed,1);
  const final=await outbox(c,job.id).get();
  assert.equal(final.get('state'),'needs_review');assert.equal(final.get('lastErrorCode'),'conflict');
  assert.equal((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),undefined,'needs_review must not block the owner');
});
// ---------------------------------------------------------------------------
// E-3
// ---------------------------------------------------------------------------
const DIRECT_NAMES=['account','identity','input','project','intent','origin','guard','intentGuard','request','jobMarker','sealWitness','sealRecovery','releaseWitness','releaseRecovery'];
const directRef=(c,name)=>{
  const key=c.p.witness.intentId;
  const map={account:ref(c.root,'accounts',c.account),identity:ref(c.root,'identities',c.p.identityKey),input:ref(c.root,'inputs',c.input),project:ref(c.root,'projects',c.input),intent:ref(c.root,'billingIntents',key),origin:ref(c.root,'billingIntentWitnesses',key),guard:ref(c.root,'billingGuards',c.account),intentGuard:ref(c.root,'billingIntentAdmissionGuards',key),request:ref(c.root,'requests',key),jobMarker:ref(c.root,'billingIntentJobMarkers',key),sealWitness:ref(c.root,'billingIntentTerminalWitnesses',sha(JSON.stringify(['billing-intent-terminal-v1',key,'seal']))),sealRecovery:ref(c.root,'billingIntentTerminalRecovery',sha(JSON.stringify(['billing-intent-terminal-v1',key,'seal']))),releaseWitness:ref(c.root,'billingIntentTerminalWitnesses',sha(JSON.stringify(['billing-intent-terminal-v1',key,'release']))),releaseRecovery:ref(c.root,'billingIntentTerminalRecovery',sha(JSON.stringify(['billing-intent-terminal-v1',key,'release'])))};
  return map[name];
};
/** The five allowed direct mutations for the E-3 negative cases. */
const directMutations={
  // A no-op write does not bump updateTime in the emulator, so the divergence is a real content change
  // that moves the version while every validated field (accountId, uid) stays intact.
  identityVersion:async c=>{await directRef(c,'identity').update({versionProbe:'touched'});},
  intentTuple:async c=>{await directRef(c,'intent').update({seconds:3});},
  projectVersion:async c=>{await directRef(c,'project').update({draft:'touched'});},
  originVersion:async c=>{await directRef(c,'origin').update({baseline:'touched'});},
  guardVersion:async c=>{await directRef(c,'guard').set({accountId:c.account,blocked:false},{merge:true});},
};
async function preparedRelease(c){
  const requestKey=randomUUID(),identityKey=accountIdentityKey(c.uid),reservationId=reservationFor(c.account,identityKey,c.input,requestKey),billing={provider:'account_seconds',identityKey,reservationId,seconds:2};
  await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,billing);
  const witness=await c.backend.externalIntentWitness(c.account,requestKey,billing);
  await c.backend.fenceExternalBillingRelease(c.account,requestKey,billing);
  assert.deepEqual(await c.backend.prepareExternalIntentTerminal(witness,requestKey,'release'),{state:'ready'});
  const snapshot=await c.backend.captureDirectObservation(witness,requestKey,'status');assert.ok(snapshot);
  c.p={witness,identityKey};
  return {requestKey,identityKey,reservationId,billing,witness,snapshot};
}
const releaseObs=p=>({action:'release',source:'status',state:'released',reservationId:p.reservationId,seconds:2});
test('4 a committed direct close with a lost response is the same close on the retry: already_closed, no block',{timeout:30000},async()=>{
  const c=await fixture('e3_lost_response'),p=await preparedRelease(c),ack={reservationId:p.reservationId,seconds:2,state:'released'};
  const original=c.backend.finishExternalBillingRelease.bind(c.backend);
  // The close commits locally and its response is lost: the caller sees a failure while the intent is already closed.
  let lost=false;
  try{await (async()=>{assert.equal(await original(c.account,p.requestKey,p.billing,ack,p.witness,'status',p.snapshot),true);lost=true;throw Error('synthetic lost local response');})();}catch(error){assert.equal(error.message,'synthetic lost local response');}
  assert.equal(lost,true,'the close did commit before the response was lost');
  assert.equal((await ref(c.root,'billingIntents',p.witness.intentId).get()).get('state'),'closed');
  // The retry must recognize the exact close it already wrote instead of blocking.
  assert.equal(await original(c.account,p.requestKey,p.billing,ack,p.witness,'status',p.snapshot),true,'an identical already-written close is accepted');
  const result=await c.backend.recordConfirmedIntentObservation(p.witness,releaseObs(p),p.snapshot);
  assert.equal(result.state,'already_closed');assert.equal(result.ownerBlocked,false);
  assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0,'no incident for the exact close');
  assert.notEqual((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true,'the owner is not blocked');
  assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
});
test('5 an identical direct replay over a closed intent is already_closed; a missing confirmation is needs_review',{timeout:30000},async()=>{
  const c=await fixture('e3_replay_identity'),p=await preparedRelease(c),ack={reservationId:p.reservationId,seconds:2,state:'released'};
  assert.equal(await c.backend.finishExternalBillingRelease(c.account,p.requestKey,p.billing,ack,p.witness,'status',p.snapshot),true);
  const replay=await c.backend.recordConfirmedIntentObservation(p.witness,releaseObs(p),p.snapshot);
  assert.equal(replay.state,'already_closed');assert.equal(replay.ownerBlocked,false);
  assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
  // Negative: the confirmation is absent on the closed intent; the same observation must go to review.
  const second=await fixture('e3_replay_missing_confirmation'),q=await preparedRelease(second),secondAck={reservationId:q.reservationId,seconds:2,state:'released'};
  assert.equal(await second.backend.finishExternalBillingRelease(second.account,q.requestKey,q.billing,secondAck,q.witness,'status',q.snapshot),true);
  await ref(second.root,'billingIntents',q.witness.intentId).update({releaseConfirmed:FieldValue.delete(),releaseReservationId:FieldValue.delete(),releaseSeconds:FieldValue.delete()});
  const missing=await second.backend.recordConfirmedIntentObservation(q.witness,releaseObs(q),q.snapshot);
  assert.equal(missing.state,'needs_review');
});
for(const [name,mutate] of Object.entries(directMutations))test(`5 negative: after a direct close, a change to ${name} keeps needs_review with no false already_closed`,{timeout:30000},async()=>{
  const c=await fixture('e3_negative_'+name),p=await preparedRelease(c),ack={reservationId:p.reservationId,seconds:2,state:'released'};
  assert.equal(await c.backend.finishExternalBillingRelease(c.account,p.requestKey,p.billing,ack,p.witness,'status',p.snapshot),true);
  await mutate(c);
  const result=await c.backend.recordConfirmedIntentObservation(p.witness,releaseObs(p),p.snapshot);
  assert.equal(result.state,'needs_review',`${name} must not be silently accepted`);
});
// ---------------------------------------------------------------------------
// D-4
// ---------------------------------------------------------------------------
test('5 negative: a recreated closed intent (same content, new document) is not the close that was written',{timeout:30000},async()=>{
  const c=await fixture('e3_recreated_intent'),p=await preparedRelease(c),ack={reservationId:p.reservationId,seconds:2,state:'released'};
  assert.equal(await c.backend.finishExternalBillingRelease(c.account,p.requestKey,p.billing,ack,p.witness,'status',p.snapshot),true);
  // The intent document is rebuilt with the same content: the close was not written by this retry, so it must stay under review.
  const intent=ref(c.root,'billingIntents',p.witness.intentId),data=(await intent.get()).data();
  await intent.delete();await intent.create(data);
  const result=await c.backend.recordConfirmedIntentObservation(p.witness,releaseObs(p),p.snapshot);
  assert.equal(result.state,'needs_review','a recreated intent must not be accepted as the same close');
  assert.equal(result.ownerBlocked,true);
});

test('6 a hold row that needs review raises one alert from the Video report',{timeout:30000},async()=>{
  const c=await fixture('d4_hold_alert');
  const holdId=sha(JSON.stringify(['account-hold-v1','outbox','synthetic']));
  await ref(c.root,'billingHoldOutbox',holdId).create({state:'needs_review',reviewReason:'invalid_scheduling_metadata',createdAtMs:Date.now()});
  const report=await readPendingReport(c.root,Date.now()),raised=await raisePendingAlerts(c.db,c.root,report,Date.now());
  const alerts=await c.root.collection(ALERT_COLLECTION).get();
  assert.equal(raised.created,1);assert.equal(alerts.size,1);
  assert.deepEqual({kind:alerts.docs[0].get('kind'),reason:alerts.docs[0].get('reason')},{kind:'hold',reason:'needs_review'});
});
test('6 negative: a repeated sweep only counts a sighting, never a second alert',{timeout:30000},async()=>{
  const c=await fixture('d4_hold_alert_dedupe');
  const holdId=sha(JSON.stringify(['account-hold-v1','outbox','synthetic']));
  await ref(c.root,'billingHoldOutbox',holdId).create({state:'needs_review',reviewReason:'invalid_event',createdAtMs:Date.now()});
  const first=await raisePendingAlerts(c.db,c.root,await readPendingReport(c.root,Date.now()),Date.now());
  const second=await raisePendingAlerts(c.db,c.root,await readPendingReport(c.root,Date.now()),Date.now()+1000);
  assert.equal(first.created,1);assert.deepEqual(second,{created:0,seen:1});
  assert.equal((await c.root.collection(ALERT_COLLECTION).get()).size,1);
});
test('7 a hold with an unverified owner needs review without blocking the named account',{timeout:30000},async()=>{
  const c=await fixture('d4_hold_unverified');
  const sourceId=sha(JSON.stringify(['synthetic-intent','x'])),holdId=sha(JSON.stringify(['account-hold-v1','intent',sourceId])),foreign=randomUUID();
  await ref(c.root,'billingHoldOutbox',holdId).create({id:holdId,accountId:foreign,identityKey:c.identity,sourceKind:'intent',sourceId,state:'pending',attempts:0,nextAttemptAt:0,createdAtMs:Date.now()});
  const row=await ref(c.root,'billingHoldOutbox',holdId).get(),snapshotVersion=row.updateTime.seconds+':'+String(row.updateTime.nanoseconds).padStart(9,'0');
  const decision=await c.backend.authorizeExternalHold({id:holdId,accountId:foreign,identityKey:c.identity,sourceKind:'intent',sourceId,snapshotVersion});
  assert.equal(decision.state,'needs_review');
  assert.equal((await ref(c.root,'billingHoldOutbox',holdId).get()).get('state'),'needs_review');
  assert.equal((await ref(c.root,'billingGuards',foreign).get()).exists,false,'an unverified hold must not block anyone');
});
test('12b a blocked account produces one alert per account and epoch, deduped by the sweep; a guard without an incident is malformed',{timeout:30000},async()=>{
  const c=await fixture('d4_guard_alert'),job=await captureJob(c);
  const {expected,snapshot}=await expectedAndSnapshot(c,job.id),version=await versionOf(c,job.id);
  await c.backend.quarantineExternalBillingOutbox(job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:{reservationId:randomUUID(),seconds:expected.seconds,state:'released'},settlementSnapshot:snapshot});
  const guard=await ref(c.root,'billingGuards',c.account).get();assert.equal(guard.get('blocked'),true);
  const report=await readPendingReport(c.root,Date.now());
  const guardRows=report.rows.filter(row=>row.kind==='guard');
  assert.equal(guardRows.length,1,'one guard row per blocked account');assert.equal(guardRows[0].id,c.account);
  assert.equal(guardRows[0].attention,'needs_review');
  const first=await raisePendingAlerts(c.db,c.root,report,Date.now());
  const again=await raisePendingAlerts(c.db,c.root,await readPendingReport(c.root,Date.now()),Date.now()+1000);
  const guardAlerts=(await c.root.collection(ALERT_COLLECTION).get()).docs.filter(doc=>doc.get('kind')==='guard');
  assert.equal(guardAlerts.length,1,'one alert per account and epoch');assert.equal(first.created>=1,true);assert.equal(again.created,0);
  // Two epochs of the SAME blocked account are two distinct guard rows (state carries the epoch), so the alert
  const reblocked=await fixture('d4_guard_epoch');
  const reblockedAtMs=Date.now();
  await ref(reblocked.root,'billingGuards',reblocked.account).set({accountId:reblocked.account,blocked:true,epoch:2,lastIncidentId:'inc-2',createdAtMs:reblockedAtMs,updatedAtMs:reblockedAtMs});
  const epochRow=(await readPendingReport(reblocked.root,Date.now())).rows.find(r=>r.kind==='guard');
  assert.equal(epochRow.state,blockedState(2,reblockedAtMs,'inc-2'),'the guard state must carry the whole generation so a re-block is a new row');

  const orphan=await fixture('d4_guard_malformed'),lonely=randomUUID();
  await ref(orphan.root,'billingGuards',lonely).set({accountId:lonely,blocked:true,updatedAtMs:Date.now()});
  const orphanReport=await readPendingReport(orphan.root,Date.now()),row=orphanReport.rows.find(r=>r.kind==='guard');
  assert.ok(row);assert.equal(row.malformed,true);assert.equal(row.attention,'malformed');
  const raised=await raisePendingAlerts(orphan.db,orphan.root,orphanReport,Date.now());
  assert.equal(raised.created,1);
  assert.equal((await orphan.root.collection(ALERT_COLLECTION).get()).docs[0].get('reason'),'malformed');
});
// ---------------------------------------------------------------------------
// RONDA 2 (paso 1.4a): C-3 sin exigir la version de la propia fila; E-3 al tope;
// ACK divergente sobre una fila ya settled.
// ---------------------------------------------------------------------------
// Codex certification test (step 1.4a): the C-3 discriminator is the 13 OTHER documents and the tuple (design 3.1), NOT the outbox row's own version.
test('1 positive: a benign write to the outbox row itself (another drainer recorded a failure) with intact history is still a transient retry',{timeout:30000},async()=>{
  const c=await fixture('c3_row_touched'),job=await releaseJob(c);
  const {expected,snapshot}=await expectedAndSnapshot(c,job.id),staleVersion=await versionOf(c,job.id);
  // Another drainer lost its own local mark too and recorded the failure on the same row: same tuple, still retry_wait, other documents untouched.
  await outbox(c,job.id).update({state:'retry_wait',attempts:1,lastErrorCode:'unavailable',nextAttemptAt:Date.now()+1000,lastAttemptAtMs:Date.now()});
  assert.notEqual(await versionOf(c,job.id),staleVersion,'the row version really moved');
  const result=await c.backend.quarantineExternalBillingOutbox(job.id,{phase:'after_ack',snapshotVersion:staleVersion,expected,ack:ackFor(expected),settlementSnapshot:snapshot});
  assert.deepEqual(result,{state:'retry_wait',ownerBlocked:false});
  const row=await outbox(c,job.id).get();
  assert.equal(row.get('state'),'retry_wait');assert.equal(row.get('attempts'),2);
  assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,0,'no incident for a benign race');
  assert.notEqual((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true,'the owner must not be blocked by a benign race');
  assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
});

test('1 negative: a recreated outbox row (same tuple, new document) is a demonstrated divergence, not a transient retry',{timeout:30000},async()=>{
  const c=await fixture('c3_row_recreated'),job=await releaseJob(c);
  const {expected,snapshot}=await expectedAndSnapshot(c,job.id),staleVersion=await versionOf(c,job.id);
  const row=await outbox(c,job.id).get(),data=row.data();
  // The row is deleted and recreated with the same tuple and metadata: same content, a NEW document (different createTime).
  await outbox(c,job.id).delete();
  await outbox(c,job.id).create({...data,state:'retry_wait',attempts:1,lastErrorCode:'unavailable',nextAttemptAt:0,lastAttemptAtMs:Date.now()});
  assert.notEqual(await versionOf(c,job.id),staleVersion,'the row document was replaced');
  const result=await c.backend.quarantineExternalBillingOutbox(job.id,{phase:'after_ack',snapshotVersion:staleVersion,expected,ack:ackFor(expected),settlementSnapshot:snapshot});
  assert.equal(result.state,'needs_review','a recreated row must not be accepted as a transient retry');
  assert.equal(result.ownerBlocked,true);
  assert.equal((await outbox(c,job.id).get()).get('state'),'needs_review');
  assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,1,'a demonstrated divergence records one incident');
  assert.equal((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true,'a demonstrated divergence blocks the owner');
  assert.equal((await c.root.collection('billingHoldOutbox').get()).size,1);
});

// E-3 (direct close retried WITHOUT a snapshot): the branch counts attempts on the intent itself, with the shared wait, and at the limit moves the
// intent to needs_review with an alert but WITHOUT blocking the owner (design v2 3.2). No snapshot means no baseline to compare, so it is never a
// demonstrated divergence here.
test('1a E-3 snapshot-less retry: each retry counts on the intent, reschedules, and never blocks or invents an incident',{timeout:30000},async()=>{
  const c=await fixture('e3_no_snapshot_retry'),p=await preparedRelease(c),ack={reservationId:p.reservationId,seconds:2,state:'released'};
  assert.equal(await c.backend.finishExternalBillingRelease(c.account,p.requestKey,p.billing,ack,p.witness,'status',p.snapshot),true);
  const intent=ref(c.root,'billingIntents',p.witness.intentId),base=(await intent.get()).get('attempts')??0;
  assert.ok(base>=1&&base<EXTERNAL_BILLING_ATTEMPT_LIMIT,'the intent starts with a pending attempt');
  let last=0;
  for(let round=1;round<=EXTERNAL_BILLING_ATTEMPT_LIMIT-1-base;round++){
    const now=Date.now(),result=await c.backend.recordConfirmedIntentObservation(p.witness,releaseObs(p));
    assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,false,`round ${round}`);
    const row=await intent.get();
    assert.equal(row.get('state'),'closed',`the intent keeps its state below the limit (round ${round})`);
    assert.equal(row.get('attempts'),base+round);
    assert.equal(row.get('lastErrorCode'),'closure_unverified');
    assert.ok(row.get('nextAttemptAt')>now,'nextAttemptAt must be in the future');
    assert.ok(row.get('nextAttemptAt')>=last,'nextAttemptAt must not go backwards');last=row.get('nextAttemptAt');
    assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
    assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
    assert.notEqual((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true);
  }
  await expectBalance(c,{credited:40,available:40,reserved:0,consumed:0,active:0});
  assert.equal(c.transport.bodies.length,0,'a snapshot-less direct retry never calls Account');
});
test('1b E-3 at the attempt limit without a snapshot: the intent becomes needs_review with one alert, no incident and no block',{timeout:30000},async()=>{
  const c=await fixture('e3_no_snapshot_limit'),p=await preparedRelease(c),ack={reservationId:p.reservationId,seconds:2,state:'released'};
  assert.equal(await c.backend.finishExternalBillingRelease(c.account,p.requestKey,p.billing,ack,p.witness,'status',p.snapshot),true);
  const intent=ref(c.root,'billingIntents',p.witness.intentId),base=(await intent.get()).get('attempts')??0;
  let result,limitRound=0;
  for(let round=1;round<=EXTERNAL_BILLING_ATTEMPT_LIMIT-base;round++){
    result=await c.backend.recordConfirmedIntentObservation(p.witness,releaseObs(p));
    assert.equal(result.ownerBlocked,false,`round ${round} must never block`);
    const row=await intent.get();
    if(row.get('state')==='needs_review'){limitRound=round;break;}
    assert.equal(row.get('state'),'closed',`round ${round} stays closed below the limit`);
  }
  assert.ok(limitRound>0,'the limit must be reached within the bounded retries');
  assert.equal(result.state,'needs_review');
  const row=await intent.get();
  assert.equal(row.get('state'),'needs_review','at the limit the intent is needs_review');
  assert.equal(row.get('attempts'),EXTERNAL_BILLING_ATTEMPT_LIMIT);
  assert.equal(row.get('lastErrorCode'),'closure_unverified');
  assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0,'the limit alone raises no incident');
  assert.notEqual((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true,'the limit must not block the owner');
  assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
  // An identical retry after the limit is a no-op: still needs_review, still no incident and still no block.
  const beforeAgain=await intent.get();
  const again=await c.backend.recordConfirmedIntentObservation(p.witness,releaseObs(p));
  assert.equal(again.state,'needs_review');assert.equal(again.ownerBlocked,false);
  assert.equal((await intent.get()).get('state'),'needs_review');
  // Codex certification (step 1.4a): "a no-op" means NOTHING is written: the counter does not keep growing and the document is untouched.
  const afterAgain=await intent.get();
  assert.equal(afterAgain.get('attempts'),EXTERNAL_BILLING_ATTEMPT_LIMIT,'a retry after the limit does not count another attempt');
  assert.equal(afterAgain.updateTime.isEqual(beforeAgain.updateTime),true,'a retry after the limit writes nothing');
  assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
  assert.notEqual((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true);
  const report=await readPendingReport(c.root,Date.now());
  const entry=report.rows.find(r=>r.kind==='intent'&&r.id===p.witness.intentId);
  assert.ok(entry&&entry.attention==='needs_review','the report must see the limited intent as needs_review');
  const raised=await raisePendingAlerts(c.db,c.root,report,Date.now());
  assert.ok(raised.created>=1);
  const alerts=(await c.root.collection(ALERT_COLLECTION).get()).docs.filter(doc=>doc.get('kind')==='intent');
  assert.equal(alerts.length,1,'exactly one alert for the limited intent');
  await expectBalance(c,{credited:40,available:40,reserved:0,consumed:0,active:0});
  assert.equal(c.transport.bodies.length,0,'the limit alone never calls Account');
});
test('1c E-3 negative: with a snapshot and a moved document the direct retry still keeps the incident and the block',{timeout:30000},async()=>{
  const c=await fixture('e3_snapshot_moved'),p=await preparedRelease(c),ack={reservationId:p.reservationId,seconds:2,state:'released'};
  assert.equal(await c.backend.finishExternalBillingRelease(c.account,p.requestKey,p.billing,ack,p.witness,'status',p.snapshot),true);
  await directMutations.projectVersion(c);
  const result=await c.backend.recordConfirmedIntentObservation(p.witness,releaseObs(p),p.snapshot);
  assert.equal(result.state,'needs_review');assert.equal(result.ownerBlocked,true,'a demonstrated divergence still blocks');
  assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,1);
  assert.equal((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true);
});
test('4a a divergent ACK on an already settled row must not take the already_settled shortcut: it records an incident',{timeout:30000},async()=>{
  const c=await fixture('c3_settled_divergent_ack'),job=await releaseJob(c);
  const {expected,snapshot}=await expectedAndSnapshot(c,job.id),version=await versionOf(c,job.id);
  // The local settlement did commit: the row is settled with the expected tuple and the history is intact.
  await outbox(c,job.id).update({state:'settled',settledAtMs:Date.now()});
  const divergent={reservationId:randomUUID(),seconds:expected.seconds,state:'released'};
  const result=await c.backend.quarantineExternalBillingOutbox(job.id,{phase:'after_ack',snapshotVersion:version,expected,ack:divergent,settlementSnapshot:snapshot});
  assert.equal(result.state,'needs_review','a divergent ACK must never be absorbed by the already_settled shortcut');
  assert.equal(result.ownerBlocked,true);
  const incidents=await c.root.collection('billingOutboxReviewIncidents').get();
  assert.equal(incidents.size,1,'the divergent ACK is recorded as exactly one incident');
  assert.equal(incidents.docs[0].get('remoteAck.state'),'released');
  assert.equal((await ref(c.root,'billingGuards',c.account).get()).get('blocked'),true);
});
test('4b re-sending after a C-3 transient ACK never duplicates balance: one settlement after the drain pass',{timeout:30000},async()=>{
  const c=await fixture('c3_no_double_balance'),job=await captureJob(c);
  const mark=c.backend.markExternalBillingSettled.bind(c.backend);
  // The local mark fails before commit while Account already captured: the row becomes retry_wait (C-3 transient).
  try{c.backend.markExternalBillingSettled=async()=>{throw Error('synthetic local write failure before commit');};
    const first=await c.ai.drainExternalBilling();
    assert.equal(first.settled,0);assert.equal(first.failed,1);
    assert.equal((await outbox(c,job.id).get()).get('state'),'retry_wait');
  }finally{c.backend.markExternalBillingSettled=mark;}
  await makeDue(c,job.id);
  const second=await c.ai.drainExternalBilling();
  assert.equal(second.settled,1,'the second pass settles');
  assert.equal((await outbox(c,job.id).get()).get('state'),'settled');
  // Account is idempotent by (reservation, action): balance, reservation and ledger stay as a single settlement.
  await expectBalance(c,{credited:40,available:38,reserved:0,consumed:2,active:0});
  assert.equal((await reservationDoc(c,job.reservationId).get()).get('state'),'captured');
  const captured=await c.accountRoot.collection('ledgerEntries').where('kind','==','video_capture').get();
  assert.equal(captured.size,1,'exactly one capture ledger entry');
  const releases=await c.accountRoot.collection('ledgerEntries').where('kind','==','video_release').get();
  assert.equal(releases.size,0,'no release ledger entry for a re-sent capture');
  assert.equal(releaseBodies(c.transport).length,0,'no release is ever posted for a capture row');
});
