import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { startPilot } from './pilotHttp';
import { createSimulatedPayments } from './pilotPayments';

const database = process.env.LINGUISTVISION_TEST_DATABASE_URL;

it.skipIf(!database)('protects Firebase sessions, verified UID ownership, concurrent creation and revoked media access', async () => {
  const schema = 'lv_firebase_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: database });
  const pool = new Pool({ connectionString: database, options: '-c search_path=' + schema });
  let server: Awaited<ReturnType<typeof startPilot>> | undefined;
  const claims = (uid: string, overrides = {}) => ({ uid, sub: uid, email: 'same@example.test', email_verified: true,
    auth_time: Math.floor(Date.now() / 1000), ...overrides }) as DecodedIdToken;
  const tokens = new Map([['owner', claims('owner')], ['other', claims('other')],
    ['unverified', claims('unverified', { email_verified: false })], ['old', claims('old', { auth_time: 1 })]]);
  const sessions = new Map<string, DecodedIdToken>();
  const revoked = new Set<string>();
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    for (const script of ['schema.sql', 'pilotAttributionMigration.sql', 'accountAccess.sql']) {
      await pool.query(await readFile(new URL('./' + script, import.meta.url), 'utf8'));
    }
    server = await startPilot({ pool, port: 0, invitations: new Map(), payments: createSimulatedPayments(), services: [],
      editorAssets: new URL('../../dist/pilot-editor/', import.meta.url),
      commercialPreview: { firebase: { web: { projectId: 'linguistvision-test', appId: 'fixture-app', apiKey: 'fixture-key', authDomain: 'linguistvision-test.firebaseapp.com' },
        identity: {
          async verifyIdToken(token, checkRevoked) {
            expect(checkRevoked).toBe(true);
            if (!tokens.has(token)) throw new Error('Invalid token');
            return tokens.get(token)!;
          },
          async createSessionCookie(token, { expiresIn }) {
            expect(expiresIn).toBe(8 * 3600 * 1000);
            const cookie = randomUUID();
            sessions.set(cookie, tokens.get(token)!);
            return cookie;
          },
          async verifySessionCookie(cookie, checkRevoked) {
            expect(checkRevoked).toBe(true);
            const user = sessions.get(cookie);
            if (!user || revoked.has(user.uid)) throw new Error('Revoked session');
            return user;
          },
        },
      } },
    });
    const { origin } = server;
    const call = (path: string, token?: string, cookie = '', requestOrigin = origin) => fetch(origin + '/pilot/' + path, {
      method: token === undefined ? 'GET' : 'POST', headers: { origin: requestOrigin, cookie, 'Content-Type': 'application/json' },
      body: token === undefined ? undefined : JSON.stringify({ idToken: token }), redirect: 'manual',
    });
    const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
    for (const [token, status] of [['unverified', 403], ['old', 401], ['forged', 401]] as const) {
      expect((await call('auth/session/', token)).status).toBe(status);
    }
    expect((await call('auth/session/', 'owner', '', 'https://attacker.example')).status).toBe(403);
    expect((await call('auth/session/', 'owner')).headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax');
    const first = await Promise.all([call('auth/session/', 'owner'), call('auth/session/', 'owner')]);
    expect(first.map(response => response.status)).toEqual([200, 200]);
    expect((await pool.query('SELECT 1 FROM commercial_firebase_identities')).rowCount).toBe(1);
    const ownerCookie = cookie(first[0]);
    const workspace = await call('', undefined, ownerCookie);
    expect(await workspace.text()).toContain('/pilot/editor-assets/firebaseAuth.js');
    expect((await call('api/account', undefined, ownerCookie)).status).toBe(200);
    const { rows: [owner] } = await pool.query('SELECT account_id FROM commercial_firebase_identities WHERE firebase_uid=$1', ['owner']);
    await pool.query('UPDATE accounts SET available=600,credited=600 WHERE id=$1', [owner.account_id]);
    const otherCookie = cookie(await call('auth/session/', 'other'));
    const other = await (await call('api/account', undefined, otherCookie)).json();
    expect(other.balance.available).toBe(0);
    const form = new FormData();
    form.set('video', await (await fetch(origin + '/demo/jobsite.mp4')).blob(), 'jobsite.mp4');
    form.set('srt', await (await fetch(origin + '/demo/jobsite.srt')).blob(), 'jobsite.srt');
    const imported = await fetch(origin + '/pilot/api/projects', { method: 'POST', headers: { origin, cookie: ownerCookie }, body: form });
    expect(imported.status).toBe(201);
    const { id } = await imported.json();
    expect((await call('api/projects/' + id + '/source', undefined, otherCookie)).status).toBe(404);
    const video = origin + '/pilot/api/projects/' + id + '/source';
    expect((await fetch(video, { headers: { cookie: ownerCookie, range: 'bytes=0-15' } })).status).toBe(206);
    revoked.add('owner');
    expect((await call('api/account', undefined, ownerCookie)).status).toBe(401);
    expect((await fetch(video, { headers: { cookie: ownerCookie, range: 'bytes=0-15' } })).status).toBe(401);
    expect((await call('api/account', undefined, otherCookie)).status).toBe(200);
    expect((await call('register/?lang=ar')).headers.get('content-security-policy')).toContain('identitytoolkit.googleapis.com');
    expect((await call('sign-in/?lang=es')).headers.get('content-security-policy')).toContain("script-src 'self' 'wasm-unsafe-eval' https://apis.google.com;");
    expect(await (await call('register/?lang=ar')).text()).toContain('firebaseAuth.js');
  } finally {
    await server?.close();
    await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
}, 20_000);
