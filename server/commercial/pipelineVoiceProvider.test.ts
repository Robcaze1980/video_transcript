import {buildWavRiff} from './pipelineVoiceWav';
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  GeminiVoiceProvider,
  narrationChunks,
  isVoiceId,
  voiceGenderFor,
  VoiceOutcomeUnknown,
  VoiceProviderError,
  VOICE_MODEL,
  VOICE_SAMPLE_MIME,
} from './pipelineVoiceProvider';

function l16Base64(values: readonly number[]): string {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeInt16LE(value, index * 2));
  return buffer.toString('base64');
}

function payload(data: string, mimeType: string = VOICE_SAMPLE_MIME): unknown {
  return { candidates: [{ finishReason:'STOP', content: { parts: [{ inlineData: { mimeType, data } }] } }] };
}

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  return vi.fn(handler) as unknown as typeof fetch;
}

describe('Gemini narration provider', () => {
  it('allowlists exactly Kore and Charon with fixed genders', () => {
    expect(isVoiceId('Kore')).toBe(true);
    expect(isVoiceId('Charon')).toBe(true);
    expect(isVoiceId('Puck')).toBe(false);
    expect(isVoiceId('kore')).toBe(false);
    expect(voiceGenderFor('Kore')).toBe('female');
    expect(voiceGenderFor('Charon')).toBe('male');
  });

  it('sends audio modality, the selected voice and a fixed narration style', async () => {
    const fetchImpl = stubFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
      expect(body.generationConfig.speechConfig.voiceConfig.voice).toBe('Charon');
      expect(body.contents[0].parts[0].speech_metadata.style).toMatch(/English narration/);
      expect(body.contents[0].parts[0].text).toBe('Saved English text');
      return new Response(JSON.stringify(payload(l16Base64([0, 10, -10, 20]))), { status: 200 });
    });

    const provider = new GeminiVoiceProvider({ apiKey: 'test-key', fetchImpl });
    const result = await provider.synthesize({
      jobId: 'job',
      text: 'Saved English text',
      voiceId: 'Charon',
      signal: new AbortController().signal,
    });

    expect(result.l16.readInt16LE(2)).toBe(10);
    expect(result.l16.readInt16LE(6)).toBe(20);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain(VOICE_MODEL);
  });

  it('rejects inline audio that uses an unexpected MIME type', async () => {
    const fetchImpl = stubFetch(async () =>
      new Response(JSON.stringify(payload(l16Base64([1, 2]), 'audio/mpeg')), { status: 200 }));
    const provider = new GeminiVoiceProvider({ apiKey: 'test-key', fetchImpl });
    await expect(
      provider.synthesize({ jobId: 'job', text: 'text', voiceId: 'Kore', signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(VoiceProviderError);
  });

  it('treats rate limits and server errors as unknown outcomes', async () => {
    for (const status of [429, 500, 503]) {
      const fetchImpl = stubFetch(async () => new Response('busy', { status }));
      const provider = new GeminiVoiceProvider({ apiKey: 'test-key', fetchImpl });
      await expect(
        provider.synthesize({ jobId: 'job', text: 'text', voiceId: 'Kore', signal: new AbortController().signal }),
      ).rejects.toBeInstanceOf(VoiceOutcomeUnknown);
    }
  });

  it('treats hostile 4xx rejections as definite failures', async () => {
    const fetchImpl = stubFetch(async () => new Response('denied', { status: 403 }));
    const provider = new GeminiVoiceProvider({ apiKey: 'test-key', fetchImpl });
    const error = await provider
      .synthesize({ jobId: 'job', text: 'text', voiceId: 'Kore', signal: new AbortController().signal })
      .catch(value => value);
    expect(error).toBeInstanceOf(VoiceProviderError);
    expect(error).not.toBeInstanceOf(VoiceOutcomeUnknown);
  });

  it('treats malformed successes and empty candidate lists as unknown outcomes', async () => {
    const malformed = stubFetch(async () => new Response('not json', { status: 200 }));
    await expect(
      new GeminiVoiceProvider({ apiKey: 'test-key', fetchImpl: malformed }).synthesize({
        jobId: 'job', text: 'text', voiceId: 'Kore', signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(VoiceOutcomeUnknown);

    const empty = stubFetch(async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    await expect(
      new GeminiVoiceProvider({ apiKey: 'test-key', fetchImpl: empty }).synthesize({
        jobId: 'job', text: 'text', voiceId: 'Kore', signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(VoiceOutcomeUnknown);
  });

  it('accepts a validated provider WAV and rejects truncated or non-PCM headers',async()=>{
    const wav=buildWavRiff(Buffer.alloc(4800,1));
    const provider=(b:Buffer)=>new GeminiVoiceProvider({apiKey:'test',fetchImpl:stubFetch(async()=>new Response(JSON.stringify(payload(b.toString('base64'),'audio/wav'))))});
    expect((await provider(wav).synthesize({jobId:'job',text:'text',voiceId:'Kore',signal:new AbortController().signal})).l16.length).toBe(4800);
    const bad=Buffer.from(wav);bad.writeUInt16LE(2,22);
    await expect(provider(bad).synthesize({jobId:'job',text:'text',voiceId:'Kore',signal:new AbortController().signal})).rejects.toThrow();
  });
  it('rejects non-STOP results, oversized responses, and malformed base64 without retry',async()=>{
    const result:any=payload(l16Base64([1,2]));result.candidates[0].finishReason='MAX_TOKENS';
    for(const body of [result,payload('!bad')]) {
      const fetchImpl=stubFetch(async()=>new Response(JSON.stringify(body)));
      await expect(new GeminiVoiceProvider({apiKey:'test',fetchImpl}).synthesize({jobId:'job',text:'text',voiceId:'Kore',signal:new AbortController().signal})).rejects.toBeInstanceOf(VoiceOutcomeUnknown);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
    await expect(new GeminiVoiceProvider({apiKey:'test',maxResponseBytes:4,fetchImpl:stubFetch(async()=>new Response('too large'))}).synthesize({jobId:'job',text:'text',voiceId:'Kore',signal:new AbortController().signal})).rejects.toBeInstanceOf(VoiceOutcomeUnknown);
  });
  it('preserves all six repeated paragraphs in ordered requests and concatenated PCM',async()=>{
    const paragraph='Elena Robles checks the waterproof membrane next to the downspout. The joint is raised five centimeters and must be sealed before the rain. Keep the scaffolding six feet away and check the roof screws. This is a demonstration with made-up data. Always check names and materials before sharing the video.';
    const text=Array(6).fill(paragraph).join(' '),chunks=narrationChunks(text),seen:string[]=[];
    expect(chunks.join(' ')).toBe(text);expect(chunks.every(c=>c.length<=320)).toBe(true);
    const provider=new GeminiVoiceProvider({apiKey:'test',fetchImpl:stubFetch(async(_url,init)=>{
      seen.push(JSON.parse(String(init.body)).contents[0].parts[0].text);
      return new Response(JSON.stringify(payload(Buffer.alloc(4800,1).toString('base64'))));
    })});
    const result=await provider.synthesize({jobId:'job',text,voiceId:'Kore',signal:new AbortController().signal});
    expect(seen).toEqual(chunks);expect(result.l16.length).toBe(chunks.length*4800+(chunks.length-1)*3840);
  });
  it('stops on an uncertain later chunk without returning partial audio or retrying',async()=>{
    const fetchImpl=stubFetch(async()=>new Response(JSON.stringify(payload(Buffer.alloc(4800,1).toString('base64'))))) as any;
    fetchImpl.mockImplementationOnce(async()=>new Response(JSON.stringify(payload(Buffer.alloc(4800,1).toString('base64')))))
      .mockImplementationOnce(async()=>{throw new Error('network');});
    await expect(new GeminiVoiceProvider({apiKey:'test',fetchImpl}).synthesize({jobId:'job',text:Array(20).fill('A moderately long sentence with a concrete measurement of five centimeters.').join(' '),voiceId:'Kore',signal:new AbortController().signal})).rejects.toBeInstanceOf(VoiceOutcomeUnknown);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('rejects long words and over-budget text before any billable call',async()=>{
    expect(()=>narrationChunks('x'.repeat(321))).toThrow();
    const fetchImpl=stubFetch(async()=>new Response('{}'));
    await expect(new GeminiVoiceProvider({apiKey:'test',fetchImpl}).synthesize({jobId:'job',text:Array(901).fill('word').join(' '),voiceId:'Kore',signal:new AbortController().signal})).rejects.toBeInstanceOf(VoiceProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('isolates usage observers and classifies invalid billed PCM as unknown',async()=>{
    const fetchImpl=stubFetch(async()=>new Response(JSON.stringify(payload(Buffer.alloc(4800,1).toString('base64')))));
    await expect(new GeminiVoiceProvider({apiKey:'test',fetchImpl,onUsage:async()=>{throw new Error('observer');}}).synthesize({jobId:'job',text:'text',voiceId:'Kore',signal:new AbortController().signal})).resolves.toHaveProperty('l16');
    const bad=stubFetch(async()=>new Response(JSON.stringify(payload(Buffer.alloc(3).toString('base64')))));
    await expect(new GeminiVoiceProvider({apiKey:'test',fetchImpl:bad}).synthesize({jobId:'job',text:'text',voiceId:'Kore',signal:new AbortController().signal})).rejects.toBeInstanceOf(VoiceOutcomeUnknown);
  });
  it('refuses voices outside the allowlist before any network call', async () => {
    const fetchImpl = stubFetch(async () => new Response('', { status: 200 }));
    const provider = new GeminiVoiceProvider({ apiKey: 'test-key', fetchImpl });
    await expect(
      provider.synthesize({ jobId: 'job', text: 'text', voiceId: 'Puck' as never, signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(VoiceProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
