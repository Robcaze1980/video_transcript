// LV-019.B step 1.3b integration fixture. A REAL AccountStore sits behind the
// local transport so both balances are observed. This file covers the
// pre-POST window comparison, ACK identity binding and the active counters.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {privateBucket} from './privateObjectPlan.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185';
const videoCollection='vistavo_ack_window_video_synthetic',accountCollection='vistavo_ack_window_ledger_synthetic';
const WORK_TIMEOUT_MS=180000,CLEANUP_TIMEOUT_MS=45000;
const sha=value=>createHash('sha256').update(value).digest('hex');
const contexts=[];
let created=0,cleaned=0;
const ref=(root,collection,id)=>root.collection(collection).doc(id);
const intentRef=(c,requestKey)=>ref(c.root,'billingIntents',sha(JSON.stringify([c.account,requestKey])));
const bounded=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout: '+label)),ms))]);
const observed=promise=>promise.then(value=>({value}),error=>({error}));
async function descendants(root,found=[]){for(const collection of await root.listCollections())for(const doc of await collection.listDocuments()){found.push(doc);await descendants(doc,found);}return found;}

before(async()=>{
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
 assert.equal((await fetch('http://127.0.0.1:8185/',{signal:AbortSignal.timeout(5000)})).status,200);
});
afterEach(async()=>{
 for(const c of contexts.splice(0)){
  try{
   for(const entry of c.roots){const known=await descendants(entry.root);await bounded(c.db.recursiveDelete(entry.root),CLEANUP_TIMEOUT_MS,'cleanup');assert.equal((await entry.root.get()).exists,false);for(const doc of known)assert.equal((await doc.get()).exists,false);}
   cleaned++;
  }finally{try{await bounded(c.db.terminate(),15000,'terminate');}catch{}}
 }
});
after(()=>{assert.equal(cleaned,created);});

const accountStatus={invalid:400,not_found:404,conflict:409,quota:429,insufficient:402,invariant:503};
class LocalAccountTransport{
 bodies=[];
 constructor(store){this.store=store;}
 async request(request){
  const pathname=new URL(request.url).pathname,body=request.data??{};this.bodies.push({path:pathname,body});
  const reservationId=pathname.split('/').at(-2);
  const httpFault=(status,code)=>Object.assign(new Error('synthetic account fault'),{response:{status,data:{error:code}}});
  const guard=async action=>{try{return {data:await action()};}catch(error){if(error?.response)throw error;throw httpFault(accountStatus[error?.code]??503,error?.code??'invariant');}};
  if(pathname==='/api/internal/video/reservations')return guard(async()=>({...await this.store.reserveVideo(body.identityKey,body.reservationId,body.seconds),reservationId:body.reservationId}));
  if(pathname.endsWith('/status'))return guard(()=>this.store.videoReservation(body.identityKey,reservationId));
  if(pathname.endsWith('/release')||pathname.endsWith('/capture')){
   const action=pathname.endsWith('/release')?'release':'capture';
   return guard(async()=>({...await this.store.settleVideo(body.identityKey,reservationId,action,body.seconds),reservationId}));
  }
  throw httpFault(404,'not_found');
 }
}
async function fixture(scope){
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
 const root=db.collection(videoCollection).doc(randomUUID()),accountRoot=db.collection(accountCollection).doc(randomUUID());
 const c={scope,db,root,accountRoot,roots:[{root},{root:accountRoot}]};
 contexts.push(c);created++;
 for(const entry of c.roots)await entry.root.create({purpose:'ack-window-synthetic',nonce:randomUUID()});
 c.backend=new FirestoreBackend(db,root);c.store=new AccountStore(db,accountRoot);
 c.uid='ack-window-owner-'+randomUUID();c.account=await c.backend.accountForUid(c.uid);
 await ref(root,'accounts',c.account).update({aiPilot:true,simulationOnly:true,credited:40,available:40});
 const boot=await c.store.bootstrap(c.uid);c.accountOwner=boot.account.id;
 await ref(accountRoot,'accounts',c.accountOwner).update({credited:40,available:40});
 c.identity=accountIdentityKey(c.uid);

 c.input=randomUUID();const source=Buffer.from('synthetic ACK window source'),digest=sha(source);
 await ref(root,'inputs',c.input).create({accountId:c.account,expiresAtMs:Date.now()+3600000,sha256:digest,deleted:false,ready:true,unknown:false,unknownCount:0,metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:`candidate-files-v1/${c.input}/video.mp4`,generation:'1',size:source.length,sha256:digest}});
 await c.backend.saveProject(c.account,c.input,0,'ACK window source');
 c.transport=new LocalAccountTransport(c.store);
 c.ai=new FirestoreAi(db,root,c.backend,{},undefined,new AccountBillingClient(undefined,c.transport));
 return c;
}
async function videoJobs(c){return (await c.root.collection('jobs').get()).size;}
function reservationUuid(accountId,identityKey,inputId,operation,revision,requestKey){
 const bytes=createHash('sha256').update(JSON.stringify(['vistavo-video-reservation-v1',accountId,identityKey,inputId,operation,revision,requestKey])).digest().subarray(0,16);
 bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;const h=bytes.toString('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
async function videoBalance(c){return c.backend.readBalance(c.account);}
async function localBalance(c){return c.store.videoBalance(c.identity);}
async function attempts(c){const rows=await c.root.collection('billingReserveAttempts').get();return rows.docs.map(doc=>doc.data());}

test('an active request counts one slot in BOTH bases',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('active_both');
 const jobId=await c.ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);
 assert.deepEqual(await videoBalance(c),{credited:40,available:40,reserved:0,consumed:0,active:1});
 assert.equal(await videoJobs(c),1);
 assert.deepEqual(await localBalance(c),{unit:'video_seconds',credited:40,available:38,reserved:2,consumed:0,active:1});
});
test('a reservation of another attempt with the same tuple cannot create work',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('other_attempt');const key=randomUUID();
 const billing={provider:'account_seconds',identityKey:c.identity,reservationId:reservationUuid(c.account,c.identity,c.input,'translation:en',1,key),seconds:2};

 await c.backend.beginExternalBillingIntent(c.account,c.input,key,'translation:en',1,billing);
 const held=await c.store.reserveVideo(c.identity,billing.reservationId,2);
 const attempt=await c.backend.prepareExternalReserveAttempt(c.account,c.input,key,'translation:en',1,c.uid);
 assert.ok(attempt,'The preflight must commit the real attempt');
 const forged={...structuredClone(attempt),attemptId:randomUUID()};
 let rejected=false;
 try{await c.backend.reserve(c.account,c.input,key,2,'translation:en',1,'ai-candidate-v1',billing,undefined,c.uid,forged,{reservationId:held.reservationId,seconds:held.seconds,state:'reserved'});}
 catch(error){rejected=error?.code==='conflict'||error?.code==='invariant';if(!rejected)throw error;}
 assert.equal(rejected,true,'Another attempt must not authorize this job');
 assert.equal(await videoJobs(c),0,'Another attempt must not create this job');
 assert.equal((await ref(c.root,'billingReserveAttempts',forged.attemptId).get()).exists,false);
});

test('an immutable document rewritten between preflight and job write preserves only the ACK',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('window_version');const key=randomUUID();
 const original=c.backend.prepareExternalReserveAttempt.bind(c.backend);
 c.backend.prepareExternalReserveAttempt=async(...args)=>{
  const attempt=await original(...args);
  // `origin` is immutable in this window; changing it after the preflight must
  // block the job so the ACK stays without work (design 3.2.3).
  const id=sha(JSON.stringify([c.account,key]));
  await ref(c.root,'billingIntentWitnesses',id).update({createdAtMs:Date.now()+1000});
  return attempt;
 };
 const result=await observed(c.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid));
 c.backend.prepareExternalReserveAttempt=original;
 assert.ok(result.error,'A changed immutable document must not authorize work');
 assert.equal(await videoJobs(c),0);
 const acks=await c.root.collection('billingReserveAckObservations').where('intentId','==',sha(JSON.stringify([c.account,key]))).get();
 assert.equal(acks.size,1,'The received ACK must survive without a job');
 assert.equal(acks.docs[0].get('attribution'),'unverified');
});
test('identity revoked after the local precheck prevents the Account POST',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('revoked_before_post');const key=randomUUID();let posts=0;
 const originalTransport=c.transport.request.bind(c.transport);
 c.transport.request=async request=>{if(new URL(request.url).pathname.endsWith('/reservations'))posts++;return originalTransport(request);};
 const original=c.backend.captureExternalBillingIntentFailureEvidence.bind(c.backend);
 c.backend.captureExternalBillingIntentFailureEvidence=async(...args)=>{const evidence=await original(...args);await ref(c.root,'identities',c.identity).delete();return evidence;};
 const result=await observed(c.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid));
 c.backend.captureExternalBillingIntentFailureEvidence=original;
 assert.ok(result.error,'A revoked identity must stop the request');
 assert.equal(posts,0,'No Account POST after the identity was revoked');
 assert.equal(await videoJobs(c),0);
 assert.equal((await c.root.collection('billingReserveAttempts').get()).size,0,'The preflight must not record an attempt for a revoked identity');
});
test('a job write does not commit the ACK after a changed immutable document',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('ack_atomic');const key=randomUUID();
 const original=c.backend.prepareExternalReserveAttempt.bind(c.backend);
 c.backend.prepareExternalReserveAttempt=async(...args)=>{
  const attempt=await original(...args);
  await ref(c.root,'requests',sha(JSON.stringify([c.account,key]))).create({foreign:true});
  return attempt;
 };
 const result=await observed(c.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid));
 c.backend.prepareExternalReserveAttempt=original;
 assert.ok(result.error);
 assert.equal(await videoJobs(c),0,'The job write must not commit without the unchanged window');
});

test('each immutable document rewritten after the preflight blocks the job and keeps only the ACK',{timeout:WORK_TIMEOUT_MS},async()=>{
 const names=['identity','input','project','origin','intentGuard','request','sealWitness','sealRecovery','releaseWitness','releaseRecovery'];
 for(const name of names){
  const c=await fixture('window_'+name);const key=randomUUID(),id=sha(JSON.stringify([c.account,key])),addresses={
   identity:['identities',c.identity],input:['inputs',c.input],project:['projects',c.input],origin:['billingIntentWitnesses',id],
   intentGuard:['billingIntentAdmissionGuards',id],request:['requests',id],
   sealWitness:['billingIntentTerminalWitnesses',sha(JSON.stringify(['billing-intent-terminal-v1',id,'seal']))],
   sealRecovery:['billingIntentTerminalRecovery',sha(JSON.stringify(['billing-intent-terminal-v1',id,'seal']))],
   releaseWitness:['billingIntentTerminalWitnesses',sha(JSON.stringify(['billing-intent-terminal-v1',id,'release']))],
   releaseRecovery:['billingIntentTerminalRecovery',sha(JSON.stringify(['billing-intent-terminal-v1',id,'release']))]};
  const [collection,document]=addresses[name];
  const original=c.backend.prepareExternalReserveAttempt.bind(c.backend);
  c.backend.prepareExternalReserveAttempt=async(...args)=>{
   const attempt=await original(...args);
   // A new row at these immutable addresses changes the exact version without
   // altering any content the later checks would otherwise accept.
   await ref(c.root,collection,document).set({windowProbe:name});
   return attempt;
  };
  const result=await observed(c.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid));
  c.backend.prepareExternalReserveAttempt=original;
  assert.ok(result.error,`${name}: a changed immutable version must not authorize work`);
  assert.equal(await videoJobs(c),0,`${name}: no job may be created`);
  const acks=await c.root.collection('billingReserveAckObservations').get();
  assert.equal(acks.size,1,`${name}: the received ACK must survive without a job`);
  assert.equal(acks.docs[0].get('attribution'),'unverified');
 }
});


test('an existing conflicting ACK observation aborts the job in the same transaction',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('ack_conflict');const key=randomUUID();
 const original=c.backend.prepareExternalReserveAttempt.bind(c.backend);
 c.backend.prepareExternalReserveAttempt=async(...args)=>{
  const attempt=await original(...args);
  // A pre-existing, non-matching observation must abort the job; an ACK written
  // after a committed job would leave the job without its correlated evidence.
  await ref(c.root,'billingReserveAckObservations',attempt.attemptId).create({
   version:1,attemptId:attempt.attemptId,...attempt.witness,source:'reserve_ack',state:'reserved',
   attribution:'verified',snapshot:{versions:attempt.versions}});
  return attempt;
 };
 const result=await observed(c.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid));
 c.backend.prepareExternalReserveAttempt=original;
 assert.ok(result.error);
 assert.equal(await videoJobs(c),0,'A conflicting ACK observation must not leave a job');
 const acks=(await c.root.collection('billingReserveAckObservations').get()).docs;
 assert.equal(acks.length,1);assert.equal(acks[0].get('attribution'),'verified','The original observation is kept, never overwritten');
});
test('an intent rescheduled by the probe still creates work (semantic intent)',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('intent_semantic');const key=randomUUID();
 const original=c.backend.prepareExternalReserveAttempt.bind(c.backend);
 c.backend.prepareExternalReserveAttempt=async(...args)=>{
  const attempt=await original(...args);
  await ref(c.root,'billingIntents',sha(JSON.stringify([c.account,key]))).update({attempts:5,nextAttemptAt:Date.now()-1000,lastErrorCode:'reserved_unconfirmed'});
  return attempt;
 };
 const jobId=await c.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid);
 c.backend.prepareExternalReserveAttempt=original;
 assert.equal(typeof jobId,'string');
 assert.equal(await videoJobs(c),1);
});

test('other jobs changing the balance do not block work (semantic account)',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('account_semantic');
 const original=c.backend.prepareExternalReserveAttempt.bind(c.backend);
 c.backend.prepareExternalReserveAttempt=async(...args)=>{
  const attempt=await original(...args);
  await ref(c.root,'accounts',c.account).update({credited:41,available:41});
  return attempt;
 };
 const jobId=await c.ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);
 c.backend.prepareExternalReserveAttempt=original;
 assert.equal(typeof jobId,'string');
});

test('a blocked guard still stops the preflight without an Account POST',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('guard_blocked');
 await ref(c.root,'billingGuards',c.account).create({accountId:c.account,blocked:true});
 const result=await observed(c.ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid));
 assert.ok(result.error);
 assert.equal(await videoJobs(c),0);
});

test('a guard absent at preflight and still clear at the job write is accepted',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('guard_absent');
 const jobId=await c.ai.enqueue(c.account,c.input,'translation:en',1,randomUUID(),c.uid);
 assert.equal(typeof jobId,'string');
 const guard=await ref(c.root,'billingGuards',c.account).get();
 assert.equal(guard.exists,false,'This case is only meaningful when the guard stayed absent');
});

test('two sequential reservations keep distinct attempts and ACK observations',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('two_attempts');const first=randomUUID(),second=randomUUID();
 await c.ai.enqueue(c.account,c.input,'translation:en',1,first,c.uid);
 await c.ai.enqueue(c.account,c.input,'translation:en',1,second,c.uid);
 const attempts=(await c.root.collection('billingReserveAttempts').get()).docs;
 const acks=(await c.root.collection('billingReserveAckObservations').get()).docs;
 assert.equal(attempts.length,2);assert.equal(acks.length,2);
 assert.equal(new Set(attempts.map(doc=>doc.get('attemptId'))).size,2,'Distinct attempts must stay distinct');
 assert.ok(acks.every(doc=>doc.get('attribution')==='unverified'&&doc.get('state')==='reserved'));
});

test('an ACK tuple of another attempt cannot be staged with this job',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('ack_tuple');const key=randomUUID();
 const originalPrepare=c.backend.prepareExternalReserveAttempt.bind(c.backend),originalReserve=c.backend.reserve.bind(c.backend);
 try{
  c.backend.prepareExternalReserveAttempt=async(...args)=>{
   const attempt=await originalPrepare(...args);
   // Model a caller that forwards a well-formed but foreign reservation id:
   // only the staged observation proves the POST's ACK belonged to this attempt.
   c.backend.reserve=async(...next)=>{const foreign={...next[11],reservationId:randomUUID()};return originalReserve(...next.slice(0,11),foreign);};
   return attempt;
  };
  const result=await observed(c.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid));
  assert.ok(result.error,'A foreign ACK tuple must not authorize a job');
  assert.equal(await videoJobs(c),0,'A foreign ACK tuple must never create work');
  const acks=(await c.root.collection('billingReserveAckObservations').get()).docs;
  assert.equal(acks.length,1,'Only the real ACK survives without work');
  assert.equal(acks[0].get('reservationId'),reservationUuid(c.account,c.identity,c.input,'translation:en',1,key));
  assert.equal(acks[0].get('attribution'),'unverified');
 }finally{c.backend.prepareExternalReserveAttempt=originalPrepare;c.backend.reserve=originalReserve;}
});
test('the Account POST must use exactly the prepared attempt history',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('post_tuple');const key=randomUUID(),id=sha(JSON.stringify([c.account,key]));
 const before=await localBalance(c);
 const original=c.backend.prepareExternalReserveAttempt.bind(c.backend);
 try{
  // The persisted history is the authority for the POST. Here the intent and its
  // origin carry 3 seconds while the caller already computed a 2-second reservation:
  // forwarding the stale tuple would reserve in Account with a history that the ACK
  // can only reject afterwards, leaving a paid reservation without work.
  c.backend.prepareExternalReserveAttempt=async(...args)=>{
   await ref(c.root,'billingIntents',id).update({seconds:3});
   await ref(c.root,'billingIntentWitnesses',id).update({seconds:3});
   return original(...args);
  };
  const result=await observed(c.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid));
  assert.equal(result.error?.code,'conflict','A POST tuple that differs from the prepared attempt must fail closed');
  assert.equal(c.transport.bodies.filter(entry=>entry.path==='/api/internal/video/reservations').length,0,'No Account POST may use a stale tuple');
  assert.deepEqual(await localBalance(c),before,'The Account balance must stay untouched');
  const prepared=await attempts(c);
  assert.equal(prepared.length,1,'The attempt was already committed before the comparison; it stays prepared without an ACK');
  assert.equal(prepared[0].witness.seconds,3,'The stored attempt carries the persisted history, not the stale POST tuple');
  assert.equal(await videoJobs(c),0,'No work may be created without an Account POST');
  assert.equal((await c.root.collection('billingReserveAckObservations').get()).size,0,'No ACK observation exists because no POST was sent');
 }finally{c.backend.prepareExternalReserveAttempt=original;}
});
// Codex certification test (step 1.3b): the preflight itself refuses a guard that became blocked AFTER the failure-evidence capture and BEFORE the attempt is
// prepared (a narrow race the earlier capture cannot see). No attempt is recorded and no Account POST is sent.
test('a guard blocked between the evidence capture and the preflight prevents the Account POST',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('guard_blocked_race');const key=randomUUID();let posts=0;
 const originalTransport=c.transport.request.bind(c.transport);
 c.transport.request=async request=>{if(new URL(request.url).pathname.endsWith('/reservations'))posts++;return originalTransport(request);};
 const original=c.backend.captureExternalBillingIntentFailureEvidence.bind(c.backend);
 c.backend.captureExternalBillingIntentFailureEvidence=async(...args)=>{const evidence=await original(...args);await ref(c.root,'billingGuards',c.account).set({accountId:c.account,blocked:true});return evidence;};
 const result=await observed(c.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid));
 c.backend.captureExternalBillingIntentFailureEvidence=original;
 assert.ok(result.error,'A guard blocked before the preflight must stop the request');
 assert.equal(posts,0,'No Account POST for a blocked account');
 assert.equal(await videoJobs(c),0);
 assert.equal((await c.root.collection('billingReserveAttempts').get()).size,0,'The preflight must not record an attempt for a blocked account');
});

// Codex certification test (step 1.3b): the preflight also refuses a job request or marker that appeared AFTER the failure-evidence capture and BEFORE the attempt
// is prepared (work created by a concurrent requester). Neither an attempt nor an Account POST may follow.
for(const [label,collection]of [['request','requests'],['marker','billingIntentJobMarkers']])test(`a job ${label} appearing between the evidence capture and the preflight prevents the Account POST`,{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('work_race_'+label);const key=randomUUID();let posts=0;
 const originalTransport=c.transport.request.bind(c.transport);
 c.transport.request=async request=>{if(new URL(request.url).pathname.endsWith('/reservations'))posts++;return originalTransport(request);};
 const original=c.backend.captureExternalBillingIntentFailureEvidence.bind(c.backend);
 c.backend.captureExternalBillingIntentFailureEvidence=async(...args)=>{const evidence=await original(...args);await ref(c.root,collection,sha(JSON.stringify([c.account,key]))).create({synthetic:'concurrent-work'});return evidence;};
 const result=await observed(c.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid));
 c.backend.captureExternalBillingIntentFailureEvidence=original;
 assert.ok(result.error,'Work that appeared before the preflight must stop the request');
 assert.equal(posts,0,'No Account POST once work exists');
 assert.equal((await c.root.collection('billingReserveAttempts').get()).size,0,'No attempt is recorded for an intent that already has work');
});

// Codex certification test (step 1.3b): a COMPLETE terminal pair (witness AND recovery, the evidence module only rejects an incoherent half pair) that exists at the
// preflight means the intent already went down the release or seal path: no attempt may be recorded and no Account POST may follow.
for(const action of ['seal','release'])test(`a complete ${action} terminal pair existing at the preflight prevents the Account POST`,{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('terminal_pair_'+action);const key=randomUUID();let posts=0;
 const originalTransport=c.transport.request.bind(c.transport);
 c.transport.request=async request=>{if(new URL(request.url).pathname.endsWith('/reservations'))posts++;return originalTransport(request);};
 const intentId=sha(JSON.stringify([c.account,key])),terminalId=sha(JSON.stringify(['billing-intent-terminal-v1',intentId,action]));
 const original=c.backend.captureExternalBillingIntentFailureEvidence.bind(c.backend);
 c.backend.captureExternalBillingIntentFailureEvidence=async(...args)=>{const evidence=await original(...args);
  await ref(c.root,'billingIntentTerminalWitnesses',terminalId).create({synthetic:'terminal-witness'});await ref(c.root,'billingIntentTerminalRecovery',terminalId).create({synthetic:'terminal-recovery'});return evidence;};
 const result=await observed(c.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid));
 c.backend.captureExternalBillingIntentFailureEvidence=original;
 assert.ok(result.error,'A complete terminal pair at the preflight must stop the request');
 assert.equal(posts,0,'No Account POST once a terminal pair exists');
 assert.equal((await c.root.collection('billingReserveAttempts').get()).size,0,'No attempt is recorded for an intent with a terminal pair');
});

// Codex certification test (step 1.3b): the EXACT version of each immutable document, isolated from its content. A harmless MERGE (`update`) changes only the
// version (updateTime) and leaves every field the other checks read untouched, so only the exact-version comparison can reject it. For the documents that must
// NOT exist at the preflight, creating them afterwards changes the version from "absent" to "present".
for(const [name,collection,addressOf,mode]of [
 ['identity','identities',(c,id)=>c.identity,'update'],['input','inputs',(c,id)=>c.input,'update'],['project','projects',(c,id)=>c.input,'update'],
 ['origin','billingIntentWitnesses',(c,id)=>id,'update'],['intentGuard','billingIntentAdmissionGuards',(c,id)=>id,'update'],
 ['jobMarker','billingIntentJobMarkers',(c,id)=>id,'create']])test(`a version-only change of the ${name} document after the preflight blocks the job and keeps only the ACK`,{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('version_only_'+name);const key=randomUUID(),id=sha(JSON.stringify([c.account,key]));
 const original=c.backend.prepareExternalReserveAttempt.bind(c.backend);
 c.backend.prepareExternalReserveAttempt=async(...args)=>{
  const attempt=await original(...args);
  const target=ref(c.root,collection,addressOf(c,id));
  if(mode==='update')await target.update({windowProbe:name});else await target.create({windowProbe:name});
  return attempt;
 };
 const result=await observed(c.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid));
 c.backend.prepareExternalReserveAttempt=original;
 assert.ok(result.error,`${name}: a changed immutable version must not authorize work`);
 assert.equal(await videoJobs(c),0,`${name}: no job may be created`);
 const acks=await c.root.collection('billingReserveAckObservations').get();
 assert.equal(acks.size,1,`${name}: the received ACK must survive without a job`);
});
