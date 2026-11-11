import type { Subtitle } from '../../types';
import type { TimedWord } from './pilotCueTiming';

const MAX_TOKENS = 600;
const GAP = 2;
const SUBSTITUTE = 3;
const PATH_MARGIN = 1;
const MIN_COVERAGE = 0.65;
const MAX_SHIFT = 2;

const numbers = {
  English: 'zero one two three four five six seven eight nine ten eleven twelve'.split(' '),
  Spanish: 'cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce'.split(' '),
};

type Language = keyof typeof numbers;
type Status = 'moved' | 'unchanged' | 'ambiguous' | 'unsupported' | 'conflict';
type Edge = { time: number; status: Status };

function tokens(text: string, language: Language) {
  return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).map(word => {
    const digit = numbers[language].indexOf(word);
    return digit < 0 ? word : String(digit);
  });
}

function matchWords(source: readonly string[], spoken: readonly string[]) {
  const width = spoken.length + 1;
  const cells = (source.length + 1) * width;
  const forward = new Uint16Array(cells);
  const backward = new Uint16Array(cells);
  const substitution = (i: number, j: number) => source[i] === spoken[j] ? 0 : SUBSTITUTE;
  for (let i = 0; i <= source.length; i++) {
    for (let j = 0; j <= spoken.length; j++) {
      const k = i * width + j;
      forward[k] = i === 0 ? j * GAP : j === 0 ? i * GAP : Math.min(
        forward[k - width] + GAP, forward[k - 1] + GAP,
        forward[k - width - 1] + substitution(i - 1, j - 1),
      );
    }
  }
  for (let i = source.length; i >= 0; i--) {
    for (let j = spoken.length; j >= 0; j--) {
      const k = i * width + j;
      backward[k] = i === source.length ? (spoken.length - j) * GAP : j === spoken.length
        ? (source.length - i) * GAP : Math.min(
          backward[k + width] + GAP, backward[k + 1] + GAP,
          backward[k + width + 1] + substitution(i, j),
        );
    }
  }

  const limit = forward[cells - 1] + PATH_MARGIN;
  return source.map((token, i) => {
    let match: number | undefined;
    for (let j = 0; j <= spoken.length; j++) {
      const k = i * width + j;
      const prefix = forward[k];
      if (prefix + GAP + backward[k + width] <= limit) return;
      if (j === spoken.length || prefix + substitution(i, j) + backward[k + width + 1] > limit) continue;
      if (token !== spoken[j] || match !== undefined) return;
      match = j;
    }
    return match;
  });
}

// Experimental comparison only. The pilot adapter does not call this function.
export function alignPilotSequence(
  cues: readonly Subtitle[], words: readonly TimedWord[], duration: number, language: Language,
) {
  const unchanged = () => ({
    cues: [...cues],
    edges: cues.map(cue => ({
      start: { time: cue.start, status: 'unsupported' as const },
      end: { time: cue.end, status: 'unsupported' as const },
    })),
  });
  if (!Number.isFinite(duration) || duration <= 0 || words.some((word, index) =>
    !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 ||
    word.end <= word.start || word.end > duration + 0.5 || (index > 0 && word.start < words[index - 1].start))) {
    return unchanged();
  }
  const textByCue = cues.map(cue => tokens(cue.originalText, language));
  const source = textByCue.flat();
  const spoken = words.flatMap(word => tokens(word.text, language).map(text => ({ ...word, text })));
  if (!source.length || !spoken.length || source.length > MAX_TOKENS || spoken.length > MAX_TOKENS) return unchanged();
  const matches = matchWords(source, spoken.map(word => word.text));
  let offset = 0;
  const edges = cues.map((cue, index) => {
    const count = textByCue[index].length;
    const aligned = matches.slice(offset, offset + count);
    offset += count;
    const covered = aligned.filter(match => match !== undefined).length;
    const edge = (side: 'start' | 'end'): Edge => {
      const original = cue[side];
      const match = side === 'start' ? aligned[0] : aligned.at(-1);
      if (match === undefined) return { time: original, status: 'ambiguous' };
      if (side === 'start' && match === 0 && spoken[0].start === 0 && !spoken[0].leadingOnset) {
        return { time: original, status: 'unsupported' };
      }
      const neighbors = side === 'start' ? aligned.slice(1, 3) : aligned.slice(-3, -1);
      if (covered < count * MIN_COVERAGE || !neighbors.some(value => value !== undefined && Math.abs(value - match) <= 3)) {
        return { time: original, status: 'unsupported' };
      }
      const time = Number(Math.min(duration, spoken[match][side]).toFixed(3));
      const delta = Math.abs(time - original);
      if (delta > MAX_SHIFT) return { time: original, status: 'unsupported' };
      return delta <= 0.1 ? { time: original, status: 'unchanged' } : { time, status: 'moved' };
    };
    return { start: edge('start'), end: edge('end') };
  });

  // Reverting a proposed edge can expose a collision with a neighbor. Each
  // pass only removes proposals, so this terminates with valid original edges.
  const revert = (index: number, side: 'start' | 'end') => {
    if (edges[index][side].status !== 'moved') return false;
    edges[index][side] = { time: cues[index][side], status: 'conflict' };
    return true;
  };
  let changed: boolean;
  do {
    changed = false;
    for (const [index, edge] of edges.entries()) {
      if (edge.end.time - edge.start.time < Math.min(0.25, cues[index].end - cues[index].start)) {
        changed = revert(index, 'start') || changed;
        changed = revert(index, 'end') || changed;
      }
      if (index > 0 && edges[index - 1].end.time > edge.start.time) {
        changed = revert(index - 1, 'end') || changed;
        changed = revert(index, 'start') || changed;
      }
    }
  } while (changed);
  return {
    cues: cues.map((cue, index) => ({ ...cue, start: edges[index].start.time, end: edges[index].end.time })),
    edges,
  };
}
