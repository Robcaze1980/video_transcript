import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { privateSha, privateUuid } from './privateObjectPlan';
import { reviewTranslation, validateTranslationSource } from './reviewedTranslation';
import { narrationChunks, VOICE_MODEL, VOICE_NARRATION_STYLE } from './pipelineVoiceProvider';

/**
 * Pure local candidate. These inputs must come from documents read and
 * authorized in one transaction; this function does not authenticate them,
 * verify a capture, move funds, admit an attempt, or contact a provider.
 */
export class ReviewedVoiceCanonicalError extends Error {
  constructor() { super('invalid_reviewed_voice'); }
}
const invalid = (): never => { throw new ReviewedVoiceCanonicalError(); };
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const digest = (value: unknown) => hash(JSON.stringify(value));
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const timestamp = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hex = (value: unknown): value is string => typeof value === 'string' && privateSha.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && privateUuid.test(value);

function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) return invalid();
  const copy: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !('value' in descriptor)) return invalid();
    copy[name] = descriptor.value;
  }
  return copy;
}

/**
 * Canon v1 uses the existing review codec: cue English strings in order, each
 * followed by LF, with no Unicode normalization. The existing narrationChunks
 * algorithm then trims surrounding whitespace and may replace inter-sentence or
 * long-sentence whitespace with one ASCII space; this is not lossless text.
 * JSON.stringify's ECMAScript property order and UTF-8 bytes below are part of
 * this candidate version; a future change requires a new version and vectors.
 *
 * `body` is sensitive client content. Do not log it. A future caller must send
 * exactly the returned immutable string, not a separately mutable object.
 */
export function validateReviewedVoiceCall(input: unknown): Readonly<{
  version: 'reviewed-voice-canon-v1'; accountId: string; inputId: string; textJobId: string;
  reviewId: string; receiptId: string; revision: number; bindingHash: string; payloadSha256: string;
  voiceTextSha256: string; operation: 'narration:en:female' | 'narration:en:male'; voiceId: 'Kore' | 'Charon';
  model: string; callKey: string; chunkIndex: number; chunkCount: number; requestSha256: string; body: string;
}> {
  try {
    const request = fields(input, ['evidence', 'operation', 'model', 'callKey', 'body']);
    const evidence = fields(request.evidence, ['accountId', 'inputId', 'textJobId', 'revision', 'bindingHash', 'reviewId', 'review', 'receiptId', 'receipt']);
    const { accountId, inputId, textJobId, revision, bindingHash, reviewId, receiptId } = evidence;
    if (!uuid(accountId) || !uuid(inputId) || !uuid(textJobId) || !positive(revision) || revision < 2 ||
        !hex(bindingHash) || !hex(reviewId) || !hex(receiptId) ||
        reviewId !== digest(['review-revision-v1', accountId, inputId, textJobId, revision])) return invalid();

    const review = fields(evidence.review, ['version', 'accountId', 'inputId', 'jobId', 'expectedRevision', 'revision', 'bindingHash', 'fingerprint', 'baseHash', 'receiptId', 'payload', 'payloadSha256', 'voiceSha256', 'createdAtMs']);
    const receipt = fields(evidence.receipt, ['version', 'accountId', 'inputId', 'jobId', 'expectedRevision', 'committedRevision', 'bindingHash', 'fingerprint', 'baseHash', 'reviewId', 'payloadSha256', 'voiceSha256', 'createdAtMs']);
    if (review.version !== 1 || receipt.version !== 1 || review.accountId !== accountId || receipt.accountId !== accountId ||
        review.inputId !== inputId || receipt.inputId !== inputId || review.jobId !== textJobId || receipt.jobId !== textJobId ||
        review.revision !== revision || receipt.committedRevision !== revision || review.expectedRevision !== revision - 1 ||
        receipt.expectedRevision !== revision - 1 || review.bindingHash !== bindingHash || receipt.bindingHash !== bindingHash ||
        review.receiptId !== receiptId || receipt.reviewId !== reviewId || !hex(review.fingerprint) || receipt.fingerprint !== review.fingerprint ||
        !hex(review.baseHash) || receipt.baseHash !== review.baseHash || !hex(review.payloadSha256) || receipt.payloadSha256 !== review.payloadSha256 ||
        !hex(review.voiceSha256) || receipt.voiceSha256 !== review.voiceSha256 || !timestamp(review.createdAtMs) || !timestamp(receipt.createdAtMs) || review.createdAtMs !== receipt.createdAtMs ||
        typeof review.payload !== 'string' || Buffer.byteLength(review.payload, 'utf8') > 512 * 1024 || hash(review.payload) !== review.payloadSha256) return invalid();

    const parsed: unknown = JSON.parse(review.payload);
    if (JSON.stringify(parsed) !== review.payload) return invalid();
    const original = validateTranslationSource(textJobId, parsed);
    const reviewed = reviewTranslation(textJobId, parsed, original.cues.map(cue => ({ id: cue.id, en: cue.en })));
    if (hash(reviewed.voiceText) !== review.voiceSha256 || reviewed.voiceText.length > 12_000 ||
        digest(['review-save-v1', accountId, inputId, textJobId, revision - 1, reviewed.cues.map(cue => [cue.id, cue.en])]) !== review.fingerprint) return invalid();

    const operation = request.operation;
    if (operation !== 'narration:en:female' && operation !== 'narration:en:male') return invalid();
    const voiceId = operation === 'narration:en:female' ? 'Kore' as const : 'Charon' as const;
    if (request.model !== VOICE_MODEL || typeof request.callKey !== 'string' || !/^voice-chunk:\d{4}(?![\s\S])/.test(request.callKey) ||
        typeof request.body !== 'string' || Buffer.byteLength(request.body, 'utf8') > 16 * 1024) return invalid();
    const chunks = narrationChunks(reviewed.voiceText), chunkIndex = Number(request.callKey.slice('voice-chunk:'.length));
    if (!chunks.length || chunks.length > 1_000 || chunkIndex >= chunks.length) return invalid();
    const body = JSON.stringify({
      contents: [{ parts: [{ text: chunks[chunkIndex], speech_metadata: { style: VOICE_NARRATION_STYLE } }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: voiceId } } },
    });
    if (request.body !== body) return invalid();
    return Object.freeze({ version: 'reviewed-voice-canon-v1' as const, accountId, inputId, textJobId, reviewId, receiptId, revision,
      bindingHash, payloadSha256: review.payloadSha256, voiceTextSha256: review.voiceSha256, operation, voiceId, model: VOICE_MODEL,
      callKey: request.callKey, chunkIndex, chunkCount: chunks.length, requestSha256: hash(body), body });
  } catch (error) {
    if (error instanceof ReviewedVoiceCanonicalError) throw error;
    throw new ReviewedVoiceCanonicalError();
  }
}
