import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rmdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AccountStore } from '../account/backend';
import { stub } from './billingFirestoreStub';
import { generateCloudText, prepareTextVideo, type CloudAiInvoke, type PreparedTextVideo } from './cloudAiProvider';
import { probePrivateVideo } from './resumableUploads';
import { videoReservationId } from './videoReservationId';

const uid = 'synthetic-long-video-owner';
const accountId = '10000000-0000-4000-8000-000000000001';
const inputId = '10000000-0000-4000-8000-000000000002';
const requestKey = '10000000-0000-4000-8000-000000000003';
const jobId = '10000000-0000-4000-8000-000000000004';
const attemptId = '10000000-0000-4000-8000-000000000005';
const identityKey = AccountStore.identityKey(uid);
const reservationId = videoReservationId(accountId, identityKey, inputId, 'translation:en', 1, requestKey);
const signal = new AbortController().signal;
const hash = (body: object) => createHash('sha256').update(JSON.stringify(body)).digest('hex');
const windows = [
  [0, 30_000], [30_000, 60_000], [60_000, 90_000], [90_000, 120_000],
  [120_000, 150_000], [150_000, 150_250],
] as const;
const keys = windows.map((_, index) => `text-window:${String(index).padStart(4, '0')}`);
let directory: string | undefined;
let file: string | undefined;
let prepared: PreparedTextVideo;
let sourceSeconds: number;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vistavo-long-video-test-'));
  file = join(directory, 'synthetic.mp4');
  const encoded = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 'lavfi', '-i', 'color=c=blue:s=64x96:r=4',
    '-f', 'lavfi', '-i', 'aevalsrc=sin(2*PI*(440+110*floor(t/30))*t):s=16000',
    '-t', '150.25', '-c:v', 'libx264', '-c:a', 'aac', '-y', file,
  ], { windowsHide: true, timeout: 15_000, encoding: 'utf8' });
  expect(encoded.error).toBeUndefined();
  expect(encoded.status, encoded.stderr).toBe(0);
  const metadata = await probePrivateVideo(file);
  sourceSeconds = Math.ceil(metadata.duration);
  prepared = await prepareTextVideo({ id: inputId, name: 'synthetic.mp4', path: file,
    size: (await stat(file)).size, expiresAt: new Date(Date.now() + 60_000), metadata }, signal);
}, 30_000);

afterAll(async () => {
  try { await prepared?.cleanup(); }
  finally {
    if (file) await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (directory) await rmdir(directory);
  }
});

type TestDocument = ReturnType<ReturnType<ReturnType<typeof stub>['root']['collection']>['doc']> & {
  collection(name: string): TestCollection;
};
type TestCollection = { doc(id: string): TestDocument };

function accountFixture() {
  const memory = stub({
    identities: { [identityKey]: { uid, accountId } },
    accounts: { [accountId]: { identityKey, schemaVersion: 1, unit: 'video_seconds',
      credited: 200, available: 200, reserved: 0, consumed: 0, active: 0, activeProjectCount: 0, createdAtMs: 1 } },
  });
  // Account uses nested collections for call receipts. Keep the same staged transaction double.
  function collection(path: string): TestCollection {
    return { doc(id) {
      const doc = memory.root.collection(path).doc(id);
      return { ...doc, collection: name => collection(`${doc.path}/${name}`) };
    } };
  }
  const store = new AccountStore(memory.db as never, { collection } as never);
  const reserve = () => store.reserveVideo(identityKey, reservationId, sourceSeconds);
  const admit = (callKey: string, model: string, requestSha256: string, seconds = sourceSeconds) =>
    store.admitVideoCall(identityKey, reservationId, seconds, jobId, attemptId, callKey, model, requestSha256);
  const ledger = () => [...memory.store.entries()].filter(([path]) => path.startsWith('ledgerEntries/'))
    .map(([, value]) => [value.kind, value.seconds]);
  const calls = () => [...memory.store.keys()].filter(path => path.includes('/providerCalls/')).length;
  return { store, reserve, admit, ledger, calls };
}

function response(index: number) {
  const [startMs, endMs] = windows[index];
  const cue = { startMs: 0, endMs: endMs - startMs, es: `Ventana sintética ${index + 1}.`, en: `Synthetic window ${index + 1}.` };
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ detectedLanguage: 'es', hasSpeech: true, cues: [cue] }) }] } }] };
}

function sampledFrequency(path: string) {
  const decoded = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe',
    '-i', path, '-ss', '0.06', '-t', '0.1', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1',
  ], { windowsHide: true, timeout: 5_000 });
  expect(decoded.error).toBeUndefined();
  expect(decoded.status, decoded.stderr.toString()).toBe(0);
  expect(decoded.stdout.length).toBe(3200);
  let upCrossings = 0;
  for (let at = 2; at < decoded.stdout.length; at += 2) {
    if (decoded.stdout.readInt16LE(at - 2) <= 0 && decoded.stdout.readInt16LE(at) > 0) upCrossings++;
  }
  return upCrossings * 10;
}

it('assembles contiguous absolute cues from a 150.25-second clip under one source reservation', async () => {
  expect(sourceSeconds).toBe(151);
  expect(prepared.durationMs).toBe(150_250);
  expect(prepared.chunks.map(({ startMs, endMs }) => [startMs, endMs])).toEqual(windows);
  for (const { index, path } of prepared.chunks) {
    expect(Math.abs(sampledFrequency(path) - (440 + 110 * index))).toBeLessThan(20);
  }
  const account = accountFixture();
  expect(await account.reserve()).toMatchObject({ created: true, seconds: 151 });
  expect(await account.reserve()).toMatchObject({ created: false, seconds: 151 });
  const sends: string[] = [];
  const invoke: CloudAiInvoke = async (key, model, body) => {
    const digest = hash(body);
    expect(await account.admit(key, model, digest)).toMatchObject({ created: true, receiptOnly: false, seconds: 151 });
    expect(await account.admit(key, model, digest)).toMatchObject({ created: false, receiptOnly: true });
    sends.push(key);
    return response(sends.length - 1);
  };
  const bundle = await generateCloudText(jobId, prepared, invoke, signal);
  expect(sends).toEqual(keys);
  expect(account.calls()).toBe(keys.length);
  expect(bundle.cues.map(({ startMs, endMs }) => [startMs, endMs])).toEqual(windows);
  expect(new Set(bundle.cues.map(cue => cue.id)).size).toBe(keys.length);
  expect(bundle.es.srt).toContain('00:00:30,000 --> 00:01:00,000');
  expect(bundle.en.srt).toContain('00:02:30,000 --> 00:02:30,250');
  expect(account.ledger()).toEqual([['video_reserve', 151]]);

  // The harness exercises Account settlement after full assembly. Video's final publication is outside this test.
  const capture = () => account.store.settleVideo(identityKey, reservationId, 'capture', sourceSeconds, { jobId, attemptId });
  expect(await capture()).toMatchObject({ settled: true, state: 'captured', seconds: 151 });
  expect(await capture()).toMatchObject({ settled: false, state: 'captured', seconds: 151 });
  expect(account.ledger()).toEqual([['video_reserve', 151], ['video_capture', 151]]);
  expect(await account.store.videoBalance(identityKey)).toMatchObject({ credited: 200, available: 49, consumed: 151, reserved: 0, active: 0 });
});

it.each([
  ['gap', { startMs: 30_001 }], ['overlap', { startMs: 29_999 }], ['duplicate index', { index: 0 }],
])('rejects a manifest with a %s before any simulated transport', async (_, change) => {
  const chunks = prepared.chunks.map((chunk, index) => index === 1 ? { ...chunk, ...change } : chunk);
  const invoke = vi.fn<CloudAiInvoke>();
  await expect(generateCloudText(jobId, { ...prepared, chunks }, invoke, signal)).rejects.toThrow('Invalid prepared audio window');
  expect(invoke).not.toHaveBeenCalled();
});

it('keeps the source reserve after an ambiguous window and treats replays only as receipts', async () => {
  const account = accountFixture();
  expect(await account.reserve()).toMatchObject({ created: true, seconds: 151 });
  const sent: Array<{ key: string; model: string; digest: string }> = [];
  const invoke: CloudAiInvoke = async (key, model, body) => {
    const digest = hash(body);
    expect(await account.admit(key, model, digest)).toMatchObject({ created: true, receiptOnly: false });
    sent.push({ key, model, digest });
    if (key === keys[1]) throw Error('Synthetic response lost after admission');
    return response(0);
  };
  await expect(generateCloudText(jobId, prepared, invoke, signal)).rejects.toThrow('Synthetic response lost after admission');
  expect(sent.map(call => call.key)).toEqual(keys.slice(0, 2));
  expect(await account.reserve()).toMatchObject({ created: false, seconds: 151 });
  for (const { key, model, digest } of sent) {
    expect(await account.admit(key, model, digest)).toMatchObject({ created: false, receiptOnly: true });
  }
  const { key, model, digest } = sent[1];
  await expect(account.admit(key, model, digest, 30)).rejects.toMatchObject({ code: 'conflict' });
  await expect(account.admit(key, model, hash({ changed: true }))).rejects.toMatchObject({ code: 'conflict' });
  expect(account.calls()).toBe(2);
  expect(account.ledger()).toEqual([['video_reserve', 151]]);
  expect(await account.store.videoBalance(identityKey)).toMatchObject({ credited: 200, available: 49, consumed: 0, reserved: 151, active: 1 });
});
