import { describe, expect, it } from 'vitest';
import { parseSRT } from '../../utils/helpers';
import { parseHighlights, validHighlight } from './pilotHighlights';
import { convertPilotSubtitle } from './pilotSubtitleImport';
import { activePilotPreset, defaultPilotStyle, parsePilotStyle } from './pilotStyles';
import { previewTimeline } from './web/pilotTracks';

const projectCues = (name: string, content: string) =>
  parseSRT(convertPilotSubtitle(name, content, 5).draft);

describe('pilot subtitle imports and appearance', () => {
  it('sorts LRC timestamps, applies offset and uses gaps or video end', () => {
    const cues = projectCues('lyrics.LRC', [
      '[offset:+100]', '[00:03.10]Buenos días', '[00:00.60]Hello', '[00:00.60]Hello', '[00:01.60]',
    ].join('\n'));
    expect(cues.map(({start, end, translatedText}) => [start, end, translatedText]))
      .toEqual([[0.5, 1.5, 'Hello'], [3, 5, 'Buenos días']]);
  });

  it('converts ASS dialogue while preserving commas, line breaks and Arabic', () => {
    const cues = projectCues('caption.ass', '[Events]\nFormat: Layer, Start, End, Text\n' +
      'Dialogue: 0,0:00:00.50,0:00:02.40,{\\b1}Hola, amigos.\\Nصباح الخير');
    expect(cues[0]).toMatchObject({ start: 0.5, end: 2.4, translatedText: 'Hola, amigos.\nصباح الخير' });
  });

  it('recognizes Android text downloads without renaming either track', () => {
    expect(projectCues('pista-es.lrc.txt', '[00:01.00]Hola')).toMatchObject([
      { start: 1, end: 5, translatedText: 'Hola' },
    ]);
    expect(projectCues('pista-ar.ASS (1).txt', '[Events]\nFormat: Start,End,Text\n' +
      'Dialogue: 0:00:01.00,0:00:02.00,صباح الخير')).toMatchObject([
      { start: 1, end: 2, translatedText: 'صباح الخير' },
    ]);
    expect(() => projectCues('pista-es.lrc.txt', 'texto sin marcas')).toThrow('subtitleVariantUnsupported');
  });

  it('rejects enhanced LRC, ASS drawings and cues outside the clip', () => {
    expect(() => projectCues('a.lrc', '[00:01.00]<00:01.00>Hi')).toThrow('subtitleVariantUnsupported');
    expect(() => projectCues('a.ass', '[Events]\nFormat: Start,End,Text\n' +
      'Dialogue: 0:00:01.00,0:00:02.00,{\\p1}m 0 0 l 5 5')).toThrow('subtitleVariantUnsupported');
    expect(() => projectCues('a.lrc', '[00:06.00]Hi')).toThrow('projectSrtOutside');
  });

  it('validates transform controls and matches legacy presets to equivalent defaults', () => {
    expect(activePilotPreset({ ...defaultPilotStyle, bold: false, scale: 1 }, [])).toBe('styleDefault');
    const style = { ...defaultPilotStyle, bold: true, italic: true, underline: true, letterSpacing: 2,
      lineSpacing: 1.6, scale: 1.2, rotation: -25, opacity: 0.65, anchor: { x: 0.3, y: 0.65 } };
    expect(parsePilotStyle(style)).toEqual(style);
    expect(activePilotPreset({ ...style, presetId: 'styleContrast' }, [{ name: 'Personalizado', style }]))
      .toBe('custom:Personalizado');
    expect(parsePilotStyle({ ...style, rotation: 181 })).toBeUndefined();
    expect(parsePilotStyle({ ...style, bold: 'yes' })).toBeUndefined();
  });

  it('keeps highlights at grapheme boundaries and separates identical cues with different marks', () => {
    expect(validHighlight('بِت', 0, 1)).toBe(false);
    const cues = projectCues('a.lrc', '[00:01.00]Hi\n[00:02.00]Hi');
    expect(parseHighlights([{ cue: 0, start: 0, end: 3 }], cues)).toBeUndefined();
    cues[1].highlights = [{ start: 0, end: 2 }];
    const timeline = previewTimeline({ translated: cues, original: [] }, 'translated', 5);
    expect(timeline).toHaveLength(2);
    expect(timeline[1].highlights).toEqual([{ start: 0, end: 2 }]);
  });
});
