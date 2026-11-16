import {describe,it,expect} from 'vitest';
import {candidateApi,RequestBook,publicConfig,bytesSha,CHUNK_BYTES,hasUnknown,MAX_DRAFT_CHARS,draftWithinPilotLimit,type Store,type Job} from './cloudCandidateApi';
const account='10000000-0000-4000-8000-000000000001',foreign='10000000-0000-4000-8000-000000000002',input='20000000-0000-4000-8000-000000000001',jobId='30000000-0000-4000-8000-000000000001';
class MemoryStore implements Store {data=new Map<string,string>();getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,v);}removeItem(k:string){this.data.delete(k);}}
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture(request:typeof fetch,store:Store=new MemoryStore(),controller=new AbortController()){return {api:candidateApi({accountId:account,token:async()=>'synthetic-id-token',signal:controller.signal,store,request}),store,controller};}
describe('local cloud candidate durable requests and private transport',()=>{
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
  const f=fixture((async(path,init)=>{expect(String(path)).toBe('/api/cloud/ai/jobs/'+jobId);expect(String(path)).not.toContain('token');expect(init?.headers).toMatchObject({Authorization:'Bearer synthetic-id-token'});expect(init?.credentials).toBe('omit');expect(init?.redirect).toBe('error');return response({id:jobId,state:'unknown'});}) as typeof fetch);
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
 it('rejects unconfirmed offsets without sending the next chunk',async()=>{
  let chunks=0;const f=fixture((async(path,init)=>{if(String(path).includes('/chunks?')){chunks++;return response({id:input,offset:1,state:'uploading'});}return response({id:input,offset:0,state:'uploading'},init?.method==='POST'?201:200);}) as typeof fetch);
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
 for(const failure of ['http500','lost-response','abort','wrong-id','wrong-status'])it('preserves upload identity on ambiguous delete: '+failure,async()=>{
  const digest='b'.repeat(64),controller=new AbortController();const f=fixture((async()=>{if(failure==='http500')return response({},500);if(failure==='wrong-status')return response({id:input,state:'deleting'},200);if(failure==='wrong-id')return response({id:foreign,state:'deleting'},202);if(failure==='abort')controller.abort();throw TypeError('response lost');}) as typeof fetch,new MemoryStore(),controller);
  const original=f.api.book.key(digest,'upload',0);f.api.book.rememberInput(input);f.api.book.rememberUpload(input,digest);await expect(f.api.remove(input)).rejects.toThrow();expect(f.api.book.input()).toBe(input);expect(new RequestBook(account,f.store).key(digest,'upload',0)).toBe(original);
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
