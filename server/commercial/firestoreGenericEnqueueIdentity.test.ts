import {createHash} from 'node:crypto';
import {Readable,Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import {describe,expect,it,vi} from 'vitest';
import {FirestoreBackend} from './firestoreBackend';
import {firestoreHttp} from './firestoreHttp';

const account='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const input='20000000-0000-4000-8000-000000000001',job='30000000-0000-4000-8000-000000000001';
const uid='synthetic-owner',key='synthetic-request',operation='transcript:es';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Row=Record<string,unknown>;
type Ref={collection:string;id:string};
function fixture(){
 const docs=new Map<string,Row>(),path=(collection:string,id:string)=>`${collection}/${id}`;
 docs.set(path('identities',digest(['firebase',uid])),{uid,accountId:account});
 docs.set(path('accounts',account),{credited:10,available:8,reserved:2,consumed:0,active:1});
 docs.set(path('inputs',input),{accountId:account});docs.set(path('projects',input),{accountId:account,inputId:input,revision:1});
 docs.set(path('requests',digest([account,key])),{accountId:account,jobId:job,requestFingerprint:digest([input,operation,1])});
 docs.set(path('jobs',job),{accountId:account,inputId:input,requestKey:key,operation,revision:1,price:2,state:'queued'});
 docs.set(path('jobAccounting',job),{protocol:1,jobId:job,accountId:account,inputId:input,requestKey:key,operation,revision:1,price:2,profile:null,mode:'simulation',createdAtMs:1});
 docs.set(path('movements','reserve:'+job),{accountId:account,reference:job,kind:'reserve',credits:2});
 const root={collection:(collection:string)=>({doc:(id:string)=>({collection,id})})};
 const snapshot=(ref:Ref)=>{const value=docs.get(path(ref.collection,ref.id));return {exists:value!==undefined,id:ref.id,get:(field:string)=>value?.[field],data:()=>value};};
 const tx={get:vi.fn(async(ref:Ref)=>snapshot(ref)),getAll:vi.fn(async(...refs:Ref[])=>refs.map(snapshot)),update:vi.fn(),create:vi.fn(),set:vi.fn(),delete:vi.fn()};
 const db={runTransaction:vi.fn(async(fn:(transaction:typeof tx)=>Promise<unknown>)=>fn(tx))};
 const backend=new FirestoreBackend(db as never,root as never);
 return {backend,db,tx,docs,path};
}
function noWrites(c:ReturnType<typeof fixture>){expect(c.tx.update).not.toHaveBeenCalled();expect(c.tx.create).not.toHaveBeenCalled();expect(c.tx.set).not.toHaveBeenCalled();expect(c.tx.delete).not.toHaveBeenCalled();}
function replace(c:ReturnType<typeof fixture>,collection:string,id:string,change:Row){const path=c.path(collection,id);c.docs.set(path,{...c.docs.get(path),...change});}

describe('generic job replay and reservation requester',()=>{
 for(const [label,identity] of [
  ['missing',null],['changed uid',{uid:'synthetic-other',accountId:account}],['reassigned',{uid,accountId:other}],
 ] as const)it(`fails closed before job or money reads for ${label} identity`,async()=>{
  const c=fixture(),identityPath=c.path('identities',digest(['firebase',uid]));if(identity)c.docs.set(identityPath,identity);else c.docs.delete(identityPath);
  await expect(c.backend.priorRequestForUid(account,input,key,operation,1,uid)).rejects.toMatchObject({code:'not_found'});
  await expect(c.backend.reserveForUid(account,input,key,2,operation,1,uid)).rejects.toMatchObject({code:'not_found'});
  expect(c.tx.getAll).not.toHaveBeenCalled();noWrites(c);
 });
 it.each([undefined,'',42,'u'.repeat(129)])('rejects an invalid UID before opening a transaction: %s',async bad=>{
  const c=fixture();await expect(c.backend.priorRequestForUid(account,input,key,operation,1,bad as string)).rejects.toMatchObject({code:'not_found'});
  await expect(c.backend.reserveForUid(account,input,key,2,operation,1,bad as string)).rejects.toMatchObject({code:'not_found'});
  expect(c.db.runTransaction).not.toHaveBeenCalled();noWrites(c);
 });
 it('replays only a request linked to the matching synthetic job and accounting evidence',async()=>{
  const c=fixture();await expect(c.backend.priorRequestForUid(account,input,key,operation,1,uid)).resolves.toBe(job);
  await expect(c.backend.reserveForUid(account,input,key,2,operation,1,uid)).resolves.toBe(job);noWrites(c);
 });
 it('returns no prior job when the request is absent',async()=>{
  const c=fixture();c.docs.delete(c.path('requests',digest([account,key])));
  await expect(c.backend.priorRequestForUid(account,input,key,operation,1,uid)).resolves.toBeNull();noWrites(c);
 });
 it('does not reveal or reserve a job when the account document is missing',async()=>{
  const c=fixture();c.docs.delete(c.path('accounts',account));
  await expect(c.backend.priorRequestForUid(account,input,key,operation,1,uid)).rejects.toMatchObject({code:'not_found'});
  await expect(c.backend.reserveForUid(account,input,key,2,operation,1,uid)).rejects.toMatchObject({code:'not_found'});noWrites(c);
 });
 for(const [label,collection,id,change] of [
  ['request owner','requests',digest([account,key]),{accountId:other}],
  ['request fingerprint','requests',digest([account,key]),{requestFingerprint:'wrong'}],
  ['request job id','requests',digest([account,key]),{jobId:'invalid'}],
  ['job owner','jobs',job,{accountId:other}],
  ['job input','jobs',job,{inputId:'20000000-0000-4000-8000-000000000002'}],
  ['job request key','jobs',job,{requestKey:'other-request'}],
  ['job operation','jobs',job,{operation:'translation:en'}],
  ['job revision','jobs',job,{revision:2}],
  ['job AI profile','jobs',job,{aiProfile:'ai-candidate-v1'}],
  ['accounting owner','jobAccounting',job,{accountId:other}],
  ['reserve movement','movements','reserve:'+job,{kind:'capture'}],
 ] as const)it(`rejects mismatched ${label} for the replay`,async()=>{
  const c=fixture();replace(c,collection,id,change);
  await expect(c.backend.priorRequestForUid(account,input,key,operation,1,uid)).rejects.toMatchObject({code:'conflict'});noWrites(c);
 });
 for(const [label,collection,id,change] of [
  ['request owner','requests',digest([account,key]),{accountId:other}],
  ['job owner','jobs',job,{accountId:other}],
  ['job input','jobs',job,{inputId:'20000000-0000-4000-8000-000000000002'}],
  ['job request key','jobs',job,{requestKey:'other-request'}],
  ['job operation','jobs',job,{operation:'translation:en'}],
  ['job revision','jobs',job,{revision:2}],
  ['reserve movement','movements','reserve:'+job,{kind:'capture'}],
 ] as const)it(`rejects mismatched ${label} if a prior request appears during reservation`,async()=>{
  const c=fixture();replace(c,collection,id,change);
  await expect(c.backend.reserveForUid(account,input,key,2,operation,1,uid)).rejects.toMatchObject({code:'conflict'});noWrites(c);
 });
 for(const [label,field,value] of [
  ['owner','accountId',other],['input','inputId','20000000-0000-4000-8000-000000000002'],
  ['request key','requestKey','other-request'],['operation','operation','translation:en'],['revision','revision',2],
 ] as const)it(`rejects a coherently forged job and accounting ${label} for both prior paths`,async()=>{
  const c=fixture();replace(c,'jobs',job,{[field]:value});replace(c,'jobAccounting',job,{[field]:value});
  if(field==='accountId')replace(c,'movements','reserve:'+job,{accountId:value});
  await expect(c.backend.priorRequestForUid(account,input,key,operation,1,uid)).rejects.toMatchObject({code:'conflict'});
  await expect(c.backend.reserveForUid(account,input,key,2,operation,1,uid)).rejects.toMatchObject({code:'conflict'});noWrites(c);
 });
 it('rejects a missing prior job even when its request record remains',async()=>{
  const c=fixture();c.docs.delete(c.path('jobs',job));
  await expect(c.backend.priorRequestForUid(account,input,key,operation,1,uid)).rejects.toMatchObject({code:'conflict'});
  await expect(c.backend.reserveForUid(account,input,key,2,operation,1,uid)).rejects.toMatchObject({code:'conflict'});noWrites(c);
 });
});

class SyntheticResponse extends Writable{
 headers:Record<string,string>={};statusCode=200;headersSent=false;parts:Buffer[]=[];
 setHeader(name:string,value:unknown){this.headers[name.toLowerCase()]=String(value);return this;}
 writeHead(status:number,headers:Record<string,unknown>={}){this.statusCode=status;this.headersSent=true;for(const [name,value] of Object.entries(headers))this.setHeader(name,value);return this;}
 _write(chunk:Buffer,_encoding:BufferEncoding,callback:(error?:Error|null)=>void){this.parts.push(Buffer.from(chunk));callback();}
}
describe('generic HTTP job admission',()=>{
 for(const prior of [null,job])it(`passes the verified UID to customer operations, prior=${String(prior)}`,async()=>{
  const backend={accountForUid:vi.fn(async()=>account),priorRequestForUid:vi.fn(async()=>prior),readProjectForUid:vi.fn(async()=>({revision:1})),reserveForUid:vi.fn(async()=>job)};
  const quote=vi.fn(async()=>2),identity={verifyIdToken:vi.fn(async()=>({uid,email_verified:true}))};
  const handler=firestoreHttp({backend:backend as never,identity:identity as never,origin:'http://127.0.0.1',quote});
  const bytes=Buffer.from(JSON.stringify({inputId:input,requestKey:key,operation,expectedRevision:1})),req=Readable.from([bytes]) as Readable&{url:string;method:string;headers:Record<string,string>};
  req.url='/api/cloud/jobs';req.method='POST';req.headers={origin:'http://127.0.0.1',authorization:'Bearer synthetic-token','content-type':'application/json','content-length':String(bytes.length)};
  const res=new SyntheticResponse();await handler(req as never,res as never);await finished(res);expect(res.statusCode).toBe(202);
  expect(identity.verifyIdToken).toHaveBeenCalledExactlyOnceWith('synthetic-token',true);
  expect(backend.priorRequestForUid).toHaveBeenCalledExactlyOnceWith(account,input,key,operation,1,uid);
  if(prior){expect(quote).not.toHaveBeenCalled();expect(backend.readProjectForUid).not.toHaveBeenCalled();expect(backend.reserveForUid).not.toHaveBeenCalled();}
  else{expect(backend.readProjectForUid).toHaveBeenCalledExactlyOnceWith(account,input,uid);expect(quote).toHaveBeenCalledExactlyOnceWith(account,input,operation);expect(backend.reserveForUid).toHaveBeenCalledExactlyOnceWith(account,input,key,2,operation,1,uid);}
 });
});
