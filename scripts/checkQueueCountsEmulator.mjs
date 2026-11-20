// Diagnostic only: the 1C counts-only runner (scripts/oneCReadOnlyCounts.mjs) against a LOCAL Firestore emulator, started as a real child process,
// over a synthetic root with more than one page of intents. Checks exact counts, that nothing identifying is in the output, that no document
// anywhere in the root changed, and that the runner refuses what it must. Refuses anything but a loopback emulator and a demo-* project.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> GCLOUD_PROJECT=demo-... node --import tsx scripts/checkQueueCountsEmulator.mjs
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Firestore} from 'firebase-admin/firestore';

const host=process.env.FIRESTORE_EMULATOR_HOST,project=process.env.GCLOUD_PROJECT;
assert.match(host??'',/^127\.0\.0\.1:\d{2,5}$/,'Loopback emulator required');assert.match(project??'',/^demo-[a-z0-9-]+$/,'demo-* project required');
for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GEMINI_API_KEY','OPENROUTER_API_KEY','K_SERVICE'])assert.ok(process.env[key]===undefined,'Unexpected variable set: '+key);
const db=new Firestore({projectId:project}),id=randomUUID(),root=db.collection('queue_counts_check').doc(id),rootPath='queue_counts_check/'+id,NOW=Date.now();
const ACCOUNT='44444444-4444-4444-8444-444444444444';
const collections=['billingIntents','billingIntentTerminalRecovery','billingHoldOutbox','billingOutbox','jobs','accounts'];
const dir=mkdtempSync(join(tmpdir(),'queue-counts-'));
const results={};

// [collection, how many, data factory(i)]
const plan=[
  ['billingIntents',120,i=>({state:'reserve_pending',createdAtMs:NOW-1000-i,nextAttemptAt:NOW-5000,accountId:ACCOUNT})],
  ['billingIntents',40,i=>({state:'reserve_pending',createdAtMs:NOW-900-i,nextAttemptAt:NOW+60000})],
  ['billingIntents',10,i=>({state:'reserve_pending',createdAtMs:NOW-800-i})],
  ['billingIntents',5,i=>({state:'reserve_pending',createdAtMs:NOW-700-i,nextAttemptAt:'x'})],
  ['billingIntents',20,i=>({state:'release_pending',createdAtMs:NOW-600-i,nextAttemptAt:NOW+60000})],
  ['billingIntents',6,i=>({state:'needs_review',createdAtMs:NOW-500-i})],
  ['billingIntents',4,i=>({state:'closed'})],
  ['billingIntentTerminalRecovery',3,i=>({state:'pending',createdAtMs:NOW-400-i})],
  ['billingHoldOutbox',4,i=>({state:'pending',createdAtMs:NOW-300-i,nextAttemptAt:NOW+60000})],
  ['billingHoldOutbox',2,i=>({state:'pending',createdAtMs:NOW-290-i,nextAttemptAt:null})],
  ['billingHoldOutbox',3,i=>({state:'needs_review',createdAtMs:NOW-280-i})],
  ['billingHoldOutbox',5,i=>({state:'applied'})],
  ['billingOutbox',6,i=>({state:'pending',createdAtMs:NOW-200-i,lastErrorCode:'unavailable'})],
  ['billingOutbox',4,i=>({state:'retry_wait',createdAtMs:NOW-190-i,nextAttemptAt:NOW+60000})],
  ['billingOutbox',3,i=>({state:'retry_wait',createdAtMs:NOW-180-i})],
  ['billingOutbox',2,i=>({state:'needs_review',createdAtMs:NOW-170-i})],
  ['billingOutbox',8,i=>({state:'settled'})],
  ['jobs',2,i=>({state:'unknown',createdAtMs:NOW-100-i})],
  ['jobs',6,i=>({state:'running'})],
  ['accounts',3,i=>({available:10+i,reserved:0})],
];
const snapshotHash=async()=>{
  const entries=[];for(const c of collections)for(const doc of (await root.collection(c).get()).docs)entries.push([c,doc.id,JSON.stringify(doc.data())]);
  return createHash('sha256').update(JSON.stringify(entries.sort())).digest('hex');
};
const run=(extra)=>spawnSync(process.execPath,['--import','tsx','scripts/oneCReadOnlyCounts.mjs',...extra],{encoding:'utf8',env:process.env});
try{
  let n=0;const writes=[];
  for(const [collection,count,make] of plan)for(let i=0;i<count;i++)writes.push([root.collection(collection).doc('d'+String(n++).padStart(5,'0')),make(i)]);
  for(let i=0;i<writes.length;i+=100){const b=db.batch();for(const [ref,data] of writes.slice(i,i+100))b.set(ref,data);await b.commit();}
  const before=await snapshotHash(),outFile=join(dir,'counts.json');
  const r=run(['--target','emulator','--root',rootPath,'--out',outFile]);
  assert.equal(r.status,0,'the runner exits cleanly: '+r.stderr.slice(0,200));
  const result=JSON.parse(readFileSync(outFile,'utf8')),c=result.counts;
  assert.deepEqual(c.sizes,{billingIntents:205,billingIntentTerminalRecovery:3,billingHoldOutbox:14,billingOutbox:23,jobs:8});
  assert.equal(c.report.total,230);
  assert.deepEqual(c.report.byKind.intent.byState,{reserve_pending:175,release_pending:20,needs_review:6});
  assert.equal(c.report.byKind.intent.malformed,5);assert.equal(c.report.byKind.intent.needsReview,6);assert.equal(c.report.byKind.intent.total,201);
  assert.equal(c.report.byKind.terminal_recovery.total,3);assert.equal(c.report.byKind.hold.total,9);assert.equal(c.report.byKind.outbox.total,15);assert.equal(c.report.byKind.job_unknown.total,2);
  assert.deepEqual(c.report.byLastErrorCode,{none:224,unavailable:6});
  const intents=c.inventory.collections.find(x=>x.collection==='billingIntents');
  assert.deepEqual(intents.selectable.reserve_pending,{due:120,future:40,missing:10,invalid:0,nonNumeric:5});assert.deepEqual(intents.selectable.release_pending,{due:0,future:20,missing:0,invalid:0,nonNumeric:0});
  assert.equal(c.inventory.neverSelectedAtLeast,5,'3 undated retry_wait rows + 2 null-dated hold rows');assert.equal(c.inventory.maxFuturePerState,40);
  assert.equal(result.reads.billingIntents.countAggregations,1);assert.ok(result.reads.billingIntents.documents>=205,'every intent was read through paging');
  // Nothing identifying in the file; nothing changed in the root (billing collections and the untouched accounts collection).
  const text=readFileSync(outFile,'utf8');
  assert.ok(!/4444|queue_counts_check\/[0-9a-f-]{36}|"d0|accountId|createdAtMs/.test(text.replace(rootPath,'')),'no id, account or per-row value in the output');
  assert.equal(await snapshotHash(),before,'no document anywhere in the root changed');
  assert.deepEqual((await root.listCollections()).map(x=>x.id).sort(),[...collections].sort(),'no new collection was created');
  // The runner refuses what it must.
  assert.equal(run(['--target','emulator','--root','accounts/x','--out',join(dir,'x.json'),'--max-docs','0']).status,2,'invalid cap');
  assert.equal(run(['--target','emulator','--out',join(dir,'x.json')]).status,2,'missing root');
  assert.equal(run(['--target','emulator','--root',rootPath,'--out','counts.txt']).status,2,'output must be .json');
  assert.equal(run(['--target','somewhere','--out',join(dir,'x.json')]).status,2,'unknown target');
  assert.equal(spawnSync(process.execPath,['--import','tsx','scripts/oneCReadOnlyCounts.mjs','--target','real','--out',join(dir,'y.json')],{encoding:'utf8',env:process.env}).status,2,'the real target refuses while an emulator is configured');
  // The output never replaces an existing file, and --root is refused for the real target.
  assert.equal(run(['--target','emulator','--root',rootPath,'--out',outFile]).status,2,'an existing output file is not overwritten');
  assert.equal(JSON.parse(readFileSync(outFile,'utf8')).counts.report.total,230,'the existing output was left intact');
  // The real target decides its refusals before opening any connection (no emulator variables here, so these runs never reach a network).
  const clean={...process.env};for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','STORAGE_EMULATOR_HOST','GOOGLE_APPLICATION_CREDENTIALS','LOCALAPPDATA','GCLOUD_PROJECT'])delete clean[key];
  const realRun=env=>spawnSync(process.execPath,['--import','tsx','scripts/oneCReadOnlyCounts.mjs','--target','real','--out',join(dir,'z.json')],{encoding:'utf8',env});
  assert.equal(spawnSync(process.execPath,['--import','tsx','scripts/oneCReadOnlyCounts.mjs','--target','real','--root','vistavo/other','--out',join(dir,'r.json')],{encoding:'utf8',env:clean}).status,2,'the real target refuses --root');
  assert.equal(realRun(clean).status,2,'the real target needs LOCALAPPDATA');
  assert.equal(realRun({...clean,LOCALAPPDATA:dir}).status,2,'the real target needs the isolated credential file');
  assert.equal(realRun({...clean,LOCALAPPDATA:dir,GOOGLE_APPLICATION_CREDENTIALS:'x'}).status,2,'the real target refuses a credential variable');
  // A tiny cap aborts the scan instead of reading on.
  const capped=run(['--target','emulator','--root',rootPath,'--out',join(dir,'capped.json'),'--max-docs','50']);
  assert.equal(capped.status,1);assert.match(capped.stdout,/maximum documents exceeded/);
  results.pending=c.report.total;results.neverSelectedAtLeast=c.inventory.neverSelectedAtLeast;
}finally{
  rmSync(dir,{recursive:true,force:true});
  for(const col of await root.listCollections()){const refs=await col.listDocuments();for(let i=0;i<refs.length;i+=100){const b=db.batch();for(const r of refs.slice(i,i+100))b.delete(r);await b.commit();}}
  const left=await Promise.all((await root.listCollections()).map(c=>c.listDocuments()));
  await db.terminate();
  assert.equal(left.flat().length,0,'cleanup must leave nothing behind');
}
console.log(JSON.stringify({ok:true,...results,cleanup:'verified'}));
