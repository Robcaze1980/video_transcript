import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AccountFault, AccountStore } from './backend';

// Synthetic optimistic transaction/retry model. It identifies mixed reads but
// does not prove Firestore's deployed concurrency or cross-database ordering.
type Row = Record<string, unknown>;
type Ref = { path: string; get: () => Promise<Snapshot> };
type Snapshot = { exists: boolean; get: (name: string) => unknown; data: () => Row | undefined };
const uid='synthetic-video-reservation-owner',accountA='10000000-0000-4000-8000-000000000001';
const accountB='10000000-0000-4000-8000-000000000002',reservationId='20000000-0000-4000-8000-000000000001';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fixture(){
 const identityKey=AccountStore.identityKey(uid),identityPath=`identities/${identityKey}`;
 const reservationPath=(accountId:string)=>`videoReservations/${digest([accountId,reservationId])}`;
 const rows=new Map<string,Row>([[identityPath,{uid,accountId:accountA}],
  [reservationPath(accountA),{ownerAccountId:accountA,identityKey,reservationId,seconds:3,state:'reserved'}]]);
 const versions=new Map<string,number>(Array.from(rows.keys(),key=>[key,1]));
 let identityHook:(()=>void)|undefined,transactions=0,attempts=0;
 const write=(path:string,value?:Row)=>{if(value)rows.set(path,structuredClone(value));else rows.delete(path);versions.set(path,(versions.get(path)??0)+1);};
 const capture=(path:string)=>{const value=rows.get(path),copy=value?structuredClone(value):undefined;
  const snapshot:Snapshot={exists:copy!==undefined,get:name=>copy?.[name],data:()=>copy};return {snapshot,version:versions.get(path)??0};};
 const root={collection:(collection:string)=>({doc:(id:string):Ref=>{const path=`${collection}/${id}`;return {path,get:async()=>{
  const value=capture(path);if(path===identityPath&&identityHook){const hook=identityHook;identityHook=undefined;hook();}return value.snapshot;
 }};}})};
 const db={runTransaction:async(fn:(tx:{get:(ref:Ref)=>Promise<Snapshot>})=>Promise<unknown>)=>{
  transactions++;for(let retry=0;retry<3;retry++){
   attempts++;const reads=new Map<string,number>(),tx={get:async(ref:Ref)=>{const value=capture(ref.path);reads.set(ref.path,value.version);
    if(ref.path===identityPath&&identityHook){const hook=identityHook;identityHook=undefined;hook();}return value.snapshot;}};
   const result=await fn(tx);if([...reads].every(([path,version])=>(versions.get(path)??0)===version))return result;
  }throw Error('synthetic transaction retry limit');
 }};
 return {store:new AccountStore(db as never,root as never),identityKey,identityPath,reservationPath,write,rows,
  transactions:()=>transactions,attempts:()=>attempts,onIdentityRead:(hook:()=>void)=>{identityHook=hook;}};
}

describe('Account video reservation identity and record consistency',()=>{
 it('reads an authorized reservation coherently without moving funds',async()=>{
  const f=fixture();expect(await f.store.videoReservation(f.identityKey,reservationId)).toEqual({reservationId,seconds:3,state:'reserved'});
  expect(f.transactions()).toBe(1);
 });
 for(const mutation of ['removed','other-account','changed-uid'] as const)it(`does not return the old reservation after identity is ${mutation}`,async()=>{
  const f=fixture();f.onIdentityRead(()=>{
   if(mutation==='removed')f.write(f.identityPath);
   else if(mutation==='other-account')f.write(f.identityPath,{uid,accountId:accountB});
   else f.write(f.identityPath,{uid:'synthetic-other',accountId:accountA});
  });
  await expect(f.store.videoReservation(f.identityKey,reservationId)).rejects.toBeInstanceOf(AccountFault);
  expect(f.attempts()).toBeGreaterThanOrEqual(2);
 });
 it('never returns the earlier reservation after a coherent reassignment',async()=>{
  const f=fixture();f.write(f.reservationPath(accountB),{ownerAccountId:accountB,identityKey:f.identityKey,reservationId,seconds:7,state:'captured'});
  f.onIdentityRead(()=>f.write(f.identityPath,{uid,accountId:accountB}));
  expect(await f.store.videoReservation(f.identityKey,reservationId)).toEqual({reservationId,seconds:7,state:'captured'});
  expect(f.attempts()).toBeGreaterThanOrEqual(2);
 });
 it('rejects an identity or reservation already absent and never provisions a replacement',async()=>{
  const f=fixture();f.write(f.identityPath);await expect(f.store.videoReservation(f.identityKey,reservationId)).rejects.toMatchObject({code:'account_not_provisioned'});
  expect(f.rows.has(f.identityPath)).toBe(false);f.write(f.identityPath,{uid,accountId:accountA});f.write(f.reservationPath(accountA));
  await expect(f.store.videoReservation(f.identityKey,reservationId)).rejects.toMatchObject({code:'not_found'});
 });
 it('rejects malformed, foreign or inconsistent reservation evidence',async()=>{
  const f=fixture(),path=f.reservationPath(accountA),base={ownerAccountId:accountA,identityKey:f.identityKey,reservationId,seconds:3,state:'reserved'};
  for(const change of [{ownerAccountId:accountB},{identityKey:'b'.repeat(64)},{reservationId:'30000000-0000-4000-8000-000000000003'},
   {seconds:0},{seconds:1.5},{state:'other'}]){
   f.write(path,{...base,...change});await expect(f.store.videoReservation(f.identityKey,reservationId)).rejects.toMatchObject({code:'invariant'});
  }
  await expect(f.store.videoReservation(f.identityKey,'invalid')).rejects.toMatchObject({code:'invalid'});
 });
});
