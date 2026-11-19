import { CandidateError, validId } from './cloudCandidateApi';

export type ReviewCue = Readonly<{ id: string; index: number; startMs: number; endMs: number; es: string; en: string }>;
export type ReviewEdit = Readonly<{ id: string; en: string }>;
export type ReviewSource = Readonly<{
  projectRevision: number; jobRevision: number; durationMs: number;
  status: 'original' | 'reviewed' | 'legacy'; cues: readonly ReviewCue[];
  reason?: 'unlinked_draft' | 'incomplete_review_link'; legacyDraft?: string;
}>;
type PrivateCall = (path: string, method?: string, body?: unknown) => Promise<Response>;
type Check = () => void;
const MAX_RESPONSE = 2 * 1024 * 1024, MAX_DOWNLOAD = 256 * 1024, MAX_DRAFT = 64 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const encoder = new TextEncoder();
const badResponse = (): never => { throw new CandidateError(0, 'invalid_review_response'); };
const badEdit = (): never => { throw new CandidateError(400, 'invalid_review_edit'); };
const number = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const revision = (value: unknown): value is number => number(value, 1, Number.MAX_SAFE_INTEGER - 1);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !CONTROL.test(value) && new TextDecoder('utf-8', { fatal: true }).decode(encoder.encode(value)) === value;

/** Client guidance only; the service still validates source, timings and edits. */
export function validReviewEdits(edits: readonly ReviewEdit[]): boolean {
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 1000) return false;
  let total = 0; const seen = new Set<string>();
  for (const edit of edits) {
    if (!edit || !HASH.test(edit.id) || seen.has(edit.id) || !text(edit.en)) return false;
    const length = encoder.encode(edit.en).length;
    if (length > 4096 || (total += length + 1) > MAX_DRAFT) return false;
    seen.add(edit.id);
  }
  return true;
}

async function bounded(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  const reader = response.body?.getReader(); if (!reader) return badResponse();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      length += part.value.length; if (length > maximum) return badResponse(); chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  signal.throwIfAborted();
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function requireHeaders(response: Response, mime: string) {
  if (response.headers.get('cache-control') !== 'no-store' || response.headers.get('content-type') !== mime) badResponse();
}
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  requireHeaders(response, 'application/json; charset=utf-8');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bounded(response, MAX_RESPONSE, signal))); }
  catch (error) { if (signal.aborted) throw error; return badResponse(); }
}
function parseSource(value: unknown): ReviewSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return badResponse();
  const data = value as Record<string, unknown>;
  if (!revision(data.projectRevision) || !revision(data.jobRevision) || !number(data.durationMs, 1, 600000) ||
      !['original', 'reviewed', 'legacy'].includes(String(data.status)) || !Array.isArray(data.cues) || data.cues.length < 1 || data.cues.length > 1000) return badResponse();
  if (data.status === 'legacy' && (!['unlinked_draft', 'incomplete_review_link'].includes(String(data.reason)) || typeof data.legacyDraft !== 'string' || encoder.encode(data.legacyDraft).length > MAX_DRAFT)) return badResponse();
  let previousEnd = 0; const ids = new Set<string>();
  const cues = data.cues.map((value, index): ReviewCue => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return badResponse();
    const cue = value as Record<string, unknown>;
    if (typeof cue.id !== 'string' || !HASH.test(cue.id) || ids.has(cue.id) || cue.index !== index ||
        !number(cue.startMs, previousEnd, data.durationMs as number) || !number(cue.endMs, cue.startMs + 1, data.durationMs as number) ||
        !text(cue.es) || !text(cue.en)) return badResponse();
    ids.add(cue.id); previousEnd = cue.endMs;
    return Object.freeze({ id: cue.id, index, startMs: cue.startMs, endMs: cue.endMs, es: cue.es, en: cue.en });
  });
  return Object.freeze({ projectRevision: data.projectRevision, jobRevision: data.jobRevision, durationMs: data.durationMs,
    status: data.status as ReviewSource['status'], cues: Object.freeze(cues),
    ...(data.status === 'legacy' ? { reason: data.reason as ReviewSource['reason'], legacyDraft: data.legacyDraft as string } : {}) });
}

/** Uses only the candidate's authenticated same-origin transport; never persists text or tokens. */
export function reviewedTranslationClient(options: { enabled: boolean; signal: AbortSignal; call: PrivateCall }) {
  function requireEnabled(check: Check) {
    if (!options.enabled) throw new CandidateError(503, 'review_disabled');
    options.signal.throwIfAborted(); check();
  }
  function path(inputId: string, jobId: string) {
    validId(inputId); validId(jobId); return '/api/cloud/ai/jobs/' + jobId + '/review';
  }
  return {
    async load(inputId: string, jobId: string, check: Check): Promise<ReviewSource> {
      requireEnabled(check); const response = await options.call(path(inputId, jobId) + '?inputId=' + inputId);
      const source = parseSource(await json(response, options.signal)); requireEnabled(check); return source;
    },
    async save(inputId: string, jobId: string, expectedRevision: number, requestKey: string, edits: readonly ReviewEdit[], check: Check): Promise<number> {
      requireEnabled(check); const target = path(inputId, jobId);
      if (!revision(expectedRevision) || typeof requestKey !== 'string' || !requestKey.trim() || requestKey.length > 200 || CONTROL.test(requestKey) || !validReviewEdits(edits)) return badEdit();
      const safeEdits = edits.map(edit => ({ id: edit.id, en: edit.en }));
      const response = await options.call(target, 'PUT', { inputId, expectedRevision, requestKey, edits: safeEdits });
      const value = await json(response, options.signal) as { committedRevision?: unknown };
      if (!value || value.committedRevision !== expectedRevision + 1 || !revision(value.committedRevision)) return badResponse();
      requireEnabled(check); return value.committedRevision;
    },
    async download(inputId: string, jobId: string, projectRevision: number, format: 'txt' | 'srt', check: Check): Promise<Blob> {
      requireEnabled(check); const target = path(inputId, jobId);
      if (!revision(projectRevision) || !['txt', 'srt'].includes(format)) return badEdit();
      const response = await options.call(target + '/download?inputId=' + inputId + '&revision=' + projectRevision + '&format=' + format);
      const mime = format === 'txt' ? 'text/plain; charset=utf-8' : 'application/x-subrip; charset=utf-8';
      requireHeaders(response, mime); if (response.headers.get('x-vistavo-revision') !== String(projectRevision)) return badResponse();
      // The adapter emits uncompressed bytes. A proxy must not compress them:
      // Content-Length would otherwise describe a different representation.
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding.toLowerCase() !== 'identity') return badResponse();
      const header = response.headers.get('content-length');
      const declared = header === null ? undefined : Number(header);
      if (header !== null && (!/^[0-9]+$/.test(header) || !Number.isSafeInteger(declared) || declared! < 1 || declared! > MAX_DOWNLOAD)) return badResponse();
      const bytes = await bounded(response, MAX_DOWNLOAD, options.signal); if (!bytes.length) return badResponse();
      if (declared !== undefined && declared !== bytes.length) return badResponse();
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return badResponse(); }
      requireEnabled(check); return new Blob([bytes], { type: mime });
    },
  };
}
