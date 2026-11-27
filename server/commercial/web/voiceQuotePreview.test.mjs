import assert from 'node:assert/strict';
import { test } from 'vitest';
import { estimateVoiceQuote } from './voiceQuotePreview.mjs';

test('the 2 min 10 s example defaults to the text estimate', () => {
  assert.deepEqual(estimateVoiceQuote(130_000, false), { textCents: 22, voiceCents: 0, totalCents: 22 });
});

test('the total adds the separately rounded text and voice estimates', () => {
  assert.deepEqual(estimateVoiceQuote(130_000, true), { textCents: 22, voiceCents: 22, totalCents: 44 });
});

test('rounds source duration up to the second before rounding to cents', () => {
  assert.equal(estimateVoiceQuote(2_000, false).textCents, 0);
  assert.equal(estimateVoiceQuote(2_001, false).textCents, 1);
  assert.equal(estimateVoiceQuote(128_000, true).totalCents, 42);
  assert.equal(estimateVoiceQuote(128_001, true).totalCents, 44);
});

test('exact half-cent ties round up regardless of their position', () => {
  for (const [durationMs, cents] of [[3_000, 1], [9_000, 2], [129_000, 22], [597_000, 100]]) {
    assert.deepEqual(estimateVoiceQuote(durationMs, true), { textCents: cents, voiceCents: cents, totalCents: cents * 2 });
  }
});

test('accepts one millisecond and ten minutes as estimate boundaries', () => {
  assert.deepEqual(estimateVoiceQuote(1, true), { textCents: 0, voiceCents: 0, totalCents: 0 });
  assert.deepEqual(estimateVoiceQuote(600_000, true), { textCents: 100, voiceCents: 100, totalCents: 200 });
});

test('rejects malformed duration and voice choices', () => {
  for (const value of [-1, 0, 0.1, 600_001, Infinity, NaN, '130000', null]) {
    assert.throws(() => estimateVoiceQuote(value, true), RangeError);
  }
  for (const value of ['true', 1, null, undefined]) {
    assert.throws(() => estimateVoiceQuote(130_000, value), RangeError);
  }
});
