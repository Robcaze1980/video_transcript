import assert from 'node:assert/strict';import {test} from 'node:test';import {randomUUID} from 'node:crypto';import {createServer} from 'node:http';
import {Firestore} from 'firebase-admin/firestore';import {FirestoreBackend} from './firestoreBackend.ts';import {firestoreHttp} from './firestoreHttp.ts';import {privateBucket} from './privateObjectPlan.ts';
test('optional local account gate denies verified users before account creation or upload IO',async()=>{
 let accountCalls=0,gateCalls=0;const backend={accountForUid:async()=>{accountCalls++;throw Error('Account creation forbidden');}};
 const server=createServer(firestoreHttp({backend,origin:'http://127.0.0.1',identity:{verifyIdToken:async token=>{if(token!=='verified')throw Error('invalid');return {uid:'synthetic-gated-user',email_verified:true};}},authorizeUser:async uid=>{assert.equal(uid,'synthetic-gated-user');gateCalls++;return false;}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const base='http://127.0.0.1:'+server.address().port;assert.equal((await fetch(base+'/api/cloud/me',{headers:{Authorization:'Bearer invalid'}})).status,401);assert.equal(gateCalls,0);assert.equal((await fetch(base+'/api/cloud/uploads',{method:'POST',headers:{Authorization:'Bearer verified','Content-Type':'application/json'},body:'{}'})).status,403);assert.equal(gateCalls,1);assert.equal(accountCalls,0);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('HTTP500 after injected reservation ACK loss reports one correlated trace and same-key replay preserves one durable reservation',async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:true}),root=db.collection('vistavo_diagnostics_test').doc(randomUUID()),backend=new FirestoreBackend(db,root),uid='synthetic-diagnostics-'+randomUUID(),account=await backend.accountForUid(uid),input=randomUUID(),sha='a'.repeat(64),logs=[],secret='SYNTHETIC_DIAGNOSTIC_SECRET';
 let server;const originalError=console.error;
 try{
  await root.collection('accounts').doc(account).update({credited:10,available:10});
  await root.collection('inputs').doc(input).create({accountId:account,expiresAtMs:Date.now()+60000,sha256:sha,deleted:false,unknownCount:0,ready:true,storage:{bucket:privateBucket,key:'candidate-files-v1/'+input+'/video.mp4',generation:'1',size:12,sha256:sha}});
  await backend.saveProject(account,input,0,'Synthetic English fixture.');
  const originalReserve=backend.reserve.bind(backend);let injected=false;backend.reserve=async(...args)=>{const id=await originalReserve(...args);if(!injected){injected=true;throw Object.assign(new Error(secret),{code:4,stack:secret});}return id;};
  server=createServer(firestoreHttp({backend,origin:'http://127.0.0.1',identity:{verifyIdToken:async()=>({uid,email_verified:true})},quote:async()=>2}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const payload={inputId:input,operation:'translation:en',expectedRevision:1,requestKey:'same-after-lost-ack'},call=()=>fetch(base+'/api/cloud/jobs',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  console.error=(...args)=>logs.push(args);const failed=await call();assert.equal(failed.status,500);assert.deepEqual(await failed.json(),{error:'internal'});assert.match(failed.headers.get('x-vistavo-trace'),/^[a-f0-9-]{36}$/);assert.equal(logs.length,1);
  const record=JSON.parse(logs[0][0]);assert.equal(record.traceId,failed.headers.get('x-vistavo-trace'));assert.equal(record.code,4);assert.equal(record.status,500);assert.equal(record.attempts.reserve,1);assert.ok(record.attempts.identity>=1);assert.ok(record.stages['reserve.read'].calls>=1);assert.ok(record.stages['reserve.callback'].calls>=1);assert.equal(JSON.stringify(logs).includes(secret),false);
  const replay=await call();assert.equal(replay.status,202);const id=(await replay.json()).id;assert.equal(logs.length,1);assert.equal((await root.collection('jobs').get()).size,1);assert.equal((await root.collection('movements').where('kind','==','reserve').get()).size,1);assert.equal((await backend.readBalance(account)).reserved,2);assert.equal((await root.collection('providerCalls').get()).size,0);await backend.cancel(account,id);
 }finally{console.error=originalError;if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await db.recursiveDelete(root);await db.terminate();}
});
