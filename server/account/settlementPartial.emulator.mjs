import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {createServer} from 'node:http';
import {AccountStore} from './backend.ts';
import {accountHttp} from './http.ts';
import {AccountBillingClient} from '../commercial/accountBillingClient.ts';
// LV-019.B C2a (docs/specs/LV-019-B-liquidacion-parcial-y-liberacion-posadmision.md): partial capture and release after admission, Account side.
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185')throw Error('Dedicated loopback emulator required, no fallback');
const fixtures=[];
before(async()=>{assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const f of fixtures.splice(0)){await f.db.recursiveDelete(f.root);await f.db.terminate();await deleteApp(f.app);}});
function fixture(){const app=initializeApp({projectId:'demo-vistavo-ledger'},'partial-'+randomUUID()),db=getFirestore(app),root=db.collection('vistavo_account_test').doc(randomUUID()),f={app,db,root,time:1_800_000_000_000};f.store=new AccountStore(db,root,()=>f.time);fixtures.push(f);return f;}
const reject=(p,code)=>assert.rejects(p,e=>e.code===code,'expected '+code);
const hex=c=>c.repeat(64);
const MIN_AGE_MS=15*60_000;
async function reserved(f,uid,N=60,{admit=true,credited=90}={}){
 const boot=await f.store.bootstrap(uid),key=AccountStore.identityKey(uid),rid=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()};
 await f.root.collection('accounts').doc(boot.account.id).update({credited,available:credited});
 await f.store.reserveVideo(key,rid,N);
 if(admit)await f.store.admitVideoCall(key,rid,N,a.jobId,a.attemptId,'text-window:0000','gemini-3.8-flash',hex('a'));
 return {key,rid,a,uid,N,credited,account:boot.account.id};
}
const balance=async(f,uid)=>(await f.store.me(uid)).balance;
const reservationDoc=async f=>{const s=await f.root.collection('videoReservations').get();assert.equal(s.size,1);return s.docs[0].data();};
const ledger=async f=>(await f.root.collection('ledgerEntries').get()).docs.map(d=>d.data()).sort((x,y)=>x.kind.localeCompare(y.kind));
const untouched=async(f,r)=>assert.deepEqual(await balance(f,r.uid),{unit:'video_seconds',credited:r.credited,available:r.credited-r.N,reserved:r.N,consumed:0,active:1},'balance unchanged while still reserved');
const resolution=(kind='no_speech',evidenceSha256=hex('b'))=>({kind,evidenceSha256});

test('partial capture moves exactly K seconds to consumed and returns the remainder in one transaction with two ledger entries',async()=>{
 const f=fixture(),r=await reserved(f,'pc-happy',60);
 const result=await f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:25});
 assert.equal(result.settled,true);assert.equal(result.state,'captured');assert.equal(result.capturedSeconds,25);assert.equal(result.releasedSeconds,35);
 assert.deepEqual(await balance(f,r.uid),{unit:'video_seconds',credited:90,available:65,reserved:0,consumed:25,active:0});
 const doc=await reservationDoc(f);assert.equal(doc.state,'captured');assert.equal(doc.capturedSeconds,25);assert.equal(doc.releasedSeconds,35);assert.equal(doc.partialSettlement,true,'marker used by the read-only reconciliation counts');
 const rows=await ledger(f);assert.deepEqual(rows.map(x=>[x.kind,x.seconds]),[['video_capture',25],['video_release_remainder',35],['video_reserve',60]]);
 assert.equal(rows.filter(x=>x.kind!=='video_reserve').reduce((n,x)=>n+x.seconds,0),60,'capture + remainder = N');
});
test('capturedSeconds must satisfy 1 <= K < N: zero, N, above N, negative, fractional, textual and non-finite values fail closed without changes',async()=>{
 const f=fixture(),r=await reserved(f,'pc-invalid',60);
 for(const value of [0,60,61,-1,1.5,'5',NaN,Infinity,Number.MAX_SAFE_INTEGER+1,null])await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:value}),'invalid');
 await untouched(f,r);assert.equal((await reservationDoc(f)).state,'reserved');assert.equal((await ledger(f)).length,1);
});
test('capturedSeconds on a release, unknown option keys and a resolution on a capture are rejected',async()=>{
 const f=fixture(),r=await reserved(f,'pc-shape',60);
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,undefined,{capturedSeconds:10}),'invalid');
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:10,extra:1}),'invalid');
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{resolution:resolution()}),'invalid');
 await untouched(f,r);
});
test('partial capture needs the same admission as a full capture',async()=>{
 const f=fixture(),r=await reserved(f,'pc-admission',60),other=await reserved(f,'pc-unadmitted',60,{admit:false});
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,undefined,{capturedSeconds:10}),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,{...r.a,attemptId:randomUUID()},{capturedSeconds:10}),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,{...r.a,jobId:randomUUID()},{capturedSeconds:10}),'conflict');
 await reject(f.store.settleVideo(other.key,other.rid,'capture',60,{jobId:randomUUID(),attemptId:randomUUID()},{capturedSeconds:10}),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'capture',59,r.a,{capturedSeconds:10}),'conflict');
 assert.equal((await balance(f,r.uid)).consumed,0);
});
test('replaying the same partial capture is a no-op without writes; another K, a full capture or any release is a conflict',async()=>{
 const f=fixture(),r=await reserved(f,'pc-replay',60);
 await f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:25});
 const before=JSON.stringify([await balance(f,r.uid),await reservationDoc(f),await ledger(f)]);
 const again=await f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:25});assert.equal(again.settled,false);assert.equal(again.capturedSeconds,25);assert.equal(again.releasedSeconds,35);
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:26}),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'release',60),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution()}),'conflict');
 assert.equal(JSON.stringify([await balance(f,r.uid),await reservationDoc(f),await ledger(f)]),before);
});
test('a full capture is not replayed as a partial one',async()=>{
 const f=fixture(),r=await reserved(f,'pc-full-then-partial',60);
 assert.equal((await f.store.settleVideo(r.key,r.rid,'capture',60,r.a)).settled,true);
 assert.equal((await f.store.settleVideo(r.key,r.rid,'capture',60,r.a)).settled,false);
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:10}),'conflict');
 assert.deepEqual(await balance(f,r.uid),{unit:'video_seconds',credited:90,available:30,reserved:0,consumed:60,active:0});
});
test('release after admission returns all seconds, frees the slot and stores admission and resolution',async()=>{
 const f=fixture(),r=await reserved(f,'ra-happy',60);
 const result=await f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution('no_speech')});
 assert.equal(result.settled,true);assert.equal(result.state,'released');assert.equal(result.admitted,true);
 assert.deepEqual(await balance(f,r.uid),{unit:'video_seconds',credited:90,available:90,reserved:0,consumed:0,active:0});
 const doc=await reservationDoc(f);assert.equal(doc.state,'released');assert.deepEqual(doc.releaseAdmission,r.a);assert.deepEqual(doc.resolution,resolution('no_speech'));
 assert.deepEqual((await ledger(f)).map(x=>[x.kind,x.seconds]),[['video_release',60],['video_reserve',60]]);
});
test('release after admission fails closed without a matching admission and a valid resolution',async()=>{
 const f=fixture(),r=await reserved(f,'ra-negatives',60);
 await reject(f.store.settleVideo(r.key,r.rid,'release',60),'conflict'); // stored admission, nothing supplied: still closed
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,r.a),'invalid'); // admission without resolution
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,undefined,{resolution:resolution()}),'invalid'); // resolution without admission
 for(const bad of [resolution('other'),resolution('no_speech','A'.repeat(64)),resolution('no_speech','b'.repeat(63)),resolution('no_speech',''),{kind:'no_speech'},{evidenceSha256:hex('b')},{...resolution(),extra:1},null,[]])await reject(f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:bad}),'invalid');
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,{...r.a,attemptId:randomUUID()},{resolution:resolution()}),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,{...r.a,jobId:randomUUID()},{resolution:resolution()}),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'release',59,r.a,{resolution:resolution()}),'conflict');
 await untouched(f,r);assert.equal((await reservationDoc(f)).state,'reserved');
});
test('replaying a release after admission is a no-op; another resolution, kind or admission is a conflict; a capture afterwards is a conflict',async()=>{
 const f=fixture(),r=await reserved(f,'ra-replay',60);
 await f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution('not_delivered',hex('c'))});
 const before=JSON.stringify([await balance(f,r.uid),await reservationDoc(f),await ledger(f)]);
 const again=await f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution('not_delivered',hex('c'))});assert.equal(again.settled,false);assert.equal(again.admitted,true);
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution('no_speech',hex('c'))}),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution('not_delivered',hex('d'))}),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,{...r.a,attemptId:randomUUID()},{resolution:resolution('not_delivered',hex('c'))}),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'release',60),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:5}),'conflict');
 assert.equal(JSON.stringify([await balance(f,r.uid),await reservationDoc(f),await ledger(f)]),before);
});
test('after a release following admission a new call is refused and an exact replay of the admitted call stays a receipt only',async()=>{
 const f=fixture(),r=await reserved(f,'ra-late-admit',60);
 await f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution()});
 await reject(f.store.admitVideoCall(r.key,r.rid,60,r.a.jobId,r.a.attemptId,'text-window:0001','gemini-3.8-flash',hex('e')),'conflict');
 const replay=await f.store.admitVideoCall(r.key,r.rid,60,r.a.jobId,r.a.attemptId,'text-window:0000','gemini-3.8-flash',hex('a'));
 assert.equal(replay.receiptOnly,true);assert.equal(replay.created,false);
 assert.equal((await reservationDoc(f)).state,'released');
});
test('releasing with a supplied admission when Account has none is the plain release and reports admitted:false, also on replay',async()=>{
 const f=fixture(),r=await reserved(f,'ra-none-stored',60,{admit:false});
 const claim={jobId:randomUUID(),attemptId:randomUUID()};
 const result=await f.store.settleVideo(r.key,r.rid,'release',60,claim,{resolution:resolution('not_delivered')});
 assert.equal(result.settled,true);assert.equal(result.admitted,false);
 const doc=await reservationDoc(f);assert.equal(doc.state,'released');assert.equal(doc.releaseAdmission,undefined);
 assert.deepEqual(await balance(f,r.uid),{unit:'video_seconds',credited:90,available:90,reserved:0,consumed:0,active:0});
 const again=await f.store.settleVideo(r.key,r.rid,'release',60,claim,{resolution:resolution('not_delivered')});assert.equal(again.settled,false);assert.equal(again.admitted,false);
 assert.equal((await f.store.settleVideo(r.key,r.rid,'release',60)).settled,false,'the plain release replay of today stays valid');
});
test('a plain release without admission works exactly as before',async()=>{
 const f=fixture(),r=await reserved(f,'ra-plain',30,{admit:false});
 const result=await f.store.settleVideo(r.key,r.rid,'release',30);assert.equal(result.settled,true);assert.equal(result.admitted,false);
 assert.deepEqual(await balance(f,r.uid),{unit:'video_seconds',credited:90,available:90,reserved:0,consumed:0,active:0});
});
test('unknown_expired needs a minimum age since the admission; too_early changes nothing and does not poison a later release',async()=>{
 const f=fixture(),r=await reserved(f,'ra-too-early',60);
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution('unknown_expired')}),'too_early');
 f.time+=MIN_AGE_MS-1;await reject(f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution('unknown_expired')}),'too_early');
 await untouched(f,r);assert.equal((await reservationDoc(f)).state,'reserved');
 // the other kinds are not age-gated
 const ok=await f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution('not_delivered')});assert.equal(ok.settled,true);
 const g=fixture(),s=await reserved(g,'ra-old-enough',60);g.time+=MIN_AGE_MS;
 assert.equal((await g.store.settleVideo(s.key,s.rid,'release',60,s.a,{resolution:resolution('unknown_expired')})).settled,true);
 assert.deepEqual((await reservationDoc(g)).resolution,resolution('unknown_expired'));
});
test('a billing hold blocks both new settlements and legacy reservations stay closed',async()=>{
 const f=fixture(),p=await reserved(f,'hold-partial',60),q=await reserved(f,'hold-release',60);
 await f.store.blockVideoBilling(p.key,randomUUID());await f.store.blockVideoBilling(q.key,randomUUID());
 await reject(f.store.settleVideo(p.key,p.rid,'capture',60,p.a,{capturedSeconds:10}),'conflict');
 await reject(f.store.settleVideo(q.key,q.rid,'release',60,q.a,{resolution:resolution()}),'conflict');
 assert.equal((await balance(f,p.uid)).consumed,0);
 const g=fixture(),legacy=await reserved(g,'legacy',60);
 await g.root.collection('videoReservations').get().then(s=>s.docs[0].ref.update({admissionProtocol:1}));
 await reject(g.store.settleVideo(legacy.key,legacy.rid,'capture',60,legacy.a,{capturedSeconds:10}),'conflict');
 await reject(g.store.settleVideo(legacy.key,legacy.rid,'release',60,legacy.a,{resolution:resolution()}),'conflict');
 await untouched(g,legacy);
});
test('another account cannot settle the reservation and the identity is checked',async()=>{
 const f=fixture(),r=await reserved(f,'owner',60),other=await reserved(f,'intruder',10,{admit:false});
 await reject(f.store.settleVideo(other.key,r.rid,'capture',60,r.a,{capturedSeconds:10}),'not_found');
 await reject(f.store.settleVideo(other.key,r.rid,'release',60,r.a,{resolution:resolution()}),'not_found');
 await untouched(f,r);
});
test('a partial capture racing a release after admission leaves exactly one terminal state and a consistent balance',async()=>{
 for(let round=0;round<4;round++){
  const f=fixture(),r=await reserved(f,'race-'+round,60);
  const results=await Promise.allSettled([f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:10+round}),f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution()}),f.store.settleVideo(r.key,r.rid,'capture',60,r.a)]);
  assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value.settled===true).length,1,'one winner');
  assert.ok(results.filter(x=>x.status==='rejected').every(x=>x.reason.code==='conflict'));
  const b=await balance(f,r.uid),doc=await reservationDoc(f);
  assert.equal(b.credited,b.available+b.reserved+b.consumed);assert.equal(b.reserved,0);assert.equal(b.active,0);
  const entries=await ledger(f),sum=entries.filter(x=>x.kind!=='video_reserve').reduce((n,x)=>n+x.seconds,0);assert.equal(sum,60);
  assert.equal(b.consumed,entries.filter(x=>x.kind==='video_capture').reduce((n,x)=>n+x.seconds,0));
  assert.ok(['captured','released'].includes(doc.state));
 }
});
test('five concurrent identical partial captures settle once',async()=>{
 const f=fixture(),r=await reserved(f,'pc-concurrent',60);
 const results=await Promise.all(Array.from({length:5},()=>f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:20})));
 assert.equal(results.filter(x=>x.settled).length,1);assert.ok(results.every(x=>x.capturedSeconds===20&&x.releasedSeconds===40));
 assert.deepEqual(await balance(f,r.uid),{unit:'video_seconds',credited:90,available:70,reserved:0,consumed:20,active:0});assert.equal((await ledger(f)).length,3);
});
test('a corrupt partial settlement record is reported as an invariant failure, not repaired silently',async()=>{
 const f=fixture(),r=await reserved(f,'pc-corrupt',60);
 await f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:25});
 const ref=(await f.root.collection('videoReservations').get()).docs[0].ref;
 await ref.update({releasedSeconds:34});
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:25}),'invariant');
 await ref.update({releasedSeconds:35,partialSettlement:false});
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:25}),'invariant');
 await ref.update({partialSettlement:true});
 assert.equal((await f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:25})).settled,false);
 // a full capture and a release never carry the partial marker; if one shows up, both replays refuse it
 const g=fixture(),full=await reserved(g,'pc-marker-on-full',60);await g.store.settleVideo(full.key,full.rid,'capture',60,full.a);
 await (await g.root.collection('videoReservations').get()).docs[0].ref.update({partialSettlement:true});
 await reject(g.store.settleVideo(full.key,full.rid,'capture',60,full.a),'invariant');
});
test('released with a provider admission but without releaseAdmission is still corruption',async()=>{
 const f=fixture(),r=await reserved(f,'ra-corrupt',60);
 await f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution()});
 const ref=(await f.root.collection('videoReservations').get()).docs[0].ref;
 await ref.update({releaseAdmission:null});
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution()}),'invariant');
});
test('Video client -> Account HTTP -> store over loopback: partial capture, release after admission and the distinct too_early refusal',async()=>{
 const f=fixture(),p=await reserved(f,'chain-partial',60),q=await reserved(f,'chain-release',60),worker='worker@example.invalid',reader='reader@example.invalid';
 const handler=accountHttp(f.store,{verifyIdToken:async()=>{throw Error('no browser access');}},'https://vistavo.app',{audience:'https://account.invalid',allowedEmails:[worker,reader],reservationCaller:reader,settlementCaller:worker,verifier:{verifyIdToken:async token=>({email:token==='worker'?worker:reader,email_verified:true})}});
 const server=createServer((req,res)=>void handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address!=='string');
 try{
  const client=new AccountBillingClient(undefined,{request:async({url,data})=>{
   const r=await fetch('http://127.0.0.1:'+address.port+new URL(url).pathname,{method:'POST',headers:{Authorization:'Bearer worker','Content-Type':'application/json'},body:JSON.stringify(data)});
   if(!r.ok)throw Object.assign(Error('synthetic response'),{response:{status:r.status,data:await r.json().catch(()=>({}))}});return {data:await r.json()};
  }});
  const partial=await client.settle(p.key,p.rid,'capture',60,p.a,{capturedSeconds:25});assert.equal(partial.state,'captured');assert.equal(partial.seconds,60);
  assert.deepEqual(await balance(f,p.uid),{unit:'video_seconds',credited:90,available:65,reserved:0,consumed:25,active:0});
  await reject(client.settle(q.key,q.rid,'release',60,q.a,{resolution:{kind:'unknown_expired',evidenceSha256:hex('d')}}),'too_early');
  await untouched(f,q);
  const released=await client.settle(q.key,q.rid,'release',60,q.a,{resolution:{kind:'no_speech',evidenceSha256:hex('d')}});assert.equal(released.state,'released');
  assert.deepEqual(await balance(f,q.uid),{unit:'video_seconds',credited:90,available:90,reserved:0,consumed:0,active:0});
  await reject(client.settle(q.key,q.rid,'release',60,q.a,{resolution:{kind:'not_delivered',evidenceSha256:hex('d')}}),'conflict');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('without a stored admission a repeated claim must repeat the stored resolution; a claim after a plain release is a conflict',async()=>{
 const f=fixture(),r=await reserved(f,'claim-replay',60,{admit:false}),claim={jobId:randomUUID(),attemptId:randomUUID()};
 await f.store.settleVideo(r.key,r.rid,'release',60,claim,{resolution:resolution('not_delivered',hex('c'))});
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,claim,{resolution:resolution('not_delivered',hex('d'))}),'conflict');
 await reject(f.store.settleVideo(r.key,r.rid,'release',60,claim,{resolution:resolution('no_speech',hex('c'))}),'conflict');
 const g=fixture(),p=await reserved(g,'plain-then-claim',60,{admit:false});
 await g.store.settleVideo(p.key,p.rid,'release',60);
 await reject(g.store.settleVideo(p.key,p.rid,'release',60,claim,{resolution:resolution('not_delivered')}),'conflict');
 assert.equal((await g.store.settleVideo(p.key,p.rid,'release',60)).settled,false);
});
test('a released reservation whose releaseAdmission no longer matches its admission is an invariant failure for admission replays too',async()=>{
 const f=fixture(),r=await reserved(f,'admit-corrupt',60);
 await f.store.settleVideo(r.key,r.rid,'release',60,r.a,{resolution:resolution()});
 await (await f.root.collection('videoReservations').get()).docs[0].ref.update({releaseAdmission:{jobId:randomUUID(),attemptId:randomUUID()}});
 await reject(f.store.admitVideoCall(r.key,r.rid,60,r.a.jobId,r.a.attemptId,'text-window:0000','gemini-3.8-flash',hex('a')),'invariant');
});
test('settlement options must be plain objects: inherited properties and class instances are refused, a null-prototype object is accepted',async()=>{
 const f=fixture(),r=await reserved(f,'options-shape',60);
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,Object.create({capturedSeconds:25})),'invalid');
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,new (class Options{capturedSeconds=25;})()),'invalid');
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,[]),'invalid');
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,null),'invalid');
 await untouched(f,r);
 const plain=Object.assign(Object.create(null),{capturedSeconds:25});
 assert.equal((await f.store.settleVideo(r.key,r.rid,'capture',60,r.a,plain)).settled,true);
});
test('a captured reservation whose capture links are corrupt is an invariant failure, not a conflict (C2a hardening)',async()=>{
 const f=fixture(),r=await reserved(f,'capture-links',60);
 await f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:25});
 const ref=(await f.root.collection('videoReservations').get()).docs[0].ref;
 await ref.update({captureAdmission:{jobId:randomUUID(),attemptId:randomUUID()}});
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:25}),'invariant');
 await ref.update({captureAdmission:r.a,releaseAdmission:r.a});
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:25}),'invariant');
 await ref.update({releaseAdmission:FieldValue.delete(),resolution:resolution()});
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:25}),'invariant');
 await ref.update({resolution:FieldValue.delete()});
 assert.equal((await f.store.settleVideo(r.key,r.rid,'capture',60,r.a,{capturedSeconds:25})).settled,false);
 const g=fixture(),full=await reserved(g,'capture-links-full',60);await g.store.settleVideo(full.key,full.rid,'capture',60,full.a);
 await (await g.root.collection('videoReservations').get()).docs[0].ref.update({captureAdmission:FieldValue.delete()});
 await reject(g.store.settleVideo(full.key,full.rid,'capture',60,full.a),'invariant');
});
test('settlement options with accessor properties are refused',async()=>{
 const f=fixture(),r=await reserved(f,'options-accessor',60);
 const sneaky={};Object.defineProperty(sneaky,'capturedSeconds',{enumerable:true,get:()=>25});
 await reject(f.store.settleVideo(r.key,r.rid,'capture',60,r.a,sneaky),'invalid');
 await untouched(f,r);
});
