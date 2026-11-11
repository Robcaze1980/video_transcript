import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { createAccountAccess } from './accountAccess';
import { commercialSessionSeconds, normalizeEmail } from './accountAccess';
import { commercialLocale } from './commercialPages';
import { createSupabaseAccess, type SupabaseAccessConfig } from './supabaseAccess';
import { renderAccountAccess, type AccessPage } from './accountPages';

const flowName = (flow: string) => 'lv_auth_' + flow;
const recoveryName = 'lv_password_reset';
const userId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function getCookie(req: IncomingMessage, name: string) {
  return req.headers.cookie?.split(';').map(item => item.trim())
    .find(item => item.startsWith(name + '='))?.slice(name.length + 1);
}

function readProof(req: IncomingMessage, flow: string, signature: (flow: string, payload: string) => Buffer) {
  try {
    const raw = getCookie(req, flowName(flow));
    if (!raw || raw.length > 3000) return;
    const separator = raw.lastIndexOf('.');
    if (separator < 0) return;
    const payload = raw.slice(0, separator);
    const received = Buffer.from(raw.slice(separator + 1), 'base64url');
    const expected = signature(flow, payload);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return;
    const proof = JSON.parse(decodeURIComponent(payload)) as { locale: string; verifier: Record<string, string> };
    if (typeof proof.locale === 'string' && proof.verifier && Object.entries(proof.verifier).every(([key, value]) =>
      /^linguistvision-auth[-\w]*-code-verifier$/.test(key) && typeof value === 'string')) return proof;
  } catch { /* Missing or invalid browser proof. */ }
}

export function createSupabaseRoutes(config: SupabaseAccessConfig, accounts: ReturnType<typeof createAccountAccess>,
  sessionName: string, readForm: (req: IncomingMessage) => Promise<URLSearchParams>) {
  const provider = createSupabaseAccess(config);
  const key = randomBytes(32);
  const sign = (flow: string, payload: string) => createHmac('sha256', key).update(flow + '\0' + payload).digest();
  let attempts = 0;
  let resetRate = 0;

  return async (req: IncomingMessage, res: ServerResponse, url: URL, origin: string, priorSession?: string) => {
    const path = url.pathname;
    const screen = /^\/pilot\/(register|sign-in)\/$/.exec(path)?.[1] as AccessPage | undefined;
    const auth = /^\/pilot\/auth\/(google|confirm|forgot|recovery|reset)\/$/.exec(path)?.[1];
    if (!screen && !auth) return false;
    let language = commercialLocale(url.searchParams.get('lang'));
    const secure = new URL(origin).protocol === 'https:' ? '; Secure' : '';
    const cookies: string[] = [];
    const setCookie = (name: string, value: string, scope: string, ttl: number) => {
      cookies.push(`${name}=${value}; Path=${scope}; HttpOnly; SameSite=Lax; Max-Age=${ttl}${secure}`);
      res.setHeader('Set-Cookie', cookies);
    };
    const redirect = (location: string) => res.writeHead(303, { Location: location }).end();
    const local = (path: string) => path + '?lang=' + language.id;
    const show = (page: AccessPage, status = 200, notice?: 'sent' | 'error' | 'updated') => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderAccountAccess(language, page, notice));
    };
    const fail = (page: AccessPage = screen ?? 'sign-in') => show(page, 422, 'error');
    const verified = async (client: ReturnType<typeof provider.client>, token: string) => {
      const { data: { user }, error } = await client.auth.getUser(token);
      return !error && user?.email_confirmed_at && userId.test(user.id) ? user.id : undefined;
    };
    const login = async (id: string) => {
      if (priorSession) await accounts.revoke(priorSession);
      setCookie(sessionName, await accounts.verifiedProviderSession(id), '/pilot/', commercialSessionSeconds);
      redirect(local('/pilot/'));
    };
    const resetToken = () => getCookie(req, recoveryName);
    const resetScope = '/pilot/auth/reset/';
    if (req.method === 'GET') {
      if (screen) show(screen);
      else if (auth === 'forgot') show('forgot');
      else if (auth === 'reset') {
        if (resetToken()) show('reset');
        else fail('forgot');
      } else if (auth) {
        const proof = readProof(req, auth, sign);
        const code = url.searchParams.get('code');
        if (proof) language = commercialLocale(proof.locale);
        setCookie(flowName(auth), '', '/pilot/auth/', 0);
        if (!proof || !code || code.length > 512) { fail(auth === 'recovery' ? 'forgot' : 'sign-in'); return true; }
        const client = provider.client(proof.verifier);
        const flowId = url.searchParams.get('sb_flow_id');
        const { data, error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
        const recovering = 'redirectType' in data && data.redirectType === 'recovery';
        if (error || !data.session || recovering !== (auth === 'recovery')) {
          fail(auth === 'recovery' ? 'forgot' : 'sign-in');
          return true;
        }
        const token = data.session.access_token;
        if (!/^[A-Za-z0-9._-]{1,3000}$/.test(token)) { fail(); return true; }
        const id = await verified(client, token);
        if (!id) fail();
        else if (auth === 'recovery') {
          await accounts.allowPasswordReset(token, id);
          setCookie(recoveryName, token, resetScope, 300);
          redirect(local(resetScope));
        } else await login(id);
      }
      return true;
    }
    if (req.method !== 'POST' || req.headers.origin !== origin) {
      res.writeHead(403).end();
      return true;
    }
    if (Date.now() >= resetRate) { attempts = 0; resetRate = Date.now() + 60_000; }
    if (attempts++ >= 30) { show(screen ?? 'sign-in', 429, 'error'); return true; }
    const form = await readForm(req);
    const email = normalizeEmail(form.get('email'));
    const password = form.get('password') ?? '';
    if (auth === 'reset') {
      if (password.length < 8 || password.length > 128) { fail('reset'); return true; }
      const token = resetToken();
      setCookie(recoveryName, '', resetScope, 0);
      const id = token ? await accounts.takePasswordReset(token) : undefined;
      if (!id || !token || !await provider.updatePassword(token, password)) fail('forgot');
      else {
        await accounts.revokeProviderSessions(id);
        show('sign-in', 200, 'updated');
      }
      return true;
    }
    let proof: Record<string, string> | undefined;
    const client = provider.client(undefined, values => { proof = values; });
    const saveProof = (flow: string) => {
      if (proof) {
        const payload = encodeURIComponent(JSON.stringify({ locale: language.id, verifier: proof }));
        setCookie(flowName(flow), payload + '.' + sign(flow, payload).toString('base64url'), '/pilot/auth/', 3600);
      }
    };
    const callback = (flow: string) => origin + '/pilot/auth/' + flow + '/';
    if (auth === 'google') {
      const { data, error } = await client.auth.signInWithOAuth({ provider: 'google',
        options: { redirectTo: callback('google'), skipBrowserRedirect: true } });
      const next = data.url ? new URL(data.url) : undefined;
      if (error || !next || next.origin !== provider.origin || next.pathname !== '/auth/v1/authorize') fail();
      else { saveProof('google'); redirect(next.href); }
    } else if (!email) fail(auth === 'forgot' ? 'forgot' : screen);
    else if (auth === 'forgot') {
      await client.auth.resetPasswordForEmail(email, { redirectTo: callback('recovery') });
      saveProof('recovery');
      show('forgot', 202, 'sent');
    } else if (!password || password.length > 128 || (screen === 'register' && password.length < 8)) fail();
    else if (screen === 'register') {
      await client.auth.signUp({ email, password, options: { emailRedirectTo: callback('confirm') } });
      saveProof('confirm');
      show('register', 202, 'sent');
    } else if (screen === 'sign-in') {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      const id = !error && data.session ? await verified(client, data.session.access_token) : undefined;
      if (id) await login(id);
      else fail();
    } else res.writeHead(405).end();
    return true;
  };
}
