// Synthetic-only LV-019.B step 1.6b fixture (drain CONTROL, first round). It runs a REAL `AccountStore` behind a local
// adapter of `AccountBillingClient`, against the fixed demo emulator at 127.0.0.1:8198. No cloud service, credential, HTTP
// route or real media is touched. Every wait is bounded and every fixture terminates its Firestore client in a finally.
//
// Design: docs/specs/LV-019-B-ejecutor-periodico-drenajes.md (sections 2, 3.2-3.6, 4). These scenarios pin the CONTROL
// contract of `drainExternalBilling`/`drainExternalHolds` (second OPTIONAL argument `control`) and are written to fail
// TODAY for the right reason: the current drain ignores the second argument, so there is no `stopped`, no `skippedRows`,
// no `next`, no per-account cap and no rotation cursor.
//
// The cap/cursor/stop scenarios seed syntactically shaped, well-ordered `billingOutbox` rows the drain can attend
// deterministically WITHOUT any Account call (an incomplete tuple is quarantined before the POST), so the counts of
// attended vs skipped rows are the observable contract and nothing in the ledger moves for them. Only the concurrency
// and interruption scenarios use real reservations, so a single balance movement is what is actually measured.
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

const project='demo-vistavo-financial',host='127.0.0.1:8198';
const videoCollection='vistavo_drain_control_video_synthetic',accountCollection='vistavo_drain_control_ledger_synthetic';
const WORK_TIMEOUT_MS=180000,CLEANUP_TIMEOUT_MS=45000,TERMINATE_TIMEOUT_MS=15000;
const sha=value=>createHash('sha256').update(value).digest('hex');
const contexts=[],counters={created:0,cleaned:0};

/** A bounded race so a stalled shared emulator fails loudly and fast instead of hanging, and cleanup still runs. */
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
 for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY',
  'K_SERVICE','K_REVISION','K_JOB','FUNCTION_TARGET','GAE_ENV','VISTAVO_PROJECT_ID'])assert.equal(process.env[key],undefined,`Unexpected ${key}`);
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
   counters.cleaned++;console.log(`Drain-control cleanup verified ${counters.cleaned}/${counters.created}`);
  }finally{try{await bounded(c.db.terminate(),TERMINATE_TIMEOUT_MS,'terminate');}catch{/* the handle is closed even if terminate reports an error */}}
 }
});
after(()=>{console.log(`Drain-control cleanup total: ${counters.cleaned}/${counters.created}`);assert.equal(counters.cleaned,counters.created);});

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
   const options=body.resolutionKind!==undefined?{resolution:{kind:body.resolutionKind,evidenceSha256:body.evidenceSha256}}:body.capturedSeconds!==undefined?{capturedSeconds:body.capturedSeconds}:undefined;
   return guard(async()=>({...await this.store.settleVideo(body.identityKey,reservationId,action,body.seconds,admission,options),reservationId}));
  }
  throw httpFault(404,'not_found');
 }
}

async function fixture(scope){
 assertSafeEnvironment();
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
 const root=db.collection(videoCollection).doc(randomUUID()),accountRoot=db.collection(accountCollection).doc(randomUUID());
 const c={scope,db,root,accountRoot,roots:[root,accountRoot].map(document=>({root:document,marker:{project,purpose:'drain-control-synthetic-v1',nonce:randomUUID()}}))};
 contexts.push(c);counters.created++;
 for(const entry of c.roots){assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);await entry.root.create(entry.marker);}
 c.backend=new FirestoreBackend(db,root);c.store=new AccountStore(db,accountRoot);
 c.uid='synthetic-drain-owner-'+randomUUID();c.account=await c.backend.accountForUid(c.uid);
 await c.root.collection('accounts').doc(c.account).update({aiPilot:true,simulationOnly:true});
 const boot=await c.store.bootstrap(c.uid);c.accountOwner=boot.account.id;
 await c.accountRoot.collection('accounts').doc(c.accountOwner).update({credited:40,available:40});
 c.identity=accountIdentityKey(c.uid);
 c.input=randomUUID();const source=Buffer.from('synthetic source placeholder; not a decodable video'),sourceSha=sha(source);
 c.storage={bucket:privateBucket,key:`candidate-files-v1/${c.input}/video.mp4`,generation:'1',size:source.length,sha256:sourceSha};
 await c.root.collection('inputs').doc(c.input).create({accountId:c.account,expiresAtMs:Date.now()+3600000,sha256:sourceSha,deleted:false,ready:true,unknownCount:0,
  metadata:{duration:2,audioTracks:1},storage:c.storage});
 await c.backend.saveProject(c.account,c.input,0,'Synthetic input only.');
 c.transport=new LocalAccountTransport(c.store);
 const objects={async putArtifactOnce(){throw Error('Unexpected synthetic artifact write');},async read(){throw Error('Unexpected synthetic object read');}};
 c.ai=new FirestoreAi(db,root,c.backend,objects,undefined,new AccountBillingClient(undefined,c.transport));
 return c;
}
/** A second real account in the same Video root, used for the fairness/cap scenarios. */
async function secondAccount(c){
 const uid='synthetic-drain-owner-b-'+randomUUID(),account=await c.backend.accountForUid(uid);
 await c.root.collection('accounts').doc(account).update({aiPilot:true,simulationOnly:true});
 return {uid,account};
}
/** Enqueue one text job (real Account reserve included). */
async function newJob(c){
 const requestKey=randomUUID(),id=await c.ai.enqueue(c.account,c.input,'translation:en',1,requestKey,c.uid);
 const row=await c.backend.job(c.account,id);
 assert.equal(row.aiProfile,AI_CATALOG_VERSION);assert.equal(row.price,2);
 assert.equal(row.externalBilling.identityKey,c.identity);
 return {id,requestKey,reservationId:row.externalBilling.reservationId,attempt:null};
}
const outboxRef=(c,id)=>c.root.collection('billingOutbox').doc(id);
const reservationDoc=(c,reservationId)=>c.accountRoot.collection('videoReservations').doc(sha(JSON.stringify([c.accountOwner,reservationId])));
/** Claim and admit one provider call in the real Account, then write the matching worker receipt. */
async function admitCall(c,job){
 const attempt=await c.backend.claim(c.account,job.id);assert.ok(attempt);
 const row=await c.backend.job(c.account,job.id);
 if(row.invocationPhase==='local_check')assert.equal(await c.backend.resumeTextAfterLocalCheck(c.account,job.id,attempt.attemptId,row.inputStorage,'nonzero'),true);
 assert.equal(await c.backend.beginInvocation(c.account,job.id,attempt.attemptId),true);
 job.attempt=attempt;
 const requestSha256='b'.repeat(64),responseSha256='c'.repeat(64);
 await c.store.admitVideoCall(c.identity,job.reservationId,2,job.id,attempt.attemptId,'text-window:0000','gemini-3.8-flash',requestSha256);
 await c.root.collection('providerCalls').doc(`${job.id}-text-window-0000`).create({jobId:job.id,accountId:c.account,attemptId:attempt.attemptId,callKey:'text-window:0000',
  model:'gemini-3.8-flash',state:'received',requestSha256,responseSha256,responseId:'synthetic-drain-receipt',httpStatus:200,
  startedAtMs:Date.now()-50,finishedAtMs:Date.now(),usage:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2},fixtureOnly:true});
 return {callKey:'text-window:0000',responseSha256};
}
/** Produce one real PENDING release row through the certified no-speech path. */
async function pendingRelease(c,job){
 const receipt=await admitCall(c,job);
 assert.equal(await c.backend.completeNoSpeech(c.account,job.id,job.attempt.attemptId,[{callKey:receipt.callKey,responseSha256:receipt.responseSha256}]),true);
 const row=await outboxRef(c,job.id).get();assert.equal(row.get('state'),'pending');assert.equal(row.get('action'),'release');
 return job;
}

const idFor=n=>'00000000-0000-0000-0000-'+n.toString(16).padStart(12,'0');
/** Read a document's full observable state: its fields together with its version tuple. */
async function versioned(ref){const snap=await ref.get();const time=snap.updateTime;return {exists:snap.exists,data:snap.data()??null,version:time?`${time.seconds}:${String(time.nanoseconds).padStart(9,'0')}`:null};}
/**
 * Seed one due settlement row for `accountId`. The tuple is intentionally incomplete (no `seconds`), so the drain attends
 * the row, quarantines it before any Account call and counts it as attended, while the ledger never moves. The document
 * id (`idFor(n)`) gives a deterministic document-id order, which is exactly what the cap and the rotation cursor order by.
 */
async function seedPendingRow(c,id,accountId){
 await outboxRef(c,id).create({jobId:id,accountId,provider:'account_seconds',identityKey:'a'.repeat(64),reservationId:randomUUID(),
  action:'release',state:'pending',attempts:0,generation:0,nextAttemptAt:0,createdAtMs:Date.now()});
 return id;
}
const count=value=>typeof value==='number'?value:0;
/** Rows a billing drain actually attended, whichever terminal bucket they landed in. */
const attendedBilling=result=>count(result.settled)+count(result.failed)+count(result.intentsRecovered)+count(result.intentsFailed);
const attendedHolds=result=>count(result.applied)+count(result.failed)+count(result.review);
const restoredBalance={unit:'video_seconds',credited:40,available:40,reserved:0,consumed:0,active:0};

test('S1 without control the billing drain behaves exactly as today (characterization)',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('s1_characterization'),job=await newJob(c);
 await pendingRelease(c,job);
 const before=c.transport.bodies.length;
 const result=await c.ai.drainExternalBilling();
 assert.equal(result.settled,1);assert.equal(result.failed,0);assert.equal(result.intentsRecovered,0);assert.equal(result.intentsFailed,0);
 assert.ok(result.skippedRows===undefined||result.skippedRows===0,'without control nothing is skipped');
 assert.ok(result.stopped===undefined||result.stopped===false,'without control the pass is not marked stopped');
 assert.equal(c.transport.bodies.length-before,1,'exactly one Account call');
 assert.equal((await outboxRef(c,job.id).get()).get('state'),'settled');
 assert.deepEqual(await c.store.videoBalance(c.identity),restoredBalance);
});

test('S1b without control the holds drain behaves exactly as today (characterization)',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('s1b_holds_characterization');
 const id=sha(JSON.stringify(['synthetic-hold',randomUUID()]));
 await c.root.collection('billingHoldOutbox').doc(id).create({accountId:c.account,state:'pending',nextAttemptAt:0,attempts:0});
 const result=await c.ai.drainExternalHolds();
 assert.ok(result.stopped===undefined||result.stopped===false,'without control the holds pass is not marked stopped');
 assert.ok(result.skippedRows===undefined||result.skippedRows===0,'without control no hold is skipped');
 assert.equal(attendedHolds(result),1,'the seeded hold is attended once');
});

for(const mode of ['false','throw'])test('S2 shouldContinue ('+mode+') ends the pass cleanly after the rows already attended, leaving the rest untouched',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('s2_should_continue_'+mode);
 const ids=[1,2,3,4].map(idFor);
 for(const id of ids)await seedPendingRow(c,id,c.account);
 const before={};for(const id of ids)before[id]=await versioned(outboxRef(c,id));
 let calls=0;
 const control={shouldContinue:()=>{calls++;if(mode==='throw'&&calls===3)throw Error('synthetic control failure');return calls<3;}};
 const result=await c.ai.drainExternalBilling(100,control);
 assert.equal(result.stopped,true,'a false or throwing shouldContinue must end the pass cleanly, never as an exception');
 assert.equal(attendedBilling(result),2,'exactly the rows before the stop are attended');
 for(const id of [1,2])assert.equal((await outboxRef(c,idFor(id)).get()).get('state'),'needs_review','an attended row changes');
 for(const id of [3,4])assert.deepEqual(await versioned(outboxRef(c,idFor(id))),before[idFor(id)],'a row past the stop keeps its fields and its version');
});

test('S3 perAccountCap=5 serves five rows of a large account and the small account in one pass; the rest stay due and successive passes exhaust them without repeating',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('s3_per_account_cap'),second=await secondAccount(c);
 const big=[];for(let n=1;n<=50;n++)big.push(await seedPendingRow(c,idFor(n),c.account));
 const small=await seedPendingRow(c,idFor(0x5000),second.account);
 const first=await c.ai.drainExternalBilling(100,{perAccountCap:5});
 assert.equal(count(first.skippedRows),45,'the big account beyond the cap is counted as skipped');
 assert.equal(attendedBilling(first),6,'five of the big account plus the one of the small account in the same pass');
 for(const id of big.slice(0,5))assert.equal((await outboxRef(c,id).get()).get('state'),'needs_review');
 assert.equal((await outboxRef(c,small).get()).get('state'),'needs_review','a large account must not starve another');
 for(const id of big.slice(5))assert.equal((await outboxRef(c,id).get()).get('state'),'pending','a capped row is not touched');
 const skipped=[count(first.skippedRows)];
 for(let pass=0;pass<20;pass++){
  if(!(await c.backend.pendingExternalBilling(100)).length)break;
  skipped.push(count((await c.ai.drainExternalBilling(100,{perAccountCap:5})).skippedRows));
 }
 for(const id of big)assert.equal((await outboxRef(c,id).get()).get('state'),'needs_review','every seeded row must be attended exactly once');
 assert.equal((await c.root.collection('billingOutbox').where('state','==','pending').get()).size,0,'no due row is left behind');
 assert.deepEqual(skipped.slice(0,10),[45,40,35,30,25,20,15,10,5,0],'each pass consumes five and reports the rest as skipped');
});

test('S4 the after cursor rotates three passes over every row exactly once, wraps on the fourth, and tolerates an unknown or foreign cursor',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('s4_cursor');
 const ids=[1,2,3,4,5,6].map(idFor);
 for(const id of ids)await seedPendingRow(c,id,c.account);
 const expectedNext=[ids[1],ids[3],ids[5]];
 let after=null;
 for(let pass=0;pass<3;pass++){
  const result=await c.ai.drainExternalBilling(2,{after:{outbox:after}});
  assert.equal(attendedBilling(result),2,'each pass attends exactly two rows');
  assert.equal(result.next&&result.next.outbox,expectedNext[pass],'next is the id of the last attended row');
  const served=pass===0?[ids[0],ids[1]]:pass===1?[ids[2],ids[3]]:[ids[4],ids[5]];
  for(const id of served)assert.equal((await outboxRef(c,id).get()).get('state'),'needs_review','the rows in the window are attended');
  after=result.next.outbox;
 }
 const wrap=await c.ai.drainExternalBilling(2,{after:{outbox:after}});
 assert.equal(attendedBilling(wrap),0,'a fourth pass over an exhausted queue attends nothing');
 assert.equal(wrap.next&&wrap.next.outbox,null,'a full wrap reports a null cursor');
 // A wrap that still finds rows serves the rows after the cursor and then completes from the beginning, without repeating.
 // The cursor sits next to the end, so only ONE row follows it: the second row of the pass must come from the wrap.
 for(const id of ids)await outboxRef(c,id).update({state:'pending'});
 const wrapped=await c.ai.drainExternalBilling(2,{after:{outbox:ids[4]}});
 assert.equal(attendedBilling(wrapped),2);
 assert.equal((await outboxRef(c,ids[5]).get()).get('state'),'needs_review','the row just after the cursor is served first');
 assert.equal((await outboxRef(c,ids[0]).get()).get('state'),'needs_review','then the reader wraps to the beginning');
 assert.equal(wrapped.next&&wrapped.next.outbox,ids[0],'next is the last row attended after the wrap');
 // An unknown or foreign cursor must not break: the reader rotates and reads from the beginning. It starts strictly after
 // the cursor and wraps in document-id order; the deterministic prefix and the absence of duplicates are asserted, while
 // the exact tail element (whether the pass ends on the cursor row itself) is left to the implementation.
 const due=async candidate=>(await c.backend.pendingExternalBilling(100,candidate)).map(row=>row.id);
 for(const id of ids)await outboxRef(c,id).update({state:'pending'});
 const rotated=await due(ids[2]);
 assert.deepEqual(rotated.slice(0,5),[ids[3],ids[4],ids[5],ids[0],ids[1]],'the reader starts after the cursor and wraps in document-id order');
 assert.equal(new Set(rotated).size,rotated.length,'no row is served twice in one rotation');
 assert.deepEqual(await due(idFor(0x9999)),ids,'an unknown cursor reads the whole queue from the beginning');
 assert.deepEqual(await due('foreign-cursor-id'),ids,'a foreign cursor reads the whole queue from the beginning');
 assert.deepEqual(await due(null),ids,'a null cursor reads the whole queue in order');
});

test('S5 a fresh drain, a concurrent drain and a stalled drain that wakes late move the balance exactly once',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('s5_concurrency'),job=await newJob(c);
 await pendingRelease(c,job);
 const original=c.backend.pendingExternalBilling.bind(c.backend);
 let entered,release;const selected=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 let first=true;
 c.backend.pendingExternalBilling=async(...args)=>{const rows=await original(...args);if(first){first=false;entered();await resume;}return rows;};
 const stalled=c.ai.drainExternalBilling();
 let stalledResult;
 try{
  await selected;
  const [concurrentA,concurrentB]=await Promise.all([c.ai.drainExternalBilling(),c.ai.drainExternalBilling()]);
  assert.equal(count(concurrentA.settled)+count(concurrentB.settled),1,'two concurrent drains must settle the row exactly once between them');
  assert.equal(count((await c.ai.drainExternalBilling()).settled),0,'a later drain must not settle a settled row again');
  release();stalledResult=await stalled;
 }finally{release();await stalled.catch(()=>undefined);c.backend.pendingExternalBilling=original;}
 assert.equal(count(stalledResult.settled),0,'the stalled drain must not report a second settlement');
 assert.equal(count(stalledResult.failed),0,'the stalled drain must not report a failure for a row taken elsewhere');
 assert.equal((await outboxRef(c,job.id).get()).get('state'),'settled');
 // One single balance movement: exactly one release ledger entry and the exact final balance, whatever the Account POSTs.
 assert.equal((await c.accountRoot.collection('ledgerEntries').where('kind','==','video_release').get()).size,1,'exactly one release ledger entry');
 assert.deepEqual(await c.store.videoBalance(c.identity),restoredBalance);
 assert.equal((await c.root.collection('billingOutboxReviewIncidents').get()).size,0,'no incident');
 assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0,'no hold');
});

test('S6 a pass interrupted mid-way leaves the rest for the next pass, which completes without a second charge',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('s6_interrupted');
 const first=await newJob(c);await pendingRelease(c,first);
 const second=await newJob(c);await pendingRelease(c,second);
 let calls=0;
 const interrupted=await c.ai.drainExternalBilling(100,{shouldContinue:()=>{calls++;return calls<2;}});
 assert.equal(interrupted.stopped,true);
 assert.equal(attendedBilling(interrupted),1,'the interrupted pass attends exactly one row');
 assert.equal((await c.backend.pendingExternalBilling(100)).length,1,'one row is left for the next pass');
 const completed=await c.ai.drainExternalBilling();
 assert.equal(completed.settled,1);assert.equal(completed.failed,0);
 for(const job of [first,second]){
  assert.equal((await outboxRef(c,job.id).get()).get('state'),'settled');
  assert.equal((await reservationDoc(c,job.reservationId).get()).get('state'),'released');
 }
 assert.equal(c.transport.bodies.filter(body=>body.pathname.endsWith('/release')).length,2,'one release per reservation, never a second charge');
 assert.equal((await c.accountRoot.collection('ledgerEntries').where('kind','==','video_release').get()).size,2);
 assert.deepEqual(await c.store.videoBalance(c.identity),restoredBalance);
});

test('S7 drainExternalHolds honors shouldContinue and perAccountCap',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('s7_holds'),second=await secondAccount(c);
 const seedHold=async accountId=>{const id=sha(JSON.stringify(['synthetic-hold',randomUUID()]));await c.root.collection('billingHoldOutbox').doc(id).create({accountId,state:'pending',nextAttemptAt:0,attempts:0});return id;};
 const four=[];for(let n=0;n<4;n++)four.push(await seedHold(c.account));
 const before={};for(const id of four)before[id]=await versioned(c.root.collection('billingHoldOutbox').doc(id));
 let calls=0;
 const stopped=await c.ai.drainExternalHolds(100,{shouldContinue:()=>{calls++;return calls<3;}});
 assert.equal(stopped.stopped,true,'a false shouldContinue must end the holds pass cleanly');
 assert.equal(attendedHolds(stopped),2,'exactly two holds are attended before the stop');
 const untouched=[];for(const id of four)if((await c.root.collection('billingHoldOutbox').doc(id).get()).get('state')==='pending')untouched.push(id);
 assert.equal(untouched.length,2,'the two holds past the stop stay pending');
 for(const id of untouched)assert.deepEqual(await versioned(c.root.collection('billingHoldOutbox').doc(id)),before[id],'an untouched hold keeps its fields and its version');
 for(const id of four)await c.root.collection('billingHoldOutbox').doc(id).delete();
 const big=[];for(let n=0;n<50;n++)big.push(await seedHold(c.account));
 const small=await seedHold(second.account);
 const capped=await c.ai.drainExternalHolds(100,{perAccountCap:5});
 assert.equal(count(capped.skippedRows),45,'holds of the big account beyond the cap are skipped');
 assert.equal(attendedHolds(capped),6,'five of the big account plus the one of the small account');
 assert.equal((await c.root.collection('billingHoldOutbox').doc(small).get()).get('state'),'needs_review','the small account is attended, not starved');
 // Holds share `nextAttemptAt:0` and have random ids, so which five of the big account go first is not fixed: only the counts are.
 let bigAttended=0,bigPending=0;
 for(const id of big){(await c.root.collection('billingHoldOutbox').doc(id).get()).get('state')==='pending'?bigPending++:bigAttended++;}
 assert.equal(bigAttended,5,'exactly five holds of the big account are attended');
 assert.equal(bigPending,45,'the capped holds stay pending and untouched');
});

test('S8 the intents cursor rotates the intent queue through the drain without repeating',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('s8_intents_cursor');
 const ids=[1,2,3,4,5,6].map(idFor);
 // Incomplete intent tuples: the drain attends each one (counted as a failed intent) and stops before any Account call, so the
 // rotation is observable purely through the counts and the `next` cursor, and nothing in the ledger or Account moves.
 for(const id of ids)await c.root.collection('billingIntents').doc(id).create({provider:'account_seconds',state:'reserve_pending',accountId:c.account,updatedAtMs:Date.now()});
 const first=await c.ai.drainExternalBilling(2,{after:{intents:ids[2]}});
 assert.equal(first.intentsFailed,2,'the pass after the cursor attends exactly two intents');
 assert.equal(first.intentsRecovered,0,'an invalid intent is never recovered');
 assert.equal(first.next&&first.next.intents,ids[4],'next is the last intent attended, strictly after the cursor');
 const wrapped=await c.ai.drainExternalBilling(2,{after:{intents:ids[4]}});
 assert.equal(wrapped.intentsFailed,2);
 assert.equal(wrapped.next&&wrapped.next.intents,ids[0],'the reader wraps to the beginning when the tail runs short');
 const full=await c.ai.drainExternalBilling(100,{after:{intents:ids[5]}});
 assert.equal(full.intentsFailed,5,'a full rotation serves every intent except the cursor row');
 assert.equal(full.next&&full.next.intents,ids[4],'a full rotation ends on the last row before the cursor');
});

test('S9 a stop in the intents section never leaks into the outbox section',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('s9_intents_then_outbox');
 const intentIds=[1,2,3].map(idFor),outboxIds=[0x100,0x101].map(idFor);
 for(const id of intentIds)await c.root.collection('billingIntents').doc(id).create({provider:'account_seconds',state:'reserve_pending',accountId:c.account,updatedAtMs:Date.now()});
 for(const id of outboxIds)await seedPendingRow(c,id,c.account);
 const before={};for(const id of outboxIds)before[id]=await versioned(outboxRef(c,id));
 // shouldContinue turns false ONCE and true again: a leak into the outbox section would then be free to attend a row, which is what this scenario must catch.
 let calls=0;
 const result=await c.ai.drainExternalBilling(100,{shouldContinue:()=>{calls++;return calls!==2;}});
 assert.equal(result.stopped,true,'the pass stops as soon as shouldContinue turns false');
 assert.equal(attendedBilling(result),1,'exactly one intent row is attended before the stop');
 assert.equal(result.next&&result.next.outbox,null,'no outbox row was attended, so the outbox cursor stays null');
 for(const id of outboxIds)assert.deepEqual(await versioned(outboxRef(c,id)),before[id],'an outbox row past the stop keeps its fields and its version');
});
