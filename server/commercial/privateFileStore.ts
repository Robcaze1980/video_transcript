import { constants, type ReadStream } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Private local artifacts. The caller authorizes ownership and expiration before opening an artifact. */
export class PrivateFileStore {
  private initialization?: Promise<void>;
  readonly root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) throw new Error('Private storage requires an absolute directory.');
    this.root = resolve(root);
    const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
    const fromSource = relative(sourceRoot, this.root);
    if (!fromSource || (!fromSource.startsWith('..' + sep) && fromSource !== '..' && !isAbsolute(fromSource))) {
      throw new Error('Private storage must be outside the repository.');
    }
  }

  private initialize() {
    this.initialization ??= (async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const info = await lstat(this.root);
      const canonical = await realpath(this.root);
      const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
      if (!info.isDirectory() || info.isSymbolicLink() || normalize(canonical) !== normalize(this.root)) {
        throw new Error('Private storage must be a direct directory.');
      }
    })();
    return this.initialization;
  }

  path(id: string) {
    if (!uuid.test(id)) throw new Error('Invalid private artifact key.');
    return join(this.root, id.toLowerCase() + '.mp4');
  }

  private async existing(id: string, writable = false): Promise<FileHandle> {
    await this.initialize();
    const path = this.path(id);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid private artifact.');
    const flags = (writable ? constants.O_RDWR : constants.O_RDONLY) | (constants.O_NOFOLLOW ?? 0);
    const handle = await open(path, flags);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) {
      await handle.close();
      throw new Error('Private artifact changed while opening.');
    }
    return handle;
  }

  /** The upload row must be locked while calling this method. Sync bytes before committing offset. */
  async append(id: string, persistedOffset: number, requestedOffset: number, chunk: Buffer) {
    if (![persistedOffset, requestedOffset].every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error('Invalid private artifact offset.');
    }
    await this.initialize();
    let file: FileHandle;
    try { file = await this.existing(id, true); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || persistedOffset !== 0) throw error;
      file = await open(this.path(id), 'wx+', 0o600);
    }
    try {
      const { size } = await file.stat();
      if (size < persistedOffset) throw new Error('Private artifact is incomplete on disk.');
      // An interrupted transaction can leave durable bytes past the last committed offset.
      if (size > persistedOffset) await file.truncate(persistedOffset);
      if (requestedOffset < persistedOffset) {
        if (requestedOffset + chunk.length > persistedOffset) return false;
        const existing = Buffer.alloc(chunk.length);
        const { bytesRead } = await file.read(existing, 0, existing.length, requestedOffset);
        return bytesRead === chunk.length && existing.equals(chunk);
      }
      if (requestedOffset !== persistedOffset) return false;
      let written = 0;
      while (written < chunk.length) {
        const { bytesWritten } = await file.write(chunk, written, chunk.length - written, persistedOffset + written);
        if (!bytesWritten) throw new Error('Private artifact write did not progress.');
        written += bytesWritten;
      }
      await file.sync();
      return true;
    } finally { await file.close(); }
  }

  async size(id: string) {
    const file = await this.existing(id);
    try { return (await file.stat()).size; }
    finally { await file.close(); }
  }

  async open(id: string, range?: { start: number; end?: number }): Promise<ReadStream> {
    const file = await this.existing(id);
    return file.createReadStream({ ...range, autoClose: true });
  }

  /** Scan atom boundaries with bounded reads, including the end of a large or fragmented MP4. */
  async validateMp4(id: string, expectedSize: number) {
    const file = await this.existing(id);
    try {
      if ((await file.stat()).size !== expectedSize) throw new Error('The uploaded file is incomplete.');
      let offset = 0;
      let media = false;
      let movie = false;
      let atoms = 0;
      const header = Buffer.alloc(16);
      while (offset < expectedSize) {
        if (++atoms > 100_000 || expectedSize - offset < 8) throw new Error('Invalid MP4 structure.');
        const { bytesRead } = await file.read(header, 0, Math.min(16, expectedSize - offset), offset);
        const declared = header.readUInt32BE(0);
        const type = header.toString('latin1', 4, 8);
        const headerSize = declared === 1 ? 16 : 8;
        if (bytesRead < headerSize || (offset === 0 && type !== 'ftyp')) throw new Error('Invalid MP4 structure.');
        const length = declared === 1 ? Number(header.readBigUInt64BE(8)) : declared || expectedSize - offset;
        if (!Number.isSafeInteger(length) || length < headerSize || length > expectedSize - offset) {
          throw new Error('Invalid MP4 structure.');
        }
        if (type === 'mdat' && length > headerSize) media = true;
        if (type === 'moov') movie = true;
        offset += length;
      }
      if (!media || !movie) throw new Error('The upload must contain MP4 media and metadata.');
    } finally { await file.close(); }
  }

  async remove(id: string) {
    await this.initialize();
    try { await unlink(this.path(id)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
