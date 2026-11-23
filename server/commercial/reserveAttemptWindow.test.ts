import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { RESERVE_ATTEMPT_DOCUMENTS, RESERVE_ATTEMPT_PROFILE_V1, type ReserveAttemptDocumentName, type ReserveAttemptEvidenceV1 } from './reserveAttemptEvidence';
import { RESERVE_ATTEMPT_IMMUTABLE_DOCUMENTS, reserveAttemptVersions, reserveAttemptWindowChanged } from './reserveAttemptWindow';

// A minimal snapshot double: only `exists`, `data()`, `get()` and the two
// timestamps are read by the comparison. It does not emulate Firestore.
type Snapshot = DocumentSnapshot & { setVersion:(seconds:number,nanos:number)=>Snapshot; setData:(value:Record<string,unknown>)=>Snapshot };
type Window = Record<ReserveAttemptDocumentName, Snapshot>;
function snapshot(exists:boolean,data:Record<string,unknown>={},seconds=1,nanos=0):Snapshot{
  const doc:any={exists,data:()=>exists?structuredClone(data):undefined,get:(field:string)=>exists?data[field]:undefined,
    createTime:{seconds,nanoseconds:nanos},updateTime:{seconds,nanoseconds:nanos}};
  doc.setVersion=(nextSeconds:number,nextNanos:number)=>{doc.createTime={seconds:nextSeconds,nanoseconds:nextNanos};doc.updateTime={seconds:nextSeconds,nanoseconds:nextNanos};return doc;};
  doc.setData=(value:Record<string,unknown>)=>{data=structuredClone(value);return doc;};
  return doc as Snapshot;
}
const required=['account','identity','input','project','intent','origin','intentGuard'] as const;
function windowDocuments():Window{
  const rows:Partial<Record<ReserveAttemptDocumentName,Snapshot>>={
    account:snapshot(true,{aiPilot:true,simulationOnly:true,credited:40,available:40,reserved:0,consumed:0,active:0}),
    identity:snapshot(true,{accountId:'account',uid:'uid'}),
    input:snapshot(true,{accountId:'account'}),
    project:snapshot(true,{accountId:'account'}),
    intent:snapshot(true,{state:'reserve_pending',inputId:'input',operation:'translation:en',revision:1,seconds:2}),
    origin:snapshot(true,{baseline:'before_reservation'}),
    guard:snapshot(false),
    intentGuard:snapshot(true,{protocol:1,intentId:'intent',state:'clear',createdAtMs:1}),
    request:snapshot(false),
    jobMarker:snapshot(false),
    sealWitness:snapshot(false),sealRecovery:snapshot(false),
    releaseWitness:snapshot(false),releaseRecovery:snapshot(false),
  };
  return rows as Window;
}
function attemptFor(docs:Window):ReserveAttemptEvidenceV1{
  const versions=reserveAttemptVersions(docs)!;
  const witness={intentId:'a'.repeat(64),accountId:'account',inputId:'input',operation:'translation:en' as const,revision:1,
    profile:RESERVE_ATTEMPT_PROFILE_V1,provider:'account_seconds' as const,identityKey:'b'.repeat(64),reservationId:randomUUID(),seconds:2};
  return {version:1,attemptId:randomUUID(),witness,versions};
}
function mutableAttempt(value:ReserveAttemptEvidenceV1){return structuredClone(value) as unknown as ReserveAttemptEvidenceV1;}

describe('reserve attempt window comparison (design 3.2)',()=>{
  it('records the 14 versions and accepts an unchanged window',()=>{
    const docs=windowDocuments(),attempt=attemptFor(docs);
    expect(Object.keys(attempt.versions).sort()).toEqual([...RESERVE_ATTEMPT_DOCUMENTS].sort());
    for(const name of required)expect(attempt.versions[name].exists).toBe(true);
    for(const name of ['request','jobMarker','sealWitness','sealRecovery','releaseWitness','releaseRecovery'] as const)expect(attempt.versions[name]).toEqual({exists:false});
    expect(reserveAttemptWindowChanged(attempt,docs,'account')).toBe(false);
  });

  it('rejects each immutable document whose exact version changed',()=>{
    for(const name of RESERVE_ATTEMPT_IMMUTABLE_DOCUMENTS){
      const docs=windowDocuments(),attempt=attemptFor(docs);
      docs[name]=snapshot(true,{windowProbe:name},2,0);
      expect(reserveAttemptWindowChanged(attempt,docs,'account'),name+' must invalidate the window').toBe(true);
    }
  });

  it('checks createTime and updateTime independently',()=>{
    const first=windowDocuments(),firstAttempt=attemptFor(first);
    (first.origin as any).createTime={seconds:0,nanoseconds:999_999_999};
    expect(reserveAttemptWindowChanged(firstAttempt,first,'account')).toBe(true);
    const second=windowDocuments(),secondAttempt=attemptFor(second);
    (second.origin as any).updateTime={seconds:2,nanoseconds:0};
    expect(reserveAttemptWindowChanged(secondAttempt,second,'account')).toBe(true);
  });

  it('rejects a same-content rewrite because the exact version moved',()=>{
    const docs=windowDocuments(),attempt=attemptFor(docs);
    docs.origin.setVersion(1,500_000_000);
    expect(reserveAttemptWindowChanged(attempt,docs,'account')).toBe(true);
  });

  it('rejects a required immutable document that disappeared',()=>{
    for(const name of RESERVE_ATTEMPT_IMMUTABLE_DOCUMENTS){
      if(!required.includes(name as typeof required[number]))continue;
      const docs=windowDocuments(),attempt=attemptFor(docs);
      docs[name]=snapshot(false);
      expect(reserveAttemptWindowChanged(attempt,docs,'account'),name+' disappearing must invalidate the window').toBe(true);
    }
  });

  it('rejects an optional immutable document that appeared or disappeared',()=>{
    for(const name of RESERVE_ATTEMPT_IMMUTABLE_DOCUMENTS){
      if(required.includes(name as typeof required[number]))continue;
      const present=windowDocuments(),missing=windowDocuments(),recorded=attemptFor(missing);
      present[name]=snapshot(true,{windowProbe:name});
      missing[name]=snapshot(false);
      expect(reserveAttemptWindowChanged(recorded,missing,'account'),name+' staying absent must stay clean').toBe(false);
      expect(reserveAttemptWindowChanged(recorded,present,'account'),name+' appearing must invalidate the window').toBe(true);
      const existing=mutableAttempt(recorded);(existing.versions as Record<string,unknown>)[name]={exists:true,createTime:'1:000000000',updateTime:'1:000000000'};
      expect(reserveAttemptWindowChanged(existing as ReserveAttemptEvidenceV1,missing,'account'),name+' disappearing must invalidate the window').toBe(true);
    }
  });

  it('rejects each terminal pair whose witness or recovery version moved',()=>{
    const recordedDocs=windowDocuments();
    recordedDocs.sealWitness=snapshot(true,{protocol:1});recordedDocs.sealRecovery=snapshot(true,{protocol:1});
    recordedDocs.releaseWitness=snapshot(true,{protocol:1});recordedDocs.releaseRecovery=snapshot(true,{protocol:1});
    const recorded=attemptFor(recordedDocs);
    for(const name of ['sealWitness','sealRecovery','releaseWitness','releaseRecovery'] as const){
      const changed=windowDocuments();
      changed.sealWitness=snapshot(true,{protocol:1});changed.sealRecovery=snapshot(true,{protocol:1});
      changed.releaseWitness=snapshot(true,{protocol:1});changed.releaseRecovery=snapshot(true,{protocol:1});
      changed[name]=snapshot(true,{protocol:1},2,0);
      expect(reserveAttemptWindowChanged(recorded,changed,'account'),name+' must invalidate the window').toBe(true);
    }
  });

  it('accepts an intent whose rescheduling fields changed but rejects a semantic change',()=>{
    const docs=windowDocuments(),attempt=attemptFor(docs);
    docs.intent.setData({state:'reserve_pending',inputId:'input',operation:'translation:en',revision:1,seconds:2,attempts:5,nextAttemptAt:0,lastErrorCode:'reserved_unconfirmed'});
    expect(reserveAttemptWindowChanged(attempt,docs,'account')).toBe(false);
    for(const change of [{state:'release_pending'},{inputId:'other'},{operation:'narration:en'},{revision:2},{seconds:3},{jobId:randomUUID()}]){
      const changed=windowDocuments(),expectation=attemptFor(changed);
      changed.intent.setData({state:'reserve_pending',inputId:'input',operation:'translation:en',revision:1,seconds:2,...change});
      expect(reserveAttemptWindowChanged(expectation,changed,'account'),`intent ${JSON.stringify(change)} must invalidate`).toBe(true);
    }
  });

  it('accepts an account balance change but rejects losing either pilot flag',()=>{
    const docs=windowDocuments(),attempt=attemptFor(docs);
    docs.account.setData({aiPilot:true,simulationOnly:true,credited:39,available:39,reserved:0,consumed:0,active:0});
    expect(reserveAttemptWindowChanged(attempt,docs,'account')).toBe(false);
    for(const flags of [{aiPilot:false,simulationOnly:true},{aiPilot:true,simulationOnly:false},{aiPilot:false,simulationOnly:false}]){
      const changed=windowDocuments(),expectation=attemptFor(changed);
      changed.account.setData(flags);
      expect(reserveAttemptWindowChanged(expectation,changed,'account'),JSON.stringify(flags)+' must invalidate').toBe(true);
    }
    const foreign=windowDocuments(),attempt3=attemptFor(foreign);
    foreign.account=snapshot(false);
    expect(reserveAttemptWindowChanged(attempt3,foreign,'account')).toBe(true);
  });

  it('rejects an intent that disappeared entirely',()=>{
    const docs=windowDocuments(),attempt=attemptFor(docs);
    docs.intent=snapshot(false);
    expect(reserveAttemptWindowChanged(attempt,docs,'account')).toBe(true);
  });


  it('accepts an absent or clear guard but rejects one blocking this account',()=>{
    const clear=windowDocuments(),attempt=attemptFor(clear);
    clear.guard=snapshot(true,{accountId:'account',blocked:false});
    expect(reserveAttemptWindowChanged(attempt,clear,'account')).toBe(false);
    for(const guard of [{accountId:'account',blocked:true},{accountId:'foreign',blocked:false}]){
      const docs=windowDocuments(),expectation=attemptFor(docs);
      docs.guard=snapshot(true,guard);
      expect(reserveAttemptWindowChanged(expectation,docs,'account'),`guard ${JSON.stringify(guard)} must invalidate`).toBe(true);
    }
  });

  it('refuses a half terminal pair while building the attempt',()=>{
    const docs=windowDocuments();
    docs.sealWitness=snapshot(true,{historyProtocol:1});
    expect(reserveAttemptVersions(docs)).toBeNull();
    const complete=windowDocuments();
    complete.releaseWitness=snapshot(true,{historyProtocol:1});complete.releaseRecovery=snapshot(true,{historyProtocol:1});
    expect(reserveAttemptVersions(complete)!.releaseWitness).toEqual({exists:true,createTime:'1:000000000',updateTime:'1:000000000'});
  });
});
