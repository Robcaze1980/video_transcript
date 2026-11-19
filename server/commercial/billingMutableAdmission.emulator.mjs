// Synthetic regressions; only Firestore Emulator, never Account or providers.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {FirestoreBackend} from './firestoreBackend.ts';
import {privateBucket,objectPlan} from './privateObjectPlan.ts';
import {AI_CATALOG_VERSION} from './aiContracts.ts';

const host='127.0.0.1:8185',project='demo-vistavo-ledger',rootName='vistavo_mutable_billing_audit_test';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function boundary(){
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);assert.equal(process.env.NODE_ENV,'test');
 for(const name of ['GOOGLE_APPLICATION_CREDENTIALS','K_SERVICE','K_JOB','FUNCTION_TARGET','GAE_ENV'])assert.ok(!process.env[name],name+' must be absent');
 for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])assert.ok(!process.env[name]||process.env[name]===project,name+' must be demo only');
}
function version(doc){return doc.updateTime?`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`:null;}
async function readSnapshot(f){
 const intent=await f.root.collection('billingIntents').doc(f.intentId).get();
 const [guard,request,marker]=await Promise.all(['billingGuards','requests','billingIntentJobMarkers'].map((name,index)=>f.root.collection(name).doc(index===0?f.account:f.intentId).get()));
 const [terminal,holds,jobs]=await Promise.all(['billingIntentTerminalWitnesses','billingHoldOutbox','jobs'].map(name=>f.root.collection(name).get()));
 return {intentState:intent.get('state'),nextAttemptAt:intent.get('nextAttemptAt'),intentVersion:version(intent),guardExists:guard.exists,requestExists:request.exists,markerExists:marker.exists,terminalWitnesses:terminal.size,holdEvents:holds.size,jobs:jobs.size,balance:await f.backend.readBalance(f.account)};
}
async function compareAttempt(f,method,source,replacement){
 let release;const barrier=new Promise(resolve=>{release=resolve;});
 const delayed=new FirestoreBackend({runTransaction:async callback=>{await barrier;return f.db.runTransaction(callback);}},f.root);
 const supplied=Object.defineProperties({},Object.getOwnPropertyDescriptors(source)),waiting=delayed[method](f.account,f.requestKey,supplied);
 if(replacement)Object.assign(supplied,replacement);
 release();try{const outcome=await waiting;return {kind:'resolved',state:outcome.state,...(outcome.jobId?{jobId:outcome.jobId}:{})};}catch(error){if(error?.code==='conflict')return {kind:'conflict'};throw error;}
}
async function cleanup(f){
 boundary();assert.equal(f.root.path,rootName+'/'+f.runId);
 const doc=await f.root.get();assert.equal(doc.get('fixture'),'mutable-billing-synthetic-v1');assert.equal(doc.get('runId'),f.runId);
 await f.db.recursiveDelete(f.root);assert.equal((await f.root.get()).exists,false);
 for(const name of ['accounts','identities','inputs','projects','billingIntents','billingIntentWitnesses','billingIntentTerminalWitnesses','billingIntentObservationIncidents','billingReviewIncidents','billingHoldOutbox','billingGuards','jobs','requests','billingIntentJobMarkers','artifacts','outbox','movements'])assert.equal((await f.root.collection(name).get()).size,0,'cleanup '+name);
}

for(const method of ['recheckExternalBillingAdmission','fenceExternalBillingRelease'])test(method+' snapshots and validates only the tuple submitted before waiting',async()=>{
 boundary();assert.equal((await fetch('http://'+host+'/')).status,200);
 const runId=randomUUID(),app=initializeApp({projectId:project},'mutable-billing-audit-'+runId),db=getFirestore(app);
 db.settings({host,ssl:false,preferRest:true});assert.equal(app.options.projectId,project);assert.equal(db._settings.servicePath,'127.0.0.1');assert.equal(db._settings.port,8185);assert.equal(db._settings.ssl,false);
 const root=db.collection(rootName).doc(runId);assert.equal(root.path,rootName+'/'+runId);
 const f={runId,db,root,backend:new FirestoreBackend(db,root)};let created=false,evidence,clean=false;
 try{
  await root.create({fixture:'mutable-billing-synthetic-v1',runId});created=true;
  const uid='synthetic-mutable-billing-'+runId;f.account=await f.backend.accountForUid(uid);const inputId=randomUUID();f.requestKey=randomUUID();
  f.billing={provider:'account_seconds',identityKey:hash(['firebase',uid]),reservationId:randomUUID(),seconds:2};
  const original={...f.billing,reservationId:randomUUID(),seconds:3};assert.notEqual(original.reservationId,f.billing.reservationId);
  await root.collection('accounts').doc(f.account).update({aiPilot:true,simulationOnly:true});
  const sha='a'.repeat(64);
  await root.collection('inputs').doc(inputId).create({accountId:f.account,deleted:false,expiresAtMs:Date.now()+300000,ready:true,sha256:sha,unknownCount:0,metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:objectPlan(inputId,12).final,generation:'1',size:12,sha256:sha}});
  await root.collection('projects').doc(inputId).create({accountId:f.account,inputId,revision:1,draft:'synthetic only'});
  await f.backend.beginExternalBillingIntent(f.account,inputId,f.requestKey,'translation:en',1,f.billing);
  f.intentId=hash([f.account,f.requestKey]);
  for(const invalid of [null,{}, {...f.billing,provider:'invalid'}, {...f.billing,identityKey:'x'}, {...f.billing,reservationId:'invalid'}, {...f.billing,seconds:0}, {...f.billing,seconds:601}, {...f.billing,seconds:NaN}, {...f.billing,seconds:'2'}])await assert.rejects(f.backend[method](f.account,f.requestKey,invalid),error=>error.code==='invalid');
  const positiveBilling={...f.billing,reservationId:randomUUID()},positiveKey=randomUUID();
  await f.backend.beginExternalBillingIntent(f.account,inputId,positiveKey,'translation:en',1,positiveBilling);
  const positive=await compareAttempt({...f,requestKey:positiveKey,billing:positiveBilling},method,positiveBilling,false);
  const expectedState=method==='recheckExternalBillingAdmission'?'permitted':'release_pending';assert.deepEqual(positive,{kind:'resolved',state:expectedState});
  const positiveIntent=await root.collection('billingIntents').doc(hash([f.account,positiveKey])).get();
  assert.equal(positiveIntent.get('state'),method==='recheckExternalBillingAdmission'?'reserve_pending':'release_pending');
  const before=await readSnapshot(f),control=await compareAttempt(f,method,original,false),afterControl=await readSnapshot(f);
  assert.equal(before.intentState,'reserve_pending');assert.deepEqual(control,{kind:'conflict'});assert.deepEqual(afterControl,before);
  const mutated=await compareAttempt(f,method,original,f.billing),afterMutation=await readSnapshot(f);
  assert.deepEqual(afterMutation.balance,before.balance);assert.equal(afterMutation.jobs,0);assert.equal(afterMutation.terminalWitnesses,0);
  const permittedBefore=await compareAttempt(f,method,{...f.billing,unexpected:'synthetic-extra',state:'closed',nextAttemptAt:-1,accountId:randomUUID()},original),afterValid=await readSnapshot(f);
  assert.deepEqual(permittedBefore,{kind:'resolved',state:expectedState});assert.equal(afterValid.intentState,method==='recheckExternalBillingAdmission'?'reserve_pending':'release_pending');
  const latest=await root.collection('billingIntents').doc(f.intentId).get();assert.equal(latest.get('unexpected'),undefined);assert.equal(latest.get('accountId'),f.account);assert.ok(latest.get('nextAttemptAt')>=0);
  let reads=0;const oneRead={...f.billing};Object.defineProperty(oneRead,'seconds',{enumerable:true,get(){return ++reads===1?2:3;}});
  assert.deepEqual(await compareAttempt(f,method,oneRead,false),{kind:'resolved',state:expectedState});assert.equal(reads,1);
  // Exercise the existing-job branch and its nested verification with a late mutation.
  const jobKey=randomUUID(),jobBilling={...f.billing,reservationId:randomUUID()};
  await f.backend.beginExternalBillingIntent(f.account,inputId,jobKey,'translation:en',1,jobBilling);
  const jobId=await f.backend.reserve(f.account,inputId,jobKey,2,'translation:en',1,AI_CATALOG_VERSION,jobBilling,undefined,uid),jobRef=root.collection('jobs').doc(jobId),jobBefore=await jobRef.get();
  const jobContext={...f,requestKey:jobKey,billing:jobBilling};
  const jobOutcome=await compareAttempt(jobContext,method,jobBilling,{...jobBilling,reservationId:randomUUID(),seconds:3});
  assert.deepEqual(jobOutcome,{kind:'resolved',state:'job_created',jobId});const jobAfter=await jobRef.get();assert.deepEqual(jobAfter.data(),jobBefore.data());assert.equal(version(jobAfter),version(jobBefore));
  evidence={scope:'synthetic Firestore emulator only',method,positive,originalTupleMatchesStoredIntent:false,control,mutated,
   initialState:before.intentState,stateAfterControl:afterControl.intentState,stateAfterMutation:afterMutation.intentState,
   intentChanged:afterMutation.intentVersion!==before.intentVersion,priorDueUnchanged:afterMutation.nextAttemptAt===before.nextAttemptAt,
   matchingTupleSurvivesLateMutation:true,extraFieldsIgnored:true,tupleGetterReadOnce:true,existingJobBranchSurvivesLateMutation:true,
   accountApiCalls:0,providerCalls:0,balanceUnchanged:true,jobCountAtNegative:afterMutation.jobs,terminalWitnesses:afterMutation.terminalWitnesses};
 }finally{
  try{if(created){await cleanup(f);clean=true;}}finally{await db.terminate();await deleteApp(app);}
 }
 evidence.cleanupVerified=clean;console.log('SYNTHETIC_MUTABLE_BILLING '+JSON.stringify(evidence));
 assert.equal(evidence.cleanupVerified,true);assert.deepEqual(evidence.mutated,evidence.control,'post-invocation mutation must not alter the authorized tuple');
 assert.equal(evidence.intentChanged,false,'post-invocation mutation must not alter the intent');
});
