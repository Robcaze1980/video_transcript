import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {readFile,mkdtemp,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {DocumentReference} from 'firebase-admin/firestore';
import {cloudFilesRuntime} from './cloudFilesRuntime';
import {firestoreHttp} from './firestoreHttp';
import {privateUuid,objectPlan} from './privateObjectPlan';
import {validateArtifactPlan,validateArtifactManifest} from './aiContracts';
import {ObjectFault,type CloudObject} from './gcsObjects';
import {validateDigitalSilenceProof,digitalSilenceProofHash} from './digitalSilence';

const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const kind='vistavo-three-fixes-proof-v3',entry='/app/cloud-three-fixes-probe.mjs';
const stages=['init','accounts','uploads','queued','jobs','access','cleanup','done'] as const;
const allowedChecks=['managed-boundary','sources-ready','speech-succeeded','silence-released','private-downloads','revoked-denied','late-authorization-control','one-provider-receipt','digital-zero-no-provider','old-generations-inaccessible','cleanup-complete'] as const;
type Stage=typeof stages[number];
type Runtime=Awaited<ReturnType<typeof cloudFilesRuntime>>;
type ProofReport={runId:string|null;result:'PASS'|'FAIL';stage:Stage;checks:string[];providerCalls:number|null;oldGenerations404:number;markers:number;downloadCount:number;deniedGcsReads:number;errorCode?:number|string};

export function threeFixesPlan(runId:string){
 if(typeof runId!=='string'||!privateUuid.test(runId)||runId!==runId.toLowerCase())throw Error('Proof ID boundary');
 return {runId,kind,ownerUid:'vistavo-close-owner-'+runId,otherUid:'vistavo-close-other-'+runId,
  uploadKeys:{speech:'close-upload-speech-'+runId,silent:'close-upload-silent-'+runId},
  jobKeys:{speech:'close-text-speech-'+runId,silent:'close-text-silent-'+runId},maxJobs:2,maxProviderCalls:1} as const;
}
/** Read-only observation of an already durable local-zero settlement; never creates or settles a proof. */
export function assertDigitalZeroObservation(job:any,inputId:string){
 assert.equal(job.state,'failed');assert.equal(job.failureCode,'no_speech');assert.equal(job.noSpeechSubtype,'digital_zero');assert.equal(job.invocationPhase,'local_check');assert.equal(job.attemptId,null);assert.equal(job.leaseUntil,null);assert.equal(job.noSpeechReceiptHash,undefined);assert.ok(privateUuid.test(job.digitalSilenceAttemptId));
 const proof=validateDigitalSilenceProof(job.digitalSilenceProof),hash=digitalSilenceProofHash(proof);assert.equal(job.digitalSilenceProofHash,hash);assert.equal(job.reconciliationRef,'digital-zero:'+hash);
 assert.equal(proof.sourceBucket,job.inputStorage?.bucket);assert.equal(proof.sourceKey,'candidate-files-v1/'+inputId+'/video.mp4');assert.equal(proof.sourceKey,job.inputStorage?.key);assert.equal(proof.sourceGeneration,job.inputStorage?.generation);assert.equal(proof.sourceSize,job.inputStorage?.size);assert.equal(proof.sourceSha256,job.inputStorage?.sha256);assert.equal(proof.sourceSha256,job.inputSha256);
 return {proof,proofHash:hash,attemptId:job.digitalSilenceAttemptId};
}
export function assertThreeFixesBoundary(env:NodeJS.ProcessEnv){
 if(env.VISTAVO_PROJECT_ID!=='vistavo-prod'||env.CLOUD_RUN_JOB!=='vistavo-files-validate'||env.VISTAVO_FILES_MODE!=='validate'||env.FIRESTORE_EMULATOR_HOST||env.FIREBASE_AUTH_EMULATOR_HOST||env.GOOGLE_APPLICATION_CREDENTIALS)throw Error('Managed probe boundary');
 return threeFixesPlan(env.VISTAVO_CLOSE_PROOF_ID!);
}
/** Intent is exclusive and durable before work. Unknown acknowledgements are inspected, never retried here. */
export async function recordedProofMutation<T>(control:Pick<DocumentReference,'collection'>,name:string,work:()=>Promise<T>):Promise<T>{
 if(!/^[a-z][a-z0-9.-]{1,79}$/.test(name))throw Error('Mutation label boundary');
 const intent=control.collection('intents').doc(name);await intent.create({kind,state:'intent',atMs:Date.now()});
 const result=await work();await intent.update({state:'acknowledged',acknowledgedAtMs:Date.now()});return result;
}
/** Whitelist only. No error message/stack, credentials, request/provider bodies or transcript text. */
export function threeFixesSummary(report:Partial<ProofReport>){
 const number=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0?n:null;
 return {event:'cloud-three-fixes-probe',kind,runId:typeof report.runId==='string'&&privateUuid.test(report.runId)?report.runId:null,
  result:report.result==='PASS'?'PASS':'FAIL',stage:stages.includes(report.stage!)?report.stage:'init',
  checks:Array.isArray(report.checks)?report.checks.filter(x=>(allowedChecks as readonly string[]).includes(x)):[],
  providerCalls:number(report.providerCalls),oldGenerations404:number(report.oldGenerations404),markers:number(report.markers),downloadCount:number(report.downloadCount),deniedGcsReads:number(report.deniedGcsReads),
  errorCode:typeof report.errorCode==='number'&&Number.isSafeInteger(report.errorCode)&&report.errorCode>=0&&report.errorCode<=599?report.errorCode:'UNCLASSIFIED',nativeAuth:'loopback-stub-not-human-login',
  directProviderRequests:0,directDispatchRequests:0,secretEnvironmentRead:false,newInfrastructure:false,realPayment:false};
}
async function waitFor(deadline:number,condition:()=>Promise<boolean>){while(Date.now()<deadline){if(await condition())return;await new Promise(r=>setTimeout(r,4000));}throw Error('Operational proof wait budget exhausted');}

async function main(){
 let runtime:Runtime|undefined,control:DocumentReference|undefined,created=false,server:Server|undefined,directory:string|undefined;
 const pending=new Set<Promise<unknown>>(),report:ProofReport={runId:null,result:'FAIL',stage:'init',checks:[],providerCalls:null,oldGenerations404:0,markers:0,downloadCount:0,deniedGcsReads:0};
 const accounts:{owner?:string;other?:string}={},inputs:{speech?:string;silent?:string}={},jobs:{speech?:string;silent?:string}={};
 const plannedKeys=new Set<string>(),oldGenerations=new Map<string,CloudObject>();let failure:unknown,cleanupOk=false;
 const deadline=Date.now()+22*60000,cleanupDeadline=Date.now()+27*60000;
 try{
  const plan=assertThreeFixesBoundary(process.env);report.runId=plan.runId;runtime=await cloudFilesRuntime('validate');assert.equal(runtime.root.path,'vistavo/candidate-v1');
  control=runtime.root.collection('closeProofs').doc(plan.runId);
  await control.create({kind,runId:plan.runId,state:'created',atMs:Date.now(),ownerUid:plan.ownerUid,otherUid:plan.otherUid,scope:'two synthetic translation jobs; no Auth users'});created=true;
  report.checks.push('managed-boundary');
  const ref=(col:string,id:string)=>runtime!.root.collection(col).doc(id),mutate=<T>(name:string,work:()=>Promise<T>)=>recordedProofMutation(control!,name,work);
  const record=async(stage:Stage,data:Record<string,unknown>={})=>{report.stage=stage;await control!.update({stage,...data,updatedAtMs:Date.now()});};
  await record('accounts');
  for(const role of ['owner','other'] as const){
   const uid=role==='owner'?plan.ownerUid:plan.otherUid,identity=ref('identities',digest(JSON.stringify(['firebase',uid])));assert.equal((await identity.get()).exists,false);
   const account=await mutate('account-'+role,()=>runtime!.backend.accountForUid(uid));accounts[role]=account;
   await control.update({['accounts.'+role]:account});
   await mutate('flags-'+role+'-on',()=>ref('accounts',account).update({aiPilot:true,simulationOnly:true,syntheticProof:{kind,id:plan.runId,role}}));
  }
  await mutate('credit-owner',()=>runtime!.backend.creditVerifiedPurchase(accounts.owner!,'synthetic-close:'+plan.runId,100,1,'synthetic-three-fixes-no-payment','sandbox'));
  assert.deepEqual(await runtime.backend.readBalance(accounts.owner!),{credited:100,available:100,reserved:0,consumed:0,active:0});assert.equal((await runtime.backend.readBalance(accounts.other!)).credited,0);
  directory=await mkdtemp(join(tmpdir(),'vistavo-close-proof-'));await chmod(directory,0o700);const silentPath=join(directory,'silent.mp4');
  await promisify(execFile)('ffmpeg',['-v','error','-nostdin','-n','-f','lavfi','-i','color=c=blue:s=320x180:r=25','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-b:a','32k','-movflags','+faststart','-shortest',silentPath],{timeout:30000,maxBuffer:1024*1024});await chmod(silentPath,0o600);
  const buffers={speech:await readFile('/app/fixtures/ai-es.mp4'),silent:await readFile(silentPath)};assert.equal(buffers.speech.length,414238);assert.equal(digest(buffers.speech),'c004fc91e72eee4835185fa4feffcb4a5d897a35cc5e7c7ee94595bb7dddb8cb');
  await record('uploads');
  for(const role of ['speech','silent'] as const){
   const bytes=buffers[role];assert.ok(bytes.length>0&&bytes.length<8*1024*1024);
   const upload=await mutate('upload-'+role+'-begin',()=>runtime!.files.begin(accounts.owner!,'synthetic-close-'+role+'.mp4',bytes.length,digest(bytes),plan.uploadKeys[role]));
   inputs[role]=upload.id;await control.update({['inputs.'+role]:upload.id});
   await mutate('upload-'+role+'-chunk',()=>runtime!.files.append(accounts.owner!,upload.id,0,bytes));
   await mutate('upload-'+role+'-complete',()=>runtime!.files.complete(accounts.owner!,upload.id));
  }
  await waitFor(deadline,async()=>{const statuses=await Promise.all(Object.values(inputs).map(id=>runtime!.files.status(accounts.owner!,id)));if(statuses.some(x=>['deleting','deleted'].includes(x.state)))throw Error('Source validation failed');return statuses.every(x=>x.state==='ready');});
  report.checks.push('sources-ready');
  for(const role of ['speech','silent'] as const){
   const upload=(await ref('uploads',inputs[role]!).get()).data()!;const expected=objectPlan(inputs[role]!,buffers[role].length,upload.chunkBytes);assert.deepEqual(upload.plan,expected);
   for(const key of [...expected.chunks,...expected.groups,expected.final])plannedKeys.add(key);
   for(const chunk of upload.chunks)oldGenerations.set(upload.plan.chunks[chunk.index]+'@'+chunk.generation,{key:upload.plan.chunks[chunk.index],generation:chunk.generation,size:chunk.size});
   const original=upload.receipt.object;oldGenerations.set(original.key+'@'+original.generation,original);
   await mutate('project-'+role,()=>runtime!.backend.saveProject(accounts.owner!,inputs[role]!,0,''));
  }
  await record('queued');
  for(const role of ['speech','silent'] as const){
   const quoted=await runtime.ai.quote(accounts.owner!,inputs[role]!,'translation:en',1);assert.ok(quoted.units>=1&&quoted.units<=30);
   const jobId=await mutate('enqueue-'+role,()=>runtime!.ai.enqueue(accounts.owner!,inputs[role]!,'translation:en',1,plan.jobKeys[role]));jobs[role]=jobId;
   await control.update({['jobs.'+role]:jobId,['quotedUnits.'+role]:quoted.units});
  }
  await record('jobs');
  await waitFor(deadline,async()=>{const rows=await Promise.all(Object.values(jobs).map(id=>runtime!.backend.job(accounts.owner!,id)));return rows.every(j=>['succeeded','failed','unknown','cancelled'].includes(j.state));});
  const speech=await runtime.backend.job(accounts.owner!,jobs.speech!),silent=await runtime.backend.job(accounts.owner!,jobs.silent!);assert.equal(speech.state,'succeeded');assert.equal(silent.state,'failed');assert.equal((silent as any).failureCode,'no_speech');
  const calls=[],jobObservations=[];const digital=assertDigitalZeroObservation(silent,inputs.silent!);assert.equal(digital.proof.channels,1);assert.equal(digital.proof.sampleRate,16000);
  for(const role of ['speech','silent'] as const){
   const id=jobs[role]!,rows=await runtime.root.collection('providerCalls').where('jobId','==',id).get();assert.equal(rows.size,role==='speech'?1:0);
   const call=role==='speech'?rows.docs[0].data():undefined;if(call){assert.equal(call.accountId,accounts.owner);assert.equal(call.state,'received');assert.equal(call.httpStatus,200);assert.equal(call.callKey,'text-window:0000');assert.equal(call.model,'gemini-3.8-flash');assert.match(call.responseSha256,/^[a-f0-9]{64}$/);assert.ok(privateUuid.test(call.attemptId));calls.push({jobId:id,attemptId:call.attemptId,callKey:call.callKey,state:call.state,httpStatus:call.httpStatus,responseSha256:call.responseSha256,usage:call.usage??null});}
   const outbox=await ref('outbox',id).get();jobObservations.push({jobId:id,inputId:inputs[role],role,state:role==='speech'?speech.state:silent.state,...(call?{providerAttemptId:call.attemptId}:{digitalSilenceAttemptId:digital.attemptId}),dispatchAttempt:typeof outbox.get('dispatchAttempt')==='string'?outbox.get('dispatchAttempt'):null,platformExecution:null,platformAcceptance:'PENDING_EXTERNAL_OPERATOR'});
   assert.equal((await ref('movements','reserve:'+id).get()).get('kind'),'reserve');assert.equal((await ref('movements','terminal:'+id).get()).get('kind'),role==='speech'?'capture':'release');
   const artifact=(await ref('artifacts',id).get()).data()!;for(const spec of validateArtifactPlan(artifact.plan).artifacts)plannedKeys.add(spec.key);
   if(role==='speech'){assert.equal(artifact.state,'ready');for(const e of validateArtifactManifest(artifact.plan,artifact.entries))oldGenerations.set(e.key+'@'+e.generation,{key:e.key,generation:e.generation,size:e.size});}
   else{assert.ok(['purging','purged'].includes(artifact.state));assert.deepEqual(artifact.entries,[]);}
  }
  report.providerCalls=calls.length;assert.equal(calls.length,plan.maxProviderCalls);report.checks.push('speech-succeeded','silence-released','one-provider-receipt','digital-zero-no-provider');
  const balance=await runtime.backend.readBalance(accounts.owner!);assert.equal(balance.credited,100);assert.equal(balance.consumed,speech.price);assert.equal(balance.available,100-speech.price);assert.equal(balance.reserved,0);assert.equal(balance.active,0);
  await control.update({providerCalls:calls,jobObservations,digitalSilence:{jobId:jobs.silent,inputId:inputs.silent,...digital},billing:{...balance,realPayment:false},plannedKeys:[...plannedKeys],oldGenerations:[...oldGenerations.values()]});
  await record('access');let reads=0;const originalRead=runtime.objects.read.bind(runtime.objects),countingRead:typeof runtime.objects.read=async(...args)=>{reads++;return originalRead(...args);};runtime.objects.read=countingRead;
  const handler=firestoreHttp({backend:runtime.backend,files:runtime.files,ai:runtime.ai,origin:'http://127.0.0.1',identity:{verifyIdToken:async(token,revoked)=>{assert.equal(revoked,true);const uid=token==='owner'?plan.ownerUid:token==='other'?plan.otherUid:null;if(!uid)throw Error('Synthetic token rejected');const now=Math.floor(Date.now()/1000);return {uid,sub:uid,aud:'vistavo-prod',iss:'https://securetoken.google.com/vistavo-prod',auth_time:now,iat:now,exp:now+3600,email_verified:true,firebase:{identities:{},sign_in_provider:'custom'}};}}});
  server=createServer((req,res)=>{const task=Promise.resolve(handler(req,res));pending.add(task);void task.finally(()=>pending.delete(task)).catch(()=>undefined);});await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
  const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
  const call=(path:string,method='GET',token='owner',headers:Record<string,string>={})=>fetch(origin+path,{method,headers:{Authorization:'Bearer '+token,Origin:'http://127.0.0.1',...headers},signal:AbortSignal.timeout(30000)});
  const target='/api/cloud/ai/jobs/'+jobs.speech,status=await call(target);assert.equal(status.status,200);const dto=await status.json();assert.equal(dto.results.length,5);
  const artifact=(await ref('artifacts',jobs.speech!).get()).data()!,entries=validateArtifactManifest(validateArtifactPlan(artifact.plan),artifact.entries);let first:Buffer|undefined;
  for(const e of entries){const path=target+'/results/'+e.name,response=await call(path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,e.size);assert.equal(digest(bytes),e.sha256);report.downloadCount++;first??=bytes;assert.equal((await call(path,'GET','other')).status,404);}
  assert.equal((await call(target,'GET','other')).status,404);const path=target+'/results/'+entries[0].name,head=await call(path,'HEAD');assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(entries[0].size));assert.equal((await head.arrayBuffer()).byteLength,0);
  const range=await call(path,'GET','owner',{Range:'bytes=0-3'});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),first!.subarray(0,4));
  const silentStatus=await call('/api/cloud/ai/jobs/'+jobs.silent);assert.equal(silentStatus.status,200);assert.deepEqual((await silentStatus.json()).results,[]);report.checks.push('private-downloads');
  await mutate('owner-grant-revoke',()=>ref('accounts',accounts.owner!).update({aiPilot:false,simulationOnly:false}));const beforeDenied=reads;
  for(const [p,method,headers]of [[target,'GET',{}],[path,'GET',{}],[path,'HEAD',{}],[path,'GET',{Range:'bytes=0-3'}]] as const)assert.ok([403,503].includes((await call(p,method,'owner',headers)).status));
  report.deniedGcsReads=reads-beforeDenied;assert.equal(report.deniedGcsReads,0);report.checks.push('revoked-denied');
  await mutate('owner-grant-late-control',()=>ref('accounts',accounts.owner!).update({aiPilot:true,simulationOnly:true}));let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(r=>enter=r),resume=new Promise<void>(r=>release=r);runtime.objects.read=async(...args)=>{enter();await resume;return countingRead(...args);};
  const inFlight=call(path);
  try{await Promise.race([entered,inFlight.then(()=>{throw Error('Expected object-read admission');})]);await mutate('owner-grant-revoke-late',()=>ref('accounts',accounts.owner!).update({aiPilot:false,simulationOnly:false}));release();const response=await inFlight;assert.equal(response.status,200);assert.equal(digest(Buffer.from(await response.arrayBuffer())),entries[0].sha256);}finally{release();await inFlight.catch(()=>undefined);runtime.objects.read=countingRead;}
  const afterLate=reads;assert.ok([403,503].includes((await call(path)).status));assert.equal(reads,afterLate);report.checks.push('late-authorization-control');
 }catch(error){failure=error;report.errorCode=typeof(error as any)?.code==='number'?(error as any).code:'UNCLASSIFIED';
 }finally{
  if(runtime&&control&&created){
   report.stage='cleanup';
   try{
    // Revoke only positively marked synthetic accounts; never repair money or UNKNOWN.
    for(const role of ['owner','other'] as const){const uid=(threeFixesPlan(report.runId!))[role==='owner'?'ownerUid':'otherUid'];
     const identity=await runtime.root.collection('identities').doc(digest(JSON.stringify(['firebase',uid]))).get();const recovered=identity.get('accountId');
     if(!accounts[role]&&typeof recovered==='string'&&privateUuid.test(recovered))accounts[role]=recovered;
     if(accounts[role]){const a=runtime.root.collection('accounts').doc(accounts[role]!),d=await a.get(),marker=d.get('syntheticProof');
      if(marker?.kind!==kind||marker?.id!==report.runId||marker?.role!==role)throw Error('Synthetic account cleanup ownership unavailable');
      await recordedProofMutation(control,'cleanup-flags-'+role,()=>a.update({aiPilot:false,simulationOnly:false}));}
    }
    if(accounts.owner){const plan=threeFixesPlan(report.runId!);
     for(const role of ['speech','silent'] as const){
      if(!inputs[role]){const fileRequest=await runtime.root.collection('fileRequests').doc(digest(JSON.stringify([accounts.owner,plan.uploadKeys[role]]))).get();if(fileRequest.get('accountId')===accounts.owner&&privateUuid.test(fileRequest.get('id')??''))inputs[role]=fileRequest.get('id');}
      if(inputs[role]){const upload=await runtime.root.collection('uploads').doc(inputs[role]!).get();assert.equal(upload.get('accountId'),accounts.owner);await recordedProofMutation(control,'cleanup-source-'+role,()=>runtime!.files.remove(accounts.owner!,inputs[role]!));}
     }
     await waitFor(cleanupDeadline,async()=>{const rows=await Promise.all(Object.values(inputs).map(id=>runtime!.root.collection('uploads').doc(id).get()));const a=await runtime!.root.collection('accounts').doc(accounts.owner!).get();return rows.every(r=>r.get('state')==='deleted'&&r.get('purgeState')==='done')&&['storageReservedBytes','storageCommittedBytes','activeUploads'].every(k=>(a.get(k)??0)===0);});
     for(const key of plannedKeys){const object=await runtime.objects.metadata(key);assert.equal(object?.marker,true);assert.equal(object?.size,0);report.markers++;}
     for(const object of oldGenerations.values()){await assert.rejects(async()=>{const stream=await runtime!.objects.read(object);stream.destroy();throw Error('Old generation still readable');},error=>error instanceof ObjectFault&&error.code==='missing');report.oldGenerations404++;}
     if(!failure){assert.equal(report.markers,14);assert.equal(report.oldGenerations404,9);assert.equal(Object.values(jobs).length,2);
      for(const id of Object.values(jobs)){const artifact=(await runtime.root.collection('artifacts').doc(id).get()).data()!;assert.equal(artifact.state,'purged');assert.deepEqual(artifact.entries,[]);assert.equal((await runtime.backend.job(accounts.owner,id)).snapshot,null);}
      const balance=await runtime.backend.readBalance(accounts.owner);assert.equal(balance.reserved,0);assert.equal(balance.active,0);assert.equal(balance.credited,100);assert.equal(balance.available+balance.consumed,100);
      const ownerJobs=await runtime.root.collection('jobs').where('accountId','==',accounts.owner).get();assert.equal(ownerJobs.size,2);const receipts=await runtime.root.collection('providerCalls').where('accountId','==',accounts.owner).get();assert.equal(receipts.size,1);assert.equal(report.providerCalls,1);assert.equal((await runtime.root.collection('providerCalls').where('jobId','==',jobs.silent).get()).size,0);
      for(const id of Object.values(inputs))assert.equal((await runtime.root.collection('projects').doc(id).get()).exists,false);
      report.checks.push('old-generations-inaccessible','cleanup-complete');cleanupOk=true;
     }
    }
   }catch(error){failure??=error;report.errorCode=typeof(error as any)?.code==='number'?(error as any).code:'UNCLASSIFIED';}
   report.result=!failure&&cleanupOk?'PASS':'FAIL';report.stage='done';
   const summary=threeFixesSummary(report);await control.update({state:report.result,finishedAtMs:Date.now(),summary,accounts,inputs,jobs,auditRecordsPreserved:true}).catch(()=>{report.result='FAIL';});
  }
  if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));}await Promise.allSettled([...pending]);
  if(directory)try{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('vistavo-close-proof-'));await rm(directory,{recursive:true,force:true});}catch{report.result='FAIL';}
  if(runtime)await runtime.close().catch(()=>{report.result='FAIL';});
  console.log(JSON.stringify(threeFixesSummary(report)));if(report.result!=='PASS')process.exitCode=1;
 }
}
// Exact, native-only entry. Imports for tests/bundling never create credentials or fixtures.
if(process.argv[1]===entry)void main();
