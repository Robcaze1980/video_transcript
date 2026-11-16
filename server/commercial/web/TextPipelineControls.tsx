import {recoverTextRequest} from './textRequest';
import React, { useEffect, useRef, useState } from 'react';
export interface TextPipelineApi {
  voice?(id: import('./VoicePipelineControls').VoiceId): import('./VoicePipelineControls').VoicePipelineApi;
  latest(): Promise<any>;
  start(revision: number, requestKey: string): Promise<any>;
  get(id: string): Promise<any>;
  cancel(id: string): Promise<any>;
  apply(id: string): Promise<any>;
  downloads(id: string): string;
  reload(): Promise<void>;
}
export function TextPipelineControls({ api, revision, dirty, spanish, setApplying }: {
  api: TextPipelineApi; revision: number; dirty: boolean; spanish: boolean; setApplying(value: boolean): void;
}) {
  const [data,setData] = useState<any>();
  const [working,setWorking] = useState(false);
  const [error,setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const copy = (es:string,en:string) => spanish ? es : en;
  useEffect(() => { let live=true; void api.latest().then(d=>{if(live)setData(d);}).catch(()=>undefined);return()=>{live=false;}; },[api]);
  const pending = data?.job && ['queued','running'].includes(data.job.state);
  useEffect(() => {
    if (!pending) return;
    let live=true;
    const timer=setInterval(()=>{void api.get(data.job.id).then(d=>{if(live)setData(d);}).catch(()=>{if(live)setError(copy('No se pudo actualizar el estado.','Could not refresh status.'));});},1000);
    return()=>{live=false;clearInterval(timer);};
  },[pending,data?.job?.id,api]);
  async function start() {
    setWorking(true);setError('');
    try { await recoverTextRequest(api,revision,key,setData); }
    catch { setError(copy('No se pudo solicitar. Reintenta para recuperar la misma solicitud.','Request failed. Retry to recover the same request.')); }
    finally {setWorking(false);}
  }
  async function apply() {
    setWorking(true);setApplying(true);setError('');
    try {await api.apply(data.job.id);await api.reload();}
    catch {setError(copy('El proyecto cambió o el resultado ya no está disponible. Tus cambios se conservan.','Project changed or result unavailable. Your edits are preserved.'));}
    finally {setWorking(false);setApplying(false);}
  }
  return <section aria-label={copy('Transcripción y traducción','Transcription and translation')}>
    <h3>{copy('Video español → texto inglés','Spanish video → English text')}</h3>
    <p>{copy('Ensayo privado: se envía el video a Google para transcribir y traducir. Sin descuento de saldo. Revisa nombres, medidas y tiempos antes de aplicar.','Private trial: sends the video to Google for transcription and translation. No balance deduction. Review names, measurements and timing before applying.')}</p>
    <button disabled={dirty||working||pending||data?.job?.state==='unknown'} onClick={()=>void start()}>
      {copy('Generar español e inglés','Generate Spanish and English')}</button>
    {dirty && <p>{copy('Guarda tus cambios antes de generar o aplicar.','Save your edits before generating or applying.')}</p>}
    {data?.job && <p role="status">{copy('Estado: ','Status: ')}{({queued:copy('En cola','Queued'),running:copy('Transcribiendo y traduciendo','Transcribing and translating'),succeeded:copy('Listo para revisar','Ready to review'),failed:copy('No se pudo completar','Could not complete'),unknown:copy('Necesita revisión','Needs review'),cancelled:copy('Cancelado','Cancelled')} as Record<string,string>)[data.job.state]}{data.job.stale?copy(' · revisión anterior',' · older revision'):''}</p>}
    {(pending||data?.job?.state==='unknown') && <button disabled={working} onClick={()=>{void api.cancel(data.job.id).then(()=>api.get(data.job.id)).then(setData).catch(()=>setError(copy('No se pudo cancelar.','Could not cancel.')));}}>{copy('Cancelar','Cancel')}</button>}
    {data?.job && ['failed','unknown','cancelled'].includes(data.job.state) && <p>{copy('No se aplicaron cambios. Si el resultado es desconocido, comprueba el intento antes de generar otro.','No edits applied. If outcome is unknown, reconcile the attempt before generating again.')}</p>}
    {data?.result && <>
      <details><summary>{copy('Revisar español e inglés','Review Spanish and English')}</summary>
        <ol>{data.result.cues.map((c:any)=><li key={c.id}><span>{(c.startMs/1000).toFixed(2)}–{(c.endMs/1000).toFixed(2)} s</span><p lang="es">{c.es}</p><p lang="en">{c.en}</p></li>)}</ol>
      </details>
      <p>{copy('Descargas del resultado generado. Para obtener tus correcciones guardadas, usa TXT o SRT del editor.','Generated-result downloads. For saved corrections, use the editor TXT or SRT buttons.')}</p>
      <div className="actions">{(['es','en'] as const).flatMap(language=>(['txt','srt'] as const).map(format=><a key={language+format} href={api.downloads(data.job.id)+'/'+language+'.'+format} download>{language.toUpperCase()} {format.toUpperCase()}</a>))}</div>
      {!data.result.appliedRevision && <button disabled={dirty||working||data.job.stale} onClick={()=>void apply()}>{copy('Aplicar ambas pistas al editor','Apply both tracks to editor')}</button>}
      {data.result.appliedRevision && <p>{copy('Aplicado a revisión ','Applied to revision ')}{data.result.appliedRevision}</p>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
