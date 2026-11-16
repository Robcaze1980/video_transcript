import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { firstReleaseLanguages } from '../../config/launchLanguages';
import { renderAccountAccess } from './accountPages';
import { publicAuthPage, publicAuthRoute } from './publicAuthPages';
import { createPublicAuthFence, finishPublicSignOut, publicAuthLabels, publicAuthLocation, publicAuthPath,
  publicEmailReturnUrl, requirePublicAuthOrigin, validatePublicAuthConfig, type PublicAuthPage } from './web/publicAuthModel';

const web = () => ({ apiKey: 'AIza' + 'x'.repeat(35), projectId: 'vistavo-prod',
  appId: '1:107404655346:web:15c4589a314cf3e4d9ae6b', authDomain: 'vistavo-prod.firebaseapp.com' });

describe('permanent public Auth boundary', () => {
  it('accepts only the confirmed production identity and projects only four public fields', () => {
    expect(validatePublicAuthConfig({ ...web(), databaseURL: 'https://ignored.invalid', storageBucket: 'ignored',
      measurementId: 'ignored', arbitrary: { token: 'must not propagate' } })).toEqual(web());
    for (const value of [null, [], {}, { ...web(), projectId: 'other' }, { ...web(), appId: 'other' },
      { ...web(), authDomain: 'attacker.invalid' }, { ...web(), apiKey: '<script>' }, Object.create(web())]) {
      expect(() => validatePublicAuthConfig(value)).toThrow();
    }
    for (const key of ['emulator', 'authEmulatorHost', 'useEmulator', 'emulatorConfig']) {
      expect(() => validatePublicAuthConfig({ ...web(), [key]: false })).toThrow('emulator_forbidden');
    }
  });

  it('allows the canonical production origin and the exact approved preview only', () => {
    for (const origin of ['https://vistavo.app', 'http://127.0.0.1:3001']) expect(() => requirePublicAuthOrigin(origin)).not.toThrow();
    for (const origin of ['http://vistavo.app', 'https://www.vistavo.app', 'https://vistavo.app.attacker.invalid',
      'https://vistavo.app:444', 'http://127.0.0.1:3002', 'http://localhost:3001', 'https://vistavo-prod.web.app',
      'https://user@vistavo.app', 'https://vistavo.app/']) expect(() => requirePublicAuthOrigin(origin)).toThrow();
  });

  it('maps exactly ten locale routes and fixes email continuation to production without next-url input', () => {
    expect(firstReleaseLanguages).toHaveLength(10);
    const pages: PublicAuthPage[] = ['sign-in', 'register', 'forgot', 'account'];
    for (const language of firstReleaseLanguages) {
      const locale = language.locale.toLowerCase();
      for (const page of pages) {
        const route = publicAuthRoute(language, page);
        expect(route).toBe(publicAuthPath(locale, page));
        expect(publicAuthLocation(route)).toMatchObject({ page, locale, language });
      }
      expect(publicEmailReturnUrl(locale)).toBe('https://vistavo.app/acceso/' + locale + '/');
      expect(Object.values(publicAuthLabels(language.id)).every(value => typeof value === 'string' && value.length > 0)).toBe(true);
    }
    for (const locale of ['es-419?next=https://evil.invalid', '//evil.invalid', '../en-us', 'en-US', 'unsupported']) {
      expect(() => publicEmailReturnUrl(locale)).toThrow();
    }
    for (const path of ['/cuenta/es-419/?next=https://evil.invalid', '/cuenta/es-419/extra', '/cuenta/%2e%2e/', '/cuenta/ES-419/']) {
      expect(() => publicAuthLocation(path)).toThrow();
    }
  });

  it('blocks stale completion and observer redisplay after local sign-out until a deliberate new sign-in', () => {
    const fence = createPublicAuthFence();
    const pendingLogin = fence.beginSignIn();
    expect(fence.isCurrent(pendingLogin)).toBe(true);
    fence.beginSignOut();
    expect(fence.isCurrent(pendingLogin)).toBe(false);
    expect(fence.permitsUser()).toBe(false);
    const fresh = fence.beginSignIn();
    expect(fence.permitsUser()).toBe(true);
    expect(fence.isCurrent(fresh)).toBe(true);
    expect(fence.isCurrent(pendingLogin)).toBe(false);
  });

  it('permits only the latest deliberate public response after logout without rearming account access', () => {
    const fence = createPublicAuthFence();
    const login = fence.beginSignIn(); fence.beginSignOut();
    const first = fence.beginPublicAction();
    expect(fence.matchesAction(first)).toBe(true);
    expect(fence.isCurrent(first)).toBe(false); expect(fence.permitsUser()).toBe(false);
    expect(fence.isCurrent(login)).toBe(false);
    const second = fence.beginPublicAction();
    expect(fence.matchesAction(first)).toBe(false); expect(fence.matchesAction(second)).toBe(true);
    expect(fence.permitsUser()).toBe(false);
    fence.beginSignOut(); expect(fence.matchesAction(second)).toBe(false);
    const freshLogin = fence.beginSignIn();
    expect(fence.isCurrent(freshLogin)).toBe(true); expect(fence.matchesAction(second)).toBe(false);
  });

  it('hides details before a rejected SDK sign-out and reports the failure', async () => {
    const order: string[] = [];
    const result = finishPublicSignOut({ hideImmediately: () => { order.push('hidden'); },
      signOut: async () => { order.push('sdk'); throw Error('offline'); }, pending: null,
      hasUser: () => false, failed: () => { order.push('error'); } });
    expect(order).toEqual(['hidden', 'sdk']);
    expect(await result).toBe(false);
    expect(order).toEqual(['hidden', 'sdk', 'error']);
  });

  it('drains an older sign-in and clears a late SDK session without reopening the view', async () => {
    let release!: () => void, currentUser = true;
    const pending = new Promise<void>(resolve => { release = resolve; }).then(() => { currentUser = true; });
    const clear = vi.fn(), failed = vi.fn();
    const sdk = vi.fn(async () => { currentUser = false; });
    const result = finishPublicSignOut({ hideImmediately: clear, signOut: sdk, pending,
      hasUser: () => currentUser, failed });
    expect(clear).toHaveBeenCalledOnce(); expect(sdk).toHaveBeenCalledOnce();
    release();
    expect(await result).toBe(true);
    expect(sdk).toHaveBeenCalledTimes(2); expect(currentUser).toBe(false); expect(failed).not.toHaveBeenCalled();
  });
});

describe('public Auth HTML and approved artwork', () => {
  it('starts all forty pages closed with static-only routes, no profile data and no submit handlers', () => {
    for (const language of firstReleaseLanguages) for (const page of ['sign-in', 'register', 'forgot', 'account'] as const) {
      const html = publicAuthPage(language, page);
      expect(html).not.toMatch(/\/pilot\/|\/api\/|on(?:click|submit)=|localStorage|unidades ficticias|saldo/i);
      expect(html).not.toMatch(/<button\b(?![^>]*\bdisabled\b)/);
      expect(html).not.toMatch(/<input\b(?![^>]*\bdisabled\b)/);
      expect(html).toContain('data-public-locale="' + language.locale.toLowerCase() + '"');
      expect(html).toContain('data-vistavo-brand="a3"');
      expect(html).toContain('/assets/publicAuth.js'); expect(html).toContain('/assets/publicAuth.css');
      expect(html).not.toContain('photoURL');
      if (page === 'account') {
        expect(html).toContain('<div id="public-account" hidden>');
        expect(html).toContain('<div id="public-guest" hidden>');
        expect(html).toContain('<dd id="public-name"></dd>');
        expect(html).toContain('<dd id="public-email" dir="ltr"></dd>');
      }
    }
    const language = firstReleaseLanguages[0];
    expect(() => publicAuthPage({ ...language, locale: '"><svg onload=alert(1)>' } as unknown as typeof language, 'sign-in')).toThrow();
    expect(() => publicAuthPage({ ...language, direction: 'rtl" onload="bad' } as unknown as typeof language, 'account')).toThrow();
    expect(() => publicAuthPage(language, 'reset' as PublicAuthPage)).toThrow();
  });

  it('preserves the original official Google SVG and button structure for sign-in and sign-up in all ten languages', () => {
    for (const language of firstReleaseLanguages) for (const page of ['sign-in', 'register'] as const) {
      const original = renderAccountAccess(language, page, undefined, true), current = publicAuthPage(language, page);
      const icon = (html: string) => html.match(/<span class="gsi-material-button-icon">([\s\S]*?)<\/span>/)![1];
      expect(icon(current)).toBe(icon(original));
      for (const name of ['gsi-material-button-state', 'gsi-material-button-content-wrapper', 'gsi-material-button-contents']) expect(current).toContain('class="' + name + '"');
      expect(current).toContain('type="submit" class="gsi-material-button"');
    }
  });

  it('retains the entire approved CSS as a prefix without changing Google colours or ratios', async () => {
    const [original, current] = await Promise.all([fs.readFile('server/commercial/web/account.css', 'utf8'), fs.readFile('server/commercial/web/publicAuth.css', 'utf8')]);
    expect(current.startsWith(original)).toBe(true);
    expect(current.slice(original.length)).not.toMatch(/\.gsi-material-button/);
  });

  it('does not initialize Firebase or make requests when the module is imported outside a browser', async () => {
    const request = vi.spyOn(globalThis, 'fetch');
    try { await import('./web/publicAuth'); expect(request).not.toHaveBeenCalled(); }
    finally { request.mockRestore(); }
  });
});
