import { Buffer } from 'node:buffer';
import {extractProviderWav,validateL16} from './pipelineVoiceWav';

/** Server-side fixed model for English narration. */
export const VOICE_MODEL = 'gemini-3.8-flash-tts';
/** Exact inline payload contract returned by the provider. */
export const VOICE_SAMPLE_MIME = 'audio/L16;rate=24000';
/** Fixed narration style. User content never reaches this field. */
export const VOICE_NARRATION_STYLE = 'English narration in a clear, neutral standard voice. Read all the supplied text faithfully, including names, numbers and units. Preserve Spanish pronunciation of Spanish personal names. Do not add commentary.';

/** Only these two standard English voices are accepted, with their fixed genders. */
export const VOICE_ALLOWLIST = Object.freeze({ Kore: 'female', Charon: 'male' } as const);
export type VoiceId = keyof typeof VOICE_ALLOWLIST;
export type VoiceGender = (typeof VOICE_ALLOWLIST)[VoiceId];

export function isVoiceId(value: unknown): value is VoiceId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VOICE_ALLOWLIST, value);
}

export function voiceGenderFor(voiceId: VoiceId): VoiceGender {
  return VOICE_ALLOWLIST[voiceId];
}

export class VoiceProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'VoiceProviderError';
  }
}

/** Raised when the provider may already have produced or billed audio, so the attempt must never retry blindly. */
export class VoiceOutcomeUnknown extends VoiceProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceOutcomeUnknown';
  }
}

export interface VoiceSynthesisRequest {
  readonly jobId: string;
  readonly text: string;
  readonly voiceId: VoiceId;
  readonly signal: AbortSignal;
}

export interface VoiceSynthesisResult {
  readonly l16: Buffer;
}

export interface VoiceProvider {
  synthesize(request: VoiceSynthesisRequest): Promise<VoiceSynthesisResult>;
}

export interface GeminiVoiceProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly onUsage?: (event: {jobId:string;model:string;voiceId:VoiceId;chunkIndex:number;chunkCount:number;responseId?:string;usageMetadata?:unknown}) => void | Promise<void>;
}

/** Small ordered requests prevent the model from collapsing repeated paragraphs in long text. */
export function narrationChunks(text:string):string[] {
  const sentences=text.trim().split(/(?<=[.!?])\s+/), chunks:string[]=[];let current='';
  for(const sentence of sentences) {
    const units=sentence.length<=320?[sentence]:sentence.split(/\s+/);
    for(const unit of units) {
      if(unit.length>320) throw new VoiceProviderError('Narration contains an oversized word.');
      if(current && current.length+unit.length+1>320) {chunks.push(current);current='';}
      current+=(current?' ':'')+unit;
    }
  }
  if(current) chunks.push(current);
  return chunks;
}

function combineSignals(signals: readonly AbortSignal[]): AbortSignal {
  return AbortSignal.any([...signals]); // Node 24 is the supported runtime.
}

export function estimatedNarrationSeconds(text:string):number {
  return text.trim()?text.trim().split(/\s+/).length*60/90:0;
}

function decodeBase64(value: string): Buffer {
  const compact = value.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new VoiceOutcomeUnknown('Narration audio is not valid base64.');
  }
  return Buffer.from(compact, 'base64');
}

/** Reads the first inlineData part and rejects any other MIME contract. */
function extractL16(payload: unknown): Buffer {
  const candidates = (payload as { candidates?: unknown[] } | null)?.candidates;
  const content = (Array.isArray(candidates) ? candidates[0] : undefined) as { content?: { parts?: unknown[] } } | undefined;
  if (candidates?.length !== 1 || (content as {finishReason?:string})?.finishReason !== 'STOP') {
    throw new VoiceOutcomeUnknown('Narration did not finish normally.');
  }
  const parts = content?.content?.parts;
  if (!Array.isArray(parts)) throw new VoiceOutcomeUnknown('Narration provider returned no candidates.');
  if (parts.length !== 1) throw new VoiceOutcomeUnknown('Unexpected narration parts.');
  for (const part of parts) {
    const inline = (part as { inlineData?: { mimeType?: unknown; data?: unknown } } | null)?.inlineData;
    if (!inline) continue;
    const mime = typeof inline.mimeType === 'string' ? inline.mimeType : '';
    if (mime !== VOICE_SAMPLE_MIME && mime !== 'audio/wav') throw new VoiceOutcomeUnknown('Unexpected narration encoding.');
    if (typeof inline.data !== 'string' || inline.data.length === 0) {
      throw new VoiceOutcomeUnknown('Narration audio payload is missing.');
    }
    const bytes=decodeBase64(inline.data);
    return mime==='audio/wav'?extractProviderWav(bytes):bytes;
  }
  throw new VoiceOutcomeUnknown('Narration provider returned no audio.');
}

export class GeminiVoiceProvider implements VoiceProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly onUsage: GeminiVoiceProviderOptions['onUsage'];

  constructor(options: GeminiVoiceProviderOptions) {
    if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
      throw new Error('Gemini narration requires an API key.');
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? VOICE_MODEL;
    if (this.model !== VOICE_MODEL) throw new Error('Narration model is fixed.');
    this.baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 90_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 46 * 1024 * 1024;
    this.onUsage = options.onUsage;
  }

  private buildBody(text: string, voiceId: VoiceId): string {
    return JSON.stringify({
      contents: [
        {
          parts: [
            {
              text,
              speech_metadata: { style: VOICE_NARRATION_STYLE },
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { voice: voiceId } },
      },
    });
  }

  async synthesize(request: VoiceSynthesisRequest): Promise<VoiceSynthesisResult> {
    if(!isVoiceId(request.voiceId)) throw new VoiceProviderError('Voice is not on the allowlist.');
    if(typeof request.text!=='string'||!request.text.trim()||request.text.length>12000) throw new VoiceProviderError('Invalid narration text.');
    const chunks=narrationChunks(request.text), pcm:Buffer[]=[];
    if(estimatedNarrationSeconds(request.text)+(chunks.length-1)*0.08>600) throw new VoiceProviderError('Narration exceeds the conservative 10-minute trial estimate.');
    let bytes=0;
    for(let index=0;index<chunks.length;index++) {
      if(request.signal.aborted) throw new VoiceOutcomeUnknown('Narration cancelled; review any billed chunks before retrying.');
      if(bytes/48000+estimatedNarrationSeconds(chunks[index]!)>600) throw new VoiceOutcomeUnknown('Remaining audio budget is insufficient; review billed chunks.');
      const result=await this.synthesizeChunk({...request,text:chunks[index]!},index,chunks.length).catch(error=>{
        if(index>0 && !(error instanceof VoiceOutcomeUnknown)) throw new VoiceOutcomeUnknown('Later chunk failed; review previously billed chunks.');
        throw error;
      });
      if(request.signal.aborted) throw new VoiceOutcomeUnknown('Narration cancelled after a billable call.');
      try {validateL16(result.l16);} catch {throw new VoiceOutcomeUnknown('Provider audio failed validation; review billed chunks.');}
      // No overlap, time stretching or source-video timing is implied by this standalone audio.
      if(index) {pcm.push(Buffer.alloc(3840));bytes+=3840;} // 80 ms pause.
      pcm.push(result.l16);bytes+=result.l16.length;
      if(bytes+44>32*1024*1024 || bytes/48000>600) throw new VoiceOutcomeUnknown('Narration exceeds audio limits; review billed chunks.');
    }
    if(request.signal.aborted) throw new VoiceOutcomeUnknown('Narration cancelled before returning audio.');
    return {l16:Buffer.concat(pcm,bytes)};
  }

  private async synthesizeChunk(request:VoiceSynthesisRequest,chunkIndex:number,chunkCount:number):Promise<VoiceSynthesisResult> {
    if (!isVoiceId(request.voiceId)) throw new VoiceProviderError('Voice is not on the allowlist.');
    const text = typeof request.text === 'string' ? request.text.trim() : '';
    if (text.length === 0) throw new VoiceProviderError('Narration text is empty.');

    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const signal = combineSignals([request.signal, timeout.signal]);

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: this.buildBody(text, request.voiceId),
        signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (request.signal.aborted) throw new VoiceOutcomeUnknown('Narration was cancelled while contacting the provider.');
      if (timeout.signal.aborted) throw new VoiceOutcomeUnknown('Narration provider timed out.');
      throw new VoiceOutcomeUnknown('Narration provider was not reachable.');
    }
    try {
    if (!response.ok) {
      await response.body?.cancel().catch(()=>undefined);
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new VoiceOutcomeUnknown(`Narration provider returned ${response.status}.`);
      }
      throw new VoiceProviderError(
        `Narration provider rejected the request (${response.status}).`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No body');
      const chunks: Uint8Array[] = []; let bytes = 0;
      for (;;) {
        const {done,value} = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > this.maxResponseBytes) { await reader.cancel(); throw new Error('Response too large'); }
        chunks.push(value);
      }
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new VoiceOutcomeUnknown('Narration provider returned a malformed response.');
    }

    const metadata = payload as {responseId?:string;usageMetadata?:unknown};
    try {await this.onUsage?.({jobId:request.jobId, model:this.model, voiceId:request.voiceId,chunkIndex,chunkCount,
      responseId:metadata.responseId, usageMetadata:metadata.usageMetadata});} catch { /* An observer cannot discard generated audio. */ }
    try {return {l16:extractL16(payload)};} catch {throw new VoiceOutcomeUnknown('Provider audio failed decoding; review billed chunks.');}
    } finally { clearTimeout(timer); }
  }
}
