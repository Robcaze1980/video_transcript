import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { driveCopy } from './driveCopy';
import { CaptionOverlay } from '../../../components/CaptionOverlay';
import type { Subtitle } from '../../../types';
import { generateSRT, parseSRT } from '../../../utils/helpers';
import { panelText, type pilotLocale } from './pilotLocales.js';
import { milliseconds, orderCues, previewCaption, previewTimeline, type Preview, type Track, type Tracks } from './pilotTracks';
import { defaultPilotStyle, parsePilotStyle, type PilotStyle } from '../pilotStyles';
import { PilotStyleControls, type PresetActions } from './PilotStyleControls';
import { convertPilotSubtitle, maxPilotSubtitleBytes } from '../pilotSubtitleImport';
import { parseHighlights, validHighlight, type SavedHighlights } from '../pilotHighlights';

type Locale = ReturnType<typeof pilotLocale>;
export interface CloudExport {
  authorize(): Promise<void>;
  save(blob: Blob, name: string, key: string, signal: AbortSignal, progress: (fraction: number) => void): Promise<{webViewLink: string}>;
  clear(): void;
}

type SaveDraft = (draft: string | undefined, revision: number, originalDraft: string | null | undefined,
  style: PilotStyle | undefined, highlights?: SavedHighlights) => Promise<{ revision: number }>;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function validText(cues: Subtitle[]) {
  return cues.every(cue => cue.translatedText.trim() && !/\n[^\S\n]*\n/.test(cue.translatedText.trim()));
}

function Editor({ source, initial, initialStyle, duration, locale, persistence, presets, reportDirty, demo, cloud }: {
  source: string; initial: Tracks; initialStyle: PilotStyle; duration: number; locale: Locale;
  presets?: PresetActions; reportDirty: (dirty: boolean) => void;
  persistence?: { revision: number; save: SaveDraft };
  demo?: boolean; cloud?: CloudExport;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const correction = useRef<HTMLTextAreaElement>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);
  const exportController = useRef<AbortController | null>(null);
  const [tracks, setTracks] = useState(initial);
  const [track, setTrack] = useState<Track>(initial.translated.length || !initial.original.length ? 'translated' : 'original');
  const [preview, setPreview] = useState<Preview>(initial.original.length && initial.translated.length ? 'both' : track);
  const cues = tracks[track];
  const [selected, setSelected] = useState<string>();
  const [search, setSearch] = useState('');
  const [time, setTime] = useState(0);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [sourceBytes, setSourceBytes] = useState<number>();
  const [sourceDuration, setSourceDuration] = useState(duration);
  // Large-file ingestion is verified independently from the existing browser render profile.
  const mp4Profile = sourceBytes !== undefined && sourceBytes <= 1048576 && sourceDuration > 0 && sourceDuration <= 30;
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    void fetch(source, { headers: { Range: 'bytes=0-0' }, signal: controller.signal }).then(async response => {
      const total = /^bytes \d+-\d+\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '')?.[1];
      const length = Number(total ?? response.headers.get('Content-Length'));
      await response.body?.cancel();
      if (response.ok && Number.isSafeInteger(length) && length > 0) setSourceBytes(length);
    }).catch(() => {});
    return () => controller.abort();
  }, [source, demo]);
  const [subtitleStyle, setStyle] = useState(initialStyle);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [saved, setSaved] = useState(() => ({ tracks: initial, style: initialStyle, revision: persistence?.revision ?? 0 }));
  const [undo, setUndo] = useState<{ tracks: Tracks; style: PilotStyle }>();
  const [message, setMessage] = useState<[string, ...Array<string | number>]>();
  const t = locale.text;
  const dc = driveCopy(locale.id);
  const [cloudStatus, setCloudStatus] = useState('');
  const [cloudLink, setCloudLink] = useState('');
  const srtBlob = useMemo(() => new Blob([generateSRT(cues)], { type: 'application/x-subrip' }), [cues]);
  const srtKey = useMemo(() => crypto.randomUUID(), [srtBlob]);
  const lastMp4 = useRef<{ tracks: Tracks; style: PilotStyle; preview: Preview; blob: Blob; key: string }>();
  useEffect(() => () => { cloud?.clear(); lastMp4.current = undefined; }, [cloud]);
  async function saveSrtToDrive() {
    if (!cloud || exportController.current) return;
    const controller = new AbortController(); exportController.current = controller; setBusy(true); setCloudLink('');
    try {
      await cloud.authorize();
      const result = await cloud.save(srtBlob, track === 'original' ? 'linguistvision-original.srt' : 'linguistvision.srt',
        srtKey, controller.signal, progress => setCloudStatus(dc[2] + ' ' + Math.round(progress * 100) + '%'));
      setCloudLink(result.webViewLink); setCloudStatus(dc[3]);
    } catch (error) { setCloudStatus(controller.signal.aborted ? dc[4] : dc[5] + (locale.id === 'es' && error instanceof Error && !error.message.startsWith('drive_') ? ' ' + error.message : '')); }
    finally { exportController.current = null; setBusy(false); }
  }
  const dirty = Boolean(!demo && (tracks !== saved.tracks || subtitleStyle !== saved.style));
  useEffect(() => { reportDirty(dirty || saving); }, [dirty, reportDirty, saving]);
  useEffect(() => () => exportController.current?.abort(), []);
  const active = useMemo(() => previewCaption(tracks, preview, time), [tracks, preview, time]);
  const selectedCue = cues.find(cue => cue.id === selected);
  const matches = useMemo(() => cues.filter(cue =>
    cue.translatedText.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [cues, search]);

  async function saveDraft(replacement?: File) {
    if (!persistence || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setMessage(['projectSaving']);
    try {
      let nextTracks = tracks;
      let drafts = { translated: generateSRT(tracks.translated), original: generateSRT(tracks.original) };
      if (replacement) {
        let content: string;
        try {
          if (!replacement.size || replacement.size > maxPilotSubtitleBytes) throw new Error();
          content = new TextDecoder('utf-8', { fatal: true }).decode(await replacement.arrayBuffer());
        } catch {
          throw Object.assign(new Error(), { key: 'projectSrtInvalid' });
        }
        let converted: ReturnType<typeof convertPilotSubtitle>;
        try { converted = convertPilotSubtitle(replacement.name, content, duration); }
        catch (error) { throw Object.assign(error as Error, { key: (error as Error).message }); }
        const imported = parseSRT(converted.draft);
        if (!imported.length) throw Object.assign(new Error(), { key: 'projectSrtInvalid' });
        const summary = converted.format.toUpperCase() + ' · ' + t('subtitleSegmentCount', imported.length);
        if (!window.confirm([t('projectReplaceConfirm'), summary, imported[0].translatedText.slice(0, 140)].join('\n'))) {
          setMessage(undefined);
          return;
        }
        drafts = { ...drafts, [track]: converted.draft };
        nextTracks = { ...tracks, [track]: imported };
      }
      if (!validText(nextTracks.original) || !validText(nextTracks.translated)) {
        throw Object.assign(new Error(), { key: 'projectSrtInvalid' });
      }
      const { revision } = await persistence.save(
        nextTracks.translated !== saved.tracks.translated ? drafts.translated : undefined,
        saved.revision,
        nextTracks.original !== saved.tracks.original ? drafts.original || null : undefined,
        subtitleStyle !== saved.style ? subtitleStyle : undefined,
        Object.fromEntries((['translated', 'original'] as const).filter(key => nextTracks[key] !== saved.tracks[key])
          .map(key => [key, nextTracks[key].flatMap((cue, index) => (cue.highlights ?? []).map(mark => ({ ...mark, cue: index })))])),
      );
      if (replacement) {
        setUndo({ tracks, style: subtitleStyle });
        setTracks(nextTracks);
        setSelected(undefined);
        setSearch('');
      }
      setSaved({ tracks: nextTracks, style: subtitleStyle, revision });
      setMessage(['projectSaved']);
    } catch (error) {
      const key = (error as { key?: string })?.key;
      setMessage([key || 'projectSaveError']);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  function changeCues(next: Subtitle[]) {
    if (persistence) setUndo({ tracks, style: subtitleStyle });
    setTracks({ ...tracks, [track]: orderCues(next) });
    setMessage(undefined);
  }

  function changeStyle(next: PilotStyle) {
    if (saveInFlight.current) return;
    if (persistence) setUndo({ tracks, style: subtitleStyle });
    setStyle(next);
    setMessage(undefined);
  }

  function highlightSelection(remove: boolean) {
    const input = correction.current;
    if (!input || !selectedCue) return;
    const text = input.value.trim();
    const leading = input.value.length - input.value.trimStart().length;
    const start = Math.max(0, input.selectionStart - leading);
    const end = Math.min(text.length, input.selectionEnd - leading);
    if (!remove && !validHighlight(text, start, end)) {
      setMessage(['highlightSelect']);
      return;
    }
    changeCues(cues.map(cue => cue === selectedCue ? { ...cue, highlights: remove ? undefined : [{ start, end }] } : cue));
  }

  function setTimes() {
    if (!selectedCue || !startInput.current || !endInput.current) return;
    const rawStart = startInput.current.valueAsNumber;
    const start = milliseconds(rawStart);
    const end = milliseconds(endInput.current.valueAsNumber);
    if (!(rawStart >= 0 && start < end && end <= milliseconds(demo ? video.current?.duration ?? 0 : duration))) {
      setMessage(['cueInvalidTime']);
      return;
    }
    changeCues(cues.map(cue => cue === selectedCue ? { ...cue, start, end } : cue));
  }

  function addCue() {
    const start = milliseconds(video.current?.currentTime ?? 0);
    const end = Math.min(milliseconds(duration), milliseconds(start + 2));
    if (!(start < end) || cues.length >= 1000) { setMessage(['cueInvalidTime']); return; }
    const id = crypto.randomUUID();
    changeCues([...cues, { id, start, end, translatedText: '', originalText: '' }]);
    setSelected(id);
    setSearch('');
  }

  function splitCue() {
    if (!selectedCue || !correction.current) return;
    const split = milliseconds(video.current?.currentTime ?? 0);
    const caret = correction.current.selectionStart;
    const before = selectedCue.translatedText.slice(0, caret).trim();
    const after = selectedCue.translatedText.slice(caret).trim();
    if (!(selectedCue.start < split && split < selectedCue.end) || !before || !after || cues.length >= 1000) {
      setMessage(['cueInvalidSplit']);
      return;
    }
    changeCues(cues.flatMap(cue => cue === selectedCue ? [
      { ...cue, end: split, translatedText: before, highlights: undefined },
      { ...cue, id: crypto.randomUUID(), start: split, translatedText: after, highlights: undefined },
    ] : [cue]));
  }

  function mergeCue() {
    if (!selectedCue) return;
    const next = cues[cues.indexOf(selectedCue) + 1];
    if (!next) return;
    changeCues(cues.filter(cue => cue !== next).map(cue => cue === selectedCue ? {
      ...cue, end: Math.max(cue.end, next.end),
      highlights: undefined,
      translatedText: [cue.translatedText.trim(), next.translatedText.trim()].filter(Boolean).join('\n'),
    } : cue));
  }

  async function exportMp4(toDrive = false) {
    if (!video.current || !canvas.current || !size || !mp4Profile || exportController.current) return;
    const duration = video.current.duration;
    const controller = new AbortController();
    exportController.current = controller;
    video.current.pause();
    setBusy(true);
    try {
      setCloudLink('');
      if (toDrive) { if (!cloud) throw new Error('Drive unavailable.'); await cloud.authorize(); }
      setMessage(['mp4Preparing']);
      const started = performance.now();
      const cached = lastMp4.current;
      let blob: Blob;
      if (cached && cached.tracks === tracks && cached.style === subtitleStyle && cached.preview === preview) blob = cached.blob;
      else {
      const response = await fetch(source, { signal: controller.signal });
      if (!response.ok) throw new Error('The original video is no longer available.');
      const { renderTimedSubtitlesMp4 } = await import('../../../utils/ffmpegUtil');
      blob = await renderTimedSubtitlesMp4({
        source: await response.blob(), canvas: canvas.current, ...size, duration,
        subtitles: previewTimeline(tracks, preview, duration), style: subtitleStyle, signal: controller.signal,
        onProgress: progress => setMessage(['mp4Progress', Math.round(progress * 100)]),
      });
      lastMp4.current = { tracks, style: subtitleStyle, preview, blob, key: crypto.randomUUID() };
      }
      controller.signal.throwIfAborted();
      if (toDrive && cloud) {
        const result = await cloud.save(blob, 'linguistvision.mp4', lastMp4.current!.key, controller.signal,
          progress => setCloudStatus(dc[2] + ' ' + Math.round(progress * 100) + '%'));
        setCloudLink(result.webViewLink); setCloudStatus(dc[3]);
      } else download(blob, 'linguistvision.mp4');
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      setMessage(['mp4Done', seconds, blob.size]);
    } catch (error) {
      if (toDrive) setCloudStatus(controller.signal.aborted ? dc[4] : dc[5] + (locale.id === 'es' && error instanceof Error && !error.message.startsWith('drive_') ? ' ' + error.message : ''));
      setMessage([controller.signal.aborted ? 'exportCancelled' : 'mp4Error']);
    } finally {
      exportController.current = null;
      setBusy(false);
    }
  }

  return <div className="pilot-editor">
    <h3>{t('review')}</h3>
    <div className="editor-stage">
      <video ref={video} src={source} controls={!busy} playsInline preload="metadata"
        onLoadedMetadata={event => {
          const { videoWidth: width, videoHeight: height } = event.currentTarget;
          setSourceDuration(event.currentTarget.duration);
          if (width && height) setSize({ width, height });
        }}
        onTimeUpdate={event => setTime(event.currentTarget.currentTime)} />
      {size && !busy && <CaptionOverlay text={active.text} highlights={active.highlights} style={subtitleStyle}
        videoSize={size} onMove={anchor => changeStyle({ ...subtitleStyle, anchor })}
        labels={{ inactive: t('noCaption'), move: t('move'), help: t('moveHelp') }} />}
    </div>
    <canvas ref={canvas} hidden />
    <fieldset disabled={busy || saving}>
      {!demo && <>
      <label htmlFor="subtitle-track">{t('editTrack')}</label>
      <select id="subtitle-track" value={track} onChange={event => {
        const next = event.target.value as Track;
        setTrack(next);
        setSelected(undefined);
        setSearch('');
      }}>
        <option value="translated">{t('translatedTrack')}</option>
        <option value="original">{t('originalTrack')}</option>
      </select>
      <label htmlFor="subtitle-preview">{t('previewTracks')}</label>
      <select id="subtitle-preview" value={preview} onChange={event => setPreview(event.target.value as Preview)}>
        <option value="translated">{t('translatedTrack')}</option>
        <option value="original">{t('originalTrack')}</option>
        <option value="both">{t('bothTracks')}</option>
      </select>
      </>}
      <label htmlFor="subtitle-search">{t('search')}</label>
      <input id="subtitle-search" type="search" value={search} onChange={event => setSearch(event.target.value)} />
      <ul className="subtitle-matches">
        {matches.map(cue => <li key={cue.id}>
          <button type="button" aria-pressed={selected === cue.id} onClick={() => {
            setSelected(cue.id);
            if (!video.current || !size) return;
            video.current.pause();
            video.current.currentTime = cue.start;
            setTime(cue.start);
          }}><bdi>{cue.start.toFixed(2)} s</bdi> · <bdi>{cue.translatedText}</bdi></button>
        </li>)}
      </ul>
      {selectedCue && <>
        <label htmlFor="subtitle-correction">{t('correct')}</label>
        <textarea id="subtitle-correction" ref={correction} dir="auto" value={selectedCue.translatedText}
          onChange={event => changeCues(cues.map(cue => cue === selectedCue ? {
            ...cue, translatedText: event.target.value, highlights: undefined,
          } : cue))} />
        {persistence && <>
          <div className="actions">
            <button type="button" onClick={() => highlightSelection(false)}>{t('highlightAdd')}</button>
            <button type="button" disabled={!selectedCue.highlights?.length}
              onClick={() => highlightSelection(true)}>{t('highlightRemove')}</button>
          </div>
          {selectedCue.highlights?.length ? <p><mark dir="auto">{selectedCue.translatedText.trim().slice(
            selectedCue.highlights[0].start, selectedCue.highlights[0].end)}</mark></p> : null}
        </>}
        {(persistence || demo) && <div className="actions" key={selectedCue.id + ':' + selectedCue.start + ':' + selectedCue.end}>
            <label>{t('cueStart')} <input ref={startInput} type="number" min="0" step="0.001" defaultValue={selectedCue.start} /></label>
            <label>{t('cueEnd')} <input ref={endInput} type="number" min="0" step="0.001" defaultValue={selectedCue.end} /></label>
            <div className="cue-time-controls">{(['start', 'end'] as const).map(edge => <React.Fragment key={edge}>
              {[-0.1, 0.1].map(delta => <button key={delta} type="button" onClick={() => {
                const input = edge === 'start' ? startInput.current : endInput.current;
                if (!input) return;
                input.value = String(milliseconds(Math.max(0, input.valueAsNumber + delta)));
                setTimes();
              }}>{panelText(locale.id, edge === 'start' ? 'timeStart' : 'timeEnd')} {delta > 0 ? '+' : '−'} 0.1 s</button>)}
              <button type="button" onClick={() => {
                const input = edge === 'start' ? startInput.current : endInput.current;
                if (!input || !video.current) return;
                input.value = String(milliseconds(video.current.currentTime)); setTimes();
              }}>{panelText(locale.id, edge === 'start' ? 'timeStart' : 'timeEnd')}: {panelText(locale.id, 'currentTime')}</button>
            </React.Fragment>)}</div>
            <button type="button" onClick={setTimes}>{t('cueApplyTimes')}</button>
        </div>}
        {persistence && <>
          <div className="actions">
            <button type="button" onClick={splitCue}>{t('cueSplit')}</button>
            <button type="button" disabled={cues.at(-1) === selectedCue} onClick={mergeCue}>{t('cueMerge')}</button>
            <button type="button" onClick={() => {
              changeCues(cues.filter(cue => cue !== selectedCue));
              setSelected(undefined);
            }}>{t('cueDelete')}</button>
          </div>
        </>}
      </>}
      {persistence && <>
        {presets && <PilotStyleControls style={subtitleStyle} change={changeStyle} presets={presets} locale={locale} />}
        <button type="button" onClick={addCue}>{t('cueAdd')}</button>
        <div className="actions editor-save-bar">
          <button type="button" disabled={!dirty} onClick={() => void saveDraft()}>{t('projectSave')}</button>
          <button type="button" className="secondary" disabled={!undo} onClick={() => {
            if (undo) {
              setTracks(undo.tracks);
              setStyle(undo.style);
            }
            setUndo(undefined);
          }}>{t('projectUndo')}</button>
        </div>
        <label htmlFor="project-replace">{t('projectReplace')}</label>
        <input id="project-replace" type="file" onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void saveDraft(file);
        }} />
        <p>{t('subtitleImportHelp')}</p>
        <p role="status">{t(dirty ? 'projectUnsaved' : 'projectSaved')}</p>
      </>}
      <div className="actions">
        <button type="button" disabled={!cues.length || !validText(cues)}
          onClick={() => download(new Blob([generateSRT(cues)], { type: 'application/x-subrip' }),
            track === 'original' ? 'linguistvision-original.srt' : 'linguistvision.srt')}>{t('srt')}</button>
        {!demo && <button type="button" disabled={!size || !mp4Profile || !(preview === 'both' ? tracks.original.length || tracks.translated.length : tracks[preview].length)}
          onClick={() => void exportMp4()}>{t('mp4')}</button>}
        {!demo && cloud && <>
          <button type="button" disabled={!cues.length || !validText(cues)} onClick={() => void saveSrtToDrive()}>{dc[0]}</button>
          <button type="button" disabled={!size || !mp4Profile || !(preview === 'both' ? tracks.original.length || tracks.translated.length : tracks[preview].length)} onClick={() => void exportMp4(true)}>{dc[1]}</button>
        </>}
      </div>
      {!demo && <p className="download-help">{panelText(locale.id, 'downloadsHelp')}</p>}
      {!demo && sourceBytes !== undefined && !mp4Profile && <p role="status">{locale.id === 'es'
        ? 'Puedes editar y guardar el SRT. La exportación MP4 de videos grandes sigue pendiente de validación; el perfil actual es de hasta 1 MiB y 30 segundos.'
        : 'You can edit and save the SRT. Large-video MP4 export is still awaiting validation; the current profile is up to 1 MiB and 30 seconds.'}</p>}
    </fieldset>
    {busy && <button type="button" onClick={() => exportController.current?.abort()}>{t('cancelExport')}</button>}
    <p role="status">{message && t(...message)}</p>
    {!demo && cloud && <p role="status">{cloudStatus} {cloudLink && <a href={cloudLink} target="_blank" rel="noopener noreferrer">{dc[3]}</a>}</p>}
  </div>;
}

function Project({ source, subtitles, originalSubtitles, locale, save, presets, reportDirty, demo, cloud }: {
  source: string; subtitles: string; originalSubtitles?: string; locale: Locale; save?: SaveDraft;
  presets?: PresetActions; reportDirty: (dirty: boolean) => void;
  demo?: boolean; cloud?: CloudExport;
}) {
  const [loaded, setLoaded] = useState<{ tracks: Tracks; style: PilotStyle; revision: number; duration: number }>();
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void fetch(subtitles, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error(save ? 'projectUnavailable' : 'srtUnavailable');
      const { draft, originalDraft, revision, duration, style, highlights } = save ? await response.json() :
        { draft: await response.text(), originalDraft: null, revision: 0, duration: 0, style: null };
      let original = originalDraft;
      if (originalSubtitles) {
        const response = await fetch(originalSubtitles, { signal: abort.signal });
        if (response.ok) original = await response.text();
        else if (response.status !== 404) throw new Error('srtUnavailable');
      }
      const tracks = { translated: parseSRT(draft), original: original ? parseSRT(original) : [] };
      for (const track of ['translated', 'original'] as const) {
        for (const { cue, start, end } of parseHighlights(highlights?.[track], tracks[track]) ?? []) {
          tracks[track][cue].highlights = [{ start, end }];
        }
      }
      if (!save && !tracks.translated.length && !tracks.original.length) throw new Error('srtInvalid');
      setLoaded({ tracks, style: parsePilotStyle(style) ?? defaultPilotStyle, revision, duration });
    }).catch(error => {
      if (!abort.signal.aborted) setError(error.message === 'srtInvalid' ? 'srtInvalid' :
        save ? 'projectUnavailable' : 'srtUnavailable');
    });
    return () => abort.abort();
  }, [subtitles, originalSubtitles, save]);
  return loaded ? <Editor source={source} initial={loaded.tracks} initialStyle={loaded.style} duration={loaded.duration}
    locale={locale} presets={presets} reportDirty={reportDirty} demo={demo} cloud={cloud}
    persistence={save ? { revision: loaded.revision, save } : undefined} /> :
    <p role="status">{locale.text(error || 'srtLoading')}</p>;
}

export function mountEditor(element: HTMLElement, source: string, subtitles: string, locale: Locale, save?: SaveDraft,
  originalSubtitles?: string, presets?: PresetActions, demo = false, cloud?: CloudExport) {
  const root = createRoot(element);
  let dirty = false;
  const reportDirty = (value: boolean) => { dirty = value; };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  };
  if (!demo) window.addEventListener('beforeunload', beforeUnload);
  const setLocale = (next: Locale) => root.render(
    <Project source={source} subtitles={subtitles} originalSubtitles={originalSubtitles} locale={next}
      save={save} presets={presets} reportDirty={reportDirty} demo={demo} cloud={cloud} />,
  );
  setLocale(locale);
  return { setLocale, hasUnsavedChanges: () => dirty, unmount: () => {
    window.removeEventListener('beforeunload', beforeUnload);
    root.unmount();
  } };
}
