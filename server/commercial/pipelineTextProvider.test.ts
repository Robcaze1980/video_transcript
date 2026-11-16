import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { createGeminiTextProvider,TextOutcomeUnknown } from './pipelineTextProvider';
vi.mock('./geminiFileUpload',()=>({withGeminiVideoFile:async(_key:unknown,_input:unknown,consume:any,options:any)=>consume({uri:'https://generativelanguage.googleapis.com/v1beta/files/fixture'},options.signal)}));
const file:any={metadata:{duration:60,audioTracks:1}};
const raw=(language='es',speech=true)=>({detectedLanguage:language,hasSpeech:speech,cues:speech?[{startMs:100,endMs:1000,es:'Cinco centímetros.',en:'Five centimeters.'}]:[]});
const response=(result:any)=>new Response(JSON.stringify({responseId:'fixture',usageMetadata:{promptTokenCount:1},candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result)}]}}]}));
afterEach(()=>vi.unstubAllGlobals());
it('clips each 30-second window once, offsets paired times and observes each call',async()=>{
 const fetcher=vi.fn(async()=>response(raw()));vi.stubGlobal('fetch',fetcher);const events:any[]=[];
 const out:any=await createGeminiTextProvider('fixture-key',e=>events.push(e)).generate(file,new AbortController().signal,'job');
 expect(fetcher).toHaveBeenCalledTimes(2);expect(out.cues.map((c:any)=>c.startMs)).toEqual([100,30100]);expect(events).toHaveLength(2);expect(events[1].elapsedSinceStartMs).toBeGreaterThan(events[1].windowMilliseconds);expect(events[0].windowMilliseconds).toBeGreaterThanOrEqual(0);
 const requests=fetcher.mock.calls.map(c=>JSON.parse((c as any)[1].body));
 expect(requests[0].contents[0].parts[0].videoMetadata).toEqual({startOffset:'0s',endOffset:'30s'});
 expect(requests[1].contents[0].parts[0].videoMetadata).toEqual({startOffset:'30s',endOffset:'60s'});
});
it('does not publish partial windows or retry unknown generation',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response(raw())).mockRejectedValueOnce(new Error('network'));
 vi.stubGlobal('fetch',fetcher);await expect(createGeminiTextProvider('fixture').generate(file,new AbortController().signal)).rejects.toBeInstanceOf(TextOutcomeUnknown);
 expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(['wrong-language','out-of-window','silent'])('handles %s explicitly',async kind=>{
 const result=raw(kind==='wrong-language'?'en':'es',kind!=='silent');if(kind==='out-of-window')result.cues[0].endMs=30001;
 const fetcher=vi.fn(async()=>response(result));vi.stubGlobal('fetch',fetcher);
 const task=createGeminiTextProvider('fixture').generate(file,new AbortController().signal);
 if(kind==='silent')expect(await task).toMatchObject({hasSpeech:false,cues:[]});else await expect(task).rejects.toThrow();
});
it('rejects a voiced empty window instead of publishing the other windows',async()=>{
 const empty={detectedLanguage:'es',hasSpeech:true,cues:[]};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response(raw())).mockResolvedValueOnce(response(empty)));
 await expect(createGeminiTextProvider('fixture').generate(file,new AbortController().signal)).rejects.toThrow();
});
it('rejects out-of-range duration before remote calls',async()=>{
 const fetcher=vi.fn(async()=>response(raw()));vi.stubGlobal('fetch',fetcher);
 await expect(createGeminiTextProvider('fixture').generate({...file,metadata:{duration:601,audioTracks:1}},new AbortController().signal)).rejects.toThrow();
 expect(fetcher).not.toHaveBeenCalled();
});

it.each([undefined,NaN,0,1.5])('rejects invalid audio count %s before calls',async audioTracks=>{
 const fetcher=vi.fn(async()=>response(raw()));vi.stubGlobal('fetch',fetcher);
 await expect(createGeminiTextProvider('fixture').generate({...file,metadata:{duration:60,audioTracks}},new AbortController().signal)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
});
