import {randomUUID} from 'node:crypto';
import {Readable, Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import {describe,expect,it,vi} from 'vitest';
import {firestoreHttp} from './firestoreHttp';

// This separate routing test explicitly injects the optional generic quote.
// Current runtime candidates do not necessarily register that callback.
class SyntheticResponse extends Writable {
  headers:Record<string,string>={}; statusCode=200; parts:Buffer[]=[];
  setHeader(name:string,value:unknown){this.headers[name.toLowerCase()]=String(value);return this;}
  writeHead(status:number,headers:Record<string,unknown>={}){this.statusCode=status;for(const [name,value] of Object.entries(headers))this.setHeader(name,value);return this;}
  _write(chunk:Buffer,_encoding:BufferEncoding,callback:(error?:Error|null)=>void){this.parts.push(Buffer.from(chunk));callback();}
}
function fixture(prior:string|null=null){
  const account=randomUUID(),input=randomUUID(),uid='synthetic-generic-owner',job=randomUUID();
  const backend={accountForUid:vi.fn(async()=>account),priorRequestForUid:vi.fn(async()=>prior),
    readProjectForUid:vi.fn(async()=>({revision:1})),reserveForUid:vi.fn(async()=>job)};
  const quote=vi.fn(async()=>2),verify=vi.fn(async(token:string,checkRevoked?:boolean)=>{
    expect(token).toBe('synthetic-token');expect(checkRevoked).toBe(true);return {uid,email_verified:true};
  });
  const handler=firestoreHttp({backend:backend as never,identity:{verifyIdToken:verify as never},origin:'http://127.0.0.1',quote});
  const call=async(operation:string)=>{
    const bytes=Buffer.from(JSON.stringify({inputId:input,requestKey:randomUUID(),operation,expectedRevision:1}));
    const req:any=Readable.from([bytes]);req.url='/api/cloud/jobs';req.method='POST';
    req.headers={origin:'http://127.0.0.1',authorization:'Bearer synthetic-token','content-type':'application/json','content-length':String(bytes.length)};
    const res=new SyntheticResponse();await handler(req,res as never);await finished(res);
    return {status:res.statusCode,body:JSON.parse(Buffer.concat(res.parts).toString('utf8'))};
  };
  return {account,input,uid,job,backend,quote,verify,call};
}

describe('generic HTTP admission with an explicitly injected quote',()=>{
  it('keeps a text request available',async()=>{
    const f=fixture(),response=await f.call('translation:en');
    expect(response).toEqual({status:202,body:{id:f.job}});
    expect(f.verify).toHaveBeenCalledTimes(1);expect(f.quote).toHaveBeenCalledOnce();expect(f.backend.reserveForUid).toHaveBeenCalledOnce();
  });
  for(const operation of ['narration:en:female','narration:en:male'] as const){
    for(const replay of [false,true])it(`does not admit ${operation} with prior=${replay}`,async()=>{
      const f=fixture(replay?randomUUID():null),response=await f.call(operation);
      expect(response).toEqual({status:503,body:{error:'disabled'}});
      expect(f.verify).toHaveBeenCalledTimes(1);expect(f.quote).not.toHaveBeenCalled();expect(f.backend.reserveForUid).not.toHaveBeenCalled();
    });
  }
});
