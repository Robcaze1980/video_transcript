import {alignTextCues} from './pipelineTextTiming';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { CommercialJobs, JobError } from './jobs';
import { parsePipelineSnapshot, snapshotHash, type PipelineJobAttempt } from './pipelineContracts';
import { PipelineStore } from './pipelineStore';
import { textModel, TextOutcomeUnknown, type TextProvider } from './pipelineTextProvider';
import { normalizeTextResult, encodeTextResult } from './pipelineTextCodec';

export class PipelineTextService {
  readonly store: PipelineStore;
  private active = new Map<string, AbortController>();
  private busy = false;
  constructor(private readonly pool: Pool, private readonly files: CommercialJobs, private readonly provider: TextProvider, private readonly align: typeof alignTextCues = alignTextCues) {
    this.store = new PipelineStore(pool);
  }
  async request(accountId: string, projectId: string, expectedRevision: unknown, requestKey: unknown) {
    const file = await this.files.fileInput(accountId, projectId);
    if (!file) throw new JobError('not_found', 'Private video unavailable.');
    if (!Number.isFinite(file.metadata.duration)||file.metadata.duration<=0||file.metadata.duration>600) throw new JobError('invalid_input','Video duration outside supported profile.');
    if (!Number.isInteger(file.metadata.audioTracks) || file.metadata.audioTracks < 1) throw new JobError('invalid_input', 'Video needs an audio track.');
    try { return await this.store.createJob(accountId, { inputId: projectId, expectedRevision, requestKey, stage: 'translation',
      config: { stage: 'translation', provider: 'gemini', model: textModel, sourceLanguage: 'es', targetLanguage: 'en' } }); } catch (error) {
      if ((error as any).constraint === 'pipeline_text_single_active') throw new JobError('conflict','Text processing already active for this video.');
      throw error;
    }
  }
  async latest(accountId: string, projectId: string) {
    const {rows:[job]} = await this.pool.query(`SELECT id FROM pipeline_jobs WHERE account_id=$1 AND project_id=$2
      AND stage='translation' AND config->>'model'=$3 ORDER BY created_at DESC,id DESC LIMIT 1`,[accountId,projectId,textModel]);
    return job ? this.get(accountId,job.id) : null;
  }
  async get(accountId: string, jobId: string) {
    const job = await this.store.getJob(accountId, jobId);
    if (!job) return null;
    const { rows: [result] } = await this.pool.query(`SELECT r.cues,r.applied_revision FROM pipeline_text_results r
      JOIN pipeline_jobs j ON j.id=r.job_id AND j.account_id=r.account_id
      JOIN inputs i ON i.id=j.input_id AND i.account_id=j.account_id
      WHERE r.account_id=$1 AND r.job_id=$2 AND j.state='succeeded' AND j.expires_at>clock_timestamp() AND r.expires_at>clock_timestamp()
      AND i.expires_at>clock_timestamp() AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL)`, [accountId,jobId]);
    return { job, result: result ? { cues: result.cues, appliedRevision: result.applied_revision } : null };
  }
  async download(accountId: string, jobId: string, language: 'es'|'en', format: 'txt'|'srt') {
    const current = await this.get(accountId,jobId);
    if (!current?.result) throw new JobError('not_found','Text result unavailable.');
    const {rows:[stored]}=await this.pool.query(`SELECT r.es_srt,r.en_srt,r.es_txt,r.en_txt FROM pipeline_text_results r
      JOIN pipeline_jobs j ON j.id=r.job_id AND j.account_id=r.account_id JOIN inputs i ON i.id=j.input_id AND i.account_id=j.account_id
      WHERE r.account_id=$1 AND r.job_id=$2 AND j.state='succeeded' AND r.expires_at>clock_timestamp() AND j.expires_at>clock_timestamp()
      AND i.expires_at>clock_timestamp() AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL)`,[accountId,jobId]);
    if(!stored)throw new JobError('not_found','Text result unavailable.');
    return Buffer.from(stored[(language==='es'?'es':'en')+'_'+(format==='srt'?'srt':'txt')],'utf8');
  }
  async cancel(accountId: string, jobId: string) {
    const cancelled = await this.store.cancelJob(accountId,jobId);
    if (cancelled) this.active.get(jobId)?.abort();
    return cancelled;
  }
  abortAll() { for (const controller of this.active.values()) controller.abort(); }
  async runOnce() {
    if (this.busy) return;
    this.busy = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let attempt: PipelineJobAttempt | null = null;
    try {
      attempt = await this.store.claimNext('translation',textModel);
      if (!attempt) return;
      const controller = new AbortController();
      this.active.set(attempt.jobId,controller);
      timer = setInterval(() => { void this.store.renew(attempt!).catch(() => controller.abort()); },10_000);
      timer.unref();
      if (attempt.config.stage !== 'translation' || attempt.config.model !== textModel) throw new Error('Invalid text configuration.');
      const job = await this.store.getJob(attempt.accountId,attempt.jobId);
      if (!job) throw new Error('Job unavailable.');
      const file = await this.files.fileInput(attempt.accountId,job.inputId);
      if (!file || file.metadata.audioTracks < 1) throw new Error('Private source unavailable.');
      const raw = await this.provider.generate(file,controller.signal,attempt.jobId);
      controller.signal.throwIfAborted();
      const cues = await this.align(file,normalizeTextResult(raw,Math.floor(file.metadata.duration*1000),attempt.jobId),controller.signal);
      for (const [kind,language,format] of [['transcript_es','es','txt'],['translation_en','en','txt'],['subtitle_srt_en','en','srt']] as const) {
        const content = encodeTextResult(cues,language,format);
        await this.store.publishArtifact(attempt.accountId,attempt.jobId,attempt.attemptId,{
          kind,state:'staged',mimeType:format==='srt' && language==='en' ? 'application/x-subrip' : 'text/plain',
          byteSize:content.length,durationMs:null,sha256:createHash('sha256').update(content).digest('hex'),
          storageKey:'text_'+attempt.jobId.replaceAll('-','')+'_'+kind,
        });
      }
      await this.store.complete(attempt,'succeeded',async client => {
        const manifests = (await client.query('SELECT kind,sha256,byte_size FROM pipeline_artifacts WHERE job_id=$1 AND attempt_id=$2',[attempt!.jobId,attempt!.attemptId])).rows;
        for (const [kind,language,format] of [['transcript_es','es','txt'],['translation_en','en','txt'],['subtitle_srt_en','en','srt']] as const) {
          const bytes=encodeTextResult(cues,language,format);const manifest=manifests.find(m=>m.kind===kind);
          if (!manifest || Number(manifest.byte_size)!==bytes.length || manifest.sha256!==createHash('sha256').update(bytes).digest('hex')) throw new JobError('conflict','Text manifest differs from persisted bytes.');
        }

        await client.query(`INSERT INTO pipeline_text_results(account_id,job_id,revision,cues,es_srt,en_srt,expires_at,es_txt,en_txt)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [attempt!.accountId,attempt!.jobId,attempt!.revision,JSON.stringify(cues),
          encodeTextResult(cues,'es','srt').toString('utf8'),encodeTextResult(cues,'en','srt').toString('utf8'),attempt!.expiresAt,encodeTextResult(cues,'es','txt').toString('utf8'),encodeTextResult(cues,'en','txt').toString('utf8')]);
      });
    } catch (error) {
      if (attempt) await this.store.complete(attempt!,error instanceof TextOutcomeUnknown ? 'unknown':'failed').catch(() => undefined);
    } finally {
      if (timer) clearInterval(timer);
      if (attempt) this.active.delete(attempt!.jobId);
      this.busy = false;
    }
  }
  async apply(accountId: string, jobId: string) {
    const candidate = await this.get(accountId,jobId);
    if (!candidate?.result) throw new JobError('not_found','Text result unavailable.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const projectId = candidate.job.projectId;
      await client.query('SELECT 1 FROM inputs WHERE account_id=$1 AND id=$2 FOR UPDATE',[accountId,projectId]);
      const {rows:[project]} = await client.query('SELECT * FROM subtitle_projects WHERE account_id=$1 AND id=$2 FOR UPDATE',[accountId,projectId]);
      const {rows:[result]} = await client.query(`SELECT r.*,j.state,j.snapshot_hash FROM pipeline_text_results r JOIN pipeline_jobs j
        ON j.id=r.job_id AND j.account_id=r.account_id WHERE r.account_id=$1 AND r.job_id=$2 FOR UPDATE OF j,r`,[accountId,jobId]);
      const live = await client.query(`SELECT 1 FROM inputs WHERE account_id=$1 AND id=$2 AND expires_at>clock_timestamp()
        AND (content IS NOT NULL OR private_upload_id IS NOT NULL)`,[accountId,projectId]);
      const liveResult=await client.query(`SELECT 1 FROM pipeline_jobs j JOIN pipeline_text_results r ON r.job_id=j.id AND r.account_id=j.account_id
        WHERE j.account_id=$1 AND j.id=$2 AND j.expires_at>clock_timestamp() AND r.expires_at>clock_timestamp()`,[accountId,jobId]);
      if (!live.rowCount || !liveResult.rowCount || !project || !result || result.state !== 'succeeded') throw new JobError('not_found','Text result unavailable.');
      if (!result.applied_revision) {
        const currentHash = snapshotHash(parsePipelineSnapshot({revision:project.revision,draft:project.draft,originalDraft:project.original_draft,duration:project.duration,style:project.subtitle_style,highlights:project.highlights}));
        if (project.revision !== result.revision || currentHash !== result.snapshot_hash) throw new JobError('conflict','Project changed before applying result.');
        const updated = await client.query(`UPDATE subtitle_projects p SET draft=$3,original_draft=$4,highlights='{}'::jsonb,
          segment_ids=$6::jsonb,revision=p.revision+1,updated_at=clock_timestamp() FROM inputs i WHERE p.id=$1 AND p.account_id=$2
          AND p.revision=$5 AND i.id=p.id AND i.account_id=p.account_id AND i.expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM pipeline_jobs j JOIN pipeline_text_results r ON r.job_id=j.id
            WHERE j.id=$7 AND j.account_id=$2 AND j.expires_at>clock_timestamp() AND r.expires_at>clock_timestamp()) RETURNING p.revision`,
          [projectId,accountId,result.en_srt,result.es_srt,result.revision,JSON.stringify({original:result.cues.map((c:any)=>c.id),translated:result.cues.map((c:any)=>c.id)}),jobId]);
        if (!updated.rowCount) throw new JobError('conflict','Project expired or changed.');
        result.applied_revision = updated.rows[0].revision;
        project.revision = updated.rows[0].revision;
        const receipt=await client.query(`UPDATE pipeline_text_results r SET applied_revision=$2 WHERE job_id=$1 AND expires_at>clock_timestamp()
          AND EXISTS(SELECT 1 FROM pipeline_jobs j WHERE j.id=r.job_id AND j.expires_at>clock_timestamp())`,[jobId,result.applied_revision]);
        if (!receipt.rowCount) throw new JobError('not_found','Result expired during application.');
      }
      await client.query('COMMIT');
      return {revision:project.revision,appliedRevision:result.applied_revision};
    } catch(error) { await client.query('ROLLBACK');throw error; } finally {client.release();}
  }
}
