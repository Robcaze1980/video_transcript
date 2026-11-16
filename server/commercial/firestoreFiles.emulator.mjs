import assert from 'node:assert/strict';import {test,afterEach,before} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';import {Readable} from 'node:stream';import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';import {FirestoreFiles} from './firestoreFiles.ts';
import {createServer} from 'node:http';import {firestoreHttp} from './firestoreHttp.ts';
import {ObjectFault} from './gcsObjects.ts';
const sha=data=>createHash('sha256').update(data).digest('hex');const contexts=[];
class MemoryObjects{
 data=new Map();next=0;beforePut;failBarrier=false;losePut=false;loseFinal=false;composeCount=0;
 meta(key){const x=this.data.get(key);return x?{key,generation:x.generation,size:x.bytes.length,...(x.marker?{marker:true}:{})}:null;}
 async metadata(key){return this.meta(key);}
 save(key,bytes,marker=false){const generation=String(++this.next);this.data.set(key,{generation,bytes:Buffer.from(bytes),marker});return this.meta(key);}
 async putOnce(key,bytes){if(this.beforePut)await this.beforePut(key);
  const existing=this.data.get(key);if(existing){if(!existing.bytes.equals(bytes))throw new ObjectFault('conflict');return this.meta(key);}
  const object=this.save(key,bytes);if(this.losePut){this.losePut=false;throw new ObjectFault('remote');}return object;}
 async composeOnce(key,sources,size){const prior=this.meta(key);if(prior){if(prior.size!==size)throw new ObjectFault('conflict');return prior;}
  assert.ok(sources.length<=32);const parts=sources.map(s=>{const x=this.data.get(s.key);if(!x||x.generation!==s.generation)throw new ObjectFault('missing');return x.bytes;});
  const bytes=Buffer.concat(parts);assert.equal(bytes.length,size);this.composeCount++;const object=this.save(key,bytes);
  if(key.endsWith('/video.mp4')&&this.loseFinal){this.loseFinal=false;throw new ObjectFault('remote');}return object;}
 async read(object,range){const x=this.data.get(object.key);if(!x||x.generation!==object.generation)throw new ObjectFault('missing');return Readable.from(range?x.bytes.subarray(range.start,range.end+1):x.bytes);}
 async barrier(key){if(this.failBarrier){this.failBarrier=false;throw new ObjectFault('remote');}
  const prior=this.meta(key);return prior?.marker?prior:this.save(key,Buffer.alloc(0),true);}
}
before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');await fetch('http://127.0.0.1:8185/');});
afterEach(async()=>{for(const c of contexts.splice(0)){await c.db.recursiveDelete(c.root);await c.db.terminate();}});
async function fixture(options={}){
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:true});
 const root=db.collection('vistavo_files_test').doc(randomUUID()),objects=new MemoryObjects(),backend=new FirestoreBackend(db,root);
 const files=new FirestoreFiles(db,root,objects,{chunkBytes:4,...options});const uid='files-'+randomUUID(),account=await backend.accountForUid(uid);
 const c={db,root,objects,backend,files,account,uid};contexts.push(c);return c;
}
const ref=(c,col,id)=>c.root.collection(col).doc(id);
const reject=(p,code)=>assert.rejects(p,e=>e.code===code);
async function upload(c,data=Buffer.from('abcdefghijkl')){
 const u=await c.files.begin(c.account,'synthetic.mp4',data.length,sha(data),randomUUID());
 for(let at=0;at<data.length;at+=c.files.limits.chunkBytes)await c.files.append(c.account,u.id,at,data.subarray(at,at+c.files.limits.chunkBytes));return u;
}
const probe=c=>({inspect:async(object,expected)=>{const chunks=[];for await(const p of await c.objects.read(object))chunks.push(p);const digest=sha(Buffer.concat(chunks));assert.equal(digest,expected);return {sha256:digest,video:{duration:2,width:320,height:180,audioTracks:1}};}});
async function ready(c,u){await c.files.complete(c.account,u.id);assert.equal(await c.files.work(u.id,'validate',probe(c)),'cleaning');assert.equal(await c.files.work(u.id,'cleanup'),'ready');}

test('storage begin is idempotent and reserves peak quota once under concurrency',async()=>{
 const c=await fixture();const params=[c.account,'s.mp4',12,sha(Buffer.from('abcdefghijkl')),'same-request'];
 const all=await Promise.all(Array.from({length:4},()=>c.files.begin(...params)));assert.equal(new Set(all.map(x=>x.id)).size,1);
 const a=(await ref(c,'accounts',c.account).get()).data();assert.equal(a.storageReservedBytes,36);assert.equal(a.activeUploads,1);assert.equal(a.credited,0);
 await reject(c.files.begin(c.account,'changed.mp4',12,params[3],params[4]),'conflict');
});
test('peak quota and active limits reject new reservations without changing money or storage',async()=>{
 const c=await fixture({quotaBytes:40,maxActive:1});await c.files.begin(c.account,'s.mp4',12,'a'.repeat(64),'one');
 await reject(c.files.begin(c.account,'s.mp4',12,'a'.repeat(64),'two'),'quota');
 const a=(await ref(c,'accounts',c.account).get()).data();assert.equal(a.storageReservedBytes,36);assert.equal(a.activeUploads,1);assert.equal(a.available,0);
});
test('chunk replay preserves generation, rejects changed bytes, and survives a lost GCS acknowledgement',async()=>{
 const c=await fixture();const bytes=Buffer.from('abcdefghijkl'),u=await c.files.begin(c.account,'s.mp4',12,sha(bytes),'chunk');
 c.objects.losePut=true;await reject(c.files.append(c.account,u.id,0,bytes.subarray(0,4)),'unavailable');
 const generation=[...c.objects.data.values()][0].generation;
 assert.equal((await c.files.append(c.account,u.id,0,bytes.subarray(0,4))).offset,4);
 assert.equal((await c.files.append(c.account,u.id,0,bytes.subarray(0,4))).offset,4);assert.equal([...c.objects.data.values()][0].generation,generation);
 await reject(c.files.append(c.account,u.id,0,Buffer.from('XXXX')),'conflict');await reject(c.files.append(c.account,u.id,8,Buffer.from('ijkl')),'conflict');
});
test('two accounts cannot status, append, complete, delete or download each other uploads',async()=>{
 const c=await fixture(),u=await upload(c),foreign=await c.backend.accountForUid('foreign-'+randomUUID());
 for(const run of [()=>c.files.status(foreign,u.id),()=>c.files.append(foreign,u.id,0,Buffer.from('abcd')),()=>c.files.complete(foreign,u.id),()=>c.files.remove(foreign,u.id),()=>c.files.download(foreign,u.id)])await reject(run(),'not_found');
});
test('compose beyond32 sources, verification and normal cleanup publish a generation-bound input',async()=>{
 const c=await fixture(),data=Buffer.alloc(132,65),u=await upload(c,data);await ready(c,u);
 assert.equal(c.objects.composeCount,3);const row=(await ref(c,'uploads',u.id).get()).data();
 assert.equal(row.plan.chunks.length,33);assert.equal(row.plan.groups.length,2);
 for(const key of [...row.plan.chunks,...row.plan.groups])assert.equal((await c.objects.metadata(key)).marker,true);
 const a=(await ref(c,'accounts',c.account).get()).data();assert.equal(a.storageReservedBytes,0);assert.equal(a.storageCommittedBytes,132);assert.equal(a.activeUploads,0);
 const input=(await ref(c,'inputs',u.id).get()).data();assert.equal(input.ready,true);assert.equal(input.storage.generation,row.receipt.object.generation);
 const opened=await c.files.download(c.account,u.id),parts=[];for await(const part of await c.objects.read(opened.object))parts.push(part);
 assert.equal(sha(Buffer.concat(parts)),sha(data));
});
test('unknown normal cleanup retains all peak quota and does not publish an input',async()=>{
 const c=await fixture(),u=await upload(c);await c.files.complete(c.account,u.id);await c.files.work(u.id,'validate',probe(c));
 c.objects.failBarrier=true;await reject(c.files.work(u.id,'cleanup'),'remote');
 assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),36);assert.equal((await ref(c,'inputs',u.id).get()).exists,false);
 await c.files.work(u.id,'cleanup');assert.equal((await c.files.status(c.account,u.id)).state,'ready');
});
test('validation recovers an already composed final after its acknowledgement was lost',async()=>{
 const c=await fixture(),u=await upload(c);await c.files.complete(c.account,u.id);c.objects.loseFinal=true;
 await reject(c.files.work(u.id,'validate',probe(c)),'remote');const created=[...c.objects.data].find(([k])=>k.endsWith('/video.mp4'))[1].generation;
 await c.files.work(u.id,'validate',probe(c));await c.files.work(u.id,'cleanup');
 assert.equal((await ref(c,'inputs',u.id).get()).get('storage').generation,created);assert.equal(c.objects.composeCount,1);
});
test('delete fences an append paused after its metadata check, including absent planned keys',async()=>{
 const c=await fixture(),data=Buffer.from('abcdefghijkl'),u=await c.files.begin(c.account,'s.mp4',12,sha(data),'late');
 let enter,release;const entered=new Promise(r=>enter=r),paused=new Promise(r=>release=r);
 c.objects.beforePut=async()=>{enter();await paused;};const writer=c.files.append(c.account,u.id,0,Buffer.from('abcd'));const observed=writer.catch(e=>e);
 await entered;await c.files.remove(c.account,u.id);await c.files.work(u.id,'cleanup');release();assert.equal((await observed).code,'conflict');
 const row=(await ref(c,'uploads',u.id).get()).data();for(const key of [...row.plan.chunks,...row.plan.groups,row.plan.final])assert.equal((await c.objects.metadata(key)).marker,true);
 const a=(await ref(c,'accounts',c.account).get()).data();assert.equal(a.storageReservedBytes,0);assert.equal(a.activeUploads,0);
});
test('delete preserves UNKNOWN money evidence, erases text, and releases only storage quota',async()=>{
 const c=await fixture(),u=await upload(c);await ready(c,u);await c.backend.creditVerifiedPurchase(c.account,'fixture-capture',10,100,'synthetic','sandbox');
 await c.backend.saveProject(c.account,u.id,0,'synthetic customer-like text');
 const job=await c.backend.reserve(c.account,u.id,'unknown',1,'transcript:es',1),attempt=await c.backend.claim(c.account,job);
 await c.backend.beginInvocation(c.account,job,attempt.attemptId);await c.backend.quarantine(c.account,job,attempt.attemptId);
 await c.files.remove(c.account,u.id);await c.files.work(u.id,'cleanup');
 assert.equal((await c.backend.readBalance(c.account)).reserved,1);assert.equal((await c.backend.job(c.account,job)).state,'unknown');
 assert.equal((await ref(c,'inputs',u.id).get()).get('deleted'),true);assert.equal((await ref(c,'inputs',u.id).get()).get('unknownCount'),1);
 assert.equal((await ref(c,'projects',u.id).get()).exists,false);assert.equal((await ref(c,'jobs',job).get()).get('snapshot'),null);
 await reject(c.files.download(c.account,u.id),'not_found');
 await c.backend.reconcile(c.account,job,'failed','synthetic-no-provider-work');assert.equal((await c.backend.readBalance(c.account)).available,10);
 assert.equal((await ref(c,'accounts',c.account).get()).get('storageCommittedBytes'),0);
});
test('production ledger refuses metadata-only inputs and freezes the verified object generation',async()=>{
 const c=await fixture();await reject(c.backend.addInput(c.account,Date.now()+10000,'a'.repeat(64)),'invalid');
 const bad=randomUUID();await ref(c,'inputs',bad).create({accountId:c.account,expiresAtMs:Date.now()+100000,sha256:'a'.repeat(64),unknownCount:0,deleted:false});
 await c.backend.creditVerifiedPurchase(c.account,'binding-fixture',10,100,'synthetic','sandbox');await reject(c.backend.reserve(c.account,bad,'bad',1,'transcript:es'),'not_found');
 const u=await upload(c);await ready(c,u);const all=await Promise.all([c.backend.reserve(c.account,u.id,'price-freeze',1,'transcript:es'),c.backend.reserve(c.account,u.id,'price-freeze',2,'transcript:es')]);
 assert.equal(all[0],all[1]);const job=await c.backend.job(c.account,all[0]);assert.equal(job.inputStorage.generation,(await ref(c,'inputs',u.id).get()).get('storage').generation);
 assert.equal((await c.backend.readBalance(c.account)).reserved,job.price);
});
test('expiry is denied immediately and maintenance enqueues durable deletion',async()=>{
 const c=await fixture(),u=await upload(c);await ref(c,'uploads',u.id).update({expiresAtMs:Date.now()-1});
 await reject(c.files.status(c.account,u.id),'expired');assert.deepEqual(await c.files.maintenance(),[u.id]);
 assert.equal((await ref(c,'uploads',u.id).get()).get('state'),'deleting');await c.files.work(u.id,'cleanup');
 assert.equal((await c.files.status(c.account,u.id)).state,'deleted');assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),0);
});

for(const poison of ['decode','remove'])test('maintenance reports persistent '+poison+' failure while valid expiry and file outbox neighbors remain actionable',async()=>{
 const c=await fixture(),bytes=Buffer.from('abcd'),bad=await upload(c,bytes),canary=await upload(c,bytes);await c.files.complete(c.account,canary.id);
 await ref(c,'uploads',bad.id).update({expiresAtMs:Date.now()-10000,...(poison==='decode'?{expectedSha:'malformed-fixture'}:{})});
 const remove=c.files.remove.bind(c.files);if(poison==='remove')c.files.remove=async(account,id,...args)=>{if(id===bad.id)throw Object.assign(new Error('SYNTHETIC_SECRET_MUST_NOT_APPEAR'),{code:14});return remove(account,id,...args);};
 const before=await c.backend.readBalance(c.account),canaryEvent=(await ref(c,'fileOutbox',canary.id).get()).data();
 for(let pass=0;pass<2;pass++){
  const neighbor=await upload(c,bytes);await ref(c,'uploads',neighbor.id).update({expiresAtMs:Date.now()-1000});
  const report=await c.files.maintenanceReport();assert.ok(report.ids.includes(neighbor.id));assert.ok(report.ids.includes(canary.id));assert.equal(report.failures.length,pass===0?1:0);if(pass===0)assert.deepEqual(report.failures[0],{stage:'expiry',id:bad.id,code:poison==='decode'?'invariant':14});assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET'),false);
  assert.equal((await ref(c,'uploads',neighbor.id).get()).get('state'),'deleting');assert.equal(await c.files.work(neighbor.id,'cleanup'),'deleted');
  assert.deepEqual((await ref(c,'fileOutbox',canary.id).get()).data(),canaryEvent);assert.equal((await ref(c,'uploads',bad.id).get()).get('state'),'uploading');assert.deepEqual(await c.backend.readBalance(c.account),before);
 }
 const report=await c.files.maintenanceReport();assert.ok(report.ids.includes(canary.id));assert.equal(report.failures.length,1);assert.deepEqual(await c.files.maintenance(),report.ids);
});

test('maintenance preserves genuine expiry and pending query errors instead of returning an empty success',async()=>{
 for(const failing of ['uploads','fileOutbox']){
  const failure=Object.assign(new Error('synthetic query failure'),{code:7}),calls=[];
  const root={collection(name){if(name==='maintenance')return {doc:()=>({get:async()=>({data:()=>undefined})})};const query={where(){return query;},orderBy(){return query;},limit(){return query;},async get(){calls.push(name);if(name===failing)throw failure;return {docs:[]};}};return query;}};
  const files=new FirestoreFiles({},root,new MemoryObjects());await assert.rejects(files.maintenanceReport(),error=>error===failure);await assert.rejects(files.maintenance(),error=>error===failure);assert.ok(calls.includes(failing));
 }
});

test('durable expiry cursor crosses twenty-five persistent poisoned rows and reaches healthy row twenty-six on a later turn',async()=>{
 const c=await fixture(),poisonIds=Array.from({length:25},()=>randomUUID());
 for(const id of poisonIds)await ref(c,'uploads',id).create({id,accountId:c.account,purgeState:'pending',expiresAtMs:1,syntheticMalformedFixture:true});
 const canary=await upload(c,Buffer.from('abcd'));await c.files.complete(c.account,canary.id);const canaryEvent=(await ref(c,'fileOutbox',canary.id).get()).data();
 const valid=await upload(c,Buffer.from('abcd'));await ref(c,'uploads',valid.id).update({expiresAtMs:2});
 const before=await c.backend.readBalance(c.account),first=await c.files.maintenanceReport();assert.equal(first.failures.length,25);assert.ok(first.failures.every(f=>f.stage==='expiry'&&f.code==='invariant'));assert.ok(!first.ids.includes(valid.id));assert.ok(first.ids.includes(canary.id));
 const cursor=(await ref(c,'maintenance','files-expiry-v1').get()).data();assert.equal(cursor.kind,'files-expiry-cursor-v1');assert.equal(cursor.expiresAtMs,1);assert.equal(cursor.id,[...poisonIds].sort().at(-1));
 // A new service instance demonstrates progress is durable, not an in-memory offset.
 const restarted=new FirestoreFiles(c.db,c.root,c.objects,{chunkBytes:4}),second=await restarted.maintenanceReport();assert.ok(second.ids.includes(valid.id));assert.ok(second.ids.includes(canary.id));assert.equal(second.failures.length,0);assert.equal((await ref(c,'uploads',valid.id).get()).get('state'),'deleting');assert.equal(await restarted.work(valid.id,'cleanup'),'deleted');
 const wrapped=await restarted.maintenanceReport();assert.equal(wrapped.failures.length,25);for(const id of poisonIds){const row=await ref(c,'uploads',id).get();assert.equal(row.get('expiresAtMs'),1);assert.equal(row.get('purgeState'),'pending');}
 assert.deepEqual((await ref(c,'fileOutbox',canary.id).get()).data(),canaryEvent);await restarted.remove(c.account,canary.id);assert.equal(await restarted.work(canary.id,'cleanup'),'deleted');
 const quota=(await ref(c,'accounts',c.account).get()).data();assert.equal(quota.storageReservedBytes,0);assert.equal(quota.storageCommittedBytes,0);assert.deepEqual(await c.backend.readBalance(c.account),before);
});

test('cursor persistence failure is reported after returning useful pending file work',async()=>{
 const c=await fixture(),valid=await upload(c,Buffer.from('abcd'));await ref(c,'uploads',valid.id).update({expiresAtMs:1});
 const original=c.db.runTransaction.bind(c.db);let calls=0;c.db.runTransaction=async(...args)=>{calls++;if(calls===2)throw Object.assign(new Error('synthetic cursor write failure'),{code:14});return original(...args);};
 try{const report=await c.files.maintenanceReport();assert.ok(report.ids.includes(valid.id));assert.deepEqual(report.failures,[{stage:'cursor',id:null,code:14}]);assert.equal((await ref(c,'uploads',valid.id).get()).get('state'),'deleting');assert.equal((await ref(c,'maintenance','files-expiry-v1').get()).exists,false);}finally{c.db.runTransaction=original;}
 assert.equal(await c.files.work(valid.id,'cleanup'),'deleted');assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),0);
});

test('a delayed expiry checkpoint cannot overwrite a newer cursor from another database client', {timeout:30000},async()=>{
 const c=await fixture();for(let n=0;n<25;n++){const id=randomUUID();await ref(c,'uploads',id).create({id,accountId:c.account,purgeState:'pending',expiresAtMs:1});}
 const valid=await upload(c,Buffer.from('abcd'));await ref(c,'uploads',valid.id).update({expiresAtMs:2});const cursorRef=ref(c,'maintenance','files-expiry-v1');await cursorRef.set({kind:'files-expiry-cursor-v1',expiresAtMs:0,id:randomUUID()});
 const secondDb=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:true}),secondFiles=new FirestoreFiles(secondDb,secondDb.doc(c.root.path),c.objects,{chunkBytes:4});
 let enter,release;const entered=new Promise(r=>enter=r),resume=new Promise(r=>release=r),original=c.db.runTransaction.bind(c.db);let paused=false;
 c.db.runTransaction=async(...args)=>{if(!paused){paused=true;enter();await resume;}return original(...args);};
 const delayed=c.files.maintenanceReport();
 try{
  await entered;assert.equal((await secondFiles.maintenanceReport()).failures.length,25);assert.ok((await secondFiles.maintenanceReport()).ids.includes(valid.id));const newer=await cursorRef.get();assert.equal(newer.get('expiresAtMs'),2);
  release();await delayed;const after=await cursorRef.get();assert.equal(after.get('id'),valid.id);assert.ok(after.updateTime.isEqual(newer.updateTime));assert.equal(await secondFiles.work(valid.id,'cleanup'),'deleted');
 }finally{release();await delayed.catch(()=>undefined);c.db.runTransaction=original;await secondDb.terminate();}
});

test('HTTP authenticated files resume, preserve durable nudges and stream exact ranges with deletion revocation',async()=>{
 const c=await fixture(),bytes=Buffer.from('abcdefghijkl');let nudges=0;
 const identity={verifyIdToken:async(token,revoked)=>{assert.equal(revoked,true);if(token==='revoked')throw Error('revoked');return {uid:token==='owner'?c.uid:'foreign-user',email_verified:true};}};
 const server=createServer(firestoreHttp({backend:c.backend,files:c.files,identity,origin:'https://vistavo.app',nudgeFile:async()=>{nudges++;throw Error('synthetic lost launch acknowledgement');}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(path,options={},token='owner')=>fetch(base+path,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
 try{
  const created=await request('/api/cloud/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'video.mp4',size:bytes.length,sha256:sha(bytes),requestKey:'http'})});assert.equal(created.status,201);const u=await created.json();const path='/api/cloud/uploads/'+u.id;
  assert.equal((await request(path,{},'foreign')).status,404);assert.equal((await request(path,{},'revoked')).status,401);
  assert.equal((await request(path+'/chunks?offset=0',{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:Buffer.alloc(5)})).status,413);
  const put=async(at,data)=>request(path+'/chunks?offset='+at,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:data});
  for(let at=0;at<bytes.length;at+=4)assert.equal((await put(at,bytes.subarray(at,at+4))).status,200);
  assert.equal((await put(0,bytes.subarray(0,4))).status,200);assert.equal((await put(0,Buffer.from('xxxx'))).status,409);
  assert.equal((await request(path+'/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,202);assert.equal(nudges,1);
  assert.equal((await ref(c,'fileOutbox',u.id).get()).get('state'),'pending');await ready(c,u);
  const content=await request(path+'/content',{headers:{Range:'bytes=5-8'}});assert.equal(content.status,206);assert.equal(content.headers.get('content-range'),'bytes 5-8/12');assert.equal(content.headers.get('content-length'),'4');assert.equal(content.headers.get('cache-control'),'no-store');assert.equal(await content.text(),'fghi');
  const suffix=await request(path+'/content',{headers:{Range:'bytes=-3'}});assert.equal(await suffix.text(),'jkl');
  const invalid=await request(path+'/content',{headers:{Range:'bytes=20-'}});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),'bytes */12');
  const head=await request(path+'/content',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'12');assert.equal(await head.text(),'');
  assert.equal((await request(path+'/content',{},'foreign')).status,404);
  assert.equal((await request(path,{method:'DELETE'})).status,202);assert.equal((await request(path+'/content')).status,404);
  await c.files.work(u.id,'cleanup');assert.equal((await(await request(path)).json()).state,'deleted');
 }finally{await new Promise(r=>server.close(r));}
});

test('transient probe interruption retains bytes, peak quota and retryable state',async()=>{
 const c=await fixture(),u=await upload(c);await c.files.complete(c.account,u.id);
 await assert.rejects(c.files.work(u.id,'validate',{inspect:async()=>{throw new Error('simulated reader infrastructure timeout');}}));
 const saved=(await ref(c,'uploads',u.id).get()).data();assert.equal(saved.state,'verifying');assert.equal(saved.failure,null);
 assert.equal((await ref(c,'accounts',c.account).get()).get('storageReservedBytes'),36);assert.equal((await ref(c,'inputs',u.id).get()).exists,false);
 await c.files.work(u.id,'validate',probe(c));await c.files.work(u.id,'cleanup');assert.equal((await c.files.status(c.account,u.id)).state,'ready');
});
