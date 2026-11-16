import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { JobError } from './jobs';

export const TEXT_CODEC_MAX_DURATION_MS = 600_000;
export const TEXT_CODEC_MAX_CUES = 1_000;
export const TEXT_CODEC_MAX_SRT_BYTES = 64 * 1024;
export const TEXT_CODEC_MAX_JOB_ID_CHARS = 200;

export interface ProviderTextCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly es: string;
  readonly en: string;
}

export interface ProviderTextResult {
  readonly detectedLanguage: string;
  readonly hasSpeech: boolean;
  readonly cues: readonly ProviderTextCue[];
}

export interface ValidatedTextCue {
  readonly id: string;
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly es: string;
  readonly en: string;
}

export interface ValidatedTextResult {
  readonly detectedLanguage: 'es';
  readonly hasSpeech: true;
  readonly durationMs: number;
  readonly cues: readonly ValidatedTextCue[];
}

export interface EncodedTextLanguage {
  readonly language: 'es' | 'en';
  readonly srt: string;
  readonly txt: string;
  readonly srtBytes: Buffer;
  readonly txtBytes: Buffer;
  readonly srtSha256: string;
  readonly txtSha256: string;
  readonly srtByteLength: number;
  readonly txtByteLength: number;
}

export interface EncodedTextBundle {
  readonly jobId: string;
  readonly durationMs: number;
  readonly cueCount: number;
  readonly cues: readonly ValidatedTextCue[];
  readonly es: EncodedTextLanguage;
  readonly en: EncodedTextLanguage;
}

const UNSAFE_TEXT_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]');
const UNSAFE_JOB_ID_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]');

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function assertExactObject(
  value: unknown,
  field: string,
  allowed: readonly string[]
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new JobError('invalid_input', `${field} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new JobError('invalid_input', `${field} contains unknown field ${key}.`);
    }
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new JobError('invalid_input', `${field} is missing field ${key}.`);
    }
  }
  return value;
}

function assertInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new JobError('invalid_input', `${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function assertSafeText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new JobError('invalid_input', `${field} must be a string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw new JobError('invalid_input', `${field} must be non-empty.`);
  }
  if (UNSAFE_TEXT_RE.test(value)) {
    throw new JobError(
      'invalid_input',
      `${field} contains control characters or ambiguous paragraph separators.`
    );
  }
  return value;
}

function assertJobId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > TEXT_CODEC_MAX_JOB_ID_CHARS) {
    throw new JobError(
      'invalid_input',
      `jobId must be a non-empty string of at most ${TEXT_CODEC_MAX_JOB_ID_CHARS} characters.`
    );
  }
  if (UNSAFE_JOB_ID_RE.test(value)) {
    throw new JobError('invalid_input', 'jobId contains control characters.');
  }
  return value;
}

function cueId(jobId: string, index: number): string {
  return createHash('sha256')
    .update('lv016-cue-id-v1\0', 'utf8')
    .update(jobId, 'utf8')
    .update('\0', 'utf8')
    .update(String(index), 'utf8')
    .digest('hex');
}

function formatSrtTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = ms % 1000;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return (
    `${String(hours).padStart(2, '0')}:` +
    `${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')},` +
    `${String(milliseconds).padStart(3, '0')}`
  );
}

function srtByteLength(cues: readonly ValidatedTextCue[], language: 'es' | 'en'): number {
  let total = 0;
  for (let index = 0; index < cues.length; index++) {
    const indexLength = String(index + 1).length;
    const textBytes = Buffer.byteLength(cues[index][language], 'utf8');
    total += indexLength + 33 + textBytes;
    if (total > TEXT_CODEC_MAX_SRT_BYTES) {
      return total;
    }
  }
  return total;
}

function buildSrt(cues: readonly ValidatedTextCue[], language: 'es' | 'en'): string {
  const parts: string[] = [];
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index];
    parts.push(String(index + 1));
    parts.push(`${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}`);
    parts.push(cue[language]);
    parts.push('');
  }
  return parts.join('\n') + '\n';
}

function buildTxt(cues: readonly ValidatedTextCue[], language: 'es' | 'en'): string {
  return cues.map((cue) => cue[language]).join('\n') + '\n';
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function encodeLanguage(
  cues: readonly ValidatedTextCue[],
  language: 'es' | 'en'
): EncodedTextLanguage {
  const measured = srtByteLength(cues, language);
  if (measured > TEXT_CODEC_MAX_SRT_BYTES) {
    throw new JobError(
      'invalid_input',
      `${language} SRT exceeds ${TEXT_CODEC_MAX_SRT_BYTES} bytes.`
    );
  }

  const srt = buildSrt(cues, language);
  const txt = buildTxt(cues, language);
  const srtBytes = Buffer.from(srt, 'utf8');
  const txtBytes = Buffer.from(txt, 'utf8');

  if (srtBytes.byteLength > TEXT_CODEC_MAX_SRT_BYTES) {
    throw new JobError(
      'invalid_input',
      `${language} SRT exceeds ${TEXT_CODEC_MAX_SRT_BYTES} bytes.`
    );
  }

  return Object.freeze({
    language,
    srt,
    txt,
    srtBytes,
    txtBytes,
    srtSha256: sha256Hex(srtBytes),
    txtSha256: sha256Hex(txtBytes),
    srtByteLength: srtBytes.byteLength,
    txtByteLength: txtBytes.byteLength,
  });
}

export function validateProviderTextResult(
  jobId: string,
  durationMs: number,
  value: unknown
): ValidatedTextResult {
  const safeJobId = assertJobId(jobId);
  const duration = assertInteger(durationMs, 'durationMs', 1, TEXT_CODEC_MAX_DURATION_MS);
  const obj = assertExactObject(value, 'providerResult', [
    'detectedLanguage',
    'hasSpeech',
    'cues',
  ]);

  if (typeof obj.detectedLanguage !== 'string') {
    throw new JobError('invalid_input', 'providerResult.detectedLanguage must be a string.');
  }
  if (obj.detectedLanguage !== 'es') {
    throw new JobError('invalid_input', 'providerResult.detectedLanguage must be es.');
  }
  if (obj.hasSpeech !== true) {
    throw new JobError('invalid_input', 'providerResult.hasSpeech must be true.');
  }
  if (!Array.isArray(obj.cues)) {
    throw new JobError('invalid_input', 'providerResult.cues must be an array.');
  }
  if (obj.cues.length === 0) {
    throw new JobError('invalid_input', 'providerResult.cues must not be empty when speech is present.');
  }
  if (obj.cues.length > TEXT_CODEC_MAX_CUES) {
    throw new JobError(
      'invalid_input',
      `providerResult.cues must not exceed ${TEXT_CODEC_MAX_CUES} entries.`
    );
  }

  const rawCues = obj.cues;
  const cues: ValidatedTextCue[] = [];
  let previousEndMs = 0;

  for (let index = 0; index < rawCues.length; index++) {
    const raw = assertExactObject(rawCues[index], `providerResult.cues[${index}]`, [
      'startMs',
      'endMs',
      'es',
      'en',
    ]);

    const startMs = assertInteger(
      raw.startMs,
      `providerResult.cues[${index}].startMs`,
      0,
      duration
    );
    const endMs = assertInteger(
      raw.endMs,
      `providerResult.cues[${index}].endMs`,
      1,
      duration
    );

    if (endMs <= startMs) {
      throw new JobError(
        'invalid_input',
        `providerResult.cues[${index}] must have endMs > startMs.`
      );
    }
    if (startMs < previousEndMs) {
      throw new JobError(
        'invalid_input',
        `providerResult.cues[${index}] overlaps or is out of order.`
      );
    }

    const es = assertSafeText(raw.es, `providerResult.cues[${index}].es`);
    const en = assertSafeText(raw.en, `providerResult.cues[${index}].en`);

    cues.push(
      Object.freeze({
        id: cueId(safeJobId, index),
        index,
        startMs,
        endMs,
        es,
        en,
      })
    );

    previousEndMs = endMs;
  }

  return Object.freeze({
    detectedLanguage: 'es' as const,
    hasSpeech: true as const,
    durationMs: duration,
    cues: Object.freeze(cues),
  });
}

export function encodeTextBundle(
  jobId: string,
  durationMs: number,
  providerResult: unknown
): EncodedTextBundle {
  const safeJobId = assertJobId(jobId);
  const validated = validateProviderTextResult(safeJobId, durationMs, providerResult);
  const es = encodeLanguage(validated.cues, 'es');
  const en = encodeLanguage(validated.cues, 'en');

  return Object.freeze({
    jobId: safeJobId,
    durationMs: validated.durationMs,
    cueCount: validated.cues.length,
    cues: validated.cues,
    es,
    en,
  });
}
export function normalizeTextResult(value: unknown, durationMs: number, jobId: string): readonly ValidatedTextCue[] {
  return encodeTextBundle(jobId,durationMs,value).cues;
}
export function encodeTextResult(cues: readonly ValidatedTextCue[], language: 'es'|'en', format: 'srt'|'txt'): Buffer {
  const encoded = encodeLanguage(cues,language);
  return format === 'srt' ? encoded.srtBytes : encoded.txtBytes;
}
