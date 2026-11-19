import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import * as codec from './pipelineTextCodec';
import { encodeTextBundle, TEXT_CODEC_MAX_CUES, TEXT_CODEC_MAX_SRT_BYTES } from './pipelineTextCodec';
import { REVIEWED_CUE_MAX_BYTES, REVIEWED_DRAFT_MAX_BYTES, reviewTranslation, validateTranslationSource } from './reviewedTranslation';

const jobId = 'synthetic-translation-job';

function sourceWith(count = 3) {
  const stepMs = count > 300 ? 500 : 2_000;
  const durationMs = count * stepMs;
  const rows = Array.from({ length: count }, (_, index) => ({
    startMs: index * stepMs,
    endMs: index * stepMs + (stepMs === 500 ? 250 : 1_500),
    es: index === 0 ? 'José mide cinco centímetros.' : `Frase original ${index + 1}.`,
    en: index === 0 ? 'José measures five centimeters.' : `Original phrase ${index + 1}.`,
  }));
  const bundle = encodeTextBundle(jobId, durationMs, { detectedLanguage: 'es', hasSpeech: true, cues: rows });
  return { durationMs, cues: bundle.cues.map(cue => ({ ...cue })) };
}

function originalEdits(source: ReturnType<typeof sourceWith>) {
  return source.cues.map(cue => ({ id: cue.id, en: cue.en }));
}

describe('reviewed translation content', () => {
  it('accepts a valid long original phrase without treating it as an edit', () => {
    const source = sourceWith(), longEnglish = 'é'.repeat(REVIEWED_CUE_MAX_BYTES / 2 + 1);
    source.cues[0].en = longEnglish;
    const before = structuredClone(source);
    const validated = validateTranslationSource(jobId, source);
    expect(Buffer.byteLength(validated.cues[0].en)).toBeGreaterThan(REVIEWED_CUE_MAX_BYTES);
    expect(validated.cues[0]).toEqual(source.cues[0]);
    expect(validated.cues[0]).not.toBe(source.cues[0]);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.cues)).toBe(true);
    expect(source).toEqual(before);
    const edits = originalEdits(source);
    expect(() => reviewTranslation(jobId, source, edits)).toThrow();
    edits[0].en = 'A shorter reviewed phrase.';
    expect(reviewTranslation(jobId, source, edits).cues[0].en).toBe(edits[0].en);
  });

  it('keeps the original immutable and gives TXT, timed SRT and voice the same edited phrases', () => {
    const source = sourceWith();
    const before = structuredClone(source);
    const edits = [
      { id: source.cues[0].id, en: 'José measures 2½ inches.' },
      { id: source.cues[1].id, en: 'The valve is 5 cm wide.' },
      { id: source.cues[2].id, en: 'Check the pressure, Ana.' },
    ];
    const beforeEdits = structuredClone(edits);
    source.cues.forEach(cue => Object.freeze(cue)); // Inputs must not be changed.
    Object.freeze(source.cues);
    Object.freeze(source);

    const result = reviewTranslation(jobId, source, edits);
    expect(result.txt).toBe('José measures 2½ inches.\nThe valve is 5 cm wide.\nCheck the pressure, Ana.\n');
    expect(result.voiceText).toBe(result.txt);
    expect(result.srt).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nJosé measures 2½ inches.\n\n' +
      '2\n00:00:02,000 --> 00:00:03,500\nThe valve is 5 cm wide.\n\n' +
      '3\n00:00:04,000 --> 00:00:05,500\nCheck the pressure, Ana.\n\n',
    );
    expect(result.cues.map(({ id, index, startMs, endMs, es }) => ({ id, index, startMs, endMs, es })))
      .toEqual(before.cues.map(({ id, index, startMs, endMs, es }) => ({ id, index, startMs, endMs, es })));
    expect(source).toEqual(before);
    expect(edits).toEqual(beforeEdits);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.cues)).toBe(true);
    expect(result.cues.every(Object.isFrozen)).toBe(true);
  });

  it('checks source IDs against the requested job and each regenerated index', () => {
    const source = sourceWith(), edits = originalEdits(source);
    expect(() => validateTranslationSource('another-job', source)).toThrow();
    expect(() => reviewTranslation('another-job', source, edits)).toThrow();
    const wrongId = structuredClone(source); wrongId.cues[0].id = 'not-the-original-id';
    expect(() => validateTranslationSource(jobId, wrongId)).toThrow();
    expect(() => reviewTranslation(jobId, wrongId, edits)).toThrow();
    const duplicated = structuredClone(source); duplicated.cues[1].id = duplicated.cues[0].id;
    expect(() => validateTranslationSource(jobId, duplicated)).toThrow();
    expect(() => reviewTranslation(jobId, duplicated, edits)).toThrow();
    const wrongIndex = structuredClone(source); wrongIndex.cues[0].index = 1;
    expect(() => validateTranslationSource(jobId, wrongIndex)).toThrow();
    expect(() => reviewTranslation(jobId, wrongIndex, edits)).toThrow();
  });

  it('requires exactly the same ordered IDs and number of edits', () => {
    const source = sourceWith(), edits = originalEdits(source);
    expect(() => reviewTranslation(jobId, source, edits.slice(1))).toThrow();
    expect(() => reviewTranslation(jobId, source, [])).toThrow();
    expect(() => reviewTranslation(jobId, source, [...edits, edits[0]])).toThrow();
    expect(() => reviewTranslation(jobId, source, [edits[1], edits[0], edits[2]])).toThrow();
    expect(() => reviewTranslation(jobId, source, [edits[0], edits[0], edits[2]])).toThrow();
    expect(() => reviewTranslation(jobId, source, [{ ...edits[0], id: 'altered' }, ...edits.slice(1)])).toThrow();
  });

  it.each([
    ['negative start', (s: ReturnType<typeof sourceWith>) => { s.cues[0].startMs = -1; }],
    ['fractional time', (s: ReturnType<typeof sourceWith>) => { s.cues[0].startMs = 0.5; }],
    ['zero-length cue', (s: ReturnType<typeof sourceWith>) => { s.cues[0].endMs = 0; }],
    ['overlap', (s: ReturnType<typeof sourceWith>) => { s.cues[1].startMs = 1_000; }],
    ['past duration', (s: ReturnType<typeof sourceWith>) => { s.cues[2].endMs = s.durationMs + 1; }],
    ['invalid duration', (s: ReturnType<typeof sourceWith>) => { s.durationMs = Number.NaN; }],
  ])('rejects original %s', (_name, mutate) => {
    const source = sourceWith(), edits = originalEdits(source);
    mutate(source);
    expect(() => validateTranslationSource(jobId, source)).toThrow();
    expect(() => reviewTranslation(jobId, source, edits)).toThrow();
  });

  it('rejects added or missing fields in the source, cue and edits', () => {
    const source = sourceWith(), edits = originalEdits(source);
    expect(() => reviewTranslation(jobId, { ...source, extra: true }, edits)).toThrow();
    expect(() => reviewTranslation(jobId, { durationMs: source.durationMs }, edits)).toThrow();
    expect(() => reviewTranslation(jobId, { ...source, cues: [{ ...source.cues[0], speaker: 'x' }, ...source.cues.slice(1)] }, edits)).toThrow();
    expect(() => reviewTranslation(jobId, source, [{ ...edits[0], es: 'injected' }, ...edits.slice(1)])).toThrow();
    expect(() => reviewTranslation(jobId, source, [{ id: edits[0].id }, ...edits.slice(1)])).toThrow();
  });

  it('rejects non-JSON shapes, extra array properties, holes and accessors without invoking them', () => {
    const source = sourceWith(), edits = originalEdits(source);
    const withExtra = [...edits] as typeof edits & { hidden?: boolean };
    withExtra.hidden = true;
    expect(() => reviewTranslation(jobId, source, withExtra)).toThrow();
    const sparse = [...edits]; delete sparse[1];
    expect(() => reviewTranslation(jobId, source, sparse)).toThrow();
    let read = false;
    const accessor = { id: edits[0].id, get en() { read = true; return 'unsafe'; } };
    expect(() => reviewTranslation(jobId, source, [accessor, ...edits.slice(1)])).toThrow();
    expect(read).toBe(false);
    expect(() => reviewTranslation(jobId, new Date(), edits)).toThrow();
  });

  it.each(['', '   ', 'hello\nworld', 'hello\rworld', 'bad\u0000text', 'bad\u0085text', 'bad\u2028text', '\ud800'])
    ('rejects unsafe or non-roundtripping edited text %#', text => {
      const source = sourceWith(), edits = originalEdits(source);
      edits[0].en = text;
      expect(() => reviewTranslation(jobId, source, edits)).toThrow();
    });

  it('also rejects malformed Unicode in an original source phrase', () => {
    const source = sourceWith(), edits = originalEdits(source);
    source.cues[0].es = 'bad\ud800text';
    expect(() => reviewTranslation(jobId, source, edits)).toThrow();
  });

  it('enforces the per-phrase limit in UTF-8 bytes, including multibyte text', () => {
    const source = sourceWith(), edits = originalEdits(source);
    edits[0].en = 'é'.repeat(REVIEWED_CUE_MAX_BYTES / 2);
    expect(Buffer.byteLength(edits[0].en)).toBe(REVIEWED_CUE_MAX_BYTES);
    expect(reviewTranslation(jobId, source, edits).cues[0].en).toBe(edits[0].en);
    edits[0].en += 'a';
    expect(() => reviewTranslation(jobId, source, edits)).toThrow();
  });

  it('accepts an SRT exactly at the existing bound and rejects one byte more', () => {
    const source = sourceWith(16), edits = originalEdits(source);
    const overhead = edits.reduce((sum, _edit, index) => sum + String(index + 1).length + 33, 0);
    const remaining = TEXT_CODEC_MAX_SRT_BYTES - overhead - 15 * REVIEWED_CUE_MAX_BYTES;
    edits.forEach((edit, index) => { edit.en = 'x'.repeat(index < 15 ? REVIEWED_CUE_MAX_BYTES : remaining); });
    const result = reviewTranslation(jobId, source, edits);
    expect(Buffer.byteLength(result.srt)).toBe(TEXT_CODEC_MAX_SRT_BYTES);
    expect(Buffer.byteLength(result.voiceText)).toBeLessThanOrEqual(REVIEWED_DRAFT_MAX_BYTES);
    edits[15].en += 'x';
    expect(() => reviewTranslation(jobId, source, edits)).toThrow();
  });

  it('rejects an oversized total draft before returning any text', () => {
    const source = sourceWith(16), edits = originalEdits(source);
    edits.forEach(edit => { edit.en = 'x'.repeat(REVIEWED_CUE_MAX_BYTES); });
    expect(edits.reduce((n, edit) => n + Buffer.byteLength(edit.en) + 1, 0)).toBeGreaterThan(REVIEWED_DRAFT_MAX_BYTES);
    expect(() => reviewTranslation(jobId, source, edits)).toThrow(/draft size/);
  });

  it('checks the final TXT bound even if an encoder returns an unexpectedly oversized result', () => {
    const source = sourceWith(), edits = originalEdits(source), original = codec.encodeTextBundle;
    let calls = 0;
    const spy = vi.spyOn(codec, 'encodeTextBundle').mockImplementation((...args) => {
      const result = original(...args);
      if (++calls !== 2) return result;
      return { ...result, en: { ...result.en, txt: 'x'.repeat(REVIEWED_DRAFT_MAX_BYTES + 1) } };
    });
    try {
      expect(() => reviewTranslation(jobId, source, edits)).toThrow(/draft size/);
      expect(calls).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects an oversized original SRT even when the edited text is short', () => {
    const source = sourceWith(17), edits = originalEdits(source);
    source.cues.forEach(cue => { cue.es = 'x'.repeat(REVIEWED_CUE_MAX_BYTES); });
    expect(() => reviewTranslation(jobId, source, edits)).toThrow();
  });

  it('honors the existing source cue-count limit', () => {
    const source = sourceWith(TEXT_CODEC_MAX_CUES), edits = originalEdits(source);
    expect(reviewTranslation(jobId, source, edits).cues).toHaveLength(TEXT_CODEC_MAX_CUES);
    source.cues.push({ ...source.cues[0] });
    expect(() => reviewTranslation(jobId, source, edits)).toThrow();
  });
});
