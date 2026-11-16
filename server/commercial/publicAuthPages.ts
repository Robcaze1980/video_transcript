import { firstReleaseLanguages } from '../../config/launchLanguages';
import { pilotLanguages } from '../pilot-site/languages';
import { renderAccountAccess } from './accountPages';
import type { commercialLocale } from './commercialPages';
import { publicAuthLabels, publicAuthPath, type PublicAuthPage } from './web/publicAuthModel';

export type { PublicAuthPage } from './web/publicAuthModel';
type Language = ReturnType<typeof commercialLocale>;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

function canonical(language: Language) {
  const known = firstReleaseLanguages.find(item => item.id === language.id && item.locale === language.locale && item.direction === language.direction);
  if (!known) throw new Error('unsupported_auth_language');
  return known;
}

export function publicAuthRoute(language: Language, page: PublicAuthPage): string {
  return publicAuthPath(canonical(language).locale.toLowerCase(), page);
}

export function publicAuthPage(language: Language, page: PublicAuthPage): string {
  const selected = canonical(language), locale = selected.locale.toLowerCase(), labels = publicAuthLabels(selected.id);
  publicAuthPath(locale, page); // Reject unsupported runtime input before choosing a renderer.
  const landing = pilotLanguages.find(item => item.id === selected.id)!;
  const home = '/' + locale + '/' + encodeURIComponent(landing.slug) + '/';
  const verification = '<div id="auth-verification" hidden><button id="auth-resend" type="button" disabled></button><button id="auth-check" type="button" disabled></button></div>';
  let html: string;
  if (page === 'account') {
    html = `<!doctype html><html lang="${escape(selected.locale)}" dir="${selected.direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(labels.account)} | Vistavo</title><link rel="stylesheet" href="/assets/publicAuth.css"><script type="module" src="/assets/publicAuth.js"></script></head><body data-auth-page="account"><header class="auth-header"><a class="brand" href="${home}"><bdi>Vistavo</bdi></a></header><main class="auth-main"><section class="auth-panel" aria-labelledby="account-title"><h1 id="account-title">${escape(labels.account)}</h1><p id="auth-message" role="status" class="auth-status" aria-live="polite">${escape(labels.loading)}</p><div id="public-guest" hidden><p>${escape(labels.guest)}</p><p class="next"><a href="${publicAuthPath(locale, 'sign-in')}">${escape(labels.signIn)}</a> · <a href="${publicAuthPath(locale, 'register')}">${escape(labels.register)}</a></p></div><div id="public-account" hidden><dl class="public-profile"><dt>${escape(labels.name)}</dt><dd id="public-name"></dd><dt>${escape(labels.email)}</dt><dd id="public-email" dir="ltr"></dd><dt>${escape(labels.status)}</dt><dd id="public-verification"></dd></dl></div>${verification}</section><section id="account-workspace" hidden aria-label="${escape(labels.account)}"></section></main></body></html>`;
  } else {
    html = renderAccountAccess(selected, page, undefined, true)
      .replaceAll('/pilot/account.css', '/assets/publicAuth.css')
      .replaceAll('/pilot/editor-assets/accountUi.js', '/assets/accountUi.js')
      .replaceAll('/pilot/editor-assets/firebaseAuth.js', '/assets/publicAuth.js')
      .replace(/href="\/pilot\/(register|sign-in)\/\?lang=[^"]*"/g, (_match, target: 'register' | 'sign-in') => 'href="' + publicAuthPath(locale, target) + '"')
      .replace(/href="\/pilot\/auth\/forgot\/\?lang=[^"]*"/g, 'href="' + publicAuthPath(locale, 'forgot') + '"')
      .replace(/action="[^"]*"/g, 'action="#"')
      .replace('<button>', '<button type="submit">')
      .replace(/<button\b/g, '<button disabled')
      .replace(/<input\b/g, '<input disabled')
      .replace('<button disabled id="auth-signout" type="button" class="auth-secondary"></button>', '')
      .replace('class="auth-status" aria-live="polite"></p>', 'class="auth-status" aria-live="polite">' + escape(labels.loading) + '</p>');
  }
  // Keep the approved official Google SVG/button structure verbatim. Brand assets are separate.
  html = html.replace('<html ', '<html data-vistavo-brand="a3" ')
    .replace('<body data-auth-page="' + page + '">', '<body data-auth-page="' + page + '" data-public-locale="' + locale + '">')
    .replace('<bdi>Vistavo</bdi>', '<img class="vistavo-mark" src="/brand/vistavo-symbol.svg" width="32" height="32" alt=""><bdi>Vistavo</bdi>')
    .replace('</head>', '<link rel="icon" type="image/svg+xml" href="/brand/vistavo-symbol.svg"><link rel="icon" type="image/png" sizes="32x32" href="/brand/vistavo-32.png"><link rel="shortcut icon" href="/favicon.ico"></head>')
    .replace('</section>', '<div id="public-session" hidden><button id="public-signout" class="auth-secondary" type="button" disabled></button></div><nav class="public-auth-nav" aria-label="' + escape(labels.account) + '"><a href="' + publicAuthPath(locale, 'account') + '">' + escape(labels.account) + '</a><a href="' + home + '">' + escape(labels.home) + '</a></nav><noscript><p class="auth-status">' + escape(labels.js) + '</p></noscript></section>');
  if (/\/pilot\/|on(?:click|submit)=/i.test(html)) throw new Error('private_auth_dependency');
  return html;
}
