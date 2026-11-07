import { describe, expect, it } from 'vitest';
import {
  formatTime,
  generateSRT,
  parseSRT,
  parseTimeToSeconds,
} from './helpers';

describe('SRT timing', () => {
  it('rounds milliseconds without floating-point drift', () => {
    expect(formatTime(1.23)).toBe('00:00:01,230');
    expect(formatTime(2.57)).toBe('00:00:02,570');
    expect(formatTime(3661.9996)).toBe('01:01:02,000');
  });

  it('rejects malformed timestamps instead of returning zero', () => {
    expect(parseTimeToSeconds('oops')).toBeNaN();
    expect(parseTimeToSeconds('00:99:00,000')).toBeNaN();
    expect(parseTimeToSeconds('00:00:61,000')).toBeNaN();
    expect(parseTimeToSeconds('00:01:02,345')).toBeCloseTo(62.345, 3);
  });

  it('preserves millisecond precision through a parse/generate round trip', () => {
    const source = '1\n00:00:01,234 --> 00:00:02,567\nHola';
    const parsed = parseSRT(source);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].start).toBe(1.234);
    expect(parsed[0].end).toBe(2.567);
    expect(generateSRT(parsed)).toBe(
      '1\n00:00:01,234 --> 00:00:02,567\nHola\n'
    );
  });

  it('ignores invalid cues and sorts valid cues', () => {
    const parsed = parseSRT(`1
oops --> 00:00:02,000
Invalid

2
00:00:05,000 --> 00:00:06,000
Second

3
00:00:01,000 --> 00:00:02,000
First`);

    expect(parsed.map((cue) => cue.translatedText)).toEqual(['First', 'Second']);
  });

  it('accepts WebVTT cue settings after the end timestamp', () => {
    const parsed = parseSRT(`WEBVTT

00:00:01.250 --> 00:00:02.500 align:middle
Hello`);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].start).toBe(1.25);
    expect(parsed[0].end).toBe(2.5);
  });

  it('filters invalid cues from generated SRT and renumbers them', () => {
    const srt = generateSRT([
      {
        id: 'b',
        start: 5,
        end: 6,
        originalText: '',
        translatedText: 'Second',
        speaker: 'Speaker',
      },
      {
        id: 'bad',
        start: 2,
        end: 2,
        originalText: '',
        translatedText: 'Invalid',
        speaker: 'Speaker',
      },
      {
        id: 'a',
        start: 1,
        end: 2,
        originalText: '',
        translatedText: 'First',
        speaker: 'Speaker',
      },
    ]);

    expect(srt.startsWith('1\n00:00:01,000 --> 00:00:02,000\nFirst')).toBe(true);
    expect(srt).not.toContain('Invalid');
    expect(srt).toContain('2\n00:00:05,000 --> 00:00:06,000\nSecond');
  });
});
