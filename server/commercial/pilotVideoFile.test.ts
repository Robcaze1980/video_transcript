import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPilotVideoAdapter } from './pilotVideo';
import { requestSectionTranscription } from '../../services/transcriptionCore';
import type { FileInput } from './jobs';

vi.mock('../../services/transcriptionCore', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/transcriptionCore')>(),
  requestSectionTranscription: vi.fn(),
}));
let directory: string;
let input: FileInput;
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), 'lv-file-adapter-'));
  const path = join(directory, 'synthetic.mp4');
  // Upload transport is simulated; trusted-store metadata is the boundary under test.
  await writeFile(path, Buffer.alloc(13));
  input = { id: 'synthetic-id', name: 'synthetic.mp4', path, size: 13, expiresAt: new Date(Date.now() + 60000),
    metadata: { duration: 120.2, width: 1920, height: 1080, audioTracks: 1 } };
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
function transport() {
  return vi.fn<typeof fetch>(async (_url, init) => {
    if (new Headers(init?.headers).get('X-Goog-Upload-Command') === 'start') return new Response('', {
      headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=test' },
    });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json({ file: { name: 'files/test', uri: 'https://generativelanguage.googleapis.com/v1beta/files/test', state: 'ACTIVE' } });
  });
}
it('uses fileData, trusted metadata, duration pricing and shared SRT output without local word timing', async () => {
  const fetch = transport();
  const usage = vi.fn();
  const read = vi.fn();
  vi.mocked(requestSectionTranscription).mockImplementation(async (_ai, options) => {
    options.onUsage?.({ totalTokenCount: 12 });
    return { hasSpeech: true, subtitles: [{ start: 0.5, end: 2, original: 'Hello.', translated: 'Hola.' }] };
  });
  const adapter = createPilotVideoAdapter('synthetic-key', undefined, usage, { read }, true, { fetch });
  adapter.validateFile!(input, { direction: 'en-es', duration: 1 });
  expect(await adapter.measureFilePrice!(input)).toBe(121);
  const output = await adapter.executeFile!(input, { direction: 'en-es', duration: 1 }, 'job-test') as { result: Buffer; original: Buffer; timingMode: string };
  expect(output.result.toString()).toBe('1\n00:00:00,500 --> 00:00:02,000\nHola.\n');
  expect(output.original.toString()).toContain('Hello.');
  expect(output.timingMode).toBe('gemini-only');
  const options = vi.mocked(requestSectionTranscription).mock.calls[0][1];
  expect(options.mediaPart).toEqual({ fileData: { mimeType: 'video/mp4', fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/test' } });
  expect(options.request.videoDuration).toBe(120.2);
  expect(usage).toHaveBeenCalledWith(expect.objectContaining({ seconds: 120.2, inputMode: 'file', timingMode: 'gemini-only' }));
  expect(read).not.toHaveBeenCalled();
  expect(fetch.mock.calls.at(-1)![1]!.method).toBe('DELETE');
});
it('rejects flat pricing, unsupported directions, expired assets and excessive trusted dimensions/duration', async () => {
  const flat = createPilotVideoAdapter('synthetic-key');
  expect(() => flat.validateFile!(input, { direction: 'en-es' })).toThrow('duration-based');
  await expect(flat.measureFilePrice!(input)).rejects.toThrow('duration-based');
  const adapter = createPilotVideoAdapter('synthetic-key', undefined, undefined, undefined, true);
  expect(() => adapter.validateFile!(input, { direction: 'unsupported' })).toThrow('Unsupported');
  for (const changed of [
    { ...input, expiresAt: new Date(0) }, { ...input, size: 500_000_001 },
    { ...input, metadata: { ...input.metadata, duration: 600.1 } },
    { ...input, metadata: { ...input.metadata, width: 1921 } },
  ]) expect(() => adapter.validateFile!(changed, { direction: 'en-es' })).toThrow('valid stored MP4');
  expect(requestSectionTranscription).not.toHaveBeenCalled();
});
it('rejects invalid/excessive provider cues and deletes the file on transcription failure', async () => {
  for (const subtitles of [[], [{ start: 0, end: 5, original: 'x'.repeat(10001), translated: 'Hola' }]]) {
    const fetch = transport();
    vi.mocked(requestSectionTranscription).mockResolvedValue({ hasSpeech: true, subtitles });
    const adapter = createPilotVideoAdapter('synthetic-key', undefined, undefined, undefined, true, { fetch });
    await expect(adapter.executeFile!(input, { direction: 'en-es' }, 'job-test')).rejects.toThrow();
    expect(fetch.mock.calls.at(-1)![1]!.method).toBe('DELETE');
  }
});

it('keeps the established short-clip alignment for small private files', async () => {
  const bytes = await readFile(new URL('../pilot-site/assets/jobsite.mp4', import.meta.url));
  await writeFile(input.path, bytes);
  input.size = bytes.length;
  input.metadata.duration = 6;
  const fetch = transport();
  const read = vi.fn().mockResolvedValue([]);
  vi.mocked(requestSectionTranscription).mockResolvedValue({ hasSpeech: true,
    subtitles: [{ start: 0.5, end: 2, original: 'Hello.', translated: 'Hola.' }] });
  const adapter = createPilotVideoAdapter('synthetic-key', undefined, undefined, { read }, true, { fetch });
  await adapter.executeFile!(input, { direction:'en-es' }, 'short-test');
  expect(fetch).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalled();
  expect(vi.mocked(requestSectionTranscription).mock.calls[0][1].mediaPart).toHaveProperty('inlineData');
});
