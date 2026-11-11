export const pilotLanguageDirections = [
  { id: 'en-es', label: 'Inglés → español', sourceLanguage: 'English', targetLanguage: 'Spanish', experimental: false },
  { id: 'es-en', label: 'Español → inglés', sourceLanguage: 'Spanish', targetLanguage: 'English', experimental: false },
  { id: 'ar-es', label: 'Árabe → español (prueba)', sourceLanguage: 'Arabic', targetLanguage: 'Spanish', experimental: true },
  { id: 'en-en', label: 'Inglés → inglés', sourceLanguage: 'English', targetLanguage: 'English', experimental: false },
  { id: 'es-es', label: 'Español → español', sourceLanguage: 'Spanish', targetLanguage: 'Spanish', experimental: false },
  { id: 'ar-ar', label: 'Árabe → árabe (prueba)', sourceLanguage: 'Arabic', targetLanguage: 'Arabic', experimental: true },
] as const;

const additionalSpeech = [
  ['pt', 'Português do Brasil', 'Brazilian Portuguese'],
  ['fr', 'Français', 'French'],
  ['de', 'Deutsch', 'German'],
  ['ja', '日本語', 'Japanese'],
  ['ko', '한국어', 'Korean'],
  ['cmn', '普通话', 'Mandarin Chinese (Simplified Chinese writing)'],
  ['vi', 'Tiếng Việt', 'Vietnamese'],
] as const;

export const additionalPilotMonolingualDirections = additionalSpeech.map(([id, label, language]) => ({
  id: `${id}-${id}`,
  label,
  sourceLanguage: language,
  targetLanguage: language,
  experimental: true,
  preciseSpeechTiming: true,
}));

// A short speech sample passed the 0.5-second timing check for these directions.
const previewTimingPassed = new Set(['pt-pt', 'fr-fr', 'de-de', 'ja-ja', 'ko-ko', 'cmn-cmn', 'vi-vi']);
export const additionalPilotBetaDirections = additionalPilotMonolingualDirections.filter(
  ({ id }) => previewTimingPassed.has(id),
);
