import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FirestoreBackend } from './firestoreBackend';
import { accountIdentityKey } from './accountBillingClient';
import { AI_CATALOG_VERSION } from './aiContracts';

// Sequential read/write doubles test the admission contract only. They do not
// prove Firestore serializability or a remotely authenticated requester.
function fixture(identity:Record<string,unknown>|null={uid:'synthetic-requester',accountId:'10000000-0000-4000-8000-000000000001'}){
 const uid='synthetic-requester',account='10000000-0000-4000-8000-000000000001',input=randomUUID(),key=randomUUID();
 const billing={provider:'account_seconds' as const,identityKey:accountIdentityKey(uid),reservationId:randomUUID(),seconds:2};
 const root:any={collection:(collection:string)=>({doc:(id:string)=>({collection,id})})};
 const tx:any={
  get:vi.fn(async()=>({exists:!!identity,get:(field:string)=>identity?.[field]})),
  getAll:vi.fn(async()=>{throw Error('synthetic transaction stopped after UID read');}),
  create:vi.fn(),set:vi.fn(),update:vi.fn(),delete:vi.fn(),
 };
 const db:any={runTransaction:vi.fn(async(fn:(transaction:any)=>Promise<unknown>)=>fn(tx))};
 const backend=new FirestoreBackend(db,root);
 const invoke=(requester?:string)=>backend.reserve(account,input,key,2,'translation:en',1,AI_CATALOG_VERSION,billing,undefined,requester);
 return {uid,account,billing,backend,db,tx,invoke};
}
function noWrites(f:ReturnType<typeof fixture>){expect(f.tx.create).not.toHaveBeenCalled();expect(f.tx.set).not.toHaveBeenCalled();expect(f.tx.update).not.toHaveBeenCalled();expect(f.tx.delete).not.toHaveBeenCalled();}

describe('requester identity for external reservation admission',()=>{
 it('refuses an external reservation without a requester before any database access',async()=>{
  const f=fixture();await expect(f.invoke()).rejects.toMatchObject({code:'not_found'});
  expect(f.db.runTransaction).not.toHaveBeenCalled();noWrites(f);
 });
 it('refuses a requester whose UID does not match the financial identity tuple',async()=>{
  const f=fixture();await expect(f.invoke('different-synthetic-requester')).rejects.toMatchObject({code:'not_found'});
  expect(f.db.runTransaction).not.toHaveBeenCalled();noWrites(f);
 });
 for(const [label,identity] of [
  ['removed',null],
  ['reassigned',{uid:'synthetic-requester',accountId:'10000000-0000-4000-8000-000000000002'}],
  ['changed UID',{uid:'other-synthetic-requester',accountId:'10000000-0000-4000-8000-000000000001'}],
 ] as const)it(`refuses ${label} identity inside the reservation transaction`,async()=>{
  const f=fixture(identity);await expect(f.invoke(f.uid)).rejects.toMatchObject({code:'not_found'});
  expect(f.db.runTransaction).toHaveBeenCalledOnce();expect(f.tx.get).toHaveBeenCalledOnce();expect(f.tx.getAll).not.toHaveBeenCalled();noWrites(f);
 });
 it('reaches the remaining checks only after validating a matching requester inside the transaction',async()=>{
  const f=fixture();await expect(f.invoke(f.uid)).rejects.toThrow('synthetic transaction stopped after UID read');
  expect(f.db.runTransaction).toHaveBeenCalledOnce();expect(f.tx.get).toHaveBeenCalledWith({collection:'identities',id:f.billing.identityKey});
  expect(f.tx.getAll).toHaveBeenCalledOnce();noWrites(f);
 });
});
