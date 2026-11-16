import {performance} from 'node:perf_hooks';
type DispatchClaim={accountId:string;jobId:string;dispatchAttempt:string};
export interface AiDrainDependencies {
 recover(limit:number):Promise<number|{scanned:number;recovered:number;failures:{jobId:string|null;stage:string;code?:string|number}[]}>;
 pending(limit:number):Promise<string[]>;
 eligible(jobId:string):Promise<boolean>;
 claim(jobId:string):Promise<DispatchClaim|null>;
 acknowledge(jobId:string,attempt:string):Promise<unknown>;
 pendingPurges(limit:number):Promise<string[]>;
 claimPurge(jobId:string):Promise<boolean>;
 start(kind:'ai'|'purge',jobId:string,accountId:string|undefined,signal:AbortSignal):Promise<void>;
}
/** Quantity and admission/network budgets; an in-flight Firestore SDK operation is NOT cancelable here. */
export async function drainCloudAi(deps:AiDrainDependencies,options:{now?:()=>number;budgetMs?:number;networkMs?:number}={}){
 const now=options.now??(()=>performance.now()),budget=options.budgetMs??20000,network=options.networkMs??5000;
 if(!Number.isSafeInteger(budget)||budget<1||budget>60000||!Number.isSafeInteger(network)||network<1||network>20000)throw Error('Invalid dispatch budget');
 const deadline=now()+budget,remaining=()=>deadline-now();
 const result={recovered:0,startsAttempted:0,startsAccepted:0,purgesAttempted:0,purgesAccepted:0,skipped:0,failures:[] as {stage:string;jobId?:string|null;code?:string|number}[],budgetExhausted:false};
 const admitted=()=>{if(remaining()>0)return true;result.budgetExhausted=true;return false;};
 if(admitted())try{const report=await deps.recover(3);if(typeof report==='number')result.recovered=report;else{result.recovered=report.recovered;result.failures.push(...report.failures.slice(0,3));}}catch{result.failures.push({stage:'recover-query'});}
 let jobs:string[]=[],purges:string[]=[];
 if(admitted())try{jobs=(await deps.pending(30)).slice(0,30);}catch{result.failures.push({stage:'pending'});}
 if(admitted())try{purges=(await deps.pendingPurges(3)).slice(0,3);}catch{result.failures.push({stage:'pending-purges'});}
 // Interleave queues so one failing/slow start does not consume all purge admissions.
 for(let i=0;i<Math.max(jobs.length,purges.length);i++){
  if(!admitted())break;
  const jobId=jobs[i];
  if(jobId&&result.startsAttempted<3){
   try{
    if(!await deps.eligible(jobId)){result.skipped++;}
    else if(admitted()){
     const claim=await deps.claim(jobId);
     if(claim&&admitted()){
      result.startsAttempted++;
      await deps.start('ai',jobId,claim.accountId,AbortSignal.timeout(Math.max(1,Math.min(network,remaining()))));
      result.startsAccepted++;
      if(admitted())await deps.acknowledge(jobId,claim.dispatchAttempt);
     }
    }
   }catch{result.failures.push({stage:'start-or-ack',jobId});}
  }
  const purgeId=purges[i];
  if(purgeId&&result.purgesAttempted<3&&admitted())try{
   const claimed=await deps.claimPurge(purgeId);
   if(claimed&&admitted()){
    result.purgesAttempted++;
    await deps.start('purge',purgeId,undefined,AbortSignal.timeout(Math.max(1,Math.min(network,remaining()))));
    result.purgesAccepted++;
   }
  }catch{result.failures.push({stage:'purge-start',jobId:purgeId});}
 }
 admitted();return result;
}

/** Files share the same durable recovery policy; no unbounded Promise.all fan-out. */
export async function drainCloudFiles(deps:{pending:()=>Promise<string[]|{ids:string[];failures:{stage:string;id:string|null;code?:string|number}[]}>;dispatch:(id:string,timeoutMs:number)=>Promise<void>},options:{now?:()=>number;budgetMs?:number}={}){
 const now=options.now??(()=>performance.now()),budget=options.budgetMs??20000;
 if(!Number.isSafeInteger(budget)||budget<1||budget>60000)throw Error('Invalid files budget');
 const deadline=now()+budget,result={due:0,attempted:0,accepted:0,failed:0,deferred:0,failures:[] as {stage:string;id:string|null;code?:string|number}[]};let ids:string[];
 try{const report=await deps.pending();ids=Array.isArray(report)?report:report.ids;if(!Array.isArray(report)){result.failures=report.failures.slice(0,26);result.failed=report.failures.length;}result.due=ids.length;}catch{result.failed=1;result.failures.push({stage:'pending',id:null});return result;}
 for(const id of ids.slice(0,3)){
  const left=Math.floor(deadline-now());if(left<1)break;result.attempted++;
  try{await deps.dispatch(id,Math.min(5000,left));result.accepted++;}catch{result.failed++;result.failures.push({stage:'dispatch',id});}
 }
 result.deferred=result.due-result.attempted;return result;
}

/** Fixed project/targets and managed access token only; no provider request or service-account key. */
export function aiJobStarter(accessToken:()=>Promise<string>,request:typeof fetch=fetch):AiDrainDependencies['start']{
 return async(kind,jobId,accountId,signal)=>{
  const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  if(!['ai','purge'].includes(kind)||!uuid.test(jobId)||kind==='ai'&&(!accountId||!uuid.test(accountId)))throw Error('Invalid dispatch identity');
  signal.throwIfAborted();const token=await accessToken();signal.throwIfAborted();
  const target=kind==='ai'?'vistavo-ai-process':'vistavo-files-cleanup';
  const env=kind==='ai'?[{name:'VISTAVO_ACCOUNT_ID',value:accountId!},{name:'VISTAVO_JOB_ID',value:jobId}]:[{name:'VISTAVO_RESULT_JOB_ID',value:jobId}];
  const response=await request('https://run.googleapis.com/v2/projects/vistavo-prod/locations/us-central1/jobs/'+target+':run',{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','x-goog-user-project':'vistavo-prod'},
   body:JSON.stringify({overrides:{taskCount:1,containerOverrides:[{env}]}}),signal});
  if(!response.ok){await response.body?.cancel();throw Error('AI dispatch unavailable');}
  const data=await response.json();
  if(typeof data.name!=='string'||!data.name.startsWith('projects/vistavo-prod/locations/us-central1/operations/')||data.error)throw Error('Invalid dispatch receipt');
 };
}
