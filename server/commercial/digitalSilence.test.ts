import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {FileInput} from './jobs';
import {privateBucket} from './privateObjectPlan';
import {ConfirmedDigitalSilence,createDigitalSilenceAccumulator,digitalSilenceProof,digitalSilenceProofHash,validateDigitalSilenceProof,inspectDigitalSilence,digitalSilenceLimits,type DigitalSilenceBinding} from './digitalSilence';

const execute=promisify(execFile),sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const inputId='11111111-1111-4111-8111-111111111111',binding:DigitalSilenceBinding={key:'candidate-files-v1/'+inputId+'/video.mp4',generation:'9007199254740993',size:100,sha256:'a'.repeat(64)};
const audio={audioTracks:1 as const,channels:2,sampleRate:48000},pcm=(...samples:number[])=>{const bytes=Buffer.alloc(samples.length*8);samples.forEach((value,index)=>bytes.writeDoubleLE(value,index*8));return bytes;};
let directory:string;
type Fixture={file:FileInput;binding:DigitalSilenceBinding};
const fixtures:Record<string,Fixture>={};
async function identify(path:string):Promise<Fixture>{
 const bytes=await readFile(path),raw=JSON.parse((await execute('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,width,height,duration','-of','json',path],{windowsHide:true,maxBuffer:65536})).stdout),video=raw.streams.find((s:any)=>s.codec_type==='video'),duration=Math.max(...[raw.format.duration,...raw.streams.map((s:any)=>s.duration)].map(Number).filter(Number.isFinite)),id=randomUUID();
 return {file:{id,path,size:bytes.length,name:basename(path),expiresAt:new Date(Date.now()+3600000),metadata:{duration,width:video.width,height:video.height,audioTracks:raw.streams.filter((s:any)=>s.codec_type==='audio').length}},binding:{key:'candidate-files-v1/'+id+'/video.mp4',generation:'9007199254740993',size:bytes.length,sha256:sha(bytes)}};
}
async function encode(args:string[],path:string){await execute('ffmpeg',['-v','error','-nostdin','-n',...args,path],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});return identify(path);}
async function floating(name:string,samples:Buffer,channels:number,rate:number,duration:number){const raw=join(directory,name+'.raw');await writeFile(raw,samples);return encode(['-f','lavfi','-i',`color=c=blue:s=64x64:r=10:d=${duration}`,'-f','f64le','-ar',String(rate),'-ac',String(channels),'-i',raw,'-map','0:v','-map','1:a','-c:v','mpeg4','-c:a','copy','-shortest','-f','mov'],join(directory,name+'.mov'));}
beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'vistavo-digital-tests-'));
 const zeroArgs=['-f','lavfi','-i','color=c=blue:s=64x64:r=10:d=2','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','2','-map','0:v','-map','1:a','-c:v','mpeg4','-c:a','aac'];
 fixtures.zero=await encode(zeroArgs,join(directory,'zero.mp4'));
 fixtures.matroska=await encode([...zeroArgs,'-f','matroska'],join(directory,'zero.mkv'));
 const quiet=Buffer.alloc(1600*8);quiet.writeDoubleLE(1e-12,0);fixtures.quiet=await floating('quiet',quiet,1,16000,0.1);
 const tiny=Buffer.alloc(1600*8);tiny.writeDoubleLE(Number.MIN_VALUE,8*1599);fixtures.subnormal=await floating('subnormal',tiny,1,16000,0.1);
 const anti=Buffer.alloc(3200*8);for(let n=0;n<1600;n++){anti.writeDoubleLE(0.01,n*16);anti.writeDoubleLE(-0.01,n*16+8);}fixtures.antiphase=await floating('antiphase',anti,2,16000,0.1);
 const tail=Buffer.alloc(31000*8);tail.writeDoubleLE(0.01,tail.length-8);fixtures.tail=await floating('tail',tail,1,1000,31);
 fixtures.multi=await encode(['-f','lavfi','-i','color=c=blue:s=64x64:r=10:d=0.2','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','0.2','-map','0:v','-map','1:a','-map','2:a','-c:v','mpeg4','-c:a','aac'],join(directory,'multi.mp4'));
 const part1=join(directory,'part1.ts'),part2=join(directory,'part2.ts'),part3=join(directory,'part3.ts');
 const tsVideo=['-f','lavfi','-i','color=c=blue:s=64x64:r=25:d=0.2'];
 await execute('ffmpeg',['-v','error','-nostdin','-n',...tsVideo,'-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','0.2','-map','0:v','-map','1:a','-c:v','mpeg2video','-c:a','aac','-f','mpegts',part1],{windowsHide:true,timeout:30000});
 await execute('ffmpeg',['-v','error','-nostdin','-n',...tsVideo,'-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','0.2','-map','0:v','-map','1:a','-ac','2','-c:v','mpeg2video','-c:a','aac','-f','mpegts',part2],{windowsHide:true,timeout:30000});
 await execute('ffmpeg',['-v','error','-nostdin','-n',...tsVideo,'-f','lavfi','-i','anullsrc=r=48000:cl=mono','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','0.2','-map','0:v','-map','1:a','-map','2:a','-c:v','mpeg2video','-c:a','aac','-f','mpegts',part3],{windowsHide:true,timeout:30000});
 const changedPath=join(directory,'changed-parameters.ts'),latePath=join(directory,'late-track.ts');await writeFile(changedPath,Buffer.concat([await readFile(part1),await readFile(part2)]));await writeFile(latePath,Buffer.concat([await readFile(part1),await readFile(part3)]));fixtures.changed=await identify(changedPath);fixtures.lateTrack=await identify(latePath);
},60000);
afterAll(async()=>{if(directory){expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));expect(basename(directory)).toMatch(/^vistavo-digital-tests-/);await rm(directory,{recursive:true,force:true});}});
afterEach(()=>{vi.useRealTimers();vi.doUnmock('node:child_process');vi.resetModules();});
describe('nominal complete native digital silence',()=>{
 it('seals exactly finite signed-zero samples across every split boundary without losing frames',()=>{
  const bytes=pcm(0,-0,0,-0,0,0);
  for(let split=1;split<16;split++){const accumulator=createDigitalSilenceAccumulator(binding,audio);for(let at=0;at<bytes.length;at+=split)expect(accumulator.write(bytes.subarray(at,at+split))).toBe(true);const evidence=accumulator.sealComplete(),proof=digitalSilenceProof(evidence);expect(proof.frameCount).toBe(3);expect(proof.sampleCount).toBe(6);expect(proof.byteCount).toBe(48);expect(proof.pcmSha256).toBe(sha(bytes));expect(Object.isFrozen(proof)).toBe(true);expect(Object.isFrozen(evidence)).toBe(true);expect(accumulator.sealComplete()).toBe(evidence);expect(()=>accumulator.write(pcm(0,0))).toThrow();}
 });
 it('a quiet, subnormal or opposite-phase nonzero value excludes zero without averaging channels',()=>{
  for(const bytes of [pcm(1e-12,0),pcm(Number.MIN_VALUE,0),pcm(0.01,-0.01)]){const accumulator=createDigitalSilenceAccumulator(binding,audio);expect(accumulator.write(bytes)).toBe(false);expect(()=>accumulator.sealComplete()).toThrow();}
 });
 it('never seals empty, partial, nonfinite or channel-incomplete data, including after catching an earlier error',()=>{
  expect(()=>createDigitalSilenceAccumulator(binding,audio).sealComplete()).toThrow('empty_audio');
  for(const bytes of [Buffer.alloc(7),pcm(0)]){const a=createDigitalSilenceAccumulator(binding,audio);a.write(bytes);expect(()=>a.sealComplete()).toThrow('invalid_pcm');}
  for(const value of [NaN,Infinity,-Infinity]){const a=createDigitalSilenceAccumulator(binding,audio);expect(()=>a.write(pcm(value,0))).toThrow('invalid_pcm');expect(()=>a.sealComplete()).toThrow('invalid_pcm');}
 });
 it('accepts the exact512MiB streaming byte boundary but poisons the stream upon one extra byte',async()=>{
  const a=createDigitalSilenceAccumulator(binding,{...audio,channels:8,sampleRate:192000}),chunk=Buffer.alloc(1024*1024);
  for(let n=0;n<digitalSilenceLimits.pcmBytes/chunk.length;n++){expect(a.write(chunk)).toBe(true);await new Promise<void>(r=>setImmediate(r));}
  expect(()=>a.write(Buffer.alloc(1))).toThrow('pcm_limit');expect(()=>a.sealComplete()).toThrow('pcm_limit');
 },30000);
 it('separates strict persisted schema validation from the unforgeable in-process decoder brand',()=>{
  const a=createDigitalSilenceAccumulator(binding,audio);a.write(pcm(0,0));const evidence=a.sealComplete(),proof=digitalSilenceProof(evidence),plain=JSON.parse(JSON.stringify(proof));
  expect(validateDigitalSilenceProof(plain)).toEqual(proof);expect(digitalSilenceProofHash(plain)).toBe(digitalSilenceProofHash(Object.fromEntries(Object.entries(plain).reverse())));
  expect(()=>digitalSilenceProof(plain)).toThrow();expect(()=>digitalSilenceProof(Object.create(ConfirmedDigitalSilence.prototype))).toThrow();expect(()=>new ConfirmedDigitalSilence(Symbol('forged'),plain)).toThrow();
  for(const change of [{extra:true},{sourceBucket:'other'},{sourceKey:'candidate-files-v1/other/video.mp4'},{sourceGeneration:'0'},{sourceSize:0},{sourceSha256:'x'.repeat(64)},{audioTracks:2},{channels:0},{sampleRate:Infinity},{frameCount:2},{sampleCount:3},{byteCount:0},{pcmSha256:'x'.repeat(64)},{format:'s16le'},{decodeComplete:false}])expect(()=>validateDigitalSilenceProof({...plain,...change})).toThrow();
 });
 it('decodes actual mono/stereo-safe AAC silence and Matroska without forcing a MOV demuxer',async()=>{
  for(const fixture of [fixtures.zero,fixtures.matroska]){const result=await inspectDigitalSilence(fixture.file,fixture.binding,new AbortController().signal);expect(result.kind).toBe('zero');if(result.kind==='zero'){const proof=digitalSilenceProof(result.evidence);expect(proof.channels).toBe(2);expect(proof.sampleRate).toBe(48000);expect(proof.frameCount).toBeGreaterThan(0);expect(proof.sourceSha256).toBe(fixture.binding.sha256);expect(proof.sourceBucket).toBe(privateBucket);}}
 });
 it('preserves actual f64 quiet/subnormal, opposite-phase and final-after30s impulses',async()=>{
  for(const fixture of [fixtures.quiet,fixtures.subnormal,fixtures.antiphase,fixtures.tail])expect(await inspectDigitalSilence(fixture.file,fixture.binding,new AbortController().signal)).toEqual({kind:'nonzero'});
 });
 it('a coherent second speaking track safely falls through, but mismatched track metadata does not',async()=>{
  expect(await inspectDigitalSilence(fixtures.multi.file,fixtures.multi.binding,new AbortController().signal)).toEqual({kind:'ineligible',reason:'multiple_audio_tracks'});
  const wrong={...fixtures.multi.file,metadata:{...fixtures.multi.file.metadata,audioTracks:1}};expect(await inspectDigitalSilence(wrong,fixtures.multi.binding,new AbortController().signal)).toEqual({kind:'unavailable',reason:'metadata'});
 });
 it('never certifies a real transport stream with late changed native parameters or a newly introduced audio track',async()=>{
  for(const fixture of [fixtures.changed,fixtures.lateTrack]){const result=await inspectDigitalSilence(fixture.file,fixture.binding,new AbortController().signal);expect(['unavailable','ineligible']).toContain(result.kind);}
 });
 it('rejects bad source binding, changed bytes and pre-existing abort without any certificate',async()=>{
  expect(await inspectDigitalSilence(fixtures.zero.file,{...fixtures.zero.binding,sha256:'0'.repeat(64)},new AbortController().signal)).toEqual({kind:'unavailable',reason:'source_changed'});
  const controller=new AbortController();controller.abort();expect(await inspectDigitalSilence(fixtures.zero.file,fixtures.zero.binding,controller.signal)).toEqual({kind:'unavailable',reason:'aborted'});
  const path=join(directory,'invalid.mp4');await writeFile(path,'not media');const bad={...fixtures.zero.file,path,size:9};expect((await inspectDigitalSilence(bad,{...fixtures.zero.binding,size:9,sha256:sha('not media')},new AbortController().signal)).kind).toBe('unavailable');
 });
});

type FakeChild=EventEmitter&{stdout:PassThrough;stderr:PassThrough;kill:ReturnType<typeof vi.fn>;finish:(code?:number)=>void};
function fakeChild():FakeChild{
 const child=new EventEmitter() as FakeChild;child.stdout=new PassThrough();child.stderr=new PassThrough();let closed=false;
 const close=(code:number|null)=>{if(closed)return;closed=true;child.emit('close',code);};child.finish=(code=0)=>{child.stdout.end();child.stderr.end();setImmediate(()=>close(code));};child.kill=vi.fn(()=>{child.stdout.end();child.stderr.end();setImmediate(()=>close(null));return true;});return child;
}
const probePayload=()=>Buffer.from(JSON.stringify({format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',duration:'2'},streams:[{codec_type:'video'},{codec_type:'audio',channels:2,sample_rate:'48000'}]}));
async function controlled(actions:((child:FakeChild)=>void)[]){
 vi.resetModules();const calls:{tool:string;args:string[];child:FakeChild}[]=[],spawn=vi.fn((tool:string,args:string[])=>{const child=fakeChild();calls.push({tool,args,child});queueMicrotask(()=>actions[calls.length-1]?.(child));return child;});
 vi.doMock('node:child_process',async()=>({...await vi.importActual<object>('node:child_process'),spawn}));const module=await import('./digitalSilence');return {module,calls};
}
describe('decoder process completion, bounds and cancellation',()=>{
 it('requires clean full close and rejects errors after all-zero output rather than certifying a prefix',async()=>{
  const c=await controlled([child=>{child.stdout.write(probePayload());child.finish();},child=>{child.stdout.write(pcm(0,0));child.stderr.write('SYNTHETIC_ERROR_MUST_NEVER_ESCAPE');child.finish(1);}]);
  expect(await c.module.inspectDigitalSilence(fixtures.zero.file,fixtures.zero.binding,new AbortController().signal)).toEqual({kind:'unavailable',reason:'process'});
  expect(c.calls[1].args).not.toContain('-ac');expect(c.calls[1].args).not.toContain('-ar');expect(c.calls[1].args).not.toContain('-ss');expect(c.calls[1].args).not.toContain('-t');expect(c.calls[1].args).toContain('pcm_f64le');expect(c.calls[1].args).toContain('-enable_drefs');expect(c.calls[1].args).toContain('file,pipe');expect(c.calls[0].args).not.toContain('-f');
  expect(c.calls[0].args).toContain('-count_packets');expect(c.calls[1].args).toContain('-reinit_filter');
 });
 it('pipe errors and native audio-property errors after a zero prefix cannot escape as unhandled errors or a certificate',async()=>{
  for(const mode of ['stdout','stderr','parameters'] as const){const c=await controlled([child=>{child.stdout.write(probePayload());child.finish();},child=>{child.stdout.write(pcm(0,0));if(mode==='parameters')child.stderr.write('Changing audio frame properties on the fly is not supported.');else child[mode].emit('error',new Error('SYNTHETIC_PIPE_ERROR_NEVER_EXPOSE'));child.finish();}]);
   const result=await c.module.inspectDigitalSilence(fixtures.zero.file,fixtures.zero.binding,new AbortController().signal);expect(result).toEqual({kind:'unavailable',reason:'process'});expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PIPE');}
 });
 it('rejects close0 before stdout EOF and rejects partial frames even after a clean close',async()=>{
  for(const malformed of ['premature','partial'] as const){const c=await controlled([child=>{child.stdout.write(probePayload());child.finish();},child=>{if(malformed==='premature'){child.emit('close',0);child.stdout.end();child.stderr.end();}else{child.stdout.write(Buffer.alloc(9));child.finish();}}]);
   expect((await c.module.inspectDigitalSilence(fixtures.zero.file,fixtures.zero.binding,new AbortController().signal)).kind).toBe('unavailable');}
 });
 it('enforces exact probe/stderr boundaries and discards all over-budget output',async()=>{
  for(const extra of [0,1]){const bytes=Buffer.concat([probePayload(),Buffer.alloc(digitalSilenceLimits.probeBytes-probePayload().length+extra,32)]),c=await controlled([child=>{child.stdout.write(bytes);child.finish();},child=>{child.stdout.write(pcm(0,0));child.stderr.write(Buffer.alloc(digitalSilenceLimits.stderrBytes,32));child.finish();}]);
   const result=await c.module.inspectDigitalSilence(fixtures.zero.file,fixtures.zero.binding,new AbortController().signal);expect(result.kind).toBe(extra?'unavailable':'zero');if(result.kind==='unavailable')expect(result.reason).toBe('probe_limit');}
  const c=await controlled([child=>{child.stdout.write(probePayload());child.finish();},child=>{child.stdout.write(pcm(0,0));child.stderr.write(Buffer.alloc(digitalSilenceLimits.stderrBytes+1,32));child.finish();}]);expect(await c.module.inspectDigitalSilence(fixtures.zero.file,fixtures.zero.binding,new AbortController().signal)).toEqual({kind:'unavailable',reason:'stderr_limit'});
 });
 it('uses one joint60s budget across probing and decoding, kills and drains the child before returning',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const c=await controlled([()=>{},()=>{}]),result=c.module.inspectDigitalSilence(fixtures.zero.file,fixtures.zero.binding,new AbortController().signal);
  while(c.calls.length<1)await new Promise<void>(r=>setImmediate(r));vi.advanceTimersByTime(50000);c.calls[0].child.stdout.write(probePayload());c.calls[0].child.finish();
  while(c.calls.length<2)await new Promise<void>(r=>setImmediate(r));c.calls[1].child.stdout.write(pcm(0,0));vi.advanceTimersByTime(10001);
  expect(await result).toEqual({kind:'unavailable',reason:'timeout'});expect(c.calls[1].child.kill).toHaveBeenCalledTimes(1);
 });
 it('honors user cancellation during decode and never seals the received zero prefix',async()=>{
  const controller=new AbortController(),c=await controlled([child=>{child.stdout.write(probePayload());child.finish();},child=>{child.stdout.write(pcm(0,0));controller.abort();}]);
  expect(await c.module.inspectDigitalSilence(fixtures.zero.file,fixtures.zero.binding,controller.signal)).toEqual({kind:'unavailable',reason:'aborted'});expect(c.calls[1].child.kill).toHaveBeenCalledTimes(1);
 });
 it('a source changed during the decode cannot mint a usable certificate',async()=>{
  const bytes=await readFile(fixtures.zero.file.path),path=join(directory,'changed-during.mp4');await writeFile(path,bytes);const file={...fixtures.zero.file,path};
  const c=await controlled([child=>{child.stdout.write(probePayload());child.finish();},child=>{void writeFile(path,Buffer.from(bytes).fill(1,0,1)).then(()=>{child.stdout.write(pcm(0,0));child.finish();});}]);
  expect(await c.module.inspectDigitalSilence(file,fixtures.zero.binding,new AbortController().signal)).toEqual({kind:'unavailable',reason:'source_changed'});
 });
 it('a changed FileInput metadata snapshot during decoding is unavailable even if PCM is zero',async()=>{
  const file={...fixtures.zero.file,metadata:{...fixtures.zero.file.metadata}},c=await controlled([child=>{child.stdout.write(probePayload());child.finish();},child=>{file.metadata.audioTracks=2;child.stdout.write(pcm(0,0));child.finish();}]);
  expect(await c.module.inspectDigitalSilence(file,fixtures.zero.binding,new AbortController().signal)).toEqual({kind:'unavailable',reason:'metadata'});
 });
});
