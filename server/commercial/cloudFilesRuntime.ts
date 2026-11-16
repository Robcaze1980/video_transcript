import {FirestoreAi} from './firestoreAi';
import {processCloudAi} from './cloudAiWorker';
import {drainCloudAi,drainCloudFiles,aiJobStarter} from './cloudAiDispatch';
import {createServer} from 'node:http';
import {firestoreRuntime} from './firestoreRuntime';
import {FirestoreFiles,type FileRole} from './firestoreFiles';
import {GcsObjects} from './gcsObjects';
import {privateBucket,privateUuid} from './privateObjectPlan';
import {privateVideoProbe} from './privateVideoProbe';
import {firestoreHttp} from './firestoreHttp';

const accounts={api:'vistavo-files-api',validate:'vistavo-files-validator',cleanup:'vistavo-files-cleaner',maintenance:'vistavo-files-maintenance',proof:'vistavo-bootstrap',ai:'vistavo-runtime'} as const;
export async function cloudFilesRuntime(role:keyof typeof accounts){
 if(process.env.VISTAVO_PROJECT_ID!=='vistavo-prod')throw Error('Project boundary');
 const metadata=async(path:string)=>{const r=await fetch('http://metadata.google.internal/computeMetadata/v1/'+path,{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(5000)});
  if(!r.ok||r.headers.get('Metadata-Flavor')!=='Google')throw Error('Managed identity unavailable');return r.text();};
 const [project,email]=await Promise.all([metadata('project/project-id'),metadata('instance/service-accounts/default/email')]);
 if(project!=='vistavo-prod'||email!==accounts[role]+'@vistavo-prod.iam.gserviceaccount.com')throw Error('Identity boundary');
 const runtime=firestoreRuntime('vistavo-prod');
 try{
  const marker=(await runtime.root.get()).data();
  if(marker?.schemaVersion!==2||marker?.service!=='vistavo'||marker?.environment!=='candidate'||marker?.storageProtocol!=='immutable-chunks-v1')throw Error('Schema boundary');
  const objects=new GcsObjects({bucket:privateBucket,projectId:'vistavo-prod',accessToken:runtime.accessToken});
  const ai=new FirestoreAi(runtime.db,runtime.root,runtime.backend,objects);
  const files=new FirestoreFiles(runtime.db,runtime.root,objects,{},(accountId,inputId)=>ai.purgeInput(accountId,inputId));
  const dispatch=async(id:string,timeoutMs=20000)=>{
   if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000)throw Error('Invalid dispatch timeout');
   const signal=AbortSignal.timeout(timeoutMs);
   if(!privateUuid.test(id))throw Error('Invalid upload');const claim=await files.claimDispatch(id);if(!claim)return;
   signal.throwIfAborted();const token=await runtime.accessToken();signal.throwIfAborted();
   const job=claim.role==='validate'?'vistavo-files-validate':'vistavo-files-cleanup';
   const response=await fetch('https://run.googleapis.com/v2/projects/vistavo-prod/locations/us-central1/jobs/'+job+':run',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','x-goog-user-project':'vistavo-prod'},
    body:JSON.stringify({overrides:{containerOverrides:[{env:[{name:'VISTAVO_UPLOAD_ID',value:id}]}]}}),signal});
   if(!response.ok)throw Error('Dispatch unavailable');await response.body?.cancel();await files.acknowledgeDispatch(id,claim.token);
  };
  const nudgeAi=async()=>{
   if(process.env.VISTAVO_AI_ENABLED!=='1')return;
   return drainCloudAi({
    recover:limit=>runtime.backend.recoverExpiredLeasesReport(limit),
    pending:limit=>runtime.backend.pendingAiDispatches(limit),
    // Inspect immutable job profile before claiming: never consume another worker's outbox lease.
    eligible:jobId=>runtime.backend.aiDispatchEligible(jobId),
    claim:jobId=>runtime.backend.claimDispatch(jobId),
    acknowledge:(jobId,attempt)=>runtime.backend.acknowledgeDispatch(jobId,attempt),
    pendingPurges:limit=>ai.pendingPurges(limit),
    claimPurge:jobId=>{
     const ref=runtime.root.collection('artifacts').doc(jobId);
     return runtime.db.runTransaction(async tx=>{const d=await tx.get(ref);if(!d.exists||d.get('state')!=='purging'||d.get('nextAttemptAt')>Date.now())return false;tx.update(ref,{nextAttemptAt:Date.now()+60000});return true;});
    },
    start:aiJobStarter(runtime.accessToken),
   });
  };
  return {...runtime,objects,files,dispatch,ai,nudgeAi};
 }catch(error){await runtime.close();throw error;}
}
export async function filesMain(){
 const mode=process.env.VISTAVO_FILES_MODE;
 if(mode==='ai'){
  const runtime=await cloudFilesRuntime('ai');
  try{const accountId=process.env.VISTAVO_ACCOUNT_ID,jobId=process.env.VISTAVO_JOB_ID,key=process.env.VISTAVO_GEMINI_KEY;
   if(!accountId||!jobId||!privateUuid.test(accountId)||!privateUuid.test(jobId)||!key||key.length<20)throw Error('AI worker configuration unavailable');
   const state=await processCloudAi(runtime.ai,accountId,jobId,key);console.log(JSON.stringify({event:'ai-worker',state,jobId}));
  }finally{await runtime.close();}return;
 }
 if(mode==='validate'||mode==='cleanup'){
  const runtime=await cloudFilesRuntime(mode),id=process.env.VISTAVO_UPLOAD_ID;
  try{const resultId=process.env.VISTAVO_RESULT_JOB_ID;if(mode==='cleanup'&&resultId){if(!privateUuid.test(resultId))throw Error('Result boundary');await runtime.ai.purgeResult(resultId);return;}if(!id||!privateUuid.test(id))throw Error('Upload boundary');
   const state=await runtime.files.work(id,mode as FileRole,mode==='validate'?privateVideoProbe(runtime.objects):undefined);
   if(state==='cleaning'||state==='deleting')await runtime.dispatch(id).catch(()=>undefined);
   console.log(JSON.stringify({event:'file-worker',role:mode,state}));
  }finally{await runtime.close();}return;
 }
 if(mode!=='api'&&mode!=='maintenance')throw Error('Mode boundary');
 const runtime=await cloudFilesRuntime(mode);
 const server=createServer(mode==='api'?firestoreHttp({backend:runtime.backend,identity:runtime.identity,origin:'https://vistavo.app',files:runtime.files,...(process.env.VISTAVO_AI_ENABLED==='1'?{ai:runtime.ai}:{})}):async(req,res)=>{
  // IAM-authenticated internal Cloud Run service, invokable only by Scheduler.
  if(req.method!=='POST'||req.url!=='/internal/maintenance'){req.resume();res.writeHead(404).end();return;}
  try{req.resume();const fileDrain=await drainCloudFiles({pending:()=>runtime.files.maintenanceReport(),dispatch:runtime.dispatch});
   const aiDrain=await runtime.nudgeAi();
   const failed=fileDrain.failed+(aiDrain?.failures.length??0);res.writeHead(failed?503:200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({due:fileDrain.due,failed,fileDrain,aiDrain}));
  }catch(error){console.error(JSON.stringify({event:'maintenance-failed',type:error?.name,code:error?.code}));res.writeHead(503,{'Cache-Control':'no-store'}).end();}
 });
 server.requestTimeout=180000;server.headersTimeout=30000;
 server.listen(Number(process.env.PORT)||8080,'0.0.0.0');
 process.once('SIGTERM',()=>server.close(()=>void runtime.close().finally(()=>process.exit(0))));
}
