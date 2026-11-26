import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReviewedVoiceFragmentMemoryBridge, type SyntheticC1Read } from './reviewedVoiceFragment.memory';

const vectors=JSON.parse(readFileSync(new URL('./reviewedVoiceCanonical.vectors.json',import.meta.url),'utf8')).vectors;
const vector=vectors.find((entry:{calls:unknown[]})=>entry.calls.length===1);
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unchanged={exists:true,createTime:'1:000000000',updateTime:'1:000000000'} as const;
type Ports=Parameters<typeof createReviewedVoiceFragmentMemoryBridge>[0];
const fresh:Ports['admitForTest']=async (_identity,call)=>({...call,created:true,receiptOnly:false});

function fixture(overrides:Partial<Ports>={}) {
  const {accountId,inputId,revision}=vector.evidence,uid='synthetic-voice-owner',jobId=randomUUID(),reservationId=randomUUID();
  const identityKey=digest(['firebase',uid]);
  const proof:SyntheticC1Read={
    accountId,inputId,revision,jobId,operation:vector.operation,identityKey,
    reservationId,seconds:3,canonicalEvidence:structuredClone(vector.evidence),originalMarkerVersion:unchanged,
    reserveAck:{attemptId:reservationId,identityKey,reservationId,seconds:3,state:'reserved',source:'reserve_ack'},
    versions:{
      identity:unchanged,account:unchanged,input:unchanged,project:unchanged,review:unchanged,receipt:unchanged,marker:unchanged,
      attempt:unchanged,reserveAck:unchanged,voiceJob:unchanged,origin:unchanged,intent:unchanged,request:unchanged,jobMarker:unchanged,
    },
  };
  const request={
    principal:{accountId,uid},jobId,operation:vector.operation,model:vector.model,
    callKey:vector.calls[0].callKey,body:vector.calls[0].body,
  };
  const readVerifiedC1=vi.fn(overrides.readVerifiedC1??(async()=>proof));
  const admitForTest=vi.fn(overrides.admitForTest??fresh);
  const bridge=createReviewedVoiceFragmentMemoryBridge({readVerifiedC1,admitForTest});
  return {bridge,request,proof,readVerifiedC1,admitForTest};
}

describe('reviewed voice fragment memory bridge',()=>{
  beforeEach(()=>vi.stubEnv('LV_VOICE_C2_MEMORY_TEST','1'));
  afterEach(()=>vi.unstubAllEnvs());

  it('is off by default and requires Node test even with its explicit flag',async()=>{
    const {bridge,request,readVerifiedC1,admitForTest}=fixture();
    vi.stubEnv('LV_VOICE_C2_MEMORY_TEST','');
    await expect(bridge.send(request)).resolves.toBe('disabled');
    vi.stubEnv('LV_VOICE_C2_MEMORY_TEST','1');
    vi.stubEnv('NODE_ENV','production');
    await expect(bridge.send(request)).resolves.toBe('disabled');
    expect(readVerifiedC1).not.toHaveBeenCalled();
    expect(admitForTest).not.toHaveBeenCalled();
    expect(bridge.received()).toEqual([]);
  });

  it('reads twice, confirms a new admission and delivers the exact canonical UTF-8 bytes once',async()=>{
    const {bridge,request,proof,readVerifiedC1,admitForTest}=fixture();
    expect(await bridge.send(request)).toBe('sent');
    expect(readVerifiedC1).toHaveBeenCalledTimes(2);
    expect(admitForTest).toHaveBeenCalledTimes(1);
    const [identityKey,call]=admitForTest.mock.calls[0];
    expect(identityKey).toBe(proof.identityKey);
    expect(call).toMatchObject({reservationId:proof.reservationId,seconds:3,jobId:request.jobId,callKey:'voice-chunk:0000',
      model:request.model,requestSha256:createHash('sha256').update(request.body,'utf8').digest('hex')});
    expect(bridge.readReceipt(request.jobId)).toEqual({...call,created:true,receiptOnly:false});
    expect(bridge.received()).toEqual([Buffer.from(request.body,'utf8')]);
    bridge.received()[0].fill(0);
    expect(bridge.received()).toEqual([Buffer.from(request.body,'utf8')]);
    expect(await bridge.send(request)).toBe('unknown');
    expect(await bridge.send({...request,principal:{...request.principal,uid:'synthetic-other'}})).toBe('rejected');
    expect(admitForTest).toHaveBeenCalledTimes(1);
  });

  it('does not admit missing C1 authority, missing marker version, missing ACK or a foreign UID',async()=>{
    const f=fixture();
    f.readVerifiedC1.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({...f.proof,originalMarkerVersion:undefined} as unknown as SyntheticC1Read)
      .mockResolvedValueOnce({...f.proof,versions:{...f.proof.versions,reserveAck:undefined}} as unknown as SyntheticC1Read)
      .mockResolvedValueOnce({...f.proof,reserveAck:{...f.proof.reserveAck,reservationId:randomUUID()}});
    for(let count=0;count<4;count++)expect(await f.bridge.send(f.request)).toBe('rejected');
    expect(await f.bridge.send({...f.request,principal:{...f.request.principal,uid:'synthetic-other'}})).toBe('rejected');
    expect(f.admitForTest).not.toHaveBeenCalled();
    expect(f.bridge.received()).toEqual([]);
  });

  it('rejects changed body, model, voice and ordinal before an admission',async()=>{
    const f=fixture();
    const otherVoice=f.request.operation.endsWith(':female')?'narration:en:male':'narration:en:female';
    for(const change of [{body:f.request.body+' '},{model:'synthetic-wrong-model'},{operation:otherVoice},{callKey:'voice-chunk:0001'}]){
      expect(await f.bridge.send({...f.request,...change})).toBe('rejected');
    }
    expect(f.admitForTest).not.toHaveBeenCalled();
    expect(f.bridge.received()).toEqual([]);
  });

  it.each(['identity','project','review','receipt','marker'] as const)('keeps the admission and never delivers if the %s version changes',async field=>{
    const f=fixture();
    const restoredOrRecreated={...f.proof,versions:{...f.proof.versions,[field]:{...unchanged,updateTime:'2:000000000'}}} as SyntheticC1Read;
    f.readVerifiedC1.mockResolvedValueOnce(f.proof).mockResolvedValueOnce(restoredOrRecreated);
    expect(await f.bridge.send(f.request)).toBe('unknown');
    expect(f.bridge.readReceipt(f.request.jobId)).toMatchObject({created:true,receiptOnly:false});
    expect(f.bridge.received()).toEqual([]);
    expect(await f.bridge.send(f.request)).toBe('unknown');
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
  });

  it('does not deliver if marker contents are recreated with a new creation version',async()=>{
    const f=fixture();
    f.readVerifiedC1.mockResolvedValueOnce(f.proof).mockResolvedValueOnce({...f.proof,versions:{...f.proof.versions,
      marker:{exists:true,createTime:'2:000000000',updateTime:'2:000000000'},
    }});
    expect(await f.bridge.send(f.request)).toBe('unknown');
    expect(f.bridge.readReceipt(f.request.jobId)).toMatchObject({created:true});
    expect(f.bridge.received()).toEqual([]);
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
  });

  it.each(['receiptOnly','lostBefore','lostAfter','wrongTuple'] as const)('does not deliver or retry on %s',async failure=>{
    let simulatedAdmissions=0;
    const f=fixture({admitForTest:async (_identity,call)=>{
      if(failure==='lostBefore')throw new Error('synthetic loss before admission');
      if(failure==='lostAfter'){
        simulatedAdmissions++;
        throw new Error('synthetic loss after admission');
      }
      if(failure==='wrongTuple')return {...call,seconds:4,created:true,receiptOnly:false};
      return {...call,created:false,receiptOnly:true};
    }});
    expect(await f.bridge.send(f.request)).toBe('unknown');
    expect(await f.bridge.send(f.request)).toBe('unknown');
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
    expect(simulatedAdmissions).toBe(failure==='lostAfter'?1:0);
    expect(f.bridge.received()).toEqual([]);
    if(failure==='receiptOnly')expect(f.bridge.readReceipt(f.request.jobId)).toMatchObject({created:false,receiptOnly:true});
    else expect(f.bridge.readReceipt(f.request.jobId)).toBeUndefined();
  });

  it('fences competing sends before the admission returns',async()=>{
    let release!:()=>void;
    const paused=new Promise<void>(resolve=>{release=resolve;});
    const f=fixture({admitForTest:async (identity,call)=>{await paused;return fresh(identity,call);}});
    const first=f.bridge.send(f.request),second=f.bridge.send(f.request);
    await expect(Promise.race([first,second])).resolves.toBe('unknown');
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
    expect(f.bridge.received()).toEqual([]);
    release();
    expect((await Promise.all([first,second])).sort()).toEqual(['sent','unknown']);
    expect(f.bridge.received()).toEqual([Buffer.from(f.request.body,'utf8')]);
  });
});
