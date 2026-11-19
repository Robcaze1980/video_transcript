import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {AccountStore} from './backend.ts';
import {accountHttp} from './http.ts';
import {AccountBillingClient} from '../commercial/accountBillingClient.ts';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185')throw Error('Dedicated loopback emulator required, no fallback');
const fixtures=[];
before(async()=>{assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const f of fixtures.splice(0)){await f.db.recursiveDelete(f.root);await f.db.terminate();await deleteApp(f.app);}});
function fixture(){const app=initializeApp({projectId:'demo-vistavo-ledger'},'account-test-'+randomUUID()),db=getFirestore(app),root=db.collection('vistavo_account_test').doc(randomUUID()),store=new AccountStore(db,root),f={app,db,root,store};fixtures.push(f);return f;}
const reject=(p,code)=>assert.rejects(p,e=>e.code===code);
const create=(s,uid,title='Project',content='hello',kind='text',key=randomUUID())=>s.create(uid,key,title,kind,content);
const callDefaults={callKey:'text-window:0000',model:'gemini-3.8-flash',requestSha256:'a'.repeat(64)};
const admitCall=(s,identityKey,reservationId,seconds,jobId,attemptId,callKey=callDefaults.callKey,model=callDefaults.model,requestSha256=callDefaults.requestSha256)=>s.admitVideoCall(identityKey,reservationId,seconds,jobId,attemptId,callKey,model,requestSha256);
test('video settlement never moves a different number of seconds than authorized',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('video-duration-owner'),identityKey=AccountStore.identityKey('video-duration-owner'),reservationId=randomUUID();
 await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});await f.store.reserveVideo(identityKey,reservationId,3);
 await reject(f.store.settleVideo(identityKey,reservationId,'capture',2),'conflict');
 await reject(f.store.settleVideo(identityKey,reservationId,'capture',3),'conflict');
 assert.deepEqual((await f.store.me('video-duration-owner')).balance,{unit:'video_seconds',credited:10,available:7,reserved:3,consumed:0,active:1});
 assert.equal((await f.store.videoReservation(identityKey,reservationId)).state,'reserved');
});
test('GET does not provision; explicit concurrent bootstrap maps UID once with real zero and no ledger',async()=>{
 const f=fixture();await reject(f.store.me('A'),'account_not_provisioned');assert.equal((await f.root.collection('identities').get()).size,0);
 const results=await Promise.all(Array.from({length:8},()=>f.store.bootstrap('A')));assert.equal(new Set(results.map(r=>r.account.id)).size,1);assert.equal(results.filter(r=>r.created).length,1);assert.equal((await f.root.collection('accounts').get()).size,1);
 assert.deepEqual((await f.store.me('A')).balance,{unit:'video_seconds',credited:0,available:0,reserved:0,consumed:0,active:0});assert.deepEqual(await f.store.ledger('A'),{items:[],nextCursor:null});
 const b=await f.store.bootstrap('B');assert.notEqual(b.account.id,results[0].account.id);assert.equal((await f.root.collection('ledgerEntries').get()).size,0);
});
test('real create/reopen/save supports Unicode and literal hostile content without normalizing it',async()=>{
 const f=fixture();await f.store.bootstrap('A');const content='1\n00:00:00,000 --> 00:00:01,000\n<img src=x onerror=alert(1)> 日本語 العربية 😀\n';
 const p=await create(f.store,'A','Video 😀',content,'srt');assert.equal((await f.store.read('A',p.project.id)).project.content,content);
 const next=await f.store.save('A',p.project.id,1,'Otro','edited');assert.equal(next.project.revision,2);assert.equal((await f.store.read('A',p.project.id)).project.content,'edited');assert.equal((await f.store.me('A')).balance.credited,0);
});
test('replayed create after lost acknowledgement produces one project, differing payload conflicts',async()=>{
 const f=fixture();await f.store.bootstrap('A');const key=randomUUID();const committed=await create(f.store,'A','one','body','text',key); // response intentionally lost by caller
 const repeated=await create(f.store,'A','one','body','text',key);assert.equal(repeated.created,false);assert.equal(repeated.project.id,committed.project.id);
 await reject(create(f.store,'A','two','body','text',key),'conflict');assert.equal((await f.root.collection('projects').get()).size,1);
});
test('same key concurrent requests settle as one; delete removes active content and cannot resurrect',async()=>{
 const f=fixture();await f.store.bootstrap('A');const key=randomUUID(),values=await Promise.all(Array.from({length:6},()=>create(f.store,'A','one','private','text',key)));assert.equal(new Set(values.map(v=>v.project.id)).size,1);
 const pid=values[0].project.id;await f.store.remove('A',pid,1);await reject(create(f.store,'A','one','private','text',key),'deleted');await reject(f.store.read('A',pid),'not_found');assert.deepEqual((await f.store.list('A')).items,[]);
 const tomb=(await f.root.collection('projects').doc(pid).get()).data();assert.equal(tomb.content,undefined);assert.equal(tomb.title,undefined);assert.equal((await f.root.collection('accounts').doc((await f.store.me('A')).id).get()).get('activeProjectCount'),0);
});
test('foreign GET/PUT/DELETE remain404 and cannot alter revision/counter/balance',async()=>{
 const f=fixture();await f.store.bootstrap('A');await f.store.bootstrap('B');const p=await create(f.store,'A');await reject(f.store.read('B',p.project.id),'not_found');await reject(f.store.save('B',p.project.id,1,'hack','hack'),'not_found');await reject(f.store.remove('B',p.project.id,1),'not_found');assert.equal((await f.store.read('A',p.project.id)).project.revision,1);assert.equal((await f.store.list('B')).items.length,0);
});
test('competing saves and stale delete preserve the winning draft',async()=>{
 const f=fixture();await f.store.bootstrap('A');const p=await create(f.store,'A'),values=await Promise.allSettled([f.store.save('A',p.project.id,1,'a','first'),f.store.save('A',p.project.id,1,'b','second')]);assert.equal(values.filter(v=>v.status==='fulfilled').length,1);assert.equal(values.find(v=>v.status==='rejected').reason.code,'conflict');await reject(f.store.remove('A',p.project.id,1),'conflict');const saved=(await f.store.read('A',p.project.id)).project;assert.equal(saved.revision,2);assert(['first','second'].includes(saved.content));
});
test('pagination uses immutable order, excludes content, disallows foreign and forged cursors',async()=>{
 const f=fixture();await f.store.bootstrap('A');await f.store.bootstrap('B');for(let i=0;i<5;i++)await create(f.store,'A','p'+i,'private'+i);await create(f.store,'B');
 const first=await f.store.list('A','2'),second=await f.store.list('A','2',first.nextCursor),third=await f.store.list('A','2',second.nextCursor);assert.equal(new Set([...first.items,...second.items,...third.items].map(v=>v.id)).size,5);assert.equal(third.nextCursor,null);assert.equal(first.items[0].content,undefined);
 await reject(f.store.list('B','2',first.nextCursor),'invalid');for(const value of ['not_base64!','e30','a'.repeat(513)])await reject(f.store.list('A','2',value),'invalid');for(const n of ['0','51','NaN','1.5'])await reject(f.store.list('A',n),'invalid');
 const edited=first.items[0];await f.store.save('A',edited.id,edited.revision,'changed','changed');assert.deepEqual((await f.store.list('A','2')).items.map(v=>v.id),first.items.map(v=>v.id));
});
test('max content is bytes, invalid Unicode/titles/shape rejected before project writes',async()=>{
 const f=fixture();await f.store.bootstrap('A');const p=await create(f.store,'A','max','a'.repeat(65536));assert.equal(p.project.content.length,65536);
 for(const title of ['', 'x'.repeat(121),'a\nb','a\u202eb','\ud800'])await reject(create(f.store,'A',title),'invalid');for(const content of ['あ'.repeat(22000),'\ud800'])await reject(create(f.store,'A','bad',content),'invalid');await reject(create(f.store,'A','bad','x','evil'),'invalid');await reject(create(f.store,'A','bad','x','text','no-key'),'invalid');assert.equal((await f.store.list('A')).items.length,1);
});
test('concurrent project quota is atomic, duplicate requests still return existing when full',async()=>{
 const f=fixture(),account=(await f.store.bootstrap('A')).account;await f.root.collection('accounts').doc(account.id).update({activeProjectCount:99});const keys=[randomUUID(),randomUUID()],results=await Promise.allSettled(keys.map(k=>create(f.store,'A','last','content','text',k)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'quota');const at=results.findIndex(r=>r.status==='fulfilled');assert.equal((await create(f.store,'A','last','content','text',keys[at])).created,false);assert.equal((await f.root.collection('accounts').doc(account.id).get()).get('activeProjectCount'),100);
});
test('corrupt identity/account/hash is not silently repaired or published as fakezero',async()=>{
 const f=fixture(),a=(await f.store.bootstrap('A')).account,p=await create(f.store,'A');await f.root.collection('projects').doc(p.project.id).update({content:'tampered'});await reject(f.store.read('A',p.project.id),'invariant');await f.root.collection('accounts').doc(a.id).update({credited:1});await reject(f.store.me('A'),'invariant');await reject(f.store.bootstrap('A'),'invariant');assert.equal((await f.root.collection('accounts').get()).size,1);
});
test('video balance reservation, capture, release and idempotent retries stay atomic',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('video-owner'),identityKey=AccountStore.identityKey('video-owner'),accountRef=f.root.collection('accounts').doc(boot.account.id);
 await accountRef.update({credited:90,available:90});
 const reservationId=randomUUID(),concurrent=await Promise.all(Array.from({length:8},()=>f.store.reserveVideo(identityKey,reservationId,60)));
 assert.equal(concurrent.filter(x=>x.created).length,1);assert.equal(new Set(concurrent.map(x=>x.state)).size,1);
 let account=await f.store.me('video-owner');assert.deepEqual(account.balance,{unit:'video_seconds',credited:90,available:30,reserved:60,consumed:0,active:1});
 assert.deepEqual(await f.store.videoBalance(identityKey),account.balance);
 await reject(f.store.reserveVideo(identityKey,randomUUID(),31),'insufficient');
 const providerAdmission={jobId:randomUUID(),attemptId:randomUUID()};
 assert.equal((await admitCall(f.store,identityKey,reservationId,60,providerAdmission.jobId,providerAdmission.attemptId)).created,true);
 const captured=await f.store.settleVideo(identityKey,reservationId,'capture',60,providerAdmission);assert.equal(captured.settled,true);
 assert.equal((await f.store.settleVideo(identityKey,reservationId,'capture',60,providerAdmission)).settled,false);
 await reject(f.store.settleVideo(identityKey,reservationId,'capture',60),'conflict');
 await reject(f.store.settleVideo(identityKey,reservationId,'capture',60,{...providerAdmission,attemptId:randomUUID()}),'conflict');
 account=await f.store.me('video-owner');assert.deepEqual(account.balance,{unit:'video_seconds',credited:90,available:30,reserved:0,consumed:60,active:0});
 const releaseId=randomUUID();await f.store.reserveVideo(identityKey,releaseId,20);await f.store.settleVideo(identityKey,releaseId,'release',20);
 await reject(f.store.settleVideo(identityKey,releaseId,'capture',20),'conflict');
 account=await f.store.me('video-owner');assert.deepEqual(account.balance,{unit:'video_seconds',credited:90,available:30,reserved:0,consumed:60,active:0});
 const ledger=(await f.store.ledger('video-owner')).items;assert.deepEqual(ledger.map(x=>x.kind).sort(),['video_capture','video_release','video_reserve','video_reserve']);assert(ledger.every(x=>x.seconds>0));
});
test('video holds cap active work, reject reused settled keys and fail closed on corrupt receipts',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('video-owner-2'),identityKey=AccountStore.identityKey('video-owner-2');await f.root.collection('accounts').doc(boot.account.id).update({credited:20,available:20});
 const ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];for(const id of ids.slice(0,3))await f.store.reserveVideo(identityKey,id,1);
 await reject(f.store.reserveVideo(identityKey,ids[3],1),'quota');await f.store.settleVideo(identityKey,ids[0],'release',1);await reject(f.store.reserveVideo(identityKey,ids[0],1),'conflict');
 const storedId=createHash('sha256').update(JSON.stringify([boot.account.id,ids[1]])).digest('hex');await f.root.collection('videoReservations').doc(storedId).update({state:'corrupt'});
 await reject(f.store.videoReservation(identityKey,ids[1]),'invariant');await reject(f.store.settleVideo(identityKey,ids[1],'release',1),'invariant');
});

test('incident hold is durable, isolated and idempotent; only exact terminal receipts survive it',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('hold-owner'),other=await f.store.bootstrap('other-owner');
 const key=AccountStore.identityKey('hold-owner'),otherKey=AccountStore.identityKey('other-owner');
 await f.root.collection('accounts').doc(boot.account.id).update({credited:90,available:90});
 await f.root.collection('accounts').doc(other.account.id).update({credited:5,available:5});
 const captured=randomUUID(),released=randomUUID(),pending=randomUUID(),preAdmitted=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()},admitted={jobId:randomUUID(),attemptId:randomUUID()},incident=randomUUID();
 await f.store.reserveVideo(key,captured,20);await admitCall(f.store,key,captured,20,a.jobId,a.attemptId);await f.store.settleVideo(key,captured,'capture',20,a);
 await f.store.reserveVideo(key,released,10);await f.store.settleVideo(key,released,'release',10);await f.store.reserveVideo(key,pending,15);
 await f.store.reserveVideo(key,preAdmitted,5);await admitCall(f.store,key,preAdmitted,5,admitted.jobId,admitted.attemptId);
 assert.deepEqual(await f.store.videoBillingHold(key,incident),{blocked:false,recorded:false});
 assert.deepEqual(await f.store.blockVideoBilling(key,incident),{blocked:true,recorded:true,created:true});
 assert.deepEqual(await f.store.blockVideoBilling(key,incident),{blocked:true,recorded:true,created:false});
 assert.deepEqual(await f.store.videoBillingHold(key,incident),{blocked:true,recorded:true});
 const second=randomUUID();assert.deepEqual(await f.store.videoBillingHold(key,second),{blocked:true,recorded:false});
 assert.deepEqual(await f.store.blockVideoBilling(key,second),{blocked:true,recorded:true,created:true});
 const held=await f.root.collection('videoBillingGuards').doc(boot.account.id).get();assert.equal(held.get('incidentCount'),2);assert.equal(held.get('epoch'),2);
 await reject(f.store.blockVideoBilling(key,'invalid'),'invalid');
 assert.deepEqual(await f.store.videoBillingHold(otherKey,incident),{blocked:false,recorded:false});
 await reject(f.store.videoReservation(otherKey,pending),'not_found');
 await reject(admitCall(f.store,otherKey,pending,15,admitted.jobId,admitted.attemptId),'not_found');
 await reject(f.store.settleVideo(otherKey,pending,'release',15),'not_found');
 await reject(f.store.reserveVideo(key,randomUUID(),1),'conflict');
 assert.equal((await f.store.reserveVideo(key,pending,15)).created,false);
 await reject(admitCall(f.store,key,pending,15,randomUUID(),randomUUID()),'conflict');
 await reject(f.store.settleVideo(key,pending,'capture',15),'conflict');
 await reject(f.store.settleVideo(key,pending,'release',15),'conflict');
 assert.equal((await admitCall(f.store,key,preAdmitted,5,admitted.jobId,admitted.attemptId)).receiptOnly,true);
 await reject(f.store.settleVideo(key,preAdmitted,'capture',5,admitted),'conflict');
 await reject(f.store.settleVideo(key,preAdmitted,'release',5),'conflict');
 assert.equal((await f.store.settleVideo(key,captured,'capture',20,a)).settled,false);
 assert.equal((await f.store.settleVideo(key,released,'release',10)).settled,false);
 await reject(f.store.settleVideo(key,captured,'capture',19,a),'conflict');
 await reject(f.store.settleVideo(key,captured,'capture',20,{...a,jobId:randomUUID()}),'conflict');
 await reject(f.store.settleVideo(key,captured,'capture',20,{...a,attemptId:randomUUID()}),'conflict');
 assert.equal((await admitCall(f.store,key,captured,20,a.jobId,a.attemptId)).receiptOnly,true);
 assert.equal((await f.store.reserveVideo(otherKey,randomUUID(),1)).created,true);
 assert.deepEqual((await f.store.me('hold-owner')).balance,{unit:'video_seconds',credited:90,available:50,reserved:20,consumed:20,active:2});
 const entries=await f.store.ledger('hold-owner');assert.deepEqual(entries.items.map(x=>x.kind).sort(),['video_capture','video_release','video_reserve','video_reserve','video_reserve','video_reserve']);
});

test('hold and reserve serialize: whichever commits first is recorded without a later debit',async()=>{
 for(let i=0;i<3;i++){
  const f=fixture(),boot=await f.store.bootstrap('hold-race'),key=AccountStore.identityKey('hold-race'),reservation=randomUUID(),incident=randomUUID();
  await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});
  const [hold,reserve]=await Promise.allSettled([f.store.blockVideoBilling(key,incident),f.store.reserveVideo(key,reservation,3)]);
  assert.equal(hold.status,'fulfilled');assert.deepEqual(await f.store.videoBillingHold(key,incident),{blocked:true,recorded:true});
  const balance=await f.store.videoBalance(key);
  if(reserve.status==='fulfilled'){assert.equal(reserve.value.created,true);assert.equal(balance.reserved,3);assert.equal((await f.store.reserveVideo(key,reservation,3)).created,false);}
  else{assert.equal(reserve.reason.code,'conflict');assert.equal(balance.reserved,0);await reject(f.store.videoReservation(key,reservation),'not_found');}
  await reject(f.store.reserveVideo(key,randomUUID(),1),'conflict');assert.equal(balance.available+balance.reserved+balance.consumed,10);
 }
});

test('hold and capture serialize; an already captured attempt is receipt-only after hold',async()=>{
 for(let i=0;i<3;i++){
  const f=fixture(),boot=await f.store.bootstrap('capture-race'),key=AccountStore.identityKey('capture-race'),reservation=randomUUID(),incident=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()};
  await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});await f.store.reserveVideo(key,reservation,3);await admitCall(f.store,key,reservation,3,a.jobId,a.attemptId);
  const [hold,capture]=await Promise.allSettled([f.store.blockVideoBilling(key,incident),f.store.settleVideo(key,reservation,'capture',3,a)]);assert.equal(hold.status,'fulfilled');
  const balance=await f.store.videoBalance(key),entries=(await f.store.ledger('capture-race')).items;
  if(capture.status==='fulfilled'){assert.equal(capture.value.settled,true);assert.equal(balance.consumed,3);assert.equal(entries.filter(x=>x.kind==='video_capture').length,1);assert.equal((await f.store.settleVideo(key,reservation,'capture',3,a)).settled,false);}
  else{assert.equal(capture.reason.code,'conflict');assert.equal(balance.reserved,3);assert.equal(entries.filter(x=>x.kind==='video_capture').length,0);await reject(f.store.settleVideo(key,reservation,'capture',3,a),'conflict');}
  await reject(f.store.settleVideo(key,reservation,'release',3),'conflict');
 }
});

test('hold and provider admission compete without authorizing a new attempt after the hold',async()=>{
 for(let i=0;i<3;i++){
  const f=fixture(),boot=await f.store.bootstrap('admission-hold-race'),key=AccountStore.identityKey('admission-hold-race'),reservation=randomUUID(),incident=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()};
  await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});await f.store.reserveVideo(key,reservation,3);
  const [hold,admit]=await Promise.allSettled([f.store.blockVideoBilling(key,incident),admitCall(f.store,key,reservation,3,a.jobId,a.attemptId)]);assert.equal(hold.status,'fulfilled');
  if(admit.status==='fulfilled'){assert.equal(admit.value.created,true);assert.equal((await admitCall(f.store,key,reservation,3,a.jobId,a.attemptId)).receiptOnly,true);}
  else{assert.equal(admit.reason.code,'conflict');await reject(admitCall(f.store,key,reservation,3,a.jobId,a.attemptId),'conflict');}
  await reject(admitCall(f.store,key,reservation,3,randomUUID(),randomUUID()),'conflict');
  await reject(f.store.settleVideo(key,reservation,'capture',3,a),'conflict');await reject(f.store.settleVideo(key,reservation,'release',3),'conflict');
  assert.deepEqual(await f.store.videoBalance(key),{unit:'video_seconds',credited:10,available:7,reserved:3,consumed:0,active:1});
 }
});

test('tombstone is proof against late reserve, while existing reservations keep their true state',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('seal-owner'),key=AccountStore.identityKey('seal-owner'),sealed=randomUUID(),existing=randomUUID();
 await f.root.collection('accounts').doc(boot.account.id).update({credited:20,available:20});
 assert.deepEqual(await f.store.sealVideoReservation(key,sealed,4),{state:'sealed',reservationId:sealed,seconds:4,created:true});
 assert.deepEqual(await f.store.sealVideoReservation(key,sealed,4),{state:'sealed',reservationId:sealed,seconds:4,created:false});
 await reject(f.store.videoReservation(key,sealed),'not_found');await reject(f.store.reserveVideo(key,sealed,4),'conflict');
 await reject(f.store.sealVideoReservation(key,sealed,5),'conflict');await reject(f.store.reserveVideo(key,sealed,5),'conflict');
 await reject(admitCall(f.store,key,sealed,4,randomUUID(),randomUUID()),'conflict');
 await f.store.reserveVideo(key,existing,3);
 assert.deepEqual(await f.store.sealVideoReservation(key,existing,3),{state:'reserved',reservationId:existing,seconds:3,created:false});
 await reject(f.store.sealVideoReservation(key,existing,4),'conflict');
 await f.store.settleVideo(key,existing,'release',3);
 assert.deepEqual(await f.store.sealVideoReservation(key,existing,3),{state:'released',reservationId:existing,seconds:3,created:false});
 assert.equal((await f.root.collection('videoReservationTombstones').get()).size,1);
 assert.deepEqual(await f.store.videoBalance(key),{unit:'video_seconds',credited:20,available:20,reserved:0,consumed:0,active:0});
});

test('resolution status observes sealed and reservation states without creating or changing money',async()=>{
 const f=fixture(),a=await f.store.bootstrap('resolution-A'),b=await f.store.bootstrap('resolution-B');
 const key=AccountStore.identityKey('resolution-A'),other=AccountStore.identityKey('resolution-B');
 const missing=randomUUID(),sealed=randomUUID(),reservation=randomUUID();
 await f.root.collection('accounts').doc(a.account.id).update({credited:10,available:10});
 const accountRef=f.root.collection('accounts').doc(a.account.id);
 const start=await accountRef.get();
 await reject(f.store.videoReservationResolution(key,missing,3),'not_found');
 assert.equal((await f.root.collection('videoReservationTombstones').get()).size,0);
 assert.equal((await accountRef.get()).updateTime.toMillis(),start.updateTime.toMillis());
 await f.store.sealVideoReservation(key,sealed,4);
 assert.deepEqual(await f.store.videoReservationResolution(key,sealed,4),{reservationId:sealed,seconds:4,state:'sealed'});
 await reject(f.store.videoReservationResolution(key,sealed,5),'conflict');
 await reject(f.store.videoReservationResolution(other,sealed,4),'not_found');
 await f.store.reserveVideo(key,reservation,3);
 assert.deepEqual(await f.store.videoReservationResolution(key,reservation,3),{reservationId:reservation,seconds:3,state:'reserved'});
 await reject(f.store.videoReservationResolution(key,reservation,4),'conflict');
 await f.store.settleVideo(key,reservation,'release',3);
 const balance=await f.store.videoBalance(key),before=await accountRef.get();
 await f.store.blockVideoBilling(key,randomUUID());
 assert.deepEqual(await f.store.videoReservationResolution(key,reservation,3),{reservationId:reservation,seconds:3,state:'released'});
 assert.deepEqual(await f.store.videoReservationResolution(key,sealed,4),{reservationId:sealed,seconds:4,state:'sealed'});
 assert.deepEqual(await f.store.videoBalance(key),balance);
 assert.equal((await accountRef.get()).updateTime.toMillis(),before.updateTime.toMillis());
 assert.equal((await f.root.collection('accounts').doc(b.account.id).get()).get('credited'),0);
});

test('resolution status rejects contradictory or corrupt records instead of trusting an absence',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('resolution-corrupt'),key=AccountStore.identityKey('resolution-corrupt'),id=randomUUID();
 await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});
 await f.store.reserveVideo(key,id,3);
 const ref=f.root.collection('videoReservations').doc(createHash('sha256').update(JSON.stringify([boot.account.id,id])).digest('hex'));
 const tomb=f.root.collection('videoReservationTombstones').doc(ref.id);
 await tomb.set({ownerAccountId:boot.account.id,identityKey:key,reservationId:id,seconds:3,state:'sealed',createdAtMs:Date.now()});
 await reject(f.store.videoReservationResolution(key,id,3),'invariant');
 await tomb.delete();await ref.update({state:'invalid'});
 await reject(f.store.videoReservationResolution(key,id,3),'invariant');
});

test('resolution status reports a captured reservation and remains stable across repeated reads',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('resolution-captured'),key=AccountStore.identityKey('resolution-captured'),id=randomUUID(),jobId=randomUUID(),attemptId=randomUUID();
 await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});
 await f.store.reserveVideo(key,id,3);await admitCall(f.store,key,id,3,jobId,attemptId);await f.store.settleVideo(key,id,'capture',3,{jobId,attemptId});
 const expected={reservationId:id,seconds:3,state:'captured'},balance=await f.store.videoBalance(key);
 for(let i=0;i<3;i++)assert.deepEqual(await f.store.videoReservationResolution(key,id,3),expected);
 assert.deepEqual(await f.store.videoBalance(key),balance);assert.equal(balance.consumed,3);
});

test('resolution status racing a seal is a snapshot and never creates a seal by itself',async()=>{
 for(let i=0;i<3;i++){
  const f=fixture();await f.store.bootstrap('resolution-race');const key=AccountStore.identityKey('resolution-race'),id=randomUUID();
  const [observed,sealed]=await Promise.allSettled([f.store.videoReservationResolution(key,id,3),f.store.sealVideoReservation(key,id,3)]);
  assert.equal(sealed.status,'fulfilled');assert.equal(sealed.value.state,'sealed');
  if(observed.status==='fulfilled')assert.deepEqual(observed.value,{reservationId:id,seconds:3,state:'sealed'});
  else assert.equal(observed.reason.code,'not_found');
  assert.deepEqual(await f.store.videoReservationResolution(key,id,3),{reservationId:id,seconds:3,state:'sealed'});
  assert.equal((await f.root.collection('videoReservationTombstones').get()).size,1);
 }
});

test('resolution status over loopback HTTP is restricted and does not create a tombstone',async()=>{
 const f=fixture();await f.store.bootstrap('resolution-http-A');await f.store.bootstrap('resolution-http-B');
 const key=AccountStore.identityKey('resolution-http-A'),other=AccountStore.identityKey('resolution-http-B'),id=randomUUID(),worker='worker@example.invalid',reader='reader@example.invalid',audience='https://account.invalid';
 const handler=accountHttp(f.store,{verifyIdToken:async()=>{throw Error('no browser access');}},'https://vistavo.app',{audience,allowedEmails:[worker,reader],reservationCaller:reader,settlementCaller:worker,verifier:{verifyIdToken:async token=>({email:token==='worker'?worker:reader,email_verified:true})}});
 const server=createServer((req,res)=>void handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address!=='string');
 const post=(token,identityKey)=>fetch('http://127.0.0.1:'+address.port+'/api/internal/video/reservations/'+id+'/resolution',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({identityKey,seconds:3})});
 try{
  assert.equal((await post('reader',key)).status,403);assert.equal((await post('worker',key)).status,404);
  assert.equal((await f.root.collection('videoReservationTombstones').get()).size,0);
  await f.store.sealVideoReservation(key,id,3);
  assert.equal((await post('worker',other)).status,404);
  const response=await post('worker',key);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(await response.json(),{reservationId:id,seconds:3,state:'sealed'});
  const localClient=new AccountBillingClient(undefined,{request:async({url,data})=>{
   const path=new URL(url).pathname,r=await fetch('http://127.0.0.1:'+address.port+path,{method:'POST',headers:{Authorization:'Bearer worker','Content-Type':'application/json'},body:JSON.stringify(data)});
   if(!r.ok)throw Object.assign(Error('synthetic response'),{response:{status:r.status}});return {data:await r.json()};
  }});
  assert.deepEqual(await localClient.resolution(key,id,3),{reservationId:id,seconds:3,state:'sealed'});
  await reject(localClient.resolution(other,id,3),'not_found');
  assert.equal((await f.root.collection('videoReservationTombstones').get()).size,1);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('reserve and tombstone race never both win and never debit a sealed reservation',async()=>{
 for(let i=0;i<4;i++){
  const f=fixture(),boot=await f.store.bootstrap('seal-race'),key=AccountStore.identityKey('seal-race'),reservation=randomUUID();
  await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});
  const [seal,reserve]=await Promise.allSettled([f.store.sealVideoReservation(key,reservation,3),f.store.reserveVideo(key,reservation,3)]);assert.equal(seal.status,'fulfilled');
  const balance=await f.store.videoBalance(key);
  if(seal.value.state==='sealed'){assert.equal(reserve.status,'rejected');assert.equal(reserve.reason.code,'conflict');assert.equal(balance.reserved,0);assert.equal((await f.store.ledger('seal-race')).items.length,0);}
  else{assert.equal(seal.value.state,'reserved');assert.equal(reserve.status,'fulfilled');assert.equal(balance.reserved,3);assert.equal((await f.root.collection('videoReservationTombstones').get()).size,0);}
 }
});

test('provider admission is correlated and replays are receipts, never permission for another provider call',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('admit-owner'),key=AccountStore.identityKey('admit-owner'),reservation=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()};
 await f.root.collection('accounts').doc(boot.account.id).update({credited:20,available:20});
 await reject(admitCall(f.store,key,reservation,5,a.jobId,a.attemptId),'not_found');await f.store.reserveVideo(key,reservation,5);
 await reject(f.store.settleVideo(key,reservation,'capture',5),'conflict');await reject(admitCall(f.store,key,reservation,4,a.jobId,a.attemptId),'conflict');
 assert.deepEqual(await admitCall(f.store,key,reservation,5,a.jobId,a.attemptId),{reservationId:reservation,seconds:5,...a,...callDefaults,created:true,receiptOnly:false});
 assert.deepEqual(await admitCall(f.store,key,reservation,5,a.jobId,a.attemptId),{reservationId:reservation,seconds:5,...a,...callDefaults,created:false,receiptOnly:true});
 await reject(admitCall(f.store,key,reservation,5,randomUUID(),a.attemptId),'conflict');
 await reject(admitCall(f.store,key,reservation,5,a.jobId,randomUUID()),'conflict');
 await reject(f.store.settleVideo(key,reservation,'capture',5,{...a,attemptId:randomUUID()}),'conflict');
 await reject(f.store.settleVideo(key,reservation,'release',5),'conflict');
 assert.equal((await f.store.settleVideo(key,reservation,'capture',5,a)).settled,true);
 assert.equal((await f.store.settleVideo(key,reservation,'capture',5,a)).settled,false);
 assert.equal((await admitCall(f.store,key,reservation,5,a.jobId,a.attemptId)).receiptOnly,true);
 assert.equal((await f.store.ledger('admit-owner')).items.filter(x=>x.kind==='video_capture').length,1);
});

test('admission and release compete; after admission there is no automatic release',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('admit-release'),key=AccountStore.identityKey('admit-release'),a={jobId:randomUUID(),attemptId:randomUUID()},first=randomUUID(),second=randomUUID();
 await f.root.collection('accounts').doc(boot.account.id).update({credited:20,available:20});
 await f.store.reserveVideo(key,first,2);await admitCall(f.store,key,first,2,a.jobId,a.attemptId);await reject(f.store.settleVideo(key,first,'release',2),'conflict');
 await f.store.reserveVideo(key,second,3);await f.store.settleVideo(key,second,'release',3);await reject(admitCall(f.store,key,second,3,a.jobId,a.attemptId),'conflict');
 for(let i=0;i<3;i++){
  const reservation=randomUUID(),attempt={jobId:randomUUID(),attemptId:randomUUID()};await f.store.reserveVideo(key,reservation,1);
  const [admit,release]=await Promise.allSettled([admitCall(f.store,key,reservation,1,attempt.jobId,attempt.attemptId),f.store.settleVideo(key,reservation,'release',1)]);
  assert.notEqual(admit.status,release.status);
  if(admit.status==='fulfilled'){assert.equal(release.reason.code,'conflict',String(release.reason?.stack||release.reason));assert.equal((await f.store.videoReservation(key,reservation)).state,'reserved');}
  else{assert.equal(admit.reason.code,'conflict',String(admit.reason?.stack||admit.reason));assert.equal((await f.store.videoReservation(key,reservation)).state,'released');}
  // Free only non-admitted fixture slots; admitted reservations intentionally remain held.
  if((await f.store.videoBalance(key)).active>=3)break;
 }
});

test('legacy captured receipt does not acquire or invent an admission',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('legacy-owner'),key=AccountStore.identityKey('legacy-owner'),reservation=randomUUID(),attempt={jobId:randomUUID(),attemptId:randomUUID()};
 const accountRef=f.root.collection('accounts').doc(boot.account.id),reservationKey=createHash('sha256').update(JSON.stringify([boot.account.id,reservation])).digest('hex');
 await accountRef.update({credited:10,available:10});await f.store.reserveVideo(key,reservation,4);
 await accountRef.update({available:6,reserved:0,consumed:4,active:0});await f.root.collection('videoReservations').doc(reservationKey).update({state:'captured',admissionProtocol:FieldValue.delete()});
 assert.equal((await f.store.settleVideo(key,reservation,'capture',4)).settled,false);
 await reject(f.store.settleVideo(key,reservation,'capture',4,attempt),'conflict');
 await reject(admitCall(f.store,key,reservation,4,attempt.jobId,attempt.attemptId),'conflict');
 assert.equal((await f.root.collection('videoReservations').doc(reservationKey).get()).get('providerAdmission'),undefined);
});

test('corrupt capture markers never authorize a provider admission',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('corrupt-admit'),key=AccountStore.identityKey('corrupt-admit'),reservation=randomUUID(),attempt={jobId:randomUUID(),attemptId:randomUUID()};
 await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});await f.store.reserveVideo(key,reservation,3);
 const reservationKey=createHash('sha256').update(JSON.stringify([boot.account.id,reservation])).digest('hex');
 await f.root.collection('videoReservations').doc(reservationKey).update({captureAdmission:attempt});
 await reject(admitCall(f.store,key,reservation,3,attempt.jobId,attempt.attemptId),'invariant');
 await reject(f.store.settleVideo(key,reservation,'capture',3,attempt),'invariant');
 assert.deepEqual(await f.store.videoBalance(key),{unit:'video_seconds',credited:10,available:7,reserved:3,consumed:0,active:1});
});

test('each video window or voice fragment has its own exact, durable receipt and barrier check',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('windows-owner'),other=await f.store.bootstrap('other-windows'),key=AccountStore.identityKey('windows-owner'),otherKey=AccountStore.identityKey('other-windows');
 const reservation=randomUUID(),attempt={jobId:randomUUID(),attemptId:randomUUID()},k0='text-window:0000',k1='text-window:0001',k2='text-window:0002',different='b'.repeat(64);
 await f.root.collection('accounts').doc(boot.account.id).update({credited:30,available:30});await f.store.reserveVideo(key,reservation,12);
 const reservationKey=createHash('sha256').update(JSON.stringify([boot.account.id,reservation])).digest('hex'),ref=f.root.collection('videoReservations').doc(reservationKey);
 assert.equal((await ref.get()).get('admissionProtocol'),2);
 const first=await admitCall(f.store,key,reservation,12,attempt.jobId,attempt.attemptId,k0);assert.equal(first.created,true);assert.equal(first.receiptOnly,false);
 const next=await admitCall(f.store,key,reservation,12,attempt.jobId,attempt.attemptId,k1,callDefaults.model,different);assert.equal(next.created,true);
 assert.equal((await admitCall(f.store,key,reservation,12,attempt.jobId,attempt.attemptId,k0)).receiptOnly,true);
 await reject(admitCall(f.store,key,reservation,12,attempt.jobId,attempt.attemptId,k0,callDefaults.model,different),'conflict');
 await reject(admitCall(f.store,key,reservation,12,attempt.jobId,attempt.attemptId,k0,'gemini-3.8-flash-tts',callDefaults.requestSha256),'conflict');
 await reject(admitCall(f.store,key,reservation,12,attempt.jobId,attempt.attemptId,'voice-chunk:0000','gemini-3.8-flash-tts',callDefaults.requestSha256),'conflict');
 await reject(admitCall(f.store,key,reservation,12,attempt.jobId,randomUUID(),k1,callDefaults.model,different),'conflict');
 await reject(admitCall(f.store,key,reservation,11,attempt.jobId,attempt.attemptId,k1,callDefaults.model,different),'conflict');
 await reject(admitCall(f.store,otherKey,reservation,12,attempt.jobId,attempt.attemptId,k1,callDefaults.model,different),'not_found');
 await reject(admitCall(f.store,key,reservation,12,attempt.jobId,attempt.attemptId,'text-window:1000'),'invalid');
 await reject(admitCall(f.store,key,reservation,12,attempt.jobId,attempt.attemptId,k2,callDefaults.model,'invalid'),'invalid');
 await reject(admitCall(f.store,key,reservation,12,attempt.jobId,attempt.attemptId,k0+'\n'),'invalid');
 await reject(admitCall(f.store,key,reservation,12,attempt.jobId,attempt.attemptId,k0,callDefaults.model,callDefaults.requestSha256+'\n'),'invalid');
 await reject(admitCall(f.store,key,reservation,12,attempt.jobId+'\n',attempt.attemptId,k0),'invalid');
 await reject(admitCall(f.store,key+'\n',reservation,12,attempt.jobId,attempt.attemptId,k0),'invalid');
 const calls=await ref.collection('providerCalls').get();assert.equal(calls.size,2);
 for(const doc of calls.docs){assert.equal(doc.get('expiresAt'),undefined);assert.equal(doc.get('request'),undefined);assert.equal(doc.get('text'),undefined);assert.match(doc.get('requestSha256'),/^[a-f0-9]{64}$/);}
 await f.store.blockVideoBilling(key,randomUUID());
 await reject(admitCall(f.store,key,reservation,12,attempt.jobId,attempt.attemptId,k2),'conflict');
 assert.equal((await admitCall(f.store,key,reservation,12,attempt.jobId,attempt.attemptId,k1,callDefaults.model,different)).receiptOnly,true);
 await reject(f.store.settleVideo(key,reservation,'release',12),'conflict');assert.equal((await f.store.videoBalance(key)).reserved,12);
 assert.equal((await f.store.videoBalance(otherKey)).credited,0);assert.notEqual(other.account.id,boot.account.id);
});

test('duplicate call admissions and a lost ACK return one authorization and never recreate a receipt',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('call-replay'),key=AccountStore.identityKey('call-replay'),reservation=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()};
 await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});await f.store.reserveVideo(key,reservation,5);
 const responses=await Promise.all(Array.from({length:6},()=>admitCall(f.store,key,reservation,5,a.jobId,a.attemptId)));
 assert.equal(responses.filter(r=>r.created&&!r.receiptOnly).length,1);assert.equal(responses.filter(r=>!r.created&&r.receiptOnly).length,5);
 // Caller discards the winning ACK; a later response is a receipt only, never a second authorization.
 const retry=await admitCall(f.store,key,reservation,5,a.jobId,a.attemptId);assert.equal(retry.created,false);assert.equal(retry.receiptOnly,true);
 const reservationKey=createHash('sha256').update(JSON.stringify([boot.account.id,reservation])).digest('hex');
 assert.equal((await f.root.collection('videoReservations').doc(reservationKey).collection('providerCalls').get()).size,1);
 assert.equal((await f.store.videoBalance(key)).consumed,0);
});

test('hold and a later fragment serialize; any earlier admission stays reserved for reconciliation',async()=>{
 for(let i=0;i<3;i++){
  const f=fixture(),boot=await f.store.bootstrap('later-call-race'),key=AccountStore.identityKey('later-call-race'),reservation=randomUUID(),incident=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()};
  await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});await f.store.reserveVideo(key,reservation,5);
  await admitCall(f.store,key,reservation,5,a.jobId,a.attemptId,'text-window:0000');
  const [hold,second]=await Promise.allSettled([f.store.blockVideoBilling(key,incident),admitCall(f.store,key,reservation,5,a.jobId,a.attemptId,'text-window:0001')]);
  assert.equal(hold.status,'fulfilled');
  if(second.status==='fulfilled'){assert.equal(second.value.created,true);assert.equal((await admitCall(f.store,key,reservation,5,a.jobId,a.attemptId,'text-window:0001')).receiptOnly,true);}
  else{assert.equal(second.reason.code,'conflict');await reject(admitCall(f.store,key,reservation,5,a.jobId,a.attemptId,'text-window:0001'),'conflict');}
  await reject(admitCall(f.store,key,reservation,5,a.jobId,a.attemptId,'text-window:0002'),'conflict');
  await reject(f.store.settleVideo(key,reservation,'capture',5,a),'conflict');await reject(f.store.settleVideo(key,reservation,'release',5),'conflict');
  assert.equal((await f.store.videoBalance(key)).reserved,5);
 }
});

test('legacy active reservations and the old whole-job admission path remain closed',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('legacy-open'),key=AccountStore.identityKey('legacy-open'),a={jobId:randomUUID(),attemptId:randomUUID()},older=randomUUID(),oldAdmitted=randomUUID(),fresh=randomUUID();
 await f.root.collection('accounts').doc(boot.account.id).update({credited:20,available:20});
 for(const reservation of [older,oldAdmitted,fresh])await f.store.reserveVideo(key,reservation,3);
 const doc=id=>f.root.collection('videoReservations').doc(createHash('sha256').update(JSON.stringify([boot.account.id,id])).digest('hex'));
 await doc(older).update({admissionProtocol:FieldValue.delete()});
 await doc(oldAdmitted).update({admissionProtocol:FieldValue.delete(),providerAdmission:{...a,admittedAtMs:Date.now()}});
 for(const reservation of [older,oldAdmitted]){
  assert.equal((await f.store.reserveVideo(key,reservation,3)).created,false);
  await reject(admitCall(f.store,key,reservation,3,a.jobId,a.attemptId),'conflict');
  await reject(f.store.settleVideo(key,reservation,'capture',3,a),'conflict');
  await reject(f.store.settleVideo(key,reservation,'release',3),'conflict');
  assert.equal((await f.store.videoReservation(key,reservation)).state,'reserved');
 }
 await reject(f.store.admitVideoProvider(key,fresh,3,a.jobId,a.attemptId),'conflict');
 assert.equal((await doc(fresh).get()).get('providerAdmission'),undefined);
 assert.equal((await doc(fresh).collection('providerCalls').get()).size,0);
 assert.deepEqual(await f.store.videoBalance(key),{unit:'video_seconds',credited:20,available:11,reserved:9,consumed:0,active:3});
});

test('legacy terminal captured and released receipts remain replayable without upgrading their history',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('legacy-terminal'),key=AccountStore.identityKey('legacy-terminal'),a={jobId:randomUUID(),attemptId:randomUUID()},captured=randomUUID(),released=randomUUID();
 const account=f.root.collection('accounts').doc(boot.account.id),doc=id=>f.root.collection('videoReservations').doc(createHash('sha256').update(JSON.stringify([boot.account.id,id])).digest('hex'));
 await account.update({credited:10,available:10});await f.store.reserveVideo(key,captured,3);await f.store.reserveVideo(key,released,2);
 await account.update({available:7,reserved:0,consumed:3,active:0});
 await doc(captured).update({state:'captured',admissionProtocol:FieldValue.delete(),providerAdmission:{...a,admittedAtMs:Date.now()},captureAdmission:a});
 await doc(released).update({state:'released',admissionProtocol:FieldValue.delete()});
 assert.equal((await f.store.settleVideo(key,captured,'capture',3,a)).settled,false);
 assert.equal((await f.store.settleVideo(key,released,'release',2)).settled,false);
 await reject(f.store.settleVideo(key,captured,'capture',3,{...a,attemptId:randomUUID()}),'conflict');
 await reject(admitCall(f.store,key,captured,3,a.jobId,a.attemptId),'conflict');
 assert.equal((await doc(captured).get()).get('admissionProtocol'),undefined);assert.equal((await doc(captured).collection('providerCalls').get()).size,0);
});

test('v2 refuses an orphan or damaged first receipt before admission or capture',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('call-corrupt'),key=AccountStore.identityKey('call-corrupt'),reservation=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()};
 await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});await f.store.reserveVideo(key,reservation,4);
 await admitCall(f.store,key,reservation,4,a.jobId,a.attemptId);
 const reservationKey=createHash('sha256').update(JSON.stringify([boot.account.id,reservation])).digest('hex'),ref=f.root.collection('videoReservations').doc(reservationKey),calls=await ref.collection('providerCalls').get();
 await calls.docs[0].ref.update({requestSha256:'b'.repeat(64)});
 await reject(admitCall(f.store,key,reservation,4,a.jobId,a.attemptId,'text-window:0001'),'invariant');
 await reject(f.store.settleVideo(key,reservation,'capture',4,a),'invariant');
 await reject(f.store.settleVideo(key,reservation,'release',4),'invariant');
 assert.deepEqual(await f.store.videoBalance(key),{unit:'video_seconds',credited:10,available:6,reserved:4,consumed:0,active:1});
});

test('v2 never refunds or creates a fresh first receipt if the reservation marker is missing',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('orphan-call'),key=AccountStore.identityKey('orphan-call'),reservation=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()};
 await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});await f.store.reserveVideo(key,reservation,4);
 const reservationKey=createHash('sha256').update(JSON.stringify([boot.account.id,reservation])).digest('hex'),ref=f.root.collection('videoReservations').doc(reservationKey);
 await admitCall(f.store,key,reservation,4,a.jobId,a.attemptId);await ref.update({providerAdmission:FieldValue.delete()});
 await reject(admitCall(f.store,key,reservation,4,a.jobId,a.attemptId,'text-window:0001'),'invariant');await reject(f.store.settleVideo(key,reservation,'release',4),'invariant');
 assert.equal((await f.store.videoBalance(key)).reserved,4);
});

test('v2 fails closed if its first-admission fence is missing',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('missing-call-fence'),key=AccountStore.identityKey('missing-call-fence'),reservation=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()};
 await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});await f.store.reserveVideo(key,reservation,4);await admitCall(f.store,key,reservation,4,a.jobId,a.attemptId);
 const reservationKey=createHash('sha256').update(JSON.stringify([boot.account.id,reservation])).digest('hex'),ref=f.root.collection('videoReservations').doc(reservationKey);
 await ref.collection('providerCallFences').doc('first').delete();
 await reject(admitCall(f.store,key,reservation,4,a.jobId,a.attemptId),'invariant');
 await reject(f.store.settleVideo(key,reservation,'capture',4,a),'invariant');await reject(f.store.settleVideo(key,reservation,'release',4),'invariant');
 assert.equal((await f.store.videoBalance(key)).reserved,4);
});

test('v2 rejects a first-admission fence with a changed timestamp',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('changed-call-fence'),key=AccountStore.identityKey('changed-call-fence'),reservation=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()};
 await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});await f.store.reserveVideo(key,reservation,4);await admitCall(f.store,key,reservation,4,a.jobId,a.attemptId);
 const reservationKey=createHash('sha256').update(JSON.stringify([boot.account.id,reservation])).digest('hex'),fence=f.root.collection('videoReservations').doc(reservationKey).collection('providerCallFences').doc('first');
 const admittedAt=(await fence.get()).get('admittedAtMs');await fence.update({admittedAtMs:admittedAt+1});
 await reject(admitCall(f.store,key,reservation,4,a.jobId,a.attemptId),'invariant');await reject(f.store.settleVideo(key,reservation,'capture',4,a),'invariant');
 assert.equal((await f.store.videoBalance(key)).reserved,4);
});

test('voice chunk receipts use their own allowed call family and exact model',async()=>{
 const f=fixture(),boot=await f.store.bootstrap('voice-calls'),key=AccountStore.identityKey('voice-calls'),reservation=randomUUID(),a={jobId:randomUUID(),attemptId:randomUUID()},model='gemini-3.8-flash-tts';
 await f.root.collection('accounts').doc(boot.account.id).update({credited:10,available:10});await f.store.reserveVideo(key,reservation,4);
 assert.equal((await admitCall(f.store,key,reservation,4,a.jobId,a.attemptId,'voice-chunk:0000',model)).created,true);
 assert.equal((await admitCall(f.store,key,reservation,4,a.jobId,a.attemptId,'voice-chunk:0001',model,'b'.repeat(64))).created,true);
 await reject(admitCall(f.store,key,reservation,4,a.jobId,a.attemptId,'voice-chunk:0000',model,'b'.repeat(64)),'conflict');
 await reject(admitCall(f.store,key,reservation,4,a.jobId,a.attemptId,'text-window:0001',callDefaults.model),'conflict');
 assert.equal((await f.store.settleVideo(key,reservation,'capture',4,a)).settled,true);
});
