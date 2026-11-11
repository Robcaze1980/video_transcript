import { open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const origin = 'https://generativelanguage.googleapis.com';
const chunkBytes = 8 * 1024 * 1024;
export const MAX_GEMINI_VIDEO_BYTES = 500_000_000;
type ProviderFile = { name: string; uri: string; state: string };
export type GeminiUploadOptions = {
  signal?: AbortSignal;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  maxPolls?: number;
  onCleanupFailure?: (reason: 'file_delete_failed' | 'upload_cancel_failed') => void;
};

function googleUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid Gemini upload destination.'); }
  if (url.origin !== origin || url.username || url.password || url.hash) throw new Error('Invalid Gemini upload destination.');
  return url.href;
}

// Provider responses are deliberately bounded; never propagate their body or URL into errors/logs.
async function json(response: Response): Promise<any> {
  if (!response.ok) throw new Error('Gemini Files API request failed (HTTP ' + response.status + ').');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Gemini Files API returned no metadata.');
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) throw new Error('Gemini Files API metadata exceeded the limit.');
      parts.push(value);
    }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
    catch { throw new Error('Gemini Files API returned invalid metadata.'); }
  } finally { await reader.cancel().catch(() => undefined); }
}

/** Bounded, resumable Files API upload. Owns provider cleanup even if polling/consumer fails.
 * Official protocol: https://ai.google.dev/gemini-api/docs/files (REST resumable upload).
 * No source filename, local path, media content, or credential is included in error messages.
 */
export async function withGeminiVideoFile<T>(apiKey: string, input: { path: string; size: number },
  consume: (file: { uri: string; mimeType: 'video/mp4' }, signal: AbortSignal) => Promise<T>,
  options: GeminiUploadOptions = {}): Promise<T> {
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > MAX_GEMINI_VIDEO_BYTES) {
    throw new Error('Video file size is outside the supported limit.');
  }
  const request = options.fetch ?? fetch;
  const signal = AbortSignal.any([AbortSignal.timeout(15 * 60_000), ...(options.signal ? [options.signal] : [])]);
  const headers = { 'x-goog-api-key': apiKey };
  let uploadUrl: string | undefined;
  let fileName: string | undefined;
  let finalized = false;
  const handle = await open(input.path, 'r').catch(() => { throw new Error('Video file could not be opened.'); });
  try {
    signal.throwIfAborted();
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== input.size) throw new Error('Video file changed before upload.');
    const started = await request(origin + '/upload/v1beta/files', {
      method: 'POST', redirect: 'error', signal, headers: {
        ...headers, 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(input.size),
        'X-Goog-Upload-Header-Content-Type': 'video/mp4',
      }, body: JSON.stringify({ file: { display_name: 'LinguistVision video' } }),
    });
    if (!started.ok) throw new Error('Gemini upload could not start (HTTP ' + started.status + ').');
    uploadUrl = googleUrl(started.headers.get('x-goog-upload-url') || '');
    await started.body?.cancel();
    let metadata: any;
    for (let offset = 0; offset < input.size;) {
      signal.throwIfAborted();
      const length = Math.min(chunkBytes, input.size - offset);
      const block = Buffer.allocUnsafe(length);
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await handle.read(block, filled, length - filled, offset + filled);
        if (!bytesRead) throw new Error('Video file changed during upload.');
        filled += bytesRead;
      }
      const last = offset + length === input.size;
      const response = await request(uploadUrl, { method: 'POST', redirect: 'error', signal, headers: {
        ...headers, 'Content-Type': 'video/mp4', 'Content-Length': String(length),
        'X-Goog-Upload-Offset': String(offset), 'X-Goog-Upload-Command': last ? 'upload, finalize' : 'upload',
      }, body: block });
      if (!response.ok) throw new Error('Gemini upload failed (HTTP ' + response.status + ').');
      if (last) {
        metadata = (await json(response)).file;
        // Capture the safe resource name before URI/state validation so failures still delete it.
        if (typeof metadata?.name === 'string' && /^files\/[a-zA-Z0-9_-]+$/.test(metadata.name)) fileName = metadata.name;
        finalized = true;
      } else await response.body?.cancel();
      const received = response.headers.get('x-goog-upload-size-received');
      if (received !== null && received !== String(offset + length)) throw new Error('Gemini upload offset mismatch.');
      offset += length;
    }
    if (!fileName) throw new Error('Gemini Files API returned an invalid file name.');
    const maxPolls = Math.min(120, Math.max(1, options.maxPolls ?? 60));
    let file: ProviderFile = metadata;
    for (let poll = 0; file.state === 'PROCESSING' && poll < maxPolls; poll++) {
      await delay(options.pollIntervalMs ?? 2000, undefined, { signal });
      file = await json(await request(origin + '/v1beta/' + fileName, { headers, redirect: 'error', signal }));
      if (file.name !== fileName) throw new Error('Gemini file identity changed during processing.');
    }
    if (file.state !== 'ACTIVE') throw new Error('Gemini video processing did not become active.');
    const uri = googleUrl(file.uri);
    if (new URL(uri).pathname !== '/v1beta/' + fileName || new URL(uri).search) throw new Error('Invalid Gemini file reference.');
    signal.throwIfAborted();
    return await consume({ uri, mimeType: 'video/mp4' }, signal);
  } catch (error) {
    signal.throwIfAborted();
    // fetch exceptions can contain the upload URL (a bearer capability), so sanitize them.
    if (error instanceof Error && /^(Gemini |Invalid Gemini |Video file )/.test(error.message)) throw error;
    throw new Error('Gemini file processing failed.');
  } finally {
    await handle.close();
    const cleanupSignal = AbortSignal.timeout(5000);
    if (fileName) {
      try {
        const response = await request(origin + '/v1beta/' + fileName, { method: 'DELETE', headers, redirect: 'error', signal: cleanupSignal });
        await response.body?.cancel();
        if (!response.ok && response.status !== 404) throw new Error('cleanup');
      } catch { reportCleanup('file_delete_failed'); }
    } else if (uploadUrl && !finalized) {
      try {
        const response = await request(uploadUrl, { method: 'POST', headers: { ...headers, 'X-Goog-Upload-Command': 'cancel' }, redirect: 'error', signal: cleanupSignal });
        await response.body?.cancel();
        if (!response.ok) throw new Error('cleanup');
      } catch { reportCleanup('upload_cancel_failed'); }
    } else if (finalized) reportCleanup('file_delete_failed');
  }
  function reportCleanup(reason: 'file_delete_failed' | 'upload_cancel_failed') {
    // Observability failures must not turn a completed transcription into a failed/charged retry.
    try {
      if (options.onCleanupFailure) options.onCleanupFailure(reason);
      else console.warn('Gemini cleanup failed: ' + reason);
    } catch { console.warn('Gemini cleanup failed: ' + reason); }
  }
}
