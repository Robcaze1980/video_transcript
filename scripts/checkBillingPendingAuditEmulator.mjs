// Diagnostic only: concurrency checks for the audited disposition (piece D) against a LOCAL Firestore emulator.
// Refuses anything but a loopback emulator and a demo-* project; touches only its own random root document; prints no env values.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> GCLOUD_PROJECT=demo-... node --import tsx scripts/checkBillingPendingAuditEmulator.mjs
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {buildPendingReport,readPendingReport} from '../server/commercial/billingPendingReport.ts';
import {ALERT_COLLECTION,alertKey,raisePendingAlerts} from '../server/commercial/billingPendingAlerts.ts';
import {AUDIT_COLLECTION,AuditFault,recordDisposition} from '../server/commercial/billingPendingAudit.ts';

const host=process.env.FIRESTORE_EMULATOR_HOST,project=process.env.GCLOUD_PROJECT;
assert.match(host??'',/^127\.0\.0\.1:\d{2,5}$/,'Loopback emulator required');assert.match(project??'',/^demo-[a-z0-9-]+$/,'demo-* project required');
for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','K_SERVICE'])assert.ok(process.env[key]===undefined,'Unexpected variable set: '+key);
const db=new Firestore({projectId:project});
const root=db.collection('pending_audit_check').doc(randomUUID());
const NOW=Date.now(),results={};
const auditDocs=async()=>(await root.collection(AUDIT_COLLECTION).get()).docs.map(d=>d.data());
try{
  const account='11111111-1111-4111-8111-111111111111';
  await root.collection('accounts').doc(account).set({available:100,reserved:5});
  for(const id of ['h1','h2'])await root.collection('billingHoldOutbox').doc(id).set({state:'needs_review',createdAtMs:NOW-5000,accountId:account});
  const report=await readPendingReport(root,NOW,{audit:true});
  assert.equal(report.total,2);
  await raisePendingAlerts(db,root,report,NOW);
  const k1=alertKey('hold','h1','needs_review','needs_review'),k2=alertKey('hold','h2','needs_review','needs_review');
  // 1. Same person, same payload, 4 concurrent calls: every call succeeds, exactly one record is written.
  const same={authorizedBy:'owner-1',evidenceRef:'ticket-1',note:'same payload'};
  const a=await Promise.allSettled(Array.from({length:4},()=>recordDisposition(db,root,k1,'resolve',same,NOW+1)));
  const okA=a.filter(r=>r.status==='fulfilled');
  assert.ok(okA.length>=1,'at least one writer succeeds');
  assert.equal(okA.filter(r=>!r.value.replayed).length,1,'exactly one real write');
  assert.ok(a.filter(r=>r.status==='rejected').every(r=>!(r.reason instanceof AuditFault)),'identical repeats never conflict');
  // a final sequential repeat is a clean replay
  assert.deepEqual(await recordDisposition(db,root,k1,'resolve',same,NOW+2),{replayed:true});
  // 2. Different people at once on another alert: exactly one wins; the others conflict (or abort loudly).
  const people=['p1','p2','p3','p4'];
  const b=await Promise.allSettled(people.map(p=>recordDisposition(db,root,k2,'resolve',{authorizedBy:p,evidenceRef:'ev-'+p},NOW+3)));
  const wins=b.filter(r=>r.status==='fulfilled'&&!r.value.replayed);
  assert.equal(wins.length,1,'exactly one resolver wins');
  assert.ok(b.filter(r=>r.status==='rejected').every(r=>r.reason instanceof AuditFault&&r.reason.code==='conflict'||!(r.reason instanceof AuditFault)),'losers conflict or abort loudly');
  const docs=await auditDocs();
  assert.equal(docs.length,2,'one audit record per alert');
  const alert2=(await root.collection(ALERT_COLLECTION).doc(k2).get()).data();
  assert.equal(alert2.status,'dispositioned');
  assert.equal(docs.find(d=>d.alertKey===k2).authorizedBy,alert2.dispositionedBy,'the alert names the person whose audit record exists');
  assert.equal(docs.find(d=>d.alertKey===k1).observedRowState,'needs_review');
  // 3. Nothing else was written: rows and balance are untouched.
  assert.deepEqual((await root.collection('accounts').doc(account).get()).data(),{available:100,reserved:5});
  for(const id of ['h1','h2'])assert.equal((await root.collection('billingHoldOutbox').doc(id).get()).data().state,'needs_review');
  results.losersOrAborts=b.filter(r=>r.status==='rejected').length;results.audits=docs.length;
}finally{
  const cols=await root.listCollections();
  for(const col of cols){const refs=await col.listDocuments();for(let i=0;i<refs.length;i+=100){const b=db.batch();for(const r of refs.slice(i,i+100))b.delete(r);await b.commit();}}
  const left=await Promise.all((await root.listCollections()).map(c=>c.listDocuments()));
  assert.equal(left.flat().length,0,'cleanup must leave nothing behind');
}
console.log(JSON.stringify({ok:true,...results,cleanup:'verified'}));
