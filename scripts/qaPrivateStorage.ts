import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { PrivateFileStore } from '../server/commercial/privateFileStore';
import { ResumableUploads, privateUploadChunkBytes } from '../server/commercial/resumableUploads';

const connectionString = process.env.LINGUISTVISION_TEST_DATABASE_URL;
if (!connectionString || new URL(connectionString).hostname !== '127.0.0.1' || new URL(connectionString).port !== '15438') {
  throw new Error('Use the dedicated local test database on port 15438.');
}
const evidenceRoot = resolve(process.env.LOCALAPPDATA!, 'LinguistVision/validation/large-files-20261111');
await mkdir(evidenceRoot, { recursive: true });
const out = await mkdtemp(join(evidenceRoot, 'run-'));
const schema = 'lv_large_qa_' + randomUUID().replaceAll('-', '');
const admin = new Pool({ connectionString });
const pool = new Pool({ connectionString, options: '-c search_path=' + schema });
const store = new PrivateFileStore(join(out, 'private'));
const uploads = new ResumableUploads(pool, store);
const sourcePaths: string[] = [];
const results: object[] = [];
let account: string | undefined;

async function generate(path: string, seconds: number) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=2:d=' + seconds,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=' + seconds,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '24k',
      '-t', String(seconds), '-movflags', '+faststart', '-y', path,
    ], { windowsHide: true, stdio: 'ignore' });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Synthetic media generation timed out.')); }, 120_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('Synthetic media generation failed.')); });
  });
}

async function hash(path: string) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

try {
  await admin.query('CREATE SCHEMA ' + schema);
  await pool.query('CREATE TABLE accounts(id uuid PRIMARY KEY)');
  await pool.query(await readFile(resolve('server/commercial/privateUploads.sql'), 'utf8'));
  account = randomUUID();
  await pool.query('INSERT INTO accounts(id) VALUES($1)', [account]);
  for (const { seconds, bytes } of [{ seconds: 60, bytes: 100_000_000 }, { seconds: 300, bytes: 250_000_000 }, { seconds: 600, bytes: 500_000_000 }]) {
    const source = join(out, 'synthetic-' + seconds + '.mp4');
    sourcePaths.push(source);
    const generationStarted = performance.now();
    await generate(source, seconds);
    const encodedBytes = (await stat(source)).size;
    const padding = bytes - encodedBytes;
    assert.ok(padding >= 8);
    const file = await open(source, 'r+');
    try {
      const header = Buffer.alloc(8);
      header.writeUInt32BE(padding);
      header.write('free', 4, 'ascii');
      await file.write(header, 0, 8, encodedBytes);
      await file.truncate(bytes);
      await file.sync();
    } finally { await file.close(); }
    const generationMs = performance.now() - generationStarted;
    const rssBefore = process.memoryUsage().rss;
    let rssPeak = rssBefore;
    const sampler = setInterval(() => { rssPeak = Math.max(rssPeak, process.memoryUsage().rss); }, 5);
    const upload = await uploads.begin(account, bytes, 'synthetic-' + seconds + '.mp4', randomUUID());
    const started = performance.now();
    let offset = 0;
    let chunks = 0;
    const input = await open(source, 'r');
    try {
      const chunk = Buffer.alloc(privateUploadChunkBytes);
      while (offset < bytes) {
        const { bytesRead } = await input.read(chunk, 0, Math.min(chunk.length, bytes - offset), offset);
        assert.ok(bytesRead > 0);
        const next = await uploads.append(account, upload.id, offset, chunk.subarray(0, bytesRead));
        assert.equal(next.offset, offset + bytesRead);
        offset = next.offset;
        chunks++;
      }
    } finally { await input.close(); }
    const uploadMs = performance.now() - started;
    const probeStart = performance.now();
    const asset = await uploads.complete(account, upload.id);
    const probeMs = performance.now() - probeStart;
    clearInterval(sampler);
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    assert.equal(asset.size, bytes);
    assert.ok(Math.abs(asset.metadata.duration - seconds) < 0.1);
    assert.equal(asset.metadata.width, 640);
    assert.equal(asset.metadata.height, 360);
    assert.equal(asset.metadata.audioTracks, 1);
    assert.equal(await hash(source), await hash(asset.path));
    const range = await store.open(asset.id, { start: 4, end: 7 });
    const small: Buffer[] = [];
    for await (const chunk of range) small.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(small).toString('ascii'), 'ftyp');
    await assert.rejects(uploads.get(randomUUID(), asset.id), { code: 'not_found' });
    await pool.query("UPDATE private_uploads SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [asset.id]);
    await assert.rejects(uploads.get(account, asset.id), { code: 'not_found' });
    const deletionStart = performance.now();
    assert.equal((await uploads.purgeExpired()).deleted, 1);
    await assert.rejects(stat(asset.path), { code: 'ENOENT' });
    const deletionMs = performance.now() - deletionStart;
    await unlink(source);
    const result = { bytes, seconds, encodedBytes, paddingBytes: padding, paddingPurpose: 'MP4 free atom exercises byte volume without representative video bitrate',
      metadata: asset.metadata, chunkBytes: privateUploadChunkBytes, chunks,
      generationMs: Math.round(generationMs), uploadMs: Math.round(uploadMs), probeMs: Math.round(probeMs), deletionMs: Math.round(deletionMs),
      nodeRssBeforeBytes: rssBefore, nodeRssPeakBytes: rssPeak, nodeRssIncreaseBytes: rssPeak - rssBefore,
      streamedHashesEqual: true, rangeVerified: true, crossAccountRejected: true, expiredRejected: true, bytesDeleted: true };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(join(out, 'evidence.json'), JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version,
    scope: 'Dedicated PostgreSQL and local private disk. Sources contain synthetic video/audio and MP4 padding. No cloud or Gemini calls.', results }, null, 2) + '\n');
  console.log(JSON.stringify({ evidence: join(out, 'evidence.json') }));
} finally {
  if (account) {
    const pending = await pool.query<{ id: string }>("SELECT id FROM private_uploads WHERE state<>'deleted'").catch(() => ({ rows: [] }));
    for (const upload of pending.rows) await uploads.abort(account, upload.id).catch(() => undefined);
  }
  for (const source of sourcePaths) await unlink(source).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  await pool.end();
  await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
  await admin.end();
}
