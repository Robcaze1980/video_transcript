// Diagnostic only: concurrency and real-query checks for the pending-billing alerts against a LOCAL Firestore emulator.
// Refuses anything but a loopback emulator and a demo-* project; touches only its own random root document; prints no env values.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> GCLOUD_PROJECT=demo-... node --import tsx scripts/checkBillingPendingAlertsEmulator.mjs
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {buildPendingReport,readPendingReport} from '../server/commercial/billingPendingReport.ts';
import {ALERT_COLLECTION,clearResolvedAlerts,raisePendingAlerts,raiseSweepAlert} from '../server/commercial/billingPendingAlerts.ts';

const host=process.env.FIRESTORE_EMULATOR_HOST,project=process.env.GCLOUD_PROJECT;
assert.match(host??'',/^127\.0\.0\.1:\d{2,5}$/,'Loopback emulator required');assert.match(project??'',/^demo-[a-z0-9-]+$/,'demo-* project required');
for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','K_SERVICE'])assert.ok(process.env[key]===undefined,'Unexpected variable set: '+key);
const db=new Firestore({projectId:project});
const root=db.collection('pending_alerts_check').doc(randomUUID());
const NOW=Date.now(),results={};
const alertDocs=async()=>(await root.collection(ALERT_COLLECTION).get()).docs.map(d=>d.data());
try{
  const account='11111111-1111-4111-8111-111111111111';
  await root.collection('accounts').doc(account).set({available:100,reserved:5});
  await root.collection('billingHoldOutbox').doc('h1').set({state:'needs_review',createdAtMs:NOW-5000,accountId:account});
  await root.collection('billingIntents').doc('i-bad').set({createdAtMs:NOW});
  await root.collection('billingOutbox').doc('o1').set({state:'pending',createdAtMs:NOW-100});
  const report=await readPendingReport(root,NOW,{audit:true});
  assert.equal(report.total,3);
  // 1a. Heavy contention (20 writers on the same two documents): the emulator may abort some transactions with a lock
  // timeout. That must be LOUD (a rejected call), never a duplicate alert or a corrupt counter.
  const heavy=await Promise.allSettled(Array.from({length:20},()=>raisePendingAlerts(db,root,report,NOW)));
  const heavyOk=heavy.filter(r=>r.status==='fulfilled');
  assert.ok(heavy.filter(r=>r.status==='rejected').every(r=>r.reason instanceof AggregateError),'failures surface as errors');
  let docs=await alertDocs();
  assert.equal(docs.length,2,'never more than one alert per needing row');
  assert.ok(docs.every(d=>d.status==='open'&&d.seenCount>=1&&d.seenCount<=20));
  assert.ok(heavyOk.reduce((n,r)=>n+r.value.created,0)<=2,'at most two creations');
  const before=Object.fromEntries(docs.map(d=>[d.rowId,d.seenCount]));
  // 1b. Realistic contention (4 writers): all succeed and every sighting is counted exactly once.
  const runs=await Promise.all(Array.from({length:4},()=>raisePendingAlerts(db,root,report,NOW+1)));
  assert.equal(runs.reduce((n,r)=>n+r.created,0),0,'alerts already exist');assert.equal(runs.reduce((n,r)=>n+r.seen,0),8);
  docs=await alertDocs();assert.equal(docs.length,2);
  assert.ok(docs.every(d=>d.seenCount===before[d.rowId]+4),'each sighting counted exactly once');
  results.heavyRejected=heavy.length-heavyOk.length;
  // 2. Sweep alert under concurrency.
  const sweeps=await Promise.all(Array.from({length:4},()=>raiseSweepAlert(db,root,'sweep_failed',NOW)));
  assert.equal(sweeps.filter(s=>s.created).length,1);
  docs=await alertDocs();assert.equal(docs.filter(d=>d.kind==='sweep').length,1);assert.equal(docs.find(d=>d.kind==='sweep').seenCount,4);
  // 3. The hold row finishes normally; five concurrent clearers clear it exactly once, and only after reading the row.
  await root.collection('billingHoldOutbox').doc('h1').update({state:'applied'});
  const after=await readPendingReport(root,NOW,{audit:true});
  const clears=await Promise.all(Array.from({length:4},()=>clearResolvedAlerts(db,root,after,NOW+1)));
  assert.equal(clears.reduce((n,c)=>n+c.cleared,0),1,'exactly one clearer wins');
  docs=await alertDocs();const hold=docs.find(d=>d.rowId==='h1');
  assert.equal(hold.status,'cleared');assert.equal(hold.observedState,'applied');
  assert.equal(docs.find(d=>d.rowId==='i-bad').status,'open','the malformed row stays open');
  assert.equal(docs.find(d=>d.kind==='sweep').status,'open','sweep alerts are never auto-cleared');
  // 4. Nothing outside the alert collection was written; balance data is untouched.
  assert.deepEqual((await root.collection('accounts').doc(account).get()).data(),{available:100,reserved:5});
  assert.equal((await root.collection('billingOutbox').doc('o1').get()).data().state,'pending');
  results.alerts=docs.length;results.cleared=1;
}finally{
  const cols=await root.listCollections();
  for(const col of cols){const refs=await col.listDocuments();for(let i=0;i<refs.length;i+=100){const b=db.batch();for(const r of refs.slice(i,i+100))b.delete(r);await b.commit();}}
  const left=await Promise.all((await root.listCollections()).map(c=>c.listDocuments()));
  assert.equal(left.flat().length,0,'cleanup must leave nothing behind');
}
console.log(JSON.stringify({ok:true,...results,cleanup:'verified'}));
