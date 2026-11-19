import assert from 'node:assert/strict';
import { test, afterEach, before } from 'node:test';
import { randomUUID } from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {processOnDemand,dispatchPending} from './firestoreWorker.ts';
import {createServer} from 'node:http';
import {firestoreHttp} from './firestoreHttp.ts';
import {cloudRunDispatch} from './cloudRunDispatch.ts';
import {prepareFinancialFixture,cleanupFinancialFixture} from './financialFixtureSafety.mjs';
function createLocalFirestoreLedger(){
 if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185')throw Error('Dedicated emulator required');
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,
  preferRest:process.env.LV_FINANCIAL_REGRESSION==='1'?false:process.env.VISTAVO_TEST_TRANSPORT!=='grpc'});
 const root=db.collection('vistavo_backend_test').doc(randomUUID());
 const ledger=new FirestoreBackend(db,root,{allowUnverifiedInputsForTests:true});
 const credit=ledger.creditVerifiedPurchase.bind(ledger);ledger.creditVerifiedPurchase=(...args)=>credit(...args,'merchant-test','sandbox');
 const reserve=ledger.reserve.bind(ledger);ledger.reserve=(...args)=>args.length===4?reserve(...args,'transcript:v1'):reserve(...args);
 return {ledger,db,root,projectId:'demo-vistavo-ledger'};
}
const contexts=[];
const sha='a'.repeat(64);
before(async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185','Dedicated emulator required; no fallback');
 await fetch('http://127.0.0.1:8185/');
});
afterEach(async()=>{for(const c of contexts.splice(0))try{await cleanupFinancialFixture(c,'vistavo_backend_test');}finally{await c.db.terminate();}});
async function fixture(credits=3){const c=createLocalFirestoreLedger();assert.equal(c.projectId,'demo-vistavo-ledger');contexts.push(c);await prepareFinancialFixture(c,'vistavo_backend_test');const account=await c.ledger.createAccount();if(credits)await c.ledger.creditVerifiedPurchase(account,'fixture-'+randomUUID(),credits,100);const input=await c.ledger.addInput(account,Date.now()+120000,sha);return{...c,account,input};}
const ref=(c,name,id)=>c.root.collection(name).doc(id);
const reject=(promise,code)=>assert.rejects(promise,error=>error.code===code);
async function claim(c,...args){const a=await c.ledger.claim(...args);if(a)assert.equal(await c.ledger.beginInvocation(args[0],args[1],a.attemptId),true);return a;}
const state=async(c,id)=>c.ledger.job(c.account,id);
const money=async(c,expected)=>{const value=await c.ledger.readBalance(c.account);assert.equal(value.credited,value.available+value.reserved+value.consumed);for(const[k,v]of Object.entries(expected))assert.equal(value[k],v,k);};
test('fails closed without the dedicated loopback emulator host',()=>{const original=process.env.FIRESTORE_EMULATOR_HOST;try{delete process.env.FIRESTORE_EMULATOR_HOST;assert.throws(()=>createLocalFirestoreLedger());process.env.FIRESTORE_EMULATOR_HOST='production.invalid:443';assert.throws(()=>createLocalFirestoreLedger());}finally{process.env.FIRESTORE_EMULATOR_HOST=original;}});
test('concurrent duplicate verified captures credit exactly once',async()=>{const c=await fixture(0);const results=await Promise.all(Array.from({length:4},()=>c.ledger.creditVerifiedPurchase(c.account,'capture-1',3,100)));assert.equal(results.filter(Boolean).length,1);await money(c,{credited:3,available:3,reserved:0,consumed:0});assert.equal((await c.root.collection('purchases').get()).size,1);});
test('same capture with changed owner or payload rejects without crediting either twice',async()=>{const c=await fixture(0);await c.ledger.creditVerifiedPurchase(c.account,'same-capture',3,100);const other=await c.ledger.createAccount();await reject(c.ledger.creditVerifiedPurchase(other,'same-capture',3,100),'conflict');await reject(c.ledger.creditVerifiedPurchase(c.account,'same-capture',4,100),'conflict');await reject(c.ledger.creditVerifiedPurchase(c.account,'same-capture',3,200),'conflict');await money(c,{credited:3,available:3});assert.equal((await c.ledger.readBalance(other)).credited,0);});
test('concurrent reservations cannot spend more than available',async()=>{const c=await fixture();const results=await Promise.allSettled([c.ledger.reserve(c.account,c.input,'a',2),c.ledger.reserve(c.account,c.input,'b',2)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'insufficient');await money(c,{available:1,reserved:2,consumed:0,active:1});});
test('stable logical request preserves its reserved price and rejects changed operation',async()=>{const c=await fixture();const results=await Promise.all([c.ledger.reserve(c.account,c.input,'key',1),c.ledger.reserve(c.account,c.input,'key',1)]);assert.equal(results[0],results[1]);assert.equal(await c.ledger.reserve(c.account,c.input,'key',2),results[0]);assert.equal((await c.ledger.job(c.account,results[0])).price,1);const strict=new FirestoreBackend(c.db,c.root,{allowUnverifiedInputsForTests:true});await reject(strict.reserve(c.account,c.input,'key',1,'different-operation'),'conflict');await money(c,{available:2,reserved:1,active:1});});
test('concurrent completion captures once and never also releases',async()=>{const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'finish',1);const a=await claim(c,c.account,id);const results=await Promise.all(Array.from({length:3},()=>c.ledger.finish(c.account,id,a.attemptId,true)));assert.equal(results.filter(Boolean).length,1);assert.equal(await c.ledger.cancel(c.account,id),false);await money(c,{available:2,reserved:0,consumed:1,active:0});assert.equal((await ref(c,'movements','terminal:'+id).get()).get('kind'),'capture');});
test('queued cancel releases once and cannot later be claimed',async()=>{const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'cancel',1);assert.equal(await c.ledger.cancel(c.account,id),true);assert.equal(await c.ledger.cancel(c.account,id),false);assert.equal(await claim(c,c.account,id),null);assert.equal((await state(c,id)).state,'cancelled');await money(c,{available:3,reserved:0,active:0});});
test('running cancel holds UNKNOWN reservation and prevents new work on that input',async()=>{const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'cancel-running',1);const a=await claim(c,c.account,id);await c.ledger.cancel(c.account,id);assert.equal((await state(c,id)).state,'unknown');assert.equal(await claim(c,c.account,id),null);assert.equal(await c.ledger.finish(c.account,id,a.attemptId,true),false);await reject(c.ledger.reserve(c.account,c.input,'different-key',1),'conflict');await money(c,{available:2,reserved:1,active:1});});
test('unknown reconciliation requires evidence and releases exactly once',async()=>{const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'unknown',1);const a=await claim(c,c.account,id);await c.ledger.quarantine(c.account,id,a.attemptId);await reject(c.ledger.reconcile(c.account,id,'failed',''),'invalid');const results=await Promise.all([c.ledger.reconcile(c.account,id,'failed','synthetic-status'),c.ledger.reconcile(c.account,id,'failed','synthetic-status')]);assert.equal(results.filter(Boolean).length,1);await money(c,{available:3,reserved:0,consumed:0,active:0});});
test('expired output is refunded instead of charged',async()=>{const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'expired',1);const a=await claim(c,c.account,id);await ref(c,'inputs',c.input).update({expiresAtMs:Date.now()-1000});assert.equal(await c.ledger.finish(c.account,id,a.attemptId,true),true);assert.equal((await state(c,id)).state,'failed');await money(c,{available:3,reserved:0,consumed:0});});
test('expired unknown resolution retains evidence and refunds an unavailable result',async()=>{const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'expired-unknown',1);const a=await claim(c,c.account,id);await c.ledger.quarantine(c.account,id,a.attemptId);await ref(c,'inputs',c.input).update({expiresAtMs:Date.now()-1000,deleted:true});await c.ledger.reconcile(c.account,id,'succeeded','synthetic-result-expired');const job=await state(c,id);assert.equal(job.state,'failed');assert.equal(job.inputSha256,sha);assert.equal(job.unknownAttemptId,a.attemptId);assert.equal(job.requestKey,'expired-unknown');assert.equal(job.reconciliationRef,'synthetic-result-expired');await money(c,{available:3,reserved:0,consumed:0});});
test('a stale attempt and a foreign account cannot change the job',async()=>{const c=await fixture();const other=await c.ledger.createAccount();const id=await c.ledger.reserve(c.account,c.input,'fence',1);await claim(c,c.account,id);assert.equal(await c.ledger.finish(c.account,id,randomUUID(),true),false);assert.equal(await c.ledger.quarantine(c.account,id,randomUUID()),false);await reject(c.ledger.job(other,id),'not_found');await reject(c.ledger.cancel(other,id),'not_found');await money(c,{reserved:1,consumed:0});});
test('completion and running cancellation choose capture or quarantine without double resolution',async()=>{const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'race',1);const a=await claim(c,c.account,id);const [done,cancelled]=await Promise.all([c.ledger.finish(c.account,id,a.attemptId,true),c.ledger.cancel(c.account,id)]);assert.notEqual(done,cancelled);const job=await state(c,id);if(job.state==='succeeded')await money(c,{reserved:0,consumed:1});else{assert.equal(job.state,'unknown');await money(c,{reserved:1,consumed:0});assert.equal((await ref(c,'movements','terminal:'+id).get()).exists,false);}});
test('multiple unknown jobs keep the input blocked until every reservation is reconciled',async()=>{const c=await fixture();const one=await c.ledger.reserve(c.account,c.input,'one',1),two=await c.ledger.reserve(c.account,c.input,'two',1);const a=await claim(c,c.account,one),b=await claim(c,c.account,two);await c.ledger.quarantine(c.account,one,a.attemptId);await c.ledger.quarantine(c.account,two,b.attemptId);assert.equal((await ref(c,'inputs',c.input).get()).get('unknownCount'),2);await c.ledger.reconcile(c.account,one,'failed','verified-one');await reject(c.ledger.reserve(c.account,c.input,'three',1),'conflict');await c.ledger.reconcile(c.account,two,'failed','verified-two');assert.equal((await ref(c,'inputs',c.input).get()).get('unknownCount'),0);assert.ok(await c.ledger.reserve(c.account,c.input,'three',1));});
test('an SDK-retried transaction callback credits once',async()=>{const c=await fixture(0);const original=c.db.runTransaction.bind(c.db);let callbacks=0;c.db.runTransaction=(fn,...args)=>original(async tx=>{const value=await fn(tx);callbacks++;if(callbacks===1)throw Object.assign(new Error('synthetic ABORTED'),{code:10});return value;},...args);try{assert.equal(await c.ledger.creditVerifiedPurchase(c.account,'retried-capture',3,100),true);}finally{c.db.runTransaction=original;}assert.ok(callbacks>=2);await money(c,{credited:3,available:3,reserved:0});assert.equal((await c.root.collection('purchases').get()).size,1);});
test('an expired lease is fenced and quarantined without releasing or capturing',async()=>{const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'lost-lease',1);const a=await claim(c,c.account,id);await ref(c,'jobs',id).update({leaseUntil:Date.now()-1000});assert.equal(await c.ledger.finish(c.account,id,a.attemptId,true),false);assert.equal((await state(c,id)).state,'unknown');await money(c,{available:2,reserved:1,consumed:0});});
test('invalid numeric inputs and overflow leave the ledger unchanged',async()=>{const c=await fixture(0);await reject(c.ledger.creditVerifiedPurchase(c.account,'nan',NaN,100),'invalid');await c.ledger.creditVerifiedPurchase(c.account,'max',Number.MAX_SAFE_INTEGER,100);await reject(c.ledger.creditVerifiedPurchase(c.account,'overflow',1,100),'invalid');await reject(c.ledger.reserve(c.account,c.input,'negative',-1),'invalid');await money(c,{credited:Number.MAX_SAFE_INTEGER,available:Number.MAX_SAFE_INTEGER,reserved:0});});
test('an expired queued input is failed and released before claim',async()=>{const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'queued-expired',1);await ref(c,'inputs',c.input).update({expiresAtMs:Date.now()-1000});assert.equal(await claim(c,c.account,id),null);assert.equal((await state(c,id)).state,'failed');await money(c,{available:3,reserved:0,active:0});});
test('UNKNOWN blocks an already queued sibling until reconciliation',async()=>{
 const c=await fixture();const one=await c.ledger.reserve(c.account,c.input,'unknown-one',1);const two=await c.ledger.reserve(c.account,c.input,'queued-two',1);
 const attempt=await claim(c,c.account,one);await c.ledger.quarantine(c.account,one,attempt.attemptId);
 assert.equal(await claim(c,c.account,two),null);
 const queued=await state(c,two);assert.equal(queued.state,'queued');assert.equal(queued.attemptId,null);
 await money(c,{credited:3,available:1,reserved:2,consumed:0,active:2});
 assert.equal(await c.ledger.reconcile(c.account,one,'failed','synthetic-cleared'),true);
 const next=await claim(c,c.account,two);assert.ok(next);assert.equal(await c.ledger.finish(c.account,two,next.attemptId,true),true);
 await money(c,{credited:3,available:2,reserved:0,consumed:1,active:0});
});

test('Firebase UID resolves to one stable zero-balance account under concurrency',async()=>{
 const c=await fixture(0);const ids=await Promise.all(Array.from({length:5},()=>c.ledger.accountForUid('verified-google-uid')));
 assert.equal(new Set(ids).size,1);const other=await c.ledger.accountForUid('different-uid');assert.notEqual(ids[0],other);
 await money({...c,account:ids[0]},{available:0,credited:0});
});
test('project optimistic revisions reject a stale concurrent editor and foreign access',async()=>{
 const c=await fixture();const created=await c.ledger.saveProject(c.account,c.input,0,'original');assert.equal(created.revision,1);
 const edits=await Promise.allSettled([c.ledger.saveProject(c.account,c.input,1,'one'),c.ledger.saveProject(c.account,c.input,1,'two')]);
 assert.equal(edits.filter(x=>x.status==='fulfilled').length,1);assert.equal((await c.ledger.readProject(c.account,c.input)).revision,2);
 await reject(c.ledger.readProject(randomUUID(),c.input),'not_found');await reject(c.ledger.saveProject(c.account,c.input,1,'stale'),'conflict');
 assert.notEqual((await c.ledger.readProject(c.account,c.input)).draft,'stale');
});
test('one reservation atomically creates one durable outbox despite repeated request',async()=>{
 const c=await fixture();const ids=await Promise.all(Array.from({length:4},()=>c.ledger.reserve(c.account,c.input,'outbox',1)));
 assert.equal(new Set(ids).size,1);assert.equal((await c.root.collection('outbox').get()).size,1);
 assert.deepEqual(await c.ledger.pendingDispatches(),[ids[0]]);await money(c,{available:2,reserved:1});
});
test('lost dispatcher response redelivers same job without a second provider invocation',async()=>{
 const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'lost-dispatch',1);let calls=0;
 const processor={process:async()=>{calls++;return 'succeeded';}};
 assert.equal(await dispatchPending(c.ledger,{start:async message=>{await processOnDemand(c.ledger,message,processor);throw Error('lost response');}}),0);
 await ref(c,'outbox',id).update({nextAttemptAt:0,leaseUntil:0});
 assert.equal(await processOnDemand(c.ledger,{accountId:c.account,jobId:id},processor),'not_claimed');
 assert.equal(calls,1);await money(c,{consumed:1,reserved:0});
});
test('transport acceptance without execution retains durable redelivery',async()=>{
 const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'accepted-only',1);let launches=0;
 const transport={start:async()=>{launches++;}};assert.equal(await dispatchPending(c.ledger,transport),1);
 assert.equal((await ref(c,'outbox',id).get()).get('state'),'pending');assert.equal((await state(c,id)).state,'queued');
 await ref(c,'outbox',id).update({nextAttemptAt:0});assert.equal(await dispatchPending(c.ledger,transport),1);assert.equal(launches,2);
});
test('worker timeout retains UNKNOWN reservation and never retries provider',async()=>{
 const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'remote-timeout',1);let calls=0;
 const processor={process:async()=>{calls++;throw Error('remote outcome unknown');}};
 assert.equal(await processOnDemand(c.ledger,{accountId:c.account,jobId:id},processor),'unknown');
 assert.equal(await processOnDemand(c.ledger,{accountId:c.account,jobId:id},processor),'not_claimed');assert.equal(calls,1);
 await money(c,{reserved:1,consumed:0});assert.equal((await state(c,id)).state,'unknown');
});
test('crashed worker lease is quarantined without calling provider again',async()=>{
 const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'crashed',1);await claim(c,c.account,id);
 await ref(c,'jobs',id).update({leaseUntil:Date.now()-1});let calls=0;
 assert.equal(await processOnDemand(c.ledger,{accountId:c.account,jobId:id},{process:async()=>{calls++;return 'succeeded';}}),'not_claimed');
 assert.equal(calls,0);assert.equal((await state(c,id)).state,'unknown');await money(c,{reserved:1});
});
test('provider IO runs outside retryable Firestore transaction callbacks',async()=>{
 const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'callback',1);const original=c.db.runTransaction.bind(c.db);let inCallback=false;
 c.db.runTransaction=(fn,...args)=>original(async tx=>{inCallback=true;try{return await fn(tx);}finally{inCallback=false;}},...args);
 try{assert.equal(await processOnDemand(c.ledger,{accountId:c.account,jobId:id},{process:async()=>{assert.equal(inCallback,false);return 'verified_failed';}}),'failed');}finally{c.db.runTransaction=original;}
 await money(c,{available:3,reserved:0,consumed:0});
});
test('expired queued input never reaches on-demand provider',async()=>{
 const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'expired-provider',1);await ref(c,'inputs',c.input).update({expiresAtMs:1});
 let calls=0;await processOnDemand(c.ledger,{accountId:c.account,jobId:id},{process:async()=>{calls++;return 'succeeded';}});
 assert.equal(calls,0);await money(c,{available:3,reserved:0});
});
test('Cloud Run transport constrains target and sends only stable job identity',async()=>{
 const message={accountId:randomUUID(),jobId:randomUUID()};let observed;
 const transport=cloudRunDispatch({projectId:'vistavo-prod',region:'us-central1',jobName:'vistavo-worker',accessToken:async()=>'synthetic-token',request:async(url,init)=>{observed={url,body:JSON.parse(init.body)};return Response.json({name:'projects/vistavo-prod/locations/us-central1/operations/example'});}});
 await transport.start(message);assert.equal(observed.body.overrides.taskCount,1);assert.equal(observed.body.overrides.containerOverrides[0].env[1].value,message.jobId);
 assert.throws(()=>cloudRunDispatch({projectId:'foreign-project',region:'us-central1',jobName:'vistavo-worker'}));
});

test('authenticated HTTP uses verified UID, rejects foreign/revoked/unverified tokens and forged balance',async()=>{
 const c=await fixture(0);const id=await c.ledger.accountForUid('owner');const input=await c.ledger.addInput(id,Date.now()+120000,sha);
 await c.ledger.saveProject(id,input,0,'saved');let checkedRevocation=false;
 const identity={verifyIdToken:async(token,revoked)=>{checkedRevocation=revoked;if(token==='revoked')throw Error('revoked');return {uid:token,email_verified:token!=='unverified'};}};
 const server=createServer(firestoreHttp({backend:c.ledger,identity,origin:'https://vistavo.app'}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(path,token,options={})=>fetch(base+path,{...options,headers:{...(token?{Authorization:'Bearer '+token}:{}),...options.headers}});
 try{
  assert.equal((await request('/api/cloud/me')).status,401);
  assert.equal((await request('/api/cloud/me','revoked')).status,401);assert.equal(checkedRevocation,true);
  assert.equal((await request('/api/cloud/me','unverified')).status,403);
  const owner=await request('/api/cloud/me','owner');assert.equal(owner.status,200);assert.equal((await owner.json()).id,id);
  assert.equal((await request('/api/cloud/projects/'+input,'foreign')).status,404);
  assert.equal((await request('/api/cloud/projects/'+input,'owner')).status,200);
  assert.equal((await request('/api/cloud/projects/'+input,'owner',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:1,draft:'forged',accountId:id})})).status,400);
  assert.equal((await request('/api/cloud/projects/'+input,'owner',{method:'PUT',headers:{Origin:'https://foreign.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await request('/api/cloud/credit','owner',{method:'POST'})).status,404);
  assert.equal((await request('/api/cloud/jobs','owner',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,503);
 }finally{await new Promise(r=>server.close(r));}
});
test('recovery trigger quarantines expired running leases even without another worker delivery',async()=>{
 const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'recovery-sweep',1);await claim(c,c.account,id);
 await ref(c,'jobs',id).update({leaseUntil:0});let launches=0;
 await dispatchPending(c.ledger,{start:async()=>{launches++;}});
 assert.equal(launches,0);assert.equal((await state(c,id)).state,'unknown');await money(c,{reserved:1});
});
test('reservation binds immutable project revision atomically and rejects changed payload',async()=>{
 const c=await fixture();await c.ledger.saveProject(c.account,c.input,0,'revision one');
 const original=c.ledger.reserve; // bypass fixture convenience only to pass revision explicitly
 const backend=new FirestoreBackend(c.db,c.root,{allowUnverifiedInputsForTests:true});
 const id=await backend.reserve(c.account,c.input,'revision-key',1,'translation:en',1);
 await c.ledger.saveProject(c.account,c.input,1,'revision two');
 assert.equal((await ref(c,'jobs',id).get()).get('snapshot').draft,'revision one');
 await reject(backend.reserve(c.account,c.input,'new-request',1,'translation:en',1),'conflict');
 await reject(backend.reserve(c.account,c.input,'revision-key',1,'narration:en:male',1),'conflict');
 assert.equal(await backend.reserve(c.account,c.input,'revision-key',1,'translation:en',1),id);
});

test('crash before permission to invoke safely requeues and fences old worker',async()=>{
 const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'not-started',1);
 const attempt=await c.ledger.claim(c.account,id);await ref(c,'jobs',id).update({leaseUntil:Date.now()-1});
 assert.equal(await c.ledger.recover(c.account,id),true);assert.equal((await state(c,id)).state,'queued');
 assert.equal(await c.ledger.beginInvocation(c.account,id,attempt.attemptId),false);
 let calls=0;assert.equal(await processOnDemand(c.ledger,{accountId:c.account,jobId:id},{process:async()=>{calls++;return 'succeeded';}}),'succeeded');
 assert.equal(calls,1);await money(c,{consumed:1,reserved:0});
});
test('cancel before invocation releases reservation and prevents provider permission',async()=>{
 const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'cancel-not-started',1);const a=await c.ledger.claim(c.account,id);
 assert.equal(await c.ledger.cancel(c.account,id),true);assert.equal(await c.ledger.beginInvocation(c.account,id,a.attemptId),false);
 await money(c,{available:3,reserved:0,consumed:0});
});
test('UNKNOWN prevents a previously running sibling from capturing automatically',async()=>{
 const c=await fixture();const one=await c.ledger.reserve(c.account,c.input,'one-running',1),two=await c.ledger.reserve(c.account,c.input,'two-running',1);
 const a=await claim(c,c.account,one),b=await claim(c,c.account,two);await c.ledger.quarantine(c.account,one,a.attemptId);
 assert.equal(await c.ledger.finish(c.account,two,b.attemptId,true),false);assert.equal((await state(c,two)).state,'unknown');
 await money(c,{reserved:2,consumed:0});
});

test('default-deny client rules reject reads and writes of actual Admin-created documents',async()=>{
 const c=await fixture();const target='http://127.0.0.1:8185/v1/projects/demo-vistavo-ledger/databases/(default)/documents/'+c.root.path+'/accounts/'+c.account;
 assert.equal((await fetch(target)).status,403);
 assert.equal((await fetch(target,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{available:{integerValue:'999999'}}})})).status,403);
 await money(c,{credited:3,available:3});
});
test('request replay lookup survives later project edits and expiry without recalculating price',async()=>{
 const c=await fixture();await c.ledger.saveProject(c.account,c.input,0,'original');const backend=new FirestoreBackend(c.db,c.root,{allowUnverifiedInputsForTests:true});
 const id=await backend.reserve(c.account,c.input,'replay-original',1,'translation:en',1);
 await c.ledger.saveProject(c.account,c.input,1,'edited');await ref(c,'inputs',c.input).update({expiresAtMs:0});
 assert.equal(await backend.priorRequest(c.account,c.input,'replay-original','translation:en',1),id);
 await reject(backend.priorRequest(c.account,c.input,'replay-original','narration:en:male',1),'conflict');
 await money(c,{available:2,reserved:1});
});

test('expired heartbeat persists UNKNOWN immediately rather than waiting for a recovery sweep',async()=>{
 const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'heartbeat-expired',1);const a=await claim(c,c.account,id);
 await ref(c,'jobs',id).update({leaseUntil:Date.now()-1});assert.equal(await c.ledger.heartbeat(c.account,id,a.attemptId),false);
 assert.equal((await state(c,id)).state,'unknown');await money(c,{reserved:1,consumed:0});
});
test('HTTP reserves at server price, replays without quoting and reports honest cancellation state',async()=>{
 const c=await fixture(0);const owner=await c.ledger.accountForUid('http-owner');await c.ledger.creditVerifiedPurchase(owner,'http-capture',3,100);
 const input=await c.ledger.addInput(owner,Date.now()+120000,sha);await c.ledger.saveProject(owner,input,0,'draft');let quotes=0;
 const identity={verifyIdToken:async()=>({uid:'http-owner',email_verified:true})};
 const server=createServer(firestoreHttp({backend:c.ledger,identity,origin:'https://vistavo.app',quote:async()=>{quotes++;return 1;}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const headers={Authorization:'Bearer synthetic','Content-Type':'application/json'};
 const data={inputId:input,requestKey:'http-request',operation:'translation:en',expectedRevision:1};
 const post=value=>fetch(base+'/api/cloud/jobs',{method:'POST',headers,body:JSON.stringify(value)});
 try{
  assert.equal((await post({...data,price:0})).status,400);assert.equal(quotes,0);
  assert.equal((await post({...data,inputId:[input],requestKey:'invalid-array'})).status,400);assert.equal(quotes,0);
  const first=await post(data);assert.equal(first.status,202);const {id}=await first.json();assert.equal(quotes,1);
  const publicJob=await(await fetch(base+'/api/cloud/jobs/'+id,{headers})).json();
  assert.deepEqual(Object.keys(publicJob).sort(),['id','inputId','price','state']);
  await c.ledger.saveProject(owner,input,1,'new draft');const replay=await post(data);assert.equal((await replay.json()).id,id);assert.equal(quotes,1);
  await claim(c,owner,id);
  const cancellation=await(await fetch(base+'/api/cloud/jobs/'+id,{method:'DELETE',headers})).json();
  assert.deepEqual(cancellation,{cancelled:false,state:'unknown'});assert.equal((await c.ledger.readBalance(owner)).reserved,1);
  assert.equal((await fetch(base+'/api/cloud/projects/'+input,{method:'PUT',headers,body:'x'.repeat(400001)})).status,413);
 }finally{await new Promise(r=>server.close(r));}
});

test('worker reports failed when bytes expire after provider success and reservation is refunded',async()=>{
 const c=await fixture();const id=await c.ledger.reserve(c.account,c.input,'late-expiry',1);
 const result=await processOnDemand(c.ledger,{accountId:c.account,jobId:id},{process:async message=>{
  assert.equal(message.work.inputId,c.input);assert.equal(message.work.price,1);assert.match(message.providerRequestKey,/^[a-f0-9]{64}$/);
  await ref(c,'inputs',c.input).update({expiresAtMs:Date.now()-1});return 'succeeded';
 }});
 assert.equal(result,'failed');assert.equal((await state(c,id)).state,'failed');await money(c,{available:3,reserved:0,consumed:0});
});

test('expired queued sibling releases only its own reservation while an UNKNOWN stays reserved',async()=>{
 const c=await fixture();const one=await c.ledger.reserve(c.account,c.input,'unknown-expiry-one',1),two=await c.ledger.reserve(c.account,c.input,'unknown-expiry-two',1);
 const a=await claim(c,c.account,one);await c.ledger.quarantine(c.account,one,a.attemptId);
 await ref(c,'inputs',c.input).update({expiresAtMs:Date.now()-1});assert.equal(await c.ledger.claim(c.account,two),null);
 assert.equal((await state(c,two)).state,'failed');assert.equal((await state(c,one)).state,'unknown');
 await money(c,{available:2,reserved:1,consumed:0,active:1});
 assert.equal((await ref(c,'inputs',c.input).get()).get('unknownCount'),1);
});
