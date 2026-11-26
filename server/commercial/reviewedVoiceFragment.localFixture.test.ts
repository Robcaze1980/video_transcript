import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreBackend } from './firestoreBackend';
import { FirestoreReviewedTranslation } from './firestoreReviewedTranslation';
import { createReviewedVoiceFragmentLocalFixture, localVoiceC2AccountRoot } from './reviewedVoiceFragment.localFixture';

const collection='vistavo_review_contract_synthetic';
const ownerId='11111111-1111-4111-8111-111111111111';
const foreignId='22222222-2222-4222-8222-222222222222';
const principal={accountId:ownerId,uid:'synthetic-owner'};
const input={principal,jobId:ownerId,operation:'narration:en:male',model:'model',callKey:'voice-chunk:0000',body:'synthetic'};

function fixture() {
  const db={projectId:'demo-vistavo-ledger',databaseId:'(default)',_settings:{servicePath:'127.0.0.1',port:8185,ssl:false},
    runTransaction:vi.fn()} as unknown as Firestore;
  function root(id:string) {
    const path=collection+'/'+id;
    return {id,path,parent:{path:collection},firestore:db,isEqual:(ref:DocumentReference)=>ref.firestore===db&&ref.path===path,
      get:vi.fn(async()=>({exists:false,get:()=>undefined})),
      collection:(name:string)=>({doc:(key:string)=>({path:path+'/'+name+'/'+key})}),
    } as unknown as DocumentReference;
  }
  const video=root(ownerId),other=root(foreignId),backend=new FirestoreBackend(db,video);
  const objects={read:vi.fn()};
  const service=new FirestoreReviewedTranslation(db,video,backend,objects);
  const adapter=createReviewedVoiceFragmentLocalFixture(video,backend,service);
  const reserve=adapter.reserve.bind(null,principal,ownerId,2,foreignId,input.operation);
  return {db,video,other,backend,objects,adapter,reserve};
}

describe('C2 local fixture gate',()=>{
  beforeEach(()=>{
    vi.stubEnv('NODE_ENV','test');
    vi.stubEnv('FIRESTORE_EMULATOR_HOST','127.0.0.1:8185');
    vi.stubEnv('LV_VOICE_C1_FIXTURE','1');
    vi.stubEnv('LV_REVIEW_CONTRACT','1');
    vi.stubEnv('LV_VOICE_C2_MEMORY_TEST','1');
    vi.stubEnv('LV_VOICE_C2_FIXTURE','1');
  });
  afterEach(()=>vi.unstubAllEnvs());

  it('keeps the local C2 gate off by default with zero reads',async()=>{
    const f=fixture();
    vi.stubEnv('LV_VOICE_C2_FIXTURE',undefined);
    await expect(f.reserve()).rejects.toThrow('synthetic_voice_c2_disabled');
    expect(await f.adapter.receiver().send(input)).toBe('rejected');
    expect(f.video.get).not.toHaveBeenCalled();
    expect(f.db.runTransaction).not.toHaveBeenCalled();
  });

  it('requires a marked root and derives a distinct Account path inside it',async()=>{
    const f=fixture();
    expect(localVoiceC2AccountRoot(f.video).path).toBe(f.video.path+'/syntheticAccountStores/'+f.video.id);
    expect(localVoiceC2AccountRoot(f.other).path).not.toBe(localVoiceC2AccountRoot(f.video).path);
    await expect(f.reserve()).rejects.toThrow('synthetic_voice_c2_disabled');
    expect(f.video.get).toHaveBeenCalledOnce();
    expect(f.db.runTransaction).not.toHaveBeenCalled();
  });

  it('rejects a service assigned to a different Video root before reading either root',async()=>{
    const f=fixture();
    const mismatched=new FirestoreReviewedTranslation(f.db,f.other,f.backend,f.objects);
    const adapter=createReviewedVoiceFragmentLocalFixture(f.video,f.backend,mismatched);
    await expect(adapter.reserve(principal,ownerId,2,foreignId,input.operation)).rejects.toThrow('synthetic_voice_c2_disabled');
    expect(await adapter.receiver().send(input)).toBe('rejected');
    expect(f.video.get).not.toHaveBeenCalled();
    expect(f.other.get).not.toHaveBeenCalled();
    expect(f.db.runTransaction).not.toHaveBeenCalled();
  });
});
