import {createHash,randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FirestoreBackend} from './firestoreBackend';
import {FirestoreAi} from './firestoreAi';
import {AI_CATALOG_VERSION,artifactPlan,artifactPlanHash} from './aiContracts';
import {privateBucket} from './privateObjectPlan';
import {textModel} from './pipelineTextProvider';

// Sequential in-memory Firestore and objects: no real credentials, storage,
// Account, provider, or network. Does not simulate a put already in flight.
class MemoryStore {
  rows=new Map<string,Record<string,any>>();
  ref(collection:string,id:string){const ref={id,path:`${collection}/${id}`,get:async()=>this.snapshot(ref)};return ref;}
  snapshot(ref:{id:string;path:string}){const value=this.rows.get(ref.path),data=value===undefined?undefined:structuredClone(value);
    return {id:ref.id,ref,exists:data!==undefined,data:()=>data,get:(key:string)=>data?.[key]};}
  query(name:string,field:string,value:unknown){const docs=[...this.rows.keys()].filter(key=>key.startsWith(name+'/'))
    .map(path=>this.snapshot({id:path.slice(name.length+1),path})).filter(doc=>doc.get(field)===value);return {docs,size:docs.length};}
  async runTransaction<T>(work:(tx:any)=>Promise<T>):Promise<T>{
    const writes:Array<{kind:'create'|'update';ref:{path:string};value:Record<string,any>}>=[];
    const tx={get:async(ref:any)=>ref.query?this.query(ref.name,ref.field,ref.value):this.snapshot(ref),
      getAll:async(...refs:any[])=>refs.map(ref=>this.snapshot(ref)),create:(ref:any,value:any)=>writes.push({kind:'create',ref,value:structuredClone(value)}),
      update:(ref:any,value:any)=>writes.push({kind:'update',ref,value:structuredClone(value)})};
    const result=await work(tx),staged=new Map(this.rows);
    for(const item of writes){const prior=staged.get(item.ref.path);if(item.kind==='create'){if(prior!==undefined)throw Error('Synthetic duplicate');staged.set(item.ref.path,item.value);}
      else{if(prior===undefined)throw Error('Synthetic missing update');staged.set(item.ref.path,{...prior,...item.value});}}
    this.rows=staged;return result;
  }
}
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
async function fixture(operation:'translation:en'|'narration:en:male'){
  const store=new MemoryStore(),account=randomUUID(),input=randomUUID(),uid=`synthetic-${randomUUID()}`;
  const root={collection:(name:string)=>({doc:(id:string)=>store.ref(name,id),where:(field:string,op:string,value:unknown)=>{
    if(op!=='==')throw Error('Synthetic query operator');return {query:true,name,field,value};}})};
  const backend=new FirestoreBackend(store as never,root as never);
  const put=vi.fn(async(key:string,bytes:Buffer)=>({key,generation:'2',size:bytes.length}));
  const ai=new FirestoreAi(store as never,root as never,backend,{putArtifactOnce:put} as never);
  const draft='Synthetic words.',inputSha=sha('synthetic input');
  store.rows.set(`identities/${sha(JSON.stringify(['firebase',uid]))}`,{uid,accountId:account});
  store.rows.set(`accounts/${account}`,{credited:10,available:10,reserved:0,consumed:0,active:0,aiPilot:true,simulationOnly:true});
  store.rows.set(`inputs/${input}`,{accountId:account,expiresAtMs:Date.now()+3600000,sha256:inputSha,deleted:false,ready:true,unknownCount:0,
    metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:`candidate-files-v1/${input}/video.mp4`,generation:'1',size:100,sha256:inputSha}});
  store.rows.set(`projects/${input}`,{accountId:account,inputId:input,revision:1,draft,updatedAtMs:1,reviewedTextRevision:1,reviewedTextSha256:sha(draft)});
  const job=await backend.reserveSimulatedAiForUid(account,input,randomUUID(),operation==='translation:en'?2:1,operation,1,uid),attempt=randomUUID();
  store.rows.set(`jobs/${job}`,{...store.rows.get(`jobs/${job}`),state:'running',attemptId:attempt,leaseUntil:Date.now()+60000,invocationPhase:'invoking'});
  store.rows.set(`providerCalls/${job}-text-window-0000`,{jobId:job,accountId:account,attemptId:attempt,callKey:'text-window:0000',model:textModel,
    state:'received',httpStatus:200,requestSha256:'a'.repeat(64),responseSha256:'b'.repeat(64),responseId:'synthetic',usage:{totalTokenCount:1}});
  const buffers=():Map<string,Buffer>=>new Map<string,Buffer>((store.rows.get(`artifacts/${job}`)!.plan.artifacts as Array<{name:string}>)
    .map(spec=>[spec.name,Buffer.from('synthetic bytes')]));
  const state=()=>structuredClone([...store.rows.entries()].sort(([a],[b])=>a.localeCompare(b)));
  return {store,account,input,uid,job,attempt,backend,ai,put,buffers,state};
}
function attachSyntheticExternalHistory(f:Awaited<ReturnType<typeof fixture>>){
  const jobRef=`jobs/${f.job}`,job=f.store.rows.get(jobRef)!,intentId=sha(JSON.stringify([f.account,job.requestKey]));
  const billing={provider:'account_seconds',identityKey:sha(JSON.stringify(['firebase',f.uid])),reservationId:randomUUID(),seconds:job.price};
  const witness={intentId,accountId:f.account,inputId:f.input,operation:job.operation,revision:job.revision,profile:AI_CATALOG_VERSION,...billing};
  f.store.rows.set(jobRef,{...job,externalBilling:billing});
  const accountRef=`accounts/${f.account}`,account=f.store.rows.get(accountRef)!;
  f.store.rows.set(accountRef,{...account,available:account.available+account.reserved,reserved:0});
  const accountingRef=`jobAccounting/${f.job}`,accounting=f.store.rows.get(accountingRef)!;
  f.store.rows.set(accountingRef,{...accounting,mode:'account_seconds',...billing});
  f.store.rows.delete(`movements/reserve:${f.job}`);
  f.store.rows.set(`billingIntents/${intentId}`,{id:intentId,accountId:f.account,inputId:f.input,requestKey:job.requestKey,
    operation:job.operation,revision:job.revision,...billing,state:'job_created',jobId:f.job});
  f.store.rows.set(`billingIntentWitnesses/${intentId}`,{...witness,historyProtocol:1,baseline:'before_reservation',createdAtMs:1});
  f.store.rows.set(`billingIntentJobMarkers/${intentId}`,{...witness,jobId:f.job,historyProtocol:1,createdAtMs:1});
  f.store.rows.set(`billingIntentAdmissionGuards/${intentId}`,{protocol:1,intentId,state:'clear',createdAtMs:1});
  return {identityKey:billing.identityKey};
}
async function externalAdmission(f:Awaited<ReturnType<typeof fixture>>){
  const job=f.store.rows.get(`jobs/${f.job}`)!;
  return f.store.runTransaction(tx=>f.backend.externalJobAdmissionAllowed(tx as never,f.job,job as never));
}
describe('private AI output verifies the job and plan before object writes',()=>{
  beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('Unexpected network');})));
  afterEach(()=>{expect(globalThis.fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
  it('stages a coherent text job using only its planned synthetic outputs',async()=>{
    const f=await fixture('translation:en'),result=await f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers());
    expect(result).toHaveLength(5);expect(f.put).toHaveBeenCalledTimes(5);expect(f.store.rows.get(`artifacts/${f.job}`)?.state).toBe('staged');
  });
  it('does not write when an old voice job carries a forged text plan',async()=>{
    const f=await fixture('narration:en:male'),ref=`artifacts/${f.job}`,plan=artifactPlan(f.job,f.input,'translation:en');
    f.store.rows.set(ref,{...f.store.rows.get(ref),plan,planHash:artifactPlanHash(plan)});
    const before=f.state(),outcome=await f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers()).then(()=>({code:'accepted'}),error=>({code:error.code}));
    console.log(JSON.stringify({event:'synthetic-voice-text-plan',code:outcome.code,objectAttempts:f.put.mock.calls.length}));
    expect(['disabled','conflict']).toContain(outcome.code);expect(f.put).not.toHaveBeenCalled();expect(f.state()).toEqual(before);
  });
  it('does not write if the job and artifact have different owners',async()=>{
    const f=await fixture('translation:en'),ref=`jobs/${f.job}`;f.store.rows.set(ref,{...f.store.rows.get(ref),accountId:randomUUID()});
    const before=f.state(),outcome=await f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers()).then(()=>({code:'accepted'}),error=>({code:error.code}));
    console.log(JSON.stringify({event:'synthetic-output-owner-mismatch',code:outcome.code,objectAttempts:f.put.mock.calls.length}));
    expect(['not_found','conflict']).toContain(outcome.code);expect(f.put).not.toHaveBeenCalled();expect(f.state()).toEqual(before);
  });
  it('does not write a valid plan that names a different job',async()=>{
    const f=await fixture('translation:en'),ref=`artifacts/${f.job}`,plan=artifactPlan(randomUUID(),f.input,'translation:en');
    f.store.rows.set(ref,{...f.store.rows.get(ref),plan,planHash:artifactPlanHash(plan)});
    const before=f.state(),outcome=await f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers()).then(()=>({code:'accepted'}),error=>({code:error.code}));
    console.log(JSON.stringify({event:'synthetic-output-plan-job-mismatch',code:outcome.code,objectAttempts:f.put.mock.calls.length}));
    expect(['not_found','conflict']).toContain(outcome.code);expect(f.put).not.toHaveBeenCalled();expect(f.state()).toEqual(before);
  });
  it('does not start a write for an expired worker attempt',async()=>{
    const f=await fixture('translation:en'),ref=`jobs/${f.job}`;f.store.rows.set(ref,{...f.store.rows.get(ref),leaseUntil:Date.now()-1});
    const before=f.state(),outcome=await f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers()).then(()=>({code:'accepted'}),error=>({code:error.code}));
    console.log(JSON.stringify({event:'synthetic-output-expired',code:outcome.code,objectAttempts:f.put.mock.calls.length}));
    expect(['not_found','conflict']).toContain(outcome.code);expect(f.put).not.toHaveBeenCalled();expect(f.state()).toEqual(before);
  });
  for(const change of ['account-disabled','input-deleted','input-generation','accounting-missing','snapshot-changed'] as const){
    it(`does not write when ${change} is detected before the first put`,async()=>{
      const f=await fixture('translation:en');
      if(change==='account-disabled'){const ref=`accounts/${f.account}`;f.store.rows.set(ref,{...f.store.rows.get(ref),aiPilot:false});}
      if(change==='input-deleted'){const ref=`inputs/${f.input}`;f.store.rows.set(ref,{...f.store.rows.get(ref),deleted:true});}
      if(change==='input-generation'){const ref=`inputs/${f.input}`,row=f.store.rows.get(ref)!;f.store.rows.set(ref,{...row,storage:{...row.storage,generation:'3'}});}
      if(change==='accounting-missing')f.store.rows.delete(`jobAccounting/${f.job}`);
      if(change==='snapshot-changed'){const ref=`jobs/${f.job}`,row=f.store.rows.get(ref)!;f.store.rows.set(ref,{...row,snapshot:{...row.snapshot,draft:'changed'}});}
      const before=f.state(),outcome=await f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers()).then(()=>({code:'accepted'}),error=>({code:error.code}));
      expect(['disabled','not_found','conflict']).toContain(outcome.code);expect(f.put).not.toHaveBeenCalled();expect(f.state()).toEqual(before);
    });
  }
  it('does not start later puts after ownership changes while an earlier put is in flight',async()=>{
    const f=await fixture('translation:en'),jobRef=`jobs/${f.job}`;
    f.put.mockImplementationOnce(async(key,bytes)=>{
      // The first put has already started and can complete; only later puts are fenced.
      f.store.rows.set(jobRef,{...f.store.rows.get(jobRef),accountId:randomUUID()});
      return {key,generation:'2',size:bytes.length};
    });
    const outcome=await f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers()).then(()=>({code:'accepted'}),error=>({code:error.code}));
    console.log(JSON.stringify({event:'synthetic-output-change-after-first-put',code:outcome.code,objectAttempts:f.put.mock.calls.length}));
    expect(['not_found','conflict']).toContain(outcome.code);expect(f.put).toHaveBeenCalledTimes(1);
    expect(f.store.rows.get(`artifacts/${f.job}`)?.state).toBe('pending');
  });
  it('allows a coherent synthetic external job to stage results without contacting Account',async()=>{
    const f=await fixture('translation:en');attachSyntheticExternalHistory(f);expect(await externalAdmission(f)).toBe(true);
    const result=await f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers());
    expect(result).toHaveLength(5);expect(f.put).toHaveBeenCalledTimes(5);
    expect(f.store.rows.get(`artifacts/${f.job}`)?.state).toBe('staged');
  });
  for(const change of ['guard','identity'] as const){
    it(`does not start output writes after the external ${change} changes`,async()=>{
      const f=await fixture('translation:en'),external=attachSyntheticExternalHistory(f);expect(await externalAdmission(f)).toBe(true);
      if(change==='guard')f.store.rows.set(`billingGuards/${f.account}`,{accountId:f.account,blocked:true});
      else f.store.rows.delete(`identities/${external.identityKey}`);
      expect(await externalAdmission(f)).toBe(false);
      const before=f.state(),outcome=await f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers()).then(()=>({code:'accepted'}),error=>({code:error.code}));
      console.log(JSON.stringify({event:'synthetic-external-output-before',change,code:outcome.code,objectAttempts:f.put.mock.calls.length}));
      expect(['not_found','conflict']).toContain(outcome.code);expect(f.put).not.toHaveBeenCalled();expect(f.state()).toEqual(before);
    });
    it(`does not start later output writes if the external ${change} changes during the first`,async()=>{
      const f=await fixture('translation:en'),external=attachSyntheticExternalHistory(f);expect(await externalAdmission(f)).toBe(true);
      const receiptBefore=structuredClone(f.store.rows.get(`providerCalls/${f.job}-text-window-0000`));
      const accountBefore=structuredClone(f.store.rows.get(`accounts/${f.account}`)),jobBefore=structuredClone(f.store.rows.get(`jobs/${f.job}`));
      f.put.mockImplementationOnce(async(key,bytes)=>{
        if(change==='guard')f.store.rows.set(`billingGuards/${f.account}`,{accountId:f.account,blocked:true});
        else f.store.rows.delete(`identities/${external.identityKey}`);
        return {key,generation:'2',size:bytes.length};
      });
      const outcome=await f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers()).then(()=>({code:'accepted'}),error=>({code:error.code}));
      console.log(JSON.stringify({event:'synthetic-external-output-during',change,code:outcome.code,objectAttempts:f.put.mock.calls.length}));
      expect(['not_found','conflict']).toContain(outcome.code);expect(f.put).toHaveBeenCalledTimes(1);
      expect(f.store.rows.get(`providerCalls/${f.job}-text-window-0000`)).toEqual(receiptBefore);
      expect(f.store.rows.get(`accounts/${f.account}`)).toEqual(accountBefore);expect(f.store.rows.get(`jobs/${f.job}`)).toEqual(jobBefore);
      expect(f.store.rows.get(`artifacts/${f.job}`)?.state).toBe('pending');
    });
  }
  it('does not issue the next put if its validated input buffer is later changed',async()=>{
    const f=await fixture('translation:en'),buffers=f.buffers(),names=[...buffers.keys()];
    const receiptBefore=structuredClone(f.store.rows.get(`providerCalls/${f.job}-text-window-0000`));
    f.put.mockImplementationOnce(async(key,bytes)=>{buffers.get(names[1])!.fill(0x58);return {key,generation:'2',size:bytes.length};});
    const outcome=await f.ai.uploadResults(f.account,f.job,f.attempt,buffers).then(()=>({code:'accepted'}),error=>({code:error.code}));
    console.log(JSON.stringify({event:'synthetic-output-next-buffer-mutated',code:outcome.code,objectAttempts:f.put.mock.calls.length}));
    expect(['invalid','conflict']).toContain(outcome.code);expect(f.put).toHaveBeenCalledTimes(1);
    expect(f.store.rows.get(`providerCalls/${f.job}-text-window-0000`)).toEqual(receiptBefore);
    expect(f.store.rows.get(`artifacts/${f.job}`)?.state).toBe('pending');
  });
  it('passes an independent buffer to a put already in flight',async()=>{
    const f=await fixture('translation:en'),buffers=f.buffers(),first=buffers.get([...buffers.keys()][0])!,original=Buffer.from(first);let sent:Buffer|undefined;
    f.put.mockImplementationOnce(async(key,bytes)=>{first.fill(0x58);sent=Buffer.from(bytes);return {key,generation:'2',size:bytes.length};});
    await f.ai.uploadResults(f.account,f.job,f.attempt,buffers);
    expect(sent).toEqual(original);expect(f.put).toHaveBeenCalledTimes(5);
  });
  it('does not retry a lost object response or alter the provider receipt',async()=>{
    const f=await fixture('translation:en'),receipt=structuredClone(f.store.rows.get(`providerCalls/${f.job}-text-window-0000`));
    f.put.mockRejectedValueOnce(new Error('Synthetic response lost'));
    await expect(f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers())).rejects.toThrow('Synthetic response lost');
    expect(f.put).toHaveBeenCalledTimes(1);expect(f.store.rows.get(`providerCalls/${f.job}-text-window-0000`)).toEqual(receipt);
    expect(f.store.rows.get(`artifacts/${f.job}`)?.state).toBe('pending');
  });
});
