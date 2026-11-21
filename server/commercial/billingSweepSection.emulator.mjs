// LV-019.B phase 3 (plan step 3.4, A2): write guarantee of the cloud-ready sweep SECTION against a LOCAL Firestore
// emulator. It seeds pending rows across collections, fingerprints EVERY collection under its private test root,
// runs the section and proves only billingPendingAlerts changed. It also covers disabled, exhausted budget, a sweep
// that throws, the always-on heartbeat, idempotency and no sensitive data in the log line.
// Same style and cleanup as the other fixtures: loopback emulator, demo-* project, random root, recursive delete.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {runBillingSweepSection} from './billingSweepSection.ts';
import {ALERT_COLLECTION} from './billingPendingAlerts.ts';

const HOST='127.0.0.1:8185',PROJECT='demo-vistavo-ledger',NOW=9_000_000;
const ACCOUNT='11111111-1111-4111-8111-111111111111';

// The shared emulator can stall under contention with other fixtures; a bounded promise turns that into a fast, loud
// failure instead of a multi-minute hang, and the cleanup still runs so the client handle and process never leak.
const WORK_TIMEOUT_MS=60_000,CLEANUP_TIMEOUT_MS=30_000;
function bounded(promise,ms,label){
 // The timer stays referenced while waiting (so the timeout really fires) and is cleared the moment the race settles,
 // so a normal run never waits the full budget. A late settlement can never surface as an unhandled rejection.
 let timer;
 const guard=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('emulator timeout: '+label)),ms);});
 promise.catch(()=>undefined);
 return Promise.race([promise,guard]).finally(()=>clearTimeout(timer));
}
async function fixture(work){
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST,'No native fallback');
 const db=new Firestore({projectId:PROJECT}),root=db.collection('vistavo_a2_sweep_test').doc(randomUUID());
 try{await bounded(Promise.resolve().then(()=>work({db,root})),WORK_TIMEOUT_MS,'fixture work');}
 finally{
  try{await bounded(db.recursiveDelete(root),CLEANUP_TIMEOUT_MS,'cleanup delete');}catch{/* a stalled delete must not mask terminate */}
  finally{try{await db.terminate();}catch{/* the client is closed even if terminate reports an error */}}
 }
}
/** A per-collection fingerprint (sorted path + data) of every collection under the private root. */
async function fingerprint(root){
 const out={};
 for(const col of (await root.listCollections()).sort((a,b)=>a.id<b.id?-1:1)){
  const docs=(await col.listDocuments()).sort((a,b)=>a.path<b.path?-1:1),entries=[];
  for(const doc of docs)entries.push([doc.path,(await doc.get()).data()]);
  out[col.id]=createHash('sha256').update(JSON.stringify(entries)).digest('hex');
 }
 return out;
}
const onlyAlertsChanged=(before,after)=>{
 for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(key!==ALERT_COLLECTION)assert.equal(after[key],before[key],'collection must be untouched: '+key);
};
const seed=async root=>{
 await root.collection('accounts').doc(ACCOUNT).set({available:100,reserved:5,consumed:2});
 await root.collection('ledgerEntries').doc('l1').set({kind:'video_reserve',accountId:ACCOUNT});
 await root.collection('billingIntents').doc('i1').set({state:'reserve_pending',createdAtMs:NOW-4000,accountId:ACCOUNT});
 await root.collection('billingIntents').doc('i2').set({state:'needs_review',createdAtMs:NOW-3000,accountId:ACCOUNT});
 await root.collection('billingOutbox').doc('o1').set({state:'retry_wait',createdAtMs:NOW-2000,accountId:ACCOUNT});
 await root.collection('billingHoldOutbox').doc('h1').set({state:'needs_review',createdAtMs:NOW-5000,accountId:ACCOUNT});
 await root.collection('billingHoldOutbox').doc('h2').set({state:'pending',createdAtMs:NOW-500,accountId:ACCOUNT});
 await root.collection('jobs').doc('j1').set({state:'unknown',createdAtMs:NOW-1000,accountId:ACCOUNT});
};

test('a seeded tree: only the alert collection changes, rows and balances are untouched, and a repeat is idempotent',()=>fixture(async({db,root})=>{
 await seed(root);
 const before=await fingerprint(root);
 const first=await runBillingSweepSection({db,root,now:NOW,enabled:true,budgetMs:20000,log:()=>{}});
 assert.equal(first.outcome,'ok',first.outcome);
 const after=await fingerprint(root);
 assert.notEqual(after[ALERT_COLLECTION],before[ALERT_COLLECTION],'the sweep must write to the alert collection');
 onlyAlertsChanged(before,after);
 assert.deepEqual((await root.collection('accounts').doc(ACCOUNT).get()).data(),{available:100,reserved:5,consumed:2});
 for(const [col,id,state] of [['billingIntents','i1','reserve_pending'],['billingIntents','i2','needs_review'],['billingOutbox','o1','retry_wait'],['billingHoldOutbox','h1','needs_review'],['billingHoldOutbox','h2','pending'],['jobs','j1','unknown']])
  assert.equal((await root.collection(col).doc(id).get()).data().state,state,'queue row '+col+'/'+id+' must be untouched');
 assert.equal((await root.collection('ledgerEntries').doc('l1').get()).data().kind,'video_reserve');
 const alerts1=await root.collection(ALERT_COLLECTION).get();
 assert.ok(alerts1.size>=1,'at least one alert was raised');
 const seeded=await fingerprint(root);
 const second=await runBillingSweepSection({db,root,now:NOW+1000,enabled:true,budgetMs:20000,log:()=>{}});
 assert.equal(second.outcome,'ok');assert.equal(second.created,0,'a repeat must not duplicate alerts');
 assert.equal((await root.collection(ALERT_COLLECTION).get()).size,alerts1.size,'no duplicate alerts');
 onlyAlertsChanged(seeded,await fingerprint(root));
}));

test('disabled is the default and writes nothing at all',()=>fixture(async({db,root})=>{
 await seed(root);
 const before=await fingerprint(root);
 const logs=[];
 const result=await runBillingSweepSection({db,root,now:NOW,enabled:false,budgetMs:20000,log:l=>logs.push(l)});
 assert.equal(result.outcome,'disabled');assert.equal(logs.length,1,'a heartbeat is emitted even when disabled');
 assert.equal(JSON.parse(logs[0]).event,'billing-sweep');assert.equal(JSON.parse(logs[0]).outcome,'disabled');
 assert.deepEqual(await fingerprint(root),before,'disabled writes nothing');
}));

test('an exhausted budget returns timeout without throwing and leaves the tree untouched',()=>fixture(async({db,root})=>{
 await seed(root);
 const before=await fingerprint(root);
 const sweep=()=>new Promise(()=>{});
 const result=await runBillingSweepSection({db,root,now:NOW,enabled:true,budgetMs:5,sweep,log:()=>{}});
 assert.equal(result.outcome,'timeout');
 assert.deepEqual(await fingerprint(root),before,'a timeout writes nothing new');
}));

test('a sweep that throws is an error outcome that never propagates',()=>fixture(async({db,root})=>{
 await seed(root);
 const sweep=async()=>{throw Object.assign(new Error('SYNTHETIC_PRIVATE_DETAIL'),{stage:'read'});};
 const logs=[];
 const result=await runBillingSweepSection({db,root,now:NOW,enabled:true,budgetMs:20000,sweep,log:l=>logs.push(l)});
 assert.equal(result.outcome,'error');assert.equal(result.stage,'read');
 assert.equal(logs.length,1,'a heartbeat is emitted on failure');
 assert.equal(JSON.stringify(logs).includes('SYNTHETIC_PRIVATE_DETAIL'),false);
}));

test('the heartbeat carries counts only: seeded ids, account UID and row content never appear',()=>fixture(async({db,root})=>{
 await seed(root);
 const logs=[];
 const result=await runBillingSweepSection({db,root,now:NOW,enabled:true,budgetMs:20000,log:l=>logs.push(l)});
 assert.equal(result.outcome,'ok');assert.equal(logs.length,1);
 const line=JSON.parse(logs[0]);
 assert.equal(line.event,'billing-sweep');assert.equal(typeof line.startedAtMs,'number');assert.equal(typeof line.durationMs,'number');assert.equal(typeof line.outcome,'string');
 assert.equal(typeof line.reported,'number');assert.equal(typeof line.created,'number');
 const raw=logs[0];
 for(const secret of [ACCOUNT,'i1','i2','o1','h1','h2','j1','l1','reserve_pending'])assert.equal(raw.includes(secret),false,'log leaked '+secret);
 assert.ok(!/accountId|"uid"|@/.test(raw),'log carries no identity fields');
}));
