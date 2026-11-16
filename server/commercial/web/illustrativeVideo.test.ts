import {describe,it,expect,vi} from 'vitest';
import {syncIllustrativeVideo} from './illustrativeVideo';
function fixture() {
  const video={muted:false,src:'',paused:true,dataset:{src:'/demo/hero-reparacion.mp4'},
    hasAttribute:vi.fn(()=>Boolean(video.src)),removeAttribute:vi.fn(()=>{video.src='';}),
    play:vi.fn(async()=>{}),pause:vi.fn(),load:vi.fn()};
  return video;
}
describe('illustrative hero playback policy',()=>{
  it('plays an active visible scene muted without loading the other scenes',()=>{
    const shown=fixture(),hidden=fixture();syncIllustrativeVideo(shown as any,true,true);syncIllustrativeVideo(hidden as any,false,false);
    expect(shown.src).toBe(shown.dataset.src);expect(shown.muted).toBe(true);expect(shown.play).toHaveBeenCalledOnce();expect(hidden.src).toBe('');expect(hidden.play).not.toHaveBeenCalled();
  });
  it('freezes a manually paused visible video without discarding its current frame',()=>{
    const video=fixture();video.src=video.dataset.src;syncIllustrativeVideo(video as any,true,false);
    expect(video.pause).toHaveBeenCalledOnce();expect(video.src).toBe(video.dataset.src);expect(video.play).not.toHaveBeenCalled();
  });
  it('unloads an invisible or motion-suppressed video and restores the poster',()=>{
    const video=fixture();video.src=video.dataset.src;syncIllustrativeVideo(video as any,false,false);
    expect(video.pause).toHaveBeenCalledOnce();expect(video.src).toBe('');expect(video.load).toHaveBeenCalledOnce();expect(video.play).not.toHaveBeenCalled();
  });
  it('handles a rejected autoplay promise without an unhandled rejection',async()=>{
    const video=fixture();video.play.mockRejectedValue(new Error('autoplay blocked'));syncIllustrativeVideo(video as any,true,true);
    await Promise.resolve();expect(video.play).toHaveBeenCalledOnce();
  });
});
