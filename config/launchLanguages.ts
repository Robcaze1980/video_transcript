// Commercial scope. Inclusion is not proof of provider or translation coverage.
export const launchLanguages = [
  { id: 'en', name: 'English', locale: 'en-US', direction: 'ltr', speechTag: 'en', searchLanguage: 'en-US' },
  { id: 'es', name: 'Español', locale: 'es-419', direction: 'ltr', speechTag: 'es', searchLanguage: 'es' },
  { id: 'cmn', name: '普通话', locale: 'zh-Hans', direction: 'ltr', speechTag: 'cmn', searchLanguage: 'zh-Hans' },
  { id: 'yue', name: '粵語', locale: 'yue-Hant', direction: 'ltr', speechTag: 'yue', searchLanguage: null },
  { id: 'vi', name: 'Tiếng Việt', locale: 'vi', direction: 'ltr', speechTag: 'vi', searchLanguage: 'vi' },
  { id: 'fil', name: 'Filipino', locale: 'fil', direction: 'ltr', speechTag: 'fil', searchLanguage: null },
  { id: 'ko', name: '한국어', locale: 'ko', direction: 'ltr', speechTag: 'ko', searchLanguage: 'ko' },
  { id: 'pt', name: 'Português', locale: 'pt-BR', direction: 'ltr', speechTag: 'pt', searchLanguage: 'pt-BR' },
  { id: 'fr', name: 'Français', locale: 'fr', direction: 'ltr', speechTag: 'fr', searchLanguage: 'fr' },
  { id: 'ja', name: '日本語', locale: 'ja', direction: 'ltr', speechTag: 'ja', searchLanguage: 'ja' },
  { id: 'de', name: 'Deutsch', locale: 'de', direction: 'ltr', speechTag: 'de', searchLanguage: 'de' },
  { id: 'it', name: 'Italiano', locale: 'it', direction: 'ltr', speechTag: 'it', searchLanguage: 'it' },
  { id: 'nl', name: 'Nederlands', locale: 'nl', direction: 'ltr', speechTag: 'nl', searchLanguage: 'nl' },
  { id: 'pl', name: 'Polski', locale: 'pl', direction: 'ltr', speechTag: 'pl', searchLanguage: 'pl' },
  { id: 'cs', name: 'Čeština', locale: 'cs', direction: 'ltr', speechTag: 'cs', searchLanguage: 'cs' },
  { id: 'sv', name: 'Svenska', locale: 'sv', direction: 'ltr', speechTag: 'sv', searchLanguage: 'sv' },
  { id: 'ro', name: 'Română', locale: 'ro', direction: 'ltr', speechTag: 'ro', searchLanguage: 'ro' },
  { id: 'uk', name: 'Українська', locale: 'uk', direction: 'ltr', speechTag: 'uk', searchLanguage: 'uk' },
  { id: 'ru', name: 'Русский', locale: 'ru', direction: 'ltr', speechTag: 'ru', searchLanguage: 'ru' },
  { id: 'tr', name: 'Türkçe', locale: 'tr', direction: 'ltr', speechTag: 'tr', searchLanguage: 'tr' },
  { id: 'ar', name: 'العربية', locale: 'ar', direction: 'rtl', speechTag: 'ar', searchLanguage: 'ar' },
  { id: 'hi', name: 'हिन्दी', locale: 'hi', direction: 'ltr', speechTag: 'hi', searchLanguage: 'hi' },
  { id: 'bn', name: 'বাংলা', locale: 'bn', direction: 'ltr', speechTag: 'bn', searchLanguage: 'bn' },
  { id: 'ur', name: 'اردو', locale: 'ur', direction: 'rtl', speechTag: 'ur', searchLanguage: 'ur' },
  { id: 'pa', name: 'ਪੰਜਾਬੀ', locale: 'pa-Guru', direction: 'ltr', speechTag: 'pa', searchLanguage: 'pa-Guru' },
  { id: 'id', name: 'Bahasa Indonesia', locale: 'id', direction: 'ltr', speechTag: 'id', searchLanguage: 'id' },
  { id: 'th', name: 'ไทย', locale: 'th', direction: 'ltr', speechTag: 'th', searchLanguage: 'th' },
  { id: 'ms', name: 'Bahasa Melayu', locale: 'ms', direction: 'ltr', speechTag: 'ms', searchLanguage: 'ms' },
  { id: 'fa', name: 'فارسی', locale: 'fa', direction: 'rtl', speechTag: 'fa', searchLanguage: 'fa' },
  { id: 'sw', name: 'Kiswahili', locale: 'sw', direction: 'ltr', speechTag: 'sw', searchLanguage: 'sw' },
] as const;

export type LaunchLanguage = typeof launchLanguages[number];
export type LaunchLanguageId = LaunchLanguage['id'];

export const firstReleaseLanguageIds = [
  'en', 'es', 'pt', 'fr', 'de', 'ja', 'ko', 'ar', 'cmn', 'vi',
] as const satisfies readonly LaunchLanguageId[];

export const firstReleaseLanguages = firstReleaseLanguageIds.map(id =>
  launchLanguages.find(language => language.id === id)!);
