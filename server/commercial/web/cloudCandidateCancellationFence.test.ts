import { describe, expect, it } from 'vitest';
import { candidateApi, RequestBook, type CandidateLock, type Store } from './cloudCandidateApi';

// Only synthetic IDs and a stub transport are used in these browser-storage races.
const account = '10000000-0000-4000-8000-000000000001';
const input = '20000000-0000-4000-8000-000000000001';
const otherInput = '20000000-0000-4000-8000-000000000002';
const job = '30000000-0000-4000-8000-000000000001';
class MemoryStore implements Store {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
class SerialLock implements CandidateLock {
  private tail: Promise<void> = Promise.resolve();
  async request<T>(_name: string, signal: AbortSignal, action: () => Promise<T>) {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { signal.throwIfAborted(); return await action(); } finally { release(); }
  }
}
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const status = (billingState: 'settled' | 'review' = 'settled') => ({
  id: job, inputId: input, operation: 'translation:en', state: 'cancelled', billingState,
  billing: { mode: 'account_seconds', unit: 'video_seconds' }, revision: 1, stale: false, units: 3, results: [],
});
function setup(pending = true) {
  const store = new MemoryStore(), book = new RequestBook(account, store), controller = new AbortController();
  const lock = new SerialLock(), started = defer<void>(), released = defer<Response>();
  let statusReads = 0, cancellationDeletes = 0, inputDeletes = 0;
  book.rememberInput(input); book.rememberJob(input, 'translation:en', job);
  if (pending) book.markCancel(input, job);
  const request = (async (path, init) => {
    if (String(path) === `/api/cloud/ai/jobs/${job}`) {
      if (init?.method === 'DELETE') cancellationDeletes++; else statusReads++;
      started.resolve(); return released.promise;
    }
    if (String(path) === `/api/cloud/uploads/${input}` && init?.method === 'DELETE') {
      inputDeletes++; return reply({ id: input, state: 'deleting' }, 202);
    }
    if (String(path) === `/api/cloud/uploads/${input}` && init?.method === 'GET') return reply({id:input,state:'ready',size:10,offset:10,name:'synthetic.mp4'});
    throw Error('Unexpected synthetic request');
  }) as typeof fetch;
  const api = candidateApi({ accountId: account, token: async () => 'synthetic-token',
    signal: controller.signal, store, request, lock });
  return { api, book, controller, store, started, released,
    counts: () => ({ statusReads, cancellationDeletes, inputDeletes }) };
}

describe('local cancellation response fences', () => {
  it('confirms a current cancellation without losing its normal behavior', async () => {
    const f = setup(), read = f.api.resolveCancellation(input, job);
    await f.started.promise; f.released.resolve(reply(status()));
    expect((await read).state).toBe('cancelled'); expect(f.book.cancelPending(input)).toBeNull();
    expect(f.counts()).toEqual({ statusReads: 1, cancellationDeletes: 0, inputDeletes: 0 });
  });
  it('keeps the pending marker and historical reference when the input was removed', async () => {
    const f = setup(), read = f.api.resolveCancellation(input, job);
    await f.started.promise; const removed = await f.api.remove(input);
    expect(removed.pendingReferenceRetained).toBe(true); expect(f.book.input()).toBeNull();
    f.released.resolve(reply(status())); await expect(read).rejects.toMatchObject({ code: 'stale_job_response' });
    expect(f.book.cancelPending(input)).toBe(job);
    expect(f.book.reviewReferences()).toEqual([{ inputId: input, jobId: job, operation: 'translation:en' }]);
  });
  it('reports confirmed withdrawal even when local input retirement fails and fences its old response', async () => {
    const f = setup(), read = f.api.resolveCancellation(input, job).catch(error => error);
    await f.started.promise;
    const set = f.store.setItem.bind(f.store);
    f.store.setItem = (key, value) => { if (key.endsWith(':input-generation')) throw Error('synthetic storage failure'); set(key, value); };
    let removed: Awaited<ReturnType<typeof f.api.remove>>;
    try { removed = await f.api.remove(input); } finally { f.released.resolve(reply(status())); }
    expect(removed.state).toBe('deleting'); expect(removed.localKeyRetired).toBe(false);
    expect(removed.localCleanupFailed).toBe(true); expect((await read).code).toBe('stale_job_response');
    expect(f.book.cancelPending(input)).toBe(job);
    expect(f.book.reviewReferences()).toEqual([{ inputId: input, jobId: job, operation: 'translation:en' }]);
  });
  it('does not apply a response after the current input is replaced', async () => {
    const f = setup(), read = f.api.resolveCancellation(input, job);
    await f.started.promise; f.book.rememberInput(otherInput);
    f.released.resolve(reply(status('review'))); await expect(read).rejects.toMatchObject({ code: 'stale_job_response' });
    expect(f.book.input()).toBe(otherInput); expect(f.book.cancelPending(input)).toBe(job);
    expect(f.book.reviewMark(job)).toBeNull();
  });
  it('does not accept an old response after a cooperative input A → B → A replacement', async () => {
    const f = setup(), read = f.api.resolveCancellation(input, job);
    await f.started.promise; f.book.rememberInput(otherInput); f.book.rememberInput(input);
    f.released.resolve(reply(status())); await expect(read).rejects.toMatchObject({ code: 'stale_job_response' });
    expect(f.book.input()).toBe(input); expect(f.book.cancelPending(input)).toBe(job);
  });
  it('does not persist a review from a status response after the session ends', async () => {
    const f = setup(), read = f.api.resolveCancellation(input, job);
    await f.started.promise; f.controller.abort(); f.released.resolve(reply(status('review')));
    await expect(read).rejects.toThrow(); expect(f.book.reviewMark(job)).toBeNull();
    expect(f.book.cancelPending(input)).toBe(job);
  });
  it('keeps the preexisting cancellation marker when DELETE resolves after the session ends', async () => {
    const f = setup(false), cancellation = f.api.cancel(input, job);
    await f.started.promise; expect(f.book.cancelPending(input)).toBe(job);
    f.controller.abort(); f.released.resolve(reply(status('review')));
    await expect(cancellation).rejects.toThrow(); expect(f.book.reviewMark(job)).toBeNull();
    expect(f.book.cancelPending(input)).toBe(job); expect(f.counts().cancellationDeletes).toBe(1);
  });
  it('still sends and confirms a normal cancellation exactly once', async () => {
    const f = setup(false), cancellation = f.api.cancel(input, job);
    await f.started.promise; expect(f.book.cancelPending(input)).toBe(job);
    f.released.resolve(reply(status())); expect((await cancellation).state).toBe('cancelled');
    expect(f.book.cancelPending(input)).toBeNull(); expect(f.counts().cancellationDeletes).toBe(1);
  });
  it('fails closed before contacting the service if the remembered input is absent', async () => {
    const f = setup(); f.book.forgetInput(); f.released.resolve(reply(status()));
    await expect(f.api.resolveCancellation(input, job)).rejects.toMatchObject({ code: 'stale_job_response' });
    expect(f.book.cancelPending(input)).toBe(job); expect(f.counts().statusReads).toBe(0);
  });
  it('initializes an old selection without a generation before resuming a cancellation', async () => {
    const f = setup(), generation = `vistavo-candidate-v1:${account}:input-generation`;
    f.store.removeItem(generation);
    const read = f.api.resolveCancellation(input, job); await f.started.promise;
    expect(f.store.getItem(generation)).not.toBeNull(); f.released.resolve(reply(status()));
    expect((await read).state).toBe('cancelled'); expect(f.book.cancelPending(input)).toBeNull();
  });
  it('does not contact the service when a missing generation cannot be saved', async () => {
    const f = setup(), generation = `vistavo-candidate-v1:${account}:input-generation`;
    f.store.removeItem(generation);
    const set = f.store.setItem.bind(f.store);
    f.store.setItem = (key, value) => { if (key === generation) throw Error('synthetic storage failure'); set(key, value); };
    await expect(f.api.resolveCancellation(input, job)).rejects.toThrow();
    expect(f.counts().statusReads).toBe(0); expect(f.book.cancelPending(input)).toBe(job);
  });
  it('does not replace a corrupt generation or contact the service', async () => {
    const f = setup(), generation = `vistavo-candidate-v1:${account}:input-generation`;
    f.store.setItem(generation, 'invalid');
    await expect(f.api.resolveCancellation(input, job)).rejects.toThrow();
    expect(f.counts().statusReads).toBe(0); expect(f.store.getItem(generation)).toBe('invalid');
    expect(f.book.cancelPending(input)).toBe(job);
  });
  it.each([
    ['unknown job', { state: 'unknown', billingState: 'settled' }],
    ['pending settlement', { state: 'cancelled', billingState: 'pending' }],
    ['financial review', { state: 'cancelled', billingState: 'review' }],
    ['missing settlement', { state: 'cancelled', billingState: undefined }],
    ['simulation is not terminal evidence', { state: 'cancelled', billingState: 'simulated', billing: { mode: 'simulation', unit: 'test-unit' } }],
    ['mismatched simulated settlement', { state: 'cancelled', billingState: 'settled', billing: { mode: 'simulation', unit: 'test-unit' } }],
    ['mismatched units', { state: 'cancelled', billingState: 'settled', billing: { mode: 'account_seconds', unit: 'test-unit' } }],
    ['missing billing mode', { state: 'cancelled', billingState: 'settled', billing: undefined }],
  ])('keeps the cancellation pending for %s', async (_label, override) => {
    const f = setup(), read = f.api.resolveCancellation(input, job); await f.started.promise;
    f.released.resolve(reply({ ...status(), ...override })); await read;
    expect(f.book.cancelPending(input)).toBe(job);
  });
  it.each(['succeeded', 'failed', 'cancelled'])('confirms a %s job only with real settled billing', async state => {
    const f = setup(), read = f.api.resolveCancellation(input, job); await f.started.promise;
    f.released.resolve(reply({ ...status(), state })); await read;
    expect(f.book.cancelPending(input)).toBeNull();
  });
  it.each([
    { state: 'unknown', billingState: 'settled' },
    { state: 'cancelled', billingState: 'pending' },
    { state: 'cancelled', billingState: 'simulated', billing: { mode: 'simulation', unit: 'test-unit' } },
  ])('keeps DELETE pending while the response is not financially conclusive: %j', async override => {
    const f = setup(false), cancellation = f.api.cancel(input, job); await f.started.promise;
    f.released.resolve(reply({ ...status(), ...override })); await cancellation;
    expect(f.book.cancelPending(input)).toBe(job);
  });
});
