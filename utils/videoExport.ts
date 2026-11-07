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

export const recordVideoWithSubtitles = async (
  options: RecordVideoOptions
): Promise<RecordedVideo> => {
  const { video, canvas, subtitles, style, continuousMode, onProgress } = options;

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser does not support video recording.');
  }

  const mimeTypes = [
    'video/mp4;codecs="avc1.42E01E, mp4a.40.2"',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const selectedMime = mimeTypes.find((mime) => MediaRecorder.isTypeSupported(mime));
  if (!selectedMime) throw new Error('This browser cannot record a supported video format.');

  video.pause();
  await seekToStart(video);

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
    let settled = false;
    const chunks: Blob[] = [];

    const cleanup = () => {
      cancelAnimationFrame(animationFrame);
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

    const renderFrame = () => {
      if (settled) return;
      if (video.ended) {
        finish();
        return;
      }
      if (!video.paused) {
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
        onProgress(Math.min(100, (video.currentTime / video.duration) * 100));
      }
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
      if (chunks.length === 0) {
        reject(new Error('Export failed: no video data was captured.'));
        return;
      }
      const baseMime = selectedMime.split(';')[0] || 'video/webm';
      resolve({
        blob: new Blob(chunks, { type: baseMime }),
        ext: selectedMime.includes('mp4') ? 'mp4' : 'webm',
        audioCaptured,
      });
    };

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const initialSubtitle = findActiveSubtitle(subtitles, video.currentTime, continuousMode);
    if (initialSubtitle?.translatedText.trim()) {
      drawSubtitlesToCanvas(
        context,
        initialSubtitle.translatedText,
        style,
        canvas.width,
        canvas.height
      );
    }

    mediaRecorder.start(1000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    void video
      .play()
      .then(() => {
        animationFrame = requestAnimationFrame(renderFrame);
      })
      .catch(() => fail(new Error('The browser blocked video playback. Press Export again.')));
  });
};
