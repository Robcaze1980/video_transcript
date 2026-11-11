import type { SubtitleStyle } from '../../types';

export const pilotFonts = ['sans-serif', 'serif', 'monospace'] as const;
export const pilotAlignments = ['left', 'center', 'right'] as const;
export const pilotFontSize = { min: 12, max: 64 };
export const pilotStyleSwitches = ['bold', 'italic', 'underline'] as const;
export const pilotStyleRanges = {
  letterSpacing: { min: 0, max: 4, step: 1, initial: 0 },
  lineSpacing: { min: 1, max: 2, step: 0.05, initial: 1.3 },
  scale: { min: 0.5, max: 2, step: 0.05, initial: 1 },
  rotation: { min: -180, max: 180, step: 1, initial: 0 },
  opacity: { min: 0, max: 1, step: 0.05, initial: 1 },
} as const;
export const pilotStyleRangeKeys = Object.keys(pilotStyleRanges) as (keyof typeof pilotStyleRanges)[];

export type PilotStyle = SubtitleStyle & {
  fontFamily: typeof pilotFonts[number];
  alignment: typeof pilotAlignments[number];
  presetId?: string;
};
export type SubtitlePreset = { name: string; style: PilotStyle };

export const defaultPilotStyle: PilotStyle = {
  fontSize: 20, fontFamily: 'sans-serif', alignment: 'center', textColor: '#ffffff',
  backgroundColor: '#000000', backgroundOpacity: 0.7, position: 'bottom',
  showBackground: true, textOutline: false, textShadow: true,
};

export const builtinPilotPresets: Record<string, PilotStyle> = {
  styleDefault: defaultPilotStyle,
  styleContrast: { ...defaultPilotStyle, fontSize: 28, textColor: '#ffff66', backgroundOpacity: 0.92, textOutline: true },
  styleEditorial: { ...defaultPilotStyle, fontFamily: 'serif', alignment: 'left', position: 'top', backgroundColor: '#19223b' },
};

const color = /^#[\da-f]{6}$/i;
const appearanceFields = Object.keys(defaultPilotStyle) as (keyof PilotStyle)[];
const styleFields = new Set([...appearanceFields, ...pilotStyleSwitches, ...pilotStyleRangeKeys, 'anchor', 'presetId']);
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function parsePilotStyle(value: unknown): PilotStyle | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !styleFields.has(key))) return;
  const style = value as PilotStyle;
  if (!pilotFonts.includes(style.fontFamily) || !pilotAlignments.includes(style.alignment) ||
      !inRange(style.fontSize, pilotFontSize.min, pilotFontSize.max) || !Number.isInteger(style.fontSize) ||
      typeof style.textColor !== 'string' || !color.test(style.textColor) ||
      typeof style.backgroundColor !== 'string' || !color.test(style.backgroundColor) ||
      !inRange(style.backgroundOpacity, 0, 1) || !['top', 'bottom'].includes(style.position) ||
      typeof style.showBackground !== 'boolean' || typeof style.textOutline !== 'boolean' ||
      typeof style.textShadow !== 'boolean') return;
  if (pilotStyleSwitches.some(key => style[key] !== undefined && typeof style[key] !== 'boolean') ||
      pilotStyleRangeKeys.some(key => style[key] !== undefined &&
        !inRange(style[key], pilotStyleRanges[key].min, pilotStyleRanges[key].max))) return;
  if (style.anchor !== undefined &&
      (!style.anchor || typeof style.anchor !== 'object' || Array.isArray(style.anchor) ||
       Object.keys(style.anchor).length !== 2 || !inRange(style.anchor.x, 0, 1) || !inRange(style.anchor.y, 0, 1))) return;
  if (style.presetId !== undefined &&
      (typeof style.presetId !== 'string' || (!Object.hasOwn(builtinPilotPresets, style.presetId) &&
       (!style.presetId.startsWith('custom:') || !style.presetId.slice(7).trim() ||
        Array.from(style.presetId.slice(7)).length > 48 || /[\x00-\x1f\x7f]/.test(style.presetId))))) return;
  return style;
}

export function activePilotPreset(style: PilotStyle, custom: SubtitlePreset[]) {
  const presets = [...Object.entries(builtinPilotPresets), ...custom.map(preset => ['custom:' + preset.name, preset.style] as const)];
  if (style.presetId && !presets.some(([id]) => id === style.presetId)) return '';
  const matches = presets.filter(([, candidate]) =>
    appearanceFields.every(field => style[field] === candidate[field]) &&
    pilotStyleSwitches.every(key => (style[key] ?? false) === (candidate[key] ?? false)) &&
    pilotStyleRangeKeys.every(key => (style[key] ?? pilotStyleRanges[key].initial) ===
      (candidate[key] ?? pilotStyleRanges[key].initial)) &&
    style.anchor?.x === candidate.anchor?.x && style.anchor?.y === candidate.anchor?.y);
  return (matches.find(([id]) => id === style.presetId) ?? matches[0])?.[0] ?? '';
}
