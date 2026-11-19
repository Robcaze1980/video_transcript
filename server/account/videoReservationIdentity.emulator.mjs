import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { Firestore } from 'firebase-admin/firestore';
import { AccountStore } from './backend.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_account_reservation_synthetic',expectedTests=5;
const contexts=[];let verifiedCleanups=0;
function environment(){
 assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);
 for(const name of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN',
  'GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY',
  'VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT',
  'GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID','K_SERVICE','K_REVISION','K_CONFIGURATION','K_JOB',
  'FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.ok(!process.env[name],`Unexpected test environment: ${name}`);
 const profile=process.env.APPDATA;assert.ok(profile&&profile===process.env.USERPROFILE&&profile===process.env.LOCALAPPDATA);
 const absolute=resolve(profile),base=resolve('outputs/lv019-b-account-reservation-runs'),parts=relative(base,absolute).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());
 assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function safeClient(c){
 environment();assert.match(c.root.path,/^vistavo_account_reservation_synthetic\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 assert.equal(c.db.projectId,project);assert.equal(c.db.databaseId,'(default)');const s=c.db._settings;
 assert.equal(s?.projectId,project);assert.equal(s?.servicePath,'127.0.0.1');assert.equal(s?.port,8185);assert.equal(s?.ssl,false);assert.equal(s?.preferRest,false);
 for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(s?.[key],undefined);
}
async function descendants(document,found=[]){for(const childCollection of await document.listCollections())for(const child of await childCollection.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{environment();assert.equal((await fetch(`http://${host}/`,{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0))try{
 safeClient(c);const marker=await c.root.get();
 if(!c.confirmed){assert.equal(marker.exists,false,'Unconfirmed root is preserved');assert.deepEqual(await c.root.listCollections(),[]);continue;}
 assert.equal(marker.get('marker'),c.marker);assert.equal(marker.get('purpose'),'account-reservation-identity-synthetic-v1');
 const known=await descendants(c.root);for(const doc of known)assert.ok(doc.path.startsWith(`${c.root.path}/`));
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await c.root.listCollections(),[]);
 for(const doc of known){assert.equal((await doc.get()).exists,false);assert.deepEqual(await doc.listCollections(),[]);}
 verifiedCleanups++;console.log(`Synthetic account reservation cleanup verified ${verifiedCleanups}/${expectedTests}`);
}finally{await c.db.terminate();}});
after(()=>{console.log(`Synthetic account reservation cleanup total: ${verifiedCleanups}/${expectedTests}`);assert.equal(verifiedCleanups,expectedTests);});
async function fixture(){
 environment();const db=new Firestore({projectId:project,host,ssl:false,preferRest:false}),root=db.collection(collection).doc(randomUUID());
 const c={db,root,marker:randomUUID(),confirmed:false};contexts.push(c);safeClient(c);
 assert.equal((await root.get()).exists,false);assert.deepEqual(await root.listCollections(),[]);
 await root.create({marker:c.marker,purpose:'account-reservation-identity-synthetic-v1'});assert.equal((await root.get()).get('marker'),c.marker);c.confirmed=true;
 c.store=new AccountStore(db,root);c.uid=`synthetic-balance-${randomUUID()}`;c.key=AccountStore.identityKey(c.uid);
 c.boot=await c.store.bootstrap(c.uid);c.account=root.collection('accounts').doc(c.boot.account.id);c.identity=root.collection('identities').doc(c.key);
 await c.account.update({credited:10,available:10});c.reservationId=randomUUID();await c.store.reserveVideo(c.key,c.reservationId,3);c.reservation=root.collection('videoReservations').doc(createHash('sha256').update(JSON.stringify([c.boot.account.id,c.reservationId])).digest('hex'));return c;
}
const outcome=promise=>promise.then(value=>({value}),error=>({error}));
const gate=()=>{let enter,release;return {entered:new Promise(r=>{enter=r;}),resume:new Promise(r=>{release=r;}),enter:()=>enter(),release:()=>release()};};

test('authorized reservation and another account remain isolated',{timeout:60000},async()=>{
 const c=await fixture(),otherUid=`synthetic-other-${randomUUID()}`;await c.store.bootstrap(otherUid);const otherKey=AccountStore.identityKey(otherUid);
 assert.deepEqual(await c.store.videoReservation(c.key,c.reservationId),{reservationId:c.reservationId,seconds:3,state:'reserved'});
 await assert.rejects(c.store.videoReservation(otherKey,c.reservationId),error=>error.code==='not_found');
 assert.equal((await c.account.get()).get('reserved'),3);
});

test('missing or inconsistent reservation identities fail closed',{timeout:60000},async()=>{
 const c=await fixture(),initial=(await c.identity.get()).data(),reservation=(await c.reservation.get()).data();
 await c.identity.delete();await assert.rejects(c.store.videoReservation(c.key,c.reservationId),error=>error.code==='account_not_provisioned');
 await c.identity.set({...initial,uid:'synthetic-other'});await assert.rejects(c.store.videoReservation(c.key,c.reservationId),error=>error.code==='invariant');
 await c.identity.set(initial);await c.reservation.update({identityKey:'b'.repeat(64)});await assert.rejects(c.store.videoReservation(c.key,c.reservationId),error=>error.code==='invariant');
 await c.reservation.set(reservation);await c.reservation.update({seconds:0});await assert.rejects(c.store.videoReservation(c.key,c.reservationId),error=>error.code==='invariant');
});

test('reservation status reads identity and reservation through one transaction',{timeout:60000},async()=>{
 const c=await fixture(),reads=[];let directIdentityReads=0;
 const root={collection:name=>({doc:id=>{
  const ref=c.root.collection(name).doc(id);
  if(name==='identities'&&id===c.key){const direct=ref.get.bind(ref);Object.defineProperty(ref,'get',{configurable:true,value:async()=>{
   directIdentityReads++;const captured=await direct();await c.identity.delete();return captured;
  }});}
  return ref;
 }})};
 const db={runTransaction:callback=>c.db.runTransaction(tx=>callback({get:async ref=>{reads.push(ref.path);return tx.get(ref);}}))};
 const store=new AccountStore(db,root),value=await store.videoReservation(c.key,c.reservationId);
 assert.equal(value.state,'reserved');assert.equal(value.seconds,3);assert.equal(directIdentityReads,0);
 assert.ok(reads.includes(c.identity.path));assert.ok(reads.includes(c.reservation.path));assert.equal((await c.identity.get()).exists,true);
});

test('identity removed before reservation transaction denies the status read',{timeout:60000},async()=>{
 const c=await fixture(),waiting=gate();
 const db={runTransaction:async callback=>{waiting.enter();await waiting.resume;return c.db.runTransaction(callback);}};
 const store=new AccountStore(db,c.root),pending=outcome(store.videoReservation(c.key,c.reservationId));
 try{await waiting.entered;await c.identity.delete();waiting.release();const result=await pending;
  assert.equal(result.error?.code,'account_not_provisioned');assert.equal(result.value,undefined);assert.equal((await c.reservation.get()).get('state'),'reserved');
 }finally{waiting.release();}
});

test('concurrent identity removal permits only a serializable status and blocks later reads',{timeout:60000},async()=>{
 const c=await fixture(),waiting=gate();let once=true;
 const db={runTransaction:callback=>c.db.runTransaction(tx=>callback({get:async ref=>{
  const snapshot=await tx.get(ref);if(once&&ref.path===c.identity.path){once=false;waiting.enter();await waiting.resume;}return snapshot;
 }}))};
 const store=new AccountStore(db,c.root),pending=outcome(store.videoReservation(c.key,c.reservationId));
 try{
  await waiting.entered;const removal=c.identity.delete();waiting.release();const [result]=await Promise.all([pending,removal]);
  if(result.error)assert.equal(result.error.code,'account_not_provisioned');else assert.deepEqual(result.value,{reservationId:c.reservationId,seconds:3,state:'reserved'});
  // Either serialization is allowed. No test can retract an earlier response.
  await assert.rejects(c.store.videoReservation(c.key,c.reservationId),error=>error.code==='account_not_provisioned');
 }finally{waiting.release();}
});

