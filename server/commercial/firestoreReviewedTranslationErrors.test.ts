import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { AI_CATALOG_VERSION, artifactPlan, artifactPlanHash } from './aiContracts';
import { FirestoreReviewedTranslation } from './firestoreReviewedTranslation';
import { JobError } from './jobs';
import { encodeTextBundle } from './pipelineTextCodec';
import { privateBucket } from './privateObjectPlan';
import * as reviewModule from './reviewedTranslation';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function syntheticContext(accounting: 'simulation' | 'account_seconds' | 'unverified' = 'simulation') {
  const accountId = randomUUID(), inputId = randomUUID(), jobId = randomUUID(), attemptId = randomUUID(), uid = `synthetic-${randomUUID()}`;
  const sourceSha = hash('synthetic-video'), emptySha = hash(''), expiry = Date.now() + 60_000;
  const source = { bucket: privateBucket, key: `candidate-files-v1/${inputId}/video.mp4`, generation: '11', size: 12, sha256: sourceSha };
  const bundle = encodeTextBundle(jobId, 2_000, { detectedLanguage: 'es', hasSpeech: true, cues: [
    { startMs: 0, endMs: 1_500, es: 'Cinco centímetros.', en: 'Five centimeters.' },
  ] });
  const sourceBytes = Buffer.from(JSON.stringify({ durationMs: bundle.durationMs, cues: bundle.cues }));
  const plan = artifactPlan(jobId, inputId, 'translation:en');
  const entries = plan.artifacts.map(spec => {
    const bytes = spec.name === 'cues.json' ? sourceBytes : Buffer.from('x');
    return { name: spec.name, key: spec.key, mimeType: spec.mimeType, generation: '17', size: bytes.length, sha256: hash(bytes) };
  });
  const data = new Map<string, Record<string, unknown>>([
    [`identities/${hash(JSON.stringify(['firebase', uid]))}`, { uid, accountId }],
    [`accounts/${accountId}`, { aiPilot: true, simulationOnly: true }],
    [`inputs/${inputId}`, { accountId, ready: true, deleted: false, expiresAtMs: expiry, sha256: sourceSha, metadata: { duration: 2, audioTracks: 1 }, storage: source }],
    [`jobs/${jobId}`, { accountId, inputId, state: 'succeeded', operation: 'translation:en', aiProfile: AI_CATALOG_VERSION,
      revision: 1, price: 2, inputSha256: sourceSha, inputStorage: source, snapshotSha256: emptySha }],
    [`artifacts/${jobId}`, { accountId, inputId, jobId, state: 'ready', revision: 1, expiresAtMs: expiry, plan,
      planHash: artifactPlanHash(plan), sourceGeneration: source.generation, inputSha256: sourceSha,
      snapshotSha256: emptySha, attemptId, quotaMode: 'committed', quotaHeld: entries.reduce((n, item) => n + item.size, 0), entries }],
    [`projects/${inputId}`, { accountId, inputId, revision: 1, draft: '' }],
    [`movements/terminal:${jobId}`, { accountId, reference: jobId, credits: 2, kind: 'capture' }],
  ]);
  const root = { collection: (collection: string) => ({ doc: (id: string) => ({ id, path: `${collection}/${id}` }) }) };
  const snapshot = (ref: { id: string; path: string }) => {
    const value = data.get(ref.path);
    return { id: ref.id, exists: value !== undefined, data: () => value, get: (name: string) => value?.[name] };
  };
  let transactions = 0, writes = 0, reads = 0;
  const tx = {
    getAll: async (...refs: Array<{ id: string; path: string }>) => refs.map(snapshot),
    get: async (ref: { id: string; path: string }) => snapshot(ref),
    create: () => { writes++; }, update: () => { writes++; },
  };
  const db = { runTransaction: async (callback: (transaction: typeof tx) => unknown) => { transactions++; return callback(tx); } };
  const objects = { read: async () => { reads++; return Readable.from([sourceBytes]); } };
  const backend = { jobAccounting: async () => accounting };
  const service = new FirestoreReviewedTranslation(db as never, root as never, backend as never, objects);
  const request = { inputId, jobId, expectedRevision: 1, requestKey: randomUUID(), edits: [{ id: bundle.cues[0].id, en: 'Five centimeters.' }] };
  return { service, accountId, principal: { accountId, uid }, request, data, counts: () => ({ transactions, writes, reads }) };
}

describe('review save error classification', () => {
  it.each(['unverified', 'account_seconds'] as const)(
    'rejects %s accounting without reading the source or writing a review', async accounting => {
      const c = syntheticContext(accounting);
      const error = await c.service.saveReview(c.principal, c.request).catch(value => value);
      expect(error).toMatchObject({ code: 'not_found', message: 'not_found' });
      expect(c.counts()).toEqual({ transactions: 1, writes: 0, reads: 0 });
    },
  );
  it.each([
    [new JobError('invalid_input', 'synthetic-private-input-detail'), 'invalid'],
    [new JobError('conflict', 'synthetic-private-conflict-detail'), 'unavailable'],
    [new Error('synthetic-private-internal-detail'), 'unavailable'],
    [new Error('invalid_input'), 'unavailable'],
  ])('classifies %s as %s without exposing its message', async (thrown, expected) => {
    const c = syntheticContext();
    const spy = vi.spyOn(reviewModule, 'reviewTranslation').mockImplementation(() => { throw thrown; });
    try {
      const error = await c.service.saveReview(c.principal, c.request).catch(value => value);
      expect(error).toMatchObject({ code: expected, message: expected });
      expect(error.message).not.toContain('synthetic-private');
      expect(spy).toHaveBeenCalledOnce();
      expect(c.counts()).toEqual({ transactions: 1, writes: 0, reads: 1 });
    } finally { spy.mockRestore(); }
  });

  it('reports an actual invalid cue ID as invalid without writing', async () => {
    const c = syntheticContext();
    c.request.edits[0].id = 'f'.repeat(64);
    const error = await c.service.saveReview(c.principal, c.request).catch(value => value);
    expect(error).toMatchObject({ code: 'invalid', message: 'invalid' });
    expect(c.counts()).toEqual({ transactions: 1, writes: 0, reads: 1 });
  });
});

describe('review caller identity', () => {
  it.each(['missing', 'other_account', 'different_uid'] as const)('rejects %s identity before accessing content or mutating review', async mode => {
    const c = syntheticContext(), identityPath = `identities/${hash(JSON.stringify(['firebase', c.principal.uid]))}`;
    if (mode === 'missing') c.data.delete(identityPath);
    if (mode === 'other_account') c.data.set(identityPath, { uid: c.principal.uid, accountId: randomUUID() });
    if (mode === 'different_uid') c.data.set(identityPath, { uid: 'synthetic-other-uid', accountId: c.accountId });
    for (const run of [
      () => c.service.readSource(c.principal, c.request.inputId, c.request.jobId),
      () => c.service.saveReview(c.principal, c.request),
      () => c.service.downloadReview(c.principal, { inputId: c.request.inputId, jobId: c.request.jobId, revision: 2, format: 'txt' }),
    ]) {
      const error = await run().catch(value => value); expect(error).toMatchObject({ code: 'not_found' });
    }
    expect(c.counts()).toEqual({ transactions: 3, writes: 0, reads: 0 });
  });
  it('rejects an unverified-shaped principal before any transaction', async () => {
    const c = syntheticContext(), error = await c.service.saveReview({ accountId: c.accountId } as never, c.request).catch(value => value);
    expect(error).toMatchObject({ code: 'invalid' }); expect(c.counts()).toEqual({ transactions: 0, writes: 0, reads: 0 });
  });
  it('copies the original principal before asynchronous work', async () => {
    const c = syntheticContext(), principal = { ...c.principal }, pending = c.service.readSource(principal, c.request.inputId, c.request.jobId);
    principal.uid = 'synthetic-other-uid'; principal.accountId = randomUUID();
    expect((await pending).status).toBe('original'); expect(c.counts().transactions).toBe(2);
  });
});
