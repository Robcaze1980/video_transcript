import {createHash, randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FirestoreAi} from './firestoreAi';
import {FirestoreBackend} from './firestoreBackend';
import {privateBucket} from './privateObjectPlan';
import {VOICE_MODEL,VOICE_NARRATION_STYLE} from './pipelineVoiceProvider';
import {textModel} from './pipelineTextProvider';

// Transactions are serialized in this stand-in. The test uses the real
// dispatch, claim, invocation and ledger methods, but it cannot prove Firestore
// retry/concurrency behavior, cloud permissions or a remote provider outcome.
class MemoryStore {
  rows = new Map<string,Record<string,any>>();
  ref(collection:string,id:string){const ref={id,path:`${collection}/${id}`,get:async()=>this.snapshot(ref)};return ref;}
  snapshot(ref:{id:string;path:string}){
    const source=this.rows.get(ref.path),data=source===undefined?undefined:structuredClone(source);
    return {id:ref.id,ref,exists:data!==undefined,data:()=>data,get:(key:string)=>data?.[key]};
  }
  query(name:string,field:string,value:unknown){
    const docs=[...this.rows.keys()].filter(key=>key.startsWith(name+'/')).map(path=>this.snapshot({id:path.slice(name.length+1),path}))
      .filter(doc=>doc.get(field)===value);
    return {docs,size:docs.length,empty:docs.length===0};
  }
  async runTransaction<T>(work:(tx:any)=>Promise<T>):Promise<T>{
    const writes:Array<{kind:'create'|'update';ref:{path:string};value:Record<string,any>}> = [];
    const tx={get:async(ref:any)=>ref.query?this.query(ref.name,ref.field,ref.value):this.snapshot(ref),getAll:async(...refs:any[])=>refs.map(ref=>this.snapshot(ref)),
      create:(ref:any,value:any)=>writes.push({kind:'create',ref,value:structuredClone(value)}),
      update:(ref:any,value:any)=>writes.push({kind:'update',ref,value:structuredClone(value)})};
    const result=await work(tx),staged=new Map(this.rows);
    for(const write of writes){const prior=staged.get(write.ref.path);
      if(write.kind==='create'){if(prior!==undefined)throw Error('Synthetic duplicate');staged.set(write.ref.path,write.value);}
      else{if(prior===undefined)throw Error('Synthetic missing update');staged.set(write.ref.path,{...prior,...write.value});}}
    this.rows=staged;return result;
  }
}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
async function fixture(operation:'translation:en'|'narration:en:female'|'narration:en:male',generic=false){
  const store=new MemoryStore(),account=randomUUID(),input=randomUUID(),uid=`synthetic-${randomUUID()}`,requestKey=randomUUID();
  const root={collection:(name:string)=>({doc:(id:string)=>store.ref(name,id),where:(field:string,op:string,value:unknown)=>{
    if(op!=='==')throw Error('Synthetic query operator');return {query:true,name,field,value};}})};
  const backend=new FirestoreBackend(store as never,root as never),objects=vi.fn(async()=>{throw Error('Object storage must not be contacted');});
  const ai=new FirestoreAi(store as never,root as never,backend,new Proxy({},{get:()=>objects}) as never);
  const draft='Synthetic English text.',inputSha=sha('synthetic video');
  store.rows.set(`identities/${sha(JSON.stringify(['firebase',uid]))}`,{uid,accountId:account});
  store.rows.set(`accounts/${account}`,{credited:10,available:10,reserved:0,consumed:0,active:0,aiPilot:true,simulationOnly:true});
  store.rows.set(`inputs/${input}`,{accountId:account,expiresAtMs:Date.now()+3600000,sha256:inputSha,deleted:false,ready:true,unknownCount:0,
    metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:`candidate-files-v1/${input}/video.mp4`,generation:'1',size:100,sha256:inputSha}});
  store.rows.set(`projects/${input}`,{accountId:account,inputId:input,revision:1,draft,updatedAtMs:1,
    reviewedTextRevision:1,reviewedTextSha256:sha(draft)});
  // Simulates a job created before the customer admission gate existed. This is
  // an internal test setup only, with no structured review or receipt.
  const price=operation==='translation:en'?2:1;
  const job=generic?await backend.reserveForUid(account,input,requestKey,price,operation,1,uid):
    await backend.reserveSimulatedAiForUid(account,input,requestKey,price,operation,1,uid);
  function running(phase:'not_started'|'invoking'){
    const current=store.rows.get(`jobs/${job}`)!;
    const attempt=randomUUID();store.rows.set(`jobs/${job}`,{...current,state:'running',attemptId:attempt,leaseUntil:Date.now()+60000,invocationPhase:phase});
    const outbox=store.rows.get(`outbox/${job}`)!;store.rows.set(`outbox/${job}`,{...outbox,state:'sent',leaseUntil:null});
    return attempt;
  }
  function expired(){const row=store.rows.get(`jobs/${job}`)!;store.rows.set(`jobs/${job}`,{...row,leaseUntil:Date.now()-1});}
  function contradictoryReceipt(attemptId:string){
    const callKey='voice-chunk:0000';
    store.rows.set(`providerCalls/${job}-voice-chunk-0000`,{jobId:job,accountId:account,attemptId,callKey,model:VOICE_MODEL,
      requestSha256:'a'.repeat(64),state:'intent',startedAtMs:1});
  }
  function receivedReceipt(attemptId:string){
    contradictoryReceipt(attemptId);const path=`providerCalls/${job}-voice-chunk-0000`;
    store.rows.set(path,{...store.rows.get(path),state:'received',httpStatus:200,responseSha256:'b'.repeat(64),responseId:'synthetic-receipt',usage:{totalTokenCount:1}});
  }
  function resultEntries(){
    const artifact=store.rows.get(`artifacts/${job}`)!,spec=artifact.plan.artifacts[0];
    return [{name:spec.name,key:spec.key,mimeType:spec.mimeType,generation:'2',size:12,sha256:sha('synthetic-audio')}];
  }
  function staged(attemptId:string){
    receivedReceipt(attemptId);const path=`artifacts/${job}`,artifact=store.rows.get(path)!;
    const call=store.rows.get(`providerCalls/${job}-voice-chunk-0000`)!;
    const proof=[[call.callKey,call.requestSha256,call.responseSha256,call.responseId,call.usage]];
    store.rows.set(path,{...artifact,state:'staged',attemptId,entries:resultEntries(),callReceiptHash:sha(JSON.stringify(proof)),callKeys:['voice-chunk:0000']});
  }
  function completed(){
    const attempt=running('invoking');staged(attempt);
    const artifact=store.rows.get(`artifacts/${job}`)!,row=store.rows.get(`jobs/${job}`)!,balance=store.rows.get(`accounts/${account}`)!;
    store.rows.set(`artifacts/${job}`,{...artifact,state:'ready',quotaMode:'committed',quotaHeld:12});
    store.rows.set(`jobs/${job}`,{...row,state:'succeeded',attemptId:null,leaseUntil:null});
    store.rows.set(`accounts/${account}`,{...balance,reserved:0,consumed:1,active:0});
    store.rows.set(`movements/terminal:${job}`,{accountId:account,reference:job,credits:1,kind:'capture'});
  }
  function evidence(){
    const docs=(prefix:string)=>[...store.rows.entries()].filter(([key])=>key.startsWith(prefix+'/')).map(([key,value])=>[key,structuredClone(value)]);
    return {account:structuredClone(store.rows.get(`accounts/${account}`)),input:structuredClone(store.rows.get(`inputs/${input}`)),job:structuredClone(store.rows.get(`jobs/${job}`)),
      artifact:structuredClone(store.rows.get(`artifacts/${job}`)),movements:docs('movements'),providerCalls:docs('providerCalls')};
  }
  const outbox=()=>structuredClone(store.rows.get(`outbox/${job}`));
  const body={contents:[{parts:[{text:draft,speech_metadata:{style:VOICE_NARRATION_STYLE}}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{voice:operation.endsWith('female')?'Kore':'Charon'}}}};
  return {store,root,backend,ai,account,input,uid,job,evidence,outbox,objects,running,expired,contradictoryReceipt,receivedReceipt,resultEntries,staged,completed,body};
}

function assertOnlyDispatchDeferred(before:Record<string,any>,after:Record<string,any>){
  expect({...after,nextAttemptAt:before.nextAttemptAt}).toEqual(before);
  expect(after.nextAttemptAt).toBeGreaterThanOrEqual(before.nextAttemptAt);
  expect(after.nextAttemptAt).toBeLessThanOrEqual(Date.now()+301000);
  expect(after).toMatchObject({state:'pending',dispatchAttempt:null,leaseUntil:null});
}

describe('an old unlinked voice job is fenced before dispatch and provider invocation',()=>{
  beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('Synthetic provider trap: no network');})));
  afterEach(()=>vi.unstubAllGlobals());

  it('keeps a synthetic text job eligible for dispatch',async()=>{
    const f=await fixture('translation:en'),before=f.evidence();
    expect(await f.backend.aiDispatchEligible(f.job)).toBe(true);expect(f.evidence()).toEqual(before);
    expect(await f.backend.claimDispatch(f.job)).toMatchObject({jobId:f.job,accountId:f.account});
    expect(globalThis.fetch).not.toHaveBeenCalled();expect(f.objects).not.toHaveBeenCalled();
  });

  it('keeps the text provider fence separate from the voice block',async()=>{
    const f=await fixture('translation:en'),attempt=f.running('invoking');
    await expect(f.ai.invoke(f.account,f.job,attempt,'synthetic-no-real-key')('text-window:0000',textModel,{synthetic:true},new AbortController().signal)).rejects.toMatchObject({code:'unknown'});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);expect(f.evidence().providerCalls).toHaveLength(1);
    expect(f.objects).not.toHaveBeenCalled();
  });

  for(const operation of ['narration:en:female','narration:en:male'] as const){
    it(`preserves access to an already completed ${operation} result`,async()=>{
      const f=await fixture(operation);f.completed();const before=f.evidence(),status=await f.ai.status(f.account,f.job,f.uid);
      expect(status.state).toBe('succeeded');expect(status.billingState).toBe('simulated');expect(status.results.map(entry=>entry.name)).toEqual(['narration-en.wav']);
      const result=await f.ai.download(f.account,f.job,'narration-en.wav',f.uid);expect(result.entry.name).toBe('narration-en.wav');
      await expect(f.ai.download(f.account,f.job,'narration-en.wav','synthetic-foreign')).rejects.toMatchObject({code:'not_found'});
      expect(f.evidence()).toEqual(before);expect(f.objects).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
    });
    it(`marks an unfinished ${operation} as requiring review in its authorized status`,async()=>{
      const f=await fixture(operation),before=f.evidence(),status=await f.ai.status(f.account,f.job,f.uid);
      expect(status.billingState).toBe('review');expect(status.results).toEqual([]);expect(f.evidence()).toEqual(before);
    });
    it(`also marks running and uncertain ${operation} jobs for review`,async()=>{
      const f=await fixture(operation),attempt=f.running('invoking');f.contradictoryReceipt(attempt);
      expect((await f.ai.status(f.account,f.job,f.uid)).billingState).toBe('review');
      const job=f.store.rows.get(`jobs/${f.job}`)!,input=f.store.rows.get(`inputs/${f.input}`)!;
      f.store.rows.set(`jobs/${f.job}`,{...job,state:'unknown',unknownAttemptId:attempt,attemptId:null,leaseUntil:null});
      f.store.rows.set(`inputs/${f.input}`,{...input,unknownCount:1});
      const before=f.evidence(),status=await f.ai.status(f.account,f.job,f.uid);
      expect(status.billingState).toBe('review');expect(status.results).toEqual([]);expect(f.evidence()).toEqual(before);
    });
    it(`does not mark ${operation} eligible for dispatch`,async()=>{
      const f=await fixture(operation),before=f.evidence(),outbox=f.outbox(),result=await f.backend.aiDispatchEligible(f.job);
      console.log(JSON.stringify({event:'synthetic-voice-eligible',operation,result}));
      expect(result).toBe(false);expect(f.evidence()).toEqual(before);
      assertOnlyDispatchDeferred(outbox!,f.outbox()!);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
    it(`does not claim the dispatch for ${operation} directly`,async()=>{
      const f=await fixture(operation),before=f.evidence(),outbox=f.outbox(),result=await f.backend.claimDispatch(f.job);
      console.log(JSON.stringify({event:'synthetic-voice-dispatch-claim',operation,claimed:!!result}));
      expect(result).toBeNull();expect(f.evidence()).toEqual(before);
      assertOnlyDispatchDeferred(outbox!,f.outbox()!);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
    it(`does not claim the queued ${operation} job`,async()=>{
      const f=await fixture(operation),before=f.evidence(),outbox=f.outbox(),result=await f.backend.claim(f.account,f.job);
      console.log(JSON.stringify({event:'synthetic-voice-worker-claim',operation,claimed:!!result}));
      expect(result).toBeNull();expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
    it(`does not begin an existing ${operation} attempt`,async()=>{
      const f=await fixture(operation),attempt=f.running('not_started'),before=f.evidence(),outbox=f.outbox();
      const result=await f.backend.beginInvocation(f.account,f.job,attempt);
      console.log(JSON.stringify({event:'synthetic-voice-begin',operation,started:result}));
      expect(result).toBe(false);expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
    it(`does not create a provider receipt or send an existing ${operation} invocation`,async()=>{
      const f=await fixture(operation),attempt=f.running('invoking'),before=f.evidence(),outbox=f.outbox();
      const outcome=await f.ai.invoke(f.account,f.job,attempt,'synthetic-no-real-key')('voice-chunk:0000',VOICE_MODEL,f.body,new AbortController().signal)
        .then(()=>({code:'accepted'}),error=>({code:error.code}));
      console.log(JSON.stringify({event:'synthetic-voice-provider',operation,code:outcome.code,providerAttempts:vi.mocked(globalThis.fetch).mock.calls.length,
        providerRecords:f.evidence().providerCalls.length}));
      expect(['disabled','conflict']).toContain(outcome.code);expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);expect(f.objects).not.toHaveBeenCalled();
    });
    it(`does not start object uploads for a previously running ${operation}`,async()=>{
      const f=await fixture(operation),attempt=f.running('invoking'),before=f.evidence(),outbox=f.outbox();
      const outcome=await f.ai.uploadResults(f.account,f.job,attempt,new Map([['narration-en.wav',Buffer.from('synthetic')]]))
        .then(()=>({code:'accepted'}),error=>({code:error.code}));
      console.log(JSON.stringify({event:'synthetic-voice-upload',operation,code:outcome.code,objectAttempts:f.objects.mock.calls.length}));
      expect(outcome.code).toBe('disabled');expect(f.objects).not.toHaveBeenCalled();
      expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
    });
    it(`does not stage an unlinked ${operation} result`,async()=>{
      const f=await fixture(operation),attempt=f.running('invoking');f.receivedReceipt(attempt);
      const before=f.evidence(),outbox=f.outbox(),result=await f.backend.stageArtifactReceipt(f.account,f.job,attempt,f.resultEntries());
      console.log(JSON.stringify({event:'synthetic-voice-stage',operation,staged:result}));
      expect(result).toBe(false);expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
    });
    it(`does not capture an unlinked staged ${operation} result`,async()=>{
      const f=await fixture(operation),attempt=f.running('invoking');f.staged(attempt);
      const before=f.evidence(),outbox=f.outbox(),result=await f.backend.finish(f.account,f.job,attempt,true);
      console.log(JSON.stringify({event:'synthetic-voice-finish',operation,finished:result,consumed:f.evidence().account?.consumed}));
      expect(result).toBe(false);expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
    });
    it(`does not purge uncertain ${operation} artifacts during quarantine`,async()=>{
      const f=await fixture(operation),attempt=f.running('invoking');f.receivedReceipt(attempt);
      const before=f.evidence(),outbox=f.outbox(),result=await f.backend.quarantine(f.account,f.job,attempt);
      console.log(JSON.stringify({event:'synthetic-voice-quarantine',operation,quarantined:result,artifact:f.evidence().artifact?.state}));
      expect(result).toBe(false);expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
    });
    it(`does not resolve uncertain ${operation} with a generic evidence string`,async()=>{
      const f=await fixture(operation),attempt=f.running('invoking');f.contradictoryReceipt(attempt);
      const job=f.store.rows.get(`jobs/${f.job}`)!,input=f.store.rows.get(`inputs/${f.input}`)!;
      f.store.rows.set(`jobs/${f.job}`,{...job,state:'unknown',unknownAttemptId:attempt,attemptId:null,leaseUntil:null});
      f.store.rows.set(`inputs/${f.input}`,{...input,unknownCount:1});
      const before=f.evidence(),outbox=f.outbox(),result=await f.backend.reconcile(f.account,f.job,'failed','synthetic generic text');
      console.log(JSON.stringify({event:'synthetic-voice-reconcile',operation,resolved:result,reserved:f.evidence().account?.reserved}));
      expect(result).toBe(false);expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
    });
    it(`does not requeue expired ${operation} with contradictory provider intent`,async()=>{
      const f=await fixture(operation),attempt=f.running('not_started');f.expired();f.contradictoryReceipt(attempt);
      const before=f.evidence(),outbox=f.outbox(),result=await f.backend.recover(f.account,f.job);
      console.log(JSON.stringify({event:'synthetic-voice-recover',operation,recovered:result,state:f.evidence().job?.state}));
      expect(result).toBe(false);expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
    it(`does not requeue expired ${operation} through heartbeat with contradictory provider intent`,async()=>{
      const f=await fixture(operation),attempt=f.running('not_started');f.expired();f.contradictoryReceipt(attempt);
      const before=f.evidence(),outbox=f.outbox(),result=await f.backend.heartbeat(f.account,f.job,attempt);
      console.log(JSON.stringify({event:'synthetic-voice-heartbeat',operation,extended:result,state:f.evidence().job?.state}));
      expect(result).toBe(false);expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
    it(`does not release ${operation} on pre-invocation failure with contradictory provider intent`,async()=>{
      const f=await fixture(operation),attempt=f.running('not_started');f.contradictoryReceipt(attempt);
      const before=f.evidence(),outbox=f.outbox(),result=await f.backend.failBeforeInvocation(f.account,f.job,attempt);
      console.log(JSON.stringify({event:'synthetic-voice-preinvoke-failure',operation,settled:result,state:f.evidence().job?.state,
        reserved:f.evidence().account?.reserved,terminalMovements:f.evidence().movements.length-before.movements.length}));
      expect(result).toBe(false);expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
    it(`does not infer that an apparently clean ${operation} attempt was never sent`,async()=>{
      const f=await fixture(operation),attempt=f.running('not_started'),before=f.evidence(),outbox=f.outbox();
      expect(await f.backend.failBeforeInvocation(f.account,f.job,attempt)).toBe(false);
      expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
    });
    for(const state of ['queued','running'] as const)it(`does not release ${operation} on ${state} cancellation with contradictory provider intent`,async()=>{
      const f=await fixture(operation),attempt=state==='running'?f.running('not_started'):randomUUID();f.contradictoryReceipt(attempt);
      const before=f.evidence(),outbox=f.outbox(),result=await f.backend.cancelForUid(f.account,f.job,f.uid);
      console.log(JSON.stringify({event:'synthetic-voice-cancel',operation,originalState:state,cancelled:result,state:f.evidence().job?.state,
        reserved:f.evidence().account?.reserved,terminalMovements:f.evidence().movements.length-before.movements.length}));
      expect(result).toBe(false);expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
    it(`does not dispatch a legacy generic ${operation} job`,async()=>{
      const f=await fixture(operation,true),before=f.evidence(),outbox=f.outbox(),result=await f.backend.claimDispatch(f.job);
      console.log(JSON.stringify({event:'synthetic-generic-voice-dispatch',operation,claimed:!!result}));
      expect(result).toBeNull();expect(f.evidence()).toEqual(before);assertOnlyDispatchDeferred(outbox!,f.outbox()!);
    });
    it(`does not claim a legacy generic ${operation} job`,async()=>{
      const f=await fixture(operation,true),before=f.evidence(),outbox=f.outbox(),result=await f.backend.claim(f.account,f.job);
      console.log(JSON.stringify({event:'synthetic-generic-voice-claim',operation,claimed:!!result}));
      expect(result).toBeNull();expect(f.evidence()).toEqual(before);expect(f.outbox()).toEqual(outbox);
    });
  }
});
