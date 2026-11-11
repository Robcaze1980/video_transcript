import { describe, expect, it } from 'vitest';
import type { Subtitle } from '../../types';
import { alignPilotHybrid } from './pilotHybridAlignment';

const raw: Subtitle[] = [{
  id: 'test', start: 0.1, end: 2,
  originalText: 'Check the steel bracket', translatedText: 'Revisa el soporte de acero.',
}];
const candidate = [{ ...raw[0], start: 0.2, end: 1.8 }];

function words(text: string, start: number) {
  return text.split(' ').map((word, index) => ({
    text: word, start: start + index * 0.25, end: start + (index + 1) * 0.25,
  }));
}

function signal(start: number, end: number, pcm = Buffer.alloc(3 * 16_000 * 2)) {
  for (let sample = start * 16_000; sample < end * 16_000; sample++) {
    pcm.writeInt16LE(2000, sample * 2);
  }
  return pcm;
}

describe('experimental hybrid pilot alignment', () => {
  it('moves unique lexical edges when both have sustained acoustic transitions', () => {
    expect(alignPilotHybrid(raw, candidate, words('Check the steel bracket', 0.5), signal(0.5, 1.5), 3, 'English'))
      .toEqual({ cues: [{ ...candidate[0], start: 0.5, end: 1.5 }], accepted: 2 });
  });

  it('keeps candidate times when there is no transition near either proposal', () => {
    expect(alignPilotHybrid(raw, candidate, words('Check the steel bracket', 0.5), signal(0, 3), 3, 'English'))
      .toEqual({ cues: candidate, accepted: 0 });
  });

  it('keeps the candidate start when the first word has two lexical matches', () => {
    expect(alignPilotHybrid(raw, candidate, words('Check check the steel bracket', 0.25), signal(0.5, 1.5), 3, 'English'))
      .toEqual({ cues: [{ ...candidate[0], end: 1.5 }], accepted: 1 });
  });

  it('moves a repeated article past a short noise burst while preserving both texts', () => {
    const cues = [
      { ...raw[0], start: 0.1, end: 0.4, originalText: 'Then' },
      { ...raw[0], id: 'next', start: 0.4, end: 1.75, originalText: 'The, the roof collapsed.' },
    ];
    const reference = [{ text: 'Then', start: 0.1, end: 0.4 }, ...words('The roof collapsed.', 1)];
    const pcm = signal(1, 1.75);
    signal(0.405, 0.415, pcm);
    expect(alignPilotHybrid(cues, cues, reference, pcm, 3, 'English'))
      .toEqual({ cues: [cues[0], { ...cues[1], start: 1 }], accepted: 1 });
    signal(0.4, 0.55, pcm);
    expect(alignPilotHybrid(cues, cues, reference, pcm, 3, 'English'))
      .toEqual({ cues, accepted: 0 });
  });
});
