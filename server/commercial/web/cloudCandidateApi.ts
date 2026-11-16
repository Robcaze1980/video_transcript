/** Browser transport for the loopback cloud candidate. No tokens in URLs or persistence. */
export type Operation='translation:en'|'narration:en:female'|'narration:en:male';
export interface Job {id:string;inputId:string;operation:Operation;state:string;revision:number;stale:boolean;units:number;results:Array<{name:string;mimeType:string;size:number;sha256:string}>}
export interface Input {id:string;name:string;state:string;offset:number;size:number;sha256?:string;metadata?:{duration:number;audioTracks:number};failure?:string}
export interface Store {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
export class CandidateError extends Error {constructor(readonly status:number,readonly code:string){super(code);}}
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const CHUNK_BYTES=8*1024*1024;
export const MAX_BYTES=500000000;
export const MAX_DRAFT_CHARS=600;
export function draftWithinPilotLimit(text:string){return typeof text==='string'&&text.length<=MAX_DRAFT_CHARS;}
export function validId(id:string){if(!uuid.test(id))throw new CandidateError(400,'invalid_id');return id;}
export async function bytesSha(bytes:ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
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
 rememberInput(id:string){this.store.setItem(this.prefix+'input',validId(id));}
 rememberUpload(id:string,digest:string){validId(id);if(!/^[a-f0-9]{64}$/.test(digest))throw new CandidateError(400,'invalid_digest');this.store.setItem(this.prefix+'upload:'+id,digest);}
 /** Called only after confirmed logical deletion; the next upload still needs an explicit click. */
 retireUpload(id:string){validId(id);const key=this.prefix+'upload:'+id,digest=this.store.getItem(key);if(digest){if(!/^[a-f0-9]{64}$/.test(digest))throw new CandidateError(0,'invalid_digest');this.store.removeItem(this.prefix+'request:'+digest+':upload:0');this.store.removeItem(key);}if(this.input()===id)this.forgetInput();}
 input(){const value=this.store.getItem(this.prefix+'input');return value?validId(value):null;}
 forgetInput(){this.store.removeItem(this.prefix+'input');}
 pending(input:string,operation:Operation,revision?:number){const key=this.prefix+'pending:'+validId(input)+':'+operation;if(revision!==undefined){if(!Number.isSafeInteger(revision)||revision<1)throw new CandidateError(400,'invalid_request');this.store.setItem(key,String(revision));if(this.store.getItem(key)!==String(revision))throw new CandidateError(0,'persistence_unavailable');}const value=this.store.getItem(key);if(value===null)return undefined;const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new CandidateError(0,'invalid_request');return n;}
 rememberJob(input:string,operation:Operation,id:string){this.store.setItem(this.prefix+'job:'+validId(input)+':'+operation,validId(id));this.store.removeItem(this.prefix+'pending:'+input+':'+operation);}
 job(input:string,operation:Operation){const value=this.store.getItem(this.prefix+'job:'+validId(input)+':'+operation);return value?validId(value):null;}
 savePending(input:string,revision?:number){const key=this.prefix+'save:'+validId(input);if(revision!==undefined){if(!Number.isSafeInteger(revision)||revision<0)throw new CandidateError(400,'invalid_request');this.store.setItem(key,String(revision));if(this.store.getItem(key)!==String(revision))throw new CandidateError(0,'persistence_unavailable');}const value=this.store.getItem(key);if(value===null)return undefined;const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw new CandidateError(0,'invalid_request');return n;}
 confirmSave(input:string){this.store.removeItem(this.prefix+'save:'+validId(input));}
}
export function hasUnknown(jobs:Partial<Record<Operation,Job>>){return Object.values(jobs).some(job=>job?.state==='unknown');}
export async function publicConfig(request:typeof fetch=fetch){
 const r=await request('/api/cloud/config',{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new CandidateError(r.status,'configuration_unavailable');
 const config=await r.json();if(config?.web?.projectId!=='vistavo-prod'||typeof config.web.apiKey!=='string'||typeof config.web.appId!=='string'||config.web.authDomain!=='vistavo-prod.firebaseapp.com')throw new CandidateError(0,'invalid_configuration');return config;
}
export function candidateApi(options:{accountId:string;token:()=>Promise<string>;signal:AbortSignal;store:Store;request?:typeof fetch}){
 const request=options.request??fetch,book=new RequestBook(options.accountId,options.store);
 async function call(path:string,method='GET',body?:unknown,timeout=120000){
  if(!/^\/api\/cloud\/[a-z0-9/?&=:.%-]+$/i.test(path)||path.includes('..')||path.includes('//'))throw new CandidateError(400,'invalid_path');
  options.signal.throwIfAborted();const token=await options.token();options.signal.throwIfAborted();if(!token||/\s/.test(token))throw new CandidateError(401,'signed_out');
  let r:Response;try{r=await request(path,{method,redirect:'error',credentials:'omit',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':body instanceof Blob?'application/octet-stream':'application/json'})},body:body===undefined?undefined:body instanceof Blob?body:JSON.stringify(body),signal:AbortSignal.any([options.signal,AbortSignal.timeout(timeout)])});}
  catch(error){if(options.signal.aborted)throw error;throw new CandidateError(0,'response_unconfirmed');}
  if(!r.ok){await r.body?.cancel();throw new CandidateError(r.status,r.status===409?'conflict':r.status===503?'pilot_unavailable':r.status===402?'insufficient_test_units':r.status===401?'signed_out':'request_unconfirmed');}return r;
 }
 const json=async(path:string,method='GET',body?:unknown)=>(await call(path,method,body)).json();
 const saveConfirmed=(id:string)=>{if(book.savePending(id)!==undefined)throw new CandidateError(409,'save_unconfirmed');};
 const readProject=async(id:string)=>{const p=await json('/api/cloud/projects/'+validId(id));if(!Number.isSafeInteger(p.revision)||p.revision<1||typeof p.draft!=='string')throw new CandidateError(0,'response_unconfirmed');return p;};
 return {book,signal:options.signal,
  me:()=>json('/api/cloud/me'),
  input:(id:string):Promise<Input>=>json('/api/cloud/uploads/'+validId(id)),
  project:readProject,
  async reloadProject(id:string){let p;try{p=await readProject(id);}catch(error){if((error as CandidateError).status!==404)throw error;p=null;}options.signal.throwIfAborted();book.confirmSave(id);return p;},
  async save(id:string,revision:number,draft:string){if(!draftWithinPilotLimit(draft))throw new CandidateError(400,'pilot_draft_limit');saveConfirmed(id);book.savePending(id,revision);const project=await json('/api/cloud/projects/'+validId(id),'PUT',{expectedRevision:revision,draft});if(project.revision!==revision+1||project.draft!==draft)throw new CandidateError(0,'response_unconfirmed');book.confirmSave(id);return project;},
  quote:(id:string,operation:Operation,revision:number)=>{saveConfirmed(id);return json('/api/cloud/ai/quote?inputId='+validId(id)+'&operation='+encodeURIComponent(operation)+'&revision='+revision);},
  async start(id:string,operation:Operation,revision:number):Promise<string>{saveConfirmed(id);const requestKey=book.key(id,operation,revision);book.pending(id,operation,revision);const made=await json('/api/cloud/ai/jobs','POST',{inputId:id,operation,expectedRevision:revision,requestKey});validId(made.id);book.rememberJob(id,operation,made.id);return made.id;},
  job:(id:string):Promise<Job>=>json('/api/cloud/ai/jobs/'+validId(id)),
  cancel:(id:string)=>json('/api/cloud/ai/jobs/'+validId(id),'DELETE'),
  async remove(id:string){const response=await call('/api/cloud/uploads/'+validId(id),'DELETE');if(response.status!==202)throw new CandidateError(0,'response_unconfirmed');const result=await response.json();if(result.id!==id||!['deleting','deleted'].includes(result.state))throw new CandidateError(0,'response_unconfirmed');book.retireUpload(id);return result;},
  async upload(file:File,progress:(fraction:number)=>void):Promise<Input>{
   if(file.size<1||file.size>MAX_BYTES||!file.name.toLowerCase().endsWith('.mp4'))throw new CandidateError(400,'invalid_video');
   options.signal.throwIfAborted();const digest=await bytesSha(await file.arrayBuffer());options.signal.throwIfAborted();
   const requestKey=book.key(digest,'upload',0);let input:Input=await json('/api/cloud/uploads','POST',{name:file.name,size:file.size,sha256:digest,requestKey});validId(input.id);book.rememberInput(input.id);book.rememberUpload(input.id,digest);
   input=await json('/api/cloud/uploads/'+input.id);let offset=input.offset;
   if(!Number.isSafeInteger(offset)||offset<0||offset>file.size)throw new CandidateError(0,'invalid_offset');progress(offset/file.size);
   while(offset<file.size){options.signal.throwIfAborted();const chunk=file.slice(offset,Math.min(file.size,offset+CHUNK_BYTES)),next:Input=await json('/api/cloud/uploads/'+input.id+'/chunks?offset='+offset,'PUT',chunk);if(next.offset!==offset+chunk.size)throw new CandidateError(0,'invalid_offset');offset=next.offset;input=next;progress(offset/file.size);}
   return input.state==='uploading'?json('/api/cloud/uploads/'+input.id+'/complete','POST',{}):input;
  },
  async result(job:Job,entry:Job['results'][number]){
   const mime=entry.name.endsWith('.wav')?'audio/wav':entry.name.endsWith('.txt')?'text/plain; charset=utf-8':entry.name.endsWith('.srt')?'application/x-subrip; charset=utf-8':'application/json; charset=utf-8';
   validId(job.id);if(!/^(transcript-es\.(txt|srt)|translation-en\.(txt|srt)|cues\.json|narration-en\.wav)$/.test(entry.name)||entry.mimeType!==mime||!job.results.some(x=>x.name===entry.name&&x.sha256===entry.sha256)||!Number.isSafeInteger(entry.size)||entry.size<1||entry.size>(entry.name.endsWith('.wav')?32*1024*1024:256*1024)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new CandidateError(0,'invalid_result');
   const r=await call('/api/cloud/ai/jobs/'+job.id+'/results/'+entry.name);if(r.headers.get('cache-control')!=='no-store'||r.headers.get('content-type')!==entry.mimeType)throw new CandidateError(0,'invalid_result');
   const reader=r.body?.getReader();if(!reader)throw new CandidateError(0,'invalid_result');const parts:Uint8Array[]=[];let size=0;
   try{for(;;){options.signal.throwIfAborted();const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>entry.size)throw new CandidateError(0,'invalid_result');parts.push(p.value);}}finally{await reader.cancel().catch(()=>undefined);}
   if(size!==entry.size)throw new CandidateError(0,'invalid_result');const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}if(await bytesSha(bytes.buffer)!==entry.sha256)throw new CandidateError(0,'invalid_result');options.signal.throwIfAborted();return new Blob([bytes],{type:entry.mimeType});
  }
 };
}
export type CandidateApi=ReturnType<typeof candidateApi>;
