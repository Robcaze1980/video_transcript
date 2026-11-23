import {createHash} from 'node:crypto';
import {FieldPath,type Firestore,type DocumentReference,type Transaction} from 'firebase-admin/firestore';
import {FirestoreBackend,LedgerFault,narrationRequiresReview,validClearIntentAdmissionGuard,copyIntentWitness,copyTerminalRecoveryReadSnapshot,copyDirectObservationSnapshot,pickOutboxSnapshot,copyOutboxSnapshot,OUTBOX_METADATA_KEYS,classifyA3ReplayWindow,type DirectObservationSnapshot,type ExternalBillingOutboxSnapshot,type ExternalBillingSettlementReadSnapshot,type ExternalBillingObservation,type ExternalBillingIntentWitness,type ExternalBillingConfirmedIntentObservation,type ExternalBillingIntentFailureEvidence} from './firestoreBackend';
import {aiOperation,artifactPlanHash,validateArtifactPlan,validateArtifactManifest,simulatedAiPrice,storageQuota,AI_CATALOG_VERSION,AI_BILLING_PROFILE,AI_TEXT_WINDOW_MS,AI_TEXT_MAX_DURATION_MS,AI_VOICE_BUDGET,AiContractFault,type AiArtifactReceipt} from './aiContracts';
import type {CloudObjects,CloudObject} from './gcsObjects';
import {readyPrivateInput,privateUuid} from './privateObjectPlan';
import {textModel} from './pipelineTextProvider';
import {VOICE_MODEL,narrationChunks} from './pipelineVoiceProvider';
import {diagnosticStage} from './cloudDiagnostics';
import {reserveWithRecovery} from './cloudEnqueueRecovery';
import {AccountBillingClient,AccountBillingFault,accountIdentityKey} from './accountBillingClient';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function reservationUuid(accountId:string,identityKey:string,inputId:string,operation:string,revision:number,requestKey:string){const bytes=createHash('sha256').update(JSON.stringify(['vistavo-video-reservation-v1',accountId,identityKey,inputId,operation,revision,requestKey])).digest().subarray(0,16);bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export class AiFault extends Error {constructor(readonly code:'invalid'|'not_found'|'conflict'|'disabled'|'unknown'){super(code);}}
export type AiCandidateLimits=Readonly<{maxSourceSeconds:number;maxNarrationChars:number;maxVoiceChunks:number}>;
/**
 * Optional control for ONE drain pass, shared by `drainExternalBilling` and `drainExternalHolds`. It never changes what a row does: it decides how far a pass
 * goes and how the queue is walked. Without it both drains behave exactly as before.
 * - `shouldContinue` is consulted BEFORE each row (intent, outbox or hold); a `false` or a throw ends the pass cleanly (`stopped: true`, never an exception).
 * - `perAccountCap` is the most rows a single account is served in a pass; the extra rows are counted in `skippedRows` and left untouched.
 * - `after` is a rotation cursor per kind (document id): the reader starts strictly AFTER it and wraps, so a rotation visits each due row at most once.
 * - `maxRows` replaces the positional `limit` (default 25, bounds 1..100).
 * - `accountUsage` is a per-pass usage map shared by several drains: when present the cap is counted against it, so one
 *   account cannot take `perAccountCap` rows in each section of the same pass.
 * - `now` overrides the wall clock for the A-3 deadline (step 1.3a). It defaults to `Date.now()` at the start of the pass so a
 *   single pass uses one clock; no production caller passes it.
 */
export type DrainControl=Readonly<{shouldContinue?:()=>boolean|Promise<boolean>;perAccountCap?:number;after?:Readonly<{intents?:string|null;outbox?:string|null}>;maxRows?:number;accountUsage?:Map<string,number>;now?:number}>;
function id(value:string){if(typeof value!=='string'||!privateUuid.test(value))throw new AiFault('invalid');}
function safeUsage(value:any){const out:Record<string,number>={};for(const key of ['promptTokenCount','candidatesTokenCount','totalTokenCount','thoughtsTokenCount','cachedContentTokenCount'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)out[key]=value[key];return out;}
/** Candidate-only orchestration. No client can mutate receipts, credits, plans or provider outcomes. */
export class FirestoreAi {
 constructor(readonly db:Firestore,readonly root:DocumentReference,readonly backend:FirestoreBackend,readonly objects:CloudObjects,readonly candidateLimits?:AiCandidateLimits,readonly accountBilling?:AccountBillingClient){
  if(candidateLimits&&Object.values(candidateLimits).some(x=>!Number.isSafeInteger(x)||x<1))throw new AiFault('invalid');
 }
 private ref(col:string,value:string){return this.root.collection(col).doc(value);}
 async enabled(accountId:string){return diagnosticStage('enabled',async()=>{id(accountId);const d=await this.ref('accounts',accountId).get();if(!d.exists||d.get('aiPilot')!==true||d.get('simulationOnly')!==true)throw new AiFault('disabled');});}
 private async enabledForUid(accountId:string,uid:string){
  id(accountId);if(typeof uid!=='string'||!uid||uid.length>128)throw new AiFault('not_found');
  return this.db.runTransaction(async tx=>{
   const [identity,account]=await tx.getAll(this.ref('identities',accountIdentityKey(uid)),this.ref('accounts',accountId));
   if(!identity.exists||identity.get('uid')!==uid||identity.get('accountId')!==accountId||!account.exists)throw new AiFault('not_found');
   if(account.get('aiPilot')!==true||account.get('simulationOnly')!==true)throw new AiFault('disabled');
  });
 }
 private async quoteFromSnapshots(inputId:string,op:ReturnType<typeof aiOperation>,revision:number,project:any,input:any){
  if(project.revision!==revision)throw new AiFault('conflict');if(!readyPrivateInput(input,inputId)||(input as any).deleted||(input as any).expiresAtMs<=Date.now())throw new AiFault('not_found');
  if(this.candidateLimits){const duration=(input as any).metadata?.duration,limits=this.candidateLimits;
   if(!Number.isFinite(duration)||duration<=0||duration>limits.maxSourceSeconds)throw new AiFault('invalid');
   if(op.startsWith('narration:')){let chunks:number;try{chunks=narrationChunks(project.draft).length;}catch{throw new AiFault('invalid');}
    if(project.draft.length>limits.maxNarrationChars||chunks<1||chunks>limits.maxVoiceChunks)throw new AiFault('invalid');}
  }
  const duration=(input as any).metadata?.duration;
  if(this.accountBilling&&(!Number.isFinite(duration)||duration<=0||duration>600))throw new AiFault('invalid');
  if(op.startsWith('narration:')&&(typeof project.draft!=='string'||!project.draft.trim()||(project as any).reviewedTextRevision!==revision||(project as any).reviewedTextSha256!==hash(project.draft)))throw new AiFault('invalid');
  if(op==='translation:en'&&((input as any).metadata?.audioTracks??0)<1)throw new AiFault('invalid');
  const units=this.accountBilling?Math.ceil(duration):simulatedAiPrice(op,duration);
  const exactPriceUsd=units*0.10/60;
  return diagnosticStage('quote.catalog',async()=>({catalogVersion:AI_CATALOG_VERSION,billing:this.accountBilling?{mode:'account_seconds' as const,unit:'video_seconds' as const,rateUsdPerMinute:0.10,exactPriceUsd:Math.round(exactPriceUsd*1_000_000)/1_000_000,priceUsd:Math.round(exactPriceUsd*100)/100,rounding:'per_selected_service_half_up_to_cent' as const}:AI_BILLING_PROFILE,inputId,operation:op,revision,snapshotSha256:hash(project.draft),sourceGeneration:input.storage.generation,inputSha256:input.sha256,units}));
 }
 /** Trusted internal quote; customer routes must use quoteForUid. */
 async quote(accountId:string,inputId:string,operation:unknown,revision:number){
  return diagnosticStage('quote',async()=>{
  await this.enabled(accountId);id(inputId);const op=aiOperation(operation),project=await this.backend.readProject(accountId,inputId),input=(await diagnosticStage('quote.input',()=>this.ref('inputs',inputId).get())).data();
  return this.quoteFromSnapshots(inputId,op,revision,project,input);
  });
 }
 /** Identity, account, input and project must be observed together before returning a quote. */
 async quoteForUid(accountId:string,inputId:string,operation:unknown,revision:number,uid:string){
  id(accountId);id(inputId);const op=aiOperation(operation);
  if(typeof uid!=='string'||!uid||uid.length>128)throw new AiFault('not_found');
  return diagnosticStage('quote',async()=>{
   const identityKey=accountIdentityKey(uid);
   const {project,input}=await this.db.runTransaction(async tx=>{
    const [identity,account,inputDoc,projectDoc]=await tx.getAll(this.ref('identities',identityKey),this.ref('accounts',accountId),this.ref('inputs',inputId),this.ref('projects',inputId));
    if(!identity.exists||identity.get('uid')!==uid||identity.get('accountId')!==accountId||!account.exists)throw new AiFault('not_found');
    if(account.get('aiPilot')!==true||account.get('simulationOnly')!==true)throw new AiFault('disabled');
    if(!inputDoc.exists||inputDoc.get('accountId')!==accountId||inputDoc.get('deleted')!==false||!Number.isSafeInteger(inputDoc.get('expiresAtMs'))||inputDoc.get('expiresAtMs')<=Date.now()||
       !projectDoc.exists||projectDoc.get('accountId')!==accountId||projectDoc.get('inputId')!==inputId)throw new AiFault('not_found');
    // Voice admission will be enabled only when it is bound to a captured,
    // structured review and its durable billing/recovery protocol.
    if(op.startsWith('narration:'))throw new AiFault('disabled');
    return {project:projectDoc.data()!,input:inputDoc.data()!};
   });
   return this.quoteFromSnapshots(inputId,op,revision,project,input);
  });
 }
  /** A confirmed Account observation is re-read atomically if closing fails or its response is lost. */
  private async confirmedIntentObservation(witness:ExternalBillingIntentWitness,requestKey:string,observed:Exclude<ExternalBillingConfirmedIntentObservation,{source:'resolution_status'}>,snapshotInput:DirectObservationSnapshot){
   if(!observed||typeof observed!=='object')throw new AiFault('invalid');
   witness=copyIntentWitness(witness);observed={action:observed.action,source:observed.source,state:observed.state,reservationId:observed.reservationId,seconds:observed.seconds} as typeof observed;
   const snapshot=copyDirectObservationSnapshot(snapshotInput);
   if(!observed||!(observed.action==='seal'&&observed.source==='seal_ack'&&observed.state==='sealed'||observed.action==='release'&&['status','release_ack','seal_status'].includes(observed.source)&&observed.state==='released'))throw new AiFault('invalid');
   let closed=false;
   try{closed=observed.action==='seal'?await this.backend.finishExternalBillingSeal(witness.accountId,requestKey,witness,observed,witness,snapshot):await this.backend.finishExternalBillingRelease(witness.accountId,requestKey,witness,observed,witness,observed.source,snapshot);}catch{/* A committed local close can lose its response. */}
   if(closed)return true;
   const result=await this.backend.recordConfirmedIntentObservation(witness,observed,snapshot);return result.state==='closed'||result.state==='already_closed';
  }
  /** Trusted internal entry, including Account reconciliation fixtures; not a customer route. */
  async enqueue(accountId:string,inputId:string,operation:unknown,revision:number,requestKey:string,uid?:string){
  const op=aiOperation(operation);
  if(this.accountBilling&&(typeof uid!=='string'||!uid||uid.length>128))throw new AiFault('invalid');
  if(this.accountBilling)await this.enabledForUid(accountId,uid!);else await this.enabled(accountId);
  const previous=()=>this.accountBilling?this.backend.priorExternalRequestForEnqueue(accountId,inputId,requestKey,op,revision,AI_CATALOG_VERSION,uid!):this.backend.priorSimulatedRequestForEnqueue(accountId,inputId,requestKey,op,revision,AI_CATALOG_VERSION);
  const prior=await previous();if(prior){if(this.accountBilling)throw new AiFault('unknown');return prior;}
  const q=await this.quote(accountId,inputId,op,revision),data=this.accountBilling?(()=>{if(!uid)throw new AiFault('invalid');const identityKey=accountIdentityKey(uid);return {provider:'account_seconds' as const,identityKey,reservationId:reservationUuid(accountId,identityKey,inputId,op,revision,requestKey),seconds:q.units};})():undefined;
   if(!data)return reserveWithRecovery(this,accountId,{inputId,operation:op,expectedRevision:revision,requestKey},()=>this.backend.reserve(accountId,inputId,requestKey,q.units,q.operation,revision,AI_CATALOG_VERSION),error=>error instanceof AiFault||error instanceof LedgerFault||error instanceof AiContractFault,previous);
   const priorIntent=await this.backend.beginExternalBillingIntent(accountId,inputId,requestKey,op,revision,data);if(priorIntent){const verified=await previous();if(verified!==priorIntent)throw new AiFault('conflict');throw new AiFault('unknown');}
   const witness=await this.backend.externalIntentWitness(accountId,requestKey,data);
  const admission=await this.backend.recheckExternalBillingAdmission(accountId,requestKey,data);if(admission.state==='job_created'){const verified=await previous();if(verified!==admission.jobId)throw new AiFault('conflict');throw new AiFault('unknown');}
  // Capture once before reserve/status. If ownership cannot be proved, leave the intent recoverable without making a new Account call.
  const failureEvidence=await this.backend.captureExternalBillingIntentFailureEvidence(witness,requestKey);
  if(!failureEvidence||failureEvidence.state!=='reserve_pending')throw new AiFault('unknown');
 // Step 1.3b: the preflight re-reads every source document and commits the immutable
 // attempt BEFORE the Account POST. If it cannot prove the same history, no POST is sent.
 const attempt=await this.backend.prepareExternalReserveAttempt(accountId,inputId,requestKey,op,revision,uid!);
 // The POST tuple was computed before the preflight; the persisted intent is the
 // authority. A difference would reserve in Account with a history the ACK must
 // reject, leaving a paid reservation without work, so fail closed before the POST.
 if(data.identityKey!==attempt.witness.identityKey||data.reservationId!==attempt.witness.reservationId||data.seconds!==attempt.witness.seconds)throw new AiFault('conflict');
 let held:import('./accountBillingClient').VideoReservation;
 try{held=await this.accountBilling!.reserve(data.identityKey,data.reservationId,data.seconds);}
  catch(error){
   // A later status may aid reconciliation, but cannot establish the direct
   // POST ACK or authorize a job. Preserve the intent and changed history.
   if(!(error instanceof AccountBillingFault))throw error;
   const statusSnapshot=await this.backend.captureDirectObservation(witness,requestKey,'status');if(!statusSnapshot)throw error;
   let held;
   try{held=await this.accountBilling!.status(data.identityKey,data.reservationId);}
   catch(statusError){await this.backend.recordExternalBillingIntentFailure(accountId,requestKey,statusError instanceof AccountBillingFault?statusError.code:'unavailable',failureEvidence).catch(()=>undefined);throw error;}
   if(held.seconds!==data.seconds||held.state==='captured'){
    await this.backend.recordExternalBillingReview(accountId,requestKey,data,held,statusSnapshot);throw new AccountBillingFault('conflict');
   }
    if(held.state==='released'){
     await this.confirmedIntentObservation(witness,requestKey,{action:'release',source:'status',...held},statusSnapshot);
    throw new AccountBillingFault('conflict');
   }
   // A later status is not the POST ACK. Preserve changed history as an
   // observation, but never turn the status into admission or a refund.
   await this.backend.recordReservedStatusUncertainty(witness,requestKey,statusSnapshot);
   throw new AiFault('unknown');
  }
  // A validated direct ACK. The ACK and the job are written in ONE transaction; if that
  // local commit fails (including a revoked/reassigned identity or a release fence that
  // appeared after the POST), the ACK is still preserved without a job (design 3.2.3).
  const ack={reservationId:held.reservationId,seconds:held.seconds,state:'reserved' as const};
  try{return await this.backend.reserve(accountId,inputId,requestKey,q.units,q.operation,revision,AI_CATALOG_VERSION,data,undefined,uid!,attempt,ack);}
  catch(error){
   await this.backend.recordExternalReserveAck(attempt,ack).catch(()=>undefined);
   throw error;
  }
 }
 /** Customer admission is limited to the simulated ledger until external Account ACK recovery is audited. */
 async enqueueForUid(accountId:string,inputId:string,operation:unknown,revision:number,requestKey:string,uid:string){
  if(typeof uid!=='string'||!uid||uid.length>128)throw new AiFault('not_found');
  if(this.accountBilling){await this.enabledForUid(accountId,uid);throw new AiFault('disabled');}
  const op=aiOperation(operation);
  if(op.startsWith('narration:')){
   // This validates the requester and input before failing closed; it never
   // replays a flat-draft job or creates a reservation for customer voice.
   await this.quoteForUid(accountId,inputId,op,revision,uid);
   throw new AiFault('disabled');
  }
  const previous=()=>this.backend.priorSimulatedRequestForEnqueueForUid(accountId,inputId,requestKey,op,revision,AI_CATALOG_VERSION,uid);
  const prior=await previous();if(prior)return prior;
  const q=await this.quoteForUid(accountId,inputId,op,revision,uid);
  return reserveWithRecovery(this,accountId,{inputId,operation:op,expectedRevision:revision,requestKey},
   ()=>this.backend.reserveSimulatedAiForUid(accountId,inputId,requestKey,q.units,q.operation,revision,uid),
   error=>error instanceof AiFault||error instanceof LedgerFault||error instanceof AiContractFault,previous,
   {enabled:()=>this.enabledForUid(accountId,uid),job:id=>this.backend.jobForUid(accountId,id,uid)});
 }
 /** Optional control validation shared by both drains: `maxRows` replaces the positional `limit` (1..100) and `perAccountCap` must be a positive integer. */
 private drainMaxRows(limit:number,control?:DrainControl){
  const maxRows=control?.maxRows??limit,cap=control?.perAccountCap;
  if(control?.maxRows!==undefined&&(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>100))throw new AiFault('invalid');
  if(cap!==undefined&&(!Number.isSafeInteger(cap)||cap<1))throw new AiFault('invalid');
  return maxRows;
 }
 /** shouldContinue is asked BEFORE each row: a false value or a throw ends the pass (reported as `stopped:true`) instead of propagating. */
 private async drainShouldContinue(control?:DrainControl){if(!control?.shouldContinue)return true;try{return !!(await control.shouldContinue());}catch{return false;}}
 /** Counts a taken row against its account; at the cap the row is left pending for a later pass and reported as skipped, never touched. */
 private drainCapped(control:DrainControl|undefined,perAccount:Map<string,number>,accountId:string|null){
  const cap=control?.perAccountCap;if(cap===undefined||accountId===null)return false;
  const usage=control?.accountUsage??perAccount;
  const used=usage.get(accountId)??0;if(used>=cap)return true;usage.set(accountId,used+1);return false;
 }
 /** Recover Account holds independently of user visits; a scheduler is still required. */
 async drainExternalHolds(limit=25,control?:DrainControl):Promise<{applied:number;failed:number;review:number;skippedRows?:number;stopped?:boolean}>{
  const maxRows=this.drainMaxRows(limit,control);
  if(!this.accountBilling)return control===undefined?{applied:0,failed:0,review:0}:{applied:0,failed:0,review:0,skippedRows:0,stopped:false};
  let applied=0,failed=0,review=0,skippedRows=0,stopped=false;
  const perAccount=control?.accountUsage??new Map<string,number>();
  for(const row of await this.backend.pendingExternalHolds(maxRows) as Array<Record<string,unknown>>){
   if(!await this.drainShouldContinue(control)){stopped=true;break;}
   if(this.drainCapped(control,perAccount,typeof row.accountId==='string'?row.accountId:null)){skippedRows++;continue;}
   let hold:import('./firestoreBackend').ExternalBillingHold|undefined,holdVersion:string|undefined,ack=false;
   try{
    const authorized=await this.backend.authorizeExternalHold(row);if(authorized.state==='changed')continue;if(authorized.state==='needs_review'){review++;continue;}
    hold=authorized.hold;holdVersion=typeof row.snapshotVersion==='string'?row.snapshotVersion:undefined;await this.accountBilling.block(hold.identityKey,hold.id);ack=true;
    if(await this.backend.markExternalHoldApplied(hold)){applied++;continue;}
    failed++;await this.backend.recordExternalHoldAckMismatch(hold);
   }catch(error){
    failed++;
    if(hold){if(ack)await this.backend.recordExternalHoldAckMismatch(hold).catch(()=>undefined);else await this.backend.recordExternalHoldFailure(hold,error instanceof AccountBillingFault?error.code:'unavailable',holdVersion).catch(()=>undefined);}
   }
  }
  return control===undefined?{applied,failed,review}:{applied,failed,review,skippedRows,stopped};
 }
 /** One recovery read only. A scheduler and durable handling for unresolved rows are still required. */
 async recoverTerminalObservation(terminalId:string){
  const billing=this.accountBilling;if(!billing)throw new AiFault('disabled');
  const candidate=await this.backend.terminalWitnessForRecovery(terminalId);if(!candidate)return {state:'unverified' as const};
  const witness=copyIntentWitness(candidate.witness),snapshot=copyTerminalRecoveryReadSnapshot(candidate.snapshot),action=candidate.action;
  if(!snapshot||snapshot.intentId!==witness.intentId||snapshot.action!==action)return {state:'unverified' as const};
  let resolution:Awaited<ReturnType<AccountBillingClient['resolution']>>;
  try{resolution=await billing.resolution(witness.identityKey,witness.reservationId,witness.seconds);}
  catch(error){if(error instanceof AccountBillingFault&&error.code==='not_found')return {state:'unresolved' as const,reason:'not_found' as const};throw error;}
  if(resolution.state==='reserved'||resolution.state==='captured')return {state:'unresolved' as const,reason:resolution.state};
  const observed=resolution.state==='sealed'
   ?{action:'seal' as const,source:'resolution_status' as const,terminalAction:action,state:'sealed' as const,reservationId:resolution.reservationId,seconds:resolution.seconds}
   :{action:'release' as const,source:'resolution_status' as const,terminalAction:action,state:'released' as const,reservationId:resolution.reservationId,seconds:resolution.seconds};
  return this.backend.recordConfirmedIntentObservation(witness,observed,snapshot);
 }
 async drainExternalBilling(limit=25,control?:DrainControl):Promise<{settled:number;failed:number;intentsRecovered:number;intentsFailed:number;skippedRows?:number;stopped?:boolean;next?:{intents:string|null;outbox:string|null};traversed?:{intents:boolean;outbox:boolean}}>{
  const maxRows=this.drainMaxRows(limit,control);
  if(!this.accountBilling)return control===undefined?{settled:0,failed:0,intentsRecovered:0,intentsFailed:0}:{settled:0,failed:0,intentsRecovered:0,intentsFailed:0,skippedRows:0,stopped:false,next:{intents:null,outbox:null},traversed:{intents:false,outbox:false}};
  const now=control?.now??Date.now();
  let settled=0,failed=0,skippedRows=0,stopped=false,nextIntents:string|null=null,nextOutbox:string|null=null;
  const perAccount=control?.accountUsage??new Map<string,number>();
  const intents=await this.backend.pendingExternalBillingIntents(maxRows,control?.after?.intents);let intentsRecovered=0,intentsFailed=0,intentsAttended=false;
  for(const row of intents as Array<Record<string,any>>){
   if(!await this.drainShouldContinue(control)){stopped=true;break;}
   if(this.drainCapped(control,perAccount,typeof row.accountId==='string'?row.accountId:null)){skippedRows++;continue;}
   if(typeof row.id==='string'){nextIntents=row.id;intentsAttended=true;}
   let failureEvidence:ExternalBillingIntentFailureEvidence|null=null,terminalObserved=false;
   try{
   if(row.provider!=='account_seconds'||!['reserve_pending','release_pending'].includes(row.state)||typeof row.identityKey!=='string'||typeof row.reservationId!=='string'||typeof row.accountId!=='string'||typeof row.inputId!=='string'||typeof row.requestKey!=='string'||typeof row.operation!=='string'||!Number.isSafeInteger(row.revision)||!Number.isSafeInteger(row.seconds))throw new AiFault('invalid');
   const billing={provider:'account_seconds' as const,identityKey:row.identityKey,reservationId:row.reservationId,seconds:row.seconds};
   // This witness was committed with the original intent, before any Account status or terminal POST.
   const witness=await this.backend.externalIntentWitness(row.accountId,row.requestKey,billing);
   // LV-019.B step 1.6c: the three evidence-less routes below cannot fence a failure record (no snapshotVersion,
   // no failure evidence, no status snapshot), so each one records a bare ATTEMPT on the row before continuing.
   // Without it the row would be re-attempted on every pass without advancing its counter or its wait.
   if(typeof row.snapshotVersion!=='string'){intentsFailed++;await this.backend.recordExternalBillingIntentStall(row.accountId,row.requestKey,'unavailable').catch(()=>undefined);continue;}
   failureEvidence=await this.backend.captureExternalBillingIntentFailureEvidence(witness,row.requestKey,row.snapshotVersion);
   if(!failureEvidence){
          intentsFailed++;
          // LV-019.B step 1.3a: null failure evidence has many causes that are NOT a blocked account: a benign intent
          // write racing another drainer, a work request or marker that appeared, a foreign or expired lease, or a
          // missing input or identity. Close for review ONLY when the row is still reserve_pending, the deadline
          // passed AND the account is truly blocked, which closeA3ReservationForReview proves in its own transaction.
          // Any other cause (or a release already underway) keeps today's stall behavior: an overdue row is never
          // closed to review for nothing.
          if(row.state==='reserve_pending'&&classifyA3ReplayWindow(row,now)==='due'){
           const closed=await this.backend.closeA3ReservationForReview(row.accountId,row.requestKey,billing,{reservationId:row.reservationId,state:'reserved',seconds:row.seconds},{requireBlocked:true}).catch(()=>undefined);
           if(closed&&closed.state==='needs_review')continue;
          }
          await this.backend.recordExternalBillingIntentStall(row.accountId,row.requestKey,'unavailable').catch(()=>undefined);
          continue;
         }
   const initialStatus=await this.backend.captureDirectObservation(witness,row.requestKey,'status'),statusSnapshot=copyDirectObservationSnapshot(initialStatus);
   if(!statusSnapshot){intentsFailed++;await this.backend.recordExternalBillingIntentStall(row.accountId,row.requestKey,'unavailable').catch(()=>undefined);continue;}
   // The status proof is checked inside the same transaction that fences and prepares release.
   const releaseAfter=async(snapshot:DirectObservationSnapshot,reason:'status_reserved'|'seal_reserved')=>{
    const prepared=await this.backend.prepareTerminalFromDirectObservation(witness,row.requestKey,'release',reason,snapshot);
    if(prepared.state==='job_created')return 'recovered' as const;if(prepared.state!=='ready')return 'failed' as const;
    const captured=await this.backend.captureDirectObservation(witness,row.requestKey,'release'),releaseSnapshot=copyDirectObservationSnapshot(captured);
    if(!releaseSnapshot)return 'failed' as const;
    const released=await this.accountBilling!.settle(row.identityKey,row.reservationId,'release',row.seconds);
    if(released.state!=='released')throw new AiFault('unknown');terminalObserved=true;
    return await this.confirmedIntentObservation(witness,row.requestKey,{action:'release',source:'release_ack',reservationId:released.reservationId,seconds:released.seconds,state:released.state},releaseSnapshot)?'recovered' as const:'failed' as const;
   };
   let held:{reservationId:string;state:'reserved'|'captured'|'released';seconds:number};
   try{held=await this.accountBilling.status(row.identityKey,row.reservationId);terminalObserved=held.state==='captured'||held.state==='released';}
   catch(error){
    if(!(error instanceof AccountBillingFault)||error.code!=='not_found')throw error;
    const prepared=await this.backend.prepareTerminalFromDirectObservation(witness,row.requestKey,'seal','status_not_found',statusSnapshot);
    if(prepared.state==='job_created'){intentsRecovered++;continue;}if(prepared.state!=='ready'){intentsFailed++;continue;}
    const captured=await this.backend.captureDirectObservation(witness,row.requestKey,'seal'),sealSnapshot=copyDirectObservationSnapshot(captured);
    if(!sealSnapshot){intentsFailed++;continue;}
    const sealed=await this.accountBilling.seal(row.identityKey,row.reservationId,row.seconds);
    terminalObserved=sealed.state==='sealed'||sealed.state==='captured'||sealed.state==='released';
    if(sealed.state==='sealed'){if(await this.confirmedIntentObservation(witness,row.requestKey,{action:'seal',source:'seal_ack',reservationId:sealed.reservationId,seconds:sealed.seconds,state:'sealed'},sealSnapshot))intentsRecovered++;else intentsFailed++;continue;}
    if(sealed.state==='released'){if(await this.confirmedIntentObservation(witness,row.requestKey,{action:'release',source:'seal_status',reservationId:sealed.reservationId,seconds:sealed.seconds,state:'released'},sealSnapshot))intentsRecovered++;else intentsFailed++;continue;}
    if(sealed.state==='captured'||sealed.seconds!==row.seconds){const review=await this.backend.recordExternalBillingReview(row.accountId,row.requestKey,billing,{reservationId:sealed.reservationId,seconds:sealed.seconds,state:sealed.state as 'reserved'|'captured'},sealSnapshot);if(review.state==='needs_review')intentsFailed++;else intentsRecovered++;continue;}
    const result=await releaseAfter(sealSnapshot,'seal_reserved');if(result==='recovered')intentsRecovered++;else intentsFailed++;continue;
   }
   if(held.seconds!==row.seconds||held.state==='captured'){
    const review=await this.backend.recordExternalBillingReview(row.accountId,row.requestKey,billing,held,statusSnapshot);
    if(review.state==='needs_review')intentsFailed++;else intentsRecovered++;
    continue;
   }
   if(held.state==='released'){
    if(await this.confirmedIntentObservation(witness,row.requestKey,{action:'release',source:'status',reservationId:held.reservationId,seconds:held.seconds,state:held.state},statusSnapshot))intentsRecovered++;else intentsFailed++;
    continue;
   }
   if(row.state==='release_pending'){
    const result=await releaseAfter(statusSnapshot,'status_reserved');if(result==='recovered')intentsRecovered++;else intentsFailed++;continue;
   }
   // LV-019.B step 1.3a: an A-3 reserve_pending intent with no work is uncertain only until its deadline. At the
   // deadline the fence atomically closes the window for creating work; Account still reporting the matching reserved
   // status then lets the drain release, because Account's own admission check is the proof. An invalid clock stays on
   // the uncertainty path and never fences. Before the deadline behavior is exactly as before: reschedule only.
   const replayWindow=classifyA3ReplayWindow(row,now);
   if(replayWindow!=='due'){
    const deferred=await this.backend.recordReservedStatusUncertainty(witness,row.requestKey,statusSnapshot);
    if(deferred==='unchanged'&&failureEvidence)await this.backend.recordExternalBillingIntentFailure(row.accountId,row.requestKey,'reserved_unconfirmed',failureEvidence);
    intentsFailed++;continue;
   }
   let fenced:{state:'release_pending';transitioned:boolean}|{state:'job_created';jobId:string};
   try{fenced=await this.backend.claimExternalBillingRelease(row.accountId,row.requestKey,billing);}
   catch(error){
    if(!(error instanceof LedgerFault)||error.code!=='conflict')throw error;
    // A blocked account (or an invalid admission guard) closes the A-3 row for review without
    // blocking the owner or touching Account balance: the A2 sweep alerts on needs_review.
    await this.backend.closeA3ReservationForReview(row.accountId,row.requestKey,billing,{reservationId:held.reservationId,state:'reserved',seconds:held.seconds});
    intentsFailed++;continue;
   }
   if(fenced.state==='job_created'){intentsRecovered++;continue;}
   // A concurrent drain already owns the single release for this intent: only the caller that
   // performed the reserve_pending -> release_pending transition may contact Account.
   if(!fenced.transitioned){intentsFailed++;continue;}
   const refreshed=await this.backend.captureDirectObservation(witness,row.requestKey,'status'),freshSnapshot=copyDirectObservationSnapshot(refreshed);
   if(!freshSnapshot){intentsFailed++;continue;}
   try{
    const result=await releaseAfter(freshSnapshot,'status_reserved');if(result==='recovered')intentsRecovered++;else intentsFailed++;
   }catch(error){
    if(!(error instanceof AccountBillingFault)||error.code!=='conflict')throw error;
    // Account refused the release (inherited reservation or stored admission). Preserve the intent
    // for review without a second release and without blocking the owner.
    await this.backend.closeA3ReservationForReview(row.accountId,row.requestKey,billing,{reservationId:held.reservationId,state:'reserved',seconds:held.seconds});
    intentsFailed++;
   }
   continue;
  }catch(error){
   // No response is not an ACK. If Firestore also fails after an ACK, the immutable
   // witness remains for independent reconciliation; a read-only seal status is still pending.
   intentsFailed++;if(!terminalObserved&&failureEvidence&&typeof row.accountId==='string'&&typeof row.requestKey==='string')await this.backend.recordExternalBillingIntentFailure(row.accountId,row.requestKey,error instanceof AccountBillingFault?error.code:'unavailable',failureEvidence).catch(()=>undefined);
  }
  }
  // A stop in the intents section ends the whole pass: no outbox row is read or touched, so a one-shot shouldContinue cannot leak into it.
  // "Traversed" is decided at the END: the outbox kind was walked only if the loop completed, or if it stopped after
  // attending a row. A stop before the first outbox row leaves `next.outbox` null for "not read", which must never be
  // persisted as a completed wrap.
  const enteredOutbox=!stopped;
  let outboxAttended=false;
  if(enteredOutbox)for(const row of await this.backend.pendingExternalBilling(maxRows,control?.after?.outbox) as Array<Record<string,any>>){
   if(!await this.drainShouldContinue(control)){stopped=true;break;}
   if(this.drainCapped(control,perAccount,typeof row.accountId==='string'?row.accountId:null)){skippedRows++;continue;}
   if(typeof row.id==='string'){nextOutbox=row.id;outboxAttended=true;}
   let expected:ExternalBillingOutboxSnapshot|undefined,ack:ExternalBillingObservation|undefined,settlementSnapshot:ExternalBillingSettlementReadSnapshot|undefined;
   try{
    const validity=await this.validExternalBillingOutbox(row);
    if(validity==='already_settled'||validity==='changed')continue;
    if(validity==='blocked')throw new AiFault('conflict');
    if(validity==='invalid'){
     const q=await this.backend.quarantineExternalBillingOutbox(row.id,{phase:'before_ack',snapshotVersion:row.snapshotVersion});
     if(q.state==='needs_review')failed++;
     continue;
    }
    if(typeof validity==='string')throw new AiFault('conflict');
    settlementSnapshot=validity.snapshot;expected=settlementSnapshot.expected;
    // LV-019.B C2a: a protocol-3 release after an admission sends the admission together with the row's resolution; a capture sends its admitted attempt.
    const claim=expected.settlementProtocol===3&&expected.resolutionKind!==undefined?{jobId:expected.jobId,attemptId:expected.attemptId!}:expected.action==='capture'?{jobId:expected.jobId,attemptId:expected.attemptId!}:undefined;
    const options=expected.settlementProtocol===3&&expected.resolutionKind!==undefined?{resolution:{kind:expected.resolutionKind,evidenceSha256:expected.evidenceSha256!}}:expected.settlementProtocol===3&&expected.capturedSeconds!==undefined?{capturedSeconds:expected.capturedSeconds}:undefined;
    ack=await this.accountBilling.settle(expected.identityKey,expected.reservationId,expected.action,expected.seconds,claim,options);
    if(await this.backend.markExternalBillingSettled(expected,settlementSnapshot)){settled++;continue;}
    const q=await this.backend.quarantineExternalBillingOutbox(row.id,{phase:'after_ack',snapshotVersion:row.snapshotVersion,expected,ack,settlementSnapshot});
    if(q.state!=='already_settled')failed++;
   }catch(error){
    failed++;
    if(ack&&expected&&typeof row.id==='string'){
     // LV-019.B 3b (design v2): a throw from the quarantine must never be swallowed leaving the row pending with no alert. The quarantine records
     // the divergent ACK itself; if that write also fails, fall back to the durable review incident so the owner is blocked and a human sees it.
     try{await this.backend.quarantineExternalBillingOutbox(row.id,{phase:'after_ack',snapshotVersion:row.snapshotVersion,expected,ack,settlementSnapshot});}
     catch{
           // The outbox row has no requestKey; it is resolved from the job that owns the row (the same document the quarantine reads).
           const job=await this.backend.job(row.accountId,row.id).catch(()=>null);
           if(job&&typeof job.requestKey==='string')await this.backend.recordExternalBillingReview(row.accountId,job.requestKey,{provider:expected.provider,identityKey:expected.identityKey,reservationId:expected.reservationId,seconds:expected.seconds},ack).catch(()=>undefined);
          }
    }
    else if(expected&&typeof row.id==='string'&&typeof row.snapshotVersion==='string'&&['pending','retry_wait'].includes(row.state))await this.backend.recordExternalBillingFailure(row.id,error instanceof AccountBillingFault?error.code:'unavailable',{snapshotVersion:row.snapshotVersion,state:row.state,outbox:expected}).catch(()=>undefined);
   }
  }
  return control===undefined?{settled,failed,intentsRecovered,intentsFailed}:{settled,failed,intentsRecovered,intentsFailed,skippedRows,stopped,next:{intents:nextIntents,outbox:nextOutbox},traversed:{intents:intentsAttended||!stopped,outbox:outboxAttended||!stopped}};
 }
 /** A privileged account movement requires a matching durable terminal job and outbox. */
 private async validExternalBillingOutbox(row:Record<string,any>):Promise<{state:'eligible';snapshot:ExternalBillingSettlementReadSnapshot}|'already_settled'|'changed'|'invalid'|'blocked'>{
  if(!row||typeof row.id!=='string')return 'invalid';
  if(typeof row.jobId!=='string'||!privateUuid.test(row.jobId)||row.id!==row.jobId||typeof row.accountId!=='string'||!privateUuid.test(row.accountId)||typeof row.identityKey!=='string'||!/^[a-f0-9]{64}$/.test(row.identityKey)||typeof row.reservationId!=='string'||!privateUuid.test(row.reservationId)||!Number.isSafeInteger(row.seconds)||row.seconds<1||row.seconds>600||row.provider!=='account_seconds'||!['capture','release'].includes(row.action))return 'invalid';
  // LV-019.B C2a: the strict v1/v3 shape gate, so a new field without `settlementProtocol: 3` or any unexpected key is invalid (quarantined before any POST).
  // The documented metadata keys are passed explicitly; nothing else on the document is tolerated.
  if(!copyOutboxSnapshot(row,['snapshotVersion',...OUTBOX_METADATA_KEYS]))return 'invalid';
  if(typeof row.snapshotVersion!=='string'||!/^\d{1,15}:\d{9}$/.test(row.snapshotVersion))throw new AiFault('invalid');
  return this.db.runTransaction(async tx=>{
   const [account,outbox,job,terminal,artifact]=await tx.getAll(this.ref('accounts',row.accountId),this.ref('billingOutbox',row.jobId),this.ref('jobs',row.jobId),this.ref('movements','terminal:'+row.jobId),this.ref('artifacts',row.jobId));
   const j=job.data(),b=outbox.data(),t=terminal.data(),a=artifact.data(),ext=j?.externalBilling;
   const time=outbox.updateTime,version=time?`${time.seconds}:${String(time.nanoseconds).padStart(9,'0')}`:null;
   const expected=copyOutboxSnapshot(row,['snapshotVersion',...OUTBOX_METADATA_KEYS])!;
   const stored=copyOutboxSnapshot(b,OUTBOX_METADATA_KEYS),same=!!b&&!!stored&&JSON.stringify(stored)===JSON.stringify(expected);
   if(!outbox.exists||!same)return 'changed';
   if(b.state!=='settled'&&version!==row.snapshotVersion)return 'changed';
   // The current drainer has no billing lease; do not send on a row claimed elsewhere.
   if(b.state!=='settled'){
    if(['leaseToken','leaseOwner','leaseUntil'].some(field=>Object.hasOwn(b,field)))return 'changed';
    if([b.generation,b.attempts].some(value=>value!==undefined&&(!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER))||!Number.isSafeInteger(b.nextAttemptAt)||b.nextAttemptAt<0)return 'invalid';
    if(b.nextAttemptAt>Date.now())return 'changed';
   }
   if(!account.exists||!j||!t||!a||!['pending','retry_wait','settled'].includes(b.state)||j.accountId!==row.accountId||j.aiProfile!==AI_CATALOG_VERSION||j.price!==row.seconds||typeof j.requestKey!=='string'||typeof j.inputId!=='string'||!Number.isSafeInteger(j.revision)||ext?.provider!=='account_seconds'||ext.identityKey!==row.identityKey||ext.reservationId!==row.reservationId||ext.seconds!==row.seconds||a.accountId!==row.accountId||a.jobId!==row.jobId||a.inputId!==j.inputId)return 'invalid';
   if(t.accountId!==row.accountId||t.reference!==row.jobId||t.credits!==row.seconds||t.kind!=='external_'+row.action||(row.action==='capture'?j.state!=='succeeded'||j.completedAttemptId!==row.attemptId||a.attemptId!==row.attemptId:!['failed','cancelled'].includes(j.state)))return 'invalid';
   // A missing/corrupt class is not authority to make another financial call.
   if(await this.backend.jobAccounting(tx,row.jobId,j as import('./firestoreBackend').Job)!=='account_seconds')return 'blocked';
   const key=hash(JSON.stringify([row.accountId,j.requestKey]));
   const [identity,request,intent,guard,intentGuard]=await tx.getAll(this.ref('identities',row.identityKey),this.ref('requests',key),this.ref('billingIntents',key),this.ref('billingGuards',row.accountId),this.ref('billingIntentAdmissionGuards',key));
   const uid=identity.get('uid'),fingerprint=hash(JSON.stringify([j.inputId,j.operation,j.revision,AI_CATALOG_VERSION]));
   if(!identity.exists||identity.get('accountId')!==row.accountId||typeof uid!=='string'||accountIdentityKey(uid)!==row.identityKey||!request.exists||request.get('accountId')!==row.accountId||request.get('jobId')!==row.jobId||request.get('requestFingerprint')!==fingerprint||!intent.exists||intent.get('accountId')!==row.accountId||intent.get('requestKey')!==j.requestKey||intent.get('jobId')!==row.jobId||intent.get('inputId')!==j.inputId||intent.get('operation')!==j.operation||intent.get('revision')!==j.revision||intent.get('identityKey')!==row.identityKey||intent.get('reservationId')!==row.reservationId||intent.get('seconds')!==row.seconds)return 'invalid';
   if(guard.exists&&(guard.get('accountId')!==row.accountId||guard.get('blocked')!==false))return 'blocked';
   if(!validClearIntentAdmissionGuard(intentGuard,key))return 'blocked';
   if(intent.get('state')!=='job_created')return 'blocked';
   if(b.state==='settled')return 'already_settled';
   const snapshot=await this.backend.captureExternalBillingSettlement(tx,expected,key);
   return snapshot?{state:'eligible',snapshot}:'blocked';
  });
 }
 private async externalJobRunnable(accountId:string,jobId:string,attemptId:string|null,billing:import('./firestoreBackend').ExternalVideoBilling){
  return this.db.runTransaction(async tx=>{
   const current=(await tx.get(this.ref('jobs',jobId))).data() as import('./firestoreBackend').Job|undefined;
   if(!current||current.accountId!==accountId||current.state!=='running'||current.attemptId!==attemptId||!current.leaseUntil||current.leaseUntil<=Date.now()||!current.externalBilling||current.externalBilling.provider!==billing.provider||current.externalBilling.identityKey!==billing.identityKey||current.externalBilling.reservationId!==billing.reservationId||current.externalBilling.seconds!==billing.seconds)return false;
   return this.backend.externalJobAdmissionAllowed(tx,jobId,current);
  });
 }
 async assertExternalReservation(job:import('./firestoreBackend').Job,jobId:string){
  if(!job.externalBilling)return;
  if(!this.accountBilling)throw new AiFault('disabled');id(jobId);
  const billing={...job.externalBilling},accountId=job.accountId,attemptId=job.attemptId;
  if(!await this.externalJobRunnable(accountId,jobId,attemptId,billing))throw new AiFault('conflict');
  let row:any;try{row=await this.accountBilling.status(billing.identityKey,billing.reservationId);}catch{throw new AiFault('unknown');}
  if(row?.state!=='reserved'||row?.seconds!==billing.seconds||!await this.externalJobRunnable(accountId,jobId,attemptId,billing))throw new AiFault('conflict');
 }
 async accountBalance(uid:string){
  if(!this.accountBilling)return null;return this.accountBilling.balance(accountIdentityKey(uid));
 }
 async status(accountId:string,jobId:string,uid:string){
  id(accountId);id(jobId);
  return this.db.runTransaction(async tx=>{
   const {job,artifact,input,accounting,billingSettled,captureSettled}=await this.resultContext(tx,accountId,jobId,uid),project=(await tx.get(this.ref('projects',job.inputId))).data();
   const resultAllowed=accounting==='simulation'||accounting==='account_seconds'&&await this.backend.externalJobResultAllowed(tx,jobId,job as import('./firestoreBackend').Job),billingReview=!resultAllowed||narrationRequiresReview(job.operation)&&['queued','running','unknown'].includes(job.state);
   const manifest=resultAllowed?this.availableManifest(accountId,job,artifact,input,captureSettled):null;
   return {id:jobId,inputId:job.inputId,state:job.state,revision:job.revision,operation:job.operation,units:job.price,billing:accounting==='account_seconds'?{mode:'account_seconds' as const,unit:'video_seconds' as const}:accounting==='simulation'?AI_BILLING_PROFILE:{mode:'unverified' as const},billingState:billingReview?'review':accounting==='account_seconds'?(billingSettled?'settled':'pending'):'simulated',stale:!!project&&project.revision!==job.revision,results:manifest?manifest.map(x=>({name:x.name,mimeType:x.mimeType,size:x.size,sha256:x.sha256})):[]};
  });
 }
 async download(accountId:string,jobId:string,name:string,uid:string){
  id(accountId);id(jobId);
  return this.db.runTransaction(async tx=>{
   const {job,artifact,input,accounting,captureSettled}=await this.resultContext(tx,accountId,jobId,uid);
   if(accounting==='unverified'||accounting==='account_seconds'&&!await this.backend.externalJobResultAllowed(tx,jobId,job as import('./firestoreBackend').Job))throw new AiFault('not_found');
   const manifest=this.availableManifest(accountId,job,artifact,input,captureSettled),entry=manifest?.find(x=>x.name===name);if(!entry)throw new AiFault('not_found');
   return {entry,revision:job.revision,object:{key:entry.key,generation:entry.generation,size:entry.size} as CloudObject};
  });
 }
 /** The account grant and result binding share one authorization transaction.
  * A revocation committed before that authorization denies the request. Bytes
  * already authorized or downloaded cannot be withdrawn by a later revocation. */
 private async resultContext(tx:Transaction,accountId:string,jobId:string,uid:string){
  if(typeof uid!=='string'||!uid||uid.length>128)throw new AiFault('not_found');
  const identityKey=accountIdentityKey(uid);
  const [account,j,a,identity]=await tx.getAll(this.ref('accounts',accountId),this.ref('jobs',jobId),this.ref('artifacts',jobId),this.ref('identities',identityKey));
  if(!identity.exists||identity.get('uid')!==uid||identity.get('accountId')!==accountId)throw new AiFault('not_found');
  if(account.get('aiPilot')!==true||account.get('simulationOnly')!==true)throw new AiFault('disabled');
  const job=j.data(),artifact=a.data();
  if(!job||!artifact||job.accountId!==accountId||artifact.accountId!==accountId||job.aiProfile!==AI_CATALOG_VERSION||typeof job.inputId!=='string'||!privateUuid.test(job.inputId)||artifact.jobId!==jobId||artifact.inputId!==job.inputId||artifact.revision!==job.revision)throw new AiFault('not_found');
  const accounting=await this.backend.jobAccounting(tx,jobId,job as import('./firestoreBackend').Job);
  const [inputDoc,billing,terminal]=await tx.getAll(this.ref('inputs',job.inputId),this.ref('billingOutbox',jobId),this.ref('movements','terminal:'+jobId)),input=inputDoc.data();
  const action=billing?.get('action'),external=job.externalBilling;
  const settled=accounting==='account_seconds'&&billing.get('state')==='settled'&&billing.get('jobId')===jobId&&billing.get('accountId')===accountId&&external?.provider==='account_seconds'&&billing.get('provider')===external.provider&&billing.get('identityKey')===external.identityKey&&billing.get('reservationId')===external.reservationId&&billing.get('seconds')===external.seconds&&external.seconds===job.price&&terminal.get('accountId')===accountId&&terminal.get('reference')===jobId&&terminal.get('credits')===external.seconds&&terminal.get('kind')==='external_'+action&&(action==='capture'?typeof job.completedAttemptId==='string'&&privateUuid.test(job.completedAttemptId)&&billing.get('attemptId')===job.completedAttemptId&&artifact.attemptId===job.completedAttemptId:action==='release'&&billing.get('attemptId')===undefined);
  const simulatedCapture=accounting==='simulation'&&terminal.exists&&terminal.get('accountId')===accountId&&terminal.get('reference')===jobId&&terminal.get('credits')===job.price&&terminal.get('kind')==='capture';
  const captureSettled=simulatedCapture||settled&&action==='capture';
  const billingSettled=accounting==='simulation'?simulatedCapture:settled&&(job.state==='succeeded'&&action==='capture'||['failed','cancelled'].includes(job.state)&&action==='release');
  return {job,artifact,input,accounting,billingSettled,captureSettled};
 }
 private availableManifest(accountId:string,job:any,artifact:any,input:any,billingSettled:boolean){
  if(!billingSettled||job.state!=='succeeded'||artifact.state!=='ready'||!input||input.accountId!==accountId||input.deleted||!Number.isFinite(input.expiresAtMs)||input.expiresAtMs<=Date.now()||!readyPrivateInput(input,job.inputId)||input.storage.generation!==artifact.sourceGeneration||input.sha256!==artifact.inputSha256||input.storage.generation!==job.inputStorage?.generation||input.sha256!==job.inputSha256)return null;
  const plan=validateArtifactPlan(artifact.plan);
  if(plan.jobId!==artifact.jobId||plan.inputId!==job.inputId||plan.operation!==job.operation||artifact.planHash!==artifactPlanHash(plan))throw new AiFault('not_found');
  return validateArtifactManifest(plan,artifact.entries);
 }
 async uploadResults(accountId:string,jobId:string,attemptId:string,buffers:ReadonlyMap<string,Buffer>){
  id(accountId);id(jobId);id(attemptId);if(!this.objects.putArtifactOnce)throw new AiFault('disabled');
  // Fix size and hash synchronously, before any transaction can yield. Do not
  // retain full copies of all outputs; each put receives its own copy below.
  if(!buffers||!Number.isSafeInteger(buffers.size)||buffers.size<1||buffers.size>5)throw new AiFault('invalid');
  const fingerprints=new Map<string,{size:number;sha256:string}>();let total=0;
  for(const [name,bytes] of buffers){
   if(typeof name!=='string'||fingerprints.has(name)||fingerprints.size>=5||!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>AI_VOICE_BUDGET)throw new AiFault('invalid');
   total+=bytes.length;if(total>AI_VOICE_BUDGET)throw new AiFault('invalid');fingerprints.set(name,{size:bytes.length,sha256:hash(bytes)});
  }
  if(fingerprints.size!==buffers.size)throw new AiFault('invalid');
  // Before the first irreversible object write, bind the worker attempt, owner,
  // input and actual job to the stored plan in one Firestore transaction. A
  // later change cannot cancel a put already in flight; stageArtifactReceipt
  // rechecks the durable context after the writes.
  const readUploadPlan=()=>this.db.runTransaction(async tx=>{
   const [j,a,account]=await tx.getAll(this.ref('jobs',jobId),this.ref('artifacts',jobId),this.ref('accounts',accountId));
   const job=j.data(),artifact=a.data();
   if(!job||!artifact||!account.exists||job.accountId!==accountId||artifact.accountId!==accountId||artifact.jobId!==jobId||
      typeof job.inputId!=='string'||!privateUuid.test(job.inputId)||artifact.inputId!==job.inputId)throw new AiFault('not_found');
   if(narrationRequiresReview(job.operation))throw new AiFault('disabled');
   if(account.get('aiPilot')!==true||account.get('simulationOnly')!==true)throw new AiFault('disabled');
   if(job.aiProfile!==AI_CATALOG_VERSION||job.state!=='running'||job.attemptId!==attemptId||job.invocationPhase!=='invoking'||
      !Number.isSafeInteger(job.leaseUntil)||job.leaseUntil<=Date.now()||artifact.state!=='pending'||
      !Number.isSafeInteger(artifact.expiresAtMs)||artifact.expiresAtMs<=Date.now())throw new AiFault('conflict');
   const trusted=validateArtifactPlan(artifact.plan);
   if(trusted.jobId!==jobId||trusted.inputId!==job.inputId||trusted.operation!==job.operation||artifact.planHash!==artifactPlanHash(trusted)||
      artifact.revision!==job.revision||artifact.snapshotSha256!==job.snapshotSha256||typeof job.snapshot?.draft!=='string'||
      hash(job.snapshot.draft)!==job.snapshotSha256||artifact.quotaMode!=='reserved'||artifact.quotaHeld!==trusted.budgetBytes)throw new AiFault('conflict');
   const input=(await tx.get(this.ref('inputs',job.inputId))).data();
   if(!input||input.accountId!==accountId||input.deleted!==false||!Number.isSafeInteger(input.expiresAtMs)||input.expiresAtMs<=Date.now()||
      input.unknownCount!==0||!readyPrivateInput(input,job.inputId)||!job.inputStorage||
      ['bucket','key','generation','size','sha256'].some(key=>input.storage[key]!==job.inputStorage[key])||
      input.sha256!==job.inputSha256||artifact.inputSha256!==job.inputSha256||artifact.sourceGeneration!==input.storage.generation)throw new AiFault('conflict');
   // A coherent accounting label alone is not an authorization: an external
   // owner or guard may have changed while the provider was running.
   if(!await this.backend.externalJobAdmissionAllowed(tx,jobId,job as import('./firestoreBackend').Job))throw new AiFault('conflict');
   return trusted;
  });
  const plan=await readUploadPlan();
  const entries:AiArtifactReceipt[]=[];if(buffers.size!==plan.artifacts.length||fingerprints.size!==plan.artifacts.length)throw new AiFault('conflict');
  for(const spec of plan.artifacts){const original=fingerprints.get(spec.name),current=buffers.get(spec.name);
   if(!original||original.size>spec.maxBytes)throw new AiFault('invalid');
   if(!Buffer.isBuffer(current)||current.length!==original.size||hash(current)!==original.sha256)throw new AiFault('conflict');
  }
  if(total>plan.budgetBytes)throw new AiFault('invalid');
  for(const spec of plan.artifacts){
   // The prior put may have taken time. A changed owner, input, attempt or
   // plan cannot authorize the next object, even if an earlier put finished.
   const current=await readUploadPlan();if(artifactPlanHash(current)!==artifactPlanHash(plan))throw new AiFault('conflict');
   const source=buffers.get(spec.name),fingerprint=fingerprints.get(spec.name)!;
   if(buffers.size!==plan.artifacts.length||!Buffer.isBuffer(source)||source.length!==fingerprint.size)throw new AiFault('conflict');
   const bytes=Buffer.from(source);if(hash(bytes)!==fingerprint.sha256)throw new AiFault('conflict');
   const object=await this.objects.putArtifactOnce(spec.key,bytes);entries.push({name:spec.name,key:spec.key,mimeType:spec.mimeType,generation:object.generation,size:object.size,sha256:fingerprint.sha256});
  }
  const manifest=validateArtifactManifest(plan,entries);if(!await this.backend.stageArtifactReceipt(accountId,jobId,attemptId,manifest))throw new AiFault('conflict');return manifest;
 }
 /** Durable BEFORE each paid request. Ambiguity never creates another attempt/call. */
 invoke(accountId:string,jobId:string,attemptId:string,apiKey:string){
  return async(callKey:string,model:string,body:object,signal:AbortSignal):Promise<any>=>{
   if(typeof callKey!=='string'||!/^(text-window|voice-chunk):\d{4}(?![\s\S])/.test(callKey)||!['gemini-3.8-flash','gemini-3.8-flash-tts'].includes(model))throw new AiFault('invalid');
   const serialized=JSON.stringify(body),requestSha256=hash(serialized),call=this.ref('providerCalls',jobId+'-'+callKey.replace(':','-'));
    const billing=await this.db.runTransaction(async tx=>{const [j,p,c,a]=await tx.getAll(this.ref('jobs',jobId),this.ref('artifacts',jobId),call,this.ref('accounts',accountId));const job=j.data(),plan=p.data();
     if(a.get('aiPilot')!==true||a.get('simulationOnly')!==true)throw new AiFault('disabled');
    if(!job||job.accountId!==accountId||job.state!=='running'||job.invocationPhase!=='invoking'||job.attemptId!==attemptId||job.leaseUntil<=Date.now()||!plan||plan.state!=='pending'||plan.planHash!==artifactPlanHash(plan.plan))throw new AiFault('conflict');
    if(!await this.backend.externalJobAdmissionAllowed(tx,jobId,job as import('./firestoreBackend').Job))throw new AiFault('conflict');
    const input=(await tx.get(this.ref('inputs',job.inputId))).data();if(!input||input.deleted||input.expiresAtMs<=Date.now()||input.unknownCount!==0||!readyPrivateInput(input,job.inputId)||input.storage.generation!==job.inputStorage?.generation)throw new AiFault('conflict');
     const voice=job.operation==='narration:en:female'||job.operation==='narration:en:male',duration=(input as {metadata?:{duration?:number}}).metadata?.duration;
     if((!voice&&job.operation!=='translation:en')||!job.snapshot||(!voice&&(!Number.isFinite(duration)||duration!<=0||duration!*1000>AI_TEXT_MAX_DURATION_MS)))throw new AiFault('conflict');
     const count=voice?narrationChunks(job.snapshot.draft).length:Math.ceil(Math.floor(duration!*1000)/AI_TEXT_WINDOW_MS),ordinal=Number(callKey.slice(callKey.indexOf(':')+1));
     if(count<1||count>1000||ordinal>=count||!callKey.startsWith(voice?'voice-chunk:':'text-window:')||model!==(voice?VOICE_MODEL:textModel))throw new AiFault('invalid');
    if(c.exists)throw new AiFault('unknown');tx.create(call,{jobId,accountId,attemptId,callKey,model,requestSha256,state:'intent',startedAtMs:Date.now()});return job.externalBilling??null;
   });
   signal.throwIfAborted();
   if(billing){
    if(!this.accountBilling)throw new AiFault('disabled');
    const receipt=await this.accountBilling.admit(billing.identityKey,billing.reservationId,billing.seconds,jobId,attemptId,callKey,model,requestSha256);
    if(!receipt.created||receipt.receiptOnly)throw new AiFault('unknown');
    // A hold that appears while Account is processing cannot revoke the admit;
    // recheck locally before a new provider request and leave that admission for reconciliation.
    if(!await this.externalJobRunnable(accountId,jobId,attemptId,billing))throw new AiFault('conflict');
   }
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
