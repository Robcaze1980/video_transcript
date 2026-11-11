import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_GEMINI_VIDEO_BYTES, withGeminiVideoFile } from './geminiFileUpload';

const origin = 'https://generativelanguage.googleapis.com';
const uploadUrl = origin + '/upload/v1beta/files?upload_id=private-session';
const file = { name: 'files/test-file', uri: origin + '/v1beta/files/test-file', state: 'ACTIVE' };
let directory: string;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lv-gemini-file-'));
  path = join(directory, 'private-video.mp4');
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
async function input(size = 13) {
  const handle = await open(path, 'w');
  await handle.truncate(size);
  await handle.close();
  return { path, size };
}
function transport(finalFile = file) {
  return vi.fn<typeof fetch>(async (_url, options) => {
    const headers = new Headers(options?.headers);
    const command = headers.get('X-Goog-Upload-Command');
    if (command === 'start') return new Response('', { headers: { 'x-goog-upload-url': uploadUrl } });
    if (command === 'cancel' || options?.method === 'DELETE') return new Response(null, { status: 204 });
    if (command?.includes('finalize')) return Response.json({ file: finalFile });
    if (command === 'upload') return new Response('', { headers: {
      'x-goog-upload-size-received': String(Number(headers.get('X-Goog-Upload-Offset')) + (options?.body as Buffer).length),
    } });
    return Response.json(file);
  });
}

describe('Gemini resumable disk upload (synthetic transport only)', () => {
  it('uploads bounded real blocks with exact offsets, key only in header, then deletes', async () => {
    const fetch = transport();
    const consume = vi.fn(async (_file: { uri: string; mimeType: 'video/mp4' }) => 'subtitles');
    expect(await withGeminiVideoFile('test-secret', await input(8 * 1024 * 1024 + 13), consume, { fetch })).toBe('subtitles');
    const calls = fetch.mock.calls;
    expect(calls).toHaveLength(4);
    const blocks = calls.filter(([, options]) => new Headers(options?.headers).get('X-Goog-Upload-Command')?.startsWith('upload'));
    expect(blocks.map(([, options]) => [(options!.body as Buffer).length, new Headers(options!.headers).get('X-Goog-Upload-Offset')]))
      .toEqual([[8 * 1024 * 1024, '0'], [13, String(8 * 1024 * 1024)]]);
    for (const [url, options] of calls) {
      expect(String(url)).not.toContain('test-secret');
      expect(new Headers(options!.headers).get('x-goog-api-key')).toBe('test-secret');
      expect(options!.redirect).toBe('error');
    }
    expect(String(calls[0][1]!.body)).not.toContain('private-video');
    expect(calls.at(-1)![1]!.method).toBe('DELETE');
    expect(consume.mock.calls[0][0]).toEqual({ uri: file.uri, mimeType: 'video/mp4' });
  });
  it('polls processing to ACTIVE before consuming', async () => {
    const fetch = transport({ ...file, state: 'PROCESSING' });
    await withGeminiVideoFile('key', await input(), async () => 'ok', { fetch, pollIntervalMs: 0 });
    expect(fetch.mock.calls.some(([url, options]) => String(url).endsWith(file.name) && !options?.method)).toBe(true);
    expect(fetch.mock.calls.at(-1)![1]!.method).toBe('DELETE');
  });
  it('rejects hostile session URLs before media/key is sent there', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('', { headers: { 'x-goog-upload-url': 'https://evil.test/upload' } }));
    await expect(withGeminiVideoFile('key', await input(), async () => 'bad', { fetch })).rejects.toThrow('Invalid Gemini');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects offset mismatch and cancels unfinished session', async () => {
    const normal = transport();
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, options) => new Headers(options?.headers).get('X-Goog-Upload-Command') === 'upload'
      ? new Response('', { headers: { 'x-goog-upload-size-received': '1' } }) : normal(url, options));
    await expect(withGeminiVideoFile('key', await input(8 * 1024 * 1024 + 1), async () => 'bad', { fetch })).rejects.toThrow('offset mismatch');
    expect(new Headers(fetch.mock.calls.at(-1)![1]!.headers).get('X-Goog-Upload-Command')).toBe('cancel');
  });
  it('bounded polling and FAILED state both delete provider file', async () => {
    for (const state of ['PROCESSING', 'FAILED']) {
      const normal = transport({ ...file, state });
      const fetch = vi.fn<typeof globalThis.fetch>(async (url, options) => !options?.method
        ? Response.json({ ...file, state }) : normal(url, options));
      await expect(withGeminiVideoFile('key', await input(), async () => 'bad', { fetch, maxPolls: 2, pollIntervalMs: 0 })).rejects.toThrow('did not become active');
      expect(fetch.mock.calls.at(-1)![1]!.method).toBe('DELETE');
      expect(fetch.mock.calls.filter(([, options]) => !options?.method)).toHaveLength(state === 'PROCESSING' ? 2 : 0);
    }
  });
  it('aborting during processing still deletes with a fresh cleanup signal', async () => {
    const controller = new AbortController();
    const normal = transport({ ...file, state: 'PROCESSING' });
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, options) => {
      const response = await normal(url, options);
      if (new Headers(options?.headers).get('X-Goog-Upload-Command')?.includes('finalize')) controller.abort();
      if (options?.method === 'DELETE') expect(options.signal!.aborted).toBe(false);
      return response;
    });
    await expect(withGeminiVideoFile('key', await input(), async () => 'bad', { fetch, signal: controller.signal })).rejects.toBeDefined();
    expect(fetch.mock.calls.at(-1)![1]!.method).toBe('DELETE');
  });
  it('cleans up consumer failure and sanitizes arbitrary provider/URL errors', async () => {
    const fetch = transport();
    await expect(withGeminiVideoFile('key', await input(), async () => { throw new Error(uploadUrl); }, { fetch })).rejects.toThrow('Gemini file processing failed.');
    expect(fetch.mock.calls.at(-1)![1]!.method).toBe('DELETE');
  });
  it('reports cleanup failure using only a fixed reason and retains successful result', async () => {
    const normal = transport();
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, options) => options?.method === 'DELETE' ? new Response('private error', { status: 500 }) : normal(url, options));
    const onCleanupFailure = vi.fn();
    expect(await withGeminiVideoFile('key', await input(), async () => 'ok', { fetch, onCleanupFailure })).toBe('ok');
    expect(onCleanupFailure).toHaveBeenCalledExactlyOnceWith('file_delete_failed');
  });
  it('deletes even if uploaded file URI is unsafe', async () => {
    const fetch = transport({ ...file, uri: 'https://evil.test/file' });
    await expect(withGeminiVideoFile('key', await input(), async () => 'bad', { fetch })).rejects.toThrow('Invalid Gemini');
    expect(fetch.mock.calls.at(-1)![1]!.method).toBe('DELETE');
  });
  it('rejects oversized and changed local files without any network request', async () => {
    const fetch = transport();
    await expect(withGeminiVideoFile('key', { path, size: MAX_GEMINI_VIDEO_BYTES + 1 }, async () => 'bad', { fetch })).rejects.toThrow('size');
    await input(12);
    await expect(withGeminiVideoFile('key', { path, size: 13 }, async () => 'bad', { fetch })).rejects.toThrow('changed');
    expect(fetch).not.toHaveBeenCalled();
  });
});
