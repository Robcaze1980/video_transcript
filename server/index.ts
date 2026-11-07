import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer, loadEnv, ViteDevServer } from 'vite';
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  describeGeminiError,
  requestSectionTranscription,
} from '../services/transcriptionCore';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST_DIR = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const model = process.env.GEMINI_MODEL || DEFAULT_TRANSCRIPTION_MODEL;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const loadEnvironment = (): void => {
  const loaded = loadEnv(process.env.NODE_ENV || 'development', ROOT, '');
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
};

loadEnvironment();

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
const configured = Boolean(apiKey);
const ai = configured ? new GoogleGenAI({ apiKey }) : null;

const requireAi = (): GoogleGenAI => {
  if (!ai) {
    throw new HttpError(
      503,
      'Gemini is not configured on the server. Add GEMINI_API_KEY to .env.local.'
    );
  }
  return ai;
};

const sendJson = (res: ServerResponse, status: number, payload: unknown): void => {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
};

const sendError = (res: ServerResponse, error: unknown): void => {
  const status = error instanceof HttpError ? error.status : 500;
  const message =
    error instanceof HttpError
      ? error.message
      : describeGeminiError(error);
  if (status >= 500) console.error('[api]', error);
  sendJson(res, status, { error: message });
};

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BYTES) throw new HttpError(413, 'JSON request is too large.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid JSON request body.');
  }
};

const requireString = (
  body: Record<string, unknown>,
  field: string,
  maxLength: number = 200
): string => {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new HttpError(400, `Invalid or missing "${field}".`);
  }
  return value.trim();
};

const requireNumber = (body: Record<string, unknown>, field: string): number => {
  const value = typeof body[field] === 'number' ? body[field] : Number(body[field]);
  if (!Number.isFinite(value)) throw new HttpError(400, `Invalid numeric field "${field}".`);
  return value;
};

const waitForActiveFile = async (
  client: GoogleGenAI,
  name: string
): Promise<{ uri: string; state: string }> => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const file = await client.files.get({ name });
    const state = String(file.state || '').toUpperCase();
    if (state === 'ACTIVE' && file.uri) return { uri: file.uri, state };
    if (state === 'FAILED') {
      throw new HttpError(422, file.error?.message || 'Gemini could not process this video.');
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  throw new HttpError(504, 'Timed out while Gemini processed the uploaded video.');
};

const extensionForMime = (mimeType: string): string => {
  const known: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
    'video/mpeg': '.mpeg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/wav': '.wav',
  };
  return known[mimeType] || '.bin';
};

const handleUpload = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, 'Video exceeds the 300 MB upload limit.');
  }

  const mimeType = String(req.headers['x-video-mime'] || req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!/^(video|audio)\/[\w.+-]+$/.test(mimeType)) {
    throw new HttpError(415, 'A valid video or audio MIME type is required.');
  }

  const client = requireAi();
  const uploadDir = join(tmpdir(), 'linguistvision-uploads');
  await mkdir(uploadDir, { recursive: true });
  const tempPath = join(uploadDir, `${randomUUID()}${extensionForMime(mimeType)}`);
  let received = 0;

  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) {
        callback(new HttpError(413, 'Video exceeds the 300 MB upload limit.'));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(req, limiter, createWriteStream(tempPath, { flags: 'wx' }));
    if (received === 0) throw new HttpError(400, 'The uploaded file is empty.');

    const uploaded = await client.files.upload({
      file: tempPath,
      config: {
        mimeType,
        displayName: `linguistvision-${Date.now()}${extensionForMime(mimeType)}`,
      },
    });
    if (!uploaded.name) throw new Error('Gemini did not return an uploaded file name.');

    const active = await waitForActiveFile(client, uploaded.name);
    sendJson(res, 200, {
      backend: 'proxy',
      name: uploaded.name,
      uri: active.uri,
      mimeType: uploaded.mimeType || mimeType,
      sizeBytes: uploaded.sizeBytes,
      expirationTime: uploaded.expirationTime,
    });
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
};

const isGeminiFileUri = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('googleapis.com') &&
      url.pathname.includes('/files/')
    );
  } catch {
    return false;
  }
};

const handleTranscribe = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const client = requireAi();
  const body = await readJson(req);

  const fileUri = requireString(body, 'fileUri', 2000);
  const mimeType = requireString(body, 'mimeType', 100);
  const targetLanguage = requireString(body, 'targetLanguage', 80);
  const sourceLanguage = requireString(body, 'sourceLanguage', 80);
  const start = requireNumber(body, 'start');
  const end = requireNumber(body, 'end');
  const videoDuration = requireNumber(body, 'duration');
  const sectionIndex = requireNumber(body, 'sectionIndex');
  const totalSections = requireNumber(body, 'totalSections');

  if (!isGeminiFileUri(fileUri)) {
    throw new HttpError(400, 'The supplied file URI is not a Gemini Files API URI.');
  }
  if (!/^(video|audio)\/[\w.+-]+$/.test(mimeType)) {
    throw new HttpError(415, 'Unsupported media MIME type.');
  }
  if (
    start < 0 ||
    end <= start ||
    videoDuration <= 0 ||
    end > videoDuration + 1 ||
    sectionIndex < 0 ||
    totalSections <= 0 ||
    sectionIndex >= totalSections
  ) {
    throw new HttpError(400, 'Invalid transcription section boundaries.');
  }

  const controller = new AbortController();
  req.once('aborted', () => controller.abort());

  try {
    const response = await requestSectionTranscription(client, {
      model,
      mediaPart: {
        fileData: { fileUri, mimeType },
      },
      request: {
        sectionIndex,
        totalSections,
        start,
        end,
        videoDuration,
        targetLanguage,
        sourceLanguage,
      },
      abortSignal: controller.signal,
    });
    sendJson(res, 200, response);
  } catch (error) {
    if (error instanceof Error && /quota|RESOURCE_EXHAUSTED|429/i.test(error.message)) {
      throw new HttpError(429, describeGeminiError(error));
    }
    throw error;
  }
};

const handleDeleteFile = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const client = requireAi();
  const body = await readJson(req);
  const name = requireString(body, 'name', 300);
  if (!/^files\/[\w.-]+$/.test(name)) {
    throw new HttpError(400, 'Invalid Gemini file name.');
  }
  await client.files.delete({ name });
  sendJson(res, 200, { deleted: true });
};

const handleApi = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> => {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      configured,
      provider: configured ? 'server' : null,
      model,
    });
    return;
  }
  if (url.pathname === '/api/video' && req.method === 'POST') {
    await handleUpload(req, res);
    return;
  }
  if (url.pathname === '/api/transcribe' && req.method === 'POST') {
    await handleTranscribe(req, res);
    return;
  }
  if (url.pathname === '/api/video' && req.method === 'DELETE') {
    await handleDeleteFile(req, res);
    return;
  }
  throw new HttpError(404, 'API route not found.');
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const serveFile = async (
  res: ServerResponse,
  filePath: string
): Promise<void> => {
  const fileStat = await stat(filePath);
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': fileStat.size,
  });
  createReadStream(filePath).pipe(res);
};

const serveProductionAsset = async (
  res: ServerResponse,
  url: URL
): Promise<void> => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'Invalid URL encoding.');
  }

  const relativePath = normalize(pathname).replace(/^([/\\])+/, '');
  let filePath = resolve(DIST_DIR, relativePath || 'index.html');
  if (filePath !== DIST_DIR && !filePath.startsWith(`${DIST_DIR}\\`) && !filePath.startsWith(`${DIST_DIR}/`)) {
    throw new HttpError(403, 'Forbidden path.');
  }

  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html');
    await serveFile(res, filePath);
  } catch {
    // SPA routes fall back to index.html.
    await serveFile(res, join(DIST_DIR, 'index.html'));
  }
};

const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
let vite: ViteDevServer | null = null;

if (!production) {
  vite = await createViteServer({
    root: ROOT,
    appType: 'spa',
    server: { middlewareMode: true },
  });
}

const httpServer = createHttpServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const handle = async (): Promise<void> => {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (vite) {
      vite.middlewares(req, res, () => {
        if (!res.writableEnded) sendJson(res, 404, { error: 'Not found.' });
      });
      return;
    }
    await serveProductionAsset(res, url);
  };

  handle().catch((error) => {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }
    sendError(res, error);
  });
});

httpServer.requestTimeout = 0;
httpServer.headersTimeout = 0;
httpServer.keepAliveTimeout = 65_000;

httpServer.listen(PORT, HOST, () => {
  console.log(
    `LinguistVision ${production ? 'production' : 'development'} server: http://localhost:${PORT}`
  );
  console.log(
    configured
      ? 'Gemini API key loaded on the server (not exposed to the browser).'
      : 'No GEMINI_API_KEY configured. Add it to .env.local.'
  );
});

const shutdown = async (): Promise<void> => {
  await vite?.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
