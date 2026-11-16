import { recoverTextRequest } from './textRequest';
import React, { useEffect, useRef, useState } from 'react';

export const VOICE_IDS = ['Kore', 'Charon'] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

export interface VoicePipelineApi {
  latest(): Promise<any>;
  start(revision: number, requestKey: string): Promise<any>;
  get(id: string): Promise<any>;
  cancel(id: string): Promise<any>;
  audio(id: string): string;
  reload(): Promise<void>;
}

interface VoiceJob {
  id: string;
  state: string;
  stale?: boolean;
}

interface VoiceNarration {
  byteSize: number;
  durationMs: number;
  voiceId: VoiceId;
  revision: number;
  current: boolean;
}

interface VoicePayload {
  job?: VoiceJob;
  narration?: VoiceNarration | null;
}

const STATUS: Record<string, [string, string]> = {
  queued: ['En cola', 'Queued'],
  running: ['Narrando en inglés', 'Narrating in English'],
  succeeded: ['Listo para escuchar', 'Ready to listen'],
  failed: ['No se pudo completar', 'Could not complete'],
  unknown: ['Necesita revisión', 'Needs review'],
  cancelled: ['Cancelado', 'Cancelled'],
};

const VOICE_LABEL: Record<VoiceId, [string, string]> = {
  Kore: ['Kore (femenina)', 'Kore (female)'],
  Charon: ['Charon (masculina)', 'Charon (male)'],
};

/**
 * English narration controls. The api passed in is already bound to a single allowlisted voice,
 * which is what lets the shared recoverTextRequest helper provide idempotent retries.
 */
export function VoicePipelineControls({ api, voiceId, onSelectVoice, revision, dirty, spanish }: {
  api: VoicePipelineApi;
  voiceId: VoiceId;
  onSelectVoice(voiceId: VoiceId): void;
  revision: number;
  dirty: boolean;
  spanish: boolean;
}) {
  const [data, setData] = useState<VoicePayload>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const copy = (es: string, en: string) => (spanish ? es : en);

  useEffect(() => {
    key.current = crypto.randomUUID();
    setData(undefined);
    setError('');
    let live = true;
    void api.latest()
      .then(value => { if (live) setData(value as VoicePayload); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [api,revision]);

  const job = data?.job;
  const pending = Boolean(job && (job.state === 'queued' || job.state === 'running'));

  useEffect(() => {
    if (!pending || !job) return;
    let live = true;
    const timer = setInterval(() => {
      void api.get(job.id)
        .then(value => { if (live) setData(value as VoicePayload); })
        .catch(() => { if (live) setError(copy('No se pudo actualizar el estado.', 'Could not refresh status.')); });
    }, 1000);
    return () => { live = false; clearInterval(timer); };
  }, [pending, job?.id, api]);

  async function start() {
    setWorking(true);
    setError('');
    try {
      await recoverTextRequest(api, revision, key, value => setData(value as VoicePayload));
    } catch {
      setError(copy(
        'No se pudo solicitar. Reintenta para recuperar la misma solicitud.',
        'Request failed. Retry to recover the same request.',
      ));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section aria-label={copy('Narración en inglés', 'English narration')}>
      <h3>{copy('Voz inglesa del texto guardado', 'English voice for the saved text')}</h3>

      <fieldset disabled={working} style={{display:'flex',gap:'1rem',flexWrap:'wrap',border:0,padding:0}}>
        <legend>{copy('Voz', 'Voice')}</legend>
        {VOICE_IDS.map(id => (
          <label key={id} style={{display:'inline-flex',alignItems:'center',gap:'.5rem',minHeight:44}}>
            <input
              type="radio"
              name="voice"
              value={id}
              checked={voiceId === id}
              style={{width:'auto',minHeight:20,padding:0,margin:0}}
              onChange={() => onSelectVoice(id)}
            />
            {copy(VOICE_LABEL[id][0], VOICE_LABEL[id][1])}
          </label>
        ))}
      </fieldset>

      <p>{copy(
        'Ensayo privado: se envía el texto inglés guardado a Google para narrarlo. No descuenta saldo. Puedes escucharla y descargarla; unirla al video será el siguiente paso.',
        'Private trial: the saved English text is sent to Google to be narrated. No balance deduction. Listen or download; adding it to the video is the next step.',
      )}</p>

      <button disabled={dirty || working || pending || job?.state === 'unknown'} onClick={() => void start()}>
        {copy('Generar narración', 'Generate narration')}
      </button>

      {dirty && <p>{copy('Guarda tus cambios antes de generar la narración.', 'Save your edits before generating the narration.')}</p>}

      {job && (
        <p role="status">
          {copy('Estado: ', 'Status: ')}
          {(STATUS[job.state] ?? [job.state, job.state])[spanish ? 0 : 1]}
          {job.stale ? copy(' · revisión anterior', ' · older revision') : ''}
        </p>
      )}

      {(pending || job?.state === 'unknown') && (
        <button
          disabled={working}
          onClick={() => {
            void api.cancel(job!.id)
              .then(() => api.get(job!.id))
              .then(value => setData(value as VoicePayload))
              .catch(() => setError(copy('No se pudo cancelar.', 'Could not cancel.')));
          }}
        >
          {copy('Cancelar', 'Cancel')}
        </button>
      )}

      {job?.state === 'unknown' && <p>{copy(
        'Resultado desconocido: comprueba el intento antes de generar otra narración.',
        'Unknown outcome: reconcile the attempt before generating another narration.',
      )}</p>}

      {data?.narration && (
        <>
          <audio controls preload="metadata" src={api.audio(job!.id)} />
          <p>
            {copy('Duración: ', 'Duration: ')}
            {(data.narration.durationMs / 1000).toFixed(2)} s · {data.narration.voiceId}
          </p>
          <a href={api.audio(job!.id)} download={`narration-${voiceId}.wav`}>
            {copy('Descargar WAV', 'Download WAV')}
          </a>
          {!data.narration.current && <p>{copy('Este audio pertenece a una revisión anterior.', 'This audio belongs to an older revision.')}</p>}
        </>
      )}

      {data && !data.narration && job?.state === 'succeeded' && (
        <p>{copy('El audio ya no está disponible.', 'The audio is no longer available.')}</p>
      )}

      {error && <p role="alert">{error}</p>}
    </section>
  );
}
