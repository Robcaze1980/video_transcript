export class VoiceTextError extends Error {
  constructor(readonly code: 'not_string' | 'empty', message: string) {
    super(message);
    this.name = 'VoiceTextError';
  }
}

export interface SrtCue {
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly lines: readonly string[];
}

export interface ParsedSrt {
  readonly cues: readonly SrtCue[];
  readonly translatedText: string;
}

const TIMESTAMP = /^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})\s*-->\s*(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/;

function toMillis(hours: string, minutes: string, seconds: string, fraction: string): number {
  const ms = Number(fraction.padEnd(3, '0').slice(0, 3));
  return Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1_000 + ms;
}

/**
 * Extracts the saved English text that will be narrated.
 * The project draft is an SRT produced by the text pipeline, so cues are parsed and joined.
 * A draft without any SRT structure is treated as a single free-form segment; a draft that
 * looks like SRT but cannot be parsed yields no text and blocks narration instead of reading mark-up.
 */
export function parseSRT(input: string): ParsedSrt {
  if (typeof input !== 'string') throw new VoiceTextError('not_string', 'Draft must be a string.');
  const normalized = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if(normalized.length>12000) throw new VoiceTextError('empty','Narration trial accepts up to 12,000 characters.');
  const cues: SrtCue[] = [];
  const structured=normalized.includes('-->');

  for (const block of normalized.split(/\n{2,}/)) {
    if(!block.trim()) continue;
    const lines = block.trim().split('\n');
    while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
    if (lines.length < 2) { if(structured) throw new VoiceTextError('empty','Malformed subtitle block.'); continue; }
    let cursor = 0;
    if (/^\s*\d+\s*$/.test(lines[0] ?? '')) cursor = 1;
    const timing = lines[cursor];
    if (!timing) continue;
    const match = TIMESTAMP.exec(timing);
    if (!match) { if(structured) throw new VoiceTextError('empty','Malformed subtitle timing.'); continue; }
    const text = lines
      .slice(cursor + 1)
      .map(line => line.trim())
      .filter(line => line.length > 0);
    if (text.length === 0 || toMillis(match[5]!,match[6]!,match[7]!,match[8]!)<=toMillis(match[1]!,match[2]!,match[3]!,match[4]!)) throw new VoiceTextError('empty','Invalid subtitle content or duration.');
    cues.push({
      index: cues.length + 1,
      startMs: toMillis(match[1]!, match[2]!, match[3]!, match[4]!),
      endMs: toMillis(match[5]!, match[6]!, match[7]!, match[8]!),
      lines: text,
    });
  }

  if (cues.length > 0) {
    const translatedText = cues
      .map(cue => cue.lines.join(' '))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { cues, translatedText };
  }

  if (/-->/.test(normalized)) return { cues, translatedText: '' };
  return { cues, translatedText: normalized.replace(/\s+/g, ' ').trim() };
}
