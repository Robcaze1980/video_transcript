import type { Subtitle, SubtitleHighlight } from '../../../types';

export type Track = 'original' | 'translated';
export type Tracks = Record<Track, Subtitle[]>;
export type Preview = Track | 'both';

export const orderCues = (cues: Subtitle[]) => [...cues].sort((a, b) => a.start - b.start);
export const milliseconds = (seconds: number) => Math.round(seconds * 1000) / 1000;

function activeCue(cues: Subtitle[], time: number) {
  for (let index = cues.length - 1; index >= 0; index--) {
    const cue = cues[index];
    if (cue.start <= time && time < cue.end) return cue;
  }
}

export function previewText(tracks: Tracks, preview: Preview, time: number) {
  return previewCaption(tracks, preview, time).text;
}

export function previewCaption(tracks: Tracks, preview: Preview, time: number) {
  const visible: Track[] = preview === 'both' ? ['original', 'translated'] : [preview];
  const highlights: SubtitleHighlight[] = [];
  let text = '';
  for (const track of visible) {
    const cue = activeCue(tracks[track], time);
    const line = cue?.translatedText.trim();
    if (!line) continue;
    if (text) text += '\n';
    for (const { start, end } of cue.highlights ?? []) {
      highlights.push({ start: start + text.length, end: end + text.length });
    }
    text += line;
  }
  return { text, highlights };
}

export function previewTimeline(tracks: Tracks, preview: Preview, duration: number): Subtitle[] {
  const visible = preview === 'both' ? [...tracks.original, ...tracks.translated] : tracks[preview];
  const points = [...new Set([0, duration, ...visible.flatMap(cue => [cue.start, cue.end])])]
    .filter(time => time >= 0 && time <= duration).sort((a, b) => a - b);
  const timeline: Subtitle[] = [];
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const { text, highlights } = previewCaption(tracks, preview, (start + end) / 2);
    if (!text) continue;
    const previous = timeline.at(-1);
    if (previous?.end === start && previous.translatedText === text &&
        JSON.stringify(previous.highlights ?? []) === JSON.stringify(highlights)) previous.end = end;
    else timeline.push({ id: String(index), start, end, translatedText: text, originalText: '',
      ...(highlights.length ? { highlights } : {}) });
  }
  return timeline;
}
