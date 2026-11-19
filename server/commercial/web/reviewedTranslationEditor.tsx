import React, { useEffect, useRef, useState } from 'react';
import type { CandidateApi } from './cloudCandidateApi';
import { validReviewEdits, type ReviewEdit, type ReviewSource } from './reviewedTranslationClient';

type Pending = Readonly<{ key: string; revision: number; edits: readonly ReviewEdit[] }>;
type Props = {
  // The project uses React's runtime without the optional React type package.
  key?: string;
  api: CandidateApi; inputId: string; jobId: string; disabled: boolean; suspended: boolean;
  checkCurrent: () => void; onSaved: (revision: number, draft: string) => void;
  onAccessLost: () => void;
  onBlockingChange: (blocked: boolean) => void;
};
const seconds = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
const denied = (error: unknown) => [401, 403, 404, 410].includes((error as { status?: number })?.status ?? 0);
function message(error: unknown) {
  const status = (error as { status?: number })?.status;
  if (denied(error)) return 'Ya no tienes acceso a este resultado o dejó de estar disponible. Vuelve a consultar tu cuenta.';
  if (status === 402) return 'No pudimos completar la solicitud por el estado del saldo. Consulta tu cuenta.';
  if (status === 409) return 'Otra acción cambió el proyecto. Conservamos tu edición aquí para que puedas compararla antes de descartarla.';
  if (status === 400) return 'Revisa las frases: no pueden estar vacías, tener saltos de línea ni superar el límite indicado.';
  return 'No pudimos confirmar la respuesta. Puedes volver a intentarlo.';
}

/** Private, local candidate. The parent enables it only in an explicitly built candidate. */
export function ReviewedTranslationEditor({ api, inputId, jobId, disabled, suspended, checkCurrent, onSaved, onAccessLost, onBlockingChange }: Props) {
  const [source, setSource] = useState<ReviewSource>(), [edits, setEdits] = useState<ReviewEdit[]>([]);
  const [pending, setPending] = useState<Pending>(), [conflict, setConflict] = useState(false);
  const [working, setWorking] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const active = useRef(true), busyRef = useRef(false), urls = useRef(new Set<string>()), checkRef = useRef(checkCurrent), savedRef = useRef(onSaved), accessRef = useRef(onAccessLost), blockRef = useRef(onBlockingChange);
  checkRef.current = checkCurrent; savedRef.current = onSaved; accessRef.current = onAccessLost; blockRef.current = onBlockingChange;
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); blockRef.current(false); };
  }, []);
  const ensure = () => { if (!active.current) throw Error('editor_closed'); api.signal.throwIfAborted(); checkRef.current(); };
  const dirty = !!source && source.status !== 'legacy' && edits.some((edit, index) => edit.en !== source.cues[index]?.en);
  useEffect(() => { blockRef.current(!!working || !!pending || conflict || dirty); }, [working, pending, conflict, dirty]);
  useEffect(() => {
    if (!dirty && !pending && !conflict) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pending, conflict]);
  const runnable = !disabled && !suspended && !working;
  const wipe = () => { setSource(undefined); setEdits([]); setPending(undefined); setConflict(false); };
  const showFailure = (failure: unknown, duringSave: boolean) => {
    if (!active.current || api.signal.aborted) return;
    if (['needs_review', 'stale_job_response'].includes((failure as { code?: string }).code ?? '')) { setNotice(duringSave?'El estado del trabajo cambió. Conservamos tus cambios y el mismo intento de guardado en esta página.':'El estado del trabajo cambió. Vuelve a consultar antes de continuar.'); return; }
    if (denied(failure)) { wipe(); accessRef.current(); }
    else if ((failure as { status?: number }).status === 409) { setConflict(true); setPending(undefined); }
    else if (duringSave && (failure as { status?: number }).status === 400) setPending(undefined);
    setError(message(failure));
  };
  async function load(discard: boolean) {
    if (!runnable || busyRef.current || pending || (dirty && !discard)) return;
    if (dirty && discard && !window.confirm('¿Descartar los cambios de esta pantalla y cargar la versión guardada?')) return;
    busyRef.current = true; setWorking('load'); setError(''); setNotice('');
    try {
      ensure(); const loaded = await api.reviewed.load(inputId, jobId, ensure); ensure();
      setSource(loaded); setEdits(loaded.cues.map(cue => ({ id: cue.id, en: cue.en }))); setConflict(false);
      savedRef.current(loaded.projectRevision, loaded.status === 'legacy' ? loaded.legacyDraft ?? '' : loaded.status === 'original' ? '' : loaded.cues.map(cue => cue.en).join('\n') + '\n');
      setNotice(loaded.status === 'legacy' ? 'Tu borrador anterior se conserva sin asignarlo a tiempos.' : loaded.status === 'reviewed' ? 'Revisión guardada cargada.' : 'Traducción original cargada.');
    } catch (failure) { showFailure(failure, false); }
    finally { busyRef.current = false; if (active.current) setWorking(''); }
  }
  async function save() {
    if (!runnable || busyRef.current || conflict || !source || source.status === 'legacy') return;
    const attempt = pending ?? Object.freeze({ key: crypto.randomUUID(), revision: source.projectRevision,
      edits: Object.freeze(edits.map(edit => Object.freeze({ id: edit.id, en: edit.en }))) });
    if (!validReviewEdits(attempt.edits)) { setError('Revisa que las frases tengan texto, no incluyan saltos de línea ni caracteres no admitidos y no sean demasiado largas.'); return; }
    busyRef.current = true; setPending(attempt); setWorking('save'); setError(''); setNotice('');
    try {
      ensure(); const committed = await api.reviewed.save(inputId, jobId, attempt.revision, attempt.key, attempt.edits, ensure);
      const reopened = await api.reviewed.load(inputId, jobId, ensure); ensure();
      if (reopened.status !== 'reviewed' || reopened.projectRevision !== committed || reopened.jobRevision !== source.jobRevision || reopened.durationMs !== source.durationMs || reopened.cues.length !== attempt.edits.length ||
          reopened.cues.some((cue, index) => cue.id !== attempt.edits[index].id || cue.en !== attempt.edits[index].en || cue.index !== source.cues[index]?.index || cue.es !== source.cues[index]?.es || cue.startMs !== source.cues[index]?.startMs || cue.endMs !== source.cues[index]?.endMs)) {
        setPending(undefined); setConflict(true); setError('Tu guardado se confirmó, pero el proyecto volvió a cambiar. Conservamos tu edición para compararla.'); return;
      }
      setSource(reopened); setEdits(reopened.cues.map(cue => ({ id: cue.id, en: cue.en }))); setPending(undefined); setConflict(false);
      savedRef.current(committed, reopened.cues.map(cue => cue.en).join('\n') + '\n');
      setNotice('Revisión guardada y reabierta. Ya puedes descargar los archivos revisados.');
    } catch (failure) { showFailure(failure, true); }
    finally { busyRef.current = false; if (active.current) setWorking(''); }
  }
  async function download(format: 'txt' | 'srt') {
    if (!runnable || busyRef.current || !source || source.status !== 'reviewed' || dirty || pending || conflict) return;
    busyRef.current = true; setWorking('download'); setError(''); setNotice('');
    try {
      ensure(); const blob = await api.reviewed.download(inputId, jobId, source.projectRevision, format, ensure); ensure();
      const url = URL.createObjectURL(blob); urls.current.add(url);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `vistavo-translation.${format}`; anchor.click();
      setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 30000);
    } catch (failure) { showFailure(failure, false); }
    finally { busyRef.current = false; if (active.current) setWorking(''); }
  }
  // Keep the draft in component memory, but remove its text and controls from
  // the DOM until the current job is authorized again.
  if (suspended) return <section className="cv-card" aria-live="polite"><h2>Revisa las frases</h2><p>Este trabajo necesita revisión. Conservamos tus cambios en esta página y los mostraremos cuando puedas continuar.</p></section>;
  return <section className="cv-card cv-review cv-structured-review" aria-labelledby="cv-reviewed-heading">
    <div className="cv-step"><span>03</span><div><h2 id="cv-reviewed-heading">Revisa las frases</h2><p>Español original e inglés · se conservan los tiempos.</p></div></div>
    <p className="cv-help">Esta candidata local descarga la revisión guardada. La voz desde estas frases todavía no está conectada.</p>
    {error && <p className="cv-warning" role="alert">{error}</p>}{notice && <p className="cv-message" role="status">{notice}</p>}
    {!source && <button className="cv-secondary" disabled={!runnable} onClick={() => void load(false)}>Cargar frases</button>}
    {source?.status === 'legacy' && <div className="cv-alert"><p>Hay un borrador anterior sin tiempos vinculados. Se conserva tal como está; no podemos asignarlo automáticamente a estas frases.</p><label htmlFor="cv-legacy-draft">Borrador anterior</label><textarea id="cv-legacy-draft" readOnly value={source.legacyDraft ?? ''}/></div>}
    {source && source.status !== 'legacy' && <>
      <p className="cv-help">Revisión {source.projectRevision} · {source.status === 'reviewed' ? 'guardada' : 'original'}{dirty ? ' · cambios sin guardar' : ''}</p>
      <ol className="cv-cues">{source.cues.map((cue, index) => <li key={cue.id}>
        <p className="cv-cue-time">Frase {index + 1} · {seconds(cue.startMs)}–{seconds(cue.endMs)}</p>
        <p className="cv-cue-es"><span>Español: </span>{cue.es}</p>
        <label htmlFor={'cv-cue-' + index}>Inglés · frase {index + 1}</label>
        <textarea id={'cv-cue-' + index} rows={2} value={edits[index]?.en ?? ''} disabled={!runnable || !!pending || conflict} onChange={event => {
          const value = event.currentTarget.value; setEdits(current => current.map((edit, i) => i === index ? { id: edit.id, en: value } : edit)); setError('');
        }}/>
      </li>)}</ol>
      <p className="cv-help">Escribe cada frase en una sola línea. Si una frase o el texto completo es demasiado largo, acórtalo antes de guardar.</p>
      {!validReviewEdits(edits) && <p className="cv-warning" role="status">Revisa que las frases tengan texto, no incluyan saltos de línea ni caracteres no admitidos y no sean demasiado largas.</p>}
      {(dirty || !!pending || conflict) && <p className="cv-warning" role="status">Si recargas o cierras esta página, los cambios que no se hayan guardado podrían perderse.</p>}
      {pending && <p className="cv-warning" role="status">Guardado sin confirmar. Puedes comprobarlo de nuevo; conservaremos la misma edición.</p>}
      <div className="cv-actions"><button disabled={!runnable || conflict || !validReviewEdits(edits) || (!pending && !dirty && source.status === 'reviewed')} onClick={() => void save()}>{pending ? 'Comprobar mismo guardado' : 'Guardar revisión'}</button>
        <button className="cv-secondary" disabled={!runnable || !!pending} onClick={() => void load(dirty)}>{dirty ? 'Descartar cambios y cargar versión guardada' : 'Volver a cargar revisión'}</button></div>
      <div className="cv-actions"><button className="cv-secondary" disabled={!runnable || source.status !== 'reviewed' || dirty || !!pending || conflict} onClick={() => void download('txt')}>Descargar inglés TXT revisado</button>
        <button className="cv-secondary" disabled={!runnable || source.status !== 'reviewed' || dirty || !!pending || conflict} onClick={() => void download('srt')}>Descargar inglés SRT revisado</button></div>
    </>}
  </section>;
}
