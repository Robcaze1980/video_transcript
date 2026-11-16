import {createHash} from 'node:crypto';import {Readable,Transform} from 'node:stream';import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';import {mkdtemp,chmod,unlink,rmdir} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import type {FirestoreAi} from './firestoreAi';import {readyPrivateInput} from './privateObjectPlan';
import {prepareTextVideo,generateCloudText,generateCloudVoice,ConfirmedNoSpeech,type PreparedTextVideo} from './cloudAiProvider';
import {inspectDigitalSilence,digitalSilenceProof} from './digitalSilence';
/** One fenced job. Preparation is local/reversible; any ambiguity after admission is UNKNOWN. */
export async function processCloudAi(ai:FirestoreAi,accountId:string,jobId:string,apiKey:string){
 const backend=ai.backend;await backend.recover(accountId,jobId);const attempt=await backend.claim(accountId,jobId);if(!attempt)return 'not_claimed';
 const controller=new AbortController();let heartbeatPending:Promise<void>|undefined,invoking=false,localFence=false,prepared:PreparedTextVideo|undefined,directory:string|undefined,source:string|undefined;
 const timer=setInterval(()=>{if(heartbeatPending)return;heartbeatPending=backend.heartbeat(accountId,jobId,attempt.attemptId).then(ok=>{if(!ok)controller.abort();},()=>controller.abort()).finally(()=>{heartbeatPending=undefined;});},4000);timer.unref();
 try{
  const job=await backend.job(accountId,jobId);localFence=job.operation==='translation:en';
  if(job.state!=='running'||job.attemptId!==attempt.attemptId)return job.state;
  if(!job.aiProfile||!job.snapshot||!job.inputStorage||job.operation==='translation:en'&&job.invocationPhase!=='local_check')throw Error('Invalid AI snapshot');await ai.enabled(accountId);
  const input=(await ai.root.collection('inputs').doc(job.inputId).get()).data();if(!input||input.accountId!==accountId||input.deleted||input.expiresAtMs<=Date.now()||!readyPrivateInput(input,job.inputId)||input.storage.generation!==job.inputStorage.generation)throw Error('Input not available');
  if(job.operation==='translation:en'){
   directory=await mkdtemp(join(tmpdir(),'vistavo-ai-input-'));await chmod(directory,0o700);source=join(directory,'video.mp4');const digest=createHash('sha256');let bytes=0;
   const counter=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;if(bytes>job.inputStorage!.size){callback(Error('Input size mismatch'));return;}digest.update(chunk);callback(null,chunk);}});
   await pipeline(await ai.objects.read({key:job.inputStorage.key,generation:job.inputStorage.generation,size:job.inputStorage.size}),counter,createWriteStream(source,{flags:'wx',mode:0o600}),{signal:controller.signal});
   if(bytes!==job.inputStorage.size||digest.digest('hex')!==job.inputSha256)throw Error('Input digest mismatch');
   const file={id:job.inputId,path:source,size:bytes,name:'private.mp4',expiresAt:new Date((input as any).expiresAtMs),metadata:(input as any).metadata};
   const decision=await inspectDigitalSilence(file,job.inputStorage,controller.signal);
   if(decision.kind==='zero'){
    // Drain in-flight heartbeat before settlement. No exception in this branch may reach a generic refund.
    clearInterval(timer);await heartbeatPending;controller.signal.throwIfAborted();const proof=digitalSilenceProof(decision.evidence);
    try{await backend.completeDigitalSilence(accountId,jobId,attempt.attemptId,proof);}catch{/* A committed ACK can be lost; inspect only. */}
    try{if(await backend.confirmedDigitalSilence(accountId,jobId,attempt.attemptId,proof))return 'failed';}catch{/* No authoritative proof means no claim of success. */}
    try{await backend.quarantine(accountId,jobId,attempt.attemptId);}catch{/* The committed local fence survives a complete SDK outage. */}
    return 'unknown';
   }
   if(decision.kind==='unavailable')throw Error('Local audio inspection unavailable');
   const resumed=await backend.resumeTextAfterLocalCheck(accountId,jobId,attempt.attemptId,job.inputStorage,decision.kind==='nonzero'?'nonzero':'multiple_audio_tracks');
   if(!resumed)throw Error('Local audio decision not admitted');localFence=false;
   prepared=await prepareTextVideo(file,controller.signal);
  }else{
   // All voice preflight happens before the invocation fence, including chunk length and budget.
   const {narrationChunks,estimatedNarrationSeconds}=await import('./pipelineVoiceProvider');
   if(!job.snapshot.draft.trim()||!narrationChunks(job.snapshot.draft).length||estimatedNarrationSeconds(job.snapshot.draft)>600)throw Error('Voice text outside profile');
  }
  controller.signal.throwIfAborted();if(!await backend.beginInvocation(accountId,jobId,attempt.attemptId))return (await backend.job(accountId,jobId)).state;invoking=true;
  const invoke=ai.invoke(accountId,jobId,attempt.attemptId,apiKey),outputs=new Map<string,Buffer>();
  if(job.operation==='translation:en'){
   const bundle=await generateCloudText(jobId,prepared!,invoke,controller.signal);outputs.set('transcript-es.txt',bundle.es.txtBytes);outputs.set('transcript-es.srt',bundle.es.srtBytes);outputs.set('translation-en.txt',bundle.en.txtBytes);outputs.set('translation-en.srt',bundle.en.srtBytes);outputs.set('cues.json',Buffer.from(JSON.stringify({durationMs:bundle.durationMs,cues:bundle.cues})));
  }else{
   const voice=job.operation==='narration:en:female'?'Kore' as const:job.operation==='narration:en:male'?'Charon' as const:null;if(!voice)throw Error('Unsupported operation');
   const result=await generateCloudVoice(jobId,job.snapshot.draft,voice,invoke,controller.signal);outputs.set('narration-en.wav',result.wav);
  }
  controller.signal.throwIfAborted();await ai.uploadResults(accountId,jobId,attempt.attemptId,outputs);await backend.finish(accountId,jobId,attempt.attemptId,true);
  return (await backend.job(accountId,jobId)).state;
 }catch(error){
  if(localFence){
   clearInterval(timer);await heartbeatPending;
   try{await backend.quarantine(accountId,jobId,attempt.attemptId);}catch{/* Never replace uncertainty with a speculative refund. */}
   return 'unknown';
  }
  // Only complete, semantically validated silence may release a post-invocation reservation.
  // The backend independently binds every proof hash to the durable received call set.
  if(invoking&&error instanceof ConfirmedNoSpeech){
   try{await backend.completeNoSpeech(accountId,jobId,attempt.attemptId,error.receipts);}catch{/* Re-read a possibly committed terminal result before quarantining. */}
  }
  let durable=await backend.job(accountId,jobId);
  if(durable.state==='running'&&durable.invocationPhase==='local_check'){
   clearInterval(timer);await heartbeatPending;try{await backend.quarantine(accountId,jobId,attempt.attemptId);}catch{/* Preserve the durable local fence on SDK failure. */}return 'unknown';
  }
  // A lost STAGE/FINISH acknowledgement must not repeat a provider call or an object write.
  // Re-read the durable staged receipt, then let FINISH revalidate every publication fence.
  if(durable.state==='running'&&durable.attemptId===attempt.attemptId&&durable.invocationPhase==='invoking'){
   const artifact=await ai.root.collection('artifacts').doc(jobId).get();
   if(artifact.get('state')==='staged'&&artifact.get('attemptId')===attempt.attemptId){
    try{await backend.finish(accountId,jobId,attempt.attemptId,true);}catch{/* Quarantine below if confirmation remains ambiguous. */}
    durable=await backend.job(accountId,jobId);
   }
  }
  if(durable.state==='running'){if(invoking||durable.invocationPhase==='invoking')await backend.quarantine(accountId,jobId,attempt.attemptId);else await backend.failBeforeInvocation(accountId,jobId,attempt.attemptId);}
  return (await backend.job(accountId,jobId)).state;
 }finally{clearInterval(timer);controller.abort();await heartbeatPending;await prepared?.cleanup();if(source)await unlink(source).catch(e=>{if(e.code!=='ENOENT')throw e;});if(directory)await rmdir(directory);}
}

