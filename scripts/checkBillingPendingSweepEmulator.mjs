// Diagnostic only: end-to-end check of the local pending-billing sweep and its runner against a LOCAL Firestore emulator.
// Refuses anything but a loopback emulator and a demo-* project; touches only its own random root document; prints no env values.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> GCLOUD_PROJECT=demo-... node --import tsx scripts/checkBillingPendingSweepEmulator.mjs
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {ALERT_COLLECTION} from '../server/commercial/billingPendingAlerts.ts';
import {runPendingSweep} from '../server/commercial/billingPendingSweep.ts';

const host=process.env.FIRESTORE_EMULATOR_HOST,project=process.env.GCLOUD_PROJECT;
assert.match(host??'',/^127\.0\.0\.1:\d{2,5}$/,'Loopback emulator required');assert.match(project??'',/^demo-[a-z0-9-]+$/,'demo-* project required');
for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','K_SERVICE'])assert.ok(process.env[key]===undefined,'Unexpected variable set: '+key);
const db=new Firestore({projectId:project});
const rootId=randomUUID(),rootPath='pending_sweep_check/'+rootId,root=db.doc(rootPath);
const NOW=Date.now(),results={};
const alertDocs=async()=>(await root.collection(ALERT_COLLECTION).get()).docs.map(d=>d.data());
const minimalEnv=extra=>({SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,USERPROFILE:process.env.USERPROFILE,APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA,...extra});
const runner=(args,env)=>spawnSync(process.execPath,['--import','tsx','scripts/runBillingPendingSweepLocal.mjs',...args],{env:minimalEnv(env),encoding:'utf8',timeout:60000});
try{
  const account='11111111-1111-4111-8111-111111111111';
  await root.collection('accounts').doc(account).set({available:100,reserved:5});
  await root.collection('billingHoldOutbox').doc('h1').set({state:'needs_review',createdAtMs:NOW-5000,accountId:account});
  await root.collection('billingIntents').doc('i1').set({state:'reserve_pending',createdAtMs:NOW-4000,nextAttemptAt:NOW+86_400_000});
  await root.collection('billingIntents').doc('i-nostate').set({createdAtMs:NOW});
  // 1. First sweep alerts only the row that needs attention; the healthy pending row stays quiet (no default age policy).
  const first=await runPendingSweep(db,root,NOW);
  assert.equal(first.ok,true);assert.equal(first.reported,2);assert.equal(first.created,1);
  // 2. Two overlapping sweeps neither duplicate nor lose a sighting.
  const both=await Promise.allSettled([runPendingSweep(db,root,NOW+1),runPendingSweep(db,root,NOW+1)]);
  assert.ok(both.some(r=>r.status==='fulfilled'),'at least one overlapping sweep succeeds');
  let docs=await alertDocs();assert.equal(docs.length,1);assert.ok(docs[0].seenCount>=2&&docs[0].seenCount<=3);
  // 3. The runner (a separate process) refuses a missing, non-loopback or non-demo environment, and a missing root.
  const bad=[runner(['--root',rootPath],{GCLOUD_PROJECT:project}),runner(['--root',rootPath],{FIRESTORE_EMULATOR_HOST:'10.0.0.5:8080',GCLOUD_PROJECT:project}),
    runner(['--root',rootPath],{FIRESTORE_EMULATOR_HOST:host,GCLOUD_PROJECT:'my-real-project'}),runner([],{FIRESTORE_EMULATOR_HOST:host,GCLOUD_PROJECT:project}),
    runner(['--root','a/b/c'],{FIRESTORE_EMULATOR_HOST:host,GCLOUD_PROJECT:project}),runner(['--root',rootPath,'--age-threshold-ms','0'],{FIRESTORE_EMULATOR_HOST:host,GCLOUD_PROJECT:project})];
  assert.ok(bad.every(r=>r.status===2&&/^REFUSED:/m.test(r.stderr)),'every unsafe invocation is refused with exit 2');
  assert.equal((await alertDocs()).length,1,'refusals write nothing');
  // 4. The runner works with a correct local environment and prints counts only.
  const ok=runner(['--root',rootPath,'--audit'],{FIRESTORE_EMULATOR_HOST:host,GCLOUD_PROJECT:project});
  assert.equal(ok.status,0,'runner succeeds');const summary=JSON.parse(ok.stdout.trim());
  assert.equal(summary.ok,true);assert.equal(summary.reported,3,'audit mode also sees the row without a usable state');assert.equal(summary.created,1);
  assert.ok(!/accountId|identity|uid|email/.test(ok.stdout),'summary carries no row data');
  // 5. The hold row finishes normally: the next sweep clears its alert after reading the row itself.
  await root.collection('billingHoldOutbox').doc('h1').update({state:'applied'});
  const third=await runPendingSweep(db,root,NOW+2,{audit:true});
  assert.equal(third.ok,true);assert.equal(third.cleared,1);
  docs=await alertDocs();assert.equal(docs.find(d=>d.rowId==='h1').status,'cleared');assert.equal(docs.find(d=>d.rowId==='i-nostate').status,'open');
  // 6. Nothing but alerts was written.
  assert.deepEqual((await root.collection('accounts').doc(account).get()).data(),{available:100,reserved:5});
  assert.equal((await root.collection('billingHoldOutbox').doc('h1').get()).data().state,'applied');
  results.sweeps=4;results.alerts=docs.length;
}finally{
  const cols=await root.listCollections();
  for(const col of cols){const refs=await col.listDocuments();for(let i=0;i<refs.length;i+=100){const b=db.batch();for(const r of refs.slice(i,i+100))b.delete(r);await b.commit();}}
  const left=await Promise.all((await root.listCollections()).map(c=>c.listDocuments()));
  assert.equal(left.flat().length,0,'cleanup must leave nothing behind');
}
console.log(JSON.stringify({ok:true,...results,cleanup:'verified'}));
