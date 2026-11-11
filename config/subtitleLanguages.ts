type SubtitleLanguage = {
  tag: string;
  label: string;
};

// The local app still sends these labels to the existing Gemini prompt.
// Presence here does not certify a language or pair for the commercial app.
export const subtitleLanguages = [
  { tag: 'en', label: 'English' },
  { tag: 'es', label: 'Spanish' },
  { tag: 'fr', label: 'French' },
  { tag: 'de', label: 'German' },
  { tag: 'zh', label: 'Chinese' },
  { tag: 'ja', label: 'Japanese' },
  { tag: 'ar', label: 'Arabic' },
  { tag: 'pt', label: 'Portuguese' },
  { tag: 'it', label: 'Italian' },
  { tag: 'ru', label: 'Russian' },
] as const satisfies readonly SubtitleLanguage[];
