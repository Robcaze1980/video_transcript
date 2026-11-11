import { describe, expect, it, vi } from 'vitest';
import { createDriveUploader, createGoogleDriveAuthorization, DRIVE_FILE_SCOPE } from './pilotDrive.js';

const SESSION = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test';
const CHUNK = 256 * 1024;
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const saved = size => json({ id: 'file_1', name: 'captions.mp4', size: String(size), webViewLink: 'https://drive.google.com/file/d/file_1/view' });
function fixture(steps, options = {}) {
  const fetch = vi.fn(async (url, init) => {
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request ${init.method} ${url}`);
    return typeof step === 'function' ? step(url, init) : step;
  });
  return { fetch, uploader: createDriveUploader({ fetch, getAccessToken: () => 'test-oauth-token', chunkSize: CHUNK, retryDelay: 0, ...options }) };
}
const begin = () => [json({ ids: ['file_1'] }), new Response(null, { status: 200, headers: { Location: SESSION } })];

describe('Drive resumable exports (fake transport only)', () => {
  it('sends Blob slices, acknowledges server Range and confirms metadata before success', async () => {
    const size = CHUNK + 42;
    const blob = new Blob([new Uint8Array(size)], { type: 'video/mp4' });
    blob.arrayBuffer = () => { throw new Error('Must not buffer complete video'); };
    const { uploader, fetch } = fixture([...begin(),
      (url, init) => { expect(init.body).toBeInstanceOf(Blob); expect(init.body.size).toBe(CHUNK); expect(init.headers['Content-Range']).toBe(`bytes 0-${CHUNK - 1}/${size}`); return new Response(null, { status: 308, headers: { Range: `bytes=0-${CHUNK - 1}` } }); },
      (url, init) => { expect(init.body.size).toBe(42); expect(init.headers['Content-Range']).toBe(`bytes ${CHUNK}-${size - 1}/${size}`); return saved(size); }, saved(size)]);
    const progress = [];
    const input = { exportKey: 'mp4-project-rev1', blob, name: 'captions.mp4', onProgress: value => progress.push(value.uploaded) };
    const first = uploader.upload(input);
    expect(uploader.upload(input)).toBe(first);
    expect(await first).toMatchObject({ id: 'file_1', size });
    expect(progress).toEqual([CHUNK, size]);
    expect(await uploader.upload(input)).toMatchObject({ id: 'file_1' });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls[1][1].body).toContain('"id":"file_1"');
    expect(fetch.mock.calls.every(([, init]) => init.credentials === 'omit' && init.redirect === 'error')).toBe(true);
  });

  it('recovers lost chunk response by probing its session and resuming from the confirmed byte', async () => {
    const blob = new Blob([new Uint8Array(CHUNK + 1)]);
    const { uploader, fetch } = fixture([...begin(), () => { throw new TypeError('offline'); },
      (url, init) => { expect(url).toBe(SESSION); expect(init.headers['Content-Range']).toBe(`bytes */${blob.size}`); return new Response(null, { status: 308, headers: { Range: `bytes=0-${CHUNK - 1}` } }); },
      (url, init) => { expect(init.headers['Content-Range']).toBe(`bytes ${CHUNK}-${CHUNK}/${blob.size}`); return saved(blob.size); }, saved(blob.size)]);
    await uploader.upload({ exportKey: 'recover', blob, name: 'captions.mp4' });
    expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });

  it('confirms lost final response without uploading another file', async () => {
    const blob = new Blob(['subtitle']);
    const { uploader, fetch } = fixture([...begin(), () => { throw new TypeError('lost final response'); }, saved(blob.size), saved(blob.size)]);
    expect(await uploader.upload({ exportKey: 'last', blob, name: 'sub.srt' })).toMatchObject({ id: 'file_1' });
    expect(fetch.mock.calls.filter(([, init]) => init.body instanceof Blob)).toHaveLength(1);
  });

  it('recovers a 308 with no Range without assuming the chunk was accepted', async () => {
    const blob = new Blob(['subtitle']);
    const { uploader, fetch } = fixture([...begin(), new Response(null, { status: 308 }),
      new Response(null, { status: 308 }), saved(blob.size), saved(blob.size)]);
    await uploader.upload({ exportKey: 'empty-range', blob, name: 'sub.srt' });
    expect(fetch.mock.calls[3][1].headers['Content-Range']).toBe(`bytes */${blob.size}`);
    expect(fetch.mock.calls[4][1].headers['Content-Range']).toBe(`bytes 0-${blob.size - 1}/${blob.size}`);
  });

  it('a forgotten upload session checks the file before restarting with the same ID', async () => {
    const blob = new Blob(['subtitle']);
    const { uploader, fetch } = fixture([...begin(), () => { throw new TypeError('connection lost'); },
      new Response(null, { status: 404 }), new Response(null, { status: 404 }),
      new Response(null, { status: 200, headers: { Location: SESSION } }), saved(blob.size), saved(blob.size)]);
    await uploader.upload({ exportKey: 'expired', blob, name: 'sub.srt' });
    const starts = fetch.mock.calls.filter(([, init]) => init.method === 'POST');
    expect(starts).toHaveLength(2);
    expect(starts[0][1].body).toBe(starts[1][1].body);
    expect(fetch.mock.calls.filter(([url]) => url.includes('generateIds'))).toHaveLength(1);
  });

  it('cancel then retry reuses the session and reconciles uploaded bytes', async () => {
    const blob = new Blob(['subtitle']);
    const controller = new AbortController();
    const { uploader, fetch } = fixture([...begin(), () => { controller.abort(); throw new DOMException('cancelled', 'AbortError'); },
      new Response(null, { status: 308 }), saved(blob.size), saved(blob.size)]);
    const input = { exportKey: 'cancel-retry', blob, name: 'sub.srt' };
    await expect(uploader.upload({ ...input, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await uploader.upload(input);
    expect(fetch.mock.calls[3][0]).toBe(SESSION);
    expect(fetch.mock.calls[3][1].headers['Content-Range']).toBe(`bytes */${blob.size}`);
    expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });

  it('reuses a pre-generated ID if creation response was lost', async () => {
    const blob = new Blob(['subtitle']);
    const { uploader, fetch } = fixture([json({ ids: ['file_1'] }), () => { throw new TypeError('lost create response'); },
      new Response(null, { status: 409 }), saved(blob.size)]);
    await uploader.upload({ exportKey: 'idempotent', blob, name: 'sub.srt' });
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[2][1].body);
  });

  it('does not report success before file ID, size and view URL are confirmed', async () => {
    const blob = new Blob(['subtitle']);
    const { uploader } = fixture([...begin(), saved(blob.size), json({ id: 'file_1', size: String(blob.size) })]);
    await expect(uploader.upload({ exportKey: 'unconfirmed', blob, name: 'sub.srt' })).rejects.toMatchObject({ code: 'drive_confirmation_incomplete' });
  });

  it('rejects range overflow and untrusted resumable location without forwarding a token', async () => {
    const blob = new Blob(['subtitle']);
    const { uploader } = fixture([...begin(), new Response(null, { status: 308, headers: { Range: 'bytes=0-999999' } })]);
    await expect(uploader.upload({ exportKey: 'range', blob, name: 'sub.srt' })).rejects.toMatchObject({ code: 'drive_invalid_range' });
    const unsafe = fixture([json({ ids: ['file_1'] }), new Response(null, { status: 200, headers: { Location: 'https://attacker.example/upload' } })]);
    await expect(unsafe.uploader.upload({ exportKey: 'unsafe', blob, name: 'sub.srt' })).rejects.toMatchObject({ code: 'drive_invalid_session' });
    expect(unsafe.fetch).toHaveBeenCalledTimes(2);
  });

  it('requires explicit authorization after 401 and retains resumable state for a later gesture', async () => {
    const blob = new Blob(['subtitle']);
    const { uploader, fetch } = fixture([...begin(), new Response(null, { status: 401 }), new Response(null, { status: 308 }), saved(blob.size), saved(blob.size)]);
    const input = { exportKey: 'reauthorize', blob, name: 'sub.srt' };
    await expect(uploader.upload(input)).rejects.toMatchObject({ code: 'drive_authorization_required' });
    await uploader.upload(input);
    expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    expect(JSON.parse(fetch.mock.calls[1][1].body).id).toBe('file_1');
    expect(fetch.mock.calls[3][0]).toBe(SESSION);
  });

  it('aborts during retry backoff without sending a recovery request', async () => {
    vi.useFakeTimers();
    try {
      const blob = new Blob(['subtitle']);
      const controller = new AbortController();
      const { uploader, fetch } = fixture([...begin(), new Response(null, { status: 503 })], { retryDelay: 10000 });
      const pending = uploader.upload({ exportKey: 'backoff', blob, name: 'sub.srt', signal: controller.signal });
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(1);
      controller.abort();
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it('bounds completed receipts to 20 with weak Blob identities and rejects wrong-content key reuse', async () => {
    const original = globalThis.WeakRef;
    const weak = vi.fn(function (value) { return new original(value); });
    vi.stubGlobal('WeakRef', weak);
    try {
      let counter = 0;
      const fetch = vi.fn(async (url, init) => {
        if (url.includes('generateIds')) return json({ ids: [`file_${++counter}`] });
        if (init.method === 'POST') return new Response(null, { status: 200, headers: { Location: SESSION } });
        return json({ id: `file_${counter}`, name: 'sub.srt', size: '1', webViewLink: `https://drive.google.com/file/d/file_${counter}/view` });
      });
      const uploader = createDriveUploader({ fetch, getAccessToken: () => 'test-token' });
      const inputs = Array.from({ length: 21 }, (_, i) => ({ exportKey: `revision-${i}`, blob: new Blob(['a']), name: 'sub.srt' }));
      for (const input of inputs) await uploader.upload(input);
      expect(weak.mock.calls.filter(([value]) => value instanceof Blob)).toHaveLength(21);
      const calls = fetch.mock.calls.length;
      await uploader.upload(inputs[20]);
      expect(fetch).toHaveBeenCalledTimes(calls);
      await expect(uploader.upload({ ...inputs[20], blob: new Blob(['b']) })).rejects.toMatchObject({ code: 'drive_export_key_reused' });
      await uploader.upload(inputs[0]);
      expect(fetch).toHaveBeenCalledTimes(calls + 4); // The oldest receipt was evicted, not retained indefinitely.
    } finally { vi.unstubAllGlobals(); }
  });

  it('keeps at most two strong Blob references for active uploads', async () => {
    let number = 0;
    const fetch = vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
      number++;
    }));
    const uploader = createDriveUploader({ fetch, getAccessToken: () => 'test-token' });
    const one = uploader.upload({ exportKey: 'one', blob: new Blob(['a']), name: 'one.mp4' });
    const two = uploader.upload({ exportKey: 'two', blob: new Blob(['b']), name: 'two.srt' });
    const rejectedOne = expect(one).rejects.toMatchObject({ name: 'AbortError' });
    const rejectedTwo = expect(two).rejects.toMatchObject({ name: 'AbortError' });
    await expect(uploader.upload({ exportKey: 'three', blob: new Blob(['c']), name: 'three.mp4' })).rejects.toMatchObject({ code: 'drive_upload_limit' });
    expect(number).toBe(2);
    uploader.clear();
    await Promise.all([rejectedOne, rejectedTwo]);
  });

  it('does not accept a changed Blob under a previous export key', async () => {
    const blob = new Blob(['a']);
    const { uploader } = fixture([...begin(), saved(1), saved(1)]);
    await uploader.upload({ exportKey: 'stable', blob, name: 'sub.srt' });
    await expect(uploader.upload({ exportKey: 'stable', blob: new Blob(['b']), name: 'sub.srt' })).rejects.toMatchObject({ code: 'drive_export_key_reused' });
  });

  it('clear aborts an active export and forgets retained Blobs and sessions', async () => {
    const blob = new Blob(['subtitle']);
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const { uploader } = fixture([...begin(), (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
      started();
    })]);
    const pending = uploader.upload({ exportKey: 'logout', blob, name: 'sub.srt' });
    await ready;
    uploader.clear();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('optional GIS authorization adapter', () => {
  it('requests drive.file separately, refuses partial consent, keeps tokens in memory only', async () => {
    let config;
    const requestAccessToken = vi.fn();
    const auth = createGoogleDriveAuthorization({ clientId: 'public-client-id', google: { accounts: { oauth2: { initTokenClient: value => { config = value; return { requestAccessToken }; } } } } });
    expect(() => auth.getAccessToken()).toThrow('drive_authorization_required');
    const refused = auth.authorize();
    expect(config.scope).toBe(DRIVE_FILE_SCOPE);
    expect(config.include_granted_scopes).toBe(false);
    config.callback({ access_token: 'not-authorized', scope: 'openid', expires_in: 3600 });
    await expect(refused).rejects.toMatchObject({ code: 'drive_permission_denied' });
    const accepted = auth.authorize();
    config.callback({ access_token: 'in-memory-only', scope: DRIVE_FILE_SCOPE, expires_in: 3600 });
    await accepted;
    expect(auth.getAccessToken()).toBe('in-memory-only');
    auth.clear();
    expect(() => auth.getAccessToken()).toThrow('drive_authorization_required');
    expect(requestAccessToken).toHaveBeenCalledTimes(2);
  });
});
