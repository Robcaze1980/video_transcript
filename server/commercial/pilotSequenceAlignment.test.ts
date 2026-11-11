import { describe, expect, it } from 'vitest';
import type { Subtitle } from '../../types';
import { alignPilotSequence } from './pilotSequenceAlignment';

const cue = (id: string, start: number, end: number, originalText: string): Subtitle => ({
  id, start, end, originalText, translatedText: 'Texto de prueba con cerchas y 6 pies.',
});
const words = (text: string, start: number) => text.split(' ').map((word, index) => ({
  text: word, start: start + index * 0.2, end: start + (index + 1) * 0.2,
}));

describe('experimental pilot sequence alignment', () => {
  it('uses matches on both sides of an omitted interior word and preserves both texts', () => {
    const input = [cue('one', 0, 1.5, 'Coloca cinco piezas pequeñas'), cue('two', 1.5, 2.7, 'Revisa el soporte')];
    const reference = [...words('Coloca 5 pequeñas', 0.2), ...words('Revisa el soporte', 1.8)];
    const result = alignPilotSequence(input, reference, 3, 'Spanish');
    expect(result.cues).toEqual([{ ...input[0], start: 0.2, end: 0.8 }, { ...input[1], start: 1.8, end: 2.4 }]);
    expect(alignPilotSequence(input, reference, 3, 'Spanish')).toEqual(result);
  });

  it('keeps the original time when the first word has two equally plausible matches', () => {
    const input = [cue('one', 0.1, 2, 'Check the bracket')];
    const result = alignPilotSequence(input, words('Check check the bracket', 0.3), 3, 'English');
    expect(result.edges[0].start).toEqual({ time: 0.1, status: 'ambiguous' });
    expect(result.cues[0].end).toBe(1.1);
  });

  it('reverts a proposed end that would cross the next ambiguous start', () => {
    const input = [cue('one', 0, 1.2, 'Check the beam'), cue('two', 1.2, 2.8, 'Um check the bracket')];
    const reference = [...words('Check the beam', 0.8), ...words('check the bracket', 1.8)];
    const result = alignPilotSequence(input, reference, 3, 'English');
    expect(result.edges[0].end).toEqual({ time: 1.2, status: 'conflict' });
    expect(result.edges[1].start).toEqual({ time: 1.2, status: 'ambiguous' });
  });

  it('keeps the first cue start when the local word begins at an unverified zero', () => {
    const input = [cue('one', 0.6, 2, 'Check the bracket')];
    const result = alignPilotSequence(input, words('Check the bracket', 0), 3, 'English');
    expect(result.edges[0].start).toEqual({ time: 0.6, status: 'unsupported' });
  });
});
