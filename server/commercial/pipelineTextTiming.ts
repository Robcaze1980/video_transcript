import { spawn } from 'node:child_process';
import type { FileInput } from './jobs';
import type { ValidatedTextCue } from './pipelineTextCodec';
export interface Silence { startMs:number;endMs:number }
export function trimSilentEnds(cues:readonly ValidatedTextCue[],silences:readonly Silence[]):readonly ValidatedTextCue[]{
 return cues.map(c=>{let endMs=c.endMs;
  const silent=silences.find(s=>endMs>s.startMs&&endMs<=s.endMs);
  if(silent){if(c.startMs>=silent.startMs)throw new Error('Subtitle entirely inside confirmed silence.');endMs=silent.startMs;}
  if(endMs<=c.startMs)throw new Error('Invalid aligned subtitle.');return {...c,endMs};
 });
}
export async function alignTextCues(input:FileInput,cues:readonly ValidatedTextCue[],signal:AbortSignal){
 const silences=await new Promise<Silence[]>((resolve,reject)=>{
  const child=spawn('ffmpeg',['-hide_banner','-nostdin','-protocol_whitelist','file,pipe','-i',input.path,'-vn','-af','silencedetect=noise=-35dB:d=0.35','-f','null','-'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let output='';let oversized=false;
  const kill=()=>child.kill();signal.addEventListener('abort',kill,{once:true});
  const timer=setTimeout(kill,60000);
  child.stderr.on('data',(chunk:Buffer)=>{output+=chunk.toString('utf8');if(Buffer.byteLength(output)>262144){oversized=true;kill();}});
  child.on('error',()=>{clearTimeout(timer);signal.removeEventListener('abort',kill);reject(new Error('Audio timing unavailable.'));});
  child.on('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',kill);
   if(code!==0||oversized||signal.aborted){reject(new Error('Audio timing interrupted.'));return;}
   const intervals:Silence[]=[];let start:number|undefined;
   for(const match of output.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g)){
    const ms=Math.max(0,Math.round(Number(match[2])*1000));
    if(match[1]==='start')start=ms;else if(start!==undefined){intervals.push({startMs:start,endMs:ms});start=undefined;}
   }
   if(start!==undefined)intervals.push({startMs:start,endMs:Math.ceil(input.metadata.duration*1000)});
   resolve(intervals);
  });
  if(signal.aborted)kill();
 });
 return trimSilentEnds(cues,silences);
}
