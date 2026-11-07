import { describe, expect, it } from 'vitest';
import { Subtitle } from '../types';
import {
  buildTranscriptionReport,
  findActiveSubtitle,
  findUncaptionedRanges,
  mergeSubtitleCues,
  normalizeSectionCues,
  planTranscriptionSections,
} from './subtitles';

const cue = (
  id: string,
  start: number,
  end: number,
  translatedText: string = id
): Subtitle => ({
  id,
  start,
  end,
  originalText: translatedText,
  translatedText,
  speaker: 'Speaker',
});

describe('planTranscriptionSections', () => {
  it('covers the complete duration with bounded overlaps', () => {
    const sections = planTranscriptionSections(100, 45, 1.25);

    expect(sections[0].start).toBe(0);
    expect(sections.at(-1)?.end).toBe(100);
    for (let index = 1; index < sections.length; index += 1) {
      expect(sections[index].start).toBeLessThan(sections[index - 1].end);
    }
  });

  it('rejects invalid durations instead of inventing a section', () => {
    expect(() => planTranscriptionSections(0)).toThrow(/duration/i);
    expect(() => planTranscriptionSections(Number.NaN)).toThrow(/duration/i);
  });
});

describe('normalizeSectionCues', () => {
  const section = { index: 0, start: 10, end: 20 };

  it('rejects cues outside the requested section', () => {
    const result = normalizeSectionCues(
      [{ start: 21.5, end: 23, original: 'hola', translated: 'hello' }],
      section,
      60
    );

    expect(result.cues).toHaveLength(0);
    expect(result.rejected[0]).toMatch(/outside/i);
  });

  it('rejects start times at or after the end instead of swapping them', () => {
    const result = normalizeSectionCues(
      [{ start: 18, end: 18, original: 'hola', translated: 'hello' }],
      section,
      60
    );

    expect(result.cues).toHaveLength(0);
    expect(result.rejected[0]).toMatch(/greater than start/i);
  });

  it('keeps valid cues and clamps only boundary drift', () => {
    const result = normalizeSectionCues(
      [{ start: 9.4, end: 12.567, original: 'hola', translated: 'hello' }],
      section,
      60
    );

    expect(result.rejected).toHaveLength(0);
    expect(result.cues[0].start).toBe(9.4);
    expect(result.cues[0].end).toBe(12.567);
  });

  it('rejects empty text and non-finite timestamps', () => {
    const result = normalizeSectionCues(
      [
        { start: 10, end: 11, original: '', translated: '' },
        { start: 'oops', end: 12, original: 'x', translated: 'x' },
      ],
      section,
      60
    );

    expect(result.cues).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
  });
});

describe('mergeSubtitleCues', () => {
  it('deduplicates the same cue discovered in overlapping sections', () => {
    const merged = mergeSubtitleCues(
      [
        cue('a', 40, 46, 'Same sentence'),
        cue('b', 44.8, 48, 'Same sentence.'),
      ],
      60
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].start).toBe(40);
    expect(merged[0].end).toBe(48);
  });

  it('produces ordered, non-overlapping cues for different text', () => {
    const merged = mergeSubtitleCues(
      [
        cue('b', 12, 18, 'Second'),
        cue('a', 10, 14, 'First'),
        cue('c', 20, 22, 'Third'),
      ],
      60
    );

    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(merged[0].end).toBeLessThanOrEqual(merged[1].start);
    expect(merged[1].end).toBeLessThanOrEqual(merged[2].start);
  });

  it('drops invalid intervals and clips cues to the video duration', () => {
    const merged = mergeSubtitleCues(
      [cue('invalid', 5, 5), cue('tail', 58, 70)],
      60
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].end).toBe(60);
  });
});

describe('subtitle lookup and coverage', () => {
  const subtitles = [cue('a', 0, 2), cue('b', 5, 7), cue('c', 20, 22)];

  it('finds the active cue efficiently and respects continuous mode', () => {
    expect(findActiveSubtitle(subtitles, 1, false)?.id).toBe('a');
    expect(findActiveSubtitle(subtitles, 3, false)).toBeNull();
    expect(findActiveSubtitle(subtitles, 3, true)?.id).toBe('a');
  });

  it('does not extend a subtitle across a long gap', () => {
    expect(findActiveSubtitle(subtitles, 10, true)).toBeNull();
  });

  it('reports leading, internal, and trailing uncaptioned ranges', () => {
    expect(findUncaptionedRanges(subtitles, 25)).toEqual([
      { start: 2, end: 5 },
      { start: 7, end: 20 },
      { start: 22, end: 25 },
    ]);
  });

  it('counts verified silence separately from failures', () => {
    const sections = planTranscriptionSections(20, 10, 1);
    sections[0].status = 'success';
    sections[0].cues = [cue('a', 0, 2)];
    sections[1].status = 'no_speech';
    if (sections[2]) sections[2].status = 'error';

    const report = buildTranscriptionReport(sections, [cue('a', 0, 2)], 20);
    expect(report.completedSections).toBe(1);
    expect(report.noSpeechSections).toBe(1);
    expect(report.failedSections).toBe(sections.length > 2 ? 1 : 0);
  });
});
