import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {describe,it,expect,vi} from 'vitest';
import {AccountBillingClient} from './accountBillingClient';
import {FirestoreAi} from './firestoreAi';
import {firestoreHttp} from './firestoreHttp';
import {objectPlan,privateBucket} from './privateObjectPlan';
import {AI_CATALOG_VERSION} from './aiContracts';

function fixture(request:(value:any)=>Promise<any>){
 const accountId=randomUUID(),inputId=randomUUID(),uid='billing-fixture-user',sha='a'.repeat(64),draft='The technician checks the water pump.';
 const input={accountId,ready:true,deleted:false,expiresAtMs:Date.now()+60000,sha256:sha,metadata:{duration:2.1,audioTracks:1},storage:{bucket:privateBucket,key:objectPlan(inputId,12).final,generation:'1',size:12,sha256:sha}};
 const account={get:(key:string)=>key==='aiPilot'||key==='simulationOnly'};
 const root={collection:(name:string)=>({doc:(id:string)=>({get:async()=>name==='accounts'?{exists:true,...account}:name==='inputs'?{exists:true,data:()=>input}:{exists:false}})})};
 const project:any={accountId,inputId,revision:1,draft,reviewedTextRevision:1,reviewedTextSha256:createHash('sha256').update(draft).digest('hex')};
 const prior=new Map<string,string>(),reserve=vi.fn(async(_account:string,_input:string,key:string)=>{const id=randomUUID();prior.set(key,id);return id;});
 const witnesses=new Map<string,Record<string,unknown>>();
 const beginExternalBillingIntent=vi.fn(async(account:string,input:string,key:string,operation:string,revision:number,billing:Record<string,unknown>)=>{witnesses.set(key,{intentId:createHash('sha256').update(JSON.stringify([account,key])).digest('hex'),accountId:account,inputId:input,operation,revision,profile:AI_CATALOG_VERSION,...billing});return null;});
 const externalIntentWitness=vi.fn(async(account:string,key:string,billing:Record<string,unknown>)=>{const witness=witnesses.get(key);if(!witness||witness.accountId!==account||witness.identityKey!==billing.identityKey||witness.reservationId!==billing.reservationId||witness.seconds!==billing.seconds)throw Error('Missing synthetic intent witness');return witness;});
 const captureExternalBillingIntentFailureEvidence=vi.fn(async(witness:Record<string,unknown>)=>({mode:'unleased',snapshotVersion:'1:000000000',intentGuardVersion:'1:000000000',state:'reserve_pending',witness}));
 const captureDirectObservation=vi.fn(async(witness:Record<string,unknown>,_key:string,source:string)=>({attemptId:randomUUID(),source,witness,versions:Object.fromEntries(['account','identity','input','project','intent','origin','guard','intentGuard','request','jobMarker','sealWitness','sealRecovery','releaseWitness','releaseRecovery'].map(name=>[name,['account','identity','input','intent','origin','intentGuard'].includes(name)?{exists:true,createTime:'1:000000000',updateTime:'1:000000000'}:{exists:false}]))}));
 const priorRequest=vi.fn(async(_account:string,_input:string,key:string)=>prior.get(key)??null);
 // Step 1.3b (Codex): the requester path prepares an immutable attempt BEFORE the Account POST and records the ACK; the double derives the attempt from the intent witness.
 const prepareExternalReserveAttempt=vi.fn(async(account:string,_input:string,key:string)=>{const w=witnesses.get(key);if(!w||w.accountId!==account)throw Error('Missing synthetic intent witness');return {version:1,attemptId:randomUUID(),witness:{intentId:w.intentId,accountId:w.accountId,inputId:w.inputId,operation:w.operation,revision:w.revision,profile:AI_CATALOG_VERSION,provider:'account_seconds',identityKey:w.identityKey,reservationId:w.reservationId,seconds:w.seconds},versions:{}};});
 const recordExternalReserveAck=vi.fn(async()=>'recorded');
 const backend={accountForUid:vi.fn(async()=>accountId),readProject:vi.fn(async()=>project),priorRequest,priorExternalRequestForEnqueue:priorRequest,beginExternalBillingIntent,externalIntentWitness,recheckExternalBillingAdmission:vi.fn(async()=>({state:'permitted'})),captureExternalBillingIntentFailureEvidence,captureDirectObservation,recordReservedStatusUncertainty:vi.fn(async()=>'unchanged'),pendingExternalBillingIntents:vi.fn(async()=>[]),pendingExternalBilling:vi.fn(async()=>[]),recordExternalBillingIntentFailure:vi.fn(async()=>true),recordExternalBillingFailure:vi.fn(async()=>true),markExternalBillingSettled:vi.fn(async()=>true),prepareExternalReserveAttempt,recordExternalReserveAck,reserve,readBalance:vi.fn(async()=>({available:0,reserved:0}))};
 const billing=new AccountBillingClient(undefined,{request}),ai=new FirestoreAi({} as any,root as any,backend as any,{} as any,undefined,billing);
 (ai as any).enabledForUid=vi.fn(async(account:string,requester:string)=>{if(account!==accountId||requester!==uid)throw Error('synthetic UID mismatch');});
 return {accountId,inputId,uid,backend,ai};
}
const reserved=(request:any)=>({data:{reservationId:request.data.reservationId,state:'reserved',seconds:request.data.seconds}});

describe('video AI account balance integration',()=>{
 it('insufficient account balance fails closed before local job or provider dispatch',async()=>{
  const accountRequest=vi.fn(async(request:any)=>{throw Object.assign(Error('hidden'),{response:{status:request.url.endsWith('/status')?404:402}});}),c=fixture(accountRequest);
  await expect(c.ai.enqueue(c.accountId,c.inputId,'translation:en',1,randomUUID(),c.uid)).rejects.toMatchObject({code:'insufficient'});
  expect(accountRequest).toHaveBeenCalledTimes(2);expect(accountRequest.mock.calls[1][0].url).toMatch(/\/status$/);expect(c.backend.captureDirectObservation.mock.invocationCallOrder[0]).toBeLessThan(accountRequest.mock.invocationCallOrder[1]);expect(c.backend.reserve).not.toHaveBeenCalled();
 });
 it('the customer HTTP endpoint keeps external Account admission disabled without a remote call or replay',async()=>{
  const accountRequest=vi.fn(async()=>{throw Error('External Account must not be contacted');}),c=fixture(accountRequest),server=createServer(),addressReady=new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));await addressReady;
  const checked=vi.fn(async()=>undefined);(c.ai as any).enabledForUid=checked;
  const address=server.address();if(!address||typeof address==='string')throw Error('No loopback address');const origin=`http://127.0.0.1:${address.port}`;
  const handler=firestoreHttp({backend:c.backend as any,identity:{verifyIdToken:async(token:string)=>{if(token!=='fixture-user-token')throw Error('bad token');return {uid:c.uid,email_verified:true} as unknown as import('firebase-admin/auth').DecodedIdToken;}},origin,ai:c.ai});server.removeAllListeners('request');server.on('request',(req,res)=>void handler(req,res));
  try{const response=await fetch(origin+'/api/cloud/ai/jobs',{method:'POST',headers:{Origin:origin,Authorization:'Bearer fixture-user-token','Content-Type':'application/json'},body:JSON.stringify({inputId:c.inputId,operation:'translation:en',expectedRevision:1,requestKey:randomUUID()})});
   expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'disabled'});expect(checked).toHaveBeenCalledExactlyOnceWith(c.accountId,c.uid);expect(accountRequest).not.toHaveBeenCalled();expect(c.backend.priorRequest).not.toHaveBeenCalled();expect(c.backend.beginExternalBillingIntent).not.toHaveBeenCalled();expect(c.backend.reserve).not.toHaveBeenCalled();
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
 it('external admission cannot be enabled by omitting the verified UID',async()=>{
  const accountRequest=vi.fn(async()=>{throw Error('External Account must not be contacted');}),c=fixture(accountRequest);
  await expect(c.ai.enqueueForUid(c.accountId,c.inputId,'translation:en',1,randomUUID(),undefined as never)).rejects.toMatchObject({code:'not_found'});
  expect(accountRequest).not.toHaveBeenCalled();expect(c.backend.priorRequest).not.toHaveBeenCalled();expect(c.backend.beginExternalBillingIntent).not.toHaveBeenCalled();expect(c.backend.reserve).not.toHaveBeenCalled();
 });
 it('quotes ceil-second text and voice, and does not treat external replay as a new acceptance',async()=>{
  const accountRequest=vi.fn(async(request:any)=>reserved(request)),c=fixture(accountRequest),key=randomUUID();
  const quote=await c.ai.quote(c.accountId,c.inputId,'narration:en:female',1);expect(quote).toMatchObject({units:3,billing:{mode:'account_seconds',unit:'video_seconds',exactPriceUsd:0.005,priceUsd:0.01,rateUsdPerMinute:0.1,rounding:'per_selected_service_half_up_to_cent'}});
  const job=await c.ai.enqueue(c.accountId,c.inputId,'translation:en',1,key,c.uid);
  await expect(c.ai.enqueue(c.accountId,c.inputId,'translation:en',1,key,c.uid)).rejects.toMatchObject({code:'unknown'});
  expect(job).toEqual(expect.any(String));expect(c.backend.priorRequest).toHaveBeenLastCalledWith(c.accountId,c.inputId,key,'translation:en',1,AI_CATALOG_VERSION,c.uid);
  expect(accountRequest).toHaveBeenCalledTimes(1);expect(c.backend.beginExternalBillingIntent.mock.invocationCallOrder[0]).toBeLessThan(c.backend.recheckExternalBillingAdmission.mock.invocationCallOrder[0]);expect(c.backend.recheckExternalBillingAdmission.mock.invocationCallOrder[0]).toBeLessThan(c.backend.captureExternalBillingIntentFailureEvidence.mock.invocationCallOrder[0]);expect(c.backend.captureExternalBillingIntentFailureEvidence.mock.invocationCallOrder[0]).toBeLessThan(accountRequest.mock.invocationCallOrder[0]);expect(accountRequest.mock.invocationCallOrder[0]).toBeLessThan(c.backend.reserve.mock.invocationCallOrder[0]);// Step 1.3b (Codex): the job write also receives the prepared attempt and the validated ACK.
  expect(c.backend.reserve).toHaveBeenCalledWith(c.accountId,c.inputId,key,3,'translation:en',1,expect.any(String),expect.objectContaining({provider:'account_seconds',seconds:3}),undefined,c.uid,expect.objectContaining({version:1}),expect.objectContaining({state:'reserved',seconds:3}));expect(c.backend.prepareExternalReserveAttempt.mock.invocationCallOrder[0]).toBeLessThan(accountRequest.mock.invocationCallOrder[0]);
 });
 it('requires a requester UID before an external replay lookup or Account request',async()=>{
  const accountRequest=vi.fn(async(value:any)=>reserved(value)),c=fixture(accountRequest);
  await expect(c.ai.enqueue(c.accountId,c.inputId,'translation:en',1,randomUUID())).rejects.toMatchObject({code:'invalid'});
  expect(c.backend.priorRequest).not.toHaveBeenCalled();expect(accountRequest).not.toHaveBeenCalled();
 });
 it('does not create a job from a later reserved status after the POST response is lost',async()=>{
  const accountRequest=vi.fn(async(request:any)=>{
   const path=new URL(request.url).pathname;
   if(path.endsWith('/status'))return {data:{reservationId:path.split('/').at(-2),seconds:3,state:'reserved'}};
   throw Object.assign(Error('synthetic response lost'),{response:{status:503}});
  }),c=fixture(accountRequest);
  await expect(c.ai.enqueue(c.accountId,c.inputId,'translation:en',1,randomUUID(),c.uid)).rejects.toMatchObject({code:'unknown'});
  expect(accountRequest).toHaveBeenCalledTimes(2);expect(c.backend.captureDirectObservation).toHaveBeenCalledOnce();expect(c.backend.recordReservedStatusUncertainty).toHaveBeenCalledOnce();
  expect(c.backend.reserve).not.toHaveBeenCalled();
 });
 it('does not recover a pending job or release balance from reserved status in the drain',async()=>{
  const accountRequest=vi.fn(async(request:any)=>{
   const path=new URL(request.url).pathname;
   if(path.endsWith('/status'))return {data:{reservationId:path.split('/').at(-2),seconds:3,state:'reserved'}};
   throw Error('unexpected synthetic Account endpoint');
  }),c=fixture(accountRequest),requestKey=randomUUID(),reservationId=randomUUID(),identityKey=createHash('sha256').update(JSON.stringify(['firebase',c.uid])).digest('hex');
  const intentId=createHash('sha256').update(JSON.stringify([c.accountId,requestKey])).digest('hex');
  const witness={intentId,accountId:c.accountId,inputId:c.inputId,operation:'translation:en',revision:1,profile:AI_CATALOG_VERSION,provider:'account_seconds',identityKey,reservationId,seconds:3};
  (c.backend.pendingExternalBillingIntents as any).mockResolvedValue([{...witness,requestKey,state:'reserve_pending',snapshotVersion:'1:000000000'}]);
  (c.backend.externalIntentWitness as any).mockResolvedValue(witness);
  await expect(c.ai.drainExternalBilling()).resolves.toEqual({settled:0,failed:0,intentsRecovered:0,intentsFailed:1});
  expect(accountRequest).toHaveBeenCalledTimes(1);expect(accountRequest.mock.calls[0][0].url).toMatch(/\/status$/);expect(c.backend.recordReservedStatusUncertainty).toHaveBeenCalledOnce();expect(c.backend.reserve).not.toHaveBeenCalled();
 });
 it('rejects optional voice until a saved reviewed text revision exists',async()=>{
  const request=vi.fn(async(value:any)=>reserved(value)),c=fixture(request);(c.backend.readProject as any).mockResolvedValueOnce({revision:1,draft:'edited',reviewedTextRevision:0,reviewedTextSha256:'b'.repeat(64)});
  await expect(c.ai.enqueue(c.accountId,c.inputId,'narration:en:male',1,randomUUID(),c.uid)).rejects.toMatchObject({code:'invalid'});
  expect(request).not.toHaveBeenCalled();expect(c.backend.reserve).not.toHaveBeenCalled();
 });
});
