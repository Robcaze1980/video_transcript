import { Buffer } from 'node:buffer';

/** L16 PCM contract returned by the narration provider. */
export const VOICE_SAMPLE_RATE = 24000;
export const VOICE_BITS_PER_SAMPLE = 16;
export const VOICE_CHANNELS = 1;

/** Hard budgets for a single English narration artifact. */
export const VOICE_MAX_BYTES = 32 * 1024 * 1024;
export const VOICE_MAX_DURATION_SECONDS = 600;
export const VOICE_MAX_CLIPPED_RATIO = 0.01;
export const VOICE_MAX_SILENCE_RUN_SECONDS = 10;
export const VOICE_MIN_BYTES = 2;

export type VoiceWavFailure =
  | 'not_buffer'
  | 'empty'
  | 'odd_bytes'
  | 'too_large'
  | 'too_long'
  | 'clipping'
  | 'silence_stop'
  | 'invalid_header'
  | 'truncated';

export class VoiceWavError extends Error {
  constructor(readonly code: VoiceWavFailure, message: string) {
    super(message);
    this.name = 'VoiceWavError';
  }
}

export interface VoicePayloadStats {
  readonly samples: number;
  readonly durationMs: number;
  readonly clippedRatio: number;
  readonly longestSilenceMs: number;
}

export interface VoicePayloadLimits {
  readonly maxBytes: number;
  readonly maxDurationSeconds: number;
  readonly maxClippedRatio: number;
  readonly maxSilenceRunSeconds: number;
}

const DEFAULT_LIMITS: VoicePayloadLimits = Object.freeze({
  maxBytes: VOICE_MAX_BYTES,
  maxDurationSeconds: VOICE_MAX_DURATION_SECONDS,
  maxClippedRatio: VOICE_MAX_CLIPPED_RATIO,
  maxSilenceRunSeconds: VOICE_MAX_SILENCE_RUN_SECONDS,
});

function mergeLimits(overrides?: Partial<VoicePayloadLimits>): VoicePayloadLimits {
  return overrides ? { ...DEFAULT_LIMITS, ...overrides } : DEFAULT_LIMITS;
}

/**
 * Validates a raw L16 stream before it is wrapped or trusted.
 * Rejects: non-buffers, empty or truncated payloads ("STOP"), odd byte counts
 * (incomplete 16-bit pairs), payloads over the byte budget, narration over the
 * duration budget, full-scale clipping and long silent runs left by a stopped stream.
 */
export function validateL16(raw: Buffer, overrides?: Partial<VoicePayloadLimits>): VoicePayloadStats {
  const limits = mergeLimits(overrides);
  if (!Buffer.isBuffer(raw)) throw new VoiceWavError('not_buffer', 'Narration payload must be a buffer.');
  if (raw.length < VOICE_MIN_BYTES) throw new VoiceWavError('empty', 'Narration payload is empty.');
  if (raw.length % 2 !== 0) throw new VoiceWavError('odd_bytes', 'L16 payload must contain complete 16-bit sample pairs.');
  if (raw.length + 44 > limits.maxBytes) throw new VoiceWavError('too_large', `Narration payload exceeds ${limits.maxBytes} bytes.`);

  const samples = raw.length / 2;
  const durationMs = Math.round((samples / VOICE_SAMPLE_RATE) * 1000);
  if (samples / VOICE_SAMPLE_RATE > limits.maxDurationSeconds) {
    throw new VoiceWavError('too_long', `Narration exceeds ${limits.maxDurationSeconds} seconds.`);
  }

  let clipped = 0;
  let silence = 0;
  let longestSilence = 0;
  for (let offset = 0; offset < raw.length; offset += 2) {
    const sample = raw.readInt16LE(offset);
    if (sample === 32767 || sample === -32768) clipped += 1;
    if (sample === 0) {
      silence += 1;
      if (silence > longestSilence) longestSilence = silence;
    } else {
      silence = 0;
    }
  }

  const clippedRatio = clipped / samples;
  if (clippedRatio > limits.maxClippedRatio) {
    throw new VoiceWavError('clipping', 'Narration is clipped at full scale.');
  }

  const longestSilenceMs = Math.round((longestSilence / VOICE_SAMPLE_RATE) * 1000);
  if (longestSilence / VOICE_SAMPLE_RATE > limits.maxSilenceRunSeconds) {
    throw new VoiceWavError('silence_stop', 'Narration stops early with a long silent run.');
  }

  return { samples, durationMs, clippedRatio, longestSilenceMs };
}

/** Wraps validated L16 PCM into a canonical RIFF/WAVE container (PCM, mono, 16-bit little-endian). */
export function buildWavRiff(l16: Buffer, overrides?: Partial<VoicePayloadLimits>): Buffer {
  validateL16(l16, overrides);
  const dataSize = l16.length;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(VOICE_CHANNELS, 22);
  wav.writeUInt32LE(VOICE_SAMPLE_RATE, 24);
  wav.writeUInt32LE(VOICE_SAMPLE_RATE * VOICE_CHANNELS * (VOICE_BITS_PER_SAMPLE / 8), 28);
  wav.writeUInt16LE(VOICE_CHANNELS * (VOICE_BITS_PER_SAMPLE / 8), 32);
  wav.writeUInt16LE(VOICE_BITS_PER_SAMPLE, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataSize, 40);
  l16.copy(wav, 44);
  return wav;
}

/** Re-reads a produced WAV and revalidates structure plus PCM payload; never assumes the container is valid. */
export function validateWavRiff(wav: Buffer, overrides?: Partial<VoicePayloadLimits>): VoicePayloadStats {
  const limits = mergeLimits(overrides);
  if (!Buffer.isBuffer(wav)) throw new VoiceWavError('not_buffer', 'WAV payload must be a buffer.');
  if (wav.length < 44) throw new VoiceWavError('truncated', 'WAV payload is shorter than its header.');
  if (wav.length > limits.maxBytes) throw new VoiceWavError('too_large', 'WAV exceeds the narration size limit.');
  if (wav.toString('ascii', 0, 4) !== 'RIFF') throw new VoiceWavError('invalid_header', 'WAV is missing the RIFF signature.');
  if (wav.readUInt32LE(4) !== wav.length - 8) throw new VoiceWavError('invalid_header', 'WAV size field does not match its payload.');
  if (wav.toString('ascii', 8, 12) !== 'WAVE') throw new VoiceWavError('invalid_header', 'WAV is missing the WAVE signature.');
  if (wav.toString('ascii', 12, 16) !== 'fmt ') throw new VoiceWavError('invalid_header', 'WAV is missing the fmt chunk.');
  if (wav.readUInt32LE(16) !== 16) throw new VoiceWavError('invalid_header', 'WAV fmt chunk size must be 16.');
  if (wav.readUInt16LE(20) !== 1) throw new VoiceWavError('invalid_header', 'WAV must use uncompressed PCM.');
  if (wav.readUInt16LE(22) !== VOICE_CHANNELS) throw new VoiceWavError('invalid_header', 'WAV must be mono.');
  if (wav.readUInt32LE(24) !== VOICE_SAMPLE_RATE) throw new VoiceWavError('invalid_header', `WAV must use ${VOICE_SAMPLE_RATE} Hz.`);
  if (wav.readUInt32LE(28) !== VOICE_SAMPLE_RATE * VOICE_CHANNELS * (VOICE_BITS_PER_SAMPLE / 8)) {
    throw new VoiceWavError('invalid_header', 'WAV byte rate is inconsistent.');
  }
  if (wav.readUInt16LE(32) !== VOICE_CHANNELS * (VOICE_BITS_PER_SAMPLE / 8)) {
    throw new VoiceWavError('invalid_header', 'WAV block alignment is inconsistent.');
  }
  if (wav.readUInt16LE(34) !== VOICE_BITS_PER_SAMPLE) throw new VoiceWavError('invalid_header', 'WAV must use 16-bit samples.');
  if (wav.toString('ascii', 36, 40) !== 'data') throw new VoiceWavError('invalid_header', 'WAV is missing the data chunk.');
  const dataSize = wav.readUInt32LE(40);
  if (dataSize !== wav.length - 44) throw new VoiceWavError('truncated', 'WAV data chunk size does not match its payload.');
  return validateL16(wav.subarray(44), overrides);
}

/** Provider WAV may contain a C2PA provenance chunk. Validate chunks before extracting PCM. */
export function extractProviderWav(wav:Buffer):Buffer {
  if (wav.length<44 || wav.length>VOICE_MAX_BYTES || wav.toString('ascii',0,4)!=='RIFF'
    || wav.toString('ascii',8,12)!=='WAVE' || wav.readUInt32LE(4)!==wav.length-8) {
    throw new VoiceWavError('invalid_header','Invalid provider WAV container.');
  }
  let fmt=false, pcm:Buffer|undefined, offset=12, chunks=0;
  while(offset<wav.length) {
    if (++chunks>128 || offset+8>wav.length) throw new VoiceWavError('truncated','Invalid WAV chunk.');
    const kind=wav.toString('ascii',offset,offset+4), size=wav.readUInt32LE(offset+4), start=offset+8;
    const end=start+size;
    if(end>wav.length) throw new VoiceWavError('truncated','Truncated WAV chunk.');
    if(kind==='fmt ') {
      if(fmt || size!==16 || wav.readUInt16LE(start)!==1 || wav.readUInt16LE(start+2)!==1
        || wav.readUInt32LE(start+4)!==24000 || wav.readUInt32LE(start+8)!==48000
        || wav.readUInt16LE(start+12)!==2 || wav.readUInt16LE(start+14)!==16) {
        throw new VoiceWavError('invalid_header','Expected 24kHz mono 16-bit PCM.');
      }
      fmt=true;
    } else if(kind==='data') {
      if(pcm) throw new VoiceWavError('invalid_header','Duplicate WAV data.');
      pcm=wav.subarray(start,end);
    }
    offset=end+(size%2);
    if(offset>wav.length) throw new VoiceWavError('truncated','Missing WAV padding.');
  }
  if(!fmt || !pcm) throw new VoiceWavError('invalid_header','Missing WAV audio.');
  validateL16(pcm); return pcm;
}
