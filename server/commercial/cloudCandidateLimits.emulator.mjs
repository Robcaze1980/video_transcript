import assert from 'node:assert/strict';import {test} from 'node:test';import {randomUUID} from 'node:crypto';import {createServer} from 'node:http';
import {Firestore} from 'firebase-admin/firestore';import {FirestoreBackend} from './firestoreBackend.ts';import {FirestoreAi} from './firestoreAi.ts';import {firestoreHttp} from './firestoreHttp.ts';import {privateBucket,objectPlan} from './privateObjectPlan.ts';
test('actual HTTP AI quote/enqueue reject local policy bypasses without reservation or provider IO',async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:true}),root=db.collection('vistavo_limits_test').doc(randomUUID()),backend=new FirestoreBackend(db,root),uid='limits-'+randomUUID(),account=await backend.accountForUid(uid),input=randomUUID(),sha='a'.repeat(64);let server,io=0;
 const limits={maxSourceSeconds:30,maxNarrationChars:600,maxVoiceChunks:3};
 try{
  await root.collection('accounts').doc(account).update({aiPilot:true,simulationOnly:true});await backend.creditVerifiedPurchase(account,'synthetic-limit-'+randomUUID(),100,1,'synthetic-only','sandbox');
  const ref=root.collection('inputs').doc(input);await ref.create({accountId:account,expiresAtMs:Date.now()+60000,sha256:sha,deleted:false,ready:true,unknownCount:0,metadata:{duration:31,audioTracks:1},storage:{bucket:privateBucket,key:objectPlan(input,12).final,generation:'1',size:12,sha256:sha}});
  await backend.saveProject(account,input,0,'A short sentence.');const balance=await backend.readBalance(account),movements=(await root.collection('movements').get()).size;
  const ai=new FirestoreAi(db,root,backend,new Proxy({},{get(){io++;throw Error('No object/provider IO allowed');}}),limits);
  server=createServer(firestoreHttp({backend,ai,origin:'http://127.0.0.1',identity:{verifyIdToken:async()=>({uid,email_verified:true})}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  let revision=1;
  async function reject(operation){for(const method of ['GET','POST']){const route=method==='GET'?'/api/cloud/ai/quote?inputId='+input+'&operation='+encodeURIComponent(operation)+'&revision='+revision:'/api/cloud/ai/jobs';const response=await fetch(base+route,{method,headers:{Authorization:'Bearer synthetic-only',...(method==='POST'?{'Content-Type':'application/json'}:{})},body:method==='POST'?JSON.stringify({inputId:input,operation,expectedRevision:revision,requestKey:randomUUID()}):undefined});assert.equal(response.status,400);await response.body?.cancel();}}
  await reject('translation:en');await ref.update({'metadata.duration':30});await backend.saveProject(account,input,revision++,'x'.repeat(601));await reject('narration:en:male');
  await backend.saveProject(account,input,revision++,'x'.repeat(321));await reject('narration:en:female');
  // Exercise chunk guard independently; the real local600-char guard is stricter than this fixture allowance.
  limits.maxNarrationChars=2000;await backend.saveProject(account,input,revision++,('a '.repeat(99)+'done. ').repeat(4));await reject('narration:en:male');
  assert.deepEqual(await backend.readBalance(account),balance);assert.equal((await root.collection('movements').get()).size,movements);
  for(const col of ['jobs','outbox','artifacts','providerCalls'])assert.equal((await root.collection(col).get()).size,0);assert.equal(io,0);
  limits.maxNarrationChars=600;const boundary='a'.repeat(198)+'. '+ 'b'.repeat(198)+'. '+ 'c'.repeat(199)+'.';assert.equal(boundary.length,600);
  await backend.saveProject(account,input,revision++,boundary);const expectedRevision=revision,requestKey=randomUUID(),payload={inputId:input,operation:'narration:en:male',expectedRevision,requestKey};
  const post=()=>fetch(base+'/api/cloud/ai/jobs',{method:'POST',headers:{Authorization:'Bearer synthetic-only','Content-Type':'application/json'},body:JSON.stringify(payload)});
  const accepted=await post();assert.equal(accepted.status,202);const job=(await accepted.json()).id;
  const held=await backend.readBalance(account);await ref.update({'metadata.duration':31});await backend.saveProject(account,input,revision++,'An edited later revision.');
  const replay=await post();assert.equal(replay.status,202);assert.equal((await replay.json()).id,job);assert.deepEqual(await backend.readBalance(account),held);
  assert.equal((await root.collection('jobs').get()).size,1);assert.equal((await root.collection('movements').where('kind','==','reserve').get()).size,1);assert.equal((await root.collection('providerCalls').get()).size,0);assert.equal(io,0);await backend.cancel(account,job);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await db.recursiveDelete(root);await db.terminate();}
});
