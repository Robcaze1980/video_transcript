import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  buildWavRiff,
  extractProviderWav,
  validateL16,
  validateWavRiff,
  VoiceWavError,
  VOICE_MAX_BYTES,
  VOICE_SAMPLE_RATE,
} from './pipelineVoiceWav';

function l16(values: readonly number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeInt16LE(value, index * 2));
  return buffer;
}

function ramp(samples: number): Buffer {
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE((index % 2000) - 1000, index * 2);
  return buffer;
}

describe('voice WAV handling', () => {
  it('builds a canonical RIFF/WAVE container for 24 kHz mono 16-bit samples', () => {
    const wav = buildWavRiff(l16([0, 1, -1, 32000, -32000]));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt32LE(16)).toBe(16);
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(VOICE_SAMPLE_RATE);
    expect(wav.readUInt32LE(28)).toBe(VOICE_SAMPLE_RATE * 2);
    expect(wav.readUInt16LE(32)).toBe(2);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(10);
  });

  it('rejects payloads without complete 16-bit sample pairs', () => {
    expect(() => validateL16(Buffer.alloc(3))).toThrow(VoiceWavError);
  });

  it('rejects empty or stopped payloads', () => {
    expect(() => validateL16(Buffer.alloc(0))).toThrow(VoiceWavError);
    expect(() => validateL16(Buffer.alloc(1))).toThrow(VoiceWavError);
  });

  it('rejects payloads larger than the byte budget', () => {
    expect(() => validateL16(ramp(64), { maxBytes: 8 })).toThrow(VoiceWavError);
  });

  it('rejects narration longer than the duration budget', () => {
    expect(() => validateL16(ramp(48_000), { maxDurationSeconds: 1 })).toThrow(VoiceWavError);
  });

  it('rejects narration clipped at full scale', () => {
    const clipped = l16(Array.from({ length: 1000 }, () => 32767));
    expect(() => validateL16(clipped)).toThrow(VoiceWavError);
  });

  it('rejects a premature stop marked by a long silent run', () => {
    const silent = l16(Array.from({ length: VOICE_SAMPLE_RATE * 12 }, () => 0));
    expect(() => validateL16(silent)).toThrow(VoiceWavError);
  });

  it('reports duration and clipping ratio for accepted narration', () => {
    const stats = validateL16(ramp(24_000));
    expect(stats.samples).toBe(24_000);
    expect(stats.durationMs).toBe(1000);
    expect(stats.clippedRatio).toBe(0);
  });

  it('re-reads a produced WAV and rejects tampered or truncated containers', () => {
    const wav = buildWavRiff(ramp(4800));
    expect(validateWavRiff(wav).durationMs).toBe(200);

    const wrongChannels = Buffer.from(wav);
    wrongChannels.writeUInt16LE(2, 22);
    expect(() => validateWavRiff(wrongChannels)).toThrow(VoiceWavError);

    const wrongSignature = Buffer.from(wav);
    wrongSignature.write('RIFX', 0, 'ascii');
    expect(() => validateWavRiff(wrongSignature)).toThrow(VoiceWavError);

    const truncated = Buffer.from(wav.subarray(0, wav.length - 2));
    truncated.writeUInt32LE(truncated.length - 8, 4);
    expect(() => validateWavRiff(truncated)).toThrow(VoiceWavError);
  });

  it('accepts a bounded C2PA provenance chunk without narrating its bytes',()=>{
    const wav=buildWavRiff(ramp(128));const extra=Buffer.alloc(12);extra.write('C2PA');extra.writeUInt32LE(4,4);
    const annotated=Buffer.concat([wav,extra]);annotated.writeUInt32LE(annotated.length-8,4);
    expect(extractProviderWav(annotated)).toEqual(wav.subarray(44));
    const truncated=annotated.subarray(0,annotated.length-1);truncated.writeUInt32LE(truncated.length-8,4);
    expect(()=>extractProviderWav(truncated)).toThrow();
  });
  it('keeps the container within the byte budget plus its 44 byte header', () => {
    const wav = buildWavRiff(ramp(128));
    expect(wav.length).toBeLessThanOrEqual(VOICE_MAX_BYTES + 44);
  });
});
