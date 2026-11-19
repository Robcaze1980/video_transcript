import {createHash,randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FirestoreAi} from './firestoreAi';
import {AI_CATALOG_VERSION,artifactPlan,artifactPlanHash} from './aiContracts';
import {privateBucket} from './privateObjectPlan';

// In-memory snapshots and synthetic object writer only. This checks the byte
// snapshot boundary, not Firestore concurrency or real storage behavior.
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fixture(mutate?:(buffers:Map<string,Buffer>)=>void){
  const account=randomUUID(),input=randomUUID(),job=randomUUID(),attempt=randomUUID(),draft='Synthetic text.',inputSha=sha('synthetic video');
  const plan=artifactPlan(job,input,'translation:en'),buffers=new Map<string,Buffer>(plan.artifacts.map(spec=>[spec.name,Buffer.from('original synthetic bytes')]));
  const storage={bucket:privateBucket,key:`candidate-files-v1/${input}/video.mp4`,generation:'1',size:100,sha256:inputSha};
  const rows=new Map<string,Record<string,any>>([
    [`accounts/${account}`,{aiPilot:true,simulationOnly:true}],
    [`inputs/${input}`,{accountId:account,expiresAtMs:Date.now()+3600000,deleted:false,ready:true,unknownCount:0,sha256:inputSha,storage}],
    [`jobs/${job}`,{accountId:account,inputId:input,aiProfile:AI_CATALOG_VERSION,state:'running',attemptId:attempt,invocationPhase:'invoking',
      leaseUntil:Date.now()+60000,operation:'translation:en',revision:1,snapshot:{draft},snapshotSha256:sha(draft),inputStorage:storage,inputSha256:inputSha}],
    [`artifacts/${job}`,{accountId:account,inputId:input,jobId:job,state:'pending',expiresAtMs:Date.now()+3600000,plan,planHash:artifactPlanHash(plan),
      quotaMode:'reserved',quotaHeld:plan.budgetBytes,revision:1,snapshotSha256:sha(draft),inputSha256:inputSha,sourceGeneration:'1'}],
  ]);
  const root={collection:(name:string)=>({doc:(id:string)=>({path:`${name}/${id}`})})};
  const snapshot=(ref:{path:string})=>{const row=rows.get(ref.path);return {exists:row!==undefined,data:()=>row,get:(field:string)=>row?.[field]};};
  const tx={get:async(ref:{path:string})=>snapshot(ref),getAll:async(...refs:{path:string}[])=>refs.map(snapshot)};
  let transactions=0;const db={runTransaction:async(work:(transaction:any)=>Promise<unknown>)=>{
    transactions++;if(transactions===1)mutate?.(buffers);return work(tx);
  }};
  const put=vi.fn(async(key:string,bytes:Buffer)=>({key,generation:'2',size:bytes.length}));
  const backend={externalJobAdmissionAllowed:vi.fn(async()=>true),stageArtifactReceipt:vi.fn(async()=>true)};
  const ai=new FirestoreAi(db as never,root as never,backend as never,{putArtifactOnce:put} as never);
  return {ai,account,input,job,attempt,buffers,put,backend};
}

describe('private output bytes are fixed before the first asynchronous read',()=>{
  beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('Unexpected network');})));
  afterEach(()=>{expect(globalThis.fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
  it('accepts unchanged synthetic text outputs',async()=>{
    const f=fixture(),result=await f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers);
    expect(result).toHaveLength(5);expect(f.put).toHaveBeenCalledTimes(5);expect(f.backend.stageArtifactReceipt).toHaveBeenCalledOnce();
  });
  for(const change of ['edit-buffer','replace-buffer'] as const)it(`rejects ${change} during the first transaction before any put`,async()=>{
    const f=fixture(buffers=>{const name=[...buffers.keys()][1];
      if(change==='edit-buffer')buffers.get(name)!.fill(0x58);else buffers.set(name,Buffer.from('replacement synthetic bytes'));
    });
    const outcome=await f.ai.uploadResults(f.account,f.job,f.attempt,f.buffers).then(()=>({code:'accepted'}),error=>({code:error.code}));
    console.log(JSON.stringify({event:'synthetic-output-buffer-before-read',change,code:outcome.code,objectAttempts:f.put.mock.calls.length}));
    expect(['invalid','conflict']).toContain(outcome.code);expect(f.put).not.toHaveBeenCalled();expect(f.backend.stageArtifactReceipt).not.toHaveBeenCalled();
  });
});
