import type { Subtitle } from '../../types';
import { generateSRT, parseTimeToSeconds } from '../../utils/helpers';

export const maxPilotSubtitleBytes = 65536;

function cue(start: number, end: number, text: string): Subtitle {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || !text.trim()) {
    throw new Error('projectSrtInvalid');
  }
  return { id: '', start, end, originalText: '', translatedText: text.trim() };
}

function readLrc(text: string, duration: number): Subtitle[] {
  let offset = 0;
  let hasOffset = false;
  const entries: { time: number; text: string }[] = [];
  for (const row of text.split('\n')) {
    let line = row.trim();
    if (!line) continue;
    const tag = /^\[([a-z]+):(.*)\]$/i.exec(line);
    if (tag) {
      if (tag[1].toLowerCase() === 'offset') {
        if (hasOffset || !/^[+-]?\d{1,8}$/.test(tag[2].trim())) throw new Error('projectSrtInvalid');
        offset = Number(tag[2]) / 1000;
        hasOffset = true;
      }
      continue;
    }
    const times: number[] = [];
    for (let stamp; (stamp = /^\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/.exec(line));) {
      const seconds = Number(stamp[2]);
      if (seconds >= 60) throw new Error('projectSrtInvalid');
      times.push(Number(stamp[1]) * 60 + seconds + Number('0.' + (stamp[3] ?? '0')));
      line = line.slice(stamp[0].length);
    }
    if (!times.length || /^\s*[\[<]\d+:\d/.test(line) || /<\d+:\d{2}(?:\.\d+)?>/.test(line)) {
      throw new Error('subtitleVariantUnsupported');
    }
    entries.push(...times.map(time => ({ time, text: line.trim() })));
    if (entries.length > 1000) throw new Error('projectSrtInvalid');
  }
  const byTime = new Map<number, Set<string>>();
  for (const entry of entries) {
    // LRC offsets express a playback-time adjustment. Positive values advance lyrics.
    const time = Math.round((entry.time - offset) * 1000) / 1000;
    if (time < 0 || time > duration || (time === duration && entry.text)) throw new Error('projectSrtOutside');
    if (!byTime.has(time)) byTime.set(time, new Set());
    if (entry.text) byTime.get(time)!.add(entry.text);
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  return times.flatMap((time, index) => {
    const text = [...byTime.get(time)!].join('\n');
    return text ? [cue(time, times[index + 1] ?? duration, text)] : [];
  });
}

function readAss(text: string): Subtitle[] {
  let inEvents = false;
  let fields: string[] = [];
  const cues: Subtitle[] = [];
  for (const row of text.split('\n')) {
    const line = row.trim();
    if (line.startsWith('[')) {
      inEvents = /^\[events\]$/i.test(line);
      fields = [];
      continue;
    }
    if (!inEvents) continue;
    const format = /^format:\s*(.+)$/i.exec(line);
    if (format) fields = format[1].split(',').map(field => field.trim().toLowerCase());
    const dialogue = /^dialogue:\s*(.*)$/i.exec(line);
    if (!dialogue) continue;
    if (!fields.includes('start') || !fields.includes('end') || fields.at(-1) !== 'text') {
      throw new Error('subtitleVariantUnsupported');
    }
    let remaining = dialogue[1];
    const values: string[] = [];
    for (let index = 0; index < fields.length - 1; index++) {
      const comma = remaining.indexOf(',');
      if (comma < 0) throw new Error('projectSrtInvalid');
      values.push(remaining.slice(0, comma));
      remaining = remaining.slice(comma + 1);
    }
    if (/\{[^}]*\\p\s*[1-9][^}]*\}/i.test(remaining)) throw new Error('subtitleVariantUnsupported');
    const visible = remaining.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, '\u00a0');
    if (/[{}]/.test(visible) || /\n[^\S\n]*\n/.test(visible.trim())) throw new Error('subtitleVariantUnsupported');
    const start = values[fields.indexOf('start')].trim();
    const end = values[fields.indexOf('end')].trim();
    if (![start, end].every(time => /^\d{1,3}:\d{2}:\d{2}\.\d{2}$/.test(time))) throw new Error('projectSrtInvalid');
    cues.push(cue(parseTimeToSeconds(start), parseTimeToSeconds(end), visible));
    if (cues.length > 1000) throw new Error('projectSrtInvalid');
  }
  return cues;
}

export function convertPilotSubtitle(name: string, content: string, videoDuration: number) {
  const text = content.replace(/\r\n?/g, '\n').trim();
  if (!text || text.includes('\0') || new TextEncoder().encode(text).length > maxPilotSubtitleBytes) {
    throw new Error('projectSrtInvalid');
  }
  // Android can append .txt when downloading a subtitle through a text provider.
  const extension = /\.(lrc|ass)(?:\s*\(\d+\))?(?:\.txt)?$/i.exec(name.trim())?.[1].toLowerCase();
  const format = extension === 'lrc' ? 'lrc' : extension === 'ass' ? 'ass' : 'srt';
  if (format === 'srt') return { draft: text, format };
  const duration = Math.round(videoDuration * 1000) / 1000;
  const cues = format === 'lrc' ? readLrc(text, duration) : readAss(text);
  if (cues.some(item => item.end > duration)) throw new Error('projectSrtOutside');
  const draft = generateSRT(cues);
  if (!draft || new TextEncoder().encode(draft).length > maxPilotSubtitleBytes) throw new Error('projectSrtInvalid');
  return { draft, format };
}
