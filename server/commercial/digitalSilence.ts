import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {finished} from 'node:stream/promises';
import {isAbsolute} from 'node:path';
import type {FileInput} from './jobs';
import {privateBucket,privateSha,privateUuid} from './privateObjectPlan';

export const digitalSilenceLimits=Object.freeze({totalMs:60000,pcmBytes:512*1024*1024,stderrBytes:8192,probeBytes:65536});
export type DigitalSilenceUnavailableReason='source'|'source_changed'|'metadata'|'unsupported_container'|'process'|'probe_limit'|'stderr_limit'|'pcm_limit'|'invalid_pcm'|'empty_audio'|'aborted'|'timeout';
class InspectionFault extends Error {constructor(readonly reason:DigitalSilenceUnavailableReason){super(reason);}}
export type DigitalSilenceBinding=Readonly<{key:string;generation:string;size:number;sha256:string}>;
export type DigitalSilenceProof=Readonly<{
 version:'digital-zero-pcm-f64le-v1';sourceBucket:typeof privateBucket;sourceKey:string;sourceGeneration:string;sourceSize:number;sourceSha256:string;
 audioTracks:1;channels:number;sampleRate:number;frameCount:number;sampleCount:number;byteCount:number;pcmSha256:string;format:'pcm_f64le';decodeComplete:true;
}>;
const fields=['version','sourceBucket','sourceKey','sourceGeneration','sourceSize','sourceSha256','audioTracks','channels','sampleRate','frameCount','sampleCount','byteCount','pcmSha256','format','decodeComplete'];
const keyPattern=/^candidate-files-v1\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/video\.mp4$/;
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
function binding(value:DigitalSilenceBinding){
 if(!value||typeof value.key!=='string'||!keyPattern.test(value.key)||typeof value.generation!=='string'||!/^[1-9]\d{0,30}$/.test(value.generation)||!positive(value.size)||value.size>500000000||typeof value.sha256!=='string'||!privateSha.test(value.sha256)||('bucket'in value&&(value as any).bucket!==privateBucket))throw new InspectionFault('source');
 return Object.freeze({key:value.key,generation:value.generation,size:value.size,sha256:value.sha256});
}
/** Plain persisted evidence is validated separately from the trusted in-process brand. */
export function validateDigitalSilenceProof(value:unknown):DigitalSilenceProof{
 const v=value as any;if(!v||typeof v!=='object'||Array.isArray(v)||(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)||Object.keys(v).length!==fields.length||Object.keys(v).some(k=>!fields.includes(k)))throw new InspectionFault('invalid_pcm');
 const source=binding({key:v.sourceKey,generation:v.sourceGeneration,size:v.sourceSize,sha256:v.sourceSha256});
 if(v.version!=='digital-zero-pcm-f64le-v1'||v.sourceBucket!==privateBucket||v.audioTracks!==1||v.format!=='pcm_f64le'||v.decodeComplete!==true||
  ![v.channels,v.sampleRate,v.frameCount,v.sampleCount,v.byteCount].every(positive)||v.byteCount>digitalSilenceLimits.pcmBytes||v.byteCount!==v.sampleCount*8||v.sampleCount!==v.frameCount*v.channels||typeof v.pcmSha256!=='string'||!privateSha.test(v.pcmSha256))throw new InspectionFault('invalid_pcm');
 return Object.freeze({version:'digital-zero-pcm-f64le-v1',sourceBucket:privateBucket,sourceKey:source.key,sourceGeneration:source.generation,sourceSize:source.size,sourceSha256:source.sha256,
  audioTracks:1,channels:v.channels,sampleRate:v.sampleRate,frameCount:v.frameCount,sampleCount:v.sampleCount,byteCount:v.byteCount,pcmSha256:v.pcmSha256,format:'pcm_f64le',decodeComplete:true});
}
export function digitalSilenceProofHash(value:unknown){return createHash('sha256').update(JSON.stringify(validateDigitalSilenceProof(value))).digest('hex');}
const capability=Symbol('trusted complete digital silence'),brands=new WeakMap<object,DigitalSilenceProof>();
/** Not an Error or a serializable client assertion. Only the trusted decoder adapter can mint it. */
export class ConfirmedDigitalSilence {
 constructor(token:unknown,proof:unknown){if(token!==capability)throw new InspectionFault('invalid_pcm');brands.set(this,validateDigitalSilenceProof(proof));Object.freeze(this);}
}
export function digitalSilenceProof(evidence:unknown):DigitalSilenceProof{
 const proof=typeof evidence==='object'&&evidence!==null?brands.get(evidence):undefined;if(!proof)throw new InspectionFault('invalid_pcm');return proof;
}
/** Trusted server decoder adapter: sealComplete is called only after clean full EOF/process close.
 * Exported for deterministic stream tests/worker fixtures; never exposed through an HTTP input. */
export function createDigitalSilenceAccumulator(source:DigitalSilenceBinding,metadata:{audioTracks:1;channels:number;sampleRate:number}){
 const saved=binding(source),audio=Object.freeze({...metadata});if(audio.audioTracks!==1||!positive(audio.channels)||!positive(audio.sampleRate))throw new InspectionFault('metadata');
 let bytes=0,samples=0,carry=Buffer.alloc(0),nonzero=false,failure:DigitalSilenceUnavailableReason|undefined,sealed:ConfirmedDigitalSilence|undefined;
 const hash=createHash('sha256'),fail=(reason:DigitalSilenceUnavailableReason):never=>{failure=reason;throw new InspectionFault(reason);};
 const sample=(value:number)=>{if(!Number.isFinite(value))fail('invalid_pcm');samples++;if(value!==0){nonzero=true;return false;}return true;};
 return Object.freeze({
  write(chunk:Buffer):boolean{
   if(failure)throw new InspectionFault(failure);if(sealed)throw new InspectionFault('invalid_pcm');if(nonzero)return false;
   if(!Buffer.isBuffer(chunk))return fail('invalid_pcm');if(!Number.isSafeInteger(bytes+chunk.length)||bytes+chunk.length>digitalSilenceLimits.pcmBytes)return fail('pcm_limit');bytes+=chunk.length;hash.update(chunk);
   let at=0;
   if(carry.length){const amount=Math.min(8-carry.length,chunk.length),joined=Buffer.alloc(carry.length+amount);carry.copy(joined);chunk.copy(joined,carry.length,0,amount);at=amount;
    if(joined.length<8){carry=joined;return true;}carry=Buffer.alloc(0);if(!sample(joined.readDoubleLE(0)))return false;}
   for(;at+8<=chunk.length;at+=8)if(!sample(chunk.readDoubleLE(at)))return false;
   carry=Buffer.from(chunk.subarray(at));return true;
  },
  sealComplete():ConfirmedDigitalSilence{
   if(failure)throw new InspectionFault(failure);if(sealed)return sealed;if(nonzero)throw new InspectionFault('invalid_pcm');if(!bytes)return fail('empty_audio');
   if(carry.length||bytes!==samples*8||samples%audio.channels!==0)return fail('invalid_pcm');
   if(!samples)return fail('empty_audio');
   sealed=new ConfirmedDigitalSilence(capability,{version:'digital-zero-pcm-f64le-v1',sourceBucket:privateBucket,sourceKey:saved.key,sourceGeneration:saved.generation,sourceSize:saved.size,sourceSha256:saved.sha256,
    audioTracks:1,channels:audio.channels,sampleRate:audio.sampleRate,frameCount:samples/audio.channels,sampleCount:samples,byteCount:bytes,pcmSha256:hash.digest('hex'),format:'pcm_f64le',decodeComplete:true});return sealed;
  },
 });
}
export type DigitalSilenceResult={kind:'zero';evidence:ConfirmedDigitalSilence}|{kind:'nonzero'}|{kind:'ineligible';reason:'multiple_audio_tracks'}|{kind:'unavailable';reason:DigitalSilenceUnavailableReason};
const formats='mov,matroska,webm,avi,mpeg,mpegts,asf,flv,ogg';
const aliases=new Set((formats+',mp4,m4a,3gp,3g2,mj2').split(','));
async function run(command:'ffprobe'|'ffmpeg',args:string[],signal:AbortSignal,onData:(data:Buffer)=>boolean){
 signal.throwIfAborted();
 return new Promise<'complete'|'nonzero'>((resolve,reject)=>{
  let child:ReturnType<typeof spawn>;try{child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});}catch{reject(new InspectionFault('process'));return;}
  let fault:InspectionFault|undefined,early=false,closed=false,stdoutEnded=false,stderrEnded=false,stderrBytes=0,stderrText=false;
  const stop=(error?:InspectionFault)=>{if(closed)return;if(error)fault??=error;try{child.kill('SIGKILL');}catch{fault??=new InspectionFault('process');}};
  const abort=()=>stop(new InspectionFault('aborted'));signal.addEventListener('abort',abort,{once:true});
  child.once('error',()=>stop(new InspectionFault('process')));
  if(!child.stdout||!child.stderr){stop(new InspectionFault('process'));}
  child.stdout?.once('error',()=>stop(new InspectionFault('process')));child.stderr?.once('error',()=>stop(new InspectionFault('process')));
  child.stdout?.on('end',()=>{stdoutEnded=true;});child.stderr?.on('end',()=>{stderrEnded=true;});
  child.stdout?.on('data',(data:Buffer)=>{if(fault||early||closed)return;try{if(!onData(data)){early=true;stop();}}catch(error){stop(error instanceof InspectionFault?error:new InspectionFault('process'));}});
  child.stderr?.on('data',(data:Buffer)=>{if(closed)return;stderrBytes+=data.length;if(stderrBytes>digitalSilenceLimits.stderrBytes){stop(new InspectionFault('stderr_limit'));return;}if(data.some(byte=>![9,10,13,32].includes(byte)))stderrText=true;});
  child.once('close',code=>{closed=true;signal.removeEventListener('abort',abort);if(signal.aborted)fault??=new InspectionFault('aborted');
   if(fault){reject(fault);return;}if(stderrText){reject(new InspectionFault('process'));return;}if(early){resolve('nonzero');return;}
   if(code!==0||!stdoutEnded||!stderrEnded){reject(new InspectionFault('process'));return;}resolve('complete');
  });
  if(signal.aborted)abort();
 });
}
async function sourceHash(path:string,size:number,signal:AbortSignal){
 signal.throwIfAborted();const stream=createReadStream(path,{signal}),hash=createHash('sha256');let bytes=0;
 try{for await(const data of stream){bytes+=data.length;if(bytes>size)throw new InspectionFault('source_changed');hash.update(data);}if(bytes!==size)throw new InspectionFault('source_changed');return hash.digest('hex');}
 finally{stream.destroy();await finished(stream,{cleanup:true}).catch(()=>undefined);}
}
/** Local/reversible only: source is rehashed around probing/decoding, before any provider admission. */
export async function inspectDigitalSilence(file:FileInput,source:DigitalSilenceBinding,signal:AbortSignal):Promise<DigitalSilenceResult>{
 const total=new AbortController();let timedOut=false;const timer=setTimeout(()=>{timedOut=true;total.abort();},digitalSilenceLimits.totalMs);timer.unref();const combined=AbortSignal.any([signal,total.signal]);
 try{
  const saved=binding(source);if(!file||typeof file.path!=='string'||!isAbsolute(file.path)||typeof file.id!=='string'||!privateUuid.test(file.id)||saved.key!=='candidate-files-v1/'+file.id+'/video.mp4'||file.size!==saved.size||
   !file.metadata||!Number.isFinite(file.metadata.duration)||file.metadata.duration<=0||file.metadata.duration>600||!positive(file.metadata.audioTracks)||file.metadata.sha256!==undefined&&file.metadata.sha256!==saved.sha256)throw new InspectionFault('metadata');
  const original={id:file.id,path:file.path,size:file.size,metadata:{...file.metadata}};
  const unchanged=()=>{if(file.id!==original.id||file.path!==original.path||file.size!==original.size||!file.metadata||(['duration','width','height','audioTracks','sha256'] as const).some(k=>!Object.is(file.metadata[k],original.metadata[k])))throw new InspectionFault('metadata');};
  combined.throwIfAborted();const before=await lstat(original.path,{bigint:true});if(!before.isFile()||before.size!==BigInt(saved.size))throw new InspectionFault('source');
  if(await sourceHash(original.path,saved.size,combined)!==saved.sha256)throw new InspectionFault('source_changed');unchanged();
  const output:Buffer[]=[];let outputBytes=0;
  await run('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',formats,'-i',original.path,'-count_packets','-show_entries','format=format_name,duration:stream=codec_type,channels,sample_rate','-of','json'],combined,data=>{outputBytes+=data.length;if(outputBytes>digitalSilenceLimits.probeBytes)throw new InspectionFault('probe_limit');output.push(Buffer.from(data));return true;});unchanged();
  let probe:any;try{probe=JSON.parse(Buffer.concat(output).toString('utf8'));}catch{throw new InspectionFault('metadata');}
  if(typeof probe?.format?.format_name!=='string'||!probe.format.format_name.split(',').every((format:string)=>aliases.has(format)))throw new InspectionFault('unsupported_container');
  if(!Array.isArray(probe.streams)||!probe.streams.some((s:any)=>s.codec_type==='video'))throw new InspectionFault('metadata');const tracks=probe.streams.filter((s:any)=>s.codec_type==='audio');
  if(tracks.length!==original.metadata.audioTracks||!tracks.every((s:any)=>positive(s.channels)&&typeof s.sample_rate==='string'&&/^\d+$/.test(s.sample_rate)&&positive(Number(s.sample_rate))))throw new InspectionFault('metadata');
  let result:DigitalSilenceResult;
  if(tracks.length>1)result={kind:'ineligible',reason:'multiple_audio_tracks'};
  else{
   const audio={audioTracks:1 as const,channels:tracks[0].channels as number,sampleRate:Number(tracks[0].sample_rate)},accumulator=createDigitalSilenceAccumulator(saved,audio);
   // MOV drefs are disabled by default during auto-probe (official format docs).
   // Apply the explicit MOV-only options after format identification, without forcing a demuxer.
   const mov=probe.format.format_name.split(',').includes('mov')?['-enable_drefs','0','-use_absolute_path','0']:[];
   const outcome=await run('ffmpeg',['-hide_banner','-loglevel','warning','-nostats','-nostdin','-xerror','-protocol_whitelist','file,pipe','-format_whitelist',formats,...mov,'-reinit_filter','0','-i',original.path,'-map','0:a:0','-vn','-sn','-dn','-c:a','pcm_f64le','-f','f64le','pipe:1'],combined,data=>accumulator.write(data));
   result=outcome==='nonzero'?{kind:'nonzero'}:{kind:'zero',evidence:accumulator.sealComplete()};
  }
  const after=await lstat(original.path,{bigint:true});if(!after.isFile()||after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs||after.ino!==before.ino||after.dev!==before.dev||await sourceHash(original.path,saved.size,combined)!==saved.sha256)throw new InspectionFault('source_changed');
  unchanged();combined.throwIfAborted();return result;
 }catch(error){return {kind:'unavailable',reason:signal.aborted?'aborted':timedOut?'timeout':error instanceof InspectionFault?error.reason:'process'};}
 finally{clearTimeout(timer);}
}
