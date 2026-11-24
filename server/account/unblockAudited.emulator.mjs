// LV-019.B step 1.4b piece 1: audited unblock on the Account side.
// Contract: docs/specs/LV-019-B-bloqueos-y-cierres-diseno.md (2 decisions 4 and 8, 3.3, 3.6, 4 tests 11/12/13, 6).
// A real AccountStore runs against the fixed emulator; every fixture is deleted in the finally cleanup.
import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {AccountStore} from './backend.ts';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185')throw Error('Dedicated loopback emulator required, no fallback');
const fixtures=[];
before(async()=>{assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const f of fixtures.splice(0)){await f.db.recursiveDelete(f.root);await f.db.terminate();await deleteApp(f.app);}});
// Injectable clock: the guard `createdAtMs` is the discriminator a stale unblock must miss.
function fixture(){const app=initializeApp({projectId:'demo-vistavo-ledger'},'unblock-'+randomUUID()),db=getFirestore(app),root=db.collection('vistavo_account_test').doc(randomUUID()),f={app,db,root,time:1_800_000_000_000};f.store=new AccountStore(db,root,()=>f.time);fixtures.push(f);return f;}
const reject=(p,code)=>assert.rejects(p,e=>e.code===code,'expected '+code);
const guardRef=(f,accountId)=>f.root.collection('videoBillingGuards').doc(accountId);
const incidentRef=(f,accountId,incident)=>f.root.collection('videoBillingIncidents').doc(createHash('sha256').update(JSON.stringify([accountId,incident])).digest('hex'));
const unblockRef=(f,accountId,incident)=>f.root.collection('videoBillingUnblocks').doc(createHash('sha256').update(JSON.stringify([accountId,incident,'unblock'])).digest('hex'));
// Every document of the four Account billing collections, so a replay can be proven to write nothing.
async function signature(f){
 const rows=[];
 for(const name of ['accounts','videoBillingGuards','videoBillingIncidents','videoBillingUnblocks']){
  const snap=await f.root.collection(name).get();
  for(const doc of snap.docs)rows.push([doc.ref.path,JSON.stringify(doc.data()),doc.updateTime.toMillis()]);
 }
 return rows.sort((a,b)=>a[0]<b[0]?-1:1);
}
async function owner(f,uid,credited=90){
 const boot=await f.store.bootstrap(uid),accountId=boot.account.id;
 await f.root.collection('accounts').doc(accountId).update({credited,available:credited});
 return {key:AccountStore.identityKey(uid),accountId};
}
const callKey='text-window:0000',model='gemini-3.8-flash';

test('an audited unblock of the only incident deletes the guard and restores reserve, admit and settle',async()=>{
 const f=fixture(),{key,accountId}=await owner(f,'unblock-single'),incident=randomUUID(),ref='review-ref-'+randomUUID();
 assert.equal((await guardRef(f,accountId).get()).exists,false);
 assert.deepEqual(await f.store.blockVideoBilling(key,incident),{blocked:true,recorded:true,created:true});
 const guard=await guardRef(f,accountId).get();assert.equal(guard.get('epoch'),1);assert.equal(guard.get('createdAtMs'),f.time);assert.equal(guard.get('incidentCount'),1);
 await reject(f.store.reserveVideo(key,randomUUID(),5),'conflict');
 assert.deepEqual(await f.store.unblockVideoBilling(key,{incidentId:incident,epoch:guard.get('epoch'),createdAtMs:guard.get('createdAtMs'),reviewRef:ref}),{unblocked:true,replayed:false,blocked:false});
 // The guard document itself is gone (never `blocked:false`), so the `invariant` of billingHold cannot fire.
 assert.equal((await guardRef(f,accountId).get()).exists,false);
 assert.deepEqual(await f.store.videoBillingHold(key,incident),{blocked:false,recorded:false});
 const rid=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()};
 assert.equal((await f.store.reserveVideo(key,rid,5)).created,true);
 assert.equal((await f.store.admitVideoCall(key,rid,5,a.jobId,a.attemptId,callKey,model,'a'.repeat(64))).created,true);
 assert.equal((await f.store.settleVideo(key,rid,'capture',5,a)).settled,true);
 const reviewed=await incidentRef(f,accountId,incident).get();assert.equal(reviewed.get('state'),'reviewed');assert.equal(reviewed.get('reviewedAtMs'),f.time);
 assert.deepEqual((await unblockRef(f,accountId,incident).get()).data(),{ownerAccountId:accountId,identityKey:key,incidentId:incident,epoch:1,createdAtMs:f.time,reviewRef:ref,unblockedAtMs:f.time});
 // No balance or reservation movement came from the unblock itself: only reserve + capture ledger rows exist.
 const ledger=(await f.store.ledger('unblock-single')).items;assert.deepEqual(ledger.map(x=>x.kind).sort(),['video_capture','video_reserve']);
});

test('an identical unblock is a replay without writes; a different payload is a conflict',async()=>{
 const f=fixture(),{key,accountId}=await owner(f,'unblock-replay'),incident=randomUUID(),ref='review-ref-'+randomUUID();
 await f.store.blockVideoBilling(key,incident);const guard=await guardRef(f,accountId).get();
 const request={incidentId:incident,epoch:guard.get('epoch'),createdAtMs:guard.get('createdAtMs'),reviewRef:ref};
 assert.deepEqual(await f.store.unblockVideoBilling(key,request),{unblocked:true,replayed:false,blocked:false});
 const before=await signature(f);
 assert.deepEqual(await f.store.unblockVideoBilling(key,request),{unblocked:true,replayed:true,blocked:false});
 assert.deepEqual(await signature(f),before,'an identical replay must not write anything');
 await reject(f.store.unblockVideoBilling(key,{...request,reviewRef:'other-'+randomUUID()}),'conflict');
 await reject(f.store.unblockVideoBilling(key,{...request,epoch:2}),'conflict');
 await reject(f.store.unblockVideoBilling(key,{...request,createdAtMs:request.createdAtMs+1}),'conflict');
 assert.deepEqual(await signature(f),before,'a conflicting replay must not write either');
});

test('an unblock naming a stale epoch or createdAtMs is refused; after a re-block only the current guard applies',async()=>{
 const f=fixture(),{key,accountId}=await owner(f,'unblock-stale'),first=randomUUID(),second=randomUUID(),ref='review-ref-'+randomUUID();
 await f.store.blockVideoBilling(key,first);const a=await guardRef(f,accountId).get(),createdA=a.get('createdAtMs');
 assert.equal(createdA,f.time);
 await f.store.unblockVideoBilling(key,{incidentId:first,epoch:a.get('epoch'),createdAtMs:createdA,reviewRef:ref});
 assert.equal((await guardRef(f,accountId).get()).exists,false);
 // A guard deleted and recreated resets the epoch to 1: only createdAtMs tells the generations apart.
 f.time+=1000;await f.store.blockVideoBilling(key,second);const b=await guardRef(f,accountId).get();
 assert.equal(b.get('epoch'),1);assert.equal(b.get('createdAtMs'),f.time);assert.notEqual(b.get('createdAtMs'),createdA);
 await reject(f.store.unblockVideoBilling(key,{incidentId:second,epoch:1,createdAtMs:createdA,reviewRef:ref}),'conflict');
 await reject(f.store.unblockVideoBilling(key,{incidentId:second,epoch:2,createdAtMs:b.get('createdAtMs'),reviewRef:ref}),'conflict');
 await reject(f.store.unblockVideoBilling(key,{incidentId:second,epoch:1,createdAtMs:createdA+1,reviewRef:ref}),'conflict');
 // Re-sending the OLD incident's exact request is only a replay and must not clear the newer block.
 assert.deepEqual(await f.store.unblockVideoBilling(key,{incidentId:first,epoch:1,createdAtMs:createdA,reviewRef:ref}),{unblocked:true,replayed:true,blocked:true});
 assert.equal((await guardRef(f,accountId).get()).exists,true);
 assert.deepEqual(await f.store.unblockVideoBilling(key,{incidentId:second,epoch:1,createdAtMs:b.get('createdAtMs'),reviewRef:ref}),{unblocked:true,replayed:false,blocked:false});
 assert.equal((await guardRef(f,accountId).get()).exists,false);
});

test('a missing or reviewed incident, a stale guard and a missing or oversized reviewRef are refused without writes',async()=>{
 const f=fixture(),{key,accountId}=await owner(f,'unblock-invalid'),incident=randomUUID(),ref='review-ref-'+randomUUID();
 await f.store.blockVideoBilling(key,incident);const guard=await guardRef(f,accountId).get();
 const base={incidentId:incident,epoch:guard.get('epoch'),createdAtMs:guard.get('createdAtMs'),reviewRef:ref};
 const before=await signature(f);
 await reject(f.store.unblockVideoBilling(key,{...base,incidentId:randomUUID()}),'conflict');
 for(const bad of [undefined,null,'','x'.repeat(201),'bad\nchar','bad\u0000char','bad\u001fchar','bad\u007fchar',5])await reject(f.store.unblockVideoBilling(key,{...base,reviewRef:bad}),'invalid');
 for(const bad of [undefined,null,0,-1,1.5,'1',true])await reject(f.store.unblockVideoBilling(key,{...base,epoch:bad}),'invalid');
 for(const bad of [undefined,null,-1,1.5,'0',true])await reject(f.store.unblockVideoBilling(key,{...base,createdAtMs:bad}),'invalid');
 await reject(f.store.unblockVideoBilling('bad',base),'invalid');
 await reject(f.store.unblockVideoBilling(key,null),'invalid');
 // The request shape is strict: an extra or a missing key is refused before any read (Codex addition after review).
 await reject(f.store.unblockVideoBilling(key,{...base,extra:1}),'invalid');
 await reject(f.store.unblockVideoBilling(key,{incidentId:base.incidentId,epoch:base.epoch,createdAtMs:base.createdAtMs}),'invalid');
 assert.deepEqual(await signature(f),before,'every refused input must leave the store untouched');
 // A guard that is still blocked but whose incident was already reviewed is never unblocked again.
 await incidentRef(f,accountId,incident).update({state:'reviewed',reviewedAtMs:f.time});
 await reject(f.store.unblockVideoBilling(key,base),'conflict');
});

test('two incidents keep the account blocked after the first unblock and open it only after the second',async()=>{
 const f=fixture(),{key,accountId}=await owner(f,'unblock-two'),first=randomUUID(),second=randomUUID(),ref='review-ref-'+randomUUID();
 await f.store.blockVideoBilling(key,first);await f.store.blockVideoBilling(key,second);
 const guard=await guardRef(f,accountId).get();assert.equal(guard.get('incidentCount'),2);assert.equal(guard.get('epoch'),2);
 assert.deepEqual(await f.store.unblockVideoBilling(key,{incidentId:first,epoch:2,createdAtMs:guard.get('createdAtMs'),reviewRef:ref}),{unblocked:true,replayed:false,blocked:true});
 const stillBlocked=await guardRef(f,accountId).get();assert.equal(stillBlocked.exists,true);assert.equal(stillBlocked.get('reviewedCount'),1);assert.equal(stillBlocked.get('incidentCount'),2);
 assert.equal((await incidentRef(f,accountId,first).get()).get('state'),'reviewed');
 await reject(f.store.reserveVideo(key,randomUUID(),5),'conflict');
 assert.deepEqual(await f.store.unblockVideoBilling(key,{incidentId:second,epoch:2,createdAtMs:guard.get('createdAtMs'),reviewRef:ref}),{unblocked:true,replayed:false,blocked:false});
 assert.equal((await guardRef(f,accountId).get()).exists,false);
 assert.equal((await f.store.reserveVideo(key,randomUUID(),5)).created,true);
});

// Emulator transactions hold a pessimistic read lock, so a same-document write cannot be injected into the
// read-to-write window; the two operations are instead started together and Firestore serializes them. The safety
// property is that neither a stale unblock nor a concurrent incident loses the other: the account must never end up
// open while the second incident is still unreviewed, and a live newer incident is never silently absorbed.
test('a concurrent incident never lets a stale unblock open an account that still owes a review',async()=>{
 for(let round=0;round<6;round++){
  const f=fixture(),{key,accountId}=await owner(f,'unblock-race'),first=randomUUID(),second=randomUUID(),ref='review-ref-'+randomUUID();
  await f.store.blockVideoBilling(key,first);const guard=await guardRef(f,accountId).get();
  const [unblock,block]=await Promise.allSettled([
   f.store.unblockVideoBilling(key,{incidentId:first,epoch:guard.get('epoch'),createdAtMs:guard.get('createdAtMs'),reviewRef:ref}),
   f.store.blockVideoBilling(key,second),
  ]);
  assert.equal(block.status,'fulfilled','the new incident must always be recorded');
  const firstQueued=await guardRef(f,accountId).get(),secondDoc=await incidentRef(f,accountId,second).get();
  assert.equal(secondDoc.exists,true);assert.equal(secondDoc.get('state'),'active','the second incident must remain unreviewed');
  // Whichever order the two operations commit in, the unreviewed second incident keeps the account closed.
  assert.deepEqual(await f.store.videoBillingHold(key,second),{blocked:true,recorded:true});
  await reject(f.store.reserveVideo(key,randomUUID(),5),'conflict');
  if(unblock.status==='fulfilled'){
   // The unblock won its read race and deleted the old guard; the new incident was not part of it and re-blocked the account.
   assert.deepEqual(unblock.value,{unblocked:true,replayed:false,blocked:false});
   assert.equal(firstQueued.exists,true,'the newer incident re-blocks what the stale unblock opened');
   assert.equal(firstQueued.get('incidentCount'),1);
   assert.equal(firstQueued.get('epoch'),1);
   assert.equal((await incidentRef(f,accountId,first).get()).get('state'),'reviewed');
  }else{
   // The incident committed first; the stale unblock must abort with a conflict and write nothing.
   assert.equal(unblock.reason.code,'conflict');
   assert.equal(firstQueued.exists,true);assert.equal(firstQueued.get('incidentCount'),2);assert.equal(firstQueued.get('epoch'),2);
   assert.equal((await incidentRef(f,accountId,first).get()).get('state'),'active');
   assert.equal((await unblockRef(f,accountId,first).get()).exists,false);
  }
 }
});

test('the reviewed reader reports blocked without recorded, and rejects corruption',async()=>{
 const f=fixture(),{key,accountId}=await owner(f,'unblock-reader'),first=randomUUID(),second=randomUUID(),third=randomUUID(),ref='review-ref-'+randomUUID();
 // (a) A single reviewed incident with the guard gone: not recorded (no ACTIVE incident with that id) and not blocked.
 await f.store.blockVideoBilling(key,first);let guard=await guardRef(f,accountId).get();
 await f.store.unblockVideoBilling(key,{incidentId:first,epoch:guard.get('epoch'),createdAtMs:guard.get('createdAtMs'),reviewRef:ref});
 assert.equal((await guardRef(f,accountId).get()).exists,false);
 assert.deepEqual(await f.store.videoBillingHold(key,first),{blocked:false,recorded:false});
 // (b) A reviewed incident while another incident still holds the account: blocked, not recorded, and no throw.
 await f.store.blockVideoBilling(key,second);await f.store.blockVideoBilling(key,third);guard=await guardRef(f,accountId).get();
 await f.store.unblockVideoBilling(key,{incidentId:second,epoch:guard.get('epoch'),createdAtMs:guard.get('createdAtMs'),reviewRef:ref});
 assert.equal((await guardRef(f,accountId).get()).exists,true);
 assert.deepEqual(await f.store.videoBillingHold(key,second),{blocked:true,recorded:false});
 assert.deepEqual(await f.store.videoBillingHold(key,third),{blocked:true,recorded:true});
 // (c) `reviewedAtMs` is always written by this operation: a reviewed incident missing it is corruption.
 await incidentRef(f,accountId,second).update({reviewedAtMs:FieldValue.delete()});
 await reject(f.store.videoBillingHold(key,second),'invariant');
 await incidentRef(f,accountId,second).update({reviewedAtMs:'not-an-integer'});
 await reject(f.store.videoBillingHold(key,second),'invariant');
 // (d) An unknown incident state is still corruption.
 await incidentRef(f,accountId,third).update({state:'closed'});
 await reject(f.store.videoBillingHold(key,third),'invariant');
});

test('a new incident keeps the reviewed counter, and only the last review deletes the guard',async()=>{
 const f=fixture(),{key,accountId}=await owner(f,'unblock-counter'),a=randomUUID(),b=randomUUID(),c=randomUUID(),ref='review-ref-'+randomUUID();
 await f.store.blockVideoBilling(key,a);await f.store.blockVideoBilling(key,b);
 const ab=await guardRef(f,accountId).get();assert.equal(ab.get('incidentCount'),2);assert.equal(ab.get('epoch'),2);
 assert.deepEqual(await f.store.unblockVideoBilling(key,{incidentId:a,epoch:2,createdAtMs:ab.get('createdAtMs'),reviewRef:ref}),{unblocked:true,replayed:false,blocked:true});
 assert.equal((await guardRef(f,accountId).get()).get('reviewedCount'),1);
 // A third incident raises incidentCount and epoch but must NOT reset the reviewed counter.
 await f.store.blockVideoBilling(key,c);
 const abc=await guardRef(f,accountId).get();assert.equal(abc.get('incidentCount'),3);assert.equal(abc.get('epoch'),3);assert.equal(abc.get('reviewedCount'),1);
 // Reviewing B with the epoch that predates C is refused.
 await reject(f.store.unblockVideoBilling(key,{incidentId:b,epoch:2,createdAtMs:ab.get('createdAtMs'),reviewRef:ref}),'conflict');
 assert.deepEqual(await f.store.unblockVideoBilling(key,{incidentId:b,epoch:3,createdAtMs:abc.get('createdAtMs'),reviewRef:ref}),{unblocked:true,replayed:false,blocked:true});
 assert.equal((await guardRef(f,accountId).get()).get('reviewedCount'),2);
 assert.equal((await f.root.collection('accounts').doc(accountId).get()).get('active'),0);
 await reject(f.store.reserveVideo(key,randomUUID(),5),'conflict');
 assert.deepEqual(await f.store.unblockVideoBilling(key,{incidentId:c,epoch:3,createdAtMs:abc.get('createdAtMs'),reviewRef:ref}),{unblocked:true,replayed:false,blocked:false});
 assert.equal((await guardRef(f,accountId).get()).exists,false);
 assert.equal((await f.store.reserveVideo(key,randomUUID(),5)).created,true);
});

// Codex additions after the independent review and the mutation round: the identity gate and the status reader.
test('an unprovisioned identity is refused with account_not_provisioned and nothing is written',async()=>{
 const f=fixture(),key=AccountStore.identityKey('unblock-nobody');
 await reject(f.store.unblockVideoBilling(key,{incidentId:randomUUID(),epoch:1,createdAtMs:1,reviewRef:'review-ref'}),'account_not_provisioned');
 assert.deepEqual(await signature(f),[]);
});

test('the status reader fails closed on an ACTIVE incident whose guard is absent and tolerates a reviewed one',async()=>{
 const f=fixture(),{key,accountId}=await owner(f,'unblock-status'),incident=randomUUID();
 await f.store.blockVideoBilling(key,incident);
 assert.deepEqual(await f.store.videoBillingHold(key,incident),{blocked:true,recorded:true});
 // An active incident can never exist without its guard: that is corruption and must not read as «open».
 await guardRef(f,accountId).delete();
 await reject(f.store.videoBillingHold(key,incident),'invariant');
});
