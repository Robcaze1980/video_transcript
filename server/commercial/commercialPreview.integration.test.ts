import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { pilotLanguages } from '../pilot-site/languages';
import { videoPackages } from '../../config/videoPackages';
import { CommercialJobs, JobError } from './jobs';
import { measureVideoSeconds } from './pilotVideo';
import { startPilot } from './pilotHttp';
import { createSimulatedPayments } from './pilotPayments';

const database = process.env.LINGUISTVISION_TEST_DATABASE_URL;

it.skipIf(!database)('completes account access and a single simulated purchase from each commercial locale', async () => {
  const schema = 'lv_commercial_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: database });
  const pool = new Pool({ connectionString: database, options: '-c search_path=' + schema });
  let preview: Awaited<ReturnType<typeof startPilot>> | undefined;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    for (const script of ['schema.sql', 'pilotAttributionMigration.sql', 'accountAccess.sql']) {
      await pool.query(await readFile(new URL('./' + script, import.meta.url), 'utf8'));
    }
    const mailbox = new Map<string, { code: string; locale: string }>();
    const simulated = createSimulatedPayments();
    const rejected = new Set<string>();
    preview = await startPilot({
      pool, port: 0, invitations: new Map(), payments: {
        ...simulated,
        async getOrder(id) {
          const order = await simulated.getOrder(id);
          return rejected.has(id) ? { ...order, status: 'VOIDED' } : order;
        },
      },
      editorAssets: new URL('../../dist/pilot-editor/', import.meta.url),
      services: [{ adapter: {
        key: 'video-to-srt:test', price: 1, validate() {}, measurePrice: measureVideoSeconds,
        async execute(_input, options) {
          if (options.fail) throw new Error('Fixture failure');
          return Buffer.from('1\n00:00:00,500 --> 00:00:04,000\nTest subtitle.\n');
        },
      }, label: 'Video', accepts: 'video/mp4', filename: 'result.srt', contentType: 'application/x-subrip' }],
      commercialPreview: { sendAccessCode: async ({ email, code, locale }) => { mailbox.set(email, { code, locale }); } },
    });
    const { origin } = preview;
    const get = (path: string, cookie = '') => fetch(origin + path, { redirect: 'manual', headers: { cookie } });
    const post = (path: string, body: URLSearchParams | string, cookie = '') => fetch(origin + path, {
      method: 'POST', redirect: 'manual', headers: { origin, cookie, ...(typeof body === 'string' ? {
        'Content-Type': 'application/json',
      } : {}) }, body,
    });
    const sitemap = await get('/sitemap.xml');
    expect((await sitemap.text()).match(/<loc>/g)).toHaveLength(10);
    expect((await get('/demo/jobsite.mp4')).headers.get('content-type')).toBe('video/mp4');
    expect(await (await get('/demo/jobsite.srt')).text()).toContain('00:00:00,500 --> 00:00:04,000');
    const accountCss = await get('/pilot/account.css');
    expect(accountCss.headers.get('content-type')).toContain('text/css');
    expect(await accountCss.text()).toContain('color-scheme: light');
    expect((await get('/pilot/api/account')).status).toBe(401);
    expect((await post('/pilot/api/login', '{}')).status).toBe(404);
    const accounts: Array<{ session: string; order: string; seconds: number }> = [];
    for (const language of pilotLanguages) {
      const query = '?lang=' + language.id;
      const route = '/' + language.locale.toLowerCase() + '/' + language.slug + '/';
      const page = await get(route);
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(page.headers.get('x-robots-tag')).toContain('noindex');
      expect(page.headers.get('content-security-policy')).toContain("style-src 'sha256-");
      expect(html.match(/hreflang=/g)).toHaveLength(11);
      if (language.id !== 'es') expect(html).toContain('/pilot/demo/' + query);
      expect(html).toContain('/pilot/register/' + query);
      expect(await (await get('/pilot/demo/' + query)).text()).toContain('data-locale="' + language.id + '"');
      const entry = page.headers.get('set-cookie')!.split(';')[0];
      const register = '/pilot/register/' + query;
      const registration = await get(register, entry);
      expect(registration.status).toBe(200);
      const registrationHtml = await registration.text();
      expect(registrationHtml).toContain('dir="' + language.direction + '"');
      expect(registrationHtml).toContain('href="/pilot/account.css"');
      expect(registrationHtml).toContain('href="/pilot/sign-in/' + query + '"');
      const email = language.id + '@example.test';
      const request = await post(register, new URLSearchParams({ email }), entry);
      expect(request.status).toBe(202);
      const challenge = await request.text();
      expect(challenge).toContain('autocomplete="one-time-code"');
      expect(challenge).toContain('<bdi dir="ltr">' + email + '</bdi>');
      expect(mailbox.get(email)?.locale).toBe(language.id);
      const code = mailbox.get(email)!.code;
      const wrongCode = code === '00000000' ? '00000001' : '00000000';
      const rejectedCode = await post(register, new URLSearchParams({ email, code: wrongCode }), entry);
      expect(rejectedCode.status).toBe(422);
      expect(await rejectedCode.text()).toContain('aria-describedby="code-error"');
      const verify = () => post(register, new URLSearchParams({ email, code }), entry);
      const responses = await Promise.all([verify(), verify()]);
      expect(responses.map(response => response.status).sort()).toEqual([303, 422]);
      const verified = responses.find(response => response.status === 303)!;
      expect(verified.headers.get('location')).toBe('/pilot/' + query);
      const session = verified.headers.get('set-cookie')!.split(';')[0];
      const browser = session + '; ' + entry;
      expect((await get('/pilot/' + query, browser)).status).toBe(200);
      expect(html).toContain('id="plans"');
      const style = html.match(/<style>([\s\S]*?)<\/style>/)![1];
      expect(page.headers.get('content-security-policy')).toContain("'sha256-" + createHash('sha256').update(style).digest('base64') + "'");
      expect(html.match(language.id === 'es' ? /class="pnum"/g : /class="offer-price"/g)).toHaveLength(3);
      const pack = videoPackages[accounts.length % videoPackages.length];
      const created = await post('/pilot/api/checkout', JSON.stringify({ packageId: pack.id, amount: 1 }), browser);
      expect(created.status).toBe(201);
      const { id: order } = await created.json();
      const confirm = () => post('/pilot/api/checkout/' + order + '/simulate', '{}', browser);
      expect((await Promise.all([confirm(), confirm()])).map(response => response.status)).toEqual([202, 202]);
      accounts.push({ session: browser, order, seconds: pack.credits });
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      if ((await pool.query('SELECT 1 FROM purchases')).rowCount === 10) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    expect((await pool.query('SELECT 1 FROM purchases')).rowCount).toBe(10);
    for (const { session, seconds } of accounts) {
      const account = await (await get('/pilot/api/account', session)).json();
      expect(account.balance.available).toBe(seconds);
    }
    expect((await get('/pilot/api/checkout/' + accounts[0].order, accounts[1].session)).status).toBe(404);
    const owner = accounts[0].session;
    expect((await post('/pilot/api/checkout', '{"packageId":"fake"}', owner)).status).toBe(422);
    const cancelled = await (await post('/pilot/api/checkout', '{"packageId":"10-min"}', owner)).json();
    const pending = await (await post('/pilot/api/checkout', '{"packageId":"50-min"}', owner)).json();
    const denied = await (await post('/pilot/api/checkout', '{"packageId":"100-min"}', owner)).json();
    const { rows: [deniedOrder] } = await pool.query('SELECT provider_order_id FROM checkout_orders WHERE id=$1', [denied.id]);
    rejected.add(deniedOrder.provider_order_id);
    expect((await post('/pilot/api/checkout/' + pending.id + '/capture', '{}', owner)).status).toBe(202);
    expect((await post('/pilot/api/checkout/' + denied.id + '/capture', '{}', owner)).status).toBe(202);
    for (let attempt = 0; attempt < 20; attempt++) {
      const checked = await pool.query('SELECT 1 FROM checkout_orders WHERE id=ANY($1::uuid[]) AND next_attempt_at>clock_timestamp()',
        [[pending.id, denied.id]]);
      if (checked.rowCount === 2) break;
      if (attempt === 19) throw new Error('The worker did not check the pending and rejected orders.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(await (await get('/pilot/api/checkout/' + cancelled.id, owner)).json()).toEqual({ status: 'approval' });
    const balance = async () => (await (await get('/pilot/api/account', owner)).json()).balance;
    expect((await balance()).available).toBe(600);
    const clip = Buffer.from(await (await get('/demo/jobsite.mp4')).arrayBuffer());
    const seconds = await measureVideoSeconds(clip);
    expect(seconds).toBeGreaterThan(1);
    for (const [requestKey, fail] of [['first', false], ['second', false], ['refund', true]] as const) {
      const file = await fetch(origin + '/pilot/api/files', { method: 'POST', headers: { origin, cookie: owner }, body: new Uint8Array(clip) });
      expect(file.status).toBe(201);
      const { id: inputId } = await file.json();
      const create = () => post('/pilot/api/jobs', JSON.stringify({ inputId, requestKey, service: 'video-to-srt:test',
        options: { duration: 0.01, fail } }), owner);
      const attempts = await Promise.all([create(), create()]);
      expect(attempts.map(response => response.status)).toEqual([202, 202]);
      const ids = await Promise.all(attempts.map(async response => (await response.json()).id));
      expect(ids[0]).toBe(ids[1]);
      const route = '/pilot/api/jobs/' + ids[0];
      const terminal = fail ? 'failed' : 'succeeded';
      for (let attempt = 0; attempt < 50; attempt++) {
        const job = await (await get(route, owner)).json();
        expect(job.price).toBe(seconds);
        if (job.state === terminal) break;
        if (attempt === 49) throw new Error('The video job did not complete.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!fail) expect(await (await get(route + '/download', owner)).text()).toContain('Test subtitle.');
    }
    expect(await balance()).toMatchObject({ available: 600 - 2 * seconds, reserved: 0, consumed: 2 * seconds });
    const project = new FormData();
    project.set('video', await (await get('/demo/jobsite.mp4')).blob(), 'jobsite.mp4');
    project.set('srt', await (await get('/demo/jobsite.srt')).blob(), 'jobsite.srt');
    const imported = await fetch(origin + '/pilot/api/projects', {
      method: 'POST', headers: { origin, cookie: owner }, body: project,
    });
    expect(imported.status).toBe(201);
    const { id } = await imported.json();
    expect((await get('/pilot/api/projects/' + id + '/source', owner)).status).toBe(200);
    expect((await get('/pilot/api/projects/' + id + '/source', accounts[1].session)).status).toBe(404);
    expect((await get('/pilot/api/projects/' + id, accounts[1].session)).status).toBe(404);
    const { rows } = await pool.query('SELECT event, sum(total)::int AS total FROM pilot_preview_funnel GROUP BY event');
    expect(Object.fromEntries(rows.map(row => [row.event, row.total]))).toEqual({
      landing_view: 10, product_entry: 10, purchase_credited: 10,
    });
    const signIn = '/pilot/sign-in/?lang=en';
    const email = 'en@example.test';
    expect((await post(signIn, new URLSearchParams({ email }))).status).toBe(202);
    const signedIn = await post(signIn, new URLSearchParams({ email, code: mailbox.get(email)!.code }));
    expect(signedIn.status).toBe(303);
    expect((await pool.query('SELECT 1 FROM commercial_identities')).rowCount).toBe(10);
    expect((await post('/pilot/api/logout', '{}', accounts[0].session)).status).toBe(200);
    expect((await get('/pilot/api/account', accounts[0].session)).status).toBe(401);
    await preview.close();
    preview = undefined;
    const jobs = new CommercialJobs(pool, new Map([['video-to-srt:contention', {
      key: 'video-to-srt:contention', price: 1, validate() {}, measurePrice: measureVideoSeconds,
      async execute() { return Buffer.from('fixture'); },
    }]]));
    const limited = await jobs.createAccount();
    await jobs.creditConfirmedPurchase(limited, 'contention-fixture', seconds);
    const inputIds = await Promise.all([jobs.addInput(limited, clip), jobs.addInput(limited, clip)]);
    const competing = await Promise.allSettled(inputIds.map(input => jobs.enqueue(limited, input, input, 'video-to-srt:contention', {})));
    expect(competing.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const refused = competing.find(result => result.status === 'rejected');
    expect(refused?.reason).toBeInstanceOf(JobError);
    expect(refused?.reason.code).toBe('insufficient_credits');
    expect(await jobs.balance(limited)).toMatchObject({ available: 0, reserved: seconds });
  } finally {
    await preview?.close();
    await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
}, 25_000);
