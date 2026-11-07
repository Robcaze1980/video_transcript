
export interface Subtitle {
  id: string;
  start: number; // in seconds
  end: number;   // in seconds
  originalText: string;
  translatedText: string;
  speaker?: string;
}

export type SectionStatus =
  | 'pending'
  | 'processing'
  | 'success'
  | 'no_speech'
  | 'error';

export interface TranscriptSection {
  index: number;
  start: number;
  end: number;
  ownershipStart: number;
  ownershipEnd: number;
  status: SectionStatus;
  attempts: number;
  cues: Subtitle[];
  error?: string;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface TranscriptionReport {
  sections: TranscriptSection[];
  completedSections: number;
  noSpeechSections: number;
  failedSections: number;
  pendingSections: number;
  uncaptionedRanges: TimeRange[];
}

export interface TranscriptionResult {
  subtitles: Subtitle[];
  language: string;
  report: TranscriptionReport;
}

export interface ModelCue {
  start: unknown;
  end: unknown;
  original?: unknown;
  translated?: unknown;
  speaker?: unknown;
}

export interface SectionModelResponse {
  hasSpeech: boolean;
  detectedLanguage?: string;
  subtitles: ModelCue[];
}

export interface UploadedVideoSource {
  backend: 'proxy' | 'direct';
  name: string;
  uri: string;
  mimeType: string;
}

export interface ProcessingProgress {
  phase: 'upload' | 'transcribe' | 'merge';
  percent: number;
  completedSections: number;
  totalSections: number;
  retryingSection?: number;
  message: string;
}

export interface SubtitleStyle {
  fontSize: number;
  fontFamily: string;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  position: 'bottom' | 'top';
  showBackground: boolean;
  textOutline: boolean;
  textShadow: boolean;
}

export enum AppState {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  REVIEW = 'REVIEW',
  EXPORTING = 'EXPORTING',
  ERROR = 'ERROR'
}

export interface ProcessingResult {
  subtitles: Subtitle[];
  languageDetected: string;
}
