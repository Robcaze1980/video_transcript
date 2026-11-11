// Resume only the same File object: never combine chunks from a reselected, potentially different file.
const sessions = new WeakMap();
export async function uploadPrivateVideo(file, { signal, onProgress, chunkBytes = 8 * 1048576, context = '' } = {}) {
  let entries = sessions.get(file);
  if (!entries) { entries = new Map(); sessions.set(file, entries); }
  let session = entries.get(context);
  const call = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch('./api/uploads' + path, { method, body, headers, signal });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'No se pudo cargar el video.'), { status: response.status });
    return data;
  };
  const save = value => { session = value; entries.set(context, value); };
  try {
  if (session?.id) {
    try { session = { ...session, ...await call('/' + session.id) }; }
    catch (error) { if ([404,410].includes(error.status)) { entries.delete(context); session = undefined; } else throw error; }
  }
  if (!session?.id) {
    const requestKey = session?.requestKey || crypto.randomUUID();
    save({ requestKey });
    const data = await call('', 'POST', JSON.stringify({ name: file.name, size: file.size, requestKey }), { 'Content-Type': 'application/json' });
    save({ ...data, requestKey });
  }
    let offset = session.offset;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size) throw new Error('Posición de carga inválida.');
    onProgress?.(offset / file.size);
    while (offset < file.size) {
      signal?.throwIfAborted();
      const next = file.slice(offset, Math.min(file.size, offset + chunkBytes));
      const result = await call('/' + session.id, 'PUT', next, { 'Content-Type': 'application/octet-stream', 'Upload-Offset': String(offset) });
      if (!Number.isSafeInteger(result.offset) || result.offset !== offset + next.size) throw new Error('El servidor no confirmó el bloque.');
      offset = result.offset; save({ ...session, ...result }); onProgress?.(offset / file.size);
    }
    return await call('/' + session.id + '/complete', 'POST', '{}', { 'Content-Type': 'application/json' });
  } catch (error) {
    if (!session?.id && [404,410].includes(error.status)) entries.delete(context);
    if (signal?.aborted && session?.state !== 'ready') {
      // The explicit Cancel action removes partial media. Network errors retain a resumable upload.
      if (session?.id) await fetch('./api/uploads/' + session.id + '/abort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000) }).catch(() => {});
      entries.delete(context);
      throw Object.assign(new Error(), { key: 'uploadCancelled' });
    }
    throw error;
  }
}
