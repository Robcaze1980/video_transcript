/** Apply the hero's motion policy; inactive scenes keep only their poster and cannot download media. */
export function syncIllustrativeVideo(video: HTMLVideoElement, visible: boolean, playing: boolean): void {
  video.muted = true;
  if (visible && playing) {
    if (!video.hasAttribute('src') && video.dataset.src) video.src = video.dataset.src;
    if (video.paused) void video.play().catch(() => { /* The explicit resume button can retry after a gesture. */ });
  } else {
    video.pause();
    if (!visible && video.hasAttribute('src')) { video.removeAttribute('src'); video.load(); }
  }
}
