import {createHash} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {candidateApi,RequestBook,publicConfig,bytesSha,fileSha256,CHUNK_BYTES,HASH_BLOCK_BYTES,hasUnknown,MAX_DRAFT_CHARS,draftWithinPilotLimit,MAX_VIDEO_DIMENSION,videoDimensionIssue,type CandidateLock,type Store,type Job} from './cloudCandidateApi';
const account='10000000-0000-4000-8000-000000000001',foreign='10000000-0000-4000-8000-000000000002',input='20000000-0000-4000-8000-000000000001',jobId='30000000-0000-4000-8000-000000000001';
class MemoryStore implements Store {data=new Map<string,string>();getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,v);}removeItem(k:string){this.data.delete(k);}}
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const immediateLock:CandidateLock={async request(_name,signal,action){signal.throwIfAborted();return action();}};
class SerialLock implements CandidateLock {
 private tail:Promise<void>=Promise.resolve();
 async request<T>(_name:string,signal:AbortSignal,action:()=>Promise<T>):Promise<T>{
  const previous=this.tail;let release!:()=>void;this.tail=new Promise(resolve=>{release=resolve;});
  await previous;try{signal.throwIfAborted();return await action();}finally{release();}
 }
}
function fixture(request:typeof fetch,store:Store=new MemoryStore(),controller=new AbortController()){return {api:candidateApi({accountId:account,token:async()=>'synthetic-id-token',signal:controller.signal,store,request,lock:immediateLock}),store,controller};}
function cancellationFixture(request:typeof fetch,store:Store=new MemoryStore(),controller=new AbortController()){return fixture((async(path,init)=>String(path)==='/api/cloud/uploads/'+input&&(init?.method??'GET')==='GET'?response({id:input,state:'ready',size:10,offset:10,name:'synthetic.mp4'}):request(path,init)) as typeof fetch,store,controller);}
describe('local cloud candidate durable requests and private transport',()=>{
 it('accepts dimensions through 1920 in either direction and rejects invalid or larger metadata',()=>{
  expect(MAX_VIDEO_DIMENSION).toBe(1920);
  for(const [width,height] of [[1920,1080],[1080,1920],[1920,1920],[1,1]])expect(videoDimensionIssue(width,height)).toBeUndefined();
  for(const [width,height] of [[1921,1080],[1080,1921],[1921,1921]])expect(videoDimensionIssue(width,height)).toBe('too_large');
  for(const [width,height] of [[0,1],[1,0],[NaN,1],[1,NaN],[Infinity,1],[-1,1],[1.5,2]])expect(videoDimensionIssue(width,height)).toBe('invalid');
 });
 it('serializes simultaneous job starts in two clients and reuses the same request key',async()=>{
  const store=new MemoryStore(),lock=new SerialLock(),controller=new AbortController(),bodies:any[]=[];
  let entered!:()=>void,release!:()=>void;const firstRequest=new Promise<void>(resolve=>{entered=resolve;}),waitForRelease=new Promise<void>(resolve=>{release=resolve;});
  const request=(async(_path,init)=>{bodies.push(JSON.parse(String(init?.body)));if(bodies.length===1){entered();await waitForRelease;}return response({id:jobId},202);}) as typeof fetch;
  const options={accountId:account,token:async()=>'synthetic-id-token',signal:controller.signal,store,request,lock};
  const first=candidateApi(options).start(input,'translation:en',1);await firstRequest;
  const second=candidateApi(options).start(input,'translation:en',1);await new Promise(resolve=>setTimeout(resolve,0));expect(bodies).toHaveLength(1);
  release();expect(await Promise.all([first,second])).toEqual([jobId,jobId]);expect(bodies).toHaveLength(2);expect(bodies[1].requestKey).toBe(bodies[0].requestKey);
 });
 it('serializes two attempts to resume the same upload and rechecks its confirmed state',async()=>{
  const store=new MemoryStore(),lock=new SerialLock(),controller=new AbortController(),file=new File(['abc'],'original.mp4');
  new RequestBook(account,store).rememberUpload(input,await bytesSha(await file.arrayBuffer()));
  let entered!:()=>void,release!:()=>void,offset=0,state='uploading',gets=0,puts=0,completes=0;
  const firstPut=new Promise<void>(resolve=>{entered=resolve;}),waitForRelease=new Promise<void>(resolve=>{release=resolve;});
  const dto=()=>({id:input,size:file.size,offset,state});
  const request=(async(path,init)=>{
   if(init?.method==='PUT'){puts++;entered();await waitForRelease;offset=file.size;return response(dto());}
   if(init?.method==='POST'){completes++;state='queued';return response(dto(),202);}
   gets++;return response(dto());
  }) as typeof fetch;
  const options={accountId:account,token:async()=>'synthetic-id-token',signal:controller.signal,store,request,lock};
  const first=candidateApi(options).resumeUpload(input,file,()=>{});await firstPut;
  const second=candidateApi(options).resumeUpload(input,file,()=>{});await new Promise(resolve=>setTimeout(resolve,0));
  expect(gets).toBe(1);expect(puts).toBe(1);release();
  expect((await Promise.all([first,second])).map(value=>value.state)).toEqual(['queued','queued']);
  expect(gets).toBe(2);expect(puts).toBe(1);expect(completes).toBe(1);
 });
 it('does not send a job when browser coordination is unavailable',async()=>{
  let calls=0;vi.stubGlobal('navigator',{});
  try{
   const api=candidateApi({accountId:account,token:async()=>'token',signal:new AbortController().signal,store:new MemoryStore(),request:(async()=>{calls++;return response({id:jobId});}) as typeof fetch});
   await expect(api.start(input,'translation:en',1)).rejects.toMatchObject({code:'coordination_unavailable'});expect(calls).toBe(0);
  }finally{vi.unstubAllGlobals();}
 });
 it('keeps a lost cancellation across reload, blocks new jobs, and retries only the same job',async()=>{
  const store=new MemoryStore();let deletes=0,posts=0,state='running';
  const job=()=>({id:jobId,inputId:input,operation:'translation:en',state,billing:{mode:'account_seconds',unit:'video_seconds'},billingState:state==='cancelled'?'settled':'pending',revision:1,stale:false,units:3,results:[]});
  const request=(async(_path,init)=>{
   if(init?.method==='DELETE'){deletes++;if(deletes===1)throw TypeError('cancellation response lost');state='cancelled';return response(job());}
   if(init?.method==='POST'){posts++;return response({id:jobId});}
   return response(job());
  }) as typeof fetch;
  const first=cancellationFixture(request,store);first.api.book.rememberInput(input);
  await expect(first.api.cancel(input,jobId)).rejects.toMatchObject({code:'response_unconfirmed'});
  expect(first.api.book.cancelPending(input)).toBe(jobId);
  const reopened=cancellationFixture(request,store);expect((await reopened.api.resolveCancellation(input,jobId)).state).toBe('running');
  expect(reopened.api.book.cancelPending(input)).toBe(jobId);
  await expect(reopened.api.start(input,'narration:en:female',1)).rejects.toMatchObject({code:'cancel_unconfirmed'});
  expect(posts).toBe(0);expect(deletes).toBe(1);
  expect((await reopened.api.cancel(input,jobId)).state).toBe('cancelled');
  expect(reopened.api.book.cancelPending(input)).toBeNull();expect(deletes).toBe(2);
 });
 it('clears an ambiguous cancellation only after reading the matching terminal job',async()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store);book.rememberInput(input);book.markCancel(input,jobId);
  let state='running',wrong=true;
  const f=cancellationFixture((async()=>response({id:jobId,inputId:wrong?foreign:input,operation:'translation:en',state,billing:{mode:'account_seconds',unit:'video_seconds'},billingState:'settled',revision:1,stale:false,units:3,results:[]})) as typeof fetch,store);
  await expect(f.api.resolveCancellation(input,jobId)).rejects.toMatchObject({code:'response_unconfirmed'});expect(book.cancelPending(input)).toBe(jobId);
  wrong=false;expect((await f.api.resolveCancellation(input,jobId)).state).toBe('running');expect(book.cancelPending(input)).toBe(jobId);
  state='unknown';expect((await f.api.resolveCancellation(input,jobId)).state).toBe('unknown');expect(book.cancelPending(input)).toBe(jobId);
  state='cancelled';expect((await f.api.resolveCancellation(input,jobId)).state).toBe('cancelled');expect(book.cancelPending(input)).toBeNull();
 });
 it('hashes bounded slices and matches native SHA-256 across block boundaries',async()=>{
  for(const length of [0,1,63,64,65,HASH_BLOCK_BYTES+65]){
   const data=new Uint8Array(length);for(let i=0;i<data.length;i++)data[i]=i%251;
   const file=new File([data],'synthetic.mp4'),whole=vi.spyOn(file,'arrayBuffer'),slices=vi.spyOn(file,'slice'),progress:number[]=[];
   const hash=await fileSha256(file,new AbortController().signal,value=>progress.push(value));
   expect(hash).toBe(createHash('sha256').update(data).digest('hex'));expect(whole).not.toHaveBeenCalled();
   expect(slices.mock.calls.every(([start,end])=>Number(end)-Number(start)<=HASH_BLOCK_BYTES)).toBe(true);
   expect(progress[0]).toBe(0);expect(progress.at(-1)).toBe(1);
   if(length>HASH_BLOCK_BYTES)expect(slices).toHaveBeenCalledTimes(2);
  }
 });
 it('cancels during file preparation without contacting the server',async()=>{
  const controller=new AbortController(),file=new File([new Uint8Array(HASH_BLOCK_BYTES+10)],'synthetic.mp4');let calls=0;
  const f=fixture((async()=>{calls++;return response({});}) as typeof fetch,new MemoryStore(),controller);
  await expect(f.api.upload(file,()=>{},fraction=>{if(fraction>0)controller.abort();})).rejects.toThrow();expect(calls).toBe(0);
 });
 it('keeps a key across reloads and isolates accounts, operations and revisions without text/token persistence',()=>{
  const store=new MemoryStore(),a=new RequestBook(account,store),key=a.key(input,'translation:en',1);expect(new RequestBook(account,store).key(input,'translation:en',1)).toBe(key);
  expect(new RequestBook(foreign,store).key(input,'translation:en',1)).not.toBe(key);expect(a.key(input,'translation:en',2)).not.toBe(key);expect(a.key(input,'narration:en:female',1)).not.toBe(key);
  a.rememberInput(input);a.rememberJob(input,'translation:en',jobId);expect(new RequestBook(foreign,store).input()).toBeNull();expect(JSON.stringify([...store.data])).not.toMatch(/Bearer|draft|synthetic-id-token/);
 });
 it('persists pending revision BEFORE POST and retries exactly the same key after HTTP500, including a new client instance',async()=>{
  const store=new MemoryStore(),bodies:any[]=[];const request=(async(path,init)=>{expect(new RequestBook(account,store).pending(input,'translation:en')).toBe(1);bodies.push(JSON.parse(String(init!.body)));return bodies.length===1?response({},500):response({id:jobId},202);}) as typeof fetch;
  const first=fixture(request,store);await expect(first.api.start(input,'translation:en',1)).rejects.toMatchObject({status:500});expect(first.api.book.pending(input,'translation:en')).toBe(1);
  const second=fixture(request,store);expect(await second.api.start(input,'translation:en',1)).toBe(jobId);expect(bodies[1]).toEqual(bodies[0]);expect(second.api.book.pending(input,'translation:en')).toBeUndefined();expect(second.api.book.job(input,'translation:en')).toBe(jobId);
 });
 it('does not send a paid request when durable key persistence fails',async()=>{
  let calls=0;const f=fixture((async()=>{calls++;return response({id:jobId},202);}) as typeof fetch,{getItem:()=>null,setItem:()=>{throw Error('storage disabled');},removeItem:()=>{}});
  await expect(f.api.start(input,'translation:en',1)).rejects.toThrow();expect(calls).toBe(0);
 });
 it('retains the key after transport failure and never retries automatically',async()=>{
  let calls=0;const f=fixture((async()=>{calls++;throw TypeError('network');}) as typeof fetch);
  await expect(f.api.start(input,'translation:en',1)).rejects.toMatchObject({code:'response_unconfirmed'});expect(calls).toBe(1);expect(f.api.book.pending(input,'translation:en')).toBe(1);
 });
 it('aborts before request when account changes while obtaining a token',async()=>{
  const controller=new AbortController();let release!:(v:string)=>void,calls=0;const token=new Promise<string>(r=>release=r);
  const api=candidateApi({accountId:account,store:new MemoryStore(),signal:controller.signal,token:()=>token,request:(async()=>{calls++;return response({});}) as typeof fetch});
  const waiting=api.me();controller.abort();release('old-account-token');await expect(waiting).rejects.toThrow();expect(calls).toBe(0);
 });
 it('sends credentials only as Bearer to same-origin fixed paths and rejects hostile IDs',async()=>{
  const f=fixture((async(path,init)=>{expect(String(path)).toBe('/api/cloud/ai/jobs/'+jobId);expect(String(path)).not.toContain('token');expect(init?.headers).toMatchObject({Authorization:'Bearer synthetic-id-token'});expect(init?.credentials).toBe('omit');expect(init?.redirect).toBe('error');return response({id:jobId,inputId:input,operation:'translation:en',state:'unknown',results:[]});}) as typeof fetch);
  expect((await f.api.job(jobId)).state).toBe('unknown');expect(()=>f.api.job('https://attacker.invalid/')).toThrow();
 });
 it('requires the explicit production Firebase configuration',async()=>{
  await expect(publicConfig((async()=>response({web:{projectId:'other',apiKey:'public',appId:'app',authDomain:'other.firebaseapp.com'}})) as typeof fetch)).rejects.toMatchObject({code:'invalid_configuration'});
  expect((await publicConfig((async()=>response({web:{projectId:'vistavo-prod',apiKey:'public',appId:'app',authDomain:'vistavo-prod.firebaseapp.com'}})) as typeof fetch)).web.projectId).toBe('vistavo-prod');
 });
 it('resumes the identical upload after chunk failure using SHA and the cloud chunks offset protocol',async()=>{
  const file=new File([new Uint8Array(CHUNK_BYTES+3)],'synthetic.mp4',{type:'video/mp4'});let offset=0,fail=true;const starts:any[]=[],chunks:number[]=[];
  const f=fixture((async(path,init)=>{const url=String(path);if(url==='/api/cloud/uploads'){starts.push(JSON.parse(String(init?.body)));return response({id:input,size:file.size,offset,state:'uploading'},201);}
   if(url==='/api/cloud/uploads/'+input)return response({id:input,size:file.size,offset,state:'uploading'});
   if(url.includes('/chunks?offset=')){const at=Number(url.split('offset=')[1]);chunks.push(at);expect(init?.method).toBe('PUT');expect(init?.headers).toMatchObject({'Content-Type':'application/octet-stream'});if(at===CHUNK_BYTES&&fail){fail=false;return response({},503);}expect(at).toBe(offset);offset+=(init!.body as Blob).size;return response({id:input,size:file.size,offset,state:'uploading'});}
   expect(url).toBe('/api/cloud/uploads/'+input+'/complete');return response({id:input,size:file.size,offset,state:'queued'},202);
  }) as typeof fetch);
  await expect(f.api.upload(file,()=>{})).rejects.toMatchObject({status:503});expect((await f.api.upload(file,()=>{})).state).toBe('queued');expect(starts[1]).toEqual(starts[0]);expect(starts[0].sha256).toMatch(/^[a-f0-9]{64}$/);expect(chunks).toEqual([0,CHUNK_BYTES,CHUNK_BYTES]);expect(f.api.book.input()).toBe(input);
 });
 it('continues a recovered upload from its confirmed offset without creating another upload',async()=>{
  const bytes=new Uint8Array(CHUNK_BYTES+3),file=new File([bytes],'original.mp4',{type:'video/mp4'}),renamed=new File([bytes],'renamed.mp4',{type:'video/mp4'});
  const store=new MemoryStore(),digest=await bytesSha(await file.arrayBuffer()),book=new RequestBook(account,store);
  book.rememberInput(input);book.rememberUpload(input,digest);
  const requests:string[]=[],progress:number[]=[];
  const request=(async(path,init)=>{
   const url=String(path);requests.push((init?.method??'GET')+' '+url);
   if(url==='/api/cloud/uploads/'+input)return response({id:input,size:file.size,offset:CHUNK_BYTES,state:'uploading'});
   if(url.includes('/chunks?offset=')){expect(url).toContain('offset='+CHUNK_BYTES);expect((init!.body as Blob).size).toBe(3);return response({id:input,offset:file.size,state:'uploading'});}
   expect(url).toBe('/api/cloud/uploads/'+input+'/complete');return response({id:input,size:file.size,offset:file.size,state:'queued'},202);
  }) as typeof fetch;
  const reloaded=fixture(request,store);
  expect((await reloaded.api.resumeUpload(input,renamed,value=>progress.push(value))).state).toBe('queued');
  expect(requests).toEqual(['GET /api/cloud/uploads/'+input,'PUT /api/cloud/uploads/'+input+'/chunks?offset='+CHUNK_BYTES,'POST /api/cloud/uploads/'+input+'/complete']);
  expect(progress).toEqual([CHUNK_BYTES/file.size,1]);
 });
 it('rejects a different same-size file or missing account-scoped digest before contacting the server',async()=>{
  const store=new MemoryStore(),correct=new File(['abc'],'synthetic.mp4'),other=new File(['xyz'],'synthetic.mp4');
  const book=new RequestBook(account,store);book.rememberUpload(input,await bytesSha(await correct.arrayBuffer()));let calls=0;
  const request=(async()=>{calls++;return response({});}) as typeof fetch;
  await expect(fixture(request,store).api.resumeUpload(input,other,()=>{})).rejects.toMatchObject({code:'different_file'});
  const otherAccount=candidateApi({accountId:foreign,token:async()=>'token',signal:new AbortController().signal,store,request});
  await expect(otherAccount.resumeUpload(input,correct,()=>{})).rejects.toMatchObject({code:'resume_unavailable'});expect(calls).toBe(0);
 });
 it('recognizes a completed upload after an unconfirmed response without completing it again',async()=>{
  const store=new MemoryStore(),file=new File(['abc'],'synthetic.mp4'),book=new RequestBook(account,store);book.rememberUpload(input,await bytesSha(await file.arrayBuffer()));
  const requests:string[]=[],f=fixture((async(path,init)=>{requests.push((init?.method??'GET')+' '+String(path));return response({id:input,size:file.size,offset:file.size,state:'queued'});}) as typeof fetch,store);
  expect((await f.api.resumeUpload(input,file,()=>{})).state).toBe('queued');expect(requests).toEqual(['GET /api/cloud/uploads/'+input]);
 });
 it('rejects an inconsistent completion response and preserves the upload identity for a retry',async()=>{
  const store=new MemoryStore(),file=new File(['abc'],'synthetic.mp4'),book=new RequestBook(account,store);book.rememberInput(input);book.rememberUpload(input,await bytesSha(await file.arrayBuffer()));
  let completed=false;const f=fixture((async(path,init)=>{
   if(String(path).endsWith('/complete')){completed=true;return response({id:foreign,size:file.size,offset:file.size,state:'queued'},202);}
   return response({id:input,size:file.size,offset:file.size,state:completed?'queued':'uploading'});
  }) as typeof fetch,store);
  await expect(f.api.resumeUpload(input,file,()=>{})).rejects.toMatchObject({code:'response_unconfirmed'});expect(book.input()).toBe(input);
  expect((await f.api.resumeUpload(input,file,()=>{})).state).toBe('queued');
 });
 it('rejects unconfirmed offsets without sending the next chunk',async()=>{
  let chunks=0;const f=fixture((async(path,init)=>{if(String(path).includes('/chunks?')){chunks++;return response({id:input,offset:1,state:'uploading'});}return response({id:input,size:3,offset:0,state:'uploading'},init?.method==='POST'?201:200);}) as typeof fetch);
  await expect(f.api.upload(new File(['abc'],'synthetic.mp4'),()=>{})).rejects.toMatchObject({code:'invalid_offset'});expect(chunks).toBe(1);
 });
 it('verifies authenticated result size, MIME, no-store and SHA before returning a Blob',async()=>{
  const bytes=new TextEncoder().encode('Synthetic translated text.'),sha256=await bytesSha(bytes.buffer),entry={name:'translation-en.txt',mimeType:'text/plain; charset=utf-8',size:bytes.length,sha256},job={id:jobId,results:[entry]} as Job;
  const f=fixture((async()=>new Response(bytes,{headers:{'Content-Type':entry.mimeType,'Cache-Control':'no-store'}})) as typeof fetch);expect(await(await f.api.result(job,entry)).text()).toBe('Synthetic translated text.');
  const bad=fixture((async()=>new Response(new TextEncoder().encode('wrong'),{headers:{'Content-Type':entry.mimeType,'Cache-Control':'no-store'}})) as typeof fetch);await expect(bad.api.result(job,entry)).rejects.toMatchObject({code:'invalid_result'});
 });
 it('rejects unbounded or non-private result metadata before download',async()=>{
  let calls=0;const f=fixture((async()=>{calls++;return response({});}) as typeof fetch),entry={name:'narration-en.wav',mimeType:'audio/wav',size:33*1024*1024,sha256:'a'.repeat(64)},job={id:jobId,results:[entry]} as Job;
  await expect(f.api.result(job,entry)).rejects.toMatchObject({code:'invalid_result'});expect(calls).toBe(0);
 });
 it('drops the last input only after server confirms deletion',async()=>{
  let fail=true;const f=fixture((async()=>fail?response({},500):response({id:input,state:'deleting'},202)) as typeof fetch);f.api.book.rememberInput(input);await expect(f.api.remove(input)).rejects.toMatchObject({status:500});expect(f.api.book.input()).toBe(input);fail=false;await f.api.remove(input);expect(f.api.book.input()).toBeNull();
 });
 it('rejects a public/cacheable response and cancels an oversized stream before any Blob is published',async()=>{
  const entry={name:'translation-en.txt',mimeType:'text/plain; charset=utf-8',size:3,sha256:'a'.repeat(64)},job={id:jobId,results:[entry]} as Job;
  const cacheable=fixture((async()=>new Response('abc',{headers:{'Content-Type':entry.mimeType,'Cache-Control':'public'}})) as typeof fetch);await expect(cacheable.api.result(job,entry)).rejects.toMatchObject({code:'invalid_result'});
  let cancelled=false;const oversized=fixture((async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4));},cancel(){cancelled=true;}}),{headers:{'Content-Type':entry.mimeType,'Cache-Control':'no-store'}})) as typeof fetch);
  await expect(oversized.api.result(job,entry)).rejects.toMatchObject({code:'invalid_result'});expect(cancelled).toBe(true);
 });
 it('does not confuse a pending revision after reload with a newly edited project revision',()=>{
  const store=new MemoryStore(),first=new RequestBook(account,store),oldKey=first.key(input,'translation:en',1);first.pending(input,'translation:en',1);
  const reloaded=new RequestBook(account,store);expect(reloaded.pending(input,'translation:en')).toBe(1);expect(reloaded.key(input,'translation:en',reloaded.pending(input,'translation:en')!)).toBe(oldKey);expect(reloaded.key(input,'translation:en',2)).not.toBe(oldKey);
 });
 it('retires an upload key only after confirmed delete, with no new upload until the next explicit call',async()=>{
  const file=new File(['synthetic'],'synthetic.mp4'),digest=await bytesSha(await file.arrayBuffer()),keys:string[]=[];let uploadPosts=0;
  const f=fixture((async(path,init)=>{if(init?.method==='DELETE')return response({id:input,state:'deleting'},202);if(String(path)==='/api/cloud/uploads'){uploadPosts++;keys.push(JSON.parse(String(init?.body)).requestKey);return response({id:input,state:'queued',offset:file.size,size:file.size},201);}return response({id:input,state:'queued',offset:file.size,size:file.size});}) as typeof fetch);
  await f.api.upload(file,()=>{});const before=f.api.book.key(digest,'upload',0);await f.api.remove(input);expect(uploadPosts).toBe(1);await f.api.upload(file,()=>{});expect(uploadPosts).toBe(2);expect(keys[0]).toBe(before);expect(keys[1]).not.toBe(before);
 });
 it('does not erase a newer same-file request when an older deletion resolves late',()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store),digest='c'.repeat(64),newInput='20000000-0000-4000-8000-000000000002';
  const original=book.key(digest,'upload',0);book.rememberInput(input);book.rememberUpload(input,digest,original);
  const slot=[...store.data.keys()].find(key=>key.includes('request:'+digest+':upload:0'))!;
  const newer='40000000-0000-4000-8000-000000000001';expect(newer).not.toBe(original);
  store.setItem(slot,newer);book.rememberInput(newInput);book.rememberUpload(newInput,digest,newer);
  book.retireUpload(input);
  expect(book.key(digest,'upload',0)).toBe(newer);expect(book.input()).toBe(newInput);expect(book.uploadDigest(newInput)).toBe(digest);
 });
 it('binds an older upload to the key sent, even if another tab changes the slot before its response',()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store),digest='e'.repeat(64);
  const sent=book.key(digest,'upload',0),slot='vistavo-candidate-v1:'+account+':request:'+digest+':upload:0';
  const newer='40000000-0000-4000-8000-000000000003';store.setItem(slot,newer);
  book.rememberInput(input);book.rememberUpload(input,digest,sent);book.retireUpload(input);
  expect(book.key(digest,'upload',0)).toBe(newer);
 });
 it('preserves an unbound legacy key even when the old input pointer reappears',()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store),digest='d'.repeat(64),slot='vistavo-candidate-v1:'+account+':request:'+digest+':upload:0';
  const newKey='40000000-0000-4000-8000-000000000002';store.setItem(slot,newKey);store.setItem('vistavo-candidate-v1:'+account+':upload:'+input,digest);book.rememberInput(input);
  expect(book.retireUpload(input)).toBe(false);expect(book.key(digest,'upload',0)).toBe(newKey);expect(book.input()).toBeNull();
 });
 for(const failure of ['http500','lost-response','abort','wrong-id','wrong-status'])it('preserves upload identity on ambiguous delete: '+failure,async()=>{
  const digest='b'.repeat(64),controller=new AbortController();const f=fixture((async()=>{if(failure==='http500')return response({},500);if(failure==='wrong-status')return response({id:input,state:'deleting'},200);if(failure==='wrong-id')return response({id:foreign,state:'deleting'},202);if(failure==='abort')controller.abort();throw TypeError('response lost');}) as typeof fetch,new MemoryStore(),controller);
  const original=f.api.book.key(digest,'upload',0);f.api.book.rememberInput(input);f.api.book.rememberUpload(input,digest,original);await expect(f.api.remove(input)).rejects.toThrow();expect(f.api.book.input()).toBe(input);expect(new RequestBook(account,f.store).key(digest,'upload',0)).toBe(original);
 });
 it('blocks generation and new saves after lost save ACK until manual authoritative reload; never bumps revision automatically',async()=>{
  let puts=0,posts=0;const f=fixture((async(path,init)=>{if(init?.method==='PUT'){puts++;throw TypeError('committed, ACK lost');}if(init?.method==='POST'){posts++;return response({id:jobId},202);}return response({revision:2,draft:'Server confirmed English.'});}) as typeof fetch);
  await expect(f.api.save(input,1,'Server confirmed English.')).rejects.toMatchObject({code:'response_unconfirmed'});expect(f.api.book.savePending(input)).toBe(1);
  await expect(f.api.save(input,1,'Local unsaved edits.')).rejects.toMatchObject({code:'save_unconfirmed'});await expect(f.api.start(input,'narration:en:female',1)).rejects.toMatchObject({code:'save_unconfirmed'});expect(()=>f.api.quote(input,'translation:en',1)).toThrow();expect(puts).toBe(1);expect(posts).toBe(0);
  // An ordinary read does not silently unlock the save barrier.
  expect((await f.api.project(input)).revision).toBe(2);expect(f.api.book.savePending(input)).toBe(1);
  expect(await f.api.reloadProject(input)).toMatchObject({revision:2,draft:'Server confirmed English.'});expect(f.api.book.savePending(input)).toBeUndefined();expect(puts).toBe(1);
  await f.api.start(input,'narration:en:female',2);expect(posts).toBe(1);
 });
 it('keeps the save barrier across reload and failed manual reads, clearing only confirmed project absence',async()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store);book.savePending(input,0);let unavailable=true;
  const f=fixture((async()=>response({},unavailable?500:404)) as typeof fetch,store);await expect(f.api.reloadProject(input)).rejects.toMatchObject({status:500});expect(new RequestBook(account,store).savePending(input)).toBe(0);unavailable=false;expect(await f.api.reloadProject(input)).toBeNull();expect(book.savePending(input)).toBeUndefined();
 });
 it('blocks all operation panels when any job is UNKNOWN, including a different voice',()=>{
  expect(hasUnknown({'translation:en':{state:'succeeded'} as Job,'narration:en:female':{state:'unknown'} as Job})).toBe(true);expect(hasUnknown({'translation:en':{state:'queued'} as Job})).toBe(false);
  expect(hasUnknown({'translation:en':{state:'succeeded',billingState:'review'} as Job,'narration:en:female':{state:'succeeded',billingState:'settled'} as Job})).toBe(true);
  expect(hasUnknown({'translation:en':{state:'succeeded',billingState:'settled'} as Job})).toBe(false);
 });
 it('retains review references across deletion and account reload without storing text or credentials',()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store);book.rememberInput(input);book.rememberJob(input,'translation:en',jobId);
  expect(book.rememberReview(input,'translation:en',jobId)).toEqual([{inputId:input,jobId,operation:'translation:en'}]);
  book.rememberReview(input,'translation:en',jobId);book.retireUpload(input);
  expect(new RequestBook(account,store).reviewReferences()).toEqual([{inputId:input,jobId,operation:'translation:en'}]);
  expect(new RequestBook(foreign,store).reviewReferences()).toEqual([]);expect(JSON.stringify([...store.data])).not.toMatch(/token|draft|Synthetic/);
 });
 it('serializes review-reference writes from two local clients on the account lock',async()=>{
  const store=new MemoryStore(),lock=new SerialLock(),controller=new AbortController(),otherJob='30000000-0000-4000-8000-000000000002';
  const options={accountId:account,token:async()=>'synthetic-token',signal:controller.signal,store,request:(async()=>response({})) as typeof fetch,lock};
  let entered!:()=>void,release!:()=>void;const locked=new Promise<void>(resolve=>{entered=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;});
  const held=lock.request('fixture',controller.signal,async()=>{entered();await wait;});await locked;
  const one=candidateApi(options).rememberReview(input,'translation:en',jobId),two=candidateApi(options).rememberReview(input,'narration:en:female',otherJob);
  await new Promise(resolve=>setTimeout(resolve,0));expect(new RequestBook(account,store).reviewReferences()).toEqual([]);release();await held;await Promise.all([one,two]);
  expect(new RequestBook(account,store).reviewReferences().map(item=>item.jobId).sort()).toEqual([jobId,otherJob].sort());
 });
 it('allows access withdrawal during an unconfirmed cancellation while keeping its marker and review reference',async()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store);book.rememberInput(input);book.rememberJob(input,'translation:en',jobId);book.markCancel(input,jobId);
  const f=fixture((async(path,init)=>{expect(String(path)).toBe('/api/cloud/uploads/'+input);expect(init?.method).toBe('DELETE');return response({id:input,state:'deleting'},202);}) as typeof fetch,store);
  const removed=await f.api.remove(input);expect(removed.pendingReferenceRetained).toBe(true);expect(book.cancelPending(input)).toBe(jobId);
  expect(book.input()).toBeNull();expect(book.reviewReferences()).toEqual([{inputId:input,operation:'translation:en',jobId}]);
 });
 it('allows access withdrawal even if the reference cannot be saved, and reports that limitation',async()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store);book.rememberInput(input);book.markCancel(input,jobId);
  const original=store.setItem.bind(store);store.setItem=(key,value)=>{if(key.endsWith('review-references'))throw Error('synthetic storage failure');original(key,value);};let calls=0;
  const f=fixture((async()=>{calls++;return response({id:input,state:'deleting'},202);}) as typeof fetch,store);
  const removed=await f.api.remove(input);expect(removed.pendingReferenceRetained).toBe(false);expect(calls).toBe(1);expect(book.cancelPending(input)).toBe(jobId);
 });
 it('preserves a corrupt local review index while allowing the user to revoke access',async()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store),slot='vistavo-candidate-v1:'+account+':review-references';book.rememberInput(input);book.markCancel(input,jobId);store.setItem(slot,'{invalid');
  expect(()=>book.reviewReferences()).toThrow();const f=fixture((async()=>response({id:input,state:'deleting'},202)) as typeof fetch,store);
  const removed=await f.api.remove(input);expect(removed.pendingReferenceRetained).toBe(false);expect(store.getItem(slot)).toBe('{invalid');expect(book.cancelPending(input)).toBe(jobId);
 });
 it('preserves pending cancellation while billing needs review and blocks another DELETE until a later clear read',async()=>{
  const store=new MemoryStore();let state='succeeded',billingState='review',deletes=0;
  const job=()=>({id:jobId,inputId:input,operation:'translation:en',state,billingState,billing:{mode:'account_seconds',unit:'video_seconds'},revision:1,stale:false,units:3,results:[]});
  const f=cancellationFixture((async(_path,init)=>{if(init?.method==='DELETE')deletes++;return response(job());}) as typeof fetch,store);
  f.api.book.rememberInput(input);
  expect((await f.api.cancel(input,jobId)).billingState).toBe('review');expect(f.api.book.cancelPending(input)).toBe(jobId);
  expect((await f.api.resolveCancellation(input,jobId)).billingState).toBe('review');expect(f.api.book.cancelPending(input)).toBe(jobId);
  await expect(f.api.cancel(input,jobId)).rejects.toMatchObject({code:'needs_review'});expect(deletes).toBe(1);
  state='cancelled';billingState='settled';expect((await f.api.resolveCancellation(input,jobId)).state).toBe('cancelled');expect(f.api.book.cancelPending(input)).toBeNull();
 });
 it('keeps a per-job review barrier across reload for missing, pending and simulated billing states',async()=>{
  for(const next of [undefined,'pending','simulated']){
   const store=new MemoryStore(),book=new RequestBook(account,store);book.rememberJob(input,'translation:en',jobId);let state:unknown='review',quotes=0,posts=0;
   const request=(async(path,init)=>{if(String(path).endsWith('/'+jobId))return response({id:jobId,inputId:input,operation:'translation:en',state:'succeeded',results:[],...(state===undefined?{}:{billingState:state})});if(init?.method==='POST')posts++;else quotes++;return response({id:jobId});}) as typeof fetch;
   const first=fixture(request,store);expect((await first.api.job(jobId)).billingState).toBe('review');expect(book.reviewMark(jobId)?.inputId).toBe(input);
   state=next;const reopened=fixture(request,store),current=await reopened.api.job(jobId);expect(current.localBillingReview).toBe(true);expect(hasUnknown({'translation:en':current})).toBe(true);
   expect(()=>reopened.api.quote(input,'translation:en',1)).toThrow();await expect(reopened.api.start(input,'translation:en',1)).rejects.toMatchObject({code:'needs_review'});expect(quotes).toBe(0);expect(posts).toBe(0);
   state='settled';expect((await reopened.api.job(jobId)).billingState).toBe('settled');await reopened.api.quote(input,'translation:en',1);expect(quotes).toBe(1);expect(book.reviewMark(jobId)?.inputId).toBe(input);
  }
 });
 it('does not let another tab clear a review with a status request that started before the review',async()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store);book.rememberJob(input,'translation:en',jobId);let release!:(response:Response)=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;}),job=(billingState:'review'|'settled')=>({id:jobId,inputId:input,operation:'translation:en',state:'succeeded',billingState,results:[]});
  let delay=true;const request=(async(path)=>{if(!String(path).endsWith('/'+jobId))return response({});if(delay){delay=false;entered();return await new Promise<Response>(resolve=>{release=resolve;});}return response(job('settled'));}) as typeof fetch;
  const older=fixture(request,store),other=fixture((async()=>response(job('review'))) as typeof fetch,store);
  const read=older.api.job(jobId);await waiting;await other.api.job(jobId);release(response(job('settled')));
  expect((await read).localBillingReview).toBe(true);expect(()=>older.api.quote(input,'translation:en',1)).toThrow();
  expect((await older.api.job(jobId)).billingState).toBe('settled');await older.api.quote(input,'translation:en',1);
  await other.api.job(jobId);expect(()=>older.api.quote(input,'translation:en',1)).toThrow();
 });
 it('keeps review blocked in the current session and reports failed persistence',async()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store);book.rememberJob(input,'translation:en',jobId);const set=store.setItem.bind(store);
  store.setItem=(key,value)=>{if(key.includes(':review-mark:'))throw Error('synthetic storage unavailable');set(key,value);};let billingState='review',quotes=0;
  const f=fixture((async(path)=>{if(String(path).endsWith('/'+jobId))return response({id:jobId,inputId:input,operation:'translation:en',state:'succeeded',billingState,results:[]});quotes++;return response({});}) as typeof fetch,store);
  const job=await f.api.job(jobId);expect(job.reviewPersistenceFailed).toBe(true);expect(hasUnknown({'translation:en':job})).toBe(true);expect(()=>f.api.quote(input,'translation:en',1)).toThrow();
  billingState='pending';expect((await f.api.job(jobId)).localBillingReview).toBe(true);expect(()=>f.api.quote(input,'translation:en',1)).toThrow();expect(quotes).toBe(0);
 });
 it('fails closed when a saved review marker is corrupt or belongs to a different input',async()=>{
  for(const raw of ['{invalid',JSON.stringify({inputId:foreign,version:'40000000-0000-4000-8000-000000000001'})]){
   const store=new MemoryStore(),book=new RequestBook(account,store);book.rememberJob(input,'translation:en',jobId);store.setItem('vistavo-candidate-v1:'+account+':review-mark:'+jobId,raw);let calls=0;
   const f=fixture((async()=>{calls++;return response({id:jobId,inputId:input,operation:'translation:en',state:'succeeded',billingState:'settled',results:[]});}) as typeof fetch,store);
   await expect(async()=>await f.api.job(jobId)).rejects.toThrow();expect(()=>f.api.quote(input,'translation:en',1)).toThrow();expect(store.getItem('vistavo-candidate-v1:'+account+':review-mark:'+jobId)).toBe(raw);
  }
 });
 it('does not return an obsolete cancellation response when review arrives while waiting for the local lock',async()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store),lock=new SerialLock(),controller=new AbortController();book.rememberInput(input);book.markCancel(input,jobId);
  let entered!:()=>void,release!:()=>void,read!:()=>void,releaseRead!:()=>void;const locked=new Promise<void>(resolve=>{entered=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;}),firstRead=new Promise<void>(resolve=>{read=resolve;}),waitRead=new Promise<void>(resolve=>{releaseRead=resolve;});
  let reads=0;const request=(async()=>{reads++;const first=reads===1;if(first){read();await waitRead;}return response({id:jobId,inputId:input,operation:'translation:en',state:'succeeded',billingState:first?'settled':'review',revision:1,stale:false,units:3,results:[]});}) as typeof fetch;
  const api=candidateApi({accountId:account,token:async()=>'synthetic-id-token',signal:controller.signal,store,request,lock});
  const previous=api.resolveCancellation(input,jobId);await firstRead;const held=lock.request('fixture',controller.signal,async()=>{entered();await wait;});await locked;releaseRead();await new Promise(resolve=>setTimeout(resolve,0));expect((await api.job(jobId)).billingState).toBe('review');
  release();await held;await expect(previous).rejects.toMatchObject({code:'stale_job_response'});expect(book.cancelPending(input)).toBe(jobId);
 });
 it('keeps cancellation pending if another tab records review while confirmation is saved',async()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store);book.rememberInput(input);book.rememberJob(input,'translation:en',jobId);book.markCancel(input,jobId);
  const remove=store.removeItem.bind(store);let injected=false;store.removeItem=key=>{if(!injected&&key.endsWith(':cancel:'+input)){injected=true;book.markReview(input,jobId);}remove(key);};
  const f=cancellationFixture((async()=>response({id:jobId,inputId:input,operation:'translation:en',state:'cancelled',billingState:'settled',billing:{mode:'account_seconds',unit:'video_seconds'},results:[]})) as typeof fetch,store);
  await expect(f.api.resolveCancellation(input,jobId)).rejects.toMatchObject({code:'stale_job_response'});expect(injected).toBe(true);expect(book.cancelPending(input)).toBe(jobId);
 });
 it('reopens a locally confirmed cancellation when a newer review is observed and rechecks settlement before clearing it',async()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store);book.rememberInput(input);book.rememberJob(input,'translation:en',jobId);let billingState='settled';
  const f=cancellationFixture((async()=>response({id:jobId,inputId:input,operation:'translation:en',state:'cancelled',billingState,billing:{mode:'account_seconds',unit:'video_seconds'},results:[]})) as typeof fetch,store);
  await f.api.cancel(input,jobId);expect(book.cancelPending(input)).toBeNull();billingState='review';await f.api.job(jobId);expect(book.cancelPending(input)).toBe(jobId);
  billingState='settled';await f.api.resolveCancellation(input,jobId);expect(book.cancelPending(input)).toBeNull();billingState='review';await f.api.job(jobId);expect(book.cancelPending(input)).toBe(jobId);
 });
 it('keeps cancellation pending when its local confirmation cannot be saved',async()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store);book.rememberInput(input);book.markCancel(input,jobId);const set=store.setItem.bind(store);
  store.setItem=(key,value)=>{if(key.includes(':cancel-confirmed:'))throw Error('synthetic storage failure');set(key,value);};
  const f=cancellationFixture((async()=>response({id:jobId,inputId:input,operation:'translation:en',state:'cancelled',billingState:'settled',billing:{mode:'account_seconds',unit:'video_seconds'},results:[]})) as typeof fetch,store);
  await expect(f.api.resolveCancellation(input,jobId)).rejects.toThrow();expect(book.cancelPending(input)).toBe(jobId);
 });
 it('does not treat an empty corrupted cancellation marker as confirmed',async()=>{
  const store=new MemoryStore(),book=new RequestBook(account,store);store.setItem('vistavo-candidate-v1:'+account+':cancel:'+input,'');let posts=0;
  const f=fixture((async()=>{posts++;return response({id:jobId},202);}) as typeof fetch,store);expect(()=>book.cancelPending(input)).toThrow();
  await expect(f.api.start(input,'translation:en',1)).rejects.toThrow();expect(posts).toBe(0);
 });
 it('rejects older status replies after review and blocks quotes, starts, and results for the reviewed job',async()=>{
  const bytes=new TextEncoder().encode('abc'),sha256=await bytesSha(bytes.buffer),entry={name:'translation-en.txt',mimeType:'text/plain; charset=utf-8',size:3,sha256};
  const job=(billingState:'review'|'settled')=>({id:jobId,inputId:input,operation:'translation:en' as const,state:'succeeded',billingState,revision:1,stale:false,units:3,results:[entry]});
  let release!:(response:Response)=>void,reads=0,otherCalls=0;
  const f=fixture((async(path)=>{if(String(path).endsWith('/'+jobId)){reads++;if(reads===1)return await new Promise<Response>(resolve=>{release=resolve;});return response(job(reads===2?'review':'settled'));}otherCalls++;return response({});}) as typeof fetch);
  const stale=f.api.job(jobId);await new Promise(resolve=>setTimeout(resolve,0));expect((await f.api.job(jobId)).billingState).toBe('review');
  release(response(job('settled')));await expect(stale).rejects.toMatchObject({code:'stale_job_response'});
  expect(()=>f.api.quote(input,'translation:en',1)).toThrow();await expect(f.api.start(input,'translation:en',1)).rejects.toMatchObject({code:'needs_review'});
  await expect(f.api.result(job('settled'),entry)).rejects.toMatchObject({code:'needs_review'});expect(otherCalls).toBe(0);
  expect((await f.api.job(jobId)).billingState).toBe('settled');await f.api.quote(input,'translation:en',1);expect(otherCalls).toBe(1);
 });
 it('discards an in-flight result even if review appears and later clears before bytes arrive',async()=>{
  const bytes=new TextEncoder().encode('abc'),sha256=await bytesSha(bytes.buffer),entry={name:'translation-en.txt',mimeType:'text/plain; charset=utf-8',size:3,sha256};
  const job=(billingState:'review'|'settled')=>({id:jobId,inputId:input,operation:'translation:en' as const,state:'succeeded',billingState,revision:1,stale:false,units:3,results:[entry]});
  let release!:(response:Response)=>void,reads=0;
  const f=fixture((async(path)=>{if(String(path).includes('/results/'))return await new Promise<Response>(resolve=>{release=resolve;});return response(job(++reads===1?'review':'settled'));}) as typeof fetch);
  const pending=f.api.result(job('settled'),entry);await new Promise(resolve=>setTimeout(resolve,0));await f.api.job(jobId);await f.api.job(jobId);
  release(new Response(bytes,{headers:{'Content-Type':entry.mimeType,'Cache-Control':'no-store'}}));await expect(pending).rejects.toMatchObject({code:'needs_review'});
 });
 it('discards an in-flight quote if review appeared even when a subsequent read cleared it',async()=>{
  let release!:(response:Response)=>void,reads=0;const job=(billingState:'review'|'settled')=>({id:jobId,inputId:input,operation:'translation:en',state:'succeeded',billingState,results:[]});
  const f=fixture((async(path)=>String(path).includes('/quote?')?await new Promise<Response>(resolve=>{release=resolve;}):response(job(++reads===1?'review':'settled'))) as typeof fetch);
  const pending=f.api.quote(input,'translation:en',1);await new Promise(resolve=>setTimeout(resolve,0));await f.api.job(jobId);await f.api.job(jobId);release(response({units:3}));
  await expect(pending).rejects.toMatchObject({code:'needs_review'});
 });
 it('treats even a late review reply conservatively until a new status request completes',async()=>{
  let release!:(response:Response)=>void,reads=0;const job=(billingState:'review'|'settled')=>({id:jobId,inputId:input,operation:'translation:en',state:'succeeded',billingState,results:[]});
  const f=fixture((async(path)=>{if(!String(path).endsWith('/'+jobId))return response({units:3});if(++reads===1)return await new Promise<Response>(resolve=>{release=resolve;});return response(job('settled'));}) as typeof fetch);
  const delayed=f.api.job(jobId);await new Promise(resolve=>setTimeout(resolve,0));expect((await f.api.job(jobId)).billingState).toBe('settled');
  release(response(job('review')));expect((await delayed).billingState).toBe('review');expect(()=>f.api.quote(input,'translation:en',1)).toThrow();
  await f.api.job(jobId);await f.api.quote(input,'translation:en',1);
 });
 it('prevents the view from applying a once-valid response after a newer review was observed',async()=>{
  let reads=0;const f=fixture((async()=>response({id:jobId,inputId:input,operation:'translation:en',state:'succeeded',billingState:++reads===1?'settled':'review',results:[]})) as typeof fetch);
  const prior=await f.api.job(jobId),current=await f.api.job(jobId);expect(()=>f.api.assertCurrentJob(prior)).toThrow();expect(()=>f.api.assertCurrentJob(current)).not.toThrow();
 });
 it('fails closed on an unrecognized billing state while preserving legacy responses without that field',async()=>{
  let billingState:unknown='other';const f=fixture((async()=>response({id:jobId,inputId:input,operation:'translation:en',state:'succeeded',revision:1,results:[],...(billingState===undefined?{}:{billingState})})) as typeof fetch);
  await expect(f.api.job(jobId)).rejects.toMatchObject({code:'response_unconfirmed'});billingState=undefined;expect((await f.api.job(jobId)).state).toBe('succeeded');
 });
 it('accepts the exact 600-character draft but blocks oversized programmatic content without HTTP or a pending save',async()=>{
  expect(MAX_DRAFT_CHARS).toBe(600);expect(draftWithinPilotLimit('x'.repeat(600))).toBe(true);expect(draftWithinPilotLimit('x'.repeat(601))).toBe(false);
  let calls=0;const f=fixture((async(_path,init)=>{calls++;const body=JSON.parse(String(init?.body));return response({revision:body.expectedRevision+1,draft:body.draft});}) as typeof fetch);
  await expect(f.api.save(input,1,'x'.repeat(601))).rejects.toMatchObject({status:400,code:'pilot_draft_limit'});expect(calls).toBe(0);expect(f.api.book.savePending(input)).toBeUndefined();
  expect((await f.api.save(input,1,'x'.repeat(600))).revision).toBe(2);expect(calls).toBe(1);
 });
 it('does not create an AI request after server rejects the pilot quote with400',async()=>{
  let posts=0;const f=fixture((async(_path,init)=>{if(init?.method==='POST')posts++;return response({error:'invalid'},400);}) as typeof fetch);
  await expect(f.api.quote(input,'narration:en:female',1)).rejects.toMatchObject({status:400});expect(posts).toBe(0);expect(f.api.book.pending(input,'narration:en:female')).toBeUndefined();
 });
});
