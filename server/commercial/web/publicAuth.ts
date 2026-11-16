import { initializeApp } from 'firebase/app';
import { browserSessionPersistence, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, onIdTokenChanged,
  reload, sendEmailVerification, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword,
  signInWithPopup, signOut, type User } from 'firebase/auth';
import { firebaseCopy } from '../firebaseCopy';
import { mountAccountPanel } from './accountPanel';
import { createPublicAuthFence, finishPublicSignOut, publicAuthLabels, publicAuthLocation, publicAuthPath,
  publicEmailReturnUrl, requirePublicAuthOrigin, validatePublicAuthConfig } from './publicAuthModel';

export { validatePublicAuthConfig, publicAuthLocation, publicEmailReturnUrl, createPublicAuthFence, finishPublicSignOut } from './publicAuthModel';

export async function startPublicAuth() {
  const node = (id: string) => document.getElementById(id);
  const show = (id: string, visible: boolean) => { const element = node(id); if (element) element.hidden = !visible; };
  const text = (id: string, value: string) => { const element = node(id); if (element) element.textContent = value; };
  const panelRoot = node('account-workspace');
  let panel: ReturnType<typeof mountAccountPanel> | null = null;
  const controls = () => [...document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')].filter(element => !panelRoot?.contains(element));
  const clearDetails = (preservePanel = false) => {
    if (!preservePanel) panel?.setUser(null);
    for (const id of ['public-name', 'public-email', 'public-verification']) text(id, '');
    for (const id of ['public-account', 'auth-verification', 'public-session']) show(id, false);
    for (const input of document.querySelectorAll<HTMLInputElement>('input')) if (!panelRoot?.contains(input)) input.value = '';
  };
  controls().forEach(element => { element.disabled = true; });
  clearDetails();
  let route: ReturnType<typeof publicAuthLocation>;
  try {
    requirePublicAuthOrigin(location.origin);
    route = publicAuthLocation(location.pathname);
    if (document.body.dataset.authPage !== route.page || document.body.dataset.publicLocale !== route.locale) throw new Error('route_mismatch');
  } catch { return; }
  const labels = publicAuthLabels(route.language.id), messages = firebaseCopy[route.language.id];
  if (route.page === 'account' && panelRoot) panel = mountAccountPanel(panelRoot, route.language.id);
  const status = (message: string, error = false) => {
    text('auth-message', message);
    node('auth-message')?.classList.toggle('error', error);
    node('auth-message')?.setAttribute('role', error ? 'alert' : 'status');
  };
  const fence = createPublicAuthFence();
  let ready = false, busy = false, signingOut = false;
  let activeAction: Promise<void> | null = null;
  try {
    const response = await fetch('/__/firebase/init.json', { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('config_unavailable');
    const serialized = await response.text();
    if (serialized.length > 16384) throw new Error('invalid_auth_config');
    const auth = getAuth(initializeApp(validatePublicAuthConfig(JSON.parse(serialized)), 'vistavo-public-auth'));
    auth.languageCode = route.language.id === 'cmn' ? 'zh-CN' : route.language.id === 'pt' ? 'pt-BR' : route.language.id;
    // No form or popup is enabled before the required session persistence resolves.
    await setPersistence(auth, browserSessionPersistence);
    const provider = new GoogleAuthProvider();
    const actionSettings = { url: publicEmailReturnUrl(route.locale) };
    const updateControls = () => {
      controls().forEach(element => { element.disabled = !ready || busy || signingOut; });
      const exit = node('public-signout') as HTMLButtonElement | null;
      if (exit) exit.disabled = !ready || signingOut;
    };
    const forms = (visible: boolean) => {
      for (const id of ['auth-google', 'auth-form']) show(id, visible);
      for (const element of document.querySelectorAll<HTMLElement>('.auth-divider,.next')) element.hidden = !visible;
    };
    const renderUser = (user: User | null) => {
      clearDetails(true);
      if (user && (!fence.permitsUser() || auth.currentUser?.uid !== user.uid)) user = null;
      panel?.setUser(user?.emailVerified ? user : null);
      if (!user) {
        forms(true); show('public-guest', route.page === 'account'); return;
      }
      show('public-guest', false); show('public-session', true);
      if (route.page === 'account') {
        // Profile remains Auth-only; the separate panel uses the verified account API.
        text('public-name', user.displayName || labels.noName);
        text('public-email', user.email || labels.noName);
        text('public-verification', user.emailVerified ? labels.verified : labels.unverified);
        show('public-account', true);
      }
      if (route.page !== 'forgot') {
        forms(false);
        show('auth-verification', !user.emailVerified);
        status(user.emailVerified ? '' : messages[0]);
      }
      if (user.emailVerified && (route.page === 'sign-in' || route.page === 'register')) location.assign(publicAuthPath(route.locale, 'account'));
    };
    const failed = (error: unknown) => {
      const code = (error as { code?: string })?.code;
      status(code === 'auth/popup-blocked' ? labels.popupBlocked :
        code === 'auth/account-exists-with-different-credential' ? labels.existingMethod :
        code === 'auth/popup-closed-by-user' ? messages[10] : messages[5], true);
    };
    const runAction = (mode: 'sign-in' | 'account' | 'public', task: (ticket: number) => Promise<void>) => {
      if (!ready || busy || signingOut) return;
      const ticket = mode === 'sign-in' ? fence.beginSignIn() : mode === 'public' ? fence.beginPublicAction() : fence.current();
      busy = true; updateControls(); status('');
      // Calling task synchronously keeps signInWithPopup inside the direct submit gesture.
      let operation: Promise<void>;
      try { operation = task(ticket); } catch (error) { operation = Promise.reject(error); }
      const tracked = operation.catch(error => { if (mode === 'public' ? fence.matchesAction(ticket) : fence.isCurrent(ticket)) failed(error); }).finally(() => {
        if (activeAction === tracked) { activeAction = null; busy = false; updateControls(); }
      });
      activeAction = tracked;
    };
    text('auth-resend', messages[1]); text('auth-check', messages[2]); text('public-signout', messages[3]);
    node('auth-google')?.addEventListener('submit', event => {
      event.preventDefault();
      runAction('sign-in', () => signInWithPopup(auth, provider).then(() => undefined));
    });
    node('auth-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement), email = String(form.get('email') ?? '').trim(), password = String(form.get('password') ?? '');
      runAction(route.page === 'forgot' ? 'public' : 'sign-in', async ticket => {
        if (route.page === 'forgot') {
          try { await sendPasswordResetEmail(auth, email, actionSettings); } catch { /* Same message for every account state. */ }
          if (fence.matchesAction(ticket)) status(messages[4]);
        } else if (route.page === 'register') {
          const result = await createUserWithEmailAndPassword(auth, email, password);
          if (!fence.isCurrent(ticket) || auth.currentUser?.uid !== result.user.uid) return;
          try { await sendEmailVerification(result.user, actionSettings); }
          catch { if (fence.isCurrent(ticket) && auth.currentUser?.uid === result.user.uid) status(labels.createdEmailFailed, true); }
        } else { await signInWithEmailAndPassword(auth, email, password); }
      });
    });
    node('auth-resend')?.addEventListener('click', () => runAction('account', async ticket => {
      const user = auth.currentUser; if (!user || !fence.permitsUser()) return;
      await sendEmailVerification(user, actionSettings);
      if (fence.isCurrent(ticket) && auth.currentUser?.uid === user.uid) status(messages[0]);
    }));
    node('auth-check')?.addEventListener('click', () => runAction('account', async ticket => {
      const user = auth.currentUser; if (!user || !fence.permitsUser()) return;
      await reload(user);
      if (!fence.isCurrent(ticket) || auth.currentUser?.uid !== user.uid) return;
      await user.getIdToken(true);
      if (fence.isCurrent(ticket) && auth.currentUser?.uid === user.uid) renderUser(user);
    }));
    node('public-signout')?.addEventListener('click', () => {
      if (!ready || signingOut) return;
      const pending = activeAction;
      signingOut = true;
      void finishPublicSignOut({
        hideImmediately: () => { fence.beginSignOut(); clearDetails(); forms(false); show('public-guest', route.page === 'account'); status(''); updateControls(); },
        signOut: () => signOut(auth), pending, hasUser: () => auth.currentUser !== null,
        failed: () => { status(labels.logoutFailed, true); show('public-session', true); },
      }).finally(() => { signingOut = false; if (auth.currentUser === null) { forms(true); show('public-session', false); } updateControls(); });
    });
    onIdTokenChanged(auth, user => {
      ready = true;
      if (user === null || fence.permitsUser()) { status(''); renderUser(user); }
      updateControls();
    }, () => { ready = false; clearDetails(); status(labels.initFailed, true); updateControls(); });
  } catch {
    ready = false; clearDetails(); controls().forEach(element => { element.disabled = true; }); status(labels.initFailed, true);
  }
}

if (typeof document !== 'undefined') void startPublicAuth();
