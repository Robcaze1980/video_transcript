import { randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrivateFileStore } from './privateFileStore';
import { ResumableUploads, privateUploadChunkBytes, probePrivateVideo, type PrivateVideoMetadata } from './resumableUploads';

const connectionString = process.env.LINGUISTVISION_TEST_DATABASE_URL;
const schema = 'lv_upload_' + randomUUID().replaceAll('-', '');
const atom = (name: string, data = Buffer.alloc(0)) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length + 8);
  header.write(name, 4, 'latin1');
  return Buffer.concat([header, data]);
};
const video = Buffer.concat([atom('ftyp', Buffer.from('isom0000')), atom('moov'), atom('mdat', Buffer.from('synthetic'))]);
const metadata: PrivateVideoMetadata = { duration: 2, width: 1280, height: 720, audioTracks: 1 };

describe.skipIf(!connectionString)('private resumable uploads with PostgreSQL and disk', () => {
  let admin: Pool;
  let pool: Pool;
  let root: string;
  let store: PrivateFileStore;
  let uploads: ResumableUploads;

  beforeAll(async () => {
    const database = new URL(connectionString!);
    if (database.hostname !== '127.0.0.1' || !database.port || database.port === '5432') {
      throw new Error('The upload tests require a dedicated loopback PostgreSQL port.');
    }
    admin = new Pool({ connectionString });
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new Pool({ connectionString, options: '-c search_path=' + schema });
    await pool.query('CREATE TABLE accounts(id uuid PRIMARY KEY)');
    const migration = await readFile(new URL('./privateUploads.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    await pool.query(migration);
    root = await mkdtemp(join(tmpdir(), 'linguistvision-private-upload-'));
    store = new PrivateFileStore(root);
    uploads = new ResumableUploads(pool, store, { probe: async () => metadata });
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
      await admin.end();
    }
    if (root) {
      if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('linguistvision-private-upload-')) {
        throw new Error('The test cleanup target is outside its temporary directory.');
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  async function account() {
    const id = randomUUID();
    await pool.query('INSERT INTO accounts(id) VALUES($1)', [id]);
    return id;
  }

  async function ready(owner: string, name = 'test.mp4') {
    const upload = await uploads.begin(owner, video.length, name, randomUUID());
    await uploads.append(owner, upload.id, 0, video);
    return uploads.complete(owner, upload.id);
  }

  it('resumes chunks with a fixed deadline, validates once and streams the same ready asset', async () => {
    const owner = await account();
    const start = await uploads.begin(owner, video.length, '../display-name.mp4', 'retry-key');
    const deadline = start.expiresAt.toISOString();
    const first = await uploads.append(owner, start.id, 0, video.subarray(0, 16));
    expect(first.offset).toBe(16);
    expect(first.expiresAt.toISOString()).toBe(deadline);
    const retried = await uploads.append(owner, start.id, 0, video.subarray(0, 16));
    expect(retried.offset).toBe(16);
    await uploads.append(owner, start.id, 16, video.subarray(16));
    const asset = await uploads.complete(owner, start.id);
    expect(asset).toMatchObject({ id: start.id, size: video.length, metadata });
    expect(asset.path).toBe(join(root, start.id + '.mp4'));
    expect(asset.expiresAt.toISOString()).toBe(deadline);
    expect(await uploads.complete(owner, start.id)).toEqual(asset);
    expect(await uploads.get(owner, start.id)).toEqual(asset);
    const stream = await store.open(asset.id);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(video);
    expect(await uploads.begin(owner, video.length, '../display-name.mp4', 'retry-key')).toMatchObject({ id: asset.id, state: 'ready' });
  });

  it('deduplicates concurrent begin calls and rejects a request key with different details', async () => {
    const owner = await account();
    const starts = await Promise.all([uploads.begin(owner, 42, 'a.mp4', 'one'), uploads.begin(owner, 42, 'a.mp4', 'one')]);
    expect(starts[0].id).toBe(starts[1].id);
    await expect(uploads.begin(owner, 43, 'a.mp4', 'one')).rejects.toMatchObject({ code: 'conflict' });
    expect((await pool.query('SELECT count(*) AS count FROM private_uploads WHERE account_id=$1', [owner])).rows[0].count).toBe('1');
  });

  it('rejects cross-account status, append, complete, get and abort without deleting the artifact', async () => {
    const owner = await account();
    const other = await account();
    const asset = await ready(owner);
    for (const operation of [
      () => uploads.status(other, asset.id), () => uploads.append(other, asset.id, 0, video),
      () => uploads.complete(other, asset.id), () => uploads.get(other, asset.id), () => uploads.abort(other, asset.id),
    ]) await expect(operation()).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect((await stat(asset.path)).size).toBe(video.length);
  });

  it('serializes concurrent chunks and rejects conflicting, forward and overlapping offsets', async () => {
    const owner = await account();
    const upload = await uploads.begin(owner, 20, 'a.mp4', randomUUID());
    const responses = await Promise.allSettled([
      uploads.append(owner, upload.id, 0, Buffer.from('aaaa')),
      uploads.append(owner, upload.id, 0, Buffer.from('bbbb')),
    ]);
    expect(responses.filter(response => response.status === 'fulfilled')).toHaveLength(1);
    expect((await uploads.status(owner, upload.id)).offset).toBe(4);
    await expect(uploads.append(owner, upload.id, 8, Buffer.from('x'))).rejects.toMatchObject({ code: 'conflict' });
    await expect(uploads.append(owner, upload.id, 2, Buffer.from('xxxxx'))).rejects.toMatchObject({ code: 'conflict' });
    await expect(uploads.append(owner, upload.id, 4, Buffer.alloc(privateUploadChunkBytes + 1))).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('truncates bytes left by an interrupted transaction before resuming from committed offset', async () => {
    const owner = await account();
    const upload = await uploads.begin(owner, video.length, 'a.mp4', randomUUID());
    await uploads.append(owner, upload.id, 0, video.subarray(0, 16));
    await appendFile(store.path(upload.id), Buffer.from('uncommitted disk bytes'));
    await uploads.append(owner, upload.id, 16, video.subarray(16));
    expect(await readFile(store.path(upload.id))).toEqual(video);
    expect((await uploads.complete(owner, upload.id)).metadata.duration).toBe(2);
  });

  it('reserves the account quota and three active slots at begin without allocating large files', async () => {
    const owner = await account();
    const starts = await Promise.allSettled(Array.from({ length: 4 }, () => uploads.begin(owner, 500_000_000, 'a.mp4', randomUUID())));
    expect(starts.filter(result => result.status === 'fulfilled')).toHaveLength(3);
    expect(starts.filter(result => result.status === 'rejected')).toHaveLength(1);
    const wide = new ResumableUploads(pool, store, { maxActiveUploads: 10 });
    await wide.begin(owner, 500_000_000, 'a.mp4', randomUUID());
    await expect(wide.begin(owner, 500_000_000, 'a.mp4', randomUUID())).rejects.toMatchObject({ code: 'quota' });
    await expect(uploads.begin(owner, 500_000_001, 'a.mp4', randomUUID())).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('keeps ready assets in the quota until bytes are deleted and supports repeated abort', async () => {
    const owner = await account();
    const small = new ResumableUploads(pool, store, { quotaBytes: video.length, probe: async () => metadata });
    const asset = await ready(owner);
    await expect(small.begin(owner, 1, 'b.mp4', randomUUID())).rejects.toMatchObject({ code: 'quota' });
    await expect(uploads.abort(owner, asset.id)).resolves.toBe(true);
    await expect(uploads.abort(owner, asset.id)).resolves.toBe(false);
    await expect(stat(asset.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(small.begin(owner, 1, 'b.mp4', randomUUID())).resolves.toMatchObject({ state: 'uploading' });
    await expect(uploads.get(owner, asset.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('blocks expired artifacts and retries failed unlink while retaining quota', async () => {
    const owner = await account();
    const asset = await ready(owner);
    await pool.query("UPDATE private_uploads SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [asset.id]);
    await expect(uploads.get(owner, asset.id)).rejects.toMatchObject({ code: 'not_found' });
    const failure = vi.spyOn(store, 'remove').mockRejectedValueOnce(new Error('temporary disk lock'));
    const first = await uploads.purgeExpired();
    expect(first.failed).toBe(1);
    expect((await pool.query('SELECT state FROM private_uploads WHERE id=$1', [asset.id])).rows[0].state).toBe('deleting');
    expect((await stat(asset.path)).size).toBe(video.length);
    failure.mockRestore();
    expect((await uploads.purgeExpired()).deleted).toBeGreaterThanOrEqual(1);
    await expect(stat(asset.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(uploads.begin(owner, video.length, 'test.mp4', 'new-key')).resolves.toMatchObject({ state: 'uploading' });
  });

  it('rejects malformed and truncated MP4 atoms and over-duration or over-dimension metadata', async () => {
    const owner = await account();
    const broken = Buffer.from(video);
    broken.writeUInt32BE(1000, 24);
    const start = await uploads.begin(owner, broken.length, 'broken.mp4', randomUUID());
    await uploads.append(owner, start.id, 0, broken);
    await expect(uploads.complete(owner, start.id)).rejects.toMatchObject({ code: 'invalid_input' });
    await uploads.abort(owner, start.id);
    for (const rejected of [{ ...metadata, duration: 600.01 }, { ...metadata, width: 1921 }]) {
      const restricted = new ResumableUploads(pool, store, { probe: async () => rejected });
      const upload = await restricted.begin(owner, video.length, 'a.mp4', randomUUID());
      await restricted.append(owner, upload.id, 0, video);
      await expect(restricted.complete(owner, upload.id)).rejects.toMatchObject({ code: 'invalid_input' });
      await restricted.abort(owner, upload.id);
    }
  });

  it('uses ffprobe on a real local MP4 and rejects fake media without logging its content', async () => {
    const actual = await probePrivateVideo(resolve('server/pilot-site/assets/jobsite.mp4'));
    expect(actual.duration).toBeGreaterThan(0);
    expect(actual.width).toBeLessThanOrEqual(1920);
    const owner = await account();
    const upload = await uploads.begin(owner, video.length, 'fake.mp4', randomUUID());
    await uploads.append(owner, upload.id, 0, video);
    await expect(probePrivateVideo(store.path(upload.id))).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('retains an expired ready asset linked to an input until the jobs lifecycle releases it', async () => {
    await pool.query('CREATE TABLE IF NOT EXISTS inputs(id uuid PRIMARY KEY,private_upload_id uuid)');
    const owner = await account();
    const asset = await ready(owner);
    await pool.query('INSERT INTO inputs(id,private_upload_id) VALUES($1,$1)', [asset.id]);
    await pool.query("UPDATE private_uploads SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [asset.id]);
    await uploads.purgeExpired();
    expect((await stat(asset.path)).size).toBe(video.length);
    expect((await pool.query('SELECT state FROM private_uploads WHERE id=$1', [asset.id])).rows[0].state).toBe('ready');
    await pool.query('UPDATE inputs SET private_upload_id=NULL WHERE id=$1', [asset.id]);
    expect((await uploads.purgeExpired()).deleted).toBeGreaterThanOrEqual(1);
    await expect(stat(asset.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts bounded stream ranges and rejects traversal keys before disk access', async () => {
    const owner = await account();
    const asset = await ready(owner);
    const stream = await store.open(asset.id, { start: 4, end: 7 });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString('latin1')).toBe('ftyp');
    expect(() => store.path('../outside')).toThrow('Invalid private artifact key.');
    expect(() => new PrivateFileStore('relative')).toThrow('absolute directory');
    expect(() => new PrivateFileStore(resolve('private-uploads'))).toThrow('outside the repository');
  });

  it('reads and deletes within the caller transaction when the pool has only one connection', async () => {
    const owner = await account();
    const asset = await ready(owner);
    const singlePool = new Pool({ connectionString, options: '-c search_path=' + schema, max: 1, connectionTimeoutMillis: 500 });
    const single = new ResumableUploads(singlePool, store);
    const client = await singlePool.connect();
    try {
      await client.query('BEGIN');
      expect(await single.getWithClient(client, owner, asset.id)).toEqual(asset);
      expect(singlePool.totalCount).toBe(1);
      expect(singlePool.waitingCount).toBe(0);
      expect(await single.abortWithClient(client, owner, asset.id)).toBe(true);
      expect(await single.abortWithClient(client, owner, asset.id)).toBe(false);
      await client.query('COMMIT');
      await expect(stat(asset.path)).rejects.toMatchObject({ code: 'ENOENT' });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); await singlePool.end(); }
  });

  it('allows the caller to roll back and retry a failed deletion with its existing connection', async () => {
    const owner = await account();
    const asset = await ready(owner);
    const client = await pool.connect();
    const failure = vi.spyOn(store, 'remove').mockRejectedValueOnce(new Error('temporary file lock'));
    try {
      await client.query('BEGIN');
      await expect(uploads.abortWithClient(client, owner, asset.id)).rejects.toThrow('temporary file lock');
      await client.query('ROLLBACK');
      expect((await uploads.status(owner, asset.id)).state).toBe('ready');
      expect((await stat(asset.path)).size).toBe(video.length);
      failure.mockRestore();
      await client.query('BEGIN');
      expect(await uploads.abortWithClient(client, owner, asset.id)).toBe(true);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { failure.mockRestore(); client.release(); }
    await expect(stat(asset.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
