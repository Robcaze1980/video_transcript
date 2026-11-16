import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer,request} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {processOnDemand,dispatchPending} from './firestoreWorker.ts';

// Disposable loopback fault server. No runtime SDK patches or application retries.
async function fixture(mode) {
 if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185')throw Error('Dedicated emulator required');
 let injected=false;const events=[];
 const server=createServer(async(req,res)=>{
  try{
   const parts=[];for await(const part of req)parts.push(part);const bytes=Buffer.concat(parts);
   const payload=bytes.length?JSON.parse(bytes.toString()):{};
   const batch=req.url.includes(':batchGet'),query=req.url.includes(':runQuery'),commit=req.url.includes(':commit');
   const event={batch,query,existingTransaction:!!payload.transaction,injected:false};events.push(event);
   if(!injected && query && ['query-denied','query-unavailable'].includes(mode)){
    const code=mode==='query-denied'?403:503;
    injected=true;event.injected=true;res.writeHead(code,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:{code,status:code===403?'PERMISSION_DENIED':'UNAVAILABLE',message:'synthetic query fault'}}));return;
   }
   if(!injected && batch && ((mode==='abort'&&payload.transaction)||mode==='invalid'||mode==='denied')){
    injected=true;event.injected=true;
    if(mode==='abort'){
     const rollback=await fetch('http://127.0.0.1:8185/v1/projects/demo-vistavo-ledger/databases/(default)/documents:rollback',{
      method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({transaction:payload.transaction})});
     assert.equal(rollback.status,200);
    }
    const code=mode==='abort'?409:mode==='invalid'?400:403;
    res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code,status:mode==='abort'?'ABORTED':mode==='invalid'?'INVALID_ARGUMENT':'PERMISSION_DENIED',message:'synthetic transport fault'}}));return;
   }
   const upstream=request({hostname:'127.0.0.1',port:8185,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:8185'}},response=>{
    const data=[];response.on('data',part=>data.push(part));response.on('end',()=>{
     const all=Buffer.concat(data);
     const writes=payload.writes??[];
     const targeted=mode==='lost-commit'||(mode==='lost-begin'&&writes.some(w=>w.update?.fields?.invocationPhase?.stringValue==='invoking'))||
       (mode==='lost-finish'&&writes.some(w=>w.update?.fields?.state?.stringValue==='succeeded'));
     if(!injected && commit && targeted && response.statusCode===200){
      injected=true;event.injected=true;event.commitApplied=true;res.destroy();return;
     }
     if(!injected && response.statusCode===200 && ((mode==='partial-query'&&query)||(mode==='partial-batch'&&batch))){
      const rows=JSON.parse(all.toString());
      assert.ok(Array.isArray(rows)&&rows.length>1,'real multi-document response required');
      injected=true;event.injected=true;
      res.writeHead(200,{'Content-Type':'application/json'});res.flushHeaders();
      // Deliver the first real response element, then interrupt the JSON stream.
      res.write('['+JSON.stringify(rows[0])+',');setTimeout(()=>res.destroy(),30);return;
     }
     res.writeHead(response.statusCode,{'Content-Type':response.headers['content-type']??'application/json'});res.end(all);
    });
   });
   upstream.on('error',()=>{res.writeHead(502);res.end();});upstream.end(bytes);
  }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:500,status:'INTERNAL',message:error.name}}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const host='127.0.0.1:'+server.address().port;
 const previous=process.env.FIRESTORE_EMULATOR_HOST;let db;
 try{process.env.FIRESTORE_EMULATOR_HOST=host;db=new Firestore({projectId:'demo-vistavo-ledger',host,ssl:false,preferRest:true});}
 finally{process.env.FIRESTORE_EMULATOR_HOST=previous;}
 const root=db.collection('vistavo_transport_test').doc(randomUUID());
 const peers=[];
 return {db,root,events,get injected(){return injected;},arm(next){mode=next;injected=false;},peer(){
  const saved=process.env.FIRESTORE_EMULATOR_HOST;let client;
  try{process.env.FIRESTORE_EMULATOR_HOST=host;client=new Firestore({projectId:'demo-vistavo-ledger',host,ssl:false,preferRest:true});}
  finally{process.env.FIRESTORE_EMULATOR_HOST=saved;}
  peers.push(client);return {db:client,root:client.doc(root.path)};
 },async close(){
  // No fault is injected into cleanup even if a test failed before its target RPC.
  injected=true;
  try{await db.recursiveDelete(root);}finally{await Promise.all([db,...peers].map(client=>client.terminate()));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 }};
}

test('REST preserves an aborted read for a fresh transaction, with one durable effect',async()=>{
 const c=await fixture('abort');let callbacks=0;
 try{
  const state=c.root.collection('state').doc('counter'),receipt=c.root.collection('receipts').doc('once');
  await state.set({count:0});
  const result=await c.db.runTransaction(async tx=>{
   callbacks++;const prior=await tx.get(receipt);if(prior.exists)return false;
   const current=await tx.get(state);tx.update(state,{count:current.get('count')+1});tx.create(receipt,{done:true});return true;
  });
  assert.equal(result,true);assert.equal(c.injected,true);assert.ok(callbacks>=2);
  assert.equal((await state.get()).get('count'),1);assert.equal((await receipt.get()).get('done'),true);
  assert.equal(c.events.filter(x=>x.injected&&x.existingTransaction).length,1);
 }finally{await c.close();}
});

for(const [mode,expected] of [['invalid',3],['denied',7]])test('REST propagates injected code '+expected+' without treating it as a transaction retry',async()=>{
 const c=await fixture(mode);let callbacks=0;
 try{
  const doc=c.root.collection('state').doc('counter');await doc.set({count:0});
  await assert.rejects(c.db.runTransaction(async tx=>{callbacks++;await tx.get(doc);tx.update(doc,{count:999});}),e=>e.code===expected);
  assert.equal(c.injected,true);assert.equal(callbacks,1);assert.equal((await doc.get()).get('count'),0);
 }finally{await c.close();}
});

for(const mode of ['partial-query','partial-batch'])test('REST interrupted '+mode+' never silently duplicates or truncates a successful snapshot',async()=>{
 const c=await fixture(mode);
 try{
  const refs=['a','b','c'].map(id=>c.root.collection('items').doc(id));
  for(let n=0;n<refs.length;n++)await refs[n].set({order:n});
  let result,error;
  try{result=mode==='partial-query'?(await c.root.collection('items').orderBy('order').get()).docs:await c.db.getAll(...refs);}
  catch(e){error=e;}
  assert.equal(c.injected,true);
  if(result)assert.deepEqual(result.map(x=>x.id),['a','b','c']);
  else assert.ok(error,'interrupted reads must return complete unique data or an explicit error');
 }finally{await c.close();}
});

test('REST one hundred two-client cancellation/completion races preserve one terminal movement per job',async()=>{
 const c=await fixture('none');
 try{
  const backend=new FirestoreBackend(c.db,c.root,{allowUnverifiedInputsForTests:true}),account=await backend.accountForUid('stress-'+randomUUID());
  const peer=c.peer(),other=new FirestoreBackend(peer.db,peer.root,{allowUnverifiedInputsForTests:true});
  await backend.creditVerifiedPurchase(account,'stress-'+randomUUID(),200,100,'synthetic-merchant','sandbox');
  const input=await backend.addInput(account,Date.now()+3600000,'a'.repeat(64));
  for(let n=0;n<100;n++){
   const id=await backend.reserve(account,input,'stress-'+n,1,'transcript:es');const attempt=await backend.claim(account,id);
   assert.equal(await backend.beginInvocation(account,id,attempt.attemptId),true);
   const resolved=await Promise.all([backend.finish(account,id,attempt.attemptId,true),other.cancel(account,id)]);
   assert.notEqual(resolved[0],resolved[1]);
   let job=await backend.job(account,id);
   if(job.state==='unknown'){await backend.reconcile(account,id,'failed','synthetic-stress-confirmation');job=await backend.job(account,id);}
   assert.ok(['succeeded','failed'].includes(job.state));
   assert.equal((await c.root.collection('movements').where('reference','==',id).get()).size,2);
   const balance=await backend.readBalance(account);assert.equal(balance.reserved,0);assert.equal(balance.active,0);
   assert.equal(balance.credited,balance.available+balance.consumed);
  }
 }finally{await c.close();}
});

async function ledgerFixture(c,credits=3){
 const backend=new FirestoreBackend(c.db,c.root,{allowUnverifiedInputsForTests:true}),account=await backend.accountForUid('transport-'+randomUUID());
 if(credits)await backend.creditVerifiedPurchase(account,'fixture-'+randomUUID(),credits,100,'synthetic-merchant','sandbox');
 const input=await backend.addInput(account,Date.now()+3600000,'a'.repeat(64));
 return {backend,account,input};
}
const observe=promise=>promise.then(value=>({resolved:true,value}),error=>({resolved:false,code:error.code}));

test('REST lost credit and reserve commit acknowledgements retain one receipt and one reservation',async()=>{
 const c=await fixture('none');
 try{
  const {backend,account,input}=await ledgerFixture(c,0);const capture='lost-credit-'+randomUUID();
  c.arm('lost-commit');const credited=await observe(backend.creditVerifiedPurchase(account,capture,3,100,'synthetic-merchant','sandbox'));
  assert.equal(c.injected,true);assert.ok(c.events.some(x=>x.commitApplied));
  assert.equal(await backend.creditVerifiedPurchase(account,capture,3,100,'synthetic-merchant','sandbox'),false);
  assert.equal((await backend.readBalance(account)).credited,3);assert.equal((await c.root.collection('purchases').get()).size,1);
  c.arm('lost-commit');const reserved=await observe(backend.reserve(account,input,'lost-reserve',1,'transcript:es'));
  assert.equal(c.injected,true);
  const id=await backend.reserve(account,input,'lost-reserve',1,'transcript:es');
  assert.equal((await c.root.collection('jobs').get()).size,1);assert.equal((await c.root.collection('outbox').get()).size,1);
  assert.equal((await backend.job(account,id)).state,'queued');
  const balance=await backend.readBalance(account);assert.equal(balance.available,2);assert.equal(balance.reserved,1);assert.equal(balance.active,1);
  console.log(JSON.stringify({diagnostic:'lost_credit_reserve',creditResolved:credited.resolved,creditCode:credited.code,reserveResolved:reserved.resolved,reserveCode:reserved.code}));
 }finally{await c.close();}
});

test('REST lost beginInvocation acknowledgement never authorizes a second provider call',async()=>{
 const c=await fixture('none');
 try{
  const {backend,account,input}=await ledgerFixture(c);const id=await backend.reserve(account,input,'lost-begin',1,'transcript:es');let calls=0;
  const processor={process:async()=>{calls++;return 'succeeded';}};c.arm('lost-begin');
  await processOnDemand(backend,{accountId:account,jobId:id},processor);
  assert.equal(c.injected,true);assert.ok(c.events.some(x=>x.commitApplied));assert.ok(calls<=1);
  let job=await backend.job(account,id);
  if(job.state==='running'){
   await c.root.collection('jobs').doc(id).update({leaseUntil:Date.now()-1});await backend.recover(account,id);job=await backend.job(account,id);
  }
  assert.ok(['unknown','succeeded'].includes(job.state));const before=calls;
  assert.equal(await processOnDemand(backend,{accountId:account,jobId:id},processor),'not_claimed');assert.equal(calls,before);
 }finally{await c.close();}
});

test('REST lost finish commit acknowledgement reports durable success and never repeats provider',async()=>{
 const c=await fixture('none');
 try{
  const {backend,account,input}=await ledgerFixture(c);const id=await backend.reserve(account,input,'lost-finish',1,'transcript:es');let calls=0;
  const processor={process:async()=>{calls++;return 'succeeded';}};c.arm('lost-finish');
  assert.equal(await processOnDemand(backend,{accountId:account,jobId:id},processor),'succeeded');
  assert.equal(c.injected,true);assert.ok(c.events.some(x=>x.commitApplied));assert.equal(calls,1);
  assert.equal(await processOnDemand(backend,{accountId:account,jobId:id},processor),'not_claimed');assert.equal(calls,1);
  const balance=await backend.readBalance(account);assert.equal(balance.consumed,1);assert.equal(balance.reserved,0);
  assert.equal((await c.root.collection('movements').where('reference','==',id).get()).size,2);
 }finally{await c.close();}
});

test('REST recovery query errors propagate and never dispatch or masquerade as an empty batch',async()=>{
 const c=await fixture('none');
 try{
  const {backend,account,input}=await ledgerFixture(c);const id=await backend.reserve(account,input,'query-error',1,'transcript:es');
  c.arm('query-denied');await assert.rejects(backend.pendingDispatches(),e=>e.code===7);assert.equal(c.injected,true);
  c.arm('query-denied');await assert.rejects(backend.recoverExpiredLeases(),e=>e.code===7);assert.equal(c.injected,true);
  let calls=0;c.arm('query-denied');await assert.rejects(dispatchPending(backend,{start:async()=>{calls++;}}),e=>e.code===7);
  assert.equal(calls,0);assert.equal((await backend.job(account,id)).state,'queued');assert.equal((await backend.readBalance(account)).reserved,1);
  assert.equal((await c.root.collection('outbox').doc(id).get()).get('state'),'pending');
  const empty=new FirestoreBackend(c.db,c.root.collection('empty').doc('v1'));
  assert.deepEqual(await empty.pendingDispatches(),[]);assert.equal(await empty.recoverExpiredLeases(),0);
 }finally{await c.close();}
});

test('REST transient query UNAVAILABLE recovers a complete ordered snapshot without duplicates',async()=>{
 const c=await fixture('none');
 try{
  const collection=c.root.collection('items');for(let n=0;n<3;n++)await collection.doc(['a','b','c'][n]).set({order:n});
  c.arm('query-unavailable');const result=await collection.orderBy('order').get();
  assert.equal(c.injected,true);assert.deepEqual(result.docs.map(doc=>doc.id),['a','b','c']);
 }finally{await c.close();}
});
