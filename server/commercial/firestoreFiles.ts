import {createHash,randomUUID} from 'node:crypto';
import {FieldPath,type DocumentReference,type Firestore,type Transaction} from 'firebase-admin/firestore';
import type {CloudObject,CloudObjects} from './gcsObjects';
import {ObjectFault} from './gcsObjects';
import {objectPlan,privateBucket,privateChunkBytes,privateSha,privateUuid,readyPrivateInput,type ObjectPlan} from './privateObjectPlan';

type FileState='uploading'|'queued'|'verifying'|'cleaning'|'ready'|'deleting'|'deleted';
export type FileRole='validate'|'cleanup';
export interface VideoFacts {duration:number;width:number;height:number;audioTracks:number}
interface Chunk {index:number;size:number;sha256:string;generation:string}
interface Receipt {object:CloudObject;sha256:string;video:VideoFacts;manifestSha:string}
interface Upload {id:string;accountId:string;name:string;size:number;expectedSha:string;expiresAtMs:number;
  chunkBytes:number;plan:ObjectPlan;state:FileState;offset:number;chunks:Chunk[];manifestSha:string|null;
  quotaHeld:number;quotaMode:'reserved'|'committed'|'none';activeHeld:boolean;leaseToken:string|null;leaseUntil:number|null;
  attempts:number;receipt:Receipt|null;failure:string|null;purgeState:'pending'|'done'}
export interface FileStatus {id:string;name:string;size:number;offset:number;state:FileState;expiresAtMs:number;
  sha256?:string;metadata?:VideoFacts;failure?:string}
export interface FileProbe {inspect(object:CloudObject,expectedSha:string,signal:AbortSignal):Promise<{sha256:string;video:VideoFacts}>}
export class FileFault extends Error {
  constructor(readonly code:'invalid'|'not_found'|'conflict'|'expired'|'quota'|'invariant'|'unavailable'){super(code);}
}
export interface FileMaintenanceReport {ids:string[];failures:Array<{stage:'expiry'|'cursor';id:string|null;code:FileFault['code']|number|'UNCLASSIFIED'}>}
const hash=(data:unknown)=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
const bytesHash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
function id(value:string){if(typeof value!=='string'||!privateUuid.test(value))throw new FileFault('invalid');}
function integer(value:number){if(!Number.isSafeInteger(value)||value<0)throw new FileFault('invariant');return value;}
function samePlan(a:ObjectPlan,b:ObjectPlan){return !!a&&a.final===b.final&&Array.isArray(a.chunks)&&Array.isArray(a.groups)&&
  a.chunks.length===b.chunks.length&&a.groups.length===b.groups.length&&a.chunks.every((v,i)=>v===b.chunks[i])&&a.groups.every((v,i)=>v===b.groups[i]);}
const manifestHash=(u:Upload)=>hash([u.id,u.size,u.expectedSha,u.chunks.map(c=>[c.index,c.size,c.sha256,c.generation])]);
const roleFor=(u:Upload):FileRole|null=>['queued','verifying'].includes(u.state)?'validate':['cleaning','deleting'].includes(u.state)?'cleanup':null;

/** Durable metadata and quota. All object IO is explicitly outside Firestore callbacks. */
export class FirestoreFiles {
  readonly limits:{quotaBytes:number;maxActive:number;ttlMs:number;chunkBytes:number;leaseMs:number};
  constructor(private readonly db:Firestore,private readonly root:DocumentReference,readonly objects:CloudObjects,
    options:Partial<FirestoreFiles['limits']>={},private readonly purgeResults?:(accountId:string,inputId:string)=>Promise<void>){
    this.limits={quotaBytes:2*1024*1024*1024,maxActive:3,ttlMs:24*60*60*1000,chunkBytes:privateChunkBytes,leaseMs:120000,...options};
    for(const value of Object.values(this.limits))if(!Number.isSafeInteger(value)||value<1)throw new FileFault('invalid');
    if(this.limits.chunkBytes>privateChunkBytes)throw new FileFault('invalid');
  }
  private ref(collection:string,name:string){return this.root.collection(collection).doc(name);}
  private decode(doc:{exists:boolean;data:()=>unknown},owner?:string):Upload {
    if(!doc.exists)throw new FileFault('not_found');const u=doc.data() as Upload;
    if(owner&&u.accountId!==owner)throw new FileFault('not_found');id(u.id);id(u.accountId);
    if(!['uploading','queued','verifying','cleaning','ready','deleting','deleted'].includes(u.state)||typeof u.expectedSha!=='string'||!privateSha.test(u.expectedSha)||
      !samePlan(u.plan,objectPlan(u.id,u.size,u.chunkBytes))||!Array.isArray(u.chunks))throw new FileFault('invariant');
    integer(u.offset);integer(u.quotaHeld);integer(u.expiresAtMs);integer(u.attempts);
    if(u.offset>u.size||u.chunks.length>u.plan.chunks.length)throw new FileFault('invariant');
    if(u.state!=='deleted'){
      let offset=0;for(let i=0;i<u.chunks.length;i++){const c=u.chunks[i];if(c.index!==i||c.size!==Math.min(u.chunkBytes,u.size-i*u.chunkBytes)||
        typeof c.generation!=='string'||!/^[1-9]\d{0,30}$/.test(c.generation)||typeof c.sha256!=='string'||!privateSha.test(c.sha256))throw new FileFault('invariant');offset+=c.size;}
      if(offset!==u.offset)throw new FileFault('invariant');
    }
    if(u.receipt&&(u.receipt.object.key!==u.plan.final||u.receipt.object.size!==u.size||u.receipt.sha256!==u.expectedSha||
      typeof u.receipt.object.generation!=='string'||!/^[1-9]\d{0,30}$/.test(u.receipt.object.generation)))throw new FileFault('invariant');
    return u;
  }
  private quota(data:Record<string,unknown>){return {storageReservedBytes:integer((data.storageReservedBytes??0) as number),
    storageCommittedBytes:integer((data.storageCommittedBytes??0) as number),activeUploads:integer((data.activeUploads??0) as number)};}
  private live(u:Upload){if(u.expiresAtMs<=Date.now())throw new FileFault('expired');if(['deleting','deleted'].includes(u.state))throw new FileFault('not_found');}
  private dto(u:Upload):FileStatus {return {id:u.id,name:u.name,size:u.size,offset:u.offset,state:u.state,expiresAtMs:u.expiresAtMs,
    ...(u.state==='ready'&&u.receipt?{sha256:u.receipt.sha256,metadata:u.receipt.video}:{}),...(u.failure?{failure:u.failure}:{})};}
  async begin(accountId:string,name:string,size:number,expectedSha:string,requestKey:string){
    id(accountId);if(typeof name!=='string'||!name.trim()||name.length>255||/[\x00-\x1f\x7f]/.test(name)||
      typeof expectedSha!=='string'||!privateSha.test(expectedSha)||typeof requestKey!=='string'||!requestKey.trim()||requestKey.length>200)throw new FileFault('invalid');
    let plan:ObjectPlan;const uploadId=randomUUID();try{plan=objectPlan(uploadId,size,this.limits.chunkBytes);}catch{throw new FileFault('invalid');}
    const fingerprint=hash([name,size,expectedSha]);const request=this.ref('fileRequests',hash([accountId,requestKey]));
    return this.db.runTransaction(async tx=>{
      const account=this.ref('accounts',accountId),[a,prior]=await tx.getAll(account,request);
      if(!a.exists)throw new FileFault('not_found');
      if(prior.exists){if(prior.get('fingerprint')!==fingerprint)throw new FileFault('conflict');return this.dto(this.decode(await tx.get(this.ref('uploads',prior.get('id'))),accountId));}
      const q=this.quota(a.data()!),held=size*3;
      if(q.activeUploads>=this.limits.maxActive||q.storageReservedBytes+q.storageCommittedBytes+held>this.limits.quotaBytes)throw new FileFault('quota');
      const u:Upload={id:uploadId,accountId,name,size,expectedSha,expiresAtMs:Date.now()+this.limits.ttlMs,chunkBytes:this.limits.chunkBytes,plan,
        state:'uploading',offset:0,chunks:[],manifestSha:null,quotaHeld:held,quotaMode:'reserved',activeHeld:true,leaseToken:null,leaseUntil:null,
        attempts:0,receipt:null,failure:null,purgeState:'pending'};
      tx.update(account,{...q,storageReservedBytes:q.storageReservedBytes+held,activeUploads:q.activeUploads+1});
      tx.create(this.ref('uploads',uploadId),u);tx.create(request,{accountId,id:uploadId,fingerprint});return this.dto(u);
    });
  }
  async status(accountId:string,uploadId:string){id(accountId);id(uploadId);const u=this.decode(await this.ref('uploads',uploadId).get(),accountId);
    if(!['deleting','deleted'].includes(u.state))this.live(u);return this.dto(u);}
  async append(accountId:string,uploadId:string,offset:number,bytes:Buffer){
    id(accountId);id(uploadId);if(!Number.isSafeInteger(offset)||offset<0||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>this.limits.chunkBytes)throw new FileFault('invalid');
    const digest=bytesHash(bytes),token=randomUUID(),ref=this.ref('uploads',uploadId);
    const prepared=await this.db.runTransaction(async tx=>{
      const u=this.decode(await tx.get(ref),accountId);this.live(u);
      if(offset<u.offset){const chunk=u.chunks.find(c=>c.index*u.chunkBytes===offset);
        if(!chunk||chunk.size!==bytes.length||chunk.sha256!==digest)throw new FileFault('conflict');return {done:true as const,u};}
      if(u.state!=='uploading'||offset!==u.offset||offset%u.chunkBytes||bytes.length!==Math.min(u.chunkBytes,u.size-offset)||
        (u.leaseToken&&u.leaseUntil!>Date.now()))throw new FileFault('conflict');
      tx.update(ref,{leaseToken:token,leaseUntil:Date.now()+this.limits.leaseMs});return {done:false as const,u};
    });
    if(prepared.done)return this.dto(prepared.u);
    const index=offset/prepared.u.chunkBytes;
    let object:CloudObject;
    try{object=await this.objects.putOnce(prepared.u.plan.chunks[index],bytes);}catch(e){
      await this.db.runTransaction(async tx=>{const d=await tx.get(ref);if(d.exists&&d.get('leaseToken')===token)tx.update(ref,{leaseToken:null,leaseUntil:null});});
      if(e instanceof ObjectFault&&e.code==='conflict')throw new FileFault('conflict');throw new FileFault('unavailable');
    }
    return this.db.runTransaction(async tx=>{
      const u=this.decode(await tx.get(ref),accountId);this.live(u);
      if(u.offset>offset){const prior=u.chunks[index];if(prior?.sha256===digest&&prior.size===bytes.length&&prior.generation===object.generation)return this.dto(u);}
      if(u.state!=='uploading'||u.leaseToken!==token||u.offset!==offset)throw new FileFault('conflict');
      const next={...u,offset:offset+bytes.length,chunks:[...u.chunks,{index,size:bytes.length,sha256:digest,generation:object.generation}],leaseToken:null,leaseUntil:null};
      tx.update(ref,{offset:next.offset,chunks:next.chunks,leaseToken:null,leaseUntil:null});return this.dto(next);
    });
  }
  async complete(accountId:string,uploadId:string){id(accountId);id(uploadId);return this.db.runTransaction(async tx=>{
    const ref=this.ref('uploads',uploadId),u=this.decode(await tx.get(ref),accountId);this.live(u);
    if(['queued','verifying','cleaning','ready'].includes(u.state))return this.dto(u);
    if(u.state!=='uploading'||u.offset!==u.size||u.chunks.length!==u.plan.chunks.length||u.leaseToken)throw new FileFault('conflict');
    tx.update(ref,{state:'queued',manifestSha:manifestHash(u)});
    tx.set(this.ref('fileOutbox',uploadId),{state:'pending',nextAttemptAt:Date.now(),dispatchToken:null,dispatchLeaseUntil:null});
    return this.dto({...u,state:'queued'});
  });}
  async remove(accountId:string,uploadId:string,failure:string|null=null){id(accountId);id(uploadId);return this.db.runTransaction(async tx=>{
    const ref=this.ref('uploads',uploadId),inputRef=this.ref('inputs',uploadId);
    const [doc,input]=await tx.getAll(ref,inputRef),u=this.decode(doc,accountId);
    if(['deleting','deleted'].includes(u.state))return this.dto(u);
    tx.update(ref,{state:'deleting',name:'',leaseToken:null,leaseUntil:null,failure});
    if(input.exists){if(input.get('accountId')!==accountId)throw new FileFault('invariant');tx.update(inputRef,{deleted:true,ready:false});}
    tx.set(this.ref('fileOutbox',uploadId),{state:'pending',nextAttemptAt:Date.now(),dispatchToken:null,dispatchLeaseUntil:null});
    return this.dto({...u,state:'deleting',name:'',failure});
  });}
  async download(accountId:string,uploadId:string){id(accountId);id(uploadId);return this.db.runTransaction(async tx=>{
    const [doc,input]=await tx.getAll(this.ref('uploads',uploadId),this.ref('inputs',uploadId));const u=this.decode(doc,accountId);this.live(u);
    if(u.state!=='ready'||!u.receipt||!input.exists||input.get('accountId')!==accountId||input.get('deleted')||input.get('expiresAtMs')<=Date.now()||
      !readyPrivateInput(input.data(),uploadId)||input.get('storage').generation!==u.receipt.object.generation)throw new FileFault('not_found');
    return {status:this.dto(u),object:u.receipt.object};
  });}
  async claimDispatch(uploadId:string){id(uploadId);const token=randomUUID();return this.db.runTransaction(async tx=>{
    const event=this.ref('fileOutbox',uploadId),[e,d]=await tx.getAll(event,this.ref('uploads',uploadId));
    if(!e.exists||e.get('state')!=='pending'||e.get('nextAttemptAt')>Date.now()||e.get('dispatchLeaseUntil')>Date.now())return null;
    const u=this.decode(d),role=roleFor(u);if(!role)return null;
    tx.update(event,{dispatchToken:token,dispatchLeaseUntil:Date.now()+30000,nextAttemptAt:Date.now()+60000});return {uploadId,role,token};
  });}
  async acknowledgeDispatch(uploadId:string,token:string){id(uploadId);id(token);return this.db.runTransaction(async tx=>{
    const ref=this.ref('fileOutbox',uploadId),d=await tx.get(ref);if(!d.exists||d.get('dispatchToken')!==token)return false;
    tx.update(ref,{dispatchToken:null,dispatchLeaseUntil:null});return true;
  });}
  async maintenanceReport():Promise<FileMaintenanceReport>{
    const cursorRef=this.ref('maintenance','files-expiry-v1'),cursorDoc=await cursorRef.get(),cursor=cursorDoc.data();
    if(cursor&&(cursor.kind!=='files-expiry-cursor-v1'||!Number.isSafeInteger(cursor.expiresAtMs)||cursor.expiresAtMs<0||typeof cursor.id!=='string'||!cursor.id||cursor.id.includes('/')||cursor.id.length>1500))throw new FileFault('invariant');
    const query=this.root.collection('uploads').where('purgeState','==','pending').where('expiresAtMs','<=',Date.now()).orderBy('expiresAtMs').orderBy(FieldPath.documentId()).limit(25);
    let expired=await (cursor?query.startAfter(cursor.expiresAtMs,cursor.id):query).get();
    // At most two bounded reads: advancing beyond poison, then wrapping only at the end.
    if(cursor&&expired.empty)expired=await query.endAt(cursor.expiresAtMs,cursor.id).get();
    const failures:FileMaintenanceReport['failures']=[];
    for(const doc of expired.docs){try{const u=this.decode(doc);await this.remove(u.accountId,u.id,'expired');}catch(error){
      const numeric=(error as {code?:unknown}|null)?.code;
      failures.push({stage:'expiry',id:privateUuid.test(doc.id)?doc.id:null,code:error instanceof FileFault?error.code:typeof numeric==='number'&&Number.isSafeInteger(numeric)?numeric:'UNCLASSIFIED'});
    }}
    const pending=await this.root.collection('fileOutbox').where('state','==','pending').where('nextAttemptAt','<=',Date.now()).orderBy('nextAttemptAt').limit(25).get();
    const last=expired.docs.at(-1);
    if(last)try{await this.db.runTransaction(async tx=>{
      const current=await tx.get(cursorRef);
      // Do not overwrite advancement from another maintenance request.
      if(current.exists!==cursorDoc.exists||(current.exists&&!current.updateTime!.isEqual(cursorDoc.updateTime!)))return;
      tx.set(cursorRef,{kind:'files-expiry-cursor-v1',expiresAtMs:last.get('expiresAtMs'),id:last.id,updatedAtMs:Date.now()});
    });}catch(error){const code=(error as {code?:unknown}|null)?.code;failures.push({stage:'cursor',id:null,code:error instanceof FileFault?error.code:typeof code==='number'&&Number.isSafeInteger(code)?code:'UNCLASSIFIED'});}
    return {ids:pending.docs.map(doc=>doc.id),failures};
  }
  async maintenance(){return (await this.maintenanceReport()).ids;}
  private async claim(uploadId:string,role:FileRole){id(uploadId);const token=randomUUID();return this.db.runTransaction(async tx=>{
    const ref=this.ref('uploads',uploadId),u=this.decode(await tx.get(ref));
    if(roleFor(u)!==role||(u.leaseToken&&u.leaseUntil!>Date.now()))return null;
    if(role==='validate'&&u.expiresAtMs<=Date.now())return null;
    const state=role==='validate'?'verifying':u.state;
    integer(u.attempts+1);tx.update(ref,{state,leaseToken:token,leaseUntil:Date.now()+this.limits.leaseMs,attempts:u.attempts+1});
    tx.update(this.ref('fileOutbox',uploadId),{nextAttemptAt:Date.now()+this.limits.leaseMs+10000,dispatchToken:null,dispatchLeaseUntil:null});
    return {u:{...u,state} as Upload,token};
  });}
  private async renew(uploadId:string,token:string){return this.db.runTransaction(async tx=>{
    const ref=this.ref('uploads',uploadId),d=await tx.get(ref);
    if(!d.exists||d.get('leaseToken')!==token||!['verifying','cleaning','deleting'].includes(d.get('state')))return false;
    tx.update(ref,{leaseUntil:Date.now()+this.limits.leaseMs});
    tx.update(this.ref('fileOutbox',uploadId),{nextAttemptAt:Date.now()+this.limits.leaseMs+10000});return true;
  });}
  async work(uploadId:string,role:FileRole,probe?:FileProbe){
    const claim=await this.claim(uploadId,role);if(!claim)return 'not_claimed';
    const controller=new AbortController();let renewing=false;
    const heartbeat=setInterval(()=>{if(renewing)return;renewing=true;void this.renew(uploadId,claim.token).then(ok=>{if(!ok)controller.abort();},()=>controller.abort()).finally(()=>{renewing=false;});},10000);
    heartbeat.unref();
    try{
      if(role==='validate'){
        if(!probe)throw new FileFault('invariant');await this.validate(claim.u,claim.token,probe,controller.signal);return 'cleaning';
      }
      await this.clean(claim.u,claim.token);return claim.u.state==='deleting'?'deleted':'ready';
    }catch(error){
      const durable=this.decode(await this.ref('uploads',uploadId).get());
      if(['ready','deleted'].includes(durable.state)||(role==='validate'&&durable.state==='cleaning')||durable.state==='deleting')return durable.state;
      if(error instanceof FileFault&&['invalid','expired'].includes(error.code)){
        await this.remove(claim.u.accountId,uploadId,error.code==='expired'?'expired':'invalid_video');return 'deleting';
      }else await this.db.runTransaction(async tx=>{const ref=this.ref('uploads',uploadId),d=await tx.get(ref);
        if(d.exists&&d.get('leaseToken')===claim.token){tx.update(ref,{leaseToken:null,leaseUntil:null});tx.update(this.ref('fileOutbox',uploadId),{nextAttemptAt:Date.now()+60000});}});
      throw error;
    }finally{clearInterval(heartbeat);controller.abort();}
  }
  private async validate(u:Upload,token:string,probe:FileProbe,signal:AbortSignal){
    if(u.offset!==u.size||u.manifestSha!==manifestHash(u))throw new FileFault('invalid');
    let object=await this.objects.metadata(u.plan.final);
    if(!object){
      const sources=u.chunks.map((c,i)=>({key:u.plan.chunks[i],generation:c.generation}));
      if(u.plan.groups.length){const groups=[];for(let i=0;i<u.plan.groups.length;i++){
        const batch=sources.slice(i*32,(i+1)*32),size=u.chunks.slice(i*32,(i+1)*32).reduce((n,c)=>n+c.size,0);
        const group=await this.objects.composeOnce(u.plan.groups[i],batch,size);groups.push({key:group.key,generation:group.generation});
      }object=await this.objects.composeOnce(u.plan.final,groups,u.size);}
      else object=await this.objects.composeOnce(u.plan.final,sources,u.size);
    }
    if(object.size!==u.size)throw new FileFault('invalid');
    if(signal.aborted)throw new FileFault('unavailable');
    const checked=await probe.inspect(object,u.expectedSha,signal);
    if(checked.sha256!==u.expectedSha||!Number.isFinite(checked.video.duration)||checked.video.duration<=0||checked.video.duration>600||
      !Number.isInteger(checked.video.width)||!Number.isInteger(checked.video.height)||checked.video.width<1||checked.video.height<1||
      checked.video.width>1920||checked.video.height>1920||!Number.isSafeInteger(checked.video.audioTracks)||checked.video.audioTracks<0)throw new FileFault('invalid');
    const receipt:Receipt={object,sha256:checked.sha256,video:checked.video,manifestSha:u.manifestSha};
    await this.db.runTransaction(async tx=>{const ref=this.ref('uploads',u.id),current=this.decode(await tx.get(ref));
      if(['cleaning','ready'].includes(current.state)&&current.receipt?.object.generation===object!.generation&&current.receipt.sha256===checked.sha256)return;
      if(current.state!=='verifying'||current.leaseToken!==token||current.leaseUntil!<=Date.now()||current.expiresAtMs<=Date.now())throw new FileFault('conflict');
      tx.update(ref,{state:'cleaning',receipt,leaseToken:null,leaseUntil:null});
      tx.set(this.ref('fileOutbox',u.id),{state:'pending',nextAttemptAt:Date.now(),dispatchToken:null,dispatchLeaseUntil:null});
    });
  }
  private async clean(u:Upload,token:string){
    const keys=[...u.plan.chunks,...u.plan.groups,...(u.state==='deleting'?[u.plan.final]:[])];
    const markers=[];
    for(let start=0;start<keys.length;start+=4)markers.push(...await Promise.all(keys.slice(start,start+4).map(key=>this.objects.barrier(key))));
    if(markers.some((m,i)=>m.key!==keys[i]||m.size!==0||!m.marker))throw new FileFault('invariant');
    if(u.state==='cleaning'){
      const current=await this.objects.metadata(u.plan.final);
      if(!u.receipt||!current||current.generation!==u.receipt.object.generation||current.size!==u.size)throw new FileFault('conflict');
    }
    if(u.state==='deleting'){
      await this.purgeResults?.(u.accountId,u.id);
      await this.ref('projects',u.id).delete();
      let after;
      for(;;){let q=this.root.collection('jobs').where('accountId','==',u.accountId).where('inputId','==',u.id).orderBy('__name__').limit(100);
        if(after)q=q.startAfter(after);const docs=await q.get();if(!docs.size)break;
        const batch=this.db.batch();for(const doc of docs.docs)batch.update(doc.ref,{snapshot:null});await batch.commit();after=docs.docs.at(-1);
      }
    }
    await this.db.runTransaction(async tx=>{
      const account=this.ref('accounts',u.accountId),upload=this.ref('uploads',u.id),input=this.ref('inputs',u.id);
      const [a,d,existing]=await tx.getAll(account,upload,input);const current=this.decode(d,u.accountId);
      if((u.state==='cleaning'&&current.state==='ready')||(u.state==='deleting'&&current.state==='deleted'))return;
      if(!a.exists||current.leaseToken!==token||current.state!==u.state||current.leaseUntil!<=Date.now())throw new FileFault('conflict');
      const q=this.quota(a.data()!),next={...q};
      if(current.quotaMode==='reserved')next.storageReservedBytes-=current.quotaHeld;
      else if(current.quotaMode==='committed')next.storageCommittedBytes-=current.quotaHeld;
      if(current.activeHeld)next.activeUploads--;
      if(u.state==='cleaning'){
        if(current.expiresAtMs<=Date.now()||!current.receipt)throw new FileFault('expired');
        if(existing.exists)throw new FileFault('invariant');next.storageCommittedBytes+=current.size;
        tx.create(input,{accountId:u.accountId,expiresAtMs:u.expiresAtMs,sha256:current.receipt.sha256,deleted:false,ready:true,unknownCount:0,
          storage:{bucket:privateBucket,key:current.receipt.object.key,generation:current.receipt.object.generation,size:u.size,sha256:current.receipt.sha256},metadata:current.receipt.video});
      }
      for(const value of Object.values(next))integer(value);
      tx.update(account,next);tx.update(upload,{state:u.state==='cleaning'?'ready':'deleted',quotaHeld:u.state==='cleaning'?u.size:0,
        quotaMode:u.state==='cleaning'?'committed':'none',activeHeld:false,leaseToken:null,leaseUntil:null,markers,
        ...(u.state==='deleting'?{chunks:[],receipt:null,name:'',purgeState:'done'}:{})});
      tx.update(this.ref('fileOutbox',u.id),{state:'done',dispatchToken:null,dispatchLeaseUntil:null});
    });
  }
}
