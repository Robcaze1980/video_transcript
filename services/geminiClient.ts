import { GoogleGenAI } from '@google/genai';
import {
  SectionModelResponse,
  UploadedVideoSource,
} from '../types';
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  requestSectionTranscription,
  SectionTranscriptionRequest,
} from './transcriptionCore';

interface BackendHealth {
  ok: boolean;
  configured: boolean;
  provider: string | null;
  model?: string;
}

export interface ApiAccess {
  available: boolean;
  mode: 'server' | 'direct' | 'none';
  message: string;
}

let backendHealthPromise: Promise<BackendHealth | null> | null = null;
let directClient: GoogleGenAI | null = null;

const getRuntimeProcess = (): { env?: Record<string, string | undefined> } | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

export const getDirectApiKey = (): string => {
  const runtimeKey = getRuntimeProcess()?.env?.API_KEY;
  const viteKey = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }).env?.VITE_GEMINI_API_KEY;
  return runtimeKey || viteKey || '';
};

const getDirectClient = (): GoogleGenAI => {
  const apiKey = getDirectApiKey();
  if (!apiKey) {
    throw new Error(
      'No browser API key is available. Configure GEMINI_API_KEY on the local server or select a key in AI Studio.'
    );
  }
  if (!directClient) directClient = new GoogleGenAI({ apiKey });
  return directClient;
};

export const getBackendHealth = async (): Promise<BackendHealth | null> => {
  if (!backendHealthPromise) {
    backendHealthPromise = fetch('/api/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as BackendHealth;
      })
      .catch(() => null);
  }
  return backendHealthPromise;
};

export const getApiAccess = async (): Promise<ApiAccess> => {
  const health = await getBackendHealth();
  if (health?.configured) {
    return {
      available: true,
      mode: 'server',
      message: 'Gemini is configured securely on the local server.',
    };
  }

  const aistudio = (window as unknown as {
    aistudio?: { hasSelectedApiKey?: () => Promise<boolean> };
  }).aistudio;
  if (aistudio?.hasSelectedApiKey) {
    const selected = await aistudio.hasSelectedApiKey().catch(() => false);
    if (selected) {
      return {
        available: true,
        mode: 'direct',
        message: 'Using the API key selected in AI Studio.',
      };
    }
  }

  if (getDirectApiKey()) {
    return {
      available: true,
      mode: 'direct',
      message: 'Using the browser API key.',
    };
  }

  return {
    available: false,
    mode: 'none',
    message:
      'No Gemini API key is available. Add GEMINI_API_KEY to .env.local and run npm run dev.',
  };
};

const fetchJson = async <T>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with HTTP ${response.status}.`);
  }
  return payload as T;
};

const uploadToProxy = (
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<UploadedVideoSource> =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open('POST', '/api/video');
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.setRequestHeader('X-Video-Mime', file.type || 'application/octet-stream');

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };
    request.onerror = () => reject(new Error('Could not upload the video to the local server.'));
    request.onabort = () =>
      reject(new DOMException('Video upload cancelled.', 'AbortError'));
    request.onload = () => {
      let payload: { error?: string } & Partial<UploadedVideoSource> = {};
      try {
        payload = JSON.parse(request.responseText || '{}');
      } catch {
        reject(new Error('The local server returned an invalid upload response.'));
        return;
      }
      if (request.status < 200 || request.status >= 300 || !payload.uri || !payload.name) {
        reject(new Error(payload.error || `Upload failed with HTTP ${request.status}.`));
        return;
      }
      resolve({
        backend: 'proxy',
        name: payload.name,
        uri: payload.uri,
        mimeType: payload.mimeType || file.type,
      });
    };

    signal?.addEventListener('abort', abort, { once: true });
    request.onloadend = () => signal?.removeEventListener('abort', abort);
    request.send(file);
  });

const waitForDirectFile = async (
  client: GoogleGenAI,
  name: string,
  signal?: AbortSignal
): Promise<{ uri: string; state: string }> => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
    const file = await client.files.get({ name });
    const state = String(file.state || '').toUpperCase();
    if (state === 'ACTIVE' && file.uri) return { uri: file.uri, state };
    if (state === 'FAILED') {
      throw new Error(file.error?.message || 'Gemini could not process the uploaded video.');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out while Gemini processed the uploaded video.');
};

const uploadDirectly = async (
  file: File,
  signal?: AbortSignal
): Promise<UploadedVideoSource> => {
  const client = getDirectClient();
  const uploaded = await client.files.upload({
    file,
    config: {
      mimeType: file.type || 'video/mp4',
      displayName: file.name,
    },
  });
  if (!uploaded.name) throw new Error('Gemini did not return an uploaded file name.');
  const active = await waitForDirectFile(client, uploaded.name, signal);
  return {
    backend: 'direct',
    name: uploaded.name,
    uri: active.uri,
    mimeType: uploaded.mimeType || file.type || 'video/mp4',
  };
};

export const uploadVideoSource = async (
  file: File,
  options: {
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  } = {}
): Promise<UploadedVideoSource> => {
  const health = await getBackendHealth();
  if (health?.configured) {
    return uploadToProxy(file, options.onProgress, options.signal);
  }
  return uploadDirectly(file, options.signal);
};

export const transcribeSectionWithSource = async (
  source: UploadedVideoSource,
  request: SectionTranscriptionRequest,
  signal?: AbortSignal
): Promise<SectionModelResponse> => {
  if (source.backend === 'proxy') {
    return fetchJson<SectionModelResponse>('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileUri: source.uri,
        mimeType: source.mimeType,
        duration: request.videoDuration,
        sectionIndex: request.sectionIndex,
        totalSections: request.totalSections,
        start: request.start,
        end: request.end,
        targetLanguage: request.targetLanguage,
        sourceLanguage: request.sourceLanguage,
      }),
      signal,
    });
  }

  return requestSectionTranscription(getDirectClient(), {
    model: DEFAULT_TRANSCRIPTION_MODEL,
    mediaPart: {
      fileData: {
        fileUri: source.uri,
        mimeType: source.mimeType,
      },
    },
    request,
    abortSignal: signal,
  });
};

export const deleteVideoSource = async (
  source: UploadedVideoSource | null
): Promise<void> => {
  if (!source) return;
  if (source.backend === 'proxy') {
    await fetch('/api/video', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: source.name }),
    }).catch(() => undefined);
    return;
  }

  if (!getDirectApiKey()) return;
  await getDirectClient().files.delete({ name: source.name }).catch(() => undefined);
};
