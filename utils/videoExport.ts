import { Subtitle, SubtitleStyle } from '../types';
import { drawSubtitlesToCanvas } from './helpers';
import { findActiveSubtitle } from './subtitles';

export interface RecordedVideo {
  blob: Blob;
  ext: 'mp4' | 'webm';
  audioCaptured: boolean;
}

interface RecordVideoOptions {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  subtitles: Subtitle[];
  style: SubtitleStyle;
  continuousMode: boolean;
  onProgress: (percent: number) => void;
}

const seekToStart = (video: HTMLVideoElement): Promise<void> =>
  new Promise((resolve, reject) => {
    if (video.currentTime <= 0.01) {
      resolve();
      return;
    }
    const timeout = window.setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      reject(new Error('Timed out while rewinding the video for export.'));
    }, 15_000);
    const onSeeked = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = 0;
  });

// Sin un fotograma decodificado `drawImage` no pinta nada y el canvas nunca
// emite datos al grabador.
const waitForFirstFrame = (video: HTMLVideoElement): Promise<void> =>
  new Promise((resolve) => {
    if (video.readyState >= 2) {
      resolve();
      return;
    }
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 10_000);
    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('canplay', onReady, { once: true });
  });

const recordOnce = async (options: RecordVideoOptions): Promise<RecordedVideo> => {
  const { video, canvas, subtitles, style, continuousMode, onProgress } = options;

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser does not support video recording.');
  }

  const mimeTypes = [
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs="avc1.42E01E, mp4a.40.2"',
    'video/mp4',
  ];
  const selectedMime = mimeTypes.find((mime) => MediaRecorder.isTypeSupported(mime));
  if (!selectedMime) throw new Error('This browser cannot record a supported video format.');

  video.pause();
  await seekToStart(video);
  await waitForFirstFrame(video);

  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('The export canvas is unavailable.');

  const stream = canvas.captureStream(30);
  let sourceStream: MediaStream | null = null;
  let audioCaptured = false;
  try {
    const captureVideo = video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    sourceStream = captureVideo.captureStream?.() || captureVideo.mozCaptureStream?.() || null;
    sourceStream?.getAudioTracks().forEach((track) => {
      stream.addTrack(track.clone());
      audioCaptured = true;
    });
  } catch {
    audioCaptured = false;
  }

  return new Promise<RecordedVideo>((resolve, reject) => {
    let recorder: MediaRecorder | null = null;
    let animationFrame = 0;
    let pumpTimer = 0;
    let guardTimer = 0;
    let settled = false;
    const chunks: Blob[] = [];

    const cleanup = () => {
      cancelAnimationFrame(animationFrame);
      window.clearInterval(pumpTimer);
      window.clearTimeout(guardTimer);
      video.pause();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stream.getTracks().forEach((track) => track.stop());
      sourceStream?.getTracks().forEach((track) => track.stop());
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // The recorder may already be stopping.
        }
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const finish = () => {
      if (settled || !recorder) return;
      if (recorder.state === 'recording') {
        try {
          recorder.requestData();
        } catch {
          // Older browsers may not expose requestData.
        }
      }
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // Ignore duplicate stop calls.
        }
      }
    };

    const onVisibilityChange = () => {
      if (settled || !recorder) return;
      if (document.hidden) {
        if (recorder.state === 'recording') recorder.pause();
        video.pause();
      } else {
        if (recorder.state === 'paused') recorder.resume();
        void video.play().catch(() => fail(new Error('Video playback stopped during export.')));
      }
    };

    const drawFrame = () => {
      if (settled) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const activeSubtitle = findActiveSubtitle(subtitles, video.currentTime, continuousMode);
      if (activeSubtitle?.translatedText.trim()) {
        drawSubtitlesToCanvas(
          context,
          activeSubtitle.translatedText,
          style,
          canvas.width,
          canvas.height
        );
      }
      if (Number.isFinite(video.duration) && video.duration > 0) {
        onProgress(Math.min(100, (video.currentTime / video.duration) * 100));
      }
    };

    const renderFrame = () => {
      if (settled) return;
      if (video.ended) {
        finish();
        return;
      }
      if (!video.paused) drawFrame();
      animationFrame = requestAnimationFrame(renderFrame);
    };

    let mediaRecorder: MediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: selectedMime,
        videoBitsPerSecond: 2_500_000,
      });
      recorder = mediaRecorder;
    } catch (error) {
      fail(error);
      return;
    }

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    mediaRecorder.onerror = () =>
      fail(new Error('The browser stopped recording before completion.'));
    mediaRecorder.onstop = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const baseMime = selectedMime.split(';')[0] || 'video/webm';
      resolve({
        blob: new Blob(chunks, { type: baseMime }),
        ext: selectedMime.includes('mp4') ? 'mp4' : 'webm',
        audioCaptured,
      });
    };

    drawFrame();

    mediaRecorder.start(1000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    // Los navegadores frenan requestAnimationFrame cuando la pestaña pasa a
    // segundo plano: sin fotogramas el grabador no recibe imagen y el archivo
    // sale vacío. Un temporizador mantiene el canvas emitiendo mientras tanto.
    pumpTimer = window.setInterval(() => {
      if (!settled && !video.paused && !video.ended) drawFrame();
    }, 100);
    if (Number.isFinite(video.duration) && video.duration > 0) {
      guardTimer = window.setTimeout(
        () => fail(new Error('The export took longer than the video duration. Try again.')),
        video.duration * 2000 + 60_000
      );
    }
    void video
      .play()
      .then(() => {
        animationFrame = requestAnimationFrame(renderFrame);
      })
      .catch(() => fail(new Error('The browser blocked video playback. Press Export again.')));
  });
};

export const recordVideoWithSubtitles = async (
  options: RecordVideoOptions
): Promise<RecordedVideo> => {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const recorded = await recordOnce(options);
      if (recorded.blob.size > 0) return recorded;
      lastError = new Error('Export failed: no video data was captured.');
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : '';
      // Repetir no arregla estos casos: el navegador no puede grabar el vídeo.
      if (/blocked video playback|does not support|cannot record a supported/i.test(message)) {
        break;
      }
    }
    if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 400));
  }

  if (lastError instanceof Error && lastError.message.startsWith('Export failed')) {
    throw new Error(
      'Export failed: no video data was captured. Keep this tab visible in the foreground while exporting, then try again.'
    );
  }
  throw lastError instanceof Error ? lastError : new Error('Export failed.');
};
