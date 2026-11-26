import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReviewedVoiceFragmentMemoryBridge, type SyntheticC1Read, type SyntheticFragmentRequest } from './reviewedVoiceFragment.memory';
import { validateReviewedVoiceCall } from './reviewedVoiceCanonical';
import { encodeTextBundle } from './pipelineTextCodec';
import { isLocalVoiceC2FixtureTarget } from './localVoiceFixture';

const vectors=JSON.parse(readFileSync(new URL('./reviewedVoiceCanonical.vectors.json',import.meta.url),'utf8')).vectors;
const vector=vectors.find((entry:{calls:unknown[]})=>entry.calls.length===1);
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unchanged={exists:true,createTime:'1:000000000',updateTime:'1:000000000'} as const;
const versionNames=[
  'identity','account','input','project','review','receipt','marker','attempt','reserveAck',
  'voiceJob','origin','intent','request','jobMarker',
] as const;
type Ports=Parameters<typeof createReviewedVoiceFragmentMemoryBridge>[0];
const fresh:Ports['admitForTest']=async (_identity,call)=>({...call,created:true,receiptOnly:false});

function fixture(overrides:Partial<Ports>={}) {
  const {accountId,inputId,revision}=vector.evidence,uid='synthetic-voice-owner',jobId=randomUUID(),reservationId=randomUUID();
  const identityKey=digest(['firebase',uid]);
  const proof:SyntheticC1Read={
    accountId,inputId,revision,jobId,operation:vector.operation,identityKey,
    reservationId,seconds:3,canonicalEvidence:structuredClone(vector.evidence),originalMarkerVersion:unchanged,
    reserveAck:{attemptId:reservationId,identityKey,reservationId,seconds:3,state:'reserved',source:'reserve_ack'},
    reviewedSource:{
      textJobId:vector.evidence.textJobId,reviewId:vector.evidence.reviewId,receiptId:vector.evidence.receiptId,
      bindingHash:vector.evidence.bindingHash,payloadSha256:vector.evidence.review.payloadSha256,
      voiceTextSha256:vector.evidence.review.voiceSha256,
    },
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
  const inspect=()=>bridge.inspectForTest(request.jobId,request.principal);
  return {bridge,request,proof,readVerifiedC1,admitForTest,inspect};
}

function donorEvidence() {
  const evidence=structuredClone(vector.evidence),textJobId=randomUUID();
  const {accountId,inputId,revision}=evidence,review=evidence.review,receipt=evidence.receipt;
  const {durationMs,cues}=JSON.parse(review.payload);
  const donor=encodeTextBundle(textJobId,durationMs,{detectedLanguage:'es',hasSpeech:true,
    cues:cues.map(({startMs,endMs,es,en})=>({startMs,endMs,es,en}))});
  const reviewId=digest(['review-revision-v1',accountId,inputId,textJobId,revision]);
  const payload=JSON.stringify({durationMs,cues:donor.cues});
  Object.assign(evidence,{textJobId,reviewId});
  Object.assign(review,{jobId:textJobId,payload});
  Object.assign(receipt,{jobId:textJobId,reviewId});
  review.payloadSha256=receipt.payloadSha256=createHash('sha256').update(payload,'utf8').digest('hex');
  review.fingerprint=receipt.fingerprint=digest(['review-save-v1',accountId,inputId,textJobId,revision-1,
    donor.cues.map(cue=>[cue.id,cue.en])]);
  return evidence;
}

describe('reviewed voice fragment memory bridge',()=>{
  beforeEach(()=>vi.stubEnv('LV_VOICE_C2_MEMORY_TEST','1'));
  afterEach(()=>vi.unstubAllEnvs());

  it('is off by default and requires Node test even with its explicit flag',async()=>{
    const {bridge,request,readVerifiedC1,admitForTest,inspect}=fixture();
    vi.stubEnv('LV_VOICE_C2_MEMORY_TEST','');
    await expect(bridge.send(request)).resolves.toBe('disabled');
    vi.stubEnv('LV_VOICE_C2_MEMORY_TEST','1');
    vi.stubEnv('NODE_ENV','production');
    await expect(bridge.send(request)).resolves.toBe('disabled');
    expect(readVerifiedC1).not.toHaveBeenCalled();
    expect(admitForTest).not.toHaveBeenCalled();
    expect(inspect()).toBeUndefined();
  });

  it('reads twice, confirms a new admission and delivers the exact canonical UTF-8 bytes once',async()=>{
    const {bridge,request,proof,readVerifiedC1,admitForTest,inspect}=fixture();
    expect(request.jobId).not.toBe(proof.reviewedSource.textJobId);
    expect(await bridge.send(request)).toBe('sent');
    expect(readVerifiedC1).toHaveBeenCalledTimes(2);
    expect(admitForTest).toHaveBeenCalledTimes(1);
    const [identityKey,call]=admitForTest.mock.calls[0];
    expect(identityKey).toBe(proof.identityKey);
    expect(call).toMatchObject({reservationId:proof.reservationId,seconds:3,jobId:request.jobId,callKey:'voice-chunk:0000',
      model:request.model,requestSha256:createHash('sha256').update(request.body,'utf8').digest('hex')});
    expect(inspect()?.receipt).toEqual({...call,created:true,receiptOnly:false});
    expect(inspect()?.bytes).toEqual(Buffer.from(request.body,'utf8'));
    inspect()?.bytes?.fill(0);
    expect(inspect()?.bytes).toEqual(Buffer.from(request.body,'utf8'));
    expect(await bridge.send(request)).toBe('unknown');
    readVerifiedC1.mockResolvedValueOnce(null);
    expect(await bridge.send(request)).toBe('rejected');
    expect(inspect()?.receipt).toEqual({...call,created:true,receiptOnly:false});
    expect(inspect()?.bytes).toEqual(Buffer.from(request.body,'utf8'));
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
    expect(f.inspect()).toBeUndefined();
  });

  it.each(['before admission','after admission'])('rejects a valid canonical fragment from the wrong text job %s',async stage=>{
    const f=fixture();
    const donor=donorEvidence();
    expect(validateReviewedVoiceCall({evidence:donor,operation:f.request.operation,model:f.request.model,
      callKey:f.request.callKey,body:f.request.body}).textJobId).toBe(donor.textJobId);
    expect(donor.textJobId).not.toBe(f.proof.reviewedSource.textJobId);
    const wrongSource={...f.proof,canonicalEvidence:donor};
    if(stage==='after admission')f.readVerifiedC1.mockResolvedValueOnce(f.proof);
    f.readVerifiedC1.mockResolvedValueOnce(wrongSource);
    expect(await f.bridge.send(f.request)).toBe(stage==='before admission'?'rejected':'unknown');
    expect(f.admitForTest).toHaveBeenCalledTimes(stage==='before admission'?0:1);
    expect(f.inspect()?.bytes).toBeUndefined();
    if(stage==='after admission')expect(f.inspect()?.receipt).toMatchObject({created:true});
  });

  it('rejects changed body, model, voice and ordinal before an admission',async()=>{
    const f=fixture();
    const otherVoice=f.request.operation.endsWith(':female')?'narration:en:male':'narration:en:female';
    for(const change of [{body:f.request.body+' '},{model:'synthetic-wrong-model'},{operation:otherVoice},{callKey:'voice-chunk:0001'}]){
      expect(await f.bridge.send({...f.request,...change})).toBe('rejected');
    }
    expect(f.admitForTest).not.toHaveBeenCalled();
    expect(f.inspect()).toBeUndefined();
  });

  it('rejects malformed requests without invoking an accessor or either port',async()=>{
    const f=fixture(),getter=vi.fn(()=>f.request.principal);
    const withGetter=Object.defineProperty({...f.request},'principal',{get:getter,enumerable:true});
    const brokenProxy=new Proxy(f.request,{getPrototypeOf(){throw Error('invalid synthetic object');}});
    for(const request of [null,{}, {...f.request,principal:null},withGetter,brokenProxy]){
      expect(await f.bridge.send(request as SyntheticFragmentRequest)).toBe('rejected');
    }
    expect(getter).not.toHaveBeenCalled();
    expect(f.readVerifiedC1).not.toHaveBeenCalled();
    expect(f.admitForTest).not.toHaveBeenCalled();
  });

  it('requires exact own data fields for every version and rejects getters',async()=>{
    const f=fixture(),getter=vi.fn(()=>unchanged);
    const inherited=Object.assign(Object.create({identity:unchanged}),f.proof.versions);
    delete inherited.identity;
    const withGetter=Object.defineProperty({...f.proof.versions},'project',{get:getter,enumerable:true});
    const malformedVersion=Object.defineProperty({...unchanged},'updateTime',{get:getter});
    for(const versions of [inherited,withGetter,{...f.proof.versions,review:malformedVersion},
      {...f.proof.versions,receipt:{...unchanged,extra:true}}]){
      f.readVerifiedC1.mockResolvedValueOnce({...f.proof,versions});
      expect(await f.bridge.send(f.request)).toBe('rejected');
    }
    expect(getter).not.toHaveBeenCalled();
    expect(f.admitForTest).not.toHaveBeenCalled();
  });

  it.each(['review','receipt'] as const)('rejects an absent canonical %s before an admission',async field=>{
    const f=fixture(),evidence=structuredClone(vector.evidence);
    delete evidence[field];
    f.readVerifiedC1.mockResolvedValueOnce({...f.proof,canonicalEvidence:evidence});
    expect(await f.bridge.send(f.request)).toBe('rejected');
    expect(f.admitForTest).not.toHaveBeenCalled();
  });

  it.each(versionNames)('keeps the admission and original evidence if the %s version changes',async field=>{
    const f=fixture();
    const restoredOrRecreated={...f.proof,versions:{...f.proof.versions,[field]:{...unchanged,updateTime:'2:000000000'}}} as SyntheticC1Read;
    f.readVerifiedC1.mockResolvedValueOnce(f.proof).mockResolvedValueOnce(restoredOrRecreated);
    expect(await f.bridge.send(f.request)).toBe('unknown');
    expect(f.inspect()?.receipt).toMatchObject({created:true,receiptOnly:false});
    expect(f.inspect()?.before.versions).toEqual(f.proof.versions);
    expect(f.inspect()?.bytes).toBeUndefined();
    expect(await f.bridge.send(f.request)).toBe('unknown');
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
  });

  it('does not deliver if marker contents are recreated with a new creation version',async()=>{
    const f=fixture();
    f.readVerifiedC1.mockResolvedValueOnce(f.proof).mockResolvedValueOnce({...f.proof,versions:{...f.proof.versions,
      marker:{exists:true,createTime:'2:000000000',updateTime:'2:000000000'},
    }});
    expect(await f.bridge.send(f.request)).toBe('unknown');
    expect(f.inspect()?.receipt).toMatchObject({created:true});
    expect(f.inspect()?.bytes).toBeUndefined();
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
    expect(f.inspect()?.bytes).toBeUndefined();
    expect(f.inspect()?.call).toEqual(f.admitForTest.mock.calls[0][1]);
    if(failure==='receiptOnly')expect(f.inspect()?.receipt).toMatchObject({created:false,receiptOnly:true});
    else expect(f.inspect()?.receipt).toBeUndefined();
  });

  it('keeps the same request uncertain when a lost admission has closed the first-read gate',async()=>{
    let committed=0;
    const f=fixture({admitForTest:async ()=>{
      committed++;
      throw Error('synthetic loss after admission');
    }});
    // Mirrors the adapter's initial read: an already admitted reservation is
    // ineligible for a new attempt, even when its original reply was lost.
    f.readVerifiedC1.mockImplementation(async (_request,admitted)=>committed&&!admitted?null:f.proof);
    expect(await f.bridge.send(f.request)).toBe('unknown');
    const retained=f.inspect();
    expect(retained?.receipt).toBeUndefined();
    expect(retained?.bytes).toBeUndefined();
    const repeated=await f.bridge.send(f.request);
    const foreign={...f.request.principal,uid:'synthetic-foreign-voice-owner'};
    expect(await f.bridge.send({...f.request,principal:foreign})).toBe('rejected');
    expect(await f.bridge.send({...f.request,body:f.request.body+' '})).toBe('rejected');
    expect(await f.bridge.send({...f.request,model:f.request.model+'-different'})).toBe('rejected');
    const otherOperation=f.request.operation==='narration:en:male'?'narration:en:female':'narration:en:male';
    expect(await f.bridge.send({...f.request,operation:otherOperation})).toBe('rejected');
    expect(f.bridge.inspectForTest(f.request.jobId,foreign)).toBeUndefined();
    expect(f.inspect()).toEqual(retained);
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
    expect(committed).toBe(1);
    expect(repeated).toBe('unknown');
    f.readVerifiedC1.mockRejectedValueOnce(Error('synthetic replay read unavailable'));
    expect(await f.bridge.send(f.request)).toBe('unknown');
    expect(f.inspect()).toEqual(retained);
    const reads=f.readVerifiedC1.mock.calls.length;
    vi.stubEnv('LV_VOICE_C2_MEMORY_TEST','');
    expect(await f.bridge.send(f.request)).toBe('disabled');
    expect(f.readVerifiedC1).toHaveBeenCalledTimes(reads);
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
    expect(f.inspect()).toBeUndefined();
  });

  it.each(['LV_VOICE_C1_FIXTURE','LV_VOICE_C2_FIXTURE'])('keeps the replay uncertain without reaching Firestore while %s is off',async flag=>{
    vi.stubEnv('FIRESTORE_EMULATOR_HOST','127.0.0.1:8185');
    vi.stubEnv('LV_REVIEW_CONTRACT','1');
    vi.stubEnv('LV_VOICE_C1_FIXTURE','1');
    vi.stubEnv('LV_VOICE_C2_FIXTURE','1');
    const db={projectId:'demo-vistavo-ledger',databaseId:'(default)',
      _settings:{servicePath:'127.0.0.1',port:8185,ssl:false}} as unknown as Firestore;
    const root={firestore:db,id:randomUUID(),parent:{path:'vistavo_review_contract_synthetic'}} as unknown as DocumentReference;
    const f=fixture(),loadC1=vi.fn<Ports['readVerifiedC1']>(async (_request,admitted)=>{
      if(admitted)throw Error('synthetic second read unavailable');
      return f.proof;
    });
    f.readVerifiedC1.mockImplementation(async (request,admitted)=>{
      if(!isLocalVoiceC2FixtureTarget(db,root))return null;
      return loadC1(request,admitted);
    });
    expect(await f.bridge.send(f.request)).toBe('unknown');
    const retained=f.inspect();
    expect(retained?.receipt).toMatchObject({created:true,receiptOnly:false});
    expect(retained?.bytes).toBeUndefined();
    expect(loadC1).toHaveBeenCalledTimes(2);
    vi.stubEnv(flag,'0');
    expect(await f.bridge.send(f.request)).toBe('unknown');
    const foreign={...f.request.principal,uid:'synthetic-foreign-with-adapter-off'};
    expect(await f.bridge.send({...f.request,principal:foreign})).toBe('rejected');
    expect(await f.bridge.send({...f.request,body:f.request.body+' '})).toBe('rejected');
    expect(f.bridge.inspectForTest(f.request.jobId,foreign)).toBeUndefined();
    expect(loadC1).toHaveBeenCalledTimes(2);
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
    expect(f.inspect()).toEqual(retained);
  });

  it('fences competing sends before the admission returns',async()=>{
    let release!:()=>void;
    const paused=new Promise<void>(resolve=>{release=resolve;});
    const f=fixture({admitForTest:async (identity,call)=>{await paused;return fresh(identity,call);}});
    const first=f.bridge.send(f.request),second=f.bridge.send(f.request);
    await expect(Promise.race([first,second])).resolves.toBe('unknown');
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
    expect(f.inspect()?.bytes).toBeUndefined();
    release();
    expect((await Promise.all([first,second])).sort()).toEqual(['sent','unknown']);
    expect(f.inspect()?.bytes).toEqual(Buffer.from(f.request.body,'utf8'));
  });

  it('also fences a different voice job requesting the same reservation',async()=>{
    const f=fixture(),otherJobId=randomUUID();
    f.readVerifiedC1.mockImplementation(async request=>({...f.proof,jobId:request.jobId}));
    expect(await f.bridge.send(f.request)).toBe('sent');
    expect(await f.bridge.send({...f.request,jobId:otherJobId})).toBe('unknown');
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
    expect(f.bridge.inspectForTest(otherJobId,f.request.principal)).toBeUndefined();
  });

  it('keeps the confirmed receipt and original projection when the second read throws',async()=>{
    const f=fixture();
    f.readVerifiedC1.mockResolvedValueOnce(f.proof).mockRejectedValueOnce(Error('synthetic loss on reread'));
    expect(await f.bridge.send(f.request)).toBe('unknown');
    const retained=f.inspect();
    expect(retained?.receipt).toMatchObject({created:true,receiptOnly:false});
    expect(retained?.before).toMatchObject({
      jobId:f.request.jobId,textJobId:f.proof.reviewedSource.textJobId,reviewId:f.proof.reviewedSource.reviewId,
      reservationId:f.proof.reservationId,seconds:f.proof.seconds,versions:f.proof.versions,
    });
    expect(retained?.before).not.toHaveProperty('body');
    expect(retained?.before).not.toHaveProperty('canonicalEvidence');
    expect(retained?.bytes).toBeUndefined();
    f.readVerifiedC1.mockResolvedValue(null);
    const replay=await f.bridge.send(f.request);
    const foreign={...f.request.principal,uid:'synthetic-foreign-after-receipt'};
    expect(await f.bridge.send({...f.request,principal:foreign})).toBe('rejected');
    expect(await f.bridge.send({...f.request,body:f.request.body+' '})).toBe('rejected');
    expect(f.bridge.inspectForTest(f.request.jobId,foreign)).toBeUndefined();
    expect(f.inspect()).toEqual(retained);
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
    expect(replay).toBe('unknown');
  });

  it.each(['NODE_ENV','LV_VOICE_C2_MEMORY_TEST'])('does not deliver if %s is switched off after admission',async flag=>{
    const f=fixture();
    f.admitForTest.mockImplementationOnce(async (identity,call)=>{
      const result=await fresh(identity,call);
      vi.stubEnv(flag,'off');
      return result;
    });
    expect(await f.bridge.send(f.request)).toBe('unknown');
    expect(f.inspect()).toBeUndefined();
    expect(f.readVerifiedC1).toHaveBeenCalledTimes(1);
    expect(await f.bridge.send(f.request)).toBe('disabled');
    expect(f.readVerifiedC1).toHaveBeenCalledTimes(1);
    vi.stubEnv(flag,flag==='NODE_ENV'?'test':'1');
    const retained=f.inspect();
    expect(retained?.receipt).toMatchObject({created:true,receiptOnly:false});
    expect(retained?.bytes).toBeUndefined();
    f.readVerifiedC1.mockResolvedValue(null);
    const replay=await f.bridge.send(f.request);
    expect(f.inspect()).toEqual(retained);
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
    expect(replay).toBe('unknown');
  });

  it('does not deliver if the fixture is switched off during the second read',async()=>{
    const f=fixture();
    f.readVerifiedC1.mockResolvedValueOnce(f.proof).mockImplementationOnce(async()=>{
      vi.stubEnv('LV_VOICE_C2_MEMORY_TEST','0');
      return f.proof;
    });
    expect(await f.bridge.send(f.request)).toBe('unknown');
    vi.stubEnv('LV_VOICE_C2_MEMORY_TEST','1');
    expect(f.inspect()?.receipt).toMatchObject({created:true});
    expect(f.inspect()?.bytes).toBeUndefined();
    expect(f.admitForTest).toHaveBeenCalledTimes(1);
  });

  it('test inspection only exposes a job to its matching account and UID',async()=>{
    const f=fixture();
    expect(await f.bridge.send(f.request)).toBe('sent');
    expect(f.bridge.inspectForTest(f.request.jobId,{...f.request.principal,uid:'synthetic-other'})).toBeUndefined();
    expect(f.bridge.inspectForTest(f.request.jobId,{...f.request.principal,accountId:randomUUID()})).toBeUndefined();
    expect(f.inspect()?.bytes).toEqual(Buffer.from(f.request.body,'utf8'));
  });
});
