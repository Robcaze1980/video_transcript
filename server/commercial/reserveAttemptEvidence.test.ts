import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  RESERVE_ATTEMPT_DOCUMENTS, RESERVE_ATTEMPT_PROFILE_V1, prepareReserveAttemptInTransaction, recordReserveAckInTransaction, stageReserveAck,
  type ReserveAttemptEvidence,
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
function makeAttempt():ReserveAttemptEvidence {
  const required = new Set(['account','identity','input','project','intent','origin','intentGuard']);
  const versions = Object.fromEntries(RESERVE_ATTEMPT_DOCUMENTS.map(name=>[name,required.has(name)
    ? {exists:true,createTime:'1:000000000',updateTime:'1:000000000'} : {exists:false}]));
  return {version:1,attemptId:randomUUID(),witness:{
    intentId:'a'.repeat(64),accountId:randomUUID(),inputId:randomUUID(),operation:'translation:en',revision:1,
    profile:RESERVE_ATTEMPT_PROFILE_V1,provider:'account_seconds',identityKey:'b'.repeat(64),reservationId:randomUUID(),seconds:2,
  },versions} as ReserveAttemptEvidence;
}
const response=(a:ReserveAttemptEvidence)=>({reservationId:a.witness.reservationId,seconds:a.witness.seconds,state:'reserved' as const});
const preparedPath=(a:ReserveAttemptEvidence)=>`billingReserveAttempts/${a.attemptId}`;
const ackPath=(a:ReserveAttemptEvidence)=>`billingReserveAckObservations/${a.attemptId}`;
const invalid = {code:'invalid'}, conflict = {code:'conflict'};

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
