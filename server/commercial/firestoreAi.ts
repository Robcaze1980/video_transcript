import {createHash} from 'node:crypto';
import {FieldPath,type Firestore,type DocumentReference,type Transaction} from 'firebase-admin/firestore';
import {FirestoreBackend,LedgerFault} from './firestoreBackend';
import {aiOperation,artifactPlanHash,validateArtifactPlan,validateArtifactManifest,simulatedAiPrice,storageQuota,AI_CATALOG_VERSION,AI_BILLING_PROFILE,AI_TEXT_WINDOW_MS,AI_TEXT_MAX_DURATION_MS,AiContractFault,type AiArtifactReceipt} from './aiContracts';
import type {CloudObjects,CloudObject} from './gcsObjects';
import {readyPrivateInput,privateUuid} from './privateObjectPlan';
import {textModel} from './pipelineTextProvider';
import {VOICE_MODEL,narrationChunks} from './pipelineVoiceProvider';
import {diagnosticStage} from './cloudDiagnostics';
import {reserveWithRecovery} from './cloudEnqueueRecovery';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export class AiFault extends Error {constructor(readonly code:'invalid'|'not_found'|'conflict'|'disabled'|'unknown'){super(code);}}
export type AiCandidateLimits=Readonly<{maxSourceSeconds:number;maxNarrationChars:number;maxVoiceChunks:number}>;
function id(value:string){if(typeof value!=='string'||!privateUuid.test(value))throw new AiFault('invalid');}
function safeUsage(value:any){const out:Record<string,number>={};for(const key of ['promptTokenCount','candidatesTokenCount','totalTokenCount','thoughtsTokenCount','cachedContentTokenCount'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)out[key]=value[key];return out;}
/** Candidate-only orchestration. No client can mutate receipts, credits, plans or provider outcomes. */
export class FirestoreAi {
 constructor(readonly db:Firestore,readonly root:DocumentReference,readonly backend:FirestoreBackend,readonly objects:CloudObjects,readonly candidateLimits?:AiCandidateLimits){
  if(candidateLimits&&Object.values(candidateLimits).some(x=>!Number.isSafeInteger(x)||x<1))throw new AiFault('invalid');
 }
 private ref(col:string,value:string){return this.root.collection(col).doc(value);}
 async enabled(accountId:string){return diagnosticStage('enabled',async()=>{id(accountId);const d=await this.ref('accounts',accountId).get();if(!d.exists||d.get('aiPilot')!==true||d.get('simulationOnly')!==true)throw new AiFault('disabled');});}
 async quote(accountId:string,inputId:string,operation:unknown,revision:number){
  return diagnosticStage('quote',async()=>{
  await this.enabled(accountId);id(inputId);const op=aiOperation(operation),project=await this.backend.readProject(accountId,inputId),input=(await diagnosticStage('quote.input',()=>this.ref('inputs',inputId).get())).data();
  if(project.revision!==revision)throw new AiFault('conflict');if(!readyPrivateInput(input,inputId)||(input as any).deleted||(input as any).expiresAtMs<=Date.now())throw new AiFault('not_found');
  if(this.candidateLimits){const duration=(input as any).metadata?.duration,limits=this.candidateLimits;
   if(!Number.isFinite(duration)||duration<=0||duration>limits.maxSourceSeconds)throw new AiFault('invalid');
   if(op.startsWith('narration:')){let chunks:number;try{chunks=narrationChunks(project.draft).length;}catch{throw new AiFault('invalid');}
    if(project.draft.length>limits.maxNarrationChars||chunks<1||chunks>limits.maxVoiceChunks)throw new AiFault('invalid');}
  }
  if(op==='translation:en'&&((input as any).metadata?.audioTracks??0)<1)throw new AiFault('invalid');
  return diagnosticStage('quote.catalog',async()=>({catalogVersion:AI_CATALOG_VERSION,billing:AI_BILLING_PROFILE,inputId,operation:op,revision,snapshotSha256:hash(project.draft),sourceGeneration:input.storage.generation,inputSha256:input.sha256,units:simulatedAiPrice(op,(input as any).metadata?.duration)}));
  });
 }
 async enqueue(accountId:string,inputId:string,operation:unknown,revision:number,requestKey:string){
  await this.enabled(accountId);const op=aiOperation(operation);const prior=await this.backend.priorRequest(accountId,inputId,requestKey,op,revision,AI_CATALOG_VERSION);if(prior)return prior;
  const q=await this.quote(accountId,inputId,op,revision);
  return reserveWithRecovery(this,accountId,{inputId,operation:op,expectedRevision:revision,requestKey},()=>this.backend.reserve(accountId,inputId,requestKey,q.units,q.operation,revision,AI_CATALOG_VERSION),error=>error instanceof AiFault||error instanceof LedgerFault||error instanceof AiContractFault);
 }
 async status(accountId:string,jobId:string){
  id(accountId);id(jobId);
  return this.db.runTransaction(async tx=>{
   const {job,artifact,input}=await this.resultContext(tx,accountId,jobId),project=(await tx.get(this.ref('projects',job.inputId))).data();
   const manifest=this.availableManifest(accountId,job,artifact,input);
   return {id:jobId,inputId:job.inputId,state:job.state,revision:job.revision,operation:job.operation,units:job.price,billing:AI_BILLING_PROFILE,stale:!!project&&project.revision!==job.revision,results:manifest?manifest.map(x=>({name:x.name,mimeType:x.mimeType,size:x.size,sha256:x.sha256})):[]};
  });
 }
 async download(accountId:string,jobId:string,name:string){
  id(accountId);id(jobId);
  return this.db.runTransaction(async tx=>{
   const {job,artifact,input}=await this.resultContext(tx,accountId,jobId),manifest=this.availableManifest(accountId,job,artifact,input),entry=manifest?.find(x=>x.name===name);if(!entry)throw new AiFault('not_found');
   return {entry,revision:job.revision,object:{key:entry.key,generation:entry.generation,size:entry.size} as CloudObject};
  });
 }
 /** The account grant and result binding share one authorization transaction.
  * A revocation committed before that authorization denies the request. Bytes
  * already authorized or downloaded cannot be withdrawn by a later revocation. */
 private async resultContext(tx:Transaction,accountId:string,jobId:string){
  const [account,j,a]=await tx.getAll(this.ref('accounts',accountId),this.ref('jobs',jobId),this.ref('artifacts',jobId));
  if(account.get('aiPilot')!==true||account.get('simulationOnly')!==true)throw new AiFault('disabled');
  const job=j.data(),artifact=a.data();
  if(!job||!artifact||job.accountId!==accountId||artifact.accountId!==accountId||job.aiProfile!==AI_CATALOG_VERSION||typeof job.inputId!=='string'||!privateUuid.test(job.inputId)||artifact.jobId!==jobId||artifact.inputId!==job.inputId||artifact.revision!==job.revision)throw new AiFault('not_found');
  const input=(await tx.get(this.ref('inputs',job.inputId))).data();return {job,artifact,input};
 }
 private availableManifest(accountId:string,job:any,artifact:any,input:any){
  if(job.state!=='succeeded'||artifact.state!=='ready'||!input||input.accountId!==accountId||input.deleted||!Number.isFinite(input.expiresAtMs)||input.expiresAtMs<=Date.now()||!readyPrivateInput(input,job.inputId)||input.storage.generation!==artifact.sourceGeneration||input.sha256!==artifact.inputSha256||input.storage.generation!==job.inputStorage?.generation||input.sha256!==job.inputSha256)return null;
  const plan=validateArtifactPlan(artifact.plan);
  if(plan.jobId!==artifact.jobId||plan.inputId!==job.inputId||plan.operation!==job.operation||artifact.planHash!==artifactPlanHash(plan))throw new AiFault('not_found');
  return validateArtifactManifest(plan,artifact.entries);
 }
 async uploadResults(accountId:string,jobId:string,attemptId:string,buffers:ReadonlyMap<string,Buffer>){
  if(!this.objects.putArtifactOnce)throw new AiFault('disabled');const doc=(await this.ref('artifacts',jobId).get()).data();if(!doc||doc.accountId!==accountId||doc.state!=='pending')throw new AiFault('conflict');
  const plan=validateArtifactPlan(doc.plan),entries:AiArtifactReceipt[]=[];if(buffers.size!==plan.artifacts.length)throw new AiFault('invalid');
  // All sizes are checked before the first object write.
  let total=0;for(const spec of plan.artifacts){const bytes=buffers.get(spec.name);if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>spec.maxBytes)throw new AiFault('invalid');total+=bytes.length;}if(total>plan.budgetBytes)throw new AiFault('invalid');
  for(const spec of plan.artifacts){const bytes=buffers.get(spec.name)!;const object=await this.objects.putArtifactOnce(spec.key,bytes);entries.push({name:spec.name,key:spec.key,mimeType:spec.mimeType,generation:object.generation,size:object.size,sha256:hash(bytes)});}
  const manifest=validateArtifactManifest(plan,entries);if(!await this.backend.stageArtifactReceipt(accountId,jobId,attemptId,manifest))throw new AiFault('conflict');return manifest;
 }
 /** Durable BEFORE each paid request. Ambiguity never creates another attempt/call. */
 invoke(accountId:string,jobId:string,attemptId:string,apiKey:string){
  return async(callKey:string,model:string,body:object,signal:AbortSignal):Promise<any>=>{
   if(!/^(text-window|voice-chunk):\d{4}$/.test(callKey)||!['gemini-3.8-flash','gemini-3.8-flash-tts'].includes(model))throw new AiFault('invalid');
   const serialized=JSON.stringify(body),requestSha256=hash(serialized),call=this.ref('providerCalls',jobId+'-'+callKey.replace(':','-'));
    await this.db.runTransaction(async tx=>{const [j,p,c,a]=await tx.getAll(this.ref('jobs',jobId),this.ref('artifacts',jobId),call,this.ref('accounts',accountId));const job=j.data(),plan=p.data();
     if(a.get('aiPilot')!==true||a.get('simulationOnly')!==true)throw new AiFault('disabled');
    if(!job||job.accountId!==accountId||job.state!=='running'||job.invocationPhase!=='invoking'||job.attemptId!==attemptId||job.leaseUntil<=Date.now()||!plan||plan.state!=='pending'||plan.planHash!==artifactPlanHash(plan.plan))throw new AiFault('conflict');
    const input=(await tx.get(this.ref('inputs',job.inputId))).data();if(!input||input.deleted||input.expiresAtMs<=Date.now()||input.unknownCount!==0||!readyPrivateInput(input,job.inputId)||input.storage.generation!==job.inputStorage?.generation)throw new AiFault('conflict');
     const voice=job.operation==='narration:en:female'||job.operation==='narration:en:male',duration=(input as {metadata?:{duration?:number}}).metadata?.duration;
     if((!voice&&job.operation!=='translation:en')||!job.snapshot||(!voice&&(!Number.isFinite(duration)||duration!<=0||duration!*1000>AI_TEXT_MAX_DURATION_MS)))throw new AiFault('conflict');
     const count=voice?narrationChunks(job.snapshot.draft).length:Math.ceil(Math.floor(duration!*1000)/AI_TEXT_WINDOW_MS),ordinal=Number(callKey.slice(callKey.indexOf(':')+1));
     if(count<1||count>1000||ordinal>=count||!callKey.startsWith(voice?'voice-chunk:':'text-window:')||model!==(voice?VOICE_MODEL:textModel))throw new AiFault('invalid');
    if(c.exists)throw new AiFault('unknown');tx.create(call,{jobId,accountId,attemptId,callKey,model,requestSha256,state:'intent',startedAtMs:Date.now()});
   });
   signal.throwIfAborted();let response:Response;
   try{response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{method:'POST',redirect:'error',headers:{'x-goog-api-key':apiKey,'Content-Type':'application/json'},body:serialized,signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});}
   catch{throw new AiFault('unknown');}
   if(!response.ok){await response.body?.cancel();await call.update({httpStatus:response.status,state:'ambiguous',finishedAtMs:Date.now()});throw new AiFault('unknown');}
   const reader=response.body?.getReader();if(!reader)throw new AiFault('unknown');const chunks:Uint8Array[]=[];let bytes=0;
   try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>24*1024*1024)throw new AiFault('unknown');chunks.push(part.value);}}
   catch{throw new AiFault('unknown');}finally{await reader.cancel().catch(()=>undefined);}
   let payload:any;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AiFault('unknown');}
    const usage=safeUsage(payload.usageMetadata);
    await call.update({state:'received',finishedAtMs:Date.now(),httpStatus:response.status,responseId:typeof payload.responseId==='string'?payload.responseId.slice(0,200):null,responseSha256:hash(JSON.stringify(payload)),usage,usageUnavailable:Object.keys(usage).length===0});
   return payload;
  };
 }
 async pendingPurges(limit=25){const d=await this.root.collection('artifacts').where('state','==','purging').where('nextAttemptAt','<=',Date.now()).orderBy('nextAttemptAt').limit(limit).get();return d.docs.map(x=>x.id);}
 async purgeResult(jobId:string){id(jobId);const ref=this.ref('artifacts',jobId),d=(await ref.get()).data();if(!d)return false;
  const plan=validateArtifactPlan(d.plan);if(d.jobId!==jobId||plan.jobId!==jobId)throw new AiFault('conflict');if(d.state==='purged')return true;if(d.state!=='purging')return false;
  const markers=await Promise.all(plan.artifacts.map(x=>this.objects.barrier(x.key)));if(markers.some((m,i)=>m.key!==plan.artifacts[i].key||m.size!==0||!m.marker))throw new AiFault('conflict');
  await this.db.runTransaction(async tx=>{const [a,r]=await tx.getAll(this.ref('accounts',d.accountId),ref);const doc=r.data();if(!doc||doc.state==='purged')return;if(doc.state!=='purging'||doc.planHash!==artifactPlanHash(plan))throw new AiFault('conflict');
   const delta=doc.quotaHeld,quota=storageQuota(a.data(),doc.quotaMode==='reserved'?-delta:0,doc.quotaMode==='committed'?-delta:0);tx.update(a.ref,quota);tx.update(ref,{state:'purged',entries:[],quotaHeld:0,quotaMode:'none',purgedAtMs:Date.now()});
  });return true;
 }
 async purgeInput(accountId:string,inputId:string){
   const page=this.root.collection('artifacts').where('accountId','==',accountId).where('inputId','==',inputId).orderBy(FieldPath.documentId()).limit(100);
   let cursor:string|undefined;
   for(;;){
    const rows=await (cursor?page.startAfter(cursor):page).get();
    for(const row of rows.docs){await this.db.runTransaction(async tx=>{const [i,a]=await tx.getAll(this.ref('inputs',inputId),row.ref);const input=i.data(),artifact=a.data();if(!input||input.accountId!==accountId||!input.deleted)throw new AiFault('conflict');if(artifact&&artifact.state!=='purged')tx.update(row.ref,{state:'purging',nextAttemptAt:Date.now()});});await this.purgeResult(row.id);}
    if(rows.size<100)break;cursor=rows.docs[rows.size-1].id;
   }
 }
}
