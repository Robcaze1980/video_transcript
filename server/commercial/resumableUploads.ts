import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PrivateFileStore } from './privateFileStore';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const privateUploadChunkBytes = 8 * 1024 * 1024;

export interface PrivateVideoMetadata {
  duration: number;
  width: number;
  height: number;
  audioTracks: number;
}

export class UploadError extends Error {
  readonly status: number;
  constructor(readonly code: 'invalid_input' | 'not_found' | 'conflict' | 'expired' | 'quota', message: string) {
    super(message);
    this.status = { invalid_input: 422, not_found: 404, conflict: 409, expired: 410, quota: 429 }[code];
  }
}

interface UploadRow {
  id: string;
  account_id: string;
  name: string;
  size: string;
  offset_bytes: string;
  state: 'uploading' | 'ready' | 'deleting' | 'deleted';
  expires_at: Date;
  metadata: PrivateVideoMetadata | null;
  expired: boolean;
}

export interface PrivateUploadStatus {
  id: string;
  name: string;
  size: number;
  offset: number;
  state: UploadRow['state'];
  expiresAt: Date;
  metadata?: PrivateVideoMetadata;
}

export interface PrivateUploadOptions {
  maxFileBytes?: number;
  quotaBytes?: number;
  maxActiveUploads?: number;
  ttlMs?: number;
  maxDuration?: number;
  maxDimension?: number;
  probe?: (path: string) => Promise<PrivateVideoMetadata>;
}

/** Read the completed file on disk. MOV external data references and network protocols are disabled. */
export function probePrivateVideo(path: string): Promise<PrivateVideoMetadata> {
  return new Promise((resolve, reject) => {
    const probe = spawn('ffprobe', [
      '-v', 'error', '-protocol_whitelist', 'file,pipe', '-enable_drefs', '0', '-use_absolute_path', '0',
      '-f', 'mov', '-i', path, '-count_packets',
      '-show_entries', 'format=duration:stream=codec_type,width,height,duration,nb_read_packets', '-of', 'json',
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    let interrupted = false;
    const stop = () => { interrupted = true; probe.kill(); };
    const timer = setTimeout(stop, 120_000);
    probe.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); if (output.length > 65_536) stop(); });
    probe.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString('utf8'); if (errorOutput.length > 8192) stop(); });
    probe.once('error', () => { clearTimeout(timer); reject(new UploadError('invalid_input', 'The video reader is unavailable.')); });
    probe.once('close', code => {
      clearTimeout(timer);
      if (code === 0 && !interrupted && !errorOutput.trim()) {
        try {
          const metadata = JSON.parse(output);
          const streams: { codec_type?: string; width?: number; height?: number; duration?: string; nb_read_packets?: string }[] = metadata.streams ?? [];
          const video = streams.find(stream => stream.codec_type === 'video');
          const durations = [metadata.format?.duration, ...streams.map(stream => stream.duration)]
            .map(Number).filter(Number.isFinite);
          const duration = Math.max(...durations);
          if (video && Number(video.nb_read_packets) > 0 && duration > 0 && Number.isFinite(duration) &&
              Number.isSafeInteger(video.width) && Number.isSafeInteger(video.height) && video.width! > 0 && video.height! > 0) {
            resolve({ duration, width: video.width!, height: video.height!, audioTracks: streams.filter(stream => stream.codec_type === 'audio').length });
            return;
          }
        } catch { /* An incomplete or malformed file is rejected below. */ }
      }
      reject(new UploadError('invalid_input', 'The upload must be a readable MP4 video.'));
    });
  });
}

export class ResumableUploads {
  readonly limits: Readonly<Required<PrivateUploadOptions> & { chunkBytes: number }>;

  constructor(private readonly pool: Pool, readonly store: PrivateFileStore, options: PrivateUploadOptions = {}) {
    this.limits = Object.freeze({ maxFileBytes: 500_000_000, quotaBytes: 2 * 1024 * 1024 * 1024,
      maxActiveUploads: 3, ttlMs: 24 * 60 * 60 * 1000, maxDuration: 600, maxDimension: 1920,
      probe: probePrivateVideo, ...options, chunkBytes: privateUploadChunkBytes });
    for (const key of ['maxFileBytes', 'quotaBytes', 'maxActiveUploads', 'ttlMs', 'maxDuration', 'maxDimension'] as const) {
      if (!Number.isSafeInteger(this.limits[key]) || this.limits[key] <= 0) throw new Error('Invalid private upload limits.');
    }
  }

  private snapshot(row: UploadRow): PrivateUploadStatus {
    return { id: row.id, name: row.name, size: Number(row.size), offset: Number(row.offset_bytes),
      state: row.state, expiresAt: row.expires_at, ...(row.metadata ? { metadata: row.metadata } : {}) };
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async row(client: PoolClient, account: string, id: string) {
    if (!uuid.test(account) || !uuid.test(id)) throw new UploadError('not_found', 'Upload not found.');
    const { rows: [row] } = await client.query<UploadRow>(
      'SELECT *,expires_at<=clock_timestamp() AS expired FROM private_uploads WHERE account_id=$1 AND id=$2 FOR UPDATE', [account, id]);
    if (!row) throw new UploadError('not_found', 'Upload not found.');
    return row;
  }

  private available(row: UploadRow) {
    if (row.expired) throw new UploadError('expired', 'The upload has expired.');
    if (row.state === 'deleted' || row.state === 'deleting') throw new UploadError('not_found', 'Upload not found.');
  }

  async begin(account: string, size: number, name: string, requestKey: string) {
    if (!uuid.test(account) || !Number.isSafeInteger(size) || size < 1 || size > this.limits.maxFileBytes ||
        typeof name !== 'string' || !name.trim() || name.length > 255 || /[\x00-\x1f\x7f]/.test(name) ||
        typeof requestKey !== 'string' || !requestKey || requestKey.length > 200) {
      throw new UploadError('invalid_input', 'Invalid upload request.');
    }
    return this.transaction(async client => {
      const locked = await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [account]);
      if (!locked.rowCount) throw new UploadError('not_found', 'Account not found.');
      const { rows: [existing] } = await client.query<UploadRow>(
        'SELECT *,expires_at<=clock_timestamp() AS expired FROM private_uploads WHERE account_id=$1 AND request_key=$2', [account, requestKey]);
      if (existing) {
        if (Number(existing.size) !== size || existing.name !== name) throw new UploadError('conflict', 'The request key already has different upload details.');
        this.available(existing);
        return this.snapshot(existing);
      }
      const { rows: [usage] } = await client.query<{ bytes: string; active: string }>(
        `SELECT COALESCE(sum(size),0) AS bytes,count(*) FILTER (WHERE state='uploading') AS active
         FROM private_uploads WHERE account_id=$1 AND state<>'deleted'`, [account]);
      if (Number(usage.bytes) + size > this.limits.quotaBytes || Number(usage.active) >= this.limits.maxActiveUploads) {
        throw new UploadError('quota', 'The account upload limit has been reached.');
      }
      const { rows: [row] } = await client.query<UploadRow>(
        `INSERT INTO private_uploads(id,account_id,size,name,request_key,expires_at)
         VALUES ($1,$2,$3,$4,$5,clock_timestamp()+($6*interval '1 millisecond')) RETURNING *`,
        [randomUUID(), account, size, name, requestKey, this.limits.ttlMs]);
      return this.snapshot(row);
    });
  }

  async status(account: string, id: string) {
    return this.transaction(async client => {
      const row = await this.row(client, account, id);
      this.available(row);
      return this.snapshot(row);
    });
  }

  async append(account: string, id: string, offset: number, chunk: Buffer) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Buffer.isBuffer(chunk) || !chunk.length || chunk.length > privateUploadChunkBytes) {
      throw new UploadError('invalid_input', 'Invalid upload chunk.');
    }
    return this.transaction(async client => {
      const row = await this.row(client, account, id);
      this.available(row);
      if (row.state !== 'uploading' || offset + chunk.length > Number(row.size)) throw new UploadError('conflict', 'The upload offset does not match.');
      if (!await this.store.append(row.id, Number(row.offset_bytes), offset, chunk)) throw new UploadError('conflict', 'The upload offset does not match.');
      const next = Math.max(Number(row.offset_bytes), offset + chunk.length);
      const { rows: [updated] } = await client.query<UploadRow>('UPDATE private_uploads SET offset_bytes=$2 WHERE id=$1 RETURNING *', [id, next]);
      return this.snapshot(updated);
    });
  }

  async complete(account: string, id: string) {
    return this.transaction(async client => {
      const row = await this.row(client, account, id);
      this.available(row);
      if (row.state === 'ready') return this.asset(row);
      if (Number(row.offset_bytes) !== Number(row.size)) throw new UploadError('conflict', 'The upload is incomplete.');
      try { await this.store.validateMp4(row.id, Number(row.size)); }
      catch { throw new UploadError('invalid_input', 'The upload must be a complete MP4 file.'); }
      const metadata = await this.limits.probe(this.store.path(row.id));
      if (!Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.duration > this.limits.maxDuration ||
          ![metadata.width, metadata.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= this.limits.maxDimension) ||
          !Number.isSafeInteger(metadata.audioTracks) || metadata.audioTracks < 0) {
        throw new UploadError('invalid_input', 'The video exceeds the duration or dimensions allowed for this pilot.');
      }
      const { rows: [updated] } = await client.query<UploadRow>(
        `UPDATE private_uploads SET state='ready',metadata=$2::jsonb WHERE id=$1 AND expires_at>clock_timestamp() RETURNING *`,
        [id, JSON.stringify(metadata)]);
      if (!updated) throw new UploadError('expired', 'The upload has expired.');
      return this.asset(updated);
    });
  }

  private asset(row: UploadRow) {
    return { id: row.id, path: this.store.path(row.id), size: Number(row.size), name: row.name,
      expiresAt: row.expires_at, metadata: row.metadata! };
  }

  async get(account: string, id: string) {
    return this.transaction(client => this.getWithClient(client, account, id));
  }

  /** Use the caller's transaction when a job already holds a database connection. */
  async getWithClient(client: PoolClient, account: string, id: string) {
    const row = await this.row(client, account, id);
    if (row.expired) throw new UploadError('not_found', 'Upload not found.');
    this.available(row);
    if (row.state !== 'ready') throw new UploadError('conflict', 'The upload is incomplete.');
    if (await this.store.size(id) !== Number(row.size)) throw new UploadError('invalid_input', 'The private artifact is unavailable.');
    return this.asset(row);
  }

  /** The job transaction fences active work. A failed deletion must roll back that transaction. */
  async abortWithClient(client: PoolClient, account: string, id: string) {
    const row = await this.row(client, account, id);
    if (row.state === 'deleted') return false;
    await client.query("UPDATE private_uploads SET state='deleting' WHERE id=$1", [id]);
    await this.store.remove(id);
    await client.query("UPDATE private_uploads SET state='deleted',metadata=NULL WHERE id=$1", [id]);
    return true;
  }

  async abort(account: string, id: string) {
    await this.transaction(async client => {
      const row = await this.row(client, account, id);
      if (row.state !== 'deleted') await client.query("UPDATE private_uploads SET state='deleting' WHERE id=$1", [id]);
    });
    return this.deleteBytes(account, id);
  }

  /** Public cancellation may remove incomplete uploads only. Check and delete under the same lock. */
  async abortIncomplete(account: string, id: string) {
    return this.transaction(async client => {
      const row = await this.row(client, account, id);
      if (row.state === 'deleted') return false;
      if (row.state !== 'uploading') throw new UploadError('conflict', 'The video is already saved. Delete it from its project or job.');
      return this.abortWithClient(client, account, id);
    });
  }

  private async deleteBytes(account: string, id: string) {
    return this.transaction(async client => {
      const row = await this.row(client, account, id);
      if (row.state === 'deleted') return false;
      if (row.state !== 'deleting') throw new UploadError('conflict', 'The upload is still in use.');
      await this.store.remove(id);
      await client.query("UPDATE private_uploads SET state='deleted',metadata=NULL WHERE id=$1", [id]);
      return true;
    });
  }

  async purgeExpired(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid purge batch size.');
    const { rows } = await this.pool.query<{ id: string; account_id: string }>(
      `SELECT id,account_id FROM private_uploads WHERE state='deleting' OR (state<>'deleted' AND expires_at<=clock_timestamp())
       ORDER BY expires_at,id LIMIT $1`, [limit]);
    let deleted = 0;
    let failed = 0;
    const { rows: [links] } = await this.pool.query<{ enabled: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('inputs')
       AND attname='private_upload_id' AND NOT attisdropped) AS enabled`);
    for (const row of rows) {
      try {
        const remove = await this.transaction(async client => {
          const current = await this.row(client, row.account_id, row.id);
          if (current.state === 'deleted' || (!current.expired && current.state !== 'deleting')) return false;
          // Linked artifacts belong to the jobs lifecycle, which fences active workers before deletion.
          if (links.enabled && current.state === 'ready') {
            const linked = await client.query('SELECT 1 FROM inputs WHERE private_upload_id=$1 LIMIT 1', [row.id]);
            if (linked.rowCount) return false;
          }
          await client.query("UPDATE private_uploads SET state='deleting' WHERE id=$1", [row.id]);
          return true;
        });
        if (remove && await this.deleteBytes(row.account_id, row.id)) deleted++;
      }
      catch { failed++; }
    }
    return { deleted, failed };
  }
}
