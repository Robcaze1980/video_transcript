import {it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {firestoreHttp} from './firestoreHttp';
import {AiFault,FirestoreAi} from './firestoreAi';
import {LedgerFault,type FirestoreBackend} from './firestoreBackend';
import {AI_CATALOG_VERSION,AiContractFault} from './aiContracts';
import {reserveWithRecovery} from './cloudEnqueueRecovery';
const enqueueWithRecovery=(ai:FirestoreAi,account:string,data:{inputId:string;operation:unknown;expectedRevision:number;requestKey:string})=>reserveWithRecovery(ai,account,data,()=>ai.enqueue(account,data.inputId,data.operation,data.expectedRevision,data.requestKey),error=>error instanceof AiFault||error instanceof LedgerFault||error instanceof AiContractFault);

it('AI POST returns the durable job after commit ACK is lost without a second enqueue',async()=>{
 const account=randomUUID(),input=randomUUID(),jobId=randomUUID(),requestKey='same-key-after-ack-loss';let committed=false,enqueueCalls=0;
 const backend={accountForUid:async()=>account,priorRequest:async()=>committed?jobId:null,job:async()=>({accountId:account,inputId:input,operation:'narration:en:female',revision:1,requestKey,aiProfile:AI_CATALOG_VERSION}),reserve:async()=>{enqueueCalls++;committed=true;throw Object.assign(new Error('synthetic-private-error'),{code:4});}};
 const ai=new FirestoreAi({} as never,{} as never,backend as unknown as FirestoreBackend,{} as never);ai.enabled=async()=>undefined;ai.quote=async()=>({units:1,operation:'narration:en:female'} as never);
 const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);
 const server=createServer(firestoreHttp({backend:backend as unknown as FirestoreBackend,ai:ai as unknown as FirestoreAi,origin:'http://127.0.0.1',identity:{verifyIdToken:async()=>({uid:'synthetic-owner',email_verified:true} as unknown as import('firebase-admin/auth').DecodedIdToken)}}));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const port=(server.address() as {port:number}).port,response=await fetch('http://127.0.0.1:'+port+'/api/cloud/ai/jobs',{method:'POST',headers:{Authorization:'Bearer synthetic-only','Content-Type':'application/json'},body:JSON.stringify({inputId:input,operation:'narration:en:female',expectedRevision:1,requestKey})});
  expect(response.status).toBe(202);expect(await response.json()).toEqual({id:jobId});expect(enqueueCalls).toBe(1);
  expect(log).toHaveBeenCalledTimes(1);const trace=JSON.parse(log.mock.calls[0][0]);
  expect(trace.event).toBe('cloud-http-recovered');expect(trace.status).toBe(202);expect(trace.enqueueFailure).toEqual({type:'Error',code:4});expect(trace.enqueueRecovered).toBe(true);expect(trace.traceId).toBe(response.headers.get('x-vistavo-trace'));
  expect(trace.stages['enqueue.recovery.request'].calls).toBe(1);expect(JSON.stringify(trace)).not.toContain('synthetic-private-error');
 }finally{log.mockRestore();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

function recoveryFixture(){
 const account=randomUUID(),input=randomUUID(),jobId=randomUUID(),data={inputId:input,operation:'narration:en:female',expectedRevision:1,requestKey:'original-request'},error=Object.assign(new Error('private-original'),{code:4});
 const job={accountId:account,inputId:input,operation:data.operation,revision:1,requestKey:data.requestKey,aiProfile:AI_CATALOG_VERSION};
 const backend={priorRequest:vi.fn(async()=>jobId as string|null),job:vi.fn(async()=>job)},enabled=vi.fn(async()=>undefined),enqueue=vi.fn(async()=>{throw error;});
 return {account,input,jobId,data,error,job,backend,enabled,enqueue,ai:{backend,enabled,enqueue} as unknown as FirestoreAi};
}
it('a successful enqueue performs no recovery reads',async()=>{
 const c=recoveryFixture();c.enqueue.mockResolvedValueOnce(c.jobId as never);expect(await enqueueWithRecovery(c.ai,c.account,c.data)).toBe(c.jobId);expect(c.backend.priorRequest).not.toHaveBeenCalled();expect(c.enabled).not.toHaveBeenCalled();
});
it.each([new AiFault('conflict'),new AiFault('disabled'),new LedgerFault('insufficient'),new LedgerFault('invariant'),new AiContractFault('quota')])('does not conceal or retry an expected typed failure %s',async fault=>{
 const c=recoveryFixture();c.enqueue.mockRejectedValueOnce(fault);await expect(enqueueWithRecovery(c.ai,c.account,c.data)).rejects.toBe(fault);expect(c.backend.priorRequest).not.toHaveBeenCalled();expect(c.enqueue).toHaveBeenCalledTimes(1);
});
it('missing commit remains the original failure, without a second mutation',async()=>{
 const c=recoveryFixture();c.backend.priorRequest.mockResolvedValueOnce(null);await expect(enqueueWithRecovery(c.ai,c.account,c.data)).rejects.toBe(c.error);expect(c.backend.job).not.toHaveBeenCalled();expect(c.enqueue).toHaveBeenCalledTimes(1);
});
it('an unavailable recovery read preserves the original ambiguous failure',async()=>{
 const c=recoveryFixture();c.backend.priorRequest.mockRejectedValueOnce(Object.assign(new Error('private-secondary'),{code:14}));await expect(enqueueWithRecovery(c.ai,c.account,c.data)).rejects.toBe(c.error);expect(c.backend.job).not.toHaveBeenCalled();expect(c.enqueue).toHaveBeenCalledTimes(1);
});
it('lookup binds the exact original request identity and AI profile',async()=>{
 const c=recoveryFixture();expect(await enqueueWithRecovery(c.ai,c.account,c.data)).toBe(c.jobId);expect(c.backend.priorRequest).toHaveBeenCalledExactlyOnceWith(c.account,c.input,c.data.requestKey,c.data.operation,c.data.expectedRevision,AI_CATALOG_VERSION);
});
it.each(['before-read','after-read'])('revocation %s denies recovered acknowledgement',async point=>{
 const c=recoveryFixture();if(point==='before-read')c.enabled.mockRejectedValueOnce(new AiFault('disabled'));else c.enabled.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new AiFault('disabled'));
 await expect(enqueueWithRecovery(c.ai,c.account,c.data)).rejects.toMatchObject({code:'disabled'});expect(c.enqueue).toHaveBeenCalledTimes(1);
});
it.each(['accountId','inputId','operation','revision','requestKey','aiProfile'])('a mismatching durable job %s cannot turn an uncertain failure into 202',async field=>{
 const c=recoveryFixture();(c.job as any)[field]=field==='revision'?2:'different';await expect(enqueueWithRecovery(c.ai,c.account,c.data)).rejects.toMatchObject({code:'invariant'});expect(c.enqueue).toHaveBeenCalledTimes(1);
});
it('conflicting same-key fingerprint is not acknowledged as the original operation',async()=>{
 const c=recoveryFixture();c.backend.priorRequest.mockRejectedValueOnce(new LedgerFault('conflict'));await expect(enqueueWithRecovery(c.ai,c.account,c.data)).rejects.toMatchObject({code:'conflict'});expect(c.backend.job).not.toHaveBeenCalled();
});
it('an unexpected quote failure performs no ACK recovery lookup or reservation',async()=>{
 const account=randomUUID(),input=randomUUID(),original=Object.assign(new Error('private-quote-SDK-error'),{code:14});
 const backend={priorRequest:vi.fn(async()=>null),reserve:vi.fn(async()=>randomUUID()),job:vi.fn(async()=>({}))};
 const ai=new FirestoreAi({} as never,{} as never,backend as unknown as FirestoreBackend,{} as never);ai.enabled=async()=>undefined;ai.quote=async()=>{throw original;};
 await expect(ai.enqueue(account,input,'narration:en:female',1,'quote-fails')).rejects.toBe(original);expect(backend.priorRequest).toHaveBeenCalledTimes(1);expect(backend.reserve).not.toHaveBeenCalled();expect(backend.job).not.toHaveBeenCalled();
});
