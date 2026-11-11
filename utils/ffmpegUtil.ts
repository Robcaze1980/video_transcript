import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import type { Subtitle, SubtitleStyle } from '../types';
import { drawSubtitlesToCanvas } from './helpers';
import { findActiveSubtitle } from './subtitles';

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
        coreURL: new URL(coreURL, window.location.href).href,
        wasmURL: new URL(wasmURL, window.location.href).href,
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
    const exitCode = await instance.exec([
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
      '-movflags',
      '+faststart',
      outputName,
    ]);
    if (exitCode !== 0) throw new Error('FFmpeg could not convert the video to MP4.');

    const data = await instance.readFile(outputName);
    return new Blob([data as Uint8Array], { type: 'video/mp4' });
  } finally {
    progressListeners.delete(onProgress);
    await instance.deleteFile(inputName).catch(() => undefined);
    await instance.deleteFile(outputName).catch(() => undefined);
  }
};

function queueOperation(operation: () => Promise<Blob>): Promise<Blob> {
  // FFmpeg.wasm cannot execute two operations on the same instance concurrently.
  const result = operationQueue.then(operation);
  operationQueue = result.catch(() => undefined);
  return result;
}

export const convertWebmToMp4 = (webmBlob: Blob, onProgress: (progress: number) => void) =>
  queueOperation(() => executeConversion(webmBlob, onProgress));

interface TimedSubtitleExport {
  source: Blob;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  duration: number;
  subtitles: Subtitle[];
  style: SubtitleStyle;
  onProgress: (progress: number) => void;
  signal?: AbortSignal;
  continuousMode?: boolean;
}

export function renderTimedSubtitlesMp4(options: TimedSubtitleExport): Promise<Blob> {
  return queueOperation(async () => {
    const { source, width, height, duration, subtitles, style, onProgress, signal, continuousMode } = options;
    signal?.throwIfAborted();
    if (!Number.isFinite(duration) || duration <= 0 || !width || !height) throw new Error('Missing source video metadata.');
    // El canvas del llamador puede tener ya un contexto opaco: la grabación en
    // tiempo real lo abre con `alpha: false`. Un overlay PNG opaco taparía el
    // vídeo con un fondo negro, así que aquí se pinta siempre en un canvas
    // propio con transparencia.
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    const context = overlayCanvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('The export canvas is unavailable.');

    const instance = await getFFmpeg();
    signal?.throwIfAborted();
    const abort = () => {
      instance.terminate();
      ffmpeg = null;
      loadPromise = null;
    };
    const directory = 'subtitle-' + crypto.randomUUID();
    const files: string[] = [];
    const write = async (name: string, bytes: Uint8Array) => {
      const path = directory + '/' + name;
      files.push(path);
      await instance.writeFile(path, bytes);
    };
    signal?.addEventListener('abort', abort, { once: true });
    progressListeners.add(onProgress);
    try {
      await instance.createDir(directory);
      await write('source.mp4', await fetchFile(source));
      const pngs = new Map<string, string>();
      const overlay = async (text: string, highlights?: Subtitle['highlights']) => {
        signal?.throwIfAborted();
        const key = JSON.stringify([text, highlights]);
        const existing = pngs.get(key);
        if (existing) return existing;
        context.clearRect(0, 0, width, height);
        if (text) drawSubtitlesToCanvas(context, text, style, width, height, highlights);
        const png = await new Promise<Blob>((resolve, reject) =>
          overlayCanvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not render the subtitle overlay.')), 'image/png'));
        const name = 'overlay-' + pngs.size + '.png';
        await write(name, await fetchFile(png));
        pngs.set(key, name);
        return name;
      };
      const points = [...new Set([0, duration, ...subtitles.flatMap(cue => [cue.start, cue.end])
        .filter(time => time > 0 && time < duration)])].sort((left, right) => left - right);
      const timeline = ['ffconcat version 1.0'];
      for (let index = 1; index < points.length; index++) {
        const start = points[index - 1];
        const end = points[index];
        const cue = findActiveSubtitle(subtitles, (start + end) / 2, continuousMode === true);
        timeline.push('file ' + await overlay(cue?.translatedText.trim() ?? '', cue?.highlights),
          'option framerate 1000', 'duration ' + (end - start).toFixed(6));
      }
      // A final frame carries the end timestamp so the last segment has its full duration.
      timeline.push('file ' + await overlay(''), 'option framerate 1000');
      await write('overlay.ffconcat', new TextEncoder().encode(timeline.join('\n') + '\n'));
      const output = directory + '/output.mp4';
      files.push(output);
      const exitCode = await instance.exec([
        '-i', directory + '/source.mp4',
        '-f', 'concat', '-safe', '0', '-i', directory + '/overlay.ffconcat',
        '-filter_complex', '[0:v]fps=30[base];[base][1:v]overlay=eof_action=pass:repeatlast=0,pad=ceil(iw/2)*2:ceil(ih/2)*2[video]',
        '-map', '[video]', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-t', duration.toFixed(6), '-movflags', '+faststart', output,
      ]);
      if (exitCode !== 0) throw new Error('FFmpeg could not export the subtitled video.');
      const data = await instance.readFile(output);
      signal?.throwIfAborted();
      return new Blob([data as Uint8Array], { type: 'video/mp4' });
    } finally {
      progressListeners.delete(onProgress);
      signal?.removeEventListener('abort', abort);
      if (!signal?.aborted) {
        await Promise.all(files.map(file => instance.deleteFile(file).catch(() => undefined)));
        await instance.deleteDir(directory).catch(() => undefined);
      }
    }
  });
}
