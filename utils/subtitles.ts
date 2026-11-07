import {
  ModelCue,
  Subtitle,
  TimeRange,
  TranscriptSection,
  TranscriptionReport,
} from '../types';

const DEFAULT_SECTION_SECONDS = 45;
const DEFAULT_OVERLAP_SECONDS = 1.25;
const BOUNDARY_TOLERANCE_SECONDS = 0.9;
const CONTINUOUS_GAP_SECONDS = 3.5;

let fallbackIdCounter = 0;

const createCueId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  fallbackIdCounter += 1;
  return `${prefix}-${Date.now()}-${fallbackIdCounter}`;
};

const toFiniteNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundSeconds = (value: number): number => Number(value.toFixed(3));

export const normalizeCueText = (text: string): string =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');

export const planTranscriptionSections = (
  duration: number,
  sectionSeconds: number = DEFAULT_SECTION_SECONDS,
  overlapSeconds: number = DEFAULT_OVERLAP_SECONDS
): TranscriptSection[] => {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('The video duration is invalid or could not be read.');
  }
  if (sectionSeconds <= overlapSeconds * 2) {
    throw new Error('Transcription sections must be longer than their overlap.');
  }

  const sections: TranscriptSection[] = [];
  let start = 0;
  let index = 0;

  while (start < duration - 0.01) {
    let end = Math.min(duration, start + sectionSeconds);

    // Avoid a tiny final section by extending the previous one to the end.
    if (duration - end > 0 && duration - end < sectionSeconds * 0.35) {
      end = duration;
    }

    const isFirst = index === 0;
    const isLast = end >= duration - 0.001;
    sections.push({
      index,
      start: roundSeconds(start),
      end: roundSeconds(end),
      ownershipStart: roundSeconds(isFirst ? 0 : start + overlapSeconds / 2),
      ownershipEnd: roundSeconds(isLast ? duration : end - overlapSeconds / 2),
      status: 'pending',
      attempts: 0,
      cues: [],
    });

    if (isLast) break;
    start = Math.max(0, end - overlapSeconds);
    index += 1;
  }

  return sections;
};

export interface NormalizeSectionResult {
  cues: Subtitle[];
  rejected: string[];
}

export const normalizeSectionCues = (
  rawCues: unknown,
  section: Pick<TranscriptSection, 'index' | 'start' | 'end'>,
  videoDuration: number
): NormalizeSectionResult => {
  const candidates = Array.isArray(rawCues) ? rawCues : [];
  const cues: Subtitle[] = [];
  const rejected: string[] = [];

  candidates.forEach((candidate, cueIndex) => {
    if (!candidate || typeof candidate !== 'object') {
      rejected.push(`Cue ${cueIndex + 1}: expected an object.`);
      return;
    }

    const raw = candidate as ModelCue;
    const rawStart = toFiniteNumber(raw.start);
    const rawEnd = toFiniteNumber(raw.end);
    const originalText = typeof raw.original === 'string' ? raw.original.trim() : '';
    const translatedText = typeof raw.translated === 'string' ? raw.translated.trim() : '';

    if (rawStart === null || rawEnd === null) {
      rejected.push(`Cue ${cueIndex + 1}: timestamps are not finite numbers.`);
      return;
    }
    if (!originalText && !translatedText) {
      rejected.push(`Cue ${cueIndex + 1}: both transcript fields are empty.`);
      return;
    }
    if (rawEnd <= rawStart) {
      rejected.push(`Cue ${cueIndex + 1}: end time must be greater than start time.`);
      return;
    }
    if (
      rawStart < section.start - BOUNDARY_TOLERANCE_SECONDS ||
      rawStart > section.end + BOUNDARY_TOLERANCE_SECONDS ||
      rawEnd < section.start - BOUNDARY_TOLERANCE_SECONDS ||
      rawEnd > section.end + BOUNDARY_TOLERANCE_SECONDS
    ) {
      rejected.push(`Cue ${cueIndex + 1}: timestamps fall outside the requested section.`);
      return;
    }

    // Clamp only negligible timestamp drift around section boundaries.
    const start = Math.max(0, Math.min(section.end, rawStart));
    const end = Math.min(videoDuration, Math.max(0, rawEnd));
    if (end <= start) {
      rejected.push(`Cue ${cueIndex + 1}: no valid interval remains after clamping.`);
      return;
    }

    cues.push({
      id: createCueId(`section-${section.index}-${cueIndex}`),
      start: roundSeconds(start),
      end: roundSeconds(end),
      originalText,
      translatedText,
      speaker:
        typeof raw.speaker === 'string' && raw.speaker.trim()
          ? raw.speaker.trim()
          : 'Speaker',
    });
  });

  return {
    cues: mergeSubtitleCues(cues, videoDuration),
    rejected,
  };
};

export const mergeSubtitleCues = (
  cues: Subtitle[],
  videoDuration: number = Number.POSITIVE_INFINITY
): Subtitle[] => {
  const sorted = cues
    .filter(
      (cue) =>
        Number.isFinite(cue.start) &&
        Number.isFinite(cue.end) &&
        cue.start >= 0 &&
        cue.end > cue.start &&
        cue.start < videoDuration &&
        Boolean(cue.translatedText.trim() || cue.originalText.trim())
    )
    .map((cue) => ({
      ...cue,
      start: roundSeconds(cue.start),
      end: roundSeconds(Math.min(cue.end, videoDuration)),
      translatedText: cue.translatedText.trim(),
      originalText: cue.originalText.trim(),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Subtitle[] = [];

  for (const cue of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || cue.start >= previous.end - 0.05) {
      if (previous && cue.start < previous.end) cue.start = previous.end;
      if (cue.end > cue.start) merged.push({ ...cue });
      continue;
    }

    const sameText =
      normalizeCueText(cue.translatedText) === normalizeCueText(previous.translatedText) ||
      normalizeCueText(cue.originalText) === normalizeCueText(previous.originalText);

    if (sameText) {
      previous.start = Math.min(previous.start, cue.start);
      previous.end = Math.max(previous.end, cue.end);
      if (cue.translatedText.length > previous.translatedText.length) {
        previous.translatedText = cue.translatedText;
      }
      if (cue.originalText.length > previous.originalText.length) {
        previous.originalText = cue.originalText;
      }
      continue;
    }

    if (cue.start <= previous.start && cue.end <= previous.end) {
      // Fully contained in the previous cue. Keep the richer translation.
      if (cue.translatedText.length > previous.translatedText.length) {
        previous.translatedText = cue.translatedText;
      }
      continue;
    }

    if (cue.start > previous.start + 0.1) {
      previous.end = roundSeconds(cue.start);
      if (cue.end > cue.start) merged.push({ ...cue });
      continue;
    }

    // The new cue overlaps from the same start and extends farther.
    if (cue.end > previous.end) {
      previous.end = roundSeconds(cue.end);
      if (cue.translatedText.length > previous.translatedText.length) {
        previous.translatedText = cue.translatedText;
      }
      if (cue.originalText.length > previous.originalText.length) {
        previous.originalText = cue.originalText;
      }
    }
  }

  return merged.filter((cue) => cue.end > cue.start);
};

export const findActiveSubtitle = (
  subtitles: Subtitle[],
  time: number,
  continuous: boolean,
  maxContinuousGap: number = CONTINUOUS_GAP_SECONDS
): Subtitle | null => {
  if (subtitles.length === 0 || !Number.isFinite(time)) return null;

  let low = 0;
  let high = subtitles.length - 1;
  let candidateIndex = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (subtitles[middle].start <= time) {
      candidateIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (candidateIndex < 0) return null;

  const candidate = subtitles[candidateIndex];
  if (time >= candidate.start && time <= candidate.end) return candidate;
  if (!continuous) return null;

  const next = subtitles[candidateIndex + 1];
  const gapStart = candidate.end;
  const gapEnd = next ? next.start : gapStart + maxContinuousGap;
  const gapDuration = gapEnd - gapStart;

  if (
    time > gapStart &&
    time < gapEnd &&
    gapDuration > 0 &&
    gapDuration <= maxContinuousGap &&
    time - gapStart <= maxContinuousGap
  ) {
    return candidate;
  }

  return null;
};

export const findUncaptionedRanges = (
  subtitles: Subtitle[],
  duration: number,
  minimumGap: number = 1
): TimeRange[] => {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const sorted = [...subtitles].sort((a, b) => a.start - b.start);
  const ranges: TimeRange[] = [];
  let cursor = 0;

  for (const cue of sorted) {
    if (cue.start - cursor >= minimumGap) {
      ranges.push({ start: roundSeconds(cursor), end: roundSeconds(cue.start) });
    }
    cursor = Math.max(cursor, cue.end);
  }

  if (duration - cursor >= minimumGap) {
    ranges.push({ start: roundSeconds(cursor), end: roundSeconds(duration) });
  }

  return ranges;
};

export const buildTranscriptionReport = (
  sections: TranscriptSection[],
  subtitles: Subtitle[],
  duration: number
): TranscriptionReport => {
  const completedSections = sections.filter((section) => section.status === 'success').length;
  const noSpeechSections = sections.filter((section) => section.status === 'no_speech').length;
  const failedSections = sections.filter((section) => section.status === 'error').length;
  const pendingSections = sections.filter(
    (section) => section.status === 'pending' || section.status === 'processing'
  ).length;

  return {
    sections: sections.map((section) => ({ ...section, cues: [...section.cues] })),
    completedSections,
    noSpeechSections,
    failedSections,
    pendingSections,
    uncaptionedRanges: findUncaptionedRanges(subtitles, duration),
  };
};

export const getPrimarySpeaker = (speaker: string | undefined): string =>
  speaker?.trim() || 'Speaker';
