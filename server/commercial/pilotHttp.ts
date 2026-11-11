import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { Pool } from 'pg';
import { parseSRT, parseTimeToSeconds } from '../../utils/helpers';
import { TestCheckout } from './checkout';
import { CommercialJobs, JobError, type JobAdapter, type FileInput } from './jobs';
import { testPackage, type PilotPayments } from './pilotPayments';
import { isMp4, probeDuration } from './pilotVideo';
import { parsePilotStyle } from './pilotStyles';
import { convertPilotSubtitle, maxPilotSubtitleBytes } from './pilotSubtitleImport';
import { parseHighlights, type SavedHighlights } from './pilotHighlights';
import { pilotLocales } from './web/pilotLocales.js';
import { firstReleaseLanguages } from '../../config/launchLanguages';
import { videoPackages } from '../../config/videoPackages';
import { createPreviewAttribution } from './previewAttribution';
import { commercialSessionSeconds, createAccountAccess, normalizeEmail, type SendAccessCode } from './accountAccess';
import { commercialLocale, demoAssets, renderCommercialPage } from './commercialPages';
import { commercialLandingStyle } from '../pilot-site/render';
import { landingStyle } from '../pilot-site/landingStyle';
import { createSupabaseRoutes } from './supabaseRoutes';
import type { SupabaseAccessConfig } from './supabaseAccess';
import { createFirebaseRoutes } from './firebaseRoutes';
import type { FirebaseAccessConfig } from './firebaseAccess';
import { UploadError, type ResumableUploads } from './resumableUploads';

const maxFile = 1048576;
const maxSrt = maxPilotSubtitleBytes;
const cookie = 'linguistvision_pilot';
const sessionSeconds = 8 * 60 * 60;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const sha256 = (value: string) => createHash('sha256').update(value).digest();

class RequestError extends Error {
  constructor(readonly status: number, message: string, readonly key?: string) { super(message); }
}

async function readBody(req: IncomingMessage, limit: number) {
  if (Number(req.headers['content-length']) > limit) {
    req.resume();
    throw new RequestError(413, 'El archivo o la solicitud supera el límite del piloto.');
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > limit) {
      req.resume();
      throw new RequestError(413, 'El archivo o la solicitud supera el límite del piloto.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

async function jsonBody(req: IncomingMessage, limit = 4096) {
  const input = await readBody(req, limit);
  try {
    const data = JSON.parse(input.toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new RequestError(400, 'Solicitud inválida.');
  }
}

function validateDraft(draft: unknown, duration: number) {
  if (typeof draft !== 'string' || Buffer.byteLength(draft) > maxSrt || draft.includes('\0')) {
    throw new RequestError(422, 'Se requiere un SRT UTF-8 de hasta 64 KiB.', 'projectSrtInvalid');
  }
  const normalized = draft.replace(/\r\n?/g, '\n').trim();
  const blocks = normalized.split(/\n[^\S\n]*\n+/);
  if (blocks.length > 1000) throw new RequestError(422, 'El SRT supera los 1000 segmentos.', 'projectSrtInvalid');
  const timestamp = '(\\d{2,3}:\\d{2}:\\d{2}[,.]\\d{3})';
  const timing = new RegExp('^' + timestamp + '\\s+-->\\s+' + timestamp + '$');
  for (const block of blocks) {
    const [index, times, ...text] = block.trim().split('\n');
    const match = timing.exec(times?.trim() ?? '');
    const start = parseTimeToSeconds(match?.[1] ?? '');
    const end = parseTimeToSeconds(match?.[2] ?? '');
    if (!/^\d+$/.test(index.trim()) || !Number.isFinite(start) || !Number.isFinite(end) ||
        end <= start || !text.join('\n').trim()) {
      throw new RequestError(422, 'El SRT contiene un segmento inválido.', 'projectSrtInvalid');
    }
    if (end > Math.round(duration * 1000) / 1000) {
      throw new RequestError(422, 'Un subtítulo termina después del video.', 'projectSrtOutside');
    }
  }
  return normalized;
}

function validateStyle(value: unknown) {
  const style = parsePilotStyle(value);
  if (!style) throw new RequestError(422, 'Estilo de subtítulos inválido.', 'styleInvalid');
  return style;
}

async function decodeSubtitle(file: FormDataEntryValue | null, duration: number) {
  const invalid = new RequestError(422, 'Selecciona subtítulos UTF-8 de hasta 64 KiB.', 'projectSrtInvalid');
  if (!(file instanceof File) || !file.size || file.size > maxSrt) throw invalid;
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw invalid; }
  let result: ReturnType<typeof convertPilotSubtitle>;
  try { result = convertPilotSubtitle(file.name, content, duration); }
  catch (error) {
    throw new RequestError(422, 'No se pudo convertir el archivo de subtítulos.', (error as Error).message);
  }
  return { ...result, draft: validateDraft(result.draft, duration) };
}

function sendVideo(res: ServerResponse, input: Buffer, range?: string) {
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
  if (!range) {
    res.writeHead(200, { ...headers, 'Content-Length': input.length }).end(input);
    return;
  }
  const bytes = /^bytes=(\d*)-(\d*)$/.exec(range);
  const start = bytes?.[1] ? Number(bytes[1]) : Math.max(0, input.length - Number(bytes?.[2] || 0));
  const end = Math.min(bytes?.[1] && bytes[2] ? Number(bytes[2]) : input.length - 1, input.length - 1);
  if (start > end) {
    res.writeHead(416, { 'Content-Range': 'bytes */' + input.length }).end();
    return;
  }
  res.writeHead(206, {
    ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${input.length}`,
  }).end(input.subarray(start, end + 1));
}

function sendPrivateVideo(res: ServerResponse, input: FileInput, range?: string) {
  let start = 0, end = input.size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': 'bytes */' + input.size }).end(); return; }
    start = match[1] ? Number(match[1]) : Math.max(0, input.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= input.size) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + input.size }).end(); return;
    }
  }
  res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${input.size}` } : {}) });
  const stream = createReadStream(input.path, { start, end });
  stream.on('error', error => res.destroy(error));
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function json(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export interface PilotService {
  adapter: JobAdapter;
  label: string;
  accepts: string;
  filename: string;
  contentType: string;
  directions?: readonly { id: string; label: string; status?: 'verified' | 'beta' }[];
  editableVideo?: boolean;
}

interface PilotConfig {
  pool: Pool;
  invitations: ReadonlyMap<string, string>;
  services: readonly PilotService[];
  payments: PilotPayments;
  paypalWebClientId?: string;
  port: number;
  editorAssets?: URL;
  uploads?: ResumableUploads;
  privateOrigin?: string;
  proxyHost?: string;
  onWorkerError?: () => void;
  previewLaunchLanguages?: boolean;
  previewConversionAttribution?: boolean;
  commercialPreview?: { sendAccessCode: SendAccessCode } | { supabase: SupabaseAccessConfig } | { firebase: FirebaseAccessConfig };
}

export async function startPilot(config: PilotConfig) {
  const { pool, payments } = config;
  if (config.previewLaunchLanguages && !payments.simulateApproval) {
    throw new Error('The launch language preview requires simulated payments.');
  }
  if (config.previewConversionAttribution && (!payments.simulateApproval || config.privateOrigin || config.proxyHost)) {
    throw new Error('The conversion preview requires loopback and simulated payments.');
  }
  const firebasePrivate = config.commercialPreview && 'firebase' in config.commercialPreview &&
    !config.commercialPreview.firebase.emulator && config.privateOrigin &&
    new URL(config.privateOrigin).protocol === 'https:' &&
    new URL(config.privateOrigin).hostname.endsWith('.ts.net');
  if (config.commercialPreview && ((!firebasePrivate && (config.privateOrigin || config.proxyHost)) || !config.editorAssets)) {
    throw new Error('The commercial preview requires loopback and a built editor.');
  }
  const commercial = config.commercialPreview;
  const access = commercial && createAccountAccess(pool, 'sendAccessCode' in commercial ? commercial.sendAccessCode : async () => {
    throw new Error('Local access codes are disabled with a configured identity provider.');
  });
  const supabaseRoutes = access && commercial && 'supabase' in commercial && createSupabaseRoutes(commercial.supabase,
    access, cookie, async req => new URLSearchParams((await readBody(req, 4096)).toString('utf8')));
  const firebase = access && commercial && 'firebase' in commercial && createFirebaseRoutes(commercial.firebase, access,
    cookie, req => jsonBody(req, 8192));
  const previewLanguages = config.previewLaunchLanguages || access
    ? firstReleaseLanguages.map(({ id, name, locale }) => ({ id, name, locale })) : undefined;
  const previewLanguageIds = new Set<string>(previewLanguages?.map(({ id }) => id));
  const availableDirections = new Set(config.services
    .filter(({ adapter }) => adapter.key.startsWith('video-to-srt:'))
    .flatMap(({ directions }) => directions?.map(({ id }) => id) ?? []));
  const paypalWebClientId = payments.simulateApproval ? undefined : config.paypalWebClientId;
  const firebaseConfig = commercial && 'firebase' in commercial ? commercial.firebase : undefined;
  const firebasePolicy = firebaseConfig ? "; frame-src https://" + firebaseConfig.web.authDomain +
    " https://accounts.google.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://" +
    firebaseConfig.web.authDomain + ' https://www.googleapis.com' +
    (firebaseConfig.emulator ? ' http://' + firebaseConfig.emulator : '') : '';
  const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'" +
    (firebaseConfig ? ' https://apis.google.com' : '') +
    "; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" + firebasePolicy;
  const landingCsp = csp + "; style-src 'sha256-" +
    createHash('sha256').update(access ? commercialLandingStyle : landingStyle).digest('base64') + "'";
  const paypalWebCsp = "default-src 'self'; script-src 'self' https://www.sandbox.paypal.com; frame-src https://www.sandbox.paypal.com https://sandbox.paypal.com; connect-src 'self' https://www.sandbox.paypal.com https://api-m.sandbox.paypal.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
  const services = new Map(config.services.map(service => [service.adapter.key, service]));
  if (access && config.services.some(service => !service.adapter.measurePrice)) {
    throw new Error('Commercial video services require server-measured seconds.');
  }
  const jobs = new CommercialJobs(pool, new Map(config.services.map(({ adapter }) => [adapter.key, adapter])), config.uploads);
  const checkout = new TestCheckout(pool, jobs, payments);
  const receivingUploads = new Set<string>();
  let finalizingUploads = 0;
  const invitations = [...config.invitations].map(([code, account]) => {
    if (code.length < 24 || !uuid.test(account)) throw new Error('Invalid pilot invitation.');
    return { hash: sha256(code), account };
  });
  if (!access && (!invitations.length || !services.size)) throw new Error('Access and a service are required.');
  const sessions = new Map<string, { account: string; expires: number }>();
  const privateOrigin = config.privateOrigin ? new URL(config.privateOrigin) : undefined;
  if (privateOrigin && (privateOrigin.protocol !== 'https:' || config.privateOrigin !== privateOrigin.origin)) {
    throw new Error('The private pilot origin must be a canonical HTTPS origin.');
  }
  if (config.proxyHost && (!privateOrigin || !/^[\w.-]+(?::\d+)?$/.test(config.proxyHost))) {
    throw new Error('The private proxy host must be a hostname with an optional port.');
  }
  const secureCookie = privateOrigin ? '; Secure' : '';
  let failedLogins = 0;
  let resetFailedLogins = 0;
  let emailRequests = 0;
  let resetEmailRequests = 0;
  const assets = new Map(await Promise.all([
    ['/', 'pilot.html', 'text/html; charset=utf-8'],
    ['/pilot.js', 'pilot.js', 'text/javascript; charset=utf-8'],
    ['/pilotDrive.js', 'pilotDrive.js', 'text/javascript; charset=utf-8'],
    ['/pilotUpload.js', 'pilotUpload.js', 'text/javascript; charset=utf-8'],
    ...(access ? [['/commercialDemo.js', 'commercialDemo.js', 'text/javascript; charset=utf-8'],
      ['/account.css', 'account.css', 'text/css; charset=utf-8']] : []),
    ...(paypalWebClientId ? [
      ['/paypalWebCheckout.js', 'paypalWebCheckout.js', 'text/javascript; charset=utf-8'],
      ['/paypalWebPage.js', 'paypalWebPage.js', 'text/javascript; charset=utf-8'],
    ] : []),
    ['/pilotLocales.js', 'pilotLocales.js', 'text/javascript; charset=utf-8'],
    ...pilotLocales.map(({ id }) => ['/locales/' + id + '.js', 'locales/' + id + '.js', 'text/javascript; charset=utf-8']),
    ['/pilot.css', 'pilot.css', 'text/css; charset=utf-8'],
  ].map(async ([route, file, type]) => {
    const body = await readFile(new URL('./web/' + file, import.meta.url));
    return [route, { type, body: route === '/' && (previewLanguages || firebase)
      ? Buffer.from(body.toString('utf8').replace('data-launch-language-preview="false"',
        previewLanguages ? 'data-launch-language-preview="true"' : 'data-launch-language-preview="false"')
        .replace('</head>', (firebase ? '<script type="module" src="/pilot/editor-assets/firebaseAuth.js"></script>' : '') + '</head>'))
      : body }] as const;
  })));
  const paypalWebPage = paypalWebClientId
    ? await readFile(new URL('./web/paypalWeb.html', import.meta.url))
    : undefined;
  const samples = new Map<string, { type: string; body: Buffer }>(await Promise.all(access ? [...demoAssets].map(async ([route, [name, type]]) =>
    [route, { type, body: await readFile(new URL('../pilot-site/assets/' + name, import.meta.url)) }] as const,
  ) : []));

  let origin = '';
  let host = '';
  let attribution: ReturnType<typeof createPreviewAttribution> | undefined;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', csp);
    try {
      if (req.headers.host !== host) throw new RequestError(403, 'Origen inválido.');
      const url = new URL(req.url ?? '/', origin);
      if (url.origin !== origin) throw new RequestError(403, 'Origen inválido.');
      if (access && (req.method === 'GET' || req.method === 'HEAD')) {
        const sample = samples.get(url.pathname);
        if (sample) {
          if (req.method === 'GET' && sample.type === 'video/mp4') sendVideo(res, sample.body, req.headers.range);
          else res.writeHead(200, { 'Content-Type': sample.type, 'Content-Length': sample.body.length })
            .end(req.method === 'HEAD' ? undefined : sample.body);
          return;
        }
        if (url.pathname === '/sitemap.xml' && attribution) {
          res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' })
            .end(req.method === 'HEAD' ? undefined : attribution.sitemap);
          return;
        }
      }
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(302, { Location: access ? '/es-419/subtitulos-video/' : '/pilot/' }).end();
        return;
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && attribution) {
        const session = attribution.read(req.headers.cookie);
        const page = attribution.pages.get(url.pathname);
        if (page) {
          if (req.method === 'HEAD') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': landingCsp }).end();
            return;
          }
          const { session: entry, cookie } = session
            ? { session, cookie: undefined }
            : attribution.issue(page.locale, url, req.headers.referer);
          await pool.query(
            `INSERT INTO pilot_preview_funnel_entries(session_id,locale,event,source)
             VALUES ($1,$2,'landing_view',$3) ON CONFLICT DO NOTHING`,
            [entry.sessionId, page.locale, entry.source],
          );
          if (cookie) res.setHeader('Set-Cookie', cookie);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': landingCsp }).end(page.html);
          return;
        }
        const accountPage = access && ['/pilot/register/', '/pilot/sign-in/'].includes(url.pathname);
        if (req.method === 'GET' && (url.pathname === '/pilot/enter' || accountPage)) {
          if (session) {
            await pool.query(
              `INSERT INTO pilot_preview_funnel_entries(session_id,locale,event,source)
               SELECT session_id,locale,'product_entry',source FROM pilot_preview_funnel_entries
               WHERE session_id=$1 AND locale=$2 AND event='landing_view' ON CONFLICT DO NOTHING`,
              [session.sessionId, session.locale],
            );
          }
          if (!accountPage) {
            res.writeHead(303, { Location: '/pilot/' }).end();
            return;
          }
        }
      }
      if (!url.pathname.startsWith('/pilot/')) throw new RequestError(404, 'Ruta no disponible.');
      const path = url.pathname.slice('/pilot'.length);
      const token = req.headers.cookie?.split(';').map(value => value.trim())
        .find(value => value.startsWith(cookie + '='))?.slice(cookie.length + 1);
      const language = access && commercialLocale(url.searchParams.get('lang'));
      if (access && language && req.method === 'GET' && path === '/demo/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderCommercialPage(language, 'demo'));
        return;
      }
      if (supabaseRoutes && await supabaseRoutes(req, res, url, origin, token)) return;
      if (firebase && await firebase.handle(req, res, url, origin, token)) return;
      if (access && language && (path === '/register/' || path === '/sign-in/')) {
        const page = path === '/register/' ? 'register' : 'sign-in';
        const show = (status: number, email?: string, invalid?: boolean) => res.writeHead(status, {
          'Content-Type': 'text/html; charset=utf-8',
        }).end(renderCommercialPage(language, page, email, invalid));
        if (req.method === 'GET') { show(200); return; }
        if (req.method !== 'POST' || req.headers.origin !== origin) throw new RequestError(403, 'Origen inválido.');
        const body = new URLSearchParams((await readBody(req, 2048)).toString('utf8'));
        const email = normalizeEmail(body.get('email'));
        if (!email) { show(422); return; }
        const code = body.get('code');
        if (code === null) {
          const now = Date.now();
          if (now >= resetEmailRequests) {
            emailRequests = 0;
            resetEmailRequests = now + 60_000;
          }
          if (emailRequests++ >= 30) throw new RequestError(429, 'Demasiadas solicitudes.');
          await access.request(email, language.id, page === 'register');
          show(202, email);
          return;
        }
        const verified = /^\d{8}$/.test(code) && await access.verify(email, code);
        if (!verified) { show(422, email, true); return; }
        if (token) await access.revoke(token);
        res.setHeader('Set-Cookie', cookie + '=' + verified + '; Path=/pilot/; HttpOnly; SameSite=Lax; Max-Age=' +
          commercialSessionSeconds + secureCookie);
        res.writeHead(303, { Location: '/pilot/?lang=' + language.id }).end();
        return;
      }
      const asset = req.method === 'GET' && assets.get(path);
      if (access && language && path === '/' && req.method === 'GET' &&
          (!token || !(firebase ? await firebase.account(token) : await access.account(token)))) {
        res.writeHead(303, { Location: '/pilot/sign-in/?lang=' + language.id }).end();
        return;
      }
      if (asset) {
        res.writeHead(200, { 'Content-Type': asset.type }).end(asset.body);
        return;
      }
      const editorAsset = /^\/editor-assets\/((?:assets\/)?[\w.-]+\.(js|wasm))$/.exec(path);
      if (req.method === 'GET' && config.editorAssets && editorAsset) {
        const file = new URL(editorAsset[1], config.editorAssets);
        const info = await stat(file).catch(() => undefined);
        if (!info?.isFile()) throw new RequestError(404, 'Recurso no disponible.');
        res.writeHead(200, {
          'Content-Type': editorAsset[2] === 'wasm' ? 'application/wasm' : 'text/javascript; charset=utf-8',
          'Content-Length': info.size,
        });
        const stream = createReadStream(file);
        stream.on('error', error => res.destroy(error));
        res.on('close', () => stream.destroy());
        stream.pipe(res);
        return;
      }

      if (['POST','PUT','PATCH','DELETE'].includes(req.method ?? '') && req.headers.origin !== origin) {
        throw new RequestError(403, 'Origen inválido.');
      }

      if (path === '/api/login' && req.method === 'POST') {
        if (access) throw new RequestError(404, 'Ruta no disponible.');
        const now = Date.now();
        if (now >= resetFailedLogins) {
          failedLogins = 0;
          resetFailedLogins = now + 60_000;
        }
        if (failedLogins >= 10) throw new RequestError(429, 'Demasiados intentos. Espera un minuto.');
        const { code } = await jsonBody(req);
        const digest = sha256(typeof code === 'string' ? code : '');
        const invite = invitations.find(item => timingSafeEqual(digest, item.hash));
        if (!invite) {
          failedLogins++;
          throw new RequestError(401, 'Código de invitación inválido.');
        }
        if (token) sessions.delete(token);
        for (const [key, session] of sessions) if (session.expires <= Date.now()) sessions.delete(key);
        const next = randomBytes(32).toString('base64url');
        sessions.set(next, { account: invite.account, expires: Date.now() + sessionSeconds * 1000 });
        res.setHeader('Set-Cookie', cookie + '=' + next + '; Path=/pilot/; HttpOnly; SameSite=Strict; Max-Age=' + sessionSeconds + secureCookie);
        json(res, 200, { ok: true });
        return;
      }
      const commercialAccount = access && token ? (firebase ? await firebase.account(token) : await access.account(token)) : undefined;
      const session = commercialAccount ? { account: commercialAccount, expires: Infinity } : token ? sessions.get(token) : undefined;
      if (req.method === 'GET' && path === '/paypal-web/' && paypalWebPage) {
        if (!session || session.expires <= Date.now()) {
          res.writeHead(303, { Location: '/pilot/' }).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': paypalWebCsp });
        res.end(paypalWebPage);
        return;
      }
      if (!session || session.expires <= Date.now()) throw new RequestError(401, 'Inicia sesión con tu invitación.');
      const account = session.account;

      if (req.method === 'GET' && path === '/api/checkout/browser-config' && paypalWebClientId) {
        json(res, 200, { clientId: paypalWebClientId, ...(access ? { packages: videoPackages } : {}) });
        return;
      }

      if (path === '/api/logout' && req.method === 'POST') {
        if (access && !firebase) await access.revoke(token!);
        sessions.delete(token!);
        res.setHeader('Set-Cookie', cookie + '=; Path=/pilot/; HttpOnly; SameSite=Strict; Max-Age=0' + secureCookie);
        json(res, 200, { ok: true });
        return;
      }
      if (path === '/api/account' && req.method === 'GET') {
        json(res, 200, {
          balance: await jobs.balance(account),
          subtitleProjects: Boolean(config.editorAssets),
          ...(config.uploads ? { uploads: { maxBytes: config.uploads.limits.maxFileBytes, maxSeconds: config.uploads.limits.maxDuration,
            chunkBytes: config.uploads.limits.chunkBytes, quotaBytes: config.uploads.limits.quotaBytes,
            maxActive: config.uploads.limits.maxActiveUploads, retentionHours: config.uploads.limits.ttlMs / 3600000, scope: account } } : {}),
          ...(firebaseConfig && !firebaseConfig.emulator ? { drive: { uid: await firebase.userId(token) } } : {}),
          paymentMode: payments.simulateApproval ? 'simulated' : 'paypal-sandbox',
          ...(access ? { packages: videoPackages } : {}),
          ...(paypalWebClientId ? { paypalWebCheckout: true } : {}),
          ...(previewLanguages ? { launchLanguagePreview: previewLanguages } : {}),
          services: config.services.map(({ adapter, label, accepts, directions, editableVideo }) => ({
            key: adapter.key, price: adapter.price, label, accepts, directions,
            editableVideo: Boolean(config.editorAssets && editableVideo),
          })),
        });
        return;
      }
      if (previewLanguages && path === '/api/language-requests' && req.method === 'POST') {
        const { source, target } = await jsonBody(req, 1024);
        if (typeof source !== 'string' || typeof target !== 'string' ||
            !previewLanguageIds.has(source) || !previewLanguageIds.has(target) ||
            availableDirections.has(source + '-' + target)) {
          throw new RequestError(422, 'Solicitud de idioma inválida.');
        }
        await pool.query(
          'INSERT INTO pilot_language_requests (account_id, source_id, target_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [account, source, target],
        );
        json(res, 200, { ok: true });
        return;
      }
      if (path === '/api/checkout' && req.method === 'POST') {
        const checkoutPackage = access ? (await jsonBody(req)).packageId : undefined;
        const pack = access ? videoPackages.find(plan => plan.id === checkoutPackage) : testPackage;
        if (!pack) throw new RequestError(422, 'Selecciona un paquete válido.');
        const order = await checkout.createOrder(account, pack.currency, pack.amount, pack.credits,
          origin, attribution?.read(req.headers.cookie));
        json(res, 201, { id: order.id, url: order.url,
          ...(paypalWebClientId ? { providerOrderId: order.providerOrderId } : {}),
        });
        return;
      }
      const paymentRoute = /^\/api\/checkout\/([^/]+)(?:\/(capture|simulate))?$/.exec(path);
      if (paymentRoute && uuid.test(paymentRoute[1])) {
        const [, orderId, action] = paymentRoute;
        if (req.method === 'GET' && !action) {
          const status = await checkout.status(account, orderId);
          if (!status) throw new RequestError(404, 'Orden de pago no disponible.');
          json(res, 200, { status });
          return;
        }
        if (req.method === 'POST' && (action === 'capture' || (action === 'simulate' && payments.simulateApproval))) {
          const { token } = await jsonBody(req);
          if (action === 'capture' && !payments.simulateApproval && (typeof token !== 'string' || !token)) {
            throw new RequestError(400, 'Falta la confirmación de PayPal.');
          }
          if (!await checkout.requestCapture(account, orderId, action === 'simulate', typeof token === 'string' ? token : undefined)) {
            throw new RequestError(404, 'Orden de pago no disponible.');
          }
          json(res, 202, { received: true });
          return;
        }
      }
      if (config.uploads && path === '/api/uploads' && req.method === 'POST') {
        const { size, name, requestKey } = await jsonBody(req);
        if (typeof size !== 'number' || typeof name !== 'string' || typeof requestKey !== 'string') throw new RequestError(422, 'Faltan los datos del video.');
        json(res, 201, await config.uploads.begin(account, size, name, requestKey));
        return;
      }
      const uploadRoute = /^\/api\/uploads\/([^/]+)(?:\/(complete|abort))?$/.exec(path);
      if (config.uploads && uploadRoute && uuid.test(uploadRoute[1])) {
        const [, id, action] = uploadRoute;
        if (req.method === 'GET' && !action) { json(res, 200, await config.uploads.status(account, id)); return; }
        if (req.method === 'PUT' && !action) {
          if (receivingUploads.has(account) || receivingUploads.size >= 4) {
            req.resume(); throw new RequestError(429, 'Ya hay una carga en curso. Espera y vuelve a intentar.');
          }
          const offset = Number(req.headers['upload-offset']);
          if (req.headers['upload-offset'] === undefined || !Number.isSafeInteger(offset) || offset < 0) throw new RequestError(422, 'Posición de carga inválida.');
          receivingUploads.add(account);
          try {
            const bytes = await readBody(req, config.uploads.limits.chunkBytes);
            json(res, 200, await config.uploads.append(account, id, offset, bytes));
          } finally { receivingUploads.delete(account); }
          return;
        }
        if (req.method === 'POST' && action === 'complete') {
          if (finalizingUploads >= 2) throw new RequestError(429, 'Hay videos en validación. Vuelve a intentar.');
          finalizingUploads++;
          try {
            await config.uploads.complete(account, id);
            json(res, 200, { id: await jobs.addFileInput(account, id) });
          } finally { finalizingUploads--; }
          return;
        }
        if (req.method === 'POST' && action === 'abort') {
          // Ready assets belong to inputs/projects. Delete through their authorized lifecycle instead.
          await config.uploads.abortIncomplete(account, id);
          json(res, 200, { deleted: true }); return;
        }
      }
      if (config.uploads && config.editorAssets && path === '/api/projects/from-upload' && req.method === 'POST') {
        const { uploadId, srt, originalSrt, srtName, originalName } = await jsonBody(req, 2 * maxSrt + 4096);
        if (typeof uploadId !== 'string' || !uuid.test(uploadId) || typeof srt !== 'string' ||
            (originalSrt !== undefined && typeof originalSrt !== 'string')) throw new RequestError(422, 'Selecciona los subtítulos del proyecto.');
        const file = await config.uploads.get(account, uploadId);
        await jobs.addFileInput(account, uploadId);
        const translated = await decodeSubtitle(new File([srt], typeof srtName === 'string' ? srtName : 'track.srt'), file.metadata.duration);
        const original = typeof originalSrt === 'string' && originalSrt.length
          ? await decodeSubtitle(new File([originalSrt], typeof originalName === 'string' ? originalName : 'original.srt'), file.metadata.duration) : undefined;
        const existing = await jobs.subtitleProject(account, uploadId);
        if (existing) { json(res, 200, { id: uploadId }); return; }
        const id = await jobs.createSubtitleProject(account, uploadId, file.name, file.metadata.duration, translated.draft, undefined, original?.draft);
        json(res, 201, { id, converted: [] }); return;
      }
      if (path === '/api/files' && req.method === 'POST') {
        const bytes = await readBody(req, maxFile);
        if (!bytes.length) throw new RequestError(400, 'Selecciona un archivo.');
        json(res, 201, { id: await jobs.addInput(account, bytes) });
        return;
      }
      if (config.editorAssets && path === '/api/projects') {
        if (req.method === 'GET') {
          json(res, 200, await jobs.subtitleProjects(account));
          return;
        }
        if (req.method === 'POST') {
          const bytes = await readBody(req, maxFile + 2 * maxSrt + 16384);
          let form: FormData;
          try {
            form = await new Response(new Uint8Array(bytes), {
              headers: { 'Content-Type': req.headers['content-type'] ?? '' },
            }).formData();
          } catch {
            throw new RequestError(400, 'Selecciona un video y un SRT.');
          }
          const video = form.get('video');
          if (!(video instanceof File) || !video.size || video.size > maxFile) {
            throw new RequestError(422, 'Selecciona un video de hasta 1 MiB.', 'fileLimit');
          }
          const input = Buffer.from(await video.arrayBuffer());
          const duration = await (isMp4(input) ? probeDuration(input).catch(() => 0) : 0);
          if (!duration) throw new RequestError(422, 'Se requiere un MP4 válido.', 'projectVideoInvalid');
          const translated = await decodeSubtitle(form.get('srt'), duration);
          const original = form.get('originalSrt');
          const originalTrack = original === null || original === '' || (original instanceof File && !original.name && !original.size)
            ? undefined : await decodeSubtitle(original, duration);
          const name = Array.from(video.name.trim().replaceAll('\0', '')).slice(0, 120).join('') || 'MP4';
          const id = await jobs.createSubtitleProject(account, input, name, duration, translated.draft,
            undefined, originalTrack?.draft);
          json(res, 201, { id, converted: [translated, originalTrack].flatMap(track => track && track.format !== 'srt'
            ? [{ format: track.format, count: track.draft.split(/\n[^\S\n]*\n+/).length }] : []) });
          return;
        }
      }
      if (config.editorAssets && path === '/api/subtitle-presets' && req.method === 'GET') {
        json(res, 200, await jobs.subtitlePresets(account));
        return;
      }
      if (config.editorAssets && req.method === 'POST' &&
          (path === '/api/subtitle-presets' || path === '/api/subtitle-presets/delete')) {
        const body = await jsonBody(req);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || Array.from(name).length > 48 || /[\x00-\x1f\x7f]/.test(name)) {
          throw new RequestError(422, 'Nombre de preset inválido.', 'presetNameInvalid');
        }
        if (path.endsWith('/delete')) {
          if (!await jobs.deleteSubtitlePreset(account, name)) throw new RequestError(404, 'Preset no disponible.', 'presetUnavailable');
        } else if (!await jobs.saveSubtitlePreset(account, { name, style: validateStyle(body.style) })) {
          throw new RequestError(422, 'Límite de 12 presets personalizados.', 'presetLimit');
        }
        json(res, 200, { ok: true });
        return;
      }
      const projectRoute = /^\/api\/projects\/([^/]+)(?:\/(source|delete))?$/.exec(path);
      if (config.editorAssets && projectRoute && uuid.test(projectRoute[1])) {
        const [, id, action] = projectRoute;
        if (req.method === 'GET' && action === 'source') {
          const stored = await jobs.subtitleProject(account, id);
          if (!stored) throw new RequestError(404, 'Proyecto no disponible.', 'projectUnavailable');
          const file = await jobs.fileInput(account, id);
          if (file) { sendPrivateVideo(res, file, req.headers.range); return; }
          const video = await jobs.subtitleProjectSource(account, id);
          if (!video) throw new RequestError(404, 'Video no disponible.', 'projectUnavailable');
          sendVideo(res, video, req.headers.range);
          return;
        }
        if (req.method === 'POST' && action === 'delete') {
          if (!await jobs.deleteSubtitleProject(account, id)) {
            throw new RequestError(404, 'Proyecto no disponible.', 'projectUnavailable');
          }
          json(res, 200, { deleted: true });
          return;
        }
        if (!action && (req.method === 'GET' || req.method === 'POST')) {
          const project = await jobs.subtitleProject(account, id);
          if (!project) throw new RequestError(404, 'Proyecto no disponible.', 'projectUnavailable');
          if (req.method === 'GET') {
            json(res, 200, project);
            return;
          }
          const { draft, originalDraft, revision, style, highlights } = await jsonBody(req, 14 * maxSrt + 4096);
          if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1 || revision > 2147483647) {
            throw new RequestError(400, 'Revisión inválida.');
          }
          if (draft === undefined && originalDraft === undefined && style === undefined && highlights === undefined) {
            throw new RequestError(400, 'Faltan cambios del proyecto.');
          }
          const translated = draft === undefined || draft === '' ? draft as string | undefined : validateDraft(draft, project.duration);
          const original = originalDraft === undefined || originalDraft === null ? originalDraft as undefined | null :
            validateDraft(originalDraft, project.duration);
          const nextStyle = style === undefined || style === null ? style as undefined | null : validateStyle(style);
          let nextHighlights: SavedHighlights | undefined;
          if (highlights !== undefined) {
            const invalid = new RequestError(422, 'El resaltado no coincide con los subtítulos.', 'highlightInvalid');
            if (!highlights || typeof highlights !== 'object' || Array.isArray(highlights)) throw invalid;
            nextHighlights = {};
            const drafts = { translated: translated ?? project.draft,
              original: original === undefined ? project.originalDraft : original };
            for (const [track, marks] of Object.entries(highlights)) {
              if (track !== 'original' && track !== 'translated') throw invalid;
              const validated = parseHighlights(marks, parseSRT(drafts[track] ?? ''));
              if (!validated) throw invalid;
              nextHighlights[track] = validated;
            }
          }
          const saved = await jobs.saveSubtitleProject(account, id, revision, translated, original,
            nextStyle, nextHighlights);
          if (!saved) throw new RequestError(409, 'El proyecto cambió en otra pestaña o ya no está disponible.', 'projectConflict');
          json(res, 200, saved);
          return;
        }
      }
      if (path === '/api/jobs' && req.method === 'POST') {
        const { inputId, requestKey, service, options } = await jsonBody(req);
        if (typeof inputId !== 'string' || !uuid.test(inputId) || typeof requestKey !== 'string' ||
            !requestKey.length || requestKey.length > 200 || typeof service !== 'string' ||
            !options || typeof options !== 'object' || Array.isArray(options)) {
          throw new RequestError(400, 'Faltan datos del trabajo.');
        }
        const id = await jobs.enqueue(account, inputId, requestKey, service, options as Record<string, unknown>);
        json(res, 202, { id });
        return;
      }
      if (path === '/api/jobs' && req.method === 'GET') {
        json(res, 200, await jobs.recent(account));
        return;
      }
      const match = /^\/api\/jobs\/([^/]+)(\/(?:download|original|source|delete-files|project|cancel|retry))?$/.exec(path);
      if (match && uuid.test(match[1]) && req.method === 'POST') {
        if (match[2] === '/cancel') {
          const job = await jobs.status(account, match[1]);
          if (!job) throw new RequestError(404, 'Trabajo no disponible.');
          if (job.state !== 'cancelled' && !await jobs.cancel(account, job.id) &&
              (await jobs.status(account, job.id))?.state !== 'cancelled') {
            throw new RequestError(409, 'El trabajo ya terminó.', 'jobAlreadyFinished');
          }
          json(res, 200, { state: 'cancelled' });
          return;
        }
        if (match[2] === '/retry') {
          json(res, 202, { id: await jobs.retry(account, match[1]) });
          return;
        }
      }
      if (config.editorAssets && match && uuid.test(match[1]) && match[2] === '/project' && req.method === 'POST') {
        const job = await jobs.status(account, match[1]);
        if (!job || !services.get(job.service)?.editableVideo) {
          throw new RequestError(404, 'Trabajo no disponible.', 'projectUnavailable');
        }
        const file = await jobs.completedFile(account, job.id, job.service);
        if (file) {
          const result = await jobs.result(account, job.id);
          if (!result?.result) throw new RequestError(404, 'Trabajo no disponible.');
          if (await jobs.subtitleProject(account, file.id)) { json(res, 200, { id: file.id }); return; }
          const draft = validateDraft(result.result.toString('utf8'), file.metadata.duration);
          const original = result.original ? validateDraft(result.original.toString('utf8'), file.metadata.duration) : undefined;
          const id = await jobs.createSubtitleProject(account, file.id, file.name, file.metadata.duration, draft, job.id, original);
          json(res, 201, { id }); return;
        }
        const [input, result] = await Promise.all([
          jobs.completedInput(account, job.id, job.service), jobs.result(account, job.id),
        ]);
        if (!input || !result?.result) throw new RequestError(404, 'Trabajo no disponible.', 'projectUnavailable');
        const duration = await (isMp4(input) ? probeDuration(input).catch(() => 0) : 0);
        if (!duration) throw new RequestError(422, 'Se requiere un MP4 válido.', 'projectVideoInvalid');
        const draft = validateDraft(result.result.toString('utf8'), duration);
        const originalDraft = result.original ? validateDraft(result.original.toString('utf8'), duration) : undefined;
        const id = await jobs.createSubtitleProject(account, input, 'MP4 · ' + job.id.slice(0, 8), duration, draft, job.id, originalDraft);
        json(res, 201, { id });
        return;
      }
      if (match && uuid.test(match[1]) && match[2] === '/delete-files') {
        if (req.method !== 'POST' || !await jobs.deleteInput(account, match[1])) {
          throw new RequestError(404, 'Trabajo no disponible.');
        }
        json(res, 200, { deleted: true });
        return;
      }
      if (match && req.method === 'GET' && uuid.test(match[1]) &&
          (!match[2] || ['/download', '/original', '/source'].includes(match[2]))) {
        const job = await jobs.status(account, match[1]);
        if (!job) throw new RequestError(404, 'Trabajo no disponible.');
        if (!match[2]) {
          json(res, 200, job);
          return;
        }
        const service = services.get(job.service);
        if (match[2] === '/source') {
          if (!config.editorAssets || !service?.editableVideo) throw new RequestError(404, 'Video no disponible.');
          const file = await jobs.completedFile(account, job.id, job.service);
          if (file) { sendPrivateVideo(res, file, req.headers.range); return; }
          const input = await jobs.completedInput(account, job.id, job.service);
          if (!input) throw new RequestError(404, 'Video no disponible.');
          sendVideo(res, input, req.headers.range);
          return;
        }
        const result = await jobs.result(account, job.id);
        const original = match[2] === '/original';
        const bytes = original ? result?.original : result?.result;
        if (!service || (original && (!config.editorAssets || !service.editableVideo)) || result?.state !== 'succeeded' || !bytes) {
          throw new RequestError(404, 'El resultado no está disponible.');
        }
        res.writeHead(200, {
          'Content-Type': service.contentType,
          'Content-Disposition': 'attachment; filename="' + (original ? 'subtitulos-original.srt' : service.filename) + '"',
          'Content-Length': bytes.length,
        }).end(bytes);
        return;
      }
      throw new RequestError(404, 'Ruta no disponible.');
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (error instanceof UploadError) json(res, error.status, { error: error.message });
      else if (error instanceof RequestError) json(res, error.status, { error: error.message, key: error.key });
      else if (error instanceof JobError) {
        const statuses = { not_found: 404, conflict: 409, insufficient_credits: 402, invalid_input: 422 };
        const messages = {
          not_found: 'Archivo o servicio no disponible.',
          conflict: 'La solicitud ya se usó con otros datos.',
          insufficient_credits: 'No hay créditos de prueba suficientes.',
          invalid_input: error.message,
        };
        json(res, statuses[error.code], { error: messages[error.code],
          ...(access && error.code === 'insufficient_credits' ? { key: 'insufficientMinutes' } : {}) });
      } else json(res, 500, { error: 'El piloto no pudo completar la operación.' });
    }
  });
  server.requestTimeout = config.uploads ? 60_000 : 15_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an IPv4 address.');
  host = config.proxyHost ?? privateOrigin?.host ?? '127.0.0.1:' + address.port;
  origin = privateOrigin?.origin ?? 'http://' + host;
  if (config.previewConversionAttribution || access) attribution = createPreviewAttribution(origin, Boolean(access));

  let paymentWork: Promise<unknown> | undefined;
  let jobWork: Promise<unknown> | undefined;
  let cleanupWork: Promise<unknown> | undefined;
  const poll = setInterval(() => {
    const onError = () => config.onWorkerError?.();
    if (!paymentWork) paymentWork = checkout.fulfillNext().catch(onError).finally(() => { paymentWork = undefined; });
    if (!jobWork) jobWork = jobs.runOnce().catch(onError).finally(() => { jobWork = undefined; });
  }, 250);
  poll.unref();
  const cleanup = () => {
    if (!cleanupWork) cleanupWork = jobs.purgeExpiredInputs().then(() => config.uploads?.purgeExpired()).then(() => access?.purgeExpired())
      .catch(() => config.onWorkerError?.()).finally(() => { cleanupWork = undefined; });
  };
  cleanup();
  const cleanupTimer = setInterval(cleanup, 60_000);
  cleanupTimer.unref();
  return {
    origin,
    localOrigin: 'http://127.0.0.1:' + address.port,
    async close() {
      clearInterval(poll);
      clearInterval(cleanupTimer);
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await Promise.allSettled([paymentWork, jobWork, cleanupWork]);
      if (firebase) await firebase.close();
    },
  };
}
