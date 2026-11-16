import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,unlink,rmdir,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {generateCloudText,generateCloudVoice,prepareTextVideo,ConfirmedNoSpeech,type PreparedTextVideo} from './cloudAiProvider';
import {createHash} from 'node:crypto';
import {AI_TEXT_WINDOW_MS,AI_TEXT_MAX_DURATION_MS,AI_TEXT_MAX_WINDOWS} from './aiContracts';
import {VOICE_MODEL} from './pipelineVoiceProvider';import {textModel} from './pipelineTextProvider';import {buildWavRiff,validateWavRiff} from './pipelineVoiceWav';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const clean of cleanups.splice(0))await clean();});
const response=(raw:unknown)=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]});
const cue={startMs:500,endMs:2000,es:'Elena mide cinco centímetros.',en:'Elena measures five centimeters.'};
async function prepared(durationMs=45000):Promise<PreparedTextVideo>{const dir=await mkdtemp(join(tmpdir(),'vistavo-cloud-ai-test-')),files:string[]=[],chunks=[];for(let startMs=0;startMs<durationMs;startMs+=30000){const path=join(dir,files.length+'.mp3'),bytes=Buffer.from('ID3synthetic-audio');await writeFile(path,bytes);files.push(path);chunks.push({index:chunks.length,startMs,endMs:Math.min(startMs+30000,durationMs),path,size:bytes.length});}const cleanup=async()=>{for(const f of files)await unlink(f);await rmdir(dir);};cleanups.push(cleanup);return {durationMs,chunks,cleanup};}
it('sends one bounded inline audio call per window and encodes all four exact private text outputs',async()=>{
 const p=await prepared(),invoke=vi.fn(async()=>response({detectedLanguage:'es',hasSpeech:true,cues:[cue]}));
 const bundle=await generateCloudText('job-fixture',p,invoke,new AbortController().signal);
 expect(invoke).toHaveBeenCalledTimes(2);expect(invoke.mock.calls.map((c:any)=>c[0])).toEqual(['text-window:0000','text-window:0001']);
 for(const call of invoke.mock.calls as any[]){expect(call[1]).toBe(textModel);expect(call[2].contents[0].parts[0].inlineData.mimeType).toBe('audio/mpeg');expect(call[2].contents[0].parts[0].fileData).toBeUndefined();}
 expect(bundle.cues.map(c=>c.startMs)).toEqual([500,30500]);expect(bundle.en.srt).toContain('00:00:30,500');expect(bundle.es.txtBytes.toString()).toContain('cinco centímetros');expect(bundle.en.txtByteLength).toBe(bundle.en.txtBytes.length);expect(bundle.en.srtSha256).toMatch(/^[a-f0-9]{64}$/);
});
it.each(['language','times','silent','malformed'])('rejects invalid %s responses without retry or partial bundle',async(kind)=>{
 const p=await prepared(30000),invoke=vi.fn(async()=>kind==='malformed'?{candidates:[]} : response({detectedLanguage:kind==='language'?'en':'es',hasSpeech:kind!=='silent',cues:kind==='silent'?[]:[{...cue,endMs:kind==='times'?30001:2000}]}));
 await expect(generateCloudText('job-fixture',p,invoke,new AbortController().signal)).rejects.toThrow();expect(invoke).toHaveBeenCalledTimes(1);
});
it('does not retry a paid window after an ambiguous second invocation',async()=>{
 const p=await prepared(),invoke=vi.fn().mockResolvedValueOnce(response({detectedLanguage:'es',hasSpeech:true,cues:[cue]})).mockRejectedValueOnce(Error('lost response'));
 await expect(generateCloudText('job-fixture',p,invoke,new AbortController().signal)).rejects.toThrow();expect(invoke).toHaveBeenCalledTimes(2);
});
it('recognizes complete silence only after all windows and binds its evidence to the exact received responses',async()=>{
 const p=await prepared(60000),payloads=[response({detectedLanguage:'und',hasSpeech:false,cues:[]}),response({detectedLanguage:'es',hasSpeech:false,cues:[]})];
 const invoke=vi.fn().mockResolvedValueOnce(payloads[0]).mockResolvedValueOnce(payloads[1]);let error:unknown;
 try{await generateCloudText('job-fixture',p,invoke,new AbortController().signal);}catch(e){error=e;}
 expect(error).toBeInstanceOf(ConfirmedNoSpeech);expect(invoke).toHaveBeenCalledTimes(2);
 expect((error as ConfirmedNoSpeech).receipts).toEqual(payloads.map((payload,index)=>({callKey:'text-window:'+String(index).padStart(4,'0'),responseSha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')})));
 expect(Object.isFrozen((error as ConfirmedNoSpeech).receipts)).toBe(true);
});
it.each(['first','middle','last','all','undefined','inherited'])('rejects %s sparse or missing evidence when constructing nominal silence',kind=>{
 const rows=Array.from({length:3},(_,index)=>({callKey:'text-window:'+String(index).padStart(4,'0'),responseSha256:'a'.repeat(64)}));let proof:any[]=rows;
 if(kind==='first')delete proof[0];if(kind==='middle')delete proof[1];if(kind==='last')delete proof[2];if(kind==='all')proof=new Array(3);if(kind==='undefined')proof[1]=undefined;
 if(kind==='inherited'){const inherited=Object.create(Array.prototype);inherited[1]=proof[1];delete proof[1];Object.setPrototypeOf(proof,inherited);}
 expect(()=>new ConfirmedNoSpeech(proof)).toThrow('Invalid no-speech evidence');
});
it('does not classify a silent first window followed by speech as a silent video',async()=>{
 const p=await prepared(60000),invoke=vi.fn().mockResolvedValueOnce(response({detectedLanguage:'und',hasSpeech:false,cues:[]})).mockResolvedValueOnce(response({detectedLanguage:'es',hasSpeech:true,cues:[cue]}));
 const bundle=await generateCloudText('job-fixture',p,invoke,new AbortController().signal);expect(invoke).toHaveBeenCalledTimes(2);expect(bundle.cues).toHaveLength(1);expect(bundle.cues[0].startMs).toBe(30500);
});
it('shares the exact technical window limit with the release contract and rejects an oversized clip before any call',async()=>{
 expect(AI_TEXT_MAX_WINDOWS).toBe(Math.ceil(AI_TEXT_MAX_DURATION_MS/AI_TEXT_WINDOW_MS));
 const invoke=vi.fn(async()=>response({detectedLanguage:'und',hasSpeech:false,cues:[]}));let error:unknown;
 try{await generateCloudText('job-fixture',await prepared(AI_TEXT_MAX_DURATION_MS),invoke,new AbortController().signal);}catch(e){error=e;}
 expect(error).toBeInstanceOf(ConfirmedNoSpeech);expect((error as ConfirmedNoSpeech).receipts).toHaveLength(AI_TEXT_MAX_WINDOWS);expect(invoke).toHaveBeenCalledTimes(AI_TEXT_MAX_WINDOWS);
 invoke.mockClear();await expect(generateCloudText('job-fixture',await prepared(AI_TEXT_MAX_DURATION_MS+1),invoke,new AbortController().signal)).rejects.not.toBeInstanceOf(ConfirmedNoSpeech);expect(invoke).not.toHaveBeenCalled();
});
it.each(['malformed','inconsistent','timeout'])('never treats silence followed by %s as confirmed complete silence',async kind=>{
 const p=await prepared(60000),invoke=vi.fn().mockResolvedValueOnce(response({detectedLanguage:'und',hasSpeech:false,cues:[]}));
 if(kind==='timeout')invoke.mockRejectedValueOnce(Error('lost response'));else invoke.mockResolvedValueOnce(kind==='malformed'?{candidates:[]}:response({detectedLanguage:'es',hasSpeech:false,cues:[cue]}));
 let error:unknown;try{await generateCloudText('job-fixture',p,invoke,new AbortController().signal);}catch(e){error=e;}
 expect(error).toBeInstanceOf(Error);expect(error).not.toBeInstanceOf(ConfirmedNoSpeech);expect(invoke).toHaveBeenCalledTimes(2);
});
it('stops between paid calls after cancellation and does not return generated partial text',async()=>{
 const p=await prepared(),controller=new AbortController(),invoke=vi.fn(async()=>{controller.abort();return response({detectedLanguage:'es',hasSpeech:true,cues:[cue]});});
 await expect(generateCloudText('job-fixture',p,invoke,controller.signal)).rejects.toThrow();expect(invoke).toHaveBeenCalledTimes(1);
});
it('rejects a noncanonical prepared manifest before generation',async()=>{
 const original=await prepared(),p={...original,chunks:original.chunks.map((chunk,index)=>index===1?{...chunk,startMs:29000}:chunk)};const invoke=vi.fn(async()=>response({detectedLanguage:'es',hasSpeech:true,cues:[cue]}));
 await expect(generateCloudText('job-fixture',p,invoke,new AbortController().signal)).rejects.toThrow();expect(invoke).not.toHaveBeenCalled();
});
it.each(['Kore','Charon'] as const)('uses existing standard %s voice decoder and returns a validated canonical WAV through durable invoke',async(voiceId)=>{
 const pcm=Buffer.alloc(4800);for(let i=0;i<2400;i++)pcm.writeInt16LE(Math.round(2000*Math.sin(i/12)),i*2);
 const invoke=vi.fn(async()=>({candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'audio/wav',data:buildWavRiff(pcm).toString('base64')}}]}}]}));
 const result=await generateCloudVoice('job-fixture','Elena measures five centimeters.',voiceId,invoke,new AbortController().signal);
 expect(invoke).toHaveBeenCalledTimes(1);const call=invoke.mock.calls[0] as any[];expect(call[0]).toBe('voice-chunk:0000');expect(call[1]).toBe(VOICE_MODEL);expect(call[2].generationConfig.speechConfig.voiceConfig.voice).toBe(voiceId);expect(validateWavRiff(result.wav).durationMs).toBe(100);expect(result.stats.durationMs).toBe(100);
});
it('rejects unsupported voices before invoking and never retries malformed billed voice output',async()=>{
 const invoke=vi.fn(async()=>({candidates:[]}));await expect(generateCloudVoice('job','text','Other' as any,invoke,new AbortController().signal)).rejects.toThrow();expect(invoke).not.toHaveBeenCalled();
 await expect(generateCloudVoice('job','text','Kore',invoke,new AbortController().signal)).rejects.toThrow();expect(invoke).toHaveBeenCalledTimes(1);
});
it('extracts actual private mono MP3 from a synthetic local MP4 without any AI calls',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vistavo-prepare-smoke-')),file=join(dir,'fixture.mp4');cleanups.push(async()=>{await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(dir);});
 const encoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=128x72:r=10','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','0.4','-c:v','libx264','-c:a','aac','-y',file],{windowsHide:true,stdio:'ignore'});expect(encoded.status).toBe(0);
 const data=await prepareTextVideo({id:'fixture',path:file,size:(await stat(file)).size,name:'fixture.mp4',expiresAt:new Date(Date.now()+60000),metadata:{duration:0.4,width:128,height:72,audioTracks:1}},new AbortController().signal);
 expect(data.chunks).toHaveLength(1);expect(data.chunks[0].startMs).toBe(0);expect(data.chunks[0].endMs).toBe(400);expect(data.chunks[0].size).toBeGreaterThan(0);expect(data.chunks[0].size).toBeLessThan(1048576);await data.cleanup();await expect(stat(data.chunks[0].path)).rejects.toMatchObject({code:'ENOENT'});
},20000);
