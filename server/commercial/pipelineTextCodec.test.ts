import { it,expect } from 'vitest';
import { encodeTextBundle } from './pipelineTextCodec';
const good=()=>({detectedLanguage:'es',hasSpeech:true,cues:[{startMs:0,endMs:1000,es:'Cinco centímetros.',en:'Five centimeters.'}]});
it('pairs stable IDs and deterministic UTF8 SRT/TXT without converting units',()=>{
 const a=encodeTextBundle('job',120000,good()),b=encodeTextBundle('job',120000,good());
 expect(a.cues[0].id).toBe(b.cues[0].id);expect(a.es.srt).toContain('00:00:00,000 --> 00:00:01,000');
 expect(a.en.txt).toBe('Five centimeters.\n');expect(a.es.srtSha256).toBe(b.es.srtSha256);
});
it.each(['overlap','range','fraction','empty','control','extra','language','silence','limit'])('rejects %s',kind=>{
 const r:any=good();if(kind==='overlap')r.cues.push({...r.cues[0]});if(kind==='range')r.cues[0].endMs=120001;
 if(kind==='fraction')r.cues[0].startMs=0.5;if(kind==='empty')r.cues[0].en='';if(kind==='control')r.cues[0].es+='\n';
 if(kind==='extra')r.price=1;if(kind==='language')r.detectedLanguage='en';if(kind==='silence')r.hasSpeech=false;
 if(kind==='limit')r.cues[0].es='é'.repeat(32768);
 expect(()=>encodeTextBundle('job',120000,r)).toThrow();
});
