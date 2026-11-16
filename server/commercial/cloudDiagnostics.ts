import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {Firestore,Transaction} from 'firebase-admin/firestore';
const allowed=['auth','authorization','routing','identity','identity.read','identity.callback','request.lookup','project','project.read','project.callback','reserve','reserve.read','reserve.callback','reserve.writes_staged','enabled','quote','quote.input','quote.catalog','enqueue.recovery','enqueue.recovery.request','enqueue.recovery.job'] as const;
type Stage=typeof allowed[number];
type Trace={traceId:string;started:number;stages:Partial<Record<Stage,{calls:number;durationMs:number;errors:number}>>;attempts:Partial<Record<Stage,number>>;postCallbackOuterPendingMs:Partial<Record<Stage,number>>;error?:{type:string;code:number|'UNCLASSIFIED'};enqueueFailure?:{type:string;code:number|'UNCLASSIFIED'};enqueueRecovered?:true};
const storage=new AsyncLocalStorage<Trace>();
const errorTypes=new Set(['Error','TypeError','RangeError','SyntaxError','FirebaseAuthError','FirebaseError','GoogleError','LedgerFault','AiFault','AiContractFault','FileFault','ObjectFault','HttpFault']);
const elapsed=(start:number)=>Math.round((performance.now()-start)*1000)/1000;
export function sanitizedCloudError(error:unknown){
 try{
 const type=error instanceof Error&&errorTypes.has(error.name)?error.name:error instanceof Error?'Error':typeof error;
 const code=(error as {code?:unknown}|null)?.code;
 return {type,code:typeof code==='number'&&Number.isSafeInteger(code)?code:'UNCLASSIFIED' as const};
 }catch{return {type:'Error',code:'UNCLASSIFIED' as const};}
}
export function cloudDiagnosticError(error:unknown){const context=storage.getStore();if(context)context.error=sanitizedCloudError(error);}
export function diagnosticEnqueueFailure(error:unknown){const context=storage.getStore();if(context)context.enqueueFailure??=sanitizedCloudError(error);}
export function diagnosticEnqueueRecovered(){const context=storage.getStore();if(context)context.enqueueRecovered=true;}
export function diagnosticMark(stage:'reserve.writes_staged'){const c=storage.getStore();if(c){const value=c.stages[stage]??={calls:0,durationMs:0,errors:0};value.calls++;}}
/** Only fixed stage names, counts and monotonic timing enter the trace. No arguments or SDK objects. */
export async function diagnosticStage<T>(stage:Stage,work:()=>Promise<T>):Promise<T>{
 const context=storage.getStore();if(!context)return work();
 const start=performance.now(),value=context.stages[stage]??={calls:0,durationMs:0,errors:0};value.calls++;
 try{return await work();}catch(error){value.errors++;throw error;}finally{value.durationMs=Math.round((value.durationMs+elapsed(start))*1000)/1000;}
}
export function diagnosticTransaction<T>(stage:'identity'|'project'|'reserve',db:Firestore,work:(tx:Transaction)=>Promise<T>):Promise<T>{
 return diagnosticStage(stage,async()=>{let lastCallbackEnd:number|undefined;try{return await db.runTransaction(tx=>{const c=storage.getStore();if(c)c.attempts[stage]=(c.attempts[stage]??0)+1;return diagnosticStage(`${stage}.callback`,async()=>{try{return await work(tx);}finally{lastCallbackEnd=performance.now();}});});}finally{const c=storage.getStore();if(c&&lastCallbackEnd!==undefined)c.postCallbackOuterPendingMs[stage]=elapsed(lastCallbackEnd);}});
}
export function withCloudDiagnostics<T>(work:(traceId:string)=>Promise<T>,status:()=>number,emit:(line:string)=>void=console.error,diagnosticOnlyCollectAll=false):Promise<T>{
 const context:Trace={traceId:randomUUID(),started:performance.now(),stages:{},attempts:{},postCallbackOuterPendingMs:{}};
 return storage.run(context,async()=>{try{return await work(context.traceId);}finally{
  const durationMs=elapsed(context.started),httpStatus=status();
  if(diagnosticOnlyCollectAll||context.error||context.enqueueFailure||httpStatus>=500||durationMs>=1500)try{emit(JSON.stringify({event:context.error||httpStatus>=500?'cloud-http-internal':context.enqueueRecovered?'cloud-http-recovered':durationMs>=1500?'cloud-http-slow':'cloud-diagnostic-sample',...(context.error??{}),...(context.enqueueFailure?{enqueueFailure:context.enqueueFailure,enqueueRecovered:context.enqueueRecovered===true}:{}),traceId:context.traceId,status:httpStatus,durationMs,stages:context.stages,attempts:context.attempts,postCallbackOuterPendingMs:context.postCallbackOuterPendingMs}));}catch{/* Observability must not change a durable commit or mask the original result. */}
 }});
}
