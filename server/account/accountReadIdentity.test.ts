import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AccountFault, AccountStore } from './backend';

// Synthetic optimistic transaction model, including paged query reads. It
// reproduces mixed application reads; it does not stand in for Firestore IAM.
type Row=Record<string,any>;
const uid='synthetic-account-reader',accountA='10000000-0000-4000-8000-000000000001',accountB='10000000-0000-4000-8000-000000000002';
const projectA='20000000-0000-4000-8000-000000000001',projectA2='20000000-0000-4000-8000-000000000002',projectB='20000000-0000-4000-8000-000000000003';
const ledgerA='30000000-0000-4000-8000-000000000001',ledgerA2='30000000-0000-4000-8000-000000000002',ledgerB='30000000-0000-4000-8000-000000000003';
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const accountRow=(key:string,available:number)=>({identityKey:key,schemaVersion:1,unit:'video_seconds',credited:available,available,reserved:0,consumed:0,active:0,activeProjectCount:2,createdAtMs:1});
const projectRow=(owner:string,title:string,time:number)=>({ownerAccountId:owner,title,kind:'text',content:`synthetic ${title}`,contentSha256:digest(`synthetic ${title}`),revision:1,createdAtMs:time,updatedAtMs:time,deleted:false});
const ledgerRow=(owner:string,kind:string,time:number)=>({ownerAccountId:owner,kind,seconds:3,createdAtMs:time});

function fixture(){
 const identityKey=AccountStore.identityKey(uid),identityPath=`identities/${identityKey}`;
 const rows=new Map<string,Row>([[identityPath,{uid,accountId:accountA}],[`accounts/${accountA}`,accountRow(identityKey,10)],
  [`accounts/${accountB}`,accountRow('b'.repeat(64),19)],[`projects/${projectA}`,projectRow(accountA,'owner first',30)],
  [`projects/${projectA2}`,projectRow(accountA,'owner second',20)],[`projects/${projectB}`,projectRow(accountB,'other',10)],
  [`ledgerEntries/${ledgerA}`,ledgerRow(accountA,'capture',30)],[`ledgerEntries/${ledgerA2}`,ledgerRow(accountA,'reserve',20)],
  [`ledgerEntries/${ledgerB}`,ledgerRow(accountB,'other',10)]]);
 const versions=new Map<string,number>(Array.from(rows.keys(),key=>[key,1]));
 let identityHook:(()=>void)|undefined,transactions=0,attempts=0;
 const write=(path:string,value?:Row)=>{if(value)rows.set(path,structuredClone(value));else rows.delete(path);versions.set(path,(versions.get(path)??0)+1);};
 const snapshot=(path:string)=>{const source=rows.get(path),row=source?structuredClone(source):undefined,id=path.split('/').at(-1)!;
  return {exists:row!==undefined,id,get:(field:string)=>row?.[field],data:()=>row};};
 const capture=(path:string)=>{const value={snapshot:snapshot(path),version:versions.get(path)??0};
  if(path===identityPath&&identityHook){const hook=identityHook;identityHook=undefined;hook();}return value;};
 type Spec={collection:string;filters:Array<[string,unknown]>;count:number;after?:[number,string]};
 const querySnapshot=(spec:Spec)=>{
  const prefix=spec.collection+'/',docs=[...rows.keys()].filter(path=>path.startsWith(prefix)&&!path.slice(prefix.length).includes('/'))
   .map(path=>({path,doc:snapshot(path)})).filter(({doc})=>spec.filters.every(([name,value])=>doc.get(name)===value))
   .sort((left,right)=>Number(right.doc.get('createdAtMs'))-Number(left.doc.get('createdAtMs'))||right.doc.id.localeCompare(left.doc.id))
   .filter(({doc})=>!spec.after||Number(doc.get('createdAtMs'))<spec.after[0]||Number(doc.get('createdAtMs'))===spec.after[0]&&doc.id<spec.after[1])
   .slice(0,spec.count);
  return {docs:docs.map(x=>x.doc),size:docs.length,paths:docs.map(x=>x.path)};
 };
 const makeQuery=(spec:Spec):any=>({kind:'query',spec,
  where:(name:string,op:string,value:unknown)=>{if(op!=='==')throw Error('Unsupported synthetic filter');return makeQuery({...spec,filters:[...spec.filters,[name,value]]});},
  orderBy:()=>makeQuery(spec),select:()=>makeQuery(spec),limit:(count:number)=>makeQuery({...spec,count}),
  startAfter:(time:number,id:string)=>makeQuery({...spec,after:[time,id]}),get:async()=>querySnapshot(spec)});
 const root={collection:(name:string)=>Object.assign(makeQuery({collection:name,filters:[],count:Infinity}),{
  doc:(id:string)=>{const path=`${name}/${id}`;return {kind:'document',path,get:async()=>capture(path).snapshot};}})};
 const db={runTransaction:async(fn:(tx:any)=>Promise<unknown>)=>{transactions++;for(let retry=0;retry<3;retry++){
  attempts++;const reads=new Map<string,number>(),tx={get:async(ref:any)=>{
   if(ref.kind==='query'){const result=querySnapshot(ref.spec);for(const path of result.paths)reads.set(path,versions.get(path)??0);return result;}
   const result=capture(ref.path);reads.set(ref.path,result.version);return result.snapshot;
  }};const result=await fn(tx);if([...reads].every(([path,version])=>(versions.get(path)??0)===version))return result;
 }throw Error('synthetic transaction retry limit');}};
 return {store:new AccountStore(db as never,root as never),identityKey,identityPath,write,rows,transactions:()=>transactions,
  attempts:()=>attempts,onIdentityRead:(hook:()=>void)=>{identityHook=hook;}};
}
const actions={
 me:(store:AccountStore)=>store.me(uid),
 read:(store:AccountStore)=>store.read(uid,projectA),
 list:(store:AccountStore)=>store.list(uid,'1'),
 ledger:(store:AccountStore)=>store.ledger(uid,'1'),
};

describe('Account public reads revalidate identity with the data they return',()=>{
 for(const [name,action] of Object.entries(actions)){
  it(`${name} performs its authorized read in one transaction`,async()=>{
   const f=fixture(),result=await action(f.store);expect(result).toBeDefined();expect(f.transactions()).toBe(1);
  });
  for(const mutation of ['removed','reassigned','changed-uid'] as const)it(`${name} cannot return earlier data after identity ${mutation}`,async()=>{
   const f=fixture();f.onIdentityRead(()=>{
    if(mutation==='removed')f.write(f.identityPath);
    else if(mutation==='reassigned')f.write(f.identityPath,{uid,accountId:accountB});
    else f.write(f.identityPath,{uid:'synthetic-other',accountId:accountA});
   });
   await expect(action(f.store)).rejects.toBeInstanceOf(AccountFault);expect(f.attempts()).toBeGreaterThanOrEqual(2);
  });
 }
 it('project and ledger pagination keep ordering and owner-bound cursors',async()=>{
  const f=fixture(),first=await f.store.list(uid,'1'),second=await f.store.list(uid,'1',first.nextCursor!);
  expect(first.items.map(item=>item.id)).toEqual([projectA]);expect(second.items.map(item=>item.id)).toEqual([projectA2]);expect(second.nextCursor).toBeNull();
  const firstLedger=await f.store.ledger(uid,'1'),secondLedger=await f.store.ledger(uid,'1',firstLedger.nextCursor!);
  expect(firstLedger.items.map(item=>item.id)).toEqual([ledgerA]);expect(secondLedger.items.map(item=>item.id)).toEqual([ledgerA2]);expect(secondLedger.nextCursor).toBeNull();
  expect(first.items[0]).not.toHaveProperty('content');
  const foreignCursor=Buffer.from(JSON.stringify({v:1,owner:accountB,time:30,id:projectA})).toString('base64url');
  await expect(f.store.list(uid,'1',foreignCursor)).rejects.toMatchObject({code:'invalid'});
  await expect(f.store.ledger(uid,'1',foreignCursor)).rejects.toMatchObject({code:'invalid'});
 });
 it('a coherent reassignment cannot reveal the earlier account project or lists',async()=>{
  for(const [name,action] of Object.entries(actions)){
   const f=fixture();f.write(`accounts/${accountB}`,accountRow(f.identityKey,19));
   f.onIdentityRead(()=>f.write(f.identityPath,{uid,accountId:accountB}));
   if(name==='read')await expect(action(f.store)).rejects.toMatchObject({code:'not_found'});
   else{
    const result=await action(f.store) as any;
    if(name==='me')expect(result.id).toBe(accountB);
    else expect(result.items.map((item:any)=>item.id)).toEqual([name==='list'?projectB:ledgerB]);
   }
   expect(f.attempts()).toBeGreaterThanOrEqual(2);
  }
 });
});
