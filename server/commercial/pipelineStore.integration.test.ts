import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CommercialJobs } from './jobs';
import { PipelineStore } from './pipelineStore';
import type { PipelineJobAttempt } from './pipelineContracts';

const connectionString = process.env.LINGUISTVISION_TEST_DATABASE_URL;
const schema = 'lv_pipeline_' + randomUUID().replaceAll('-', '');

describe.skipIf(!connectionString)('pipeline contracts persisted in PostgreSQL', () => {
  let admin: Pool;
  let pool: Pool;
  let editor: CommercialJobs;
  let store: PipelineStore;
  let account: string;
  let stranger: string;
  let project: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString });
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new Pool({ connectionString, application_name: schema, options: '-c search_path=' + schema });
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    const migration = await readFile(new URL('./pipelineMigration.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    await pool.query(migration);
    editor = new CommercialJobs(pool, new Map());
    store = new PipelineStore(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE accounts CASCADE');
    account = await editor.createAccount();
    stranger = await editor.createAccount();
    project = await editor.createSubtitleProject(account, Buffer.from('synthetic-source'), 'Synthetic fixture', 120,
      '1\n00:00:00,000 --> 00:00:02,000\nFive centimeters.\n', undefined,
      '1\n00:00:00,000 --> 00:00:02,000\nCinco centímetros.\n');
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
  });

  it('migration is repeatable and preserves the existing editor', async () => {
    expect(await editor.subtitleProject(account, project)).toMatchObject({ revision: 1, duration: 120 });
    expect(await editor.saveSubtitleProject(account, project, 1, 'corrected')).toEqual({ revision: 2 });
    expect(await editor.balance(account)).toEqual({ available: 0, reserved: 0, consumed: 0, credited: 0 });
  });
  const config = (stage = 'transcript') => stage === 'render'
    ? { stage, provider: 'ffmpeg', videoCodec: 'h264', audioCodec: 'aac', subtitleMode: 'burned', sourceLanguage: 'es', targetLanguage: 'en' }
    : stage === 'narration'
    ? { stage, provider: 'gemini', model: 'fixture', voiceId: 'Kore', voiceGender: 'female', sourceLanguage: 'es', targetLanguage: 'en' }
    : { stage, provider: 'gemini', model: 'fixture', sourceLanguage: 'es', targetLanguage: 'en' };
  const request = (key = randomUUID(), stage = 'transcript', dependencies: string[] = []) =>
    ({ requestKey: key, expectedRevision: 1, inputId: project, stage, config: config(stage), dependencies });
  const metadata = (kind = 'transcript_es') => ({ kind, state: 'staged', mimeType: kind.startsWith('voice_') ? 'audio/wav' : kind === 'subtitle_srt_en' ? 'application/x-subrip' : kind === 'render_mp4_en' ? 'video/mp4' : 'text/plain',
    byteSize: 123, durationMs: kind.startsWith('voice_') || kind === 'render_mp4_en' ? 1000 : null, sha256: 'a'.repeat(64), storageKey: 'opaque_fixture' });
  async function stage(attempt: PipelineJobAttempt, kind = 'transcript_es') {
    return store.publishArtifact(attempt.accountId, attempt.jobId, attempt.attemptId, metadata(kind));
  }

  it('deduplicates concurrent requests and rejects changed keys or revisions', async () => {
    const body = request();
    const results = await Promise.all(Array.from({ length: 6 }, () => store.createJob(account, body)));
    expect(new Set(results.map(j => j.id)).size).toBe(1);
    expect((await pool.query('SELECT count(*)::int n FROM pipeline_snapshots')).rows[0].n).toBe(1);
    await expect(store.createJob(account, { ...body, config: { ...body.config, model: 'changed' } })).rejects.toMatchObject({ code: 'conflict' });
    await editor.saveSubtitleProject(account, project, 1, 'New text');
    await expect(store.createJob(account, request())).rejects.toMatchObject({ code: 'conflict' });
    expect((await store.getJob(account, results[0].id))?.stale).toBe(true);
    const snap = (await pool.query('SELECT draft,revision FROM pipeline_snapshots')).rows[0];
    expect(snap.revision).toBe(1);
    expect(snap.draft).toContain('Five centimeters');
  });

  it('rejects foreign create/read/cancel/staging and never exposes storage keys', async () => {
    const job = await store.createJob(account, request());
    await expect(store.createJob(stranger, request())).rejects.toMatchObject({ code: 'not_found' });
    expect(await store.getJob(stranger, job.id)).toBeNull();
    expect(await store.listJobs(stranger)).toEqual([]);
    await expect(store.cancelJob(stranger, job.id)).rejects.toMatchObject({ code: 'not_found' });
    const attempt = (await store.claimNext())!;
    await expect(store.publishArtifact(stranger, job.id, attempt.attemptId, metadata())).rejects.toMatchObject({ code: 'not_found' });
    await stage(attempt);
    await store.complete(attempt, 'succeeded');
    const dto = (await store.getJob(account, job.id))!;
    expect(dto.artifacts[0].current).toBe(true);
    expect(JSON.stringify(dto)).not.toContain('opaque_fixture');
    expect(await editor.balance(account)).toEqual({ available: 0, reserved: 0, consumed: 0, credited: 0 });
    expect((await pool.query('SELECT count(*)::int n FROM credit_movements')).rows[0].n).toBe(0);
  });

  it('makes staged invisible as current and completes the whole required manifest atomically', async () => {
    const job = await store.createJob(account, request(randomUUID(), 'translation'));
    const attempt = (await store.claimNext())!;
    await expect(store.complete(attempt, 'succeeded')).rejects.toMatchObject({ code: 'conflict' });
    await stage(attempt, 'translation_en');
    await expect(store.complete(attempt, 'succeeded')).rejects.toMatchObject({ code: 'conflict' });
    expect((await store.getJob(account, job.id))?.artifacts.every(a => !a.current && a.state === 'staged')).toBe(true);
    await stage(attempt, 'subtitle_srt_en');
    await stage(attempt, 'transcript_es');
    await store.complete(attempt, 'succeeded');
    expect((await store.getJob(account, job.id))?.artifacts.every(a => a.current && a.state === 'ready')).toBe(true);
    await expect(stage(attempt, 'translation_en')).rejects.toMatchObject({ code: 'conflict' });
  });

  it('fences cancellation and stale revisions from late completion', async () => {
    const job = await store.createJob(account, request());
    const attempt = (await store.claimNext())!;
    await stage(attempt);
    expect(await store.cancelJob(account, job.id)).toBe(true);
    expect(await store.cancelJob(account, job.id)).toBe(true);
    await expect(store.complete(attempt, 'succeeded')).rejects.toMatchObject({ code: 'conflict' });
    expect((await store.getJob(account, job.id))?.artifacts).toEqual([]);
    await store.createJob(account, request());
    const second = (await store.claimNext())!;
    await stage(second);
    await editor.saveSubtitleProject(account, project, 1, 'Changed');
    await expect(store.complete(second, 'succeeded')).rejects.toMatchObject({ code: 'conflict' });
    expect((await store.getJob(account, second.jobId))?.artifacts.every(a => !a.current)).toBe(true);
  });

  it('only claims once under concurrency and treats expired lease as unknown, not a retry', async () => {
    await store.createJob(account, request());
    const attempts = await Promise.all([store.claimNext(), store.claimNext()]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const attempt = attempts.find(Boolean)!;
    await pool.query("UPDATE pipeline_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [attempt.jobId]);
    await expect(store.renew(attempt)).rejects.toMatchObject({ code: 'conflict' });
    expect(await store.claimNext()).toBeNull();
    expect((await store.getJob(account, attempt.jobId))?.state).toBe('unknown');
    await expect(stage(attempt)).rejects.toMatchObject({ code: 'conflict' });
    expect(await store.claimNext()).toBeNull();
  });

  it('does not claim or publish expired/deleted input and cascades snapshots on editor deletion', async () => {
    const job = await store.createJob(account, request());
    const attempt = (await store.claimNext())!;
    await stage(attempt);
    await pool.query("UPDATE inputs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [project]);
    expect(await store.getJob(account, job.id)).toBeNull();
    await expect(store.complete(attempt, 'succeeded')).rejects.toMatchObject({ code: 'not_found' });
    expect(await store.claimNext()).toBeNull();
    await editor.purgeExpiredInputs();
    expect((await pool.query('SELECT count(*)::int n FROM pipeline_snapshots')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int n FROM pipeline_artifacts')).rows[0].n).toBe(0);
  });

  it('manual deletion removes active pipeline metadata without breaking legacy editor', async () => {
    await store.createJob(account, request());
    const attempt = (await store.claimNext())!;
    expect(await editor.deleteSubtitleProject(account, project)).toBe(true);
    expect((await pool.query('SELECT count(*)::int n FROM pipeline_jobs')).rows[0].n).toBe(0);
    await expect(stage(attempt)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('ready artifacts become stale after editing without modifying saved snapshot', async () => {
    const job = await store.createJob(account, request());
    const attempt = (await store.claimNext())!;
    await stage(attempt);
    await store.complete(attempt, 'succeeded');
    await editor.saveSubtitleProject(account, project, 1, 'Edited');
    const reloaded = await new PipelineStore(pool).getJob(account, job.id);
    expect(reloaded).toMatchObject({ state: 'succeeded', stale: true, revision: 1, currentRevision: 2 });
    expect(reloaded?.artifacts[0].current).toBe(false);
  });

  it('does not treat same-revision tampering as current and refuses claim', async () => {
    const job = await store.createJob(account, request());
    await pool.query('UPDATE subtitle_projects SET draft=$2 WHERE id=$1', [project, 'tampered']);
    expect((await store.getJob(account, job.id))?.stale).toBe(true);
    expect(await store.claimNext()).toBeNull();
    expect((await store.getJob(account, job.id))?.state).toBe('failed');
  });

  it('renders only with completed narration of same account and snapshot', async () => {
    await expect(store.createJob(account, request(randomUUID(), 'render'))).rejects.toMatchObject({ code: 'conflict' });
    const narration = await store.createJob(account, request(randomUUID(), 'narration'));
    await expect(store.createJob(account, request(randomUUID(), 'render', [narration.id]))).rejects.toMatchObject({ code: 'conflict' });
    const attempt = (await store.claimNext())!;
    await stage(attempt, 'voice_full_en');
    await store.complete(attempt, 'succeeded');
    const renderBody = request(randomUUID(), 'render', [narration.id.toUpperCase()]);
    const render = await store.createJob(account, renderBody);
    expect((await store.createJob(account, renderBody)).id).toBe(render.id);
    expect(render.stage).toBe('render');
    await expect(store.createJob(account, { ...request(randomUUID(), 'render', [narration.id]), dependencies: [randomUUID()] })).rejects.toMatchObject({ code: 'conflict' });
    await editor.saveSubtitleProject(account, project, 1, 'changed');
    await expect(store.createJob(account, { ...request(randomUUID(), 'render', [narration.id]), expectedRevision: 2 })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('enforces immutable snapshots and same-account/same-revision artifact FKs', async () => {
    const job = await store.createJob(account, request());
    await expect(pool.query('UPDATE pipeline_snapshots SET draft=$1', ['tampered'])).rejects.toThrow('immutable');
    const attempt = (await store.claimNext())!;
    await stage(attempt);
    await expect(pool.query('UPDATE pipeline_artifacts SET revision=2 WHERE job_id=$1', [job.id])).rejects.toMatchObject({ code: '23503' });
    await expect(pool.query('UPDATE pipeline_artifacts SET account_id=$2 WHERE job_id=$1', [job.id, stranger])).rejects.toMatchObject({ code: '23503' });
    expect((await store.getJob(account, job.id))?.artifacts[0].revision).toBe(1);
  });

  it('cancel versus completion has exactly one consistent terminal outcome', async () => {
    const job = await store.createJob(account, request());
    const attempt = (await store.claimNext())!;
    await stage(attempt);
    const outcomes = await Promise.allSettled([store.cancelJob(account, job.id), store.complete(attempt, 'succeeded')]);
    expect(outcomes.some(r => r.status === 'fulfilled')).toBe(true);
    const result = (await store.getJob(account, job.id))!;
    expect(['cancelled', 'succeeded']).toContain(result.state);
    if (result.state === 'cancelled') expect(result.artifacts).toEqual([]);
    else expect(result.artifacts.every(a => a.current && a.state === 'ready')).toBe(true);
  });

  it('checks shortened TTL after waiting for an input lock', async () => {
    await store.createJob(account, request());
    const attempt = (await store.claimNext())!;
    await stage(attempt);
    const blocker = await pool.connect();
    let completion: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT 1 FROM inputs WHERE id=$1 FOR UPDATE', [project]);
      completion = store.complete(attempt, 'succeeded').then(() => 'unexpected-success', e => e);
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const { rows } = await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [schema]);
        if (rows.length) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await blocker.query("UPDATE inputs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [project]);
      await blocker.query('COMMIT');
      expect(await completion).toMatchObject({ code: 'not_found' });
      expect((await pool.query('SELECT state FROM pipeline_jobs WHERE id=$1', [attempt.jobId])).rows[0].state).toBe('running');
      expect((await pool.query("SELECT count(*)::int n FROM pipeline_artifacts WHERE state='ready'")).rows[0].n).toBe(0);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await completion; }
  });

  it('keeps nonempty highlights current and invalidates them only after a real change', async () => {
    await pool.query(`UPDATE subtitle_projects SET highlights='{"translated":[{"id":"fixture"}]}'::jsonb WHERE id=$1`, [project]);
    const job = await store.createJob(account, request());
    expect(job.stale).toBe(false);
    const attempt = (await store.claimNext())!;
    await stage(attempt);
    await store.complete(attempt, 'succeeded');
    expect((await store.getJob(account, job.id))?.artifacts[0].current).toBe(true);
  });

  it('replays the same request after editing and canonicalizes UUID casing', async () => {
    const body = { ...request(), inputId: project.toUpperCase() };
    const first = await store.createJob(account, body);
    expect((await store.createJob(account, body)).id).toBe(first.id);
    await editor.saveSubtitleProject(account, project, 1, 'edited');
    const replay = await store.createJob(account, body);
    expect(replay).toMatchObject({ id: first.id, stale: true, revision: 1, currentRevision: 2 });
    await expect(store.createJob(account, { ...body, expectedRevision: 2 })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('never promotes staged artifacts from another attempt', async () => {
    const job = await store.createJob(account, request());
    const attempt = (await store.claimNext())!;
    await stage(attempt);
    await pool.query(`INSERT INTO pipeline_artifacts(id,account_id,job_id,revision,attempt_id,kind,state,mime_type,
      byte_size,duration_ms,sha256,storage_key,expires_at) SELECT $1,account_id,id,revision,$2,'voice_preview_en','staged',
      'audio/wav',123,1000,$3,'foreign_attempt',expires_at FROM pipeline_jobs WHERE id=$4`,
      [randomUUID(),randomUUID(),'b'.repeat(64),job.id]);
    await store.complete(attempt, 'succeeded');
    const result = (await store.getJob(account, job.id))!;
    expect(result.artifacts.find(a => a.kind === 'voice_preview_en')).toMatchObject({ state: 'staged', current: false });
  });

  it('invalidates a completed artifact when highlights change without revision increment', async () => {
    const job = await store.createJob(account, request());
    const attempt = (await store.claimNext())!;
    await stage(attempt);
    await store.complete(attempt, 'succeeded');
    await pool.query(`UPDATE subtitle_projects SET highlights='{"translated":[{"id":"changed"}]}'::jsonb WHERE id=$1`, [project]);
    const changed = (await store.getJob(account, job.id))!;
    expect(changed.stale).toBe(true);
    expect(changed.artifacts[0].current).toBe(false);
  });

});
