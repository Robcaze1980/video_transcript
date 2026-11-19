import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {BillingNextAttemptMigration} from './billingNextAttemptMigration.ts';
import {FirestoreBackend} from './firestoreBackend.ts';
import {accountIdentityKey} from './accountBillingClient.ts';
import {AI_CATALOG_VERSION} from './aiContracts.ts';
import {objectPlan,privateBucket} from './privateObjectPlan.ts';

const fixtures=[];
before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const f of fixtures.splice(0)){for(const migration of f.migrations)await migration.close();await f.db.recursiveDelete(f.root);await f.db.terminate();await deleteApp(f.app);}});
function fixture(){const id=randomUUID(),app=initializeApp({projectId:'demo-vistavo-ledger'},'billing-migration-fixture-'+randomUUID()),db=getFirestore(app),root=db.collection('vistavo_billing_migration_test').doc(id),f={id,app,db,root,migrations:[]};fixtures.push(f);return f;}
function migrator(f,options={}){const result=new BillingNextAttemptMigration(f.id,options);f.migrations.push(result);return result;}
const checkpoint=(f,target,phase)=>f.root.collection('billingNextAttemptCheckpoints').doc(target+'-'+phase);
async function complete(m,target,phase,limit=40){for(let i=0;i<100;i++){const result=await m.scanPage(target,phase,limit);if(result.status==='scan_complete'||result.status==='blocked')return result;}throw Error('Synthetic migration did not finish');}

test('the migrator owns a loopback demo client and rejects unsafe environment or roots',async()=>{
 const f=fixture(),host=process.env.FIRESTORE_EMULATOR_HOST,project=process.env.GOOGLE_CLOUD_PROJECT;
 try{
  process.env.FIRESTORE_EMULATOR_HOST='localhost:8185';assert.throws(()=>new BillingNextAttemptMigration(f.id),error=>error.code==='emulator_boundary');
  process.env.FIRESTORE_EMULATOR_HOST=host;assert.throws(()=>new BillingNextAttemptMigration('candidate-v1'),error=>error.code==='emulator_boundary');
  assert.throws(()=>new BillingNextAttemptMigration(f.db),error=>error.code==='emulator_boundary');
  process.env.GOOGLE_CLOUD_PROJECT='vistavo-prod';const m=migrator(f);assert.equal(m.db.projectId,'demo-vistavo-ledger');assert.equal(m.db._settings.servicePath,'127.0.0.1');assert.equal(m.db._settings.port,8185);assert.equal(m.db._settings.ssl,false);
  process.env.FIRESTORE_EMULATOR_HOST='localhost:8185';await assert.rejects(m.scanPage('billingIntents','backfill'),error=>error.code==='emulator_boundary');
  process.env.FIRESTORE_EMULATOR_HOST=host;assert.equal((await f.root.collection('billingNextAttemptCheckpoints').get()).size,0);
 }finally{process.env.FIRESTORE_EMULATOR_HOST=host;if(project===undefined)delete process.env.GOOGLE_CLOUD_PROJECT;else process.env.GOOGLE_CLOUD_PROJECT=project;}
});

test('new intent and external outbox writers store numeric initial scheduling times',async()=>{
 const f=fixture(),backend=new FirestoreBackend(f.db,f.root),uid='synthetic-writer-'+randomUUID(),account=await backend.accountForUid(uid),inputId=randomUUID(),requestKey=randomUUID();
 const sha='a'.repeat(64),billing={provider:'account_seconds',identityKey:accountIdentityKey(uid),reservationId:randomUUID(),seconds:2};
 await f.root.collection('accounts').doc(account).update({aiPilot:true,simulationOnly:true});
 await f.root.collection('inputs').doc(inputId).create({accountId:account,deleted:false,expiresAtMs:Date.now()+60000,ready:true,sha256:sha,unknownCount:0,metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:objectPlan(inputId,12).final,generation:'1',size:12,sha256:sha}});
 await f.root.collection('projects').doc(inputId).create({accountId:account,inputId,revision:1,draft:'synthetic'});
 const before=Date.now();await backend.beginExternalBillingIntent(account,inputId,requestKey,'translation:en',1,billing);
 const rows=await f.root.collection('billingIntents').get();assert.equal(rows.size,1);const scheduled=rows.docs[0].get('nextAttemptAt');assert(Number.isSafeInteger(scheduled));assert(scheduled>=before&&scheduled<=Date.now());
 const jobId=await backend.reserve(account,inputId,requestKey,2,'translation:en',1,AI_CATALOG_VERSION,billing,undefined,uid);assert.equal(await backend.cancel(account,jobId),true);
 const outbox=await f.root.collection('billingOutbox').doc(jobId).get(),outboxTime=outbox.get('nextAttemptAt');assert.equal(outbox.get('state'),'pending');assert(Number.isSafeInteger(outboxTime));assert(outboxTime>=before&&outboxTime<=Date.now());
});

test('backfill and verification paginate beyond 100 for both collections without altering terminal rows or backoff',async()=>{
 const f=fixture(),m=migrator(f,{now:()=>1_000_000}),batch=f.db.batch(),expected=new Map();
 for(const target of ['billingIntents','billingOutbox'])for(let i=0;i<137;i++){
  const id='row-'+String(i).padStart(3,'0'),terminal=i%11===0,state=terminal?(target==='billingIntents'?'closed':'settled'):(target==='billingIntents'?(i%2?'reserve_pending':'release_pending'):(i%2?'pending':'retry_wait'));
  const row={state,synthetic:'unchanged'};
  if(!terminal){if(i%5===0)row.nextAttemptAt=5_000_000;else if(i%3===0){row.attempts=2;row.lastAttemptAtMs=900_000;}else if(i%3===1)row.attempts=0;else row.attempts=1;}
  batch.create(f.root.collection(target).doc(id),row);expected.set(target+'/'+id,row);
 }
 await batch.commit();
 for(const target of ['billingIntents','billingOutbox']){
  const report=await complete(m,target,'backfill',31);assert.equal(report.status,'scan_complete');assert.equal(report.scanned,137);assert.equal(report.writerGate,'unverified');assert.equal(report.readerEnabled,false);
  const rows=await f.root.collection(target).get();assert.equal(rows.size,137);
  for(const doc of rows.docs){const original=expected.get(target+'/'+doc.id),after=doc.data();
   if(['closed','settled'].includes(original.state))assert.deepEqual(after,original);
   else if(Object.hasOwn(original,'nextAttemptAt'))assert.equal(after.nextAttemptAt,original.nextAttemptAt);
   else if(original.attempts===2)assert.equal(after.nextAttemptAt,904_000);
   else if(original.attempts===0)assert.equal(after.nextAttemptAt,1_000_000);
   else assert.equal(after.nextAttemptAt,1_900_000);
  }
  const verified=await complete(m,target,'verify',37);assert.equal(verified.status,'scan_complete');assert.equal(verified.scanned,137);assert.equal(verified.modified,0);assert.equal(verified.writerGate,'unverified');assert.equal(verified.readerEnabled,false);
 }
});

test('a row changed after page selection does not overwrite concurrent backoff or terminal state',async()=>{
 const f=fixture();await f.root.collection('billingIntents').doc('a').create({state:'reserve_pending',attempts:1});await f.root.collection('billingIntents').doc('b').create({state:'release_pending',attempts:1});
 let enter,release;const selected=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});const delayed=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{enter();await resume;}}}),normal=migrator(f,{now:()=>1000});
 const work=delayed.scanPage('billingIntents','backfill',10);
 try{await selected;const before=await f.root.collection('billingIntents').doc('a').get();await f.root.collection('billingIntents').doc('a').update({nextAttemptAt:999999});const after=await f.root.collection('billingIntents').doc('a').get();assert(before.createTime.isEqual(after.createTime));await f.root.collection('billingIntents').doc('b').update({state:'closed',terminalSentinel:'preserve'});release();
  assert.equal((await work).status,'stale');assert.equal((await checkpoint(f,'billingIntents','backfill').get()).get('cursor'),null);
  assert.equal((await complete(normal,'billingIntents','backfill')).status,'scan_complete');assert.equal((await f.root.collection('billingIntents').doc('a').get()).get('nextAttemptAt'),999999);
  assert.deepEqual((await f.root.collection('billingIntents').doc('b').get()).data(),{state:'closed',attempts:1,terminalSentinel:'preserve'});
 }finally{release();await work.catch(()=>undefined);}
});

test('a deleted selected row blocks after another executor advanced the same epoch',async()=>{
 const f=fixture(),collection=f.root.collection('billingIntents');await collection.doc('a').create({state:'reserve_pending',attempts:0});await collection.doc('b').create({state:'reserve_pending',attempts:0});
 let enter,release;const selected=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});const slow=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{enter();await resume;}}}),fast=migrator(f,{now:()=>1000}),work=slow.scanPage('billingIntents','backfill',2);
 try{await selected;await fast.scanPage('billingIntents','backfill',1);const before=(await checkpoint(f,'billingIntents','backfill').get()).data();assert.equal(before.cursor,'a');
  await collection.doc('a').delete();release();const result=await work;assert.equal(result.status,'blocked');assert.equal(result.issue.reason,'selected_row_missing');
  const after=(await checkpoint(f,'billingIntents','backfill').get()).data();assert.equal(after.cursor,before.cursor);assert.equal(after.sequence,before.sequence);assert.equal(after.epoch,before.epoch);
  assert.equal((await fast.scanPage('billingIntents','backfill')).status,'blocked');assert.equal((await collection.doc('b').get()).get('nextAttemptAt'),undefined);assert.equal((await f.root.collection('billingNextAttemptIssues').get()).size,1);
 }finally{release();await work.catch(()=>undefined);}
});

test('two executors observing the same missing row persist one shared incident',async()=>{
 const f=fixture(),collection=f.root.collection('billingOutbox'),row=collection.doc('a');await row.create({state:'pending',attempts:0});
 let count=0,enter,release;const selected=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;}),hooks={afterPageRead:async()=>{if(++count===2)enter();await resume;}};
 const first=migrator(f,{now:()=>1000,hooks}),second=migrator(f,{now:()=>1000,hooks}),a=first.scanPage('billingOutbox','backfill'),b=second.scanPage('billingOutbox','backfill');
 try{await selected;await row.delete();release();const results=await Promise.all([a,b]);assert(results.every(x=>x.status==='blocked'&&x.issue.reason==='selected_row_missing'));
  assert.equal((await f.root.collection('billingNextAttemptIssues').get()).size,1);assert.equal((await f.root.collection('billingNextAttemptBarriers').get()).size,1);assert.equal((await checkpoint(f,'billingOutbox','backfill').get()).get('cursor'),null);
 }finally{release();await Promise.allSettled([a,b]);}
});

test('a late deletion observation blocks a previously completed scan and its verification',async()=>{
 const f=fixture(),collection=f.root.collection('billingIntents');for(const id of ['a','b'])await collection.doc(id).create({state:'reserve_pending',attempts:0});
 let enter,release;const selected=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});const slow=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{enter();await resume;}}}),fast=migrator(f,{now:()=>1000}),work=slow.scanPage('billingIntents','backfill',2);
 try{await selected;assert.equal((await complete(fast,'billingIntents','backfill')).status,'scan_complete');const before=(await checkpoint(f,'billingIntents','backfill').get()).data();await collection.doc('a').delete();release();
  assert.equal((await work).status,'blocked');const after=(await checkpoint(f,'billingIntents','backfill').get()).data();assert.equal(after.cursor,before.cursor);assert.equal(after.epoch,before.epoch);assert.equal(after.sequence,before.sequence);
  assert.equal((await fast.scanPage('billingIntents','backfill')).status,'blocked');const verify=await fast.scanPage('billingIntents','verify');assert.equal(verify.status,'blocked');assert.equal(verify.readerEnabled,false);
 }finally{release();await work.catch(()=>undefined);}
});

test('a page report rereads a barrier created after its last row committed',async()=>{
 const f=fixture(),row=f.root.collection('billingIntents').doc('a');await row.create({state:'reserve_pending',attempts:0});
 let select,releaseSlow,commit,releaseFast;const selected=new Promise(r=>{select=r;}),resumeSlow=new Promise(r=>{releaseSlow=r;}),committed=new Promise(r=>{commit=r;}),resumeFast=new Promise(r=>{releaseFast=r;});
 const slow=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{select();await resumeSlow;}}}),fast=migrator(f,{now:()=>1000}),original=fast.db.runTransaction.bind(fast.db);let armed=true;
 fast.db.runTransaction=async(...args)=>{const result=await original(...args);if(armed&&result?.state==='advanced'){armed=false;commit();await resumeFast;}return result;};
 const slowWork=slow.scanPage('billingIntents','backfill',1);let fastWork;
 try{await selected;fastWork=fast.scanPage('billingIntents','backfill',1);await committed;await row.delete();releaseSlow();assert.equal((await slowWork).status,'blocked');releaseFast();
  const result=await fastWork;assert.equal(result.status,'blocked');assert.equal(result.issue.reason,'selected_row_missing');assert.equal(result.readerEnabled,false);
 }finally{releaseSlow();releaseFast();await Promise.allSettled([slowWork,...(fastWork?[fastWork]:[])]);fast.db.runTransaction=original;}
});

test('a completed-scan report rereads a barrier committed after completion',async()=>{
 const f=fixture(),row=f.root.collection('billingIntents').doc('a');await row.create({state:'reserve_pending',attempts:0});
 let select,releaseSlow,commit,releaseFast;const selected=new Promise(r=>{select=r;}),resumeSlow=new Promise(r=>{releaseSlow=r;}),committed=new Promise(r=>{commit=r;}),resumeFast=new Promise(r=>{releaseFast=r;});
 const slow=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{select();await resumeSlow;}}}),fast=migrator(f,{now:()=>1000}),original=fast.db.runTransaction.bind(fast.db);let armed=true;
 fast.db.runTransaction=async(...args)=>{const result=await original(...args);if(armed&&(result?.status==='scan_complete'||result?.checkpoint?.status==='scan_complete')){armed=false;commit();await resumeFast;}return result;};
 const slowWork=slow.scanPage('billingIntents','backfill',1);let finishing;
 try{await selected;assert.equal((await fast.scanPage('billingIntents','backfill',1)).status,'scanning');finishing=fast.scanPage('billingIntents','backfill',1);await committed;
  await row.delete();releaseSlow();assert.equal((await slowWork).status,'blocked');releaseFast();const result=await finishing;assert.equal(result.status,'blocked');assert.equal(result.issue.reason,'selected_row_missing');assert.equal(result.readerEnabled,false);
 }finally{releaseSlow();releaseFast();await Promise.allSettled([slowWork,...(finishing?[finishing]:[])]);fast.db.runTransaction=original;}
});

test('a barrier written after the final read cannot revoke that report but blocks the next read',async()=>{
 const f=fixture(),row=f.root.collection('billingIntents').doc('a');await row.create({state:'reserve_pending',attempts:0});
 let select,releaseSlow,read,releaseFast;const selected=new Promise(r=>{select=r;}),resumeSlow=new Promise(r=>{releaseSlow=r;}),readDone=new Promise(r=>{read=r;}),resumeFast=new Promise(r=>{releaseFast=r;});
 const slow=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{select();await resumeSlow;}}}),fast=migrator(f,{now:()=>1000}),original=fast.db.runTransaction.bind(fast.db);let armed=true;
 fast.db.runTransaction=async(callback,options)=>{const result=await original(callback,options);if(armed&&options?.readOnly){armed=false;read();await resumeFast;}return result;};
 const slowWork=slow.scanPage('billingIntents','backfill',1);let fastWork;
 try{await selected;fastWork=fast.scanPage('billingIntents','backfill',1);await readDone;await row.delete();releaseSlow();assert.equal((await slowWork).status,'blocked');releaseFast();
  const old=await fastWork;assert.equal(old.status,'scanning');assert.equal(old.readerEnabled,false);const fresh=await fast.scanPage('billingIntents','backfill');assert.equal(fresh.status,'blocked');assert.equal(fresh.issue.reason,'selected_row_missing');
 }finally{releaseSlow();releaseFast();await Promise.allSettled([slowWork,...(fastWork?[fastWork]:[])]);fast.db.runTransaction=original;}
});

test('an old epoch observing a deletion blocks the restarted verification without moving its cursor',async()=>{
 const f=fixture(),collection=f.root.collection('billingIntents'),fast=migrator(f,{now:()=>1000});for(const id of ['a','b'])await collection.doc(id).create({state:'reserve_pending',attempts:0});
 assert.equal((await complete(fast,'billingIntents','backfill')).status,'scan_complete');let enter,release;const selected=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;}),slow=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{enter();await resume;}}}),work=slow.scanPage('billingIntents','verify',2);
 try{await selected;const first=await complete(fast,'billingIntents','verify');assert.equal(await fast.restartVerification('billingIntents',first.epoch),true);await collection.doc('a').delete();release();const result=await work;
  assert.equal(result.status,'blocked');assert.equal(result.epoch,2);const cursor=await checkpoint(f,'billingIntents','verify').get();assert.equal(cursor.get('epoch'),2);assert.equal(cursor.get('cursor'),null);assert.equal(cursor.get('sequence'),0);
  assert.equal((await fast.scanPage('billingIntents','verify')).status,'blocked');await assert.rejects(fast.restartVerification('billingIntents',2),error=>error.code==='review_required');
 }finally{release();await work.catch(()=>undefined);}
});

test('a selected row deleted and recreated under the same ID is blocked as replacement',async()=>{
 const f=fixture(),collection=f.root.collection('billingIntents'),row=collection.doc('a');await row.create({state:'reserve_pending',attempts:0});await collection.doc('b').create({state:'reserve_pending',attempts:0});
 let enter,release;const selected=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});const slow=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{enter();await resume;}}}),fast=migrator(f,{now:()=>1000}),work=slow.scanPage('billingIntents','backfill',2);
 try{await selected;const before=await row.get();await row.delete();await row.create({state:'closed',sentinel:'unchanged'});const replacement=await row.get();assert.equal(before.createTime.isEqual(replacement.createTime),false);release();
  const result=await work;assert.equal(result.status,'blocked');assert.equal(result.issue.reason,'selected_row_replaced');assert.equal((await checkpoint(f,'billingIntents','backfill').get()).get('cursor'),null);
  assert.deepEqual((await row.get()).data(),{state:'closed',sentinel:'unchanged'});assert.equal((await fast.scanPage('billingIntents','backfill')).status,'blocked');
 }finally{release();await work.catch(()=>undefined);}
});

test('a stale missing-row incident does not overwrite a different existing data blocker',async()=>{
 const f=fixture(),collection=f.root.collection('billingIntents');await collection.doc('a').create({state:'reserve_pending',attempts:0});await collection.doc('b').create({state:'reserve_pending',nextAttemptAt:'invalid'});
 let enter,release;const selected=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});const slow=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{enter();await resume;}}}),fast=migrator(f,{now:()=>1000}),work=slow.scanPage('billingIntents','backfill',2);
 try{await selected;const first=await fast.scanPage('billingIntents','backfill',2);assert.equal(first.status,'blocked');assert.equal(first.issue.reason,'invalid_next_attempt');const before=(await checkpoint(f,'billingIntents','backfill').get()).data();
  await collection.doc('a').delete();release();assert.equal((await work).status,'blocked');const after=(await checkpoint(f,'billingIntents','backfill').get()).data();assert.deepEqual(after,before);
  const issues=await f.root.collection('billingNextAttemptIssues').get();assert.equal(issues.size,2);assert.deepEqual(issues.docs.map(d=>d.get('reason')).sort(),['invalid_next_attempt','selected_row_missing']);
  await collection.doc('b').update({nextAttemptAt:3000});assert.equal((await fast.scanPage('billingIntents','backfill')).status,'blocked');assert.deepEqual((await checkpoint(f,'billingIntents','backfill').get()).data(),before);
 }finally{release();await work.catch(()=>undefined);}
});

test('a selected row deleted before its transaction leaves a durable incident and blocks the cursor',async()=>{
 const f=fixture(),collection=f.root.collection('billingIntents'),secret='SYNTHETIC_PRIVATE_DELETE_SENTINEL';
 await collection.doc('a').create({state:'reserve_pending',attempts:0,privatePayload:secret});await collection.doc('b').create({state:'reserve_pending',attempts:0});
 let enter,release;const selected=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});const delayed=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{enter();await resume;}}}),normal=migrator(f,{now:()=>1000});
 const work=delayed.scanPage('billingIntents','backfill',10);
 try{await selected;await collection.doc('a').delete();release();const result=await work;
  assert.equal(result.status,'blocked');assert.equal(result.issue.reason,'selected_row_missing');
  const cursor=await checkpoint(f,'billingIntents','backfill').get();assert.equal(cursor.get('cursor'),null);assert.equal(cursor.get('status'),'blocked');
  const issues=await f.root.collection('billingNextAttemptIssues').get();assert.equal(issues.size,1);assert.equal(issues.docs[0].get('reason'),'selected_row_missing');assert.equal(issues.docs[0].get('state'),'open');
  assert.equal(JSON.stringify(issues.docs[0].data()).includes(secret),false);assert.equal(JSON.stringify(issues.docs[0].data()).includes('privatePayload'),false);
  assert.equal((await normal.scanPage('billingIntents','backfill')).status,'blocked');assert.equal((await collection.doc('b').get()).get('nextAttemptAt'),undefined);
  await collection.doc('a').create({state:'closed'});assert.equal((await normal.scanPage('billingIntents','backfill')).status,'blocked');
  assert.equal((await checkpoint(f,'billingIntents','backfill').get()).get('cursor'),null);assert.equal((await issues.docs[0].ref.get()).get('state'),'open');
 }finally{release();await work.catch(()=>undefined);}
});

test('a database failure while recording a selected deletion propagates without advancing',async()=>{
 const f=fixture(),collection=f.root.collection('billingOutbox');await collection.doc('a').create({state:'pending',attempts:0});await collection.doc('b').create({state:'pending',attempts:0});
 let enter,release;const selected=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});const m=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{enter();await resume;}}});
 const work=m.scanPage('billingOutbox','backfill',10),original=m.db.runTransaction;
 try{await selected;await collection.doc('a').delete();m.db.runTransaction=async()=>{throw Error('synthetic database outage');};release();
  await assert.rejects(work,error=>error.code==='row_failed');const cursor=await checkpoint(f,'billingOutbox','backfill').get();assert.equal(cursor.get('cursor'),null);assert.notEqual(cursor.get('status'),'scan_complete');
  assert.equal((await f.root.collection('billingNextAttemptIssues').get()).size,0);assert.equal((await collection.doc('b').get()).get('nextAttemptAt'),undefined);
 }finally{m.db.runTransaction=original;release();await work.catch(()=>undefined);}
});

test('two executors cannot skip a row or move the checkpoint backwards',async()=>{
 const f=fixture(),batch=f.db.batch();for(const id of ['a','b','c','d','e'])batch.create(f.root.collection('billingOutbox').doc(id),{state:'pending',attempts:0});await batch.commit();
 let enter,release;const selected=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});const slow=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{enter();await resume;}}}),fast=migrator(f,{now:()=>1000});
 const work=slow.scanPage('billingOutbox','backfill',5);
 try{await selected;const first=await fast.scanPage('billingOutbox','backfill',2);assert.equal(first.scanned,2);assert.equal((await checkpoint(f,'billingOutbox','backfill').get()).get('cursor'),'b');
  release();assert.equal((await work).status,'stale');assert.equal((await checkpoint(f,'billingOutbox','backfill').get()).get('cursor'),'b');
  const pair=await Promise.all([slow.scanPage('billingOutbox','backfill',2),fast.scanPage('billingOutbox','backfill',2)]);assert(pair.every(x=>['stale','scanning','scan_complete'].includes(x.status)));
  const done=await complete(fast,'billingOutbox','backfill',2);assert.equal(done.status,'scan_complete');assert.equal(done.scanned,5);assert.equal(done.modified,5);
  for(const doc of (await f.root.collection('billingOutbox').get()).docs)assert.equal(doc.get('nextAttemptAt'),1000);
 }finally{release();await work.catch(()=>undefined);}
});

test('a fresh executor resumes after an interruption from the durable checkpoint',async()=>{
 const f=fixture(),first=migrator(f,{now:()=>1000});for(const id of ['a','b','c','d','e'])await f.root.collection('billingIntents').doc(id).create({state:'reserve_pending',attempts:0});
 const partial=await first.scanPage('billingIntents','backfill',2);assert.equal(partial.scanned,2);assert.equal((await checkpoint(f,'billingIntents','backfill').get()).get('cursor'),'b');
 const restarted=migrator(f,{now:()=>1000}),done=await complete(restarted,'billingIntents','backfill',2);assert.equal(done.status,'scan_complete');assert.equal(done.scanned,5);assert.equal(done.modified,5);
 for(const doc of (await f.root.collection('billingIntents').get()).docs)assert.equal(doc.get('nextAttemptAt'),1000);
});

test('page failure is visible, leaves the cursor unchanged and can resume safely',async()=>{
 const f=fixture();await f.root.collection('billingIntents').doc('a').create({state:'reserve_pending',attempts:0});let fail=true;
 const m=migrator(f,{now:()=>1000,hooks:{beforePageRead:async()=>{if(fail){fail=false;throw Error('private diagnostic must not be stored');}}}});
 await assert.rejects(m.scanPage('billingIntents','backfill'),error=>error.code==='page_failed');const blocked=await checkpoint(f,'billingIntents','backfill').get();
 assert.equal(blocked.get('status'),'blocked');assert.equal(blocked.get('block.kind'),'page_failure');assert.equal(blocked.get('cursor'),null);assert.equal((await f.root.collection('billingIntents').doc('a').get()).get('nextAttemptAt'),undefined);assert.equal(JSON.stringify(blocked.data()).includes('private diagnostic'),false);
 assert.equal((await complete(m,'billingIntents','backfill')).status,'scan_complete');assert.equal((await f.root.collection('billingIntents').doc('a').get()).get('nextAttemptAt'),1000);
});

test('a failed final barrier read returns an error instead of a successful report',async()=>{
 const f=fixture(),m=migrator(f,{now:()=>1000}),row=f.root.collection('billingIntents').doc('a');await row.create({state:'reserve_pending',attempts:0});
 const original=m.db.runTransaction.bind(m.db);m.db.runTransaction=async(callback,options)=>{if(options?.readOnly)throw Error('synthetic final read outage');return original(callback,options);};
 try{await assert.rejects(m.scanPage('billingIntents','backfill',1),error=>error.code==='report_failed');const current=await checkpoint(f,'billingIntents','backfill').get();assert.equal(current.get('status'),'blocked');assert.equal(current.get('block.kind'),'page_failure');assert.equal(current.get('cursor'),'a');}
 finally{m.db.runTransaction=original;}
 assert.equal((await complete(m,'billingIntents','backfill')).status,'scan_complete');
});

test('verification cannot start early and a corrupt checkpoint fails without changing queued rows',async()=>{
 const f=fixture(),m=migrator(f,{now:()=>1000}),collection=f.root.collection('billingIntents');await collection.doc('a').create({state:'reserve_pending',attempts:0});await collection.doc('b').create({state:'reserve_pending',attempts:0});
 await assert.rejects(m.scanPage('billingIntents','verify'),error=>error.code==='backfill_incomplete');assert.equal((await checkpoint(f,'billingIntents','verify').get()).exists,false);
 assert.equal((await m.scanPage('billingIntents','backfill',1)).scanned,1);const cursor=checkpoint(f,'billingIntents','backfill');await cursor.update({sequence:-1});const before=(await cursor.get()).data(),rowBefore=(await collection.doc('b').get()).data();
 await assert.rejects(m.scanPage('billingIntents','backfill',1),error=>error.code==='checkpoint_invalid');assert.deepEqual((await cursor.get()).data(),before);assert.deepEqual((await collection.doc('b').get()).data(),rowBefore);
});

test('a malformed shared barrier fails closed before any cursor or row is changed',async()=>{
 const f=fixture(),m=migrator(f,{now:()=>1000}),collection=f.root.collection('billingIntents');await collection.doc('a').create({state:'reserve_pending',attempts:0});
 await f.root.collection('billingNextAttemptBarriers').doc('billingIntents').create({kind:'billing-next-attempt-barrier-v1',target:'billingIntents',blocked:false});
 await assert.rejects(m.scanPage('billingIntents','backfill'),error=>error.code==='checkpoint_invalid');assert.equal((await checkpoint(f,'billingIntents','backfill').get()).exists,false);assert.equal((await collection.doc('a').get()).get('nextAttemptAt'),undefined);
});

test('corrupt data creates a private-safe blocking incident and remains unchanged until repaired',async()=>{
 const f=fixture(),m=migrator(f,{now:()=>1000}),a=f.root.collection('billingIntents').doc('a'),b=f.root.collection('billingIntents').doc('b'),secret='SYNTHETIC_PRIVATE_DO_NOT_STORE';
 await a.create({state:'reserve_pending',nextAttemptAt:'bad',privatePayload:secret});await b.create({state:'invalid',privatePayload:secret});
 let result=await m.scanPage('billingIntents','backfill');assert.equal(result.status,'blocked');assert.equal(result.issue.reason,'invalid_next_attempt');assert.equal((await checkpoint(f,'billingIntents','backfill').get()).get('cursor'),null);
 let issues=await f.root.collection('billingNextAttemptIssues').get();assert.equal(issues.size,1);assert.equal(JSON.stringify(issues.docs[0].data()).includes(secret),false);assert.equal(JSON.stringify(issues.docs[0].data()).includes('accountId'),false);
 assert.equal((await a.get()).get('nextAttemptAt'),'bad');assert.equal((await m.scanPage('billingIntents','backfill')).status,'blocked');
 await a.update({nextAttemptAt:9999});result=await m.scanPage('billingIntents','backfill');assert.equal(result.status,'blocked');assert.equal(result.issue.reason,'invalid_state');assert.equal((await checkpoint(f,'billingIntents','backfill').get()).get('cursor'),'a');
 await b.update({state:'closed'});result=await complete(m,'billingIntents','backfill');assert.equal(result.status,'scan_complete');issues=await f.root.collection('billingNextAttemptIssues').get();assert.equal(issues.size,2);assert(issues.docs.every(d=>d.get('state')==='resolved'));
 assert.deepEqual((await b.get()).data(),{state:'closed',privatePayload:secret});
});

test('deleting a corrupt row does not silently resolve its blocking incident',async()=>{
 const f=fixture(),m=migrator(f,{now:()=>1000}),bad=f.root.collection('billingOutbox').doc('a');await bad.create({state:'pending',nextAttemptAt:null});
 assert.equal((await m.scanPage('billingOutbox','backfill')).status,'blocked');await bad.delete();const retry=await m.scanPage('billingOutbox','backfill');
 assert.equal(retry.status,'blocked');assert.equal((await checkpoint(f,'billingOutbox','backfill').get()).get('cursor'),null);const issues=await f.root.collection('billingNextAttemptIssues').get();assert.equal(issues.size,1);assert.equal(issues.docs[0].get('state'),'open');
});

test('verification restart revisits IDs behind its old cursor and never enables a reader',async()=>{
 const f=fixture(),m=migrator(f,{now:()=>1000}),collection=f.root.collection('billingIntents');for(const id of ['b','c','d'])await collection.doc(id).create({state:'reserve_pending',nextAttemptAt:2000});
 assert.equal((await complete(m,'billingIntents','backfill',2)).status,'scan_complete');const first=await m.scanPage('billingIntents','verify',2);assert.equal(first.scanned,2);
 await collection.doc('a').create({state:'reserve_pending'});const old=await complete(m,'billingIntents','verify',2);assert.equal(old.status,'scan_complete');assert.equal(old.writerGate,'unverified');assert.equal(old.readerEnabled,false);
 assert.equal(await m.restartVerification('billingIntents',old.epoch),true);assert.equal(await m.restartVerification('billingIntents',old.epoch),false);
 let verify=await m.scanPage('billingIntents','verify',2);assert.equal(verify.status,'blocked');assert.equal(verify.issue.reason,'missing_next_attempt');assert.equal((await collection.doc('a').get()).get('nextAttemptAt'),undefined);
 await collection.doc('a').update({nextAttemptAt:2500});verify=await m.scanPage('billingIntents','verify',2);assert.equal(verify.scanned,2);
 await collection.doc('00').create({state:'reserve_pending',nextAttemptAt:'invalid'});const second=await complete(m,'billingIntents','verify',2);assert.equal(second.status,'scan_complete');assert.equal(second.readerEnabled,false);
 assert.equal(await m.restartVerification('billingIntents',second.epoch),true);verify=await m.scanPage('billingIntents','verify',2);assert.equal(verify.status,'blocked');assert.equal(verify.issue.reason,'invalid_next_attempt');assert.equal((await collection.doc('00').get()).get('nextAttemptAt'),'invalid');
});

test('an old verification worker cannot advance a restarted epoch',async()=>{
 const f=fixture(),fast=migrator(f,{now:()=>1000});for(const id of ['a','b','c'])await f.root.collection('billingOutbox').doc(id).create({state:'pending',nextAttemptAt:2000});
 assert.equal((await complete(fast,'billingOutbox','backfill')).status,'scan_complete');let done=await complete(fast,'billingOutbox','verify');assert.equal(await fast.restartVerification('billingOutbox',done.epoch),true);
 let enter,release;const selected=new Promise(r=>{enter=r;}),resume=new Promise(r=>{release=r;});const slow=migrator(f,{now:()=>1000,hooks:{afterPageRead:async()=>{enter();await resume;}}}),work=slow.scanPage('billingOutbox','verify',2);
 try{await selected;done=await complete(fast,'billingOutbox','verify',2);assert.equal(done.epoch,2);assert.equal(await fast.restartVerification('billingOutbox',2),true);
  release();assert.equal((await work).status,'stale');const current=await checkpoint(f,'billingOutbox','verify').get();assert.equal(current.get('epoch'),3);assert.equal(current.get('cursor'),null);assert.equal(current.get('sequence'),0);
 }finally{release();await work.catch(()=>undefined);}
});
