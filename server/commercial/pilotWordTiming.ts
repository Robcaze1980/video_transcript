import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TimedWord, TimingWindow } from './pilotCueTiming';

const sourceCodes: Readonly<Record<string, string>> = { English: 'en', Spanish: 'es', Vietnamese: 'vi', Arabic: 'ar' };
const worker = fileURLToPath(new URL('./pilotWordTiming.py', import.meta.url));
const childEnvironment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(path|systemroot|windir|temp|tmp|tmpdir|userprofile|home)$/i.test(key))),
  HF_HUB_OFFLINE: '1',
  HF_HUB_DISABLE_TELEMETRY: '1',
};

function run(command: string, args: string[], input: Buffer | undefined, limit: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: childEnvironment, signal, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    child.stdin.on('error', () => undefined);
    child.on('error', error => { failure ??= error; });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        failure ??= new Error('Word timing output exceeded its limit.');
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.on('close', code => {
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error('Word timing process failed.'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}

export async function decodePilotAudio(input: Buffer, signal: AbortSignal) {
  const decode = async (source: string, stdin?: Buffer) => {
    const pcm = await run('ffmpeg', [
      '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', stdin ? 'pipe' : 'file,pipe',
      '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-i', source,
      // Preserve any delay before the first audio packet and match the first audio track.
      '-map', '0:a:0', '-af', 'aresample=16000:async=1:first_pts=0', '-ac', '1', '-t', '30',
      '-f', 's16le', 'pipe:1',
    ], stdin, 960_000, signal);
    if (!pcm.length) throw new Error('No readable audio for local word timing.');
    return pcm;
  };

  try {
    return await decode('pipe:0', input);
  } catch (error) {
    signal.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
    // The pilot accepts up to 1 MiB. Retry with a seekable input for containers
    // whose media packets cannot be reached through a pipe.
    if (input.length > 1_048_576) throw error;
    const directory = await mkdtemp(join(tmpdir(), 'linguistvision-timing-'));
    try {
      const file = join(directory, 'source.mp4');
      await writeFile(file, input, { flag: 'wx', mode: 0o600, signal });
      return await decode(file);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }
}

function cleanLeadingOnset(pcm: Buffer) {
  // Only refine a word at the start of clean audio. A quiet room is not
  // digital silence, and a short click is not a sustained onset.
  const blockBytes = 320; // 10 ms at 16 kHz, signed 16-bit mono.
  const blockCount = Math.min(160, Math.floor(pcm.length / blockBytes));
  const peaks: number[] = [];
  for (let block = 0; block < blockCount; block++) {
    let peak = 0;
    for (let offset = block * blockBytes; offset < (block + 1) * blockBytes; offset += 2) {
      peak = Math.max(peak, Math.abs(pcm.readInt16LE(offset)));
    }
    peaks.push(peak);
  }
  const firstAudible = peaks.findIndex(peak => peak > 60);
  if (firstAudible < 25) return;
  const onset = peaks.findIndex((peak, block) => block >= firstAudible && peak > 260 &&
    peaks.slice(block, block + 4).filter(value => value > 260).length >= 3);
  if (onset >= 0 && onset - firstAudible <= 3) return onset / 100;
}

export function createLocalWordTiming(python: string, modelDirectory: string) {
  return async (input: Buffer, language: string, signal?: AbortSignal, window?: TimingWindow): Promise<TimedWord[]> => {
    const code = sourceCodes[language];
    if (!code) return [];
    const deadline = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    const pcm = await decodePilotAudio(input, deadline);
    const range = window ? window.map(String) : [];
    const output = await run(python, ['-I', worker, modelDirectory, code, ...range], pcm, 128_000, deadline);
    const parsed: unknown = JSON.parse(output.toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length > 2_000 || !parsed.every(word =>
      word && typeof word.start === 'number' && typeof word.end === 'number' && typeof word.text === 'string')) {
      throw new Error('Invalid word timing response.');
    }
    const words = parsed as TimedWord[];
    const first = words[0];
    if (!window && first && first.start <= 0.1) {
      const onset = cleanLeadingOnset(pcm);
      if (onset !== undefined && onset < first.end) {
        first.start = onset;
        first.leadingOnset = true;
      }
    }
    return words;
  };
}
