// Diagnostic only: the read-only `nextAttemptAt` inventory against a LOCAL Firestore emulator (real `select` projection, `__name__` ordering
// and `startAfter` paging over more than one page). Refuses anything but a loopback emulator and a demo-* project; touches only its own
// random root; checks that the inventory changes nothing; prints counts only.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> GCLOUD_PROJECT=demo-... node --import tsx scripts/checkScheduleInventoryEmulator.mjs
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {readScheduleInventory} from '../server/commercial/billingScheduleInventory.ts';

const host=process.env.FIRESTORE_EMULATOR_HOST,project=process.env.GCLOUD_PROJECT;
assert.match(host??'',/^127\.0\.0\.1:\d{2,5}$/,'Loopback emulator required');assert.match(project??'',/^demo-[a-z0-9-]+$/,'demo-* project required');
for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','K_SERVICE'])assert.ok(process.env[key]===undefined,'Unexpected variable set: '+key);
const db=new Firestore({projectId:project}),root=db.collection('schedule_inventory_check').doc(randomUUID()),NOW=Date.now();
const collections=['billingIntents','billingOutbox','billingHoldOutbox'];

// [collection, state-or-undefined, nextAttemptAt (undefined = field absent), how many]
const plan=[
  ['billingIntents','reserve_pending',NOW-5000,100],['billingIntents','reserve_pending',NOW+60000,60],['billingIntents','reserve_pending',undefined,15],['billingIntents','reserve_pending',null,10],
  ['billingIntents','reserve_pending','soon',5],['billingIntents','release_pending',NOW+60000,8],['billingIntents','closed',1,3],['billingIntents',undefined,undefined,2],['billingIntents','needs_review',undefined,2],
  ['billingOutbox','pending',NOW-1,7],['billingOutbox','retry_wait',NOW+60000,3],['billingOutbox','retry_wait',undefined,2],['billingOutbox','settled',undefined,4],
  ['billingHoldOutbox','pending',NOW+60000,4],['billingHoldOutbox','pending',NOW-1,1],['billingHoldOutbox','applied',undefined,2],
];
const snapshotHash=async()=>{
  const entries=[];for(const c of collections)for(const doc of (await root.collection(c).get()).docs)entries.push([c,doc.id,JSON.stringify(doc.data())]);
  return createHash('sha256').update(JSON.stringify(entries.sort())).digest('hex');
};
const results={};
try{
  let n=0;const batch=[];
  for(const [collection,state,nextAttemptAt,count] of plan)for(let i=0;i<count;i++){
    const data={accountId:'33333333-3333-4333-8333-333333333333',note:'private-'+(n++)};
    if(state!==undefined)data.state=state;if(nextAttemptAt!==undefined)data.nextAttemptAt=nextAttemptAt;
    batch.push([root.collection(collection).doc('d'+String(n).padStart(5,'0')),data]);
  }
  for(let i=0;i<batch.length;i+=100){const b=db.batch();for(const [ref,data] of batch.slice(i,i+100))b.set(ref,data);await b.commit();}
  const before=await snapshotHash();
  const expected=(collection,state,pick)=>plan.filter(p=>p[0]===collection&&p[1]===state).reduce((sum,p)=>sum+(pick(p)?p[3]:0),0);
  const due=p=>typeof p[2]==='number'&&p[2]<=NOW,future=p=>typeof p[2]==='number'&&p[2]>NOW,missing=p=>p[2]===undefined,invalid=p=>p[2]===null||typeof p[2]==='string';
  for(const pageSize of [undefined,7,1000]){
    const inv=await readScheduleInventory(root,NOW,pageSize===undefined?{}:{pageSize});
    const intents=inv.collections.find(c=>c.collection==='billingIntents');
    assert.equal(intents.scanned,205,'every intent is scanned across pages');assert.equal(intents.noState,2);assert.equal(intents.otherStates,5);
    assert.deepEqual(intents.selectable.reserve_pending,{due:expected('billingIntents','reserve_pending',due),future:expected('billingIntents','reserve_pending',future),missing:expected('billingIntents','reserve_pending',missing),invalid:expected('billingIntents','reserve_pending',invalid)});
    assert.deepEqual(intents.selectable.release_pending,{due:0,future:8,missing:0,invalid:0});
    const outbox=inv.collections.find(c=>c.collection==='billingOutbox');
    assert.equal(outbox.scanned,16);assert.deepEqual(outbox.selectable.pending,{due:7,future:0,missing:0,invalid:0});assert.deepEqual(outbox.selectable.retry_wait,{due:0,future:3,missing:2,invalid:0});
    const hold=inv.collections.find(c=>c.collection==='billingHoldOutbox');
    assert.equal(hold.scanned,7);assert.deepEqual(hold.selectable.pending,{due:1,future:4,missing:0,invalid:0});
    assert.equal(inv.maxFuturePerState,60);
    const text=JSON.stringify(inv);assert.ok(!/3333|private-|"d0|soon/.test(text),'no id, account or value in the result');
    results.reserve_pending=intents.selectable.reserve_pending;
  }
  assert.equal(await snapshotHash(),before,'the inventory changed nothing');
  results.scannedIntents=205;
}finally{
  for(const col of await root.listCollections()){const refs=await col.listDocuments();for(let i=0;i<refs.length;i+=100){const b=db.batch();for(const r of refs.slice(i,i+100))b.delete(r);await b.commit();}}
  const left=await Promise.all((await root.listCollections()).map(c=>c.listDocuments()));
  await db.terminate();
  assert.equal(left.flat().length,0,'cleanup must leave nothing behind');
}
console.log(JSON.stringify({ok:true,...results,cleanup:'verified'}));
