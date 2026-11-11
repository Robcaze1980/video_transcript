import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { startPilot } from './pilotHttp';
import { createSimulatedPayments } from './pilotPayments';

const database = process.env.LINGUISTVISION_TEST_DATABASE_URL;

it.skipIf(!database)('verifies Supabase identities, isolates accounts and limits password recovery to one use', async () => {
  const schema = 'lv_supabase_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: database });
  const pool = new Pool({ connectionString: database, options: '-c search_path=' + schema });
  let server: Awaited<ReturnType<typeof startPilot>> | undefined;
  const uid = randomUUID();
  const other = randomUUID();
  const email = 'worker@example.test';
  const user = (id: string) => ({ id, email, aud: 'authenticated', role: 'authenticated', created_at: '2026-11-10T00:00:00Z',
    email_confirmed_at: '2026-11-10T00:00:00Z', app_metadata: {}, user_metadata: {} });
  const session = (id: string, token: string) => ({ user: user(id), access_token: token, refresh_token: 'unused-refresh',
    token_type: 'bearer', expires_in: 3600 });
  let password = 'original-password';
  let confirmed = false;
  let signUpChallenge: string | undefined;
  let recoveryChallenge: string | undefined;
  const used = new Set<string>();
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(input.toString());
    expect(url.origin).toBe('https://linguistvision.example');
    const data = init?.body ? JSON.parse(String(init.body)) : {};
    const invalid = () => Response.json({ message: 'Invalid', code: 'invalid_credentials' }, { status: 400 });
    if (url.pathname.endsWith('/signup')) {
      expect(data.email).toBe(email);
      expect(data.password).toBe(password);
      signUpChallenge = data.code_challenge;
      return Response.json({ ...user(uid), email_confirmed_at: undefined });
    }
    if (url.pathname.endsWith('/recover')) {
      recoveryChallenge = data.code_challenge;
      return Response.json({});
    }
    if (url.searchParams.get('grant_type') === 'password') {
      return confirmed && data.password === password ? Response.json(session(uid, 'account-token')) : invalid();
    }
    if (url.searchParams.get('grant_type') === 'pkce') {
      const code: string = data.auth_code;
      expect(data.code_verifier.length).toBeGreaterThan(40);
      if (used.has(code)) return invalid();
      used.add(code);
      if (code === 'confirmation') {
        expect(signUpChallenge).toBeTruthy();
        confirmed = true;
        return Response.json(session(uid, 'account-token'));
      }
      if (code === 'recovery') {
        expect(recoveryChallenge).toBeTruthy();
        return Response.json(session(uid, 'recovery-token'));
      }
      if (code === 'google') return Response.json(session(other, 'other-token'));
    }
    if (url.pathname.endsWith('/user')) {
      const bearer = new Headers(init?.headers).get('authorization');
      if (init?.method === 'PUT') {
        expect(bearer).toBe('Bearer recovery-token');
        password = data.password;
      }
      return Response.json(user(bearer === 'Bearer other-token' ? other : uid));
    }
    throw new Error('Unexpected Auth request: ' + url.pathname);
  };
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    for (const script of ['schema.sql', 'pilotAttributionMigration.sql', 'accountAccess.sql']) {
      await pool.query(await readFile(new URL('./' + script, import.meta.url), 'utf8'));
    }
    server = await startPilot({ pool, port: 0, invitations: new Map(), payments: createSimulatedPayments(), services: [],
      editorAssets: new URL('../../dist/pilot-editor/', import.meta.url),
      commercialPreview: { supabase: { url: 'https://linguistvision.example', publishableKey: 'local-fixture', fetch: fake } },
    });
    const { origin } = server;
    const call = (path: string, values?: Record<string, string>, cookie = '') => fetch(origin + '/pilot/' + path, {
      method: values ? 'POST' : 'GET', body: values && new URLSearchParams(values), redirect: 'manual', headers: { origin, cookie },
    });
    const cookie = (response: Response, name: string) => response.headers.getSetCookie().find(value => value.startsWith(name + '='))!.split(';')[0];
    const register = await call('register/?lang=es', { email, password });
    expect(register.status).toBe(202);
    expect((await call('sign-in/', { email, password })).status).toBe(422);
    expect((await call('auth/confirm/?code=confirmation')).status).toBe(422);
    const proof = cookie(register, 'lv_auth_confirm');
    expect((await call('auth/confirm/?code=confirmation', undefined, proof + 'a')).status).toBe(422);
    const verified = await call('auth/confirm/?code=confirmation', undefined, proof);
    expect(verified.headers.get('location')).toBe('/pilot/?lang=es');
    expect((await call('auth/confirm/?code=confirmation', undefined, proof)).status).toBe(422);
    const originalSession = cookie(verified, 'linguistvision_pilot');
    expect((await call('api/account', undefined, originalSession)).status).toBe(200);
    const concurrent = await Promise.all([call('sign-in/', { email, password }), call('sign-in/', { email, password })]);
    expect(concurrent.map(item => item.status)).toEqual([303, 303]);
    expect((await pool.query('SELECT 1 FROM commercial_supabase_identities')).rowCount).toBe(1);
    const source = await pool.query<{ account_id: string }>('SELECT account_id FROM commercial_supabase_identities WHERE user_id=$1', [uid]);
    await pool.query('UPDATE accounts SET available=600, credited=600 WHERE id=$1', [source.rows[0].account_id]);
    const project = new FormData();
    project.set('video', await (await fetch(origin + '/demo/jobsite.mp4')).blob(), 'jobsite.mp4');
    project.set('srt', await (await fetch(origin + '/demo/jobsite.srt')).blob(), 'jobsite.srt');
    const imported = await fetch(origin + '/pilot/api/projects', { method: 'POST', headers: { origin, cookie: originalSession }, body: project });
    expect(imported.status).toBe(201);
    const { id: projectId } = await imported.json();
    const google = await call('auth/google/?lang=en', {});
    const googleUrl = new URL(google.headers.get('location')!);
    expect(googleUrl.origin).toBe('https://linguistvision.example');
    expect(googleUrl.searchParams.get('provider')).toBe('google');
    const googleCallback = new URL(googleUrl.searchParams.get('redirect_to')!);
    expect(googleCallback.origin).toBe(origin);
    googleCallback.searchParams.set('code', 'google');
    const googleSignedIn = await call('auth/google/' + googleCallback.search, undefined, cookie(google, 'lv_auth_google'));
    expect(googleSignedIn.status).toBe(303);
    const otherSession = cookie(googleSignedIn, 'linguistvision_pilot');
    const otherBalance = await (await call('api/account', undefined, otherSession)).json();
    expect(otherBalance.balance.available).toBe(0);
    expect((await call('api/projects/' + projectId + '/source', undefined, originalSession)).status).toBe(200);
    expect((await call('api/projects/' + projectId + '/source', undefined, otherSession)).status).toBe(404);
    const request = await call('auth/forgot/', { email });
    expect(request.status).toBe(202);
    const recovery = await call('auth/recovery/?code=recovery', undefined, cookie(request, 'lv_auth_recovery'));
    expect(recovery.headers.get('location')).toBe('/pilot/auth/reset/?lang=en');
    expect(recovery.headers.getSetCookie().some(value => value.startsWith('linguistvision_pilot='))).toBe(false);
    const reset = cookie(recovery, 'lv_password_reset');
    expect((await call('api/account', undefined, reset)).status).toBe(401);
    const replacements = await Promise.all([call('auth/reset/', { password: 'replaced-password' }, reset),
      call('auth/reset/', { password: 'replaced-password' }, reset)]);
    expect(replacements.map(item => item.status).sort()).toEqual([200, 422]);
    expect((await call('api/account', undefined, originalSession)).status).toBe(401);
    expect((await call('sign-in/', { email, password: 'original-password' })).status).toBe(422);
    expect((await call('sign-in/', { email, password: 'replaced-password' })).status).toBe(303);
  } finally {
    await server?.close();
    await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
}, 20_000);
