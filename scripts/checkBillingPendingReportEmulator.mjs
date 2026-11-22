// Diagnostic only: runs readPendingReport against a LOCAL Firestore emulator with synthetic rows.
// Refuses anything but a loopback emulator and a demo-* project; touches only its own random root document.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> GCLOUD_PROJECT=demo-... node --import tsx scripts/checkBillingPendingReportEmulator.mjs
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {readPendingReport} from '../server/commercial/billingPendingReport.ts';

const host=process.env.FIRESTORE_EMULATOR_HOST,project=process.env.GCLOUD_PROJECT;
assert.match(host??'',/^127\.0\.0\.1:\d{2,5}$/,'Loopback emulator required');assert.match(project??'',/^demo-[a-z0-9-]+$/,'demo-* project required');
for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','K_SERVICE'])assert.ok(process.env[key]===undefined,'Unexpected variable set: '+key);
const db=new Firestore({projectId:project});
const root=db.collection('pending_report_check').doc(randomUUID());
const made=[];
async function put(collection,id,data){const ref=root.collection(collection).doc(id);made.push(ref);await ref.set(data);}
const results={};
try{
  const NOW=Date.now();
  for(let i=0;i<130;i++)await put('billingIntents','f'+String(i).padStart(4,'0'),{state:'release_pending',createdAtMs:NOW-1000+i,nextAttemptAt:NOW+86_400_000,attempts:0});
  await put('billingIntents','due',{state:'reserve_pending',createdAtMs:NOW-9000,nextAttemptAt:NOW-1,attempts:1,lastErrorCode:'unavailable'});
  await put('billingIntents','done',{state:'closed',createdAtMs:1});
  await put('billingIntents','nostate',{createdAtMs:NOW});
  await put('billingIntents','numstate',{state:42,createdAtMs:NOW});
  await put('billingHoldOutbox','h1',{state:'needs_review',createdAtMs:NOW-5000});
  await put('billingHoldOutbox','h2',{state:'applied',createdAtMs:1});
  await put('billingOutbox','o1',{state:'retry_wait',createdAtMs:NOW-4000,nextAttemptAt:NOW+10,attempts:2});
  await put('billingOutbox','o2',{state:'settled',createdAtMs:1});
  await put('billingIntentTerminalRecovery','r1',{state:'pending',createdAtMs:NOW-3000,attempts:0});
  await put('jobs','j1',{state:'unknown',createdAtMs:NOW-2000});
  await put('jobs','j2',{state:'running',createdAtMs:NOW-2000});
  const fast=await readPendingReport(root,NOW,{pageSize:25});
  assert.equal(fast.total,130+1+1+1+1+1,'fast: 130 future + due + hold + outbox + recovery + unknown job');
  assert.equal(fast.rows[0].id,'due');assert.equal(new Set(fast.rows.map(r=>r.kind+r.id)).size,fast.total);
  assert.deepEqual(fast.byKind,{intent:131,terminal_recovery:1,hold:1,outbox:1,job_unknown:1,guard:0});
  assert.ok(!fast.rows.some(r=>['done','h2','o2','j2','nostate','numstate'].includes(r.id)),'fast mode must not see terminal rows nor unusable-state rows');
  assert.ok(fast.rows.find(r=>r.id==='h1').attention==='needs_review');
  const audit=await readPendingReport(root,NOW,{pageSize:25,audit:true});
  assert.equal(audit.total,fast.total+2,'audit adds exactly the two unusable-state rows');
  for(const id of ['nostate','numstate'])assert.equal(audit.rows.find(r=>r.id===id).attention,'malformed');
  assert.ok(!audit.rows.some(r=>['done','h2','o2','j2'].includes(r.id)));
  results.fast=fast.total;results.audit=audit.total;results.byKind=fast.byKind;
}finally{
  for(let i=0;i<made.length;i+=100){const b=db.batch();for(const ref of made.slice(i,i+100))b.delete(ref);await b.commit();}
  const left=await Promise.all(['billingIntents','billingHoldOutbox','billingOutbox','billingIntentTerminalRecovery','jobs'].map(c=>root.collection(c).listDocuments()));
  assert.equal(left.flat().length,0,'cleanup must leave nothing behind');
}
console.log(JSON.stringify({ok:true,...results,cleanup:'verified'}));
