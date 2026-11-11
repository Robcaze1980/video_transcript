import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadPrivateVideo } from './pilotUpload.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function transport(steps) {
  const fetch = vi.fn(async (url, init) => {
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${init.method} ${url}`);
    return typeof step === 'function' ? step(url, init) : step;
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const file = () => new File(['abcdef'], 'same.mp4', { type: 'video/mp4', lastModified: 1234 });
afterEach(() => vi.unstubAllGlobals());

describe('private video upload recovery (no network)', () => {
  it('reconciles a committed chunk after its response is lost, without resending confirmed bytes', async () => {
    const video = file();
    const fetch = transport([
      json({ id: 'upload_1', offset: 0, state: 'uploading' }),
      () => { throw new TypeError('response lost after commit'); },
      json({ id: 'upload_1', offset: 2, state: 'uploading' }),
      (url, init) => { expect(url).toBe('./api/uploads/upload_1'); expect(init.headers['Upload-Offset']).toBe('2'); expect(init.body.size).toBe(2); return json({ offset: 4 }); },
      (url, init) => { expect(init.headers['Upload-Offset']).toBe('4'); return json({ offset: 6, state: 'ready' }); },
      json({ uploadId: 'upload_1', ready: true }),
    ]);
    await expect(uploadPrivateVideo(video, { chunkBytes: 2 })).rejects.toThrow('response lost after commit');
    expect(await uploadPrivateVideo(video, { chunkBytes: 2 })).toEqual({ uploadId: 'upload_1', ready: true });
    expect(fetch.mock.calls.filter(([url, init]) => url === './api/uploads' && init.method === 'POST')).toHaveLength(1);
    expect(fetch.mock.calls.filter(([, init]) => init.method === 'PUT').map(([, init]) => init.headers['Upload-Offset'])).toEqual(['0', '2', '4']);
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/abort'))).toBe(false);
  });

  it('does not reuse sessions for another File with identical name, size and modification date', async () => {
    const first = file(), second = file();
    const fetch = transport([
      json({ id: 'old', offset: 0 }), () => { throw new TypeError('offline'); },
      json({ id: 'new', offset: 0 }), json({ offset: 6, state: 'ready' }), json({ uploadId: 'new' }),
    ]);
    await expect(uploadPrivateVideo(first)).rejects.toThrow('offline');
    expect(await uploadPrivateVideo(second)).toEqual({ uploadId: 'new' });
    const starts = fetch.mock.calls.filter(([url, init]) => url === './api/uploads' && init.method === 'POST');
    expect(starts).toHaveLength(2);
    expect(JSON.parse(starts[0][1].body).requestKey).not.toBe(JSON.parse(starts[1][1].body).requestKey);
    expect(fetch.mock.calls.filter(([, init]) => init.method === 'GET')).toHaveLength(0);
  });

  it('isolates sessions for the same File in separate account contexts', async () => {
    const video = file();
    const fetch = transport([
      json({ id: 'account_a', offset: 0 }), () => { throw new TypeError('offline'); },
      json({ id: 'account_b', offset: 0 }), json({ offset: 6 }), json({ uploadId: 'account_b' }),
    ]);
    await expect(uploadPrivateVideo(video, { context: 'user-a' })).rejects.toThrow('offline');
    expect(await uploadPrivateVideo(video, { context: 'user-b' })).toEqual({ uploadId: 'account_b' });
    const starts = fetch.mock.calls.filter(([url]) => url === './api/uploads');
    expect(starts).toHaveLength(2);
    expect(JSON.parse(starts[0][1].body).requestKey).not.toBe(JSON.parse(starts[1][1].body).requestKey);
  });

  it('saves requestKey before initiation and reuses it when the creation response is lost', async () => {
    const video = file();
    const fetch = transport([
      () => { throw new TypeError('lost initiation response'); },
      json({ id: 'deduplicated', offset: 0 }), json({ offset: 6, state: 'ready' }), json({ uploadId: 'deduplicated' }),
    ]);
    await expect(uploadPrivateVideo(video)).rejects.toThrow('lost initiation response');
    await uploadPrivateVideo(video);
    expect(fetch.mock.calls[0][0]).toBe('./api/uploads');
    expect(fetch.mock.calls[1][0]).toBe('./api/uploads');
    expect(JSON.parse(fetch.mock.calls[0][1].body).requestKey).toBe(JSON.parse(fetch.mock.calls[1][1].body).requestKey);
  });

  it('explicit cancellation aborts partial media without reusing the aborted request signal', async () => {
    const video = file(), controller = new AbortController();
    const fetch = transport([
      json({ id: 'cancelled', offset: 0 }),
      () => { controller.abort(); throw new DOMException('cancelled', 'AbortError'); },
      (url, init) => { expect(url).toBe('./api/uploads/cancelled/abort'); expect(init.signal).toBeUndefined(); return json({ removed: true }); },
      json({ id: 'fresh', offset: 0 }), json({ offset: 6 }), json({ uploadId: 'fresh' }),
    ]);
    await expect(uploadPrivateVideo(video, { signal: controller.signal })).rejects.toMatchObject({ key: 'uploadCancelled' });
    expect(await uploadPrivateVideo(video)).toEqual({ uploadId: 'fresh' });
    expect(fetch.mock.calls[3][0]).toBe('./api/uploads');
    expect(JSON.parse(fetch.mock.calls[0][1].body).requestKey).not.toBe(JSON.parse(fetch.mock.calls[3][1].body).requestKey);
  });

  it('explicit cancellation during the resume status query also removes known partial media', async () => {
    const video = file(), controller = new AbortController();
    const fetch = transport([
      json({ id: 'cancel_resume', offset: 0 }), () => { throw new TypeError('connection interrupted'); },
      () => { controller.abort(); throw new DOMException('cancelled during status', 'AbortError'); },
      (url, init) => { expect(url).toBe('./api/uploads/cancel_resume/abort'); expect(init.signal).toBeUndefined(); return json({ removed: true }); },
    ]);
    await expect(uploadPrivateVideo(video)).rejects.toThrow('connection interrupted');
    await expect(uploadPrivateVideo(video, { signal: controller.signal })).rejects.toMatchObject({ key: 'uploadCancelled' });
    expect(fetch.mock.calls[3][0]).toBe('./api/uploads/cancel_resume/abort');
  });

  it('waits for completion acknowledgement rather than treating the last chunk as success', async () => {
    let acknowledge;
    const finalResponse = new Promise(resolve => { acknowledge = resolve; });
    const fetch = transport([json({ id: 'final', offset: 0 }), json({ offset: 6, state: 'ready' }), () => finalResponse]);
    let finished = false;
    const pending = uploadPrivateVideo(file()).then(result => { finished = true; return result; });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(finished).toBe(false);
    expect(fetch.mock.calls[2][0]).toBe('./api/uploads/final/complete');
    acknowledge(json({ uploadId: 'final', ready: true }));
    expect(await pending).toEqual({ uploadId: 'final', ready: true });
  });

  it('rejects unacknowledged offsets and failed finalization', async () => {
    transport([json({ id: 'bad_offset', offset: 0 }), json({ offset: 5 })]);
    await expect(uploadPrivateVideo(file())).rejects.toThrow('El servidor no confirmó el bloque.');
    transport([json({ id: 'bad_final', offset: 0 }), json({ offset: 6 }), json({ error: 'not_ready' }, 409)]);
    await expect(uploadPrivateVideo(file())).rejects.toMatchObject({ message: 'not_ready', status: 409 });
  });
});

it('starts a new request key after an unacknowledged initiation expires', async () => {
  const video = file();
  const fetch = transport([
    () => { throw new TypeError('lost creation response'); },
    json({error:'expired'}, 410),
    json({id:'fresh',offset:0}), json({offset:6,state:'uploading'}), json({id:'fresh'}),
  ]);
  await expect(uploadPrivateVideo(video)).rejects.toThrow('lost creation response');
  await expect(uploadPrivateVideo(video)).rejects.toMatchObject({status:410});
  expect(await uploadPrivateVideo(video)).toEqual({id:'fresh'});
  const starts = fetch.mock.calls.filter(([url,init]) => url === './api/uploads' && init.method==='POST');
  expect(JSON.parse(starts[0][1].body).requestKey).toBe(JSON.parse(starts[1][1].body).requestKey);
  expect(JSON.parse(starts[1][1].body).requestKey).not.toBe(JSON.parse(starts[2][1].body).requestKey);
});
