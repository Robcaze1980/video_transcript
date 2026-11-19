import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { ReviewedTranslationFault } from './firestoreReviewedTranslation';
import { reviewedTranslationHttp, type ReviewedTranslationCaller, type ReviewedTranslationHttpService } from './reviewedTranslationHttp';

const accountId=randomUUID(),uid='synthetic-firebase-user',jobId=randomUUID(),inputId=randomUUID(),cueId='a'.repeat(64);
const path=`/api/cloud/ai/jobs/${jobId}/review`,caller:ReviewedTranslationCaller={accountId,uid};
let server:Server,origin:string,activeCaller:ReviewedTranslationCaller=caller;
const service={
  readSource:vi.fn(async()=>({projectRevision:1,jobRevision:1,durationMs:2000,status:'original',cues:[{id:cueId,es:'Bomba',en:'Pump'}]})),
  saveReview:vi.fn(async()=>({committedRevision:2})),
  downloadReview:vi.fn(async(_principal:ReviewedTranslationCaller,request:unknown)=>({revision:2,mime:(request as {format:string}).format==='txt'?'text/plain; charset=utf-8':'application/x-subrip; charset=utf-8',bytes:Buffer.from('Synthetic review\n')})),
} satisfies ReviewedTranslationHttpService;

beforeAll(async()=>{
 server=createServer(async(req,res)=>{
  try{if(!await reviewedTranslationHttp(req,res,activeCaller,service)){res.writeHead(404,{'Cache-Control':'no-store'}).end();}}
  catch{res.writeHead(500).end();}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
beforeEach(()=>{vi.clearAllMocks();activeCaller=caller;});
const read=(query=`inputId=${inputId}`,method='GET')=>fetch(`${origin}${path}?${query}`,{method});
const save=(body:unknown,headers:Record<string,string>={})=>fetch(`${origin}${path}`,{method:'PUT',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const download=(query=`inputId=${inputId}&revision=2&format=txt`,method='GET')=>fetch(`${origin}${path}/download?${query}`,{method});
const valid=()=>({inputId,expectedRevision:1,requestKey:'synthetic-request',edits:[{id:cueId,en:'Water pump'}]});
const noCalls=()=>{expect(service.readSource).not.toHaveBeenCalled();expect(service.saveReview).not.toHaveBeenCalled();expect(service.downloadReview).not.toHaveBeenCalled();};

it('reads the structured review for the account provided by the router',async()=>{
 const response=await read();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');
 expect((await response.json()).cues[0].en).toBe('Pump');expect(service.readSource).toHaveBeenCalledExactlyOnceWith(caller,inputId,jobId);
});
it('saves exact edits, binding the job from the path and account from the caller',async()=>{
 const response=await save(valid());expect(response.status).toBe(200);expect(await response.json()).toEqual({committedRevision:2});
 expect(service.saveReview).toHaveBeenCalledExactlyOnceWith(caller,{...valid(),jobId});
});
it.each(['txt','srt'])('downloads %s with fixed filename, MIME, revision and no-store',async format=>{
 const response=await download(`format=${format}&inputId=${inputId}&revision=2`);expect(response.status).toBe(200);
 expect(response.headers.get('content-type')).toBe(format==='txt'?'text/plain; charset=utf-8':'application/x-subrip; charset=utf-8');
 expect(response.headers.get('content-disposition')).toBe(`attachment; filename="vistavo-translation.${format}"`);
 expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-vistavo-revision')).toBe('2');expect(await response.text()).toBe('Synthetic review\n');
 expect(service.downloadReview).toHaveBeenCalledExactlyOnceWith(caller,{inputId,jobId,revision:2,format});
});
it('HEAD validates and authorizes like download but sends no bytes',async()=>{
 const response=await download(undefined,'HEAD');expect(response.status).toBe(200);expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength('Synthetic review\n')));expect(await response.text()).toBe('');expect(service.downloadReview).toHaveBeenCalledTimes(1);
});

describe('route, query and identity boundaries',()=>{
 it.each(['',`inputId=${inputId}&inputId=${inputId}`,`inputId=${inputId}&uid=stolen`,`inputId=${inputId}&accountId=${randomUUID()}`,'inputId=wrong',`inputId=${inputId}&text=private`])('rejects read query %s',async query=>{
  const response=await read(query);expect(response.status).toBe(400);expect(response.headers.get('cache-control')).toBe('no-store');noCalls();
 });
 it.each([`inputId=${inputId}&revision=2&format=wav`,`inputId=${inputId}&revision=0&format=txt`,`inputId=${inputId}&revision=02&format=txt`,`inputId=${inputId}&revision=9007199254740992&format=txt`,`inputId=${inputId}&revision=2&format=txt&uid=other`,`inputId=${inputId}&revision=2&format=txt&format=srt`])('rejects invalid download query %s',async query=>{
  expect((await download(query)).status).toBe(400);noCalls();
 });
 it('does not accept a query on save',async()=>{
  const response=await fetch(`${origin}${path}?uid=other`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(valid())});expect(response.status).toBe(400);noCalls();
 });
 it('rejects an oversized request target before invoking the service',async()=>{
  const response=await read(`inputId=${inputId}&text=${'x'.repeat(2100)}`);expect(response.status).toBe(414);noCalls();
 });
 it('returns 405 for an unsupported method and does not invoke the service',async()=>{
  const response=await fetch(`${origin}${path}?inputId=${inputId}`,{method:'DELETE'});expect(response.status).toBe(405);expect(response.headers.get('allow')).toBe('GET, PUT');noCalls();
 });
 it.each(['GET','HEAD'])('rejects a %s body before invoking the service',async method=>{
  const status=await new Promise<number>((resolve,reject)=>{
   const request=httpRequest(`${origin}${path}/download?inputId=${inputId}&revision=2&format=txt`,{method,headers:{'content-length':'1'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode!));});
   request.on('error',reject);request.end('x');
  });
  expect(status).toBe(400);noCalls();
 });
 it('does not claim unrelated or encoded routes',async()=>{
  expect((await fetch(`${origin}/api/cloud/ai/jobs/${jobId}/%72eview?inputId=${inputId}`)).status).toBe(404);noCalls();
 });
 it('rejects a malformed trusted caller before invoking the service',async()=>{
  activeCaller={accountId:'invalid',uid};const response=await read();expect(response.status).toBe(500);expect(await response.json()).toEqual({error:'internal'});noCalls();
 });
});

describe('save body',()=>{
 it.each([
  {...valid(),accountId:randomUUID()}, {...valid(),uid:'other'}, {...valid(),jobId:randomUUID()}, {...valid(),inputId:'bad'},
  {...valid(),expectedRevision:0}, {...valid(),expectedRevision:1.5}, {...valid(),requestKey:''}, {...valid(),edits:[]},
  {...valid(),edits:[{id:cueId,en:'ok',uid:'other'}]}, {...valid(),edits:[{id:'bad',en:'ok'}]},
  {...valid(),edits:[{id:cueId,en:'line\nbreak'}]}, {...valid(),edits:[{id:cueId,en:'x'.repeat(4097)}]},
  {...valid(),edits:[{id:cueId,en:'one'},{id:cueId,en:'two'}]},
 ])('rejects invalid or forged fields %#',async body=>{const response=await save(body);expect(response.status).toBe(400);noCalls();});
 it('rejects duplicate top-level keys even when one name is escaped',async()=>{
  const raw=`{"inputId":"${inputId}","\\u0069nputId":"${randomUUID()}","expectedRevision":1,"requestKey":"r","edits":[{"id":"${cueId}","en":"ok"}]}`;
  expect((await save(raw)).status).toBe(400);noCalls();
 });
 it('rejects duplicate nested keys and invalid JSON',async()=>{
  const raw=`{"inputId":"${inputId}","expectedRevision":1,"requestKey":"r","edits":[{"id":"${cueId}","en":"ok","en":"changed"}]}`;
  expect((await save(raw)).status).toBe(400);expect((await save('{')).status).toBe(400);noCalls();
 });
 it('rejects malformed UTF-8 rather than silently replacing bytes',async()=>{
  const response=await fetch(`${origin}${path}`,{method:'PUT',headers:{'content-type':'application/json'},body:Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d])});
  expect(response.status).toBe(400);noCalls();
 });
 it('enforces content type, encoding and total body limit',async()=>{
  expect((await save(valid(),{'content-type':'text/plain'})).status).toBe(415);
  expect((await save(valid(),{'content-encoding':'gzip'})).status).toBe(415);
  expect((await save('x'.repeat(400001))).status).toBe(413);noCalls();
 });
});

it.each([['invalid',400],['not_found',404],['conflict',409],['disabled',503],['unavailable',503]] as const)('maps %s without leaking internals',async(code,status)=>{
 service.readSource.mockRejectedValueOnce(new ReviewedTranslationFault(code));const response=await read();expect(response.status).toBe(status);expect(await response.json()).toEqual({error:code});
});
it('sanitizes unexpected service errors',async()=>{
 service.readSource.mockRejectedValueOnce(new Error('synthetic private internals'));const response=await read();expect(response.status).toBe(500);expect(await response.text()).toBe('{"error":"internal"}');
});
it('rejects a mismatched download from the service without reflecting it',async()=>{
 service.downloadReview.mockResolvedValueOnce({revision:3,mime:'text/html',bytes:Buffer.from('private')});const response=await download();expect(response.status).toBe(500);expect(await response.text()).toBe('{"error":"internal"}');
});
