import { commercialNarrative, type CommercialNarrative } from './commercialNarrative';
import { commercialCopy } from './commercialCopy';
import { commercialDesignCopy } from './commercialDesignCopy';
import { commercialSectionsCopyV2 } from './commercialSectionsCopyV2';
import { packageCopy } from './packageCopy';
import { videoPackages } from '../../config/videoPackages';
import type { CommercialOffer } from './render';

const escape = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const diagonalArrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const stepIcons = [
  '<path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5"/>',
  '<path d="m5 16-1 4 4-1L20 7l-3-3L5 16Zm10-10 3 3"/>',
  '<path d="M12 4v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
];

export function renderHowV2(locale: string, n: CommercialNarrative): string {
  const copy = commercialSectionsCopyV2[locale];
  const base = commercialCopy[locale]!;
  return [
    '<section class="v2-how wrap marketing-section" id="how" data-how-widget data-motion="static" data-phase="5">',
    '<div class="section-intro"><h2>' + escape(n.howHeading) + '</h2></div><div class="how-layout">',
    '<div><ol class="how-step-list">' + n.steps.map(([title, body], index) =>
      '<li><button type="button" class="how-step-button" disabled data-step-target="' + index + '" aria-pressed="false" aria-controls="how-panel-' + index + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' + stepIcons[index] + '</svg>' +
      '<span><strong>' + (index + 1) + '. ' + escape(title) + '</strong><span>' + escape(body) + '</span></span>' +
      '<span class="how-step-progress" aria-hidden="true"></span></button></li>').join('') + '</ol>',
    '<button type="button" class="motion-toggle" data-motion-toggle data-play-label="' + escape(copy.play) + '" data-pause-label="' + escape(copy.pause) + '" aria-pressed="false">' + escape(copy.play) + '</button></div>',
    '<div class="how-preview">',
    '<section class="how-step-panel" id="how-panel-0" data-step-panel="0" aria-labelledby="how-heading-0"><div class="how-preview-top"><h3 id="how-heading-0">' + escape(n.steps[0][0]) + '</h3><bdi dir="ltr">01</bdi></div>',
    '<div class="how-file" data-reveal="1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' + stepIcons[0] + '</svg><bdi dir="ltr">jobsite.mp4</bdi><span>EN</span></div>',
    '<p>' + escape(n.steps[0][1]) + '</p></section>',
    '<section class="how-step-panel" id="how-panel-1" data-step-panel="1" aria-labelledby="how-heading-1"><div class="how-preview-top"><h3 id="how-heading-1">' + escape(n.steps[1][0]) + '</h3><bdi dir="ltr">02</bdi></div>',
    '<div class="how-caption-row" data-reveal="1"><bdi dir="ltr">00:00.500 → 00:04.000</bdi><p>' + escape(n.beforeLabel) + '</p><del lang="en" dir="ltr">Keep the walkway clear while we move the material.</del></div>',
    '<div class="how-caption-row is-corrected" data-reveal="3"><p>' + escape(n.afterLabel) + '</p><q lang="en" dir="ltr">Keep the walkway clear while we move the <mark>materials.</mark></q></div></section>',
    '<section class="how-step-panel" id="how-panel-2" data-step-panel="2" aria-labelledby="how-heading-2"><div class="how-preview-top"><h3 id="how-heading-2">' + escape(n.steps[2][0]) + '</h3><bdi dir="ltr">03</bdi></div>',
    '<div class="how-output" data-reveal="1"><bdi dir="ltr">jobsite.srt</bdi><a href="/demo/jobsite.srt" download>' + escape(base[6]) + '</a></div><p>' + escape(n.steps[2][1]) + '</p></section>',
    '</div></div><p class="how-illustration-note">' + escape(copy.illustration) + '</p></section>',
  ].join('\n');
}

export function renderPricingV2(locale: string, registration: string, offer?: CommercialOffer): string {
  const copy = commercialSectionsCopyV2[locale];
  const [balanceNote, balanceExample, previewNote] = packageCopy[locale];
  const register = commercialCopy[locale]![2];
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0 });
  const minutes = new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'long' });
  const condition = offer
    ? '<bdi dir="ltr">' + offer.maxFileMiB + ' MiB · ' + offer.maxDurationSeconds + ' s</bdi> · ' + escape(offer.capabilities[locale])
    : escape(commercialDesignCopy[locale].pilotNote);
  return [
    '<section class="v2-pricing wrap marketing-section" id="plans"><header class="pricing-header"><p class="eyebrow">' + escape(copy.pricingLabel) + '</p><h2>' +
    escape(copy.pricingTitle[0]) + ' <span>' + escape(copy.pricingTitle[1]) + '</span></h2><p>' + escape(balanceNote) + '</p></header>',
    '<div class="pricing-grid">' + videoPackages.map((plan, index) =>
      '<article class="pricing-plan' + (index === 1 ? ' is-featured' : '') + '"><h3>' + escape(minutes.format(plan.credits / 60)) + '</h3>' +
      '<p class="offer-price"><bdi dir="ltr">' + escape(money.format(plan.amount / 100)) + '</bdi> <span>USD</span></p>' +
      '<p class="pricing-unit">' + escape(copy.once) + ' · <bdi dir="ltr">USD 0.10 / min</bdi></p>' +
      '<ul><li>' + escape(balanceNote) + '</li><li>' + escape(copy.destination) + '</li></ul>' +
      '<a class="pricing-action" href="' + escape(registration) + '">' + escape(register) + diagonalArrow + '</a></article>').join('') + '</div>',
    '<p class="balance-example">' + escape(balanceExample) + '</p><aside class="pilot-condition"><h3>' + escape(commercialDesignCopy[locale].pilotHeading) + '</h3><p>' + condition + '</p>',
    offer ? '' : '<p class="offer-condition">' + escape(previewNote) + '</p>',
    '</aside></section>',
  ].join('\n');
}

export function renderFaqV2(locale: string, n: CommercialNarrative): string {
  const copy = commercialSectionsCopyV2[locale];
  const extra = copy.extraFaqs;
  const groups = [
    [extra[0], n.faqs[0], n.faqs[6], n.faqs[3], extra[1]],
    [extra[2], [n.faqs[2][0], n.faqs[2][1] + ' ' + n.faqs[1][1]], extra[3], extra[4]],
    [n.faqs[4], extra[5], extra[6], extra[7]],
    [n.faqs[5], extra[8], extra[9], extra[10]],
  ];
  const categories = ['general', 'files', 'languages', 'pricing'];
  return [
    '<section class="v2-faq" id="questions" data-faq-widget><header class="faq-header"><div class="wrap"><p class="eyebrow">' + escape(copy.legal) + '</p><h2>' + escape(commercialCopy[locale]![13]) + '</h2>',
    '<div class="faq-search" role="search"><label for="faq-search">' + escape(copy.search) + '</label><div><input id="faq-search" type="search" data-faq-search placeholder="' + escape(copy.search) + '" aria-controls="faq-content">',
    '<button type="button" data-faq-clear hidden>' + escape(copy.clear) + '</button></div></div></div></header>',
    '<div class="wrap marketing-section faq-layout"><aside class="faq-sidebar"><div class="faq-categories">' + categories.map((id, index) =>
      '<button type="button" data-category="' + id + '" aria-pressed="false" aria-controls="faq-group-' + id + '">' + escape(copy.categories[index]) + '</button>').join('') + '</div>',
    '<img class="faq-illustration" src="/demo/faq-ilustracion.jpg" alt="" loading="lazy" width="560" height="560"></aside>',
    '<div class="faq-content" id="faq-content"><p class="faq-status" data-faq-status data-results-label="' + escape(copy.results) + '" role="status" aria-live="polite"></p>',
    '<p class="faq-empty" data-faq-empty hidden>' + escape(copy.empty) + '</p>',
    groups.map((questions, groupIndex) => '<section class="faq-group" id="faq-group-' + categories[groupIndex] + '" data-faq-group="' + categories[groupIndex] + '"><h3>' + escape(copy.categories[groupIndex]) + '</h3><div class="faq-list">' +
      questions.map(([question, answer]) => '<details data-faq-category="' + categories[groupIndex] + '"><summary>' + escape(question) + '<span aria-hidden="true">+</span></summary><p>' + escape(answer) + '</p></details>').join('') + '</div></section>').join(''),
    '</div></div></section>',
  ].join('\n');
}

export function renderFooterV2(
  locale: string,
  landing: string,
  registration: string,
  selector: string,
  offer?: CommercialOffer,
): string {
  const copy = commercialSectionsCopyV2[locale];
  const base = commercialCopy[locale]!;
  const query = new URL(registration, 'http://127.0.0.1').search;
  const signIn = '/pilot/sign-in/' + query;
  const link = (href: string, label: string) => '<a href="' + escape(href) + '">' + escape(label) + '</a>';
  const legal = [
    [offer?.supportUrl, base[16]], [offer?.privacyUrl, base[17]], [offer?.termsUrl, base[18]],
  ];
  return [
    '<footer class="v2-footer"><div class="wrap"><div class="footer-action-grid">' +
    [[registration, base[2]], [signIn, base[3]], ['#plans', commercialSectionsCopyV2[locale].pricingLabel]].map(([href, label]) =>
      '<a href="' + escape(href) + '">' + escape(label) + diagonalArrow + '</a>').join('') +
    (offer ? '<a href="' + escape(offer.supportUrl) + '">' + escape(base[16]) + diagonalArrow + '</a>' : '<p>' + escape(base[16]) + ' <span>' + escape(copy.pending) + '</span></p>') +
    '</div><div class="footer-grid"><div class="footer-brand"><a class="brand" href="' + escape(landing) + '"><span class="mark" aria-hidden="true">LV</span><bdi>LinguistVision</bdi></a><p>' + escape(base[1]) + '</p></div>',
    '<nav class="footer-column"><h3>' + escape(copy.product) + '</h3>' + link('#how', commercialNarrative[locale].nav[1]) + link('#languages', copy.languages) + link('#plans', copy.pricingLabel) + link('#questions', base[13]) + '</nav>',
    '<nav class="footer-column"><h3>' + escape(copy.account) + '</h3>' + link(registration, base[2]) + link(signIn, base[3]) + '</nav>',
    '<div class="footer-column"><h3>' + escape(copy.legal) + '</h3>' + legal.map(([href, label]) =>
      href ? link(href, label) : '<p>' + escape(label) + ' <span>' + escape(copy.pending) + '</span></p>').join('') + '</div></div>',
    '<nav class="footer-locales"><h3>' + escape(copy.languages) + '</h3><ul>' + selector + '</ul></nav>',
    '<div class="footer-end"><p><bdi dir="ltr">© ' + new Date().getUTCFullYear() + ' LinguistVision</bdi></p></div></div></footer>',
  ].join('\n');
}
