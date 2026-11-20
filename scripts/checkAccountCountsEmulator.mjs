// Diagnostic only: the counts-only runner (scripts/oneCReadOnlyCounts.mjs --scope account) against a LOCAL Firestore emulator, started as a real child
// process, over a synthetic Account-shaped root with more than one page of accounts and open reservations and with sensitive-looking documents in
// collections the facade must never reach. Checks exact counts, that nothing identifying is in the output, that no document anywhere in the root
// changed and that the runner refuses what it must. Refuses anything but a loopback emulator and a demo-* project.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> GCLOUD_PROJECT=demo-... node --import tsx scripts/checkAccountCountsEmulator.mjs
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
const db=new Firestore({projectId:project}),id=randomUUID(),root=db.collection('account_counts_check').doc(id),rootPath='account_counts_check/'+id,NOW=Date.now();
const reachable=['accounts','videoReservations','videoReservationTombstones','videoBillingGuards','videoBillingIncidents','ledgerEntries'];
const unreachable=['identities','projects','providerCalls','createRequests'];
const dir=mkdtempSync(join(tmpdir(),'account-counts-'));
const results={};
const pad=(n,w=4)=>String(n).padStart(w,'0');

const writes=[];
const put=(collection,docId,data)=>writes.push([root.collection(collection).doc(docId),data]);
for(let i=0;i<205;i++){
  const accountId='acc'+pad(i);
  const account={credited:100,available:60,reserved:30,consumed:10,active:1,identityKey:'LEAK-ik-'+i,uid:'LEAK-uid-'+i,activeProjectCount:2,createdAtMs:NOW-1e6};
  if(i===0)account.credited=99;                          // balance break
  if(i===1){account.reserved=31;account.credited=101;}   // reserved differs from its open reservation (31 vs 30), balance still adds up
  if(i===2)account.active=2;                             // active differs from its open reservations (2 vs 1)
  put('accounts',accountId,account);
  put('videoReservations','open'+pad(i),{ownerAccountId:accountId,identityKey:'LEAK-ik-'+i,reservationId:'LEAK-rid-'+i,seconds:30,state:'reserved',admissionProtocol:i<5?1:2,createdAtMs:NOW-1000-i,updatedAtMs:NOW,
    ...(i<50?{providerAdmission:{jobId:'LEAK-job-'+i,attemptId:'LEAK-att-'+i,admittedAtMs:NOW}}:{})});
}
put('videoReservations','orphan',{ownerAccountId:'ghost',seconds:7,state:'reserved',admissionProtocol:2,createdAtMs:NOW-500,identityKey:'LEAK-ik-g'});
for(let i=0;i<20;i++)put('videoReservations','cap'+pad(i),{ownerAccountId:'acc'+pad(i),seconds:5,state:'captured',createdAtMs:NOW-2000,captureAdmission:{jobId:'LEAK-cap'}});
for(let i=0;i<10;i++)put('videoReservations','rel'+pad(i),{ownerAccountId:'acc'+pad(i),seconds:5,state:'released',createdAtMs:NOW-3000});
put('videoReservations','weird',{state:'weird'});
for(let i=0;i<3;i++)put('videoBillingGuards','guard'+i,{blocked:true,incidentCount:1,epoch:1,identityKey:'LEAK-g'});
for(let i=0;i<2;i++)put('videoBillingGuards','free'+i,{blocked:false,incidentCount:0});
for(let i=0;i<4;i++)put('videoBillingIncidents','inc'+i,{state:'active',incidentId:'LEAK-inc-'+i});
for(let i=0;i<2;i++)put('videoBillingIncidents','done'+i,{state:'resolved'});
for(let i=0;i<2;i++)put('videoReservationTombstones','tomb'+i,{state:'sealed',seconds:3,identityKey:'LEAK-t'});
for(let i=0;i<237;i++)put('ledgerEntries','res'+pad(i),{kind:'video_reserve',seconds:5,ownerAccountId:'LEAK-owner'});
for(let i=0;i<20;i++)put('ledgerEntries','cap'+pad(i),{kind:'video_capture',seconds:5});
for(let i=0;i<10;i++)put('ledgerEntries','rel'+pad(i),{kind:'video_release',seconds:5});
for(let i=0;i<205;i++)put('ledgerEntries','crd'+pad(i),{kind:'credit',seconds:100});
for(let i=0;i<3;i++)put('identities','id'+i,{uid:'LEAK-uid-'+i,accountId:'acc'+pad(i)});
for(let i=0;i<2;i++)put('projects','p'+i,{title:'LEAK-title',content:'LEAK-content'});
put('providerCalls','c0',{callKey:'LEAK-call'});put('createRequests','q0',{fingerprint:'LEAK-fp'});

const snapshotHash=async()=>{
  const entries=[];for(const c of [...reachable,...unreachable])for(const doc of (await root.collection(c).get()).docs)entries.push([c,doc.id,JSON.stringify(doc.data())]);
  return createHash('sha256').update(JSON.stringify(entries.sort())).digest('hex');
};
const run=(extra)=>spawnSync(process.execPath,['--import','tsx','scripts/oneCReadOnlyCounts.mjs',...extra],{encoding:'utf8',env:process.env});
try{
  for(let i=0;i<writes.length;i+=100){const b=db.batch();for(const [ref,data] of writes.slice(i,i+100))b.set(ref,data);await b.commit();}
  const before=await snapshotHash(),outFile=join(dir,'counts.json');
  const r=run(['--target','emulator','--scope','account','--root',rootPath,'--out',outFile]);
  assert.equal(r.status,0,'the runner exits cleanly: '+r.stderr.slice(0,200)+r.stdout.slice(0,200));
  const result=JSON.parse(readFileSync(outFile,'utf8')),c=result.counts;
  assert.equal(result.scope,'account');
  assert.deepEqual(c.sizes,{accounts:205,videoReservations:237,videoReservationTombstones:2,videoBillingGuards:5,videoBillingIncidents:6,ledgerEntries:472});
  assert.deepEqual(c.reservations,{total:237,byState:{reserved:206,captured:20,released:10,other:1},partiallyCaptured:0});
  assert.deepEqual(c.ledger,{total:472,byKind:{video_reserve:237,video_capture:20,video_release:10,video_release_remainder:0,other:205}});
  assert.equal(c.tombstonesSealed,2);assert.equal(c.guardsBlocked,3);assert.equal(c.incidentsActive,4);
  assert.deepEqual(c.ledgerMinusReservations,{reserve:0,capture:0,release:0,remainder:0});
  assert.equal(c.accounts.scanned,205);assert.equal(c.accounts.invalid,0);assert.equal(c.accounts.balanceBreaks,1);assert.equal(c.accounts.reservedMismatch,1);assert.equal(c.accounts.activeMismatch,1);assert.equal(c.accounts.withReservedBalance,205);
  assert.deepEqual(c.accounts.totals,{credited:20500,available:12300,reserved:6151,consumed:2050,active:206});
  assert.equal(c.openReservations.count,206);assert.equal(c.openReservations.secondsTotal,6157);assert.equal(c.openReservations.orphan,1);assert.equal(c.openReservations.invalid,0);
  assert.equal(c.openReservations.legacyProtocol,5);assert.equal(c.openReservations.withProviderAdmission,50);assert.ok(c.openReservations.oldestAgeMs>=1204,'oldest open reservation age');
  assert.equal(result.reads.accounts.documents,205);assert.equal(result.reads.videoReservations.documents,206);
  assert.ok(!('identities' in result.reads)&&!('projects' in result.reads)&&!('providerCalls' in result.reads),'unreachable collections were never touched');
  // Nothing identifying in the file; nothing changed anywhere in the root (readable or not); no new collection.
  const text=readFileSync(outFile,'utf8');
  assert.ok(!/LEAK|acc0|ghost|account_counts_check\/[0-9a-f-]{36}|identityKey|ownerAccountId|reservationId|providerAdmission|"uid"/.test(text.replace(rootPath,'')),'no id, key or per-row value in the output');
  assert.equal(await snapshotHash(),before,'no document anywhere in the root changed');
  assert.deepEqual((await root.listCollections()).map(x=>x.id).sort(),[...reachable,...unreachable].sort(),'no new collection was created');
  // Refusals.
  assert.equal(run(['--target','emulator','--scope','account','--root',rootPath,'--out',outFile]).status,2,'an existing output file is not overwritten');
  assert.equal(JSON.parse(readFileSync(outFile,'utf8')).counts.sizes.accounts,205,'the existing output was left intact');
  assert.equal(run(['--target','emulator','--root',rootPath,'--out',join(dir,'x.json')]).status,2,'--scope is required, there is no default');
  assert.equal(run(['--target','emulator','--scope','nowhere','--root',rootPath,'--out',join(dir,'x.json')]).status,2,'unknown scope');
  assert.equal(run(['--target','emulator','--scope','account','--root',rootPath,'--out',join(dir,'x.json'),'--max-docs','0']).status,2,'invalid cap');
  const clean={...process.env};for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','STORAGE_EMULATOR_HOST','GOOGLE_APPLICATION_CREDENTIALS','LOCALAPPDATA','GCLOUD_PROJECT'])delete clean[key];
  const realRun=(env,extra=[])=>spawnSync(process.execPath,['--import','tsx','scripts/oneCReadOnlyCounts.mjs','--target','real','--scope','account','--out',join(dir,'z.json'),...extra],{encoding:'utf8',env});
  assert.equal(realRun(clean).status,2,'the real target needs LOCALAPPDATA');
  assert.equal(realRun({...clean,LOCALAPPDATA:dir}).status,2,'the real target needs the isolated credential file');
  assert.equal(realRun({...clean,LOCALAPPDATA:dir,GOOGLE_APPLICATION_CREDENTIALS:'x'}).status,2,'the real target refuses a credential variable');
  assert.equal(realRun(clean,['--root','vistavo/other']).status,2,'the real target refuses --root');
  assert.equal(realRun(process.env).status,2,'the real target refuses while an emulator is configured');
  // A tiny cap aborts the scan instead of reading on.
  const capped=run(['--target','emulator','--scope','account','--root',rootPath,'--out',join(dir,'capped.json'),'--max-docs','50']);
  assert.equal(capped.status,1);assert.match(capped.stdout,/maximum documents exceeded/);
  results.accounts=c.accounts.scanned;results.openReservations=c.openReservations.count;results.balanceBreaks=c.accounts.balanceBreaks;
}finally{
  rmSync(dir,{recursive:true,force:true});
  for(const col of await root.listCollections()){const refs=await col.listDocuments();for(let i=0;i<refs.length;i+=100){const b=db.batch();for(const ref of refs.slice(i,i+100))b.delete(ref);await b.commit();}}
  const left=await Promise.all((await root.listCollections()).map(c=>c.listDocuments()));
  await db.terminate();
  assert.equal(left.flat().length,0,'cleanup must leave nothing behind');
}
console.log(JSON.stringify({ok:true,...results,cleanup:'verified'}));
