// Public service facade. The UI should import from here instead of depending on
// transport details such as the local proxy or the direct AI Studio fallback.
export {
  deleteVideoSource,
  getApiAccess,
  getBackendHealth,
  uploadVideoSource,
} from './geminiClient';
export {
  TranscriptionSession,
  transcribeRangeWithSource,
} from './transcriptionSession';
export {
  DEFAULT_TRANSCRIPTION_MODEL,
  describeGeminiError,
} from './transcriptionCore';
