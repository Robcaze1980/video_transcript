import {expect,it,vi} from 'vitest';
import {drainCloudAi,drainCloudFiles,aiJobStarter,type AiDrainDependencies} from './cloudAiDispatch';
function fixture(){
 const calls:string[]=[];
 const deps:AiDrainDependencies={recover:vi.fn(async()=>0),pending:async()=>Array.from({length:10},(_,i)=>'j'+i),eligible:async()=>true,
  claim:async jobId=>({accountId:'owner',jobId,dispatchAttempt:'attempt'}),acknowledge:vi.fn(async()=>true),
  pendingPurges:async()=>['p0','p1','p2','p3'],claimPurge:async()=>true,start:vi.fn(async(kind,id)=>{calls.push(kind+':'+id);})};
 return {deps,calls};
}
it('files query failure is explicit and never reports an empty successful batch',async()=>{
 const dispatch=vi.fn(async()=>{}),r=await drainCloudFiles({pending:async()=>{throw Error('SDK query');},dispatch});
 expect(r).toEqual({due:0,attempted:0,accepted:0,failed:1,deferred:0,failures:[{stage:'pending',id:null}]});expect(dispatch).not.toHaveBeenCalled();
});
it('files dispatch is sequential, isolates a failed neighbor and caps the batch at three',async()=>{
 let active=0,maxActive=0;const calls:string[]=[];
 const r=await drainCloudFiles({pending:async()=>['bad','good','third','deferred'],dispatch:async id=>{active++;maxActive=Math.max(maxActive,active);calls.push(id);try{await Promise.resolve();if(id==='bad')throw Error('lost ACK');}finally{active--;}}});
 expect(calls).toEqual(['bad','good','third']);expect(maxActive).toBe(1);expect(r).toEqual({due:4,attempted:3,accepted:2,failed:1,deferred:1,failures:[{stage:'dispatch',id:'bad'}]});
});
it('files budget admits no additional SDK/network work and passes only the remaining network timeout',async()=>{
 let now=0;const timeouts:number[]=[];
 const r=await drainCloudFiles({pending:async()=>{now=17;return ['first','second'];},dispatch:async(_id,timeout)=>{timeouts.push(timeout);now=21;}},{now:()=>now,budgetMs:20});
 expect(timeouts).toEqual([3]);expect(r).toEqual({due:2,attempted:1,accepted:1,failed:0,deferred:1,failures:[]});
});
it('files row failures remain visible after valid returned neighbors are dispatched',async()=>{
 const dispatch=vi.fn(async()=>{}),r=await drainCloudFiles({pending:async()=>({ids:['good'],failures:[{stage:'expiry',id:'poison',code:'invalid'}]}),dispatch});
 expect(dispatch).toHaveBeenCalledOnce();expect(r.accepted).toBe(1);expect(r.failed).toBe(1);expect(r.failures).toEqual([{stage:'expiry',id:'poison',code:'invalid'}]);
});
it('retains the checkpoint error after a full page of twenty-five row failures',async()=>{
 const failures=[...Array.from({length:25},(_,i)=>({stage:'expiry',id:'poison'+i,code:'invalid'})),{stage:'cursor',id:null,code:'UNCLASSIFIED'}];
 const dispatch=vi.fn(async()=>{}),r=await drainCloudFiles({pending:async()=>({ids:['healthy'],failures}),dispatch});
 expect(dispatch).toHaveBeenCalledWith('healthy',expect.any(Number));expect(r.accepted).toBe(1);expect(r.failed).toBe(26);expect(r.failures).toEqual(failures);expect(r.failures.at(-1)?.stage).toBe('cursor');
});
it('recovery report keeps per-row faults visible while healthy dispatch and purge work proceeds',async()=>{
 const c=fixture();c.deps.recover=async()=>({scanned:3,recovered:2,failures:[{jobId:'poison',stage:'recover'}]});
 const r=await drainCloudAi(c.deps);expect(r.recovered).toBe(2);expect(r.failures).toEqual([{jobId:'poison',stage:'recover'}]);expect(r.startsAccepted).toBe(3);expect(r.purgesAccepted).toBe(3);
});
it('scans up to thirty AI candidates to admit valid work behind ten blocked rows',async()=>{
 const c=fixture();c.deps.pending=vi.fn(async()=>Array.from({length:11},(_,i)=>'j'+i));c.deps.eligible=async id=>id==='j10';
 const r=await drainCloudAi(c.deps);expect(c.deps.pending).toHaveBeenCalledWith(30);expect(r.skipped).toBe(10);expect(r.startsAccepted).toBe(1);expect(c.calls).toContain('ai:j10');
});
it('admits at most three starts and three purges, interleaving them with bounded recovery',async()=>{
 const c=fixture(),r=await drainCloudAi(c.deps);
 expect(c.deps.recover).toHaveBeenCalledWith(3);expect(r.startsAttempted).toBe(3);expect(r.purgesAttempted).toBe(3);
 expect(c.calls).toEqual(['ai:j0','purge:p0','ai:j1','purge:p1','ai:j2','purge:p2']);expect(r.failures).toEqual([]);
});
it('isolates failed starts and purge dispatches and retains their durable claims',async()=>{
 const c=fixture();c.deps.start=vi.fn(async(kind,id)=>{c.calls.push(kind+':'+id);if(id.endsWith('0'))throw Error('lost ACK');});
 const r=await drainCloudAi(c.deps);expect(r.startsAccepted).toBe(2);expect(r.purgesAccepted).toBe(2);expect(r.failures).toHaveLength(2);
 expect(c.deps.acknowledge).not.toHaveBeenCalledWith('j0','attempt');expect(c.deps.acknowledge).toHaveBeenCalledTimes(2);
});
it('checks profile before claim and never claims another worker outbox',async()=>{
 const c=fixture();c.deps.eligible=async id=>id!=='j0';c.deps.claim=vi.fn(c.deps.claim);
 const r=await drainCloudAi(c.deps);expect(c.deps.claim).not.toHaveBeenCalledWith('j0');expect(r.skipped).toBe(1);expect(r.startsAttempted).toBe(3);
});
it('does not hide recovery/query failures as an empty successful batch',async()=>{
 const c=fixture();c.deps.recover=async()=>{throw Error('SDK');};c.deps.pending=async()=>{throw Error('query');};
 const r=await drainCloudAi(c.deps);expect(r.failures).toEqual([{stage:'recover-query'},{stage:'pending'}]);expect(r.purgesAccepted).toBe(3);
});
it('isolates profile reads, claims and ACK failures while continuing other jobs and purges',async()=>{
 const c=fixture();c.deps.pending=async()=>['read-fails','claim-fails','ack-fails','good'];
 c.deps.eligible=async id=>{if(id==='read-fails')throw Error('read');return true;};
 c.deps.claim=async jobId=>{if(jobId==='claim-fails')throw Error('claim');return {accountId:'owner',jobId,dispatchAttempt:'a'};};
 c.deps.acknowledge=async id=>{if(id==='ack-fails')throw Error('ACK lost');return true;};
 const r=await drainCloudAi(c.deps);expect(r.failures.map(x=>x.jobId)).toEqual(['read-fails','claim-fails','ack-fails']);expect(r.startsAccepted).toBe(2);expect(r.purgesAccepted).toBe(3);expect(c.calls).toContain('ai:good');
});
it('reports purge-query failure without dropping eligible starts',async()=>{
 const c=fixture();c.deps.pendingPurges=async()=>{throw Error('query');};
 const r=await drainCloudAi(c.deps);expect(r.failures).toEqual([{stage:'pending-purges'}]);expect(r.startsAccepted).toBe(3);
});
it('starts no additional work after a slow SDK operation exhausts admission budget',async()=>{
 const c=fixture();let now=0;c.deps.recover=async()=>{now=51;return 1;};c.deps.pending=vi.fn(c.deps.pending);
 const r=await drainCloudAi(c.deps,{now:()=>now,budgetMs:50});expect(r.recovered).toBe(1);expect(r.budgetExhausted).toBe(true);expect(c.deps.pending).not.toHaveBeenCalled();expect(c.calls).toEqual([]);
});
it('does not launch or ack after an SDK claim overruns the admission budget',async()=>{
 const c=fixture();let now=0;c.deps.claim=async jobId=>{now=101;return {accountId:'owner',jobId,dispatchAttempt:'a'};};
 const r=await drainCloudAi(c.deps,{now:()=>now,budgetMs:100});expect(r.budgetExhausted).toBe(true);expect(c.calls).toEqual([]);expect(c.deps.acknowledge).not.toHaveBeenCalled();
});
it('cancels network dispatch and continues the next item without repeating the failed call',async()=>{
 const c=fixture();c.deps.pending=async()=>['j0','j1'];c.deps.pendingPurges=async()=>[];
 c.deps.start=async(_,id,_account,signal)=>{c.calls.push(id);if(id==='j0')await new Promise<void>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
 const r=await drainCloudAi(c.deps,{networkMs:5});expect(c.calls).toEqual(['j0','j1']);expect(r.startsAccepted).toBe(1);expect(r.failures).toHaveLength(1);
});
it('sends only fixed job overrides, honors signal and validates LRO without treating it as completion',async()=>{
 const job='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
 const request=vi.fn(async(_url:Parameters<typeof fetch>[0],_init?:RequestInit)=>new Response(JSON.stringify({name:'projects/vistavo-prod/locations/us-central1/operations/abc'}),{status:200}));
 const signal=new AbortController().signal,start=aiJobStarter(async()=>'synthetic-access',request as typeof fetch);
 await start('ai',job,account,signal);expect(request.mock.calls[0][0]).toContain('/vistavo-ai-process:run');
 const init=(request.mock.calls[0] as unknown[])[1] as RequestInit;expect(init.signal).toBe(signal);expect(JSON.parse(init.body as string).overrides.taskCount).toBe(1);
 const controller=new AbortController();controller.abort();await expect(start('purge',job,undefined,controller.signal)).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
 await expect(aiJobStarter(async()=>'x',async()=>new Response('{}'))('ai',job,account,signal)).rejects.toThrow('Invalid dispatch receipt');
});
