// Synthetic-only LV-019.B step 1.6c fixture: MAXIMUM AGE with alert and the INTENT-ATTEMPT record, against a LOCAL
// Firestore emulator with a REAL `AccountStore` behind a local adapter of `AccountBillingClient`. No cloud service,
// credential, HTTP route or real media is touched. Every wait is bounded and every fixture terminates its client.
// Design: docs/specs/LV-019-B-ejecutor-periodico-drenajes.md (3.4, 3.5, 4).
import assert from 'node:assert/strict';
import {prepareFinancialOwnedRoot,assertFinancialOwnedRoot,deleteFinancialOwnedRoot} from './financialOwnedRootGuard.mjs';
import {after,afterEach,before,test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend,EXTERNAL_BILLING_ATTEMPT_LIMIT,EXTERNAL_BILLING_MAX_AGE_MS} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {AccountBillingClient,accountIdentityKey} from './accountBillingClient.ts';
import {AccountStore} from '../account/backend.ts';
import {privateBucket} from './privateObjectPlan.ts';
import {runBillingDrainSection} from './billingDrainSection.ts';
import {runPendingSweep} from './billingPendingSweep.ts';
import {ALERT_COLLECTION} from './billingPendingAlerts.ts';

const project='demo-vistavo-financial',host='127.0.0.1:8198';
const videoCollection='vistavo_age_escalation_video_synthetic',accountCollection='vistavo_age_escalation_ledger_synthetic';
const WORK_TIMEOUT_MS=180000,CLEANUP_TIMEOUT_MS=45000,TERMINATE_TIMEOUT_MS=15000,DAY=24*60*60*1000;
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
 for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY',
  'K_SERVICE','K_REVISION','K_JOB','FUNCTION_TARGET','GAE_ENV','VISTAVO_PROJECT_ID'])assert.ok(!process.env[key],`Unexpected ${key}`);
}
async function descendants(document,found=[]){for(const group of await document.listCollections())for(const child of await group.listDocuments()){found.push(child);await descendants(child,found);}return found;}
const ref=(c,name,id)=>c.root.collection(name).doc(id);

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
   counters.cleaned++;console.log(`Age-escalation cleanup verified ${counters.cleaned}/${counters.created}`);
  }finally{try{await bounded(c.db.terminate(),TERMINATE_TIMEOUT_MS,'terminate');}catch{/* closed even if terminate errors */}}
 }
});
after(()=>{console.log(`Age-escalation cleanup total: ${counters.cleaned}/${counters.created}`);assert.equal(counters.cleaned,counters.created);});

const accountStatus={invalid:400,not_found:404,account_not_provisioned:404,conflict:409,deleted:410,quota:429,insufficient:402,invariant:503,too_early:409,forbidden:403};
/** Local stand-in for the Account HTTP edge: forwards the whitelisted body to a real `AccountStore`. */
class LocalAccountTransport{
 constructor(store){this.store=store;}
 async request(request){
  const pathname=new URL(request.url).pathname,body=request.data,parts=pathname.split('/'),reservationId=parts.at(-2);
  const httpFault=(status,code)=>Object.assign(Error('Synthetic Account refusal'),{response:{status,data:{error:code}}});
  const guard=async action=>{try{return {data:await action()};}catch(error){if(error?.response)throw error;throw httpFault(accountStatus[error?.code]??503,error?.code??'invariant');}};
  if(pathname==='/api/internal/video/reservations')return guard(async()=>({...await this.store.reserveVideo(body.identityKey,body.reservationId,body.seconds),reservationId:body.reservationId}));
  if(pathname.endsWith('/status'))return guard(()=>this.store.videoReservation(body.identityKey,reservationId));
  if(pathname.endsWith('/release')||pathname.endsWith('/capture')){
   const action=pathname.endsWith('/release')?'release':'capture';
   const admission=body.jobId!==undefined?{jobId:body.jobId,attemptId:body.attemptId}:undefined;
   const choose=body.resolutionKind!==undefined?{resolution:{kind:body.resolutionKind,evidenceSha256:body.evidenceSha256}}:body.capturedSeconds!==undefined?{capturedSeconds:body.capturedSeconds}:undefined;
   return guard(async()=>({...await this.store.settleVideo(body.identityKey,reservationId,action,body.seconds,admission,choose),reservationId}));
  }
  throw httpFault(404,'not_found');
 }
}

function reservationFor(account,identity,input,operation,revision,key){
 const bytes=createHash('sha256').update(JSON.stringify(['vistavo-video-reservation-v1',account,identity,input,operation,revision,key])).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

async function fixture(scope){
 assertSafeEnvironment();
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false});
 const root=db.collection(videoCollection).doc(randomUUID()),accountRoot=db.collection(accountCollection).doc(randomUUID());
 const c={scope,db,root,accountRoot,roots:[root,accountRoot].map(document=>({root:document,marker:{project,purpose:'age-escalation-synthetic-v1',nonce:randomUUID()}}))};
 contexts.push(c);counters.created++;
 for(const entry of c.roots){assert.equal((await entry.root.get()).exists,false);assert.deepEqual(await entry.root.listCollections(),[]);await entry.root.create(entry.marker);}
 c.backend=new FirestoreBackend(db,root);
 c.store=new AccountStore(db,accountRoot,()=>Date.now());
 c.uid='synthetic-age-owner-'+randomUUID();c.account=await c.backend.accountForUid(c.uid);
 await ref(c,'accounts',c.account).update({aiPilot:true,simulationOnly:true});
 const boot=await c.store.bootstrap(c.uid);c.accountOwner=boot.account.id;
 await accountRoot.collection('accounts').doc(c.accountOwner).update({credited:40,available:40});
 c.identity=accountIdentityKey(c.uid);
 const transport=new LocalAccountTransport(c.store);
 const objects={async putArtifactOnce(){throw Error('Unexpected synthetic artifact write');},async read(){throw Error('Unexpected synthetic object read');}};
 c.ai=new FirestoreAi(db,root,c.backend,objects,undefined,new AccountBillingClient(undefined,transport));
 c.input=randomUUID();const source=Buffer.from('synthetic age placeholder '+randomUUID()),sourceSha=sha(source);
 await ref(c,'inputs',c.input).create({accountId:c.account,expiresAtMs:Date.now()+3600000,sha256:sourceSha,deleted:false,ready:true,unknownCount:0,
  metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:`candidate-files-v1/${c.input}/video.mp4`,generation:'1',size:source.length,sha256:sourceSha}});
 await c.backend.saveProject(c.account,c.input,0,'Synthetic age input.');
 c.requestKey=randomUUID();
 c.reservationId=reservationFor(c.account,c.identity,c.input,'translation:en',1,c.requestKey);
 c.billing={provider:'account_seconds',identityKey:c.identity,reservationId:c.reservationId,seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,c.requestKey,'translation:en',1,c.billing);
 c.intentId=sha(JSON.stringify([c.account,c.requestKey]));c.intent=ref(c,'billingIntents',c.intentId);
 // A REAL Account reservation, so "no balance moved" is a statement about real ledger state.
 await c.store.reserveVideo(c.identity,c.reservationId,2);
 return c;
}

/** The three routes that end in `intentsFailed++; continue;` without any evidence to record. */
async function breakEvidence(c,mode){
 if(mode==='missing_snapshot'){
  const original=c.backend.pendingExternalBillingIntents.bind(c.backend);
  c.backend.pendingExternalBillingIntents=async(...args)=>(await original(...args)).map(row=>({...row,snapshotVersion:undefined}));
 }else if(mode==='no_evidence'){
  await ref(c,'requests',c.intentId).create({jobId:randomUUID(),accountId:c.account,requestFingerprint:'synthetic-already-a-job'});
 }else if(mode==='no_status_snapshot'){
  await ref(c,'projects',c.input).update({accountId:randomUUID()});
 }else throw Error('unknown evidence mode');
}

const balanceOf=c=>c.store.videoBalance(c.identity);
const ledgerOf=async c=>{const rows=await c.accountRoot.collection('ledgerEntries').get();return rows.docs.map(doc=>({id:doc.id,data:doc.data()})).sort((a,b)=>a.id<b.id?-1:1);};
const seed=(c,collection,id,data)=>ref(c,collection,id).create(data);
const staleIntent=(c,extra={})=>({accountId:c.account,state:'reserve_pending',attempts:1,nextAttemptAt:0,createdAtMs:Date.now()-DAY-1,...extra});
const staleOutbox=(c,extra={})=>({accountId:c.account,state:'pending',attempts:0,nextAttemptAt:0,createdAtMs:Date.now()-DAY-1,...extra});
const staleHold=(c,extra={})=>({accountId:c.account,state:'pending',attempts:0,nextAttemptAt:0,createdAtMs:Date.now()-DAY-1,...extra});
const oneLine=line=>{assert.equal(typeof line,'string');assert.ok(!line.includes('\n'));return JSON.parse(line);};

test('(1) an intent whose evidence cannot be captured advances attempts, waits longer and reaches needs_review at the eighth pass',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('one_stall');
 await breakEvidence(c,'no_evidence');
 const seen=[];
 for(let pass=1;pass<=EXTERNAL_BILLING_ATTEMPT_LIMIT-2;pass++){
  const result=await c.ai.drainExternalBilling();
  assert.equal(result.intentsFailed,1,'the stalled route counts one failed intent');
  const row=(await c.intent.get()).data();
  assert.equal(row.state,'reserve_pending');assert.equal(row.attempts,1+pass);
  assert.equal(row.lastErrorCode,'unavailable');assert.ok(Number.isSafeInteger(row.lastAttemptAtMs));
  assert.equal(row.nextAttemptAt,row.lastAttemptAtMs+Math.min(15*60_000,1000*2**Math.min(row.attempts,10)));
  seen.push(row.attempts);
  await c.intent.update({nextAttemptAt:0});
 }
 const eighth=await c.ai.drainExternalBilling();
 assert.equal(eighth.intentsFailed,1);
 const final=(await c.intent.get()).data();
 assert.equal(final.state,'needs_review');assert.equal(final.attempts,EXTERNAL_BILLING_ATTEMPT_LIMIT);assert.equal(final.reviewReason,undefined);
 assert.equal((await c.root.collection('billingHoldOutbox').get()).size,0,'the owner is never blocked by a hold');
 assert.notEqual((await ref(c,'billingGuards',c.account).get()).get('blocked'),true,'no billing guard is set');
 assert.equal((await ref(c,'billingIntents',c.intentId).get()).get('state'),'needs_review');
 assert.deepEqual(seen,[2,3,4,5,6,7]);
 assert.deepEqual(await balanceOf(c),{unit:'video_seconds',credited:40,available:38,reserved:2,consumed:0,active:1});
});

for(const mode of ['missing_snapshot','no_evidence','no_status_snapshot'])test('(2) the '+mode+' route records the attempt instead of retrying forever',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('route_'+mode);
 await breakEvidence(c,mode);
 const first=await c.ai.drainExternalBilling();
 assert.equal(first.intentsFailed,1);
 const afterFirst=(await c.intent.get()).data();
 assert.equal(afterFirst.attempts,2);assert.equal(afterFirst.state,'reserve_pending');assert.ok(afterFirst.nextAttemptAt>Date.now());
 const holds=(await c.root.collection('billingHoldOutbox').get()).size;
 assert.equal(holds,0,'no hold is created by the stall record');
 assert.notEqual((await ref(c,'billingGuards',c.account).get()).get('blocked'),true);
 await c.intent.update({nextAttemptAt:0});
 const second=await c.ai.drainExternalBilling();
 assert.equal((await c.intent.get()).get('attempts'),3);
});

test('(3) the exact age limit and one millisecond younger are untouched; one millisecond older is escalated',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('boundary');
 const now=Date.now(),maxAgeMs=DAY;
 await seed(c,'billingIntents','exact',staleIntent(c,{createdAtMs:now-maxAgeMs}));
 await seed(c,'billingIntents','younger',staleIntent(c,{createdAtMs:now-maxAgeMs+1}));
 await seed(c,'billingIntents','older',staleIntent(c,{createdAtMs:now-maxAgeMs-1}));
 const report=await c.backend.escalateStaleBillingRows({now,maxAgeMs,limit:10});
 assert.equal(report.escalated,1);assert.equal(report.failed,0);
 assert.equal((await ref(c,'billingIntents','exact').get()).get('state'),'reserve_pending');
 assert.equal((await ref(c,'billingIntents','younger').get()).get('state'),'reserve_pending');
 const older=(await ref(c,'billingIntents','older').get()).data();
 assert.equal(older.state,'needs_review');assert.equal(older.reviewReason,'max_age');assert.equal(older.updatedAtMs,now);
 assert.equal(EXTERNAL_BILLING_MAX_AGE_MS,48*60*60*1000);
});

test('(4) the three non-terminal collections are covered and terminal rows are not',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('collections');
 await seed(c,'billingIntents','i_res',staleIntent(c));
 await seed(c,'billingIntents','i_rel',staleIntent(c,{state:'release_pending'}));
 await seed(c,'billingIntents','i_closed',staleIntent(c,{state:'closed'}));
 await seed(c,'billingOutbox','o_pending',staleOutbox(c));
 await seed(c,'billingOutbox','o_retry',staleOutbox(c,{state:'retry_wait'}));
 await seed(c,'billingOutbox','o_settled',staleOutbox(c,{state:'settled'}));
 await seed(c,'billingHoldOutbox','h_pending',staleHold(c));
 await seed(c,'billingHoldOutbox','h_applied',staleHold(c,{state:'applied'}));
 const report=await c.backend.escalateStaleBillingRows({now:Date.now(),maxAgeMs:DAY,limit:10});
 assert.equal(report.escalated,5);assert.equal(report.failed,0);
 for(const [collection,id] of [['billingIntents','i_res'],['billingIntents','i_rel'],['billingOutbox','o_pending'],['billingOutbox','o_retry'],['billingHoldOutbox','h_pending']])
  assert.equal((await ref(c,collection,id).get()).get('state'),'needs_review',collection+'/'+id);
 for(const [collection,id] of [['billingIntents','i_closed'],['billingOutbox','o_settled'],['billingHoldOutbox','h_applied']])
  assert.notEqual((await ref(c,collection,id).get()).get('state'),'needs_review',collection+'/'+id);
});

test('(5) a row whose state changed between the page read and its own transaction is never overwritten',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('changed_state');
 await seed(c,'billingIntents','a',staleIntent(c));
 let flipped=false;
 const report=await c.backend.escalateStaleBillingRows({now:Date.now(),maxAgeMs:DAY,limit:10,shouldContinue:async()=>{
  if(!flipped){flipped=true;await ref(c,'billingIntents','a').update({state:'closed'});}
  return true;
 }});
 assert.equal(report.escalated,0);
 const row=(await ref(c,'billingIntents','a').get()).data();
 assert.equal(row.state,'closed');assert.equal(row.reviewReason,undefined);
});

test('(6) a missing, textual, negative or future createdAtMs counts a failure, leaves the row intact and the pass goes on',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('malformed_age');
 const now=Date.now();
 await seed(c,'billingIntents','absent',{accountId:c.account,state:'reserve_pending',attempts:1,nextAttemptAt:0});
 await seed(c,'billingIntents','textual',staleIntent(c,{createdAtMs:'yesterday'}));
 await seed(c,'billingIntents','negative',staleIntent(c,{createdAtMs:-5}));
 await seed(c,'billingIntents','future',staleIntent(c,{createdAtMs:now+60_000}));
 await seed(c,'billingIntents','stale',staleIntent(c,{createdAtMs:now-DAY-1}));
 const report=await c.backend.escalateStaleBillingRows({now,maxAgeMs:DAY,limit:10});
 assert.equal(report.failed,4);assert.equal(report.escalated,1);
 for(const id of ['absent','textual','negative','future'])assert.equal((await ref(c,'billingIntents',id).get()).get('state'),'reserve_pending',id);
 assert.equal((await ref(c,'billingIntents','stale').get()).get('state'),'needs_review');
});

test('(7) the escalation moves no balance, no ledger entry, no hold and no guard',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('no_side_effects');
 await seed(c,'billingIntents','i',staleIntent(c));
 await seed(c,'billingOutbox','o',staleOutbox(c));
 await seed(c,'billingHoldOutbox','h',staleHold(c));
 const beforeBalance=await balanceOf(c),beforeLedger=await ledgerOf(c);
 const report=await c.backend.escalateStaleBillingRows({now:Date.now(),maxAgeMs:DAY,limit:10});
 assert.equal(report.escalated,3);
 assert.deepEqual(await balanceOf(c),beforeBalance);
 assert.deepEqual(await ledgerOf(c),beforeLedger);
 assert.equal((await c.root.collection('billingHoldOutbox').get()).size,1,'only the seeded hold exists');
 assert.equal((await ref(c,'billingHoldOutbox','h').get()).get('state'),'needs_review');
 assert.equal((await ref(c,'billingGuards',c.account).get()).exists,false,'no guard document is written');
 assert.equal((await c.accountRoot.collection('ledgerEntries').where('kind','==','video_release').get()).size,0);
});

test('(8) the escalation is idempotent and two concurrent executions never double-escalate',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('concurrent');
 const ids=['a','b','c','d'];
 for(const id of ids)await seed(c,'billingIntents',id,staleIntent(c));
 const [first,second]=await Promise.all([
  c.backend.escalateStaleBillingRows({now:Date.now(),maxAgeMs:DAY,limit:10}),
  c.backend.escalateStaleBillingRows({now:Date.now(),maxAgeMs:DAY,limit:10}),
 ]);
 assert.ok(first.escalated+second.escalated>=ids.length,'every stale row is escalated at least once');
 assert.ok(first.escalated+second.escalated<=2*ids.length);
 for(const id of ids){
  const row=(await ref(c,'billingIntents',id).get()).data();
  assert.equal(row.state,'needs_review');assert.equal(row.reviewReason,'max_age');
 }
 const third=await c.backend.escalateStaleBillingRows({now:Date.now(),maxAgeMs:DAY,limit:10});
 assert.equal(third.escalated,0,'a row already in needs_review is never escalated again');
 assert.equal(third.failed,0);
});

test('(9) the executor section runs the age escalation with its own budget and gate, and counts it in the heartbeat',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('section');
 await seed(c,'billingIntents','stale_invalid',{accountId:c.account,provider:'account_seconds',state:'reserve_pending',nextAttemptAt:0,createdAtMs:Date.now()-EXTERNAL_BILLING_MAX_AGE_MS-DAY});
 const lines=[];
 const starved=await runBillingDrainSection({db:c.db,root:c.root,ai:c.ai,backend:c.backend,now:Date.now(),enabled:true,budgetMs:60000,sectionBudgetsMs:{age:0},log:line=>lines.push(line)});
 assert.equal(starved.outcome,'partial','a starved age section ends partial');
 assert.equal(starved.staleEscalated,0);
 assert.equal((await ref(c,'billingIntents','stale_invalid').get()).get('state'),'reserve_pending','the age budget refuses before the first row');
 const clean=await runBillingDrainSection({db:c.db,root:c.root,ai:c.ai,backend:c.backend,now:Date.now(),enabled:true,budgetMs:60000,log:line=>lines.push(line)});
 assert.equal(clean.staleEscalated,1);
 assert.equal((await ref(c,'billingIntents','stale_invalid').get()).get('state'),'needs_review');
 const cursors=(await ref(c,'billingDrainLease','cursors').get()).data();
 assert.ok(cursors&&Object.hasOwn(cursors,'age'),'the age cursor is persisted');
 const heartbeat=oneLine(lines[0]);
 assert.deepEqual(Object.keys(heartbeat).sort(),HEARTBEAT_KEYS);
 assert.equal(heartbeat.staleEscalated,0);
 assert.equal(oneLine(lines[1]).staleEscalated,1);
 const joined=lines.join('\n');
 for(const secret of [c.account,c.uid,c.intentId,'stale_invalid'])assert.ok(!joined.includes(secret),'the heartbeat must not contain '+secret);
});

test('(10) one needs_review by age produces exactly one alert in the real pending sweep',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('sweep');
 await seed(c,'billingIntents','stale_sweep',staleIntent(c));
 const now=Date.now();
 const report=await c.backend.escalateStaleBillingRows({now,maxAgeMs:DAY,limit:10});
 assert.equal(report.escalated,1);
 const summary=await runPendingSweep(c.db,c.root,now);
 assert.equal(summary.ok,true);assert.equal(summary.created,1);
 const alerts=await c.root.collection(ALERT_COLLECTION).get();
 assert.equal(alerts.size,1);
 const alert=alerts.docs[0].data();
 assert.equal(alert.kind,'intent');assert.equal(alert.rowId,'stale_sweep');assert.equal(alert.state,'needs_review');assert.equal(alert.reason,'needs_review');
 const second=await runPendingSweep(c.db,c.root,now+1000);
 assert.equal(second.created,0);assert.equal(second.seen,1);
 assert.equal((await c.root.collection(ALERT_COLLECTION).get()).size,1,'one alert per row, never two');
});

// Codex certification tests (step 1.6c): the rotation must reach EVERY stale row, whatever the collection it lives in.
const rotate=async(c,limit,passes,now)=>{
 let after=null;const reports=[];
 for(let pass=0;pass<passes;pass++){const report=await c.backend.escalateStaleBillingRows({now,maxAgeMs:DAY,limit,after});reports.push(report);after=report.next;}
 return reports;
};
const freshRow=(c,extra={})=>({accountId:c.account,state:'pending',attempts:0,nextAttemptAt:0,createdAtMs:Date.now(),...extra});

test('(11) a full page of young rows in one collection never starves stale rows with smaller ids in another',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('rotation_starvation');
 for(const id of ['h_1','h_2','h_3','h_4'])await seed(c,'billingHoldOutbox',id,freshRow(c));
 await seed(c,'billingOutbox','a_stale1',staleOutbox(c));await seed(c,'billingOutbox','a_stale2',staleOutbox(c));
 await rotate(c,3,8,Date.now());
 for(const id of ['a_stale1','a_stale2'])assert.equal((await ref(c,'billingOutbox',id).get()).get('state'),'needs_review',id+' must be reached by the rotation');
 for(const id of ['h_1','h_2','h_3','h_4'])assert.equal((await ref(c,'billingHoldOutbox',id).get()).get('state'),'pending',id+' is young and stays untouched');
});

test('(12) two stale rows with the same id in two collections are both reached even when the page limit is one',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('rotation_same_id');
 await seed(c,'billingHoldOutbox','dup',staleHold(c));await seed(c,'billingOutbox','dup',staleOutbox(c));
 await rotate(c,1,6,Date.now());
 assert.equal((await ref(c,'billingHoldOutbox','dup').get()).get('state'),'needs_review','hold row');
 assert.equal((await ref(c,'billingOutbox','dup').get()).get('state'),'needs_review','outbox row');
});

test('(13) one rotation attends every row exactly once and a short page ends the rotation',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('rotation_complete');
 const ids=['r1','r2','r3','r4','r5','r6','r7'];
 for(const [index,id] of ids.entries())await seed(c,['billingIntents','billingOutbox','billingHoldOutbox'][index%3],id,index%3===0?staleIntent(c):index%3===1?staleOutbox(c):staleHold(c));
 const now=Date.now();let after=null,escalated=0,passes=0;
 do{const report=await c.backend.escalateStaleBillingRows({now,maxAgeMs:DAY,limit:3,after});escalated+=report.escalated;after=report.next;passes++;}while(after!==null&&passes<10);
 assert.equal(escalated,7,'every row escalated once in a single rotation');assert.equal(after,null,'the rotation wrapped');assert.ok(passes<=4,'no pass repeated work: '+passes);
});


// Codex certification (step 1.6c), extra case: when a YOUNG row keeps an id occupied, a STALE sibling with the SAME id
// in another collection must still travel in the same page. Without the tie inclusion the young row holds the cursor id
// and the stale sibling is starved on every pass (test 12 alone cannot see this: both of its rows are stale, so the
// first escalation frees the id).
test('(14) a young row and a stale sibling with the same id are both selected in one page, so the stale one is never starved',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('rotation_tie_young');
 await seed(c,'billingHoldOutbox','dup',freshRow(c));await seed(c,'billingOutbox','dup',staleOutbox(c));
 const reports=await rotate(c,1,8,Date.now());
 assert.equal((await ref(c,'billingOutbox','dup').get()).get('state'),'needs_review','the stale sibling is reached even while the young row holds the id');
 assert.equal((await ref(c,'billingHoldOutbox','dup').get()).get('state'),'pending','the young row stays untouched');
 assert.ok(reports.some(report=>report.escalated===1),'the stale sibling is escalated in one of the passes');
});
// Codex certification, correction 2. These pin the four adjudicated findings: stopping inside a tie group, the exact
// state seen by the scan, the due check of the stall record, and the intent lease.
test('(15) stopping inside a tie group leaves the cursor on the last COMPLETED id, so the rest of the group is reached',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('tie_pause');
 // The fixture's own intent is terminal so the page holds only the three-row tie group.
 await c.intent.update({state:'closed'});
 await seed(c,'billingHoldOutbox','dup',staleHold(c));await seed(c,'billingIntents','dup',staleIntent(c));await seed(c,'billingOutbox','dup',staleOutbox(c));
 let asked=0;
 const first=await c.backend.escalateStaleBillingRows({now:Date.now(),maxAgeMs:DAY,limit:1,shouldContinue:async()=>++asked<=1});
 assert.equal(first.escalated,1,'only the first row of the group is attended before the stop');
 assert.equal(first.stopped,true);
 assert.equal(first.next,null,'the interrupted group is the first one, so the cursor stays at `after`');
 const second=await c.backend.escalateStaleBillingRows({now:Date.now(),maxAgeMs:DAY,limit:10,after:first.next});
 assert.equal(second.escalated,2,'the other two rows of the same id are reached by the next call');
 for(const collection of ['billingHoldOutbox','billingIntents','billingOutbox'])
  assert.equal((await ref(c,collection,'dup').get()).get('state'),'needs_review',collection+'/dup');
 // A fully completed group before the interrupted one must advance the cursor: `next` is the last id whose whole tie
 // group was attended, never the id of the group the stop landed in.
 await seed(c,'billingIntents','a',staleIntent(c));
 await seed(c,'billingHoldOutbox','dup2',staleHold(c));await seed(c,'billingIntents','dup2',staleIntent(c));await seed(c,'billingOutbox','dup2',staleOutbox(c));
 let asked2=0;
 const third=await c.backend.escalateStaleBillingRows({now:Date.now(),maxAgeMs:DAY,limit:10,shouldContinue:async()=>++asked2<=2});
 assert.equal(third.escalated,2,'the single row `a` and the first row of `dup2` are attended before the stop');
 assert.equal(third.next,'a','the cursor is the last fully completed id, not the interrupted group');
 const fourth=await c.backend.escalateStaleBillingRows({now:Date.now(),maxAgeMs:DAY,limit:10,after:third.next});
 assert.equal(fourth.escalated,2,'the remaining rows of `dup2` are reached after the completed id');
 assert.equal((await ref(c,'billingOutbox','dup2').get()).get('state'),'needs_review','the last row of `dup2` is reached');
});

test('(16) a row that moved to another non-terminal state after the scan is skipped, not escalated',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('exact_state');
 await seed(c,'billingIntents','i_move',staleIntent(c));
 let flipped=false;
 const report=await c.backend.escalateStaleBillingRows({now:Date.now(),maxAgeMs:DAY,limit:10,shouldContinue:async()=>{
  if(!flipped){flipped=true;await ref(c,'billingIntents','i_move').update({state:'release_pending'});}
  return true;
 }});
 assert.equal(report.escalated,0,'a state change between scan and transaction is not escalated');
 const row=(await ref(c,'billingIntents','i_move').get()).data();
 assert.equal(row.state,'release_pending');assert.equal(row.reviewReason,undefined);
});

test('(17) the stall record counts one attempt per due window, so two drainers cannot double count the same row',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('stall_due');
 const requestKey=randomUUID(),id=sha(JSON.stringify([c.account,requestKey])),intent=ref(c,'billingIntents',id);
 await seed(c,'billingIntents',id,{accountId:c.account,requestKey,id,state:'reserve_pending',attempts:1,nextAttemptAt:0,createdAtMs:Date.now()});
 assert.equal(await c.backend.recordExternalBillingIntentStall(c.account,requestKey,'unavailable'),true);
 const afterFirst=(await intent.get()).data();
 assert.equal(afterFirst.attempts,2);
 assert.equal(await c.backend.recordExternalBillingIntentStall(c.account,requestKey,'unavailable'),false,'a second call inside the new wait writes nothing');
 assert.equal((await intent.get()).get('attempts'),2,'the same attempt is never counted twice');
 await intent.update({nextAttemptAt:0});
 assert.equal(await c.backend.recordExternalBillingIntentStall(c.account,requestKey,'unavailable'),true,'a row that is due again does count');
 assert.equal((await intent.get()).get('attempts'),3);
});

test('(18) an intent with an active lease is not escalated; an expired or dangling lease is cleared when it is',{timeout:WORK_TIMEOUT_MS},async()=>{
 const c=await fixture('intent_lease');
 const now=Date.now(),old=now-DAY-1;
 await seed(c,'billingIntents','i_active',staleIntent(c,{createdAtMs:old,leaseToken:'11111111-1111-4111-8111-111111111111',leaseOwner:'holder-a',leaseUntil:now+60_000}));
 await seed(c,'billingIntents','i_expired',staleIntent(c,{createdAtMs:old,leaseToken:'22222222-2222-4222-8222-222222222222',leaseOwner:'holder-b',leaseUntil:now-1}));
 await seed(c,'billingIntents','i_dangling',staleIntent(c,{createdAtMs:old,leaseToken:'33333333-3333-4333-8333-333333333333'}));
 const report=await c.backend.escalateStaleBillingRows({now,maxAgeMs:DAY,limit:10});
 assert.equal(report.escalated,2,'only the rows without an active lease are escalated');
 const active=(await ref(c,'billingIntents','i_active').get()).data();
 assert.equal(active.state,'reserve_pending');assert.equal(active.leaseToken,'11111111-1111-4111-8111-111111111111');
 assert.equal(active.leaseOwner,'holder-a');assert.equal(active.leaseUntil,now+60_000);
 for(const id of ['i_expired','i_dangling']){
  const row=(await ref(c,'billingIntents',id).get()).data();
  assert.equal(row.state,'needs_review',id);
  for(const field of ['leaseToken','leaseOwner','leaseUntil'])assert.ok(!Object.hasOwn(row,field),field+' must be cleared on '+id);
 }
});