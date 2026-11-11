import type { Subtitle, SubtitleHighlight } from '../../types';

export type SavedHighlights = Partial<Record<'original' | 'translated', (SubtitleHighlight & { cue: number })[]>>;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function validHighlight(text: string, start: number, end: number) {
  if (!Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end > text.length || start >= end || !text.slice(start, end).trim()) return false;
  const segments = segmenter.segment(text);
  return segments.containing(start)?.index === start &&
    (end === text.length || segments.containing(end)?.index === end);
}

export function parseHighlights(value: unknown, cues: Subtitle[]) {
  if (!Array.isArray(value) || value.length > cues.length) return;
  const seen = new Set<number>();
  const result: NonNullable<SavedHighlights['translated']> = [];
  for (const mark of value) {
    if (!mark || typeof mark !== 'object' || Object.keys(mark).length !== 3) return;
    const { cue, start, end } = mark;
    if (!Number.isInteger(cue) || !cues[cue] || seen.has(cue) ||
        !validHighlight(cues[cue].translatedText, start, end)) return;
    seen.add(cue);
    result.push({ cue, start, end });
  }
  return result;
}
