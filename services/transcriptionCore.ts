import { GoogleGenAI, Part, Type } from '@google/genai';
import { SectionModelResponse } from '../types';

export const DEFAULT_TRANSCRIPTION_MODEL = 'gemini-3.8-flash';

export interface SectionTranscriptionRequest {
  sectionIndex: number;
  totalSections: number;
  start: number;
  end: number;
  videoDuration: number;
  targetLanguage: string;
  sourceLanguage: string;
}

const formatPromptTime = (seconds: number): string => {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remaining = safeSeconds - minutes * 60;
  return `${minutes.toString().padStart(2, '0')}:${remaining.toFixed(2).padStart(5, '0')}`;
};

const buildSectionPrompt = (request: SectionTranscriptionRequest): string => {
  const sourceInstruction =
    request.sourceLanguage === 'Auto-detect'
      ? 'Detect the spoken language from the audio.'
      : `The spoken language is ${request.sourceLanguage}.`;

  return `You are a precise audio-visual transcription engine. Analyze ONLY the requested portion of this video.

REQUESTED WINDOW: ${formatPromptTime(request.start)} to ${formatPromptTime(request.end)} (${(request.end - request.start).toFixed(2)} seconds), within a ${formatPromptTime(request.videoDuration)} video.

${sourceInstruction}

RULES:
1. Transcribe every spoken utterance whose midpoint falls inside the requested window. Do not summarize, paraphrase, skip repeated words, or describe non-speech sounds.
2. Return absolute timestamps in seconds for the full video, not timestamps relative to this section.
3. Include a cue only when its midpoint is between ${request.start.toFixed(3)} and ${request.end.toFixed(3)} seconds. Keep cues short, normally 1 to 6 seconds, and never overlap them.
4. Translate the complete original utterance into ${request.targetLanguage}. Preserve meaning; do not omit details to make the translation shorter.
5. Set hasSpeech to false only if there is no human speech anywhere in the requested window. In that case return an empty subtitles array.
6. If you cannot verify a segment, leave it out rather than inventing text. Never fabricate dialogue.

This is section ${request.sectionIndex + 1} of ${request.totalSections}. Return JSON that matches the requested schema.`;
};

const stripJsonFence = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
};

export const describeGeminiError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown API error');
  if (/PERMISSION_DENIED|caller does not have permission/i.test(message)) {
    return 'The API key does not have permission to use this model. Select a key from a billing-enabled project.';
  }
  if (/no longer available|model.*not found|not found.*model|NOT_FOUND|404/i.test(message)) {
    return `The configured Gemini model is unavailable for this account. Set GEMINI_MODEL to gemini-3.8-flash and restart the server. Details: ${message}`;
  }
  if (/API key|entity was not found|UNAUTHENTICATED|401/i.test(message)) {
    return 'The Gemini API key is missing or invalid. Select or configure a valid key.';
  }
  if (/RESOURCE_EXHAUSTED|quota|429/i.test(message)) {
    return 'Gemini rate limit or quota exceeded. Wait a moment and retry the failed sections.';
  }
  if (/payload|too large|413/i.test(message)) {
    return 'The video is too large for the current upload method. Use the local backend with Files API support.';
  }
  return message;
};

export const isRetryableGeminiError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  const message = error instanceof Error ? error.message : String(error || '');
  if (/ABORT|CANCEL/i.test(message)) return false;
  if (/PERMISSION_DENIED|UNAUTHENTICATED|API key|invalid argument|400|401|403|404/i.test(message)) {
    return false;
  }
  return true;
};

export async function requestSectionTranscription(
  ai: GoogleGenAI,
  options: {
    model?: string;
    mediaPart: Part;
    request: SectionTranscriptionRequest;
    abortSignal?: AbortSignal;
  }
): Promise<SectionModelResponse> {
  const { mediaPart, request, abortSignal } = options;
  const response = await ai.models.generateContent({
    model: options.model || DEFAULT_TRANSCRIPTION_MODEL,
    contents: [
      {
        role: 'user',
        parts: [mediaPart, { text: buildSectionPrompt(request) }],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          hasSpeech: { type: Type.BOOLEAN },
          detectedLanguage: { type: Type.STRING },
          subtitles: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: { type: Type.NUMBER },
                end: { type: Type.NUMBER },
                original: { type: Type.STRING },
                translated: { type: Type.STRING },
                speaker: { type: Type.STRING },
              },
              required: ['start', 'end', 'original', 'translated', 'speaker'],
            },
          },
        },
        required: ['hasSpeech', 'detectedLanguage', 'subtitles'],
      },
      temperature: 0.1,
      maxOutputTokens: 8192,
      abortSignal,
    },
  });

  const finishReason = String(response.candidates?.[0]?.finishReason || '').toUpperCase();
  if (finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(finishReason)) {
    throw new Error(`The model stopped before completing the section (${finishReason}).`);
  }

  const text = response.text;
  if (!text || !text.trim()) {
    throw new Error('The model returned an empty transcription response.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error('The model returned malformed JSON for this section.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The model response was not a JSON object.');
  }

  const candidate = parsed as {
    hasSpeech?: unknown;
    detectedLanguage?: unknown;
    subtitles?: unknown;
  };

  if (typeof candidate.hasSpeech !== 'boolean') {
    throw new Error('The model response is missing the hasSpeech flag.');
  }
  if (!Array.isArray(candidate.subtitles)) {
    throw new Error('The model response is missing the subtitles array.');
  }
  if (candidate.hasSpeech && candidate.subtitles.length === 0) {
    throw new Error('The model reported speech but returned no subtitle cues.');
  }
  if (!candidate.hasSpeech && candidate.subtitles.length > 0) {
    throw new Error('The model returned cues while reporting no speech.');
  }

  return {
    hasSpeech: candidate.hasSpeech,
    detectedLanguage:
      typeof candidate.detectedLanguage === 'string' ? candidate.detectedLanguage : undefined,
    subtitles: candidate.subtitles as SectionModelResponse['subtitles'],
  };
}
