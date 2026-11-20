// Selector diagnostic only. Firestore Emulator with flat synthetic rows; no
// Account API, provider, scheduler, customer identity or real balance.
import assert from 'node:assert/strict';
import {after,afterEach,before,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,openSync,realpathSync,statfsSync,writeSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {Firestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';

const project='demo-vistavo-ledger',host='127.0.0.1:8185',collection='vistavo_billing_intent_selection_synthetic',expectedTests=1;
const contexts=[],minimumFree=1024n*1024n*1024n;let cleanups=0,rootLog,diskMonitor,diskLow=false,minObserved;
function checkDisk(stage){
 let free;
 try{const s=statfsSync('.',{bigint:true});free=s.bavail*s.bsize;}catch{diskLow=true;throw Error('Cannot verify disk space: '+stage);}
 if(minObserved===undefined||free<minObserved)minObserved=free;
 if(free<minimumFree)diskLow=true;
 if(diskLow)throw Error('Disk safety threshold reached: '+stage);
 return free;
}
function rootEvent(event){assert.notEqual(rootLog,undefined);writeSync(rootLog,JSON.stringify(event)+'\n');fsyncSync(rootLog);}
function assertSafeEnvironment(){
 assert.equal(process.platform,'win32');assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.LV_REVIEW_CONTRACT,'1');
 assert.equal(process.env.LV_BILLING_INTENT_SELECTION,'1');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
 assert.equal(process.env.GOOGLE_CLOUD_PROJECT,project);assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.METADATA_SERVER_DETECTION,'none');
 for(const key of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN',
  'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY',
  'GOOGLE_AUTH_CREDENTIALS','GOOGLE_SERVICE_ACCOUNT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY','VERTEX_API_KEY','OPENROUTER_API_KEY','AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','GOOGLE_CLOUD_QUOTA_PROJECT','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_CONFIG','VISTAVO_PROJECT_ID',
  'VISTAVO_AI_ENABLED','VISTAVO_FILES_MODE','VISTAVO_LOCAL_CLOUD','VISTAVO_ACCOUNT_ID','VISTAVO_JOB_ID','VISTAVO_GEMINI_KEY','K_SERVICE','K_REVISION',
  'K_CONFIGURATION','K_JOB','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV'])assert.equal(process.env[key],undefined,`Unexpected ${key}`);
 const profile=process.env.USERPROFILE;assert.ok(profile&&profile===process.env.APPDATA&&profile===process.env.LOCALAPPDATA);
 const absolute=resolve(profile),base=resolve('outputs/lv019-b-intent-selection-runs'),parts=relative(base,absolute).split(sep);
 assert.equal(parts.length,2);assert.match(parts[0],/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(parts[1],'profile');
 assert.equal(realpathSync(absolute).toLowerCase(),absolute.toLowerCase());assert.equal(existsSync(join(absolute,'gcloud','application_default_credentials.json')),false);
}
function assertSafeClient(c){
 assertSafeEnvironment();assert.match(c.root.path,/^vistavo_billing_intent_selection_synthetic\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
 assert.equal(c.db.projectId,project);assert.equal(c.db.databaseId,'(default)');const s=c.db._settings;
 assert.equal(s?.projectId,project);assert.equal(s?.servicePath,'127.0.0.1');assert.equal(s?.port,8185);assert.equal(s?.ssl,false);assert.equal(s?.preferRest,false);
 for(const key of ['auth','credentials','keyFilename','authClient'])assert.equal(s?.[key],undefined);
}
before(async()=>{
 assertSafeEnvironment();checkDisk('before setup');rootLog=openSync(join(dirname(process.env.USERPROFILE),'synthetic-roots.jsonl'),'wx');
 diskMonitor=setInterval(()=>{try{checkDisk('monitor');}catch{/* Latched until orderly stop. */}},250);diskMonitor.unref();
 assert.equal((await fetch('http://127.0.0.1:8185/',{signal:AbortSignal.timeout(5000)})).status,200);
});
afterEach(async()=>{for(const c of contexts.splice(0)){try{
 assertSafeClient(c);checkDisk('before cleanup');const marker=await c.root.get();
 if(!c.confirmed){assert.equal(marker.exists,false,'Unconfirmed root is preserved');assert.deepEqual(await c.root.listCollections(),[]);continue;}
 assert.deepEqual(marker.data(),c.marker);
 const collections=await c.root.listCollections();assert.ok(collections.every(col=>['billingIntents','accounts'].includes(col.id)));
 const known=[];for(const col of collections)known.push(...await col.listDocuments());
 for(const doc of known)assert.ok(c.expectedPaths.has(doc.path),'Unexpected synthetic document is preserved');
 // A flat synthetic fixture must never recursively remove an unexpected subtree.
 for(let i=0;i<known.length;i+=16){checkDisk('inspect cleanup paths');const children=await Promise.all(known.slice(i,i+16).map(doc=>doc.listCollections()));for(const list of children)assert.deepEqual(list,[]);}
 for(let i=0;i<known.length;i+=20){checkDisk('before cleanup batch');const batch=c.db.batch();for(const doc of known.slice(i,i+20))batch.delete(doc);await batch.commit();checkDisk('after cleanup batch');}
 checkDisk('before root cleanup');await c.root.delete();checkDisk('after root cleanup');
 assert.equal((await c.root.get()).exists,false);assert.deepEqual(await c.root.listCollections(),[]);
 for(let i=0;i<known.length;i+=30){checkDisk('verify cleanup');const snapshots=await c.db.getAll(...known.slice(i,i+30));assert.ok(snapshots.every(doc=>!doc.exists));}
 rootEvent({event:'cleanup_verified',scope:c.scope,path:c.root.path,marker:c.marker});
 cleanups++;console.log(`Synthetic intent selection cleanup verified ${cleanups}/${expectedTests}`);
 }catch(error){
  if(diskLow&&c.confirmed){try{rootEvent({event:'cleanup_preserved_low_disk',scope:c.scope,path:c.root.path,marker:c.marker});}catch{/* Journal may be unavailable. */}console.error('Synthetic root preserved or partially cleaned because disk threshold was reached; manual inspection required.');}
  throw error;
 }finally{globalThis.fetch=c.originalFetch;await c.db.terminate();}}});
after(()=>{try{console.log(`Synthetic intent selection cleanup total: ${cleanups}/${expectedTests}`);assert.equal(cleanups,expectedTests);}
 finally{if(diskMonitor)clearInterval(diskMonitor);if(rootLog!==undefined){closeSync(rootLog);rootLog=undefined;}}});

async function fixture(scope){
 assertSafeEnvironment();checkDisk('before creating root');
 const db=new Firestore({projectId:project,host,ssl:false,preferRest:false}),root=db.collection(collection).doc(randomUUID());
 const c={scope,db,root,backend:new FirestoreBackend(db,root),marker:{project,purpose:'billing-intent-selection-synthetic-v1',nonce:randomUUID()},confirmed:false,expectedPaths:new Set(),originalFetch:globalThis.fetch,providerCalls:0};
 contexts.push(c);assertSafeClient(c);rootEvent({event:'allocated',scope,path:root.path,marker:c.marker});
 globalThis.fetch=async(request,init)=>{const url=new URL(request instanceof Request?request.url:String(request));if(url.hostname!=='127.0.0.1'||url.port!=='8185'){c.providerCalls++;throw Error('Unexpected external fetch');}return c.originalFetch(request,init);};
 assert.equal((await root.get()).exists,false);assert.deepEqual(await root.listCollections(),[]);rootEvent({event:'root_absent',scope,path:root.path,marker:c.marker});
 checkDisk('before marker create');await root.create(c.marker);assert.deepEqual((await root.get()).data(),c.marker);rootEvent({event:'root_confirmed',scope,path:root.path,marker:c.marker});c.confirmed=true;checkDisk('after marker create');
 return c;
}

test('fixed intent selection finds due work and releases',{timeout:180000},async()=>{
 const c=await fixture('selection'),intents=c.root.collection('billingIntents'),accounts=c.root.collection('accounts');
 const futureIds=Array.from({length:100},(_,i)=>'reserve_'+String(i).padStart(3,'0'));
 const future=Date.now()+24*60*60*1000,due=0,batch=c.db.batch();
 for(const id of futureIds){const doc=intents.doc(id);c.expectedPaths.add(doc.path);batch.create(doc,{state:'reserve_pending',nextAttemptAt:future,fixture:'selector-only'});}
 const dueReserve=intents.doc('reserve_z_due'),dueRelease=intents.doc('release_z_due');
 c.expectedPaths.add(dueReserve.path);c.expectedPaths.add(dueRelease.path);
 batch.create(dueReserve,{state:'reserve_pending',nextAttemptAt:due,fixture:'selector-only'});batch.create(dueRelease,{state:'release_pending',nextAttemptAt:due,fixture:'selector-only'});
 const beforeBalances={owner:{credited:40,available:34,reserved:6,consumed:0,active:1},other:{credited:20,available:20,reserved:0,consumed:0,active:0}};
 for(const [id,balance] of Object.entries(beforeBalances)){const doc=accounts.doc(id);c.expectedPaths.add(doc.path);batch.create(doc,balance);}
 checkDisk('before synthetic rows');await batch.commit();checkDisk('after synthetic rows');
 const all=await intents.get(),firstHundred=await intents.where('state','==','reserve_pending').limit(100).get();
 assert.equal(all.size,102);assert.equal(firstHundred.size,100);assert.deepEqual(firstHundred.docs.map(doc=>doc.id),futureIds);
 assert.equal((await dueReserve.get()).get('nextAttemptAt'),due);assert.equal((await dueRelease.get()).get('nextAttemptAt'),due);
 // LV-019.B fix of the 2026-11-18 incident: the selector pages by document id past not-due rows and alternates releases and reserves (releases first).
 checkDisk('before phase one');const phase1=await c.backend.pendingExternalBillingIntents(100);
 assert.deepEqual(phase1.map(row=>row.id),['release_z_due','reserve_z_due']);
 const readyBatch=c.db.batch();for(const id of futureIds.slice(0,25))readyBatch.update(intents.doc(id),{nextAttemptAt:due});
 checkDisk('before ready controls');await readyBatch.commit();checkDisk('after ready controls');
 const phase2=await c.backend.pendingExternalBillingIntents(25),phase2Single=await c.backend.pendingExternalBillingIntents(1),phase2Wide=await c.backend.pendingExternalBillingIntents(100);
 assert.deepEqual(phase2.map(row=>row.id),['release_z_due',...futureIds.slice(0,24)]);assert.deepEqual(phase2Single.map(row=>row.id),['release_z_due']);
 assert.deepEqual(phase2Wide.map(row=>row.id),['release_z_due',...futureIds.slice(0,25),'reserve_z_due']);
 for(const [id,balance] of Object.entries(beforeBalances))assert.deepEqual((await accounts.doc(id).get()).data(),balance);
 assert.equal((await c.root.collection('movements').get()).size,0);assert.equal((await c.root.collection('jobs').get()).size,0);assert.equal(c.providerCalls,0);checkDisk('before evidence');
 console.log('# INTENT_SELECTION_DIAGNOSTIC '+JSON.stringify({event:'fixed_selector',futureReserves:100,totalIntents:102,dueReserveExists:true,dueReleaseExists:true,phase1DueReserveSelected:true,phase1ReleaseSelected:true,phase1ReleaseFirst:true,phase2ReleaseFirstAt25:true,phase2ReleaseAt1:true,phase2ReserveRowsAt25:phase2.length-1,phase2RowsAt100:phase2Wide.length,balancesUnchanged:true,movements:0,jobs:0,providerCalls:c.providerCalls,minFreeBytes:String(minObserved)}));
});

