// LV-019.B phase 1 (plan step 1.6, first part): the drain-executor LEASE against a LOCAL Firestore emulator.
// It proves the parts only a real transaction engine can prove: eight simultaneous acquisitions yield exactly ONE
// winner, the fencing token grows strictly across acquire/release cycles, an expiry is decided by the injected clock,
// renew/release/cursor are conditional on the holder and token, a stale holder after an expiry can neither renew nor
// release nor write a cursor, the margin check holds, and a refused call writes nothing.
// Same style and cleanup as the other fixtures: loopback emulator, demo-* project, random root, bounded waits,
// recursive delete and db.terminate() in a finally so the shared emulator never keeps a leaked client.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {DRAIN_LEASE_COLLECTION,acquireDrainLease,renewDrainLease,releaseDrainLease,assertDrainLeaseHeld,getDrainCursor,setDrainCursor} from './billingDrainLease.ts';

const HOST='127.0.0.1:8185',PROJECT='demo-vistavo-ledger',NOW=9_000_000,DEFAULT_TTL=90_000;
const LEASE=[DRAIN_LEASE_COLLECTION,'current'],COUNTER=[DRAIN_LEASE_COLLECTION,'counter'],CURSORS=[DRAIN_LEASE_COLLECTION,'cursors'];
const LEASE_FIELDS=['acquiredAtMs','expiresAtMs','holderId','renewedAtMs','token'];

// The shared emulator can stall under contention with other fixtures; a bounded promise turns that into a fast, loud
// failure instead of a multi-minute hang, and the cleanup still runs so the client handle and process never leak.
const WORK_TIMEOUT_MS=120_000,CLEANUP_TIMEOUT_MS=30_000;
function bounded(promise,ms,label){
 let timer;
 const guard=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('emulator timeout: '+label)),ms);});
 promise.catch(()=>undefined);
 return Promise.race([promise,guard]).finally(()=>clearTimeout(timer));
}
async function fixture(work){
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST,'No native fallback');
 assert.notEqual(process.env.NODE_ENV,'production');
 const db=new Firestore({projectId:PROJECT}),root=db.collection('vistavo_b1_drain_lease_test').doc(randomUUID());
 try{await bounded(Promise.resolve().then(()=>work({db,root})),WORK_TIMEOUT_MS,'fixture work');}
 finally{
  try{await bounded(db.recursiveDelete(root),CLEANUP_TIMEOUT_MS,'cleanup delete');}catch{/* a stalled delete must not mask terminate */}
  finally{try{await db.terminate();}catch{/* the client is closed even if terminate reports an error */}}
 }
}
const read=(root,path)=>root.collection(path[0]).doc(path[1]).get();
const leaseOf=async root=>{const doc=await read(root,LEASE);return doc.exists?doc.data():null;};
const counterOf=async root=>{const doc=await read(root,COUNTER);return doc.exists?doc.data().token:null;};
const cursorDoc=async root=>{const doc=await read(root,CURSORS);return doc.exists?doc.data():null;};
const acquire=(db,root,holderId,now,ttlMs)=>acquireDrainLease({db,root,holderId,now,...(ttlMs===undefined?{}:{ttlMs})});
const renew=(db,root,holderId,token,now,ttlMs,maxTenureMs)=>renewDrainLease({db,root,holderId,token,now,...(ttlMs===undefined?{}:{ttlMs}),...(maxTenureMs===undefined?{}:{maxTenureMs})});
const release=(db,root,holderId,token)=>releaseDrainLease({db,root,holderId,token});
const held=(db,root,holderId,token,now,minRemainingMs)=>assertDrainLeaseHeld({db,root,holderId,token,now,...(minRemainingMs===undefined?{}:{minRemainingMs})});
const setCursor=(db,root,kind,holderId,token,cursor,now)=>setDrainCursor({db,root,kind,holderId,token,cursor,now});
/** Every collection under the private root, so a test can prove nothing outside the lease collection was touched. */
async function collections(root){return (await root.listCollections()).map(c=>c.id).sort();}

test('eight simultaneous acquisitions yield exactly one winner and one token',()=>fixture(async({db,root})=>{
 const attempts=Array.from({length:8},(_,index)=>acquire(db,root,'run-'+index,NOW));
 const results=await Promise.all(attempts);
 const winners=results.filter(r=>r.acquired),losers=results.filter(r=>!r.acquired);
 assert.equal(winners.length,1,'exactly one holder must win: '+JSON.stringify(results));
 assert.equal(losers.length,7,'the other seven must be told the lease is held');
 for(const loser of losers)assert.equal(loser.reason,'held');
 assert.equal(winners[0].token,1,'the first acquisition on a fresh root is token 1');
 const stored=await leaseOf(root);
 assert.deepEqual(Object.keys(stored).sort(),LEASE_FIELDS);
 assert.equal(stored.token,1);
 assert.equal(stored.expiresAtMs,NOW+DEFAULT_TTL);
 assert.match(stored.holderId,/^run-[0-7]$/,'the stored holder is one of the eight');
 assert.equal(await counterOf(root),1,'the counter holds exactly the winning token');
 assert.deepEqual(await collections(root),[DRAIN_LEASE_COLLECTION]);
}));

test('the token grows strictly across twenty acquire/release cycles and never repeats',()=>fixture(async({db,root})=>{
 const tokens=[];
 for(let cycle=0;cycle<20;cycle++){
  const got=await acquire(db,root,'cycle-holder',NOW+cycle*1000);
  assert.equal(got.acquired,true,'cycle '+cycle+' must acquire');
  tokens.push(got.token);
  assert.equal(await release(db,root,'cycle-holder',got.token),true,'cycle '+cycle+' must release its own lease');
  assert.equal(await leaseOf(root),null,'the lease is gone between cycles');
 }
 for(let i=1;i<tokens.length;i++)assert.ok(tokens[i]>tokens[i-1],'token must grow: '+tokens.join(','));
 assert.deepEqual(tokens,Array.from({length:20},(_,i)=>i+1));
 assert.equal(await counterOf(root),20);
}));

test('an expiry is decided by the injected clock, and the expired holder is fenced out',()=>fixture(async({db,root})=>{
 const first=await acquire(db,root,'old-holder',NOW,10_000);
 assert.deepEqual(first,{acquired:true,token:1,expiresAtMs:NOW+10_000});
 assert.deepEqual(await acquire(db,root,'early-holder',NOW+9_999,10_000),{acquired:false,reason:'held'},'still live one millisecond before');
 const takeover=await acquire(db,root,'new-holder',NOW+10_000,10_000);
 assert.deepEqual(takeover,{acquired:true,token:2,expiresAtMs:NOW+20_000},'takeable exactly at the expiry');
 const before=await leaseOf(root);
 assert.equal(await renew(db,root,'old-holder',1,NOW+10_000),false,'the old holder cannot renew');
 assert.equal(await release(db,root,'old-holder',1),false,'the old holder cannot release the new lease');
 assert.equal(await setCursor(db,root,'intents','old-holder',1,'old',NOW+10_000),false,'the old holder cannot write a cursor');
 assert.equal(await held(db,root,'old-holder',1,NOW+10_000),false,'the old holder no longer holds the lease');
 assert.deepEqual(await leaseOf(root),before,'the new lease is untouched by every stale call');
 assert.deepEqual(await cursorDoc(root),null,'no cursor was written');
 assert.equal(await renew(db,root,'new-holder',2,NOW+10_000),true,'the new holder can renew its own lease');
 assert.equal(await release(db,root,'new-holder',2),true,'the new holder can release its own lease');
}));

test('renew, release and the cursor are conditional on the holder and the token',()=>fixture(async({db,root})=>{
 const got=await acquire(db,root,'owner',NOW,30_000);
 assert.equal(await renew(db,root,'intruder',got.token,NOW+1),false,'another holder cannot renew');
 assert.equal(await renew(db,root,'owner',got.token+1,NOW+1),false,'another token cannot renew');
 assert.equal(await release(db,root,'intruder',got.token),false,'another holder cannot release');
 assert.equal(await release(db,root,'owner',got.token+1),false,'another token cannot release');
 assert.equal(await setCursor(db,root,'outbox','intruder',got.token,'x',NOW+1),false,'another holder cannot write a cursor');
 assert.equal(await setCursor(db,root,'outbox','owner',got.token+1,'x',NOW+1),false,'another token cannot write a cursor');
 assert.deepEqual(await leaseOf(root),{holderId:'owner',token:got.token,expiresAtMs:NOW+30_000,acquiredAtMs:NOW,renewedAtMs:NOW},'refused calls write nothing');
 assert.deepEqual(await cursorDoc(root),null,'no cursor was written by a refused call');
 assert.equal(await renew(db,root,'owner',got.token,NOW+5_000),true,'the owner renews with its own token');
 assert.deepEqual(await leaseOf(root),{holderId:'owner',token:got.token,expiresAtMs:NOW+5_000+DEFAULT_TTL,acquiredAtMs:NOW,renewedAtMs:NOW+5_000},'renew restarts the ttl from now');
 assert.equal(await setCursor(db,root,'outbox','owner',got.token,'outbox-9',NOW+5_000),true,'the owner writes a cursor');
 assert.equal(await getDrainCursor({db,root,kind:'outbox'}),'outbox-9');
 assert.equal(await getDrainCursor({db,root,kind:'intents'}),null,'the other kinds stay untouched');
 assert.equal(await release(db,root,'owner',got.token),true,'the owner releases');
 assert.equal(await leaseOf(root),null);
}));

test('the margin check refuses a lease that is too close to its expiry',()=>fixture(async({db,root})=>{
 const got=await acquire(db,root,'owner',NOW,30_000);
 assert.equal(await held(db,root,'owner',got.token,NOW,15_000),true,'a fresh 30 s lease has margin');
 assert.equal(await held(db,root,'owner',got.token,NOW+15_000,15_000),true,'exactly the margin is enough');
 assert.equal(await held(db,root,'owner',got.token,NOW+15_001,15_000),false,'one millisecond less than the margin is not');
 assert.equal(await held(db,root,'owner',got.token,NOW+30_000,0),false,'at the expiry there is no margin at all');
 assert.equal(await held(db,root,'intruder',got.token,NOW),false,'another holder never holds');
 assert.equal(await held(db,root,'owner',got.token+1,NOW),false,'another token never holds');
 assert.deepEqual(await leaseOf(root),{holderId:'owner',token:got.token,expiresAtMs:NOW+30_000,acquiredAtMs:NOW,renewedAtMs:NOW},'the margin check writes nothing');
}));

test('the rotation cursor is per kind, conditional on the lease and survives a change of holder',()=>fixture(async({db,root})=>{
 assert.equal(await getDrainCursor({db,root,kind:'intents'}),null,'a fresh root has no cursor');
 const first=await acquire(db,root,'first',NOW,10_000);
 assert.equal(await setCursor(db,root,'intents','first',first.token,'intent-3',NOW),true);
 assert.equal(await setCursor(db,root,'holds','first',first.token,'hold-1',NOW),true);
 // LV-019.B step 1.2 adds the `unknown` rotation cursor alongside the three drain kinds.
 assert.equal(await setCursor(db,root,'unknown','first',first.token,'unknown-1',NOW),true);
 assert.deepEqual(await cursorDoc(root),{intents:'intent-3',holds:'hold-1',unknown:'unknown-1'},'each kind keeps its own cursor');
 const second=await acquire(db,root,'second',NOW+10_000,10_000);
 assert.equal(await setCursor(db,root,'intents','second',second.token,null,NOW+10_000),true,'the new holder clears one kind');
 assert.equal(await getDrainCursor({db,root,kind:'intents'}),null);
 assert.equal(await getDrainCursor({db,root,kind:'holds'}),'hold-1','the other kind is preserved');
 assert.deepEqual(await collections(root),[DRAIN_LEASE_COLLECTION]);
}));

test('a renewal under a clock that steps back keeps the expiry and the lease readable',()=>fixture(async({db,root})=>{
 const got=await acquire(db,root,'owner',NOW,30_000);
 assert.equal(await renew(db,root,'owner',got.token,NOW+1_000),true);
 const renewed=await leaseOf(root);
 assert.equal(renewed.renewedAtMs,NOW+1_000);
 // The clock steps back 5 s: the document must not move backwards and must stay readable.
 assert.equal(await renew(db,root,'owner',got.token,NOW-4_000),true);
 assert.deepEqual(await leaseOf(root),{holderId:'owner',token:got.token,expiresAtMs:NOW+1_000+90_000,acquiredAtMs:NOW,renewedAtMs:NOW+1_000},'nothing moved backwards');
 assert.equal(await held(db,root,'owner',got.token,NOW),true,'the holder still holds its own lease');
 assert.equal(await renew(db,root,'owner',got.token,NOW+2_000),true,'and can still renew it');
 // A renewal with a SHORTER ttl must never shorten the stored expiry: only the renewal time moves forward.
 assert.equal(await renew(db,root,'owner',got.token,NOW+2_000,5_000),true);
 assert.deepEqual(await leaseOf(root),{holderId:'owner',token:got.token,expiresAtMs:NOW+2_000+90_000,acquiredAtMs:NOW,renewedAtMs:NOW+2_000},'a shorter ttl never shrinks the expiry');
}));

test('the maximum tenure ends the lease cleanly, refusing the renewal at the boundary',()=>fixture(async({db,root})=>{
 const got=await acquire(db,root,'owner',NOW,600_000);
 const before=await leaseOf(root);
 assert.equal(await renew(db,root,'owner',got.token,NOW+120_000,600_000,120_000),false,'at exactly the tenure the renewal is refused');
 assert.deepEqual(await leaseOf(root),before,'a refused renewal writes nothing');
 assert.equal(await renew(db,root,'owner',got.token,NOW+119_999,600_000,120_000),true,'one millisecond short is accepted');
}));

test('a stored expiry window beyond the maximum ttl is not trusted',()=>fixture(async({db,root})=>{
 // The stored WINDOW (expiresAtMs - renewedAtMs) exceeds MAX while the expiry is only 500 s ahead of now: only the
 // window bound in readLease can reject this document, so this isolates it from the forward-window bound in isHeld.
 await root.collection(DRAIN_LEASE_COLLECTION).doc('current').set({holderId:'ghost',token:9,expiresAtMs:NOW+500_001,acquiredAtMs:NOW-100_000,renewedAtMs:NOW-100_000});
 const taken=await acquire(db,root,'fresh',NOW);
 assert.equal(taken.acquired,true,'an oversized window is takeable');
 assert.equal(taken.token,10,'the token still fences above the stored one');
 // A well formed lease whose expiry is more than MAX ahead of this caller clock is likewise not trusted.
 await root.collection(DRAIN_LEASE_COLLECTION).doc('current').set({holderId:'ghost',token:10,expiresAtMs:NOW+600_000,acquiredAtMs:NOW,renewedAtMs:NOW});
 assert.equal(await held(db,root,'ghost',10,NOW-1),false,'an expiry more than MAX ahead of now is not live');
 assert.equal(await renew(db,root,'ghost',10,NOW-1),false);
 assert.equal(await release(db,root,'ghost',10),true,'but the ghost can still release its own document');
}));

test('the rotation cursor refuses a Firestore reserved id',()=>fixture(async({db,root})=>{
 const got=await acquire(db,root,'owner',NOW,30_000);
 for(const reserved of ['__name__','__id__','__x__'])await assert.rejects(()=>setCursor(db,root,'intents','owner',got.token,reserved,NOW),/invalid cursor id/,'reserved id '+reserved+' must be refused');
 assert.equal(await setCursor(db,root,'intents','owner',got.token,'__',NOW),true,'a bare __ is not the reserved form');
 assert.equal(await getDrainCursor({db,root,kind:'intents'}),'__');
}));
