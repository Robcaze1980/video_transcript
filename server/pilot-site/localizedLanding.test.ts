import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { claudeLandingEsBody } from './claudeLandingEs';
import { landingSlots, landingSourceHash } from './landingSlots';
import { landingCatalogs } from './landingCatalogs';
import { renderLocalizedLanding, validateLandingCopy, validateLandingTemplate } from './localizedLanding';
import { pilotLanguages } from './languages';

describe('localized approved landing', () => {
  it('preserves the approved Spanish design apart from the authorized brand and fails on template drift', () => {
    // Independently recorded from the Spanish version Rob accepted before this phase.
    expect(createHash('sha256').update(claudeLandingEsBody.replaceAll('Vistavo', 'LinguistVision')).digest('hex')).toBe('019ccc5ffa450d4d8108a64302acf70097dea501436feb6caac3794284cbf1ff');
    expect(claudeLandingEsBody).toContain('Vistavo');
    expect(claudeLandingEsBody).not.toContain('LinguistVision');
    expect(() => validateLandingTemplate(claudeLandingEsBody + 'changed', landingSlots, landingSourceHash)).toThrow('template changed');
    expect(() => validateLandingTemplate(claudeLandingEsBody, [landingSlots[0], landingSlots[0]], landingSourceHash)).toThrow('overlapping');
  });

  it('rejects missing strings, altered prices and missing language names without fallback', () => {
    const copy = structuredClone(landingCatalogs['en-US']);
    delete copy.strings.t000;
    expect(() => renderLocalizedLanding(copy)).toThrow('Missing or extra');
    const price = structuredClone(landingCatalogs['en-US']);
    price.strings.t225 = price.strings.t225.replace('US$5', 'US$6');
    expect(() => validateLandingCopy(price)).toThrow();
    const swapped = structuredClone(landingCatalogs['en-US']);
    swapped.strings.t225 = swapped.strings.t225.replace('US$1', 'US$x').replace('US$5', 'US$1').replace('US$x', 'US$5');
    expect(() => validateLandingCopy(swapped)).toThrow('USD');
    const missingName = structuredClone(landingCatalogs['en-US']);
    delete missingName.languageNames.ar;
    expect(() => validateLandingCopy(missingName)).toThrow('language name');
  });

  it('checks structured fields for bidi overrides and allows grammatical empty fragments', () => {
    const bad = structuredClone(landingCatalogs['en-US']);
    bad.headline.before += '\u202E';
    expect(() => validateLandingCopy(bad)).toThrow('Unsafe');
    expect(() => validateLandingCopy(landingCatalogs.ko)).not.toThrow();
    expect(() => validateLandingCopy(landingCatalogs.ja)).not.toThrow();
    const absentArticle = structuredClone(landingCatalogs.ja);
    delete absentArticle.strings.t102;
    expect(() => validateLandingCopy(absentArticle)).toThrow('Missing or extra');
    const japanese = renderLocalizedLanding(landingCatalogs.ja).replace(/<[^>]+>/g, '');
    expect(japanese).toContain('所有者は、英語での説明を理解する必要があります。');
    expect(japanese).toContain('膜が縦樋のそばで約5 cm浮いています。');
    const korean = renderLocalizedLanding(landingCatalogs.ko).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    expect(korean).toContain('그 멤브레인이 배수관 옆에서 약 5cm 들려 있습니다.');
  });

  it('escapes model text in both text nodes and attributes, while keeping URLs code-owned', () => {
    const copy = structuredClone(landingCatalogs['en-US']);
    // Number-free payloads keep this check independent of numeric condition validation.
    copy.strings.t000 = '<img src=x onerror="alert()">';
    copy.strings.t002 = '" onmouseover="alert()';
    const html = renderLocalizedLanding(copy);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert()&quot;&gt;');
    expect(html).toContain('aria-label="&quot; onmouseover=&quot;alert()"');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('aria-label="" onmouseover=');
    expect(html).toContain('href="/pilot/register/?lang=en"');
  });

  for (const language of pilotLanguages.filter(item => item.locale !== 'es-419')) {
    it('renders complete content and relative destinations for ' + language.locale, () => {
      const copy = landingCatalogs[language.locale];
      const html = renderLocalizedLanding(copy);
      expect(html.match(/data-scene-panel=/g)).toHaveLength(4);
      expect(html.match(/data-illustrative-video=/g)).toHaveLength(8);
      expect(html.match(/data-faq-category=/g)).toHaveLength(16);
      expect(html.match(/class="lrow"/g)).toHaveLength(9);
      expect(html.match(/<option [^>]* selected>/g)).toHaveLength(1);
      expect(html).toContain('/pilot/register/?lang=' + language.id);
      const target = language.locale === 'en-US' ? 'es' : 'en';
      expect(html).toContain('lang="' + target + '" dir="ltr"');
      expect(html).toContain('lang="' + language.locale + '" dir="' + language.direction + '"');
      expect(html).toContain('inspeccion-robles-214.' + target + '.mp4');
      expect(html).toContain('tutorial-sellado.' + language.id + '.srt');
      expect(html).not.toContain('{{');
      expect(html).not.toContain('undefined');
      expect(html).not.toMatch(/\s(?:style|on\w+)="/);
      expect(html).not.toContain('Un ejemplo: inspección de techos');
      const demoNav = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)!.find(nav => nav.includes('/pilot/demo/'))!;
      const hrefs = [...demoNav.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
      expect(hrefs).toHaveLength(6);
      expect(new Set(hrefs).size).toBe(6);
    });
  }
});
