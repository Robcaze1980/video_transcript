import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CommercialJobs } from './jobs';
import { PrivateFileStore } from './privateFileStore';
import { ResumableUploads } from './resumableUploads';

const connectionString = process.env.LINGUISTVISION_TEST_DATABASE_URL;
const schema = 'lv_delete_qa_' + randomUUID().replaceAll('-', '');
const atom = (name: string, payload = Buffer.alloc(0)) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(name, 4, 'ascii');
  return Buffer.concat([header, payload]);
};
const video = Buffer.concat([atom('ftyp', Buffer.from('isom0000')), atom('moov'), atom('mdat', Buffer.from('synthetic'))]);

describe.skipIf(!connectionString)('private file deletion after the job transaction commits', () => {
  let admin: Pool;
  let pool: Pool;
  let root: string;
  let store: PrivateFileStore;
  let uploads: ResumableUploads;
  let jobs: CommercialJobs;

  beforeAll(async () => {
    const database = new URL(connectionString!);
    if (database.hostname !== '127.0.0.1' || !database.port || database.port === '5432') {
      throw new Error('A dedicated local PostgreSQL instance is required.');
    }
    admin = new Pool({ connectionString });
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new Pool({ connectionString, options: '-c search_path=' + schema, max: 1, connectionTimeoutMillis: 1000 });
    for (const script of ['schema.sql', 'privateUploads.sql', 'privateInputMigration.sql']) {
      await pool.query(await readFile(new URL('./' + script, import.meta.url), 'utf8'));
    }
    root = await mkdtemp(join(tmpdir(), 'linguistvision-private-deletion-'));
    store = new PrivateFileStore(root);
    uploads = new ResumableUploads(pool, store, { probe: async () => ({ duration: 2, width: 640, height: 360, audioTracks: 1 }) });
    jobs = new CommercialJobs(pool, new Map(), uploads);
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
      await admin.end();
    }
    if (root) {
      if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('linguistvision-private-deletion-')) {
        throw new Error('Unexpected test cleanup directory.');
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  async function project() {
    const owner = await jobs.createAccount();
    const upload = await uploads.begin(owner, video.length, 'synthetic.mp4', randomUUID());
    await uploads.append(owner, upload.id, 0, video);
    const asset = await uploads.complete(owner, upload.id);
    await jobs.addFileInput(owner, upload.id);
    const id = await jobs.createSubtitleProject(owner, upload.id, 'Synthetic project', 2,
      '1\n00:00:00,000 --> 00:00:01,000\nSynthetic subtitle\n');
    return { owner, id, asset };
  }

  it('rolls back a tombstone if a later input update fails, leaving the source and project usable', async () => {
    const { owner, id, asset } = await project();
    await pool.query(`CREATE FUNCTION refuse_input_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected input update failure'; END $$`);
    await pool.query(`CREATE TRIGGER reject_input_delete BEFORE UPDATE ON inputs FOR EACH ROW
      WHEN (OLD.private_upload_id IS NOT NULL AND NEW.private_upload_id IS NULL)
      EXECUTE FUNCTION refuse_input_delete()`);
    try {
      await expect(jobs.deleteSubtitleProject(owner, id)).rejects.toThrow('Injected input update failure');
      expect((await pool.query('SELECT state FROM private_uploads WHERE id=$1', [id])).rows[0].state).toBe('ready');
      expect((await stat(asset.path)).size).toBe(video.length);
      expect(await jobs.subtitleProject(owner, id)).toBeDefined();
      expect(await jobs.fileInput(owner, id)).toMatchObject({ id, size: video.length });
    } finally {
      await pool.query('DROP TRIGGER reject_input_delete ON inputs');
      await pool.query('DROP FUNCTION refuse_input_delete()');
    }
    expect(await jobs.deleteSubtitleProject(owner, id)).toBe(true);
    await expect(stat(asset.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await pool.query('SELECT state FROM private_uploads WHERE id=$1', [id])).rows[0].state).toBe('deleted');
    expect(pool.totalCount).toBe(1);
    expect(pool.waitingCount).toBe(0);
  });

  it('commits inaccessible metadata before unlink, retains a durable tombstone on disk failure and retries cleanup', async () => {
    const { owner, id, asset } = await project();
    const fail = vi.spyOn(store, 'remove').mockRejectedValueOnce(new Error('Injected disk deletion failure'));
    try {
      await expect(jobs.deleteSubtitleProject(owner, id)).rejects.toThrow('Private file cleanup is pending and will retry.');
      expect(await jobs.subtitleProject(owner, id)).toBeUndefined();
      await expect(uploads.get(owner, id)).rejects.toMatchObject({ code: 'not_found' });
      expect((await pool.query('SELECT state FROM private_uploads WHERE id=$1', [id])).rows[0].state).toBe('deleting');
      expect((await stat(asset.path)).size).toBe(video.length);
      expect((await pool.query('SELECT private_upload_id FROM inputs WHERE id=$1', [id])).rows[0].private_upload_id).toBeNull();
    } finally { fail.mockRestore(); }
    expect((await uploads.purgeExpired()).deleted).toBe(1);
    await expect(stat(asset.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await pool.query('SELECT state FROM private_uploads WHERE id=$1', [id])).rows[0].state).toBe('deleted');
    expect(pool.waitingCount).toBe(0);
  });
});
