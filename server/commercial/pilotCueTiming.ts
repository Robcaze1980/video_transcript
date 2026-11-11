import type { Subtitle } from '../../types';

export interface TimedWord {
  start: number;
  end: number;
  text: string;
  leadingOnset?: true;
}

export type TimingWindow = readonly [start: number, end: number];

const wordsIn = (text: string) =>
  text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

const tolerance = 0.5;
const maxExtension = 1.6;
const anchorSize = 5;
const maxAnchorSize = 12;
const englishArticles = new Set(['a', 'an', 'the']);
const englishTailFunctionWords = new Set(['a', 'an', 'the', 'in', 'on', 'or', 'you']);
const spanishDigits = new Map([
  ['cero', '0'], ['uno', '1'], ['dos', '2'], ['tres', '3'], ['cuatro', '4'],
  ['cinco', '5'], ['seis', '6'], ['siete', '7'], ['ocho', '8'], ['nueve', '9'], ['diez', '10'],
]);

function matchesAt(anchor: readonly string[], reference: readonly TimedWord[], offset: number, allowArticle = false) {
  let articleUsed = false;
  return anchor.every((token, i) => {
    const word = reference[offset + i];
    if (i > 0 && word.start - reference[offset + i - 1].end > tolerance) return false;
    if (word.text === token) return true;
    if (!allowArticle || articleUsed || i === 0 || !englishArticles.has(token) || !englishArticles.has(word.text)) {
      return false;
    }
    articleUsed = true;
    return true;
  });
}

function readReference(words: readonly TimedWord[], duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return;
  if (words.some((word, index) => !Number.isFinite(word.start) || !Number.isFinite(word.end) ||
    word.start < 0 || word.end <= word.start || word.end > duration + tolerance ||
    (index > 0 && word.start < words[index - 1].start))) return;
  return words.flatMap(word => wordsIn(word.text).map(text => ({ ...word, text })));
}

function endMatches(cue: Subtitle, reference: readonly TimedWord[]) {
  const tail = wordsIn(cue.originalText).slice(-maxAnchorSize);
  const lastFive = tail.slice(-anchorSize);
  // A short suffix can gain enough context from the preceding exact word.
  const anchor = lastFive.join('').length < 13 ? tail.slice(-(anchorSize + 1)) : lastFive;
  if (anchor.length < anchorSize || anchor.join('').length < 13) return { anchor: [], matches: [] };

  const matches: number[] = [];
  for (let offset = 0; offset + anchor.length <= reference.length; offset++) {
    const first = reference[offset];
    const last = reference[offset + anchor.length - 1];
    if (first.start < cue.start - 0.25 || last.end < cue.end - maxExtension ||
      last.end > cue.end + maxExtension) continue;
    if (!matchesAt(anchor, reference, offset)) continue;

    // A long early cut can hide the entire suffix. Extend the exact
    // match backward until it reaches words already covered by this cue.
    let start = offset;
    let prefix = tail.length - anchor.length;
    while (reference[start].start >= cue.end && start > 0 && prefix > 0 &&
      reference[start - 1].text === tail[prefix - 1] &&
      reference[start].start - reference[start - 1].end <= tolerance) {
      start--;
      prefix--;
    }
    if (reference[start].start >= cue.start - 0.25 && reference[start].start < cue.end) matches.push(last.end);
  }

  return { anchor, matches };
}

function applyUniqueEnd(cue: Subtitle, matches: readonly number[], limit: number) {
  if (matches.length !== 1) return cue;
  const end = Number(matches[0].toFixed(3));
  if (end - cue.end <= tolerance || end > limit) return cue;
  return { ...cue, end };
}

function sharedBoundary(cue: Subtitle, next: Subtitle, matches: readonly number[], reference: readonly TimedWord[]) {
  if (cue.end !== next.start || matches.length !== 1 || matches[0] - cue.end <= tolerance) return;
  const anchor = wordsIn(next.originalText).slice(0, anchorSize);
  if (anchor.length < anchorSize || anchor.join('').length < 13) return;

  const starts: number[] = [];
  for (let offset = 0; offset + anchorSize <= reference.length; offset++) {
    const first = reference[offset];
    if (Math.abs(first.start - next.start) > maxExtension ||
      reference[offset + anchorSize - 1].end > next.end + 0.25) continue;
    // Accept one internal English article variant, but count both exact and
    // variant matches when ruling out an ambiguous start.
    if (matchesAt(anchor, reference, offset, true)) starts.push(first.start);
  }
  if (starts.length !== 1 || starts[0] < matches[0] || starts[0] - matches[0] > 0.25 ||
    starts[0] - next.start > maxExtension) return;

  const boundary = Number(((matches[0] + starts[0]) / 2).toFixed(3));
  if (boundary < next.end - 0.25) return boundary;
}

export function extendEarlyCueEnds(cues: readonly Subtitle[], words: readonly TimedWord[], duration: number) {
  const reference = readReference(words, duration);
  const adjusted = [...cues];
  if (!reference) return adjusted;
  for (const [index, cue] of adjusted.entries()) {
    const next = adjusted[index + 1];
    const { matches } = endMatches(cue, reference);
    const boundary = next && sharedBoundary(cue, next, matches, reference);
    if (boundary !== undefined) {
      adjusted[index] = { ...cue, end: boundary };
      adjusted[index + 1] = { ...next, start: boundary };
    } else {
      adjusted[index] = applyUniqueEnd(cue, matches, Math.min(duration, next?.start ?? duration));
    }
  }
  return adjusted;
}

const samplesPerBlock = 320; // 20 ms of mono PCM at 16 kHz.

function pcmBlockEnergy(pcm: Buffer, block: number) {
  let energy = 0;
  const offset = block * samplesPerBlock * 2;
  for (let byte = offset; byte < offset + samplesPerBlock * 2; byte += 2) {
    energy += pcm.readInt16LE(byte) ** 2;
  }
  return energy;
}

function hasQuietGapBeforeStretchedStart(pcm: Buffer, start: number, previousStart: number, wordEnd: number) {
  const first = Math.ceil((start + 0.22) * 50);
  const last = Math.floor((previousStart + 0.18) * 50);
  const end = Math.floor(wordEnd * 50);
  if (last - first < 15 || end <= last || end * samplesPerBlock * 2 > pcm.length) return false;

  const gap = Array.from({ length: last - first }, (_, offset) => pcmBlockEnergy(pcm, first + offset));
  gap.sort((left, right) => left - right);
  const background = gap[Math.floor(gap.length * 0.75)];
  if (background > samplesPerBlock * 720 ** 2) return false;

  let voiceBlocks = 0;
  for (let block = last; block < end; block++) {
    const energy = pcmBlockEnergy(pcm, block);
    voiceBlocks = energy >= Math.max(background * 4, samplesPerBlock * 850 ** 2) ? voiceBlocks + 1 : 0;
    if (voiceBlocks >= 2) return true;
  }
  return false;
}

export function restoreEnglishStartsOverBackground(
  cues: readonly Subtitle[], beforeAlignment: readonly Subtitle[], words: readonly TimedWord[],
  pcm: Buffer, duration: number,
) {
  const reference = readReference(words, duration);
  if (!reference || beforeAlignment.length !== cues.length) return [...cues];
  const blockCount = Math.floor(pcm.length / (samplesPerBlock * 2));
  return cues.map((cue, index) => {
    const previousStart = beforeAlignment[index].start;
    if (index === 0 || previousStart - cue.start <= tolerance || cue.end - previousStart < 0.25) return cue;
    const head = wordsIn(cue.originalText).slice(0, 3);
    const [firstWord] = head;
    if (firstWord !== 'and' && firstWord !== 'in') return cue;

    const wordIndex = reference.findIndex(word => word.text === firstWord && Math.abs(word.start - cue.start) < 0.001);
    const word = reference[wordIndex];
    if (!word) return cue;
    if (firstWord === 'in') {
      // A shared cut can attach a stretched preposition to the preceding
      // phrase. Restore only the start when a quiet gap separates the speech.
      const sharedCut = cues[index - 1].end === cue.start && beforeAlignment[index - 1].end === previousStart;
      const anchored = head.length === 3 && wordIndex + head.length <= reference.length &&
        matchesAt(head, reference, wordIndex);
      return sharedCut && anchored && word.end - word.start >= 0.75 &&
        hasQuietGapBeforeStretchedStart(pcm, word.start, previousStart, word.end)
        ? { ...cue, start: previousStart }
        : cue;
    }

    if (word.end - word.start < 0.55 || Math.abs(previousStart - word.end) > 0.25) return cue;
    const first = Math.ceil(word.start * 50);
    const late = Math.floor((word.end - 0.04) * 50);
    if (first < 0 || late + 4 > blockCount || late - first < 20) return cue;

    let background = 0;
    for (let block = first; block < late - 5; block++) {
      background = Math.max(background, pcmBlockEnergy(pcm, block));
    }
    const sustainedVoice = [0, 1, 2, 3].filter(offset => {
      const energy = pcmBlockEnergy(pcm, late + offset);
      return energy >= samplesPerBlock * 260 ** 2 && energy >= background * 4;
    });
    return sustainedVoice.length >= 3 ? { ...cue, start: previousStart } : cue;
  });
}

export function delayEnglishStartsAfterSilence(
  cues: readonly Subtitle[], words: readonly TimedWord[], pcm: Buffer, duration: number,
) {
  const reference = readReference(words, duration);
  if (!reference) return [...cues];
  const blockCount = Math.floor(pcm.length / (samplesPerBlock * 2));
  const quiet = samplesPerBlock * 100 ** 2;
  const active = samplesPerBlock * 260 ** 2;
  return cues.map((cue, index) => {
    if (index === 0) return cue;
    const head = wordsIn(cue.originalText).slice(0, 4);
    if (head.length !== 4 || head.join('').length < 12) return cue;
    const anchors = reference.filter((word, offset) =>
      word.start >= cue.start - 0.1 && word.start <= cue.start + 0.9 &&
      offset + head.length <= reference.length && matchesAt(head, reference, offset));
    if (anchors.length !== 1) return cue;

    const lastBlock = Math.min(blockCount - 4, Math.floor(Math.min(cue.start + 0.9, cue.end - 0.25) * 50));
    // Keep a subtitle if its interval already contains speech before this
    // transition. Only delay when the candidate starts in the same silence.
    for (let block = Math.ceil(cue.start * 50); block <= lastBlock; block++) {
      if (pcmBlockEnergy(pcm, block) <= quiet) continue;
      const onset = block / 50;
      const voiced = [0, 1, 2, 3].filter(offset => pcmBlockEnergy(pcm, block + offset) >= active).length;
      if (onset - cue.start > tolerance && voiced >= 3 &&
        anchors[0].start <= onset + 0.12 && anchors[0].end >= onset - 0.06) return { ...cue, start: onset };
      break;
    }
    return cue;
  });
}

export function alignMonolingualSharedCuts(
  cues: readonly Subtitle[], words: readonly TimedWord[], pcm: Buffer, duration: number,
) {
  const reference = readReference(words, duration);
  const adjusted = [...cues];
  if (!reference) return adjusted;

  for (let i = 1; i < adjusted.length; i++) {
    const left = adjusted[i - 1];
    const right = adjusted[i];
    if (left.end !== right.start) continue;
    const tail = wordsIn(left.originalText).at(-1);
    const head = wordsIn(right.originalText).slice(0, 3);
    if (!tail || tail.length < 7 || head.length !== 3 || head.join('').length < 12) continue;
    const anchor = [tail, ...head];
    const boundaries: number[] = [];
    for (let offset = 0; offset + anchor.length <= reference.length; offset++) {
      if (!matchesAt(anchor, reference, offset)) continue;
      const end = reference[offset].end;
      const start = reference[offset + 1].start;
      if (start >= end && start - end <= 0.12) boundaries.push((start + end) / 2);
    }
    if (boundaries.length !== 1) continue;
    const time = Number(boundaries[0].toFixed(3));
    const shift = Math.abs(time - left.end);
    if (shift <= 0.6 || shift > maxExtension || time - left.start < 0.25 || right.end - time < 0.25) continue;
    const block = Math.round(time * 50);
    if (block < 6 || (block + 7) * samplesPerBlock * 2 > pcm.length) continue;
    const valley = Math.min(...[-1, 0, 1].map(offset => pcmBlockEnergy(pcm, block + offset)));
    const nearbySpeech = Math.max(...[-6, -5, -4, 4, 5, 6].map(offset => pcmBlockEnergy(pcm, block + offset)));
    if (nearbySpeech < samplesPerBlock * 260 ** 2 || valley > nearbySpeech / 16) continue;
    adjusted[i - 1] = { ...left, end: time };
    adjusted[i] = { ...right, start: time };
  }
  return adjusted;
}

export function trimLateMonolingualEnds(
  cues: readonly Subtitle[], words: readonly TimedWord[], pcm: Buffer, duration: number,
) {
  const reference = readReference(words, duration);
  if (!reference) return [...cues];
  // The decoder supplies mono PCM at 16 kHz. Use 20 ms blocks and allow
  // one isolated noise burst in the quiet interval.
  const boundaryMargin = 0.1;
  const quiet = Array.from({ length: Math.floor(pcm.length / (samplesPerBlock * 2)) },
    (_, block) => pcmBlockEnergy(pcm, block) <= samplesPerBlock * 100 ** 2);
  return cues.map(cue => {
    const tail = wordsIn(cue.originalText).slice(-anchorSize);
    while (tail.length > 2 && tail.slice(1).join('').length >= 12) tail.shift();
    if (tail.length < 2 || tail.join('').length < 12) return cue;

    const matches: number[] = [];
    for (let index = 0; index + tail.length <= reference.length; index++) {
      const first = reference[index];
      const last = reference[index + tail.length - 1];
      if (first.start < cue.start || last.end > cue.end - tolerance || last.end < cue.end - maxExtension) continue;
      if (matchesAt(tail, reference, index)) matches.push(last.end);
    }
    if (matches.length !== 1) return cue;

    const firstBlock = Math.max(6, Math.ceil((matches[0] - 0.04) * 50));
    const lastBlock = Math.min(quiet.length - 8, Math.floor((matches[0] + 0.2) * 50));
    for (let block = firstBlock; block <= lastBlock; block++) {
      if (!quiet[block] || quiet.slice(block, block + 8).filter(Boolean).length < 7 ||
        quiet.slice(block - 6, block).filter(value => !value).length < 3) continue;
      const end = block / 50;
      // A quiet transition is approximate. Keep borderline late ends.
      if (cue.end - end > tolerance + boundaryMargin && end - cue.start >= 0.25) return { ...cue, end };
    }
    return cue;
  });
}

function interiorEdge(
  tokens: readonly string[], reference: readonly TimedWord[], time: number,
  side: 'start' | 'end', allowInteriorVariant: boolean,
) {
  const minimumSize = tokens.length === 3 ? 3 : 4;
  for (let size = Math.min(tokens.length, 6); size >= minimumSize; size--) {
    const anchor = side === 'start' ? tokens.slice(0, size) : tokens.slice(-size);
    const matches = interiorMatches(anchor, reference, time, side, allowInteriorVariant);
    if (matches.length === 0) continue;
    if (matches.length === 1 && Math.abs(matches[0] - time) > tolerance) return Number(matches[0].toFixed(3));
    return;
  }
}

function interiorMatches(
  anchor: readonly string[], reference: readonly TimedWord[], time: number,
  side: 'start' | 'end', allowInteriorVariant: boolean,
) {
  if (anchor.join('').length < 13) return [];
  const matches: number[] = [];
  for (let offset = 0; offset + anchor.length <= reference.length; offset++) {
    const edge = reference[offset + (side === 'end' ? anchor.length - 1 : 0)][side];
    if (Math.abs(edge - time) > 2) continue;
    let mismatches = 0;
    const matched = anchor.every((token, index) => {
      const word = reference[offset + index];
      if (index > 0 && word.start - reference[offset + index - 1].end > tolerance) return false;
      if (token === word.text) return true;
      if (!allowInteriorVariant || anchor.length < 5 || index === 0 || index === anchor.length - 1 ||
        /\d/u.test(token) || /\d/u.test(word.text)) return false;
      mismatches++;
      return mismatches === 1;
    });
    if (matched) matches.push(edge);
  }
  return matches;
}

export function alignInteriorCueEdges(cues: Subtitle[], words: readonly TimedWord[], duration: number, spanish: boolean) {
  const reference = readReference(words, duration);
  if (!reference || cues.length === 0) return cues;
  const normalize = (word: string) => spanish ? spanishDigits.get(word) ?? word : word;
  const normalized = reference.map(word => ({ ...word, text: normalize(word.text) }));
  const adjusted = cues.map((cue, index) => {
    const tokens = wordsIn(cue.originalText).map(normalize);
    const candidateStart = interiorEdge(tokens, normalized, cue.start, 'start', false);
    // Delay the first cue only when its prefix is at the first spoken word.
    const start = index > 0 || (normalized[0]?.leadingOnset && candidateStart === normalized[0].start &&
      candidateStart !== undefined && candidateStart > cue.start) ? candidateStart : undefined;
    const end = index < cues.length - 1
      ? interiorEdge(tokens, normalized, cue.end, 'end', spanish)
      : undefined;
    return {
      ...cue,
      start: start ?? cue.start,
      end: end !== undefined && end < cue.end ? end : cue.end,
    };
  });
  const roundedDuration = Number(duration.toFixed(3));
  if (adjusted.some((cue, index) => cue.start < 0 || cue.end > roundedDuration ||
    cue.end - cue.start < Math.min(0.25, cues[index].end - cues[index].start) ||
    (index > 0 && cue.start < adjusted[index - 1].end))) return cues;
  return adjusted;
}

export function stabilizeEnglishFinalCue(cues: Subtitle[], words: readonly TimedWord[], duration: number) {
  const cue = cues.at(-1);
  const reference = readReference(words, duration);
  if (!cue || !reference?.length || duration - cue.end > maxExtension) return cues;

  const lastWordEnd = reference.at(-1)!.end;
  const exact = endMatches(cue, reference).matches;
  const closeToLastWord = exact.length === 1 && Math.abs(exact[0] - lastWordEnd) <= 0.25;
  if (!closeToLastWord) {
    if (exact.length) return cues;
    // Preserve the text when the two recognizers disagree on short function
    // words. The substantive suffix must still be unique and reach the end.
    const isSubstantive = (word: string) => !englishTailFunctionWords.has(word);
    const anchor = wordsIn(cue.originalText).filter(isSubstantive).slice(-3);
    const substantive = reference.filter(word => isSubstantive(word.text));
    if (anchor.length !== 3 || anchor.join('').length < 16) return cues;
    const starts = substantive.flatMap((word, index) => {
      const end = substantive[index + anchor.length - 1];
      if (!end || word.start < cue.start - 0.25 || Math.abs(end.end - cue.end) > maxExtension) return [];
      const contiguous = anchor.every((token, offset) => substantive[index + offset].text === token &&
        (offset === 0 || substantive[index + offset].start - substantive[index + offset - 1].end <= 0.9));
      return contiguous ? [index] : [];
    });
    if (starts.length !== 1 || starts[0] + anchor.length !== substantive.length ||
      lastWordEnd - substantive.at(-1)!.end > 0.25) return cues;
  }

  const end = Number(Math.min(duration, lastWordEnd + 0.2).toFixed(3));
  const delta = Math.abs(end - cue.end);
  if (delta <= 0.25 || delta > maxExtension || cue.end - end > tolerance || end < cue.start + 0.25) return cues;
  return [...cues.slice(0, -1), { ...cue, end }];
}

export async function verifyLateEnglishFinalCue(
  cues: Subtitle[], words: readonly TimedWord[], duration: number,
  readWindow: (window: TimingWindow) => Promise<TimedWord[]>, signal?: AbortSignal,
) {
  const cue = cues.at(-1);
  const reference = readReference(words, duration);
  if (!cue || !reference?.length || duration - cue.end > maxExtension) return cues;
  const originalText = cue.originalText.replace(/\b(\d+)\s*ft\s+(\d+)\s*in\b/giu, '$1 feet $2 inches');
  const timingCue = { ...cue, originalText };
  const exact = endMatches(timingCue, reference).matches;
  const last = reference.at(-1)!.end;
  const end = Number((last + 0.2).toFixed(3));
  const shortening = cue.end - end;
  if (exact.length !== 1 || Math.abs(exact[0] - last) > 0.1 || shortening <= tolerance ||
    shortening > 1 || end < cue.start + 0.25) return cues;
  try {
    const local = readReference(await readWindow([Math.max(cue.start, cue.end - 5), duration]), duration);
    const localEnd = local?.at(-1)?.end;
    if (!local || localEnd === undefined || Math.abs(last - localEnd) > 0.15) return cues;
    const confirmed = endMatches(timingCue, local).matches;
    if (confirmed.length === 1 && Math.abs(confirmed[0] - localEnd) <= 0.1) {
      return [...cues.slice(0, -1), { ...cue, end: Math.max(end, Number((localEnd + 0.2).toFixed(3))) }];
    }
  } catch {
    signal?.throwIfAborted();
  }
  return cues;
}

export async function retryEarlyCueEnds(
  cues: readonly Subtitle[], words: readonly TimedWord[], duration: number,
  readWindow: (window: TimingWindow) => Promise<TimedWord[]>, signal?: AbortSignal,
) {
  const reference = readReference(words, duration);
  const adjusted = [...cues];
  if (!reference) return adjusted;

  let remaining = 2;
  for (const [index, cue] of cues.entries()) {
    if (remaining === 0) break;
    const limit = Math.min(duration, cues[index + 1]?.start ?? duration);
    if (limit - cue.end <= tolerance) continue;
    const { anchor, matches } = endMatches(cue, reference);
    // Retry only when the first word of the suffix is audible at the cut,
    // but the complete suffix was absent from the full-clip reading.
    if (matches.length || !reference.some(word => word.text === anchor[0] &&
      word.start < cue.end && word.end >= cue.end - 0.25)) continue;
    const end = Math.min(limit, cue.end + maxExtension + 0.5);
    remaining--;
    try {
      const local = readReference(await readWindow([Math.max(cue.start, cue.end - 5), end]), duration);
      if (local) adjusted[index] = applyUniqueEnd(cue, endMatches(cue, local).matches, Math.min(limit, end - 0.1));
    } catch {
      signal?.throwIfAborted();
      break;
    }
  }
  return adjusted;
}
