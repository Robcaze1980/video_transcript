import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  auth: { currentUser: null as any, languageCode: '' },
  observe: null as null | ((user: any) => void),
  initialize: vi.fn(), persistence: vi.fn(), popup: vi.fn(), email: vi.fn(), create: vi.fn(), verify: vi.fn(), reset: vi.fn(), logout: vi.fn(), reload: vi.fn(),
}));
vi.mock('firebase/app', () => ({ initializeApp: sdk.initialize }));
vi.mock('firebase/auth', () => ({
  browserSessionPersistence: 'session', getAuth: () => sdk.auth, setPersistence: sdk.persistence,
  GoogleAuthProvider: class {}, signInWithPopup: sdk.popup, signInWithEmailAndPassword: sdk.email,
  createUserWithEmailAndPassword: sdk.create, sendEmailVerification: sdk.verify,
  sendPasswordResetEmail: sdk.reset, signOut: sdk.logout, reload: sdk.reload,
  onIdTokenChanged: (_auth: unknown, callback: (user: any) => void) => { sdk.observe = callback; return () => undefined; },
}));

// No document at import: actual entrypoint remains inert until explicitly started below.
import { startPublicAuth } from './web/publicAuth';

class Element {
  hidden = false;
  disabled = true;
  value = '';
  textContent = '';
  listeners = new Map<string, (event: any) => void>();
  attributes = new Map<string, string>();
  classList = { toggle: vi.fn() };
  constructor(readonly id: string) {}
  set innerHTML(_value: string) { throw Error('HTML sink must never receive profile data'); }
  addEventListener(name: string, callback: (event: any) => void) { this.listeners.set(name, callback); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  emit(name: string) { const preventDefault = vi.fn(); this.listeners.get(name)?.({ currentTarget: this, preventDefault }); return preventDefault; }
}

let nodes: Map<string, Element>, location: { origin: string; pathname: string; search: string; assign: ReturnType<typeof vi.fn> };
const get = (id: string) => nodes.get(id)!;
const web = () => ({ apiKey: 'AIza' + 'x'.repeat(35), projectId: 'vistavo-prod', appId: '1:107404655346:web:15c4589a314cf3e4d9ae6b', authDomain: 'vistavo-prod.firebaseapp.com' });
const user = (verified = false) => ({ uid: 'synthetic-unit-user', displayName: '<img src=x onerror=bad()>', email: 'unit@example.invalid', emailVerified: verified, getIdToken: vi.fn(async () => 'unused-unit-token') });
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function setup(page: 'account' | 'register' | 'sign-in' | 'forgot' = 'account') {
  nodes = new Map(['auth-message', 'auth-google', 'auth-form', 'auth-verification', 'auth-resend', 'auth-check', 'public-signout', 'public-session',
    'public-account', 'public-name', 'public-email', 'public-verification', 'public-guest', 'email', 'password', 'divider', 'next'].map(id => [id, new Element(id)]));
  location = { origin: 'https://vistavo.app', pathname: ({ account: '/cuenta/', register: '/registro/', 'sign-in': '/acceso/', forgot: '/recuperar/' })[page] + 'es-419/', search: '?next=https://attacker.invalid', assign: vi.fn() };
  vi.stubGlobal('location', location);
  const controls = ['auth-resend', 'auth-check', 'public-signout', 'email', 'password'].map(get);
  vi.stubGlobal('document', {
    body: { dataset: { authPage: page, publicLocale: 'es-419' } },
    getElementById: (id: string) => nodes.get(id) ?? null,
    querySelectorAll: (selector: string) => selector === 'input,button' ? controls : selector === 'input' ? [get('email'), get('password')] : [get('divider'), get('next')],
  });
  vi.stubGlobal('FormData', class { values = new Map([['email', get('email').value], ['password', get('password').value]]); get(key: string) { return this.values.get(key); } });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ ...web(), databaseURL: 'ignored-extra' }) })));
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.auth.currentUser = null; sdk.observe = null;
  sdk.persistence.mockImplementation(async () => undefined);
  sdk.logout.mockImplementation(async () => { sdk.auth.currentUser = null; sdk.observe?.(null); });
  sdk.popup.mockResolvedValue({ user: user(true) }); sdk.email.mockResolvedValue({ user: user() });
  sdk.create.mockResolvedValue({ user: user() }); sdk.verify.mockResolvedValue(undefined); sdk.reset.mockResolvedValue(undefined); sdk.reload.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('actual public Auth controller with isolated SDK/DOM doubles', () => {
  it('keeps controls disabled until persistence and the initial Auth observation; unauthenticated account stays empty', async () => {
    setup(); let release!: () => void;
    sdk.persistence.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const initializing = startPublicAuth(); await flush();
    expect(get('email').disabled).toBe(true); expect(sdk.observe).toBeNull();
    release(); await initializing;
    expect(sdk.persistence).toHaveBeenCalledWith(sdk.auth, 'session');
    expect(get('email').disabled).toBe(true);
    sdk.observe!(null);
    expect(get('public-guest').hidden).toBe(false); expect(get('public-account').hidden).toBe(true);
    expect(get('public-email').textContent).toBe(''); expect(get('email').disabled).toBe(false);
    expect(sdk.initialize).toHaveBeenCalledWith(web(), 'vistavo-public-auth');
  });

  it('fails closed on invalid Hosting configuration without starting Firebase', async () => {
    setup('sign-in'); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ ...web(), projectId: 'other' }) })));
    await startPublicAuth();
    expect(sdk.initialize).not.toHaveBeenCalled(); expect(sdk.persistence).not.toHaveBeenCalled();
    expect(get('email').disabled).toBe(true); expect(get('auth-message').textContent).toContain('No se pudo iniciar');
  });

  it('initiates the Google popup in the immediate submit gesture and reports blocked popup without redirect fallback', async () => {
    setup('sign-in'); await startPublicAuth(); sdk.observe!(null); let gesture = true;
    sdk.popup.mockImplementation(() => { expect(gesture).toBe(true); return Promise.reject({ code: 'auth/popup-blocked' }); });
    expect(get('auth-google').emit('submit')).toHaveBeenCalledOnce(); gesture = false; await flush();
    expect(sdk.popup).toHaveBeenCalledOnce(); expect(sdk.persistence).toHaveBeenCalledOnce();
    expect(get('auth-message').textContent).toContain('ventana emergente'); expect(location.assign).not.toHaveBeenCalled();
  });

  it('uses textContent for actual Auth fields and hides them synchronously even when logout fails', async () => {
    setup(); await startPublicAuth(); const current = user(true); sdk.auth.currentUser = current; sdk.observe!(current);
    expect(get('public-name').textContent).toBe(current.displayName); expect(get('public-account').hidden).toBe(false);
    sdk.logout.mockRejectedValue(Error('unavailable'));
    get('public-signout').emit('click');
    expect(get('public-name').textContent).toBe(''); expect(get('public-email').textContent).toBe(''); expect(get('public-account').hidden).toBe(true);
    await flush(); expect(get('auth-message').textContent).toContain('No pudimos cerrar');
    sdk.observe!(current); expect(get('public-name').textContent).toBe(''); expect(get('public-account').hidden).toBe(true);
  });

  it('distinguishes account creation from failed verification-email delivery and offers resend without duplicate creation', async () => {
    setup('register'); await startPublicAuth(); sdk.observe!(null);
    get('email').value = 'unit@example.invalid'; get('password').value = 'synthetic-only-password';
    const current = user(false);
    sdk.create.mockImplementation(async () => { sdk.auth.currentUser = current; sdk.observe!(current); return { user: current }; });
    sdk.verify.mockRejectedValue(Error('mail unavailable'));
    get('auth-form').emit('submit'); await flush();
    expect(sdk.create).toHaveBeenCalledOnce(); expect(get('auth-verification').hidden).toBe(false);
    expect(get('auth-message').textContent).toContain('Tu cuenta se creó'); expect(location.assign).not.toHaveBeenCalled();
    sdk.verify.mockResolvedValue(undefined); get('auth-resend').emit('click'); await flush();
    expect(sdk.create).toHaveBeenCalledOnce(); expect(sdk.verify).toHaveBeenCalledTimes(2);
    expect(sdk.verify.mock.calls[0][1]).toEqual({ url: 'https://vistavo.app/acceso/es-419/' });
  });

  it.each(['auth/user-not-found', 'auth/too-many-requests'])('keeps password recovery neutral for %s and ignores arbitrary continuation parameters', async code => {
    setup('forgot'); await startPublicAuth(); sdk.observe!(null); get('email').value = 'unit@example.invalid';
    sdk.reset.mockRejectedValue({ code }); get('auth-form').emit('submit'); await flush();
    expect(get('auth-message').textContent).toBe('Si la cuenta es válida, recibirás un correo de recuperación.');
    expect(sdk.reset).toHaveBeenCalledWith(sdk.auth, 'unit@example.invalid', { url: 'https://vistavo.app/acceso/es-419/' });
    expect(fetch).toHaveBeenCalledTimes(1); expect(location.assign).not.toHaveBeenCalled();
  });

  it.each(['resolved', 'rejected'])('shows neutral recovery after authenticated recovery-page logout when reset is %s without restoring the old session', async outcome => {
    setup('forgot'); await startPublicAuth();
    const oldUser = user(true); sdk.auth.currentUser = oldUser; sdk.observe!(oldUser);
    expect(get('public-session').hidden).toBe(false);
    get('public-signout').emit('click'); await flush();
    expect(sdk.auth.currentUser).toBeNull(); expect(get('public-session').hidden).toBe(true);
    expect(get('email').disabled).toBe(false);
    get('email').value = 'unit@example.invalid';
    if (outcome === 'resolved') sdk.reset.mockResolvedValue(undefined);
    else sdk.reset.mockRejectedValue({ code: 'auth/user-not-found' });
    get('auth-form').emit('submit'); await flush();
    expect(sdk.reset).toHaveBeenCalledOnce();
    expect(get('auth-message').textContent).toBe('Si la cuenta es válida, recibirás un correo de recuperación.');
    expect(sdk.popup).not.toHaveBeenCalled(); expect(sdk.email).not.toHaveBeenCalled(); expect(sdk.create).not.toHaveBeenCalled();
    // A delayed SDK user must not regain view permission just because a public reset action ran.
    sdk.auth.currentUser = oldUser; sdk.observe!(oldUser);
    expect(get('public-session').hidden).toBe(true); expect(get('public-account').hidden).toBe(true);
    expect(get('public-name').textContent).toBe(''); expect(get('public-email').textContent).toBe('');
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('refreshes verification and navigates only to the fixed own-account route', async () => {
    setup('sign-in'); await startPublicAuth(); const current = user(false); sdk.auth.currentUser = current; sdk.observe!(current);
    sdk.reload.mockImplementation(async () => { current.emailVerified = true; });
    get('auth-check').emit('click'); await flush();
    expect(current.getIdToken).toHaveBeenCalledWith(true);
    expect(location.assign).toHaveBeenCalledWith('/cuenta/es-419/');
  });
});
