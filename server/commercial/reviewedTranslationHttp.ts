import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TextDecoder } from 'node:util';
import { AI_TEXT_FILE_MAX } from './aiContracts';
import { privateSha, privateUuid } from './privateObjectPlan';
import { REVIEWED_CUE_MAX_BYTES, REVIEWED_DRAFT_MAX_BYTES } from './reviewedTranslation';
import { ReviewedTranslationFault, type ReviewedTranslationPrincipal } from './firestoreReviewedTranslation';

/** Local adapter only. The router must verify the Firebase caller before invoking it. */
export type ReviewedTranslationCaller = ReviewedTranslationPrincipal;
export interface ReviewedTranslationHttpService {
  readSource(principal: ReviewedTranslationPrincipal, inputId: string, jobId: string): Promise<unknown>;
  saveReview(principal: ReviewedTranslationPrincipal, request: unknown): Promise<Readonly<{ committedRevision: number }>>;
  downloadReview(principal: ReviewedTranslationPrincipal, request: unknown): Promise<Readonly<{ revision: number; mime: string; bytes: Buffer }>>;
}

const BODY_LIMIT = 400_000;
const RESPONSE_LIMIT = 2 * 1024 * 1024;
const REQUEST_TARGET_LIMIT = 2_048;
const controls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const route = /^\/api\/cloud\/ai\/jobs\/([a-fA-F0-9-]{36})\/review(\/download)?$/;
type PublicError = 'invalid' | 'not_found' | 'conflict' | 'disabled' | 'unavailable' | 'internal' | 'method_not_allowed' | 'body_too_large' | 'unsupported_media_type';
class RequestFault extends Error { constructor(readonly status: number, readonly code: PublicError) { super(code); } }
const invalid = (): never => { throw new RequestFault(400, 'invalid'); };

function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER;
}
function utf8(value: string): boolean { return Buffer.from(value, 'utf8').toString('utf8') === value; }
function plainExact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

/** JSON.parse accepts duplicate names, including escaped aliases; reject them before validation. */
function assertUniqueJsonKeys(raw: string): void {
  let at = 0;
  const whitespace = () => { while (at < raw.length && /[\x20\t\r\n]/.test(raw[at])) at++; };
  const string = () => {
    const start = at++;
    while (at < raw.length) {
      const char = raw[at++];
      if (char === '\\') { at++; continue; }
      if (char === '"') return JSON.parse(raw.slice(start, at)) as string;
    }
    return invalid();
  };
  const value = (depth: number): void => {
    if (depth > 8) return invalid();
    whitespace();
    if (raw[at] === '{') {
      at++; whitespace(); const names = new Set<string>();
      if (raw[at] === '}') { at++; return; }
      while (at < raw.length) {
        if (raw[at] !== '"') return invalid();
        const name = string(); if (names.has(name)) return invalid(); names.add(name);
        whitespace(); if (raw[at++] !== ':') return invalid(); value(depth + 1); whitespace();
        if (raw[at] === '}') { at++; return; }
        if (raw[at++] !== ',') return invalid(); whitespace();
      }
      return invalid();
    }
    if (raw[at] === '[') {
      at++; whitespace(); if (raw[at] === ']') { at++; return; }
      while (at < raw.length) {
        value(depth + 1); whitespace(); if (raw[at] === ']') { at++; return; }
        if (raw[at++] !== ',') return invalid();
      }
      return invalid();
    }
    if (raw[at] === '"') { string(); return; }
    const start = at; while (at < raw.length && !/[\x20\t\r\n,\]}]/.test(raw[at])) at++;
    if (at === start) return invalid();
  };
  value(0); whitespace(); if (at !== raw.length) invalid();
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = req.headers['content-type'];
  if (typeof type !== 'string' || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(type)) {
    req.resume(); throw new RequestFault(415, 'unsupported_media_type');
  }
  const encoding = req.headers['content-encoding'];
  if (encoding !== undefined && (typeof encoding !== 'string' || encoding.toLowerCase() !== 'identity')) {
    req.resume(); throw new RequestFault(415, 'unsupported_media_type');
  }
  const length = req.headers['content-length'];
  if (length !== undefined) {
    if (typeof length !== 'string' || !/^(?:0|[1-9]\d*)$/.test(length)) { req.resume(); return invalid(); }
    if (!Number.isSafeInteger(Number(length)) || Number(length) > BODY_LIMIT) { req.resume(); throw new RequestFault(413, 'body_too_large'); }
  }
  const chunks: Buffer[] = []; let size = 0;
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > BODY_LIMIT) { req.resume(); throw new RequestFault(413, 'body_too_large'); }
    chunks.push(chunk);
  }
  let raw: string, parsed: unknown;
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); parsed = JSON.parse(raw); assertUniqueJsonKeys(raw); }
  catch (error) { if (error instanceof RequestFault) throw error; return invalid(); }
  return parsed;
}

function query(raw: string, expected: readonly string[]): Record<string, string> {
  const params = new URLSearchParams(raw), result: Record<string, string> = Object.create(null);
  let count = 0;
  for (const [name, value] of params) {
    count++; if (!expected.includes(name) || Object.hasOwn(result, name)) return invalid();
    result[name] = value;
  }
  if (count !== expected.length || expected.some(name => !Object.hasOwn(result, name))) return invalid();
  return result;
}
function parseSave(input: unknown, jobId: string) {
  if (!plainExact(input, ['inputId', 'expectedRevision', 'requestKey', 'edits']) ||
      typeof input.inputId !== 'string' || !privateUuid.test(input.inputId) || !validRevision(input.expectedRevision) ||
      typeof input.requestKey !== 'string' || !input.requestKey.trim() || input.requestKey.length > 200 || controls.test(input.requestKey) || !utf8(input.requestKey) ||
      !Array.isArray(input.edits) || input.edits.length < 1 || input.edits.length > 1_000) return invalid();
  let bytes = 0; const ids = new Set<string>();
  const edits = input.edits.map(edit => {
    if (!plainExact(edit, ['id', 'en']) || typeof edit.id !== 'string' || !privateSha.test(edit.id) || ids.has(edit.id) ||
        typeof edit.en !== 'string' || !edit.en.trim() || controls.test(edit.en) || !utf8(edit.en)) return invalid();
    const length = Buffer.byteLength(edit.en, 'utf8');
    if (length > REVIEWED_CUE_MAX_BYTES) return invalid();
    bytes += length + 1; if (bytes > REVIEWED_DRAFT_MAX_BYTES) return invalid();
    ids.add(edit.id); return { id: edit.id, en: edit.en };
  });
  return { inputId: input.inputId, jobId, expectedRevision: input.expectedRevision, requestKey: input.requestKey, edits };
}
function responseHeaders() { return { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }; }
function requireNoBody(req: IncomingMessage) {
  if ((req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0') || req.headers['transfer-encoding'] !== undefined) {
    req.resume(); invalid();
  }
}
function sendJson(req: IncomingMessage, res: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}) {
  const data = JSON.stringify(value);
  if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > RESPONSE_LIMIT) throw new Error('invalid local response');
  res.writeHead(status, { ...responseHeaders(), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(data)), ...extra });
  res.end(req.method === 'HEAD' ? undefined : data);
}

/**
 * No Firebase or account authentication occurs here. The router must supply a verified
 * caller. The service rechecks UID-to-account mapping in its transactions, but
 * Firebase token verification is not atomic with those transactions.
 */
export async function reviewedTranslationHttp(req: IncomingMessage, res: ServerResponse, caller: ReviewedTranslationCaller, service: ReviewedTranslationHttpService): Promise<boolean> {
  const target = req.url;
  if (typeof target !== 'string') return false;
  const split = target.indexOf('?'), pathname = split < 0 ? target : target.slice(0, split), match = route.exec(pathname);
  if (!match) return false;
  try {
    if (target.length > REQUEST_TARGET_LIMIT) throw new RequestFault(414, 'invalid');
    if (target.includes('#')) return invalid();
    const jobId = match[1], download = !!match[2];
    if (!privateUuid.test(jobId)) return invalid();
    const accountId = caller?.accountId, uid = caller?.uid;
    if (typeof accountId !== 'string' || !privateUuid.test(accountId) || typeof uid !== 'string' || !uid || uid.length > 128 || controls.test(uid) || !utf8(uid)) throw new RequestFault(500, 'internal');
    const principal = Object.freeze({ accountId, uid });
    const allow = download ? 'GET, HEAD' : 'GET, PUT';
    if (!((download && (req.method === 'GET' || req.method === 'HEAD')) || (!download && (req.method === 'GET' || req.method === 'PUT')))) {
      req.resume(); sendJson(req, res, 405, { error: 'method_not_allowed' }, { Allow: allow }); return true;
    }
    const rawQuery = split < 0 ? '' : target.slice(split + 1);
    if (!download && req.method === 'PUT') {
      if (split >= 0) return invalid();
      const value = await service.saveReview(principal, parseSave(await readJson(req), jobId));
      if (!validRevision(value?.committedRevision)) throw new Error('invalid local response');
      sendJson(req, res, 200, { committedRevision: value.committedRevision }); return true;
    }
    requireNoBody(req);
    if (!download) {
      const args = query(rawQuery, ['inputId']);
      if (!privateUuid.test(args.inputId)) return invalid();
      sendJson(req, res, 200, await service.readSource(principal, args.inputId, jobId)); return true;
    }
    const args = query(rawQuery, ['inputId', 'revision', 'format']);
    if (!privateUuid.test(args.inputId) || !/^[1-9]\d{0,15}$/.test(args.revision) || !validRevision(Number(args.revision)) || !['txt', 'srt'].includes(args.format)) return invalid();
    const format = args.format as 'txt' | 'srt', revision = Number(args.revision);
    const value = await service.downloadReview(principal, { inputId: args.inputId, jobId, revision, format });
    const mime = format === 'txt' ? 'text/plain; charset=utf-8' : 'application/x-subrip; charset=utf-8';
    if (!value || value.revision !== revision || value.mime !== mime || !Buffer.isBuffer(value.bytes) || value.bytes.length < 1 || value.bytes.length > AI_TEXT_FILE_MAX) throw new Error('invalid local response');
    res.writeHead(200, { ...responseHeaders(), 'Content-Type': mime, 'Content-Disposition': `attachment; filename="vistavo-translation.${format}"`,
      'Content-Length': String(value.bytes.length), 'X-Vistavo-Revision': String(revision) });
    res.end(req.method === 'HEAD' ? undefined : value.bytes); return true;
  } catch (error) {
    if (res.headersSent) { res.destroy(); return true; }
    if (error instanceof RequestFault) { sendJson(req, res, error.status, { error: error.code }); return true; }
    if (error instanceof ReviewedTranslationFault) {
      const status = { invalid: 400, not_found: 404, conflict: 409, disabled: 503, unavailable: 503 }[error.code];
      if (!status) { sendJson(req, res, 500, { error: 'internal' }); return true; }
      sendJson(req, res, status, { error: error.code }); return true;
    }
    sendJson(req, res, 500, { error: 'internal' }); return true;
  }
}
