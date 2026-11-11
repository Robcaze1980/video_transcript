import { describe, expect, it, vi } from 'vitest';
import type { Subtitle } from '../../types';
import {
  alignInteriorCueEdges, extendEarlyCueEnds, retryEarlyCueEnds, stabilizeEnglishFinalCue, verifyLateEnglishFinalCue,
  alignMonolingualSharedCuts, delayEnglishStartsAfterSilence, restoreEnglishStartsOverBackground, trimLateMonolingualEnds,
  type TimingWindow,
} from './pilotCueTiming';

const caption: Subtitle = {
  id: 'first', start: 0, end: 2,
  originalText: 'La pieza queda firme en el soporte.',
  translatedText: 'The part stays firmly on the bracket.',
};
const anchor = (start: number) => 'queda firme en el soporte'.split(' ').map((text, index) => ({
  text, start: start + index * 0.2, end: start + (index + 1) * 0.2,
}));

describe('pilot subtitle end timing', () => {
  it('keeps the original start when a stretched conjunction covers background before speech', () => {
    const previous = { ...caption, end: 1 };
    const early = { ...caption, id: 'next', start: 1, end: 2.7, originalText: 'And he came swinging out.' };
    const original = { ...early, start: 1.8 };
    const words = [{ text: 'and', start: 1, end: 1.72 }, { text: 'he', start: 1.72, end: 1.88 }];
    const pcm = Buffer.alloc(3 * 16_000 * 2);
    for (let sample = 0; sample < 3 * 16_000; sample++) {
      pcm.writeInt16LE(sample >= 1.68 * 16_000 ? 1200 : 250, sample * 2);
    }
    expect(restoreEnglishStartsOverBackground([previous, early], [previous, original], words, pcm, 3))
      .toEqual([previous, original]);
    for (let sample = 16_000; sample < 1.12 * 16_000; sample++) pcm.writeInt16LE(1200, sample * 2);
    expect(restoreEnglishStartsOverBackground([previous, early], [previous, original], words, pcm, 3))
      .toEqual([previous, early]);
  });

  it('moves an early start after silence while leaving neighboring and aligned edges alone', () => {
    const left = { ...caption, end: 1 };
    const right = { ...caption, id: 'next', start: 1, end: 2.7, originalText: 'The skylight was not secure.' };
    const reference = 'the skylight was not secure'.split(' ').map((text, index) => ({
      text, start: 1.4 + index * 0.22, end: 1.4 + (index + 1) * 0.22,
    }));
    const pcm = Buffer.alloc(3 * 16_000 * 2);
    for (let sample = 1.54 * 16_000; sample < 2.5 * 16_000; sample++) pcm.writeInt16LE(800, sample * 2);
    expect(delayEnglishStartsAfterSilence([left, right], reference, pcm, 3))
      .toEqual([left, { ...right, start: 1.54 }]);
    const alreadyAligned = { ...right, start: 1.12 };
    expect(delayEnglishStartsAfterSilence([left, alreadyAligned], reference, pcm, 3)).toEqual([left, alreadyAligned]);
    expect(delayEnglishStartsAfterSilence([left, right], reference.slice(1), pcm, 3)).toEqual([left, right]);
  });

  it('restores only the right start when a stretched preposition crosses a quiet gap', () => {
    const left = { ...caption, end: 1 };
    const right = { ...caption, id: 'next', start: 1, end: 2.8, originalText: 'In the service area.' };
    const original = [{ ...left, end: 1.55 }, { ...right, start: 1.55 }];
    const words = [
      { text: 'in', start: 1, end: 2.05 },
      { text: 'the', start: 2.05, end: 2.2 },
      { text: 'service', start: 2.2, end: 2.6 },
    ];
    const pcm = Buffer.alloc(3 * 16_000 * 2);
    for (let sample = 0; sample < 3 * 16_000; sample++) {
      const time = sample / 16_000;
      pcm.writeInt16LE(time < 1.2 || time >= 1.8 ? 1400 : 350, sample * 2);
    }
    expect(restoreEnglishStartsOverBackground([left, right], original, words, pcm, 3))
      .toEqual([left, original[1]]);
    expect(restoreEnglishStartsOverBackground([left, right], original, words.slice(0, 2), pcm, 3))
      .toEqual([left, right]);
    for (let sample = 1.2 * 16_000; sample < 1.8 * 16_000; sample++) pcm.writeInt16LE(1400, sample * 2);
    expect(restoreEnglishStartsOverBackground([left, right], original, words, pcm, 3))
      .toEqual([left, right]);
  });

  it('moves a shared cut only with exact words on both sides and a nearby energy drop', () => {
    const cues = [
      { ...caption, end: 1, originalText: 'لموسم الأعاصير الأطلسية' },
      { ...caption, id: 'next', start: 1, end: 3, originalText: 'العاصفة شبه الاستوائية' },
    ];
    const reference = cues.flatMap(cue => cue.originalText.split(' ')).map((text, index) => ({
      text, start: 1.2 + index * 0.2, end: 1.2 + (index + 1) * 0.2,
    }));
    const pcm = Buffer.alloc(3 * 16_000 * 2);
    for (let sample = 0; sample < 3 * 16_000; sample++) pcm.writeInt16LE(800, sample * 2);
    expect(alignMonolingualSharedCuts(cues, reference, pcm, 3)).toEqual(cues);
    pcm.fill(0, 1.76 * 32_000, 1.84 * 32_000);
    const adjusted = [{ ...cues[0], end: 1.8 }, { ...cues[1], start: 1.8 }];
    expect(alignMonolingualSharedCuts(cues, reference, pcm, 3)).toEqual(adjusted);
    expect(alignMonolingualSharedCuts(cues, reference.slice(3), pcm, 3)).toEqual(cues);
  });

  it('shortens a late end only when the final words are followed by a sustained pause', () => {
    const cue = { ...caption, end: 2.8 };
    const next = { ...caption, id: 'next', start: 2.8, end: 3 };
    const reference = anchor(1);
    const pcm = Buffer.alloc(3 * 16_000 * 2);
    for (let sample = 0; sample < 2 * 16_000; sample++) pcm.writeInt16LE(800, sample * 2);
    expect(trimLateMonolingualEnds([cue, next], reference, pcm, 3))
      .toEqual([{ ...cue, end: 2 }, next]);
    expect(trimLateMonolingualEnds([cue, next], reference.slice(0, -1), pcm, 3)).toEqual([cue, next]);
    const borderline = { ...cue, end: 2.55 };
    expect(trimLateMonolingualEnds([borderline], reference, pcm, 3)).toEqual([borderline]);
    for (let sample = 2 * 16_000; sample < 3 * 16_000; sample++) pcm.writeInt16LE(800, sample * 2);
    expect(trimLateMonolingualEnds([cue, next], reference, pcm, 3)).toEqual([cue, next]);
  });

  it('extends only the end when the spoken phrase is uniquely matched', () => {
    const next = { ...caption, id: 'next', start: 3, end: 4 };
    const result = extendEarlyCueEnds([caption, next], anchor(1.8), 4);
    expect(result).toEqual([{ ...caption, end: 2.8 }, next]);
    expect(result[1]).toBe(next);
  });

  it('preserves ends within tolerance and avoids a later, adjacent utterance', () => {
    for (const reference of [anchor(1.5), anchor(2), anchor(2.1)]) {
      expect(extendEarlyCueEnds([caption], reference, 4)[0]).toBe(caption);
    }
  });

  it('matches earlier words when the subtitle disappears before the final five words', () => {
    const reference = [
      { text: 'pieza', start: 1.6, end: 1.8 },
      ...anchor(2.02),
    ];
    expect(extendEarlyCueEnds([caption], reference, 4)[0]).toEqual({ ...caption, end: 3.02 });
  });

  it('requires an extra exact word when the final five words are too short', () => {
    const short = { ...caption, originalText: 'Figure out how to get to it.' };
    const words = 'out how to get to it'.split(' ').map((text, index) => ({
      text, start: 1.8 + index * 0.15, end: 1.95 + index * 0.15,
    }));
    expect(extendEarlyCueEnds([short], words, 4)).toEqual([{ ...short, end: 2.7 }]);
    expect(extendEarlyCueEnds([short], words.slice(1), 4)).toEqual([short]);
  });

  it('preserves cues when a match is repeated, would overlap, or is out of bounds', () => {
    const next = { ...caption, id: 'next', start: 2.5, end: 4 };
    expect(extendEarlyCueEnds([caption], [...anchor(0.7), ...anchor(1.8)], 4)[0]).toBe(caption);
    expect(extendEarlyCueEnds([caption, next], anchor(1.8), 4)).toEqual([caption, next]);
    expect(extendEarlyCueEnds([caption], anchor(1.8), 2.6)[0]).toBe(caption);
    expect(extendEarlyCueEnds([caption], [...anchor(1.8)].reverse(), 4)[0]).toBe(caption);
  });

  it('moves both sides of an early shared boundary when both phrases match', () => {
    const next = { ...caption, id: 'next', start: 2, end: 4.2, originalText: 'Ahora ajuste la placa con cuidado.' };
    const head = 'Ahora ajuste la placa con cuidado'.split(' ').map((text, index) => ({
      text, start: 2.8 + index * 0.2, end: 3 + index * 0.2,
    }));
    const words = [...anchor(1.8), ...head];
    expect(extendEarlyCueEnds([caption, next], words, 4.2)).toEqual([
      { ...caption, end: 2.8 }, { ...next, start: 2.8 },
    ]);
    expect(extendEarlyCueEnds([caption, next], words.slice(0, -2), 4.2)).toEqual([caption, next]);
    const gapped = { ...next, start: 2.1 };
    expect(extendEarlyCueEnds([caption, gapped], words, 4.2)).toEqual([caption, gapped]);
    const repeated = head.map((word, index) => ({ ...word, start: 0.8 + index * 0.1, end: 0.9 + index * 0.1 }));
    const ambiguous = [...repeated, ...words];
    expect(extendEarlyCueEnds([caption, next], ambiguous, 4.2)).toEqual([caption, next]);
  });

  it('accepts one interior article variant but keeps substantive head changes unchanged', () => {
    const next = { ...caption, id: 'next', start: 2, end: 4.2, originalText: 'With a ladder and trying.' };
    const head = 'With the ladder and trying'.split(' ').map((text, index) => ({
      text, start: 2.8 + index * 0.2, end: 3 + index * 0.2,
    }));
    expect(extendEarlyCueEnds([caption, next], [...anchor(1.8), ...head], 4.2)).toEqual([
      { ...caption, end: 2.8 }, { ...next, start: 2.8 },
    ]);
    const different = { ...next, originalText: 'With a scaffold and trying.' };
    expect(extendEarlyCueEnds([caption, different], [...anchor(1.8), ...head], 4.2)).toEqual([caption, different]);
  });

  it('recovers an exact suffix omitted by the full reading using a bounded window', async () => {
    const reference = anchor(1.8);
    const windows: TimingWindow[] = [];
    const result = await retryEarlyCueEnds([caption], reference.slice(0, 1), 4, async window => {
      windows.push(window);
      return reference;
    });
    expect(windows).toEqual([[0, 4]]);
    expect(result).toEqual([{ ...caption, end: 2.8 }]);
  });

  it('leaves a cue unchanged if the window cannot confirm a unique ending', async () => {
    const reference = anchor(1.8);
    const incomplete = await retryEarlyCueEnds([caption], reference.slice(0, 1), 4,
      async () => reference.slice(0, 4));
    const ambiguous = await retryEarlyCueEnds([caption], reference.slice(0, 1), 4,
      async () => [...anchor(0.7), ...reference]);
    const aligned = { ...caption, end: 2.8 };
    const readWindow = vi.fn(async () => reference);
    const kept = await retryEarlyCueEnds([aligned], reference, 4, readWindow);
    expect(incomplete[0]).toBe(caption);
    expect(ambiguous[0]).toBe(caption);
    expect(kept[0]).toBe(aligned);
    expect(readWindow).not.toHaveBeenCalled();
  });
});

describe('English pilot final subtitle', () => {
  const clipWords = (text: string, from: number) => text.split(' ').map((word, index) => ({
    text: word, start: from + index * 0.2, end: from + (index + 1) * 0.2,
  }));

  it('recovers a verified early end inside the previous deadband', () => {
    const cue = { ...caption, originalText: 'Check the load on each bracket.', end: 2.8 };
    const words = clipWords('check the load on each bracket', 2);
    expect(stabilizeEnglishFinalCue([cue], words, 4)).toEqual([{ ...cue, end: 3.4 }]);
  });

  it('keeps the text and accepts a unique terminal suffix across short function words', () => {
    const cue = { ...caption, originalText: 'Working on a ladder or in a scaffold, you', end: 3.2 };
    const words = clipWords('working on a ladder or on scaffold', 1.2);
    expect(stabilizeEnglishFinalCue([cue], words, 3.6)).toEqual([{ ...cue, end: 2.8 }]);
    expect(stabilizeEnglishFinalCue([cue], [...words, ...clipWords('stop', 2.8)], 3.6)).toEqual([cue]);
    const aligned = { ...cue, end: 2.7 };
    expect(stabilizeEnglishFinalCue([aligned], words, 3.6)).toEqual([aligned]);
    const uncertainTail = { ...cue, end: 3.5 };
    expect(stabilizeEnglishFinalCue([uncertainTail], words, 3.6)).toEqual([uncertainTail]);
    const repeated = clipWords('working ladder scaffold', 2.8);
    expect(stabilizeEnglishFinalCue([cue], [...words, ...repeated], 3.6)).toEqual([cue]);
  });

  it('requires a second terminal reading for a larger shortening', async () => {
    const cue = { ...caption, originalText: 'Check the load on each bracket.', end: 4.1 };
    const words = clipWords('check the load on each bracket', 2);
    const confirmed = await verifyLateEnglishFinalCue([cue], words, 4.4, async () => words);
    expect(confirmed).toEqual([{ ...cue, end: 3.4 }]);
    const laterSpeech = await verifyLateEnglishFinalCue([cue], words, 4.4,
      async () => [...words, ...clipWords('stop', 3.6)]);
    expect(laterSpeech).toEqual([cue]);
  });

  it('matches combined feet and inch abbreviations without changing the subtitle text', async () => {
    const cue = { ...caption, originalText: 'The beam is 12 ft 6 in long.', end: 4.5 };
    const words = clipWords('the beam is 12 feet 6 inches long', 2);
    const corrected = await verifyLateEnglishFinalCue([cue], words, 4.7, async () => words);
    expect(corrected).toEqual([{ ...cue, end: 3.8 }]);
  });
});

it('repairs both edges of an interior cut without changing measurements in the text', () => {
  const first = { ...caption, originalText: 'La pieza queda firme en el soporte.', end: 3 };
  const next = { ...caption, id: 'next', start: 3, end: 5, originalText: '5 piezas quedan sobre la mesa.' };
  const timed = (text: string, from: number) => text.split(' ').map((word, index) => ({
    text: word, start: from + index * 0.2, end: from + (index + 1) * 0.2,
  }));
  const words = [...timed('la pieza queda firme en el soporte', 0.6), ...timed('cinco piezas quedan sobre la mesa', 2.2)];
  expect(alignInteriorCueEdges([first, next], words, 5, true)).toEqual([
    { ...first, end: 2 }, { ...next, start: 2.2 },
  ]);
  expect(alignInteriorCueEdges([first, next], words, 5, false)).toEqual([
    { ...first, end: 2 }, next,
  ]);
  const alreadyAligned = [{ ...first, end: 2.2 }, { ...next, start: 2.3 }];
  expect(alignInteriorCueEdges(alreadyAligned, words, 5, true)).toEqual(alreadyAligned);
});

it('delays the first cue when a unique prefix starts at the first spoken word', () => {
  const cue = { ...caption, originalText: 'Check the load on each bracket.', end: 3 };
  const words = cue.originalText.toLowerCase().split(' ').map((text, index) => ({
    text, start: 0.52 + index * 0.2, end: 0.72 + index * 0.2,
    leadingOnset: index === 0 ? true as const : undefined,
  }));
  expect(alignInteriorCueEdges([cue], words, 3, false)).toEqual([{ ...cue, start: 0.52 }]);
  expect(alignInteriorCueEdges([cue], [{ text: 'listen', start: 0.1, end: 0.3 }, ...words], 3, false))
    .toEqual([cue]);
});
