import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CommercialJobs, type JobAdapter } from './jobs';
import { startPilot } from './pilotHttp';
import { createSimulatedPayments } from './pilotPayments';
import { PrivateFileStore } from './privateFileStore';
import { ResumableUploads } from './resumableUploads';

const connectionString = process.env.LINGUISTVISION_TEST_DATABASE_URL;
const schema = 'lv_large_http_' + randomUUID().replaceAll('-', '');
const draft = '1\n00:00:00,000 --> 00:00:01,500\nTexto sintético.\n';
describe.skipIf(!connectionString)('large private video: HTTP → disk → job → editor', () => {
  let admin: Pool;
  let pool: Pool;
  let root: string;
  let fixtureDirectory: string;
  let store: PrivateFileStore;
  let uploads: ResumableUploads;
  let pilot: Awaited<ReturnType<typeof startPilot>>;
  let video: Buffer;
  let accounts: string[];
  let owner: string;
  let stranger: string;
  let release: (() => void) | undefined;
  const executeBuffer = vi.fn(async () => { throw new Error('Buffer execution must not be used.'); });
  const measureFilePrice = vi.fn(async (file: { metadata: { duration: number } }) => Math.ceil(file.metadata.duration));
  const executeFile = vi.fn(async () => {
    await new Promise<void>(resolve => { release = resolve; });
    return { result: Buffer.from(draft), original: Buffer.from(draft.replace('Texto sintético.', 'Synthetic text.')) };
  });
  const adapter: JobAdapter = {
    key: 'large-video-http-fixture', price: 1,
    validate() { throw new Error('Buffer validation must not be used.'); }, execute: executeBuffer,
    validateFile(file, options) {
      if (file.size <= 1048576 || file.metadata.duration > 600 || options.direction !== 'en-es') throw new Error('Invalid file fixture.');
    }, measureFilePrice, executeFile,
  };
  const codes = [randomBytes(24).toString('hex'), randomBytes(24).toString('hex')];
  const endpoint = (route: string) => pilot.origin + '/pilot/api/' + route;
  const get = (route: string, cookie = owner, headers: Record<string, string> = {}) => fetch(endpoint(route), { headers: { cookie, ...headers } });
  const post = (route: string, body: object = {}, cookie = owner) => fetch(endpoint(route), {
    method: 'POST', headers: { cookie, origin: pilot.origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const put = (id: string, offset: number, bytes: Buffer, cookie = owner, origin = pilot.origin) => fetch(endpoint('uploads/' + id), {
    method: 'PUT', headers: { cookie, origin, 'upload-offset': String(offset), 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes),
  });
  async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    for (let i = 0; i < 100; i++) {
      const value = await read();
      if (done(value)) return value;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for synthetic large-video job.');
  }
  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (url.hostname !== '127.0.0.1' || url.port !== '15438') throw new Error('Dedicated loopback test database required.');
    admin = new Pool({ connectionString });
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new Pool({ connectionString, options: '-c search_path=' + schema, application_name: schema });
    for (const filename of ['schema.sql', 'privateUploads.sql']) await pool.query(await readFile(new URL('./' + filename, import.meta.url), 'utf8'));
    root = await mkdtemp(join(tmpdir(), 'lv-large-http-store-'));
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'lv-large-http-fixture-'));
    const path = join(fixtureDirectory, 'synthetic.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=160x90:r=10:d=2', '-f', 'lavfi', '-i',
      'sine=frequency=440:sample_rate=16000:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest', path], { windowsHide: true });
    const free = Buffer.alloc(1200000);
    free.writeUInt32BE(free.length); free.write('free', 4, 'latin1');
    video = Buffer.concat([await readFile(path), free]);
    expect(video.length).toBeGreaterThan(1048576);
    store = new PrivateFileStore(root);
    uploads = new ResumableUploads(pool, store);
    const jobs = new CommercialJobs(pool, new Map());
    accounts = await Promise.all(codes.map(() => jobs.createAccount()));
    pilot = await startPilot({ pool, port: 0, uploads, editorAssets: new URL('../../dist/pilot-editor/', import.meta.url),
      invitations: new Map(codes.map((code, index) => [code, accounts[index]])), payments: createSimulatedPayments(),
      services: [{ adapter, label: 'Synthetic video', accepts: '.mp4', filename: 'synthetic.srt', contentType: 'application/x-subrip',
        editableVideo: true, directions: [{ id: 'en-es', label: 'English → Spanish' }] }],
    });
    const cookies = await Promise.all(codes.map(async code => {
      const response = await post('login', { code }, '');
      expect(response.status).toBe(200);
      return response.headers.get('set-cookie')!.split(';')[0];
    }));
    [owner, stranger] = cookies;
    const order = await (await post('checkout')).json();
    expect((await post('checkout/' + order.id + '/simulate')).status).toBe(202);
    await until(async () => (await get('account')).json(), account => account.balance.available === 5);
  }, 20000);
  afterAll(async () => {
    release?.();
    await pilot?.close();
    await pool?.end();
    if (admin) { await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end(); }
    for (const directory of [root, fixtureDirectory]) if (directory) await rm(directory, { recursive: true, force: true });
  });
  async function ready() {
    const started = await post('uploads', { name: 'synthetic.mp4', size: video.length, requestKey: randomUUID() });
    expect(started.status).toBe(201);
    const { id } = await started.json();
    const split = 700000;
    expect((await put(id, 0, video.subarray(0, split), owner, 'https://wrong-origin.example')).status).toBe(403);
    expect((await put(id, 0, video.subarray(0, split), stranger)).status).toBe(404);
    expect((await get('uploads/' + id, stranger)).status).toBe(404);
    expect((await put(id, 0, video.subarray(0, split))).status).toBe(200);
    expect((await (await get('uploads/' + id)).json()).offset).toBe(split);
    expect((await put(id, split, video.subarray(split))).status).toBe(200);
    expect((await post('uploads/' + id + '/complete', {}, stranger)).status).toBe(404);
    expect((await post('uploads/' + id + '/complete')).status).toBe(200);
    expect((await post('uploads/' + id + '/complete')).status).toBe(200);
    const { rows: [stored] } = await pool.query('SELECT content,private_upload_id FROM inputs WHERE id=$1', [id]);
    expect(stored).toEqual({ content: null, private_upload_id: id });
    expect((await stat(store.path(id))).size).toBe(video.length);
    return id as string;
  }
  async function enqueue(id: string) {
    release = undefined;
    const body = { inputId: id, requestKey: randomUUID(), service: adapter.key, options: { direction: 'en-es' } };
    const first = await post('jobs', body);
    expect(first.status).toBe(202);
    const { id: jobId } = await first.json();
    expect(await (await post('jobs', body)).json()).toEqual({ id: jobId });
    await until(async () => Boolean(release), Boolean);
    return jobId as string;
  }
  it('reserves/consumes once, streams source ranges, edits/reopens and removes disk artifacts', async () => {
    const id = await ready();
    const jobId = await enqueue(id);
    const price = Math.ceil((await uploads.get(accounts[0], id)).metadata.duration);
    expect(price).toBe(2);
    expect((await (await get('account')).json()).balance).toEqual({ credited: 5, available: 3, reserved: 2, consumed: 0 });
    release!();
    await until(async () => (await get('jobs/' + jobId)).json(), job => job.state === 'succeeded');
    expect((await (await get('account')).json()).balance).toEqual({ credited: 5, available: 3, reserved: 0, consumed: 2 });
    expect((await pool.query('SELECT kind,credits FROM credit_movements WHERE reference=$1 ORDER BY kind', [jobId])).rows)
      .toEqual([{ kind: 'capture', credits: 2 }, { kind: 'reserve', credits: 2 }]);
    expect(executeBuffer).not.toHaveBeenCalled();
    expect(executeFile).toHaveBeenCalledTimes(1);
    expect(measureFilePrice).toHaveBeenCalled();
    expect((await get('jobs/' + jobId + '/source', stranger)).status).toBe(404);
    const range = await get('jobs/' + jobId + '/source', owner, { range: 'bytes=0-15' });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe('bytes 0-15/' + video.length);
    expect(Buffer.from(await range.arrayBuffer())).toEqual(video.subarray(0, 16));
    expect((await get('jobs/' + jobId + '/download', stranger)).status).toBe(404);
    expect(await (await get('jobs/' + jobId + '/download')).text()).toBe(draft);
    expect((await post('jobs/' + jobId + '/project', {}, stranger)).status).toBe(404);
    const project = await post('jobs/' + jobId + '/project');
    expect(project.status).toBe(201);
    expect(await project.json()).toEqual({ id });
    expect((await post('jobs/' + jobId + '/project')).status).toBe(200);
    expect(await (await get('projects/' + id)).json()).toMatchObject({ revision: 1, draft: draft.trim(), duration: 2 });
    const corrected = draft.replace('Texto sintético.', 'Texto corregido.');
    const saved = await post('projects/' + id, { revision: 1, draft: corrected });
    expect(saved.status).toBe(200);
    expect(await (await get('projects/' + id)).json()).toMatchObject({ revision: 2, draft: corrected.trim() });
    const projectRange = await get('projects/' + id + '/source', owner, { range: 'bytes=8-15' });
    expect(projectRange.status).toBe(206);
    expect(Buffer.from(await projectRange.arrayBuffer())).toEqual(video.subarray(8, 16));
    expect((await post('projects/' + id + '/delete', {}, stranger)).status).toBe(404);
    expect((await post('projects/' + id + '/delete')).status).toBe(200);
    expect((await get('projects/' + id + '/source')).status).toBe(404);
    expect((await get('jobs/' + jobId + '/source')).status).toBe(404);
    await expect(stat(store.path(id))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 15000);
  it('refunds instead of publishing when the stored video expires during processing', async () => {
    const id = await ready();
    const before = (await (await get('account')).json()).balance;
    const jobId = await enqueue(id);
    await pool.query("UPDATE inputs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
    await pool.query("UPDATE private_uploads SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
    release!();
    await until(async () => (await get('jobs/' + jobId)).json(), job => job.state === 'failed');
    expect((await (await get('account')).json()).balance).toEqual(before);
    expect((await pool.query('SELECT kind FROM credit_movements WHERE reference=$1 ORDER BY kind', [jobId])).rows)
      .toEqual([{ kind: 'release' }, { kind: 'reserve' }]);
    expect((await get('jobs/' + jobId + '/download')).status).toBe(404);
    expect((await post('jobs/' + jobId + '/project')).status).toBe(404);
    expect((await get('jobs/' + jobId + '/source')).status).toBe(404);
    // Match startPilot cleanup order: jobs fence workers/unlink inputs, then upload orphans.
    await new CommercialJobs(pool, new Map(), uploads).purgeExpiredInputs();
    await uploads.purgeExpired();
    await expect(stat(store.path(id))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 15000);
  it('checks TTL after waiting for the terminal job lock and refunds exactly once', async () => {
    const id = await ready();
    const before = (await (await get('account')).json()).balance;
    const jobId = await enqueue(id);
    const lock = await pool.connect();
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT 1 FROM jobs WHERE id=$1 FOR UPDATE', [jobId]);
      await pool.query("UPDATE inputs SET expires_at=clock_timestamp()+interval '200 milliseconds' WHERE id=$1", [id]);
      release!();
      // Observe the actual blocked finish query; a sleep alone would not prove the interleaving.
      await until(async () => (await admin.query(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%FROM jobs WHERE id=%FOR UPDATE%'`, [schema])).rows[0].count,
      count => count > 0);
      await admin.query('SELECT pg_sleep(0.3)');
      await lock.query('COMMIT');
    } finally {
      await lock.query('ROLLBACK').catch(() => undefined);
      lock.release();
    }
    await until(async () => (await get('jobs/' + jobId)).json(), job => job.state === 'failed');
    expect((await (await get('account')).json()).balance).toEqual(before);
    expect((await pool.query('SELECT kind FROM credit_movements WHERE reference=$1 ORDER BY kind', [jobId])).rows)
      .toEqual([{ kind: 'release' }, { kind: 'reserve' }]);
    expect((await get('jobs/' + jobId + '/download')).status).toBe(404);
    expect((await post('jobs/' + jobId + '/project')).status).toBe(404);
    await new CommercialJobs(pool, new Map(), uploads).purgeExpiredInputs();
    await expect(stat(store.path(id))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 15000);
  it('rejects an abort queued behind complete without deleting the newly ready video', async () => {
    const begin = await post('uploads', { name: 'synthetic.mp4', size: video.length, requestKey: randomUUID() });
    expect(begin.status).toBe(201);
    const { id } = await begin.json();
    expect((await put(id, 0, video)).status).toBe(200);
    let completing = false;
    let releaseComplete!: () => void;
    const completeGate = new Promise<void>(resolve => { releaseComplete = resolve; });
    const validate = store.validateMp4.bind(store);
    const barrier = vi.spyOn(store, 'validateMp4').mockImplementationOnce(async (...args) => {
      await validate(...args);
      completing = true;
      await completeGate;
    });
    let abortSettled = false;
    const complete = post('uploads/' + id + '/complete');
    let abort: Promise<Response> | undefined;
    try {
      await until(async () => completing, Boolean);
      abort = post('uploads/' + id + '/abort').then(response => { abortSettled = true; return response; });
      await until(async () => (await admin.query(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%private_uploads%FOR UPDATE%'`, [schema])).rows[0].count,
      count => count > 0);
      expect(abortSettled).toBe(false);
    } finally {
      releaseComplete();
      barrier.mockRestore();
    }
    expect((await complete).status).toBe(200);
    expect((await abort!).status).toBe(409);
    expect((await post('uploads/' + id + '/abort')).status).toBe(409);
    expect((await stat(store.path(id))).size).toBe(video.length);
    expect((await uploads.get(accounts[0], id)).id).toBe(id);
    const jobId = await enqueue(id);
    release!();
    await until(async () => (await get('jobs/' + jobId)).json(), job => job.state === 'succeeded');
    const source = await get('jobs/' + jobId + '/source');
    expect(source.status).toBe(200);
    expect(Buffer.from(await source.arrayBuffer())).toEqual(video);
    expect((await post('jobs/' + jobId + '/delete-files')).status).toBe(200);
    await expect(stat(store.path(id))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 15000);
});
