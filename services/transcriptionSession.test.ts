import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadedVideoSource } from '../types';
import {
  TranscriptionSession,
  transcribeRangeWithSource,
} from './transcriptionSession';
import {
  deleteVideoSource,
  transcribeSectionWithSource,
  uploadVideoSource,
} from './geminiClient';

vi.mock('./geminiClient', () => ({
  deleteVideoSource: vi.fn().mockResolvedValue(undefined),
  uploadVideoSource: vi.fn(),
  transcribeSectionWithSource: vi.fn(),
}));

const source: UploadedVideoSource = {
  backend: 'proxy',
  name: 'files/test-video',
  uri: 'https://generativelanguage.googleapis.com/v1beta/files/test-video',
  mimeType: 'video/mp4',
};

const file = new File([], 'test.mp4', { type: 'video/mp4' });

const mockedUpload = vi.mocked(uploadVideoSource);
const mockedTranscribe = vi.mocked(transcribeSectionWithSource);
const mockedDelete = vi.mocked(deleteVideoSource);

describe('TranscriptionSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes sections independently and preserves verified silence', async () => {
    mockedTranscribe.mockImplementation(async (_source, request) => {
      if (request.sectionIndex === 0) {
        return {
          hasSpeech: true,
          detectedLanguage: 'Spanish',
          subtitles: [
            {
              start: 1,
              end: 4,
              original: 'Hola',
              translated: 'Hello',
              speaker: 'Speaker 1',
            },
          ],
        };
      }
      return { hasSpeech: false, subtitles: [] };
    });

    const session = await TranscriptionSession.create({
      file,
      duration: 90,
      targetLanguage: 'English',
      sourceLanguage: 'Spanish',
      existingSource: source,
    });
    const result = await session.transcribePending();

    expect(result.subtitles).toHaveLength(1);
    expect(result.language).toBe('Spanish');
    expect(result.report.completedSections).toBe(1);
    expect(result.report.noSpeechSections).toBe(1);
    expect(result.report.failedSections).toBe(0);
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('records failures without bridging or inventing cues', async () => {
    mockedTranscribe.mockRejectedValue(new Error('PERMISSION_DENIED: no access'));

    const session = await TranscriptionSession.create({
      file,
      duration: 90,
      targetLanguage: 'English',
      sourceLanguage: 'Auto-detect',
      existingSource: source,
    });
    const result = await session.transcribePending();

    expect(result.subtitles).toHaveLength(0);
    expect(result.report.failedSections).toBe(2);
    expect(result.report.uncaptionedRanges).toEqual([{ start: 0, end: 90 }]);
  });

  it('deletes a newly uploaded source if session setup fails', async () => {
    mockedUpload.mockResolvedValue(source);

    await expect(
      TranscriptionSession.create({
        file,
        duration: 0,
        targetLanguage: 'English',
        sourceLanguage: 'Auto-detect',
      })
    ).rejects.toThrow(/duration/i);
    expect(mockedDelete).toHaveBeenCalledWith(source);
  });
});

describe('transcribeRangeWithSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no changes when Gemini verifies silence', async () => {
    mockedTranscribe.mockResolvedValue({ hasSpeech: false, subtitles: [] });

    const result = await transcribeRangeWithSource(source, {
      start: 5,
      end: 9,
      duration: 30,
      targetLanguage: 'English',
      sourceLanguage: 'Auto-detect',
    });

    expect(result).toEqual({ hasSpeech: false, cues: [] });
  });

  it('does not convert invalid model timings into cues', async () => {
    mockedTranscribe.mockResolvedValue({
      hasSpeech: true,
      subtitles: [
        {
          start: 20,
          end: 21,
          original: 'Outside',
          translated: 'Outside',
          speaker: 'Speaker',
        },
      ],
    });

    const promise = transcribeRangeWithSource(source, {
      start: 5,
      end: 9,
      duration: 30,
      targetLanguage: 'English',
      sourceLanguage: 'Auto-detect',
    });

    await expect(promise).rejects.toThrow(/unusable cues/i);
  }, 10_000);
});
