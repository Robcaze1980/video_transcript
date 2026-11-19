import assert from 'node:assert/strict';
import {test,before,after,afterEach} from 'node:test';
import {randomUUID} from 'node:crypto';
import {existsSync,realpathSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {Firestore} from 'firebase-admin/firestore';
import {RESERVE_ATTEMPT_DOCUMENTS,RESERVE_ATTEMPT_PROFILE_V1,prepareReserveAttemptInTransaction,recordReserveAckInTransaction} from './reserveAttemptEvidence.ts';

// These are local synthetic transactions and a minimal test caller, NOT the
// real Account authority or an integrated production admission path.
const contexts=[], expectedTests=8;
let cleaned=0;
const required=new Set(['account','identity','input','project','intent','origin','intentGuard']);
const shaA='a'.repeat(64),shaB='b'.repeat(64);
function assertEnvironment(){
 assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');assert.equal(process.env.LV_RESERVE_EVIDENCE,'1');
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,'demo-vistavo-ledger');assert.equal(process.env.GCLOUD_PROJECT,'demo-vistavo-ledger');
 for(const name of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY','VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID','VISTAVO_AI_ENABLED','VISTAVO_FILES_MODE','VISTAVO_LOCAL_CLOUD','VISTAVO_ACCOUNT_ID','VISTAVO_JOB_ID','VISTAVO_GEMINI_KEY','K_SERVICE','K_REVISION','K_CONFIGURATION','K_JOB','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.ok(!process.env[name],`Unexpected synthetic environment: ${name}`);
 const profile=process.env.APPDATA;assert.ok(profile&&profile===process.env.USERPROFILE&&profile===process.env.LOCALAPPDATA);
 const absolute=resolve(profile),base=resolve('outputs/lv019-b-reserve-evidence-runs'),parts=relative(base,absolute).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function assertClient(c){
 assertEnvironment();assert.match(c.root.path,/^vistavo_reserve_evidence_synthetic\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 assert.equal(c.db.projectId,'demo-vistavo-ledger');assert.equal(c.db.databaseId,'(default)');const s=c.db._settings;
 assert.equal(s?.projectId,'demo-vistavo-ledger');assert.equal(s?.servicePath,'127.0.0.1');assert.equal(s?.port,8185);assert.equal(s?.ssl,false);assert.equal(s?.preferRest,false);
 for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(s?.[key],undefined);
}
async function descendants(doc,found=[]){for(const col of await doc.listCollections())for(const child of await col.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{assertEnvironment();assert.equal((await fetch('http://127.0.0.1:8185/',{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
 assertClient(c);const marker=await c.root.get();
 if(!c.confirmed){assert.equal(marker.exists,false,'Unconfirmed root must not be deleted');assert.deepEqual(await c.root.listCollections(),[]);continue;}
 assert.equal(marker.exists,true);assert.equal(marker.get('marker'),c.marker);assert.equal(marker.get('purpose'),'reserve-evidence-synthetic-v1');
 const known=await descendants(c.root);for(const doc of known)assert.ok(doc.path.startsWith(`${c.root.path}/`));
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await c.root.listCollections(),[]);
 for(const doc of known){assert.equal((await doc.get()).exists,false);assert.deepEqual(await doc.listCollections(),[]);}
 cleaned++;console.log(`Synthetic reserve evidence cleanup verified ${cleaned}/${expectedTests}`);
 }finally{await c.db.terminate();}}});
after(()=>{console.log(`Synthetic reserve evidence cleanup total: ${cleaned}/${expectedTests}`);assert.equal(cleaned,expectedTests);});
async function fixture(){
 assertEnvironment();
 const db=new Firestore({projectId:'demo-vistavo-ledger',host:'127.0.0.1:8185',ssl:false,preferRest:false});
 const root=db.collection('vistavo_reserve_evidence_synthetic').doc(randomUUID()),marker=randomUUID();
 const c={db,root,marker,confirmed:false};contexts.push(c);assertClient(c);
 assert.equal((await root.get()).exists,false);assert.deepEqual(await root.listCollections(),[]);
 await root.create({marker,purpose:'reserve-evidence-synthetic-v1'});assert.equal((await root.get()).get('marker'),marker);c.confirmed=true;
 c.witness={intentId:shaA,accountId:randomUUID(),inputId:randomUUID(),operation:'translation:en',revision:1,
  profile:RESERVE_ATTEMPT_PROFILE_V1,provider:'account_seconds',identityKey:shaB,reservationId:randomUUID(),seconds:2};
 c.sources=Object.fromEntries(RESERVE_ATTEMPT_DOCUMENTS.map(name=>[name,root.collection('source').doc(name)]));
 for(const name of required)await c.sources[name].create({kind:name,accountId:c.witness.accountId,intentId:c.witness.intentId,active:true});
 return c;
}
function docVersion(doc){
 if(!doc.exists)return {exists:false};
 const encode=value=>`${value.seconds}:${String(value.nanoseconds).padStart(9,'0')}`;
 return {exists:true,createTime:encode(doc.createTime),updateTime:encode(doc.updateTime)};
}
async function verifiedAttempt(c,tx,id,witness=c.witness){
 // Synthetic caller demonstrates the required shape of preflight reads; it
 // does not implement or prove the production authorization policy.
 const docs=await tx.getAll(...RESERVE_ATTEMPT_DOCUMENTS.map(name=>c.sources[name]));
 const versions=Object.fromEntries(docs.map((doc,index)=>[RESERVE_ATTEMPT_DOCUMENTS[index],docVersion(doc)]));
 for(let i=0;i<docs.length;i++){
  const name=RESERVE_ATTEMPT_DOCUMENTS[i],doc=docs[i];
  if(required.has(name))assert.equal(doc.exists&&doc.get('kind')===name&&doc.get('active')===true&&doc.get('accountId')===witness.accountId&&doc.get('intentId')===witness.intentId,true);
  else assert.equal(doc.exists,false);
 }
 return {version:1,attemptId:id,witness:{...witness},versions};
}
async function prepare(c,id=randomUUID()){
 return c.db.runTransaction(async tx=>{const attempt=await verifiedAttempt(c,tx,id);return {attempt,result:await prepareReserveAttemptInTransaction(tx,c.root,attempt)};});
}
const ack=a=>({reservationId:a.witness.reservationId,seconds:a.witness.seconds,state:'reserved'});
const attemptRef=(c,a)=>c.root.collection('billingReserveAttempts').doc(a.attemptId);
const ackRef=(c,a)=>c.root.collection('billingReserveAckObservations').doc(a.attemptId);
const ackRecord=(c,a,r=ack(a))=>c.db.runTransaction(tx=>recordReserveAckInTransaction(tx,c.root,a,r));
const errorCode=code=>error=>error?.code===code;
async function noFinancialWrites(c){for(const collection of ['jobs','movements','billingOutbox','billingGuards'])assert.equal((await c.root.collection(collection).get()).empty,true);}

test('preparation and ACK are immutable and idempotent',{timeout:60000},async()=>{
 const c=await fixture(),{attempt,result}=await prepare(c);assert.equal(result.state,'created');assert.equal(result.observation,'unknown');
 assert.deepEqual(await ackRecord(c,attempt),{state:'recorded',attribution:'unverified'});
 const before=await ackRef(c,attempt).get();assert.deepEqual(await ackRecord(c,attempt),{state:'already_recorded',attribution:'unverified'});
 const after=await ackRef(c,attempt).get();assert.ok(before.updateTime.isEqual(after.updateTime));
 const repeated=await c.db.runTransaction(tx=>prepareReserveAttemptInTransaction(tx,c.root,attempt));
 assert.deepEqual(repeated,{state:'already_prepared',observation:'ack_recorded'});
 assert.equal(after.get('attribution'),'unverified');assert.equal(after.get('source'),'reserve_ack');await noFinancialWrites(c);
});

test('concurrent duplicate preparation creates only one immutable marker',{timeout:60000},async()=>{
 const c=await fixture(),id=randomUUID(),results=await Promise.all([prepare(c,id),prepare(c,id)]);
 assert.deepEqual(results.map(x=>x.result.state).sort(),['already_prepared','created']);
 assert.deepEqual(results[0].attempt,results[1].attempt);assert.equal((await c.root.collection('billingReserveAttempts').get()).size,1);
 assert.equal((await c.root.collection('billingReserveAckObservations').get()).size,0);await noFinancialWrites(c);
});

test('concurrent duplicate ACKs create one observation',{timeout:60000},async()=>{
 const c=await fixture(),{attempt}=await prepare(c),results=await Promise.all([ackRecord(c,attempt),ackRecord(c,attempt)]);
 assert.deepEqual(results.map(x=>x.state).sort(),['already_recorded','recorded']);assert.ok(results.every(x=>x.attribution==='unverified'));
 assert.equal((await c.root.collection('billingReserveAckObservations').get()).size,1);await noFinancialWrites(c);
});

test('two attempts preserve the same remote reservation and different histories',{timeout:60000},async()=>{
 const c=await fixture(),first=(await prepare(c)).attempt;await c.sources.identity.update({syntheticGeneration:2});const second=(await prepare(c)).attempt;
 assert.notEqual(first.attemptId,second.attemptId);assert.equal(first.witness.reservationId,second.witness.reservationId);
 assert.notEqual(first.versions.identity.updateTime,second.versions.identity.updateTime);
 await ackRecord(c,second);await ackRecord(c,first);
 assert.equal((await ackRef(c,first).get()).get('snapshot.versions.identity.updateTime'),first.versions.identity.updateTime);
 assert.equal((await ackRef(c,second).get()).get('snapshot.versions.identity.updateTime'),second.versions.identity.updateTime);
 assert.equal((await c.root.collection('billingReserveAttempts').get()).size,2);assert.equal((await c.root.collection('billingReserveAckObservations').get()).size,2);await noFinancialWrites(c);
});

test('a late ACK remains unverified when identity and intent disappeared',{timeout:60000},async()=>{
 const c=await fixture(),{attempt}=await prepare(c);await c.sources.identity.delete();await c.sources.intent.delete();
 assert.deepEqual(await ackRecord(c,attempt),{state:'recorded',attribution:'unverified'});
 const observation=await ackRef(c,attempt).get();assert.equal(observation.get('attribution'),'unverified');assert.equal(observation.get('reservationId'),attempt.witness.reservationId);await noFinancialWrites(c);
});

test('an aborted ACK transaction preserves UNKNOWN and may be retried',{timeout:60000},async()=>{
 const c=await fixture(),{attempt}=await prepare(c);
 await assert.rejects(c.db.runTransaction(async tx=>{await recordReserveAckInTransaction(tx,c.root,attempt,ack(attempt));throw Error('synthetic abort before commit');}),/synthetic abort before commit/);
 assert.equal((await attemptRef(c,attempt).get()).exists,true);assert.equal((await ackRef(c,attempt).get()).exists,false);
 assert.deepEqual(await ackRecord(c,attempt),{state:'recorded',attribution:'unverified'});await noFinancialWrites(c);
});

test('missing altered and orphan attempts do not create or replace evidence',{timeout:60000},async()=>{
 const c=await fixture(),{attempt}=await prepare(c),original=(await attemptRef(c,attempt).get()).data();
 const alternate=structuredClone(attempt);alternate.witness.seconds=3;
 await assert.rejects(c.db.runTransaction(tx=>prepareReserveAttemptInTransaction(tx,c.root,alternate)),errorCode('conflict'));
 assert.deepEqual((await attemptRef(c,attempt).get()).data(),original);
 await attemptRef(c,attempt).update({'witness.seconds':3});await assert.rejects(ackRecord(c,attempt),errorCode('conflict'));
 assert.equal((await ackRef(c,attempt).get()).exists,false);
 await attemptRef(c,attempt).delete();await assert.rejects(ackRecord(c,attempt),errorCode('conflict'));
 await ackRef(c,attempt).create({version:1,source:'orphan'});
 await assert.rejects(c.db.runTransaction(tx=>prepareReserveAttemptInTransaction(tx,c.root,attempt)),errorCode('conflict'));
 assert.equal((await attemptRef(c,attempt).get()).exists,false);assert.deepEqual((await ackRef(c,attempt).get()).data(),{version:1,source:'orphan'});await noFinancialWrites(c);
});

test('an incompatible ACK does not overwrite the original observation',{timeout:60000},async()=>{
 const c=await fixture(),{attempt}=await prepare(c);await ackRecord(c,attempt);const original=await ackRef(c,attempt).get();
 for(const response of [{...ack(attempt),seconds:3},{...ack(attempt),reservationId:randomUUID()},{...ack(attempt),source:'status'}])await assert.rejects(ackRecord(c,attempt,response),errorCode('invalid'));
 const after=await ackRef(c,attempt).get();assert.ok(original.updateTime.isEqual(after.updateTime));assert.deepEqual(original.data(),after.data());await noFinancialWrites(c);
});
