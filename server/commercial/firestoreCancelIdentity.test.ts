import {describe,expect,it,vi} from 'vitest';
import {FirestoreBackend} from './firestoreBackend';
import {accountIdentityKey} from './accountBillingClient';

const account='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const job='20000000-0000-4000-8000-000000000001',uid='synthetic-owner';

function fixture(identity:{exists:boolean;uid?:string;accountId?:string},jobOwner=account){
 const document=(exists:boolean,data:Record<string,unknown>={})=>({exists,get:(field:string)=>data[field],data:()=>data});
 const refs:Array<{collection:string;id:string}>=[];
 const root={collection:(collection:string)=>({doc:(id:string)=>({collection,id})})};
 const tx={
  get:vi.fn(async(ref:{collection:string;id:string})=>{refs.push(ref);
   if(ref.collection==='identities')return document(identity.exists,identity);
   if(ref.collection==='jobs')return document(true,{accountId:jobOwner,state:'queued'});
   throw Error('Unexpected synthetic read');
  }),
  set:vi.fn(),create:vi.fn(),update:vi.fn(),delete:vi.fn(),
 };
 const db={runTransaction:async(fn:(transaction:typeof tx)=>Promise<unknown>)=>fn(tx)};
 const backend=new FirestoreBackend(db as never,root as never);
 return {backend,tx,refs};
}

describe('customer job reads and cancellations revalidate the verified UID',()=>{
 for(const bad of [undefined,'',42,'u'.repeat(129)])it(`rejects an invalid UID before reading or changing anything: ${String(bad).slice(0,12)}`,async()=>{
  const c=fixture({exists:true,uid,accountId:account});
  await expect(c.backend.jobForUid(account,job,bad as string)).rejects.toMatchObject({code:'not_found'});
  await expect(c.backend.cancelForUid(account,job,bad as string)).rejects.toMatchObject({code:'not_found'});
  expect(c.tx.get).not.toHaveBeenCalled();expect(c.tx.update).not.toHaveBeenCalled();expect(c.tx.create).not.toHaveBeenCalled();
 });
 for(const [label,identity] of [
  ['missing',{exists:false}],
  ['reassigned',{exists:true,uid,accountId:other}],
  ['changed uid',{exists:true,uid:'synthetic-other',accountId:account}],
 ] as const)it(`rejects ${label} before reading a job or mutating money`,async()=>{
  const c=fixture(identity);
  await expect(c.backend.jobForUid(account,job,uid)).rejects.toMatchObject({code:'not_found'});
  await expect(c.backend.cancelForUid(account,job,uid)).rejects.toMatchObject({code:'not_found'});
  expect(c.refs).toEqual([{collection:'identities',id:accountIdentityKey(uid)},{collection:'identities',id:accountIdentityKey(uid)}]);
  expect(c.tx.update).not.toHaveBeenCalled();expect(c.tx.create).not.toHaveBeenCalled();
 });
 it('reads the requested job only after the same transaction confirms the identity',async()=>{
  const c=fixture({exists:true,uid,accountId:account});
  await expect(c.backend.jobForUid(account,job,uid)).resolves.toMatchObject({state:'queued'});
  expect(c.refs).toEqual([{collection:'identities',id:accountIdentityKey(uid)},{collection:'jobs',id:job}]);
 });
 it('does not disclose a job belonging to another account',async()=>{
  const c=fixture({exists:true,uid,accountId:account},other);
  await expect(c.backend.jobForUid(account,job,uid)).rejects.toMatchObject({code:'not_found'});
 });
});
