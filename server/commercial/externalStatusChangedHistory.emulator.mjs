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
const sha=value=>createHash('sha256').update(value).digest('hex'),contexts=[],expectedTests=10;
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
 assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');assert.equal(process.env.LV_STATUS_CHANGED_HISTORY,'1');
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,'demo-vistavo-ledger');assert.equal(process.env.GCLOUD_PROJECT,'demo-vistavo-ledger');
 for(const name of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY','VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID','VISTAVO_AI_ENABLED','VISTAVO_FILES_MODE','VISTAVO_LOCAL_CLOUD','VISTAVO_ACCOUNT_ID','VISTAVO_JOB_ID','VISTAVO_GEMINI_KEY','K_SERVICE','K_REVISION','K_CONFIGURATION','K_JOB','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.ok(!process.env[name],`Unexpected synthetic environment: ${name}`);
 const profile=process.env.APPDATA;assert.ok(profile&&profile===process.env.USERPROFILE&&profile===process.env.LOCALAPPDATA);
 const absolute=resolve(profile),base=resolve('outputs/lv019-b-status-changed-history-runs'),parts=relative(base,absolute).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(c){
 assertSafeEnvironment();assert.match(c.root.path,/^vistavo_status_changed_history_synthetic\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 assert.equal(c.db.projectId,'demo-vistavo-ledger');assert.equal(c.db.databaseId,'(default)');const s=c.db._settings;
 assert.equal(s?.projectId,'demo-vistavo-ledger');assert.equal(s?.servicePath,'127.0.0.1');assert.equal(s?.port,8185);assert.equal(s?.ssl,false);assert.equal(s?.preferRest,false);
 for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(s?.[key],undefined);
}
async function descendants(document,found=[]){for(const collection of await document.listCollections())for(const child of await collection.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{assertSafeEnvironment();assert.equal((await fetch('http://127.0.0.1:8185/',{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){globalThis.fetch=c.originalFetch;try{
 assertSafeClient(c);const marker=await c.root.get();
 if(!c.confirmed){assert.equal(marker.exists,false,'Unconfirmed root must not be deleted');assert.deepEqual(await c.root.listCollections(),[]);continue;}
 assert.equal(marker.exists,true);assert.equal(marker.get('marker'),c.marker);assert.equal(marker.get('purpose'),'status-changed-history-synthetic-v1');
 const known=await descendants(c.root);for(const document of known)assert.ok(document.path.startsWith(`${c.root.path}/`));
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await c.root.listCollections(),[]);
 for(const document of known){assert.equal((await document.get()).exists,false);assert.deepEqual(await document.listCollections(),[]);}
 verifiedCleanups++;console.log(`Synthetic status changed history cleanup verified ${verifiedCleanups}/${expectedTests}`);
 }finally{await c.db.terminate();}}});
after(()=>{console.log(`Synthetic status changed history cleanup total: ${verifiedCleanups}/${expectedTests}`);assert.equal(verifiedCleanups,expectedTests);});
async function fixture(){
 assertSafeEnvironment();
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:false}),root=db.collection('vistavo_status_changed_history_synthetic').doc(randomUUID()),backend=new FirestoreBackend(db,root),objects=new MemoryObjects(),marker=randomUUID();
 assert.equal(db.projectId,'demo-vistavo-ledger');assert.equal(db.databaseId,'(default)');assert.equal(db._settings?.servicePath,'127.0.0.1');assert.equal(db._settings?.port,8185);assert.equal(db._settings?.ssl,false);
 const ai=new FirestoreAi(db,root,backend,objects),files=new FirestoreFiles(db,root,objects,{chunkBytes:4},(account,input)=>ai.purgeInput(account,input));
 const c={db,root,backend,objects,ai,files,marker,confirmed:false,providerAttempts:0,originalFetch:globalThis.fetch};contexts.push(c);
 assertSafeClient(c);
 // This guard covers fetch only; it is not an OS firewall for native modules.
 globalThis.fetch=async(request,init)=>{const raw=request instanceof Request?request.url:String(request),url=new URL(raw);if(url.hostname!=='127.0.0.1'||url.port!=='8185'){c.providerAttempts++;throw Error('synthetic fixture blocks outbound fetch');}return c.originalFetch(request,init);};
 assert.equal((await root.get()).exists,false);assert.deepEqual(await root.listCollections(),[]);await root.create({marker,purpose:'status-changed-history-synthetic-v1'});assert.equal((await root.get()).get('marker'),marker);c.confirmed=true;
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
 let gate,statusGate;
 function pauseNextReserve(){assert.equal(gate,undefined);let enter,release;
  const entered=new Promise(resolve=>{enter=resolve;}),resume=new Promise(resolve=>{release=resolve;});gate={enter,resume};return {entered,release};}
 function waitForReservePosts(count){
  if(calls.filter(call=>call.path.endsWith('/reservations')).length>=count)return Promise.resolve();
  return new Promise(resolve=>waiters.push({count,resolve}));
 }
 function pauseNextStatus(){assert.equal(statusGate,undefined);let enter,release;
  const entered=new Promise(resolve=>{enter=resolve;}),resume=new Promise(resolve=>{release=resolve;});statusGate={enter,resume};return {entered,release};}
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
   if(statusGate){const waiting=statusGate;statusGate=undefined;waiting.enter();await waiting.resume;}
   responses.status++;
   return {data:receipt(current)};
  }
  // No fake release or capture is implemented. Their occurrence remains
  // visible in calls and cannot be mistaken for a real refund or charge.
  throw Error('unexpected synthetic Account endpoint');
 }});
 return {ai:new FirestoreAi(c.db,c.root,c.backend,c.objects,undefined,client),calls,reservations,balance,responses,options,pauseNextReserve,waitForReservePosts,pauseNextStatus};
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

// A job is injected with the trusted internal method solely to reproduce a
// concurrent local write. The fixture does not establish a real reserve ACK.
async function changedStatus(mode,change){
 const c=await fixture(),account=fakeAccount(c),key=randomUUID(),gate=account.pauseNextStatus();let billing,pending;
 if(mode==='enqueue'){
  account.options.loseNextReserveResponse=true;pending=observed(enqueue(c,account,key));
 }else{
  const identityKey=sha(JSON.stringify(['firebase',c.uid])),reservationId=randomUUID();
  billing={provider:'account_seconds',identityKey,reservationId,seconds:2};
  await c.backend.beginExternalBillingIntent(c.account,c.input,key,'translation:en',1,billing);
  account.reservations.set(reservationId,{identityKey,reservationId,seconds:2,state:'reserved'});account.balance.available=28;account.balance.reserved=2;
  pending=observed(account.ai.drainExternalBilling());
 }
 try{
  await waitReached(gate.entered,pending);
  if(!billing){const [reservationId,held]=[...account.reservations.entries()][0];billing={provider:'account_seconds',identityKey:held.identityKey,reservationId,seconds:held.seconds};}
  const job=await c.backend.reserve(c.account,c.input,key,2,'translation:en',1,'ai-candidate-v1',billing,undefined,c.uid);
  const jobBefore=(await ref(c,'jobs',job).get()).data(),balanceBefore=await c.backend.readBalance(c.account),savedIdentity=(await identity(c).get()).data();
  const intentId=requestId(c,key),foreignGuard=ref(c,'billingGuards',c.foreign),foreignBefore=(await foreignGuard.get()).data();
  if(change==='marker')await ref(c,'billingIntentJobMarkers',intentId).delete();
  if(change==='identity')await identity(c).update({accountId:c.foreign});
  if(change==='guard')await ref(c,'billingGuards',c.account).create({accountId:c.account,blocked:true});
  gate.release();const outcome=await pending;
  if(mode==='enqueue'){assert.equal(outcome.value,undefined);assert.equal(outcome.error?.code,'unknown');}
  else{assert.equal(outcome.error,undefined);assert.equal(outcome.value?.intentsRecovered,0);assert.equal(outcome.value?.intentsFailed,1);}
  assert.equal((await jobRows(c)).length,1);assert.deepEqual((await ref(c,'jobs',job).get()).data(),jobBefore);
  assert.deepEqual(await c.backend.readBalance(c.account),balanceBefore);assert.equal(account.balance.reserved,2);
  assert.deepEqual(account.calls.map(x=>x.path.endsWith('/reservations')?'reserve':x.path.endsWith('/status')?'status':'unexpected'),mode==='enqueue'?['reserve','status']:['status']);
  assert.equal(account.responses.valid,0);assert.equal(account.responses.status,1);
  const incidents=await c.root.collection('billingIntentObservationIncidents').get();assert.equal(incidents.size,1);
  assert.equal(incidents.docs[0].get('source'),'status');assert.equal(incidents.docs[0].get('observedState'),'reserved');
  assert.equal((await reserveAckObservations(c,key)).length,0);assert.deepEqual((await foreignGuard.get()).data(),foreignBefore);
  const beforeRetryCalls=account.calls.length,retry=await observed(enqueue(c,account,key));assert.equal(retry.value,undefined);assert.equal(retry.error?.code,change==='identity'?'not_found':'conflict');
  assert.equal(account.calls.length,beforeRetryCalls,'A retry must not contact synthetic Account after the incident');
  if(change==='identity'){
   await assert.rejects(()=>account.ai.status(c.account,job,c.uid),error=>error?.code==='not_found');await identity(c).set(savedIdentity);
  }
  assert.equal((await account.ai.status(c.account,job,c.uid)).id,job);
  assert.equal(account.calls.some(call=>call.path.endsWith('/release')||call.path.endsWith('/capture')||call.path.endsWith('/seal')),false);await noProvider(c);
 }finally{gate.release();await pending;}
}

for(const mode of ['enqueue','drain'])for(const change of ['none','marker','identity','guard']){
 test(`changed ${change} during ${mode} status remains an incident`,{timeout:60000},async()=>changedStatus(mode,change));
}

test('matching reserved status without ACK returns conflict rather than silently succeeding',{timeout:60000},async()=>{
 const c=await fixture(),key=randomUUID(),identityKey=sha(JSON.stringify(['firebase',c.uid])),billing={provider:'account_seconds',identityKey,reservationId:randomUUID(),seconds:2};
 await c.backend.beginExternalBillingIntent(c.account,c.input,key,'translation:en',1,billing);
 const witness=await c.backend.externalIntentWitness(c.account,key,billing),snapshot=await c.backend.captureDirectObservation(witness,key,'status');assert.ok(snapshot);
 const before=await c.backend.readBalance(c.account),otherBefore=await c.backend.readBalance(c.foreign),intentBefore=(await ref(c,'billingIntents',requestId(c,key)).get()).data();
 const result=await observed(c.backend.reserve(c.account,c.input,key,2,'translation:en',1,'ai-candidate-v1',billing,snapshot,c.uid));
 assert.equal(result.value,undefined);assert.equal(result.error?.code,'conflict');assert.equal((await jobRows(c)).length,0);
 assert.equal((await reserveAckObservations(c,key)).length,0);assert.deepEqual(await c.backend.readBalance(c.account),before);
 assert.deepEqual(await c.backend.readBalance(c.foreign),otherBefore);assert.deepEqual((await ref(c,'billingIntents',requestId(c,key)).get()).data(),intentBefore);await noProvider(c);
});

test('direct synthetic ACK with valid UID creates one local legacy job',{timeout:60000},async()=>{
 const c=await fixture(),account=fakeAccount(c),key=randomUUID(),job=await enqueue(c,account,key);
 assert.equal((await jobRows(c)).length,1);assert.equal((await jobRows(c))[0].id,job);assert.equal(countPosts(account),1);
 assert.equal(account.responses.valid,1);assert.equal(account.balance.reserved,2);await noRelease(account);await noProvider(c);
});

