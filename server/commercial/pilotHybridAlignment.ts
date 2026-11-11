import type { Subtitle } from '../../types';
import type { TimedWord } from './pilotCueTiming';
import { alignPilotSequence } from './pilotSequenceAlignment';

const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = SAMPLE_RATE / 50; // 20 ms
const MIN_ACTIVE_LEVEL = 260;
const MAX_QUIET_RATIO = 0.35;
const MAX_SHIFT = 0.75;

function frameLevel(pcm: Buffer, firstSample: number) {
  let energy = 0;
  for (let i = firstSample; i < firstSample + FRAME_SAMPLES; i++) {
    energy += pcm.readInt16LE(i * 2) ** 2;
  }
  return Math.sqrt(energy / FRAME_SAMPLES);
}

function supportsEdge(pcm: Buffer, time: number, side: 'start' | 'end') {
  const sample = Math.round(time * SAMPLE_RATE);
  const samples = Math.floor(pcm.length / 2);
  for (const offset of [0, -1, 1, -2, 2]) {
    const boundary = sample + offset * FRAME_SAMPLES;
    if (boundary - 4 * FRAME_SAMPLES < 0 || boundary + 4 * FRAME_SAMPLES > samples) continue;
    const levels = (start: number) => [0, 1, 2, 3]
      .map(frame => frameLevel(pcm, start + frame * FRAME_SAMPLES)).sort((a, b) => a - b);
    const before = levels(boundary - 4 * FRAME_SAMPLES);
    const after = levels(boundary);
    const [quiet, active] = side === 'start' ? [before, after] : [after, before];
    // Compare three quiet frames with three active frames. A single click
    // or a single quiet frame inside a word cannot certify a transition.
    if (active[1] >= MIN_ACTIVE_LEVEL && quiet[2] <= active[1] * MAX_QUIET_RATIO) return true;
  }
  return false;
}

function repeatedArticleStart(cue: Subtitle, words: readonly TimedWord[], pcm: Buffer) {
  const tokens = cue.originalText.toLowerCase().match(/[a-z]+/g) ?? [];
  if (tokens.length < 4 || tokens[0] !== 'the' || tokens[1] !== 'the') return;
  const anchors = words.filter((word, index) => {
    const shift = word.start - cue.start;
    return shift > 0.5 && shift <= MAX_SHIFT && word.end < cue.end &&
      words[index - 1]?.end <= cue.start &&
      tokens.slice(1, 4).every((token, offset) =>
        words[index + offset]?.text.trim().toLowerCase().replace(/[^a-z]/g, '') === token);
  });
  if (anchors.length !== 1 || !supportsEdge(pcm, anchors[0].start, 'start')) return;

  const onset = Math.round(anchors[0].start * SAMPLE_RATE);
  const beginning = Math.round(cue.start * SAMPLE_RATE);
  if (beginning < 0 || onset + 4 * FRAME_SAMPLES > pcm.length / 2) return;
  const voicedLevel = [1, 2, 3].map(frame => frameLevel(pcm, onset + frame * FRAME_SAMPLES))
    .sort((a, b) => a - b)[1];
  if (voicedLevel < MIN_ACTIVE_LEVEL) return;
  // A short noise burst is allowed. Sustained energy before the later
  // article could belong to a first pronunciation, so preserve the cut.
  let activeFrames = 0;
  for (let sample = beginning; sample + 3 * FRAME_SAMPLES <= onset; sample += FRAME_SAMPLES) {
    activeFrames = frameLevel(pcm, sample) > voicedLevel * 0.2 ? activeFrames + 1 : 0;
    if (activeFrames >= 2) return;
  }
  return Number(anchors[0].start.toFixed(3));
}

// Offline experiment. PCM is signed 16-bit mono at 16 kHz and shares the
// video time origin. The pilot adapter continues to use the candidate.
export function alignPilotHybrid(
  original: readonly Subtitle[], candidate: readonly Subtitle[], words: readonly TimedWord[],
  pcm: Buffer, duration: number, language: 'English' | 'Spanish',
) {
  const fallback = () => ({ cues: [...candidate], accepted: 0 });
  if (original.length !== candidate.length || original.some((cue, index) =>
    cue.originalText !== candidate[index].originalText || cue.translatedText !== candidate[index].translatedText)) {
    return fallback();
  }
  const { edges } = alignPilotSequence(original, words, duration, language);
  let accepted = 0;
  const cues = candidate.map((cue, index) => {
    const choose = (side: 'start' | 'end') => {
      const proposal = edges[index][side];
      if (side === 'start' && language === 'English' && proposal.status === 'ambiguous' &&
        index > 0 && candidate[index - 1].end === cue.start) {
        const onset = repeatedArticleStart(cue, words, pcm);
        if (onset !== undefined) {
          accepted++;
          return onset;
        }
      }
      const shift = Math.abs(proposal.time - cue[side]);
      if (proposal.status !== 'moved' || shift <= 0.1 || shift > MAX_SHIFT || !supportsEdge(pcm, proposal.time, side)) {
        return cue[side];
      }
      accepted++;
      return proposal.time;
    };
    return { ...cue, start: choose('start'), end: choose('end') };
  });
  const limit = Number(duration.toFixed(3));
  if (cues.some((cue, index) =>
    cue.start < 0 || cue.end > limit ||
    cue.end - cue.start < Math.min(0.25, candidate[index].end - candidate[index].start) ||
    (index > 0 && cues[index - 1].end > cue.start))) return fallback();
  return { cues, accepted };
}
