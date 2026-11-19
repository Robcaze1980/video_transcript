import {createHash,randomUUID} from 'node:crypto';
import {Readable,Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {describe,expect,it} from 'vitest';
import {FirestoreFiles} from './firestoreFiles';
import {firestoreHttp} from './firestoreHttp';
import {objectPlan} from './privateObjectPlan';

type Ref={id:string;path:string;get:()=>Promise<unknown>};
type Mutation='none'|'removed'|'reassigned';
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
class ResponseBuffer extends Writable {
 statusCode=200;headersSent=false;headers:Record<string,string>={};parts:Buffer[]=[];
 setHeader(name:string,value:unknown){this.headers[name.toLowerCase()]=String(value);}
 writeHead(status:number,headers:Record<string,unknown>={}){this.statusCode=status;this.headersSent=true;for(const [key,value] of Object.entries(headers))this.setHeader(key,value);return this;}
 _write(chunk:Buffer,_encoding:BufferEncoding,done:(error?:Error|null)=>void){this.parts.push(Buffer.from(chunk));done();}
}
function fixture(mutation:Mutation,complete=false){
 const accountId=randomUUID(),other=randomUUID(),inputId=randomUUID(),uid='synthetic-upload-'+randomUUID(),bytes=Buffer.from('abcd');
 const identityPath='identities/'+sha(JSON.stringify(['firebase',uid])),uploadPath='uploads/'+inputId,expectedSha=sha(bytes);
 const plan=objectPlan(inputId,bytes.length,bytes.length),rows=new Map<string,Record<string,any>>([
  [identityPath,{uid,accountId}],['accounts/'+accountId,{storageReservedBytes:12,storageCommittedBytes:0,activeUploads:1}],
  [uploadPath,{id:inputId,accountId,name:'synthetic.mp4',size:bytes.length,expectedSha,expiresAtMs:Date.now()+60_000,
   chunkBytes:bytes.length,plan,state:'uploading',offset:complete?bytes.length:0,
   chunks:complete?[{index:0,size:bytes.length,sha256:expectedSha,generation:'2'}]:[],manifestSha:null,
   quotaHeld:12,quotaMode:'reserved',activeHeld:true,leaseToken:null,leaseUntil:null,attempts:0,receipt:null,failure:null,purgeState:'pending'}],
 ]);
 const snapshot=(reference:Pick<Ref,'id'|'path'>)=>{const value=rows.get(reference.path);return {exists:value!==undefined,id:reference.id,data:()=>value,get:(key:string)=>value?.[key]};};
 const root={collection:(name:string)=>({doc:(id:string):Ref=>{const reference={id,path:`${name}/${id}`};return {...reference,get:async()=>snapshot(reference)};}})};
 const db={runTransaction:async<T>(callback:(tx:any)=>Promise<T>):Promise<T>=>{
  const tx={get:async(reference:Ref)=>snapshot(reference),getAll:async(...references:Ref[])=>references.map(snapshot),
   create:(reference:Ref,value:Record<string,any>)=>{if(rows.has(reference.path))throw Error('duplicate synthetic row');rows.set(reference.path,value);},
   set:(reference:Ref,value:Record<string,any>)=>rows.set(reference.path,value),
   update:(reference:Ref,value:Record<string,any>)=>{const old=rows.get(reference.path);if(!old)throw Error('missing synthetic row');rows.set(reference.path,{...old,...value});}};
  return callback(tx);
 }};
 let objectWrites=0,nudges=0;
 const objects={putOnce:async(key:string,value:Buffer)=>{objectWrites++;return {key,size:value.length,generation:'2'};}};
 const files=new FirestoreFiles(db as never,root as never,objects as never,{chunkBytes:bytes.length});
 const backend={accountForUid:async()=>{if(mutation==='removed')rows.delete(identityPath);if(mutation==='reassigned')rows.set(identityPath,{uid,accountId:other});return accountId;}};
 const handler=firestoreHttp({origin:'http://127.0.0.1',backend:backend as never,files,
  nudgeFile:async()=>{nudges++;},identity:{verifyIdToken:async()=>({uid,email_verified:true}) as never}});
 return {accountId,inputId,bytes,rows,uploadPath,expectedSha,handler,get objectWrites(){return objectWrites;},get nudges(){return nudges;}};
}
async function call(c:ReturnType<typeof fixture>,operation:'status'|'begin'|'append'|'complete'){
 let method='GET',url='/api/cloud/uploads/'+c.inputId,payload=Buffer.alloc(0),contentType='';
 if(operation==='begin'){method='POST';url='/api/cloud/uploads';contentType='application/json';payload=Buffer.from(JSON.stringify({name:'new.mp4',size:c.bytes.length,sha256:c.expectedSha,requestKey:'synthetic'}));}
 if(operation==='append'){method='PUT';url+='/chunks?offset=0';contentType='application/octet-stream';payload=c.bytes;}
 if(operation==='complete'){method='POST';url+='/complete';contentType='application/json';payload=Buffer.from('{}');}
 const req=Readable.from(payload.length?[payload]:[]) as unknown as IncomingMessage;req.url=url;req.method=method;
 req.headers={authorization:'Bearer synthetic',...(contentType?{'content-type':contentType,'content-length':String(payload.length)}:{})};
 const res=new ResponseBuffer();await c.handler(req,res as unknown as ServerResponse);await finished(res);return res;
}
describe('upload authorization after the requester identity changes',()=>{
 it.each(['status','begin','append','complete'] as const)('allows the verified owner to use %s',async operation=>{
  const c=fixture('none',operation==='complete'),response=await call(c,operation);expect([200,201,202]).toContain(response.statusCode);
 });
 for(const mutation of ['removed','reassigned'] as const)for(const operation of ['status','begin','append','complete'] as const){
  it(`rejects ${operation} if the requester is ${mutation} before the operation`,async()=>{
   const c=fixture(mutation,operation==='complete'),before=structuredClone([...c.rows.entries()].filter(([key])=>!key.startsWith('identities/')));
   const response=await call(c,operation);
   expect(response.statusCode).toBe(404);
   expect([...c.rows.entries()].filter(([key])=>!key.startsWith('identities/'))).toEqual(before);
   expect(c.objectWrites).toBe(0);expect(c.nudges).toBe(0);
  });
 }
});
