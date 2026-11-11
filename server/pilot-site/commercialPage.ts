import { claudeLandingEsBody } from './claudeLandingEs';
import { commercialCopy } from './commercialCopy';
import { commercialNarrative } from './commercialNarrative';
import { commercialDesignCopy } from './commercialDesignCopy';
import { roofStories } from './roofStory';
import { firstReleaseLanguages } from '../../config/launchLanguages';
import { commercialStyle } from './commercialStyle';
import { renderHeroV2, commercialTopCopy } from './commercialHeroV2';
import { renderHowV2, renderPricingV2, renderFaqV2, renderFooterV2 } from './commercialSectionsV2';
import { pilotLanguages, type PilotLanguage } from './languages';
import type { CommercialOffer } from './render';

const escape = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const skipLabels: Record<string, string> = {
  'es-419': 'Ir al contenido', 'en-US': 'Skip to content', ar: 'انتقل إلى المحتوى',
  'pt-BR': 'Ir para o conteúdo', fr: 'Aller au contenu', de: 'Zum Inhalt springen',
  ja: '本文へ移動', ko: '본문으로 이동', 'zh-Hans': '跳至正文', vi: 'Chuyển đến nội dung',
};

export function renderCommercialLanding({ language, url, links, selector, indexable, offer }: {
  language: PilotLanguage; url: string; links: string; selector: string;
  indexable: boolean; offer?: CommercialOffer;
}) {
  const { locale, direction, name } = language;
  const topCopy = commercialTopCopy[locale];
  const localeOrder = ['es-419','en-US','pt-BR','fr','de','ja','ko','ar','zh-Hans','vi'];
  const languageOptions = localeOrder.map(code => {
    const item = pilotLanguages.find(pack => pack.locale === code)!;
    const label = code === 'pt-BR' ? 'Português (Brasil)' : code === 'zh-Hans' ? '简体中文' : item.name;
    return '<option value="/' + escape(item.locale.toLowerCase()) + '/' + escape(item.slug) + '/"' + (locale === code ? ' selected' : '') + '>' + escape(label) + '</option>';
  }).join('');
  const n = commercialNarrative[locale];
  const design = commercialDesignCopy[locale];
  const roof = design?.roof ?? roofStories[locale];
  if (!n || !design || !roof) throw new Error('Missing commercial narrative for ' + locale);
  const [seoTitle, seoDescription, register, login, demo, demoNote, download] = commercialCopy[locale]!;
  const query = '?lang=' + encodeURIComponent(firstReleaseLanguages.find(item => item.locale === locale)!.id);
  const registration = '/pilot/register/' + query;
  const demoUrl = '/pilot/demo/' + query;
  const primary = (label: string) => '<a class="primary" href="' + registration + '">' + escape(label) + arrow + '</a>';
  const languages = firstReleaseLanguages.map(item =>
    '<li lang="' + escape(item.locale) + '"><bdi>' + escape(item.name) + '</bdi></li>').join('');

  const document = [
    '<!doctype html><html lang="' + locale + '" dir="' + direction + '"><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    indexable ? '' : '<meta name="robots" content="noindex">',
    '<title>' + escape(seoTitle) + ' | LinguistVision</title><meta name="description" content="' + escape(seoDescription) + '">',
    '<link rel="canonical" href="' + escape(url) + '">' + links,
    '<meta property="og:type" content="website"><meta property="og:site_name" content="LinguistVision">',
    '<meta property="og:title" content="' + escape(seoTitle) + '"><meta property="og:description" content="' + escape(seoDescription) + '">',
    '<meta property="og:url" content="' + escape(url) + '"><meta property="og:image" content="' + escape(new URL('/demo/jobsite.webp', url).href) + '">',
    '<style>' + commercialStyle + '</style><script type="module" src="/pilot/editor-assets/commercialLanding.js"></script></head><body class="commercial">',
    '<a class="skip-link" href="#main">' + escape(skipLabels[locale]) + '</a>',
    '<header class="top"><div class="wrap"><a class="brand" href="' + escape(url) + '">LinguistVision</a>',
    '<nav class="section-nav">' + ['#how', '#languages', '#plans', '#questions'].map((href, i) => '<a href="' + href + '">' + escape(topCopy[i]) + '</a>').join('') + '</nav>',
    '<div class="header-actions"><label class="site-language-label" for="site-language">' + escape(topCopy[4]) + '</label><select id="site-language" data-site-language>' + languageOptions + '</select>',
    '<a class="sign-in-link" href="/pilot/sign-in/' + query + '">' + escape(login) + '</a></div></div></header>',
    '<main id="main" tabindex="-1">',
    renderHeroV2(locale, registration, name),
    '<details class="real-demo wrap"><summary>' + escape(demo) + '</summary><div class="real-demo-content"><video controls playsinline preload="none" poster="/demo/jobsite.webp" width="960" height="540" aria-label="' + escape(demoNote) + '"><source src="/demo/jobsite.mp4" type="video/mp4"><track kind="captions" srclang="en" label="English" src="/demo/jobsite.vtt" default></video><div><p>' + escape(demoNote) + '</p><p><a href="/demo/jobsite.srt" download>' + escape(download) + '</a></p><a href="' + demoUrl + '">' + escape(demo) + '</a></div></div></details>',
    '<section class="example-section"><article class="roof-story" aria-labelledby="roof-title"><div class="wrap marketing-section"><div class="section-intro"><p class="eyebrow">' + escape(roof.label) + '</p>',
    '<h2 id="roof-title">' + escape(roof.title) + '</h2><p>' + escape(roof.intro) + '</p></div>',
    '<ol class="roof-steps">' + roof.steps.map(([heading, body], i) => '<li><span class="roof-step-number" aria-hidden="true">0' + (i + 1) + '</span><h3>' + escape(heading) + '</h3><p>' + escape(body) + '</p></li>').join('') + '</ol>',
    '<p class="roof-note">' + escape(roof.note) + '</p></div></article></section>',
    renderHowV2(locale, n),
    '<section class="wrap marketing-section uses-section" id="uses"><div class="section-intro"><h2>' + escape(n.painHeading) + '</h2><p>' + escape(n.painIntro) + '</p></div>',
    '<div class="use-cases">' + n.cases.slice(1).map(item => '<article><h3>' + escape(item.buyer) + '</h3><p class="case-problem">' + escape(item.problem) + '</p><p class="case-solution">' + escape(item.solution) + '</p><p class="case-outcome">' + escape(item.outcome) + '</p></article>').join('') + '</div></section>',
    '<section class="language-section" id="languages"><div class="wrap marketing-section language-layout"><div class="section-intro"><h2>' + escape(n.languagesHeading) + '</h2><p>' + escape(n.languagesBody) + '</p></div>',
    '<div><h3>' + escape(design.languagesLabel) + '</h3><ul class="language-list">' + languages + '</ul><p class="coverage-note">' + escape(n.betaNote) + '</p><p class="coverage-note">' + escape(design.languageGoal) + '</p></div></div></section>',
    renderPricingV2(locale, registration, offer),
    renderFaqV2(locale, n),
    '<section class="closing"><div class="wrap"><div><h2>' + escape(n.closeTitle) + '</h2><p>' + escape(n.closeBody) + '</p></div><div class="actions">' + primary(register) + '</div></div></section></main>',
    renderFooterV2(locale, url, registration, selector, offer),
    '</body></html>',
  ].join('\n');
  if (locale !== 'es-419') return document;
  return document.slice(0, document.indexOf('<body')).replace(/<title>[\s\S]*?<\/title>/, '<title>LinguistVision · Subtítulos en inglés para tus videos en español</title>').replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="LinguistVision · Subtítulos en inglés para tus videos en español">') + '<body class="claude-landing">' + claudeLandingEsBody + '</body></html>';
}
