import {createHash, randomUUID} from 'node:crypto';
import {Readable, Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {describe, expect, it} from 'vitest';
import {FirestoreBackend} from './firestoreBackend';
import {firestoreHttp} from './firestoreHttp';

type Ref={id:string;path:string};
type Mutation='none'|'removed'|'reassigned'|'foreign-project';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');

class ResponseBuffer extends Writable {
  statusCode=200;headersSent=false;parts:Buffer[]=[];headers:Record<string,string>={};
  setHeader(name:string,value:unknown){this.headers[name.toLowerCase()]=String(value);}
  writeHead(status:number,headers:Record<string,unknown>={}){this.statusCode=status;this.headersSent=true;for(const [key,value] of Object.entries(headers))this.setHeader(key,value);return this;}
  _write(chunk:Buffer,_encoding:BufferEncoding,done:(error?:Error|null)=>void){this.parts.push(Buffer.from(chunk));done();}
}

function candidate(mutation:Mutation){
  const accountId=randomUUID(),otherAccount=randomUUID(),inputId=randomUUID(),uid='synthetic-uid-'+randomUUID();
  const identityPath='identities/'+digest(JSON.stringify(['firebase',uid])),projectPath='projects/'+inputId;
  const rows=new Map<string,Record<string,unknown>>([
    [identityPath,{uid,accountId}],
    ['inputs/'+inputId,{accountId,deleted:false,expiresAtMs:Date.now()+60_000}],
    [projectPath,{accountId,inputId,revision:1,draft:'Synthetic old text'}],
  ]);
  const root={collection:(name:string)=>({doc:(id:string):Ref=>({id,path:`${name}/${id}`})})};
  const db={runTransaction:async<T>(callback:(tx:any)=>Promise<T>):Promise<T>=>{
    const snapshot=(reference:Ref)=>{const value=rows.get(reference.path);return {exists:value!==undefined,data:()=>value,get:(key:string)=>value?.[key]};};
    const tx={get:async(reference:Ref)=>snapshot(reference),getAll:async(...references:Ref[])=>references.map(snapshot),
      set:(reference:Ref,value:Record<string,unknown>)=>rows.set(reference.path,value)};
    return callback(tx);
  }};
  const backend=new FirestoreBackend(db as never,root as never);
  // Pause the request immediately after account lookup, then change only the
  // synthetic identity or project. The transaction sees the changed state.
  backend.accountForUid=async()=>{
    if(mutation==='removed')rows.delete(identityPath);
    if(mutation==='reassigned')rows.set(identityPath,{uid,accountId:otherAccount});
    if(mutation==='foreign-project')rows.set(projectPath,{accountId:otherAccount,inputId,revision:1,draft:'Synthetic foreign text'});
    return accountId;
  };
  const handler=firestoreHttp({origin:'http://127.0.0.1',backend,
    identity:{verifyIdToken:async()=>({uid,email_verified:true}) as never}});
  return {rows,projectPath,inputId,handler};
}

async function call(c:ReturnType<typeof candidate>,method:'GET'|'PUT'){
  const body=method==='PUT'?Buffer.from(JSON.stringify({expectedRevision:1,draft:'Synthetic new text'})):Buffer.alloc(0);
  const req=Readable.from(body.length?[body]:[]) as unknown as IncomingMessage;
  req.url='/api/cloud/projects/'+c.inputId;req.method=method;
  req.headers={authorization:'Bearer synthetic',...(method==='PUT'?{'content-type':'application/json','content-length':String(body.length)}:{})};
  const res=new ResponseBuffer();await c.handler(req,res as unknown as ServerResponse);await finished(res);return res;
}

describe('project identity and ownership at the private HTTP boundary',()=>{
  it('lets the verified owner read and save a project',async()=>{
    const c=candidate('none');expect((await call(c,'GET')).statusCode).toBe(200);
    expect((await call(c,'PUT')).statusCode).toBe(200);expect(c.rows.get(c.projectPath)?.draft).toBe('Synthetic new text');
  });
  it.each(['removed','reassigned'] as const)('does not read after identity is %s',async mutation=>{
    const c=candidate(mutation);expect((await call(c,'GET')).statusCode).toBe(404);
  });
  it.each(['removed','reassigned'] as const)('does not write after identity is %s',async mutation=>{
    const c=candidate(mutation);expect((await call(c,'PUT')).statusCode).toBe(404);
    expect(c.rows.get(c.projectPath)?.draft).toBe('Synthetic old text');
  });
  it('does not overwrite an existing project owned by another account',async()=>{
    const c=candidate('foreign-project');expect((await call(c,'PUT')).statusCode).toBe(404);
    expect(c.rows.get(c.projectPath)?.draft).toBe('Synthetic foreign text');
  });
});
