import {createHash,randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
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
 const reservationPath=(accountId:string,reservationId:string=requestA.reservationId)=>'videoReservations/'+hash([accountId,reservationId]);
 const grantPath=(intentId:string)=>'videoVoiceIntentGrants/'+hash([scope,intentId]);
 for(const accountId of [A,B]){
  put('accounts/'+accountId,{identityKey,schemaVersion:1,unit:'video_seconds',credited:30,available:30,reserved:0,
   consumed:0,active:0,activeProjectCount:0,createdAtMs:1});
 }
 owner(A);
 // The unavailable authenticated issuer is represented by explicit trusted
 // rows in the fixture. No runtime component manufactures these from a request.
 function arrangeGrant(accountId:string,request:Parameters<AccountStore['reserveVideoWithVoiceOrigin']>[1]=requestA){
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
import type {ReviewedVoiceBinding} from '../commercial/firestoreReviewedTranslation';
import {videoReservationId} from '../commercial/videoReservationId';
import {RESERVE_ATTEMPT_DOCUMENTS, RESERVE_ATTEMPT_PROFILE_V1, createReviewedVoiceReserveAttempt, type ReserveAttemptEvidenceV1} from '../commercial/reserveAttemptEvidence';
function makeAttempt(f: ReturnType<typeof fixture>):ReserveAttemptEvidenceV1 {
  const required = new Set(['account','identity','input','project','intent','origin','intentGuard']);
  const versions = Object.fromEntries(RESERVE_ATTEMPT_DOCUMENTS.map(name=>[name,required.has(name)
    ? {exists:true,createTime:'1:000000000',updateTime:'1:000000000'} : {exists:false}]));
  return {version:1,attemptId:randomUUID(),witness:{
    intentId:'a'.repeat(64),accountId:f.requestA.videoAccountId,inputId:randomUUID(),operation:'translation:en',revision:1,
    profile:RESERVE_ATTEMPT_PROFILE_V1,provider:'account_seconds',identityKey:f.requestA.identityKey,reservationId:randomUUID(),seconds:2,
  },versions} as ReserveAttemptEvidenceV1;
}
  const key = 'synthetic-private-request-key';
  const privateText = 'esto es un ejemplo privado';
  const selectedVoice = 'narration:en:female';
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const timestamp = (updateTime = '1:000000000') => ({exists: true, createTime: '1:000000000', updateTime});
  const missing = {exists: false, createTime: null, updateTime: null};

  function voiceFixture(f:ReturnType<typeof fixture>) {
    const original = makeAttempt(f);
    const {accountId, inputId, identityKey} = original.witness;
    const textJobId = randomUUID(), revision = 2;
    const binding: ReviewedVoiceBinding = {
      version: 'reviewed-voice-binding-v1', identityKey, accountId, inputId, textJobId, revision,
      reviewId: digest(['review-revision-v1', accountId, inputId, textJobId, revision]),
      receiptId: 'b'.repeat(64), bindingHash: 'c'.repeat(64), payloadSha256: 'd'.repeat(64),
      voiceTextSha256: 'e'.repeat(64), inputGeneration: '1', inputSha256: 'f'.repeat(64),
      durationMs: 2000, billableSeconds: 3,
      versions: {
        principalIdentity: timestamp(), account: timestamp(), input: timestamp(), project: timestamp(),
        textJob: timestamp(), artifact: timestamp(), terminal: timestamp(), accounting: timestamp(),
        reserveMovement: timestamp(), billingOutbox: missing, review: timestamp(), receipt: timestamp(),
      },
      canonicalEvidence: {
        accountId, inputId, textJobId, revision, bindingHash: 'c'.repeat(64),
        reviewId: digest(['review-revision-v1', accountId, inputId, textJobId, revision]),
        review: {privateText}, receiptId: 'b'.repeat(64), receipt: {},
      },
    };
    const witness = {
      ...original.witness, intentId: digest([accountId, key]), operation: selectedVoice, revision, seconds: 3,
      reservationId: videoReservationId(accountId, identityKey, inputId, selectedVoice, revision, key),
    };
    return {binding, witness, attemptId: witness.reservationId, versions: original.versions};
  }


function source(f:ReturnType<typeof fixture>) {
  const s=voiceFixture(f);
  const e=createReviewedVoiceReserveAttempt(s.attemptId,s.witness,s.versions,s.binding,key,timestamp());
  const r={identityKey:e.witness.identityKey,videoAccountId:e.witness.accountId,
           intentId:e.witness.intentId,reserveAttemptId:e.attemptId,reservationId:e.witness.reservationId,seconds:e.witness.seconds};
  expect(e.version).toBe(2);
  expect(r.intentId).toMatch(/^[0-9a-f]{64}$/);
  expect(r.reserveAttemptId).toBe(r.reservationId);
  f.arrangeGrant(f.A,r);
  return r;
}
it('accepts the real C1 reviewed voice evidence tuple when the exact Account grant is already present',async()=>{
  const f=fixture(),r=source(f);
  const otherAccount=f.data('accounts/'+f.B);

  const response=await f.store.reserveVideoWithVoiceOrigin(f.scope,r);
  expect(response).toMatchObject({state:'reserved',created:true,seconds:r.seconds});
  expect(response.originRef).toEqual(expect.any(String));
  expect(f.data(f.reservationPath(f.A,r.reservationId))).toMatchObject({
    reservationId:r.reservationId,seconds:r.seconds,admissionProtocol:3,originRef:response.originRef,
  });
  expect(f.data(f.originPath(r.intentId))).toMatchObject(r);
  expect(f.data('accounts/'+f.A)).toMatchObject({available:27,reserved:3});
  expect(f.data('accounts/'+f.B)).toEqual(otherAccount);
  const after=f.snapshot();
  expect([...after.keys()].filter(path=>path.startsWith('ledgerEntries/'))).toHaveLength(1);

  await expect(f.makeStore().reserveVideoWithVoiceOrigin(f.scope,r)).resolves.toMatchObject({
    state:'reserved',created:false,originRef:response.originRef,
  });
  expect(f.snapshot()).toEqual(after);
});

it.each([
  ['UUID form',randomUUID()],
  ['truncated digest','a'.repeat(63)],
  ['uppercase hex','A'.repeat(64)],
  ['trailing newline','a'.repeat(64)+'\n'],
])('rejects an intention in %s before any Account transaction',async(_label,intentId)=>{
  const f=fixture(),r={...source(f),intentId};
  const before=f.snapshot(),txCount=f.transactions();
  await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,r)).rejects.toMatchObject({code:'invalid'});
  expect(f.transactions()).toBe(txCount);
  expect(f.snapshot()).toEqual(before);
});

it('rejects a well-formed digest for a different intention without using the existing C1 grant',async()=>{
  const f=fixture(),r=source(f);
  const differentIntent={...r,intentId:digest([r.videoAccountId,'different-test-request-key'])};
  const before=f.snapshot();
  await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,differentIntent)).rejects.toMatchObject({code:'conflict'});
  expect(f.snapshot()).toEqual(before);
});

it('the C1 issuer rejects a different voice reserve attempt for the same reservation',()=>{
  const s=voiceFixture(fixture());
  expect(()=>createReviewedVoiceReserveAttempt(randomUUID(),s.witness,s.versions,s.binding,key,timestamp())).toThrow();
});

it('rejects unrelated UUID reserve attempt and reservation IDs even when the stored grant agrees',async()=>{
  const f=fixture();
  const r={...source(f),reserveAttemptId:randomUUID()};
  f.arrangeGrant(f.A,r);
  const before=f.snapshot(),txCount=f.transactions();

  await expect(f.store.reserveVideoWithVoiceOrigin(f.scope,r)).rejects.toMatchObject({code:'invalid'});
  expect(f.transactions()).toBe(txCount);
  expect(f.snapshot()).toEqual(before);
});

it.each([
  ['a different UUID',false],
  ['the same UUID value',true],
])('pins the provider attempt independently when it has %s',async(_label,sameUUID)=>{
  const f=fixture(),r=source(f);
  const {originRef}=await f.store.reserveVideoWithVoiceOrigin(f.scope,r);
  const attemptId=sameUUID?r.reservationId:f.callA.attemptId;
  const call={...r,...f.callA,attemptId,originRef:originRef!};
  const before=f.snapshot(),txCount=f.transactions();

  await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,{...call,reserveAttemptId:randomUUID()}))
    .rejects.toMatchObject({code:'invalid'});
  await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,{...call,attemptId:r.intentId}))
    .rejects.toMatchObject({code:'invalid'});
  expect(f.transactions()).toBe(txCount);
  expect(f.snapshot()).toEqual(before);

  await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,call)).resolves.toMatchObject({
    attemptId:call.attemptId,reservationId:r.reservationId,originRef,created:true,receiptOnly:false,
  });
  expect(f.data(f.reservationPath(f.A,r.reservationId)).providerAdmission).toMatchObject({
    jobId:call.jobId,attemptId:call.attemptId,
  });
  const after=f.snapshot();
  for (const [path,row] of before) {
    if (path.startsWith('accounts/')||path.startsWith('ledgerEntries/')) expect(after.get(path)).toEqual(row);
  }
  expect([...after.keys()].filter(path=>path.startsWith('ledgerEntries/'))).toHaveLength(1);

  await expect(f.makeStore().admitVideoCallWithVoiceOrigin(f.scope,call)).resolves.toMatchObject({
    attemptId:call.attemptId,created:false,receiptOnly:true,
  });
  await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,{...call,attemptId:randomUUID()}))
    .rejects.toMatchObject({code:'conflict'});
  expect(f.snapshot()).toEqual(after);
});

it.each(['reserve UUID pair','Video account','seconds','namespace'] as const)(
  'independent audit rejects a well-formed C1 tuple with changed %s at both Account operations',
  async dimension=>{
    const f=fixture(),r=source(f);
    const authorized=await f.store.reserveVideoWithVoiceOrigin(f.scope,r);
    const scope=dimension==='namespace'?'other-video':f.scope;
    const otherId=randomUUID(), changed={...r};
    if(dimension==='reserve UUID pair'){
      changed.reservationId=otherId;
      changed.reserveAttemptId=otherId;
    }
    if(dimension==='Video account')changed.videoAccountId=f.videoB;
    if(dimension==='seconds')changed.seconds++;
    const before=f.snapshot();
    await expect(f.store.reserveVideoWithVoiceOrigin(scope,changed)).rejects.toMatchObject({code:'conflict'});
    await expect(f.store.admitVideoCallWithVoiceOrigin(scope,{...changed,...f.callA,originRef:authorized.originRef!}))
      .rejects.toMatchObject({code:'conflict'});
    expect(f.snapshot()).toEqual(before);
  }
);

it('independent audit keeps a C1 grant generation pinned after a missing response and identical grant recreation',async()=>{
  const f=fixture(),r=source(f);
  const result=await f.store.reserveVideoWithVoiceOrigin(f.scope,r),call={...r,...f.callA,originRef:result.originRef!};
  await f.store.admitVideoCallWithVoiceOrigin(f.scope,call);
  const path=f.grantPath(r.intentId),original=structuredClone(f.data(path));
  f.drop(path);
  f.put(path,original);
  const before=f.snapshot(),restarted=f.makeStore();
  await expect(restarted.reserveVideoWithVoiceOrigin(f.scope,r)).rejects.toMatchObject({code:'conflict'});
  await expect(restarted.admitVideoCallWithVoiceOrigin(f.scope,call)).rejects.toMatchObject({code:'conflict'});
  expect(f.snapshot()).toEqual(before);
});

it('independent audit preserves the first job and provider attempt across authorized voice ordinals',async()=>{
  const f=fixture(),r=source(f),result=await f.store.reserveVideoWithVoiceOrigin(f.scope,r);
  const first={...r,...f.callA,originRef:result.originRef!},initial=f.snapshot();
  await f.store.admitVideoCallWithVoiceOrigin(f.scope,first);
  const next={...first,callKey:'voice-chunk:0001',requestSha256:'3'.repeat(64)};
  const afterFirst=f.snapshot();
  for(const changed of [{attemptId:r.reservationId},{jobId:randomUUID()}]){
    await expect(f.makeStore().admitVideoCallWithVoiceOrigin(f.scope,{...next,...changed})).rejects.toMatchObject({code:'conflict'});
    expect(f.snapshot()).toEqual(afterFirst);
  }
  await expect(f.store.admitVideoCallWithVoiceOrigin(f.scope,next)).resolves.toMatchObject({created:true,receiptOnly:false});
  const after=f.snapshot();
  await expect(f.makeStore().admitVideoCallWithVoiceOrigin(f.scope,next)).resolves.toMatchObject({created:false,receiptOnly:true});
  await expect(f.makeStore().admitVideoCallWithVoiceOrigin(f.scope,{...next,requestSha256:first.requestSha256}))
    .rejects.toMatchObject({code:'conflict'});
  expect(f.snapshot()).toEqual(after);
  expect([...after.keys()].filter(path=>path.includes('/providerCalls/'))).toHaveLength(2);
  for(const [path,value] of initial){
    if(path.startsWith('ledgerEntries/')||path.startsWith('accounts/'))expect(after.get(path)).toEqual(value);
  }
});
