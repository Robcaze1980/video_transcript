import {createHash} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {FirestoreBackend,LedgerFault} from './firestoreBackend';
import {FirestoreAi} from './firestoreAi';
import {AI_CATALOG_VERSION} from './aiContracts';
import {privateBucket} from './privateObjectPlan';

const account='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const input='20000000-0000-4000-8000-000000000001',job='30000000-0000-4000-8000-000000000001';
const uid='synthetic-owner',key='synthetic-ai-request',operation='translation:en',sourceSha='a'.repeat(64);
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Row=Record<string,unknown>;
type Ref={collection:string;id:string};
function fixture(){
 const docs=new Map<string,Row>(),path=(collection:string,id:string)=>`${collection}/${id}`;
 docs.set(path('identities',digest(['firebase',uid])),{uid,accountId:account});
 docs.set(path('accounts',account),{credited:10,available:8,reserved:2,consumed:0,active:1,aiPilot:true,simulationOnly:true});
 docs.set(path('inputs',input),{accountId:account,ready:true,deleted:false,expiresAtMs:Date.now()+60000,sha256:sourceSha,metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:`candidate-files-v1/${input}/video.mp4`,generation:'1',size:20,sha256:sourceSha}});
 docs.set(path('projects',input),{accountId:account,inputId:input,revision:1,draft:''});
 docs.set(path('requests',digest([account,key])),{accountId:account,jobId:job,requestFingerprint:digest([input,operation,1,AI_CATALOG_VERSION])});
 docs.set(path('jobs',job),{accountId:account,inputId:input,requestKey:key,operation,revision:1,price:2,state:'queued',aiProfile:AI_CATALOG_VERSION});
 docs.set(path('jobAccounting',job),{protocol:1,jobId:job,accountId:account,inputId:input,requestKey:key,operation,revision:1,price:2,profile:AI_CATALOG_VERSION,mode:'simulation',createdAtMs:1});
 docs.set(path('movements','reserve:'+job),{accountId:account,reference:job,kind:'reserve',credits:2});
 const root={collection:(collection:string)=>({doc:(id:string)=>({collection,id})})};
 const snapshot=(ref:Ref)=>{const value=docs.get(path(ref.collection,ref.id));return {exists:value!==undefined,id:ref.id,get:(field:string)=>value?.[field],data:()=>value};};
 const tx={get:vi.fn(async(ref:Ref)=>snapshot(ref)),getAll:vi.fn(async(...refs:Ref[])=>refs.map(snapshot)),update:vi.fn(),create:vi.fn(),set:vi.fn(),delete:vi.fn()};
 const db={runTransaction:vi.fn(async(fn:(transaction:typeof tx)=>Promise<unknown>)=>fn(tx))};
 const backend=new FirestoreBackend(db as never,root as never),objects={read:vi.fn(),putOnce:vi.fn()};
 const ai=new FirestoreAi(db as never,root as never,backend,objects as never);
 return {backend,ai,db,tx,docs,path,objects,root};
}
function replace(c:ReturnType<typeof fixture>,collection:string,id:string,change:Row){const path=c.path(collection,id);c.docs.set(path,{...c.docs.get(path),...change});}
function noWrites(c:ReturnType<typeof fixture>){expect(c.tx.update).not.toHaveBeenCalled();expect(c.tx.create).not.toHaveBeenCalled();expect(c.tx.set).not.toHaveBeenCalled();expect(c.tx.delete).not.toHaveBeenCalled();expect(c.objects.read).not.toHaveBeenCalled();expect(c.objects.putOnce).not.toHaveBeenCalled();}

describe('AI quote requires the requester and private inputs in one transaction',()=>{
 it('reads identity, account, input and project together before returning a quote',async()=>{
  const c=fixture(),projectRead=vi.spyOn(c.backend,'readProject');
  await expect(c.ai.quoteForUid(account,input,operation,1,uid)).resolves.toMatchObject({inputId:input,operation,revision:1,units:2,billing:{mode:'simulation'}});
  expect(c.db.runTransaction).toHaveBeenCalledTimes(1);expect(c.tx.getAll).toHaveBeenCalledTimes(1);
  expect(c.tx.getAll.mock.calls[0][0]).toEqual({collection:'identities',id:digest(['firebase',uid])});
  expect(c.tx.getAll.mock.calls[0].map(ref=>ref.collection)).toEqual(['identities','accounts','inputs','projects']);
  expect(projectRead).not.toHaveBeenCalled();noWrites(c);
 });
 for(const [label,collection,id,change,code] of [
  ['missing identity','identities',digest(['firebase',uid]),null,'not_found'],
  ['reassigned identity','identities',digest(['firebase',uid]),{accountId:other},'not_found'],
  ['changed uid','identities',digest(['firebase',uid]),{uid:'synthetic-other'},'not_found'],
  ['missing account','accounts',account,null,'not_found'],
  ['disabled account','accounts',account,{aiPilot:false},'disabled'],
  ['missing input','inputs',input,null,'not_found'],
  ['foreign input','inputs',input,{accountId:other},'not_found'],
  ['deleted input','inputs',input,{deleted:true},'not_found'],
  ['invalid expiry','inputs',input,{expiresAtMs:null},'not_found'],
  ['missing project','projects',input,null,'not_found'],
  ['foreign project','projects',input,{accountId:other},'not_found'],
  ['project linked elsewhere','projects',input,{inputId:'20000000-0000-4000-8000-000000000002'},'not_found'],
 ] as const)it(`denies ${label} without returning quote data`,async()=>{
  const c=fixture();if(change)replace(c,collection,id,change);else c.docs.delete(c.path(collection,id));
  await expect(c.ai.quoteForUid(account,input,operation,1,uid)).rejects.toMatchObject({code});noWrites(c);
 });
 it.each([undefined,'',42,'u'.repeat(129)])('rejects invalid UID %s before database access',async invalid=>{
  const c=fixture();await expect(c.ai.quoteForUid(account,input,operation,1,invalid as string)).rejects.toMatchObject({code:'not_found'});
  expect(c.db.runTransaction).not.toHaveBeenCalled();noWrites(c);
 });
});

describe('simulated AI replay and reservation require UID in the same transaction',()=>{
 for(const [label,identity] of [['missing',null],['reassigned',{uid,accountId:other}],['changed UID',{uid:'synthetic-other',accountId:account}]] as const)it(`denies ${label} before any job or reservation data`,async()=>{
  const c=fixture(),p=c.path('identities',digest(['firebase',uid]));if(identity)c.docs.set(p,identity);else c.docs.delete(p);
  await expect(c.backend.priorSimulatedRequestForEnqueueForUid(account,input,key,operation,1,AI_CATALOG_VERSION,uid)).rejects.toMatchObject({code:'not_found'});
  await expect(c.backend.reserveSimulatedAiForUid(account,input,key,2,operation,1,uid)).rejects.toMatchObject({code:'not_found'});
  expect(c.tx.getAll).not.toHaveBeenCalled();noWrites(c);
 });
 it('replays only a simulated AI job with matching owner, request and accounting evidence',async()=>{
  const c=fixture();await expect(c.backend.priorSimulatedRequestForEnqueueForUid(account,input,key,operation,1,AI_CATALOG_VERSION,uid)).resolves.toBe(job);
  await expect(c.backend.reserveSimulatedAiForUid(account,input,key,2,operation,1,uid)).resolves.toBe(job);noWrites(c);
 });
 for(const [label,collection,id,change] of [
  ['request owner','requests',digest([account,key]),{accountId:other}],['job owner','jobs',job,{accountId:other}],
  ['job input','jobs',job,{inputId:'20000000-0000-4000-8000-000000000002'}],['job request','jobs',job,{requestKey:'other'}],
  ['job operation','jobs',job,{operation:'narration:en:female'}],['job revision','jobs',job,{revision:2}],
  ['job profile','jobs',job,{aiProfile:undefined}],['accounting mode','jobAccounting',job,{mode:'account_seconds'}],
  ['reserve evidence','movements','reserve:'+job,{kind:'capture'}],
 ] as const)it(`rejects mismatched ${label} rather than revealing an AI job`,async()=>{
  const c=fixture();replace(c,collection,id,change);
  await expect(c.backend.priorSimulatedRequestForEnqueueForUid(account,input,key,operation,1,AI_CATALOG_VERSION,uid)).rejects.toMatchObject({code:'conflict'});
  await expect(c.backend.reserveSimulatedAiForUid(account,input,key,2,operation,1,uid)).rejects.toMatchObject({code:'conflict'});noWrites(c);
 });
 it('does not replay a job for a missing or disabled account',async()=>{
  const c=fixture();c.docs.delete(c.path('accounts',account));
  await expect(c.backend.priorSimulatedRequestForEnqueueForUid(account,input,key,operation,1,AI_CATALOG_VERSION,uid)).rejects.toMatchObject({code:'not_found'});
  await expect(c.backend.reserveSimulatedAiForUid(account,input,key,2,operation,1,uid)).rejects.toMatchObject({code:'not_found'});
  replace(c,'accounts',account,{aiPilot:false,simulationOnly:true});
  await expect(c.backend.priorSimulatedRequestForEnqueueForUid(account,input,key,operation,1,AI_CATALOG_VERSION,uid)).rejects.toMatchObject({code:'conflict'});
  await expect(c.backend.reserveSimulatedAiForUid(account,input,key,2,operation,1,uid)).rejects.toMatchObject({code:'conflict'});noWrites(c);
 });
});

describe('external replay requires the requester inside its read transaction',()=>{
 for(const [label,identity] of [['missing',null],['reassigned',{uid,accountId:other}],['changed UID',{uid:'synthetic-other',accountId:account}]] as const)it(`denies ${label} without looking up a prior job`,async()=>{
  const c=fixture(),p=c.path('identities',digest(['firebase',uid]));if(identity)c.docs.set(p,identity);else c.docs.delete(p);
  await expect(c.backend.priorExternalRequestForEnqueue(account,input,key,operation,1,AI_CATALOG_VERSION,uid)).rejects.toMatchObject({code:'not_found'});
  expect(c.tx.getAll).not.toHaveBeenCalled();noWrites(c);
 });
 it('validates UID and account before concluding there is no prior request',async()=>{
  const c=fixture();c.docs.delete(c.path('requests',digest([account,key])));
  await expect(c.backend.priorExternalRequestForEnqueue(account,input,key,operation,1,AI_CATALOG_VERSION,uid)).resolves.toBeNull();
  expect(c.tx.get).toHaveBeenCalledWith({collection:'identities',id:digest(['firebase',uid])});
  expect(c.tx.getAll.mock.calls[0].map(ref=>ref.collection)).toContain('accounts');noWrites(c);
 });
 it('rejects UID withdrawal between enablement and the external replay transaction',async()=>{
  const c=fixture(),original=c.backend.priorExternalRequestForEnqueue.bind(c.backend),accountRequest=vi.fn(),statusRequest=vi.fn();
  vi.spyOn(c.backend,'priorExternalRequestForEnqueue').mockImplementationOnce(async(...args)=>{
   c.docs.delete(c.path('identities',digest(['firebase',uid])));return original(...args);
  });
  const ai=new FirestoreAi(c.db as never,c.root as never,c.backend,c.objects as never,undefined,{reserve:accountRequest,status:statusRequest} as never);
  await expect(ai.enqueue(account,input,operation,1,key,uid)).rejects.toMatchObject({code:'not_found'});
  expect(accountRequest).not.toHaveBeenCalled();expect(statusRequest).not.toHaveBeenCalled();noWrites(c);
 });
 it('rechecks account enablement in the external replay transaction',async()=>{
  const c=fixture(),original=c.backend.priorExternalRequestForEnqueue.bind(c.backend),accountRequest=vi.fn();
  vi.spyOn(c.backend,'priorExternalRequestForEnqueue').mockImplementationOnce(async(...args)=>{
   replace(c,'accounts',account,{aiPilot:false});return original(...args);
  });
  const ai=new FirestoreAi(c.db as never,c.root as never,c.backend,c.objects as never,undefined,{reserve:accountRequest} as never);
  await expect(ai.enqueue(account,input,operation,1,key,uid)).rejects.toMatchObject({code:'conflict'});
  expect(accountRequest).not.toHaveBeenCalled();noWrites(c);
 });
});

describe('customer AI admission keeps external Account disabled',()=>{
 it('does not inspect replay or call Account for missing or present UID',async()=>{
  const c=fixture(),accountRequest=vi.fn(),statusRequest=vi.fn(),prior=vi.spyOn(c.backend,'priorExternalRequestForEnqueue'),reserve=vi.spyOn(c.backend,'reserve');
  const ai=new FirestoreAi(c.db as never,c.root as never,c.backend,c.objects as never,undefined,{reserve:accountRequest,status:statusRequest} as never);
  await expect(ai.enqueueForUid(account,input,operation,1,key,undefined as never)).rejects.toMatchObject({code:'not_found'});
  await expect(ai.enqueueForUid(account,input,operation,1,key,uid)).rejects.toMatchObject({code:'disabled'});
  expect(c.tx.getAll.mock.calls[0].map(ref=>ref.collection)).toEqual(['identities','accounts']);
  replace(c,'identities',digest(['firebase',uid]),{accountId:other});
  await expect(ai.enqueueForUid(account,input,operation,1,key,uid)).rejects.toMatchObject({code:'not_found'});
  replace(c,'identities',digest(['firebase',uid]),{accountId:account});c.docs.delete(c.path('accounts',account));
  await expect(ai.enqueueForUid(account,input,operation,1,key,uid)).rejects.toMatchObject({code:'not_found'});
  expect(prior).not.toHaveBeenCalled();expect(reserve).not.toHaveBeenCalled();expect(accountRequest).not.toHaveBeenCalled();expect(statusRequest).not.toHaveBeenCalled();noWrites(c);
 });
 it('passes UID to replay, quote and simulated reservation without external Account',async()=>{
  const prior=vi.fn(async()=>null),reserve=vi.fn(async()=>job),backend={priorSimulatedRequestForEnqueueForUid:prior,reserveSimulatedAiForUid:reserve};
  const ai=new FirestoreAi({} as never,{} as never,backend as never,{} as never);ai.enabled=vi.fn(async()=>undefined);ai.quoteForUid=vi.fn(async()=>({units:2,operation} as never));
  await expect(ai.enqueueForUid(account,input,operation,1,key,uid)).resolves.toBe(job);
  expect(prior).toHaveBeenCalledExactlyOnceWith(account,input,key,operation,1,AI_CATALOG_VERSION,uid);
  expect(ai.quoteForUid).toHaveBeenCalledExactlyOnceWith(account,input,operation,1,uid);
  expect(reserve).toHaveBeenCalledExactlyOnceWith(account,input,key,2,operation,1,uid);
 });
 it('does not disclose a recovered ACK if the UID is revoked before the second verifier',async()=>{
  const data={accountId:account,inputId:input,operation,revision:1,requestKey:key,aiProfile:AI_CATALOG_VERSION};
  const prior=vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(job).mockRejectedValueOnce(new LedgerFault('not_found'));
  const reserve=vi.fn(async()=>{throw Object.assign(new Error('synthetic-uncertain-ack'),{code:4});}),backend={priorSimulatedRequestForEnqueueForUid:prior,reserveSimulatedAiForUid:reserve,jobForUid:vi.fn(async()=>data)};
  const ai=new FirestoreAi({} as never,{} as never,backend as never,{} as never);(ai as any).enabledForUid=vi.fn(async()=>undefined);ai.quoteForUid=vi.fn(async()=>({units:2,operation} as never));
  await expect(ai.enqueueForUid(account,input,operation,1,key,uid)).rejects.toMatchObject({code:'not_found'});expect(reserve).toHaveBeenCalledTimes(1);expect(prior).toHaveBeenCalledTimes(3);
 });
});
