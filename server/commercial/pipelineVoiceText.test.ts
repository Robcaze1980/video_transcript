import { describe, expect, it } from 'vitest';
import { parseSRT, VoiceTextError } from './pipelineVoiceText';

describe('narration text extraction', () => {
  it('parses SRT cues into plain English narration text', () => {
    const srt = [
      '1',
      '00:00:00,000 --> 00:00:02,000',
      'Hello world',
      '',
      '2',
      '00:00:02,000 --> 00:00:04,000',
      'Second cue',
      'Continued here',
      '',
    ].join('\n');
    const parsed = parseSRT(srt);
    expect(parsed.cues).toHaveLength(2);
    expect(parsed.cues[0]).toMatchObject({ startMs: 0, endMs: 2000 });
    expect(parsed.cues[1]).toMatchObject({ startMs: 2000, endMs: 4000 });
    expect(parsed.translatedText).toBe('Hello world Second cue Continued here');
  });

  it('tolerates a byte order mark and CRLF line endings', () => {
    const srt = '\uFEFF1\r\n00:00:01.500 --> 00:00:03.250\r\nLine\r\n';
    const parsed = parseSRT(srt);
    expect(parsed.cues[0]).toMatchObject({ startMs: 1500, endMs: 3250 });
    expect(parsed.translatedText).toBe('Line');
  });

  it('falls back to free-form text when the draft has no subtitle structure', () => {
    expect(parseSRT('  just some saved text  ').translatedText).toBe('just some saved text');
  });

  it('refuses to narrate unparsable subtitle markup', () => {
    const broken = '1\nnot-a-timestamp --> also-not\nHello';
    expect(()=>parseSRT(broken)).toThrow(VoiceTextError);
  });

  it('rejects an invalid second cue rather than narrating a partial draft',()=>{
    expect(()=>parseSRT('1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\nbad --> bad\nSecond')).toThrow();
    expect(()=>parseSRT('x'.repeat(12001))).toThrow();
  });
  it('returns empty text for an empty draft', () => {
    expect(parseSRT('').translatedText).toBe('');
  });

  it('rejects non-string drafts', () => {
    expect(() => parseSRT(undefined as unknown as string)).toThrow(VoiceTextError);
  });
});
