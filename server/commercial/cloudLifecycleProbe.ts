import assert from 'node:assert/strict';
import {processCloudAi} from './cloudAiWorker';
import {firestoreRuntime} from './firestoreRuntime';
import {privateBucket} from './privateObjectPlan';
import {buildWavRiff,validateWavRiff} from './pipelineVoiceWav';
import {VOICE_MODEL} from './pipelineVoiceProvider';
import type {FirestoreAi} from './firestoreAi';

function gate(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes;});return {promise,resolve};}
async function within<T>(promise:Promise<T>,ms:number){let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Probe admission timeout')),ms);})]);}finally{clearTimeout(timer!);}}
/** Actual worker/timer; business, provider, GCS and financial effects are deliberately fake. */
export async function exerciseWorkerLifecycle(options:{heartbeatRead(beforeRead:()=>Promise<void>):Promise<boolean>;close():Promise<void>}){
 const entered=gate(),release=gate(),finished=gate();let state='running',returned=false,sdkSettled=false,sdkSucceeded=false;
 let heartbeatCalls=0,invokeCalls=0,uploadCalls=0,finishCalls=0,closeCalls=0,closedWhilePending=false,heartbeat:Promise<boolean>|undefined;
 const account='11111111-1111-4111-8111-111111111111',inputId='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333',attemptId='44444444-4444-4444-8444-444444444444';
 const binding={bucket:privateBucket,key:'candidate-files-v1/'+inputId+'/video.mp4',generation:'1',size:1,sha256:'a'.repeat(64)};
 const input={accountId:account,ready:true,deleted:false,unknownCount:0,expiresAtMs:Date.now()+60000,sha256:binding.sha256,storage:binding};
 const pcm=Buffer.alloc(4800);for(let n=0;n<2400;n++)pcm.writeInt16LE(Math.round(2000*Math.sin(n/12)),n*2);
 const payload={candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'audio/wav',data:buildWavRiff(pcm).toString('base64')}}]}}]};
 const backend={recover:async()=>false,claim:async()=>({attemptId}),
  job:async()=>({aiProfile:'ai-candidate-v1',accountId:account,inputId,operation:'narration:en:female',snapshot:{draft:'Synthetic lifecycle verification.'},inputStorage:binding,state,attemptId,invocationPhase:state==='running'?'invoking':null}),
  heartbeat:async()=>{heartbeatCalls++;assert.equal(heartbeatCalls,1);heartbeat=options.heartbeatRead(async()=>{entered.resolve();await release.promise;}).then(ok=>{sdkSucceeded=ok;return ok;}).finally(()=>{sdkSettled=true;});return heartbeat;},
  beginInvocation:async()=>true,finish:async()=>{finishCalls++;state='succeeded';finished.resolve();return true;},
  quarantine:async()=>{state='unknown';},failBeforeInvocation:async()=>{state='failed';},
 };
 const ai={backend,enabled:async()=>{},root:{collection:(name:string)=>{assert.equal(name,'inputs');return {doc:()=>({get:async()=>({data:()=>input})})};}},
  objects:{read:async()=>{throw Error('GCS access forbidden in lifecycle probe');},putArtifactOnce:async()=>{throw Error('GCS write forbidden in lifecycle probe');}},
  invoke:()=>async(callKey:string,model:string)=>{invokeCalls++;assert.equal(invokeCalls,1);assert.equal(callKey,'voice-chunk:0000');assert.equal(model,VOICE_MODEL);await within(entered.promise,15000);return payload;},
  uploadResults:async(_account:string,_job:string,_attempt:string,outputs:Map<string,Buffer>)=>{uploadCalls++;assert.deepEqual([...outputs.keys()],['narration-en.wav']);assert.equal(validateWavRiff(outputs.get('narration-en.wav')!).durationMs,100);return [];},
 } as unknown as FirestoreAi;
 let failure:unknown;const worker=processCloudAi(ai,account,jobId,'synthetic-transport-only-no-provider-request').then(value=>{returned=true;return value;});
 try{
  await within(entered.promise,15000);await within(finished.promise,5000);
  // Span the real worker's next four-second interval: the pending SDK operation must coalesce.
  await new Promise(resolve=>setTimeout(resolve,4200));
  assert.equal(state,'succeeded');assert.equal(returned,false,'Worker must not return while SDK heartbeat is held');assert.equal(sdkSettled,false);assert.equal(closeCalls,0);assert.equal(heartbeatCalls,1);
  release.resolve();assert.equal(await worker,'succeeded');assert.equal(sdkSettled,true);assert.equal(sdkSucceeded,true);assert.equal(invokeCalls,1);assert.equal(uploadCalls,1);assert.equal(finishCalls,1);
 }catch(error){failure=error;}finally{
  release.resolve();await worker.catch(()=>undefined);await heartbeat?.catch(()=>undefined);
  closedWhilePending=!!heartbeat&&!sdkSettled;closeCalls++;await options.close();
 }
 if(failure)throw failure;
 assert.equal(closedWhilePending,false);assert.equal(closeCalls,1);
 return {result:'PASS',scope:'native readonly Firestore SDK heartbeat plus actual worker with fake provider/business',heartbeatCalls,heartbeatSettledBeforeWorkerReturn:sdkSettled,coalescedWhileHeld:true,workerReturnedWhileHeartbeatHeld:false,callerCloseWhileHeartbeatHeld:0,closeCalls,closedWhilePending,invokeCalls,uploadCalls,finishCalls,realProviderRequests:0,gcsWrites:0,financialWrites:0,businessFixturesOnly:true,holdMs:4200};
}

async function main(){
 let runtime:ReturnType<typeof firestoreRuntime>|undefined,runtimeClosed=false;
 try{
  assert.equal(process.env.CLOUD_RUN_JOB,'vistavo-ai-process');assert.equal(process.env.VISTAVO_PROJECT_ID,'vistavo-prod');
  const metadata=async(path:string)=>{const r=await fetch('http://metadata.google.internal/computeMetadata/v1/'+path,{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);assert.equal(r.headers.get('Metadata-Flavor'),'Google');return r.text();};
  assert.equal(await metadata('project/project-id'),'vistavo-prod');assert.equal(await metadata('instance/service-accounts/default/email'),'vistavo-runtime@vistavo-prod.iam.gserviceaccount.com');
  runtime=firestoreRuntime('vistavo-prod');const root=runtime.root;assert.equal(root.path,'vistavo/candidate-v1');const warm=await root.get();assert.equal(warm.get('schemaVersion'),2);assert.equal(warm.get('service'),'vistavo');
  let readonlyReads=0;
  const result=await exerciseWorkerLifecycle({
   heartbeatRead:beforeRead=>runtime!.db.runTransaction(async tx=>{await beforeRead();readonlyReads++;const current=await tx.get(root);assert.equal(current.get('schemaVersion'),2);assert.equal(current.get('service'),'vistavo');return true;},{readOnly:true}),
   close:async()=>{assert.equal(readonlyReads,1);runtimeClosed=true;await runtime!.close();},
  });
  console.log(JSON.stringify({event:'cloud-lifecycle-probe',...result,nativeReadonlyReads:readonlyReads,warmRootReads:1,nativeTransactionSettledBeforeClose:true,secretEnvironmentRead:false,newResourceCreated:false,note:'Not a fresh paid generation, GCS pipeline proof, or financial transaction. SDK operation completion is awaited; hold/admission timeouts are not an absolute SDK deadline.'}));
 }catch(error){console.error(JSON.stringify({event:'cloud-lifecycle-probe',result:'FAIL',type:error instanceof Error&&/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)?error.name:'Error',code:typeof(error as {code?:unknown})?.code==='number'?(error as {code:number}).code:'UNCLASSIFIED',scope:'native readonly SDK + fake provider/business only'}));process.exitCode=1;
 }finally{if(runtime&&!runtimeClosed)await runtime.close().catch(()=>{process.exitCode=1;});}
}
// Native-only operator entrypoint. Importing the helper for unit tests never creates credentials.
if(process.argv[1]==='/app/cloud-lifecycle-probe.mjs')void main();
