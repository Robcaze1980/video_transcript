import type {FirestoreAi} from './firestoreAi';
import {LedgerFault} from './firestoreBackend';
import {AI_CATALOG_VERSION,aiOperation} from './aiContracts';
import {privateUuid} from './privateObjectPlan';
import {diagnosticStage,diagnosticEnqueueFailure,diagnosticEnqueueRecovered} from './cloudDiagnostics';

type EnqueueRequest={inputId:string;operation:unknown;expectedRevision:number;requestKey:string};
/** Recover an uncertain ACK by authoritative reads only. Never retry reserve/provider or infer a missing commit. */
export async function reserveWithRecovery(ai:FirestoreAi,accountId:string,data:EnqueueRequest,reserve:()=>Promise<string>,expectedFault:(error:unknown)=>boolean):Promise<string>{
 try{return await reserve();}
 catch(error){
  if(expectedFault(error))throw error;
  diagnosticEnqueueFailure(error);
  return diagnosticStage('enqueue.recovery',async()=>{
   try{
    await ai.enabled(accountId);
    const operation=aiOperation(data.operation),jobId=await diagnosticStage('enqueue.recovery.request',()=>ai.backend.priorRequest(accountId,data.inputId,data.requestKey,operation,data.expectedRevision,AI_CATALOG_VERSION));
    if(!jobId)throw error;
    if(typeof jobId!=='string'||!privateUuid.test(jobId))throw new LedgerFault('invariant');
    const job=await diagnosticStage('enqueue.recovery.job',()=>ai.backend.job(accountId,jobId));
    if(job.accountId!==accountId||job.inputId!==data.inputId||job.operation!==operation||job.revision!==data.expectedRevision||job.requestKey!==data.requestKey||job.aiProfile!==AI_CATALOG_VERSION)throw new LedgerFault('invariant');
    await ai.enabled(accountId);
    diagnosticEnqueueRecovered();return jobId;
   }catch(recoveryError){if(expectedFault(recoveryError))throw recoveryError;throw error;}
  });
 }
}
