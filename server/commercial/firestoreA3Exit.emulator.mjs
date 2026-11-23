// LV-019-B step 1.3a: A-3 timeout exit. This fixture runs a REAL AccountStore behind a local
// adapter against the fixed emulator. It covers the deadline fence and the conflict close paths.
// Every wait is bounded and every Firestore client is terminated in a finally block.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {FieldValue,Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend,LedgerFault} from './firestoreBackend.ts';
import {AI_CATALOG_VERSION} from './aiContracts.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {privateBucket} from './privateObjectPlan.ts';

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
/** Create the A-3 state without enqueueing work: begin the intent and reserve only in Account. */
async function a3(c,{ageMs=0,requestKey=randomUUID(),nextAttemptAt=0,createdAtMs}={}){
 const billing={provider:'account_seconds',identityKey:c.identity,reservationId:randomUUID(),seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,requestKey,'translation:en',1,billing);
 await c.store.reserveVideo(c.identity,billing.reservationId,2);
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
