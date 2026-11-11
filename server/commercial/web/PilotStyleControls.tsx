import React, { useEffect, useState } from 'react';
import type { pilotLocale } from './pilotLocales.js';
import {
  activePilotPreset, builtinPilotPresets, pilotAlignments, pilotFonts, pilotFontSize, type PilotStyle, type SubtitlePreset,
  pilotStyleRanges, pilotStyleRangeKeys, pilotStyleSwitches,
} from '../pilotStyles';

export interface PresetActions {
  list: () => Promise<SubtitlePreset[]>;
  save: (preset: SubtitlePreset) => Promise<unknown>;
  remove: (name: string) => Promise<unknown>;
}

export function PilotStyleControls({ style, change, presets, locale }: {
  style: PilotStyle; change: (style: PilotStyle) => void; presets: PresetActions; locale: ReturnType<typeof pilotLocale>;
}) {
  const t = locale.text;
  const anchor = style.anchor ?? { x: 0.5, y: style.position === 'top' ? 0.18 : 0.82 };
  const [custom, setCustom] = useState<SubtitlePreset[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let active = true;
    void presets.list().then(items => { if (active) setCustom(items); })
      .catch(() => { if (active) setStatus('presetError'); });
    return () => { active = false; };
  }, [presets]);

  async function updatePreset(remove: boolean) {
    const trimmed = name.trim();
    if (busy || !trimmed) return;
    const existing = custom.some(preset => preset.name === trimmed);
    if ((remove || existing) && !window.confirm(t(remove ? 'presetDeleteConfirm' : 'presetReplaceConfirm'))) return;
    setBusy(true);
    try {
      if (remove) await presets.remove(trimmed);
      else await presets.save({ name: trimmed, style: { ...style, presetId: undefined } });
      setCustom(await presets.list());
      setStatus(remove ? 'presetDeleted' : 'presetSaved');
    } catch (error) {
      setStatus((error as { key?: string }).key || 'presetError');
    } finally {
      setBusy(false);
    }
  }

  return <details className="style-controls">
    <summary>{t('styleControls')}</summary>
    <label htmlFor="subtitle-preset">{t('presetApply')}</label>
    <select id="subtitle-preset" value={activePilotPreset(style, custom)} onChange={event => {
      const id = event.target.value;
      const preset = id.startsWith('custom:') ? custom.find(item => item.name === id.slice(7)) : undefined;
      const next = preset?.style ?? builtinPilotPresets[id];
      if (!next) return;
      change({ ...next, presetId: id });
      if (preset) setName(preset.name);
    }}>
      <option value="" disabled>{t('presetCustomStyle')}</option>
      {Object.keys(builtinPilotPresets).map(key => <option key={key} value={key}>{t(key)}</option>)}
      {custom.map(preset => <option key={preset.name} value={'custom:' + preset.name}>{preset.name}</option>)}
    </select>
    <div className="style-grid">
      <label>{t('styleFont')}
        <select id="subtitle-font" value={style.fontFamily}
          onChange={event => change({ ...style, fontFamily: event.target.value as PilotStyle['fontFamily'] })}>
          {pilotFonts.map(font => <option key={font} value={font}>{t('font-' + font)}</option>)}
        </select>
      </label>
      <label>{t('styleSize')} <output>{style.fontSize}</output>
        <input id="subtitle-size" type="range" min={pilotFontSize.min} max={pilotFontSize.max} value={style.fontSize}
          onChange={event => change({ ...style, fontSize: event.target.valueAsNumber })} />
      </label>
      <label>{t('styleTextColor')}
        <input id="subtitle-color" type="color" value={style.textColor}
          onChange={event => change({ ...style, textColor: event.target.value })} />
      </label>
      <label>{t('styleBackgroundColor')}
        <input id="subtitle-background" type="color" value={style.backgroundColor}
          onChange={event => change({ ...style, backgroundColor: event.target.value })} />
      </label>
      <label>{t('styleOpacity')} <output>{Math.round(style.backgroundOpacity * 100)}%</output>
        <input id="subtitle-opacity" type="range" min="0" max="100" value={Math.round(style.backgroundOpacity * 100)}
          onChange={event => change({ ...style, backgroundOpacity: event.target.valueAsNumber / 100 })} />
      </label>
      <label>{t('styleAlign')}
        <select id="subtitle-alignment" value={style.alignment}
          onChange={event => change({ ...style, alignment: event.target.value as PilotStyle['alignment'] })}>
          {pilotAlignments.map(alignment => <option key={alignment} value={alignment}>{t('align-' + alignment)}</option>)}
        </select>
      </label>
      <label>{t('stylePosition')}
        <select id="subtitle-position" value={style.anchor ? 'custom' : style.position} onChange={event => {
          const position = event.target.value as PilotStyle['position'];
          change({ ...style, position, anchor: undefined });
        }}>
          <option value="top">{t('styleTop')}</option>
          <option value="bottom">{t('styleBottom')}</option>
          {style.anchor && <option value="custom" disabled>{t('styleCustomPosition')}</option>}
        </select>
      </label>
      {pilotStyleRangeKeys.map(key => {
        const { min, max, step, initial } = pilotStyleRanges[key];
        const value = style[key] ?? initial;
        return <label key={key}>{t(key)} <output>{key === 'opacity' ? Math.round(value * 100) + '%' : value}</output>
          <input id={key === 'opacity' ? 'subtitle-caption-opacity' : 'subtitle-' + key}
            type="range" min={min} max={max} step={step} value={value}
            onChange={event => change({ ...style, [key]: event.target.valueAsNumber })} />
        </label>;
      })}
      {(['x', 'y'] as const).map(axis => <label key={axis}>{t('styleAxis-' + axis)}
        <output> {style.anchor ? Math.round(anchor[axis] * 100) + '%' : '—'}</output>
        <input id={'subtitle-axis-' + axis} type="range" min="0" max="100" value={Math.round(anchor[axis] * 100)}
          onChange={event => change({ ...style, anchor: { ...anchor, [axis]: event.target.valueAsNumber / 100 } })} />
      </label>)}
    </div>
    <div className="actions">
      {(['showBackground', 'textOutline', 'textShadow', ...pilotStyleSwitches] as const).map(key => <label key={key} className="style-check">
        <input type="checkbox" checked={style[key] ?? false} onChange={event => change({ ...style, [key]: event.target.checked })} />
        {t(key)}
      </label>)}
    </div>
    <label htmlFor="subtitle-preset-name">{t('presetName')}</label>
    <input id="subtitle-preset-name" type="text" maxLength={48} dir="auto" value={name}
      onChange={event => setName(event.target.value)} />
    <div className="actions">
      <button type="button" disabled={busy || !name.trim()} onClick={() => void updatePreset(false)}>{t('presetSave')}</button>
      <button type="button" className="secondary" disabled={busy || !custom.some(item => item.name === name.trim())}
        onClick={() => void updatePreset(true)}>{t('presetDelete')}</button>
    </div>
    <p aria-live="polite" className="preset-status">{status && t(status)}</p>
  </details>;
}
