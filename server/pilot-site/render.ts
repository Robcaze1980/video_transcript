import { firstReleaseLanguages, launchLanguages } from '../../config/launchLanguages';
import { pilotLanguages, type PilotLanguage } from './languages';
import { landingCopy, landingStyle } from './landingStyle';
import { commercialCopy } from './commercialCopy';
import { commercialStyle } from './commercialStyle';
import { renderCommercialLanding } from './commercialPage';

const escapeMarkup = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
);

export function renderPilotSite(
  origin: string, languages: readonly PilotLanguage[], fallbackLocale: string,
  pilotEntryLabels?: ReadonlyMap<string, string>,
) {
  return renderSite(origin, languages, fallbackLocale, false, new Set(), pilotEntryLabels);
}

export function renderLaunchPreview(origin: string) {
  const drafts = new Set<string>();
  const languages = launchLanguages.map(language => {
    const translated = pilotLanguages.find(pack => pack.locale === language.locale);
    if (translated) return translated;
    drafts.add(language.locale);
    return {
      ...language,
      searchLanguage: null,
      slug: 'video-subtitles',
      title: 'Localization preview | LinguistVision',
      description: 'This route is reserved for a localized version.',
      heading: 'Localization pending',
      descriptionOfPilot: 'Copy and language capability are still under review.',
    } satisfies PilotLanguage;
  });
  return renderSite(origin, languages, 'en-US', false, drafts);
}

export interface LaunchEvidence {
  locale: string;
  copyReview: string;
  transcriptionReview: string;
}

export interface CommercialOffer {
  maxFileMiB: number;
  maxDurationSeconds: number;
  capabilities: Readonly<Record<string, string>>;
  supportUrl: string;
  privacyUrl: string;
  termsUrl: string;
}

export const commercialLandingStyle = commercialStyle;

export function renderCommercialPreview(origin: string) {
  return renderSite(origin, pilotLanguages, 'en-US', false, new Set(), undefined, {});
}

export function renderLaunchRelease(
  origin: string,
  languages: readonly PilotLanguage[],
  evidence: readonly LaunchEvidence[], offer?: CommercialOffer,
) {
  if (new URL(origin).protocol !== 'https:') throw new Error('A release requires an HTTPS origin.');
  if (languages.length !== firstReleaseLanguages.length || evidence.length !== firstReleaseLanguages.length) {
    throw new Error('A release requires all 10 approved language packages and reviews.');
  }
  const missing = firstReleaseLanguages.filter(language => {
    const pack = languages.find(item => item.locale === language.locale);
    const review = evidence.find(item => item.locale === language.locale);
    return !pack?.example || pack.searchLanguage !== language.searchLanguage || pack.direction !== language.direction ||
      !review?.copyReview.trim() || !review.transcriptionReview.trim();
  });
  if (missing.length) throw new Error('Missing or invalid launch evidence for: ' + missing.map(language => language.locale).join(', '));
  if (!offer || ![offer.maxFileMiB, offer.maxDurationSeconds]
    .every(value => Number.isSafeInteger(value) && value > 0) ||
    ![offer.supportUrl, offer.privacyUrl, offer.termsUrl]
      .every(link => URL.canParse(link) && new URL(link).protocol === 'https:') ||
    languages.some(language => !offer.capabilities[language.locale]?.trim())) {
    throw new Error('The commercial offer is incomplete.');
  }
  const files = renderSite(origin, languages, 'en-US', true, new Set(), undefined, { offer });
  files.set('robots.txt', ['User-agent: *', 'Disallow: /pilot/', '', 'User-agent: Googlebot', 'Disallow: /pilot/',
    '', 'User-agent: OAI-SearchBot', 'Disallow: /pilot/', '', 'Sitemap: ' + new URL('/sitemap.xml', origin).href, ''].join('\n'));
  return files;
}

function renderSite(
  origin: string,
  languages: readonly PilotLanguage[],
  fallbackLocale: string,
  indexable: boolean,
  drafts: ReadonlySet<string>,
  pilotEntryLabels?: ReadonlyMap<string, string>,
  commercial?: { offer?: CommercialOffer },
) {
  const site = new URL(origin);
  if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password ||
      site.pathname !== '/' || site.search || site.hash) throw new Error('Use an HTTP origin without a path.');
  const seen = new Set<string>();
  const searchLanguages = new Set<string>();
  const pages = languages.map(language => {
    const { locale, searchLanguage, slug, direction, name, title, description, heading, descriptionOfPilot, example } = language;
    const invalidSearchLanguage = searchLanguage !== null &&
      (!/^[a-z]{2}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/.test(searchLanguage) ||
        searchLanguages.has(searchLanguage.toLowerCase()));
    if (!/^[a-zA-Z0-9-]+$/.test(locale) || Intl.getCanonicalLocales(locale)[0] !== locale ||
        invalidSearchLanguage ||
        seen.has(locale.toLowerCase()) || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug) ||
        ![name, title, description, heading, descriptionOfPilot].every(value => value.trim()) ||
        (example && (!example.heading.trim() || !example.caption.trim())) ||
        !['ltr', 'rtl'].includes(direction)) throw new Error('Invalid or incomplete language package.');
    seen.add(locale.toLowerCase());
    if (searchLanguage !== null) searchLanguages.add(searchLanguage.toLowerCase());
    const url = new URL('/' + locale.toLowerCase() + '/' + slug + '/', site).href;
    return { language, url, file: locale.toLowerCase() + '/' + slug + '/index.html' };
  });
  const fallback = pages.find(page => page.language.locale === fallbackLocale);
  if (!fallback) throw new Error('The fallback language must be present.');
  const alternates = [
    ...pages.map(({ language, url }) => ({ code: language.searchLanguage, url })),
    { code: 'x-default', url: fallback.url },
  ];
  const escaped = escapeMarkup;
  const files = new Map<string, string>();
  for (const { language, file, url } of pages) {
    const { locale, direction, title, description, heading, descriptionOfPilot, example } = language;
    const pilotEntry = pilotEntryLabels?.get(locale);
    const copy = landingCopy[locale];
    const marketing = commercial && commercialCopy[locale];
    const links = language.searchLanguage === null ? '' : alternates.flatMap(({ code, url }) =>
      code ? ['<link rel="alternate" hreflang="' + code + '" href="' + escaped(url) + '">'] : []
    ).join('\n');
    const selector = pages.map(page =>
      '<li><a lang="' + page.language.locale + '" href="' + escaped(page.url) + '"' +
      (page.language.locale === locale ? ' aria-current="page"' : '') + '>' +
      escaped(page.language.name) + '</a></li>'
    ).join('');
    if (marketing) {
      files.set(file, renderCommercialLanding({ language, url, links, selector, indexable, offer: commercial.offer }));
      continue;
    }
    files.set(file, [
      '<!doctype html>',
      '<html lang="' + locale + '" dir="' + direction + '"><head>',
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
      indexable ? '' : '<meta name="robots" content="noindex">',
      '<title>' + escaped(title) + '</title>',
      '<meta name="description" content="' + escaped(description) + '">',
      '<link rel="canonical" href="' + escaped(url) + '">',
      links,
      '<style>' + landingStyle + '</style>',
      '</head><body><header class="top"><div class="wrap">',
      '<div class="brand"><span class="mark" aria-hidden="true">LV</span><bdi>LinguistVision</bdi></div>',
      '<nav><details><summary>' + escaped(language.name) + '</summary><ul>' + selector + '</ul></details></nav>',
      '</div></header><main>',
      '<section class="hero wrap">' + (drafts.has(locale) ? '<div lang="en" dir="ltr">' : '<div>'),
      '<span class="badge">SRT</span><h1>' + escaped(heading) + '</h1><p class="lead">' + escaped(description) + '</p>',
      '<div class="actions">',
      pilotEntry ? '<span class="primary"><a href="/pilot/enter">' + escaped(pilotEntry) + '</a></span>' : '',
      copy && example ? '<a href="#subtitle-example"' + (pilotEntry ? '' : ' class="primary"') + '>' + escaped(copy[0]) + '</a>' : '',
      '</div></div>',
      example ? '<figure><div id="subtitle-example" class="window"><bdi>LinguistVision</bdi>' +
        '<div class="dots" aria-hidden="true"><i></i><i></i><i></i></div></div>' +
        '<div class="screen"><div class="caption"><p>' + escaped(example.caption) + '</p></div></div>' +
        '<div class="track" dir="ltr"><p><bdi dir="ltr"><time datetime="PT4S">00:04</time>–<time datetime="PT7S">00:07</time></bdi></p>' +
        '<div class="timeline" aria-hidden="true"><span></span><span class="active"></span><span></span><span></span></div></div>' +
        '<figcaption>' + escaped(example.heading) + '</figcaption></figure>' : '',
      '</section>',
      copy ? '<section class="steps"><div class="wrap"><ol>' + copy.slice(1).map((step, i) =>
        '<li><span aria-hidden="true">0' + (i + 1) + '</span>' + escaped(step) + '</li>').join('') + '</ol></div></section>' : '',
      '</main>',
      indexable ? '' : '<footer class="wrap"><p>' + escaped(descriptionOfPilot) + '</p></footer>',
      '</body></html>',
    ].join('\n'));
  }
  files.set('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    pages.map(page => '<url><loc>' + escaped(page.url) + '</loc></url>').join('\n') +
    '\n</urlset>\n');
  return files;
}
