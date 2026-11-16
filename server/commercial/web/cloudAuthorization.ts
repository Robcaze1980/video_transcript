/** Keep the authorization gesture synchronous, but let the editor stop waiting on cancellation. */
export async function waitForCloudAuthorization(authorize: () => Promise<void>, signal: AbortSignal) {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DOMException('Export cancelled', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([authorize(), cancelled]);
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
