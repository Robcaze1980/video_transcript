import {afterEach,expect,it,vi} from 'vitest';
import {processCloudAi} from './cloudAiWorker';
import type {FirestoreAi} from './firestoreAi';
import {buildWavRiff} from './pipelineVoiceWav';

function gate<T>(){let resolve!:(value:T)=>void,reject!:(reason?:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
afterEach(()=>vi.useRealTimers());
it.each(['resolve','false','reject'] as const)('drains a held %s heartbeat before returning and allowing the caller to terminate Firestore',async outcome=>{
 vi.useFakeTimers();
 const account='11111111-1111-4111-8111-111111111111',inputId='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333',attemptId='44444444-4444-4444-8444-444444444444';
 const providerEntered=gate<void>(),heartbeatEntered=gate<void>(),finishEntered=gate<void>(),provider=gate<unknown>(),heartbeat=gate<boolean>();
 const pcm=Buffer.alloc(4800);for(let i=0;i<2400;i++)pcm.writeInt16LE(Math.round(2000*Math.sin(i/12)),i*2);
 const payload={candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'audio/wav',data:buildWavRiff(pcm).toString('base64')}}]}}]};
 let state='running',closed=false,returned=false,heartbeatCompletedAfterClose=false;
 const storage={bucket:'vistavo-prod-107404655346-media',key:'candidate-files-v1/'+inputId+'/video.mp4',generation:'9007199254740993',size:100,sha256:'a'.repeat(64)};
 const input={accountId:account,ready:true,deleted:false,unknownCount:0,expiresAtMs:Date.now()+60000,sha256:storage.sha256,storage};
 const backend={recover:vi.fn(async()=>false),claim:vi.fn(async()=>({attemptId})),
  job:vi.fn(async()=>({aiProfile:'ai-candidate-v1',accountId:account,inputId,operation:'narration:en:female',snapshot:{draft:'The synthetic water pump is twelve inches wide.'},inputStorage:storage,state,attemptId,invocationPhase:state==='running'?'invoking':null})),
  heartbeat:vi.fn(async()=>{heartbeatEntered.resolve();try{return await heartbeat.promise;}finally{heartbeatCompletedAfterClose=closed;}}),
  beginInvocation:vi.fn(async()=>true),finish:vi.fn(async()=>{state='succeeded';finishEntered.resolve();return true;}),quarantine:vi.fn(async()=>{state='unknown';}),failBeforeInvocation:vi.fn(async()=>{state='failed';})};
 const invoke=vi.fn(async()=>{providerEntered.resolve();return provider.promise;}),uploadResults=vi.fn(async()=>[]);
 const ai={backend,enabled:vi.fn(async()=>{}),root:{collection:()=>({doc:()=>({get:async()=>({data:()=>input,get:()=>undefined})})})},invoke:()=>invoke,uploadResults} as unknown as FirestoreAi;
 const close=vi.fn(async()=>{closed=true;}),work=processCloudAi(ai,account,jobId,'synthetic-provider-key-never-sent');
 const lifecycle=work.then(async value=>{returned=true;await close();return value;});
 try{
  await providerEntered.promise;await vi.advanceTimersByTimeAsync(4000);await heartbeatEntered.promise;
  await vi.advanceTimersByTimeAsync(12000);expect(backend.heartbeat).toHaveBeenCalledTimes(1); // Coalesces while this SDK operation is pending.
  provider.resolve(payload);await finishEntered.promise;await vi.advanceTimersByTimeAsync(0);
  expect(state).toBe('succeeded');expect(returned).toBe(false);expect(close).not.toHaveBeenCalled();
  if(outcome==='reject')heartbeat.reject(new Error('synthetic SDK heartbeat rejection'));else heartbeat.resolve(outcome!=='false');
  expect(await lifecycle).toBe('succeeded');expect(close).toHaveBeenCalledTimes(1);expect(heartbeatCompletedAfterClose).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);expect(uploadResults).toHaveBeenCalledTimes(1);expect(backend.finish).toHaveBeenCalledTimes(1);
  expect(backend.quarantine).not.toHaveBeenCalled();expect(backend.failBeforeInvocation).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(12000);expect(backend.heartbeat).toHaveBeenCalledTimes(1); // Stop prevents any new SDK use after caller close.
 }finally{provider.resolve(payload);heartbeat.resolve(true);await lifecycle.catch(()=>{});}
});
