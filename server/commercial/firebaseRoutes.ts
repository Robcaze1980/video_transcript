import type { IncomingMessage, ServerResponse } from 'node:http';
import { deleteApp } from 'firebase-admin/app';
import { commercialSessionSeconds, type createAccountAccess } from './accountAccess';
import { commercialLocale } from './commercialPages';
import { firebaseIdentity, verifiedFirebaseUser, type FirebaseAccessConfig } from './firebaseAccess';
import { firebaseCopy } from './firebaseCopy';
import { renderAccountAccess, type AccessPage } from './accountPages';

export function createFirebaseRoutes(config: FirebaseAccessConfig, accounts: ReturnType<typeof createAccountAccess>,
  cookie: string, readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>) {
  const { identity, app } = firebaseIdentity(config);
  let requestCount = 0;
  let resetLimit = 0;
  const decode = async (token?: string) => {
    if (!token || token.length > 7000) return;
    try {
      const user = await identity.verifySessionCookie(token, true);
      return verifiedFirebaseUser(user) ? user : undefined;
    } catch { return; }
  };
  return {
    async userId(token?: string) { return (await decode(token))?.uid; },
    async account(token?: string) {
      const user = await decode(token);
      return user ? accounts.firebaseAccount(user.uid) : undefined;
    },
    close: async () => { if (app) await deleteApp(app); },
    async handle(req: IncomingMessage, res: ServerResponse, url: URL, origin: string, token?: string) {
      const language = commercialLocale(url.searchParams.get('lang'));
      const screen = /^\/pilot\/(register|sign-in)\/$/.exec(url.pathname)?.[1] as AccessPage | undefined;
      const forgot = url.pathname === '/pilot/auth/forgot/';
      if (req.method === 'GET' && (screen || forgot)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderAccountAccess(language, screen ?? 'forgot', undefined, true));
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/pilot/auth/config/') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          web: config.web, emulator: config.emulator, labels: firebaseCopy[language.id], locale: language.id,
        }));
        return true;
      }
      if (!['/pilot/auth/session/', '/pilot/auth/logout/'].includes(url.pathname)) {
        if (screen || url.pathname.startsWith('/pilot/auth/')) { res.writeHead(405).end(); return true; }
        return false;
      }
      if (req.method !== 'POST' || req.headers.origin !== origin ||
          !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403).end(); return true; }
      const secure = new URL(origin).protocol === 'https:' ? '; Secure' : '';
      const setSession = (session: string, ttl: number) => res.setHeader('Set-Cookie',
        `${cookie}=${session}; Path=/pilot/; HttpOnly; SameSite=Lax; Max-Age=${ttl}${secure}`);
      if (url.pathname === '/pilot/auth/logout/') {
        setSession('', 0);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
        return true;
      }
      if (Date.now() >= resetLimit) { requestCount = 0; resetLimit = Date.now() + 60_000; }
      if (requestCount++ >= 30) { res.writeHead(429).end(); return true; }
      const { idToken } = await readJson(req);
      if (typeof idToken !== 'string' || !idToken.length || idToken.length > 7000) { res.writeHead(401).end(); return true; }
      try {
        const user = await identity.verifyIdToken(idToken, true);
        if (!verifiedFirebaseUser(user)) { res.writeHead(403).end(); return true; }
        const prior = await decode(token);
        const now = Date.now() / 1000;
        if (typeof user.auth_time !== 'number' || user.auth_time > now + 60 ||
            (now - user.auth_time > 300 && prior?.uid !== user.uid)) { res.writeHead(401).end(); return true; }
        await accounts.firebaseAccount(user.uid);
        const session = await identity.createSessionCookie(idToken, { expiresIn: commercialSessionSeconds * 1000 });
        setSession(session, commercialSessionSeconds);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      } catch { res.writeHead(401).end(); }
      return true;
    },
  };
}
