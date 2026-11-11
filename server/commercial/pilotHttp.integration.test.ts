import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { get as httpGet, request as httpRequest } from 'node:http';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CommercialJobs, type JobAdapter } from './jobs';
import { pdfToCsv } from './pdfToCsv';
import { startPilot } from './pilotHttp';
import { createPayPalSandbox, createSimulatedPayments } from './pilotPayments';
import * as pilotVideo from './pilotVideo';
import { defaultPilotStyle } from './pilotStyles';
import { textPdf } from './testFixtures';
import { pilotLocale, pilotLocales } from './web/pilotLocales.js';

const connectionString = process.env.LINGUISTVISION_TEST_DATABASE_URL;
const schema = 'lv_http_' + randomUUID().replaceAll('-', '');
const invitation = () => randomBytes(24).toString('hex');
const videoFixture: JobAdapter = {
  key: 'test-private-video', price: 1, validate() {},
  async execute() { return {
    result: Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nPrueba\n'),
    original: Buffer.from('1\n00:00:00,000 --> 00:00:00,800\nاختبار\n'),
  }; },
};

describe.skipIf(!connectionString)('private pilot over HTTP', () => {
  let admin: Pool;
  let pool: Pool;
  let pilot: Awaited<ReturnType<typeof startPilot>>;
  let accounts: string[];
  const codes = [invitation(), invitation()];
  const payments = createSimulatedPayments();

  beforeAll(async () => {
    admin = new Pool({ connectionString });
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new Pool({ connectionString, options: '-c search_path=' + schema });
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('./pilotAttributionMigration.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('./pilotAttributionMigration.sql', import.meta.url), 'utf8'));
    const jobs = new CommercialJobs(pool, new Map());
    accounts = await Promise.all(codes.map(() => jobs.createAccount()));
    pilot = await startPilot({
      pool,
      port: 0,
      editorAssets: new URL('../../dist/pilot-editor/', import.meta.url),
      previewConversionAttribution: true,
      invitations: new Map(codes.map((code, index) => [code, accounts[index]])),
      services: [{
        adapter: pdfToCsv, label: 'PDF', accepts: '.pdf', filename: 'texto.csv', contentType: 'text/csv; charset=utf-8',
      }, {
        adapter: videoFixture, label: 'Video', accepts: '.mp4', filename: 'video.srt',
        contentType: 'application/x-subrip', editableVideo: true,
      }],
      payments,
    });
  });

  afterAll(async () => {
    await pilot?.close();
    await pool?.end();
    if (admin) {
      await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
      await admin.end();
    }
  });

  const url = (path: string) => pilot.origin + '/pilot/api/' + path;
  const get = (path: string, cookie?: string) => fetch(url(path), { headers: cookie ? { cookie } : {} });
  const post = (path: string, body: object | Uint8Array, cookie?: string, origin = pilot.origin) =>
    fetch(url(path), {
      method: 'POST',
      headers: { origin, ...(cookie ? { cookie } : {}), 'content-type': body instanceof Uint8Array
        ? 'application/octet-stream' : 'application/json' },
      body: body instanceof Uint8Array ? new Uint8Array(body) : JSON.stringify(body),
    });
  async function login(code: string) {
    const response = await post('login', { code });
    expect(response.status).toBe(200);
    const header = response.headers.get('set-cookie')!;
    expect(header).toContain('HttpOnly; SameSite=Strict');
    expect(header).toContain('Path=/pilot/');
    return header.split(';')[0];
  }
  async function until<T>(read: () => Promise<T>, done: (value: T) => boolean) {
    for (let i = 0; i < 50; i++) {
      const value = await read();
      if (done(value)) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for pilot worker.');
  }

  it('offers the ten approved preview languages and records only one request per account and pair', async () => {
    expect((await (await get('account', await login(codes[0]))).json()).launchLanguagePreview).toBeUndefined();
    const preview = await startPilot({
      pool, port: 0, payments, previewLaunchLanguages: true,
      invitations: new Map([[codes[0], accounts[0]]]),
      services: [{
        adapter: { ...videoFixture, key: 'video-to-srt:preview-test' },
        label: 'Video', accepts: '.mp4', filename: 'video.srt', contentType: 'application/x-subrip',
        directions: [{ id: 'en-es', label: 'English to Spanish' }],
      }],
    });
    try {
      const endpoint = preview.origin + '/pilot/api/';
      const send = (route: string, body: object, cookie?: string) => fetch(endpoint + route, {
        method: 'POST', headers: { origin: preview.origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
      const request = { source: 'en', target: 'vi' };
      expect((await send('language-requests', request)).status).toBe(401);
      const loggedIn = await send('login', { code: codes[0] });
      const cookie = loggedIn.headers.get('set-cookie')!.split(';')[0];
      const account = await (await fetch(endpoint + 'account', { headers: { cookie } })).json();
      expect(account.launchLanguagePreview.map((entry: { id: string }) => entry.id))
        .toEqual(['en', 'es', 'pt', 'fr', 'de', 'ja', 'ko', 'ar', 'cmn', 'vi']);
      expect((await send('language-requests', { source: 'en', target: 'yue' }, cookie)).status).toBe(422);
      expect((await send('language-requests', { source: 'en', target: 'es' }, cookie)).status).toBe(422);
      const result = await Promise.all([send('language-requests', request, cookie), send('language-requests', request, cookie)]);
      expect(result.map(response => response.status)).toEqual([200, 200]);
      expect((await pool.query('SELECT source_id, target_id FROM pilot_language_requests WHERE account_id=$1', [accounts[0]])).rows)
        .toEqual([{ source_id: 'en', target_id: 'vi' }]);
    } finally {
      await preview.close();
    }
  });

  it('authenticates accounts, reconciles a PayPal test payment and downloads only the owner’s result', async () => {
    const page = await fetch(pilot.origin + '/pilot/');
    expect(page.status).toBe(200);
    expect(page.headers.get('x-robots-tag')).toContain('noindex');
    const html = await page.text();
    expect(html).toContain('Código de invitación');
    const markupKeys = [...html.matchAll(/data-text="([^"]+)"/g)].map(match => match[1]);
    for (const { id } of pilotLocales) {
      const asset = await fetch(pilot.origin + '/pilot/locales/' + id + '.js');
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('text/javascript');
      expect(markupKeys.every(key => pilotLocale(id).text(key) !== key)).toBe(true);
    }
    expect(pilotLocale('ar')).toMatchObject({ tag: 'ar', dir: 'rtl' });
    expect(pilotLocale('unknown').id).toBe('es');
    expect((await get('account')).status).toBe(401);
    expect((await post('login', { code: codes[0] }, undefined, 'https://wrong.example')).status).toBe(403);
    const invalidHost = await new Promise<number | undefined>((resolve, reject) => {
      httpGet(url('account'), { headers: { host: 'wrong.example' } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    expect(invalidHost).toBe(403);
    const landingUrl = pilot.origin + '/es-419/subtitulos-video/?utm_source=chatgpt.com&other=ignore';
    const landing = await fetch(landingUrl);
    expect(landing.status).toBe(200);
    expect(landing.headers.get('x-robots-tag')).toContain('noindex');
    const entryLink = (await landing.text()).match(/<a href="([^"]+)">Entrar<\/a>/)?.[1];
    expect(entryLink).toBe('/pilot/enter');
    const entry = landing.headers.get('set-cookie')!.split(';')[0];
    const entryHeaders = { cookie: entry };
    const funnel = async () => (await pool.query(
      'SELECT locale, source, event, total FROM pilot_preview_funnel ORDER BY locale, source, event',
    )).rows;
    const spanishVisit = { locale: 'es-419', source: 'chatgpt', event: 'landing_view', total: 1 };
    expect((await fetch(landingUrl, { headers: entryHeaders })).status).toBe(200);
    expect((await fetch(pilot.origin + '/pilot/', { headers: entryHeaders })).status).toBe(200);
    expect(await funnel()).toEqual([spanishVisit]);
    const open = () => fetch(pilot.origin + entryLink, { headers: entryHeaders, redirect: 'manual' });
    const opens = await Promise.all([open(), open()]);
    expect(opens.map(response => [response.status, response.headers.get('location')]))
      .toEqual([[303, '/pilot/'], [303, '/pilot/']]);
    const spanishOpen = { ...spanishVisit, event: 'product_entry' };
    expect(await funnel()).toEqual([spanishVisit, spanishOpen]);
    const laterLanding = await fetch(pilot.origin + '/en-us/video-subtitles/', { headers: { cookie: entry } });
    expect(laterLanding.status).toBe(200);
    expect(laterLanding.headers.get('set-cookie')).toBeNull();
    const owner = (await login(codes[0])) + '; ' + entry;
    const stranger = await login(codes[1]);
    expect((await post('files', Buffer.alloc(1048577), owner)).status).toBe(413);
    expect((await post('files', textPdf())).status).toBe(401);
    const upload = await post('files', textPdf(), owner);
    expect(upload.status).toBe(201);
    const { id: inputId } = await upload.json();
    const request = { inputId, requestKey: 'file-1', service: pdfToCsv.key, options: {} };
    expect((await post('jobs', request, stranger)).status).toBe(404);
    expect((await post('jobs', request, owner)).status).toBe(402);

    const order = await post('checkout', {}, owner);
    expect(order.status).toBe(201);
    const { id: orderId } = await order.json();
    const conversions = async () => (await pool.query(
      'SELECT locale, source, conversions FROM pilot_preview_conversions',
    )).rows;
    expect((await get('checkout/' + orderId, stranger)).status).toBe(404);
    expect((await post('checkout/' + orderId + '/simulate', {}, stranger)).status).toBe(404);
    expect((await post('checkout/' + orderId + '/capture', {}, stranger)).status).toBe(404);
    expect(await (await get('checkout/' + orderId, owner)).json()).toEqual({ status: 'approval' });
    expect(await conversions()).toEqual([]);
    expect((await (await get('account', owner)).json()).balance.available).toBe(0);
    const [first, repeated] = await Promise.all([
      post('checkout/' + orderId + '/simulate', {}, owner), post('checkout/' + orderId + '/simulate', {}, owner),
    ]);
    expect([first.status, repeated.status]).toEqual([202, 202]);
    await until(async () => (await get('checkout/' + orderId, owner)).json(), value => value.status === 'credited');
    expect((await (await get('account', owner)).json()).balance)
      .toEqual({ available: 5, reserved: 0, consumed: 0, credited: 5 });
    expect((await (await get('account', stranger)).json()).balance.credited).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM purchases')).rows).toEqual([{ count: 1 }]);
    expect((await post('checkout/' + orderId + '/simulate', {}, owner)).status).toBe(202);
    expect(await conversions()).toEqual([{ locale: 'es-419', source: 'chatgpt', conversions: 1 }]);
    expect(await funnel()).toEqual([
      { locale: 'en-US', source: 'chatgpt', event: 'landing_view', total: 1 },
      spanishVisit, spanishOpen, { ...spanishVisit, event: 'purchase_credited' },
    ]);

    const unknownLanding = await fetch(pilot.origin + '/en-us/video-subtitles/?utm_source=chatgpt.com.invalid', {
      headers: { referer: 'https://chatgpt.com.invalid/' },
    });
    const unknownEntry = unknownLanding.headers.get('set-cookie')!.split(';')[0];
    const otherSession = stranger + '; ' + unknownEntry;
    const unapproved = await post('checkout', {}, otherSession);
    expect(unapproved.status).toBe(201);
    const cancelledId = (await unapproved.json()).id;
    expect((await pool.query('SELECT landing_locale, landing_source FROM checkout_orders WHERE id=$1',
      [cancelledId])).rows).toEqual([{ landing_locale: 'en-US', landing_source: 'unattributed' }]);
    // Cancellation returns to /pilot/ without a capture request.
    expect((await fetch(pilot.origin + '/pilot/', { headers: { cookie: otherSession } })).status).toBe(200);
    expect(await (await get('checkout/' + cancelledId, otherSession)).json()).toEqual({ status: 'approval' });
    const pendingId = (await (await post('checkout', {}, otherSession)).json()).id;
    // A capture request without provider approval leaves the order pending.
    expect((await post('checkout/' + pendingId + '/capture', {}, otherSession)).status).toBe(202);
    await until(async () => (await pool.query(
      'SELECT next_attempt_at > clock_timestamp() AS attempted FROM checkout_orders WHERE id=$1', [pendingId],
    )).rows[0].attempted, Boolean);
    expect(await (await get('checkout/' + pendingId, otherSession)).json()).toEqual({ status: 'pending' });
    expect(await conversions()).toEqual([{ locale: 'es-419', source: 'chatgpt', conversions: 1 }]);
    expect((await (await get('account', otherSession)).json()).balance.credited).toBe(0);
    const [queued, duplicate] = await Promise.all([post('jobs', request, owner), post('jobs', request, owner)]);
    expect([queued.status, duplicate.status]).toEqual([202, 202]);
    const { id: jobId } = await queued.json();
    expect(await duplicate.json()).toEqual({ id: jobId });
    await until(async () => (await get('jobs/' + jobId, owner)).json(), value => value.state === 'succeeded');
    const file = await get('jobs/' + jobId + '/download', owner);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="texto.csv"');
    expect(await file.text()).toBe('page,text\r\n1,"\'=5, ""units"""\r\n');
    expect((await get('jobs/' + jobId + '/download', stranger)).status).toBe(404);
    expect((await get('jobs/' + jobId + '/download')).status).toBe(401);
    expect(await (await get('jobs', stranger)).json()).toEqual([]);
    expect(await (await get('jobs', owner)).json()).toMatchObject([{ id: jobId, state: 'succeeded' }]);
    expect((await (await get('account', owner)).json()).balance)
      .toEqual({ available: 4, reserved: 0, consumed: 1, credited: 5 });
    expect((await post('jobs/' + jobId + '/delete-files', {}, stranger)).status).toBe(404);
    expect((await post('jobs/' + jobId + '/delete-files', {}, owner)).status).toBe(200);
    expect((await get('jobs/' + jobId + '/download', owner)).status).toBe(404);
    expect(await (await get('jobs', owner)).json()).toMatchObject([{ id: jobId, state: 'succeeded', downloadable: false }]);
    expect((await pool.query('SELECT content FROM inputs WHERE id=$1', [inputId])).rows).toEqual([{ content: null }]);
    expect((await pool.query('SELECT result FROM jobs WHERE id=$1', [jobId])).rows).toEqual([{ result: null }]);
    expect(await (await post('jobs', request, owner)).json()).toEqual({ id: jobId });
    expect((await post('jobs', { ...request, requestKey: 'deleted' }, owner)).status).toBe(404);
    const corrupt = await post('files', Buffer.from('%PDF-1.4\ncorrupt'), owner);
    const failed = await post('jobs', { ...request, inputId: (await corrupt.json()).id, requestKey: 'corrupt' }, owner);
    const { id: failedJob } = await failed.json();
    await until(async () => (await get('jobs/' + failedJob, owner)).json(), value => value.state === 'failed');
    expect((await (await get('account', owner)).json()).balance)
      .toEqual({ available: 4, reserved: 0, consumed: 1, credited: 5 });
    expect((await post('logout', {}, owner)).status).toBe(200);
    expect((await get('account', owner)).status).toBe(401);
  }, 15_000);

  it('serves byte ranges of the completed source only to its owner', async () => {
    const owner = await login(codes[0]);
    const stranger = await login(codes[1]);
    const bytes = Buffer.from('0123456789');
    const input = await post('files', bytes, owner);
    const { id: inputId } = await input.json();
    const response = await post('jobs', { inputId, requestKey: 'video-range', service: videoFixture.key, options: {} }, owner);
    expect(response.status).toBe(202);
    const { id } = await response.json();
    await until(async () => (await get('jobs/' + id, owner)).json(), value => value.state === 'succeeded');
    const source = url('jobs/' + id + '/source');
    const range = (cookie?: string, value = 'bytes=2-4') =>
      fetch(source, { headers: { range: value, ...(cookie ? { cookie } : {}) } });
    expect((await range()).status).toBe(401);
    expect((await range(stranger)).status).toBe(404);
    const accepted = await range(owner);
    expect(accepted.status).toBe(206);
    expect(accepted.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await accepted.text()).toBe('234');
    expect((await range(owner, 'bytes=10-')).status).toBe(416);
    expect((await post('jobs/' + id + '/delete-files', {}, owner)).status).toBe(200);
    expect((await range(owner)).status).toBe(404);
  });

  it('imports, saves and reopens a private UTF-8 subtitle project without a transcription job', async () => {
    const owner = await login(codes[0]);
    const stranger = await login(codes[1]);
    const before = await (await get('account', owner)).json();
    const jobsBefore = await (await get('jobs', owner)).json();
    const clip = execFileSync('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:d=2',
      '-c:v', 'mpeg4', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1',
    ]);
    const draft = '1\r\n00:00:00,200 --> 00:00:01,500\r\nHola, أهلاً.\r\n';
    const upload = (srt: BlobPart, cookie?: string, video = clip) => {
      const form = new FormData();
      form.append('video', new Blob([new Uint8Array(video)]), 'test.mp4');
      form.append('srt', new Blob([srt]), 'test.srt');
      return fetch(url('projects'), { method: 'POST', headers: { origin: pilot.origin, ...(cookie ? { cookie } : {}) }, body: form });
    };
    expect((await upload(draft)).status).toBe(401);
    expect(await (await upload(new Uint8Array([0xff]), owner)).json()).toMatchObject({ key: 'projectSrtInvalid' });
    expect(await (await upload(draft.replace('01,500', '00,100'), owner)).json()).toMatchObject({ key: 'projectSrtInvalid' });
    expect(await (await upload(draft.replace('01,500', '03,000'), owner)).json()).toMatchObject({ key: 'projectSrtOutside' });
    const truncated = clip.subarray(0, clip.lastIndexOf(Buffer.from('mdat')) + 4);
    expect(await (await upload(draft, owner, truncated)).json()).toMatchObject({ key: 'projectVideoInvalid' });
    const imported = await upload('\uFEFF' + draft, owner);
    const created = await imported.json();
    expect(imported.status, JSON.stringify(created)).toBe(201);
    const { id } = created;
    const path = 'projects/' + id;
    expect(await (await get('projects', stranger)).json()).toEqual([]);
    expect((await get(path, stranger)).status).toBe(404);
    expect((await get(path + '/source', stranger)).status).toBe(404);
    expect((await post(path, { draft, revision: 1 }, stranger)).status).toBe(404);
    expect((await post(path + '/delete', {}, stranger)).status).toBe(404);
    expect((await post('jobs', { inputId: id, requestKey: 'project-is-not-a-job', service: videoFixture.key, options: {} }, owner)).status).toBe(404);
    const opened = await (await get(path, owner)).json();
    expect(opened).toMatchObject({ revision: 1, draft: draft.replaceAll('\r\n', '\n').trim() });
    const range = await fetch(url(path + '/source'), { headers: { cookie: owner, range: 'bytes=0-15' } });
    expect(range.status).toBe(206);
    expect(Buffer.from(await range.arrayBuffer())).toEqual(clip.subarray(0, 16));
    const edits = ['Adiós, مع السلامة.', 'Gracias, شكراً.'].map(text => draft.replace('Hola, أهلاً.', text));
    const saves = await Promise.all(edits.map(draft => post(path, { draft, revision: 1 }, owner)));
    expect(saves.map(response => response.status).sort()).toEqual([200, 409]);
    const winner = edits[saves.findIndex(response => response.status === 200)];
    expect((await post('logout', {}, owner)).status).toBe(200);
    const returned = await login(codes[0]);
    expect(await (await get('projects', returned)).json()).toMatchObject([{ id, name: 'test.mp4' }]);
    expect(await (await get(path, returned)).json()).toMatchObject({ revision: 2, draft: winner.replaceAll('\r\n', '\n').trim() });
    expect((await (await get('account', returned)).json()).balance).toEqual(before.balance);
    expect(await (await get('jobs', returned)).json()).toEqual(jobsBefore);
    expect((await post(path + '/delete', {}, returned)).status).toBe(200);
    expect((await get(path + '/source', returned)).status).toBe(404);
    expect((await pool.query('SELECT content FROM inputs WHERE id=$1', [id])).rows).toEqual([{ content: null }]);
    expect((await pool.query('SELECT 1 FROM subtitle_projects WHERE id=$1', [id])).rowCount).toBe(0);

    const expired = (await (await upload(draft, returned)).json()).id;
    const { rows: [{ account_id: accountId }] } = await pool.query('SELECT account_id FROM inputs WHERE id=$1', [expired]);
    const store = new CommercialJobs(pool, new Map());
    for (let index = 1; index < 20; index++) {
      await store.createSubtitleProject(accountId, clip, 'test.mp4', 2, draft);
    }
    expect((await upload(draft, returned)).status).toBe(422);
    await pool.query(`UPDATE inputs SET expires_at=clock_timestamp() - interval '1 second'
      WHERE id IN (SELECT id FROM subtitle_projects WHERE account_id=$1)`, [accountId]);
    expect((await get('projects/' + expired, returned)).status).toBe(404);
    expect(await (await get('projects', returned)).json()).toEqual([]);
    const reopenedSlot = await upload(draft, returned);
    expect(reopenedSlot.status).toBe(201);
    const { id: expiringId } = await reopenedSlot.json();
    const saveProject = CommercialJobs.prototype.saveSubtitleProject;
    const expireBeforeSave = vi.spyOn(CommercialJobs.prototype, 'saveSubtitleProject').mockImplementationOnce(async function (
      this: CommercialJobs, ...args: Parameters<typeof saveProject>
    ) {
      await pool.query("UPDATE inputs SET expires_at=clock_timestamp() - interval '1 second' WHERE id=$1", [expiringId]);
      await store.purgeExpiredInputs();
      return saveProject.apply(this, args);
    });
    try {
      const save = await post('projects/' + expiringId, { draft: winner, revision: 1 }, returned);
      expect(save.status).toBe(409);
      expect(await save.json()).toMatchObject({ key: 'projectConflict' });
      expect((await get('projects/' + expiringId, returned)).status).toBe(404);
    } finally {
      expireBeforeSave.mockRestore();
    }
    expect((await pool.query('SELECT 1 FROM subtitle_projects WHERE id=$1', [expired])).rowCount).toBe(0);

    await store.creditConfirmedPurchase(accountId, 'lv009-fixture', 1);
    const { id: inputId } = await (await post('files', clip, returned)).json();
    const job = await post('jobs', { inputId, requestKey: 'lv009-fixture', service: videoFixture.key, options: {} }, returned);
    expect(job.status).toBe(202);
    const { id: jobId } = await job.json();
    await until(async () => (await get('jobs/' + jobId, returned)).json(), value => value.state === 'succeeded');
    const balanceAfterJob = (await (await get('account', returned)).json()).balance;
    expect((await post('jobs/' + jobId + '/project', {}, stranger)).status).toBe(404);
    const fromJob = await post('jobs/' + jobId + '/project', {}, returned);
    expect(fromJob.status).toBe(201);
    const copiedPath = 'projects/' + (await fromJob.json()).id;
    expect(await (await get(copiedPath, returned)).json()).toMatchObject({ revision: 1, draft: expect.stringContaining('Prueba') });
    expect(await (await get(copiedPath, returned)).json()).toMatchObject({ originalDraft: expect.stringContaining('اختبار') });
    expect((await get('jobs/' + jobId + '/original', stranger)).status).toBe(404);
    expect(await (await get('jobs/' + jobId + '/original', returned)).text()).toContain('اختبار');
    expect((await (await get('account', returned)).json()).balance).toEqual(balanceAfterJob);
    expect((await post(copiedPath + '/delete', {}, returned)).status).toBe(200);
    expect((await get('jobs/' + jobId + '/download', returned)).status).toBe(200);

    let reachedProbe!: () => void;
    const probing = new Promise<void>(resolve => { reachedProbe = resolve; });
    let finishProbe!: () => void;
    const paused = new Promise<void>(resolve => { finishProbe = resolve; });
    const probe = vi.spyOn(pilotVideo, 'probeDuration').mockImplementationOnce(async () => {
      reachedProbe();
      await paused;
      return 2;
    });
    const copying = post('jobs/' + jobId + '/project', {}, returned);
    try {
      await probing;
      expect((await post('jobs/' + jobId + '/delete-files', {}, returned)).status).toBe(200);
    } finally {
      finishProbe();
      probe.mockRestore();
    }
    expect((await copying).status).toBe(404);
    expect(await (await get('projects', returned)).json()).toEqual([]);
    expect((await pool.query('SELECT original_result FROM jobs WHERE id=$1', [jobId])).rows).toEqual([{ original_result: null }]);
  }, 15_000);

  it('saves two independent tracks atomically and keeps legacy writes and cancellation safe', async () => {
    const owner = await login(codes[0]);
    const stranger = await login(codes[1]);
    const clip = execFileSync('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:d=2',
      '-c:v', 'mpeg4', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1',
    ]);
    const form = new FormData();
    const original = '1\n00:00:00,000 --> 00:00:00,800\nاختبار';
    const draft = '1\n00:00:00,200 --> 00:00:01,500\nHola';
    form.append('video', new Blob([new Uint8Array(clip)]), 'test.mp4');
    form.append('srt', new Blob([draft]), 'translated.srt');
    form.append('originalSrt', new Blob([original]), 'original.srt');
    const imported = await fetch(url('projects'), { method: 'POST', headers: { origin: pilot.origin, cookie: owner }, body: form });
    expect(imported.status).toBe(201);
    const path = 'projects/' + (await imported.json()).id;
    const read = async () => (await get(path, owner)).json();
    expect(await read()).toMatchObject({ draft, originalDraft: original, revision: 1 });
    expect((await post(path, { draft: 'invalid', originalDraft: null, revision: 1 }, owner)).status).toBe(422);
    expect((await post(path, { draft, originalDraft: original.replace('00,800', '03,000'), revision: 1 }, owner)).status).toBe(422);
    expect(await read()).toMatchObject({ draft, originalDraft: original, revision: 1 });
    const revised = draft.replace('01,500', '01,250');
    expect((await post(path, { draft: revised, revision: 1 }, owner)).status).toBe(200);
    expect(await read()).toMatchObject({ draft: revised, originalDraft: original, revision: 2 });
    const edits = await Promise.all([
      post(path, { draft: revised, originalDraft: original.replace('00,800', '00,900'), revision: 2 }, owner),
      post(path, { draft: '', originalDraft: null, revision: 2 }, owner),
    ]);
    expect(edits.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await read()).toMatchObject(edits[0].ok ?
      { draft: revised, originalDraft: original.replace('00,800', '00,900'), revision: 3 } :
      { draft: '', originalDraft: null, revision: 3 });

    const balance = async () => (await (await get('account', owner)).json()).balance;
    const { id: inputId } = await (await post('files', clip, owner)).json();
    const { rows: [{ account_id: accountId }] } = await pool.query('SELECT account_id FROM inputs WHERE id=$1', [inputId]);
    await new CommercialJobs(pool, new Map()).creditConfirmedPurchase(accountId, 'lv010-fixture', 1);
    const initialBalance = await balance();
    let aborted = false;
    const execute = vi.spyOn(videoFixture, 'execute').mockImplementationOnce(async (_input, _options, _id, signal) => {
      const deadline = AbortSignal.timeout(8000);
      await new Promise<void>(resolve => {
        deadline.addEventListener('abort', () => resolve(), { once: true });
        signal?.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true });
      });
      throw new Error('Aborted');
    });
    try {
      const queued = await post('jobs', { inputId, requestKey: 'lv010-job', service: videoFixture.key, options: {} }, owner);
      expect(queued.status).toBe(202);
      const job = 'jobs/' + (await queued.json()).id;
      await until(() => execute.mock.calls.length > 0 ? Promise.resolve(true) : Promise.resolve(false), Boolean);
      expect((await post(job + '/cancel', {}, stranger)).status).toBe(404);
      const cancelled = await Promise.all([post(job + '/cancel', {}, owner), post(job + '/cancel', {}, owner)]);
      expect(cancelled.map(response => response.status)).toEqual([200, 200]);
      expect(aborted).toBe(true);
      expect(await balance()).toEqual(initialBalance);
      const retries = await Promise.all([post(job + '/retry', {}, owner), post(job + '/retry', {}, owner)]);
      expect(retries.map(response => response.status)).toEqual([202, 202]);
      const [first, second] = await Promise.all(retries.map(response => response.json()));
      expect(first).toEqual(second);
      await until(async () => (await get('jobs/' + first.id, owner)).json(), result => result.state === 'succeeded');
      expect(await balance()).toEqual({ ...initialBalance, available: initialBalance.available - 1, consumed: initialBalance.consumed + 1 });
    } finally { execute.mockRestore(); }
  }, 15_000);

  it('stores style and tracks in one revision and keeps reusable presets scoped to their account', async () => {
    const owner = await login(codes[0]);
    const stranger = await login(codes[1]);
    const store = new CommercialJobs(pool, new Map());
    const draft = '7\n00:00:00,200 --> 00:00:01,500\nHola';
    const original = '8\n00:00:00,000 --> 00:00:00,800\nاختبار';
    const style = { ...defaultPilotStyle, fontFamily: 'monospace', alignment: 'right', anchor: { x: .72, y: .31 } };
    const id = await store.createSubtitleProject(accounts[0], Buffer.from('synthetic'), 'style.mp4', 2, draft, undefined, original);
    const path = 'projects/' + id;
    const read = async () => (await get(path, owner)).json();
    expect(await read()).toMatchObject({ revision: 1, style: null });
    expect((await post(path, { style: { ...style, anchor: { x: 2, y: .31 } }, draft: '', revision: 1 }, owner)).status).toBe(422);
    expect(await read()).toMatchObject({ draft, originalDraft: original, style: null, revision: 1 });
    expect((await post(path, { style, revision: 1 }, stranger)).status).toBe(404);
    expect((await post(path, { style, revision: 1 }, owner)).status).toBe(200);
    expect(await read()).toMatchObject({ draft, originalDraft: original, style, revision: 2 });
    expect((await post(path, { draft, revision: 2 }, owner)).status).toBe(200);
    expect(await read()).toMatchObject({ style, originalDraft: original, revision: 3 });
    const changed = { ...style, textColor: '#ffd166' };
    const saves = await Promise.all([
      post(path, { style: changed, originalDraft: original.replace('00,800', '01,000'), revision: 3 }, owner),
      post(path, { style: null, draft: '', revision: 3 }, owner),
    ]);
    expect(saves.map(response => response.status).sort()).toEqual([200, 409]);
    const winner = await read();
    expect(winner).toMatchObject(saves[0].ok ?
      { draft, style: changed, originalDraft: original.replace('00,800', '01,000'), revision: 4 } :
      { draft: '', style: null, originalDraft: original, revision: 4 });

    const presets = 'subtitle-presets';
    expect((await post(presets, { name: 'Test', style: { ...style, backgroundColor: 'url(x)' } }, owner)).status).toBe(422);
    expect((await post(presets, { name: ' Test ', style }, owner)).status).toBe(200);
    expect(await (await get(presets, owner)).json()).toEqual([{ name: 'Test', style }]);
    expect(await (await get(presets, stranger)).json()).toEqual([]);
    expect((await post(presets + '/delete', { name: 'Test' }, stranger)).status).toBe(404);
    for (let n = 1; n < 12; n++) {
      expect((await post(presets, { name: 'Test ' + n, style }, owner)).status).toBe(200);
    }
    expect((await post(presets, { name: 'Full', style }, owner)).status).toBe(422);
    expect((await post(presets, { name: 'Test', style: changed }, owner)).status).toBe(200);
    expect((await post(presets + '/delete', { name: 'Test' }, owner)).status).toBe(200);
    expect(await read()).toEqual(winner);
  });

  it('uses the configured HTTPS origin and rejects spoofed forwarded headers', async () => {
    const account = await new CommercialJobs(pool, new Map()).createAccount();
    const code = invitation();
    const origin = 'https://lv-private.example';
    const local = await startPilot({
      pool, port: 0, privateOrigin: origin, proxyHost: 'lv-private.example',
      invitations: new Map([[code, account]]),
      services: [{ adapter: pdfToCsv, label: 'PDF', accepts: '.pdf', filename: 'test.csv', contentType: 'text/csv' }],
      payments,
    });
    const loginFrom = (host: string, requestOrigin: string) => new Promise<{ status?: number; cookie?: string }>((resolve, reject) => {
      const request = httpRequest(local.localOrigin + '/pilot/api/login', { method: 'POST', headers: {
        host, origin: requestOrigin, 'content-type': 'application/json',
        'x-forwarded-host': 'lv-private.example', 'x-forwarded-proto': 'https',
      } }, response => {
        response.resume();
        resolve({ status: response.statusCode, cookie: response.headers['set-cookie']?.[0] });
      });
      request.on('error', reject);
      request.end(JSON.stringify({ code }));
    });
    try {
      expect((await loginFrom('wrong.example', origin)).status).toBe(403);
      expect((await loginFrom('lv-private.example', 'https://wrong.example')).status).toBe(403);
      const valid = await loginFrom('lv-private.example', origin);
      expect(valid.status).toBe(200);
      expect(valid.cookie).toContain('; Secure');
    } finally {
      await local.close();
    }
  });

  it('exposes opt-in PayPal Sandbox SDK resources only on authenticated checkout', async () => {
    const account = await new CommercialJobs(pool, new Map()).createAccount();
    const code = invitation();
    const sandboxId = 'sandbox-client-id';
    const orderId = 'PAYPAL-SDK-TEST';
    const sandbox = createPayPalSandbox(sandboxId, 'sandbox-secret', 'merchant-fixture', async url =>
      String(url).endsWith('/token')
        ? Response.json({ access_token: 'sandbox-fixture' })
        : Response.json({ id: orderId, links: [{
          rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=' + orderId,
        }] }));
    const local = await startPilot({
      pool, port: 0, payments: sandbox, paypalWebClientId: sandboxId,
      invitations: new Map([[code, account]]),
      services: [{ adapter: pdfToCsv, label: 'PDF', accepts: '.pdf', filename: 'test.csv', contentType: 'text/csv' }],
    });
    const base = local.origin + '/pilot/';
    const checkout = base + 'api/checkout';
    try {
      expect((await fetch(base)).headers.get('content-security-policy')).not.toContain('paypal.com');
      expect((await fetch(base + 'paypal-web/', { redirect: 'manual' })).status).toBe(303);
      expect((await fetch(checkout + '/browser-config')).status).toBe(401);
      const login = await fetch(base + 'api/login', {
        method: 'POST', headers: { origin: local.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      const headers = { cookie };
      const page = await fetch(base + 'paypal-web/', { headers });
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toContain('https://www.sandbox.paypal.com');
      expect(page.headers.get('content-security-policy')).not.toContain('https://www.paypal.com');
      expect(await (await fetch(checkout + '/browser-config', { headers })).json()).toEqual({ clientId: sandboxId });
      const response = await fetch(checkout, { method: 'POST', headers: { ...headers, origin: local.origin }, body: '{}' });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ providerOrderId: orderId });
    } finally {
      await local.close();
    }
  });
});
