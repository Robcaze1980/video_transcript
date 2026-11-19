import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {FirestoreReviewedPurge} from './firestoreReviewedPurge';
import {FirestoreReviewedTranslation,ReviewedTranslationFault} from '../firestoreReviewedTranslation';
import {encodeTextBundle} from '../pipelineTextCodec';

// Deterministic in-memory model. It approximates optimistic transaction retries;
// it is not the Firestore emulator and does not prove Firestore indexes or IAM.
type Data=Record<string,unknown>;
const copy=<T>(value:T):T=>structuredClone(value);
const parent=(path:string)=>path.slice(0,path.lastIndexOf('/'));
class Ref {
 constructor(readonly store:Memory,readonly path:string){}
 get id(){return this.path.slice(this.path.lastIndexOf('/')+1);}
 collection(name:string){return new Query(this.store,`${this.path}/${name}`);}
}
class Snapshot {
 constructor(readonly ref:Ref,private readonly value:Data|undefined){}
 get id(){return this.ref.id;}
 get exists(){return this.value!==undefined;}
 get(field:string){return this.value?.[field];}
 data(){return this.value===undefined?undefined:copy(this.value);}
}
class Query {
 filters:Array<[string,unknown]>=[];after:string|null=null;max=100;
 constructor(readonly store:Memory,readonly path:string){}
 doc(id:string){return new Ref(this.store,`${this.path}/${id}`);}
 where(field:string,op:string,value:unknown){if(op!=='==')throw Error('Unexpected synthetic query');this.filters.push([field,value]);return this;}
 orderBy(){return this;}
 limit(value:number){this.max=value;return this;}
 startAfter(value:string){this.after=value;return this;}
}
type Mutation={kind:'set'|'create'|'update'|'delete';ref:Ref;value?:Data};
class Transaction {
 readonly reads=new Map<string,number>();readonly queries=new Map<string,number>();readonly writes:Mutation[]=[];
 constructor(readonly store:Memory){}
 async get(item:Ref|Query):Promise<any>{
  if(this.writes.length)throw Error('Synthetic transaction forbids reads after writes');
  if(item instanceof Ref){this.reads.set(item.path,this.store.version(item.path));return new Snapshot(item,copy(this.store.rows.get(item.path)));}
  this.queries.set(item.path,this.store.epoch(item.path));
  const docs=[...this.store.rows.entries()].filter(([path,data])=>parent(path)===item.path&&item.filters.every(([field,value])=>data[field]===value))
   .map(([path])=>new Ref(this.store,path)).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)))
   .filter(ref=>item.after===null||Buffer.compare(Buffer.from(ref.id),Buffer.from(item.after))>0).slice(0,item.max);
  return {docs:await Promise.all(docs.map(ref=>this.get(ref)))};
 }
 async getAll(...refs:Ref[]){return Promise.all(refs.map(ref=>this.get(ref)));}
 set(ref:Ref,value:Data){this.writes.push({kind:'set',ref,value:copy(value)});}
 create(ref:Ref,value:Data){this.writes.push({kind:'create',ref,value:copy(value)});}
 update(ref:Ref,value:Data){this.writes.push({kind:'update',ref,value:copy(value)});}
 delete(ref:Ref){this.writes.push({kind:'delete',ref});}
}
class Memory {
 readonly rows=new Map<string,Data>();readonly versions=new Map<string,number>();readonly epochs=new Map<string,number>();
 readonly history:Array<{kind:string;path:string}>=[];beforeCommit:(()=>Promise<void>)|null=null;transactions=0;
 version(path:string){return this.versions.get(path)??0;}
 epoch(path:string){return this.epochs.get(path)??0;}
 put(path:string,value:Data|undefined){
  if(value===undefined)this.rows.delete(path);else this.rows.set(path,copy(value));
  this.versions.set(path,this.version(path)+1);const collection=parent(path);this.epochs.set(collection,this.epoch(collection)+1);
 }
 async runTransaction<T>(fn:(tx:Transaction)=>Promise<T>):Promise<T>{
  this.transactions++;
  for(let attempt=0;attempt<10;attempt++){
   const tx=new Transaction(this),result=await fn(tx);
   if(this.beforeCommit){const barrier=this.beforeCommit;this.beforeCommit=null;await barrier();}
   if([...tx.reads].some(([path,version])=>this.version(path)!==version)||[...tx.queries].some(([path,epoch])=>this.epoch(path)!==epoch))continue;
   for(const change of tx.writes){const current=this.rows.get(change.ref.path);
    if(change.kind==='create'&&current!==undefined)throw Error('Synthetic create precondition failed');
    if(change.kind==='update'&&current===undefined)throw Error('Synthetic update target missing');
   }
   for(const change of tx.writes){const old=this.rows.get(change.ref.path);
    const value=change.kind==='delete'?undefined:change.kind==='update'?{...old,...change.value}:change.value;
    this.put(change.ref.path,value);this.history.push({kind:change.kind,path:change.ref.path});
   }
   return result;
  }
  throw Error('Synthetic retries exhausted');
 }
 pauseBeforeCommit(){
  let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>{enter=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
  this.beforeCommit=async()=>{enter();await resume;};return {entered,release};
 }
}

const account='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const input='20000000-0000-4000-8000-000000000001',secondInput='20000000-0000-4000-8000-000000000002',otherInput='20000000-0000-4000-8000-000000000003';
const generation='30000000-0000-4000-8000-000000000001',token='40000000-0000-4000-8000-000000000001',nextToken='40000000-0000-4000-8000-000000000002';
const job='50000000-0000-4000-8000-000000000001',rootPath='synthetic/synthetic-root';
const path=(collection:string,id:string)=>`${rootPath}/${collection}/${id}`;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const receiptId=(owner:string,key:string)=>digest(['review-request-v1',owner,key]);
const lease=Object.freeze({accountId:account,inputId:input,purgeGeneration:generation,leaseToken:token,leaseGeneration:1});

function fixture(enabled=true){
 const db=new Memory(),root=new Ref(db,rootPath);
 db.put(path('inputs',input),{accountId:account,deleted:true,reviewPurgeGeneration:generation});
 db.put(path('uploads',input),{id:input,accountId:account,state:'deleting',reviewPurgeGeneration:generation});
 db.put(path('reviewPurgeControls',input),{kind:'private-review-purge-v1',state:'deleting',accountId:account,inputId:input,purgeGeneration:generation,
  leaseToken:token,leaseGeneration:1,leaseUntil:Date.now()+60_000,reviewCursor:null,requestCursor:null});
 const financial={
  [path('accounts',account)]:{credited:10,available:3,reserved:2,consumed:5},
  [path('movements','reserve:synthetic-job')]:{accountId:account,credits:2,kind:'reserve'},
  [path('jobs','synthetic-job')]:{accountId:account,inputId:input,state:'unknown'},
  [path('jobAccounting','synthetic-job')]:{accountId:account,jobId:'synthetic-job',mode:'account_seconds'},
  [path('billingIntents','synthetic')]:{accountId:account,state:'needs_review'},
  [path('billingIntentWitnesses','synthetic')]:{accountId:account,inputId:input,intentId:'synthetic'},
  [path('billingOutbox','synthetic')]:{accountId:account,state:'pending'},
  [path('providerCalls','synthetic')]:{accountId:account,state:'received'},
 };
 for(const [key,value] of Object.entries(financial))db.put(key,value);
 db.history.length=0;
 const purge=new FirestoreReviewedPurge(db as never,root as never,enabled?{enableLocalPrototype:true}:{});
 return {db,root,purge,financial};
}
function read(db:Memory,collection:string,id:string){return copy(db.rows.get(path(collection,id)));}
function replace(db:Memory,collection:string,id:string,value:Data){db.put(path(collection,id),value);}
function merge(db:Memory,collection:string,id:string,value:Data){replace(db,collection,id,{...read(db,collection,id),...value});}
function reviews(c:ReturnType<typeof fixture>,count:number){for(let n=1;n<=count;n++)replace(c.db,'reviewedTranslations',`review-${n}`,{accountId:account,inputId:input,payload:`synthetic-${n}`,fingerprint:'private-derived'});}
function receipts(c:ReturnType<typeof fixture>,count:number){for(let n=1;n<=count;n++)replace(c.db,'reviewRequests',`request-${n}`,{accountId:account,inputId:input,version:n,state:n%2?'active':'stale',fingerprint:'private-derived',payloadSha256:'private-derived',baseHash:'private-derived'});}

afterEach(()=>{vi.useRealTimers();});
describe('disabled, bounded private-review purge prototype',()=>{
 it('is disabled by default and rejects malformed leases before touching storage',async()=>{
  const off=fixture(false);await expect(off.purge.processPage(lease,'reviews')).rejects.toMatchObject({code:'disabled'});expect(off.db.transactions).toBe(0);
  const c=fixture();await expect(c.purge.processPage({...lease,extra:'forged'},'reviews')).rejects.toMatchObject({code:'invalid'});
  await expect(c.purge.processPage({...lease,leaseGeneration:Number.MAX_SAFE_INTEGER+1},'reviews')).rejects.toMatchObject({code:'invalid'});
  await expect(c.purge.processPage(lease,'reviews',51)).rejects.toMatchObject({code:'invalid'});expect(c.db.transactions).toBe(0);
 });
 it.each([
  ['live input','inputs',{deleted:false}],['foreign input','inputs',{accountId:other}],['wrong input generation','inputs',{reviewPurgeGeneration:nextToken}],
  ['other upload','uploads',{accountId:other}],['active upload','uploads',{state:'ready'}],['wrong upload id','uploads',{id:secondInput}],
  ['wrong control owner','reviewPurgeControls',{accountId:other}],['wrong control kind','reviewPurgeControls',{kind:'unexpected'}],
  ['wrong purge generation','reviewPurgeControls',{purgeGeneration:nextToken}],['missing cursor','reviewPurgeControls',{reviewCursor:undefined}],
 ])('fails closed for %s before deleting or moving the cursor',async(_label,collection,change)=>{
  const c=fixture();reviews(c,1);merge(c.db,collection,input,change);
  const before=copy([...c.db.rows]);await expect(c.purge.processPage(lease,'reviews')).rejects.toMatchObject({code:expect.any(String)});
  expect([...c.db.rows]).toEqual(before);expect(c.db.history).toEqual([]);
 });
 it('processes multiple pages, retires all matching receipt versions and never touches other inputs or financial evidence',async()=>{
  const c=fixture();reviews(c,5);receipts(c,5);
  replace(c.db,'reviewedTranslations','other-input',{accountId:account,inputId:secondInput,payload:'other-private'});
  replace(c.db,'reviewedTranslations','foreign',{accountId:other,inputId:otherInput,payload:'foreign-private'});
  replace(c.db,'reviewRequests','other-input',{accountId:account,inputId:secondInput,version:1,fingerprint:'other-private'});
  replace(c.db,'reviewRequests','legacy-without-owner',{inputId:input,version:1,payloadSha256:'undiscoverable'});
  const beforeOther=copy([...c.db.rows].filter(([key])=>key.endsWith('/other-input')||key.endsWith('/foreign')||key.endsWith('/legacy-without-owner')));
  const reviewPages=[],receiptPages=[];
  do{reviewPages.push(await c.purge.processPage(lease,'reviews',2));}while(!reviewPages.at(-1)!.endOfScan);
  do{receiptPages.push(await c.purge.processPage(lease,'requests',2));}while(!receiptPages.at(-1)!.endOfScan);
  expect(reviewPages.map(p=>p.processed)).toEqual([2,2,1]);expect(receiptPages.map(p=>p.processed)).toEqual([2,2,1]);
  for(let n=1;n<=5;n++){expect(read(c.db,'reviewedTranslations',`review-${n}`)).toBeUndefined();expect(read(c.db,'reviewRequests',`request-${n}`)).toEqual({version:2,state:'retired',accountId:account});}
  expect([...c.db.rows].filter(([key])=>key.endsWith('/other-input')||key.endsWith('/foreign')||key.endsWith('/legacy-without-owner'))).toEqual(beforeOther);
  for(const [key,value] of Object.entries(c.financial))expect(c.db.rows.get(key)).toEqual(value);
  expect(c.db.history.every(write=>['reviewedTranslations','reviewRequests','reviewPurgeControls','uploads'].includes(parent(write.path).split('/').at(-1)!))).toBe(true);
  expect(read(c.db,'uploads',input)?.state).toBe('deleting');expect(read(c.db,'reviewPurgeControls',input)?.state).toBe('deleting');
 });
 it('continues from the durable cursor after a lost page response without reviving a retired receipt',async()=>{
  const c=fixture();receipts(c,3);
  await c.purge.processPage(lease,'requests',2); // Pretend the caller lost this response after commit.
  const repeated=await c.purge.processPage(lease,'requests',2);
  expect(repeated).toMatchObject({processed:1,endOfScan:true,cursor:'request-3'});
  for(let n=1;n<=3;n++)expect(read(c.db,'reviewRequests',`request-${n}`)).toEqual({version:2,state:'retired',accountId:account});
 });
 it('rejects a stale worker after a new lease generation wins before commit',async()=>{
  const c=fixture();receipts(c,1);const gate=c.db.pauseBeforeCommit(),pending=c.purge.processPage(lease,'requests');
  await gate.entered;merge(c.db,'reviewPurgeControls',input,{leaseToken:nextToken,leaseGeneration:2});gate.release();
  await expect(pending).rejects.toMatchObject({code:'lease_lost'});
  expect(read(c.db,'reviewRequests','request-1')).toMatchObject({inputId:input,version:1});expect(read(c.db,'reviewPurgeControls',input)?.requestCursor).toBeNull();
  await expect(c.purge.processPage({...lease,leaseToken:nextToken,leaseGeneration:2},'requests')).resolves.toMatchObject({processed:1});
  expect(read(c.db,'reviewRequests','request-1')).toEqual({version:2,state:'retired',accountId:account});
 });
 it('retries concurrent pages with the same lease and advances from the committed cursor',async()=>{
  const c=fixture();receipts(c,4);const gate=c.db.pauseBeforeCommit(),first=c.purge.processPage(lease,'requests',2);
  await gate.entered;const second=await c.purge.processPage(lease,'requests',2);gate.release();const retried=await first;
  expect(second).toMatchObject({processed:2,cursor:'request-2'});expect(retried).toMatchObject({processed:2,cursor:'request-4'});
  for(let n=1;n<=4;n++)expect(read(c.db,'reviewRequests',`request-${n}`)).toEqual({version:2,state:'retired',accountId:account});
 });
 it('refuses an expired lease before starting a page',async()=>{
  const c=fixture();receipts(c,1);merge(c.db,'reviewPurgeControls',input,{leaseUntil:Date.now()-1});const before=copy([...c.db.rows]);
  await expect(c.purge.processPage(lease,'requests')).rejects.toMatchObject({code:'lease_lost'});expect([...c.db.rows]).toEqual(before);expect(c.db.history).toEqual([]);
 });
 it('allows an already-running page to commit after clock expiry if no new lease wins',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-17T00:00:00Z'));
  const c=fixture();receipts(c,1);const gate=c.db.pauseBeforeCommit(),pending=c.purge.processPage(lease,'requests');
  await gate.entered;vi.setSystemTime(new Date('2026-11-17T00:02:00Z'));gate.release();
  await expect(pending).resolves.toMatchObject({processed:1});expect(read(c.db,'reviewRequests','request-1')).toEqual({version:2,state:'retired',accountId:account});
 });
 it('does not overwrite a legitimate concurrent financial change',async()=>{
  const c=fixture();receipts(c,1);const gate=c.db.pauseBeforeCommit(),pending=c.purge.processPage(lease,'requests');
  await gate.entered;merge(c.db,'accounts',account,{available:4,reserved:1});gate.release();await pending;
  expect(read(c.db,'accounts',account)).toEqual({credited:10,available:4,reserved:1,consumed:5});
  for(const [key,value] of Object.entries(c.financial))if(key!==path('accounts',account))expect(c.db.rows.get(key)).toEqual(value);
  expect(c.db.history.some(write=>write.path===path('accounts',account))).toBe(false);
 });
 it('does not mistake the end of one forward scan for final deletion or legacy inventory',async()=>{
  const c=fixture();replace(c.db,'reviewRequests','malformed',{inputId:input,payloadSha256:'private-derived'});
  const result=await c.purge.processPage(lease,'requests');expect(result).toMatchObject({processed:0,endOfScan:true});
  expect(read(c.db,'reviewRequests','malformed')).toBeDefined();expect(read(c.db,'reviewPurgeControls',input)?.state).toBe('deleting');
  expect(read(c.db,'uploads',input)?.state).toBe('deleting');
 });
 it('shows why a legacy blind writer remains a rollout blocker',async()=>{
  const c=fixture();receipts(c,1);await c.purge.processPage(lease,'requests');
  // Deliberately unsafe synthetic writer: it reads neither the input nor receipt.
  await c.db.runTransaction(async tx=>{tx.set(c.root.collection('reviewRequests').doc('request-1'),{version:1,accountId:account,inputId:input,fingerprint:'unsafe'});});
  expect(read(c.db,'reviewRequests','request-1')).toMatchObject({version:1,inputId:input});
 });
});

describe('retired request key interaction with the existing save flow',()=>{
 it('rejects the same key for another input of the owner while another account can use its own key',async()=>{
  const c=fixture(),key='synthetic-shared-key',oldReceipt=receiptId(account,key);
  replace(c.db,'reviewRequests',oldReceipt,{version:1,accountId:account,inputId:input,fingerprint:'private',baseHash:'private'});
  await c.purge.processPage(lease,'requests');expect(read(c.db,'reviewRequests',oldReceipt)).toEqual({version:2,state:'retired',accountId:account});
  for(const [id,owner] of [[secondInput,account],[otherInput,other]]){
   replace(c.db,'inputs',id,{accountId:owner,deleted:false});replace(c.db,'projects',id,{accountId:owner,inputId:id,revision:1,draft:''});
  }
  const bundle=encodeTextBundle(job,2000,{detectedLanguage:'es',hasSpeech:true,cues:[{startMs:0,endMs:1000,es:'Bomba',en:'Pump'}]});
  const service=new FirestoreReviewedTranslation(c.db as never,c.root as never,{} as never,{} as never);
  // Authorization and object storage are deliberately simulated here; the real
  // adapter's transaction/routing requires its separate emulator tests.
  (service as any).authorize=async(tx:Transaction,principal:{accountId:string},target:string)=>{
   const doc=await tx.get(c.root.collection('inputs').doc(target));
   if(!doc.exists||doc.get('accountId')!==principal.accountId||doc.get('deleted')!==false)throw new ReviewedTranslationFault('not_found');
   return {bindingHash:'a'.repeat(64),projectRevision:1,jobRevision:1,projectDraft:'',jobSnapshotSha256:createHash('sha256').update('').digest('hex')};
  };
  (service as any).readSourceBytes=async()=>({durationMs:2000,cues:bundle.cues});
  const request=(inputId:string)=>({inputId,jobId:job,expectedRevision:1,requestKey:key,edits:[{id:bundle.cues[0].id,en:'Water pump'}]});
  await expect(service.saveReview({accountId:account,uid:'synthetic-owner'},request(secondInput))).rejects.toMatchObject({code:'conflict'});
  await expect(service.saveReview({accountId:other,uid:'synthetic-other'},request(otherInput))).resolves.toEqual({committedRevision:2});
  expect(read(c.db,'reviewRequests',oldReceipt)).toEqual({version:2,state:'retired',accountId:account});
  expect(read(c.db,'reviewRequests',receiptId(other,key))).toMatchObject({version:1,accountId:other,inputId:otherInput});
 });
 it('does not save a delayed review when the input is marked deleted before its commit',async()=>{
  const c=fixture(),key='synthetic-delayed-save';replace(c.db,'inputs',secondInput,{accountId:account,deleted:false});
  replace(c.db,'projects',secondInput,{accountId:account,inputId:secondInput,revision:1,draft:''});
  const bundle=encodeTextBundle(job,2000,{detectedLanguage:'es',hasSpeech:true,cues:[{startMs:0,endMs:1000,es:'Bomba',en:'Pump'}]});
  const service=new FirestoreReviewedTranslation(c.db as never,c.root as never,{} as never,{} as never);
  // This controlled authorization models only the input barrier; the genuine
  // adapter and its full financial authorization need their own emulator run.
  (service as any).authorize=async(tx:Transaction,principal:{accountId:string},target:string)=>{
   const doc=await tx.get(c.root.collection('inputs').doc(target));
   if(!doc.exists||doc.get('accountId')!==principal.accountId||doc.get('deleted')!==false)throw new ReviewedTranslationFault('not_found');
   return {bindingHash:'a'.repeat(64),projectRevision:1,jobRevision:1,projectDraft:'',jobSnapshotSha256:createHash('sha256').update('').digest('hex')};
  };
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
  (service as any).readSourceBytes=async()=>{enter();await resume;return {durationMs:2000,cues:bundle.cues};};
  const pending=service.saveReview({accountId:account,uid:'synthetic-owner'},{inputId:secondInput,jobId:job,expectedRevision:1,requestKey:key,edits:[{id:bundle.cues[0].id,en:'Water pump'}]});
  try{await entered;merge(c.db,'inputs',secondInput,{deleted:true,reviewPurgeGeneration:generation});release();
   await expect(pending).rejects.toMatchObject({code:'not_found'});
   expect(read(c.db,'reviewRequests',receiptId(account,key))).toBeUndefined();expect(read(c.db,'projects',secondInput)).toMatchObject({revision:1,draft:''});
  }finally{release();}
 });
});
