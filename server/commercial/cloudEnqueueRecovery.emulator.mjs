import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {firestoreHttp} from './firestoreHttp.ts';
import {privateBucket} from './privateObjectPlan.ts';

async function fixture(work){
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185','No native fallback');
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:true}),root=db.collection('vistavo_e55_ack_test').doc(randomUUID()),backend=new FirestoreBackend(db,root),uid='synthetic-e55-'+randomUUID(),account=await backend.accountForUid(uid),input=randomUUID(),sha='a'.repeat(64),logs=[];
 let server,objectIO=0;const originalError=console.error;
 try{
  await root.collection('accounts').doc(account).update({credited:100,available:100,aiPilot:true,simulationOnly:true});
  await root.collection('inputs').doc(input).create({accountId:account,expiresAtMs:Date.now()+3600000,sha256:sha,deleted:false,unknownCount:0,ready:true,metadata:{duration:21,audioTracks:1},storage:{bucket:privateBucket,key:'candidate-files-v1/'+input+'/video.mp4',generation:'1',size:12,sha256:sha},syntheticNotActualGcsProof:true});
  await backend.saveProject(account,input,0,'Synthetic diagnostic English.');
  const ai=new FirestoreAi(db,root,backend,new Proxy({},{get(){objectIO++;throw Error('Object IO forbidden');}}));
  server=createServer(firestoreHttp({backend,ai,origin:'http://127.0.0.1',identity:{verifyIdToken:async()=>({uid,email_verified:true})}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port,payload={inputId:input,operation:'narration:en:female',expectedRevision:1,requestKey:'same-key-no-second-reserve'};
  const call=(data=payload)=>fetch(base+'/api/cloud/ai/jobs',{method:'POST',headers:{Authorization:'Bearer synthetic-no-real-auth','Content-Type':'application/json'},body:JSON.stringify(data)});
  console.error=(...args)=>logs.push(args);
  await work({db,root,backend,ai,account,input,payload,call,logs});
  assert.equal(objectIO,0);assert.equal((await root.collection('providerCalls').get()).size,0);
 }finally{console.error=originalError;if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await db.recursiveDelete(root);await db.terminate();}
}
test('actual AI HTTP lost reservation ACK returns202 and concurrent same-key replays keep one reserve/outbox/artifact without provider IO',()=>fixture(async c=>{
 const reserve=c.backend.reserve.bind(c.backend);let calls=0;const sentinel='SYNTHETIC_PRIVATE_ACK_ERROR';
 c.backend.reserve=async(...args)=>{calls++;const id=await reserve(...args);throw Object.assign(new Error(sentinel),{code:4});};
 const first=await c.call();assert.equal(first.status,202);const id=(await first.json()).id;
 const replays=await Promise.all(Array.from({length:4},()=>c.call()));for(const response of replays){assert.equal(response.status,202);assert.deepEqual(await response.json(),{id});}
 assert.equal(calls,1);for(const col of ['jobs','requests','outbox','artifacts'])assert.equal((await c.root.collection(col).get()).size,1);
 assert.equal((await c.root.collection('movements').where('kind','==','reserve').get()).size,1);assert.deepEqual(await c.backend.readBalance(c.account),{credited:100,available:99,reserved:1,consumed:0,active:1});
 assert.equal(c.logs.length,1);const log=JSON.parse(c.logs[0][0]);assert.equal(log.event,'cloud-http-recovered');assert.equal(log.enqueueRecovered,true);assert.equal(log.enqueueFailure.code,4);assert.equal(log.traceId,first.headers.get('x-vistavo-trace'));assert.equal(log.attempts.reserve,1);assert.equal(JSON.stringify(c.logs).includes(sentinel),false);
 await c.backend.cancel(c.account,id);assert.equal((await c.backend.readBalance(c.account)).reserved,0);
}));
test('actual AI HTTP failure before commit remains500 with no durable reservation or recovery success',()=>fixture(async c=>{
 const before=await c.backend.readBalance(c.account);let calls=0;c.backend.reserve=async()=>{calls++;throw Object.assign(new Error('SYNTHETIC_BEFORE_COMMIT'),{code:14});};
 const response=await c.call();assert.equal(response.status,500);assert.deepEqual(await response.json(),{error:'internal'});assert.equal(calls,1);
 assert.deepEqual(await c.backend.readBalance(c.account),before);for(const col of ['jobs','requests','outbox','artifacts','movements'])assert.equal((await c.root.collection(col).get()).size,0);
 const log=JSON.parse(c.logs[0][0]);assert.equal(log.enqueueRecovered,false);assert.equal(log.enqueueFailure.code,14);assert.equal(log.event,'cloud-http-internal');
}));
test('actual AI HTTP unavailable recovery read remains500; later exact replay recovers one committed reservation',()=>fixture(async c=>{
 const reserve=c.backend.reserve.bind(c.backend),prior=c.backend.priorSimulatedRequestForEnqueue.bind(c.backend);let mutations=0,lookups=0;
 c.backend.reserve=async(...args)=>{mutations++;await reserve(...args);throw Object.assign(new Error('SYNTHETIC_ACK_FAILURE'),{code:4});};
 c.backend.priorSimulatedRequestForEnqueue=async(...args)=>{lookups++;if(lookups===2)throw Object.assign(new Error('SYNTHETIC_READ_UNAVAILABLE'),{code:14});return prior(...args);};
 const uncertain=await c.call();assert.equal(uncertain.status,500);assert.deepEqual(await uncertain.json(),{error:'internal'});
 const replay=await c.call();assert.equal(replay.status,202);const id=(await replay.json()).id;assert.equal(mutations,1);assert.equal((await c.root.collection('jobs').get()).size,1);assert.equal((await c.root.collection('movements').where('kind','==','reserve').get()).size,1);
 const log=JSON.parse(c.logs[0][0]);assert.equal(log.enqueueFailure.code,4);assert.equal(log.code,4);assert.equal(log.enqueueRecovered,false);await c.backend.cancel(c.account,id);
}));
test('actual AI HTTP revoked flags deny recovered202; re-enable then replay uses the same existing job',()=>fixture(async c=>{
 const reserve=c.backend.reserve.bind(c.backend);let calls=0;c.backend.reserve=async(...args)=>{calls++;const id=await reserve(...args);await c.root.collection('accounts').doc(c.account).update({aiPilot:false});throw Object.assign(new Error('SYNTHETIC_ACK_REVOKE'),{code:4});};
 const revoked=await c.call();assert.equal(revoked.status,503);assert.deepEqual(await revoked.json(),{error:'disabled'});assert.equal(calls,1);assert.equal((await c.root.collection('jobs').get()).size,1);
 await c.root.collection('accounts').doc(c.account).update({aiPilot:true});const replay=await c.call();assert.equal(replay.status,202);const id=(await replay.json()).id;assert.equal(calls,1);assert.equal((await c.backend.readBalance(c.account)).reserved,1);await c.backend.cancel(c.account,id);
}));
test('actual AI HTTP conflicting reuse never acknowledges an existing different operation',()=>fixture(async c=>{
 const first=await c.call();assert.equal(first.status,202);const id=(await first.json()).id;
 const conflict=await c.call({...c.payload,operation:'narration:en:male'});assert.equal(conflict.status,409);assert.deepEqual(await conflict.json(),{error:'conflict'});assert.equal((await c.root.collection('jobs').get()).size,1);assert.equal((await c.root.collection('movements').where('kind','==','reserve').get()).size,1);await c.backend.cancel(c.account,id);
}));
