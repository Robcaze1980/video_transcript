import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';
import { expect, it } from 'vitest';
import { AccountStore } from '../account/backend';
import { accountHttp } from '../account/http';
import { AccountBillingClient, accountIdentityKey } from './accountBillingClient';

type Row=Record<string,unknown>;
type Ref={path:string;collection:(name:string)=>Collection};
type Collection={doc:(id:string)=>Ref};
type Snapshot={exists:boolean;get:(name:string)=>unknown;data:()=>Row|undefined};
type Transaction={
  get:(ref:Ref)=>Promise<Snapshot>;
  getAll:(...refs:Ref[])=>Promise<Snapshot[]>;
  create:(ref:Ref,data:Row)=>void;
  update:(ref:Ref,data:Row)=>void;
};

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const seconds=3,callKey='voice-chunk:0000',model='gemini-3.8-flash-tts',requestSha256='a'.repeat(64);
const reserveEmail='reserve@synthetic.invalid',workerEmail='worker@synthetic.invalid';

function changedPaths(before:Map<string,Row>,after:Map<string,Row>){
  return [...new Set([...before.keys(),...after.keys()])]
    .filter(path=>!isDeepStrictEqual(before.get(path),after.get(path))).sort();
}

async function fixture(compatibleB:boolean) {
  const uid='synthetic-admission-owner',identityKey=accountIdentityKey(uid);
  const ownerA=randomUUID(),ownerB=randomUUID(),reservationId=randomUUID(),jobId=randomUUID(),attemptId=randomUUID();
  const identityPath='identities/'+identityKey;
  const account=(credited:number)=>({identityKey,schemaVersion:1,unit:'video_seconds',credited,available:credited,
    reserved:0,consumed:0,active:0,activeProjectCount:0,createdAtMs:1});
  let rows=new Map<string,Row>([[identityPath,{uid,accountId:ownerA}],
    ['accounts/'+ownerA,account(20)],['accounts/'+ownerB,account(30)]]);
  const collection=(prefix:string):Collection=>({doc:id=>{
    const path=prefix+id;
    return {path,collection:name=>collection(path+'/'+name+'/')};
  }});
  let transactions=0;
  // Production AccountStore runs against a transaction-shaped double. Staged
  // writes publish only when the callback succeeds. No network or Firestore.
  const db={async runTransaction<T>(fn:(tx:Transaction)=>Promise<T>){
    transactions++;
    const staged=structuredClone(rows);
    const get:Transaction['get']=async ref=>{
      const value=staged.get(ref.path);
      return {exists:value!==undefined,get:name=>value?.[name],data:()=>value};
    };
    const result=await fn({get,getAll:(...refs)=>Promise.all(refs.map(get)),
      create(ref,data){
        if(staged.has(ref.path))throw Error('synthetic duplicate document');
        staged.set(ref.path,data);
      },
      update(ref,data){
        const previous=staged.get(ref.path);
        if(!previous)throw Error('synthetic missing document');
        staged.set(ref.path,{...previous,...data});
      },
    });
    rows=staged;
    return result;
  }};
  const store=new AccountStore(db as never,{collection:(name:string)=>collection(name+'/')} as never,()=>100);
  const handler=accountHttp(store,{async verifyIdToken(){throw Error('unexpected user authentication');}},undefined,{
    audience:'synthetic-account-service',allowedEmails:[reserveEmail,workerEmail],
    reservationCaller:reserveEmail,settlementCaller:workerEmail,
    verifier:{async verifyIdToken(token,audience){
      if(audience!=='synthetic-account-service'||!['fixture-reserve','fixture-worker'].includes(token))
        throw Error('unexpected synthetic service authentication');
      return {email:token==='fixture-reserve'?reserveEmail:workerEmail,email_verified:true};
    }},
  });
  const reservePath='/api/internal/video/reservations';
  const admitPath=reservePath+'/'+reservationId+'/admit';
  // Call the HTTP handler directly. The client's injected transport never
  // opens its production URL, creates a socket, or loads an auth credential.
  async function post(path:string,body:Row){
    const req=Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{url:path,method:'POST',
      headers:{authorization:'Bearer '+(path===reservePath?'fixture-reserve':'fixture-worker'),
        'content-type':'application/json'}});
    let status=0,data:unknown;
    const res={writeHead(value:number){status=value;},end(value:string){data=JSON.parse(value);}};
    await handler(req as unknown as IncomingMessage,res as unknown as ServerResponse);
    return {status,data};
  }
  let beforeAdmission:((body:Row)=>void|Promise<void>)|undefined;
  const client=new AccountBillingClient(undefined,{async request({url,data}){
    const path=new URL(url).pathname;
    if(path===admitPath&&beforeAdmission){
      const hook=beforeAdmission;
      beforeAdmission=undefined;
      await hook(structuredClone(data));
    }
    const response=await post(path,data);
    if(response.status>=400)throw {response};
    return {data:response.data};
  }});
  const reassign=(accountId:string)=>rows.set(identityPath,{uid,accountId});
  const reservedA=await client.reserve(identityKey,reservationId,seconds);
  if(compatibleB){
    // The handoff and compatible B reserve are deliberate fault premises.
    reassign(ownerB);
    await client.reserve(identityKey,reservationId,seconds);
    reassign(ownerA);
  }
  const reservationPath=(owner:string)=>'videoReservations/'+hash([owner,reservationId]);
  const receiptPath=(owner:string,key=callKey)=>reservationPath(owner)+'/providerCalls/'+hash(['provider-call-v2',key]);
  const fencePath=(owner:string)=>reservationPath(owner)+'/providerCallFences/first';
  const snapshot=()=>structuredClone(rows);
  const balances=()=>structuredClone([rows.get('accounts/'+ownerA),rows.get('accounts/'+ownerB)]);
  const ledger=()=>structuredClone([...rows].filter(([path])=>path.startsWith('ledgerEntries/')));
  const admit=(key=callKey,digest=requestSha256)=>client.admit(identityKey,reservationId,seconds,jobId,attemptId,key,model,digest);
  const requestBody={identityKey,seconds,jobId,attemptId,callKey,model,requestSha256};
  return {client,post,admit,admitPath,reservePath,reassign,snapshot,balances,ledger,transactions:()=>transactions,
    ownerA,ownerB,identityKey,reservationId,reservedA,reservationPath,receiptPath,fencePath,requestBody,
    intercept:(hook:NonNullable<typeof beforeAdmission>)=>{beforeAdmission=hook;}};
}

it.each([{compatibleB:false},{compatibleB:true}])('characterizes the legacy handoff with a compatible B reserve equal to $compatibleB',async({compatibleB})=>{
  const f=await fixture(compatibleB);
  const balanceBefore=f.balances(),ledgerBefore=f.ledger();
  const prior=f.snapshot();
  expect(f.reservedA).toMatchObject({reservationId:f.reservationId,seconds,state:'reserved',account:{id:f.ownerA}});
  expect(f.reservedA).not.toHaveProperty('originRef');
  const preflight=await f.client.status(f.identityKey,f.reservationId);
  let afterHandoff=prior;
  f.intercept(async body=>{
    expect(body).toEqual(f.requestBody);
    // Even a fresh read after constructing the POST precedes Account's write.
    expect(await f.client.status(f.identityKey,f.reservationId)).toEqual(preflight);
    expect(f.snapshot().get('identities/'+f.identityKey)).toMatchObject({accountId:f.ownerA});
    f.reassign(f.ownerB);
    afterHandoff=f.snapshot();
  });
  if(compatibleB){
    const ack=await f.admit();
    expect(ack).toEqual({reservationId:f.reservationId,seconds,jobId:f.requestBody.jobId,
      attemptId:f.requestBody.attemptId,callKey,model,requestSha256,created:true,receiptOnly:false});
    const written=f.snapshot();
    expect(written.get(f.reservationPath(f.ownerA))).toEqual(prior.get(f.reservationPath(f.ownerA)));
    expect(written.has(f.receiptPath(f.ownerA))).toBe(false);
    expect(written.has(f.fencePath(f.ownerA))).toBe(false);
    expect(written.get(f.receiptPath(f.ownerB))).toMatchObject({ownerAccountId:f.ownerB,jobId:ack.jobId,requestSha256});
    expect(written.get(f.fencePath(f.ownerB))).toEqual(written.get(f.receiptPath(f.ownerB)));
    expect(changedPaths(afterHandoff,written)).toEqual([f.reservationPath(f.ownerB),f.receiptPath(f.ownerB),f.fencePath(f.ownerB)].sort());
    // The wire observation also fails to distinguish the two reserved rows.
    expect(await f.client.status(f.identityKey,f.reservationId)).toEqual(preflight);
  }else{
    await expect(f.admit()).rejects.toMatchObject({code:'not_found'});
    expect(f.snapshot()).toEqual(afterHandoff);
  }
  expect(f.balances()).toEqual(balanceBefore);
  expect(f.ledger()).toEqual(ledgerBefore);
});

it('returns receiptOnly for a stable owner but creates again under B for the same wire request after handoff',async()=>{
  const f=await fixture(true),balanceBefore=f.balances(),ledgerBefore=f.ledger();
  const first=await f.admit(),atA=f.snapshot();
  expect(first.created).toBe(true);
  expect(await f.admit()).toEqual({...first,created:false,receiptOnly:true});
  expect(f.snapshot()).toEqual(atA);
  await expect(f.admit(callKey,'b'.repeat(64))).rejects.toMatchObject({code:'conflict'});
  expect(f.snapshot()).toEqual(atA);
  const nextKey='voice-chunk:0001',nextSha='b'.repeat(64);
  expect(await f.admit(nextKey,nextSha)).toMatchObject({callKey:nextKey,requestSha256:nextSha,created:true});
  const beforeHandoff=f.snapshot();
  expect(changedPaths(atA,beforeHandoff)).toEqual([f.receiptPath(f.ownerA,nextKey)]);
  f.reassign(f.ownerB);
  const afterHandoff=f.snapshot();
  expect(await f.admit()).toEqual(first);
  const after=f.snapshot();
  expect(after.get(f.receiptPath(f.ownerA))).toEqual(beforeHandoff.get(f.receiptPath(f.ownerA)));
  expect(after.get(f.receiptPath(f.ownerA,nextKey))).toEqual(beforeHandoff.get(f.receiptPath(f.ownerA,nextKey)));
  expect(after.get(f.receiptPath(f.ownerB))).toMatchObject({ownerAccountId:f.ownerB,jobId:first.jobId,requestSha256});
  expect(after.has(f.receiptPath(f.ownerB,nextKey))).toBe(false);
  expect(changedPaths(afterHandoff,after)).toEqual([f.reservationPath(f.ownerB),f.receiptPath(f.ownerB),f.fencePath(f.ownerB)].sort());
  expect(f.balances()).toEqual(balanceBefore);
  expect(f.ledger()).toEqual(ledgerBefore);
});

it('rejects unrecognized origin and generation fields in the current Account routes before a transaction',async()=>{
  const f=await fixture(false),before=f.snapshot(),transactions=f.transactions();
  const reserveBody={identityKey:f.identityKey,reservationId:f.reservationId,seconds};
  for(const fields of [{originRef:randomUUID()},{ownerAccountId:f.ownerA},{bindingGeneration:1},{reservationGeneration:randomUUID()}]){
    expect(await f.post(f.admitPath,{...f.requestBody,...fields})).toEqual({status:400,data:{error:'invalid'}});
    expect(await f.post(f.reservePath,{...reserveBody,...fields})).toEqual({status:400,data:{error:'invalid'}});
  }
  expect(f.transactions()).toBe(transactions);
  expect(f.snapshot()).toEqual(before);
});
