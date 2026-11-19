import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { Firestore } from 'firebase-admin/firestore';
import { AccountStore } from './backend.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_account_user_read_synthetic',expectedTests=7;
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
 const absolute=resolve(profile),base=resolve('outputs/lv019-b-account-user-read-runs'),parts=relative(base,absolute).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());
 assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function safeClient(c){
 environment();assert.match(c.root.path,/^vistavo_account_user_read_synthetic\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 assert.equal(c.db.projectId,project);assert.equal(c.db.databaseId,'(default)');const s=c.db._settings;
 assert.equal(s?.projectId,project);assert.equal(s?.servicePath,'127.0.0.1');assert.equal(s?.port,8185);assert.equal(s?.ssl,false);assert.equal(s?.preferRest,false);
 for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(s?.[key],undefined);
}
async function descendants(document,found=[]){for(const childCollection of await document.listCollections())for(const child of await childCollection.listDocuments()){found.push(child);await descendants(child,found);}return found;}
before(async()=>{environment();assert.equal((await fetch(`http://${host}/`,{signal:AbortSignal.timeout(5000)})).status,200);});
afterEach(async()=>{for(const c of contexts.splice(0))try{
 safeClient(c);const marker=await c.root.get();
 if(!c.confirmed){assert.equal(marker.exists,false,'Unconfirmed root is preserved');assert.deepEqual(await c.root.listCollections(),[]);continue;}
 assert.equal(marker.get('marker'),c.marker);assert.equal(marker.get('purpose'),'account-user-read-identity-synthetic-v1');
 const known=await descendants(c.root);for(const doc of known)assert.ok(doc.path.startsWith(`${c.root.path}/`));
 await c.db.recursiveDelete(c.root);assert.equal((await c.root.get()).exists,false);assert.deepEqual(await c.root.listCollections(),[]);
 for(const doc of known){assert.equal((await doc.get()).exists,false);assert.deepEqual(await doc.listCollections(),[]);}
 verifiedCleanups++;console.log(`Synthetic account user read cleanup verified ${verifiedCleanups}/${expectedTests}`);
}finally{await c.db.terminate();}});
after(()=>{console.log(`Synthetic account user read cleanup total: ${verifiedCleanups}/${expectedTests}`);assert.equal(verifiedCleanups,expectedTests);});
async function fixture(){
 environment();const db=new Firestore({projectId:project,host,ssl:false,preferRest:false}),root=db.collection(collection).doc(randomUUID());
 const c={db,root,marker:randomUUID(),confirmed:false};contexts.push(c);safeClient(c);
 assert.equal((await root.get()).exists,false);assert.deepEqual(await root.listCollections(),[]);
 await root.create({marker:c.marker,purpose:'account-user-read-identity-synthetic-v1'});assert.equal((await root.get()).get('marker'),c.marker);c.confirmed=true;
 c.store=new AccountStore(db,root);c.uid=`synthetic-balance-${randomUUID()}`;c.key=AccountStore.identityKey(c.uid);
 c.boot=await c.store.bootstrap(c.uid);c.account=root.collection('accounts').doc(c.boot.account.id);c.identity=root.collection('identities').doc(c.key);
 await c.account.update({credited:10,available:8,reserved:2,active:1});
 c.first=await c.store.create(c.uid,randomUUID(),'Synthetic first','text','synthetic one');
 c.second=await c.store.create(c.uid,randomUUID(),'Synthetic second','text','synthetic two');
 c.ledgerFirst=root.collection('ledgerEntries').doc(randomUUID());c.ledgerSecond=root.collection('ledgerEntries').doc(randomUUID());
 await c.ledgerFirst.create({ownerAccountId:c.boot.account.id,createdAtMs:20,seconds:2,kind:'synthetic'});
 await c.ledgerSecond.create({ownerAccountId:c.boot.account.id,createdAtMs:10,seconds:1,kind:'synthetic'});return c;
}
const outcome=promise=>promise.then(value=>({value}),error=>({error}));
const gate=()=>{let enter,release;return {entered:new Promise(r=>{enter=r;}),resume:new Promise(r=>{release=r;}),enter:()=>enter(),release:()=>release()};};

const actions={
 me:c=>c.store.me(c.uid),
 read:c=>c.store.read(c.uid,c.first.project.id),
 list:c=>c.store.list(c.uid,'1'),
 ledger:c=>c.store.ledger(c.uid,'1'),
};

test('authorized Account data and another user remain isolated',{timeout:60000},async()=>{
 const c=await fixture(),otherUid=`synthetic-other-${randomUUID()}`;await c.store.bootstrap(otherUid);
 const me=await c.store.me(c.uid),project=await c.store.read(c.uid,c.first.project.id);
 assert.equal(me.id,c.boot.account.id);assert.equal(me.balance.available,8);assert.equal(project.project.content,'synthetic one');
 await assert.rejects(c.store.read(otherUid,c.first.project.id),error=>error.code==='not_found');
 assert.equal((await c.store.list(otherUid)).items.length,0);assert.equal((await c.store.ledger(otherUid)).items.length,0);
});

test('project and ledger pages preserve order cursor and content privacy',{timeout:60000},async()=>{
 const c=await fixture(),first=await c.store.list(c.uid,'1');assert.equal(first.items.length,1);assert.ok(first.nextCursor);
 assert.equal(Object.hasOwn(first.items[0],'content'),false);
 const second=await c.store.list(c.uid,'1',first.nextCursor);assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);
 assert.deepEqual(new Set([first.items[0].id,second.items[0].id]),new Set([c.first.project.id,c.second.project.id]));
 assert.equal((await c.store.list(c.uid,'1')).items[0].id,first.items[0].id);
 const a=await c.store.ledger(c.uid,'1'),b=await c.store.ledger(c.uid,'1',a.nextCursor);
 assert.equal(a.items[0].id,c.ledgerFirst.id);assert.equal(b.items[0].id,c.ledgerSecond.id);assert.equal(b.nextCursor,null);
});

test('all four Account reads include identity and data in a transaction',{timeout:60000},async()=>{
 const c=await fixture();let directIdentityReads=0;
 const root={collection:name=>{
  const original=c.root.collection(name);
  if(name!=='identities')return original;
  return {doc:id=>{const ref=original.doc(id),direct=ref.get.bind(ref);Object.defineProperty(ref,'get',{configurable:true,value:async()=>{
   directIdentityReads++;const captured=await direct();await c.identity.delete();return captured;
  }});return ref;}};
 }};
 for(const name of Object.keys(actions)){
  const reads=[];let transactions=0;
  const db={runTransaction:callback=>{transactions++;return c.db.runTransaction(tx=>callback({get:async ref=>{
   reads.push(typeof ref.path==='string'?ref.path:'query');return tx.get(ref);
  }}));}};
  const store=new AccountStore(db,root),target={...c,store};await actions[name](target);
  assert.equal(transactions,1);assert.ok(reads.includes(c.identity.path));assert.ok(reads.includes(c.account.path));
  if(name==='read')assert.ok(reads.includes(c.root.collection('projects').doc(c.first.project.id).path));
  if(name==='list'||name==='ledger')assert.ok(reads.includes('query'));
 }
 assert.equal(directIdentityReads,0);assert.equal((await c.identity.get()).exists,true);
});

test('identity already removed denies all four reads without reprovisioning',{timeout:60000},async()=>{
 const c=await fixture();await c.identity.delete();
 for(const action of Object.values(actions))await assert.rejects(action(c),error=>error.code==='account_not_provisioned');
 assert.equal((await c.identity.get()).exists,false);assert.equal((await c.account.get()).exists,true);
});

test('reads before revocation succeed and all later reads are denied',{timeout:60000},async()=>{
 const c=await fixture();for(const action of Object.values(actions))assert.ok(await action(c));
 await c.identity.delete();for(const action of Object.values(actions))await assert.rejects(action(c),error=>error.code==='account_not_provisioned');
});

test('concurrent removal permits a serializable read and denies subsequent reads',{timeout:60000},async()=>{
 const c=await fixture(),original=(await c.identity.get()).data();
 for(const name of Object.keys(actions)){
  await c.identity.set(original);const waiting=gate();let once=true;
  const db={runTransaction:callback=>c.db.runTransaction(tx=>callback({get:async ref=>{
   const snapshot=await tx.get(ref);if(once&&ref.path===c.identity.path){once=false;waiting.enter();await waiting.resume;}return snapshot;
  }}))};
  const target={...c,store:new AccountStore(db,c.root)},pending=outcome(actions[name](target));
  try{
   await waiting.entered;const removal=c.identity.delete();waiting.release();const [result]=await Promise.all([pending,removal]);
   if(result.error)assert.equal(result.error.code,'account_not_provisioned');else assert.ok(result.value);
   // An earlier serializable read can return after removal; a new read cannot.
   await assert.rejects(actions[name](c),error=>error.code==='account_not_provisioned');
  }finally{waiting.release();}
 }
});

test('malformed foreign cursors and oversized pages remain rejected',{timeout:60000},async()=>{
 const c=await fixture(),other=await c.store.bootstrap(`synthetic-other-${randomUUID()}`);
 const cursor=Buffer.from(JSON.stringify({v:1,owner:other.account.id,time:20,id:c.first.project.id})).toString('base64url');
 await assert.rejects(c.store.list(c.uid,'1',cursor),error=>error.code==='invalid');
 await assert.rejects(c.store.ledger(c.uid,'1',cursor),error=>error.code==='invalid');
 await assert.rejects(c.store.list(c.uid,'51'),error=>error.code==='invalid');
 await assert.rejects(c.store.ledger(c.uid,'0'),error=>error.code==='invalid');
 await assert.rejects(c.store.read(c.uid,'bad'),error=>error.code==='invalid');
});

