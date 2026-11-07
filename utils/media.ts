export const readVideoDuration = (file: File, timeoutMs: number = 20_000): Promise<number> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      window.clearTimeout(timer);
    };

    const finish = (duration: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (duration && Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(error || new Error('The video duration could not be read.'));
    };

    const timer = window.setTimeout(
      () => finish(null, new Error('Timed out while reading the video metadata.')),
      timeoutMs
    );

    video.preload = 'metadata';
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () =>
      finish(null, new Error('The selected file is not a video supported by this browser.'));
    video.src = url;
  });

export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

export const formatApiError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error || 'An unexpected error occurred.');
};
