import { expect, it } from 'vitest';
import { activePilotPreset, builtinPilotPresets, parsePilotStyle } from './pilotStyles';

it('shows the saved preset even when two presets have identical styling', () => {
  const style = builtinPilotPresets.styleContrast;
  const custom = [{ name: 'Pixel', style }];
  expect(activePilotPreset(style, custom)).toBe('styleContrast');
  const saved = parsePilotStyle(JSON.parse(JSON.stringify({ ...style, presetId: 'custom:Pixel' })));
  expect(saved).toBeDefined();
  expect(activePilotPreset(saved!, custom)).toBe('custom:Pixel');
  expect(activePilotPreset(saved!, [])).toBe('');
  expect(activePilotPreset({ ...saved!, fontSize: 30 }, custom)).toBe('');
  expect(parsePilotStyle({ ...style, presetId: 'unknown' })).toBeUndefined();
});
