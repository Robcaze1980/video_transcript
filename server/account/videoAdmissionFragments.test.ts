import { createHash, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { AccountStore } from './backend';

type Row=Record<string,unknown>;
type Ref={path:string;collection:(name:string)=>Collection};
type Collection={doc:(id:string)=>Ref};
type Tx={
 get:(ref:Ref)=>Promise<{exists:boolean;get:(key:string)=>unknown;data:()=>Row|undefined}>;
 getAll:(...refs:Ref[])=>Promise<Awaited<ReturnType<Tx['get']>>[]>;
 create:(ref:Ref,data:Row)=>void;
 update:(ref:Ref,data:Row)=>void;
};

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

it('admits distinct voice ordinals for one attempt and rejects a changed hash for an existing ordinal',async()=>{
 const uid='synthetic-voice-fragment-contrast',owner=randomUUID(),reservationId=randomUUID();
 const identityKey=AccountStore.identityKey(uid),seconds=3,reservationPath='videoReservations/'+hash([owner,reservationId]);
 const balances={identityKey,schemaVersion:1,unit:'video_seconds',credited:20,available:17,reserved:3,
  consumed:0,active:1,activeProjectCount:0,createdAtMs:1};
 let rows=new Map<string,Row>([
  ['identities/'+identityKey,{uid,accountId:owner}],
  ['accounts/'+owner,balances],
  [reservationPath,{ownerAccountId:owner,identityKey,reservationId,seconds,state:'reserved',admissionProtocol:2}],
 ]);
 const collection=(prefix:string):Collection=>({doc:id=>{
  const path=prefix+id;
  return {path,collection:name=>collection(path+'/'+name+'/')};
 }});
 // Transaction-shaped test double. Only successful operations publish writes.
 // Real Firestore semantics are covered by the protected emulator fixture.
 const db={async runTransaction<T>(fn:(tx:Tx)=>Promise<T>){
  const staged=structuredClone(rows);
  const get:Tx['get']=async ref=>{
   const value=staged.get(ref.path);
   return {exists:value!==undefined,get:key=>value?.[key],data:()=>value};
  };
  const result=await fn({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(ref,data)=>{
   if(staged.has(ref.path))throw Error('synthetic duplicate document');
   staged.set(ref.path,data);
  },update:(ref,data)=>{
   const previous=staged.get(ref.path);
   if(!previous)throw Error('synthetic missing document');
   staged.set(ref.path,{...previous,...data});
  }});
  rows=staged;
  return result;
 }};
 const store=new AccountStore(db as never,{collection:(name:string)=>collection(name+'/')} as never,()=>2);
 const jobId=randomUUID(),attemptId=randomUUID(),model='gemini-3.8-flash-tts';
 const firstKey='voice-chunk:0000',secondKey='voice-chunk:0001',firstHash='a'.repeat(64),secondHash='b'.repeat(64);
 const admit=(key:string,digest:string)=>store.admitVideoCall(identityKey,reservationId,seconds,jobId,attemptId,key,model,digest);
 const first=await admit(firstKey,firstHash);
 expect(first).toEqual({reservationId,seconds,jobId,attemptId,callKey:firstKey,model,requestSha256:firstHash,created:true,receiptOnly:false});
 const firstState=structuredClone(rows);
 await expect(admit(firstKey,secondHash)).rejects.toMatchObject({code:'conflict'});
 expect(rows).toEqual(firstState);
 await expect(admit(firstKey,firstHash)).resolves.toEqual({...first,created:false,receiptOnly:true});
 expect(rows).toEqual(firstState);
 const second=await admit(secondKey,secondHash);
 expect(second).toEqual({...first,callKey:secondKey,requestSha256:secondHash});
 const newPath=reservationPath+'/providerCalls/'+hash(['provider-call-v2',secondKey]);
 expect([...rows.keys()].filter(key=>!firstState.has(key))).toEqual([newPath]);
 expect(rows.get(newPath)).toMatchObject({callKey:secondKey,requestSha256:secondHash});
 expect(new Map([...rows].filter(([key])=>key!==newPath))).toEqual(firstState);
});
