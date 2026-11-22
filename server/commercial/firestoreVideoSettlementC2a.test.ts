// LV-019.B C2a (Video, etapa 2) pure unit checks that need no emulator: `copyExternalBillingSettlementReadSnapshot` is the exported shape gate for the
// pre-POST/post-POST re-read of the settlement documents, so it must accept the protocol-3 outbox tuple (docs/specs/LV-019-B-liquidacion-parcial-y-
// liberacion-posadmision.md, section 4.3) and keep rejecting a new field that arrives without `settlementProtocol: 3`.
import {describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {copyExternalBillingSettlementReadSnapshot,copyOutboxSnapshot,matchesOutboxSnapshot} from './firestoreBackend';

// The 14 documents of the settlement contract. `guard` and `simulatedReserve` must be absent; the rest must exist with a real version tuple.
const names=['account','outbox','job','terminal','artifact','classification','simulatedReserve','identity','request','intent','guard','intentGuard','origin','jobMarker'];
const absent=new Set(['simulatedReserve','guard']);
const version=name=>absent.has(name)?{exists:false}:{exists:true,createTime:'123:000000001',updateTime:'124:000000002'};
const versions=()=>Object.fromEntries(names.map(name=>[name,version(name)]));
function snapshot(expected,rest={}){
  return {expected,intentId:'b'.repeat(64),versions:versions(),...rest};
}
const base={jobId:randomUUID(),accountId:randomUUID(),provider:'account_seconds' as const,identityKey:'a'.repeat(64),reservationId:randomUUID(),seconds:2};
const evidenceSha256='d'.repeat(64);

describe('C2a settlement outbox protocol',()=>{
  it('accepts a legacy protocol-1 row and carries its fields through unchanged',()=>{
    const copy=copyExternalBillingSettlementReadSnapshot(snapshot({...base,action:'capture',attemptId:randomUUID()}));
    expect(copy).not.toBeNull();
    expect(copy?.expected.action).toBe('capture');
    expect(Object.prototype.hasOwnProperty.call(copy?.expected,'settlementProtocol')).toBe(false);
  });

  it('accepts a protocol-3 release after an admission (settlementProtocol, resolution and attemptId)',()=>{
    const attemptId=randomUUID();
    const copy=copyExternalBillingSettlementReadSnapshot(snapshot({...base,action:'release',settlementProtocol:3,resolutionKind:'no_speech',evidenceSha256,attemptId}));
    expect(copy).not.toBeNull();
    expect(copy?.expected).toMatchObject({action:'release',settlementProtocol:3,resolutionKind:'no_speech',evidenceSha256,attemptId});
  });

  it('accepts a protocol-3 partial capture (settlementProtocol and capturedSeconds)',()=>{
    const copy=copyExternalBillingSettlementReadSnapshot(snapshot({...base,action:'capture',attemptId:randomUUID(),settlementProtocol:3,capturedSeconds:1}));
    expect(copy).not.toBeNull();
    expect(copy?.expected).toMatchObject({action:'capture',settlementProtocol:3,capturedSeconds:1});
  });

  it('rejects a new field that arrives without settlementProtocol 3',()=>{
    expect(copyExternalBillingSettlementReadSnapshot(snapshot({...base,action:'release',resolutionKind:'no_speech',evidenceSha256}))).toBeNull();
    expect(copyExternalBillingSettlementReadSnapshot(snapshot({...base,action:'capture',attemptId:randomUUID(),capturedSeconds:1}))).toBeNull();
  });
});
// `copyOutboxSnapshot` is the strict shape gate used before a POST and when persisting an ACK: an unknown field is never carried, and a new protocol-3 field
// without `settlementProtocol: 3` is refused - the same v1/v3 rule the emulator exercises end to end (S5).
describe('C2a outbox snapshot shape gate',()=>{
  it('keeps a legacy protocol-1 capture unchanged and refuses an unknown key',()=>{
    const attemptId=randomUUID();
    expect(copyOutboxSnapshot({...base,action:'capture',attemptId})).toMatchObject({action:'capture',attemptId});
    expect(copyOutboxSnapshot({...base,action:'capture',attemptId,unexpected:'x'})).toBeNull();
  });

  it('accepts a protocol-3 release claim and refuses a new field without settlementProtocol 3',()=>{
    const attemptId=randomUUID();
    expect(copyOutboxSnapshot({...base,action:'release',settlementProtocol:3,resolutionKind:'not_delivered',evidenceSha256,attemptId}))
      .toMatchObject({action:'release',settlementProtocol:3,resolutionKind:'not_delivered',evidenceSha256,attemptId});
    expect(copyOutboxSnapshot({...base,action:'release',resolutionKind:'not_delivered',evidenceSha256,attemptId})).toBeNull();
    expect(copyOutboxSnapshot({...base,action:'release',attemptId})).toBeNull();
  });
});
// The new protocol-3 fields are bound to their action: a resolution only describes a release, and `capturedSeconds` only a partial capture. A capture that
// carries a resolution would make `AccountBillingClient.settle` throw `invalid` on every drain, so the row could never leave `retry_wait`.
describe('C2a protocol fields are bound to the action',()=>{
  it('refuses a capture with a resolution and a release with capturedSeconds',()=>{
    const attemptId=randomUUID();
    expect(copyOutboxSnapshot({...base,action:'capture',attemptId,settlementProtocol:3,resolutionKind:'no_speech',evidenceSha256})).toBeNull();
    expect(copyOutboxSnapshot({...base,action:'release',settlementProtocol:3,capturedSeconds:1})).toBeNull();
    expect(copyOutboxSnapshot({...base,action:'capture',attemptId,settlementProtocol:3,capturedSeconds:1})).not.toBeNull();
    expect(copyOutboxSnapshot({...base,action:'release',settlementProtocol:3,resolutionKind:'no_speech',evidenceSha256,attemptId})).not.toBeNull();
  });
});
// GLM hardening 1: a v1 tuple must only match a row with NO protocol-3 field at all, and a v3 tuple only a row that has them exactly. A v1 row silently
// rewritten to v3 (or the reverse) would otherwise be settled on a core-only match.
describe('C2a matchesOutboxSnapshot is exact in both directions',()=>{
  const attemptId=randomUUID();
  // A capture is the pair whose core is identical in v1 and v3 (both carry `attemptId`), so any v1/v3 confusion is decided by the new fields alone.
  const v1={...base,action:'capture' as const,attemptId};
  const v3={...v1,settlementProtocol:3 as const,capturedSeconds:1};
  it('does not let a v1 tuple match a row that gained protocol-3 fields',()=>{
    expect(matchesOutboxSnapshot(v3,v1)).toBe(false);
  });
  it('does not let a v3 tuple match a legacy row without the fields',()=>{
    expect(matchesOutboxSnapshot(v1,v3)).toBe(false);
  });
  it('still matches each tuple against its own shape and rejects a different core',()=>{
    expect(matchesOutboxSnapshot(v1,v1)).toBe(true);
    expect(matchesOutboxSnapshot(v3,v3)).toBe(true);
    expect(matchesOutboxSnapshot({...v1,seconds:base.seconds+1},v1)).toBe(false);
    expect(matchesOutboxSnapshot({...v3,capturedSeconds:undefined},v3)).toBe(false);
  });
});
// LV-019.B step 1.5 (legacy and future shapes): a stored row written by a LATER protocol (or one that carries a malformed `settlementProtocol`) must fail
// closed everywhere a settlement tuple is read - before a POST, when persisting an ACK and when matching a stored row - instead of being settled on a
// best-effort reading. Only an absent value (legacy v1) or exactly the number 3 is legal.
describe('C2a a future or malformed settlementProtocol fails closed (step 1.5)',()=>{
  const attemptId=randomUUID();
  const illegal:unknown[]=[4,2,1,0,-1,3.5,Number.NaN,Number.POSITIVE_INFINITY,'3','4',null,true,{},[3]];
  const shapes=[
    {...base,action:'capture' as const,attemptId},
    {...base,action:'capture' as const,attemptId,capturedSeconds:1},
    {...base,action:'release' as const,attemptId,resolutionKind:'no_speech' as const,evidenceSha256},
    {...base,action:'release' as const}
  ];
  it('refuses every illegal protocol on every tuple shape in the strict copy and in the read-snapshot gate',()=>{
    for(const protocol of illegal)for(const shape of shapes){
      const row={...shape,settlementProtocol:protocol};
      expect(copyOutboxSnapshot(row),`copy ${String(protocol)} ${shape.action}`).toBeNull();
      expect(copyExternalBillingSettlementReadSnapshot(snapshot(row)),`read ${String(protocol)} ${shape.action}`).toBeNull();
    }
  });
  it('never matches a stored row that carries a future protocol, whatever protocol the expected tuple claims',()=>{
    const stored={...base,action:'capture' as const,attemptId,settlementProtocol:4,capturedSeconds:1};
    expect(matchesOutboxSnapshot(stored,{...base,action:'capture',attemptId})).toBe(false);
    expect(matchesOutboxSnapshot(stored,{...base,action:'capture',attemptId,settlementProtocol:3,capturedSeconds:1})).toBe(false);
  });
  it('a v1 tuple never matches a stored row whose ONLY new field is settlementProtocol (a protocol-3 full capture has no capturedSeconds)',()=>{
    const v1={...base,action:'capture' as const,attemptId};
    expect(matchesOutboxSnapshot({...v1,settlementProtocol:3},v1)).toBe(false);
    expect(matchesOutboxSnapshot({...v1,settlementProtocol:4},v1)).toBe(false);
    expect(matchesOutboxSnapshot({...v1,settlementProtocol:3},{...v1,settlementProtocol:3})).toBe(true);
  });
  it('the legal shapes around the illegal ones still pass (absent = legacy v1, exactly 3 = protocol 3)',()=>{
    expect(copyOutboxSnapshot({...base,action:'capture',attemptId})).not.toBeNull();
    expect(copyOutboxSnapshot({...base,action:'capture',attemptId,settlementProtocol:3,capturedSeconds:1})).not.toBeNull();
    expect(copyOutboxSnapshot({...base,action:'capture',attemptId,settlementProtocol:undefined})).not.toBeNull();
  });
});