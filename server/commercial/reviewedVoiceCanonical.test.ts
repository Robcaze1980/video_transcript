import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ReviewedVoiceCanonicalError, validateReviewedVoiceCall } from './reviewedVoiceCanonical';
import { narrationChunks, VOICE_NARRATION_STYLE } from './pipelineVoiceProvider';

const vectors = JSON.parse(readFileSync(new URL('./reviewedVoiceCanonical.vectors.json', import.meta.url), 'utf8')).vectors as any[];
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const digest = (value: unknown) => hash(JSON.stringify(value));
const request = (vector: any, index = 0) => ({ evidence: structuredClone(vector.evidence), operation: vector.operation,
  model: vector.model, callKey: vector.calls[index].callKey, body: vector.calls[index].body });
const expectInvalid = (input: unknown) => {
  try { validateReviewedVoiceCall(input); expect.fail('Expected a rejected canonical request'); }
  catch (error) { expect(error).toBeInstanceOf(ReviewedVoiceCanonicalError); expect((error as Error).message).toBe('invalid_reviewed_voice'); }
};
function replaceText(value: any, english: string[]) {
  const jobId = value.evidence.textJobId;
  const cues = english.map((en, index) => ({ id: hash(`lv016-cue-id-v1\0${jobId}\0${index}`), index,
    startMs: index * 1_000, endMs: index * 1_000 + 900, es: 'Texto sintético.', en }));
  const payload = JSON.stringify({ durationMs: 5_000, cues }), voiceText = english.join('\n') + '\n';
  const review = value.evidence.review, receipt = value.evidence.receipt;
  review.payload = payload; review.payloadSha256 = receipt.payloadSha256 = hash(payload);
  review.voiceSha256 = receipt.voiceSha256 = hash(voiceText);
  review.fingerprint = receipt.fingerprint = digest(['review-save-v1', value.evidence.accountId, value.evidence.inputId, jobId, 1, cues.map(cue => [cue.id, cue.en])]);
  const text = narrationChunks(voiceText)[0];
  value.body = JSON.stringify({ contents: [{ parts: [{ text, speech_metadata: { style: VOICE_NARRATION_STYLE } }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'Kore' } } } });
  return value;
}

describe('reviewed voice fixed vectors', () => {
  for (const vector of vectors) for (const [index, call] of vector.calls.entries()) {
    it(`${vector.name}: exact chunk ${index + 1}`, () => {
      const result = validateReviewedVoiceCall(request(vector, index));
      expect(result).toMatchObject({ version: 'reviewed-voice-canon-v1', accountId: vector.evidence.accountId,
        inputId: vector.evidence.inputId, textJobId: vector.evidence.textJobId, reviewId: vector.evidence.reviewId,
        receiptId: vector.evidence.receiptId, revision: 2, bindingHash: vector.evidence.bindingHash,
        payloadSha256: vector.payloadSha256, voiceTextSha256: vector.voiceTextSha256, operation: vector.operation,
        voiceId: vector.voiceId, model: vector.model, callKey: call.callKey, chunkIndex: index,
        chunkCount: vector.chunkCount, requestSha256: call.requestSha256, body: call.body });
      expect(Object.isFrozen(result)).toBe(true);
      expect(hash(result.body)).toBe(call.requestSha256);
    });
  }
  it('preserves decomposed Unicode while the documented splitter joins cue lines with a space', () => {
    const vector = vectors[0], body = JSON.parse(validateReviewedVoiceCall(request(vector)).body);
    expect(body.contents[0].parts[0].text).toBe('José measures 5 cm. Cafe\u0301 is ready.');
    expect(body.contents[0].parts[0].text).not.toBe('José measures 5 cm. Café is ready.');
  });
  it('uses the established 320 UTF-16-unit boundary without silently dropping a word', () => {
    const vector = vectors[1], first = JSON.parse(validateReviewedVoiceCall(request(vector, 0)).body), second = JSON.parse(validateReviewedVoiceCall(request(vector, 1)).body);
    expect(first.contents[0].parts[0].text).toBe('A'.repeat(320));
    expect(second.contents[0].parts[0].text).toBe('9 mm.');
  });
  it('counts supplementary Unicode symbols as two UTF-16 units without splitting them', () => {
    const vector = vectors[2], first = JSON.parse(validateReviewedVoiceCall(request(vector, 0)).body), second = JSON.parse(validateReviewedVoiceCall(request(vector, 1)).body);
    expect(first.contents[0].parts[0].text).toBe('🚀'.repeat(160));
    expect(first.contents[0].parts[0].text.length).toBe(320);
    expect(Array.from(first.contents[0].parts[0].text)).toHaveLength(160);
    expect(second.contents[0].parts[0].text).toBe('9 mm.');
  });
  it('preserves the LF between cues when the previous cue has no sentence-ending punctuation', () => {
    const body = JSON.parse(validateReviewedVoiceCall(request(vectors[3])).body);
    expect(body.contents[0].parts[0].text).toBe('The valve is open\nCheck 5 cm.');
  });
  it('preserves a decomposed combining sequence exactly at the 320-unit boundary', () => {
    const first = JSON.parse(validateReviewedVoiceCall(request(vectors[4], 0)).body);
    const second = JSON.parse(validateReviewedVoiceCall(request(vectors[4], 1)).body);
    expect(first.contents[0].parts[0].text).toBe('A'.repeat(318) + 'e\u0301');
    expect(first.contents[0].parts[0].text.length).toBe(320);
    expect(second.contents[0].parts[0].text).toBe('9 mm.');
  });
});

describe('canonical binding failures', () => {
  it.each([
    ['account', (x: any) => { x.evidence.accountId = '44444444-4444-4444-8444-444444444444'; }],
    ['input', (x: any) => { x.evidence.inputId = '44444444-4444-4444-8444-444444444444'; }],
    ['text job', (x: any) => { x.evidence.textJobId = '44444444-4444-4444-8444-444444444444'; }],
    ['revision', (x: any) => { x.evidence.revision = 3; }],
    ['source binding', (x: any) => { x.evidence.bindingHash = 'c'.repeat(64); }],
    ['review document ID', (x: any) => { x.evidence.reviewId = 'c'.repeat(64); }],
    ['receipt document ID', (x: any) => { x.evidence.receiptId = 'c'.repeat(64); }],
    ['review version', (x: any) => { x.evidence.review.version = 2; }],
    ['review owner', (x: any) => { x.evidence.review.accountId = '44444444-4444-4444-8444-444444444444'; }],
    ['receipt owner', (x: any) => { x.evidence.receipt.accountId = '44444444-4444-4444-8444-444444444444'; }],
    ['receipt text job', (x: any) => { x.evidence.receipt.jobId = '44444444-4444-4444-8444-444444444444'; }],
    ['review revision', (x: any) => { x.evidence.review.revision = 3; }],
    ['receipt revision', (x: any) => { x.evidence.receipt.committedRevision = 3; }],
    ['review receipt link', (x: any) => { x.evidence.review.receiptId = 'c'.repeat(64); }],
    ['receipt review link', (x: any) => { x.evidence.receipt.reviewId = 'c'.repeat(64); }],
    ['fingerprint', (x: any) => { x.evidence.receipt.fingerprint = 'c'.repeat(64); }],
    ['base hash', (x: any) => { x.evidence.receipt.baseHash = 'c'.repeat(64); }],
    ['payload hash', (x: any) => { x.evidence.review.payloadSha256 = 'c'.repeat(64); }],
    ['voice hash', (x: any) => { x.evidence.receipt.voiceSha256 = 'c'.repeat(64); }],
    ['timestamp', (x: any) => { x.evidence.review.createdAtMs = -1; }],
    ['mismatched creation times', (x: any) => { x.evidence.receipt.createdAtMs += 1; }],
    ['revision below saved-review minimum', (x: any) => { x.evidence.revision = 1; }],
    ['invalid UUID', (x: any) => { x.evidence.inputId = 'not-a-uuid'; }],
    ['invalid SHA', (x: any) => { x.evidence.bindingHash = 'z'.repeat(64); }],
    ['expected revision', (x: any) => { x.evidence.receipt.expectedRevision = 7; }],
    ['missing receipt', (x: any) => { delete x.evidence.receipt; }],
    ['future field', (x: any) => { x.evidence.review.future = true; }],
    ['unknown operation', (x: any) => { x.operation = 'narration:es:male'; }],
    ['model', (x: any) => { x.model = 'other-model'; }],
    ['chunk family', (x: any) => { x.callKey = 'text-window:0000'; }],
    ['chunk ordinal', (x: any) => { x.callKey = 'voice-chunk:0001'; }],
    ['newline suffix', (x: any) => { x.body += '\n'; }],
    ['JSON formatting', (x: any) => { x.body = JSON.stringify(JSON.parse(x.body), null, 2); }],
    ['alternate voice', (x: any) => { x.body = x.body.replace('Kore', 'Charon'); }],
    ['alternate style', (x: any) => { x.body = x.body.replace('clear, neutral', 'dramatic'); }],
    ['different text', (x: any) => { x.body = x.body.replace('5 cm', '50 cm'); }],
    ['Unicode normalization', (x: any) => { x.body = x.body.replace('Cafe\u0301', 'Café'); }],
  ])('rejects altered %s', (_label, mutate) => { const value = request(vectors[0]); mutate(value); expectInvalid(value); });

  it('rejects malformed or ambiguous canonical JSON even if its payload hash was updated', () => {
    const value = request(vectors[0]);
    const payload = value.evidence.review.payload.replace('{"durationMs":5000,', '{"durationMs":5000,"durationMs":5000,');
    value.evidence.review.payload = payload; value.evidence.review.payloadSha256 = value.evidence.receipt.payloadSha256 = hash(payload);
    expectInvalid(value);
  });
  it('rejects an oversized payload before decoding, even if both claimed hashes match', () => {
    const value = request(vectors[0]), payload = ' '.repeat(512 * 1024 + 1);
    value.evidence.review.payload = payload; value.evidence.review.payloadSha256 = value.evidence.receipt.payloadSha256 = hash(payload); expectInvalid(value);
  });
  it('rejects a coherent review over the provider\'s 12,000 UTF-16 unit limit', () => {
    const value = replaceText(request(vectors[0]), Array(4).fill('short '.repeat(600)));
    expectInvalid(value);
  });
  it('rejects an unsplittable word longer than 320 UTF-16 units', () => {
    const value = request(vectors[0]), jobId = value.evidence.textJobId, text = 'A'.repeat(321);
    const cue = { id: hash(`lv016-cue-id-v1\0${jobId}\0${0}`), index: 0, startMs: 0, endMs: 900, es: 'Medida.', en: text };
    const payload = JSON.stringify({ durationMs: 5_000, cues: [cue] }), review = value.evidence.review, receipt = value.evidence.receipt;
    review.payload = payload; review.payloadSha256 = receipt.payloadSha256 = hash(payload); review.voiceSha256 = receipt.voiceSha256 = hash(text + '\n');
    review.fingerprint = receipt.fingerprint = digest(['review-save-v1', value.evidence.accountId, value.evidence.inputId, jobId, 1, [[cue.id, text]]]);
    expectInvalid(value);
  });
  it('rejects nonstandard prototypes and symbol properties in evidence', () => {
    const value = request(vectors[0]); Object.setPrototypeOf(value.evidence.review, { extra: true }); expectInvalid(value);
    const withSymbol = request(vectors[0]); withSymbol.evidence.review[Symbol('extra')] = true; expectInvalid(withSymbol);
  });
  it('revalidates cue IDs even when payload hashes are recomputed', () => {
    const value = request(vectors[0]), parsed = JSON.parse(value.evidence.review.payload);
    parsed.cues[0].id = 'f'.repeat(64); const payload = JSON.stringify(parsed);
    value.evidence.review.payload = payload; value.evidence.review.payloadSha256 = value.evidence.receipt.payloadSha256 = hash(payload);
    expectInvalid(value);
  });
  it('rejects non-data properties and exceptions without exposing the supplied content', () => {
    const value = request(vectors[0]); Object.defineProperty(value.evidence.review, 'payload', { enumerable: true, get() { throw Error('synthetic private text'); } });
    expectInvalid(value);
    expectInvalid({ ...request(vectors[0]), body: Buffer.from('not a string') });
  });
  it('does not treat a mathematically coherent substituted receipt as authentication', () => {
    const value = request(vectors[0]), replacement = 'd'.repeat(64);
    // This pure module is deliberately unable to verify that this receipt was
    // read from Firestore or that its owner and capture remain authorized.
    value.evidence.receiptId = replacement; value.evidence.review.receiptId = replacement;
    expect(validateReviewedVoiceCall(value).receiptId).toBe(replacement);
  });
  it('rejects mismatched fingerprints even when both records agree on the replacement', () => {
    const value = request(vectors[0]); value.evidence.review.fingerprint = value.evidence.receipt.fingerprint = digest(['forged']); expectInvalid(value);
  });
});
