import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { expect, it } from 'vitest';
import { createFirebaseRoutes } from './firebaseRoutes';

it('limits Firebase session attempts by socket peer, without trusting forwarded addresses', async () => {
  const bodies = new WeakMap<IncomingMessage, Record<string, unknown>>();
  const routes = createFirebaseRoutes({
    web: { projectId: 'linguistvision-test', apiKey: 'fixture-key', appId: 'fixture-app', authDomain: 'linguistvision-test.firebaseapp.com' },
    identity: {
      async verifyIdToken(token) {
        if (token !== 'valid') throw new Error('Invalid token');
        return { uid: 'fixture', email_verified: true, auth_time: Date.now() / 1000 } as DecodedIdToken;
      },
      async createSessionCookie() { return 'fixture-cookie'; },
      async verifySessionCookie() { throw new Error('No session'); },
    },
  }, { firebaseAccount: async () => 'fixture-account' } as unknown as Parameters<typeof createFirebaseRoutes>[1],
  'fixture', async req => bodies.get(req)!);
  const call = async (address: string, token: string, forwarded?: string) => {
    const req = { method: 'POST', socket: { remoteAddress: address }, headers: {
      origin: 'http://127.0.0.1:3001', 'content-type': 'application/json',
      ...(forwarded ? { 'x-forwarded-for': forwarded, forwarded: 'for=' + forwarded } : {}),
    } } as unknown as IncomingMessage;
    bodies.set(req, { idToken: token });
    let status = 0;
    const res = { setHeader() {}, writeHead(value: number) { status = value; return this; }, end() {} } as unknown as ServerResponse;
    await routes.handle(req, res, new URL('http://127.0.0.1:3001/pilot/auth/session/'), 'http://127.0.0.1:3001');
    return status;
  };
  try {
    for (let i = 0; i < 30; i++) expect(await call('192.0.2.1', 'invalid')).toBe(401);
    expect(await call('192.0.2.1', 'valid', '192.0.2.2')).toBe(429);
    expect(await call('192.0.2.2', 'valid')).toBe(200);
  } finally { await routes.close(); }
});
