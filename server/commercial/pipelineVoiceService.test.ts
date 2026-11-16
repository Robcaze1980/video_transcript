import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { JobError } from './jobs';
import { PipelineVoiceService } from './pipelineVoiceService';
import { VoiceOutcomeUnknown } from './pipelineVoiceProvider';
import { validateWavRiff } from './pipelineVoiceWav';

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const PROJECT = '44444444-4444-4444-8444-444444444444';

function l16(samples: number): Buffer {
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE((index % 1500) - 750, index * 2);
  return buffer;
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    jobId: '11111111-1111-4111-8111-111111111111',
    accountId: ACCOUNT,
    stage: 'narration',
    attemptId: '33333333-3333-4333-8333-333333333333',
    leaseUntil: new Date(Date.now() + 30_000).toISOString(),
    revision: 3,
    snapshotHash: 'a'.repeat(64),
    config: {
      stage: 'narration',
      provider: 'gemini',
      model: 'gemini-3.8-flash-tts',
      voiceId: 'Kore',
      voiceGender: 'female',
      sourceLanguage: 'es',
      targetLanguage: 'en',
    },
    snapshot: {
      revision: 3,
      draft: '1\n00:00:00,000 --> 00:00:01,000\nHello there\n',
      originalDraft: null,
      duration: 12,
      style: null,
      highlights: {},
    },
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  } as never;
}

interface HarnessOptions {
  poolQuery?: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  provider?: { synthesize: (...args: unknown[]) => Promise<{ l16: Buffer }> };
}

function harness(options: HarnessOptions = {}) {
  const published: any[] = [];
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (options.poolQuery) return options.poolQuery(sql);
      if (String(sql).includes('pipeline_narrations')) return { rows: [], rowCount: 0 };
      return { rows: [{}], rowCount: 1 };
    }),
  } as unknown as Pool;
  (pool as any).connect = async()=>({query:pool.query,release(){}});
  const jobs = { fileInput: vi.fn(async () => ({ metadata: { duration: 12, audioTracks: 1 } })) } as never;
  const files = {
    append: vi.fn(async () => true),
    open: vi.fn(async () => ({})),
    remove: vi.fn(async () => undefined),
  } as never;
  const provider = options.provider ?? { synthesize: vi.fn(async () => ({ l16: l16(4800) })) };
  const service = new PipelineVoiceService(pool, jobs, files, provider as never);
  return { service, pool, files, provider, published };
}

function spyStore(service: PipelineVoiceService, published: any[]) {
  vi.spyOn(service.store, 'claimNext').mockResolvedValue(attempt());
  vi.spyOn(service.store, 'renew').mockResolvedValue(true);
  const publish = vi
    .spyOn(service.store, 'publishArtifact')
    .mockImplementation(async (_accountId, _jobId, _attemptId, artifact) => {
      published.push(artifact);
      return artifact as never;
    });
  const complete = vi.spyOn(service.store, 'complete').mockImplementation(async (_attempt, next, run) => {
    if (next === 'succeeded' && run) {
      await run({
        query: async (sql: string) => {
          const text = String(sql);
          const artifact = published[0];
          if (text.includes('FROM pipeline_artifacts')) {
            return {
              rows: [{
                byte_size: artifact.byteSize,
                sha256: artifact.sha256,
                storage_key: artifact.storageKey,
                duration_ms: artifact.durationMs,
              }],
              rowCount: 1,
            };
          }
          if (text.includes('SELECT project_id FROM pipeline_jobs')) {
            return { rows: [{ project_id: PROJECT }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        },
      } as never);
    }
    return true;
  });
  return { publish, complete };
}

describe('narration service', () => {
  it('reserves quota before the provider, writes a validated WAV and records the narration', async () => {
    const { service, pool, files, provider } = harness();
    const { complete } = spyStore(service, (harness as never as { published?: never }) && []);

    await service.runOnce();

    expect(pool.query).toHaveBeenCalledWith('SELECT pipeline_voice_reserve($1,$2,$3,$4,$5)', expect.any(Array));
    expect(provider.synthesize).toHaveBeenCalledTimes(1);

    const append = (files as unknown as { append: { mock: { calls: unknown[][] } } }).append;
    expect(append.mock.calls).toHaveLength(1);
    const [storageId, persistedOffset, requestedOffset, wav] = append.mock.calls[0] as [string, number, number, Buffer];
    expect(storageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(persistedOffset).toBe(0);
    expect(requestedOffset).toBe(0);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(validateWavRiff(wav).durationMs).toBe(200);

    expect(pool.query).toHaveBeenCalledWith('SELECT pipeline_voice_commit($1,$2,$3)', [ACCOUNT, storageId, wav.length]);
    expect(complete).toHaveBeenCalledWith(expect.anything(), 'succeeded', expect.any(Function));
  });

  it('releases the reservation, removes the staged file and marks unknown when the provider outcome is unknown', async () => {
    const provider = {
      synthesize: vi.fn(async () => { throw new VoiceOutcomeUnknown('provider unreachable'); }),
    };
    const { service, pool, files } = harness({ provider });
    const { complete } = spyStore(service, []);

    await service.runOnce();

    expect(pool.query).toHaveBeenCalledWith('SELECT pipeline_voice_release($1,$2)', [ACCOUNT, expect.any(String)]);
    // Durable release is removed by reconcile, after its reservation row is locked.
    expect((files as any).remove).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(expect.anything(), 'unknown');
  });

  it('fails the job without a file when the saved draft has no English text', async () => {
    const { service, files } = harness();
    vi.spyOn(service.store, 'claimNext').mockResolvedValue(attempt({
      snapshot: { revision: 3, draft: '   ', originalDraft: null, duration: 12, style: null, highlights: {} },
    }));
    const complete = vi.spyOn(service.store, 'complete').mockResolvedValue(true);

    await service.runOnce();

    expect(complete).toHaveBeenCalledWith(expect.anything(), 'failed');
    expect((files as unknown as { append: { mock: { calls: unknown[][] } } }).append).not.toHaveBeenCalled();
  });

  it('rejects request-time narration when the project has no saved text', async () => {
    const { service } = harness({
      poolQuery: async (sql: string) =>
        String(sql).includes('FROM subtitle_projects')
          ? { rows: [{ draft: '' }], rowCount: 1 }
          : { rows: [{}], rowCount: 1 },
    });
    await expect(service.request(ACCOUNT, PROJECT, 'Kore', 1, 'key')).rejects.toBeInstanceOf(JobError);
  });

  it('rejects request-time narration for a voice outside the allowlist', async () => {
    const { service } = harness();
    await expect(service.request(ACCOUNT, PROJECT, 'Puck', 1, 'key')).rejects.toBeInstanceOf(JobError);
  });

  it('reports quota pressure as a conflict without contacting the provider', async () => {
    const provider = { synthesize: vi.fn(async () => ({ l16: l16(240) })) };
    const { service } = harness({
      provider,
      poolQuery: async (sql: string) => {
        if (String(sql).startsWith('SELECT pipeline_voice_reserve')) {
          const error = new Error('voice quota exceeded') as Error & { code: string };
          error.code = '23514';
          throw error;
        }
        if (String(sql).includes('pipeline_narrations')) return { rows: [], rowCount: 0 };
        return { rows: [{}], rowCount: 1 };
      },
    });
    vi.spyOn(service.store, 'claimNext').mockResolvedValue(attempt());
    const complete = vi.spyOn(service.store, 'complete').mockResolvedValue(true);

    await service.runOnce();

    expect(provider.synthesize).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(expect.anything(), 'failed');
  });

  it('keeps a successful audio stream bounded to the stored byte size', async () => {
    const { service, pool } = harness({
      poolQuery: async (sql: string) => {
        const text = String(sql);
        if (text.includes('FROM pipeline_narrations n')) {
          return { rows: [{ storage_id: randomUUID(), byte_size: 1024, duration_ms: 500, sha256: 'b'.repeat(64), voice_id: 'Kore', voice_gender: 'female', revision: 3, expires_at: new Date(Date.now() + 60_000) }], rowCount: 1 };
        }
        if (text.includes('SELECT n.storage_id')) return { rows: [{ storage_id: randomUUID() }], rowCount: 1 };
        return { rows: [{}], rowCount: 1 };
      },
    });
    vi.spyOn(service.store, 'getJob').mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      stage: 'narration',
      config:{stage:'narration',model:'gemini-3.8-flash-tts'},
      stale: false,
    } as never);

    const result = await service.audio(ACCOUNT, '11111111-1111-4111-8111-111111111111', { start: 10 });
    expect(result).toMatchObject({ mimeType: 'audio/wav', start: 10, end: 1023, byteSize: 1024 });
    expect(pool.query).toHaveBeenCalled();
  });
});
