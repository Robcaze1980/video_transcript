import {createHash,randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {FirestoreAi} from './firestoreAi';
import {privateBucket,objectPlan} from './privateObjectPlan';

function setup(duration:number,draft='A short English narration.',limits={maxSourceSeconds:30,maxNarrationChars:600,maxVoiceChunks:3}){
 const account=randomUUID(),inputId=randomUUID(),sha='a'.repeat(64);
 const input={ready:true,sha256:sha,expiresAtMs:Date.now()+60000,metadata:{duration,audioTracks:1},storage:{bucket:privateBucket,key:objectPlan(inputId,10).final,generation:'1',size:10,sha256:sha}};
 const root={collection:()=>({doc:()=>({get:async()=>({exists:true,get:(key:string)=>key==='aiPilot'||key==='simulationOnly',data:()=>input})})})};
 const priorRequest=vi.fn(async()=>null),backend={readProject:vi.fn(async()=>({revision:1,draft,reviewedTextRevision:1,reviewedTextSha256:createHash('sha256').update(draft).digest('hex')})),priorRequest,priorSimulatedRequestForEnqueue:priorRequest,reserve:vi.fn(async()=>({id:'reserved'}))};
 const ai=new FirestoreAi({} as any,root as any,backend as any,{} as any,limits);
 return {ai,backend,account,inputId};
}
describe('local candidate server AI limits',()=>{
 it('rejects long source before reservation even with a valid private binding',async()=>{const s=setup(30.01);await expect(s.ai.enqueue(s.account,s.inputId,'translation:en',1,randomUUID())).rejects.toMatchObject({code:'invalid'});expect(s.backend.reserve).not.toHaveBeenCalled();});
 it('accepts exactly thirty seconds and short narration',async()=>{const s=setup(30);await expect(s.ai.enqueue(s.account,s.inputId,'narration:en:male',1,randomUUID())).resolves.toMatchObject({id:'reserved'});expect(s.backend.reserve).toHaveBeenCalledTimes(1);});
 it.each(['a '.repeat(301),'x'.repeat(321),''])('rejects excessive or unchunkable voice before reserve',async draft=>{const s=setup(20,draft);await expect(s.ai.enqueue(s.account,s.inputId,'narration:en:female',1,randomUUID())).rejects.toMatchObject({code:'invalid'});expect(s.backend.reserve).not.toHaveBeenCalled();});
 it('bounds chunks independently from character allowance',async()=>{const s=setup(20,'One sentence. '.repeat(30),{maxSourceSeconds:30,maxNarrationChars:600,maxVoiceChunks:1});await expect(s.ai.quote(s.account,s.inputId,'narration:en:male',1)).rejects.toMatchObject({code:'invalid'});});
 it('preserves an existing durable request rather than making another reservation',async()=>{const s=setup(50);s.backend.priorRequest.mockResolvedValueOnce({id:'original'} as any);await expect(s.ai.enqueue(s.account,s.inputId,'translation:en',1,randomUUID())).resolves.toEqual({id:'original'});expect(s.backend.reserve).not.toHaveBeenCalled();});
});
