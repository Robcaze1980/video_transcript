import {createHash,randomUUID} from 'node:crypto';
import {FieldPath,type Firestore,type DocumentReference,type Transaction,type DocumentSnapshot} from 'firebase-admin/firestore';
import type {AccountView,AccountProject,ProjectKind,ProjectPage,ProjectSummary,LedgerPage} from './contracts';

export class AccountFault extends Error {constructor(readonly code:'invalid'|'not_found'|'account_not_provisioned'|'conflict'|'deleted'|'quota'|'invariant'){super(code);}}
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const limits={projectBytes:65536,projectCount:100,titleCharacters:120};
const bad=()=>{throw new AccountFault('invalid');};
const invariant=()=>{throw new AccountFault('invariant');};
function uidKey(uid:string){if(typeof uid!=='string'||!uid||uid.length>128)bad();return hash(['firebase',uid]);}
function id(value:string){if(typeof value!=='string'||!uuid.test(value))bad();return value;}
function integer(n:unknown,min=0):n is number{return Number.isSafeInteger(n)&&Number(n)>=min;}
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
 private async resolve(uid:string,tx?:Transaction){
  const identity=this.identity(uid),d=await (tx?tx.get(identity.ref):identity.ref.get());
  if(!d.exists)throw new AccountFault('account_not_provisioned');
  const a=d.get('accountId');if(d.get('uid')!==uid||typeof a!=='string'||!uuid.test(a))invariant();
  const ref=this.root.collection('accounts').doc(a),record=await (tx?tx.get(ref):ref.get());return {accountId:a,ref,record:accountRecord(record,identity.key)};
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
 async me(uid:string){const a=await this.resolve(uid);return view(a.accountId,a.record);}
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
 async read(uid:string,projectId:string){id(projectId);const a=await this.resolve(uid),d=await this.root.collection('projects').doc(projectId).get();if(!d.exists||d.get('ownerAccountId')!==a.accountId||d.get('deleted')!==false)throw new AccountFault('not_found');return {project:project(d,a.accountId)};}
 async list(uid:string,limit?:unknown,cursor?:unknown):Promise<ProjectPage>{
  const a=await this.resolve(uid),p=pageInput(a.accountId,limit,cursor);
  let query=this.root.collection('projects').where('ownerAccountId','==',a.accountId).where('deleted','==',false).orderBy('createdAtMs','desc').orderBy(FieldPath.documentId(),'desc').select('ownerAccountId','deleted','title','kind','revision','createdAtMs','updatedAtMs').limit(p.count+1);
  if(p.after)query=query.startAfter(p.after.time,p.after.id);
  const data=await query.get(),items=data.docs.slice(0,p.count).map(d=>summary(d,a.accountId)),last=items.at(-1);
  return {items,nextCursor:data.size>p.count&&last?cursorFor(a.accountId,last.createdAtMs,last.id):null};
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
  const a=await this.resolve(uid),p=pageInput(a.accountId,limit,cursor);let q=this.root.collection('ledgerEntries').where('ownerAccountId','==',a.accountId).orderBy('createdAtMs','desc').orderBy(FieldPath.documentId(),'desc').limit(p.count+1);if(p.after)q=q.startAfter(p.after.time,p.after.id);
  const data=await q.get(),items=data.docs.slice(0,p.count).map(d=>{const v=d.data();if(v.ownerAccountId!==a.accountId||!uuid.test(d.id)||!integer(v.createdAtMs)||!integer(v.seconds)||typeof v.kind!=='string'||v.kind.length>40)invariant();return {id:d.id,createdAtMs:v.createdAtMs,seconds:v.seconds,kind:v.kind};}),last=items.at(-1);
  return {items,nextCursor:data.size>p.count&&last?cursorFor(a.accountId,last.createdAtMs,last.id):null};
 }
}
