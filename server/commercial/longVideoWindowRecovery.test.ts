import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountStore } from '../account/backend';
import { createLongVideoWindowFixture, type FixtureCall, type FixtureReservation, type FixtureVideo, type FixtureWindowFiles } from './longVideoWindowRecovery.fixture';
import { videoReservationId } from './videoReservationId';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const principal = { accountId: id(1), uid: 'synthetic-window-owner' };
const jobId = id(2), inputId = id(3), attemptId = id(4), requestKey = id(5);
const identityKey = AccountStore.identityKey(principal.uid);
const reservationId = videoReservationId(principal.accountId, identityKey, inputId, 'translation:en', 1, requestKey);
const requests = Array.from({ length: 6 }, (_, ordinal) => createHash('sha256').update(`synthetic-window-request-${ordinal}`).digest('hex'));
const fileKey = /^[a-f0-9]{64}-(manifest|\d{1,2}-(intent|result|receipt))$/;
const directories: string[] = [];

beforeEach(() => vi.stubEnv('LV_LONG_VIDEO_RECOVERY_TEST', '1'));
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    for (const key of await readdir(directory)) {
      expect(fileKey.test(key)).toBe(true);
      await unlink(join(directory, key));
    }
    await rmdir(directory);
  }
});

function response(call: FixtureCall) {
  const index = Number(call.callKey.slice(-4));
  const cue = { startMs: 0, endMs: index === 5 ? 250 : 30_000, es: `Ventana sintética ${index}.`, en: `Synthetic window ${index}.` };
  return { detectedLanguage: 'es', hasSpeech: true, cues: [cue] };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'vistavo-test-window-recovery-'));
  directories.push(directory);
  const path = (key: string) => {
    if (!fileKey.test(key)) throw Error('Unexpected fixture key');
    return join(directory, key);
  };
  // Each worker opens fresh handles. No worker object caches the source result.
  function disk(): FixtureWindowFiles {
    return {
      async read(key) {
        try { return await readFile(path(key)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
      },
      async create(key, bytes) {
        let handle;
        try { handle = await open(path(key), 'wx', 0o600); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
        try { await handle.writeFile(bytes); await handle.sync(); }
        finally { await handle.close(); }
        return true;
      },
    };
  }
  const video: FixtureVideo = { ...principal, jobId, inputId, attemptId, reservationId,
    revision: 1, authorityVersion: 1, sourceGeneration: '1', sourceSha256: 'f'.repeat(64), durationSeconds: 150.25, requests };
  const reserve: FixtureReservation = { identityKey, reservationId, seconds: 151, state: 'reserved' };
  const account = new Map([[reservationId, reserve]]), admissions = new Set<string>();
  const ports = {
    video: vi.fn(async (): Promise<FixtureVideo | null> => video),
    reservation: vi.fn(async (identity: string, key: string) => identity === identityKey ? account.get(key) ?? null : null),
    admit: vi.fn(async (call: FixtureCall) => {
      const held = account.get(call.reservationId);
      if (!held || held.seconds !== call.seconds || held.identityKey !== call.identityKey) throw Error('Fixture reserve mismatch');
      const created = !admissions.has(call.callKey);
      admissions.add(call.callKey);
      return { ...call, created, receiptOnly: !created };
    }),
    receive: vi.fn(async (call: FixtureCall) => response(call)),
  };
  return { worker: (files = disk()) => createLongVideoWindowFixture(files, ports), disk, path, directory, video, reserve, account, ports };
}

const counts = (f: Awaited<ReturnType<typeof fixture>>) => [f.ports.admit.mock.calls.length, f.ports.receive.mock.calls.length];

it('requires the test switch and rejects an unrelated UID before opening any window', async () => {
  const f = await fixture();
  vi.stubEnv('LV_LONG_VIDEO_RECOVERY_TEST', '');
  await expect(f.worker().prepare(principal, jobId)).rejects.toMatchObject({ code: 'disabled' });
  expect(f.ports.video).not.toHaveBeenCalled();
  vi.stubEnv('LV_LONG_VIDEO_RECOVERY_TEST', '1');
  await expect(f.worker().prepare({ ...principal, uid: 'synthetic-other' }, jobId)).rejects.toMatchObject({ code: 'denied' });
  await expect(f.worker().prepare({ ...principal, accountId: id(10) }, jobId)).rejects.toMatchObject({ code: 'denied' });
  expect(counts(f)).toEqual([0, 0]);
  expect(await readdir(f.directory)).toEqual([]);
});

it('reopens committed windows after the receipt response was lost and assembles each only once', async () => {
  const f = await fixture(), files = f.disk();
  await f.worker().prepare(principal, jobId);
  const interrupted = f.worker({ ...files, async create(key, bytes) {
    const committed = await files.create(key, bytes);
    if (key.endsWith('-1-receipt')) throw Error('Synthetic reply lost after committing receipt');
    return committed;
  } });
  await expect(interrupted.assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
  expect(counts(f)).toEqual([2, 2]);
  const result = await f.worker().assemble(principal, jobId);
  expect(counts(f)).toEqual([6, 6]);
  expect(result.cues.map(cue => [cue.startMs, cue.endMs])).toEqual([
    [0, 30_000], [30_000, 60_000], [60_000, 90_000], [90_000, 120_000], [120_000, 150_000], [150_000, 150_250],
  ]);
  expect((await f.worker().assemble(principal, jobId)).en.srtSha256).toBe(result.en.srtSha256);
  expect(f.ports.receive.mock.calls.map(([call]) => call.callKey)).toEqual(requests.map((_, index) => `text-window:000${index}`));
  expect(f.ports.admit.mock.calls.every(([call]) => call.reservationId === reservationId && call.seconds === 151)).toBe(true);
  expect([...f.account.values()]).toEqual([f.reserve]);
  expect(counts(f)).toEqual([6, 6]);
});

it.each(['admission lost', 'result lost', 'invalid result', 'bytes without receipt', 'receipt only'] as const)(
  'stays unknown across reopening after %s and does not start another window', async where => {
    const f = await fixture(), files = f.disk();
    await f.worker().prepare(principal, jobId);
    if (where === 'admission lost') f.ports.admit.mockRejectedValueOnce(Error('synthetic transport error'));
    if (where === 'result lost') f.ports.receive.mockRejectedValueOnce(Error('synthetic transport error'));
    if (where === 'invalid result') f.ports.receive.mockImplementationOnce(async call => {
      const value = response(call);
      value.cues[0].endMs = 30_001;
      return value;
    });
    if (where === 'receipt only') f.ports.admit.mockImplementationOnce(async call => ({ ...call, created: false, receiptOnly: true }));
    const worker = where === 'bytes without receipt' ? f.worker({ ...files, async create(key, bytes) {
      if (key.endsWith('-0-receipt')) throw Error('synthetic receipt write failed');
      return files.create(key, bytes);
    } }) : f.worker();
    await expect(worker.assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown', message: 'window_fixture_unknown' });
    const previous = counts(f);
    expect(previous).toEqual([1, where === 'admission lost' || where === 'receipt only' ? 0 : 1]);
    await expect(f.worker().assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
    expect(counts(f)).toEqual(previous);
    expect([...f.account.values()]).toEqual([f.reserve]);
  },
);

it.each(['revision', 'authorityVersion', 'sourceGeneration', 'requestOrder', 'attempt'] as const)(
  'refuses a different %s before delivering a saved result', async field => {
    const f = await fixture();
    await f.worker().prepare(principal, jobId);
    await f.worker().assemble(principal, jobId);
    const changes = { revision: { revision: 2 }, authorityVersion: { authorityVersion: 2 }, sourceGeneration: { sourceGeneration: '2' },
      requestOrder: { requests: [...requests].reverse() }, attempt: { attemptId: id(9) } };
    f.ports.video.mockResolvedValue({ ...f.video, ...changes[field] });
    await expect(f.worker().prepare(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
    await expect(f.worker().assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
    expect(counts(f)).toEqual([6, 6]);
  },
);

it('does not return saved results without the original reserve and exact source seconds', async () => {
  const f = await fixture();
  await f.worker().prepare(principal, jobId);
  await f.worker().assemble(principal, jobId);
  f.account.set(reservationId, { ...f.reserve, seconds: 30 });
  await expect(f.worker().assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
  f.account.delete(reservationId);
  await expect(f.worker().assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
  expect(counts(f)).toEqual([6, 6]);
});

it('rejects a damaged receipt, switched bytes and loss of the manifest without resending', async () => {
  const f = await fixture();
  await f.worker().prepare(principal, jobId);
  await f.worker().assemble(principal, jobId);
  const keyFor = async (suffix: string) => (await readdir(f.directory)).find(key => key.endsWith(suffix))!;
  const receipt = await keyFor('-0-receipt'), prior = await readFile(f.path(receipt));
  await writeFile(f.path(receipt), '{}');
  await expect(f.worker().assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
  await writeFile(f.path(receipt), prior);
  const first = await keyFor('-0-result'), bytes = await readFile(f.path(first));
  await writeFile(f.path(first), await readFile(f.path(await keyFor('-1-result'))));
  await expect(f.worker().assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
  await writeFile(f.path(first), bytes);
  await unlink(f.path(await keyFor('-manifest')));
  await expect(f.worker().prepare(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
  await expect(f.worker().assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
  expect(counts(f)).toEqual([6, 6]);
});

it('leaves only an intent if authorization is lost during receipt of a result', async () => {
  const f = await fixture();
  await f.worker().prepare(principal, jobId);
  f.ports.receive.mockImplementationOnce(async call => { f.ports.video.mockResolvedValue(null); return response(call); });
  await expect(f.worker().assemble(principal, jobId)).rejects.toMatchObject({ code: 'denied' });
  expect((await readdir(f.directory)).some(key => /-(result|receipt)$/.test(key))).toBe(false);
  f.ports.video.mockResolvedValue(f.video);
  await expect(f.worker().assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
  expect(counts(f)).toEqual([1, 1]);
});

it('rejects evidence outside the window plan and a missing window before a later receipt', async () => {
  const f = await fixture();
  await f.worker().prepare(principal, jobId);
  await f.worker().assemble(principal, jobId);
  const firstIntent = (await readdir(f.directory)).find(key => key.endsWith('-0-intent'))!;
  const extra = firstIntent.replace('-0-intent', '-6-intent');
  await writeFile(f.path(extra), await readFile(f.path(firstIntent)));
  await expect(f.worker().assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
  await unlink(f.path(extra));
  for (const key of (await readdir(f.directory)).filter(key => /-0-(intent|result|receipt)$/.test(key))) {
    await unlink(f.path(key));
  }
  await expect(f.worker().assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
  expect(counts(f)).toEqual([6, 6]);
});

it('permits only one writer while its first window is in flight', async () => {
  const f = await fixture();
  await f.worker().prepare(principal, jobId);
  let enter!: () => void, unpause!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const resume = new Promise<void>(resolve => { unpause = resolve; });
  f.ports.receive.mockImplementationOnce(async call => { enter(); await resume; return response(call); });
  const first = f.worker().assemble(principal, jobId);
  try {
    await Promise.race([entered, first.then(() => { throw Error('First worker did not send'); })]);
    await expect(f.worker().assemble(principal, jobId)).rejects.toMatchObject({ code: 'unknown' });
    expect(counts(f)).toEqual([1, 1]);
  } finally { unpause(); await first; }
  expect(counts(f)).toEqual([6, 6]);
});
