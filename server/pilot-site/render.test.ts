import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { firstReleaseLanguages, launchLanguages } from '../../config/launchLanguages';
import { pilotLanguages } from './languages';
import { packageCopy } from './packageCopy';
import { startLaunchPreview } from './preview';
import { renderCommercialPreview, renderLaunchRelease, renderPilotSite } from './render';

describe('pilot language packages', () => {
  it('serves the commercial journey and its conditions in HTML across all ten locales', () => {
    const files = renderCommercialPreview('http://127.0.0.1:3001');
    expect(files.size).toBe(11);
    for (const language of pilotLanguages) {
      const route = '/' + language.locale.toLowerCase() + '/' + language.slug + '/';
      const canonical = new URL(route, 'http://127.0.0.1:3001').href;
      const html = files.get(route.slice(1) + 'index.html')!;
      expect(html.match(/<h1(?:\s[^>]*)?>/g)).toHaveLength(1);
      if (language.locale === 'es-419') {
        expect(html).toContain('class="claude-landing"');
        expect(html).toContain('El inspector explica en español. El propietario necesita entenderlo en inglés.');
        expect(html.match(/data-faq-category=/g)).toHaveLength(17);
        expect(html.match(/data-scene-panel=/g)).toHaveLength(4);
        expect(html).not.toContain('{{');
        expect(html).not.toMatch(/\sstyle="/);
        expect(html).toContain('hreflang="x-default"');
        expect(html).toContain('content="noindex"');
        continue;
      }
      expect(html.match(/class="pricing-plan(?: is-featured)?"/g)).toHaveLength(3);
      expect(html.match(/data-faq-category=/g)).toHaveLength(17);
      expect(html.match(/data-scene-panel=/g)).toHaveLength(4);
      expect(html).toContain('/pilot/editor-assets/commercialLanding.js');
      expect(html).not.toMatch(/\sstyle="/);
      expect(html).toContain('class="roof-story" aria-labelledby="roof-title"');
      expect(html.match(/class="roof-step-number"/g)).toHaveLength(3);
      expect(html).toContain('srclang="en"');
      for (const anchor of ['uses', 'how', 'plans']) {
        expect(html).toContain('id="' + anchor + '"');
        if (anchor !== 'uses') expect(html).toContain('href="#' + anchor + '"');
      }
      expect(html).toContain('30');
      expect(html).toContain(packageCopy[language.locale][2]);
      expect(html).toContain('/demo/jobsite.srt');
      expect(html).toContain('/pilot/demo/?lang=');
      expect(html).toContain('content="noindex"');
      expect(html).toContain('<link rel="canonical" href="' + canonical + '">');
      expect(html).toContain('hreflang="x-default"');
      expect(html).toContain('property="og:url" content="' + canonical + '"');
      expect(html).not.toContain('undefined');
    }
  });

  it('adds an Arabic page and reciprocal alternates using the same generator', () => {
    const origin = 'https://linguistvision.example';
    const [en, es, ar] = pilotLanguages;
    const first = renderPilotSite(origin, [en, es], en.locale);
    const extended = renderPilotSite(origin, [en, es, ar], en.locale);
    const arabicFile = 'ar/' + ar.slug + '/index.html';
    const paths = [
      { locale: 'en-US', searchLanguage: 'en-US', slug: '/en-us/video-subtitles/' },
      { locale: 'es-419', searchLanguage: 'es', slug: '/es-419/subtitulos-video/' },
      { locale: 'ar', searchLanguage: 'ar', slug: '/ar/' + ar.slug + '/' },
    ];
    expect(first.has(arabicFile)).toBe(false);
    expect(extended.get(arabicFile)).toContain('<html lang="ar" dir="rtl">');
    expect(extended.get(arabicFile)).toContain(ar.heading);
    for (const { locale, slug } of paths) {
      const html = extended.get(slug.slice(1) + 'index.html');
      expect(html).toContain('<link rel="canonical" href="' + new URL(slug, origin).href + '">');
      for (const candidate of paths) {
        expect(html).toContain('hreflang="' + candidate.searchLanguage + '" href="' + new URL(candidate.slug, origin).href + '"');
      }
      expect(html).toContain('hreflang="x-default" href="' + origin + '/en-us/video-subtitles/"');
      expect(extended.get('sitemap.xml')).toContain(new URL(slug, origin).href);
      expect(html).toContain('<html lang="' + locale + '"');
    }
  });

  it('rejects incomplete, duplicate and unsafe packages before generating public routes', () => {
    const origin = 'https://linguistvision.example';
    const [en, es] = pilotLanguages;
    for (const entries of [
      [en, en],
      [en, { ...es, heading: '' }],
      [en, { ...es, slug: '../private' }],
      [en, { ...es, searchLanguage: 'es-419' }],
      [en, { ...es, searchLanguage: 'en-US' }],
      [en, { ...es, example: { ...es.example, caption: ' ' } }],
    ]) {
      expect(() => renderPilotSite(origin, entries, en.locale)).toThrow('Invalid or incomplete');
    }
  });

  it('keeps all 30 approved identities distinct without assigning unverified hreflang aliases', () => {
    expect(launchLanguages).toHaveLength(30);
    expect(new Set(launchLanguages.map(language => language.id)).size).toBe(30);
    expect(new Set(launchLanguages.map(language => language.locale)).size).toBe(30);
    const [en] = pilotLanguages;
    const cantonese = launchLanguages.find(language => language.id === 'yue')!;
    const output = renderPilotSite('https://linguistvision.example', [
      en,
      { ...en, ...cantonese, slug: 'video-subtitles' },
    ], en.locale);
    expect(output.get('yue-hant/video-subtitles/index.html')).toContain('lang="yue-Hant"');
    expect(output.get('yue-hant/video-subtitles/index.html')).not.toContain('hreflang=');
    expect(output.get('sitemap.xml')).toContain('/yue-hant/video-subtitles/');
    expect(output.get('en-us/video-subtitles/index.html')).not.toContain('hreflang="yue');
  });

  it('crawls all 30 preview routes without indexing untranslated drafts', async () => {
    const { server, origin } = await startLaunchPreview();
    try {
      const sitemap = await fetch(origin + '/sitemap.xml');
      expect(sitemap.status).toBe(200);
      expect(sitemap.headers.get('x-robots-tag')).toBe('noindex');
      expect(sitemap.headers.get('content-type')).toContain('application/xml');
      const urls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
      expect(urls).toHaveLength(30);
      expect(new Set(urls).size).toBe(30);
      const pages = await Promise.all(urls.map(async url => {
        const response = await fetch(url);
        expect(response.status).toBe(200);
        expect(response.headers.get('x-robots-tag')).toBe('noindex');
        const html = await response.text();
        expect(html).toContain('<meta name="robots" content="noindex">');
        expect(html).toContain('<link rel="canonical" href="' + url + '">');
        for (const target of urls) expect(html).toContain('href="' + target + '"');
        return html;
      }));
      for (const [index, language] of launchLanguages.entries()) {
        const html = pages[index];
        expect(html).toContain('<html lang="' + language.locale + '" dir="' + language.direction + '">');
        const localized = pilotLanguages.find(pack => pack.locale === language.locale);
        if (!localized) {
          expect(html).toContain('<div lang="en" dir="ltr">');
          expect(html).not.toContain('hreflang=');
          expect(html).not.toContain('<figure>');
          continue;
        }
        expect(html).toContain(localized.heading);
        expect(html).toContain('<figcaption>' + localized.example.heading + '</figcaption>');
        expect(html).toContain('<p>' + localized.example.caption + '</p>');
        expect(html).toContain('<bdi dir="ltr"><time datetime="PT4S">00:04</time>');
        expect(html).not.toContain('MP4');
        for (const alternate of pilotLanguages) {
          const path = '/' + alternate.locale.toLowerCase() + '/' + alternate.slug + '/';
          expect(html).toContain('hreflang="' + alternate.searchLanguage + '" href="' + new URL(path, origin).href + '"');
        }
        expect(html).toContain('hreflang="x-default" href="' + origin + '/en-us/video-subtitles/"');
      }
      expect((await fetch(origin + '/unknown/')).status).toBe(404);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('refuses an indexable release with only the pilot packages or missing review evidence', () => {
    const origin = 'https://linguistvision.example';
    expect(() => renderLaunchRelease(origin, pilotLanguages, [])).toThrow('all 10');
    const [en] = pilotLanguages;
    const fixtures = firstReleaseLanguages.map(language => ({ ...en, ...language }));
    const incomplete = firstReleaseLanguages.map(language => ({
      locale: language.locale,
      copyReview: 'synthetic test record',
      transcriptionReview: language.id === 'vi' ? '' : 'synthetic test record',
    }));
    expect(() => renderLaunchRelease(origin, fixtures, incomplete)).toThrow('vi');
    const complete = incomplete.map(review => ({ ...review, transcriptionReview: 'synthetic test record' }));
    const missingExample = fixtures.map(language => language.id === 'vi' ? { ...language, example: undefined } : language);
    expect(() => renderLaunchRelease(origin, missingExample, complete)).toThrow('vi');
  });

  it('renders reciprocal alternates for all supported search codes in a complete release fixture', () => {
    const origin = 'https://linguistvision.example';
    const fixtures = pilotLanguages;
    const evidence = fixtures.map(({ locale }) => ({
      locale, copyReview: 'fixture only', transcriptionReview: 'fixture only',
    }));
    expect(() => renderLaunchRelease(origin, fixtures, evidence)).toThrow('commercial offer');
    const files = renderLaunchRelease(origin, fixtures, evidence, {
      maxFileMiB: 1, maxDurationSeconds: 30,
      capabilities: Object.fromEntries(fixtures.map(({ locale }) => [locale, 'SRT'])),
      supportUrl: origin + '/support/', privacyUrl: origin + '/privacy/', termsUrl: origin + '/terms/',
    });
    const expected = fixtures.filter(language => language.searchLanguage !== null).map(language => ({
      code: language.searchLanguage,
      url: new URL('/' + language.locale.toLowerCase() + '/' + language.slug + '/', origin).href,
    }));
    expect(expected).toHaveLength(10);
    expect(files.size).toBe(12);
    expect(files.get('robots.txt')).toContain('User-agent: OAI-SearchBot\nDisallow: /pilot/');
    expect(files.get('sitemap.xml')).not.toContain('/yue-hant/');
    for (const language of fixtures) {
      const route = '/' + language.locale.toLowerCase() + '/' + language.slug + '/';
      const html = files.get(route.slice(1) + 'index.html');
      const url = new URL(route, origin).href;
      expect(html).toContain('<link rel="canonical" href="' + url + '">');
      expect(html).not.toContain('content="noindex"');
      expect(html).not.toContain(language.descriptionOfPilot);
      if (language.locale !== 'es-419') expect(html).toContain('/demo/jobsite.srt');
      expect(html).toContain('/pilot/register/');
      expect(files.get('sitemap.xml')).toContain('<loc>' + url + '</loc>');
      if (language.searchLanguage === null) {
        expect(html).not.toContain('hreflang=');
      } else {
        for (const { code, url } of expected) expect(html).toContain('hreflang="' + code + '" href="' + url + '"');
        expect(html).toContain('hreflang="x-default" href="' + origin + '/en-us/video-subtitles/"');
      }
    }
  });
});
