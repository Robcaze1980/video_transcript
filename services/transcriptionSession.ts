import {
  ProcessingProgress,
  TranscriptSection,
  TranscriptionResult,
  UploadedVideoSource,
} from '../types';
import {
  buildTranscriptionReport,
  mergeSubtitleCues,
  normalizeSectionCues,
  planTranscriptionSections,
} from '../utils/subtitles';
import {
  describeGeminiError,
  isRetryableGeminiError,
} from './transcriptionCore';
import {
  deleteVideoSource,
  transcribeSectionWithSource,
  uploadVideoSource,
} from './geminiClient';

const MAX_SECTION_ATTEMPTS = 3;
const SECTION_CONCURRENCY = 2;

interface ProgressOptions {
  onProgress?: (progress: ProcessingProgress) => void;
  signal?: AbortSignal;
}

interface SessionCreateOptions extends ProgressOptions {
  file: File;
  duration: number;
  targetLanguage: string;
  sourceLanguage: string;
  existingSource?: UploadedVideoSource | null;
  onUploadProgress?: (fraction: number) => void;
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError');
};

const delay = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Operation cancelled.', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Operation cancelled.', 'AbortError'));
      },
      { once: true }
    );
  });

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

export class TranscriptionSession {
  private detectedLanguage = 'Unknown';

  private constructor(
    readonly source: UploadedVideoSource,
    readonly duration: number,
    readonly targetLanguage: string,
    readonly sourceLanguage: string,
    private readonly sections: TranscriptSection[]
  ) {}

  static async create(options: SessionCreateOptions): Promise<TranscriptionSession> {
    let source = options.existingSource || null;
    let createdSource: UploadedVideoSource | null = null;

    try {
      if (!source) {
        source = await uploadVideoSource(options.file, {
          signal: options.signal,
          onProgress: options.onUploadProgress,
        });
        createdSource = source;
      }
      throwIfAborted(options.signal);
      const sections = planTranscriptionSections(options.duration);
      return new TranscriptionSession(
        source,
        options.duration,
        options.targetLanguage,
        options.sourceLanguage,
        sections
      );
    } catch (error) {
      if (createdSource) await deleteVideoSource(createdSource);
      throw error;
    }
  }

  getSections(): TranscriptSection[] {
    return this.sections.map((section) => ({ ...section, cues: [...section.cues] }));
  }

  async transcribePending(options: ProgressOptions = {}): Promise<TranscriptionResult> {
    const indices = this.sections
      .filter((section) => section.status === 'pending')
      .map((section) => section.index);
    return this.processIndices(indices, options);
  }

  async retryFailed(options: ProgressOptions = {}): Promise<TranscriptionResult> {
    const failed = this.sections.filter((section) => section.status === 'error');
    failed.forEach((section) => {
      section.status = 'pending';
      section.error = undefined;
      section.cues = [];
    });
    return this.processIndices(
      failed.map((section) => section.index),
      options
    );
  }

  private async processIndices(
    indices: number[],
    options: ProgressOptions
  ): Promise<TranscriptionResult> {
    const queue = [...new Set(indices)];
    if (queue.length > 0) await this.runQueue(queue, options);

    const subtitles = mergeSubtitleCues(
      this.sections.flatMap((section) => section.cues),
      this.duration
    );
    return {
      subtitles,
      language: this.detectedLanguage,
      report: buildTranscriptionReport(this.sections, subtitles, this.duration),
    };
  }

  private async runQueue(indices: number[], options: ProgressOptions): Promise<void> {
    let cursor = 0;
    let completed = 0;
    let abortError: unknown = null;
    const total = indices.length;

    const report = (retryingSection: number | undefined, message: string): void => {
      options.onProgress?.({
        phase: 'transcribe',
        percent: total === 0 ? 100 : Math.round((completed / total) * 100),
        completedSections: completed,
        totalSections: total,
        retryingSection,
        message,
      });
    };

    report(undefined, `Transcribing ${total} section${total === 1 ? '' : 's'}...`);

    const worker = async (): Promise<void> => {
      while (!abortError) {
        const queuePosition = cursor;
        cursor += 1;
        if (queuePosition >= indices.length) return;
        const sectionIndex = indices[queuePosition];
        const section = this.sections[sectionIndex];

        try {
          await this.transcribeOneSection(section, options.signal, (attempt) => {
            report(
              section.index,
              `Section ${section.index + 1}/${this.sections.length}: attempt ${attempt}...`
            );
          });
        } catch (error) {
          if (isAbortError(error) || options.signal?.aborted) {
            section.status = 'pending';
            abortError = error;
            return;
          }
          section.status = 'error';
          section.error = describeGeminiError(error);
        } finally {
          completed += 1;
          report(
            section.status === 'processing' ? section.index : undefined,
            `Processed ${completed}/${total} requested section${total === 1 ? '' : 's'}.`
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(SECTION_CONCURRENCY, total) }, () => worker())
    );
    if (abortError) throw abortError;
  }

  private async transcribeOneSection(
    section: TranscriptSection,
    signal: AbortSignal | undefined,
    onAttempt: (attempt: number) => void
  ): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_SECTION_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal);
      section.status = 'processing';
      section.attempts += 1;
      onAttempt(attempt);

      try {
        const response = await transcribeSectionWithSource(
          this.source,
          {
            sectionIndex: section.index,
            totalSections: this.sections.length,
            start: section.start,
            end: section.end,
            videoDuration: this.duration,
            targetLanguage: this.targetLanguage,
            sourceLanguage: this.sourceLanguage,
          },
          signal
        );

        const normalized = normalizeSectionCues(
          response.subtitles,
          section,
          this.duration
        );

        if (!response.hasSpeech) {
          section.status = 'no_speech';
          section.cues = [];
          section.error = undefined;
          return;
        }

        if (normalized.cues.length === 0) {
          const detail = normalized.rejected[0] || 'No valid cues were returned.';
          throw new Error(`The model returned unusable cues. ${detail}`);
        }

        section.cues = normalized.cues;
        section.status = 'success';
        section.error = undefined;
        if (response.detectedLanguage) this.detectedLanguage = response.detectedLanguage;
        return;
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw error;
        lastError = error;
        section.error = describeGeminiError(error);

        if (attempt >= MAX_SECTION_ATTEMPTS || !isRetryableGeminiError(error)) break;
        await delay(Math.min(4000, 700 * 2 ** (attempt - 1)), signal);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('The transcription section failed.');
  }
}

export async function transcribeRangeWithSource(
  source: UploadedVideoSource,
  options: {
    start: number;
    end: number;
    duration: number;
    targetLanguage: string;
    sourceLanguage: string;
    signal?: AbortSignal;
  }
): Promise<{ hasSpeech: boolean; cues: ReturnType<typeof normalizeSectionCues>['cues'] }> {
  const section = {
    index: 0,
    start: options.start,
    end: options.end,
    ownershipStart: options.start,
    ownershipEnd: options.end,
    status: 'pending' as const,
    attempts: 0,
    cues: [],
  };

  for (let attempt = 1; attempt <= MAX_SECTION_ATTEMPTS; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      const response = await transcribeSectionWithSource(
        source,
        {
          sectionIndex: 0,
          totalSections: 1,
          start: options.start,
          end: options.end,
          videoDuration: options.duration,
          targetLanguage: options.targetLanguage,
          sourceLanguage: options.sourceLanguage,
        },
        options.signal
      );
      const normalized = normalizeSectionCues(response.subtitles, section, options.duration);
      if (response.hasSpeech && normalized.cues.length === 0) {
        throw new Error(
          `The model returned unusable cues. ${
            normalized.rejected[0] || 'No valid cues were returned.'
          }`
        );
      }
      return { hasSpeech: response.hasSpeech, cues: normalized.cues };
    } catch (error) {
      if (
        isAbortError(error) ||
        options.signal?.aborted ||
        attempt >= MAX_SECTION_ATTEMPTS ||
        !isRetryableGeminiError(error)
      ) {
        throw error;
      }
      await delay(Math.min(4000, 700 * 2 ** (attempt - 1)), options.signal);
    }
  }

  throw new Error('The gap transcription failed.');
}
