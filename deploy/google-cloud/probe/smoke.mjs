import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

// Synthetic compatibility probe, not a transcription, translation or render acceptance test.
const dir=await mkdtemp(join(tmpdir(),'vistavo-probe-'));
try {
  const file=join(dir,'synthetic.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=25',
    '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','180','-c:v','libx264','-pix_fmt','yuv420p',
    '-c:a','aac','-movflags','+faststart',file]);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
  if(probe.streams.length!==2||probe.streams[0].codec_name!=='h264'||Math.abs(Number(probe.format.duration)-180)>.2||
    probe.streams[0].nb_frames!=='4500'||probe.streams[1].codec_name!=='aac')throw new Error('Synthetic media failed');
  const invalid=join(dir,'invalid.mp4');await writeFile(invalid,'Not an MP4');
  let invalidRejected=false;
  try {execFileSync('ffprobe',['-v','error','-show_format',invalid],{stdio:'pipe'});}catch(e){if(e.status>0)invalidRejected=true;else throw e;}
  if(!invalidRejected)throw new Error('Invalid media was accepted');
  console.log(JSON.stringify({node:process.version,platform:process.platform,uid:process.getuid(),
    ffmpeg:execFileSync('ffmpeg',['-version'],{encoding:'utf8'}).split('\n')[0],duration:probe.format.duration,
    video:probe.streams[0].codec_name,audio:probe.streams[1].codec_name,frames:probe.streams[0].nb_frames,
    invalidRejected,synthetic:true,customerData:false,passed:true}));
} finally {await rm(dir,{recursive:true,force:true});}
