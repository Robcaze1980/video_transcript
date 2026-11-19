import { describe, expect, it, vi } from 'vitest';
import { candidateApi, type Store } from './cloudCandidateApi';
import { reviewedTranslationClient, validReviewEdits } from './reviewedTranslationClient';

const account = '10000000-0000-4000-8000-000000000001', input = '20000000-0000-4000-8000-000000000001', job = '30000000-0000-4000-8000-000000000001';
const first = 'a'.repeat(64), second = 'b'.repeat(64);
const source = () => ({ projectRevision: 3, jobRevision: 3, durationMs: 3500, status: 'original', cues: [
  { id: first, index: 0, startMs: 0, endMs: 1200, es: 'La bomba mide 5 cm.', en: 'The pump measures 5 cm.' },
  { id: second, index: 1, startMs: 1500, endMs: 3500, es: 'Sin fugas.', en: 'No leaks.' },
] });
const json = (value: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(value), { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...extra } });
const data = (value: string, type = 'text/plain; charset=utf-8', revision = '4') => new Response(value, { headers: { 'Cache-Control': 'no-store', 'Content-Type': type, 'X-Vistavo-Revision': revision } });
const setup = (call: Parameters<typeof reviewedTranslationClient>[0]['call'], enabled = true) => {
  const controller = new AbortController(), check = vi.fn();
  return { client: reviewedTranslationClient({ enabled, signal: controller.signal, call }), controller, check };
};

describe('local structured-review client', () => {
  it('is disabled in the actual candidate before any authentication or request', async () => {
    const request = vi.fn(), token = vi.fn(), storage = new Map<string, string>();
    const store: Store = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } };
    const api = candidateApi({ accountId: account, token, signal: new AbortController().signal, store, request: request as typeof fetch });
    await expect(api.reviewed.load(input, job, () => {})).rejects.toMatchObject({ code: 'review_disabled' });
    expect(request).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  });
  it('uses the adapter contract for loading, saving, reopening and downloading a specific revision', async () => {
    const requests: Array<{ path: string; method?: string; body?: unknown }> = [];
    const call = vi.fn(async (path: string, method?: string, body?: unknown) => {
      requests.push({ path, method, body });
      if (method === 'PUT') return json({ committedRevision: 4 });
      if (path.includes('/download?')) return data('Corrected text.');
      const value = source(); if (requests.length > 1) { value.status = 'reviewed'; value.projectRevision = 4; value.cues[0].en = 'Corrected text.'; }
      return json(value);
    });
    const { client, check } = setup(call);
    const before = await client.load(input, job, check); expect(before.cues[0].startMs).toBe(0); expect(before.cues[1].endMs).toBe(3500);
    const edits = before.cues.map((cue, index) => ({ id: cue.id, en: index ? cue.en : 'Corrected text.' }));
    expect(await client.save(input, job, 3, 'synthetic-request', edits, check)).toBe(4);
    const reopened = await client.load(input, job, check); expect(reopened.cues[0]).toMatchObject({ id: first, es: 'La bomba mide 5 cm.', en: 'Corrected text.', startMs: 0, endMs: 1200 });
    expect(await (await client.download(input, job, 4, 'txt', check)).text()).toBe('Corrected text.');
    expect(requests[0].path).toBe(`/api/cloud/ai/jobs/${job}/review?inputId=${input}`);
    expect(requests[1]).toEqual({ path: `/api/cloud/ai/jobs/${job}/review`, method: 'PUT', body: { inputId: input, expectedRevision: 3, requestKey: 'synthetic-request', edits } });
    expect(requests[3].path).toBe(`/api/cloud/ai/jobs/${job}/review/download?inputId=${input}&revision=4&format=txt`);
    expect(check).toHaveBeenCalledTimes(8);
  });
  it('accepts a long original but rejects invalid edited text, duplicate ids and UTF-8 overflow', async () => {
    const long = source(); long.cues[0].en = 'a'.repeat(5000);
    expect((await setup(async () => json(long)).client.load(input, job, () => {})).cues[0].en).toHaveLength(5000);
    expect(validReviewEdits([{ id: first, en: 'é'.repeat(2048) }])).toBe(true);
    for (const edits of [ [{ id: first, en: 'é'.repeat(2049) }], [{ id: first, en: '' }], [{ id: first, en: 'x\ny' }], [{ id: first, en: '\ud800' }], [{ id: first, en: 'x' }, { id: first, en: 'y' }] ]) expect(validReviewEdits(edits)).toBe(false);
  });
  it('rejects bad timing, repeated identifiers, missing no-store or malformed revision', async () => {
    const invalid = source(); invalid.cues[1].startMs = 900;
    await expect(setup(async () => json(invalid)).client.load(input, job, () => {})).rejects.toMatchObject({ code: 'invalid_review_response' });
    const duplicate = source(); duplicate.cues[1].id = first;
    await expect(setup(async () => json(duplicate)).client.load(input, job, () => {})).rejects.toMatchObject({ code: 'invalid_review_response' });
    await expect(setup(async () => json(source(), { 'Cache-Control': 'public' })).client.load(input, job, () => {})).rejects.toMatchObject({ code: 'invalid_review_response' });
    await expect(setup(async () => json({ committedRevision: 7 })).client.save(input, job, 3, 'key', [{ id: first, en: 'Hello' }], () => {})).rejects.toMatchObject({ code: 'invalid_review_response' });
    await expect(setup(async () => data('wrong', 'text/plain; charset=utf-8', '5')).client.download(input, job, 4, 'txt', () => {})).rejects.toMatchObject({ code: 'invalid_review_response' });
  });
  it('does not return an in-flight result after session cancellation or a failed current-job check', async () => {
    let resolve!: (response: Response) => void;
    const waiting = new Promise<Response>(next => { resolve = next; });
    const { client, controller, check } = setup(() => waiting);
    const result = client.load(input, job, check); controller.abort(); resolve(json(source()));
    await expect(result).rejects.toThrow();
    let allowed = true; const other = setup(async () => { allowed = false; return json(source()); });
    await expect(other.client.load(input, job, () => { if (!allowed) throw Error('revoked'); })).rejects.toThrow('revoked');
  });
  it('does not map legacy text to segments', async () => {
    const legacy = { ...source(), status: 'legacy', reason: 'unlinked_draft', legacyDraft: 'Borrador sin tiempos' };
    expect(await setup(async () => json(legacy)).client.load(input, job, () => {})).toMatchObject({ status: 'legacy', reason: 'unlinked_draft', legacyDraft: 'Borrador sin tiempos' });
  });
  it('limits the legacy draft by UTF-8 bytes while preserving valid Unicode and line breaks', async () => {
    const legacy = { ...source(), status: 'legacy', reason: 'unlinked_draft', legacyDraft: '中文\nالعربية\u200f — e\u0301' };
    expect((await setup(async () => json(legacy)).client.load(input, job, () => {})).legacyDraft).toBe(legacy.legacyDraft);
    legacy.legacyDraft = 'é'.repeat(32768);
    expect((await setup(async () => json(legacy)).client.load(input, job, () => {})).legacyDraft).toBe(legacy.legacyDraft);
    legacy.legacyDraft += 'a';
    await expect(setup(async () => json(legacy)).client.load(input, job, () => {})).rejects.toMatchObject({ code: 'invalid_review_response' });
  });
  it('compares a present Content-Length to actual bytes, but permits an absent length', async () => {
    const bytes = 'Text ✓';
    const response = (declared?: string, encoding?: string) => new Response(bytes, { headers: {
      'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'X-Vistavo-Revision': '4',
      ...(declared === undefined ? {} : { 'Content-Length': declared }), ...(encoding ? { 'Content-Encoding': encoding } : {}),
    } });
    const count = new TextEncoder().encode(bytes).length;
    expect(await (await setup(async () => response(String(count))).client.download(input, job, 4, 'txt', () => {})).text()).toBe(bytes);
    expect(await (await setup(async () => response()).client.download(input, job, 4, 'txt', () => {})).text()).toBe(bytes);
    for (const value of [String(count - 1), String(count + 1), 'not-a-length', String(257 * 1024)]) {
      await expect(setup(async () => response(value)).client.download(input, job, 4, 'txt', () => {})).rejects.toMatchObject({ code: 'invalid_review_response' });
    }
    await expect(setup(async () => response(String(count), 'gzip')).client.download(input, job, 4, 'txt', () => {})).rejects.toMatchObject({ code: 'invalid_review_response' });
  });
});
