import { Buffer } from 'node:buffer';
import { JobError } from './jobs';
import { encodeTextBundle, TEXT_CODEC_MAX_CUES, type ValidatedTextCue } from './pipelineTextCodec';

// These are content limits only. Pilot-specific voice limits still apply at admission.
export const REVIEWED_CUE_MAX_BYTES = 4 * 1024;
export const REVIEWED_DRAFT_MAX_BYTES = 64 * 1024;

const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

function invalid(field: string): never {
  throw new JobError('invalid_input', `Invalid reviewed translation: ${field}.`);
}

// Accept JSON-like data properties only; never silently copy unknown fields.
function exactObject(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid(field);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return invalid(field);
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return invalid(field);
    copy[key] = descriptor.value;
  }
  return copy;
}

function exactArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > TEXT_CODEC_MAX_CUES) return invalid(field);
  if (Reflect.ownKeys(value).length !== value.length + 1) return invalid(field);
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) return invalid(field);
    copy.push(descriptor.value);
  }
  return copy;
}

function validUtf8Text(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string' || !value.trim() || UNSAFE_TEXT.test(value)) return invalid(field);
  if (Buffer.byteLength(value, 'utf8') > maxBytes || Buffer.from(value, 'utf8').toString('utf8') !== value) return invalid(field);
  return value;
}

export interface ReviewedTranslation {
  readonly durationMs: number;
  readonly cues: readonly ValidatedTextCue[];
  readonly txt: string;
  readonly srt: string;
  readonly voiceText: string;
}

export interface ValidatedTranslationSource {
  readonly durationMs: number;
  readonly cues: readonly ValidatedTextCue[];
}

/**
 * Validate the original parsed cues without pretending its English is an edit.
 * IDs correlate jobId/index; they do not authenticate the source or its duration.
 */
export function validateTranslationSource(jobId: string, original: unknown): ValidatedTranslationSource {
  const source = exactObject(original, ['durationMs', 'cues'], 'source');
  if (typeof source.durationMs !== 'number') return invalid('source duration');
  const sourceCues = exactArray(source.cues, 'source cues').map((value, index) =>
    exactObject(value, ['id', 'index', 'startMs', 'endMs', 'es', 'en'], `source cue ${index}`));

  // Revalidate the persisted shape through the existing provider codec. This
  // checks timing, order, text and both original SRT sizes, and regenerates IDs.
  const validated = encodeTextBundle(jobId, source.durationMs, {
    detectedLanguage: 'es', hasSpeech: true,
    cues: sourceCues.map(({ startMs, endMs, es, en }) => ({ startMs, endMs, es, en })),
  });
  for (let index = 0; index < sourceCues.length; index++) {
    const sourceCue = sourceCues[index], cue = validated.cues[index];
    if (sourceCue.index !== index || sourceCue.id !== cue.id) return invalid(`source identity ${index}`);
    // The provider codec accepts JS strings; ensure round-trip UTF-8 is exact.
    for (const text of [cue.es, cue.en]) {
      if (Buffer.from(text, 'utf8').toString('utf8') !== text) return invalid(`source text ${index}`);
    }
  }
  return Object.freeze({ durationMs: validated.durationMs, cues: validated.cues });
}

/**
 * Pure content transformation over parsed JSON. This does not authenticate the
 * source, bind it to storage metadata, authorize access, or persist a revision.
 */
export function reviewTranslation(jobId: string, original: unknown, edits: unknown): ReviewedTranslation {
  const validated = validateTranslationSource(jobId, original);
  const reviewed = exactArray(edits, 'edits');
  if (reviewed.length !== validated.cues.length) return invalid('edit count');
  let draftBytes = 0;
  const providerCues = reviewed.map((value, index) => {
    const edit = exactObject(value, ['id', 'en'], `edit ${index}`), cue = validated.cues[index];
    if (edit.id !== cue.id) return invalid(`edit identity ${index}`);
    const en = validUtf8Text(edit.en, `edit text ${index}`, REVIEWED_CUE_MAX_BYTES);
    draftBytes += Buffer.byteLength(en, 'utf8') + 1; // TXT and future voice snapshot end each cue with LF.
    if (draftBytes > REVIEWED_DRAFT_MAX_BYTES) return invalid('draft size');
    return { startMs: cue.startMs, endMs: cue.endMs, es: cue.es, en };
  });

  // Reusing the codec enforces its 64 KiB SRT bound and deterministic layout.
  const result = encodeTextBundle(jobId, validated.durationMs, {
    detectedLanguage: 'es', hasSpeech: true, cues: providerCues,
  });
  if (Buffer.byteLength(result.en.txt, 'utf8') > REVIEWED_DRAFT_MAX_BYTES) return invalid('draft size');
  return Object.freeze({
    durationMs: result.durationMs,
    cues: result.cues,
    txt: result.en.txt,
    srt: result.en.srt,
    voiceText: result.en.txt,
  });
}
