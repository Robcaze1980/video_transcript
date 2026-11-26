import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {AccountStore} from './backend';

type Row=Record<string,unknown>;
type Ref={path:string;collection:(name:string)=>Collection};
type Collection={doc:(id:string)=>Ref};
type Stored={data:Row;created:number;updated:number};
type Snapshot={
 exists:boolean;get:(key:string)=>unknown;data:()=>Row|undefined;
 createTime?:{seconds:number;nanoseconds:number};
 updateTime?:{seconds:number;nanoseconds:number};
};
type Tx={
 get:(ref:Ref)=>Promise<Snapshot>;
 getAll:(...refs:Ref[])=>Promise<Snapshot[]>;
 create:(ref:Ref,data:Row)=>void;
 update:(ref:Ref,data:Row)=>void;
};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fixture(){
 const scope='video-demo',uid='local-voice-origin-user';
 const A=randomUUID(),B=randomUUID(),videoA=randomUUID(),videoB=randomUUID();
 const identityKey=AccountStore.identityKey(uid),identityPath='identities/'+identityKey;
 const bindingPath='videoVoiceBindings/'+hash([scope,identityKey]);
 const reservationId=randomUUID();
 const requestA={identityKey,videoAccountId:videoA,intentId:hash([videoA,'test-voice-request']),reserveAttemptId:reservationId,reservationId,seconds:3};
 const callA={jobId:randomUUID(),attemptId:randomUUID(),callKey:'voice-chunk:0000',model:'gemini-3.8-flash-tts',requestSha256:'a'.repeat(64)};
 const claimPath=(intentId=requestA.intentId)=>'videoVoiceOriginClaims/'+hash([scope,intentId]);
 const originPath=(intentId=requestA.intentId)=>'videoVoiceReservationOrigins/'+hash([scope,intentId]);
 const rows=new Map<string,Stored>();
 const collection=(prefix:string):Collection=>({doc:id=>{
  const path=prefix+id;
  return {path,collection:name=>collection(path+'/'+name+'/')};
 }});
 let revision=0,transactions=0;
 let beforeCommit:(()=>void)|undefined;
 function put(path:string,data:Row){
  revision++;
  rows.set(path,{data,created:rows.get(path)?.created??revision,updated:revision});
 }
 function drop(path:string){
  revision++;
  rows.delete(path);
 }
 const db={async runTransaction<T>(body:(tx:Tx)=>Promise<T>):Promise<T>{
  transactions++;
  // Models Firestore's own-snapshot versions and optimistic retry for these
  // scenarios. Shared creation timestamps are an assumption to test in the emulator.
  for(let retry=0;retry<3;retry++){
   const readAt=revision,snapshot=structuredClone(rows),writes=new Map<string,Row>();
   const time=(version:number)=>({seconds:42,nanoseconds:version});
   const get:Tx['get']=async ({path})=>{
    if(writes.size)throw Error('Firestore requires reads before writes');
    const record=snapshot.get(path);
    return {exists:!!record,get:key=>record?.data[key],data:()=>record?.data,
     ...(record?{createTime:time(record.created),updateTime:time(record.updated)}:{})};
   };
   const result=await body({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(ref,data)=>{
    if(snapshot.has(ref.path)||writes.has(ref.path))throw Error('duplicate synthetic document');
    writes.set(ref.path,data);
   },update:(ref,data)=>{
    const old=snapshot.get(ref.path);
    if(!old)throw Error('missing synthetic document');
    writes.set(ref.path,{...old.data,...data});
   }});
   if(writes.size&&beforeCommit){
    const change=beforeCommit;
    beforeCommit=undefined;
    change();
   }
   if(readAt!==revision)continue;
   if(writes.size)revision++;
   for(const [path,data] of writes)rows.set(path,{data,created:snapshot.get(path)?.created??revision,updated:revision});
   return result;
  }
  throw Error('synthetic retries exhausted');
 }};
 const data=(path:string)=>rows.get(path)!.data,version=(path:string)=>'42:'+rows.get(path)!.updated;
 const owner=(accountId:string)=>put(identityPath,{uid,accountId});
 const reservationPath=(accountId:string,reservationId=requestA.reservationId)=>'videoReservations/'+hash([accountId,reservationId]);
 const grantPath=(intentId:string)=>'videoVoiceIntentGrants/'+hash([scope,intentId]);
 for(const accountId of [A,B]){
  put('accounts/'+accountId,{identityKey,schemaVersion:1,unit:'video_seconds',credited:30,available:30,reserved:0,
   consumed:0,active:0,activeProjectCount:0,createdAtMs:1});
 }
 owner(A);
 // The unavailable authenticated issuer is represented by explicit trusted
 // rows in the fixture. No runtime component manufactures these from a request.
 function arrangeGrant(accountId:string,request=requestA){
  const binding={v:1,state:'active',scope,identityKey,ownerAccountId:accountId,videoAccountId:request.videoAccountId,
   identityVersion:version(identityPath),generation:randomUUID()};
  put(bindingPath,binding);
  put(grantPath(request.intentId),{...request,v:1,purpose:'reviewed_voice_fragment',scope,ownerAccountId:accountId,
   bindingGeneration:binding.generation,bindingVersion:version(bindingPath)});
 }
 const makeStore=()=>new AccountStore(db as never,{collection:(name:string)=>collection(name+'/')} as never,()=>100);
 const store=makeStore();
 async function issue(){
  arrangeGrant(A);
  const result=await store.reserveVideoWithVoiceOrigin(scope,requestA);
  return {...requestA,...callA,originRef:result.originRef!};
 }
 async function reserveCompatibleB(){
  owner(B);
  await store.reserveVideo(identityKey,requestA.reservationId,requestA.seconds);
  owner(A);
 }
 function hold(accountId:string){
  put('videoBillingGuards/'+accountId,{ownerAccountId:accountId,identityKey,blocked:true,incidentCount:1,epoch:1,createdAtMs:1,updatedAtMs:1});
 }
 return {scope,A,B,videoB,requestA,callA,identityPath,bindingPath,claimPath,originPath,grantPath,makeStore,store,owner,put,drop,data,arrangeGrant,
  issue,hold,reservationPath,reserveCompatibleB,transactions:()=>transactions,snapshot:()=>structuredClone(rows),
  beforeCommit:(change:()=>void)=>{beforeCommit=change;}};
}

it('fails closed without the trusted binding and grant, and leaves the legacy reservation unadopted',async()=>{
 const f=fixture(),before=f.snapshot();
 await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,f.requestA)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(before);
 await f.store.reserveVideo(f.requestA.identityKey,f.requestA.reservationId,f.requestA.seconds);
 f.arrangeGrant(f.A);
 const withLegacy=f.snapshot();
 await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,f.requestA)).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,{...f.requestA,...f.callA,originRef:randomUUID()})).rejects.toMatchObject({code:'conflict'});
 const claimedOwner={...f.requestA,ownerAccountId:f.B};
 await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,claimedOwner)).rejects.toMatchObject({code:'invalid'});
 expect(f.snapshot()).toEqual(withLegacy);
 f.drop(f.grantPath(f.requestA.intentId));
 const bindingOnly=f.snapshot();
 await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,f.requestA)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(bindingOnly);
});

it('creates one Account-issued origin with the reservation and returns the same origin on exact durable replay',async()=>{
 const f=fixture(),input=await f.issue(),state=f.snapshot();
 const origin=state.get(f.originPath())!;
 const res=state.get(f.reservationPath(f.A))!,claim=state.get(f.claimPath())!;
 expect(origin.data).toMatchObject({...f.requestA,originRef:input.originRef,ownerAccountId:f.A});
 expect(origin.data.ownerAccountId).not.toBe(origin.data.videoAccountId);
 expect(res.data).toMatchObject({originRef:input.originRef,admissionProtocol:3,bindingGeneration:origin.data.bindingGeneration,reservationGeneration:origin.data.reservationGeneration});
 expect(claim.data).toEqual({originRef:input.originRef});
 expect([claim.created,res.created]).toEqual([origin.created,origin.created]);
 expect([...state.keys()].filter(key=>key.startsWith('ledgerEntries/'))).toHaveLength(1);
 expect(f.data('accounts/'+f.A)).toMatchObject({available:27,reserved:3,active:1,consumed:0});
 await expect(f.makeStore().reserveVideoWithVoiceOrigin(f.scope,f.requestA)).resolves.toMatchObject({created:false,originRef:input.originRef});
 const unrelatedReservation=randomUUID();
 await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,{...f.requestA,
  reserveAttemptId:unrelatedReservation,reservationId:unrelatedReservation,
 })).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.reserveVideo(f.requestA.identityKey,f.requestA.reservationId,f.requestA.seconds)).rejects.toMatchObject({code:'conflict'});
 const {identityKey,reservationId,seconds,jobId,attemptId,callKey,model,requestSha256}=input;
 await expect(f.store.admitVideoCall(identityKey,reservationId,seconds,jobId,attemptId,callKey,model,requestSha256)).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.settleVideo(identityKey,reservationId,'release',seconds)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(state);
});

it('rejects a foreign or missing origin and leaves both owners and their reservations untouched',async()=>{
 const f=fixture(),a=await f.issue();
 f.owner(f.B);
 const requestB={...f.requestA,videoAccountId:f.videoB,intentId:hash([f.videoB,'test-voice-request'])};
 f.arrangeGrant(f.B,requestB);
 const b=await f.store.reserveVideoWithVoiceOrigin(f.scope,requestB);
 const before=f.snapshot();
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,a)).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,{...requestB,...f.callA,originRef:a.originRef})).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.admitVideoCallWithVoiceOrigin('other-video',{...requestB,...f.callA,originRef:b.originRef!})).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(before);
 f.drop(f.originPath(requestB.intentId));
 const missing=f.snapshot();
 await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,requestB)).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,{...requestB,...f.callA,originRef:b.originRef!})).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(missing);
});

it('retries a racing commit against the new owner and never creates a receipt in a compatible reservation B',async()=>{
 const f=fixture();
 await f.reserveCompatibleB();
 const input=await f.issue(),before=f.snapshot();
 f.beforeCommit(()=>f.owner(f.B));
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,input)).rejects.toMatchObject({code:'conflict'});
 const after=f.snapshot();
 before.delete(f.identityPath);after.delete(f.identityPath);
 expect(after).toEqual(before);
 f.arrangeGrant(f.B,{...f.requestA,videoAccountId:f.videoB});
 const grantB=f.snapshot();
 await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,{...f.requestA,videoAccountId:f.videoB})).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(grantB);
});

it('preserves the A receipt when its admission commits first and rejects exact replay under the new owner',async()=>{
 const f=fixture();
 await f.reserveCompatibleB();
 const input=await f.issue();
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,input)).resolves.toMatchObject({created:true,receiptOnly:false,originRef:input.originRef});
 f.owner(f.B);
 const before=f.snapshot();
 await expect(f.makeStore().admitVideoCallWithVoiceOrigin(f.scope,input)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(before);
 const receipts=[...before.keys()].filter(key=>key.includes('/providerCalls/'));
 expect(receipts).toEqual([f.reservationPath(f.A)+'/providerCalls/'+hash(['provider-call-v2',input.callKey])]);
});

it('rejects identity ABA and binding ABA even when they return to the original contents',async()=>{
 const f=fixture(),input=await f.issue();
 const identity=f.data(f.identityPath);
 f.owner(f.B);
 f.put(f.identityPath,identity);
 const afterIdentityAba=f.snapshot();
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,input)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(afterIdentityAba);
 const reservationId=randomUUID();
 const newer={...f.requestA,intentId:hash([f.requestA.videoAccountId,'later-test-voice-request']),reserveAttemptId:reservationId,reservationId};
 f.arrangeGrant(f.A,newer);
 const result=await f.store.reserveVideoWithVoiceOrigin(f.scope,newer);
 const binding=f.data(f.bindingPath);
 f.put(f.bindingPath,{...binding,state:'closed'});
 f.put(f.bindingPath,binding);
 const afterBindingAba=f.snapshot();
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,{...newer,...f.callA,originRef:result.originRef!})).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(afterBindingAba);
});

it('rejects deletion and exact recreation of a reservation with the same generation payload',async()=>{
 const f=fixture(),input=await f.issue(),path=f.reservationPath(f.A),reservation=f.data(path);
 f.drop(path);
 const deleted=f.snapshot();
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,input)).rejects.toMatchObject({code:'not_found'});
 await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,f.requestA)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(deleted);
 f.put(path,reservation);
 const recreated=f.snapshot();
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,input)).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,f.requestA)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(recreated);
});

it('blocks new effects under a hold and returns an exact authorized historical receipt without writes',async()=>{
 const f=fixture(),blocked=fixture();
 blocked.arrangeGrant(blocked.A);
 blocked.hold(blocked.A);
 const blockedBefore=blocked.snapshot();
 await expect(blocked.store.reserveVideoWithVoiceOrigin(blocked.scope,blocked.requestA)).rejects.toMatchObject({code:'conflict'});
 expect(blocked.snapshot()).toEqual(blockedBefore);
 const input=await f.issue(),afterReserve=f.snapshot();
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,input)).resolves.toMatchObject({created:true,receiptOnly:false});
 const second={...input,callKey:'voice-chunk:0001',requestSha256:'b'.repeat(64)};
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,second)).resolves.toMatchObject({created:true,receiptOnly:false});
 for(const [path,value] of afterReserve){
  if(path.includes('accounts/')||path.startsWith('ledgerEntries/'))expect(f.snapshot().get(path)).toEqual(value);
 }
 f.hold(f.A);
 const before=f.snapshot();
 await expect(f.makeStore().admitVideoCallWithVoiceOrigin(f.scope,second)).resolves.toMatchObject({created:false,receiptOnly:true,originRef:input.originRef});
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,{...input,requestSha256:'c'.repeat(64)})).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,{...input,jobId:randomUUID()})).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,{...input,callKey:'voice-chunk:0002'})).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(before);
});

it('keeps the internal methods closed before any transaction outside test mode',async()=>{
 const f=fixture();
 const input=await f.issue(),before=f.snapshot(),transactions=f.transactions();
 vi.stubEnv('NODE_ENV','production');
 try {
  await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,f.requestA)).rejects.toMatchObject({code:'conflict'});
  await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,input)).rejects.toMatchObject({code:'conflict'});
 } finally {
  vi.unstubAllEnvs();
 }
 expect(f.transactions()).toBe(transactions);
 expect(f.snapshot()).toEqual(before);
});

it('rejects a missing claim even when a fresh owner and grant could create a compatible reservation',async()=>{
 const f=fixture(),input=await f.issue();
 f.drop(f.claimPath());
 f.owner(f.B);
 const attempted={...f.requestA,videoAccountId:f.videoB};
 f.arrangeGrant(f.B,attempted);
 const before=f.snapshot();
 await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,attempted)).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,{...attempted,...f.callA,originRef:input.originRef})).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(before);
 expect(before.has(f.reservationPath(f.B))).toBe(false);
});

it.each([{v:2},{purpose:'other-purpose'}])('rejects an altered origin with incompatible authority %o',async changed=>{
 const f=fixture(),input=await f.issue(),original=f.data(f.originPath());
 f.put(f.originPath(),{...original,...changed});
 const before=f.snapshot();
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,input)).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,f.requestA)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(before);
 f.put(f.originPath(),original);
 const restored=f.snapshot();
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,input)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(restored);
});

it('concurrent exact reservation callers converge on one origin, one ledger entry and one hold of seconds',async()=>{
 const f=fixture();
 f.arrangeGrant(f.A);
 const results=await Promise.all([
  f.store.reserveVideoWithVoiceOrigin(f.scope,f.requestA),
  f.makeStore().reserveVideoWithVoiceOrigin(f.scope,f.requestA),
 ]);
 expect(results.map(r=>r.created).sort()).toEqual([false,true]);
 expect(results[0].originRef).toBe(results[1].originRef);
 const state=f.snapshot();
 expect([...state.keys()].filter(key=>key.startsWith('ledgerEntries/'))).toHaveLength(1);
 expect(f.data('accounts/'+f.A)).toMatchObject({available:27,reserved:3,active:1});
});

it('does not read an ordinal with a lost receipt as available for new admission',async()=>{
 const f=fixture(),first=await f.issue();
 await f.store.admitVideoCallWithVoiceOrigin(f.scope,first);
 const second={...first,callKey:'voice-chunk:0001',requestSha256:'b'.repeat(64)};
 await f.store.admitVideoCallWithVoiceOrigin(f.scope,second);
 const path=f.reservationPath(f.A)+'/providerCalls/'+hash(['provider-call-v2',second.callKey]);
 f.drop(path);
 const before=f.snapshot();
 await expect(f.makeStore().admitVideoCallWithVoiceOrigin(f.scope,second)).rejects.toMatchObject({code:'invariant'});
 expect(f.snapshot()).toEqual(before);
});

it('retries a racing hold against Account state before admitting a fragment',async()=>{
 const f=fixture(),input=await f.issue(),before=f.snapshot();
 f.beforeCommit(()=>f.hold(f.A));
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,input)).rejects.toMatchObject({code:'conflict'});
 const after=f.snapshot();
 expect(after.delete('videoBillingGuards/'+f.A)).toBe(true);
 expect(after).toEqual(before);
});

it('H1 counts the legacy seal and contradictory resolution after a v3 reservation is lost',async()=>{
 const f=fixture(),input=await f.issue(),r=f.requestA;
 const live=f.snapshot(),reservationPath=f.reservationPath(f.A);
 const stateBefore=await f.store.sealVideoReservation(r.identityKey,r.reservationId,r.seconds);
 expect(stateBefore).toMatchObject({state:'reserved',created:false});
 expect(f.snapshot()).toEqual(live);
 f.drop(reservationPath);
 const missing=f.snapshot();
 expect(missing.has(f.originPath())).toBe(true);
 expect(missing.has(f.claimPath())).toBe(true);
 await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,r)).rejects.toMatchObject({code:'conflict'});
 await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,input)).rejects.toMatchObject({code:'not_found'});
 await expect(f.store.videoReservationResolution(r.identityKey,r.reservationId,r.seconds)).rejects.toMatchObject({code:'not_found'});
 expect(f.snapshot()).toEqual(missing);

 const reply=await f.store.sealVideoReservation(r.identityKey,r.reservationId,r.seconds);
 expect(reply).toMatchObject({state:'sealed',created:true});
 const after=f.snapshot(),changes=new Map(after);
 const tombPath='videoReservationTombstones/'+hash([f.A,r.reservationId]);
 expect(changes.delete(tombPath)).toBe(true);
 expect(changes).toEqual(missing);
 expect(f.data(tombPath)).toMatchObject({state:'sealed',seconds:3,ownerAccountId:f.A});
 expect(f.data('accounts/'+f.A)).toMatchObject({available:27,reserved:3,active:1,consumed:0});
 expect(after.get('accounts/'+f.B)).toEqual(live.get('accounts/'+f.B));
 expect([...after.keys()].filter(key=>key.startsWith('ledgerEntries/'))).toHaveLength(1);
 const retry=f.makeStore();
 await expect(retry.sealVideoReservation(r.identityKey,r.reservationId,r.seconds)).resolves.toMatchObject({state:'sealed',created:false});
 await expect(retry.videoReservationResolution(r.identityKey,r.reservationId,r.seconds)).resolves.toMatchObject({state:'sealed'});
 await expect(retry.videoReservation(r.identityKey,r.reservationId)).rejects.toMatchObject({code:'not_found'});
 await expect(retry.reserveVideoWithVoiceOrigin(f.scope,r)).rejects.toMatchObject({code:'conflict'});
 await expect(retry.admitVideoCallWithVoiceOrigin(f.scope,input)).rejects.toMatchObject({code:'conflict'});
 expect(f.snapshot()).toEqual(after);
});

it('H1 a surviving v3 origin and debit must preclude a new legacy seal',async()=>{
 const f=fixture(),r=f.requestA;
 await f.issue();
 f.drop(f.reservationPath(f.A));
 const before=f.snapshot();
 const result=await f.store.sealVideoReservation(r.identityKey,r.reservationId,r.seconds)
   .then(value=>value.state,error=>error.code);
 expect({result,changes:f.snapshot().size-before.size}).toEqual({result:'conflict',changes:0});
});

it.each(['first','second'] as const)('H3 keeps a surviving %s ordinal after its receipt disappears',async which=>{
 const f=fixture(),first=await f.issue(),r=f.requestA;
 const second={...first,callKey:'voice-chunk:0001',requestSha256:'b'.repeat(64)};
 for(const call of [first,second])await f.store.admitVideoCallWithVoiceOrigin(f.scope,call);
 const lost=which==='first'?first:second;
 const reservationPath=f.reservationPath(f.A),receiptPath=reservationPath+'/providerCalls/'+hash(['provider-call-v2',lost.callKey]);
 const original=f.snapshot();
 expect(f.data(reservationPath).voiceCallOrdinals).toEqual([0,1]);
 f.drop(receiptPath);
 const before=f.snapshot(),fresh=f.makeStore();
 for(const call of [lost,{...lost,requestSha256:'c'.repeat(64)}]){
   await expect(fresh.admitVideoCallWithVoiceOrigin(f.scope,call)).rejects.toMatchObject({code:'invariant'});
   expect(f.snapshot()).toEqual(before);
 }
 expect(f.data(reservationPath).voiceCallOrdinals).toEqual([0,1]);
 expect(f.snapshot().has(receiptPath)).toBe(false);
 const third={...first,callKey:'voice-chunk:0002',requestSha256:'d'.repeat(64)};
 if(which==='first'){
   await expect(fresh.admitVideoCallWithVoiceOrigin(f.scope,third)).rejects.toMatchObject({code:'invariant'});
   expect(f.snapshot()).toEqual(before);
 }else{
   await expect(fresh.admitVideoCallWithVoiceOrigin(f.scope,third)).resolves.toMatchObject({created:true,receiptOnly:false});
   expect(f.data(reservationPath).voiceCallOrdinals).toEqual([0,1,2]);
   const after=f.snapshot();
   expect(after.size).toBe(before.size+1);
   for(const [path,row] of before)if(path!==reservationPath)expect(after.get(path)).toEqual(row);
   expect(after.has(reservationPath+'/providerCalls/'+hash(['provider-call-v2',third.callKey]))).toBe(true);
   await expect(fresh.admitVideoCallWithVoiceOrigin(f.scope,third)).resolves.toMatchObject({created:false,receiptOnly:true});
   await expect(fresh.admitVideoCallWithVoiceOrigin(f.scope,second)).rejects.toMatchObject({code:'invariant'});
   expect(f.snapshot()).toEqual(after);
 }
 expect(f.snapshot().get('accounts/'+f.A)).toEqual(original.get('accounts/'+f.A));
 expect(f.snapshot().get('accounts/'+f.B)).toEqual(original.get('accounts/'+f.B));
 expect([...f.snapshot().keys()].filter(key=>key.startsWith('ledgerEntries/'))).toHaveLength(1);
 expect(f.data(f.reservationPath(f.A)).seconds).toEqual(r.seconds);
});

it.each([
 ['target receipt survives without its ordinal',[0]],
 ['duplicate ordinal',[0,1,1]],
 ['unsorted ordinals',[1,0]],
 ['out-of-range ordinal',[0,1,1000]],
 ['wrong ordinal type',[0,'1']],
 ['empty list despite first admission',[]],
] as const)('H3 rejects %s without recreating or charging',async(_label,index)=>{
 const f=fixture(),first=await f.issue();
 const second={...first,callKey:'voice-chunk:0001',requestSha256:'b'.repeat(64)};
 for(const call of [first,second])await f.store.admitVideoCallWithVoiceOrigin(f.scope,call);
 const path=f.reservationPath(f.A);
 f.put(path,{...f.data(path),voiceCallOrdinals:[...index]});
 const before=f.snapshot();
 await expect(f.makeStore().admitVideoCallWithVoiceOrigin(f.scope,second)).rejects.toMatchObject({code:'invariant'});
 expect(f.snapshot()).toEqual(before);
});

it('DS3 measures reserve replay, first admission and receipt replay after losing only the v3 ledger entry',async()=>{
 const f=fixture(),first=await f.issue(),r=f.requestA;
 const intact=f.snapshot(),ledgerPaths=[...intact.keys()].filter(path=>path.startsWith('ledgerEntries/'));
 expect(ledgerPaths).toHaveLength(1);
 const ledgerPath=ledgerPaths[0];
 f.drop(ledgerPath);
 const missing=f.snapshot(),reservationPath=f.reservationPath(f.A);
 expect(missing.has(f.originPath())&&missing.has(f.claimPath())&&missing.has(reservationPath)).toBe(true);
 const retry=f.makeStore();
 await expect(retry.reserveVideoWithVoiceOrigin(f.scope,r)).resolves.toMatchObject({created:false,state:'reserved',originRef:first.originRef});
 expect(f.snapshot()).toEqual(missing);
 await expect(retry.admitVideoCallWithVoiceOrigin(f.scope,first)).resolves.toMatchObject({created:true,receiptOnly:false});
 const after=f.snapshot();
 const receiptPath=reservationPath+'/providerCalls/'+hash(['provider-call-v2',first.callKey]);
 const fencePath=reservationPath+'/providerCallFences/first';
 expect([...after.keys()].filter(path=>!missing.has(path)).sort()).toEqual([fencePath,receiptPath].sort());
 expect([...missing.keys()].filter(path=>after.get(path)?.updated!==missing.get(path)?.updated)).toEqual([reservationPath]);
 expect(after.has(ledgerPath)).toBe(false);
 expect(after.get('accounts/'+f.A)).toEqual(intact.get('accounts/'+f.A));
 expect(after.get('accounts/'+f.B)).toEqual(intact.get('accounts/'+f.B));
 await expect(f.makeStore().admitVideoCallWithVoiceOrigin(f.scope,first)).resolves.toMatchObject({created:false,receiptOnly:true});
 expect(f.snapshot()).toEqual(after);
});

it('DS3 an absent reserve ledger should prevent a new fragment from being authorized as economically backed',async()=>{
 const f=fixture(),first=await f.issue();
 const beforeLoss=f.snapshot();
 const ledgerPath=[...beforeLoss.keys()].find(path=>path.startsWith('ledgerEntries/'))!;
 f.drop(ledgerPath);
 const before=f.snapshot();
 const result=await f.makeStore().admitVideoCallWithVoiceOrigin(f.scope,first)
   .then(response=>response.created?'created':'replay',()=> 'denied');
 expect({result,changes:f.snapshot().size-before.size,unchanged:f.snapshot().get(f.reservationPath(f.A))?.updated===before.get(f.reservationPath(f.A))?.updated})
   .toEqual({result:'denied',changes:0,unchanged:true});
});
