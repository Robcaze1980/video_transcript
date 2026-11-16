import { createHash } from 'node:crypto';
import { claudeLandingEsBody } from './claudeLandingEs';
import { landingSlots, landingSourceHash, type LandingSlot } from './landingSlots';
import { landingSourceText } from './landingSourceText';
import { pilotLanguages } from './languages';
import { firstReleaseLanguages } from '../../config/launchLanguages';
import { commercialCopy } from './commercialCopy';

export interface LandingLocaleCopy {
  locale: string;
  headline: { before: string; highlight: string; after: string };
  meta: { title: string; description: string };
  footerLanguages: string;
  languageNames: Record<string, string>;
  strings: Record<string, string>;
}

export const escapeLandingText = (value: string) => value.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function validateLandingTemplate(body: string, slots: readonly LandingSlot[], hash: string): void {
  if (createHash('sha256').update(body).digest('hex') !== hash) throw new Error('Landing template changed: regenerate localization slots');
  let previous = 0;
  for (const slot of slots) {
    if (!Number.isSafeInteger(slot.start) || !Number.isSafeInteger(slot.end) || slot.start < previous ||
      slot.end < slot.start || slot.end > body.length) throw new Error('Invalid or overlapping landing slot');
    previous = slot.end;
  }
}

const words: Record<string, string> = { un: '1', uno: '1', una: '1', dos: '2', nueve: '9', diez: '10', veinte: '20' };
function numbers(value: string) { return value.match(/\d+/g) ?? []; }
function assertPlainText(value: string): void {
  if (typeof value !== 'string' || value.length > 4000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(value)) throw new Error('Unsafe landing text');
}

export function validateLandingCopy(copy: LandingLocaleCopy): void {
  if (!pilotLanguages.some(item => item.locale === copy.locale) || copy.locale === 'es-419') throw new Error('Unsupported landing locale');
  if (!copy.headline || !['before', 'highlight', 'after'].every(key => typeof copy.headline[key] === 'string') ||
    !copy.headline.highlight.trim() || !copy.meta?.title?.trim() || !copy.meta?.description?.trim() ||
    !copy.footerLanguages?.trim()) throw new Error('Incomplete landing catalog');
  for (const value of [...Object.values(copy.headline), ...Object.values(copy.meta), copy.footerLanguages,
    ...Object.values(copy.languageNames ?? {})]) assertPlainText(value);
  const keys = Object.keys(landingSourceText);
  if (!copy.strings || Object.keys(copy.strings).length !== keys.length) throw new Error('Missing or extra landing strings');
  for (const key of keys) {
    const source = landingSourceText[key];
    const value = copy.strings[key];
    // t102 is the standalone source-language article before the highlighted noun.
    // Some grammars omit it; the key itself must still be present.
    if (!Object.hasOwn(copy.strings, key) || typeof value !== 'string' || (!value.trim() && key !== 't102')) throw new Error('Missing landing text: ' + key);
    assertPlainText(value);
    const required = numbers(source);
    const actual = numbers(value);
    const remaining = [...actual];
    for (const digit of required) {
      const i = remaining.indexOf(digit);
      if (i < 0) throw new Error('Changed numeric condition: ' + key);
      remaining.splice(i, 1);
    }
    const allowed = new Set(source.toLowerCase().match(/\p{L}+/gu)?.flatMap(word => words[word] ? [words[word]] : []) ?? []);
    if (source.includes('por minuto') || source.includes('por trabajo')) allowed.add('1');
    if (remaining.some(digit => !allowed.has(digit))) throw new Error('Added numeric condition: ' + key);
    const placeholders = source.match(/\{\w+\}/g) ?? [];
    if (placeholders.some(token => !value.includes(token))) throw new Error('Changed placeholder: ' + key);
    const currencySequence = (text: string) => (text.match(/US\$\d+(?:[.,]\d+)?/g) ?? []).map(amount => amount.replace(',', '.')).join('|');
    if (currencySequence(source) !== currencySequence(value)) throw new Error('Changed USD price: ' + key);
  }
  if (!copy.languageNames || pilotLanguages.some(item => !copy.languageNames[item.locale]?.trim())) throw new Error('Missing language name');
}

validateLandingTemplate(claudeLandingEsBody, landingSlots, landingSourceHash);
const nativeLabel = (locale: string) => locale === 'pt-BR' ? 'Português (Brasil)' : locale === 'zh-Hans' ? '简体中文'
  : pilotLanguages.find(item => item.locale === locale)!.name;
const route = (locale: string) => {
  const language = pilotLanguages.find(item => item.locale === locale)!;
  return '/' + language.locale.toLowerCase() + '/' + language.slug + '/';
};
const localeOrder = ['es-419', 'en-US', 'pt-BR', 'fr', 'de', 'ja', 'ko', 'ar', 'zh-Hans', 'vi'];

function textWithTimes(value: string): string {
  // Only text-node slots use these elements. Attribute slots always remain escaped text.
  return escapeLandingText(value).replace(/\b\d{2}:\d{2}:\d{2},\d{3}\b|\b\d{1,2}:\d{2}\b/g,
    time => '<bdi dir="ltr">' + time + '</bdi>');
}

export function renderLocalizedLanding(copy: LandingLocaleCopy): string {
  validateLandingCopy(copy);
  const locale = copy.locale;
  const language = firstReleaseLanguages.find(item => item.locale === locale)!;
  const target = locale === 'en-US' ? 'es' : 'en';
  const e = escapeLandingText;
  const renderSlot = (slot: LandingSlot): string => {
    switch (slot.kind) {
      case 'text': {
        const value = copy.strings[slot.key!];
        if (!value) return ''; // Articles can disappear when grammar changes; the key remains required.
        const original = claudeLandingEsBody.slice(slot.start, slot.end);
        const before = original.match(/^\s*/)?.[0] ?? '';
        const after = original.match(/\s*$/)?.[0] ?? '';
        const nativeJoined = (['ja', 'zh-Hans'].includes(locale) && ['t071','t072','t073','t074','t101','t102','t103'].includes(slot.key!)) ||
          (locale === 'ko' && ['t101','t103'].includes(slot.key!)) || /^[.!?。！？]+$/u.test(value);
        return textWithTimes(nativeJoined ? value.trim() : before + value + after);
      }
      case 'attribute': return e(copy.strings[slot.key!]);
      case 'homeLink': return e(route(locale));
      case 'pilotLink': {
        const original = claudeLandingEsBody.slice(slot.start, slot.end);
        const url = new URL(original, 'http://localhost');
        url.searchParams.set('lang', language.id);
        return e(url.pathname + url.search);
      }
      case 'filename': return e(claudeLandingEsBody.slice(slot.start, slot.end)
        .replace(/\.(en|es)\.(?=mp4|srt)/g, '.' + (slot.key === 'source' ? language.id : target) + '.'));
      case 'targetLang': return target;
      case 'targetLangInsert': return ' lang="' + target + '" dir="ltr"';
      case 'sourceLangInsert': return ' lang="' + e(locale) + '" dir="' + language.direction + '"';
      case 'ltrInsert': return ' dir="ltr"';
      case 'headline': return e(copy.headline.before) + '<span class="hlg">' + e(copy.headline.highlight) + '</span>' + e(copy.headline.after);
      case 'options': return localeOrder.map(code => '<option value="' + e(route(code)) + '"' +
        (code === locale ? ' selected' : '') + '>' + e(nativeLabel(code)) + '</option>').join('');
      case 'catalog': return localeOrder.filter(code => code !== locale).map(code => {
        const item = firstReleaseLanguages.find(item => item.locale === code)!;
        const abbreviation = item.id === 'cmn' ? 'ZH' : item.id.toUpperCase();
        return '<li class="lrow"><bdi class="lcode" dir="ltr">' + abbreviation + '</bdi><span><span>' +
          e(copy.languageNames[code]) + '</span><bdi class="lnat" lang="' + e(code) + '" dir="auto">' + e(nativeLabel(code)) + '</bdi></span></li>';
      }).join('');
      case 'footer': return '<span class="m">' + e(copy.footerLanguages) + ':</span>' + localeOrder.filter(code => code !== locale)
        .map(code => '<a href="' + e(route(code)) + '" lang="' + e(code) + '" dir="auto">' + e(nativeLabel(code)) + '</a>').join('');
      case 'demoLinks': {
        const labels = commercialCopy[locale]!;
        return '<a href="/pilot/demo/?lang=' + e(language.id) + '">' + e(labels[4]) + '</a>' +
          '<a href="/demo/jobsite.srt" download>' + e(labels[6]) + '</a>';
      }
    }
  };
  let cursor = 0;
  const output: string[] = [];
  for (const slot of landingSlots) {
    output.push(claudeLandingEsBody.slice(cursor, slot.start), renderSlot(slot));
    cursor = slot.end;
  }
  output.push(claudeLandingEsBody.slice(cursor));
  return output.join('');
}
