import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
let operationQueue: Promise<unknown> = Promise.resolve();
const progressListeners = new Set<(progress: number) => void>();

const getFFmpeg = async (): Promise<FFmpeg> => {
  if (ffmpeg) return ffmpeg;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const instance = new FFmpeg();
    instance.on('progress', ({ progress }) => {
      const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
      progressListeners.forEach((listener) => listener(safeProgress));
    });

    try {
      await instance.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm',
      });
      ffmpeg = instance;
      return instance;
    } catch (error) {
      ffmpeg = null;
      loadPromise = null;
      throw error;
    }
  })();

  return loadPromise;
};

const executeConversion = async (
  webmBlob: Blob,
  onProgress: (progress: number) => void
): Promise<Blob> => {
  const instance = await getFFmpeg();
  const suffix = Math.random().toString(36).slice(2, 9);
  const inputName = `input-${suffix}.webm`;
  const outputName = `output-${suffix}.mp4`;
  progressListeners.add(onProgress);

  try {
    await instance.writeFile(inputName, await fetchFile(webmBlob));
    await instance.exec([
      '-i',
      inputName,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      outputName,
    ]);

    const data = await instance.readFile(outputName);
    return new Blob([data as Uint8Array], { type: 'video/mp4' });
  } finally {
    progressListeners.delete(onProgress);
    await instance.deleteFile(inputName).catch(() => undefined);
    await instance.deleteFile(outputName).catch(() => undefined);
  }
};

export const convertWebmToMp4 = (
  webmBlob: Blob,
  onProgress: (progress: number) => void
): Promise<Blob> => {
  // FFmpeg.wasm cannot execute two operations on the same instance concurrently.
  const operation = operationQueue.then(() => executeConversion(webmBlob, onProgress));
  operationQueue = operation.catch(() => undefined);
  return operation;
};
