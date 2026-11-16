import { createHash, randomUUID } from 'node:crypto';
import type { ReadStream } from 'node:fs';
import type { Pool } from 'pg';
import { CommercialJobs, JobError } from './jobs';
import type { PipelineJobAttempt, PipelineJobDto, PipelineVoiceGender } from './pipelineContracts';
import { PipelineStore } from './pipelineStore';
import type { PrivateFileStore } from './privateFileStore';
import {
  buildWavRiff,
  validateWavRiff,
  VOICE_MAX_BYTES,
  VOICE_SAMPLE_RATE,
} from './pipelineVoiceWav';
import {
  isVoiceId,
  voiceGenderFor,
  VOICE_MODEL,
  VoiceOutcomeUnknown,
  narrationChunks,
  estimatedNarrationSeconds,
  type VoiceId,
  type VoiceProvider,
} from './pipelineVoiceProvider';
import { parseSRT, VoiceTextError } from './pipelineVoiceText';

export interface VoiceNarrationDto {
  readonly byteSize: number;
  readonly durationMs: number;
  readonly sha256: string;
  readonly voiceId: VoiceId;
  readonly voiceGender: PipelineVoiceGender;
  readonly revision: number;
  readonly current: boolean;
  readonly expiresAt: string;
}

export interface VoiceJobView {
  readonly job: PipelineJobDto;
  readonly narration: VoiceNarrationDto | null;
}

export interface VoiceListenResult {
  readonly stream: ReadStream;
  readonly start: number;
  readonly end: number;
  readonly byteSize: number;
  readonly mimeType: 'audio/wav';
  readonly sha256: string;
}

export interface VoiceByteRange {
  readonly start?: number;
  readonly end?: number;
}

/**
 * Narration worker and read model.
 * Only English narration is produced here: no mixing with video, no balance changes, no client paths.
 */
export class PipelineVoiceService {
  readonly store: PipelineStore;
  private readonly active = new Map<string, AbortController>();
  private busy = false;
  private readonly renewMs = 10_000;

  constructor(
    private readonly pool: Pool,
    private readonly jobs: CommercialJobs,
    private readonly files: PrivateFileStore,
    private readonly provider: VoiceProvider,
  ) {
    this.store = new PipelineStore(pool);
  }

  /** Creates the narration job with server-fixed voice configuration; the snapshot owns the text. */
  async request(
    accountId: string,
    projectId: string,
    voiceId: string,
    expectedRevision: unknown,
    requestKey: unknown,
  ): Promise<PipelineJobDto> {
    if (!isVoiceId(voiceId)) throw new JobError('invalid_input', 'Voice is not allowlisted.');

    const file = await this.jobs.fileInput(accountId, projectId);
    if (!file) throw new JobError('not_found', 'Private video unavailable.');

    const { rows } = await this.pool.query(
      `SELECT p.draft FROM subtitle_projects p
         JOIN inputs i ON i.id = p.id AND i.account_id = p.account_id
        WHERE p.account_id = $1 AND p.id = $2
          AND i.expires_at > clock_timestamp()
          AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL)`,
      [accountId, projectId],
    );
    const project = rows[0] as { draft: string } | undefined;
    if (!project) throw new JobError('not_found', 'Project unavailable.');
    let text:string;
    try {text=parseSRT(project.draft).translatedText;} catch {throw new JobError('invalid_input','Save valid subtitles of up to 12,000 characters before narration.');}
    if (text.length === 0) {
      throw new JobError('conflict', 'Save English text before generating narration.');
    }
    try {
      const chunks=narrationChunks(text);
      if(estimatedNarrationSeconds(text)+(chunks.length-1)*0.08>600) throw new Error('Text too long');
    } catch {throw new JobError('invalid_input','Shorten the saved English text for this narration trial.');}

    return this.store.createJob(accountId, {
      inputId: projectId,
      expectedRevision,
      requestKey,
      stage: 'narration',
      dependencies: [],
      config: {
        stage: 'narration',
        provider: 'gemini',
        model: VOICE_MODEL,
        voiceId,
        voiceGender: voiceGenderFor(voiceId),
        sourceLanguage: 'es',
        targetLanguage: 'en',
      },
    });
  }

  async latest(accountId: string, projectId: string, voiceId: string): Promise<VoiceJobView | null> {
    if (!isVoiceId(voiceId)) throw new JobError('invalid_input', 'Voice is not allowlisted.');
    const { rows } = await this.pool.query(
      `SELECT id FROM pipeline_jobs
        WHERE account_id = $1 AND project_id = $2 AND stage = 'narration'
          AND config->>'model' = $3 AND config->>'voiceId' = $4
          AND expires_at > clock_timestamp()
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [accountId, projectId, VOICE_MODEL, voiceId],
    );
    const row = rows[0] as { id: string } | undefined;
    return row ? this.get(accountId, row.id) : null;
  }

  async get(accountId: string, jobId: string): Promise<VoiceJobView | null> {
    const job = await this.store.getJob(accountId, jobId);
    if (!job || job.stage !== 'narration' || job.config.stage !== 'narration' || job.config.model !== VOICE_MODEL) return null;
    const { rows } = await this.pool.query(
      `SELECT n.byte_size, n.duration_ms, n.sha256, n.voice_id, n.voice_gender, n.revision, n.expires_at
         FROM pipeline_narrations n
         JOIN pipeline_jobs j ON j.id = n.job_id AND j.account_id = n.account_id
         JOIN inputs i ON i.id = j.input_id AND i.account_id = j.account_id
        WHERE n.account_id = $1 AND n.job_id = $2
          AND j.state = 'succeeded'
          AND j.expires_at > clock_timestamp()
          AND n.expires_at > clock_timestamp()
          AND i.expires_at > clock_timestamp()
          AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL)`,
      [accountId, jobId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return { job, narration: null };
    return {
      job,
      narration: {
        byteSize: Number(row.byte_size),
        durationMs: Number(row.duration_ms),
        sha256: String(row.sha256),
        voiceId: row.voice_id as VoiceId,
        voiceGender: row.voice_gender as PipelineVoiceGender,
        revision: Number(row.revision),
        current: !job.stale,
        expiresAt: new Date(row.expires_at as string | Date).toISOString(),
      },
    };
  }

  /** Streams the private WAV. Ownership, expiry and revision are rechecked on every call. */
  async audio(accountId: string, jobId: string, range?: VoiceByteRange): Promise<VoiceListenResult> {
    const view = await this.get(accountId, jobId);
    if (!view?.narration) throw new JobError('not_found', 'Narration audio unavailable.');
    const { rows } = await this.pool.query(
      `SELECT n.storage_id FROM pipeline_narrations n
         JOIN pipeline_jobs j ON j.id = n.job_id AND j.account_id = n.account_id
         JOIN inputs i ON i.id = j.input_id AND i.account_id = j.account_id
        WHERE n.account_id = $1 AND n.job_id = $2
          AND j.state = 'succeeded'
          AND j.expires_at > clock_timestamp()
          AND n.expires_at > clock_timestamp()
          AND i.expires_at > clock_timestamp()
          AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL)`,
      [accountId, jobId],
    );
    const row = rows[0] as { storage_id: string } | undefined;
    if (!row) throw new JobError('not_found', 'Narration audio unavailable.');

    const byteSize = view.narration.byteSize;
    const start = Math.max(0, Math.min(Math.floor(range?.start ?? 0), byteSize - 1));
    const end = Math.max(start, Math.min(Math.floor(range?.end ?? byteSize - 1), byteSize - 1));
    const stream = await this.files.open(row.storage_id, { start, end });
    return { stream, start, end, byteSize, mimeType: 'audio/wav', sha256: view.narration.sha256 };
  }

  async cancel(accountId: string, jobId: string): Promise<boolean> {
    const cancelled = await this.checkedCancel(accountId, jobId);
    if (cancelled) this.active.get(jobId)?.abort();
    return cancelled;
  }

  private async checkedCancel(accountId:string,jobId:string) {
    if (!await this.get(accountId,jobId)) throw new JobError('not_found','Narration unavailable.');
    return this.store.cancelJob(accountId,jobId);
  }

  abortAll(): void {
    for (const controller of this.active.values()) controller.abort();
  }

  /** Single worker tick. Unknown outcomes are never retried automatically. */
  async runOnce(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let attempt: PipelineJobAttempt | null = null;

    try {
      attempt = await this.store.claimNext('narration', VOICE_MODEL);
      if (!attempt) return;
      if (attempt.config.stage !== 'narration') throw new Error('Unexpected narration configuration.');
      const config = attempt.config;
      if (!isVoiceId(config.voiceId) || voiceGenderFor(config.voiceId) !== config.voiceGender) {
        throw new Error('Narration voice is not allowlisted.');
      }

      const controller = new AbortController();
      this.active.set(attempt.jobId, controller);
      timer = setInterval(() => {
        void this.store.renew(attempt!).catch(() => controller.abort());
      }, this.renewMs);
      timer.unref();

      const text = parseSRT(attempt.snapshot.draft).translatedText;
      if (text.length === 0) throw new VoiceTextError('empty', 'No saved English text to narrate.');

      const storageId = randomUUID();
      await this.reserve(attempt, storageId);

      try {
        const { l16 } = await this.provider.synthesize({
          jobId: attempt.jobId,
          text,
          voiceId: config.voiceId,
          signal: controller.signal,
        });
        controller.signal.throwIfAborted();

        const wav = buildWavRiff(l16);
        const stats = validateWavRiff(wav);
        const sha256 = createHash('sha256').update(wav).digest('hex');

        // Row lock fences filesystem writes against cancellation/crash reconciliation.
        const writer = await this.pool.connect();
        try {
          await writer.query('BEGIN');
          const reservation = await writer.query(`SELECT r.storage_id FROM pipeline_voice_reservations r
            JOIN pipeline_jobs j ON j.id=r.job_id
            WHERE r.storage_id=$1 AND r.state='reserved' AND j.state='running'
              AND j.attempt_id=$2 AND j.lease_until>clock_timestamp()
              AND j.expires_at>clock_timestamp() FOR UPDATE OF r`, [storageId,attempt.attemptId]);
          if (!reservation.rowCount) throw new JobError('conflict','Narration attempt expired.');
          controller.signal.throwIfAborted();
          if (!await this.files.append(storageId,0,0,wav)) throw new Error('Voice write rejected.');
          await writer.query('SELECT pipeline_voice_commit($1,$2,$3)',[attempt.accountId,storageId,wav.length]);
          await writer.query('COMMIT');
        } catch(error) { await writer.query('ROLLBACK'); throw error; }
        finally { writer.release(); }

        await this.store.publishArtifact(attempt.accountId, attempt.jobId, attempt.attemptId, {
          kind: 'voice_full_en',
          state: 'staged',
          mimeType: 'audio/wav',
          byteSize: wav.length,
          durationMs: stats.durationMs,
          sha256,
          storageKey: storageId,
        });

        await this.store.complete(attempt, 'succeeded', async client => {
          const { rows: [artifact] } = await client.query(
            `SELECT byte_size, sha256, storage_key, duration_ms FROM pipeline_artifacts
              WHERE account_id = $1 AND job_id = $2 AND attempt_id = $3
                AND kind = 'voice_full_en' AND state = 'ready'`,
            [attempt!.accountId, attempt!.jobId, attempt!.attemptId],
          );
          if (
            !artifact ||
            Number(artifact.byte_size) !== wav.length ||
            artifact.sha256 !== sha256 ||
            artifact.storage_key !== storageId ||
            Number(artifact.duration_ms) !== stats.durationMs
          ) {
            throw new JobError('conflict', 'Narration manifest differs from persisted bytes.');
          }

          const { rows: [owner] } = await client.query(
            'SELECT project_id FROM pipeline_jobs WHERE id = $1 AND account_id = $2',
            [attempt!.jobId, attempt!.accountId],
          );
          if (!owner) throw new JobError('conflict', 'Narration job vanished before publication.');

          await client.query(
            `INSERT INTO pipeline_narrations(account_id, job_id, project_id, revision, snapshot_hash,
               voice_id, voice_gender, storage_id, byte_size, duration_ms, sample_rate, sha256, expires_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              attempt!.accountId,
              attempt!.jobId,
              owner.project_id,
              attempt!.revision,
              attempt!.snapshotHash,
              config.voiceId,
              config.voiceGender,
              storageId,
              wav.length,
              stats.durationMs,
              VOICE_SAMPLE_RATE,
              sha256,
              attempt!.expiresAt,
            ],
          );
        });
      } catch (error) {
        const { rowCount } = await this.pool.query(
          'SELECT 1 FROM pipeline_narrations WHERE account_id = $1 AND storage_id = $2',
          [attempt.accountId, storageId],
        );
        if (!rowCount) await this.release(attempt, storageId).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (attempt) {
        const outcome = error instanceof VoiceOutcomeUnknown ? 'unknown' : 'failed';
        await this.store.complete(attempt, outcome).catch(() => undefined);
      }
    } finally {
      if (timer) clearInterval(timer);
      if (attempt) this.active.delete(attempt.jobId);
      this.busy = false;
    }
  }

  /**
   * Recoverable cleanup: tombstoned files, expired reservations with partial writes,
   * committed reservations that never produced a narration row, and expired narrations.
   * No directory listing is required because every UUID is registered before IO.
   */
  async reconcile(): Promise<{ tombstones: number; expired: number; orphaned: number }> {
    let tombstones = 0;
    let orphaned = 0;

    const expiredNarrations = await this.pool.query(
      'DELETE FROM pipeline_narrations WHERE expires_at <= clock_timestamp()',
    );

    const { rows: pending } = await this.pool.query(
      'SELECT storage_id FROM pipeline_voice_tombstones ORDER BY created_at, storage_id LIMIT 200');
    for (const row of pending as {storage_id:string}[]) {
      // A failed unlink retains its durable deletion intent for the next sweep.
      await this.files.remove(row.storage_id);
      await this.pool.query('DELETE FROM pipeline_voice_reservations WHERE storage_id=$1',[row.storage_id]);
      await this.pool.query('DELETE FROM pipeline_voice_tombstones WHERE storage_id=$1',[row.storage_id]);
      tombstones++;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const stale = await client.query(`SELECT r.storage_id FROM pipeline_voice_reservations r
        LEFT JOIN pipeline_jobs j ON j.id=r.job_id
        LEFT JOIN pipeline_narrations n ON n.storage_id=r.storage_id
        WHERE n.id IS NULL AND (r.state='released' OR r.expires_at<=clock_timestamp()
          OR j.id IS NULL OR j.state<>'running' OR j.lease_until<=clock_timestamp())
        ORDER BY r.created_at LIMIT 200 FOR UPDATE OF r SKIP LOCKED`);
      for (const row of stale.rows as {storage_id:string}[]) {
        await this.files.remove(row.storage_id);
        await client.query('DELETE FROM pipeline_voice_reservations WHERE storage_id=$1',[row.storage_id]);
        orphaned++;
      }
      await client.query('COMMIT');
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }

    return { tombstones, expired: expiredNarrations.rowCount ?? 0, orphaned };
  }

  private async reserve(attempt: PipelineJobAttempt, storageId: string): Promise<void> {
    try {
      await this.pool.query('SELECT pipeline_voice_reserve($1,$2,$3,$4,$5)', [
        attempt.accountId,
        attempt.jobId,
        storageId,
        VOICE_MAX_BYTES,
        attempt.expiresAt,
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === '23514') {
        throw new JobError('conflict', 'Voice storage is busy for this account; retry shortly.');
      }
      throw error;
    }
  }

  private async commit(attempt: PipelineJobAttempt, storageId: string, byteSize: number): Promise<void> {
    await this.pool.query('SELECT pipeline_voice_commit($1,$2,$3)', [attempt.accountId, storageId, byteSize]);
  }

  private async release(attempt: PipelineJobAttempt, storageId: string): Promise<void> {
    await this.pool.query('SELECT pipeline_voice_release($1,$2)', [attempt.accountId, storageId]);
  }
}
