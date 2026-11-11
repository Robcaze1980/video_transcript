// Drive authorization is separate from Firebase sign-in. Tokens and resumable URLs stay in memory.
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com';
const FIELDS = 'id,name,size,webViewLink';

export class DriveUploadError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'DriveUploadError';
    this.code = code;
    this.status = status;
  }
}

/** Call authorize() directly from a user gesture, after GIS has loaded. Never use a Firebase ID token. */
export function createGoogleDriveAuthorization({ clientId, google = globalThis.google }) {
  if (!clientId || !google?.accounts?.oauth2?.initTokenClient) throw new DriveUploadError('drive_not_configured');
  let token;
  let expiresAt = 0;
  let pending;
  const client = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_FILE_SCOPE,
    include_granted_scopes: false,
    callback(response) {
      const request = pending;
      pending = undefined;
      if (!request) return;
      if (response.error || !response.access_token || !response.scope?.split(' ').includes(DRIVE_FILE_SCOPE)
        || !Number.isFinite(Number(response.expires_in)) || Number(response.expires_in) <= 60) {
        request.reject(new DriveUploadError('drive_permission_denied'));
        return;
      }
      token = response.access_token;
      expiresAt = Date.now() + Math.max(0, Number(response.expires_in) - 60) * 1000;
      request.resolve();
    },
    error_callback() {
      const request = pending;
      pending = undefined;
      request?.reject(new DriveUploadError('drive_authorization_closed'));
    },
  });
  return {
    authorize() {
      if (pending) return pending.promise;
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      pending = { promise, resolve, reject };
      try { client.requestAccessToken({ prompt: 'select_account' }); }
      catch { pending = undefined; reject(new DriveUploadError('drive_authorization_failed')); }
      return promise;
    },
    getAccessToken() {
      if (!token || Date.now() >= expiresAt) throw new DriveUploadError('drive_authorization_required');
      return token;
    },
    clear() {
      token = undefined; expiresAt = 0;
      pending?.reject(new DriveUploadError('drive_authorization_closed'));
      pending = undefined;
    },
  };
}

const aborted = signal => { if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError'); };
function pause(ms, signal) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Upload cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
const retryable = status => status === 429 || status >= 500;
function acceptedUrl(value, upload = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return upload ? url.origin === API && url.pathname === '/upload/drive/v3/files'
      : url.hostname === 'drive.google.com' || url.hostname === 'docs.google.com';
  } catch { return false; }
}

/** Chunked uploads. Retains at most 20 session receipts, and strong Blob references only during at most two active uploads. */
export function createDriveUploader({ getAccessToken, fetch: request = globalThis.fetch, chunkSize = 1024 * 1024, maxRetries = 3, retryDelay = 500 }) {
  if (typeof getAccessToken !== 'function' || chunkSize < 256 * 1024 || chunkSize % (256 * 1024)) throw new DriveUploadError('drive_invalid_configuration');
  const exports = new Map();

  async function authenticated(url, init, signal) {
    aborted(signal);
    const token = await getAccessToken();
    if (!token || typeof token !== 'string') throw new DriveUploadError('drive_authorization_required');
    const response = await request(url, { ...init, signal, credentials: 'omit', redirect: 'error', headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (response.status === 401) throw new DriveUploadError('drive_authorization_required', 401);
    return response;
  }
  async function safeRequest(url, init, signal) {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await authenticated(url, init, signal);
        if (!retryable(response.status) || attempt >= maxRetries) return response;
      } catch (error) {
        if (error.name === 'AbortError' || error instanceof DriveUploadError || attempt >= maxRetries) throw error;
      }
      await pause(retryDelay * 2 ** attempt, signal);
    }
  }
  async function metadata(state, signal) {
    const response = await safeRequest(`${API}/drive/v3/files/${encodeURIComponent(state.id)}?fields=${FIELDS}`, { method: 'GET' }, signal);
    if (response.status === 404) return null;
    if (!response.ok) throw new DriveUploadError('drive_confirmation_failed', response.status);
    const result = await response.json();
    if (result.id !== state.id || String(result.size) !== String(state.blob.size) || !acceptedUrl(result.webViewLink)) throw new DriveUploadError('drive_confirmation_incomplete');
    state.result = { id: result.id, webViewLink: result.webViewLink, name: result.name || state.name, size: state.blob.size };
    state.offset = state.blob.size;
    return state.result;
  }
  function offset(response, state) {
    const range = response.headers.get('Range');
    if (!range) return 0;
    const match = /^bytes=0-(\d+)$/i.exec(range);
    const value = match ? Number(match[1]) + 1 : NaN;
    if (!Number.isSafeInteger(value) || value < 0 || value > state.blob.size) throw new DriveUploadError('drive_invalid_range');
    return value;
  }
  async function probe(state, signal) {
    const response = await safeRequest(state.sessionUrl, { method: 'PUT', headers: { 'Content-Range': `bytes */${state.blob.size}` } }, signal);
    if (response.status === 200 || response.status === 201) return { done: true };
    if (response.status === 308) { state.offset = offset(response, state); return { done: false }; }
    if (response.status === 404 || response.status === 410) {
      state.sessionUrl = undefined;
      const result = await metadata(state, signal);
      if (result) return { done: true };
      state.offset = 0;
      return { expired: true };
    }
    throw new DriveUploadError('drive_resume_failed', response.status);
  }
  async function initiate(state, signal) {
    if (!state.id) {
      const ids = await safeRequest(`${API}/drive/v3/files/generateIds?count=1&space=drive&type=files`, { method: 'GET' }, signal);
      if (!ids.ok) throw new DriveUploadError('drive_create_failed', ids.status);
      state.id = (await ids.json()).ids?.[0];
      if (!state.id || !/^[\w-]+$/.test(state.id)) throw new DriveUploadError('drive_invalid_file_id');
    }
    // Retrying initiation uses the same pre-generated file ID, never a second file.
    const response = await safeRequest(`${API}/upload/drive/v3/files?uploadType=resumable&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': state.blob.type || 'application/octet-stream', 'X-Upload-Content-Length': String(state.blob.size) },
      body: JSON.stringify({ id: state.id, name: state.name, mimeType: state.blob.type || 'application/octet-stream' }),
    }, signal);
    if (response.status === 409) {
      if (await metadata(state, signal)) return;
      throw new DriveUploadError('drive_create_conflict', 409);
    }
    if (!response.ok) throw new DriveUploadError('drive_create_failed', response.status);
    const location = response.headers.get('Location');
    if (!acceptedUrl(location, true)) throw new DriveUploadError('drive_invalid_session');
    state.sessionUrl = location;
    state.offset = 0;
  }
  async function run(state, signal, onProgress) {
    aborted(signal);
    if (state.result) return state.result;
    if (state.sessionUrl && (await probe(state, signal)).done) {
      const result = await metadata(state, signal);
      if (!result) throw new DriveUploadError('drive_confirmation_failed');
      onProgress?.({ uploaded: state.blob.size, total: state.blob.size });
      return result;
    }
    if (!state.sessionUrl) await initiate(state, signal);
    if (state.result) return state.result;
    let failures = 0;
    while (state.offset < state.blob.size) {
      aborted(signal);
      const start = state.offset;
      const end = Math.min(start + chunkSize, state.blob.size);
      try {
        const response = await authenticated(state.sessionUrl, {
          method: 'PUT', headers: { 'Content-Type': state.blob.type || 'application/octet-stream', 'Content-Range': `bytes ${start}-${end - 1}/${state.blob.size}` },
          body: state.blob.slice(start, end),
        }, signal);
        if (response.status === 200 || response.status === 201) break;
        if (response.status === 308) {
          state.offset = offset(response, state);
          if (state.offset < start || state.offset > end) throw new DriveUploadError('drive_invalid_range');
          if (state.offset > start) {
            failures = 0;
            onProgress?.({ uploaded: state.offset, total: state.blob.size });
            continue;
          }
        }
        if (response.status !== 308 && !retryable(response.status)) throw new DriveUploadError('drive_upload_failed', response.status);
      } catch (error) {
        if (error.name === 'AbortError' || error instanceof DriveUploadError) throw error;
      }
      if (failures++ >= maxRetries) throw new DriveUploadError('drive_network_interrupted');
      await pause(retryDelay * 2 ** (failures - 1), signal);
      const status = await probe(state, signal);
      if (status.done) break;
      if (status.expired) await initiate(state, signal);
      if (state.result) return state.result;
      onProgress?.({ uploaded: state.offset, total: state.blob.size });
    }
    const result = await metadata(state, signal);
    if (!result) throw new DriveUploadError('drive_confirmation_failed');
    onProgress?.({ uploaded: state.blob.size, total: state.blob.size });
    return result;
  }
  return {
    upload({ exportKey, blob, name, signal, onProgress }) {
      if (!exportKey || !(blob instanceof Blob) || blob.size === 0 || !name || /[\r\n]/.test(name)) return Promise.reject(new DriveUploadError('drive_invalid_export'));
      if (signal?.aborted) return Promise.reject(new DOMException('Upload cancelled', 'AbortError'));
      let state = exports.get(exportKey);
      if (state && ((state.blob ?? state.reference.deref()) !== blob || state.name !== name)) return Promise.reject(new DriveUploadError('drive_export_key_reused'));
      if (state?.pending) return state.pending;
      if (state?.result) {
        exports.delete(exportKey); exports.set(exportKey, state);
        onProgress?.({ uploaded: blob.size, total: blob.size });
        return Promise.resolve(state.result);
      }
      if ([...exports.values()].filter(value => value.pending).length >= 2) return Promise.reject(new DriveUploadError('drive_upload_limit'));
      if (!state) state = { name, offset: 0, reference: new WeakRef(blob) };
      exports.delete(exportKey); exports.set(exportKey, state);
      while (exports.size > 20) {
        const oldest = [...exports].find(([, value]) => !value.pending);
        if (!oldest) break;
        exports.delete(oldest[0]);
      }
      state.blob = blob;
      state.controller = new AbortController();
      const activeSignal = signal ? AbortSignal.any([signal, state.controller.signal]) : state.controller.signal;
      state.pending = run(state, activeSignal, onProgress).finally(() => {
        state.pending = undefined;
        state.controller = undefined;
        // A failed/cancelled upload retains only its resumable receipt and weak identity.
        // The editor owns the single current export Blob, not this upload history.
        state.blob = undefined;
      });
      return state.pending;
    },
    // Call on logout/project disposal. Does not delete already saved files from the user's Drive.
    clear() { exports.forEach(state => state.controller?.abort()); exports.clear(); },
  };
}
