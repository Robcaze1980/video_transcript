import {createHash, randomUUID} from 'node:crypto';
import {Readable, Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {describe, expect, it, vi} from 'vitest';
import {FirestoreFiles} from './firestoreFiles';
import {firestoreHttp} from './firestoreHttp';
import {objectPlan, privateBucket} from './privateObjectPlan';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
type Ref={id:string;path:string};

function fixture(){
 const accountId=randomUUID(),other=randomUUID(),inputId=randomUUID(),uid='synthetic-uid-'+randomUUID();
 const bytes=Buffer.from('synthetic video'),size=bytes.length,sha256=hash(bytes.toString()),plan=objectPlan(inputId,size,size);
 const object={key:plan.final,generation:'9007199254740993',size},video={duration:2,width:320,height:180,audioTracks:1},expiresAtMs=Date.now()+60_000;
 const identityPath='identities/'+hash(JSON.stringify(['firebase',uid]));
 const rows=new Map<string,Record<string,any>>([
  [identityPath,{uid,accountId}],
  ['uploads/'+inputId,{id:inputId,accountId,name:'synthetic.mp4',size,expectedSha:sha256,expiresAtMs,chunkBytes:size,plan,state:'ready',offset:size,
   chunks:[{index:0,size,sha256,generation:'2'}],manifestSha:hash('manifest'),quotaHeld:size,quotaMode:'committed',activeHeld:false,
   leaseToken:null,leaseUntil:null,attempts:1,receipt:{object,sha256,video,manifestSha:hash('manifest')},failure:null,purgeState:'pending'}],
  ['inputs/'+inputId,{accountId,expiresAtMs,sha256,deleted:false,ready:true,unknownCount:0,storage:{bucket:privateBucket,key:plan.final,generation:object.generation,size,sha256},metadata:video}],
  ['fileOutbox/'+inputId,{state:'done',nextAttemptAt:0,dispatchToken:null,dispatchLeaseUntil:null}],
 ]);
 const operations:Array<{reads:string[];writes:string[]}>=[];
 const root={collection:(name:string)=>({doc:(id:string):Ref=>({id,path:`${name}/${id}`})})};
 const db={runTransaction:async<T>(callback:(transaction:any)=>Promise<T>):Promise<T>=>{
  const log={reads:[] as string[],writes:[] as string[]};operations.push(log);
  const snapshot=(reference:Ref)=>{log.reads.push(reference.path);const row=rows.get(reference.path);return {exists:row!==undefined,data:()=>row,get:(key:string)=>row?.[key]};};
  const tx={get:async(reference:Ref)=>snapshot(reference),getAll:async(...references:Ref[])=>references.map(snapshot),
   update:(reference:Ref,patch:Record<string,unknown>)=>{const previous=rows.get(reference.path);if(!previous)throw Error('Synthetic missing document');log.writes.push(reference.path);rows.set(reference.path,{...previous,...patch});},
   set:(reference:Ref,value:Record<string,unknown>)=>{log.writes.push(reference.path);rows.set(reference.path,value);}};
  return callback(tx);
 }};
 return {accountId,other,inputId,uid,identityPath,object,rows,operations,files:new FirestoreFiles(db as never,root as never,{} as never,{chunkBytes:size})};
}

describe('private file requester identity',()=>{
 it('reads the UID binding and the owned file in one transaction before returning its object',async()=>{
  const c=fixture(),result=await c.files.downloadForUid(c.accountId,c.inputId,c.uid);
  expect(result.object).toEqual(c.object);expect(c.operations).toHaveLength(1);
  expect(c.operations[0].reads).toEqual([c.identityPath,'uploads/'+c.inputId,'inputs/'+c.inputId]);expect(c.operations[0].writes).toEqual([]);
 });
 it('verifies the binding before marking removal and even on a repeated request',async()=>{
  const c=fixture(),result=await c.files.removeForUid(c.accountId,c.inputId,c.uid);
  expect(result.state).toBe('deleting');expect(c.rows.get('inputs/'+c.inputId)).toMatchObject({deleted:true,ready:false});
  expect(c.operations[0].reads).toEqual([c.identityPath,'uploads/'+c.inputId,'inputs/'+c.inputId]);
  expect(c.operations[0].writes).toEqual(['uploads/'+c.inputId,'inputs/'+c.inputId,'fileOutbox/'+c.inputId]);
  c.rows.delete(c.identityPath);
  await expect(c.files.removeForUid(c.accountId,c.inputId,c.uid)).rejects.toMatchObject({code:'not_found'});
  expect(c.operations[1].writes).toEqual([]);
 });
 for(const method of ['downloadForUid','removeForUid'] as const){
  it.each(['missing','reassigned','mismatched_uid'] as const)(`${method} denies %s without touching file documents`,async mutation=>{
   const c=fixture();
   if(mutation==='missing')c.rows.delete(c.identityPath);
   if(mutation==='reassigned')c.rows.set(c.identityPath,{uid:c.uid,accountId:c.other});
   if(mutation==='mismatched_uid')c.rows.set(c.identityPath,{uid:'synthetic-other',accountId:c.accountId});
   await expect(c.files[method](c.accountId,c.inputId,c.uid)).rejects.toMatchObject({code:'not_found'});
   expect(c.operations).toHaveLength(1);expect(c.operations[0].reads).toEqual([c.identityPath]);expect(c.operations[0].writes).toEqual([]);
   expect(c.rows.get('inputs/'+c.inputId)).toMatchObject({deleted:false,ready:true});
  });
 }
 it('preserves explicitly trusted internal download and removal without a user mapping',async()=>{
  const c=fixture();c.rows.delete(c.identityPath);
  expect((await c.files.download(c.accountId,c.inputId)).object).toEqual(c.object);
  expect((await c.files.remove(c.accountId,c.inputId,'expired')).state).toBe('deleting');
  expect(c.rows.get('inputs/'+c.inputId)).toMatchObject({deleted:true,ready:false});
  expect(c.operations.flatMap(operation=>operation.reads)).not.toContain(c.identityPath);
 });
});

class ResponseBuffer extends Writable{
 headers:Record<string,string>={};statusCode=200;headersSent=false;parts:Buffer[]=[];
 setHeader(name:string,value:unknown){this.headers[name.toLowerCase()]=String(value);}
 writeHead(status:number,headers:Record<string,unknown>={}){this.statusCode=status;this.headersSent=true;for(const [key,value] of Object.entries(headers))this.setHeader(key,value);return this;}
 _write(chunk:Buffer,_encoding:BufferEncoding,done:(error?:Error|null)=>void){this.parts.push(Buffer.from(chunk));done();}
 get body(){return Buffer.concat(this.parts);}
}

describe('HTTP forwards the verified requester to private file operations',()=>{
 it.each(['GET','DELETE'] as const)('%s uses the UID from the verified token',async method=>{
  const accountId=randomUUID(),inputId=randomUUID(),uid='synthetic-verified-uid',bytes=Buffer.from('synthetic');
  const downloadForUid=vi.fn(async()=>({object:{key:'synthetic',generation:'1',size:bytes.length}}));
  const removeForUid=vi.fn(async()=>({id:inputId,state:'deleting'}));
  const read=vi.fn(async()=>Readable.from([bytes])),nudge=vi.fn(async()=>undefined);
  const handler=firestoreHttp({origin:'http://127.0.0.1',backend:{accountForUid:async()=>accountId} as never,
   identity:{verifyIdToken:async(_token,checkRevoked)=>{expect(checkRevoked).toBe(true);return {uid,email_verified:true} as never;}},
   files:{downloadForUid,removeForUid,objects:{read}} as never,nudgeFile:nudge});
  const req=Readable.from([]) as unknown as IncomingMessage;
  req.method=method;req.url='/api/cloud/uploads/'+inputId+(method==='GET'?'/content':'');req.headers={authorization:'Bearer synthetic',origin:'http://127.0.0.1'};
  const res=new ResponseBuffer();await handler(req,res as unknown as ServerResponse);await finished(res);
  if(method==='GET'){
   expect(res.statusCode).toBe(200);expect(res.body).toEqual(bytes);expect(downloadForUid).toHaveBeenCalledExactlyOnceWith(accountId,inputId,uid);
   expect(removeForUid).not.toHaveBeenCalled();expect(nudge).not.toHaveBeenCalled();
  }else{
   expect(res.statusCode).toBe(202);expect(removeForUid).toHaveBeenCalledExactlyOnceWith(accountId,inputId,uid);
   expect(downloadForUid).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(nudge).toHaveBeenCalledExactlyOnceWith(inputId,'cleanup');
  }
 });
});
