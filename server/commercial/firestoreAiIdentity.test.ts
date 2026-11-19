import {describe,expect,it,vi} from 'vitest';
import {FirestoreAi} from './firestoreAi';
import {accountIdentityKey} from './accountBillingClient';

const account='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const job='20000000-0000-4000-8000-000000000001',uid='synthetic-verified-owner';
function fixture(identity:{exists:boolean;uid?:string;accountId?:string}){
 const document=(exists:boolean,data:Record<string,unknown>={})=>({exists,get:(field:string)=>data[field],data:()=>data});
 const refs:Array<{collection:string;id:string}>=[],objects={read:vi.fn()};
 const root={collection:(collection:string)=>({doc:(id:string)=>({collection,id})})};
 const tx={getAll:vi.fn(async(...requested:Array<{collection:string;id:string}>)=>{refs.push(...requested);return [document(true,{aiPilot:true,simulationOnly:true}),document(true),document(true),document(identity.exists,identity)];})};
 const db={runTransaction:async(fn:(transaction:typeof tx)=>Promise<unknown>)=>fn(tx)};
 const ai=new FirestoreAi(db as never,root as never,{} as never,objects as never);
 return {ai,tx,refs,objects};
}
describe('requester identity required for private AI results',()=>{
 for(const bad of [undefined,'',42,'u'.repeat(129)])it(`rejects an invalid requester before any result read: ${String(bad).slice(0,12)}`,async()=>{
  const c=fixture({exists:true,uid,accountId:account});
  await expect(c.ai.status(account,job,bad as string)).rejects.toMatchObject({code:'not_found'});
  await expect(c.ai.download(account,job,'translation-en.txt',bad as string)).rejects.toMatchObject({code:'not_found'});
  expect(c.tx.getAll).not.toHaveBeenCalled();expect(c.objects.read).not.toHaveBeenCalled();
 });
 for(const [label,identity] of [
  ['missing',{exists:false}],
  ['other uid',{exists:true,uid:'synthetic-other',accountId:account}],
  ['other account',{exists:true,uid,accountId:other}],
 ] as const)it(`denies ${label} in the same authorization read for status and download`,async()=>{
  const c=fixture(identity);
  await expect(c.ai.status(account,job,uid)).rejects.toMatchObject({code:'not_found'});
  await expect(c.ai.download(account,job,'translation-en.txt',uid)).rejects.toMatchObject({code:'not_found'});
  expect(c.tx.getAll).toHaveBeenCalledTimes(2);
  expect(c.refs.filter(ref=>ref.collection==='identities').map(ref=>ref.id)).toEqual([accountIdentityKey(uid),accountIdentityKey(uid)]);
  expect(c.objects.read).not.toHaveBeenCalled();
 });
});
