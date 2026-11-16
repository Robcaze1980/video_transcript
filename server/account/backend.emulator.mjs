import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {AccountStore} from './backend.ts';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185')throw Error('Dedicated loopback emulator required, no fallback');
const fixtures=[];
before(async()=>{assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const f of fixtures.splice(0)){await f.db.recursiveDelete(f.root);await f.db.terminate();}});
function fixture(){const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:true}),root=db.collection('vistavo_account_test').doc(randomUUID()),store=new AccountStore(db,root),f={db,root,store};fixtures.push(f);return f;}
const reject=(p,code)=>assert.rejects(p,e=>e.code===code);
const create=(s,uid,title='Project',content='hello',kind='text',key=randomUUID())=>s.create(uid,key,title,kind,content);
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
