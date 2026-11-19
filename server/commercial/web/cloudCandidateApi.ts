/** Browser transport for the loopback cloud candidate. No tokens in URLs or persistence. */
import {sha256} from '@noble/hashes/sha2.js';
import {reviewedTranslationClient} from './reviewedTranslationClient';
import {REVIEWED_TRANSLATION_CANDIDATE} from './reviewedTranslationFeature';
export type Operation='translation:en'|'narration:en:female'|'narration:en:male';
export interface ReviewReference {inputId:string;jobId:string;operation:Operation|'unknown'}
export interface Job {id:string;inputId:string;operation:Operation;state:string;revision:number;stale:boolean;units:number;billing?:{mode?:string;unit?:string};billingState?:'simulated'|'pending'|'settled'|'review';localBillingReview?:boolean;reviewPersistenceFailed?:boolean;results:Array<{name:string;mimeType:string;size:number;sha256:string}>}
export interface Input {id:string;name:string;state:string;offset:number;size:number;sha256?:string;metadata?:{duration:number;audioTracks:number};failure?:string}
export interface Store {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
export interface CandidateLock {request<T>(name:string,signal:AbortSignal,action:()=>Promise<T>):Promise<T>}
export class CandidateError extends Error {constructor(readonly status:number,readonly code:string){super(code);}}
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const CHUNK_BYTES=8*1024*1024;
export const HASH_BLOCK_BYTES=1024*1024;
export const MAX_BYTES=500000000;
export const MAX_VIDEO_DIMENSION=1920;
/** Early browser guidance only; the server remains authoritative. */
export function videoDimensionIssue(width:number,height:number):'invalid'|'too_large'|undefined{
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)return 'invalid';
 if(width>MAX_VIDEO_DIMENSION||height>MAX_VIDEO_DIMENSION)return 'too_large';
 return undefined;
}
export const MAX_DRAFT_CHARS=600;
export function draftWithinPilotLimit(text:string){return typeof text==='string'&&text.length<=MAX_DRAFT_CHARS;}
export function validId(id:string){if(!uuid.test(id))throw new CandidateError(400,'invalid_id');return id;}
const terminalJobs=new Set(['succeeded','failed','cancelled']);
export async function bytesSha(bytes:ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
/** Hash one bounded slice at a time so preparing a video does not allocate the entire file. */
export async function fileSha256(file:Blob,signal:AbortSignal,progress?:(fraction:number)=>void){
 const digest=sha256.create();
 try{
  signal.throwIfAborted();progress?.(0);
  for(let offset=0;offset<file.size;offset+=HASH_BLOCK_BYTES){
   signal.throwIfAborted();const end=Math.min(offset+HASH_BLOCK_BYTES,file.size);
   const bytes=new Uint8Array(await file.slice(offset,end).arrayBuffer());
   signal.throwIfAborted();if(bytes.length!==end-offset)throw new CandidateError(0,'response_unconfirmed');
   digest.update(bytes);progress?.(end/file.size);
   if(end<file.size)await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  signal.throwIfAborted();if(file.size===0)progress?.(1);
  return Array.from(digest.digest(),value=>value.toString(16).padStart(2,'0')).join('');
 }finally{digest.destroy();}
}
/** A failed durable key write prevents POST; an ambiguous response never rotates the key. */
export class RequestBook {
 private prefix:string;
 constructor(accountId:string,private store:Store){this.prefix='vistavo-candidate-v1:'+validId(accountId)+':';}
 key(input:string,operation:string,revision:number){
  if(operation==='upload'){if(!/^[a-f0-9]{64}$/.test(input))throw new CandidateError(400,'invalid_digest');}
  else{validId(input);if(!['translation:en','narration:en:female','narration:en:male'].includes(operation)||!Number.isSafeInteger(revision)||revision<1)throw new CandidateError(400,'invalid_request');}
  const slot=this.prefix+'request:'+input+':'+operation+':'+revision,prior=this.store.getItem(slot);if(prior){validId(prior);return prior;}
  const value=crypto.randomUUID();this.store.setItem(slot,value);if(this.store.getItem(slot)!==value)throw new CandidateError(0,'persistence_unavailable');return value;
 }
 // A generation fences responses from an older selection, including A -> B -> A.
 // Participating tabs must use the account lock and these methods for input changes.
 private bumpInputGeneration(){const key=this.prefix+'input-generation',generation=crypto.randomUUID();this.store.setItem(key,generation);if(this.store.getItem(key)!==generation)throw new CandidateError(0,'persistence_unavailable');return generation;}
 rememberInput(id:string){validId(id);this.bumpInputGeneration();const key=this.prefix+'input';this.store.setItem(key,id);if(this.store.getItem(key)!==id)throw new CandidateError(0,'persistence_unavailable');}
 rememberUpload(id:string,digest:string,requestKey?:string){
  validId(id);if(!/^[a-f0-9]{64}$/.test(digest))throw new CandidateError(400,'invalid_digest');
  this.store.setItem(this.prefix+'upload:'+id,digest);
  if(requestKey){
   validId(requestKey);const binding=this.prefix+'upload-request:'+id;this.store.setItem(binding,requestKey);
   if(this.store.getItem(binding)!==requestKey)throw new CandidateError(0,'persistence_unavailable');
  }
 }
 uploadDigest(id:string){const digest=this.store.getItem(this.prefix+'upload:'+validId(id));if(digest!==null&&!/^[a-f0-9]{64}$/.test(digest))throw new CandidateError(0,'invalid_digest');return digest;}
 /** Called only after confirmed logical deletion; the next upload still needs an explicit click. */
 retireUpload(id:string){
  validId(id);const key=this.prefix+'upload:'+id,digest=this.store.getItem(key),boundKey=this.store.getItem(this.prefix+'upload-request:'+id);
  let localKeyRetired=true;
  if(boundKey)validId(boundKey);
  if(digest){
   if(!/^[a-f0-9]{64}$/.test(digest))throw new CandidateError(0,'invalid_digest');
   const requestSlot=this.prefix+'request:'+digest+':upload:0',currentKey=this.store.getItem(requestSlot);
   if(boundKey&&currentKey===boundKey)this.store.removeItem(requestSlot);
   else if(!boundKey&&currentKey)localKeyRetired=false;
   this.store.removeItem(key);
  }else localKeyRetired=false;
  this.store.removeItem(this.prefix+'upload-request:'+id);if(this.input()===id)this.forgetInput();
  return localKeyRetired;
 }
 input(){const value=this.store.getItem(this.prefix+'input');return value?validId(value):null;}
 inputGeneration(inputId:string){if(this.input()!==validId(inputId))throw new CandidateError(409,'stale_job_response');const value=this.store.getItem(this.prefix+'input-generation');const generation=value===null?this.bumpInputGeneration():validId(value);if(this.input()!==inputId)throw new CandidateError(409,'stale_job_response');return generation;}
 currentInputGeneration(inputId:string,generation:string){return this.input()===validId(inputId)&&this.store.getItem(this.prefix+'input-generation')===validId(generation);}
 forgetInput(){this.bumpInputGeneration();const key=this.prefix+'input';this.store.removeItem(key);if(this.store.getItem(key)!==null)throw new CandidateError(0,'persistence_unavailable');}
 pending(input:string,operation:Operation,revision?:number){const key=this.prefix+'pending:'+validId(input)+':'+operation;if(revision!==undefined){if(!Number.isSafeInteger(revision)||revision<1)throw new CandidateError(400,'invalid_request');this.store.setItem(key,String(revision));if(this.store.getItem(key)!==String(revision))throw new CandidateError(0,'persistence_unavailable');}const value=this.store.getItem(key);if(value===null)return undefined;const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new CandidateError(0,'invalid_request');return n;}
 rememberJob(input:string,operation:Operation,id:string){this.store.setItem(this.prefix+'job:'+validId(input)+':'+operation,validId(id));this.store.removeItem(this.prefix+'pending:'+input+':'+operation);}
 job(input:string,operation:Operation){const value=this.store.getItem(this.prefix+'job:'+validId(input)+':'+operation);return value?validId(value):null;}
 reviewMarkKey(id:string){return this.prefix+'review-mark:'+validId(id);}
 reviewMark(id:string):{inputId:string;version:string}|null{
  const raw=this.store.getItem(this.reviewMarkKey(id));if(raw===null)return null;
  let mark:unknown;try{mark=JSON.parse(raw);}catch{throw new CandidateError(0,'invalid_recovery');}
  if(!mark||typeof mark!=='object'||Array.isArray(mark)||Object.keys(mark).sort().join(',')!=='inputId,version')throw new CandidateError(0,'invalid_recovery');
  const value=mark as Record<string,unknown>;if(typeof value.inputId!=='string'||!uuid.test(value.inputId)||typeof value.version!=='string'||!uuid.test(value.version))throw new CandidateError(0,'invalid_recovery');
  return {inputId:value.inputId,version:value.version};
 }
 markReview(inputId:string,id:string){
  validId(inputId);validId(id);const prior=this.reviewMark(id);if(prior&&prior.inputId!==inputId)throw new CandidateError(0,'invalid_recovery');
  const mark={inputId,version:crypto.randomUUID()},key=this.reviewMarkKey(id),encoded=JSON.stringify(mark);this.store.setItem(key,encoded);
  if(this.store.getItem(key)!==encoded)throw new CandidateError(0,'persistence_unavailable');return mark;
 }
 reviewReferences():ReviewReference[]{
  const raw=this.store.getItem(this.prefix+'review-references');if(raw===null)return [];
  let data:unknown;try{data=JSON.parse(raw);}catch{throw new CandidateError(0,'invalid_recovery');}
  if(!Array.isArray(data)||data.some(item=>!item||typeof item!=='object'||!uuid.test(item.inputId)||!uuid.test(item.jobId)||!['translation:en','narration:en:female','narration:en:male','unknown'].includes(item.operation)))throw new CandidateError(0,'invalid_recovery');
  return data.map(({inputId,jobId,operation})=>({inputId,jobId,operation}));
 }
 rememberReview(inputId:string,operation:Operation|'unknown',jobId:string){
  validId(inputId);validId(jobId);if(!['translation:en','narration:en:female','narration:en:male','unknown'].includes(operation))throw new CandidateError(400,'invalid_request');
  const previous=this.reviewReferences(),next=previous.some(item=>item.inputId===inputId&&item.operation===operation&&item.jobId===jobId)?previous:[...previous,{inputId,operation,jobId}];
  const key=this.prefix+'review-references',encoded=JSON.stringify(next);this.store.setItem(key,encoded);if(this.store.getItem(key)!==encoded)throw new CandidateError(0,'persistence_unavailable');return next;
 }
 savePending(input:string,revision?:number){const key=this.prefix+'save:'+validId(input);if(revision!==undefined){if(!Number.isSafeInteger(revision)||revision<0)throw new CandidateError(400,'invalid_request');this.store.setItem(key,String(revision));if(this.store.getItem(key)!==String(revision))throw new CandidateError(0,'persistence_unavailable');}const value=this.store.getItem(key);if(value===null)return undefined;const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw new CandidateError(0,'invalid_request');return n;}
 confirmSave(input:string){this.store.removeItem(this.prefix+'save:'+validId(input));}
 cancelPending(input:string){
  validId(input);const value=this.store.getItem(this.prefix+'cancel:'+input);if(value!==null)return validId(value);
  const raw=this.store.getItem(this.prefix+'cancel-confirmed:'+input);if(raw===null)return null;
  let decoded:unknown;try{decoded=JSON.parse(raw);}catch{throw new CandidateError(0,'invalid_recovery');}
  if(!decoded||typeof decoded!=='object'||Array.isArray(decoded)||Object.keys(decoded).sort().join(',')!=='id,version')throw new CandidateError(0,'invalid_recovery');
  const receipt=decoded as Record<string,unknown>;if(typeof receipt.id!=='string'||!uuid.test(receipt.id)||(receipt.version!==null&&(typeof receipt.version!=='string'||!uuid.test(receipt.version))))throw new CandidateError(0,'invalid_recovery');
  const mark=this.reviewMark(receipt.id);if(mark&&mark.inputId!==input)throw new CandidateError(0,'invalid_recovery');return (mark?.version??null)===receipt.version?null:receipt.id;
 }
 markCancel(input:string,id:string){validId(id);const key=this.prefix+'cancel:'+validId(input),previous=this.cancelPending(input);if(previous&&previous!==id)throw new CandidateError(409,'cancel_unconfirmed');this.store.setItem(key,id);if(this.store.getItem(key)!==id)throw new CandidateError(0,'persistence_unavailable');}
 confirmCancel(input:string,id:string,reviewVersion:string|null){
  validId(input);validId(id);if(reviewVersion!==null)validId(reviewVersion);if(this.cancelPending(input)!==id)return;
  const key=this.prefix+'cancel-confirmed:'+input,encoded=JSON.stringify({id,version:reviewVersion});this.store.setItem(key,encoded);if(this.store.getItem(key)!==encoded)throw new CandidateError(0,'persistence_unavailable');
  this.store.removeItem(this.prefix+'cancel:'+input);
 }
}
export function billingNeedsReview(job?:Job){return job?.billingState==='review'||job?.localBillingReview===true;}
export function jobNeedsReview(job?:Job){return job?.state==='unknown'||billingNeedsReview(job);}
// The current simulated status identifies the ledger but does not prove its
// terminal movement. Keep its cancellation pending until such proof exists.
function cancellationSettled(job:Job){return terminalJobs.has(job.state)&&job.billingState==='settled'&&job.billing?.mode==='account_seconds'&&job.billing.unit==='video_seconds'&&!billingNeedsReview(job);}
export function hasUnknown(jobs:Partial<Record<Operation,Job>>){return Object.values(jobs).some(jobNeedsReview);}
export async function publicConfig(request:typeof fetch=fetch){
 const r=await request('/api/cloud/config',{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new CandidateError(r.status,'configuration_unavailable');
 const config=await r.json();if(config?.web?.projectId!=='vistavo-prod'||typeof config.web.apiKey!=='string'||typeof config.web.appId!=='string'||config.web.authDomain!=='vistavo-prod.firebaseapp.com')throw new CandidateError(0,'invalid_configuration');return config;
}
export function candidateApi(options:{accountId:string;token:()=>Promise<string>;signal:AbortSignal;store:Store;request?:typeof fetch;lock?:CandidateLock}){
 const request=options.request??fetch,book=new RequestBook(options.accountId,options.store);
 // Even if local storage fails after a confirmed withdrawal, this client must
 // not apply a cancellation response from the now-withdrawn selection.
 const withdrawnInputs=new Set<string>();
 const lockName='vistavo-candidate-account:'+validId(options.accountId);
 async function coordinated<T>(action:()=>Promise<T>,name=lockName):Promise<T>{
  options.signal.throwIfAborted();
  if(options.lock)return options.lock.request(name,options.signal,action);
  if(typeof navigator==='undefined'||!navigator.locks?.request||typeof AbortSignal.any!=='function'||typeof AbortSignal.timeout!=='function')throw new CandidateError(0,'coordination_unavailable');
  const waiting=AbortSignal.any([options.signal,AbortSignal.timeout(15000)]);let acquired=false;
  try{return await navigator.locks.request(name,{mode:'exclusive',signal:waiting},async()=>{acquired=true;options.signal.throwIfAborted();return action();});}
  catch(error){if(!acquired&&!options.signal.aborted&&waiting.aborted)throw new CandidateError(409,'coordination_busy');throw error;}
 }
 async function call(path:string,method='GET',body?:unknown,timeout=120000,privateNoCache=false){
  if(!/^\/api\/cloud\/[a-z0-9/?&=:.%-]+$/i.test(path)||path.includes('..')||path.includes('//'))throw new CandidateError(400,'invalid_path');
  options.signal.throwIfAborted();const token=await options.token();options.signal.throwIfAborted();if(!token||/\s/.test(token))throw new CandidateError(401,'signed_out');
  let r:Response;try{r=await request(path,{method,redirect:'error',credentials:'omit',...(privateNoCache?{cache:'no-store'}:{}),headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':body instanceof Blob?'application/octet-stream':'application/json'})},body:body===undefined?undefined:body instanceof Blob?body:JSON.stringify(body),signal:AbortSignal.any([options.signal,AbortSignal.timeout(timeout)])});}
  catch(error){if(options.signal.aborted)throw error;throw new CandidateError(0,'response_unconfirmed');}
  if(!r.ok){await r.body?.cancel();throw new CandidateError(r.status,r.status===409?'conflict':r.status===503?'pilot_unavailable':r.status===402?'insufficient_test_units':r.status===401?'signed_out':'request_unconfirmed');}return r;
 }
 const json=async(path:string,method='GET',body?:unknown)=>(await call(path,method,body)).json();
 const readInputFresh=async(id:string):Promise<Input>=>{
  const response=await call('/api/cloud/uploads/'+validId(id),'GET',undefined,15000,true);
  if(!response.headers.get('cache-control')?.split(',').some(value=>value.trim().toLowerCase()==='no-store'))throw new CandidateError(0,'response_unconfirmed');
  const value=await response.json();options.signal.throwIfAborted();
  if(!value||typeof value!=='object'||value.id!==id||!['uploading','queued','verifying','cleaning','ready','deleting','deleted'].includes(value.state))throw new CandidateError(0,'response_unconfirmed');
  return value as Input;
 };
 const revalidateCancellationInput=async(id:string)=>{
  let current:Input;try{current=await readInputFresh(id);}catch(error){const status=(error as {status?:number})?.status;if(status&&[401,403,404,410].includes(status))throw new CandidateError(status,'input_access_denied');throw error;}
  if(['deleting','deleted'].includes(current.state))throw new CandidateError(404,'input_access_denied');
  if(current.state!=='ready')throw new CandidateError(0,'response_unconfirmed');
 };
 const saveConfirmed=(id:string)=>{if(book.savePending(id)!==undefined)throw new CandidateError(409,'save_unconfirmed');};
 const readProject=async(id:string)=>{const p=await json('/api/cloud/projects/'+validId(id));if(!Number.isSafeInteger(p.revision)||p.revision<1||typeof p.draft!=='string')throw new CandidateError(0,'response_unconfirmed');return p;};
 const checkedJob=(job:Job,inputId:string|undefined,id:string)=>{if(job?.id!==id||typeof job.inputId!=='string'||!uuid.test(job.inputId)||(inputId!==undefined&&job.inputId!==inputId)||!['queued','running','succeeded','failed','cancelled','unknown'].includes(job.state)||!['translation:en','narration:en:female','narration:en:male'].includes(job.operation)||!Array.isArray(job.results)||(job.billingState!==undefined&&!['simulated','pending','settled','review'].includes(job.billingState)))throw new CandidateError(0,'response_unconfirmed');return {...job,localBillingReview:false,reviewPersistenceFailed:false};};
 // An older in-flight response must not erase a later observation of review.
 let jobSequence=0,observationSequence=0;const lastJobResponse=new Map<string,number>(),reviewBarrier=new Map<string,number>(),reviewJobs=new Map<string,string>(),reviewVersions=new Map<string,number>(),inputReviewVersions=new Map<string,number>(),validatedMarks=new Map<string,string>(),lastObservation=new Map<string,number>(),observationOf=new WeakMap<Job,number>();
 type ReviewMark=ReturnType<RequestBook['reviewMark']>;
 const sameMark=(a:ReviewMark,b:ReviewMark)=>a===null?b===null:b!==null&&a.inputId===b.inputId&&a.version===b.version;
 const markFor=(id:string,inputId:string)=>{const mark=book.reviewMark(id);if(mark&&mark.inputId!==inputId)throw new CandidateError(0,'invalid_recovery');return mark;};
 const knownReview=(id:string,inputId:string)=>{const mark=markFor(id,inputId);return reviewJobs.has(id)||!!mark&&validatedMarks.get(id)!==mark.version;};
 const observedJob=(job:Job,ticket:number,before:ReviewMark)=>{
  if(job.billingState==='review'){
   reviewBarrier.set(job.id,++jobSequence);reviewJobs.set(job.id,job.inputId);validatedMarks.delete(job.id);reviewVersions.set(job.id,(reviewVersions.get(job.id)??0)+1);inputReviewVersions.set(job.inputId,(inputReviewVersions.get(job.inputId)??0)+1);
   try{book.markReview(job.inputId,job.id);}catch{job.reviewPersistenceFailed=true;}
  }else{
   if(ticket<=(reviewBarrier.get(job.id)??0)||ticket<(lastJobResponse.get(job.id)??0))throw new CandidateError(409,'stale_job_response');
   const after=markFor(job.id,job.inputId),previouslyReviewed=!!before||!!after||reviewJobs.has(job.id);
   if(previouslyReviewed&&(!sameMark(before,after)||job.billingState!=='settled')){
    job.localBillingReview=true;reviewBarrier.set(job.id,++jobSequence);reviewJobs.set(job.id,job.inputId);validatedMarks.delete(job.id);reviewVersions.set(job.id,(reviewVersions.get(job.id)??0)+1);inputReviewVersions.set(job.inputId,(inputReviewVersions.get(job.inputId)??0)+1);
   }else{if(after)validatedMarks.set(job.id,after.version);reviewJobs.delete(job.id);}
  }
  lastJobResponse.set(job.id,Math.max(ticket,lastJobResponse.get(job.id)??0));const version=++observationSequence;lastObservation.set(job.id,version);observationOf.set(job,version);return job;
 };
 const assertCurrentJob=(job:Job)=>{if(!observationOf.has(job)||observationOf.get(job)!==lastObservation.get(job.id)||(!billingNeedsReview(job)&&knownReview(job.id,job.inputId)))throw new CandidateError(409,'stale_job_response');};
 const assertCurrentCancellation=(inputId:string,id:string,generation:string)=>{options.signal.throwIfAborted();if(withdrawnInputs.has(inputId)||!book.currentInputGeneration(inputId,generation)||book.cancelPending(inputId)!==id)throw new CandidateError(409,'stale_job_response');};
 const assertNoKnownReview=(inputId:string)=>{if([...reviewJobs.values()].includes(inputId))throw new CandidateError(409,'needs_review');for(const op of ['translation:en','narration:en:female','narration:en:male'] as Operation[]){const id=book.job(inputId,op);if(id&&knownReview(id,inputId))throw new CandidateError(409,'needs_review');}};
 async function continueUpload(id:string,file:File,progress:(fraction:number)=>void):Promise<Input>{
  let current:Input=await json('/api/cloud/uploads/'+validId(id));
  if(current.id!==id||current.size!==file.size||!Number.isSafeInteger(current.offset)||current.offset<0||current.offset>file.size)throw new CandidateError(0,'invalid_offset');
  let offset=current.offset;progress(offset/file.size);
  if(current.state!=='uploading'){
   if(offset===file.size&&['queued','verifying','cleaning','ready'].includes(current.state))return current;
   throw new CandidateError(409,'conflict');
  }
  while(offset<file.size){
   options.signal.throwIfAborted();const chunk=file.slice(offset,Math.min(file.size,offset+CHUNK_BYTES));
   const next:Input=await json('/api/cloud/uploads/'+id+'/chunks?offset='+offset,'PUT',chunk);
   if(next.id!==id||next.state!=='uploading'||next.offset!==offset+chunk.size)throw new CandidateError(0,'invalid_offset');
   offset=next.offset;current=next;progress(offset/file.size);
  }
  const completed:Input=await json('/api/cloud/uploads/'+id+'/complete','POST',{});
  if(completed.id!==id||completed.size!==file.size||completed.offset!==file.size||!['queued','verifying','cleaning','ready'].includes(completed.state))throw new CandidateError(0,'response_unconfirmed');
  return completed;
 }
 const reviewed=reviewedTranslationClient({enabled:REVIEWED_TRANSLATION_CANDIDATE,signal:options.signal,call:(path,method,body)=>call(path,method,body,120000,true)});
 return {book,signal:options.signal,assertCurrentJob,reviewed,
  rememberReview:(inputId:string,operation:Operation|'unknown',id:string)=>coordinated(async()=>book.rememberReview(inputId,operation,id)),
  me:()=>json('/api/cloud/me'),
  input:readInputFresh,
  project:readProject,
  async forgetMissingUpload(id:string){await coordinated(async()=>{if(book.input()===id)book.forgetInput();});},
  async retireConfirmedUpload(id:string){return coordinated(async()=>book.retireUpload(id));},
  async reloadProject(id:string){return coordinated(async()=>{let p;try{p=await readProject(id);}catch(error){if((error as CandidateError).status!==404)throw error;p=null;}options.signal.throwIfAborted();book.confirmSave(id);return p;});},
  async save(id:string,revision:number,draft:string){if(!draftWithinPilotLimit(draft))throw new CandidateError(400,'pilot_draft_limit');return coordinated(async()=>{saveConfirmed(id);book.savePending(id,revision);const project=await json('/api/cloud/projects/'+validId(id),'PUT',{expectedRevision:revision,draft});if(project.revision!==revision+1||project.draft!==draft)throw new CandidateError(0,'response_unconfirmed');book.confirmSave(id);return project;});},
  quote:(id:string,operation:Operation,revision:number)=>{saveConfirmed(id);assertNoKnownReview(id);const version=inputReviewVersions.get(id)??0;return json('/api/cloud/ai/quote?inputId='+validId(id)+'&operation='+encodeURIComponent(operation)+'&revision='+revision).then(value=>{assertNoKnownReview(id);if((inputReviewVersions.get(id)??0)!==version)throw new CandidateError(409,'needs_review');return value;});},
  async start(id:string,operation:Operation,revision:number):Promise<string>{return coordinated(async()=>{saveConfirmed(id);assertNoKnownReview(id);if(book.cancelPending(id))throw new CandidateError(409,'cancel_unconfirmed');const requestKey=book.key(id,operation,revision);book.pending(id,operation,revision);const made=await json('/api/cloud/ai/jobs','POST',{inputId:id,operation,expectedRevision:revision,requestKey});validId(made.id);book.rememberJob(id,operation,made.id);return made.id;});},
  job:(id:string):Promise<Job>=>{validId(id);const before=book.reviewMark(id);if(before&&validatedMarks.get(id)!==before.version)reviewJobs.set(id,before.inputId);const ticket=++jobSequence;return json('/api/cloud/ai/jobs/'+id).then(job=>observedJob(checkedJob(job,undefined,id),ticket,before));},
  async cancel(inputId:string,id:string):Promise<Job>{return coordinated(async()=>{options.signal.throwIfAborted();validId(inputId);validId(id);if(withdrawnInputs.has(inputId))throw new CandidateError(409,'stale_job_response');const generation=book.inputGeneration(inputId);if(knownReview(id,inputId))throw new CandidateError(409,'needs_review');const before=markFor(id,inputId);book.markCancel(inputId,id);if(!sameMark(before,markFor(id,inputId)))throw new CandidateError(409,'needs_review');const ticket=++jobSequence;const response=await json('/api/cloud/ai/jobs/'+id,'DELETE');assertCurrentCancellation(inputId,id,generation);const job=observedJob(checkedJob(response,inputId,id),ticket,before);if(cancellationSettled(job)&&!knownReview(id,inputId)){await revalidateCancellationInput(inputId);assertCurrentCancellation(inputId,id,generation);if(!knownReview(id,inputId))book.confirmCancel(inputId,id,before?.version??null);}assertCurrentJob(job);return job;});},
  async resolveCancellation(inputId:string,id:string):Promise<Job>{
   const snapshot=await coordinated(async()=>{options.signal.throwIfAborted();validId(inputId);validId(id);if(withdrawnInputs.has(inputId))throw new CandidateError(409,'stale_job_response');const generation=book.inputGeneration(inputId);if(book.cancelPending(inputId)!==id)throw new CandidateError(409,'stale_job_response');const before=markFor(id,inputId);if(before&&validatedMarks.get(id)!==before.version)reviewJobs.set(id,inputId);return {generation,before,ticket:++jobSequence};});
   const response=await json('/api/cloud/ai/jobs/'+id);
   return coordinated(async()=>{assertCurrentCancellation(inputId,id,snapshot.generation);const job=observedJob(checkedJob(response,inputId,id),snapshot.ticket,snapshot.before);if(cancellationSettled(job)&&!knownReview(id,inputId)&&lastJobResponse.get(id)===snapshot.ticket){await revalidateCancellationInput(inputId);assertCurrentCancellation(inputId,id,snapshot.generation);if(!knownReview(id,inputId)&&lastJobResponse.get(id)===snapshot.ticket)book.confirmCancel(inputId,id,snapshot.before?.version??null);}assertCurrentJob(job);return job;});
  },
  async remove(id:string){return coordinated(async()=>{validId(id);let cancellation:string|null=null,pendingReferenceRetained:boolean|undefined;try{cancellation=book.cancelPending(id);}catch{pendingReferenceRetained=false;}
   if(cancellation){try{const op=(['translation:en','narration:en:female','narration:en:male'] as Operation[]).find(value=>book.job(id,value)===cancellation)??'unknown';book.rememberReview(id,op,cancellation);pendingReferenceRetained=true;}catch{pendingReferenceRetained=false;}}
   const response=await call('/api/cloud/uploads/'+id,'DELETE');if(response.status!==202)throw new CandidateError(0,'response_unconfirmed');const result=await response.json();if(result.id!==id||!['deleting','deleted'].includes(result.state))throw new CandidateError(0,'response_unconfirmed');options.signal.throwIfAborted();withdrawnInputs.add(id);let localKeyRetired=false,localCleanupFailed=false;try{localKeyRetired=book.retireUpload(id);}catch{localCleanupFailed=true;}return {...result,localKeyRetired,localCleanupFailed,pendingReferenceRetained};});},
  async upload(file:File,progress:(fraction:number)=>void,preparation?:(fraction:number)=>void):Promise<Input>{
   if(file.size<1||file.size>MAX_BYTES||!file.name.toLowerCase().endsWith('.mp4'))throw new CandidateError(400,'invalid_video');
   const digest=await fileSha256(file,options.signal,preparation);
   const input=await coordinated(async()=>{const requestKey=book.key(digest,'upload',0);const result:Input=await json('/api/cloud/uploads','POST',{name:file.name,size:file.size,sha256:digest,requestKey});validId(result.id);book.rememberInput(result.id);book.rememberUpload(result.id,digest,requestKey);return result;});
   return coordinated(()=>continueUpload(input.id,file,progress),lockName+':upload:'+input.id);
  },
  async resumeUpload(id:string,file:File,progress:(fraction:number)=>void,preparation?:(fraction:number)=>void):Promise<Input>{
   validId(id);const expected=book.uploadDigest(id);if(!expected)throw new CandidateError(409,'resume_unavailable');
   const digest=await fileSha256(file,options.signal,preparation);
   if(digest!==expected)throw new CandidateError(400,'different_file');
   return coordinated(()=>continueUpload(id,file,progress),lockName+':upload:'+id);
  },
  async result(job:Job,entry:Job['results'][number]){
   const underReview=()=>jobNeedsReview(job)||knownReview(job.id,job.inputId);if(underReview())throw new CandidateError(409,'needs_review');
   const reviewVersion=reviewVersions.get(job.id)??0;
   const mime=entry.name.endsWith('.wav')?'audio/wav':entry.name.endsWith('.txt')?'text/plain; charset=utf-8':entry.name.endsWith('.srt')?'application/x-subrip; charset=utf-8':'application/json; charset=utf-8';
   validId(job.id);if(!/^(transcript-es\.(txt|srt)|translation-en\.(txt|srt)|cues\.json|narration-en\.wav)$/.test(entry.name)||entry.mimeType!==mime||!job.results.some(x=>x.name===entry.name&&x.sha256===entry.sha256)||!Number.isSafeInteger(entry.size)||entry.size<1||entry.size>(entry.name.endsWith('.wav')?32*1024*1024:256*1024)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new CandidateError(0,'invalid_result');
   const r=await call('/api/cloud/ai/jobs/'+job.id+'/results/'+entry.name);if(r.headers.get('cache-control')!=='no-store'||r.headers.get('content-type')!==entry.mimeType)throw new CandidateError(0,'invalid_result');
   const reader=r.body?.getReader();if(!reader)throw new CandidateError(0,'invalid_result');const parts:Uint8Array[]=[];let size=0;
   try{for(;;){options.signal.throwIfAborted();const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>entry.size)throw new CandidateError(0,'invalid_result');parts.push(p.value);}}finally{await reader.cancel().catch(()=>undefined);}
   if(size!==entry.size)throw new CandidateError(0,'invalid_result');const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}if(await bytesSha(bytes.buffer)!==entry.sha256)throw new CandidateError(0,'invalid_result');options.signal.throwIfAborted();if(underReview()||(reviewVersions.get(job.id)??0)!==reviewVersion)throw new CandidateError(409,'needs_review');return new Blob([bytes],{type:entry.mimeType});
  }
 };
}
export type CandidateApi=ReturnType<typeof candidateApi>;
