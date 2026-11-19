import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { copyExternalBillingSettlementReadSnapshot } from './firestoreBackend';

const names=['account','outbox','job','terminal','artifact','classification','simulatedReserve','identity','request','intent','guard','intentGuard','origin','jobMarker'];
function example(){
 const versions=Object.fromEntries(names.map(name=>[name,name==='simulatedReserve'||name==='guard'?{exists:false}:{exists:true,createTime:'123:000000001',updateTime:'124:000000002'}]));
 return {expected:{jobId:randomUUID(),accountId:randomUUID(),provider:'account_seconds',identityKey:'a'.repeat(64),reservationId:randomUUID(),seconds:2,action:'capture',attemptId:randomUUID()},intentId:'b'.repeat(64),versions};
}
describe('internal settlement snapshot copying',()=>{
 it('copies all allowed values without retaining caller references',()=>{
  const source=example(),copy=copyExternalBillingSettlementReadSnapshot(source);expect(copy).not.toBeNull();
  source.expected.reservationId=randomUUID();source.versions.identity={exists:false};expect(copy?.expected.reservationId).not.toBe(source.expected.reservationId);expect(copy?.versions.identity.exists).toBe(true);
 });
 it('reads each allowed getter once, so validation and returned copy agree',()=>{
  const source=example(),original=source.expected.reservationId;let reads=0;
  Object.defineProperty(source.expected,'reservationId',{enumerable:true,get(){reads++;return reads===1?original:randomUUID();}});
  const copy=copyExternalBillingSettlementReadSnapshot(source);expect(reads).toBe(1);expect(copy?.expected.reservationId).toBe(original);
 });
 it('rejects a throwing getter and missing, future or malformed fields',()=>{
  const throwing=example();Object.defineProperty(throwing.versions,'identity',{enumerable:true,get(){throw Error('synthetic');}});
  expect(copyExternalBillingSettlementReadSnapshot(throwing)).toBeNull();
  const extra=example();(extra.expected as Record<string,unknown>).unexpected='bad';expect(copyExternalBillingSettlementReadSnapshot(extra)).toBeNull();
  const missing=example();delete (missing.versions as Record<string,unknown>).guard;expect(copyExternalBillingSettlementReadSnapshot(missing)).toBeNull();
  const corrupt=example();corrupt.versions.identity={exists:true,createTime:'bad',updateTime:'1:000000000'};expect(copyExternalBillingSettlementReadSnapshot(corrupt)).toBeNull();
  const badId=example();badId.intentId='other';expect(copyExternalBillingSettlementReadSnapshot(badId)).toBeNull();
  const conflicting=example();conflicting.versions.simulatedReserve={exists:true,createTime:'1:000000000',updateTime:'1:000000000'};expect(copyExternalBillingSettlementReadSnapshot(conflicting)).toBeNull();
 });
 it('requires the action-specific tuple and all required documents',()=>{
  const absent=example();absent.versions.intentGuard={exists:false};expect(copyExternalBillingSettlementReadSnapshot(absent)).toBeNull();
  const release=example();release.expected.action='release';expect(copyExternalBillingSettlementReadSnapshot(release)).toBeNull();
  delete (release.expected as Record<string,unknown>).attemptId;expect(copyExternalBillingSettlementReadSnapshot(release)).not.toBeNull();
 });
});
