import type { ReviewedVoiceBinding } from './firestoreReviewedTranslation';
import { AI_CATALOG_VERSION } from './aiContracts';
import { FirestoreBackend } from './firestoreBackend';
import { videoReservationId } from './videoReservationId';
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  RESERVE_ATTEMPT_DOCUMENTS, RESERVE_ATTEMPT_PROFILE_V1, prepareReserveAttemptInTransaction, recordReserveAckInTransaction, stageReserveAck,
  createReviewedVoiceReserveAttempt, matchesReviewedVoiceReserveSource, verifyReviewedVoiceReserveReplay,
  type ReserveAttemptEvidence, type ReserveAttemptEvidenceV1,
} from './reserveAttemptEvidence';

// A deterministic local double of document reads and create-only writes.
// It does not emulate Firestore isolation, rollback, retries or IAM.
function fakeTransaction(store = new Map<string,unknown>(), wait?:Promise<void>, entered?:()=>void) {
  const root:any = {collection:(collection:string)=>({doc:(id:string)=>({path:`${collection}/${id}`})})};
  const tx:any = {
    getAll:vi.fn(async(...refs:{path:string}[])=>{
      entered?.();if (wait) await wait;
      return refs.map(ref=>({exists:store.has(ref.path), data:()=>structuredClone(store.get(ref.path))}));
    }),
    create:vi.fn((ref:{path:string}, value:unknown)=>{
      if(store.has(ref.path)) throw Error('document already exists');
      store.set(ref.path, structuredClone(value));return tx;
    }),
  };
  return {root,tx,store};
}
function makeAttempt():ReserveAttemptEvidenceV1 {
  const required = new Set(['account','identity','input','project','intent','origin','intentGuard']);
  const versions = Object.fromEntries(RESERVE_ATTEMPT_DOCUMENTS.map(name=>[name,required.has(name)
    ? {exists:true,createTime:'1:000000000',updateTime:'1:000000000'} : {exists:false}]));
  return {version:1,attemptId:randomUUID(),witness:{
    intentId:'a'.repeat(64),accountId:randomUUID(),inputId:randomUUID(),operation:'translation:en',revision:1,
    profile:RESERVE_ATTEMPT_PROFILE_V1,provider:'account_seconds',identityKey:'b'.repeat(64),reservationId:randomUUID(),seconds:2,
  },versions} as ReserveAttemptEvidenceV1;
}
const response=(a:ReserveAttemptEvidence)=>({reservationId:a.witness.reservationId,seconds:a.witness.seconds,state:'reserved' as const});
const preparedPath=(a:ReserveAttemptEvidence)=>`billingReserveAttempts/${a.attemptId}`;
const ackPath=(a:ReserveAttemptEvidence)=>`billingReserveAckObservations/${a.attemptId}`;
const invalid = {code:'invalid'}, conflict = {code:'conflict'};

describe('reviewed voice reservation entry guards', () => {
  const uid = 'synthetic-voice-owner';
  const principal = {accountId:randomUUID(), uid};
  const inputId = randomUUID();
  const billing = {
    provider:'account_seconds' as const, identityKey:createHash('sha256').update(JSON.stringify(['firebase',uid])).digest('hex'),
    reservationId:randomUUID(), seconds:3,
  };

  it('rejects arbitrary request keys before a transaction or Account call', async () => {
    const transaction = vi.fn(), reserve = vi.fn();
    const backend = new FirestoreBackend({projectId:'demo-vistavo-ledger',databaseId:'(default)',
      _settings:{servicePath:'127.0.0.1',port:8185,ssl:false},runTransaction:transaction} as never,
      {parent:{path:'vistavo_review_contract_synthetic'},id:randomUUID()} as never);
    vi.stubEnv('NODE_ENV','test');
    vi.stubEnv('LV_VOICE_C1_FIXTURE','1');
    vi.stubEnv('FIRESTORE_EMULATOR_HOST','127.0.0.1:8185');
    try {
      for (const key of ['https://synthetic.invalid/private-canary','synthetic private request text',
        '91605fd0-279b-16c6-88b4-76921edd4cb3','91605fd0-279b-46c6-78b4-76921edd4cb3',`${randomUUID()}\n`]) {
        await expect(backend.reserveReviewedVoiceLocally({} as never,reserve,principal,inputId,2,key,'narration:en:male'))
          .rejects.toMatchObject(invalid);
      }
      expect(transaction).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it('rejects direct external narration without the reviewed voice path and keeps external text keys compatible', async () => {
    const expectedRead = Error('synthetic text transaction');
    const transaction = vi.fn().mockRejectedValue(expectedRead);
    const backend = new FirestoreBackend({runTransaction:transaction} as never,{} as never);
    await expect(backend.reserve(principal.accountId,inputId,randomUUID(),3,'narration:en:male',2,
      AI_CATALOG_VERSION,billing,undefined,uid)).rejects.toMatchObject(invalid);
    expect(transaction).not.toHaveBeenCalled();
    await expect(backend.reserve(principal.accountId,inputId,'legacy-text-request',3,'translation:en',1,
      AI_CATALOG_VERSION,billing,undefined,uid)).rejects.toBe(expectedRead);
    expect(transaction).toHaveBeenCalledOnce();
  });
});

describe('disconnected evidence for an external reserve attempt',()=>{
  it('keeps v1 reserve evidence readable when the live catalog changes',async()=>{
    const f=fakeTransaction(),a=makeAttempt();
    expect(a.witness.profile).toBe('ai-candidate-v1');
    await prepareReserveAttemptInTransaction(f.tx,f.root,a);
    // Simulate deploying a later catalog without changing any persisted v1
    // record. Reset modules so this tests the dependency at import time.
    vi.resetModules();vi.doMock('./aiContracts',()=>({AI_CATALOG_VERSION:'ai-candidate-v2'}));
    try{
      expect((await import('./aiContracts')).AI_CATALOG_VERSION).toBe('ai-candidate-v2');
      const module=await import('./reserveAttemptEvidence');
      await expect(module.recordReserveAckInTransaction(f.tx,f.root,a,response(a))).resolves.toEqual({state:'recorded',attribution:'unverified'});
      await expect(module.prepareReserveAttemptInTransaction(f.tx,f.root,a)).resolves.toEqual({state:'already_prepared',observation:'ack_recorded'});
    }finally{vi.doUnmock('./aiContracts');vi.resetModules();}
  });

  it('accepts only the v1 protocol and its historical catalog profile',async()=>{
    const f=fakeTransaction(),original=makeAttempt();
    for(const [protocol,profile] of [[2,'ai-candidate-v1'],[1,'ai-candidate-v2'],[2,'ai-candidate-v2'],[0,'ai-candidate-v1']]){
      const incompatible:any=structuredClone(original);incompatible.version=protocol;incompatible.witness.profile=profile;
      await expect(prepareReserveAttemptInTransaction(f.tx,f.root,incompatible)).rejects.toMatchObject(invalid);
    }
    expect(f.tx.getAll).not.toHaveBeenCalled();expect(f.store.size).toBe(0);
    await prepareReserveAttemptInTransaction(f.tx,f.root,original);
    const stored:any=structuredClone(f.store.get(preparedPath(original)));stored.version=2;f.store.set(preparedPath(original),stored);
    await expect(recordReserveAckInTransaction(f.tx,f.root,original,response(original))).rejects.toMatchObject(conflict);
    expect(f.store.has(ackPath(original))).toBe(false);expect(f.store.get(preparedPath(original))).toEqual(stored);
  });

  it('allows an absent account guard but requires lowercase generated attempt and reservation IDs',async()=>{
    const f=fakeTransaction(),a:any=makeAttempt();expect(a.versions.guard).toEqual({exists:false});
    const lowercase='abcdefab-1234-4abc-8def-abcdefabcdef';
    for(const field of ['attemptId','reservationId']){
      const candidate=structuredClone(a);
      if(field==='attemptId')candidate.attemptId=lowercase.toUpperCase();else candidate.witness.reservationId=lowercase.toUpperCase();
      await expect(prepareReserveAttemptInTransaction(f.tx,f.root,candidate)).rejects.toMatchObject(invalid);
    }
    a.attemptId=lowercase;a.witness.reservationId=lowercase;
    await expect(prepareReserveAttemptInTransaction(f.tx,f.root,a)).resolves.toEqual({state:'created',observation:'unknown'});
  });

  it('prepares once, records one unverified ACK and treats repeats as receipts',async()=>{
    const f=fakeTransaction(),a=makeAttempt();
    await expect(prepareReserveAttemptInTransaction(f.tx,f.root,a)).resolves.toEqual({state:'created',observation:'unknown'});
    await expect(prepareReserveAttemptInTransaction(f.tx,f.root,a)).resolves.toEqual({state:'already_prepared',observation:'unknown'});
    await expect(recordReserveAckInTransaction(f.tx,f.root,a,response(a))).resolves.toEqual({state:'recorded',attribution:'unverified'});
    const stored=structuredClone(f.store.get(ackPath(a)));
    await expect(recordReserveAckInTransaction(f.tx,f.root,a,response(a))).resolves.toEqual({state:'already_recorded',attribution:'unverified'});
    await expect(prepareReserveAttemptInTransaction(f.tx,f.root,a)).resolves.toEqual({state:'already_prepared',observation:'ack_recorded'});
    expect(f.tx.create).toHaveBeenCalledTimes(2);expect(f.store.get(ackPath(a))).toEqual(stored);
    expect(stored).toMatchObject({attemptId:a.attemptId,intentId:a.witness.intentId,reservationId:a.witness.reservationId,
      seconds:2,source:'reserve_ack',state:'reserved',attribution:'unverified',snapshot:{versions:a.versions}});
  });

  it('rejects a missing or altered attempt and never reconstructs an orphan ACK',async()=>{
    const f=fakeTransaction(),a=makeAttempt();
    await expect(recordReserveAckInTransaction(f.tx,f.root,a,response(a))).rejects.toMatchObject(conflict);
    f.store.set(ackPath(a),{orphan:true});
    await expect(prepareReserveAttemptInTransaction(f.tx,f.root,a)).rejects.toMatchObject(conflict);
    expect(f.store.has(preparedPath(a))).toBe(false);expect(f.store.get(ackPath(a))).toEqual({orphan:true});
    f.store.delete(ackPath(a));await prepareReserveAttemptInTransaction(f.tx,f.root,a);
    const altered:any=structuredClone(f.store.get(preparedPath(a)));altered.witness.seconds=3;f.store.set(preparedPath(a),altered);
    await expect(recordReserveAckInTransaction(f.tx,f.root,a,response(a))).rejects.toMatchObject(conflict);
    expect(f.store.has(ackPath(a))).toBe(false);expect(f.store.get(preparedPath(a))).toEqual(altered);
  });

  it('rejects another witness or version for the same attempt without overwriting it',async()=>{
    const f=fakeTransaction(),a=makeAttempt();await prepareReserveAttemptInTransaction(f.tx,f.root,a);
    const original=structuredClone(f.store.get(preparedPath(a))), changed:any=structuredClone(a);
    changed.witness.identityKey='c'.repeat(64);
    await expect(prepareReserveAttemptInTransaction(f.tx,f.root,changed)).rejects.toMatchObject(conflict);
    changed.witness.identityKey=a.witness.identityKey;changed.versions.identity.updateTime='2:000000000';
    await expect(prepareReserveAttemptInTransaction(f.tx,f.root,changed)).rejects.toMatchObject(conflict);
    expect(f.store.get(preparedPath(a))).toEqual(original);expect(f.tx.create).toHaveBeenCalledTimes(1);
  });

  it('keeps two attempts with different histories for the same remote reservation',async()=>{
    const f=fakeTransaction(),first=makeAttempt(),second:any=structuredClone(first);
    second.attemptId=randomUUID();second.versions.identity.updateTime='2:000000000';
    await prepareReserveAttemptInTransaction(f.tx,f.root,first);await prepareReserveAttemptInTransaction(f.tx,f.root,second);
    await recordReserveAckInTransaction(f.tx,f.root,second,response(second));
    await recordReserveAckInTransaction(f.tx,f.root,first,response(first));
    expect(first.witness.reservationId).toBe(second.witness.reservationId);expect(first.attemptId).not.toBe(second.attemptId);
    expect(f.store.size).toBe(4);
    expect((f.store.get(ackPath(first)) as any).snapshot.versions.identity.updateTime).toBe('1:000000000');
    expect((f.store.get(ackPath(second)) as any).snapshot.versions.identity.updateTime).toBe('2:000000000');
  });

  it('rejects two different ACK tuples, malformed states and status-shaped extras for the same attempt',async()=>{
    const f=fakeTransaction(),a=makeAttempt();await prepareReserveAttemptInTransaction(f.tx,f.root,a);
    await recordReserveAckInTransaction(f.tx,f.root,a,response(a));const original=structuredClone(f.store.get(ackPath(a)));
    for(const bad of [
      {...response(a),seconds:3},{...response(a),reservationId:randomUUID()},
      {...response(a),state:'captured'},{...response(a),state:'released'},
      {...response(a),source:'status'},null,[],{},
    ]) await expect(recordReserveAckInTransaction(f.tx,f.root,a,bad as any)).rejects.toMatchObject(invalid);
    expect(f.store.get(ackPath(a))).toEqual(original);expect(f.tx.create).toHaveBeenCalledTimes(2);
    // A caller that removes a status marker can still supply identical fields:
    // response provenance must be guaranteed separately by the caller.
  });

  it('refuses a malformed or incompatible stored observation instead of adopting it',async()=>{
    const f=fakeTransaction(),a=makeAttempt();await prepareReserveAttemptInTransaction(f.tx,f.root,a);
    f.store.set(ackPath(a),{version:1,attemptId:a.attemptId,source:'status'});
    await expect(recordReserveAckInTransaction(f.tx,f.root,a,response(a))).rejects.toMatchObject(conflict);
    await expect(prepareReserveAttemptInTransaction(f.tx,f.root,a)).rejects.toMatchObject(conflict);
    expect(f.store.get(ackPath(a))).toEqual({version:1,attemptId:a.attemptId,source:'status'});
  });

  it('leaves no new ACK when the local evidence write fails after a response',async()=>{
    const f=fakeTransaction(),a=makeAttempt();await prepareReserveAttemptInTransaction(f.tx,f.root,a);
    const unavailable=fakeTransaction(f.store);unavailable.tx.getAll.mockRejectedValueOnce(Error('synthetic database unavailable'));
    await expect(recordReserveAckInTransaction(unavailable.tx,unavailable.root,a,response(a))).rejects.toThrow('synthetic database unavailable');
    expect(f.store.has(preparedPath(a))).toBe(true);expect(f.store.has(ackPath(a))).toBe(false);
    const writeFailure=fakeTransaction(f.store);writeFailure.tx.create.mockImplementationOnce(()=>{throw Error('synthetic local write failed');});
    await expect(recordReserveAckInTransaction(writeFailure.tx,writeFailure.root,a,response(a))).rejects.toThrow('synthetic local write failed');
    expect(f.store.has(ackPath(a))).toBe(false);
    // The caller must retain UNKNOWN; availability of Firestore is not presumed.
  });

  it('supports an identical ACK after an uncertain local commit response',async()=>{
    const f=fakeTransaction(),a=makeAttempt();await prepareReserveAttemptInTransaction(f.tx,f.root,a);
    await recordReserveAckInTransaction(f.tx,f.root,a,response(a));
    // This double models a commit followed by a lost response, not a real
    // distributed commit or Firestore failure.
    const next=fakeTransaction(f.store);
    await expect(recordReserveAckInTransaction(next.tx,next.root,a,response(a))).resolves.toEqual({state:'already_recorded',attribution:'unverified'});
    expect(next.tx.create).not.toHaveBeenCalled();expect(f.store.size).toBe(2);
  });

  it('copies input and nested versions before its first await',async()=>{
    let release!:()=>void, reached!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    const entered=new Promise<void>(resolve=>{reached=resolve;}),f=fakeTransaction(new Map(),wait,reached),a:any=makeAttempt();
    const original=structuredClone(a),pending=prepareReserveAttemptInTransaction(f.tx,f.root,a);await entered;
    a.witness.identityKey='c'.repeat(64);a.versions.identity.updateTime='2:000000000';a.attemptId=randomUUID();release();
    await expect(pending).resolves.toEqual({state:'created',observation:'unknown'});
    expect(f.store.get(preparedPath(original))).toEqual(original);expect(f.store.has(preparedPath(a))).toBe(false);
  });

  it('copies the expected attempt and ACK before awaiting local reads',async()=>{
    const store=new Map<string,unknown>(),base=fakeTransaction(store),a:any=makeAttempt();
    await prepareReserveAttemptInTransaction(base.tx,base.root,a);
    let release!:()=>void,reached!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    const entered=new Promise<void>(resolve=>{reached=resolve;}),f=fakeTransaction(store,wait,reached),ack:any=response(a),original=structuredClone(a);
    const pending=recordReserveAckInTransaction(f.tx,f.root,a,ack);await entered;
    ack.seconds=4;ack.reservationId=randomUUID();a.witness.identityKey='c'.repeat(64);a.versions.identity.updateTime='2:000000000';release();
    await expect(pending).resolves.toEqual({state:'recorded',attribution:'unverified'});
    expect((store.get(ackPath(original)) as any).identityKey).toBe(original.witness.identityKey);
    expect((store.get(ackPath(original)) as any).snapshot.versions.identity.updateTime).toBe('1:000000000');
  });

  it('rejects getters without invoking them and stores no extra private fields',async()=>{
    const f=fakeTransaction(),a:any=makeAttempt();let calls=0;
    const top:any=makeAttempt();Object.defineProperty(top,'versions',{enumerable:true,get(){calls++;throw Error('never evaluate');}});
    await expect(prepareReserveAttemptInTransaction(f.tx,f.root,top)).rejects.toMatchObject(invalid);expect(calls).toBe(0);
    Object.defineProperty(a.witness,'identityKey',{enumerable:true,get(){calls++;throw Error('never evaluate');}});
    await expect(prepareReserveAttemptInTransaction(f.tx,f.root,a)).rejects.toMatchObject(invalid);expect(calls).toBe(0);
    const b:any=makeAttempt();Object.defineProperty(b.versions.identity,'updateTime',{enumerable:true,get(){calls++;return '1:000000000';}});
    await expect(prepareReserveAttemptInTransaction(f.tx,f.root,b)).rejects.toMatchObject(invalid);expect(calls).toBe(0);
    for(const field of ['draft','uid','accessToken','apiKey']){
      const candidate:any=makeAttempt();candidate.witness[field]='synthetic-private-content';
      await expect(prepareReserveAttemptInTransaction(f.tx,f.root,candidate)).rejects.toMatchObject(invalid);
    }
    expect(f.store.size).toBe(0);expect(f.tx.getAll).not.toHaveBeenCalled();expect(f.tx.create).not.toHaveBeenCalled();
    const next=fakeTransaction(),candidate=makeAttempt();await prepareReserveAttemptInTransaction(next.tx,next.root,candidate);
    const ack:any=response(candidate);Object.defineProperty(ack,'seconds',{enumerable:true,get(){calls++;throw Error('never evaluate');}});
    const before=next.tx.getAll.mock.calls.length;
    await expect(recordReserveAckInTransaction(next.tx,next.root,candidate,ack)).rejects.toMatchObject(invalid);
    await expect(recordReserveAckInTransaction(next.tx,next.root,candidate,{...response(candidate),token:'synthetic-private-content'} as any)).rejects.toMatchObject(invalid);
    expect(calls).toBe(0);expect(next.tx.getAll).toHaveBeenCalledTimes(before);
    expect(next.store.has(ackPath(candidate))).toBe(false);expect(JSON.stringify([...next.store.values()])).not.toContain('synthetic-private-content');
  });

  it('rejects missing, extra, inconsistent or invalid document versions',async()=>{
    const f=fakeTransaction();
    const changes=[
      (a:any)=>{delete a.versions.identity;},
      (a:any)=>{a.versions.unexpected={exists:false};},
      (a:any)=>{a.versions.identity={exists:false};},
      (a:any)=>{a.versions.request={exists:true,createTime:'1:000000000',updateTime:'1:000000000'};},
      (a:any)=>{a.versions.sealWitness={exists:true,createTime:'1:000000000',updateTime:'1:000000000'};},
      (a:any)=>{a.versions.identity.updateTime='0:000000000';},
      (a:any)=>{a.versions.identity.updateTime='01:000000000';},
      (a:any)=>{a.versions.identity.updateTime='not-a-version';},
    ];
    for(const change of changes){const a:any=makeAttempt();change(a);await expect(prepareReserveAttemptInTransaction(f.tx,f.root,a)).rejects.toMatchObject(invalid);}
    expect(f.store.size).toBe(0);expect(f.tx.getAll).not.toHaveBeenCalled();
  });

  it('does not access an AI provider or Account transport',async()=>{
    const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('network disabled'));
    try{
      const f=fakeTransaction(),a=makeAttempt();await prepareReserveAttemptInTransaction(f.tx,f.root,a);
      await recordReserveAckInTransaction(f.tx,f.root,a,response(a));
      expect(network).not.toHaveBeenCalled();expect([...f.store.keys()].every(key=>key.startsWith('billingReserve'))).toBe(true);
    }finally{network.mockRestore();}
  });

  // The job transaction already holds the two snapshots, so `stageReserveAck`
  // must still validate the observed ACK tuple before writing the observation.
  it('stages only the ACK tuple of this attempt, or an identical recorded one',async()=>{
    const f=fakeTransaction(),a=makeAttempt();
    await prepareReserveAttemptInTransaction(f.tx,f.root,a);
    const prepared=f.store.get(preparedPath(a));
    const snapshot=(path:string,value:unknown)=>({exists:value!==undefined,data:()=>structuredClone(value)} as any);
    const stage=(ack:unknown)=>stageReserveAck(f.tx,f.root,a,ack as any,snapshot(preparedPath(a),prepared),snapshot(ackPath(a),f.store.get(ackPath(a))));
    for(const bad of [
      {...response(a),seconds:a.witness.seconds+1},{...response(a),reservationId:randomUUID()},
      {...response(a),state:'captured'},{...response(a),state:'released'},{...response(a),source:'status'},null,[],{},
    ])expect(()=>stage(bad)).toThrow(expect.objectContaining(invalid));
    expect(f.store.has(ackPath(a))).toBe(false);
    expect(stage(response(a))).toEqual({state:'recorded',attribution:'unverified'});
    expect((f.store.get(ackPath(a)) as any).attribution).toBe('unverified');
    f.store.set(ackPath(a),{version:1,attemptId:a.attemptId,source:'status'});
    expect(()=>stage(response(a))).toThrow(expect.objectContaining(conflict));
    expect(f.store.get(ackPath(a))).toEqual({version:1,attemptId:a.attemptId,source:'status'});
  });

  it('copies the staged attempt and ACK before reading the caller snapshots',async()=>{
    const f=fakeTransaction(),a:any=makeAttempt();
    await prepareReserveAttemptInTransaction(f.tx,f.root,a);
    const prepared=f.store.get(preparedPath(a)),ack:any=response(a),original=structuredClone(a);
    const snap=(value:unknown)=>({exists:value!==undefined,data:()=>structuredClone(value)} as any);
    // Mutating the caller's objects after the call must not change what is staged.
    const staged=stageReserveAck(f.tx,f.root,structuredClone(original),structuredClone(ack),snap(prepared),snap(undefined));
    ack.seconds=4;ack.reservationId=randomUUID();a.witness.identityKey='c'.repeat(64);a.versions.identity.updateTime='2:000000000';
    expect(staged).toEqual({state:'recorded',attribution:'unverified'});
    expect((f.store.get(ackPath(original)) as any).identityKey).toBe(original.witness.identityKey);
    expect((f.store.get(ackPath(original)) as any).snapshot.versions.identity.updateTime).toBe('1:000000000');
  });
});

describe('reviewed voice evidence for an external reserve attempt', () => {
  const key = 'synthetic-private-request-key';
  const privateText = 'esto es un ejemplo privado';
  const selectedVoice = 'narration:en:female';
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const timestamp = (updateTime = '1:000000000') => ({exists: true, createTime: '1:000000000', updateTime});
  const missing = {exists: false, createTime: null, updateTime: null};

  function voiceFixture() {
    const original = makeAttempt();
    const {accountId, inputId, identityKey} = original.witness;
    const textJobId = randomUUID(), revision = 2;
    const binding: ReviewedVoiceBinding = {
      version: 'reviewed-voice-binding-v1', identityKey, accountId, inputId, textJobId, revision,
      reviewId: digest(['review-revision-v1', accountId, inputId, textJobId, revision]),
      receiptId: 'b'.repeat(64), bindingHash: 'c'.repeat(64), payloadSha256: 'd'.repeat(64),
      voiceTextSha256: 'e'.repeat(64), inputGeneration: '1', inputSha256: 'f'.repeat(64),
      durationMs: 2000, billableSeconds: 3,
      versions: {
        principalIdentity: timestamp(), account: timestamp(), input: timestamp(), project: timestamp(),
        textJob: timestamp(), artifact: timestamp(), terminal: timestamp(), accounting: timestamp(),
        reserveMovement: timestamp(), billingOutbox: missing, review: timestamp(), receipt: timestamp(),
      },
      canonicalEvidence: {
        accountId, inputId, textJobId, revision, bindingHash: 'c'.repeat(64),
        reviewId: digest(['review-revision-v1', accountId, inputId, textJobId, revision]),
        review: {privateText}, receiptId: 'b'.repeat(64), receipt: {},
      },
    };
    const witness = {
      ...original.witness, intentId: digest([accountId, key]), operation: selectedVoice, revision, seconds: 3,
      reservationId: videoReservationId(accountId, identityKey, inputId, selectedVoice, revision, key),
    };
    return {binding, witness, attemptId: witness.reservationId, versions: original.versions};
  }

  const create = (fixture = voiceFixture()) =>
    createReviewedVoiceReserveAttempt(fixture.attemptId, fixture.witness, fixture.versions, fixture.binding, key, timestamp());

  it('persists the attempt and direct ACK without storing private text or inventing a third record', async () => {
    const f = fakeTransaction(), voice = create();
    await expect(prepareReserveAttemptInTransaction(f.tx, f.root, voice)).resolves.toEqual({state:'created', observation:'unknown'});
    expect(f.store.has(ackPath(voice))).toBe(false);
    await expect(recordReserveAckInTransaction(f.tx, f.root, voice, response(voice))).resolves.toEqual({state:'recorded', attribution:'unverified'});
    await expect(recordReserveAckInTransaction(f.tx, f.root, voice, response(voice))).resolves.toEqual({state:'already_recorded', attribution:'unverified'});
    await expect(prepareReserveAttemptInTransaction(f.tx, f.root, voice)).resolves.toEqual({state:'already_prepared', observation:'ack_recorded'});
    expect(f.store.size).toBe(2);
    expect(f.store.get(ackPath(voice))).toMatchObject({version:2, seconds:3, source:'reserve_ack', snapshot:{voice:voice.voice}});
    expect(JSON.stringify([...f.store.values()])).not.toContain(privateText);
    expect(JSON.stringify([...f.store.values()])).not.toContain(key);
  });

  it('detects a changed and restored review or receipt by version and tolerates unrelated balance updates', () => {
    const f = voiceFixture(), voice = create(f);
    const versionChanged = (field: 'review' | 'receipt') => ({
      ...f.binding, versions: {...f.binding.versions, [field]: timestamp('2:000000000')},
    });
    expect(matchesReviewedVoiceReserveSource(voice, versionChanged('review'), key, timestamp())).toBe(false);
    expect(matchesReviewedVoiceReserveSource(voice, versionChanged('receipt'), key, timestamp())).toBe(false);
    expect(matchesReviewedVoiceReserveSource(voice, {...f.binding, voiceTextSha256: '1'.repeat(64)}, key, timestamp())).toBe(false);
    expect(matchesReviewedVoiceReserveSource(voice, f.binding, key + '-other', timestamp())).toBe(false);
    expect(matchesReviewedVoiceReserveSource(voice, f.binding, key, timestamp())).toBe(true);
    const balanceChanged = {...f.binding, versions: {...f.binding.versions, account: timestamp('2:000000000')}};
    expect(matchesReviewedVoiceReserveSource(voice, balanceChanged, key, timestamp())).toBe(true);
    const accountRecreated = {...f.binding, versions: {...f.binding.versions, account: {exists:true, createTime:'2:000000000', updateTime:'2:000000000'}}};
    expect(matchesReviewedVoiceReserveSource(voice, accountRecreated, key, timestamp())).toBe(false);
  });

  it('binds the intended account, input, identity, revision, seconds and reservation ID before preparing a write', () => {
    const f = voiceFixture();
    for (const changed of [
      {accountId: randomUUID()}, {inputId: randomUUID()}, {identityKey: '1'.repeat(64)}, {intentId: '2'.repeat(64)},
      {revision: 3}, {seconds: 2}, {reservationId: randomUUID()}, {operation:'translation:en'},
    ]) {
      expect(() => create({...f, witness: {...f.witness, ...changed}})).toThrow(expect.objectContaining(invalid));
    }
    const mismatched = {...f.versions, identity: timestamp('2:000000000')};
    expect(() => create({...f, versions:mismatched})).toThrow(expect.objectContaining(invalid));
    expect(() => create({...f, attemptId:randomUUID()})).toThrow(expect.objectContaining(invalid));
  });

  it('rejects incomplete external source histories and detects a rewritten external origin', () => {
    const f = voiceFixture();
    const external = {
      payerIdentity:timestamp(), intent:timestamp(), origin:timestamp(), request:timestamp(), jobMarker:timestamp(), intentGuard:timestamp(),
    };
    const versions = {...f.binding.versions, reserveMovement:missing, billingOutbox:timestamp(), external};
    const binding = {...f.binding, versions};
    const voice = create({...f, binding});
    expect(matchesReviewedVoiceReserveSource(voice, binding, key, timestamp())).toBe(true);
    expect(matchesReviewedVoiceReserveSource(voice, {...binding, versions:{...versions, external:{...external, origin:timestamp('2:000000000')}}}, key, timestamp())).toBe(false);
    expect(() => create({...f, binding:{...binding, versions:{...versions, external:{...external, origin:missing}}}})).toThrow(expect.objectContaining(invalid));
    expect(() => create({...f, binding:{...binding, versions:{...versions, reserveMovement:timestamp()}}})).toThrow(expect.objectContaining(invalid));
  });

  it('does not acknowledge an unprepared, mismatched or status-shaped result', async () => {
    const f = fakeTransaction(), voice = create();
    await expect(recordReserveAckInTransaction(f.tx, f.root, voice, response(voice))).rejects.toMatchObject(conflict);
    await prepareReserveAttemptInTransaction(f.tx, f.root, voice);
    for (const candidate of [
      {...response(voice), source:'status'}, {...response(voice), seconds:2}, {...response(voice), reservationId:randomUUID()},
    ]) {
      await expect(recordReserveAckInTransaction(f.tx, f.root, voice, candidate)).rejects.toMatchObject(invalid);
    }
    const otherSource = {...voice, voice:{...voice.voice, sourceVersionsSha256:'0'.repeat(64)}};
    await expect(recordReserveAckInTransaction(f.tx, f.root, otherSource, response(voice))).rejects.toMatchObject(conflict);
    expect(f.store.has(ackPath(voice))).toBe(false);
    await expect(prepareReserveAttemptInTransaction(f.tx, f.root, voice)).resolves.toEqual({state:'already_prepared', observation:'unknown'});
  });

  it('preserves an identical ACK when its response was lost and rejects a rewritten observation', async () => {
    const f = fakeTransaction(), voice = create();
    await prepareReserveAttemptInTransaction(f.tx, f.root, voice);
    await recordReserveAckInTransaction(f.tx, f.root, voice, response(voice));
    const next = fakeTransaction(f.store);
    await expect(recordReserveAckInTransaction(next.tx, next.root, voice, response(voice))).resolves.toEqual({state:'already_recorded', attribution:'unverified'});
    expect(next.tx.create).not.toHaveBeenCalled();
    const ack = f.store.get(ackPath(voice)) as {snapshot:{voice:Record<string,string>}};
    f.store.set(ackPath(voice), {...ack, snapshot:{...ack.snapshot, voice:{...ack.snapshot.voice, markerFingerprint:'0'.repeat(64)}}});
    await expect(prepareReserveAttemptInTransaction(f.tx, f.root, voice)).rejects.toMatchObject(conflict);
  });

  it('supports staging the ACK alongside caller writes and rejects malformed v2 precursors', async () => {
    const f = fakeTransaction(), voice = create();
    const malformed = {...voice, voice:{...voice.voice, privateText}};
    await expect(prepareReserveAttemptInTransaction(f.tx, f.root, malformed)).rejects.toMatchObject(invalid);
    expect(f.tx.getAll).not.toHaveBeenCalled();
    await prepareReserveAttemptInTransaction(f.tx, f.root, voice);
    const snap = (value: unknown) => ({exists:value !== undefined, data:() => structuredClone(value)} as any);
    const prepared = snap(f.store.get(preparedPath(voice)));
    const badAck = {...response(voice), seconds:2};
    expect(() => stageReserveAck(f.tx, f.root, voice, badAck, prepared, snap(undefined))).toThrow(expect.objectContaining(invalid));
    expect(f.store.has(ackPath(voice))).toBe(false);
    expect(stageReserveAck(f.tx, f.root, voice, response(voice), prepared, snap(undefined))).toEqual({state:'recorded', attribution:'unverified'});
    const ack = snap(f.store.get(ackPath(voice)));
    expect(stageReserveAck(f.tx, f.root, voice, response(voice), prepared, ack)).toEqual({state:'already_recorded', attribution:'unverified'});
    expect(f.tx.create).toHaveBeenCalledTimes(2);
  });

  it('verifies both durable rows before a replay can return existing work', async () => {
    const f = fakeTransaction(), fixture = voiceFixture();
    const voice = create(fixture);
    const check = (binding = fixture.binding, selected = selectedVoice, marker = timestamp()) =>
      verifyReviewedVoiceReserveReplay(f.store.get(preparedPath(voice)), f.store.get(ackPath(voice)), binding, key, selected, marker);
    await prepareReserveAttemptInTransaction(f.tx, f.root, voice);
    expect(check()).toBe(false);
    await recordReserveAckInTransaction(f.tx, f.root, voice, response(voice));
    expect(check()).toBe(true);
    expect(check(fixture.binding,selectedVoice,timestamp('2:000000000'))).toBe(false);
    expect(check(fixture.binding,selectedVoice,{...timestamp('2:000000000'),createTime:'2:000000000'})).toBe(false);
    expect(check(fixture.binding,'narration:en:male')).toBe(false);
    expect(check({...fixture.binding, versions:{...fixture.binding.versions, receipt:timestamp('2:000000000')}})).toBe(false);
    expect(check({...fixture.binding, identityKey:'1'.repeat(64)})).toBe(false);
    const {markerVersion:_,...oldVoice}=voice.voice;
    f.store.set(preparedPath(voice),{...voice,voice:oldVoice});
    expect(check()).toBe(false);
  });
});
