import {createHash,randomUUID} from 'node:crypto';
import {FieldPath,type Firestore,type DocumentReference,type Transaction,type DocumentSnapshot} from 'firebase-admin/firestore';
import type {AccountView,AccountProject,ProjectKind,ProjectPage,ProjectSummary,LedgerPage} from './contracts';
import {UNKNOWN_RESOLUTION_MIN_AGE_MS,sameResolution,validResolution,type VideoResolution,type VideoSettlementOptions} from './settlementContract';

export class AccountFault extends Error {constructor(readonly code:'invalid'|'not_found'|'account_not_provisioned'|'conflict'|'deleted'|'quota'|'insufficient'|'invariant'|'too_early'){super(code);}}
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function ledgerId(value:unknown){const chars=hash(value).slice(0,32).split('');chars[12]='4';chars[16]='89ab'[parseInt(chars[16],16)%4];const h=chars.join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
export const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
const limits={projectBytes:65536,projectCount:100,titleCharacters:120};
const maxActiveVideoReservations=3;
const bad=()=>{throw new AccountFault('invalid');};
const invariant=()=>{throw new AccountFault('invariant');};
function uidKey(uid:string){if(typeof uid!=='string'||!uid||uid.length>128)bad();return hash(['firebase',uid]);}
function id(value:string){if(typeof value!=='string'||!uuid.test(value))bad();return value;}
function integer(n:unknown,min=0):n is number{return Number.isSafeInteger(n)&&Number(n)>=min;}
function incidentId(value:string){if(typeof value!=='string'||!(uuid.test(value)||value.length===64&&/^[a-f0-9]{64}$/.test(value)))bad();return value;}
export type VideoProviderAdmission={jobId:string;attemptId:string};
type VideoCallIdentity=VideoProviderAdmission&{callKey:string;model:string;requestSha256:string};
const callKeyValid=(value:unknown):value is string=>typeof value==='string'&&value.length===16&&/^(text-window|voice-chunk):\d{4}$/.test(value)&&Number(value.slice(-4))<1000;
const modelValid=(value:unknown):value is string=>value==='gemini-3.8-flash'||value==='gemini-3.8-flash-tts';
const modelMatchesKey=(callKey:string,model:string)=>callKey.startsWith('text-window:')?model==='gemini-3.8-flash':model==='gemini-3.8-flash-tts';
const digestValid=(value:unknown):value is string=>typeof value==='string'&&value.length===64&&/^[a-f0-9]{64}$/.test(value);
// A durable reference to the evidence an operator reviewed: bounded to 200 characters and free of control characters.
const reviewRefValid=(value:unknown):value is string=>typeof value==='string'&&/^[^\u0000-\u001f\u007f]{1,200}$/.test(value);
const callDocId=(callKey:string)=>hash(['provider-call-v2',callKey]);
function admission(value:unknown):VideoProviderAdmission{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='attemptId,jobId')bad();
 const data=value as Record<string,unknown>;
 if(typeof data.jobId!=='string'||typeof data.attemptId!=='string')bad();
 return {jobId:id(data.jobId as string),attemptId:id(data.attemptId as string)};
}
function settlementOptions(action:'capture'|'release',expectedSeconds:number,hasAdmission:boolean,options:unknown):{partial:number|undefined;resolution:VideoResolution|undefined}{
 if(options!==undefined&&(!options||typeof options!=='object'||Array.isArray(options)))bad();
 const row=(options??{}) as Record<string,unknown>;
 // Plain data only: an inherited `capturedSeconds` or a class instance must not be read as options.
 const proto=Object.getPrototypeOf(row);if(proto!==Object.prototype&&proto!==null)bad();
 for(const key of Object.keys(row)){if(key!=='capturedSeconds'&&key!=='resolution')bad();const d=Object.getOwnPropertyDescriptor(row,key);if(!d||!('value' in d))bad();} // data properties only, never getters
 const partial=row.capturedSeconds,resolution=row.resolution;
 if(partial!==undefined&&(action!=='capture'||!integer(partial,1)||partial>=expectedSeconds))bad();
 if(resolution!==undefined&&(action!=='release'||!validResolution(resolution)))bad();
 // An admission and its resolution travel together on a release; neither may appear alone.
 if(action==='release'&&hasAdmission!==(resolution!==undefined))bad();
 return {partial:partial as number|undefined,resolution:resolution as VideoResolution|undefined};
}
function billingHold(doc:DocumentSnapshot,accountId:string,identityKey:string){
 if(!doc.exists)return false;const value=doc.data();
 if(!value||value.ownerAccountId!==accountId||value.identityKey!==identityKey||value.blocked!==true||!integer(value.incidentCount,1)||!integer(value.epoch,1)||!integer(value.createdAtMs)||!integer(value.updatedAtMs))invariant();
 return true;
}
function sameAdmission(value:unknown,key:VideoProviderAdmission){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const data=value as Record<string,unknown>;
 return data.jobId===key.jobId&&data.attemptId===key.attemptId;
}
function storedAdmission(doc:DocumentSnapshot){
 const value=doc.get('providerAdmission');if(value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.jobId!=='string'||!uuid.test(value.jobId)||typeof value.attemptId!=='string'||!uuid.test(value.attemptId)||!integer(value.admittedAtMs))invariant();
 return value as VideoProviderAdmission & {admittedAtMs:number};
}
function firstCall(admitted:ReturnType<typeof storedAdmission>):VideoCallIdentity{
 if(!admitted)invariant();const value=admitted as NonNullable<typeof admitted>&Record<string,unknown>;
 if(!callKeyValid(value.firstCallKey)||!modelValid(value.firstModel)||!modelMatchesKey(value.firstCallKey as string,value.firstModel as string)||!digestValid(value.firstRequestSha256))invariant();
 return {jobId:value.jobId,attemptId:value.attemptId,callKey:value.firstCallKey as string,model:value.firstModel as string,requestSha256:value.firstRequestSha256 as string};
}
function storedCall(doc:DocumentSnapshot,accountId:string,identityKey:string,reservationId:string,seconds:number):VideoCallIdentity{
 const value=doc.data();
 if(!doc.exists||!value||value.admissionProtocol!==2||value.ownerAccountId!==accountId||value.identityKey!==identityKey||value.reservationId!==reservationId||value.seconds!==seconds||!integer(value.admittedAtMs)||typeof value.jobId!=='string'||!uuid.test(value.jobId)||typeof value.attemptId!=='string'||!uuid.test(value.attemptId)||!callKeyValid(value.callKey)||!modelValid(value.model)||!modelMatchesKey(value.callKey,value.model)||!digestValid(value.requestSha256))invariant();
 return value as VideoCallIdentity;
}
function sameCall(a:VideoCallIdentity,b:VideoCallIdentity){return a.jobId===b.jobId&&a.attemptId===b.attemptId&&a.callKey===b.callKey&&a.model===b.model&&a.requestSha256===b.requestSha256;}
function sealedReservation(doc:DocumentSnapshot,accountId:string,identityKey:string,reservationId:string,seconds:number){
 if(!doc.exists)return false;
 if(doc.get('ownerAccountId')!==accountId||doc.get('identityKey')!==identityKey||doc.get('reservationId')!==reservationId||doc.get('state')!=='sealed'||!integer(doc.get('seconds'),1)||!integer(doc.get('createdAtMs')))invariant();
 if(doc.get('seconds')!==seconds)throw new AccountFault('conflict');
 return true;
}
function draft(title:unknown,content:unknown){
 if(typeof title!=='string'||!title.trim()||[...title].length>limits.titleCharacters||/[\p{Cc}\p{Cf}]/u.test(title)||/[\uD800-\uDFFF]/u.test(title))bad();
 if(typeof content!=='string'||Buffer.byteLength(content,'utf8')>limits.projectBytes||/[\uD800-\uDFFF]/u.test(content))bad();
 return {title:title as string,content:content as string};
}
type AccountRecord={identityKey:string;schemaVersion:1;unit:'video_seconds';credited:number;available:number;reserved:number;consumed:number;active:number;activeProjectCount:number;createdAtMs:number};
function accountRecord(d:DocumentSnapshot,key:string):AccountRecord{
 const v=d.data();if(!d.exists||!v||v.identityKey!==key||v.schemaVersion!==1||v.unit!=='video_seconds'||!['credited','available','reserved','consumed','active','activeProjectCount','createdAtMs'].every(k=>integer(v[k]))||v.credited!==v.available+v.reserved+v.consumed||!Number.isSafeInteger(v.available+v.reserved+v.consumed)||v.activeProjectCount>limits.projectCount)invariant();
 return v as AccountRecord;
}
function view(accountId:string,a:AccountRecord):AccountView{return {id:accountId,balance:{unit:'video_seconds',credited:a.credited,available:a.available,reserved:a.reserved,consumed:a.consumed,active:a.active},limits:{...limits},services:{manualSubtitles:true,transcription:false,translation:false,narration:false,payments:false}};}
function summary(d:DocumentSnapshot,owner:string):ProjectSummary{
 const v=d.data();if(!v||v.ownerAccountId!==owner||v.deleted!==false||!uuid.test(d.id)||!['srt','text'].includes(v.kind)||!integer(v.revision,1)||!integer(v.createdAtMs)||!integer(v.updatedAtMs)||typeof v.title!=='string'||[...v.title].length>limits.titleCharacters)invariant();
 return {id:d.id,title:v.title,kind:v.kind,revision:v.revision,createdAtMs:v.createdAtMs,updatedAtMs:v.updatedAtMs};
}
function project(d:DocumentSnapshot,owner:string):AccountProject{
 const s=summary(d,owner),v=d.data()!;if(typeof v.content!=='string'||Buffer.byteLength(v.content)>limits.projectBytes||v.contentSha256!==hash(v.content))invariant();return {...s,content:v.content};
}
type Cursor={v:1;owner:string;time:number;id:string};
function pageInput(owner:string,limit:unknown,cursor:unknown){
 const count=limit===undefined?20:typeof limit==='string'&&/^[1-9]\d?$/.test(limit)?Number(limit):NaN;if(!integer(count,1)||count>50)bad();
 let after:Cursor|null=null;
 if(cursor!==undefined){if(typeof cursor!=='string'||!cursor||cursor.length>512||!/^[A-Za-z0-9_-]+$/.test(cursor))bad();try{const b=Buffer.from(cursor as string,'base64url'),v=JSON.parse(b.toString('utf8'));if(b.toString('base64url')!==cursor||Object.keys(v).sort().join(',')!=='id,owner,time,v'||v.v!==1||v.owner!==owner||!integer(v.time)||!uuid.test(v.id))bad();after=v;}catch{bad();}}
 return {count,after};
}
const cursorFor=(owner:string,time:number,key:string)=>Buffer.from(JSON.stringify({v:1,owner,time,id:key})).toString('base64url');

/** Production-only standalone drafts. No imports/calls to candidate, GCS, AI or purchase code. */
export class AccountStore {
 constructor(readonly db:Firestore,readonly root:DocumentReference,readonly now=()=>Date.now()){}
 private identity(uid:string){return {key:uidKey(uid),ref:this.root.collection('identities').doc(uidKey(uid))};}
 /** Bind identity and account to the caller's Account Firestore transaction. */
 private async resolve(uid:string,tx:Transaction){
  const identity=this.identity(uid),d=await tx.get(identity.ref);
  if(!d.exists)throw new AccountFault('account_not_provisioned');
  const a=d.get('accountId');if(d.get('uid')!==uid||typeof a!=='string'||!uuid.test(a))invariant();
  const ref=this.root.collection('accounts').doc(a),record=await tx.get(ref);return {accountId:a,ref,record:accountRecord(record,identity.key)};
 }
 async bootstrap(uid:string){
  const identity=this.identity(uid),accountId=randomUUID(),createdAtMs=this.now();
  return this.db.runTransaction(async tx=>{
   const existing=await tx.get(identity.ref);
   if(existing.exists){const a=await this.resolve(uid,tx);return {created:false,account:view(a.accountId,a.record)};}
   const account:AccountRecord={identityKey:identity.key,schemaVersion:1,unit:'video_seconds',credited:0,available:0,reserved:0,consumed:0,active:0,activeProjectCount:0,createdAtMs};
   tx.create(identity.ref,{uid,accountId,createdAtMs});tx.create(this.root.collection('accounts').doc(accountId),account);
   return {created:true,account:view(accountId,account)};
  });
 }
 async me(uid:string){return this.db.runTransaction(async tx=>{const a=await this.resolve(uid,tx);return view(a.accountId,a.record);});}
 async create(uid:string,requestKey:string,title:unknown,kind:unknown,content:unknown){
  id(requestKey);if(kind!=='srt'&&kind!=='text')bad();const data=draft(title,content),fingerprint=hash([kind,data.title,data.content]),projectId=randomUUID(),time=this.now();
  return this.db.runTransaction(async tx=>{
   const a=await this.resolve(uid,tx),requestId=hash([a.accountId,requestKey]),requestRef=this.root.collection('createRequests').doc(requestId),prior=await tx.get(requestRef);
   if(prior.exists){if(prior.get('ownerAccountId')!==a.accountId||prior.get('fingerprint')!==fingerprint)throw new AccountFault('conflict');if(prior.get('state')==='deleted')throw new AccountFault('deleted');const pid=prior.get('projectId');if(typeof pid!=='string'||!uuid.test(pid)||prior.get('state')!=='active')invariant();const p=await tx.get(this.root.collection('projects').doc(pid));if(!p.exists||p.get('deleted')!==false)invariant();return {created:false,project:project(p,a.accountId)};}
   if(a.record.activeProjectCount>=limits.projectCount)throw new AccountFault('quota');
   const value:AccountProject={id:projectId,title:data.title,content:data.content,kind:kind as ProjectKind,revision:1,createdAtMs:time,updatedAtMs:time};
   tx.create(this.root.collection('projects').doc(projectId),{ownerAccountId:a.accountId,title:data.title,kind,content:data.content,contentSha256:hash(data.content),revision:1,createdAtMs:time,updatedAtMs:time,deleted:false,createRequestId:requestId});
   tx.create(requestRef,{ownerAccountId:a.accountId,fingerprint,projectId,state:'active',createdAtMs:time});tx.update(a.ref,{activeProjectCount:a.record.activeProjectCount+1});
   return {created:true,project:value};
  });
 }
 async read(uid:string,projectId:string){
  id(projectId);return this.db.runTransaction(async tx=>{const a=await this.resolve(uid,tx),d=await tx.get(this.root.collection('projects').doc(projectId));
   if(!d.exists||d.get('ownerAccountId')!==a.accountId||d.get('deleted')!==false)throw new AccountFault('not_found');return {project:project(d,a.accountId)};});
 }
 async list(uid:string,limit?:unknown,cursor?:unknown):Promise<ProjectPage>{
  return this.db.runTransaction(async tx=>{
   const a=await this.resolve(uid,tx),p=pageInput(a.accountId,limit,cursor);
   let query=this.root.collection('projects').where('ownerAccountId','==',a.accountId).where('deleted','==',false).orderBy('createdAtMs','desc').orderBy(FieldPath.documentId(),'desc').select('ownerAccountId','deleted','title','kind','revision','createdAtMs','updatedAtMs').limit(p.count+1);
   if(p.after)query=query.startAfter(p.after.time,p.after.id);
   const data=await tx.get(query),items=data.docs.slice(0,p.count).map(d=>summary(d,a.accountId)),last=items.at(-1);
   return {items,nextCursor:data.size>p.count&&last?cursorFor(a.accountId,last.createdAtMs,last.id):null};
  });
 }
 async save(uid:string,projectId:string,expectedRevision:unknown,title:unknown,content:unknown){
  id(projectId);if(!integer(expectedRevision,1)||expectedRevision>=Number.MAX_SAFE_INTEGER)bad();const data=draft(title,content),time=this.now();
  return this.db.runTransaction(async tx=>{
   const a=await this.resolve(uid,tx),ref=this.root.collection('projects').doc(projectId),stored=await tx.get(ref);
   if(!stored.exists||stored.get('ownerAccountId')!==a.accountId||stored.get('deleted')!==false)throw new AccountFault('not_found');
   const old=project(stored,a.accountId);if(old.revision!==expectedRevision)throw new AccountFault('conflict');
   const next={...old,...data,revision:old.revision+1,updatedAtMs:time};tx.update(ref,{title:data.title,content:data.content,contentSha256:hash(data.content),revision:next.revision,updatedAtMs:time});return {project:next};
  });
 }
 async remove(uid:string,projectId:string,expectedRevision:unknown){
  id(projectId);if(!integer(expectedRevision,1))bad();const time=this.now();
  return this.db.runTransaction(async tx=>{
   const a=await this.resolve(uid,tx),ref=this.root.collection('projects').doc(projectId),d=await tx.get(ref);
   if(!d.exists||d.get('ownerAccountId')!==a.accountId||d.get('deleted')!==false)throw new AccountFault('not_found');
   const old=project(d,a.accountId);if(old.revision!==expectedRevision)throw new AccountFault('conflict');
   const key=d.get('createRequestId');if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||a.record.activeProjectCount<1)invariant();
   const request=this.root.collection('createRequests').doc(key),r=await tx.get(request);if(!r.exists||r.get('ownerAccountId')!==a.accountId||r.get('projectId')!==projectId||r.get('state')!=='active')invariant();
   tx.set(ref,{ownerAccountId:a.accountId,deleted:true,deletedAtMs:time,revision:old.revision+1,createRequestId:key});tx.update(request,{state:'deleted'});tx.update(a.ref,{activeProjectCount:a.record.activeProjectCount-1});return {deleted:true as const,id:projectId};
  });
 }
 async ledger(uid:string,limit?:unknown,cursor?:unknown):Promise<LedgerPage>{
  return this.db.runTransaction(async tx=>{
   const a=await this.resolve(uid,tx),p=pageInput(a.accountId,limit,cursor);let q=this.root.collection('ledgerEntries').where('ownerAccountId','==',a.accountId).orderBy('createdAtMs','desc').orderBy(FieldPath.documentId(),'desc').limit(p.count+1);if(p.after)q=q.startAfter(p.after.time,p.after.id);
   const data=await tx.get(q),items=data.docs.slice(0,p.count).map(d=>{const v=d.data();if(v.ownerAccountId!==a.accountId||!uuid.test(d.id)||!integer(v.createdAtMs)||!integer(v.seconds)||typeof v.kind!=='string'||v.kind.length>40)invariant();return {id:d.id,createdAtMs:v.createdAtMs,seconds:v.seconds,kind:v.kind};}),last=items.at(-1);
   return {items,nextCursor:data.size>p.count&&last?cursorFor(a.accountId,last.createdAtMs,last.id):null};
  });
 }

 /** Stable pseudonymous key used only by the allowlisted internal video services. */
 static identityKey(uid:string){return uidKey(uid);}
 private identityFromKey(key:string){
   if(!digestValid(key))bad();
  return this.root.collection('identities').doc(key);
 }
 /** A hold is durable and idempotent per incident; reopening requires a separate audited protocol. */
 async blockVideoBilling(identityKey:string,incident:string){
  incidentId(incident);const identityRef=this.identityFromKey(identityKey),time=this.now();
  return this.db.runTransaction(async tx=>{
   const identity=await tx.get(identityRef);if(!identity.exists)throw new AccountFault('account_not_provisioned');
   if(typeof identity.get('uid')!=='string'||uidKey(identity.get('uid'))!==identityKey)invariant();
   const accountId=identity.get('accountId');if(typeof accountId!=='string'||!uuid.test(accountId))invariant();
   const account=this.root.collection('accounts').doc(accountId),guard=this.root.collection('videoBillingGuards').doc(accountId),record=this.root.collection('videoBillingIncidents').doc(hash([accountId,incident]));
   const [stored,held,previous]=await tx.getAll(account,guard,record);accountRecord(stored,identityKey);const blocked=billingHold(held,accountId,identityKey);
   if(previous.exists){
    if(!blocked||previous.get('ownerAccountId')!==accountId||previous.get('identityKey')!==identityKey||previous.get('incidentId')!==incident||previous.get('state')!=='active'||!integer(previous.get('createdAtMs')))invariant();
    return {blocked:true as const,recorded:true as const,created:false};
   }
   const count=blocked?Number(held.get('incidentCount'))+1:1,epoch=blocked?Number(held.get('epoch'))+1:1;
   if(!integer(count,1)||!integer(epoch,1)||!integer(time))invariant();
   tx.create(record,{ownerAccountId:accountId,identityKey,incidentId:incident,state:'active',createdAtMs:time});
   if(blocked)tx.update(guard,{incidentCount:count,epoch,updatedAtMs:time});
   else tx.create(guard,{ownerAccountId:accountId,identityKey,blocked:true,incidentCount:count,epoch,createdAtMs:time,updatedAtMs:time});
   return {blocked:true as const,recorded:true as const,created:true};
  });
 }
 /** Status/replay is read-only; absence of this particular incident does not mean the account is open. */
 async videoBillingHold(identityKey:string,incident:string){
  incidentId(incident);const identityRef=this.identityFromKey(identityKey);
  return this.db.runTransaction(async tx=>{
   const identity=await tx.get(identityRef);if(!identity.exists)throw new AccountFault('account_not_provisioned');
   if(typeof identity.get('uid')!=='string'||uidKey(identity.get('uid'))!==identityKey)invariant();
   const accountId=identity.get('accountId');if(typeof accountId!=='string'||!uuid.test(accountId))invariant();
   const [stored,guard,record]=await tx.getAll(this.root.collection('accounts').doc(accountId),this.root.collection('videoBillingGuards').doc(accountId),this.root.collection('videoBillingIncidents').doc(hash([accountId,incident])));
   accountRecord(stored,identityKey);const blocked=billingHold(guard,accountId,identityKey);
   if(!record.exists)return {blocked,recorded:false};
   if(record.get('ownerAccountId')!==accountId||record.get('identityKey')!==identityKey||record.get('incidentId')!==incident||!integer(record.get('createdAtMs')))invariant();
   // `recorded` is only about THIS incident id: `recorded:true` means there is an ACTIVE incident with that id, so it must be
   // read together with `blocked` to know whether the account is still closed. An audited unblock leaves the incident
   // `reviewed` (terminal, so `recorded:false` even though the document persists); any other state is corruption.
   const state=record.get('state');
   if(state==='active'){if(!blocked)invariant();return {blocked,recorded:true};}
   // This operation always writes `reviewedAtMs`: a reviewed incident without an integer timestamp is corruption.
   if(state==='reviewed'){if(!integer(record.get('reviewedAtMs')))invariant();return {blocked,recorded:false};}
   invariant();
  });
 }
 /** Recover the accepted generation of this exact decision, with the current Account hold status. */
 async videoBillingUnblockReceipt(identityKey:string,incident:string,reviewRef:string){
  incidentId(incident);if(!reviewRefValid(reviewRef))bad();
  const identityRef=this.identityFromKey(identityKey);
  return this.db.runTransaction(async tx=>{
   const identity=await tx.get(identityRef);if(!identity.exists)throw new AccountFault('account_not_provisioned');
   if(typeof identity.get('uid')!=='string'||uidKey(identity.get('uid'))!==identityKey)invariant();
   const accountId=identity.get('accountId');if(typeof accountId!=='string'||!uuid.test(accountId))invariant();
   const [stored,guard,record,receipt]=await tx.getAll(
    this.root.collection('accounts').doc(accountId),
    this.root.collection('videoBillingGuards').doc(accountId),
    this.root.collection('videoBillingIncidents').doc(hash([accountId,incident])),
    this.root.collection('videoBillingUnblocks').doc(hash([accountId,incident,'unblock'])),
   );
   accountRecord(stored,identityKey);const blocked=billingHold(guard,accountId,identityKey);
   if(!record.exists)throw new AccountFault(receipt.exists?'invariant':'conflict');
   if(record.get('ownerAccountId')!==accountId||record.get('identityKey')!==identityKey||record.get('incidentId')!==incident||!integer(record.get('createdAtMs')))invariant();
   if(!receipt.exists){
    // Only a consistent active incident can establish that the mutation is still pending.
    if(!blocked||record.get('state')!=='active'||record.get('reviewedAtMs')!==undefined)invariant();
    return {state:'pending' as const,incidentId:incident,reviewRef};
   }
   if(receipt.get('reviewRef')!==reviewRef)throw new AccountFault('conflict');
   const epoch=receipt.get('epoch'),createdAtMs=receipt.get('createdAtMs'),unblockedAtMs=receipt.get('unblockedAtMs');
   if(receipt.get('ownerAccountId')!==accountId||receipt.get('identityKey')!==identityKey||receipt.get('incidentId')!==incident||
    !integer(epoch,1)||!integer(createdAtMs)||!integer(unblockedAtMs)||
    record.get('state')!=='reviewed'||record.get('reviewedAtMs')!==unblockedAtMs)throw new AccountFault('invariant');
   return {state:'confirmed' as const,incidentId:incident,reviewRef,epoch,createdAtMs,blocked};
  });
 }
 /**
  * The audited reopening of a blocked account: a human decision, executed once per incident, that DELETES the guard
  * (never writes `blocked:false`, which the `billingHold` reader above would reject as `invariant`). The caller must name
  * the incident and the guard generation (`epoch` and `createdAtMs`), so an old unblock cannot clear a newer block.
  * It never takes the drain lease and never moves balance or reservations. Repeating it is a replay without writes.
  */
 async unblockVideoBilling(identityKey:string,request:{incidentId:string;epoch:number;createdAtMs:number;reviewRef:string}){
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).sort().join(',')!=='createdAtMs,epoch,incidentId,reviewRef')bad();
  const {incidentId:incident,epoch,createdAtMs,reviewRef}=request;
  incidentId(incident);if(!integer(epoch,1)||!integer(createdAtMs)||!reviewRefValid(reviewRef))bad();
  const identityRef=this.identityFromKey(identityKey),time=this.now();
  return this.db.runTransaction(async tx=>{
   const identity=await tx.get(identityRef);if(!identity.exists)throw new AccountFault('account_not_provisioned');
   if(typeof identity.get('uid')!=='string'||uidKey(identity.get('uid'))!==identityKey)invariant();
   const accountId=identity.get('accountId');if(typeof accountId!=='string'||!uuid.test(accountId))invariant();
   const accountRef=this.root.collection('accounts').doc(accountId),guardRef=this.root.collection('videoBillingGuards').doc(accountId),recordRef=this.root.collection('videoBillingIncidents').doc(hash([accountId,incident])),unblockRef=this.root.collection('videoBillingUnblocks').doc(hash([accountId,incident,'unblock']));
   const [stored,guard,record,unblock]=await tx.getAll(accountRef,guardRef,recordRef,unblockRef);accountRecord(stored,identityKey);
   // A repeat of the same decision is a receipt; any different payload for the same incident is refused, and neither writes.
   if(unblock.exists){
    if(unblock.get('ownerAccountId')===accountId&&unblock.get('identityKey')===identityKey&&unblock.get('incidentId')===incident&&unblock.get('epoch')===epoch&&unblock.get('createdAtMs')===createdAtMs&&unblock.get('reviewRef')===reviewRef)return {unblocked:true as const,replayed:true as const,blocked:guard.exists};
    throw new AccountFault('conflict');
   }
   const blocked=billingHold(guard,accountId,identityKey);
   if(!blocked||guard.get('epoch')!==epoch||guard.get('createdAtMs')!==createdAtMs)throw new AccountFault('conflict');
   if(!record.exists)throw new AccountFault('conflict');
   if(record.get('ownerAccountId')!==accountId||record.get('identityKey')!==identityKey||record.get('incidentId')!==incident||!integer(record.get('createdAtMs')))invariant();
   if(record.get('state')!=='active')throw new AccountFault('conflict');
   // `incidentCount` incidents are known; each unblock adds one reviewed incident, and the guard survives until all are reviewed.
   const incidentCount=guard.get('incidentCount') as number,reviewed=guard.get('reviewedCount')===undefined?0:guard.get('reviewedCount');
   if(!integer(reviewed)||reviewed>=incidentCount)invariant();
   const nextReviewed=reviewed+1;if(!integer(nextReviewed,1)||nextReviewed>incidentCount)invariant();
   tx.create(unblockRef,{ownerAccountId:accountId,identityKey,incidentId:incident,epoch,createdAtMs,reviewRef,unblockedAtMs:time});
   tx.update(recordRef,{state:'reviewed',reviewedAtMs:time});
   if(nextReviewed===incidentCount)tx.delete(guardRef);else tx.update(guardRef,{reviewedCount:nextReviewed});
   return {unblocked:true as const,replayed:false as const,blocked:nextReviewed!==incidentCount};
  });
 }
 /** Atomically prevent a future reserve or return the existing reservation's receipt. */
 async sealVideoReservation(identityKey:string,reservationId:string,seconds:number){
  id(reservationId);if(!integer(seconds,1)||seconds>600)bad();
  const identityRef=this.identityFromKey(identityKey),time=this.now();
  return this.db.runTransaction(async tx=>{
   const identity=await tx.get(identityRef);if(!identity.exists)throw new AccountFault('account_not_provisioned');
   if(typeof identity.get('uid')!=='string'||uidKey(identity.get('uid'))!==identityKey)invariant();
   const accountId=identity.get('accountId');if(typeof accountId!=='string'||!uuid.test(accountId))invariant();
   const key=hash([accountId,reservationId]),reservationRef=this.root.collection('videoReservations').doc(key),tombRef=this.root.collection('videoReservationTombstones').doc(key);
   const [stored,reservation,tomb]=await tx.getAll(this.root.collection('accounts').doc(accountId),reservationRef,tombRef);accountRecord(stored,identityKey);
   const sealed=sealedReservation(tomb,accountId,identityKey,reservationId,seconds);
   if(reservation.exists&&sealed)invariant();
   if(reservation.exists){
    if(reservation.get('ownerAccountId')!==accountId||reservation.get('identityKey')!==identityKey||reservation.get('reservationId')!==reservationId||!integer(reservation.get('seconds'),1))invariant();
    if(reservation.get('seconds')!==seconds)throw new AccountFault('conflict');
    const state=reservation.get('state');if(!['reserved','captured','released'].includes(state))invariant();
    return {state:state as 'reserved'|'captured'|'released',reservationId,seconds,created:false};
   }
   if(sealed)return {state:'sealed' as const,reservationId,seconds,created:false};
   if(!integer(time))invariant();
   tx.create(tombRef,{ownerAccountId:accountId,identityKey,reservationId,seconds,state:'sealed',createdAtMs:time});
   return {state:'sealed' as const,reservationId,seconds,created:true};
  });
 }
 /** Reserve the verified source video's duration exactly once before provider dispatch. */
 async reserveVideo(identityKey:string,reservationId:string,seconds:number){
  id(reservationId);if(!integer(seconds,1)||seconds>600)bad();
  const identityRef=this.identityFromKey(identityKey),time=this.now();
  return this.db.runTransaction(async tx=>{
   const identity=await tx.get(identityRef);
   if(!identity.exists)throw new AccountFault('account_not_provisioned');
   if(typeof identity.get('uid')!=='string'||uidKey(identity.get('uid'))!==identityKey)invariant();
   const accountId=identity.get('accountId');
   if(typeof accountId!=='string'||!uuid.test(accountId))invariant();
   const accountRef=this.root.collection('accounts').doc(accountId),reservationIdHash=hash([accountId,reservationId]);
   const reservationRef=this.root.collection('videoReservations').doc(reservationIdHash),tombRef=this.root.collection('videoReservationTombstones').doc(reservationIdHash),guardRef=this.root.collection('videoBillingGuards').doc(accountId);
   const [stored,reservation,tomb,guard]=await tx.getAll(accountRef,reservationRef,tombRef,guardRef);
   const current=accountRecord(stored,identityKey),blocked=billingHold(guard,accountId,identityKey),sealed=sealedReservation(tomb,accountId,identityKey,reservationId,seconds);
   if(reservation.exists&&sealed)invariant();
   if(reservation.exists){
    if(reservation.get('ownerAccountId')!==accountId||reservation.get('identityKey')!==identityKey||reservation.get('reservationId')!==reservationId||reservation.get('seconds')!==seconds)throw new AccountFault('conflict');
    if(!integer(reservation.get('seconds'),1)||!['reserved','captured','released'].includes(reservation.get('state')))invariant();
    if(reservation.get('state')!=='reserved')throw new AccountFault('conflict');
    return {created:false,state:reservation.get('state'),seconds,account:view(accountId,current)};
   }
   if(sealed||blocked)throw new AccountFault('conflict');
   if(current.active>=maxActiveVideoReservations)throw new AccountFault('quota');
   if(current.available<seconds)throw new AccountFault('insufficient');
   const next={...current,available:current.available-seconds,reserved:current.reserved+seconds,active:current.active+1};
   if(![next.available,next.reserved,next.active].every(Number.isSafeInteger)||next.active<1)invariant();
   tx.update(accountRef,next);
    tx.create(reservationRef,{ownerAccountId:accountId,identityKey,reservationId,seconds,state:'reserved',admissionProtocol:2,createdAtMs:time,updatedAtMs:time});
   tx.create(this.root.collection('ledgerEntries').doc(ledgerId([accountId,reservationId,'reserve'])),{ownerAccountId:accountId,createdAtMs:time,seconds,kind:'video_reserve'});
   return {created:true,state:'reserved' as const,seconds,account:view(accountId,next)};
  });
 }
 /** Retained only to reject old clients; a job-wide admission can bypass a later hold. */
 async admitVideoProvider(_identityKey:string,_reservationId:string,_seconds:number,_jobId:string,_attemptId:string):Promise<{reservationId:string;seconds:number;jobId:string;attemptId:string;created:boolean;receiptOnly:boolean}>{
  throw new AccountFault('conflict');
 }
 /** Each provider call needs its own durable admission; an exact replay is only a receipt. */
 async admitVideoCall(identityKey:string,reservationId:string,seconds:number,jobId:string,attemptId:string,callKey:string,model:string,requestSha256:string){
  id(reservationId);if(!integer(seconds,1)||seconds>600||!callKeyValid(callKey)||!modelValid(model)||!digestValid(requestSha256))bad();
  const key:VideoCallIdentity={...admission({jobId,attemptId}),callKey,model,requestSha256};
  const identityRef=this.identityFromKey(identityKey),time=this.now();
  return this.db.runTransaction(async tx=>{
   const identity=await tx.get(identityRef);if(!identity.exists)throw new AccountFault('account_not_provisioned');
   if(typeof identity.get('uid')!=='string'||uidKey(identity.get('uid'))!==identityKey)invariant();
   const accountId=identity.get('accountId');if(typeof accountId!=='string'||!uuid.test(accountId))invariant();
   const reservationKey=hash([accountId,reservationId]),reservationRef=this.root.collection('videoReservations').doc(reservationKey),calls=reservationRef.collection('providerCalls'),callRef=calls.doc(callDocId(callKey)),fenceRef=reservationRef.collection('providerCallFences').doc('first');
   const [stored,reservation,tomb,guard,call,fence]=await tx.getAll(this.root.collection('accounts').doc(accountId),reservationRef,this.root.collection('videoReservationTombstones').doc(reservationKey),this.root.collection('videoBillingGuards').doc(accountId),callRef,fenceRef);
   accountRecord(stored,identityKey);const blocked=billingHold(guard,accountId,identityKey),sealed=sealedReservation(tomb,accountId,identityKey,reservationId,seconds);
   if(reservation.exists&&sealed)invariant();
   if(!reservation.exists){if(sealed)throw new AccountFault('conflict');throw new AccountFault('not_found');}
   if(reservation.get('ownerAccountId')!==accountId||reservation.get('identityKey')!==identityKey||reservation.get('reservationId')!==reservationId||!integer(reservation.get('seconds'),1))invariant();
   if(reservation.get('seconds')!==seconds)throw new AccountFault('conflict');
   const state=reservation.get('state');if(!['reserved','captured','released'].includes(state))invariant();
   // A missing version does not prove that an older worker never contacted the provider.
   if(reservation.get('admissionProtocol')!==2)throw new AccountFault('conflict');
   const previous=storedAdmission(reservation),capturedWith=reservation.get('captureAdmission');
   if(capturedWith!==undefined&&(state!=='captured'||!previous))invariant();
   if(previous){
    if(!sameAdmission(previous,key))throw new AccountFault('conflict');
    if(state==='released'&&!sameAdmission(reservation.get('releaseAdmission'),previous))invariant();
    if(state==='captured'&&!sameAdmission(capturedWith,key))invariant();
    const first=firstCall(previous),firstRef=calls.doc(callDocId(first.callKey)),firstReceipt=firstRef.path===callRef.path?call:await tx.get(firstRef);
    if(!sameCall(storedCall(fence,accountId,identityKey,reservationId,seconds),first)||fence.get('admittedAtMs')!==previous.admittedAtMs)invariant();
    if(!sameCall(storedCall(firstReceipt,accountId,identityKey,reservationId,seconds),first)||firstReceipt.get('admittedAtMs')!==previous.admittedAtMs)invariant();
    if(first.callKey.split(':')[0]!==callKey.split(':')[0]||first.model!==model)throw new AccountFault('conflict');
   }else if(call.exists||fence.exists)invariant();
   if(call.exists){
    if(!sameCall(storedCall(call,accountId,identityKey,reservationId,seconds),key))throw new AccountFault('conflict');
    return {reservationId,seconds,...key,created:false,receiptOnly:true};
   }
   if(state!=='reserved'||blocked)throw new AccountFault('conflict');
   if(!modelMatchesKey(callKey,model))throw new AccountFault('conflict');
   if(!integer(time))invariant();
   tx.create(callRef,{admissionProtocol:2,ownerAccountId:accountId,identityKey,reservationId,seconds,...key,admittedAtMs:time});
   if(!previous){
    tx.create(fenceRef,{admissionProtocol:2,ownerAccountId:accountId,identityKey,reservationId,seconds,...key,admittedAtMs:time});
    tx.update(reservationRef,{providerAdmission:{jobId,attemptId,firstCallKey:callKey,firstModel:model,firstRequestSha256:requestSha256,admittedAtMs:time},updatedAtMs:time});
   }
   return {reservationId,seconds,...key,created:true,receiptOnly:false};
  });
 }
 /**
  * Capture requires the admitted attempt. LV-019.B C2a: `capturedSeconds` settles K of N seconds and returns the remainder in the same transaction; a release after a
  * provider admission needs that admission plus a resolution, which is Video's unverifiable claim and is stored as such. Without a stored admission a release is the plain one.
  */
 async settleVideo(identityKey:string,reservationId:string,action:'capture'|'release',expectedSeconds:number,providerAdmission?:VideoProviderAdmission,options?:VideoSettlementOptions){
  id(reservationId);if((action!=='capture'&&action!=='release')||!integer(expectedSeconds,1)||expectedSeconds>600)bad();
  const supplied=providerAdmission===undefined?null:admission(providerAdmission),{partial,resolution}=settlementOptions(action,expectedSeconds,supplied!==null,options);
  const identityRef=this.identityFromKey(identityKey),time=this.now();
  return this.db.runTransaction(async tx=>{
   const identity=await tx.get(identityRef);
   if(!identity.exists)throw new AccountFault('account_not_provisioned');
   if(typeof identity.get('uid')!=='string'||uidKey(identity.get('uid'))!==identityKey)invariant();
   const accountId=identity.get('accountId');if(typeof accountId!=='string'||!uuid.test(accountId))invariant();
    const reservationIdHash=hash([accountId,reservationId]),accountRef=this.root.collection('accounts').doc(accountId),reservationRef=this.root.collection('videoReservations').doc(reservationIdHash);
    const [stored,reservation,tomb,guard,fence]=await tx.getAll(accountRef,reservationRef,this.root.collection('videoReservationTombstones').doc(reservationIdHash),this.root.collection('videoBillingGuards').doc(accountId),reservationRef.collection('providerCallFences').doc('first'));
    const current=accountRecord(stored,identityKey),blocked=billingHold(guard,accountId,identityKey),sealed=sealedReservation(tomb,accountId,identityKey,reservationId,expectedSeconds);
    if(reservation.exists&&sealed)invariant();
   if(!reservation.exists)throw new AccountFault('not_found');
   if(reservation.get('ownerAccountId')!==accountId||reservation.get('identityKey')!==identityKey||reservation.get('reservationId')!==reservationId||!integer(reservation.get('seconds'),1))invariant();
   const state=reservation.get('state'),seconds=reservation.get('seconds') as number;
   if(!['reserved','captured','released'].includes(state))invariant();
   if(seconds!==expectedSeconds)throw new AccountFault('conflict');
     const previous=storedAdmission(reservation),capturedWith=reservation.get('captureAdmission'),protocol=reservation.get('admissionProtocol');
     if(protocol!==undefined&&protocol!==1&&protocol!==2)invariant();
     if(protocol===2){
      const calls=reservationRef.collection('providerCalls');
       if(previous){const first=firstCall(previous),receipt=await tx.get(calls.doc(callDocId(first.callKey)));if(!sameCall(storedCall(fence,accountId,identityKey,reservationId,seconds),first)||fence.get('admittedAtMs')!==previous.admittedAtMs||!sameCall(storedCall(receipt,accountId,identityKey,reservationId,seconds),first)||receipt.get('admittedAtMs')!==previous.admittedAtMs)invariant();}
       else if(state==='captured'||fence.exists)invariant();
     }
    if(state===action+'d'){
     const storedKept=reservation.get('capturedSeconds'),storedReturned=reservation.get('releasedSeconds'),marker=reservation.get('partialSettlement'),split=storedKept!==undefined||storedReturned!==undefined||marker!==undefined;
     if(action==='capture'){
      if(split&&(marker!==true||!integer(storedKept,1)||storedKept>=seconds||storedReturned!==seconds-storedKept))invariant();
      // A captured reservation never carries release fields, and its captureAdmission exists exactly when and as its provider admission does: anything else is corruption.
      if(reservation.get('releaseAdmission')!==undefined||reservation.get('resolution')!==undefined)invariant();
      if(previous?!sameAdmission(capturedWith,previous):capturedWith!==undefined)invariant();
      if(previous){if(!supplied||!sameAdmission(previous,supplied))throw new AccountFault('conflict');}
      else if(supplied)throw new AccountFault('conflict'); // Legacy terminal receipt, never an admission.
      if((partial??null)!==(split?storedKept as number:null))throw new AccountFault('conflict');
      return {settled:false,state,seconds,account:view(accountId,current),...(split?{capturedSeconds:storedKept as number,releasedSeconds:storedReturned as number}:{})};
     }
     if(split||capturedWith!==undefined)invariant();
     const releasedWith=reservation.get('releaseAdmission'),storedResolution=reservation.get('resolution');
     if(storedResolution!==undefined&&!validResolution(storedResolution))invariant();
     if(previous){
      // Released with a provider admission but without the matching releaseAdmission and a resolution is corruption.
      if(!sameAdmission(releasedWith,previous)||storedResolution===undefined)invariant();
      if(!supplied||!resolution||!sameAdmission(previous,supplied)||!sameResolution(storedResolution,resolution))throw new AccountFault('conflict');
     }else{
      if(releasedWith!==undefined)invariant();
      // No admission on record: the supplied admission was only a claim; a repeated claim must repeat the stored resolution.
      if(resolution&&(storedResolution===undefined||!sameResolution(storedResolution,resolution)))throw new AccountFault('conflict');
     }
     return {settled:false,state,seconds,account:view(accountId,current),admitted:previous!==null};
    }
   if(state!=='reserved')throw new AccountFault('conflict');
     // Legacy active reservations cannot prove the absence of earlier provider calls.
     if(protocol!==2)throw new AccountFault('conflict');
    if(capturedWith!==undefined)invariant();
    if(blocked)throw new AccountFault('conflict');
    if(action==='capture'&&(!previous||!supplied||!sameAdmission(previous,supplied)))throw new AccountFault('conflict');
    if(action==='release'&&previous){
     // Account cannot see whether the provider delivered: the admission must match and Video's resolution is stored with its evidence hash.
     if(!supplied||!resolution||!sameAdmission(previous,supplied))throw new AccountFault('conflict');
     if(resolution.kind==='unknown_expired'&&time-previous.admittedAtMs<UNKNOWN_RESOLUTION_MIN_AGE_MS)throw new AccountFault('too_early');
    }
   if(current.reserved<seconds||current.active<1)invariant();
   const splitNow=action==='capture'&&partial!==undefined,kept=action==='capture'?(splitNow?partial as number:seconds):0,returned=seconds-kept;
   const next={...current,reserved:current.reserved-seconds,available:current.available+returned,consumed:current.consumed+kept,active:current.active-1};
   if(![next.reserved,next.available,next.consumed,next.active].every(Number.isSafeInteger)||next.active<0||next.reserved<0||next.available<0||next.consumed<0||next.credited!==next.available+next.reserved+next.consumed)invariant();
    tx.update(accountRef,next);
    tx.update(reservationRef,{state:action+'d',updatedAtMs:time,...(action==='capture'?{captureAdmission:supplied,...(splitNow?{capturedSeconds:kept,releasedSeconds:returned,partialSettlement:true}:{})}:{...(previous?{releaseAdmission:supplied}:{}),...(resolution?{resolution}:{})})});
   tx.create(this.root.collection('ledgerEntries').doc(ledgerId([accountId,reservationId,action])),{ownerAccountId:accountId,createdAtMs:time,seconds:action==='capture'?kept:seconds,kind:action==='capture'?'video_capture':'video_release'});
   if(splitNow)tx.create(this.root.collection('ledgerEntries').doc(ledgerId([accountId,reservationId,'release'])),{ownerAccountId:accountId,createdAtMs:time,seconds:returned,kind:'video_release_remainder'});
   return {settled:true,state:action+'d',seconds,account:view(accountId,next),...(splitNow?{capturedSeconds:kept,releasedSeconds:returned}:{}),...(action==='release'?{admitted:previous!==null}:{})};
  });
 }
 /** Read the resolution evidence without creating a tombstone or moving balance. */
 async videoReservationResolution(identityKey:string,reservationId:string,seconds:number){
  id(reservationId);if(!integer(seconds,1)||seconds>600)bad();const identityRef=this.identityFromKey(identityKey);
  return this.db.runTransaction(async tx=>{
   const identity=await tx.get(identityRef);if(!identity.exists)throw new AccountFault('account_not_provisioned');
   if(typeof identity.get('uid')!=='string'||uidKey(identity.get('uid'))!==identityKey)invariant();
   const accountId=identity.get('accountId');if(typeof accountId!=='string'||!uuid.test(accountId))invariant();
   const key=hash([accountId,reservationId]),[stored,reservation,tomb]=await tx.getAll(this.root.collection('accounts').doc(accountId),this.root.collection('videoReservations').doc(key),this.root.collection('videoReservationTombstones').doc(key));
   accountRecord(stored,identityKey);const sealed=sealedReservation(tomb,accountId,identityKey,reservationId,seconds);
   if(reservation.exists&&sealed)invariant();
   if(sealed)return {reservationId,seconds,state:'sealed' as const};
   if(!reservation.exists)throw new AccountFault('not_found');
   if(reservation.get('ownerAccountId')!==accountId||reservation.get('identityKey')!==identityKey||reservation.get('reservationId')!==reservationId||!integer(reservation.get('seconds'),1))invariant();
   if(reservation.get('seconds')!==seconds)throw new AccountFault('conflict');
   const state=reservation.get('state');if(!['reserved','captured','released'].includes(state))invariant();
   return {reservationId,seconds,state:state as 'reserved'|'captured'|'released'};
  });
 }
 async videoReservation(identityKey:string,reservationId:string){
  id(reservationId);const identityRef=this.identityFromKey(identityKey);
  return this.db.runTransaction(async tx=>{
   const identity=await tx.get(identityRef);
   if(!identity.exists)throw new AccountFault('account_not_provisioned');
   if(typeof identity.get('uid')!=='string'||uidKey(identity.get('uid'))!==identityKey)invariant();
   const accountId=identity.get('accountId');if(typeof accountId!=='string'||!uuid.test(accountId))invariant();
   const d=await tx.get(this.root.collection('videoReservations').doc(hash([accountId,reservationId])));
   if(!d.exists)throw new AccountFault('not_found');
   if(d.get('ownerAccountId')!==accountId||d.get('identityKey')!==identityKey||d.get('reservationId')!==reservationId)invariant();
   const seconds=d.get('seconds'),state=d.get('state');if(!integer(seconds,1)||!['reserved','captured','released'].includes(state))invariant();
   return {reservationId,seconds,state};
  });
 }
 async videoBalance(identityKey:string){
  const identityRef=this.identityFromKey(identityKey);
  // Both reads share Account Firestore's transaction, not a transaction with
  // the separate video database. A later revocation cannot retract a response.
  return this.db.runTransaction(async tx=>{
   const identity=await tx.get(identityRef);
   if(!identity.exists)throw new AccountFault('account_not_provisioned');
   if(typeof identity.get('uid')!=='string'||uidKey(identity.get('uid'))!==identityKey)invariant();
   const accountId=identity.get('accountId');if(typeof accountId!=='string'||!uuid.test(accountId))invariant();
   const account=await tx.get(this.root.collection('accounts').doc(accountId)),current=accountRecord(account,identityKey);
   return {unit:'video_seconds' as const,credited:current.credited,available:current.available,reserved:current.reserved,consumed:current.consumed,active:current.active};
  });
 }
}
