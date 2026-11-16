import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {processCloudAi} from './cloudAiWorker';
import {prepareTextVideo} from './cloudAiProvider';
import type {FirestoreAi} from './firestoreAi';
import {inspectDigitalSilence,createDigitalSilenceAccumulator} from './digitalSilence';
vi.mock('./cloudAiProvider',async importOriginal=>({...await importOriginal<typeof import('./cloudAiProvider')>(),prepareTextVideo:vi.fn()}));
vi.mock('./digitalSilence',async importOriginal=>({...await importOriginal<typeof import('./digitalSilence')>(),inspectDigitalSilence:vi.fn(async()=>({kind:'nonzero'}))}));
afterEach(()=>{vi.clearAllMocks();vi.useRealTimers();});
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
it.each([true,false])('digital settlement drains an in-flight heartbeat; retained fence=%s',async retained=>{
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});
 const account='11111111-1111-4111-8111-111111111111',inputId='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333',attemptId='44444444-4444-4444-8444-444444444444',source=Buffer.from('immutable video');
 const storage={bucket:'vistavo-prod-107404655346-media' as const,key:'candidate-files-v1/'+inputId+'/video.mp4',generation:'9007199254740993',size:source.length,sha256:hash(source)},input={accountId:account,ready:true,deleted:false,expiresAtMs:Date.now()+60000,sha256:storage.sha256,storage,metadata:{duration:2,audioTracks:1}};
 const accumulator=createDigitalSilenceAccumulator(storage,{audioTracks:1,channels:1,sampleRate:48000});accumulator.write(Buffer.alloc(16));const evidence=accumulator.sealComplete();
 let entered!:()=>void,decide!:(value:any)=>void,heartbeatDone!:(value:boolean)=>void;const inspected=new Promise<void>(resolve=>entered=resolve);
 vi.mocked(inspectDigitalSilence).mockImplementationOnce(async()=>{entered();return new Promise(resolve=>decide=resolve);});
 const backend={recover:vi.fn(async()=>false),claim:vi.fn(async()=>({attemptId})),job:vi.fn(async()=>({aiProfile:'ai-candidate-v1',state:'running',attemptId,invocationPhase:'local_check',inputId,inputStorage:storage,inputSha256:storage.sha256,operation:'translation:en',snapshot:{draft:''}})),heartbeat:vi.fn(()=>new Promise<boolean>(resolve=>heartbeatDone=resolve)),completeDigitalSilence:vi.fn(async()=>true),confirmedDigitalSilence:vi.fn(async()=>true),quarantine:vi.fn(async()=>true),failBeforeInvocation:vi.fn(),beginInvocation:vi.fn()};
 const ai={backend,enabled:async()=>{},objects:{read:async()=>Readable.from([source])},root:{collection:()=>({doc:()=>({get:async()=>({data:()=>input})})})}} as unknown as FirestoreAi;
 const work=processCloudAi(ai,account,jobId,'not-used');await inspected;await vi.advanceTimersByTimeAsync(4000);expect(backend.heartbeat).toHaveBeenCalledTimes(1);decide({kind:'zero',evidence});await Promise.resolve();await Promise.resolve();expect(backend.completeDigitalSilence).not.toHaveBeenCalled();heartbeatDone(retained);
 expect(await work).toBe(retained?'failed':'unknown');expect(backend.completeDigitalSilence).toHaveBeenCalledTimes(retained?1:0);expect(backend.failBeforeInvocation).not.toHaveBeenCalled();expect(backend.beginInvocation).not.toHaveBeenCalled();
});
it.each(['before-commit','after-commit'] as const)('claim %s ACK failure performs no local preparation, refund or provider call',async timing=>{
 let committed=false;const backend={recover:vi.fn(async()=>false),claim:vi.fn(async()=>{committed=timing==='after-commit';throw Error('claim ACK unavailable');}),failBeforeInvocation:vi.fn(),quarantine:vi.fn()},invoke=vi.fn();
 await expect(processCloudAi({backend,invoke} as unknown as FirestoreAi,'account','job','not-used')).rejects.toThrow('claim ACK unavailable');
 expect(committed).toBe(timing==='after-commit');expect(backend.failBeforeInvocation).not.toHaveBeenCalled();expect(backend.quarantine).not.toHaveBeenCalled();expect(invoke).not.toHaveBeenCalled();expect(inspectDigitalSilence).not.toHaveBeenCalled();
});
it.each(['complete','lost-ack','refused','sdk-outage','readback-outage','unrelated-failed','resume-ack-lost','unavailable','unexpected-phase'] as const)('digital local branch %s never falls through a generic refund or provider admission',async outcome=>{
 const account='11111111-1111-4111-8111-111111111111',inputId='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333',attemptId='44444444-4444-4444-8444-444444444444';
 const source=Buffer.from('synthetic local decoder input'),storage={bucket:'vistavo-prod-107404655346-media' as const,key:'candidate-files-v1/'+inputId+'/video.mp4',generation:'9007199254740993',size:source.length,sha256:hash(source)};
 const accumulator=createDigitalSilenceAccumulator(storage,{audioTracks:1,channels:2,sampleRate:48000});accumulator.write(Buffer.alloc(32));const evidence=accumulator.sealComplete();
 if(outcome!=='unexpected-phase')vi.mocked(inspectDigitalSilence).mockResolvedValueOnce(outcome==='unavailable'?{kind:'unavailable',reason:'decode_failed'} as any:outcome==='resume-ack-lost'?{kind:'nonzero'}:{kind:'zero',evidence});
 let state='queued',phase=outcome==='unexpected-phase'?'not_started':'local_check',releaseCount=0;const input={accountId:account,ready:true,deleted:false,unknownCount:0,expiresAtMs:Date.now()+60000,sha256:storage.sha256,storage,metadata:{duration:2,audioTracks:1}};
 const backend={recover:vi.fn(async()=>false),claim:vi.fn(async()=>{state='running';return {attemptId};}),heartbeat:vi.fn(async()=>true),
  job:vi.fn(async()=>({aiProfile:'ai-candidate-v1',accountId:account,inputId,operation:'translation:en',snapshot:{draft:''},inputStorage:storage,inputSha256:storage.sha256,state,attemptId,invocationPhase:phase})),
  completeDigitalSilence:vi.fn(async()=>{if(outcome==='sdk-outage')throw Error('SDK unavailable');if(['refused','readback-outage','unrelated-failed'].includes(outcome)){if(outcome==='unrelated-failed')state='failed';return false;}releaseCount++;state='failed';if(outcome==='lost-ack')throw Error('ACK lost');return true;}),
  confirmedDigitalSilence:vi.fn(async()=>{if(outcome==='readback-outage'||outcome==='sdk-outage')throw Error('read unavailable');return releaseCount===1;}),
  resumeTextAfterLocalCheck:vi.fn(async()=>{phase='not_started';throw Error('reset ACK lost');}),quarantine:vi.fn(async()=>{if(outcome==='sdk-outage')throw Error('SDK unavailable');if(state==='running')state='unknown';return true;}),
  beginInvocation:vi.fn(),failBeforeInvocation:vi.fn(),finish:vi.fn()};
 const paid=vi.fn(),uploadResults=vi.fn(),ai={backend,enabled:vi.fn(async()=>{}),objects:{read:vi.fn(async()=>Readable.from([source]))},root:{collection:()=>({doc:()=>({get:async()=>({data:()=>input})})})},invoke:()=>paid,uploadResults} as unknown as FirestoreAi;
 expect(await processCloudAi(ai,account,jobId,'not-used')).toBe(outcome==='complete'||outcome==='lost-ack'?'failed':'unknown');
 expect(backend.beginInvocation).not.toHaveBeenCalled();expect(backend.failBeforeInvocation).not.toHaveBeenCalled();expect(backend.finish).not.toHaveBeenCalled();expect(paid).not.toHaveBeenCalled();expect(uploadResults).not.toHaveBeenCalled();
 expect(releaseCount).toBe(outcome==='complete'||outcome==='lost-ack'?1:0);expect(backend.quarantine).toHaveBeenCalledTimes(outcome==='complete'||outcome==='lost-ack'?0:1);
});
it.each(['complete','lost-ack','refused','malformed','network','forged'] as const)('worker handles %s silence evidence without another paid invocation or fabricated outputs',async outcome=>{
 const account='11111111-1111-4111-8111-111111111111',inputId='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333',attemptId='44444444-4444-4444-8444-444444444444';
 const source=Buffer.from('synthetic immutable video bytes'),storage={bucket:'vistavo-prod-107404655346-media',key:'candidate-files-v1/'+inputId+'/video.mp4',generation:'9007199254740993',size:source.length,sha256:hash(source)};
 const input={accountId:account,ready:true,deleted:false,unknownCount:0,expiresAtMs:Date.now()+60000,sha256:storage.sha256,storage,metadata:{duration:31,audioTracks:1}};
 const payload={candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({detectedLanguage:'und',hasSpeech:false,cues:[]})}]}}]};
 const cleanup=vi.fn();vi.mocked(prepareTextVideo).mockImplementationOnce(async()=>{
  const directory=await mkdtemp(join(tmpdir(),'vistavo-silent-worker-')),bytes=Buffer.from('ID3synthetic-audio'),paths=[join(directory,'0.mp3'),join(directory,'1.mp3')];for(const path of paths)await writeFile(path,bytes);
  return {durationMs:31000,chunks:paths.map((path,index)=>({index,path,size:bytes.length,startMs:index*30000,endMs:index===0?30000:31000})),cleanup:async()=>{cleanup();for(const path of paths)await unlink(path);await rmdir(directory);}};
 });
 let state='queued',reserved=31,available=69,phase='local_check',releaseCount=0;
 const backend={recover:vi.fn(async()=>false),claim:vi.fn(async()=>{if(state!=='queued')return null;state='running';return {attemptId};}),heartbeat:vi.fn(async()=>true),
  job:vi.fn(async()=>({aiProfile:'ai-candidate-v1',accountId:account,inputId,operation:'translation:en',snapshot:{draft:''},inputStorage:storage,inputSha256:storage.sha256,state,attemptId,invocationPhase:phase})),
  beginInvocation:vi.fn(async()=>{phase='invoking';return true;}),
  resumeTextAfterLocalCheck:vi.fn(async()=>{phase='not_started';return true;}),
  completeNoSpeech:vi.fn(async(_account,_job,_attempt,proof)=>{expect([_account,_job,_attempt]).toEqual([account,jobId,attemptId]);expect(proof).toEqual([0,1].map(index=>({callKey:'text-window:'+String(index).padStart(4,'0'),responseSha256:hash(JSON.stringify(payload))})));if(outcome==='refused')return false;state='failed';reserved=0;available=100;releaseCount++;if(outcome==='lost-ack')throw Error('synthetic lost ACK after committed release');return true;}),
  finish:vi.fn(async()=>{throw Error('Silence cannot publish');}),quarantine:vi.fn(async()=>{state='unknown';}),failBeforeInvocation:vi.fn(async()=>{state='failed';})};
 const paid=vi.fn().mockResolvedValueOnce(payload);if(outcome==='network'||outcome==='forged')paid.mockRejectedValueOnce(outcome==='network'?Error('synthetic lost response'):Object.assign(Error('no_speech'),{name:'ConfirmedNoSpeech',receipts:[{callKey:'text-window:0000',responseSha256:hash(JSON.stringify(payload))}]}));else paid.mockResolvedValueOnce(outcome==='malformed'?{candidates:[]}:payload);
 const uploadResults=vi.fn(async()=>{throw Error('Silence must not upload');}),ai={backend,enabled:vi.fn(async()=>{}),objects:{read:vi.fn(async()=>Readable.from([source]))},root:{collection:()=>({doc:()=>({get:async()=>({data:()=>input,get:()=>undefined})})})},invoke:()=>paid,uploadResults} as unknown as FirestoreAi;
 const result=await processCloudAi(ai,account,jobId,'synthetic-key-not-sent');
 expect(result).toBe(outcome==='complete'||outcome==='lost-ack'?'failed':'unknown');expect(paid).toHaveBeenCalledTimes(2);expect(uploadResults).not.toHaveBeenCalled();expect(backend.finish).not.toHaveBeenCalled();expect(cleanup).toHaveBeenCalledTimes(1);
 if(outcome==='complete'||outcome==='lost-ack'){expect(backend.completeNoSpeech).toHaveBeenCalledTimes(1);expect(backend.quarantine).not.toHaveBeenCalled();expect({reserved,available,releaseCount}).toEqual({reserved:0,available:100,releaseCount:1});}
 else{expect(backend.quarantine).toHaveBeenCalledTimes(1);expect({reserved,available,releaseCount}).toEqual({reserved:31,available:69,releaseCount:0});if(outcome!=='refused')expect(backend.completeNoSpeech).not.toHaveBeenCalled();}
 expect(await processCloudAi(ai,account,jobId,'synthetic-key-not-sent')).toBe('not_claimed');expect(paid).toHaveBeenCalledTimes(2);expect(releaseCount).toBe(outcome==='complete'||outcome==='lost-ack'?1:0);
});
