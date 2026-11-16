import assert from 'node:assert/strict';
import {test,before,afterEach} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {firestoreHttp} from './firestoreHttp.ts';
import {AI_CATALOG_VERSION} from './aiContracts.ts';

const contexts=[],sha=value=>createHash('sha256').update(value).digest('hex'),ref=(c,col,id)=>c.root.collection(col).doc(id);
before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185','No native fallback');assert.equal((await fetch('http://127.0.0.1:8185/')).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){if(c.server){c.server.closeAllConnections();await new Promise(r=>c.server.close(r));}await c.db.recursiveDelete(c.root);await c.db.terminate();}});
async function fixture(){
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:true}),root=db.collection('vistavo_access_revocation_test').doc(randomUUID()),backend=new FirestoreBackend(db,root),uid='access-owner-'+randomUUID(),otherUid='access-other-'+randomUUID();
 const account=await backend.accountForUid(uid),other=await backend.accountForUid(otherUid),input=randomUUID(),sourceSha=sha('synthetic source');
 const objects={reads:0,data:new Map(),async read(object,range){this.reads++;const entry=this.data.get(object.key);assert.ok(entry);assert.equal(entry.generation,object.generation);return Readable.from(range?entry.bytes.subarray(range.start,range.end+1):entry.bytes);}};
 const ai=new FirestoreAi(db,root,backend,objects),c={db,root,backend,objects,ai,account,other,uid,otherUid,input};contexts.push(c);
 for(const who of [account,other])await ref(c,'accounts',who).update({aiPilot:true,simulationOnly:true});
 await backend.creditVerifiedPurchase(account,'access-fixture-'+randomUUID(),10,1,'synthetic-access-no-payment','sandbox');
 await ref(c,'inputs',input).create({accountId:account,expiresAtMs:Date.now()+3600000,sha256:sourceSha,deleted:false,ready:true,unknownCount:0,metadata:{duration:2,audioTracks:1},storage:{bucket:'vistavo-prod-107404655346-media',key:'candidate-files-v1/'+input+'/video.mp4',generation:'9007199254740993',size:100,sha256:sourceSha}});
 await backend.saveProject(account,input,0,'Synthetic reviewed text.');
 c.jobId=await backend.reserve(account,input,'access-fixture',2,'translation:en',1,AI_CATALOG_VERSION);
 const attempt=await backend.claim(account,c.jobId);assert.ok(attempt);const claimed=await backend.job(account,c.jobId);assert.equal(claimed.invocationPhase,'local_check');assert.equal(await backend.resumeTextAfterLocalCheck(account,c.jobId,attempt.attemptId,claimed.inputStorage,'nonzero'),true);assert.equal(await backend.beginInvocation(account,c.jobId,attempt.attemptId),true);
 await ref(c,'providerCalls',c.jobId+'-text-window-0000').create({jobId:c.jobId,accountId:account,attemptId:attempt.attemptId,callKey:'text-window:0000',model:'gemini-3.8-flash',state:'received',httpStatus:200,requestSha256:'a'.repeat(64),responseSha256:'b'.repeat(64),responseId:'synthetic-access-receipt',usage:{totalTokenCount:1},fixtureOnly:true});
 const artifact=(await ref(c,'artifacts',c.jobId).get()).data(),entries=artifact.plan.artifacts.map((spec,i)=>{const bytes=Buffer.from('Synthetic private result '+i),generation=String(9007199254741000n+BigInt(i));objects.data.set(spec.key,{generation,bytes});return {name:spec.name,key:spec.key,mimeType:spec.mimeType,generation,size:bytes.length,sha256:sha(bytes)};});
 assert.equal(await backend.stageArtifactReceipt(account,c.jobId,attempt.attemptId,entries),true);assert.equal(await backend.finish(account,c.jobId,attempt.attemptId,true),true);
 c.originalInput=(await ref(c,'inputs',input).get()).data();c.originalJob=(await ref(c,'jobs',c.jobId).get()).data();c.originalArtifact=(await ref(c,'artifacts',c.jobId).get()).data();c.balance=await backend.readBalance(account);return c;
}
async function server(c){
 c.server=createServer(firestoreHttp({origin:'http://127.0.0.1',backend:c.backend,ai:c.ai,identity:{verifyIdToken:async (token,checkRevoked)=>{assert.equal(checkRevoked,true);if(token==='owner')return {uid:c.uid,email_verified:true};if(token==='other')return {uid:c.otherUid,email_verified:true};throw Error('unauthorized');}}}));
 await new Promise(r=>c.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+c.server.address().port,path='/api/cloud/ai/jobs/'+c.jobId;
 return {path,call:(suffix='',method='GET',token='owner',headers={})=>fetch(base+path+suffix,{method,headers:{Origin:'http://127.0.0.1',Authorization:'Bearer '+token,...headers},signal:AbortSignal.timeout(10000)})};
}
async function unchanged(c){assert.deepEqual(await c.backend.readBalance(c.account),c.balance);assert.equal((await c.root.collection('providerCalls').get()).size,1);assert.deepEqual((await ref(c,'jobs',c.jobId).get()).data(),c.originalJob);}

test('authorized immutable results remain available with GET HEAD Range and stale revision',async()=>{
 const c=await fixture(),s=await server(c);await c.backend.saveProject(c.account,c.input,1,'A later reviewed revision.');
 const status=await s.call();assert.equal(status.status,200);const body=await status.json();assert.equal(body.results.length,5);assert.equal(body.stale,true);assert.equal(body.revision,1);assert.equal(body.results.some(x=>'key'in x||'generation'in x),false);
 const full=await s.call('/results/translation-en.txt');assert.equal(full.status,200);assert.equal(full.headers.get('cache-control'),'no-store');const bytes=Buffer.from(await full.arrayBuffer());assert.equal(bytes.toString(),'Synthetic private result 2');
 const range=await s.call('/results/translation-en.txt','GET','owner',{Range:'bytes=3-8'});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(3,9));
 const head=await s.call('/results/translation-en.txt','HEAD');assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(c.objects.reads,2);await unchanged(c);
});

test('status and download agree on sealed input owner readiness expiry generation and SHA',async()=>{
 const c=await fixture(),s=await server(c),changes=[{ready:false},{deleted:true},{expiresAtMs:Date.now()-1},{expiresAtMs:'invalid'},{accountId:c.other},{storage:{...c.originalInput.storage,generation:'9007199254740994'}},{sha256:'d'.repeat(64),storage:{...c.originalInput.storage,sha256:'d'.repeat(64)}}];
 for(const change of changes){await ref(c,'inputs',c.input).set({...c.originalInput,...change});const status=await s.call();assert.equal(status.status,200);assert.deepEqual((await status.json()).results,[]);for(const method of ['GET','HEAD'])assert.equal((await s.call('/results/translation-en.txt',method)).status,404);assert.equal((await s.call('/results/translation-en.txt','GET','owner',{Range:'bytes=0-3'})).status,404);}
 await ref(c,'inputs',c.input).delete();assert.deepEqual((await (await s.call()).json()).results,[]);assert.equal((await s.call('/results/translation-en.txt')).status,404);assert.equal(c.objects.reads,0);await unchanged(c);
});

test('confirmed account flag revocation denies status GET HEAD Range and does not read result bytes',async()=>{
 const c=await fixture(),s=await server(c);
 for(const flag of ['aiPilot','simulationOnly']){await ref(c,'accounts',c.account).update({aiPilot:true,simulationOnly:true,[flag]:false});for(const [suffix,method,headers]of [['','GET',{}],['/results/translation-en.txt','GET',{}],['/results/translation-en.txt','HEAD',{}],['/results/translation-en.txt','GET',{Range:'bytes=0-3'}]])assert.equal((await s.call(suffix,method,'owner',headers)).status,503);}
 assert.equal(c.objects.reads,0);await unchanged(c);
});

test('revocation after a discarded SDK transaction attempt is rechecked on download retry before reading bytes',async()=>{
 const c=await fixture(),run=c.db.runTransaction.bind(c.db);let attempts=0;
 // Instance-scoped harness only: actual SDK rolls back the first real read transaction.
 // Revoke after rollback, before the retry reads. No private SDK internals or global monkeypatch.
 c.db.runTransaction=(callback,options)=>run(async tx=>{attempts++;if(attempts===2)await ref(c,'accounts',c.account).update({aiPilot:false});const result=await callback(tx);if(attempts===1){const error=new Error('Synthetic controlled ABORTED');error.code=10;throw error;}return result;},options);
 try{await assert.rejects(async()=>{const authorized=await c.ai.download(c.account,c.jobId,'translation-en.txt');await c.objects.read(authorized.object);},e=>e.code==='disabled');assert.equal(attempts,2);assert.equal(c.objects.reads,0);}finally{c.db.runTransaction=run;}
 await unchanged(c);
});

test('real account revocation commits after outer HTTP check but before transaction reads and denies Range bytes',async()=>{
 const c=await fixture(),s=await server(c),run=c.db.runTransaction.bind(c.db);let enter,release,accountInTransaction=false;
 const entered=new Promise(r=>enter=r),resume=new Promise(r=>release=r);
 c.db.runTransaction=(callback,options)=>run(tx=>callback(new Proxy(tx,{get(target,key){const value=Reflect.get(target,key,target);if(key==='getAll')return async(...docs)=>{accountInTransaction ||= docs.some(d=>d.path===ref(c,'accounts',c.account).path);enter();await resume;return target.getAll(...docs);};return typeof value==='function'?value.bind(target):value;}})),options);
 const request=s.call('/results/translation-en.txt','GET','owner',{Range:'bytes=0-3'});
 try{await Promise.race([entered,request.then(()=>{throw Error('Request bypassed transaction barrier');})]);await ref(c,'accounts',c.account).update({aiPilot:false});release();const response=await request;assert.equal(response.status,503);assert.equal(accountInTransaction,true);assert.equal(c.objects.reads,0);}finally{release();c.db.runTransaction=run;}
 await unchanged(c);
});

test('status authorization also rechecks simulation grant on a discarded real SDK attempt',async()=>{
 const c=await fixture(),run=c.db.runTransaction.bind(c.db);let attempts=0;
 c.db.runTransaction=(callback,options)=>run(async tx=>{attempts++;if(attempts===2)await ref(c,'accounts',c.account).update({simulationOnly:false});const result=await callback(tx);if(attempts===1){const error=new Error('Synthetic controlled ABORTED');error.code=10;throw error;}return result;},options);
 try{await assert.rejects(c.ai.status(c.account,c.jobId),e=>e.code==='disabled');assert.equal(attempts,2);}finally{c.db.runTransaction=run;}
 assert.equal(c.objects.reads,0);await unchanged(c);
});

test('revocation after authorization allows the in-flight transfer but denies every later authorization',async()=>{
 const c=await fixture(),s=await server(c),read=c.objects.read.bind(c.objects);let enter,release;
 const entered=new Promise(r=>enter=r),resume=new Promise(r=>release=r);
 // The result authorization transaction has committed before objects.read begins.
 c.objects.read=async(...args)=>{enter();await resume;return read(...args);};
 const request=s.call('/results/translation-en.txt');
 try{await Promise.race([entered,request.then(()=>{throw Error('Request bypassed object-read barrier');})]);await ref(c,'accounts',c.account).update({aiPilot:false});release();const response=await request;assert.equal(response.status,200);assert.equal(await response.text(),'Synthetic private result 2');assert.equal(c.objects.reads,1);for(const method of ['GET','HEAD'])assert.equal((await s.call('/results/translation-en.txt',method)).status,503);assert.equal(c.objects.reads,1);}finally{release();c.objects.read=read;}
 await unchanged(c);
});

test('foreign accounts UNKNOWN and corrupted artifact associations never expose a manifest or bytes',async()=>{
 const c=await fixture(),s=await server(c);for(const path of ['','/results/translation-en.txt'])assert.equal((await s.call(path,'GET','other')).status,404);
 await ref(c,'jobs',c.jobId).update({state:'unknown'});assert.deepEqual((await (await s.call()).json()).results,[]);assert.equal((await s.call('/results/translation-en.txt')).status,404);await ref(c,'jobs',c.jobId).set(c.originalJob);
 for(const change of [{jobId:randomUUID()},{inputId:randomUUID()},{revision:99},{planHash:'e'.repeat(64)}]){await ref(c,'artifacts',c.jobId).set({...c.originalArtifact,...change});for(const path of ['','/results/translation-en.txt'])assert.equal((await s.call(path)).status,404);}
 await ref(c,'artifacts',c.jobId).set({...c.originalArtifact,plan:{...c.originalArtifact.plan,operation:'narration:en:male'}});for(const path of ['','/results/translation-en.txt'])assert.equal((await s.call(path)).status,400);
 await ref(c,'artifacts',c.jobId).set(c.originalArtifact);assert.equal((await s.call('/results/missing.txt')).status,404);assert.equal(c.objects.reads,0);await unchanged(c);
});
