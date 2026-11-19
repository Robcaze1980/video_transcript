import assert from 'node:assert/strict';
import {test,before,after,afterEach} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {existsSync,realpathSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {FirestoreAi} from './firestoreAi.ts';
import {FirestoreFiles} from './firestoreFiles.ts';
import {ObjectFault} from './gcsObjects.ts';
import {AccountBillingClient} from './accountBillingClient.ts';
const sha=value=>createHash('sha256').update(value).digest('hex'),contexts=[],expectedTests=8;
let verifiedCleanups=0;
const ref=(c,col,id)=>c.root.collection(col).doc(id);
class MemoryObjects{
 data=new Map();next=9007199254740993n;puts=0;failPutAt=0;failBarrier=false;pause;
 meta(key){const x=this.data.get(key);return x?{key,generation:x.generation,size:x.bytes.length,...(x.marker?{marker:true}:{})}:null;}
 async metadata(key){return this.meta(key);}
 save(key,bytes,marker=false){this.data.set(key,{generation:String(this.next++),bytes:Buffer.from(bytes),marker});return this.meta(key);}
 async putOnce(key,bytes){const existing=this.data.get(key);if(existing){if(existing.marker||!existing.bytes.equals(bytes))throw new ObjectFault('conflict');return this.meta(key);}return this.save(key,bytes);}
 async putArtifactOnce(key,bytes){this.puts++;if(this.failPutAt===this.puts)throw new ObjectFault('remote');
  // Like a GCS call paused after its metadata GET and before ifGenerationMatch=0 creation.
  const prior=this.data.get(key);if(prior){if(prior.marker||!prior.bytes.equals(bytes))throw new ObjectFault('conflict');return this.meta(key);}
  if(this.pause){const waiting=this.pause;this.pause=null;waiting.enter();await waiting.resume;}
  return this.putOnce(key,bytes);
 }
 async composeOnce(key,sources,size){const old=this.meta(key);if(old){assert.equal(old.size,size);return old;}const parts=sources.map(s=>{const x=this.data.get(s.key);if(!x||x.generation!==s.generation)throw new ObjectFault('missing');return x.bytes;});const bytes=Buffer.concat(parts);assert.equal(bytes.length,size);return this.save(key,bytes);}
 async read(object,range){const x=this.data.get(object.key);if(!x||x.generation!==object.generation)throw new ObjectFault('missing');return Readable.from(range?x.bytes.subarray(range.start,range.end+1):x.bytes);}
 async barrier(key){if(this.failBarrier){this.failBarrier=false;throw new ObjectFault('remote');}const old=this.meta(key);return old?.marker?old:this.save(key,Buffer.alloc(0),true);}
}
function assertSafeEnvironment(){
 assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');assert.equal(process.env.LV_EXTERNAL_REPLAY_STATUS,'1');
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,'demo-vistavo-ledger');assert.equal(process.env.GCLOUD_PROJECT,'demo-vistavo-ledger');
 for(const name of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY','VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID','VISTAVO_AI_ENABLED','VISTAVO_FILES_MODE','VISTAVO_LOCAL_CLOUD','VISTAVO_ACCOUNT_ID','VISTAVO_JOB_ID','VISTAVO_GEMINI_KEY','K_SERVICE','K_REVISION','K_CONFIGURATION','K_JOB','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.ok(!process.env[name],`Unexpected synthetic environment: ${name}`);
 const profile=process.env.APPDATA;assert.ok(profile&&profile===process.env.USERPROFILE&&profile===process.env.LOCALAPPDATA);
 const absolute=resolve(profile),base=resolve('outputs/lv019-b-external-replay-status-runs'),parts=relative(base,absolute).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(c){
 assertSafeEnvironment();assert.match(c.root.path,/^vistavo_external_replay_status_synthetic\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 assert.equal(c.db.projectId,'demo-vistavo-ledger');assert.equal(c.db.databaseId,'(default)');const s=c.db._settings;
 assert.equal(s?.projectId,'demo-vistavo-ledger');assert.equal(s?.servicePath,'127.0.0.1');assert.equal(s?.port,8185);assert.equal(s?.ssl,false);assert.equal(s?.preferRest,false);
 for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(s?.[key],undefined);
}
async function descendants(document,found=[]){for(const collection of await document.listCollections())for(const child of await collection.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{assertSafeEnvironment();assert.equal((await fetch('http://127.0.0.1:8185/',{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){globalThis.fetch=c.originalFetch;try{
 assertSafeClient(c);const marker=await c.root.get();
 if(!c.confirmed){assert.equal(marker.exists,false,'Unconfirmed root must not be deleted');assert.deepEqual(await c.root.listCollections(),[]);continue;}
 assert.equal(marker.exists,true);assert.equal(marker.get('marker'),c.marker);assert.equal(marker.get('purpose'),'external-replay-status-synthetic-v1');
 const known=await descendants(c.root);for(const document of known)assert.ok(document.path.startsWith(`${c.root.path}/`));
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await c.root.listCollections(),[]);
 for(const document of known){assert.equal((await document.get()).exists,false);assert.deepEqual(await document.listCollections(),[]);}
 verifiedCleanups++;console.log(`Synthetic external replay status cleanup verified ${verifiedCleanups}/${expectedTests}`);
 }finally{await c.db.terminate();}}});
after(()=>{console.log(`Synthetic external replay status cleanup total: ${verifiedCleanups}/${expectedTests}`);assert.equal(verifiedCleanups,expectedTests);});
async function fixture(){
 assertSafeEnvironment();
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:false}),root=db.collection('vistavo_external_replay_status_synthetic').doc(randomUUID()),backend=new FirestoreBackend(db,root),objects=new MemoryObjects(),marker=randomUUID();
 assert.equal(db.projectId,'demo-vistavo-ledger');assert.equal(db.databaseId,'(default)');assert.equal(db._settings?.servicePath,'127.0.0.1');assert.equal(db._settings?.port,8185);assert.equal(db._settings?.ssl,false);
 const ai=new FirestoreAi(db,root,backend,objects),files=new FirestoreFiles(db,root,objects,{chunkBytes:4},(account,input)=>ai.purgeInput(account,input));
 const c={db,root,backend,objects,ai,files,marker,confirmed:false,providerAttempts:0,originalFetch:globalThis.fetch};contexts.push(c);
 assertSafeClient(c);
 // This guard covers fetch only; it is not an OS firewall for native modules.
 globalThis.fetch=async(request,init)=>{const raw=request instanceof Request?request.url:String(request),url=new URL(raw);if(url.hostname!=='127.0.0.1'||url.port!=='8185'){c.providerAttempts++;throw Error('synthetic fixture blocks outbound fetch');}return c.originalFetch(request,init);};
 assert.equal((await root.get()).exists,false);assert.deepEqual(await root.listCollections(),[]);await root.create({marker,purpose:'external-replay-status-synthetic-v1'});assert.equal((await root.get()).get('marker'),marker);c.confirmed=true;
 const uid='fixture-ai-owner-'+randomUUID(),foreignUid='fixture-ai-foreign-'+randomUUID(),account=await backend.accountForUid(uid),foreign=await backend.accountForUid(foreignUid);
 Object.assign(c,{uid,foreignUid,account,foreign});
 for(const who of [account,foreign])await ref(c,'accounts',who).update({aiPilot:true,simulationOnly:true});
 await backend.creditVerifiedPurchase(account,'fixture-'+randomUUID(),100,1,'synthetic-ai-integration','sandbox');
 const source=Buffer.from('abcdefghijkl'),u=await files.begin(account,'synthetic-emulator.mp4',source.length,sha(source),randomUUID());
 for(let at=0;at<source.length;at+=4)await files.append(account,u.id,at,source.subarray(at,at+4));await files.complete(account,u.id);
 await files.work(u.id,'validate',{inspect:async()=>({sha256:sha(source),video:{duration:2,width:320,height:180,audioTracks:1}})});await files.work(u.id,'cleanup');
 c.input=u.id;c.source=source;await backend.saveProject(account,u.id,0,'');return c;
}

// Synthetic Account transport: the in-memory effect, response delivery and
// local Firestore commit are separate events. No real Account API is contacted.
function fakeAccount(c){
 const calls=[],reservations=new Map(),balance={credited:30,available:30,reserved:0,consumed:0},responses={valid:0,lost:0,malformed:0,status:0},waiters=[];
 const options={loseNextReserveResponse:false,statusUnavailable:false,malformNextReserveResponse:false};
 let gate;
 function pauseNextReserve(){assert.equal(gate,undefined);let enter,release;
  const entered=new Promise(resolve=>{enter=resolve;}),resume=new Promise(resolve=>{release=resolve;});gate={enter,resume};return {entered,release};}
 function waitForReservePosts(count){
  if(calls.filter(call=>call.path.endsWith('/reservations')).length>=count)return Promise.resolve();
  return new Promise(resolve=>waiters.push({count,resolve}));
 }
 // Account's response contains no identity. The internal map uses identityKey
 // solely to simulate Account's own ownership and idempotency checks.
 const receipt=current=>({reservationId:current.reservationId,seconds:current.seconds,state:current.state});
 const client=new AccountBillingClient(undefined,{request:async request=>{
  const path=new URL(request.url).pathname,data={...request.data};calls.push({path,data});
  if(path.endsWith('/reservations')){
   const posts=calls.filter(call=>call.path.endsWith('/reservations')).length;
   for(let i=waiters.length-1;i>=0;i--)if(waiters[i].count<=posts)waiters.splice(i,1)[0].resolve();
   let current=reservations.get(data.reservationId);
   if(current&&(current.identityKey!==data.identityKey||current.seconds!==data.seconds||current.state!=='reserved'))throw {response:{status:409}};
   if(!current){if(balance.available<data.seconds)throw {response:{status:402}};
    current={identityKey:data.identityKey,reservationId:data.reservationId,seconds:data.seconds,state:'reserved'};
    reservations.set(data.reservationId,current);balance.available-=data.seconds;balance.reserved+=data.seconds;}
   if(gate){const waiting=gate;gate=undefined;waiting.enter();await waiting.resume;}
   if(options.loseNextReserveResponse){options.loseNextReserveResponse=false;responses.lost++;throw Error('synthetic response lost after effect');}
   if(options.malformNextReserveResponse){options.malformNextReserveResponse=false;responses.malformed++;return {data:{...receipt(current),seconds:current.seconds+1}};}
   responses.valid++;
   return {data:receipt(current)};
  }
  if(path.endsWith('/status')){
   if(options.statusUnavailable)throw Error('synthetic status unavailable');
   const reservationId=path.split('/').at(-2),current=reservations.get(reservationId);
   if(!current||current.identityKey!==data.identityKey)throw {response:{status:404}};
   responses.status++;
   return {data:receipt(current)};
  }
  // No fake release or capture is implemented. Their occurrence remains
  // visible in calls and cannot be mistaken for a real refund or charge.
  throw Error('unexpected synthetic Account endpoint');
 }});
 return {ai:new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,client),calls,reservations,balance,responses,options,pauseNextReserve,waitForReservePosts};
}
const observed=promise=>promise.then(value=>({value}),error=>({error}));
const identity=c=>ref(c,'identities',sha(JSON.stringify(['firebase',c.uid])));
const requestId=(c,key)=>sha(JSON.stringify([c.account,key]));
const enqueue=(c,account,key)=>account.ai.enqueue(c.account,c.input,'translation:en',1,key,c.uid);
const countPosts=account=>account.calls.filter(call=>call.path.endsWith('/reservations')).length;
async function waitReached(entered,pending){let timer;try{await Promise.race([entered,pending.then(()=>{throw Error('operation ended before synthetic barrier');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('synthetic barrier timed out')),10000);})]);}finally{clearTimeout(timer);}}
async function jobRows(c){return (await c.root.collection('jobs').get()).docs.filter(doc=>doc.get('inputId')===c.input);}
async function noProvider(c){assert.equal(c.providerAttempts,0);assert.equal((await c.root.collection('providerCalls').get()).size,0);}
async function noRelease(account){assert.equal(account.calls.some(call=>call.path.endsWith('/release')),false);}
async function intentState(c,key){
 const id=requestId(c,key),[intent,origin]=await Promise.all([ref(c,'billingIntents',id).get(),ref(c,'billingIntentWitnesses',id).get()]);
 return {id,intent:intent.data(),origin:origin.data()};
}
async function reserveAckObservations(c,key){
 const id=requestId(c,key),docs=await c.root.collection('billingReserveAckObservations').where('intentId','==',id).get();return docs.docs.map(doc=>doc.data());
}
async function confirmedAck(c,key,account,attribution){
 const rows=await reserveAckObservations(c,key),[reservationId,stored]=[...account.reservations.entries()][0];
 assert.ok(rows.length>=1,'A validated reserve ACK needs durable correlated evidence');
 assert.ok(rows.some(row=>row.version===1&&row.intentId===requestId(c,key)&&row.identityKey===stored.identityKey&&
  row.reservationId===reservationId&&row.seconds===stored.seconds&&row.source==='reserve_ack'&&row.state==='reserved'&&row.attribution===attribution));
}

// The external job below is created only in the local emulator using the
// legacy internal path and an in-memory Account. It is NOT evidence that the
// legacy direct POST path is safe for production.
async function legacyFixture(){
 const c=await fixture(),account=fakeAccount(c),key=randomUUID(),job=await enqueue(c,account,key);
 assert.equal(countPosts(account),1);assert.equal(account.balance.reserved,2);assert.equal((await jobRows(c)).length,1);
 return {c,account,key,job};
}
async function assertNoAdditionalAccountAction(c,account,expectedPosts=1){
 assert.equal(countPosts(account),expectedPosts);
 assert.equal(account.calls.every(call=>call.path.endsWith('/reservations')||call.path.endsWith('/status')),true,'Unexpected synthetic Account operation');
 await noProvider(c);
}
async function authorizedLookupAfterRestore(c,account,job,savedIdentity){
 await identity(c).set(savedIdentity);assert.equal((await account.ai.status(c.account,job,c.uid)).id,job);
 await assertNoAdditionalAccountAction(c,account);
}

test('external admission without UID does not consult Account or create a job',{timeout:60000},async()=>{
 const c=await fixture(),account=fakeAccount(c),key=randomUUID(),result=await observed(account.ai.enqueue(c.account,c.input,'translation:en',1,key));
 assert.equal(result.error?.code,'invalid');assert.equal(countPosts(account),0);assert.equal((await jobRows(c)).length,0);
 assert.equal((await reserveAckObservations(c,key)).length,0);await assertNoAdditionalAccountAction(c,account,0);
});

test('removed identity cannot replay an external job and authorized lookup remains separate',{timeout:60000},async()=>{
 const {c,account,key,job}=await legacyFixture(),saved=(await identity(c).get()).data();await identity(c).delete();
 const result=await observed(enqueue(c,account,key));assert.equal(result.error?.code,'not_found');assert.equal(result.value,undefined);
 assert.equal((await jobRows(c)).length,1);await assertNoAdditionalAccountAction(c,account);await authorizedLookupAfterRestore(c,account,job,saved);
});

test('reassigned identity cannot replay an external job or fence another account',{timeout:60000},async()=>{
 const {c,account,key,job}=await legacyFixture(),saved=(await identity(c).get()).data(),guard=ref(c,'billingGuards',c.foreign),before=(await guard.get()).data();
 await identity(c).update({accountId:c.foreign});const result=await observed(enqueue(c,account,key));
 assert.equal(result.error?.code,'not_found');assert.equal(result.value,undefined);assert.deepEqual((await guard.get()).data(),before);
 assert.equal((await jobRows(c)).length,1);await assertNoAdditionalAccountAction(c,account);await authorizedLookupAfterRestore(c,account,job,saved);
});

test('identity removed after enablement is rechecked inside the replay transaction',{timeout:60000},async()=>{
 const {c,account,key,job}=await legacyFixture(),saved=(await identity(c).get()).data(),original=c.backend.priorExternalRequestForEnqueue.bind(c.backend);let reached=0;
 c.backend.priorExternalRequestForEnqueue=async(...args)=>{reached++;await identity(c).delete();return original(...args);};
 const result=await observed(enqueue(c,account,key));assert.equal(reached,1);assert.equal(result.error?.code,'not_found');assert.equal(result.value,undefined);
 assert.equal((await jobRows(c)).length,1);await assertNoAdditionalAccountAction(c,account);await authorizedLookupAfterRestore(c,account,job,saved);
});

test('identity reassigned after enablement is rechecked inside the replay transaction',{timeout:60000},async()=>{
 const {c,account,key,job}=await legacyFixture(),saved=(await identity(c).get()).data(),original=c.backend.priorExternalRequestForEnqueue.bind(c.backend),guard=ref(c,'billingGuards',c.foreign),before=(await guard.get()).data();let reached=0;
 c.backend.priorExternalRequestForEnqueue=async(...args)=>{reached++;await identity(c).update({accountId:c.foreign});return original(...args);};
 const result=await observed(enqueue(c,account,key));assert.equal(reached,1);assert.equal(result.error?.code,'not_found');assert.equal(result.value,undefined);
 assert.deepEqual((await guard.get()).data(),before);assert.equal((await jobRows(c)).length,1);
 await assertNoAdditionalAccountAction(c,account);await authorizedLookupAfterRestore(c,account,job,saved);
});

test('reserved status after a lost POST is not an ACK job or refund',{timeout:60000},async()=>{
 const c=await fixture(),account=fakeAccount(c),key=randomUUID();account.options.loseNextReserveResponse=true;
 const result=await observed(enqueue(c,account,key));assert.equal(result.error?.code,'unknown');assert.equal(result.value,undefined);
 assert.equal(countPosts(account),1);assert.equal(account.responses.lost,1);assert.equal(account.responses.valid,0);assert.equal(account.responses.status,1);
 assert.equal(account.balance.reserved,2);assert.equal((await jobRows(c)).length,0);assert.equal((await reserveAckObservations(c,key)).length,0);
 assert.equal((await intentState(c,key)).intent?.state,'reserve_pending');await assertNoAdditionalAccountAction(c,account);
});

test('background status reserved cannot create a job or release balance',{timeout:60000},async()=>{
 const c=await fixture(),account=fakeAccount(c),key=randomUUID();account.options.loseNextReserveResponse=true;
 const first=await observed(enqueue(c,account,key));assert.equal(first.error?.code,'unknown');
 const drain=await account.ai.drainExternalBilling();assert.equal(drain.intentsRecovered,0);assert.equal(drain.intentsFailed,1);
 assert.equal(account.responses.status,2);assert.equal(account.balance.reserved,2);assert.equal((await jobRows(c)).length,0);
 assert.equal((await reserveAckObservations(c,key)).length,0);assert.equal((await intentState(c,key)).intent?.state,'reserve_pending');
 await assertNoAdditionalAccountAction(c,account);
});

test('authorized simulated text admission remains available without Account',{timeout:60000},async()=>{
 const c=await fixture(),ai=new FirestoreAi(c.db,c.root,c.backend,c.objects),key=randomUUID();
 const job=await ai.enqueueForUid(c.account,c.input,'translation:en',1,key,c.uid),status=await ai.status(c.account,job,c.uid);
 assert.equal(status.id,job);assert.equal(status.state,'queued');assert.equal(status.billing.mode,'simulation');
 assert.equal((await jobRows(c)).length,1);assert.equal((await ref(c,'movements','reserve:'+job).get()).exists,true);
 assert.equal((await reserveAckObservations(c,key)).length,0);await noProvider(c);
});

