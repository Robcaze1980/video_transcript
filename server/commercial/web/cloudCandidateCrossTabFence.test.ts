import { describe, expect, it } from 'vitest';
import { candidateApi, RequestBook, type CandidateLock, type Store } from './cloudCandidateApi';

const account='10000000-0000-4000-8000-000000000001';
const input='20000000-0000-4000-8000-000000000001';
const other='20000000-0000-4000-8000-000000000002';
const job='30000000-0000-4000-8000-000000000001';
class MemoryStore implements Store {
 data=new Map<string,string>();getItem(k:string){return this.data.get(k)??null;}
 setItem(k:string,v:string){this.data.set(k,v);}removeItem(k:string){this.data.delete(k);}
}
class SerialLock implements CandidateLock {
 private tail:Promise<void>=Promise.resolve();
 async request<T>(_name:string,signal:AbortSignal,action:()=>Promise<T>){const previous=this.tail;let release!:()=>void;this.tail=new Promise<void>(r=>{release=r;});await previous;try{signal.throwIfAborted();return await action();}finally{release();}}
}
function gate<T>(){let release!:(v:T)=>void;const promise=new Promise<T>(r=>{release=r;});return {promise,release};}
const response=(value:unknown,status=200,privateResponse=true)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...(privateResponse?{'Cache-Control':'no-store'}:{})}});
const terminal={id:job,inputId:input,operation:'translation:en',state:'cancelled',billingState:'settled',billing:{mode:'account_seconds',unit:'video_seconds'},revision:1,stale:false,units:3,results:[]};
function setup(){
 const store=new MemoryStore(),book=new RequestBook(account,store),lock=new SerialLock(),controller=new AbortController();
 const statusStarted=gate<void>(),statusRelease=gate<void>(),inputStarted=gate<void>(),inputRelease=gate<void>();
 let removed=false,holdInput=false,inputResponse:unknown, inputStatus=200, inputPrivate=true;
 const requests:Array<{method:string;path:string;cache?:RequestCache;authorization?:string}>=[];
 book.rememberInput(input);book.rememberJob(input,'translation:en',job);book.markCancel(input,job);
 const request=(async(path,init)=>{
  const method=init?.method??'GET',url=String(path);requests.push({method,path:url,cache:init?.cache,authorization:new Headers(init?.headers).get('Authorization')??undefined});
  if(url===`/api/cloud/ai/jobs/${job}`){if(method==='GET'){statusStarted.release();await statusRelease.promise;}return response(terminal);}
  if(url===`/api/cloud/uploads/${input}`&&method==='DELETE'){removed=true;return response({id:input,state:'deleting'},202);}
  if(url===`/api/cloud/uploads/${input}`&&method==='GET'){
   inputStarted.release();if(holdInput)await inputRelease.promise;
   return response(inputResponse??{id:input,state:removed?'deleting':'ready',size:10,offset:10,name:'synthetic.mp4'},inputStatus,inputPrivate);
  }
  throw Error('Unexpected synthetic request');
 }) as typeof fetch;
 const options={accountId:account,token:async()=>'synthetic-token',signal:controller.signal,store,request,lock};
 return {a:candidateApi(options),b:candidateApi(options),book,store,controller,statusStarted,statusRelease,inputStarted,inputRelease,requests,
  holdInput:()=>{holdInput=true;},respond:(value:unknown,code=200,privateResponse=true)=>{inputResponse=value;inputStatus=code;inputPrivate=privateResponse;}};
}
describe('authoritative cancellation fence for cooperative tabs',()=>{
 it('keeps a marker after another instance withdraws the input and local generation cannot be updated',async()=>{
  const f=setup(),read=f.a.resolveCancellation(input,job);await f.statusStarted.promise;
  const set=f.store.setItem.bind(f.store);f.store.setItem=(k,v)=>{if(k.endsWith(':input-generation'))throw Error('synthetic storage failure');set(k,v);};
  const removed=await f.b.remove(input);expect(removed.localCleanupFailed).toBe(true);expect(removed.pendingReferenceRetained).toBe(true);
  f.statusRelease.release();await expect(read).rejects.toMatchObject({status:404});
  expect(f.book.cancelPending(input)).toBe(job);expect(f.book.reviewReferences()).toEqual([{inputId:input,jobId:job,operation:'translation:en'}]);
  expect(f.requests.filter(r=>r.path.endsWith('/uploads/'+input)).map(r=>r.method)).toEqual(['DELETE','GET']);
 });
 it('confirms a current terminal only after a private authorized ready-input read',async()=>{
  const f=setup(),read=f.a.resolveCancellation(input,job);await f.statusStarted.promise;f.statusRelease.release();
  expect((await read).state).toBe('cancelled');expect(f.book.cancelPending(input)).toBeNull();
  expect(f.requests.map(r=>r.path)).toEqual([`/api/cloud/ai/jobs/${job}`,`/api/cloud/uploads/${input}`]);
  expect(f.requests[1]).toMatchObject({method:'GET',cache:'no-store',authorization:'Bearer synthetic-token'});
 });
 it.each([
  ['unavailable',{},503,true],['signed out',{},401,true],['denied',{},403,true],['missing',{},404,true],['expired',{},410,true],
  ['wrong input',{id:other,state:'ready'},200,true],['not ready',{id:input,state:'queued'},200,true],['deleted',{id:input,state:'deleted'},200,true],
  ['missing privacy header',{id:input,state:'ready'},200,false],
 ])('does not confirm a cancellation when input validation is %s',async(_label,value,code,privateResponse)=>{
  const f=setup();f.respond(value,code,privateResponse);const read=f.a.resolveCancellation(input,job);await f.statusStarted.promise;f.statusRelease.release();
  await expect(read).rejects.toThrow();expect(f.book.cancelPending(input)).toBe(job);
 });
 it('finishes validation before another participating instance can withdraw',async()=>{
  const f=setup();f.holdInput();const read=f.a.resolveCancellation(input,job);await f.statusStarted.promise;f.statusRelease.release();await f.inputStarted.promise;
  const removal=f.b.remove(input);await new Promise(resolve=>setTimeout(resolve,0));
  expect(f.requests.filter(r=>r.method==='DELETE')).toHaveLength(0);f.inputRelease.release();
  expect((await read).state).toBe('cancelled');expect((await removal).state).toBe('deleting');
  expect(f.requests.map(r=>r.method)).toEqual(['GET','GET','DELETE']);
 });
 it('checks the ready input before confirming a direct cancellation response',async()=>{
  const f=setup();f.book.confirmCancel(input,job,null);const cancellation=f.a.cancel(input,job);
  expect((await cancellation).state).toBe('cancelled');expect(f.book.cancelPending(input)).toBeNull();
  expect(f.requests.map(r=>r.method)).toEqual(['DELETE','GET']);
 });
});
