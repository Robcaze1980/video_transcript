import {createHash} from 'node:crypto';
import {Readable,Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import {describe,expect,it,vi} from 'vitest';
import {AccountBillingFault} from './accountBillingClient';
import {FirestoreBackend} from './firestoreBackend';
import {firestoreHttp} from './firestoreHttp';

// Only invented identities and balances are used. These tests exercise a race
// after the Firebase token was verified; they do not simulate Firebase revocation.
const uid='synthetic-owner',account='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Row=Record<string,unknown>;
type Snapshot={exists:boolean;id:string;get:(field:string)=>unknown;data:()=>Row|undefined};
type Ref={collection:string;id:string;get:()=>Promise<Snapshot>};
const key=(collection:string,id:string)=>`${collection}/${id}`;
function fixture(){
 const rows=new Map<string,Row>([[key('identities',digest(['firebase',uid])),{uid,accountId:account}],
  [key('accounts',account),{credited:10,available:8,reserved:2,consumed:0,active:1,aiPilot:true,simulationOnly:true}]]);
 const snapshot=(ref:Ref):Snapshot=>{const row=rows.get(key(ref.collection,ref.id));return {exists:!!row,id:ref.id,get:field=>row?.[field],data:()=>row};};
 const root={collection:(collection:string)=>({doc:(id:string):Ref=>({collection,id,get:async()=>snapshot({collection,id} as Ref)})})};
 const tx={get:vi.fn(async(ref:Ref)=>snapshot(ref)),getAll:vi.fn(async(...refs:Ref[])=>refs.map(snapshot)),create:vi.fn(),update:vi.fn(),set:vi.fn(),delete:vi.fn()};
 const db={runTransaction:vi.fn(async(fn:(value:typeof tx)=>Promise<unknown>)=>fn(tx))};
 const backend=new FirestoreBackend(db as never,root as never);
 return {backend,tx,rows,identityKey:key('identities',digest(['firebase',uid])),accountKey:key('accounts',account)};
}
class Response extends Writable{
 headers:Record<string,string>={};statusCode=200;headersSent=false;parts:Buffer[]=[];
 setHeader(name:string,value:unknown){this.headers[name.toLowerCase()]=String(value);return this;}
 writeHead(status:number,headers:Record<string,unknown>={}){this.statusCode=status;this.headersSent=true;for(const [name,value] of Object.entries(headers))this.setHeader(name,value);return this;}
 _write(chunk:Buffer,_encoding:BufferEncoding,callback:(error?:Error|null)=>void){this.parts.push(Buffer.from(chunk));callback();}
}
async function request(backend:FirestoreBackend,ai?:unknown,requirePilotBalance?:true){
 const identity={verifyIdToken:vi.fn(async()=>({uid,email_verified:true}))};
 const handler=firestoreHttp({backend,identity:identity as never,origin:'http://127.0.0.1',...(ai?{ai:ai as never}:{}),...(requirePilotBalance?{requirePilotBalance}:{})});
 const req=Readable.from([]) as Readable&{url:string;method:string;headers:Record<string,string>};
 req.url='/api/cloud/me';req.method='GET';req.headers={origin:'http://127.0.0.1',authorization:'Bearer synthetic-token'};
 const res=new Response();await handler(req as never,res as never);await finished(res);
 return {status:res.statusCode,body:Buffer.concat(res.parts).toString('utf8'),headers:res.headers};
}
describe('balance response and requester identity',()=>{
 it('returns the balance while the same account is authorized',async()=>{
  const c=fixture(),res=await request(c.backend);
  expect(res.status).toBe(200);expect(JSON.parse(res.body)).toMatchObject({id:account,balance:{available:8}});
 });
 for(const mutation of ['removed','reassigned','changed-uid'] as const)it(`does not reveal balance after identity is ${mutation}`,async()=>{
  const c=fixture(),original=c.backend.accountForUid.bind(c.backend);
  c.backend.accountForUid=async value=>{const result=await original(value);
   if(mutation==='removed')c.rows.delete(c.identityKey);
   else c.rows.set(c.identityKey,mutation==='reassigned'?{uid,accountId:other}:{uid:'synthetic-other',accountId:account});
   return result;};
  const res=await request(c.backend);expect([401,403,404]).toContain(res.status);
  expect(res.body).not.toContain(account);expect(res.body).not.toContain('available');
 });
 for(const mutation of ['removed','reassigned','changed-uid'] as const)it(`does not return a remote balance if identity is ${mutation} in flight`,async()=>{
  const c=fixture(),ai={accountBalance:vi.fn(async()=>{
   if(mutation==='removed')c.rows.delete(c.identityKey);
   else c.rows.set(c.identityKey,mutation==='reassigned'?{uid,accountId:other}:{uid:'synthetic-other',accountId:account});
   return {available:8,reserved:2};})};
  const res=await request(c.backend,ai);expect(ai.accountBalance).toHaveBeenCalledOnce();expect([401,403,404]).toContain(res.status);
  expect(res.body).not.toContain(account);expect(res.body).not.toContain('available');
 });
 it('does not query the remote balance when identity is already absent',async()=>{
  const c=fixture(),original=c.backend.accountForUid.bind(c.backend),ai={accountBalance:vi.fn(async()=>({available:8}))};
  c.backend.accountForUid=async value=>{const result=await original(value);c.rows.delete(c.identityKey);return result;};
  const res=await request(c.backend,ai);expect([401,403,404]).toContain(res.status);
  expect(ai.accountBalance).not.toHaveBeenCalled();expect(res.body).not.toContain('available');
 });
 it('returns an authorized remote balance once',async()=>{
  const c=fixture(),ai={accountBalance:vi.fn(async()=>({available:8,reserved:2}))};
  const res=await request(c.backend,ai);expect(res.status).toBe(200);expect(JSON.parse(res.body)).toMatchObject({id:account,balance:{available:8,reserved:2}});
  expect(ai.accountBalance).toHaveBeenCalledOnce();
 });
 it('denies a remote response when the local pilot permission is removed in flight',async()=>{
  const c=fixture(),ai={accountBalance:vi.fn(async()=>{c.rows.set(c.accountKey,{...c.rows.get(c.accountKey),aiPilot:false});return {available:8};})};
  const res=await request(c.backend,ai,true);expect(res.status).toBe(404);expect(ai.accountBalance).toHaveBeenCalledOnce();
  expect(res.body).not.toContain(account);expect(res.body).not.toContain('available');
 });
 it('does not contact the remote account when the local pilot permission was already removed',async()=>{
  const c=fixture(),original=c.backend.accountForUid.bind(c.backend),ai={accountBalance:vi.fn(async()=>({available:8}))};
  c.backend.accountForUid=async value=>{const result=await original(value);c.rows.set(c.accountKey,{...c.rows.get(c.accountKey),simulationOnly:false});return result;};
  const res=await request(c.backend,ai,true);expect(res.status).toBe(404);expect(ai.accountBalance).not.toHaveBeenCalled();
 });
 it('does not substitute the local balance when the remote account is unavailable',async()=>{
  const c=fixture(),ai={accountBilling:{},accountBalance:vi.fn(async()=>{throw new AccountBillingFault('unavailable');})};
  const res=await request(c.backend,ai);expect(res.status).toBe(503);expect(JSON.parse(res.body)).toEqual({error:'unavailable'});
 });
 it('does not substitute the local balance for a null response from a configured remote account',async()=>{
  const c=fixture(),ai={accountBilling:{},accountBalance:vi.fn(async()=>null)};
  const res=await request(c.backend,ai);expect(res.status).toBe(503);expect(JSON.parse(res.body)).toEqual({error:'unavailable'});
 });
 it('preserves a valid zero balance from the remote account',async()=>{
  const c=fixture(),ai={accountBilling:{},accountBalance:vi.fn(async()=>({available:0,reserved:0}))};
  const res=await request(c.backend,ai);expect(res.status).toBe(200);expect(JSON.parse(res.body).balance.available).toBe(0);
 });
});
