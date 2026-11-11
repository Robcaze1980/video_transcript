import { describe, expect, it } from 'vitest';
import { parseSRT } from '../../../utils/helpers';
import { previewText, previewTimeline, type Tracks } from './pilotTracks';

describe('pilot subtitle tracks', () => {
  const tracks: Tracks = {
    original: parseSRT('1\n00:00:00,500 --> 00:00:01,500\nصباح الخير\n\n2\n00:00:01,500 --> 00:00:02,000\nأصدقاء'),
    translated: parseSRT('1\n00:00:01,000 --> 00:00:02,500\nBuenos días'),
  };

  it('composes independent track boundaries and keeps original and translation on separate lines', () => {
    expect(previewText(tracks, 'both', 1)).toBe('صباح الخير\nBuenos días');
    expect(previewText(tracks, 'both', 1.5)).toBe('أصدقاء\nBuenos días');
    expect(previewText(tracks, 'original', 2)).toBe('');
    expect(previewTimeline(tracks, 'both', 3).map(cue => [cue.start, cue.end, cue.translatedText])).toEqual([
      [0.5, 1, 'صباح الخير'],
      [1, 1.5, 'صباح الخير\nBuenos días'],
      [1.5, 2, 'أصدقاء\nBuenos días'],
      [2, 2.5, 'Buenos días'],
    ]);
  });

  it('resumes an overlapping earlier segment once the newer segment ends', () => {
    const translated = [
      { ...tracks.translated[0], start: 0, end: 3 },
      { ...tracks.translated[0], start: 1, end: 2, translatedText: 'Hola' },
    ];
    expect(previewTimeline({ original: [], translated }, 'translated', 3).map(cue => cue.translatedText))
      .toEqual(['Buenos días', 'Hola', 'Buenos días']);
  });
});
