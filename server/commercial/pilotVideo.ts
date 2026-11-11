import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { GoogleGenAI, type GenerateContentResponseUsageMetadata } from '@google/genai';
import { additionalPilotMonolingualDirections, pilotLanguageDirections } from '../../config/pilotLanguageDirections';
import { DEFAULT_TRANSCRIPTION_MODEL, localizeEnglishFootMeasurements, requestSectionTranscription } from '../../services/transcriptionCore';
import { generateSRT } from '../../utils/helpers';
import { mergeSubtitleCues, normalizeSectionCues } from '../../utils/subtitles';
import type { FileInput, JobAdapter } from './jobs';
import { MAX_GEMINI_VIDEO_BYTES, withGeminiVideoFile, type GeminiUploadOptions } from './geminiFileUpload';
import {
  alignInteriorCueEdges, extendEarlyCueEnds, retryEarlyCueEnds, stabilizeEnglishFinalCue, verifyLateEnglishFinalCue,
  alignMonolingualSharedCuts, delayEnglishStartsAfterSilence, restoreEnglishStartsOverBackground, trimLateMonolingualEnds,
  type TimedWord, type TimingWindow,
} from './pilotCueTiming';
import { decodePilotAudio } from './pilotWordTiming';

export function isMp4(input: Buffer) {
  if (input.length <= 12 || input.toString('latin1', 4, 8) !== 'ftyp') return false;
  let media = false;
  for (let offset = 0; offset < input.length;) {
    const remaining = input.length - offset;
    if (remaining < 8) return false;
    const declared = input.readUInt32BE(offset);
    const header = declared === 1 ? 16 : 8;
    if (remaining < header) return false;
    const size = declared === 1 ? Number(input.readBigUInt64BE(offset + 8)) : declared || remaining;
    if (size < header || size > remaining) return false;
    if (size > header && input.toString('latin1', offset + 4, offset + 8) === 'mdat') media = true;
    offset += size;
  }
  return media;
}

function probeMp4(input: Buffer): Promise<{ duration: number; audioTracks: number }> {
  return new Promise((resolve, reject) => {
    const probe = spawn('ffprobe', [
      '-v', 'error', '-protocol_whitelist', 'pipe', '-f', 'mov', '-i', 'pipe:0',
      '-count_packets', '-show_entries', 'format=duration:stream=codec_type,width,height,duration', '-of', 'json',
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => probe.kill(), 5000);
    probe.stdin.on('error', () => undefined);
    probe.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 8192) probe.kill();
    });
    probe.on('error', () => reject(new Error('No se pudo ejecutar ffprobe.')));
    probe.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          const metadata = JSON.parse(output);
          const streams: { codec_type: string; width: number; height: number; duration?: string }[] = metadata.streams ?? [];
          const video = streams.find(stream => stream.codec_type === 'video');
          // On a pipe, fragmented MP4 can report only the first fragment as the format duration.
          const durations = [metadata.format?.duration, ...streams.map(stream => stream.duration)]
            .map(Number).filter(Number.isFinite);
          const duration = Math.max(...durations);
          if (Number.isFinite(duration) && duration > 0 && duration <= 30 && video &&
              video.width > 0 && video.height > 0 && Math.max(video.width, video.height) <= 1920) {
            const audioTracks = streams.filter(stream => stream.codec_type === 'audio').length;
            resolve({ duration, audioTracks });
            return;
          }
        } catch { /* Unreadable MP4 metadata. */ }
      }
      reject(new Error('Se requiere un MP4 válido de hasta 30 segundos y 1920 píxeles por lado.'));
    });
    probe.stdin.end(input);
  });
}

export async function probeDuration(input: Buffer): Promise<number> {
  return (await probeMp4(input)).duration;
}

export async function measureVideoSeconds(input: Buffer): Promise<number> {
  if (!isMp4(input)) throw new Error('Select an MP4 video.');
  return Math.ceil(await probeDuration(input));
}

type Direction = (typeof pilotLanguageDirections | typeof additionalPilotMonolingualDirections)[number];
type UsageObserver = (event: {
  model: string; seconds: number; direction: string; usage: GenerateContentResponseUsageMetadata;
  inputMode?: 'file'; timingMode?: 'gemini-only';
}) => void;
type WordTiming = {
  read(input: Buffer, language: string, signal?: AbortSignal, window?: TimingWindow): Promise<TimedWord[]>;
  onUnavailable?: () => void;
};

export function createPilotVideoAdapter(apiKey: string,
  directions: readonly Direction[] = pilotLanguageDirections.filter(direction => !direction.experimental),
  observeUsage?: UsageObserver, wordTiming?: WordTiming, chargeByDuration = false,
  fileUploadOptions?: Omit<GeminiUploadOptions, 'signal'>): JobAdapter {
  const ai = new GoogleGenAI({ apiKey });
  const byId = new Map<string, Direction>(directions.map(direction => [direction.id, direction]));
  function validateFile(input: FileInput, options: Record<string, unknown>) {
    if (!chargeByDuration) throw new Error('Large videos require duration-based pricing.');
    const { duration, width, height, audioTracks } = input.metadata;
    if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > MAX_GEMINI_VIDEO_BYTES ||
        !Number.isFinite(duration) || duration <= 0 || duration > 600 ||
        !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || Math.max(width, height) > 1920 ||
        !Number.isInteger(audioTracks) || audioTracks < 0 || !Number.isFinite(input.expiresAt.getTime()) || input.expiresAt.getTime() <= Date.now()) {
      throw new Error('Select a valid stored MP4 of up to 600 seconds and 1920 pixels per side.');
    }
    if (typeof options.direction !== 'string' || !byId.has(options.direction)) throw new Error('Unsupported language pair.');
  }
  function artifacts(merged: ReturnType<typeof mergeSubtitleCues>, direction: Direction) {
    if (direction.id === 'en-es') {
      merged = merged.map(cue => ({
        ...cue, translatedText: localizeEnglishFootMeasurements(cue.originalText, cue.translatedText),
      }));
    }
    const original = generateSRT(merged.filter(cue => cue.originalText.trim())
      .map(cue => ({ ...cue, translatedText: cue.originalText })));
    return { result: Buffer.from(generateSRT(merged), 'utf8'), original: original ? Buffer.from(original, 'utf8') : undefined };
  }
  return {
    key: 'video-to-srt:pilot-v1',
    price: 1,
    ...(chargeByDuration ? { measurePrice: measureVideoSeconds } : {}),
    validateFile,
    async measureFilePrice(input) {
      if (!chargeByDuration) throw new Error('Large videos require duration-based pricing.');
      const duration = input.metadata.duration;
      if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error('Invalid video duration.');
      return Math.ceil(duration);
    },
    async executeFile(input, options, _jobId, signal) {
      validateFile(input, options);
      // Preserve the validated short-clip timing path. This read is strictly bounded to the old 1 MiB limit.
      if (input.size <= 1048576 && input.metadata.duration <= 30) {
        return this.execute(await readFile(input.path), options, _jobId, signal);
      }
      const direction = byId.get(options.direction as string)!;
      const duration = input.metadata.duration;
      const section = { index: 0, start: 0, end: duration };
      return withGeminiVideoFile(apiKey, input, async (media, uploadSignal) => {
        const result = await requestSectionTranscription(ai, {
          model: DEFAULT_TRANSCRIPTION_MODEL, mediaPart: { fileData: { fileUri: media.uri, mimeType: media.mimeType } },
          request: { ...section, sectionIndex: 0, totalSections: 1, videoDuration: duration,
            sourceLanguage: direction.sourceLanguage, targetLanguage: direction.targetLanguage,
            preciseSpeechTiming: 'preciseSpeechTiming' in direction && direction.preciseSpeechTiming,
            englishSpanishConstructionTerms: direction.id === 'en-es' },
          abortSignal: AbortSignal.any([AbortSignal.timeout(180_000), uploadSignal]),
          onUsage: observeUsage ? usage => observeUsage({ model: DEFAULT_TRANSCRIPTION_MODEL, seconds: duration, direction: direction.id, usage, inputMode: 'file', timingMode: 'gemini-only' }) : undefined,
        });
        if (result.subtitles.length > 12000 || result.subtitles.some(cue =>
          typeof cue.original !== 'string' || typeof cue.translated !== 'string' || cue.original.length > 10000 || cue.translated.length > 10000)) {
          throw new Error('The video returned excessive or invalid subtitle text.');
        }
        const { cues, rejected } = normalizeSectionCues(result.subtitles, section, duration);
        if (rejected.length || !cues.length) throw new Error('The clip did not return valid subtitles.');
        const output = artifacts(mergeSubtitleCues(cues, duration), direction);
        if (output.result.length > 1024 * 1024 || (output.original?.length ?? 0) > 1024 * 1024) throw new Error('Subtitle output exceeded the limit.');
        uploadSignal.throwIfAborted();
        // Explicit opt-out: large disk inputs never become a Buffer for local word alignment.
        return { ...output, timingMode: 'gemini-only' as const };
      }, { ...fileUploadOptions, signal });
    },
    validate(input, options) {
      if (!isMp4(input)) throw new Error('Select an MP4 video.');
      const { duration, direction } = options;
      if (!chargeByDuration && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 30)) {
        throw new Error('Select a clip of up to 30 seconds.');
      }
      if (typeof direction !== 'string' || !byId.has(direction)) throw new Error('Unsupported language pair.');
    },
    async execute(input, options, _jobId, signal) {
      const { duration, audioTracks } = await probeMp4(input);
      signal?.throwIfAborted();
      const direction = byId.get(options.direction as string);
      if (!direction) throw new Error('Unsupported language pair.');
      const section = { index: 0, start: 0, end: duration };
      const result = await requestSectionTranscription(ai, {
        model: DEFAULT_TRANSCRIPTION_MODEL,
        mediaPart: { inlineData: { mimeType: 'video/mp4', data: input.toString('base64') } },
        request: {
          ...section, sectionIndex: 0, totalSections: 1, videoDuration: duration,
          sourceLanguage: direction.sourceLanguage,
          targetLanguage: direction.targetLanguage,
          preciseSpeechTiming: 'preciseSpeechTiming' in direction && direction.preciseSpeechTiming,
          englishSpanishConstructionTerms: direction.id === 'en-es',
        },
        abortSignal: AbortSignal.any([AbortSignal.timeout(90_000), ...(signal ? [signal] : [])]),
        onUsage: observeUsage ? usage => observeUsage({
          model: DEFAULT_TRANSCRIPTION_MODEL, seconds: duration, direction: direction.id, usage,
        }) : undefined,
      });
      const { cues, rejected } = normalizeSectionCues(result.subtitles, section, duration);
      if (rejected.length || !cues.length) throw new Error('The clip did not return valid subtitles.');
      let merged = mergeSubtitleCues(cues, duration);
      // The local reference uses the first audio track. Only apply it when the track is unambiguous.
      if (wordTiming && audioTracks === 1 && direction.id !== 'ar-es') {
        try {
          const timingDeadline = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
          const reference = await wordTiming.read(input, direction.sourceLanguage, timingDeadline);
          const readWindow = (window: TimingWindow) => wordTiming.read(input, direction.sourceLanguage, timingDeadline, window);
          merged = extendEarlyCueEnds(merged, reference, duration);
          merged = await retryEarlyCueEnds(merged, reference, duration, readWindow, signal);
          if (reference.length && (direction.id === 'vi-vi' || direction.id === 'ar-ar')) {
            const pcm = await decodePilotAudio(input, timingDeadline);
            if (direction.id === 'ar-ar') merged = alignMonolingualSharedCuts(merged, reference, pcm, duration);
            merged = trimLateMonolingualEnds(merged, reference, pcm, duration);
          }
          const beforeInteriorAlignment = merged;
          if (direction.id === 'en-es' || direction.id === 'es-en') {
            merged = alignInteriorCueEdges(merged, reference, duration, direction.id === 'es-en');
          }
          if (direction.id === 'en-es') {
            merged = stabilizeEnglishFinalCue(merged, reference, duration);
            merged = await verifyLateEnglishFinalCue(merged, reference, duration, readWindow, signal);
            if (reference.length) {
              const pcm = await decodePilotAudio(input, timingDeadline);
              merged = restoreEnglishStartsOverBackground(merged, beforeInteriorAlignment, reference, pcm, duration);
              merged = delayEnglishStartsAfterSilence(merged, reference, pcm, duration);
            }
          }
        } catch {
          signal?.throwIfAborted();
          wordTiming.onUnavailable?.();
        }
      }
      signal?.throwIfAborted();
      return artifacts(merged, direction);
    },
  };
}
