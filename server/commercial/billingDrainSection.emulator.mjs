// Synthetic-only LV-019.B step 1.6b (second part) fixture: the periodic drain SECTION against a LOCAL Firestore
// emulator, with a REAL `AccountStore` behind a local adapter of `AccountBillingClient`. No cloud service, credential,
// HTTP route or real media is touched. Every wait is bounded and every fixture terminates its Firestore client.
// Design: docs/specs/LV-019-B-ejecutor-periodico-drenajes.md (sections 2, 3.2-3.6, 4).
import assert from 'node:assert/strict';
import {prepareFinancialOwnedRoot,assertFinancialOwnedRoot,deleteFinancialOwnedRoot} from './financialOwnedRootGuard.mjs';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {AI_CATALOG_VERSION} from './aiContracts.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {runBillingDrainSection,REAL_DRAIN_LEASE_OPS} from './billingDrainSection.ts';
import {Worker} from 'node:worker_threads';
import {acquireDrainLease} from './billingDrainLease.ts';
import {UNKNOWN_RESOLUTION_MIN_AGE_MS} from '../account/settlementContract.ts';

const project='demo-vistavo-financial',host='127.0.0.1:8198';
const videoCollection='vistavo_drain_section_video_synthetic',accountCollection='vistavo_drain_section_ledger_synthetic';
const WORK_TIMEOUT_MS=180000,CLEANUP_TIMEOUT_MS=45000,TERMINATE_TIMEOUT_MS=15000;
const WINDOW=6*60*60*1000;
const HEARTBEAT_KEYS=['durationMs','event','failed','holds','intentsFailed','intentsRecovered','leaseToken','outcome','settled','skippedRows','staleEscalated','startedAtMs','unknownResolved'].sort();
const sha=value=>createHash('sha256').update(value).digest('hex');
const contexts=[],counters={created:0,cleaned:0};

function bounded(promise,ms,label){
 let timer;
 const guard=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('emulator timeout: '+label)),ms);});
 promise.catch(()=>undefined);
 return Promise.race([promise,guard]).finally(()=>clearTimeout(timer));
}
function assertSafeEnvironment(){
 if(!process.env.LV_REVIEW_CONTRACT)process.env.LV_REVIEW_CONTRACT='1';
 if(!process.env.METADATA_SERVER_DETECTION)process.env.METADATA_SERVER_DETECTION='none';
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 // The check names the variable, never its value: an inherited secret must not reach this log either.
 for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY',
  'K_SERVICE','K_REVISION','K_JOB','FUNCTION_TARGET','GAE_ENV','VISTAVO_PROJECT_ID'])assert.ok(!process.env[key],`Unexpected ${key}`);
}
async function descendants(document,found=[]){for(const group of await document.listCollections())for(const child of await group.listDocuments()){found.push(child);await descendants(child,found);}return found;}

before(async()=>{
 assertSafeEnvironment();
 assert.equal((await fetch(`http://${host}/`,{signal:AbortSignal.timeout(5000)})).status,200);
});
afterEach(async()=>{
 for(const c of contexts.splice(0)){
  try{
   for(const entry of c.roots){await assertFinancialOwnedRoot(c.db,entry.root,entry.marker);
    assert.deepEqual((await entry.root.get()).data(),entry.marker);
    const known=await descendants(entry.root);for(const document of known)assert.ok(document.path.startsWith(entry.root.path+'/'));
    await bounded(deleteFinancialOwnedRoot(c.db,entry.root,entry.marker),CLEANUP_TIMEOUT_MS,'cleanup delete');
    assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);
    for(const document of known)assert.equal((await document.get()).exists,false);
   }
   counters.cleaned++;console.log(`Drain-section cleanup verified ${counters.cleaned}/${counters.created}`);
  }finally{try{await bounded(c.db.terminate(),TERMINATE_TIMEOUT_MS,'terminate');}catch{/* closed even if terminate errors */}}
 }
});
after(()=>{console.log(`Drain-section cleanup total: ${counters.cleaned}/${counters.created}`);assert.equal(counters.cleaned,counters.created);});

const accountStatus={invalid:400,not_found:404,account_not_provisioned:404,conflict:409,deleted:410,quota:429,insufficient:402,invariant:503,too_early:409,forbidden:403};
/** Local stand-in for the Account HTTP edge: forwards the whitelisted body to a real `AccountStore`. */
class LocalAccountTransport{
 bodies=[];
 constructor(store){this.store=store;}
 async request(request){
  const pathname=new URL(request.url).pathname,body=request.data;
  this.bodies.push({pathname,data:{...body}});
  const parts=pathname.split('/'),reservationId=parts.at(-2);
  const httpFault=(status,code)=>Object.assign(Error('Synthetic Account refusal'),{response:{status,data:{error:code}}});
  const guard=async action=>{try{return {data:await action()};}catch(error){if(error?.response)throw error;throw httpFault(accountStatus[error?.code]??503,error?.code??'invariant');}};
  if(pathname==='/api/internal/video/reservations')return guard(async()=>({...await this.store.reserveVideo(body.identityKey,body.reservationId,body.seconds),reservationId:body.reservationId}));
  if(pathname.endsWith('/status'))return guard(()=>this.store.videoReservation(body.identityKey,reservationId));
  if(pathname.endsWith('/admit'))return guard(()=>this.store.admitVideoCall(body.identityKey,reservationId,body.seconds,body.jobId,body.attemptId,body.callKey,body.model,body.requestSha256));
  if(pathname.endsWith('/release')||pathname.endsWith('/capture')){
   const action=pathname.endsWith('/release')?'release':'capture';
   const admission=body.jobId!==undefined?{jobId:body.jobId,attemptId:body.attemptId}:undefined;
   const choose=body.resolutionKind!==undefined?{resolution:{kind:body.resolutionKind,evidenceSha256:body.evidenceSha256}}:body.capturedSeconds!==undefined?{capturedSeconds:body.capturedSeconds}:undefined;
   return guard(async()=>({...await this.store.settleVideo(body.identityKey,reservationId,action,body.seconds,admission,choose),reservationId}));
  }
  throw httpFault(404,'not_found');
 }
}

async function fixture(scope){
 assertSafeEnvironment();
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
 const root=db.collection(videoCollection).doc(randomUUID()),accountRoot=db.collection(accountCollection).doc(randomUUID());
 const c={scope,db,root,accountRoot,roots:[root,accountRoot].map(document=>({root:document,marker:{project,purpose:'drain-section-synthetic-v1',nonce:randomUUID()}}))};
 contexts.push(c);counters.created++;
 for(const entry of c.roots){assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);await entry.root.create(entry.marker);}
 c.backend=new FirestoreBackend(db,root);c.accountClock=Date.now();c.store=new AccountStore(db,accountRoot,()=>c.accountClock);
 c.uid='synthetic-drain-section-owner-'+randomUUID();c.account=await c.backend.accountForUid(c.uid);
 await c.root.collection('accounts').doc(c.account).update({aiPilot:true,simulationOnly:true});
 const boot=await c.store.bootstrap(c.uid);c.accountOwner=boot.account.id;
 await c.accountRoot.collection('accounts').doc(c.accountOwner).update({credited:40,available:40});
 c.identity=accountIdentityKey(c.uid);
 c.transport=new LocalAccountTransport(c.store);
 const objects={async putArtifactOnce(){throw Error('Unexpected synthetic artifact write');},async read(){throw Error('Unexpected synthetic object read');}};
 c.ai=new FirestoreAi(db,root,c.backend,objects,undefined,new AccountBillingClient(undefined,c.transport));
 c.owner={uid:c.uid,account:c.account,identity:c.identity,accountOwner:c.accountOwner};
 return c;
}
async function secondAccount(c){
 const uid='synthetic-drain-section-owner-b-'+randomUUID(),account=await c.backend.accountForUid(uid);
 await c.root.collection('accounts').doc(account).update({aiPilot:true,simulationOnly:true});
 const boot=await c.store.bootstrap(uid);
 await c.accountRoot.collection('accounts').doc(boot.account.id).update({credited:40,available:40});
 return {uid,account,identity:accountIdentityKey(uid),accountOwner:boot.account.id};
}
async function addInput(c,owner){
 const input=randomUUID(),source=Buffer.from('synthetic source placeholder '+randomUUID()),sourceSha=sha(source);
 await c.root.collection('inputs').doc(input).create({accountId:owner.account,expiresAtMs:Date.now()+3600000,sha256:sourceSha,deleted:false,ready:true,unknownCount:0,
  metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:`candidate-files-v1/${input}/video.mp4`,generation:'1',size:source.length,sha256:sourceSha}});
 await c.backend.saveProject(owner.account,input,0,'Synthetic input only.');
 return input;
}
async function newJob(c,owner=null){
 owner=owner??c.owner;
 const input=await addInput(c,owner),requestKey=randomUUID();
 const id=await c.ai.enqueue(owner.account,input,'translation:en',1,requestKey,owner.uid);
 const row=await c.backend.job(owner.account,id);
 assert.equal(row.aiProfile,AI_CATALOG_VERSION);assert.equal(row.price,2);
 return {id,input,requestKey,reservationId:row.externalBilling.reservationId,attempt:null,owner};
}
const outboxRef=(c,id)=>c.root.collection('billingOutbox').doc(id);
const reservationDoc=(c,job)=>c.accountRoot.collection('videoReservations').doc(sha(JSON.stringify([job.owner.accountOwner,job.reservationId])));
async function admitCall(c,job){
 const attempt=await c.backend.claim(job.owner.account,job.id);assert.ok(attempt);
 const row=await c.backend.job(job.owner.account,job.id);
 if(row.invocationPhase==='local_check')assert.equal(await c.backend.resumeTextAfterLocalCheck(job.owner.account,job.id,attempt.attemptId,row.inputStorage,'nonzero'),true);
 assert.equal(await c.backend.beginInvocation(job.owner.account,job.id,attempt.attemptId),true);
 job.attempt=attempt;
 const requestSha256='b'.repeat(64),responseSha256='c'.repeat(64);
 await c.store.admitVideoCall(job.owner.identity,job.reservationId,2,job.id,attempt.attemptId,'text-window:0000','gemini-3.8-flash',requestSha256);
 await c.root.collection('providerCalls').doc(`${job.id}-text-window-0000`).create({jobId:job.id,accountId:job.owner.account,attemptId:attempt.attemptId,callKey:'text-window:0000',
  model:'gemini-3.8-flash',state:'received',requestSha256,responseSha256,responseId:'synthetic-drain-section-receipt',httpStatus:200,
  startedAtMs:Date.now()-50,finishedAtMs:Date.now(),usage:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},fixtureOnly:true});
 return {callKey:'text-window:0000',responseSha256};
}
async function pendingRelease(c,job){
 const receipt=await admitCall(c,job);
 assert.equal(await c.backend.completeNoSpeech(job.owner.account,job.id,job.attempt.attemptId,[{callKey:receipt.callKey,responseSha256:receipt.responseSha256}]),true);
 const row=await outboxRef(c,job.id).get();assert.equal(row.get('state'),'pending');assert.equal(row.get('action'),'release');
 return job;
}
async function sealUnknown(c,job){
 await admitCall(c,job);
 assert.equal(await c.backend.cancel(job.owner.account,job.id),true,'the invoking job must seal into unknown');
 const row=await c.backend.job(job.owner.account,job.id);
 assert.equal(row.state,'unknown');assert.ok(Number.isSafeInteger(row.quarantinedAtMs));
 return row;
}
const idFor=n=>'00000000-0000-0000-0000-'+n.toString(16).padStart(12,'0');
async function seedPendingRow(c,id,accountId){
 await outboxRef(c,id).create({jobId:id,accountId,provider:'account_seconds',identityKey:'a'.repeat(64),reservationId:randomUUID(),
  action:'release',state:'pending',attempts:0,generation:0,nextAttemptAt:0,createdAtMs:Date.now()});
 return id;
}
const count=value=>typeof value==='number'?value:0;
const attended=result=>count(result.settled)+count(result.failed)+count(result.intentsRecovered)+count(result.intentsFailed);
const restoredBalance={unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0};
const oneLine=line=>{assert.equal(typeof line,'string');assert.ok(!line.includes('\n'));return JSON.parse(line);};
const options=(c,extra={})=>({db:c.db,root:c.root,ai:c.ai,backend:c.backend,now:Date.now(),enabled:true,budgetMs:60000,log:()=>{},...extra});

/** A paused pass in its own worker context, so two REAL passes can race on the same loopback emulator. */
function spawnPaused(c,{epoch,pause}){
 const worker=new Worker(new URL('./billingDrainSection.emulator.worker.mjs',import.meta.url),{workerData:{project,host,videoPath:c.root.path,accountPath:c.accountRoot.path,uid:c.uid,epoch,pause},env:process.env,execArgv:['--import','tsx']});
 const messages=[];let acquiredResolve,acquiredReject;
 const acquired=new Promise((resolve,reject)=>{acquiredResolve=resolve;acquiredReject=reject;});
 const done=new Promise((resolve,reject)=>{
  worker.on('message',message=>{messages.push(message);if(message?.type==='acquired')acquiredResolve();if(message?.type==='done')resolve(message.result);});
  worker.on('error',error=>{acquiredReject(error);reject(error);});
  worker.on('exit',code=>{if(!messages.some(message=>message?.type==='done'))reject(new Error('worker exited '+code));});
 });
 done.catch(()=>undefined);acquired.catch(()=>undefined);
 return {acquired,resume:async(next)=>{worker.postMessage({epoch:next});worker.postMessage('wake');return done;},close:async()=>{await done.catch(()=>undefined);await worker.terminate();}};
}

test('(a) two simultaneous passes and a paused pass that wakes late move the balance exactly once',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('a_concurrency'),job=await newJob(c);await pendingRelease(c,job);
 const T=Date.now();
 // A real second JavaScript context (own module instance and per-root in-flight guard, own Firestore client).
 const spawned=spawnPaused(c,{epoch:T,pause:true});
 const lines=[];
 try{
  await spawned.acquired;
  // The paused context holds the lease; a fresh pass here must see it held and touch nothing.
  const skipped=await runBillingDrainSection({...options(c),now:T+1_000,clock:()=>T+1_000,log:line=>lines.push(line)});
  assert.equal(skipped.outcome,'skipped');assert.equal(skipped.reason,'lease_held');
  // Wake it past its own 90 s lease: a fresh pass took the lease meanwhile, so it stops before any row.
  const [late,fresh]=await Promise.all([spawned.resume(T+95_000),runBillingDrainSection({...options(c),now:T+95_000,clock:()=>T+95_000})]);
  assert.equal(late.outcome,'partial','a pass that lost its lease ends cleanly as partial');
  assert.equal(count(late.settled)+count(late.failed),0,'the late pass must not touch the row already settled');
  assert.equal(fresh.outcome,'ok');assert.equal(count(fresh.settled),1,'the fresh pass settles the row exactly once');
 }finally{await spawned.close();}
 assert.equal((await outboxRef(c,job.id).get()).get('state'),'settled');
 assert.equal((await c.accountRoot.collection('ledgerEntries').where('kind','==','video_release').get()).size,1,'exactly one release ledger entry');
 assert.deepEqual(await c.store.videoBalance(c.identity),restoredBalance);
 assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,0,'no incident');
 assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0,'no hold');
 assert.equal(oneLine(lines[0]).outcome,'skipped');
});
test('(b) a pass interrupted mid-way leaves the rest, and the next pass completes without a second charge',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('b_interrupted');
 const first=await newJob(c);await pendingRelease(c,first);
 const second=await newJob(c);await pendingRelease(c,second);
 let checks=0;
 const lease={...REAL_DRAIN_LEASE_OPS,assertHeld:async held=>{checks++;return checks<2&&REAL_DRAIN_LEASE_OPS.assertHeld(held);}};
 const interrupted=await runBillingDrainSection(options(c,{lease}));
 assert.equal(interrupted.outcome,'partial');
 assert.equal(count(interrupted.settled),1,'the interrupted pass settles exactly one row');
 assert.equal((await c.backend.pendingExternalBilling(100)).length,1,'one row is left for the next pass');
 const completed=await runBillingDrainSection(options(c));
 assert.equal(completed.outcome,'ok');assert.equal(count(completed.settled),1);assert.equal(count(completed.failed),0);
 for(const job of [first,second]){
  assert.equal((await outboxRef(c,job.id).get()).get('state'),'settled');
  assert.equal((await reservationDoc(c,job).get()).get('state'),'released');
 }
 assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/release')).length,2,'one release per reservation, never a second charge');
 assert.deepEqual(await c.store.videoBalance(c.identity),restoredBalance);
 assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,0);
});

test('(c) fairness and rotation: 50 due rows of one account never starve another, and passes cover all rows once',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('c_fairness'),second=await secondAccount(c);
 for(let n=1;n<=50;n++)await seedPendingRow(c,idFor(n),c.account);
 const small=await seedPendingRow(c,idFor(0x5000),second.account);
 const perPass=[];
 for(let pass=0;pass<12;pass++){
  const before=new Set((await c.backend.pendingExternalBilling(100)).map(row=>row.id));
  const result=await runBillingDrainSection(options(c));
  perPass.push(attended(result));
  const dueAfter=new Set((await c.backend.pendingExternalBilling(100)).map(row=>row.id));
  assert.ok([...dueAfter].every(id=>before.has(id)),'a pass never leaves behind a row it did not take');
  if(!dueAfter.size)break;
 }
 assert.equal(perPass[0],6,'the first pass serves five rows of the large account and the small account');
 assert.equal(perPass.reduce((total,n)=>total+n,0),51,'every seeded row is attended exactly once');
 assert.deepEqual(perPass.slice(1),Array(9).fill(5),'each later pass consumes five and never starves');
 for(let n=1;n<=50;n++)assert.equal((await outboxRef(c,idFor(n)).get()).get('state'),'needs_review');
 assert.equal((await outboxRef(c,small).get()).get('state'),'needs_review','a large account must not starve another');
 const cursors=(await c.root.collection('billingDrainLease').doc('cursors').get()).data();
 assert.ok(cursors&&(typeof cursors.intents==='string'||typeof cursors.outbox==='string'),'the rotation cursor is persisted');
});

test('(d) a stale holder after expiry neither renews nor releases and stops before the next row',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('d_stale_holder'),job=await newJob(c);await pendingRelease(c,job);
 const T=Date.now(),shared={now:T};
 let entered,resume;const stalled=new Promise(resolve=>{entered=resolve;}),wake=new Promise(resolve=>{resume=resolve;});
 const holds=c.ai.drainExternalHolds.bind(c.ai);let first=true;
 c.ai.drainExternalHolds=async(...args)=>{if(first){first=false;entered();await wake;}return holds(...args);};
 const paused=runBillingDrainSection({...options(c),now:T,clock:()=>shared.now});
 let stale,takeover;
 try{
  await stalled;
  takeover=await acquireDrainLease({db:c.db,root:c.root,holderId:'new-holder',now:T+95_000});
  assert.equal(takeover.acquired,true,'an expired lease is takeable');
  shared.now=T+96_000;
  resume();stale=await paused;
 }finally{resume();await paused.catch(()=>undefined);c.ai.drainExternalHolds=holds;}
 const lease=(await c.root.collection('billingDrainLease').doc('current').get()).data();
 assert.equal(lease.holderId,'new-holder','the stale holder must not delete or overwrite the new lease');
 assert.equal(lease.token,takeover.token,'the fresh token, one past the stale one, is never replaced by the stale holder');
 assert.equal(lease.expiresAtMs,T+95_000+90_000,'the stale holder must not renew the new lease');
 assert.equal(lease.renewedAtMs,T+95_000);
 assert.equal(stale.outcome,'partial');
 assert.equal(count(stale.settled)+count(stale.failed),0,'no row is touched after the lease is lost');
 assert.equal((await outboxRef(c,job.id).get()).get('state'),'pending','the row is left for the rightful holder');
 assert.equal((await c.root.collection('billingDrainLease').doc('cursors').get()).exists,false,'a stale holder writes no cursor');
});

test('(e) the expired-unknown resolver runs as its own section and releases an expired unknown',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('e_unknown'),job=await newJob(c);
 const sealed=await sealUnknown(c,job);
 const now=sealed.quarantinedAtMs+WINDOW+1;
 // The resolver seals the job and queues the release; Account refuses an unknown_expired inside its 15 min floor, so
 // the Account clock is moved past it and a second pass drains the release it wrote.
 c.accountClock=now+UNKNOWN_RESOLUTION_MIN_AGE_MS+60_000;
 const lines=[];
 const firstPass=await runBillingDrainSection({...options(c),now,clock:()=>now,log:line=>lines.push(line)});
 const result=await runBillingDrainSection({...options(c),now:now+1_000,clock:()=>now+1_000,log:line=>lines.push(line)});
 assert.equal(firstPass.outcome,'ok',JSON.stringify(firstPass));
 assert.equal(count(firstPass.unknownResolved),1,'the resolver resolves the expired unknown as a section');
 assert.equal(result.outcome,'ok');assert.equal(count(result.settled),1,'the next pass drains the release the resolver queued');
 const row=await c.backend.job(c.account,job.id);
 assert.equal(row.state,'failed');assert.equal(row.resolvedAs,'unknown_expired');
 assert.deepEqual(await c.store.videoBalance(c.identity),restoredBalance,'the release restores the balance');
 const heartbeat=oneLine(lines[0]);assert.deepEqual(Object.keys(heartbeat).sort(),HEARTBEAT_KEYS);
 assert.equal(heartbeat.unknownResolved,1);
 assert.equal(oneLine(lines[1]).settled,1);
});

test('(f) the switch off touches nothing and still emits a heartbeat',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('f_disabled'),job=await newJob(c);await pendingRelease(c,job);
 const lines=[];
 const result=await runBillingDrainSection({...options(c),enabled:false,log:line=>lines.push(line)});
 assert.equal(result.outcome,'disabled');
 assert.deepEqual({settled:result.settled,failed:result.failed,intentsRecovered:result.intentsRecovered},{settled:0,failed:0,intentsRecovered:0});
 assert.equal((await outboxRef(c,job.id).get()).get('state'),'pending','the switch off touches no row');
 assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/release')).length,0,'no Account call');
 const heartbeat=oneLine(lines[0]);assert.deepEqual(Object.keys(heartbeat).sort(),HEARTBEAT_KEYS);assert.equal(heartbeat.outcome,'disabled');
});

test('(g) a heartbeat is emitted in every state with the exact key set and no sensitive value',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('g_heartbeat'),job=await newJob(c);await pendingRelease(c,job);
 const lines=[];
 assert.equal((await runBillingDrainSection({...options(c),log:line=>lines.push(line)})).outcome,'ok');
 assert.equal((await runBillingDrainSection({...options(c),enabled:false,log:line=>lines.push(line)})).outcome,'disabled');
 const broken={...REAL_DRAIN_LEASE_OPS,acquire:async()=>{throw new Error('SECRET lease store '+job.id);}};
 assert.equal((await runBillingDrainSection({...options(c),lease:broken,log:line=>lines.push(line)})).outcome,'error');
 const held=Date.now();
 assert.equal((await acquireDrainLease({db:c.db,root:c.root,holderId:'other-holder',now:held})).acquired,true);
 const T=held+90_001;
 const skipped=await runBillingDrainSection({...options(c),now:held+1_000,clock:()=>held+1_000,log:line=>lines.push(line)});
 assert.equal(skipped.outcome,'skipped');assert.equal(skipped.reason,'lease_held');
 const poisoned={...c.ai,drainExternalBilling:async()=>{throw new Error('SECRET drain '+c.account);}};
 assert.equal((await runBillingDrainSection({...options(c,{ai:poisoned}),now:T,clock:()=>T,log:line=>lines.push(line)})).outcome,'partial');
 assert.equal(lines.length,5);
 for(const line of lines)assert.deepEqual(Object.keys(oneLine(line)).sort(),HEARTBEAT_KEYS);
 const joined=lines.join('\n');
 for(const secret of [c.account,c.uid,job.id,job.reservationId,'SECRET'])assert.ok(!joined.includes(secret),'the heartbeat must not contain '+secret);
});

test('(h) the unknown resolver stops row by row when its section budget runs out, leaving the rest intact',{timeout:WORK_TIMEOUT_MS},async()=>{
  const c=await fixture('h_unknown_budget');
  const jobs=[await newJob(c),await newJob(c),await newJob(c)];
  let now=0;
  for(const job of jobs){const sealed=await sealUnknown(c,job);now=Math.max(now,sealed.quarantinedAtMs);}
  now+=WINDOW+1;
  // A zero unknown budget means the resolver's gate refuses before the very first row: nothing is touched.
  const starved=await runBillingDrainSection({...options(c),now,clock:()=>now,sectionBudgetsMs:{unknown:0}});
  assert.equal(starved.outcome,'partial');
  assert.equal(count(starved.unknownResolved),0);
  const versions=[];
  const stamp=snap=>`${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}`;
  for(const job of jobs){versions.push(stamp(await c.root.collection('jobs').doc(job.id).get()));assert.equal((await c.backend.job(job.owner.account,job.id)).state,'unknown');}
  assert.equal((await c.root.collection('movements').where('kind','==','external_release').get()).size,0);
  for(let i=0;i<jobs.length;i++)assert.equal(stamp(await c.root.collection('jobs').doc(jobs[i].id).get()),versions[i],'an untouched row keeps its version');
  // A clean pass then resolves them (one per row, without an over-read).
  const clean=await runBillingDrainSection({...options(c),now,clock:()=>now});
  assert.equal(clean.outcome,'ok');
  assert.equal(count(clean.unknownResolved),3);
  for(const job of jobs)assert.equal((await c.backend.job(job.owner.account,job.id)).state,'failed');
  assert.equal((await c.root.collection('movements').where('kind','==','external_release').get()).size,3);
});

test('(i) one account gets at most five rows across holds-before, billing and holds-after of the same pass',{timeout:WORK_TIMEOUT_MS},async()=>{
  const c=await fixture('i_shared_cap');
  // Six pending holds and six pending billing rows of ONE account; the drain attends malformed rows without any POST.
  for(let n=1;n<=6;n++)await c.root.collection('billingHoldOutbox').doc('h_'+idFor(n)).create({accountId:c.account,state:'pending',attempts:0,nextAttemptAt:0,createdAtMs:Date.now()});
  for(let n=0x100;n<0x106;n++)await seedPendingRow(c,idFor(n),c.account);
  const lines=[];
  const result=await runBillingDrainSection({...options(c),log:line=>lines.push(line)});
  // The malformed fixtures are attended (and land in review/failed); the point is HOW MANY rows the account got.
  assert.equal(lines.length,1);
  assert.equal(count(result.holds)+count(result.settled)+count(result.failed),5,'five rows of the account in the WHOLE pass');
  assert.ok(count(result.skippedRows)>=7,'the capped rows are counted as skipped, never touched');
  const holdsLeft=(await c.root.collection('billingHoldOutbox').where('state','==','pending').get()).size;
  const billingLeft=(await c.backend.pendingExternalBilling(100)).length;
  // An attended malformed row is left pending for review/retry, so every row that was not taken is still due.
  assert.equal(holdsLeft+billingLeft,12,'the other twelve rows stay due for later passes');
});
