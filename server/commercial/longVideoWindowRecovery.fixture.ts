import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AI_TEXT_FILE_MAX, AI_TEXT_MAX_WINDOWS, AI_TEXT_WINDOW_MS } from './aiContracts';
import { encodeTextBundle, validateProviderTextResult, type ProviderTextCue } from './pipelineTextCodec';
import { textModel } from './pipelineTextProvider';
import { privateSha, privateUuid } from './privateObjectPlan';

export type FixturePrincipal = Readonly<{ accountId: string; uid: string }>;
export type FixtureVideo = Readonly<FixturePrincipal & {
  jobId: string; attemptId: string; reservationId: string; inputId: string;
  revision: number; authorityVersion: number; sourceGeneration: string; sourceSha256: string;
  durationSeconds: number; requests: readonly string[];
}>;
export type FixtureReservation = Readonly<{ identityKey: string; reservationId: string; seconds: number; state: 'reserved' }>;
export type FixtureCall = Readonly<Omit<FixtureReservation, 'state'> & {
  jobId: string; attemptId: string; callKey: string; model: string; requestSha256: string;
}>;
type Window = Readonly<{ index: number; startMs: number; endMs: number; call: FixtureCall }>;

export interface FixtureWindowFiles {
  read(key: string): Promise<Buffer | null>;
  create(key: string, bytes: Buffer): Promise<boolean>;
}

type Ports = Readonly<{
  video(principal: FixturePrincipal, jobId: string): Promise<FixtureVideo | null>;
  reservation(identityKey: string, reservationId: string): Promise<FixtureReservation | null>;
  admit(call: FixtureCall): Promise<unknown>;
  receive(call: FixtureCall): Promise<unknown>;
}>;

class FixtureFault extends Error {
  constructor(readonly code: 'disabled' | 'denied' | 'unknown') { super(`window_fixture_${code}`); }
}
const disabled = () => process.env.NODE_ENV !== 'test' || process.env.LV_LONG_VIDEO_RECOVERY_TEST !== '1';
const unknown = (): never => { throw new FixtureFault('unknown'); };
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const digest = (value: unknown) => sha(JSON.stringify(value));
const json = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8');
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const uuid = (value: unknown): value is string => typeof value === 'string' && privateUuid.test(value);
const hex = (value: unknown): value is string => typeof value === 'string' && privateSha.test(value);
const jobKey = (jobId: string) => digest(['local-text-window-job-v1', jobId]);
const windowKey = (key: string, index: number, kind: string) => `${key}-${index}-${kind}`;
const records = ['intent', 'result', 'receipt'] as const;

function normalize(jobId: string, window: Window, result: unknown) {
  const checked = validateProviderTextResult(jobId, window.endMs - window.startMs, result);
  return { detectedLanguage: 'es', hasSpeech: true, cues: checked.cues.map(({ startMs, endMs, es, en }) => ({ startMs, endMs, es, en })) };
}

/** Test-only. The ports model independent Video and Account reads and a private store. */
export function createLongVideoWindowFixture(files: FixtureWindowFiles, ports: Ports) {
  async function hasHistoryAtOrAfter(key: string, from: number) {
    for (let index = from; index < AI_TEXT_MAX_WINDOWS; index++) {
      for (const kind of records) {
        if (await files.read(windowKey(key, index, kind))) return true;
      }
    }
    return false;
  }

  async function authorize(principal: FixturePrincipal, jobId: string) {
    if (disabled()) throw new FixtureFault('disabled');
    if (!uuid(principal.accountId) || typeof principal.uid !== 'string' || !principal.uid || principal.uid.length > 128 || !uuid(jobId))
      throw new FixtureFault('denied');
    const video = await ports.video(principal, jobId);
    if (!video || video.uid !== principal.uid || video.accountId !== principal.accountId || video.jobId !== jobId)
      throw new FixtureFault('denied');
    const { accountId, uid, inputId, attemptId, reservationId, revision, authorityVersion, sourceGeneration,
      sourceSha256, durationSeconds } = video;
    if (![inputId, attemptId, reservationId].every(uuid) || !positive(revision) || !positive(authorityVersion) ||
      typeof sourceGeneration !== 'string' || !/^[1-9]\d{0,30}$/.test(sourceGeneration) || !hex(sourceSha256) ||
      !Number.isFinite(durationSeconds) || durationSeconds < 120 || durationSeconds > 180) return unknown();
    const durationMs = Math.floor(durationSeconds * 1000), seconds = Math.ceil(durationSeconds);
    const count = Math.ceil(durationMs / AI_TEXT_WINDOW_MS);
    if (!Array.isArray(video.requests) || video.requests.length !== count) return unknown();
    const requests: string[] = [];
    for (let index = 0; index < count; index++) {
      if (!Object.hasOwn(video.requests, index) || !hex(video.requests[index])) return unknown();
      requests.push(video.requests[index]);
    }
    const identityKey = digest(['firebase', uid]);
    const reservation = await ports.reservation(identityKey, reservationId);
    if (!isDeepStrictEqual(reservation, { identityKey, reservationId, seconds, state: 'reserved' })) return unknown();
    if (disabled()) throw new FixtureFault('disabled');
    const fingerprint = digest(['local-text-window-manifest-v1', accountId, identityKey, inputId, sourceGeneration,
      sourceSha256, revision, authorityVersion, jobId, attemptId, reservationId, durationSeconds, seconds, requests]);
    const windows = requests.map((requestSha256, index): Window => ({
      index, startMs: index * AI_TEXT_WINDOW_MS, endMs: Math.min(durationMs, (index + 1) * AI_TEXT_WINDOW_MS),
      call: Object.freeze({ identityKey, reservationId, seconds, jobId, attemptId,
        callKey: `text-window:${String(index).padStart(4, '0')}`, model: textModel, requestSha256 }),
    }));
    return { fingerprint, durationMs, windows };
  }

  async function verify(principal: FixturePrincipal, jobId: string, manifestKey: string, expected: Buffer) {
    const live = await authorize(principal, jobId);
    if (!expected.equals(json(live.fingerprint)) || !(await files.read(manifestKey))?.equals(expected)) return unknown();
    if (disabled()) throw new FixtureFault('disabled');
  }

  async function prepare(principal: FixturePrincipal, jobId: string) {
    const key = jobKey(jobId), manifestKey = `${key}-manifest`;
    const current = json((await authorize(principal, jobId)).fingerprint);
    if (!(await files.read(manifestKey))) {
      // A missing manifest cannot reopen a previously started window.
      if (await hasHistoryAtOrAfter(key, 0)) return unknown();
      if (!json((await authorize(principal, jobId)).fingerprint).equals(current)) return unknown();
      await files.create(manifestKey, current);
    }
    await verify(principal, jobId, manifestKey, current);
  }

  async function assemble(principal: FixturePrincipal, jobId: string) {
    const { fingerprint, durationMs, windows } = await authorize(principal, jobId);
    const key = jobKey(jobId), manifestKey = `${key}-manifest`, original = json(fingerprint);
    const live = () => verify(principal, jobId, manifestKey, original);
    const cues: ProviderTextCue[] = [];
    await live();
    if (await hasHistoryAtOrAfter(key, windows.length)) return unknown();
    for (const window of windows) {
      await live();
      const { index, startMs, endMs, call } = window;
      const intentKey = windowKey(key, index, 'intent'), resultKey = windowKey(key, index, 'result');
      const receiptKey = windowKey(key, index, 'receipt');
      const slot = digest([fingerprint, index, startMs, endMs, call]);
      const intended = json(slot), intent = await files.read(intentKey);
      const receipt = await files.read(receiptKey);
      let bytes = await files.read(resultKey);
      if (receipt) {
        if (!intent?.equals(intended) || !bytes || !bytes.length || bytes.length > AI_TEXT_FILE_MAX ||
          !receipt.equals(json({ slot, size: bytes.length, responseSha256: sha(bytes) }))) return unknown();
      } else {
        if (intent || bytes || await hasHistoryAtOrAfter(key, index + 1) ||
          !(await files.create(intentKey, intended))) return unknown();
        await live();
        const admission = await ports.admit(call);
        if (!isDeepStrictEqual(admission, { ...call, created: true, receiptOnly: false })) return unknown();
        await live();
        bytes = json(normalize(jobId, window, await ports.receive(call)));
        if (bytes.length > AI_TEXT_FILE_MAX) return unknown();
        await live();
        if (!(await files.create(resultKey, bytes))) return unknown();
        await live();
        if (!(await files.create(receiptKey, json({ slot, size: bytes.length, responseSha256: sha(bytes) })))) return unknown();
      }
      const checked = normalize(jobId, window, JSON.parse(bytes.toString('utf8')));
      if (!bytes.equals(json(checked))) return unknown();
      cues.push(...checked.cues.map(cue => ({ ...cue, startMs: cue.startMs + startMs, endMs: cue.endMs + startMs })));
    }
    await live();
    return encodeTextBundle(jobId, durationMs, { detectedLanguage: 'es', hasSpeech: true, cues });
  }

  async function sanitized<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) { if (error instanceof FixtureFault) throw error; return unknown(); }
  }
  return {
    prepare: (principal: FixturePrincipal, jobId: string) => sanitized(() => prepare(Object.freeze({ ...principal }), jobId)),
    assemble: (principal: FixturePrincipal, jobId: string) => sanitized(() => assemble(Object.freeze({ ...principal }), jobId)),
  };
}
