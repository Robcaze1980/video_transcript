// LV-019-B step 1.3a: A-3 timeout exit. This fixture runs a REAL AccountStore behind a local
// adapter against the fixed emulator. It covers the deadline fence and the conflict close paths.
// Every wait is bounded and every Firestore client is terminated in a finally block.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {FieldValue,Firestore} from 'firebase-admin/firestore';
import {EXTERNAL_BILLING_MAX_AGE_MS,FirestoreBackend,LedgerFault} from './firestoreBackend.ts';
import {AI_CATALOG_VERSION} from './aiContracts.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {readPendingReport} from './billingPendingReport.ts';
import {ALERT_COLLECTION,alertKey,raisePendingAlerts} from './billingPendingAlerts.ts';
import {AUDIT_COLLECTION,auditId,recordDisposition} from './billingPendingAudit.ts';
import {summarizeAccounts} from './accountReconciliationCounts.ts';
import {accountReadOnlyRoot} from './accountReadOnlyRoot.ts';
import {runBillingDrainSection} from './billingDrainSection.ts';
import {runBillingSweepSection} from './billingSweepSection.ts';
import {accountHoldId} from './billingHoldIdentity.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185';
const videoCollection='vistavo_a3_exit_video_synthetic',accountCollection='vistavo_a3_exit_ledger_synthetic';
const WORK_TIMEOUT_MS=180000,CLEANUP_TIMEOUT_MS=45000,TERMINATE_TIMEOUT_MS=15000;
const sha=value=>createHash('sha256').update(value).digest('hex');
const contexts=[];
let created=0,cleaned=0;
const bounded=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout: '+label)),ms))]);
const ref=(root,collection,id)=>root.collection(collection).doc(id);
const reservationDoc=(c,reservationId)=>ref(c.accountRoot,'videoReservations',sha(JSON.stringify([c.accountOwner,reservationId])));
const intentRef=(c,requestKey)=>ref(c.root,'billingIntents',sha(JSON.stringify([c.account,requestKey])));
async function descendants(root,found=[]){for(const collection of await root.listCollections())for(const doc of await collection.listDocuments()){found.push(doc);await descendants(doc,found);}return found;}

before(async()=>{assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);assert.equal((await fetch('http://127.0.0.1:8185/',{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{
 for(const c of contexts.splice(0)){
  try{
   for(const entry of c.roots){const known=await descendants(entry.root);await bounded(c.db.recursiveDelete(entry.root),CLEANUP_TIMEOUT_MS,'cleanup '+entry.root.path);assert.equal((await entry.root.get()).exists,false);for(const doc of known)assert.equal((await doc.get()).exists,false);}
   cleaned++;
  }finally{try{await bounded(c.db.terminate(),TERMINATE_TIMEOUT_MS,'terminate');}catch{}}
 }
});
after(()=>{assert.equal(cleaned,created);});

const accountStatus={invalid:400,not_found:404,account_not_provisioned:404,conflict:409,deleted:410,quota:429,insufficient:402,invariant:503,too_early:409,forbidden:403};
class LocalAccountTransport{
 bodies=[];
 constructor(store){this.store=store;}
 async request(request){
  const pathname=new URL(request.url).pathname,body=request.data??{},bodies=this.bodies;bodies.push({path:pathname,body});
  const parts=pathname.split('/'),reservationId=parts.at(-2);
  const httpFault=(status,code)=>Object.assign(new Error('synthetic account fault'),{response:{status,data:{error:code}}});
  const guard=async action=>{try{return {data:await action()};}catch(error){if(error?.response)throw error;throw httpFault(accountStatus[error?.code]??503,error?.code??'invariant');}};
  if(pathname==='/api/internal/video/reservations')return guard(async()=>({...await this.store.reserveVideo(body.identityKey,body.reservationId,body.seconds),reservationId:body.reservationId}));
  if(pathname.endsWith('/status'))return guard(()=>this.store.videoReservation(body.identityKey,reservationId));
  if(pathname.endsWith('/resolution'))return guard(()=>this.store.videoReservationResolution(body.identityKey,reservationId,body.seconds));
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
async function fixture(scope){
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
 const root=db.collection(videoCollection).doc(randomUUID()),accountRoot=db.collection(accountCollection).doc(randomUUID());
 const c={scope,db,root,accountRoot,roots:[{root},{root:accountRoot}]};
 contexts.push(c);created++;
 for(const entry of c.roots)await entry.root.create({purpose:'a3-exit-synthetic',nonce:randomUUID()});
 c.backend=new FirestoreBackend(db,root);c.store=new AccountStore(db,accountRoot);
 c.uid='a3-exit-owner-'+randomUUID();c.account=await c.backend.accountForUid(c.uid);
 await ref(root,'accounts',c.account).update({aiPilot:true,simulationOnly:true,credited:40,available:40});
 const boot=await c.store.bootstrap(c.uid);c.accountOwner=boot.account.id;
 await ref(accountRoot,'accounts',c.accountOwner).update({credited:40,available:40});
 c.identity=accountIdentityKey(c.uid);
 c.input=randomUUID();const source=Buffer.from('synthetic A3 source placeholder'),digest=sha(source);
 const storage={bucket:privateBucket,key:`candidate-files-v1/${c.input}/video.mp4`,generation:'1',size:source.length,sha256:digest};
 await ref(root,'inputs',c.input).create({accountId:c.account,expiresAtMs:Date.now()+3600000,sha256:digest,deleted:false,ready:true,unknown:false,unknownCount:0,metadata:{duration:2,audioTracks:1},storage});
 await c.backend.saveProject(c.account,c.input,0,'A3 synthetic source');
 c.transport=new LocalAccountTransport(c.store);
 c.ai=new FirestoreAi(db,root,c.backend,{},undefined,new AccountBillingClient(undefined,c.transport));
 return c;
}
/** Begin an A-3 intent without work and normally reserve only in Account. */
async function a3(c,{ageMs=0,requestKey=randomUUID(),nextAttemptAt=0,createdAtMs,reserveInAccount=true}={}){
 const billing={provider:'account_seconds',identityKey:c.identity,reservationId:randomUUID(),seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,billing);
 if(reserveInAccount)await c.store.reserveVideo(c.identity,billing.reservationId,2);
 const intent=intentRef(c,requestKey);
 await intent.update({createdAtMs:createdAtMs??Date.now()-ageMs,nextAttemptAt});
 return {requestKey,billing,intent};
}
async function intentRow(c,requestKey){return (await intentRef(c,requestKey).get()).data();}
async function balance(c){return c.store.videoBalance(c.identity);}
async function localBalance(c){return c.backend.readBalance(c.account);}
async function jobs(c){return (await c.root.collection('jobs').get()).size;}
async function terminal(c){return (await c.root.collection('billingIntentTerminalWitnesses').get()).size;}
async function releaseRows(c){return (await c.root.collection('billingOutbox').get()).size;}
async function incident(c,requestKey){return (await ref(c.root,'billingReviewIncidents',sha(JSON.stringify([c.account,requestKey]))).get()).data();}
async function otherAccount(c){
 const uid='a3-exit-foreign-'+randomUUID();
 const account=await c.backend.accountForUid(uid);
 const {account:{id:ledgerAccount}}=await c.store.bootstrap(uid);
 await ref(c.accountRoot,'accounts',ledgerAccount).update({credited:30,available:30});
 return {account,identityKey:accountIdentityKey(uid)};
}

test('A3 timeout boundary: one ms before the limit waits; the exact limit releases; never captures',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('boundary');
 const boundaryNow=Date.now();
 const early=await a3(c,{createdAtMs:boundaryNow-(30*60*1000-1)});
 const beforeEarly=await balance(c);
 let r=await c.ai.drainExternalBilling(undefined,{now:boundaryNow});
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 const earlyRow=await intentRow(c,early.requestKey);
 assert.equal(earlyRow.state,'reserve_pending');assert.equal(earlyRow.lastErrorCode,'reserved_unconfirmed');
 assert.deepEqual(await balance(c),beforeEarly);
 const exact=await a3(c,{createdAtMs:boundaryNow-30*60*1000});
 r=await c.ai.drainExternalBilling(undefined,{now:boundaryNow});
 assert.equal(r.intentsRecovered,1);assert.equal(r.intentsFailed,0);
 assert.equal((await intentRow(c,exact.requestKey)).state,'closed');
 // The earlier row stayed reserved (still within its window), so the account keeps that hold.
 assert.deepEqual(await balance(c),{unit:'video_seconds',credited:40,available:38,reserved:2,consumed:0,active:1});
 assert.equal(await jobs(c),0);assert.equal(await terminal(c),1);
 assert.deepEqual(c.transport.bodies.filter(x=>x.path.endsWith('/capture')),[]);
});

test('A3 after the limit without work releases in Account and restores both bases without a job or capture',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('after_limit');const a=await a3(c,{ageMs:30*60*1000});
 const r=await c.ai.drainExternalBilling();

 assert.equal(r.intentsRecovered,1);assert.equal(r.intentsFailed,0);
 assert.equal((await intentRow(c,a.requestKey)).state,'closed');
 assert.deepEqual(await balance(c),{unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0});
 assert.deepEqual(await localBalance(c),{credited:40,available:40,reserved:0,consumed:0,active:0});
 assert.equal(await jobs(c),0);assert.equal(await terminal(c),1);assert.equal(await releaseRows(c),0);
 assert.deepEqual(await c.transport.bodies.filter(x=>x.path.endsWith('/capture')),[]);
});

test('A3 real rescheduled intent resolves after the limit',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('rescheduled');const a=await a3(c,{ageMs:30*60*1000});
 await intentRef(c,a.requestKey).update({attempts:5,nextAttemptAt:Date.now()-1000});
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,1);assert.equal(r.intentsFailed,0);
 const row=await intentRow(c,a.requestKey);assert.equal(row.state,'closed');assert.equal(row.attempts,5);
 assert.deepEqual(await balance(c),{unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0});
});

test('A3 work appearing between read and fence returns job_created and does not release',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('job_created');const a=await a3(c,{ageMs:30*60*1000});
 const original=c.backend.claimExternalBillingRelease.bind(c.backend);
 // The requester wins the race: a real external job with the same billing tuple appears before the fence.
 c.backend.claimExternalBillingRelease=async(...args)=>{await c.backend.reserve(c.account,c.input,a.requestKey,2,'translation:en',1,AI_CATALOG_VERSION,a.billing,undefined,c.uid);return original(...args);};
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,1);assert.equal(r.intentsFailed,0);
 // The reservation stays with the job that won the race: it is held, not released.
 assert.deepEqual(await balance(c),{unit:'video_seconds',credited:40,available:38,reserved:2,consumed:0,active:1});
 assert.equal(await jobs(c),1);
});

test('A3 Account inherited reservation or stored admission becomes needs_review with balance intact',{timeout:WORK_TIMEOUT_MS},async()=>{
 for(const mode of ['inherited','admission']){
  const c=await fixture('conflict_'+mode);const a=await a3(c,{ageMs:30*60*1000});
   if(mode==='inherited')await reservationDoc(c,a.billing.reservationId).update({admissionProtocol:1});
   else await c.store.admitVideoCall(c.identity,a.billing.reservationId,2,randomUUID(),randomUUID(),'text-window:0001','gemini-3.8-flash',sha('synthetic-a3-admission'));
  const before=await balance(c);
  const r=await c.ai.drainExternalBilling();
  assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
  assert.equal((await intentRow(c,a.requestKey)).state,'needs_review');
  assert.deepEqual(await balance(c),before);
 }
});

test('A3 blocked account does not fence or release and leaves balance untouched',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('blocked');const a=await a3(c,{ageMs:30*60*1000});
 await ref(c.root,'billingGuards',c.account).set({accountId:c.account,blocked:true});
 const before=await balance(c),beforeBodies=c.transport.bodies.length;
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 assert.equal((await intentRow(c,a.requestKey)).state,'needs_review');
 assert.deepEqual(await balance(c),before);
 assert.equal(c.transport.bodies.length,beforeBodies);
});

test('A3 two concurrent drains produce one close and one terminal movement',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('concurrent');const a=await a3(c,{ageMs:30*60*1000});
 const [x,y]=await Promise.all([c.ai.drainExternalBilling(),c.ai.drainExternalBilling()]);
 assert.equal(x.intentsRecovered+y.intentsRecovered,1);
 assert.equal((await intentRow(c,a.requestKey)).state,'closed');
 const releases=c.transport.bodies.filter(x=>x.path.endsWith('/release'));
 assert.equal(releases.length,1);
 assert.deepEqual(await balance(c),{unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0});
});

test('A3 later released status closes without a second release; captured status goes to review',{timeout:WORK_TIMEOUT_MS},async()=>{
 for(const state of ['released','captured']){
  const c=await fixture('later_'+state);const a=await a3(c,{ageMs:30*60*1000});
  if(state==='released')await c.store.settleVideo(c.identity,a.billing.reservationId,'release',2);
  else{const jobId=randomUUID(),attemptId=randomUUID();await c.store.admitVideoCall(c.identity,a.billing.reservationId,2,jobId,attemptId,'text-window:0001','gemini-3.8-flash',sha('synthetic-a3-capture-admission'));await c.store.settleVideo(c.identity,a.billing.reservationId,'capture',2,{jobId,attemptId});}
  const before=c.transport.bodies.length;
  const r=await c.ai.drainExternalBilling();
  const row=await intentRow(c,a.requestKey);
  if(state==='released'){assert.equal(r.intentsRecovered,1);assert.equal(r.intentsFailed,0);assert.equal(row.state,'closed');}
  else{assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);assert.equal(row.state,'needs_review');}
  const releasesAfter=c.transport.bodies.slice(before).filter(x=>x.path.endsWith('/release')||x.path.endsWith('/seal'));
  assert.deepEqual(releasesAfter,[],'a later status must not issue a second release or seal');
 }
});

test('A3 invalid createdAtMs never fences and leaves the pass intact',{timeout:WORK_TIMEOUT_MS},async()=>{
 for(const bad of [undefined,'text',-1,Date.now()+11*60*1000]){
  const c=await fixture('bad_clock');const a=await a3(c,{ageMs:30*60*1000});
  if(bad===undefined)await intentRef(c,a.requestKey).update({createdAtMs:FieldValue.delete()});
  else await intentRef(c,a.requestKey).update({createdAtMs:bad});
  const before=await intentRow(c,a.requestKey),beforeBalance=await balance(c),beforeBodies=c.transport.bodies.length;
  const r=await c.ai.drainExternalBilling();
  assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
  const after=await intentRow(c,a.requestKey);assert.equal(after.state,'reserve_pending');assert.equal(after.reviewReason,undefined);
  assert.equal(after.attempts,before.attempts+1);assert.equal(after.lastErrorCode,'reserved_unconfirmed');
  assert.deepEqual(await balance(c),beforeBalance);
  const fencedBodies=c.transport.bodies.slice(beforeBodies).filter(x=>x.path.endsWith('/release')||x.path.endsWith('/seal'));
  assert.deepEqual(fencedBodies,[],'an invalid clock must never fence');
 }
});

test('A3 local identity revocation before the limit does not release',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('revoked');const a=await a3(c,{ageMs:1000});
 await ref(c.root,'identities',c.identity).delete();
 const before=await balance(c);
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 const row=await intentRow(c,a.requestKey);assert.notEqual(row.state,'closed');assert.notEqual(row.state,'job_created');
 assert.deepEqual(await balance(c),before);
 assert.deepEqual(c.transport.bodies.filter(x=>x.path.endsWith('/release')||x.path.endsWith('/seal')),[]);
});


test('A3 overdue with a benign intent write between read and evidence capture is not closed to review',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('evidence_version_race');const a=await a3(c,{ageMs:30*60*1000});
 const original=c.backend.captureExternalBillingIntentFailureEvidence.bind(c.backend);let bumped=false;
 c.backend.captureExternalBillingIntentFailureEvidence=async(...args)=>{if(!bumped){bumped=true;await a.intent.update({probe:1});}return original(...args);};
 const before=await balance(c);
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 const row=await intentRow(c,a.requestKey);assert.equal(row.state,'reserve_pending');assert.equal(row.reviewReason,undefined);
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);
 assert.equal(row.attempts,2);assert.equal(row.lastErrorCode,'unavailable');
 assert.deepEqual(await balance(c),before);
 assert.deepEqual(c.transport.bodies.filter(x=>x.path.endsWith('/release')||x.path.endsWith('/seal')),[]);
});

test('A3 overdue with an existing work request is not closed to review',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('evidence_request');const a=await a3(c,{ageMs:30*60*1000});
 await ref(c.root,'requests',sha(JSON.stringify([c.account,a.requestKey]))).create({synthetic:'work-request'});
 const before=await balance(c);
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 const row=await intentRow(c,a.requestKey);assert.equal(row.state,'reserve_pending');assert.equal(row.reviewReason,undefined);
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);
 assert.deepEqual(await balance(c),before);
 assert.deepEqual(c.transport.bodies.filter(x=>x.path.endsWith('/release')||x.path.endsWith('/seal')),[]);
});

test('A3 overdue blocked account closes to review with an incident and no hold or extra guard',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('blocked_incident');const a=await a3(c,{ageMs:30*60*1000});
 await ref(c.root,'billingGuards',c.account).set({accountId:c.account,blocked:true});
 const before=await balance(c),beforeLocal=await localBalance(c),beforeHold=(await c.root.collection('billingHoldOutbox').get()).size;
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 const row=await intentRow(c,a.requestKey);assert.equal(row.state,'needs_review');assert.equal(row.reviewReason,'direct_status_uncertain');
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,1);
 assert.deepEqual(await balance(c),before);
 assert.deepEqual(await localBalance(c),beforeLocal);
 assert.equal((await c.root.collection('billingHoldOutbox').get()).size,beforeHold);
 assert.deepEqual((await ref(c.root,'billingGuards',c.account).get()).data(),{accountId:c.account,blocked:true});
 assert.deepEqual(c.transport.bodies.filter(x=>x.path.endsWith('/release')||x.path.endsWith('/seal')),[]);
});

test('A3 overdue release_pending with a blocked account is not closed to review',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('release_pending_blocked');const a=await a3(c,{ageMs:30*60*1000});
 await a.intent.update({state:'release_pending'});
 await ref(c.root,'billingGuards',c.account).set({accountId:c.account,blocked:true});
 const before=await balance(c);
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 const row=await intentRow(c,a.requestKey);assert.equal(row.state,'release_pending');
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);
 assert.deepEqual(await balance(c),before);

});

async function releasePending(c,options={}){
 const pending=await a3(c,{ageMs:30*60*1000,...options});
 assert.deepEqual(await c.backend.claimExternalBillingRelease(c.account,pending.requestKey,pending.billing),{state:'release_pending',transitioned:true});
 await pending.intent.update({attempts:7,nextAttemptAt:0});
 return pending;
}

async function blockVideo(c){
 const guard=ref(c.root,'billingGuards',c.account),now=Date.now();
 await guard.create({accountId:c.account,blocked:true,epoch:1,createdAtMs:now,updatedAtMs:now,lastIncidentId:sha('synthetic-other-incident')});
 return guard;
}

test('E-4 a due release pauses across drain passes at the retry limit and remains visible',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('due_release_paused'),pending=await releasePending(c);
 const guard=await blockVideo(c);
 const before=await pending.intent.get();
 assert.equal(before.get('state'),'release_pending');
 assert.equal(before.get('attempts'),7);
 const accountBefore=await balance(c),videoBefore=await localBalance(c);

 for(let pass=0;pass<3;pass++){
  await c.ai.drainExternalBilling();
  const after=await pending.intent.get();
  assert.deepEqual(after.data(),before.data());
  assert.equal(after.updateTime.isEqual(before.updateTime),true);
  assert.deepEqual(await balance(c),accountBefore);
  assert.deepEqual(await localBalance(c),videoBefore);
 }
 assert.deepEqual(c.transport.bodies,[]);
 assert.equal(await terminal(c),0);
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);

 const now=Date.now(),report=await readPendingReport(c.root,now);
 const intentRow=report.rows.find(row=>row.kind==='intent'&&row.id===pending.intent.id);
 assert.equal(intentRow?.state,'release_pending');
 assert.equal(intentRow?.attempts,7);
 assert.equal(report.rows.find(row=>row.kind==='guard'&&row.id===c.account)?.attention,'needs_review');
 await raisePendingAlerts(c.db,c.root,report,now);
 const alerts=await c.root.collection(ALERT_COLLECTION).get();
 assert.equal(alerts.docs.filter(doc=>doc.get('kind')==='guard').length,1);

 // Lift the synthetic Video-only guard; the audited unblock itself is covered separately.
 await guard.delete();
 await c.ai.drainExternalBilling();
 await c.ai.drainExternalBilling();
 assert.equal((await pending.intent.get()).get('state'),'closed');
 assert.deepEqual(await balance(c),{unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0});
 assert.deepEqual(await localBalance(c),videoBefore);
 assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/release')).length,1);
 assert.equal(c.transport.bodies.some(call=>call.path.endsWith('/capture')),false);
});

test('E-4 the same due release at seven attempts finishes on the first unblocked pass',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('due_release_open'),pending=await releasePending(c);
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,1);
 assert.equal((await pending.intent.get()).get('state'),'closed');
 assert.deepEqual(await balance(c),{unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0});
 assert.deepEqual(await localBalance(c),{credited:40,available:40,reserved:0,consumed:0,active:0});
 assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/release')).length,1);
 assert.equal(c.transport.bodies.some(call=>call.path.endsWith('/capture')),false);
});

test('E-4 the 1.6c age sweep preserves a blocked release and the executor releases it after reopening',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('aged_release_blocked'),pending=await releasePending(c);
 const guard=await blockVideo(c),now=Date.now();
 await pending.intent.update({createdAtMs:now-EXTERNAL_BILLING_MAX_AGE_MS-1});
 const before=await pending.intent.get(),accountBefore=await balance(c),videoBefore=await localBalance(c);
 const pass=()=>runBillingDrainSection({...c,enabled:true,now,clock:()=>now,log:()=>{}});

 // Run the same age section that follows intent draining in a periodic pass.
 const blocked=await pass();
 assert.equal(blocked.staleEscalated,0);
 const cursors=await ref(c.root,'billingDrainLease','cursors').get();
 assert.ok(Object.hasOwn(cursors.data()??{},'age'));
 const after=await pending.intent.get();
 assert.deepEqual(after.data(),before.data());
 assert.equal(after.updateTime.isEqual(before.updateTime),true);
 assert.deepEqual(c.transport.bodies,[]);
 assert.deepEqual(await balance(c),accountBefore);
 assert.deepEqual(await localBalance(c),videoBefore);
 const report=await readPendingReport(c.root,now);
 assert.equal(report.rows.find(row=>row.kind==='intent'&&row.id===pending.intent.id)?.state,'release_pending');
 await raisePendingAlerts(c.db,c.root,report,now,{ageThresholdMs:EXTERNAL_BILLING_MAX_AGE_MS});
 const alerts=(await c.root.collection(ALERT_COLLECTION).get()).docs.map(doc=>doc.data());
 assert.equal(alerts.filter(row=>row.kind==='intent'&&row.rowId===pending.intent.id&&row.reason==='age'&&row.status==='open').length,1);

 // Remove the synthetic Video guard once the safety checks above have passed.
 await guard.delete();
 // The age cursor can reach the row again before the independent intent cursor comes around.
 assert.equal((await c.backend.escalateStaleBillingRows({now,limit:25})).escalated,0);
 // This single row is the exclusive cursor. Finishing the rotation clears it for the following pass.
 assert.equal((await pass()).intentsRecovered,0);
 assert.equal((await pending.intent.get()).get('state'),'release_pending');
 assert.equal((await pass()).intentsRecovered,1);
 await pass();
 assert.equal((await pending.intent.get()).get('state'),'closed');
 assert.equal((await c.store.videoReservation(c.identity,pending.billing.reservationId)).state,'released');
 assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/release')).length,1);
 assert.deepEqual(await balance(c),{unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0});
 assert.deepEqual(await localBalance(c),videoBefore);
});

test('E-4 an uncertain release gets one finite recovery window after the guard clears and a default review alert',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('bounded_uncertain_release'),pending=await releasePending(c),foreign=await c.backend.accountForUid('foreign-'+randomUUID());
 const now=Date.now(),maxAgeMs=EXTERNAL_BILLING_MAX_AGE_MS;
 await pending.intent.update({createdAtMs:now-maxAgeMs-10});
 const attemptsBefore=(await pending.intent.get()).get('attempts'),balanceBefore=await balance(c),videoBefore=await localBalance(c);
 const claim=c.backend.claimDirectTerminalDispatch.bind(c.backend);
 c.backend.claimDirectTerminalDispatch=async(...args)=>{
  assert.equal(await claim(...args),'send');
  return 'changed'; // Simulate a stopped drainer after the durable claim and before sending.
 };
 try{await c.ai.drainExternalBilling();}finally{c.backend.claimDirectTerminalDispatch=claim;}
 const [dispatch]=(await c.root.collection('billingIntentDispatchClaims').get()).docs;
 assert.equal(dispatch.get('state'),'possibly_sent');
 const waiting=await pending.intent.get(),guard=await blockVideo(c);
 const sweep=time=>c.backend.escalateStaleBillingRows({now:time,maxAgeMs,limit:25});
 assert.equal((await sweep(now)).escalated,0);
 const reopenedAt=now+3*maxAgeMs;
 assert.equal((await sweep(reopenedAt)).escalated,0);
 assert.equal((await pending.intent.get()).updateTime.isEqual(waiting.updateTime),true);
 await guard.delete();
 assert.equal((await sweep(reopenedAt)).escalated,0);
 await c.ai.drainExternalBilling();
 assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/resolution')).length,1);
 assert.equal((await pending.intent.get()).updateTime.isEqual(waiting.updateTime),true);
 for(const elapsed of [1,maxAgeMs/2,maxAgeMs])assert.equal((await sweep(reopenedAt+elapsed)).escalated,0);
 const expired=reopenedAt+maxAgeMs+1;
 assert.equal((await sweep(expired)).escalated,1);
 assert.equal((await sweep(expired+1)).escalated,0);
 const reviewed=await pending.intent.get();
 assert.equal(reviewed.get('state'),'needs_review');assert.equal(reviewed.get('reviewReason'),'max_age');
 assert.equal(reviewed.get('attempts'),attemptsBefore);
 assert.deepEqual((await dispatch.ref.get()).data(),dispatch.data());
 await c.ai.drainExternalBilling();
 assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/release')||call.path.endsWith('/capture')).length,0);
 assert.equal((await c.accountRoot.collection('ledgerEntries').where('kind','==','video_release').get()).size,0);
 const report=await readPendingReport(c.root,expired);
 await raisePendingAlerts(c.db,c.root,report,expired);
 await raisePendingAlerts(c.db,c.root,report,expired+1);
 const alerts=(await c.root.collection(ALERT_COLLECTION).get()).docs;
 assert.equal(alerts.filter(doc=>doc.get('rowId')===pending.intent.id&&doc.get('reason')==='needs_review'&&doc.get('status')==='open').length,1);
 assert.equal((await ref(c.root,'billingGuards',foreign).get()).exists,false);
 assert.deepEqual(await balance(c),balanceBefore);assert.deepEqual(await localBalance(c),videoBefore);
});
test('E-4 the 1.6c age sweep alerts on a stale unblocked release whose retry is still in the future',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('aged_release_open'),pending=await releasePending(c),now=Date.now();
 // Keep the retry waiting so this pass exercises the age limit before the release can settle.
 await pending.intent.update({createdAtMs:now-EXTERNAL_BILLING_MAX_AGE_MS-1,nextAttemptAt:now+24*60*60*1000});
 const accountBefore=await balance(c);
 const pass=await runBillingDrainSection({...c,enabled:true,now,clock:()=>now,log:()=>{}});
 assert.equal(pass.staleEscalated,1);
 const after=await pending.intent.get();
 assert.equal(after.get('state'),'needs_review');
 assert.equal(after.get('reviewReason'),'max_age');
 const report=await readPendingReport(c.root,now);
 await raisePendingAlerts(c.db,c.root,report,now);
 const alerts=(await c.root.collection(ALERT_COLLECTION).get()).docs.map(doc=>doc.data());
 assert.equal(alerts.filter(row=>row.kind==='intent'&&row.rowId===pending.intent.id&&row.reason==='needs_review'&&row.status==='open').length,1);
 assert.deepEqual(c.transport.bodies,[]);
 assert.deepEqual(await balance(c),accountBefore);
 assert.equal((await ref(c.root,'billingGuards',c.account).get()).exists,false);
});

test('E-4 two drains reading the same release_pending reservation preserve one confirmation without a false incident',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('release_pending_concurrent'),pending=await releasePending(c);
 const firstRead=Promise.withResolvers(),bothRead=Promise.withResolvers(),resumeSecond=Promise.withResolvers();
 const firstPrepared=Promise.withResolvers(),resumeFirst=Promise.withResolvers(),observed=[];
 const request=c.transport.request,capture=c.backend.captureDirectObservation;
 let firstReleaseSnapshot=true;
 assert.equal(await terminal(c),0);

 // Both drains see the same Account reservation before either can prepare a release witness.
 c.transport.request=async call=>{
  const response=await request.call(c.transport,call);
  if(new URL(call.url).pathname.endsWith('/status')){
   if(observed.push(response.data)===1){
    firstRead.resolve();
    await bounded(bothRead.promise,30000,'second drain reads Account');
   }else{
    bothRead.resolve();
    await bounded(resumeSecond.promise,30000,'resume second drain after first prepares release');
   }
  }
  return response;
 };
 c.backend.captureDirectObservation=async(...args)=>{
  if(args[2]==='release'&&firstReleaseSnapshot){
   firstReleaseSnapshot=false;
   firstPrepared.resolve();
   await bounded(resumeFirst.promise,30000,'resume first drain after second compares history');
  }
  return capture.apply(c.backend,args);
 };

 const first=c.ai.drainExternalBilling();
 first.catch(()=>undefined);
 let second;
 try{
  await bounded(firstRead.promise,30000,'first drain reads Account');
  second=c.ai.drainExternalBilling();
  second.catch(()=>undefined);
  await bounded(firstPrepared.promise,30000,'first drain prepares release');
  assert.equal(await terminal(c),1);
  resumeSecond.resolve();
  await bounded(second,30000,'second drain completes');
 }finally{
  bothRead.resolve();
  resumeSecond.resolve();
  resumeFirst.resolve();
  try{await bounded(Promise.allSettled(second?[first,second]:[first]),30000,'both drains finish');}
  finally{
   c.transport.request=request;
   c.backend.captureDirectObservation=capture;
  }
 }

 const expected={reservationId:pending.billing.reservationId,seconds:2,state:'reserved'};
 assert.deepEqual(observed,[expected,expected]);
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);
 assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
 assert.equal((await ref(c.root,'billingGuards',c.account).get()).exists,false);
 const closed=await pending.intent.get();
 assert.equal(closed.get('state'),'closed');
 assert.equal(closed.get('releaseConfirmed'),true);
 assert.equal(closed.get('releaseReservationId'),pending.billing.reservationId);
 assert.equal(closed.get('releaseSeconds'),2);
 assert.equal((await c.store.videoReservation(c.identity,pending.billing.reservationId)).state,'released');
 const ledger=await c.accountRoot.collection('ledgerEntries').where('kind','==','video_release').get();
 assert.equal(ledger.size,1);
 assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/release')).length,1);
 assert.equal(ledger.docs[0].get('seconds'),2);
 assert.deepEqual(await balance(c),{unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0});
 assert.equal(c.transport.bodies.some(call=>call.path.endsWith('/capture')),false);
});

for(const action of ['release','seal']){
 test(`E-4 a lost ${action} ACK is recovered without a duplicate mutation`,{timeout:WORK_TIMEOUT_MS},async()=>{
  const c=await fixture('lost_terminal_ack'),pending=await releasePending(c,{reserveInAccount:action==='release'});
  const request=c.transport.request.bind(c.transport);let lost=false;
  c.transport.request=async call=>{
   const response=await request(call);
   if(!lost&&new URL(call.url).pathname.endsWith('/'+action)){lost=true;throw new Error('synthetic lost ACK after commit');}
   return response;
  };
  await c.ai.drainExternalBilling();
  assert.equal(lost,true);
  await pending.intent.update({nextAttemptAt:0});
  await c.ai.drainExternalBilling();
  const row=await pending.intent.get();
  assert.equal(row.get('state'),'closed');
  assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/'+action)).length,1);
  if(action==='seal')assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/resolution')).length,1);
  assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
  assert.equal((await c.accountRoot.collection('ledgerEntries').where('kind','==','video_release').get()).size,action==='release'?1:0);
 });
}
test('E-4 a prepared release can resume before dispatch, and unresolved delivery never sends it again',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('prepared_no_send'),pending=await releasePending(c);
 const capture=c.backend.captureDirectObservation.bind(c.backend);
 c.backend.captureDirectObservation=(...args)=>args[2]==='release'?Promise.resolve(null):capture(...args);
 await c.ai.drainExternalBilling();c.backend.captureDirectObservation=capture;
 assert.equal(await terminal(c),1);
 let attempted=0;const request=c.transport.request.bind(c.transport);
 c.transport.request=call=>{
  if(new URL(call.url).pathname.endsWith('/release')){attempted++;throw new Error('synthetic ambiguous delivery');}
  return request(call);
 };
 await c.ai.drainExternalBilling();
 await pending.intent.update({nextAttemptAt:0});
 await c.ai.drainExternalBilling();
 assert.equal(attempted,1);
 assert.equal((await pending.intent.get()).get('state'),'release_pending');
 assert.equal((await c.store.videoReservation(c.identity,pending.billing.reservationId)).state,'reserved');
 assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/resolution')).length,1);
 assert.equal((await c.accountRoot.collection('ledgerEntries').where('kind','==','video_release').get()).size,0);
});
for(const history of ['original','rewritten','tampered claim']){
 test(`E-4 two readers of an already prepared release finish after ${history} closure`,{timeout:WORK_TIMEOUT_MS},async()=>{
  const c=await fixture('already_prepared_late_reader'),pending=await releasePending(c);
  const capture=c.backend.captureDirectObservation.bind(c.backend);
  c.backend.captureDirectObservation=(...args)=>args[2]==='release'?Promise.resolve(null):capture(...args);
  try{await c.ai.drainExternalBilling();}finally{c.backend.captureDirectObservation=capture;}
  assert.equal(await terminal(c),1);
  const claims=await c.root.collection('billingIntentDispatchClaims').get();
  assert.deepEqual(claims.docs.map(doc=>doc.get('state')),['unsent']);
  const firstResponse=Promise.withResolvers(),resume=Promise.withResolvers(),statuses=[];
  const request=c.transport.request.bind(c.transport);
  c.transport.request=async call=>{
   const response=await request(call);
   // The close subsequently updates the claim and the intent in the SAME commit, concealing its previous update time.
   if(history==='tampered claim'&&new URL(call.url).pathname.endsWith('/release'))await claims.docs[0].ref.update({history:'f'.repeat(64)});
   if(new URL(call.url).pathname.endsWith('/status')){
    statuses.push(response.data.state);
    if(statuses.length===1){firstResponse.resolve();await bounded(resume.promise,30000,'release delayed status');}
   }
   return response;
  };
  const delayed=c.ai.drainExternalBilling();delayed.catch(()=>undefined);
  try{
   await bounded(firstResponse.promise,30000,'read reserved on already prepared action');
   assert.equal((await c.ai.drainExternalBilling()).intentsRecovered,1);
   assert.equal((await pending.intent.get()).get('state'),'closed');
   if(history==='rewritten')await pending.intent.update({updatedAtMs:1});
  }finally{
   resume.resolve();
   try{await bounded(delayed,30000,'old prepared response finishes');}finally{c.transport.request=request;}
  }
  assert.deepEqual(statuses,['reserved','reserved']);
  assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/release')).length,1);
  assert.equal((await c.accountRoot.collection('ledgerEntries').where('kind','==','video_release').get()).size,1);
  assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,history==='original'?0:1);
  assert.equal((await ref(c.root,'billingGuards',c.account).get()).exists,history!=='original');
  if(history==='original')assert.equal((await pending.intent.get()).get('state'),'closed');
 });
}
for(const rewritten of [false,true]){
 test(`E-4 delayed reserved observation after ${rewritten?'rewritten':'original'} confirmed close`,{timeout:WORK_TIMEOUT_MS},async()=>{
  const c=await fixture('delayed_status'),pending=await releasePending(c);
  const witness=await c.backend.externalIntentWitness(c.account,pending.requestKey,pending.billing);
  const old=await c.backend.captureDirectObservation(witness,pending.requestKey,'status');
  assert.ok(old);
  assert.equal((await c.store.videoReservation(c.identity,pending.billing.reservationId)).state,'reserved');
  assert.equal((await c.ai.drainExternalBilling()).intentsRecovered,1);
  if(rewritten)await pending.intent.update({updatedAtMs:1});
  await c.backend.prepareTerminalFromDirectObservation(witness,pending.requestKey,'release','status_reserved',old);
  assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,rewritten?1:0);
  assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/release')).length,1);
 });
}
test('E-4 a prepared witness cannot excuse a concurrent change to the earlier observation',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('different_history'),pending=await releasePending(c);
 const witness=await c.backend.externalIntentWitness(c.account,pending.requestKey,pending.billing);
 const old=await c.backend.captureDirectObservation(witness,pending.requestKey,'status');
 assert.ok(old);
 await ref(c.root,'projects',c.input).update({draft:'changed before other observer'});
 const later=await c.backend.captureDirectObservation(witness,pending.requestKey,'status');
 assert.ok(later);
 assert.equal((await c.backend.prepareTerminalFromDirectObservation(witness,pending.requestKey,'release','status_reserved',later)).state,'ready');
 assert.equal((await c.backend.prepareTerminalFromDirectObservation(witness,pending.requestKey,'release','status_reserved',old)).state,'changed');
 assert.equal((await pending.intent.get()).get('state'),'needs_review');
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,1);
 assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/release')).length,0);
});
test('E-4 a block observed before reopening never consumes a release attempt',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('observed_block_reopened'),pending=await releasePending(c);
 const guard=await blockVideo(c),before=await pending.intent.get();
 const capture=c.backend.captureExternalBillingIntentFailureEvidence.bind(c.backend);
 c.backend.captureExternalBillingIntentFailureEvidence=async(...args)=>{
  const result=await capture(...args);
  await guard.delete();
  return result;
 };
 await c.ai.drainExternalBilling();
 c.backend.captureExternalBillingIntentFailureEvidence=capture;
 const after=await pending.intent.get();
 assert.deepEqual(after.data(),before.data());
 assert.equal(after.updateTime.isEqual(before.updateTime),true);
 assert.deepEqual(c.transport.bodies,[]);
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);
 await c.ai.drainExternalBilling();
 assert.equal((await pending.intent.get()).get('state'),'closed');
 assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/release')).length,1);
 assert.equal(c.transport.bodies.some(call=>call.path.endsWith('/capture')),false);
});

test('E-4 a block during the status snapshot never consumes a release attempt after reopening',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('status_snapshot_block_reopened'),pending=await releasePending(c),before=await pending.intent.get();
 const capture=c.backend.captureDirectObservation.bind(c.backend);
 c.backend.captureDirectObservation=async(...args)=>{
  if(args[2]!=='status')return capture(...args);
  const guard=await blockVideo(c);
  const result=await capture(...args);
  await guard.delete();
  return result;
 };
 await c.ai.drainExternalBilling();
 c.backend.captureDirectObservation=capture;
 const after=await pending.intent.get();
 assert.deepEqual(after.data(),before.data());
 assert.equal(after.updateTime.isEqual(before.updateTime),true);
 assert.deepEqual(c.transport.bodies,[]);
 await c.ai.drainExternalBilling();
 assert.equal((await pending.intent.get()).get('state'),'closed');
 assert.equal(c.transport.bodies.filter(call=>call.path.endsWith('/release')).length,1);
 assert.equal(c.transport.bodies.some(call=>call.path.endsWith('/capture')),false);
});

for(const changeHistory of [false,true]){
 test(`E-4 a block after Account status ${changeHistory?'preserves review when history also changes':'only pauses an unchanged release'}`,{timeout:WORK_TIMEOUT_MS},async()=>{
  const c=await fixture('release_status_race'),pending=await releasePending(c);
  const originalRequest=c.transport.request.bind(c.transport);
  c.transport.request=async request=>{
   const response=await originalRequest(request);
   if(new URL(request.url).pathname.endsWith('/status')){
    assert.equal(response.data.state,'reserved');
    await blockVideo(c);
    if(changeHistory)await ref(c.root,'projects',c.input).update({draft:'A3 synthetic changed draft'});
   }
   return response;
  };
  const before=await pending.intent.get(),accountBefore=await balance(c),videoBefore=await localBalance(c);

  await c.ai.drainExternalBilling();

  const after=await pending.intent.get();
  assert.deepEqual(await balance(c),accountBefore);
  assert.deepEqual(await localBalance(c),videoBefore);
  assert.deepEqual(c.transport.bodies.map(call=>call.path.split('/').at(-1)),['status']);
  assert.equal(await terminal(c),0);
  const observations=await c.root.collection('billingIntentObservationIncidents').get();
  const admissionGuard=await ref(c.root,'billingIntentAdmissionGuards',pending.intent.id).get();
  if(changeHistory){
   assert.equal(after.get('state'),'needs_review');
   assert.equal(after.get('reviewReason'),'direct_status_uncertain');
   assert.equal(after.get('attempts'),7);
   assert.equal(observations.size,1);
   assert.equal(observations.docs[0].get('kind'),'direct_status_uncertainty');
   assert.equal(observations.docs[0].get('state'),'needs_review');
   assert.equal(admissionGuard.get('state'),'needs_review');
   assert.equal((await incident(c,pending.requestKey)).reason,'direct_status_uncertain');
  }else{
   assert.deepEqual(after.data(),before.data());
   assert.equal(after.updateTime.isEqual(before.updateTime),true);
   assert.equal(observations.size,0);
   assert.notEqual(admissionGuard.get('state'),'needs_review');
   assert.equal(await incident(c,pending.requestKey),undefined);
  }
 });
}

test('E-4 a block after Account status not_found defers the seal without adding an incident',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('release_status_missing_blocked'),pending=await releasePending(c,{reserveInAccount:false});
 const reservationId=pending.billing.reservationId,request=c.transport.request;
 const tomb=ref(c.accountRoot,'videoReservationTombstones',sha(JSON.stringify([c.accountOwner,reservationId])));
 const before=await pending.intent.get(),accountBefore=await balance(c),videoBefore=await localBalance(c);
 const ledger=c.accountRoot.collection('ledgerEntries'),entriesBefore=(await ledger.get()).size;
 let guardAtRead;

 // Account returns a real not_found. The Video guard arrives after that read and before the seal decision.
 c.transport.request=async call=>{
  try{return await request.call(c.transport,call);}
  catch(error){
   if(new URL(call.url).pathname.endsWith('/status')&&error.response?.data?.error==='not_found'){
    guardAtRead=await (await blockVideo(c)).get();
   }
   throw error;
  }
 };
 try{await c.ai.drainExternalBilling();}
 finally{c.transport.request=request;}

 assert.ok(guardAtRead);
 const guardNow=await guardAtRead.ref.get(),after=await pending.intent.get();
 assert.equal(guardNow.updateTime.isEqual(guardAtRead.updateTime),true);
 assert.deepEqual(after.data(),before.data());
 assert.equal(after.updateTime.isEqual(before.updateTime),true);
 assert.deepEqual(c.transport.bodies.map(call=>call.path.split('/').at(-1)),['status']);
 assert.equal((await tomb.get()).exists,false);
 assert.equal(await terminal(c),0);
 assert.equal((await c.root.collection('billingIntentObservationIncidents').get()).size,0);
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);
 assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
 assert.deepEqual(await balance(c),accountBefore);
 assert.deepEqual(await localBalance(c),videoBefore);
 assert.equal((await ledger.get()).size,entriesBefore);

 await guardAtRead.ref.delete();
 assert.equal((await c.ai.drainExternalBilling()).intentsRecovered,1);
 await c.ai.drainExternalBilling();
 const closed=await pending.intent.get();
 assert.equal(closed.get('state'),'closed');
 assert.equal(closed.get('sealConfirmed'),true);
 assert.equal(closed.get('sealReservationId'),reservationId);
 assert.equal((await tomb.get()).get('state'),'sealed');
 assert.deepEqual(c.transport.bodies.map(call=>call.path.split('/').at(-1)),['status','status','seal']);
 assert.equal((await ledger.get()).size,entriesBefore);
 assert.deepEqual(await balance(c),accountBefore);
});

for(const incompatible of ['review','hold','hold_epoch']){
 const wrongEpoch=incompatible==='hold_epoch';
 const scenario=wrongEpoch?'hold with a divergent epoch':incompatible;
 test(`D1 direct observation preserves an incompatible prior ${scenario} and reports the exact problem`,{timeout:WORK_TIMEOUT_MS},async()=>{
  const c=await fixture('direct_incompatible_'+incompatible),pending=await releasePending(c),foreign=await otherAccount(c);
  const sourceId=pending.intent.id,createdAtMs=Date.now(),epoch=2;
  const ownerGuard=ref(c.root,'billingGuards',c.account),foreignGuard=ref(c.root,'billingGuards',foreign.account);
  const reviewRef=ref(c.root,'billingReviewIncidents',sourceId);
  const holdId=accountHoldId('intent',sourceId,epoch,createdAtMs);
  const holdRef=ref(c.root,'billingHoldOutbox',holdId);
  const prior=incompatible==='review'?reviewRef:holdRef;
  let seeded;
  const request=c.transport.request.bind(c.transport);
  c.transport.request=async outgoing=>{
   const answer=await request(outgoing);
   if(!new URL(outgoing.url).pathname.endsWith('/status'))return answer;
   assert.equal(answer.data.state,'reserved');
   assert.equal(answer.data.seconds,pending.billing.seconds);
   // Interleave after Cuenta returns status. A new owner guard plus a changed
   // project makes this different from a benign pause on an otherwise intact read.
   const changes=c.db.batch();
   changes.create(ownerGuard,{accountId:c.account,blocked:true,epoch:1,createdAtMs,updatedAtMs:createdAtMs,
    lastIncidentId:sha('synthetic previous guard incident')});
   changes.update(ref(c.root,'projects',c.input),{draft:'Synthetic changed project after status'});
   if(incompatible==='review'){
    changes.create(reviewRef,{accountId:foreign.account,identityKey:foreign.identityKey,intentId:sourceId,
     inputId:c.input,reservationId:pending.billing.reservationId,expectedSeconds:pending.billing.seconds,
     reason:'synthetic_foreign_review',createdAtMs});
   }else{
    // In the generation-only case the ID and the whole identity tuple still match.
    changes.create(holdRef,{id:holdId,accountId:wrongEpoch?c.account:foreign.account,identityKey:wrongEpoch?c.identity:foreign.identityKey,
     sourceKind:'intent',sourceId,epoch:wrongEpoch?epoch+1:epoch,createdAtMs,state:'pending',nextAttemptAt:0,attempts:0});
   }
   await changes.commit();
   seeded=await prior.get();
   return answer;
  };
  const accountBefore=await balance(c),videoBefore=await localBalance(c);
  const foreignBefore=await c.store.videoBalance(foreign.identityKey),foreignVideoBefore=await c.backend.readBalance(foreign.account);
  const ledgerBefore=(await c.accountRoot.collection('ledgerEntries').get()).docs.map(document=>document.data());
  const outcome=await c.ai.drainExternalBilling();
  assert.equal(outcome.intentsFailed,1);
  assert.equal(outcome.intentsRecovered,0);
  assert.ok(seeded?.exists);
  const persisted=await prior.get();
  assert.deepEqual(persisted.data(),seeded.data());
  assert.ok(persisted.updateTime.isEqual(seeded.updateTime),'The observation writer did not rewrite the incompatible row');
  const held=await ownerGuard.get();
  assert.equal(held.get('accountId'),c.account);
  assert.equal(held.get('blocked'),true);
  assert.equal(held.get('epoch'),epoch);
  assert.equal(held.get('createdAtMs'),createdAtMs);
  assert.equal(held.get('lastIncidentId'),sourceId);
  assert.equal((await pending.intent.get()).get('state'),'needs_review');
  const admission=await ref(c.root,'billingIntentAdmissionGuards',sourceId).get();
  assert.equal(admission.get('state'),'needs_review');
  const observation=await ref(c.root,'billingIntentObservationIncidents',admission.get('incidentId')).get();
  assert.equal(observation.get('attribution'),'verified');
  assert.equal(observation.get('ownerBlocked'),true);
  assert.equal(observation.get('observedState'),'reserved');
  assert.equal(observation.get('source'),'status');
  const holdCount=(await c.root.collection('billingHoldOutbox').get()).size;
  assert.equal(holdCount,incompatible==='review'?0:1,'The writer did not create a second hold');
  // The hold drainer may quarantine the old row, but must never send it.
  await c.ai.drainExternalHolds();
  assert.deepEqual(c.transport.bodies.map(call=>[call.path.split('/').at(-1),call.body.identityKey]),[['status',c.identity]]);
  assert.equal((await foreignGuard.get()).exists,false);
  assert.deepEqual(await balance(c),accountBefore);
  assert.deepEqual(await localBalance(c),videoBefore);
  assert.deepEqual(await c.store.videoBalance(foreign.identityKey),foreignBefore);
  assert.deepEqual(await c.backend.readBalance(foreign.account),foreignVideoBefore);
  assert.deepEqual((await c.accountRoot.collection('ledgerEntries').get()).docs.map(document=>document.data()),ledgerBefore);
  assert.equal((await c.root.collection('movements').get()).size,0);
  assert.equal(observation.get('holdProblem'),incompatible==='review'?'invalid_review':'invalid_hold');
 });
}

test('D3 default sweep alerts on a due invalid provider with a future integer creation time without inferring an owner',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('malformed_provider_future_clock'),foreign=await otherAccount(c),now=Date.now();
 const future=now+24*60*60*1000;
 const ahead=await a3(c,{createdAtMs:future,reserveInAccount:false});
 const validDate=await a3(c,{createdAtMs:now-1,reserveInAccount:false});
 const badDate=await a3(c,{reserveInAccount:false});
 const healthy=await a3(c,{createdAtMs:now-1,nextAttemptAt:future,reserveInAccount:false});
 for(const bad of [ahead,validDate,badDate]){
  // The row claims a real synthetic account other than the one in the source
  // witness. Reading accountId from the malformed document is not attribution.
  await bad.intent.update({provider:'invalid_synthetic_provider',accountId:foreign.account});
 }
 await badDate.intent.update({createdAtMs:'synthetic-invalid-date'});
 const refs=[ahead.intent,validDate.intent,badDate.intent,healthy.intent];
 const readRows=()=>c.db.getAll(...refs);
 const before=await readRows(),accountBefore=await balance(c),videoBefore=await localBalance(c);
 const foreignBefore=await c.store.videoBalance(foreign.identityKey),foreignVideoBefore=await c.backend.readBalance(foreign.account);

 const drain=await runBillingDrainSection({...c,enabled:true,now,clock:()=>now,log:()=>{}});
 assert.equal(drain.intentsFailed,3);
 assert.equal(drain.intentsRecovered,0);
 assert.equal(drain.staleEscalated,0);
 const report=await readPendingReport(c.root,now);
 const sweep=await runBillingSweepSection({...c,enabled:true,now,log:()=>{}});
 assert.equal(sweep.outcome,'ok');
 const alerts=(await c.root.collection(ALERT_COLLECTION).get()).docs.map(document=>document.data());
 assert.equal(alerts.some(alert=>alert.rowId===healthy.intent.id),false);
 assert.equal(report.rows.find(row=>row.id===healthy.intent.id)?.attention,'pending');
 assert.deepEqual(c.transport.bodies,[]);
 const after=await readRows();
 for(let index=0;index<before.length;index++){
  assert.deepEqual(after[index].data(),before[index].data());
  assert.ok(after[index].updateTime.isEqual(before[index].updateTime));
 }
 assert.equal((await c.root.collection('billingGuards').get()).size,0);
 assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);
 assert.equal((await c.accountRoot.collection('ledgerEntries').get()).size,0);
 assert.equal((await c.root.collection('movements').get()).size,0);
 assert.deepEqual(await balance(c),accountBefore);
 assert.deepEqual(await localBalance(c),videoBefore);
 assert.deepEqual(await c.store.videoBalance(foreign.identityKey),foreignBefore);
 assert.deepEqual(await c.backend.readBalance(foreign.account),foreignVideoBefore);
 for(const bad of [ahead,validDate,badDate]){
  const row=report.rows.find(candidate=>candidate.kind==='intent'&&candidate.id===bad.intent.id);
  assert.ok(row,'The malformed intent is visible in the default report');
  const visible=alerts.filter(alert=>alert.kind==='intent'&&alert.rowId===bad.intent.id&&alert.status==='open');
  assert.equal(visible.length,1,'The default policy raises one row alert even when the creation timestamp cannot age out');
  assert.equal(row.attention,'malformed');
  assert.equal(row.accountId,null);
  assert.equal(visible[0].reason,'malformed');
  assert.equal(visible[0].accountId,null);
 }
});

test('D3 repeat sweeps remove an obsolete account hint without changing a disposition or its audit receipt',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('malformed_obsolete_account_hint'),foreign=await otherAccount(c),now=Date.now();
 const open=await a3(c,{reserveInAccount:false}),resolved=await a3(c,{reserveInAccount:false});
 const alertRefs=[];
 for(const pending of [open,resolved]){
  const rowId=pending.intent.id,state='reserve_pending',reason='malformed';
  await pending.intent.update({provider:'invalid_synthetic_provider',createdAtMs:now+24*60*60*1000,accountId:foreign.account});
  const key=alertKey('intent',rowId,state,reason),alert=ref(c.root,ALERT_COLLECTION,key);
  // The earlier reporter copied an unverified account hint under the same deduplication key.
  await alert.create({alertKey:key,kind:'intent',rowId,state,reason,accountId:foreign.account,
   status:'open',seenCount:1,firstSeenAtMs:now-2,lastSeenAtMs:now-2});
  alertRefs.push(alert);
 }
 const [openAlert,resolvedAlert]=alertRefs,disposition={authorizedBy:'operator-ana',evidenceRef:'synthetic reviewed alert'};
 assert.deepEqual(await recordDisposition(c.db,c.root,resolvedAlert.id,'resolve',disposition,now-1),{replayed:false});
 const receiptRef=ref(c.root,AUDIT_COLLECTION,auditId(resolvedAlert.id,'resolve'));
 const [beforeOpen,beforeResolved,beforeReceipt,beforeOpenRow,beforeResolvedRow]=await c.db.getAll(openAlert,resolvedAlert,receiptRef,open.intent,resolved.intent);
 assert.equal(beforeOpen.get('accountId'),foreign.account);
 assert.equal(beforeResolved.get('accountId'),foreign.account);
 assert.equal(beforeResolved.get('status'),'dispositioned');

 for(const time of [now,now+1]){
  const sweep=await runBillingSweepSection({...c,enabled:true,now:time,log:()=>{}});
  assert.equal(sweep.outcome,'ok');assert.equal(sweep.created,0);assert.equal(sweep.seen,2);
 }
 const [afterOpen,afterResolved,afterReceipt,afterOpenRow,afterResolvedRow]=await c.db.getAll(openAlert,resolvedAlert,receiptRef,open.intent,resolved.intent);
 assert.equal((await c.root.collection(ALERT_COLLECTION).get()).size,2);
 assert.deepEqual(afterReceipt.data(),beforeReceipt.data());
 assert.ok(afterReceipt.updateTime.isEqual(beforeReceipt.updateTime));
 assert.deepEqual(await recordDisposition(c.db,c.root,resolvedAlert.id,'resolve',disposition,now+2),{replayed:true});
 assert.ok(afterOpenRow.updateTime.isEqual(beforeOpenRow.updateTime));
 assert.ok(afterResolvedRow.updateTime.isEqual(beforeResolvedRow.updateTime));
 assert.deepEqual(c.transport.bodies,[]);
 assert.deepEqual(afterOpen.data(),{...beforeOpen.data(),accountId:null,seenCount:3,lastSeenAtMs:now+1});
 assert.deepEqual(afterResolved.data(),{...beforeResolved.data(),accountId:null,seenCount:3,lastSeenAtMs:now+1});
});

for(const changeHistory of [false,true]){
 test(`E-4 a block after seal_reserved ${changeHistory?'preserves review when history also changes':'pauses the release and resumes once'}`,{timeout:WORK_TIMEOUT_MS},async()=>{
  const c=await fixture('release_seal_reserved_blocked'),pending=await releasePending(c,{reserveInAccount:false});
  const {reservationId,seconds}=pending.billing,request=c.transport.request;
  const tomb=ref(c.accountRoot,'videoReservationTombstones',sha(JSON.stringify([c.accountOwner,reservationId])));
  const ledger=c.accountRoot.collection('ledgerEntries'),before=await pending.intent.get(),videoBefore=await localBalance(c);
  const heldBalance={unit:'video_seconds',credited:40,available:38,reserved:2,consumed:0,active:1};
  let guardAtSeal,sealReply;
  await assert.rejects(c.store.videoReservation(c.identity,reservationId),{code:'not_found'});

  // The reservation arrives after the real status 404 and before the real seal. Block Video only after the seal returns reserved.
  c.transport.request=async call=>{
   if(!new URL(call.url).pathname.endsWith('/seal'))return request.call(c.transport,call);
   await c.store.reserveVideo(c.identity,reservationId,seconds);
   const response=await request.call(c.transport,call);
   sealReply=response.data;
   guardAtSeal=await (await blockVideo(c)).get();
   if(changeHistory)await ref(c.root,'projects',c.input).update({draft:'A3 synthetic changed draft after seal'});
   return response;
  };
  try{await c.ai.drainExternalBilling();}
  finally{c.transport.request=request;}

  assert.deepEqual(sealReply,{state:'reserved',reservationId,seconds,created:false});
  assert.ok(guardAtSeal);
  assert.deepEqual(c.transport.bodies.map(call=>call.path.split('/').at(-1)),['status','seal']);
  assert.equal((await tomb.get()).exists,false);
  assert.deepEqual(await balance(c),heldBalance);
  assert.deepEqual(await localBalance(c),videoBefore);
  assert.equal((await ledger.where('kind','==','video_release').get()).size,0);
  const witnesses=await c.root.collection('billingIntentTerminalWitnesses').get();
  assert.deepEqual(witnesses.docs.map(doc=>doc.get('action')),['seal']);
  const after=await pending.intent.get(),observations=await c.root.collection('billingIntentObservationIncidents').get();
  const admissionGuard=await ref(c.root,'billingIntentAdmissionGuards',pending.intent.id).get();
  if(changeHistory){
   assert.equal(after.get('state'),'needs_review');
   assert.equal(after.get('reviewReason'),'direct_status_uncertain');
   assert.equal(after.get('attempts'),before.get('attempts'));
   assert.equal(observations.size,1);
   const observation=observations.docs[0];
   assert.equal(observation.get('kind'),'direct_status_uncertainty');
   assert.equal(observation.get('source'),'seal');
   assert.equal(observation.get('observedState'),'reserved');
   assert.equal(observation.get('observedSeconds'),seconds);
   assert.equal(admissionGuard.get('state'),'needs_review');
   assert.equal((await incident(c,pending.requestKey)).reason,'direct_status_uncertain');
   return;
  }

  assert.deepEqual(after.data(),before.data());
  assert.equal(after.updateTime.isEqual(before.updateTime),true);
  assert.equal((await guardAtSeal.ref.get()).updateTime.isEqual(guardAtSeal.updateTime),true);
  assert.equal(observations.size,0);
  assert.equal(admissionGuard.get('state'),'clear');
  assert.equal(await incident(c,pending.requestKey),undefined);
  assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0);

  await guardAtSeal.ref.delete();
  assert.equal((await c.ai.drainExternalBilling()).intentsRecovered,1);
  await c.ai.drainExternalBilling();
  const closed=await pending.intent.get();
  assert.equal(closed.get('state'),'closed');
  assert.equal(closed.get('releaseConfirmed'),true);
  assert.equal(closed.get('releaseReservationId'),reservationId);
  assert.equal((await c.store.videoReservation(c.identity,reservationId)).state,'released');
  assert.equal((await tomb.get()).exists,false);
  assert.deepEqual(c.transport.bodies.map(call=>call.path.split('/').at(-1)),['status','seal','status','release']);
  assert.equal((await ledger.where('kind','==','video_release').get()).size,1);
  assert.deepEqual(await balance(c),{unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0});
  assert.deepEqual(await localBalance(c),videoBefore);
 });
}

async function blockAccount(c){
 const incidentId=sha('synthetic-account-incident');
 await c.store.blockVideoBilling(c.identity,incidentId);
 const guard=await ref(c.accountRoot,'videoBillingGuards',c.accountOwner).get();
 return {incidentId,epoch:guard.get('epoch'),createdAtMs:guard.get('createdAtMs'),reviewRef:'Synthetic A3 review'};
}

test('A-5 a stored admission prevents capture under a block and prevents simple release after reopening',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('admitted_release_blocked'),pending=await a3(c);
 const {reservationId,seconds}=pending.billing,admission={jobId:randomUUID(),attemptId:randomUUID()};
 await c.store.admitVideoCall(c.identity,reservationId,seconds,admission.jobId,admission.attemptId,'text-window:0001','gemini-3.8-flash',sha('synthetic-a5-admission'));
 const decision=await blockAccount(c);
 const before=await reservationDoc(c,reservationId).get(),accountBefore=await balance(c),videoBefore=await localBalance(c);
 const ledgerBefore=(await c.accountRoot.collection('ledgerEntries').get()).size;
 await assert.rejects(c.store.settleVideo(c.identity,reservationId,'capture',seconds,admission),{code:'conflict'});

 const opened=await c.store.unblockVideoBilling(c.identity,decision);
 assert.equal(opened.blocked,false);
 await assert.rejects(c.store.settleVideo(c.identity,reservationId,'release',seconds),{code:'conflict'});
 const after=await reservationDoc(c,reservationId).get();
 assert.equal(after.get('state'),'reserved');
 assert.equal(after.updateTime.isEqual(before.updateTime),true);
 assert.deepEqual(await balance(c),accountBefore);
 assert.deepEqual(await localBalance(c),videoBefore);
 assert.equal((await c.accountRoot.collection('ledgerEntries').get()).size,ledgerBefore);
});

test('A-5 releasing one of three held reservations restores a slot and keeps Account and Video reconciled',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('blocked_quota');
 const enqueue=()=>c.ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);
 const first=await enqueue();
 await enqueue();
 await enqueue();
 const firstJob=await c.backend.job(c.account,first);
 const fourthReservation=randomUUID(),guard=await blockVideo(c),decision=await blockAccount(c);
 const assertBalances=async active=>{
  assert.deepEqual(await balance(c),{unit:'video_seconds',credited:40,available:40-2*active,reserved:2*active,consumed:0,active});
  // Video stores the active job count; Account holds the seconds for external jobs.
  assert.deepEqual(await localBalance(c),{credited:40,available:40,reserved:0,consumed:0,active});
 };
 await assertBalances(3);
 await assert.rejects(c.store.reserveVideo(c.identity,fourthReservation,2),{code:'conflict'});

 assert.equal((await c.store.unblockVideoBilling(c.identity,decision)).blocked,false);
 await guard.delete();
 await assert.rejects(c.store.reserveVideo(c.identity,fourthReservation,2),{code:'quota'});
 await assert.rejects(c.backend.reserve(c.account,c.input,randomUUID(),2,'translation:en',1),{code:'conflict'});
 await assertBalances(3);

 assert.equal(await c.backend.cancel(c.account,first),true);
 const result=await c.ai.drainExternalBilling();
 assert.equal(result.settled,1);
 assert.equal((await reservationDoc(c,firstJob.externalBilling.reservationId).get()).get('state'),'released');
 await assertBalances(2);

 await enqueue();
 await assertBalances(3);
 const counts=await summarizeAccounts(accountReadOnlyRoot(c.accountRoot),Date.now());
 assert.equal(counts.accounts.activeMismatch,0);
 assert.equal(counts.accounts.reservedMismatch,0);
 assert.equal(counts.openReservations.count,3);
 assert.equal(counts.ledger.byKind.video_release,1);
 assert.equal(counts.ledger.byKind.video_capture,0);
});

test('A3 before the limit keeps the stall behavior even for a blocked account',{timeout:WORK_TIMEOUT_MS},async()=>{
 const boundaryNow=Date.now();
 const c=await fixture('blocked_before_limit');const a=await a3(c,{createdAtMs:boundaryNow-(30*60*1000-1)});
 await ref(c.root,'billingGuards',c.account).set({accountId:c.account,blocked:true});
 const r=await c.ai.drainExternalBilling(undefined,{now:boundaryNow});
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 const row=await intentRow(c,a.requestKey);assert.equal(row.state,'reserve_pending');assert.equal(row.attempts,2);assert.equal(row.lastErrorCode,'unavailable');
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);
});

test('A3 fence conflict from a guard appearing after the status read closes to review without releasing',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('fence_conflict');const a=await a3(c,{ageMs:30*60*1000});
 const original=c.backend.captureDirectObservation.bind(c.backend);
 c.backend.captureDirectObservation=async(...args)=>{const snapshot=await original(...args);await ref(c.root,'billingGuards',c.account).set({accountId:c.account,blocked:true});return snapshot;};
 const before=await balance(c);
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 assert.equal((await intentRow(c,a.requestKey)).state,'needs_review');
 assert.deepEqual(await balance(c),before);
 assert.deepEqual(c.transport.bodies.filter(x=>x.path.endsWith('/release')||x.path.endsWith('/seal')),[]);
});

test('A3 claimExternalBillingRelease refuses a blocked account and an invalid admission guard',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('claim_guards');const a=await a3(c,{ageMs:30*60*1000});
 await ref(c.root,'billingGuards',c.account).set({accountId:c.account,blocked:true});
 await assert.rejects(c.backend.claimExternalBillingRelease(c.account,a.requestKey,a.billing),error=>error instanceof LedgerFault&&error.code==='conflict');
 assert.equal((await intentRow(c,a.requestKey)).state,'reserve_pending');
 await ref(c.root,'billingGuards',c.account).delete();
 const intentId=sha(JSON.stringify([c.account,a.requestKey]));
 await ref(c.root,'billingIntentAdmissionGuards',intentId).set({protocol:1,intentId,state:'needs_review',createdAtMs:Date.now()});
 await assert.rejects(c.backend.claimExternalBillingRelease(c.account,a.requestKey,a.billing),error=>error instanceof LedgerFault&&error.code==='conflict');
 assert.equal((await intentRow(c,a.requestKey)).state,'reserve_pending');
});

test('A3 claimExternalBillingRelease reports job_created once work exists and transitioned only for the winner',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('claim_idempotent');
 const a1=await a3(c,{ageMs:30*60*1000});
 assert.deepEqual(await c.backend.claimExternalBillingRelease(c.account,a1.requestKey,a1.billing),{state:'release_pending',transitioned:true});
 assert.deepEqual(await c.backend.claimExternalBillingRelease(c.account,a1.requestKey,a1.billing),{state:'release_pending',transitioned:false});
 const a2=await a3(c,{ageMs:30*60*1000});
 await c.backend.reserve(c.account,c.input,a2.requestKey,2,'translation:en',1,AI_CATALOG_VERSION,a2.billing,undefined,c.uid);
 const created=await c.backend.claimExternalBillingRelease(c.account,a2.requestKey,a2.billing);
 assert.equal(created.state,'job_created');assert.equal(typeof created.jobId,'string');
});


test('A3 blocked-account incident records the expected tuple provenance, not a real status read',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('provenance_blocked');const a=await a3(c,{ageMs:30*60*1000});
 await ref(c.root,'billingGuards',c.account).set({accountId:c.account,blocked:true});
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 assert.equal((await intentRow(c,a.requestKey)).state,'needs_review');
 const inc=await incident(c,a.requestKey);assert.ok(inc);
 assert.equal(inc.firstObservedProvenance,'expected_from_intent');
 assert.equal(inc.firstObserved.reservationId,a.billing.reservationId);assert.equal(inc.firstObserved.state,'reserved');assert.equal(inc.firstObserved.seconds,2);
});

test('A3 Account-refusal incident records the real status read provenance',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('provenance_account');const a=await a3(c,{ageMs:30*60*1000});
 await reservationDoc(c,a.billing.reservationId).update({admissionProtocol:1});
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 assert.equal((await intentRow(c,a.requestKey)).state,'needs_review');
 const inc=await incident(c,a.requestKey);assert.ok(inc);
 assert.equal(inc.firstObservedProvenance,'account_status');
});

test('A3 drop between fence and release leaves release_pending and the next pass finishes with one release',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('drop_after_fence');const a=await a3(c,{ageMs:30*60*1000});
 const original=c.backend.captureDirectObservation.bind(c.backend);let calls=0;
 // The refreshed status read after the fence returns null once, simulating a crash before the release.
 c.backend.captureDirectObservation=async(...args)=>{calls++;if(calls===2)return null;return original(...args);};
 const before=await balance(c);
 const first=await c.ai.drainExternalBilling();
 assert.equal(first.intentsRecovered,0);assert.equal(first.intentsFailed,1);
 assert.equal((await intentRow(c,a.requestKey)).state,'release_pending');
 assert.deepEqual(await balance(c),before);
 assert.deepEqual(await localBalance(c),{credited:40,available:40,reserved:0,consumed:0,active:0});
 assert.deepEqual(c.transport.bodies.filter(x=>x.path.endsWith('/release')||x.path.endsWith('/seal')),[]);
 const second=await c.ai.drainExternalBilling();
 assert.equal(second.intentsRecovered,1);assert.equal(second.intentsFailed,0);
 assert.equal((await intentRow(c,a.requestKey)).state,'closed');
 assert.deepEqual(await balance(c),{unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0});
 assert.deepEqual(await localBalance(c),{credited:40,available:40,reserved:0,consumed:0,active:0});
 assert.equal(c.transport.bodies.filter(x=>x.path.endsWith('/release')).length,1);
 assert.equal(await jobs(c),0);assert.equal(await terminal(c),1);
 assert.deepEqual(c.transport.bodies.filter(x=>x.path.endsWith('/capture')),[]);
});

test('A3 two concurrent drains on a blocked overdue account leave one incident and one review transition',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('concurrent_blocked');const a=await a3(c,{ageMs:30*60*1000});
 await ref(c.root,'billingGuards',c.account).set({accountId:c.account,blocked:true});
 const beforeHold=(await c.root.collection('billingHoldOutbox').get()).size;
 const [x,y]=await Promise.all([c.ai.drainExternalBilling(),c.ai.drainExternalBilling()]);
 assert.equal(x.intentsRecovered+y.intentsRecovered,0);
 assert.equal((await intentRow(c,a.requestKey)).state,'needs_review');
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,1);
 assert.equal((await c.root.collection('billingHoldOutbox').get()).size,beforeHold);
 assert.deepEqual((await ref(c.root,'billingGuards',c.account).get()).data(),{accountId:c.account,blocked:true});
});

test('A3 a row closed by another drain before the evidence capture is not rewritten',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('closed_before_capture');const a=await a3(c,{ageMs:30*60*1000});
 await a.intent.update({attempts:3});
 const original=c.backend.captureExternalBillingIntentFailureEvidence.bind(c.backend);let done=false;
 c.backend.captureExternalBillingIntentFailureEvidence=async(...args)=>{if(!done){done=true;await a.intent.update({state:'closed'});}return original(...args);};
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 const row=await intentRow(c,a.requestKey);assert.equal(row.state,'closed');assert.equal(row.attempts,3);
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);
});

test('A3 a throw inside the A-3 catch fails only that row and the pass continues',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('throw_in_catch');
 const a1=await a3(c,{ageMs:30*60*1000}),a2=await a3(c,{ageMs:30*60*1000});
 await reservationDoc(c,a1.billing.reservationId).update({admissionProtocol:1});
 await reservationDoc(c,a2.billing.reservationId).update({admissionProtocol:1});
 const originalClose=c.backend.closeA3ReservationForReview.bind(c.backend);let calls=0;
 c.backend.closeA3ReservationForReview=async(...args)=>{calls++;if(calls===1)throw new Error('synthetic close failure');return originalClose(...args);};
 const r=await c.ai.drainExternalBilling(10);
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,2);
 const states=[(await intentRow(c,a1.requestKey)).state,(await intentRow(c,a2.requestKey)).state].sort();
 assert.deepEqual(states,['needs_review','release_pending']);
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,1);
 assert.equal(calls,2);
});

// Codex certification test (step 1.3a): the in-transaction state proof of the blocked-account closure. The row the drain read as reserve_pending was moved
// to release_pending by another drain before the closure transaction (a release is now in flight): it must NOT be closed to review, even with the account blocked.
test('A3 overdue reserve_pending moved to release_pending by another drain before the closure is not closed to review even with a blocked account',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('state_race_blocked');const a=await a3(c,{ageMs:30*60*1000});
 await ref(c.root,'billingGuards',c.account).set({accountId:c.account,blocked:true});
 const original=c.backend.captureExternalBillingIntentFailureEvidence.bind(c.backend);let moved=false;
 c.backend.captureExternalBillingIntentFailureEvidence=async(...args)=>{if(!moved){moved=true;await a.intent.update({state:'release_pending'});}return original(...args);};
 const before=await balance(c);
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 const row=await intentRow(c,a.requestKey);assert.equal(row.state,'release_pending','a release in flight is never overwritten');assert.equal(row.reviewReason,undefined);
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);
 assert.deepEqual(await balance(c),before);
 assert.deepEqual(c.transport.bodies.filter(x=>x.path.endsWith('/release')||x.path.endsWith('/seal')),[]);
});

// Codex certification test (step 1.3a): the non-blocked-proof callers of the closure (fence conflict, Account refusal) must not reopen a row another drain already
// closed. Here the row is moved to `closed` right after the status read, so the fence refuses (conflict) and the closure must return without writing anything.
test('A3 a fence conflict because another drain closed the row does not reopen it as needs_review',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('fence_conflict_closed');const a=await a3(c,{ageMs:30*60*1000});
 const original=c.backend.captureDirectObservation.bind(c.backend);
 c.backend.captureDirectObservation=async(...args)=>{const snapshot=await original(...args);await a.intent.update({state:'closed'});return snapshot;};
 const before=await balance(c);
 const r=await c.ai.drainExternalBilling();
 assert.equal(r.intentsRecovered,0);assert.equal(r.intentsFailed,1);
 const row=await intentRow(c,a.requestKey);assert.equal(row.state,'closed','a closed intent is never rewritten');assert.equal(row.reviewReason,undefined);
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);
 assert.deepEqual(await balance(c),before);
 assert.deepEqual(c.transport.bodies.filter(x=>x.path.endsWith('/release')||x.path.endsWith('/seal')),[]);
});

// Codex certification test (step 1.3a): an intent that already created work is never reopened by the review closure.
test('A3 closeA3ReservationForReview refuses an intent that already has work and leaves it untouched',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('close_job_created');const a=await a3(c,{ageMs:30*60*1000});
 await c.backend.reserve(c.account,c.input,a.requestKey,2,'translation:en',1,AI_CATALOG_VERSION,a.billing,undefined,c.uid);
 const before=await intentRow(c,a.requestKey);assert.equal(before.state,'job_created');
 await assert.rejects(()=>c.backend.closeA3ReservationForReview(c.account,a.requestKey,a.billing,{reservationId:a.billing.reservationId,state:'reserved',seconds:2}),error=>error?.code==='conflict');
 const after=await intentRow(c,a.requestKey);assert.equal(after.state,'job_created','a job-created intent is never reopened');assert.equal(after.reviewReason,undefined);
 assert.equal((await c.root.collection('billingReviewIncidents').get()).size,0);
});
