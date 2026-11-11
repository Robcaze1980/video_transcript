import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator, createUserWithEmailAndPassword, EmailAuthProvider, getAuth, getRedirectResult,
  GoogleAuthProvider, linkWithCredential, onIdTokenChanged,
  reauthenticateWithCredential, reload, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut,
  type AuthCredential, type User,
} from 'firebase/auth';

async function main() {
  const language = new URLSearchParams(location.search).get('lang') ?? 'en';
  const response = await fetch('/pilot/auth/config/?lang=' + encodeURIComponent(language));
  if (!response.ok) return;
  const { web, emulator, labels, locale } = await response.json();
  const auth = getAuth(initializeApp(web));
  if (emulator) connectAuthEmulator(auth, 'http://' + emulator, { disableWarnings: true });
  auth.languageCode = locale;
  const element = (id: string) => document.getElementById(id);
  const status = (index: number) => { const target = element('auth-message'); if (target) target.textContent = labels[index]; };
  const page = document.body.dataset.authPage;
  let pending: AuthCredential | null = null;
  let manual = false;
  let exchanging = false;
  const provider = new GoogleAuthProvider();
  const clearServer = () => fetch('/pilot/auth/logout/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const verified = async (user: User) => {
    const panel = element('auth-verification');
    if (!user.emailVerified) {
      if (panel) panel.hidden = false;
      status(0);
      return;
    }
    if (pending) {
      const button = element('auth-link') as HTMLButtonElement;
      button.hidden = false;
      status(6);
      return;
    }
    if (exchanging) return;
    exchanging = true;
    try {
      const result = await fetch('/pilot/auth/session/', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: await user.getIdToken() }) });
      if (!result.ok) { status(9); return; }
      if (page) location.assign('/pilot/?lang=' + encodeURIComponent(locale));
    } finally { exchanging = false; }
  };
  const failed = (error: unknown) => {
    const code = (error as { code?: string }).code;
    if (code === 'auth/account-exists-with-different-credential') {
      pending = GoogleAuthProvider.credentialFromError(error as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]);
      status(6);
    } else status(code === 'auth/popup-closed-by-user' ? 10 : code === 'auth/operation-not-supported-in-this-environment' ? 11 : 5);
  };
  const perform = async (task: () => Promise<void>) => {
    manual = true;
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('form button')];
    buttons.forEach(button => { button.disabled = true; });
    try { await task(); } catch (error) { failed(error); }
    finally { manual = false; buttons.forEach(button => { button.disabled = false; }); }
  };
  const popup = async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      await verified(result.user);
    } catch (error) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes((error as { code: string }).code)) {
        await signInWithRedirect(auth, provider);
      } else throw error;
    }
  };
  element('auth-google')?.addEventListener('submit', event => {
    event.preventDefault();
    void perform(() => popup());
  });
  element('auth-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void perform(async () => {
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const email = String(form.get('email') ?? '').trim();
      const password = String(form.get('password') ?? '');
      const returnUrl = location.origin + '/pilot/sign-in/?lang=' + encodeURIComponent(locale);
      if (page === 'forgot') {
        try { await sendPasswordResetEmail(auth, email, { url: returnUrl }); } catch { /* Generic response prevents account discovery. */ }
        status(4);
      } else if (page === 'register') {
        const { user } = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(user, { url: returnUrl });
        await verified(user);
      } else {
        const { user } = await signInWithEmailAndPassword(auth, email, password);
        if (pending) await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
        await verified(user);
      }
    });
  });
  if (page) {
    const link = document.createElement('button'); link.id = 'auth-link'; link.hidden = true; link.textContent = labels[7];
    element('auth-verification')?.before(link);
    link.onclick = () => void perform(async () => {
      const user = auth.currentUser;
      if (!user || !pending) return;
      const credential = pending;
      await linkWithCredential(user, credential);
      pending = null;
      await verified(user);
    });
    const resend = element('auth-resend');
    const check = element('auth-check');
    const exit = element('auth-signout');
    if (resend) { resend.textContent = labels[1]; resend.onclick = () => void perform(async () => {
      if (auth.currentUser) await sendEmailVerification(auth.currentUser, { url: location.origin + '/pilot/sign-in/?lang=' + encodeURIComponent(locale) });
      status(0);
    }); }
    if (check) { check.textContent = labels[2]; check.onclick = () => void perform(async () => {
      if (auth.currentUser) { await reload(auth.currentUser); await auth.currentUser.getIdToken(true); await verified(auth.currentUser); }
    }); }
    if (exit) { exit.textContent = labels[3]; exit.onclick = () => void perform(async () => {
      await signOut(auth); await clearServer(); location.reload();
    }); }
  } else {
    element('logout')?.addEventListener('click', () => { void signOut(auth); });
  }
  try { const result = await getRedirectResult(auth); if (result) await verified(result.user); } catch (error) { failed(error); }
  onIdTokenChanged(auth, user => {
    if (manual) return;
    if (user && (page === 'sign-in' || !page)) void verified(user).catch(failed);
    else if (!user && !page) void clearServer().then(() => location.assign('/pilot/sign-in/?lang=' + encodeURIComponent(locale)));
  });
}

void main();
