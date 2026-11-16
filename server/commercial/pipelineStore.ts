import { randomUUID, createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { JobError } from './jobs';
import {
  type PipelineApiService, type PipelineJobDto, type PipelineJobAttempt,
  type PipelineArtifactMetadataDto, type PipelineArtifactKind, type PipelineStage,
  parseCreatePipelineJobRequest, parsePipelineSnapshot, parsePublishPipelineArtifactInput,
  parseStageConfig, snapshotHash, canonicalizeConfig,
} from './pipelineContracts';

const leaseSeconds = 30;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function id(value: string) {
  if (!uuid.test(value)) throw new JobError('invalid_input', 'Invalid identifier.');
  return value;
}
const iso = (value: Date) => value.toISOString();
const required: Record<PipelineStage, readonly PipelineArtifactKind[]> = {
  transcript: ['transcript_es'], translation: ['transcript_es', 'translation_en', 'subtitle_srt_en'],
  narration: ['voice_full_en'], render: ['render_mp4_en'],
};

/** Internal persistence only. No routes, providers, file IO or commercial ledger writes. */
export class PipelineStore implements PipelineApiService {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  // Consistent lock order: input -> project -> job. Recheck TTL after acquiring locks.
  private async project(client: PoolClient, accountId: string, inputId: string) {
    const input = await client.query('SELECT 1 FROM inputs WHERE account_id=$1 AND id=$2 FOR UPDATE', [accountId, inputId]);
    if (!input.rowCount) throw new JobError('not_found', 'Project unavailable.');
    const { rows: [row] } = await client.query(`SELECT p.*,i.expires_at FROM subtitle_projects p
      JOIN inputs i ON i.id=p.id AND i.account_id=p.account_id
      WHERE p.account_id=$1 AND p.id=$2 FOR UPDATE OF p`, [accountId, inputId]);
    const available = await client.query(`SELECT 1 FROM inputs WHERE account_id=$1 AND id=$2
      AND expires_at>clock_timestamp() AND (content IS NOT NULL OR private_upload_id IS NOT NULL)`, [accountId, inputId]);
    if (!row || !available.rowCount) throw new JobError('not_found', 'Project unavailable.');
    const snapshot = parsePipelineSnapshot({ revision: row.revision, draft: row.draft,
      originalDraft: row.original_draft, duration: row.duration, style: row.subtitle_style, highlights: row.highlights });
    return { ...row, snapshot, hash: snapshotHash(snapshot) };
  }

  async createJob(accountId: string, request: unknown): Promise<PipelineJobDto> {
    id(accountId);
    const parsed = parseCreatePipelineJobRequest(request);
    const config = canonicalizeConfig(parsed.config);
    return this.transaction(async client => {
      // Serializes request keys across projects of the same account.
      const account = await client.query('SELECT 1 FROM accounts WHERE id=$1 FOR UPDATE', [accountId]);
      if (!account.rowCount) throw new JobError('not_found', 'Account unavailable.');
      const project = await this.project(client, accountId, parsed.inputId);
      const { rows: [existing] } = await client.query(`SELECT * FROM pipeline_jobs WHERE account_id=$1 AND request_key=$2`,
        [accountId, parsed.requestKey]);
      if (existing) {
        const parents = (await client.query('SELECT parent_id FROM pipeline_dependencies WHERE job_id=$1 ORDER BY parent_id', [existing.id])).rows.map(r => r.parent_id);
        if (JSON.stringify(parents) !== JSON.stringify([...parsed.dependencies].sort())) throw new JobError('conflict', 'Dependencies changed.');
        if (existing.input_id !== parsed.inputId || existing.revision !== parsed.expectedRevision || existing.stage !== parsed.stage ||
          canonicalizeConfig(parseStageConfig(existing.stage, existing.config)) !== config) {
          throw new JobError('conflict', 'Request key already has a different payload.');
        }
        const replay = await this.read(client, accountId, existing.id);
        if (!replay) throw new JobError('not_found', 'Job expired.');
        return replay;
      }
      if (project.revision !== parsed.expectedRevision) throw new JobError('conflict', 'Project revision changed.');
      const snapshotId = randomUUID();
      const { rows: [snapshot] } = await client.query(`INSERT INTO pipeline_snapshots
        (id,account_id,project_id,revision,snapshot_hash,draft,original_draft,duration,style,expires_at,highlights)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(account_id,project_id,revision,snapshot_hash) DO NOTHING RETURNING id`,
        [snapshotId, accountId, parsed.inputId, project.revision, project.hash, project.draft,
          project.original_draft, project.duration, project.subtitle_style, project.expires_at, project.highlights]);
      const stored = snapshot ?? (await client.query(`SELECT id FROM pipeline_snapshots
        WHERE account_id=$1 AND project_id=$2 AND revision=$3 AND snapshot_hash=$4`,
        [accountId, parsed.inputId, project.revision, project.hash])).rows[0];
      const parentStages = new Set<string>();
      for (const parentId of [...parsed.dependencies].sort()) {
        const parent = (await client.query(`SELECT stage FROM pipeline_jobs WHERE account_id=$1 AND id=$2
          AND snapshot_id=$3 AND state='succeeded' AND expires_at>clock_timestamp() FOR SHARE`,
          [accountId, parentId, stored.id])).rows[0];
        const rank = { transcript: 0, translation: 1, narration: 2, render: 3 };
        if (!parent || rank[parent.stage as PipelineStage] >= rank[parsed.stage]) throw new JobError('conflict', 'Dependency unavailable or incompatible.');
        parentStages.add(parent.stage);
      }
      if (parsed.stage === 'render' && !parentStages.has('narration')) throw new JobError('conflict', 'Render requires completed narration for this snapshot.');
      const jobId = randomUUID();
      await client.query(`INSERT INTO pipeline_jobs(id,account_id,input_id,project_id,snapshot_id,request_key,stage,
        config,revision,snapshot_hash,expires_at) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [jobId, accountId, parsed.inputId, stored.id, parsed.requestKey, parsed.stage, config,
          project.revision, project.hash, project.expires_at]);
      for (const parentId of parsed.dependencies) await client.query(`INSERT INTO pipeline_dependencies(account_id,job_id,parent_id,snapshot_id)
        VALUES($1,$2,$3,$4)`, [accountId,jobId,parentId,stored.id]);
      const created = await this.read(client, accountId, jobId);
      if (!created) throw new JobError('not_found', 'Job expired.');
      return created;
    });
  }

  private async read(client: PoolClient, accountId: string, jobId: string): Promise<PipelineJobDto | null> {
    const { rows: [row] } = await client.query(`SELECT j.*,p.revision AS current_revision,p.draft,p.original_draft,
      p.duration,p.subtitle_style,p.highlights FROM pipeline_jobs j JOIN inputs i ON i.id=j.input_id AND i.account_id=j.account_id
      JOIN subtitle_projects p ON p.id=j.project_id AND p.account_id=j.account_id
      WHERE j.account_id=$1 AND j.id=$2 AND j.expires_at>clock_timestamp() AND i.expires_at>clock_timestamp()
      AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL)`, [accountId, jobId]);
    if (!row) return null;
    const hash = snapshotHash(parsePipelineSnapshot({ revision: row.current_revision, draft: row.draft,
      originalDraft: row.original_draft, duration: row.duration, style: row.subtitle_style, highlights: row.highlights }));
    const stale = row.current_revision !== row.revision || hash !== row.snapshot_hash;
    const { rows: artifacts } = await client.query(`SELECT * FROM pipeline_artifacts
      WHERE account_id=$1 AND job_id=$2 AND expires_at>clock_timestamp() ORDER BY kind`, [accountId, jobId]);
    return { id: row.id, inputId: row.input_id, projectId: row.project_id, stage: row.stage, state: row.state,
      dependencies: (await client.query('SELECT parent_id FROM pipeline_dependencies WHERE job_id=$1 ORDER BY parent_id', [jobId])).rows.map(r => r.parent_id),
      requestKey: row.request_key, config: parseStageConfig(row.stage, row.config), revision: row.revision,
      snapshotId: row.snapshot_id, configHash: createHash('sha256').update(canonicalizeConfig(parseStageConfig(row.stage,row.config))).digest('hex'), snapshotHash: row.snapshot_hash, stale, currentRevision: row.current_revision,
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), expiresAt: iso(row.expires_at),
      artifacts: artifacts.map(a => ({ id: a.id, kind: a.kind, state: a.state, revision: a.revision,
        mimeType: a.mime_type, byteSize: a.byte_size === null ? null : Number(a.byte_size), durationMs: a.duration_ms,
        sha256: a.sha256, createdAt: iso(a.created_at), readyAt: a.ready_at ? iso(a.ready_at) : null,
        expiresAt: iso(a.expires_at), current: !stale && row.state === 'succeeded' && a.state === 'ready' })),
    };
  }

  async getJob(accountId: string, jobId: string) {
    id(accountId); id(jobId);
    // Stable view across project and artifacts, including concurrent editor saves.
    return this.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      return this.read(client, accountId, jobId);
    });
  }

  async listJobs(accountId: string, limit = 20): Promise<readonly PipelineJobDto[]> {
    id(accountId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new JobError('invalid_input', 'Invalid limit.');
    return this.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const { rows } = await client.query(`SELECT id FROM pipeline_jobs WHERE account_id=$1
        ORDER BY created_at DESC,id DESC LIMIT $2`, [accountId, limit]);
      const result: PipelineJobDto[] = [];
      for (const row of rows) { const job = await this.read(client, accountId, row.id); if (job) result.push(job); }
      return result;
    });
  }

  private async lockedJob(client: PoolClient, accountId: string, jobId: string) {
    const { rows: [candidate] } = await client.query('SELECT input_id FROM pipeline_jobs WHERE account_id=$1 AND id=$2', [accountId, jobId]);
    if (!candidate) throw new JobError('not_found', 'Job unavailable.');
    const project = await this.project(client, accountId, candidate.input_id);
    const { rows: [job] } = await client.query(`SELECT *,lease_until>clock_timestamp() AS lease_valid,
      expires_at>clock_timestamp() AS live FROM pipeline_jobs WHERE account_id=$1 AND id=$2 FOR UPDATE`, [accountId, jobId]);
    if (!job || !job.live) throw new JobError('not_found', 'Job unavailable.');
    // TTL and lease must be evaluated after waiting for any job lock.
    const { rows: [time] } = await client.query(`SELECT j.expires_at>clock_timestamp() AND i.expires_at>clock_timestamp() AS live,
      j.lease_until>clock_timestamp() AS lease_valid FROM pipeline_jobs j JOIN inputs i ON i.id=j.input_id
      WHERE j.account_id=$1 AND j.id=$2`, [accountId, jobId]);
    if (!time?.live) throw new JobError('not_found', 'Job unavailable.');
    return { job: { ...job, lease_valid: time.lease_valid }, project };
  }

  async cancelJob(accountId: string, jobId: string): Promise<boolean> {
    id(accountId); id(jobId);
    return this.transaction(async client => {
      const { job } = await this.lockedJob(client, accountId, jobId);
      if (job.state === 'cancelled') return true;
      if (!['queued', 'running', 'unknown'].includes(job.state)) return false;
      await client.query(`UPDATE pipeline_jobs SET state='cancelled',attempt_id=NULL,lease_until=NULL,
        updated_at=clock_timestamp() WHERE id=$1`, [jobId]);
      await client.query('DELETE FROM pipeline_artifacts WHERE job_id=$1', [jobId]);
      return true;
    });
  }

  async claimNext(stage?: PipelineStage, model?: string): Promise<PipelineJobAttempt | null> {
    // Expired leases have unknown provider outcome; never automatically run them again.
    await this.pool.query(`UPDATE pipeline_jobs SET state='unknown',attempt_id=NULL,lease_until=NULL,
      error_code='lease_lost',updated_at=clock_timestamp() WHERE state='running' AND lease_until<=clock_timestamp()`);
    const { rows } = await this.pool.query(`SELECT j.id,j.account_id FROM pipeline_jobs j JOIN inputs i ON i.id=j.input_id AND i.account_id=j.account_id
      JOIN subtitle_projects p ON p.id=j.project_id AND p.account_id=j.account_id WHERE j.state='queued'
      AND j.expires_at>clock_timestamp() AND i.expires_at>clock_timestamp() AND (i.content IS NOT NULL OR i.private_upload_id IS NOT NULL) AND ($1::text IS NULL OR j.stage=$1) AND ($2::text IS NULL OR j.config->>'model'=$2) ORDER BY j.created_at,j.id LIMIT 20`, [stage ?? null,model ?? null]);
    for (const candidate of rows) {
      try {
        const result = await this.transaction(async client => {
          const { job, project } = await this.lockedJob(client, candidate.account_id, candidate.id);
          if (job.state !== 'queued') return null;
          if (job.revision !== project.revision || job.snapshot_hash !== project.hash) {
            await client.query(`UPDATE pipeline_jobs SET state='failed',error_code='stale_revision',updated_at=clock_timestamp()
              WHERE id=$1`, [job.id]);
            return null;
          }
          const token = randomUUID();
          const { rows: [running] } = await client.query(`UPDATE pipeline_jobs SET state='running',attempt_id=$2,
            lease_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1,updated_at=clock_timestamp()
            WHERE id=$1 AND expires_at>clock_timestamp() RETURNING lease_until`, [job.id, token]);
          if (!running) throw new JobError('not_found', 'Job expired.');
          return { jobId: job.id, accountId: job.account_id, stage: job.stage, attemptId: token,
            leaseUntil: iso(running.lease_until), revision: job.revision, snapshotHash: job.snapshot_hash,
            config: parseStageConfig(job.stage, job.config), snapshot: project.snapshot, expiresAt: iso(job.expires_at) };
        });
        if (result) return result;
      } catch (error) { if (!(error instanceof JobError && error.code === 'not_found')) throw error; }
    }
    return null;
  }

  private checkAttempt(job: any, project: any, attemptId: string, requireCurrent = true) {
    if (job.state !== 'running' || job.attempt_id !== attemptId || !job.lease_valid ||
      (requireCurrent && (job.revision !== project.revision || job.snapshot_hash !== project.hash))) {
      throw new JobError('conflict', 'Attempt lost, expired or stale.');
    }
  }

  async renew(attempt: PipelineJobAttempt): Promise<boolean> {
    return this.transaction(async client => {
      const { job, project } = await this.lockedJob(client, attempt.accountId, attempt.jobId);
      this.checkAttempt(job, project, attempt.attemptId);
      const renewed = await client.query(`UPDATE pipeline_jobs SET lease_until=clock_timestamp()+($2::int*interval '1 second')
        WHERE id=$1 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp()`, [job.id, leaseSeconds]);
      if (!renewed.rowCount) throw new JobError('conflict', 'Lease expired.');
      return true;
    });
  }

  async publishArtifact(accountId: string, jobId: string, attemptId: string, artifact: unknown): Promise<PipelineArtifactMetadataDto> {
    id(accountId); id(jobId); id(attemptId);
    const parsed = parsePublishPipelineArtifactInput(artifact);
    if (parsed.state !== 'staged') throw new JobError('invalid_input', 'Stage metadata before atomic completion.');
    return this.transaction(async client => {
      const { job, project } = await this.lockedJob(client, accountId, jobId);
      this.checkAttempt(job, project, attemptId);
      if (!required[job.stage as PipelineStage].includes(parsed.kind) && !(job.stage === 'translation' && parsed.kind === 'transcript_es')) throw new JobError('invalid_input', 'Wrong artifact for stage.');
      await client.query(`INSERT INTO pipeline_artifacts(id,account_id,job_id,revision,kind,state,mime_type,
        byte_size,duration_ms,sha256,storage_key,expires_at,attempt_id) VALUES($1,$2,$3,$4,$5,'staged',$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(account_id,job_id,kind,revision) DO UPDATE SET mime_type=EXCLUDED.mime_type,
        byte_size=EXCLUDED.byte_size,duration_ms=EXCLUDED.duration_ms,sha256=EXCLUDED.sha256,storage_key=EXCLUDED.storage_key`,
        [randomUUID(), accountId, jobId, job.revision, parsed.kind, parsed.mimeType, parsed.byteSize,
          parsed.durationMs, parsed.sha256, parsed.storageKey, job.expires_at, attemptId]);
      const refreshed = await this.read(client, accountId, jobId);
      if (!refreshed) throw new JobError('not_found', 'Job expired.');
      const staged = refreshed.artifacts.find(a => a.kind === parsed.kind);
      if (!staged) throw new JobError('conflict', 'Artifact unavailable.');
      return staged;
    });
  }

  async complete(attempt: PipelineJobAttempt, next: 'succeeded' | 'failed' | 'unknown' | 'cancelled', publish?: (client: PoolClient) => Promise<void>): Promise<boolean> {
    return this.transaction(async client => {
      const { job, project } = await this.lockedJob(client, attempt.accountId, attempt.jobId);
      this.checkAttempt(job, project, attempt.attemptId, next === 'succeeded');
      if (!['succeeded', 'failed', 'unknown', 'cancelled'].includes(next)) throw new JobError('invalid_input', 'Invalid outcome.');
      if (next === 'succeeded') {
        const { rows } = await client.query(`SELECT kind FROM pipeline_artifacts WHERE account_id=$1 AND job_id=$2
          AND revision=$3 AND attempt_id=$4 AND state='staged' AND byte_size IS NOT NULL AND sha256 IS NOT NULL AND storage_key IS NOT NULL`,
          [attempt.accountId, job.id, job.revision, attempt.attemptId]);
        const present = new Set(rows.map(row => row.kind));
        if (!required[job.stage as PipelineStage].every(kind => present.has(kind))) throw new JobError('conflict', 'Incomplete artifact manifest.');
        await client.query(`UPDATE pipeline_artifacts SET state='ready',ready_at=clock_timestamp()
          WHERE job_id=$1 AND account_id=$2 AND revision=$3 AND attempt_id=$4 AND state='staged'
          AND kind=ANY($5::text[])`, [job.id, attempt.accountId, job.revision, attempt.attemptId, job.stage === 'translation' ? [...required.translation, 'transcript_es'] : required[job.stage as PipelineStage]]);
      } else {
        await client.query('DELETE FROM pipeline_artifacts WHERE job_id=$1', [job.id]);
      }
      if (publish && next === 'succeeded') await publish(client);
      const completed = await client.query(`UPDATE pipeline_jobs SET state=$2,attempt_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
        WHERE id=$1 AND state='running' AND attempt_id=$3 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp()
        AND EXISTS(SELECT 1 FROM inputs WHERE id=pipeline_jobs.input_id AND expires_at>clock_timestamp())`, [job.id, next, attempt.attemptId]);
      if (!completed.rowCount) throw new JobError('conflict', 'Attempt expired during completion.');
      return true;
    });
  }
}
