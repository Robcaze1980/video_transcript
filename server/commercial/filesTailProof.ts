import assert from 'node:assert/strict';
import type {DocumentReference} from 'firebase-admin/firestore';
import {cloudFilesRuntime} from './cloudFilesRuntime';
import {objectPlan,privateUuid} from './privateObjectPlan';

// Focused continuation of the failed original proof: no re-credit, new user or provider work.
const expiryId='ff7b93c7-eea4-4dd4-ab95-9412feacfde4';
const report:{checks:string[];startedAt:string;finishedAt?:string}={checks:[],startedAt:new Date().toISOString()};
async function main(){
 const runtime=await cloudFilesRuntime('proof');
 let control:DocumentReference|undefined;
 try{
  const origin=process.env.VISTAVO_PROOF_API,apiKey=process.env.VISTAVO_PROOF_WEB_KEY,uid=process.env.VISTAVO_PROOF_UID,
   foreignUid=process.env.VISTAVO_PROOF_FOREIGN_UID,proofId=process.env.VISTAVO_PROOF_ID;
  if(!origin||!/^https:\/\/vistavo-files-api-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/.test(origin)||!apiKey||
   !uid?.startsWith('vistavo-gcs-proof-')||!foreignUid?.startsWith('vistavo-gcs-proof-')||uid===foreignUid||!proofId||!privateUuid.test(proofId)||
   runtime.root.path!=='vistavo/candidate-v1')throw Error('Tail proof boundary');
  const identities=await runtime.root.collection('identities').where('uid','==',uid).limit(2).get();
  assert.equal(identities.size,1);const accountId=identities.docs[0].get('accountId');assert.match(accountId,privateUuid);
  const foreignIdentity=await runtime.root.collection('identities').where('uid','==',foreignUid).limit(2).get();
  assert.equal(foreignIdentity.size,1);assert.notEqual(foreignIdentity.docs[0].get('accountId'),accountId);
  control=runtime.root.collection('proofs').doc(proofId);
  const prior=await control.get();assert.equal(prior.exists,true);
  const originalResult=prior.get('result'),originalChecks=prior.get('checks');
  const originalUpload=prior.get('uploadId');assert.match(originalUpload,privateUuid);
  assert.equal((await runtime.root.collection('uploads').doc(originalUpload).get()).get('accountId'),accountId);
  const expiry=runtime.root.collection('uploads').doc(expiryId),fixture=(await expiry.get()).data();
  assert.ok(fixture);assert.equal(fixture.accountId,accountId);assert.equal(fixture.id,expiryId);
  assert.equal(fixture.size,1);assert.equal(fixture.expectedSha,'a'.repeat(64));assert.equal(fixture.offset,0);
  assert.ok(fixture.name==='synthetic-expiry.mp4'||(['deleting','deleted'].includes(fixture.state)&&fixture.failure==='expired'));
  assert.ok(fixture.expiresAtMs<Date.now());assert.deepEqual(fixture.plan,objectPlan(expiryId,fixture.size,fixture.chunkBytes));
  await control.set({followupOnly:true,followupResult:'RUNNING',followupChecks:[],followupStartedAt:report.startedAt,
   followupReason:'Focused continuation after original TTL purge failed because the native fileOutbox composite index was missing.',
   followupExpiryId:expiryId},{merge:true});
  const check=async(name:string)=>{report.checks.push(name);await control!.set({followupChecks:[...report.checks]},{merge:true});console.log(JSON.stringify({event:'tail-proof-check',check:name,result:'PASS'}));};

  // Native SDK queries against the actual collection paths; never catch/retry code9 as success.
  const now=Date.now();
  await Promise.all([
   runtime.root.collection('uploads').where('purgeState','==','pending').where('expiresAtMs','<=',now).orderBy('expiresAtMs').limit(25).get(),
   runtime.root.collection('fileOutbox').where('state','==','pending').where('nextAttemptAt','<=',now).orderBy('nextAttemptAt').limit(25).get(),
  ]);
  await check('nativeUploadsAndFileOutboxCompositeQueriesSucceed');

  const tokenFor=async(id:string)=>{
   const custom=await runtime.identity.createCustomToken(id);
   const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key='+encodeURIComponent(apiKey),{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true}),signal:AbortSignal.timeout(20000)});
   const data=await response.json();if(!response.ok||typeof data.idToken!=='string')throw Error('Existing synthetic sign in failed');return data.idToken;
  };
  const [owner,foreign]=await Promise.all([tokenFor(uid),tokenFor(foreignUid)]);
  const metadata=await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience='+encodeURIComponent(origin)+'&format=full',{
   headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(5000)});
  if(!metadata.ok||metadata.headers.get('Metadata-Flavor')!=='Google')throw Error('Managed invoker token unavailable');
  const invoker=await metadata.text();
  const call=(path:string,token=owner)=>fetch(origin+path,{headers:{Authorization:'Bearer '+token,'X-Serverless-Authorization':'Bearer '+invoker},signal:AbortSignal.timeout(30000)});
  const me=await call('/api/cloud/me');assert.equal(me.status,200);assert.equal((await me.json()).id,accountId);
  const other=await call('/api/cloud/me',foreign);assert.equal(other.status,200);assert.equal((await other.json()).id,foreignIdentity.docs[0].get('accountId'));
  await check('existingOwnerAndEnabledForeignFirebaseIdentitiesAccepted');
  const expiredContent=await call('/api/cloud/uploads/'+expiryId+'/content');assert.equal(expiredContent.status,410);await expiredContent.body?.cancel();
  await check('expiredFixtureContentDenied410EvenAfterBackgroundPurge');

  const waitControl=async(field:string)=>{
   const until=Date.now()+360000;
   while(Date.now()<until){if((await control!.get()).get(field)===true)return;await new Promise(resolve=>setTimeout(resolve,3000));}
   throw Error('Tail operator control timeout');
  };
  await control.set({phase:'maintenanceRequested',maintenanceDone:false,followupPhase:'maintenanceRequested'},{merge:true});
  console.log(JSON.stringify({event:'tail-proof-awaiting-operator',action:'trigger-real-Scheduler-maintenance',proofId}));
  await waitControl('maintenanceDone');
  const until=Date.now()+360000;let deleted=false;
  while(Date.now()<until){const row=await expiry.get();assert.equal(row.get('accountId'),accountId);if(row.get('state')==='deleted'){deleted=true;break;}await new Promise(resolve=>setTimeout(resolve,3000));}
  assert.equal(deleted,true);const erased=(await expiry.get()).data()!;
  assert.equal(erased.purgeState,'done');assert.equal(erased.quotaHeld,0);assert.equal(erased.quotaMode,'none');
  for(const key of [...fixture.plan.chunks,...fixture.plan.groups,fixture.plan.final]){
   const marker=await runtime.objects.metadata(key);assert.ok(marker);assert.equal(marker.size,0);assert.equal(marker.marker,true);
  }
  const account=(await runtime.root.collection('accounts').doc(accountId).get()).data();
  assert.equal(account?.storageReservedBytes,0);assert.equal(account?.storageCommittedBytes,0);assert.equal(account?.activeUploads,0);
  await check('expiredFixtureRealSchedulerPurge-allPlannedMarkersZero-quotaReleased');

  // Reset stale acknowledgements before asking the operator to disable/revoke this existing foreign fixture.
  await control.set({phase:'revocationRequested',revocationDone:false,followupPhase:'revocationRequested'},{merge:true});
  console.log(JSON.stringify({event:'tail-proof-awaiting-operator',action:'disable-and-revoke-existing-foreign-user',proofId}));
  await waitControl('revocationDone');
  const revoked=await call('/api/cloud/me',foreign);assert.equal(revoked.status,401);await revoked.body?.cancel();
  await check('previouslyAcceptedForeignFirebaseTokenDeniedAfterOperatorRevocation');
  const unchanged=await control.get();assert.deepEqual(unchanged.get('result'),originalResult);assert.deepEqual(unchanged.get('checks'),originalChecks);
  report.finishedAt=new Date().toISOString();
  await control.set({followupResult:'PASS',followupChecks:report.checks,followupFinishedAt:report.finishedAt,followupPhase:'complete'},{merge:true});
  console.log(JSON.stringify({event:'cloud-tail-proof-complete',followupResult:'PASS',...report,originalProofResultUnchanged:true}));
 }catch(error){
  const e=error as {name?:string;code?:unknown};report.finishedAt=new Date().toISOString();
  if(control)await control.set({followupResult:'FAIL',followupChecks:report.checks,followupFinishedAt:report.finishedAt,
   followupFailure:{type:e.name??'Error',code:typeof e.code==='string'||typeof e.code==='number'?e.code:'unclassified'}},{merge:true}).catch(()=>undefined);
  console.error(JSON.stringify({event:'cloud-tail-proof-failed',type:e.name,code:typeof e.code==='string'||typeof e.code==='number'?e.code:undefined,checks:report.checks}));
  process.exitCode=1;
 }finally{await runtime.close();}
}
main().catch(error=>{console.error(JSON.stringify({event:'cloud-tail-proof-initialization-failed',type:error?.name,code:error?.code}));process.exitCode=1;});
