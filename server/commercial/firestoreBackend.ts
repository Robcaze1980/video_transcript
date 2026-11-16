import { createHash, randomUUID } from 'node:crypto';
import {diagnosticStage,diagnosticTransaction,diagnosticMark} from './cloudDiagnostics';
import { Firestore, FieldPath, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import {readyPrivateInput,type PrivateInputBinding} from './privateObjectPlan';
import {narrationChunks,VOICE_MODEL} from './pipelineVoiceProvider';
import {textModel} from './pipelineTextProvider';
import {AI_CATALOG_VERSION,AI_TEXT_WINDOW_MS,AI_TEXT_MAX_DURATION_MS,AI_TEXT_MAX_WINDOWS,artifactPlan,artifactPlanHash,simulatedAiPrice,storageQuota,validateArtifactManifest,type AiArtifactPlan,type AiArtifactReceipt} from './aiContracts';
import {validateDigitalSilenceProof,digitalSilenceProofHash} from './digitalSilence';

// Server-only persistence for the cloud candidate; the public application remains separate.
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type State = 'queued' | 'running' | 'unknown' | 'succeeded' | 'failed' | 'cancelled';
type Balance = { credited: number; available: number; reserved: number; consumed: number; active: number };
export type ProjectSnapshot = {accountId: string; inputId: string; revision: number; draft: string; updatedAtMs: number};
export type Job = { aiProfile?:typeof AI_CATALOG_VERSION;snapshotSha256?:string; accountId: string; inputId: string; price: number; state: State; inputSha256: string;
  operation: string; revision: number | null; snapshot: ProjectSnapshot | null;
  inputStorage: PrivateInputBinding | null;
  attemptId: string | null; leaseUntil: number | null; unknownAttemptId: string | null; requestKey: string;
  invocationPhase: 'not_started' | 'local_check' | 'invoking' | null;
  quarantinedAtMs?: number; reconciliationRef?: string | null };
type Input = { accountId: string; expiresAtMs: number; sha256: string; deleted: boolean; unknownCount: number;
  ready?: boolean; storage?: PrivateInputBinding; metadata?:{duration:number;audioTracks?:number} };
export class LedgerFault extends Error {
  constructor(readonly code: 'invalid' | 'conflict' | 'not_found' | 'insufficient' | 'invariant') { super(code); }
}
function integer(value: number, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new LedgerFault('invalid');
}
function identifier(value: string) { if (typeof value !== 'string' || !uuid.test(value)) throw new LedgerFault('invalid'); }
function text(value: string) { if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new LedgerFault('invalid'); }
function balance(value: Balance): Balance {
  for (const field of ['credited','available','reserved','consumed','active'] as const) integer(value[field]);
  if (value.credited !== value.available + value.reserved + value.consumed) throw new LedgerFault('invariant');
  return {credited:value.credited,available:value.available,reserved:value.reserved,consumed:value.consumed,active:value.active};
}
export type AiArtifactRecord={accountId:string;inputId:string;jobId:string;plan:AiArtifactPlan;planHash:string;sourceGeneration:string;inputSha256:string;revision:number;snapshotSha256:string;expiresAtMs:number;state:'pending'|'staged'|'ready'|'purging'|'purged';quotaMode:'reserved'|'committed'|'none';quotaHeld:number;entries:AiArtifactReceipt[];attemptId:string|null;nextAttemptAt:number;callReceiptHash?:string|null;callKeys?:string[]};
const draftSha=(draft:string)=>createHash('sha256').update(draft).digest('hex');
const requestFingerprint=(inputId:string,operation:string,revision:number|null,profile?:typeof AI_CATALOG_VERSION)=>hash(profile?[inputId,operation,revision,profile]:[inputId,operation,revision]);
interface Context { accountRef: DocumentReference; jobRef: DocumentReference; inputRef: DocumentReference;
  terminalRef: DocumentReference; account: Balance; job: Job; input: Input; terminalExists: boolean;rawAccountData:Record<string,unknown>;artifactRef?:DocumentReference;artifact?:AiArtifactRecord;providerReceipts?:Array<{id:string;data:Record<string,unknown>}> }

export class FirestoreBackend {
  private readonly unverifiedTestInputs:boolean;
  constructor(private readonly db: Firestore, private readonly root: DocumentReference,
    options:{allowUnverifiedInputsForTests?:true}={}) {
    this.unverifiedTestInputs=options.allowUnverifiedInputsForTests===true;
    if(this.unverifiedTestInputs&&(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185'||
      !/^vistavo_(backend_test|transport_test|grpc_control)\/[a-f0-9-]{36}$/.test(root.path)))throw new LedgerFault('invalid');
  }
  private usable(input:Input,inputId:string,job?:Job){
    return !input.deleted&&input.expiresAtMs>Date.now()&&
      (this.unverifiedTestInputs||readyPrivateInput(input,inputId))&&(!job||input.sha256===job.inputSha256&&
        (this.unverifiedTestInputs||input.storage?.generation===job.inputStorage?.generation));
  }
  private ref(collection: string, id: string) { return this.root.collection(collection).doc(id); }
  /** uid comes exclusively from a verified Firebase identity, never the request body. */
  async accountForUid(uid: string) {
    if (typeof uid !== 'string' || !uid || uid.length > 128) throw new LedgerFault('invalid');
    const accountId = randomUUID(), identity = this.ref('identities', hash(['firebase', uid]));
    return diagnosticTransaction('identity',this.db,async tx => {
      const prior = await diagnosticStage('identity.read',()=>tx.get(identity));
      if (prior.exists) return prior.get('accountId') as string;
      tx.create(identity, { accountId, uid });
      tx.create(this.ref('accounts', accountId), { credited: 0, available: 0, reserved: 0, consumed: 0, active: 0 });
      return accountId;
    });
  }
  async saveProject(accountId: string, inputId: string, expectedRevision: number, draft: string) {
    identifier(accountId); identifier(inputId); integer(expectedRevision);
    if (typeof draft !== 'string' || Buffer.byteLength(draft) > 65536) throw new LedgerFault('invalid');
    return this.db.runTransaction(async tx => {
      const input = await tx.get(this.ref('inputs', inputId));
      const projectRef = this.ref('projects', inputId), previous = await tx.get(projectRef);
      if (!input.exists || input.get('accountId') !== accountId || input.get('deleted') || input.get('expiresAtMs') <= Date.now()) throw new LedgerFault('not_found');
      const revision = previous.exists ? previous.get('revision') as number : 0;
      if (revision !== expectedRevision) throw new LedgerFault('conflict');
      const nextRevision = revision + 1; integer(nextRevision, true);
      const project = { accountId, inputId, revision: nextRevision, draft, updatedAtMs: Date.now() };
      tx.set(projectRef, project); return project;
    });
  }
  async readProject(accountId: string, inputId: string) {
    identifier(accountId); identifier(inputId);
    return diagnosticTransaction('project',this.db,async tx => {
      const [input, project] = await diagnosticStage('project.read',()=>tx.getAll(this.ref('inputs', inputId), this.ref('projects', inputId)));
      if (!input.exists || input.get('accountId') !== accountId || input.get('deleted') || input.get('expiresAtMs') <= Date.now() || !project.exists || project.get('accountId') !== accountId) throw new LedgerFault('not_found');
      return project.data()!;
    });
  }
  async priorRequest(accountId: string, inputId: string, requestKey: string, operation: string, expectedRevision: number,aiProfile?:typeof AI_CATALOG_VERSION) {
    if(aiProfile!==undefined&&aiProfile!==AI_CATALOG_VERSION)throw new LedgerFault('invalid');
    identifier(accountId); identifier(inputId); text(requestKey); text(operation); integer(expectedRevision,true);
    const prior = await diagnosticStage('request.lookup',()=>this.ref('requests',hash([accountId,requestKey])).get());
    if (!prior.exists) return null;
    if (prior.get('requestFingerprint') !== requestFingerprint(inputId,operation,expectedRevision,aiProfile)) throw new LedgerFault('conflict');
    return prior.get('jobId') as string;
  }
  async createAccount() {
    const id = randomUUID();
    await this.ref('accounts', id).create({ credited: 0, available: 0, reserved: 0, consumed: 0, active: 0 });
    return id;
  }
  async readBalance(accountId: string) {
    identifier(accountId); const doc = await this.ref('accounts', accountId).get();
    if (!doc.exists) throw new LedgerFault('not_found');
    return balance(doc.data() as Balance);
  }
  /** Caller must have verified the provider capture. No provider IO occurs here. */
  async creditVerifiedPurchase(accountId: string, captureId: string, credits: number, amountCents: number, merchantId: string, environment: 'sandbox' | 'live') {
    identifier(accountId); text(captureId); text(merchantId); integer(credits, true); integer(amountCents, true);
    if (!['sandbox', 'live'].includes(environment)) throw new LedgerFault('invalid');
    const receiptId = hash(['paypal:' + environment, captureId]);
    const fingerprint = hash([accountId, captureId, credits, amountCents, 'usd', merchantId]);
    return this.db.runTransaction(async tx => {
      const a = this.ref('accounts', accountId), p = this.ref('purchases', receiptId), m = this.ref('movements', 'credit:' + receiptId);
      const [account, prior, movement] = await tx.getAll(a, p, m);
      if (!account.exists) throw new LedgerFault('not_found');
      if (prior.exists) { if (prior.get('fingerprint') !== fingerprint) throw new LedgerFault('conflict'); return false; }
      if (movement.exists) throw new LedgerFault('invariant');
      const current = balance(account.data() as Balance);
      const next = balance({ ...current, available: current.available + credits, credited: current.credited + credits });
      tx.update(a, next); tx.create(p, { accountId, fingerprint, captureId, credits, amountCents, currency: 'usd', merchantId });
      tx.create(m, { accountId, kind: 'credit', credits, reference: receiptId }); return true;
    });
  }
  async addInput(accountId: string, expiresAtMs: number, sha256: string) {
    if(!this.unverifiedTestInputs)throw new LedgerFault('invalid');
    identifier(accountId); integer(expiresAtMs, true);
    if (expiresAtMs <= Date.now() || !/^[a-f0-9]{64}$/.test(sha256)) throw new LedgerFault('invalid');
    const id = randomUUID();
    await this.db.runTransaction(async tx => {
      if (!(await tx.get(this.ref('accounts', accountId))).exists) throw new LedgerFault('not_found');
      tx.create(this.ref('inputs', id), { accountId, expiresAtMs, sha256, deleted: false, unknownCount: 0 });
    }); return id;
  }
  async reserve(accountId: string, inputId: string, requestKey: string, price: number, operation: string,
    expectedRevision?: number,aiProfile?:typeof AI_CATALOG_VERSION) {
    if(aiProfile!==undefined&&aiProfile!==AI_CATALOG_VERSION)throw new LedgerFault('invalid');
    if(aiProfile&&expectedRevision===undefined)throw new LedgerFault('invalid');
    identifier(accountId); identifier(inputId); text(requestKey); text(operation); integer(price, true);
    if (expectedRevision !== undefined) integer(expectedRevision, true);
    const jobId = randomUUID(), requestId = hash([accountId, requestKey]);
    const fingerprint = hash([inputId, price, operation, expectedRevision ?? null]);
    return diagnosticTransaction('reserve',this.db,async tx => {
      const a = this.ref('accounts', accountId), i = this.ref('inputs', inputId), r = this.ref('requests', requestId);
      const [account, input, prior, project] = await diagnosticStage('reserve.read',()=>tx.getAll(a, i, r, this.ref('projects', inputId)));
      if (!account.exists || !input.exists || input.get('accountId') !== accountId) throw new LedgerFault('not_found');
      if(aiProfile&&(account.get('aiPilot')!==true||account.get('simulationOnly')!==true))throw new LedgerFault('conflict');
      if (prior.exists) { if (prior.get('requestFingerprint') !== requestFingerprint(inputId,operation,expectedRevision??null,aiProfile)) throw new LedgerFault('conflict'); return prior.get('jobId') as string; }
      if (expectedRevision !== undefined && (!project.exists || project.get('accountId') !== accountId || project.get('revision') !== expectedRevision)) throw new LedgerFault('conflict');
      const asset = input.data() as Input;
      if (!this.usable(asset,inputId)) throw new LedgerFault('not_found');
      if (asset.unknownCount > 0) throw new LedgerFault('conflict');
      const current = balance(account.data() as Balance);
      const plan=aiProfile?artifactPlan(jobId,inputId,operation as any):undefined;
      if(aiProfile){
        if(!asset.metadata||price!==simulatedAiPrice(operation as any,asset.metadata.duration))throw new LedgerFault('invalid');
        if(operation.startsWith('narration:')&&(typeof project.get('draft')!=='string'||!project.get('draft').trim()))throw new LedgerFault('invalid');
      }
      const quota=plan?storageQuota(account.data(),plan.budgetBytes,0):undefined;
      if (current.available < price) throw new LedgerFault('insufficient');
      if (current.active >= 3) throw new LedgerFault('conflict');
      const next = balance({ ...current, available: current.available - price, reserved: current.reserved + price, active: current.active + 1 });
      const job: Job = { accountId, inputId, price, operation, revision: expectedRevision ?? null,...(aiProfile?{aiProfile,snapshotSha256:draftSha(project.get('draft'))}:{}),
        inputStorage: asset.storage??null,
        snapshot: expectedRevision === undefined ? null : project.data() as ProjectSnapshot,
        state: 'queued', inputSha256: asset.sha256,
        attemptId: null, leaseUntil: null, unknownAttemptId: null, requestKey, invocationPhase: null };
      tx.update(a, {...next,...quota}); tx.create(r, { accountId, fingerprint, requestFingerprint: requestFingerprint(inputId,operation,expectedRevision ?? null,aiProfile), jobId }); tx.create(this.ref('jobs', jobId), job);
      if(plan)tx.create(this.ref('artifacts',jobId),{accountId,inputId,jobId,plan,planHash:artifactPlanHash(plan),sourceGeneration:asset.storage!.generation,inputSha256:asset.sha256,revision:expectedRevision!,snapshotSha256:draftSha(project.get('draft')),expiresAtMs:asset.expiresAtMs,state:'pending',quotaMode:'reserved',quotaHeld:plan.budgetBytes,entries:[],attemptId:null,nextAttemptAt:Date.now()} satisfies AiArtifactRecord);
      tx.create(this.ref('outbox', jobId), {accountId, jobId, ...(aiProfile?{aiProfile}:{}), state: 'pending', nextAttemptAt: Date.now(), dispatchAttempt: null, leaseUntil: null});
      tx.create(this.ref('movements', 'reserve:' + jobId), { accountId, kind: 'reserve', credits: price, reference: jobId });
      diagnosticMark('reserve.writes_staged');
      return jobId;
    });
  }
  private async context(tx: Transaction, accountId: string, jobId: string,loadProviderReceipts:boolean|'text'=false): Promise<Context> {
    identifier(accountId); identifier(jobId);
    const accountRef = this.ref('accounts', accountId), jobRef = this.ref('jobs', jobId);
    // Every money-changing operation acquires the account before other records.
    const [account, jobDoc] = await tx.getAll(accountRef, jobRef);
    if (!jobDoc.exists || jobDoc.get('accountId') !== accountId) throw new LedgerFault('not_found');
    const job = jobDoc.data() as Job;
    const inputRef = this.ref('inputs', job.inputId), terminalRef = this.ref('movements', 'terminal:' + jobId);
    const [input, terminal, artifactDoc] = await tx.getAll(inputRef, terminalRef,...(job.aiProfile?[this.ref('artifacts',jobId)]:[]));
    if (!account.exists || !input.exists || input.get('accountId') !== accountId) throw new LedgerFault('not_found');
    const asset = input.data() as Input; integer(asset.unknownCount); integer(job.price, true);
    const artifact=artifactDoc?.data() as AiArtifactRecord|undefined;
    if(job.aiProfile){if(job.aiProfile!==AI_CATALOG_VERSION||!artifact||artifact.accountId!==accountId||artifact.inputId!==job.inputId||artifact.jobId!==jobId||artifact.planHash!==artifactPlanHash(artifact.plan)||artifact.plan.jobId!==jobId||artifact.plan.inputId!==job.inputId||artifact.plan.operation!==job.operation||artifact.sourceGeneration!==job.inputStorage?.generation||artifact.inputSha256!==job.inputSha256||artifact.revision!==job.revision||artifact.snapshotSha256!==job.snapshotSha256||(job.snapshot!==null&&artifact.snapshotSha256!==draftSha(job.snapshot.draft)))throw new LedgerFault('invariant');}
    const calls=job.aiProfile&&(loadProviderReceipts===true||loadProviderReceipts==='text'&&job.operation==='translation:en')?await tx.get(this.root.collection('providerCalls').where('jobId','==',jobId)):undefined;
    return { accountRef, jobRef, inputRef, terminalRef, account: balance(account.data() as Balance),rawAccountData:account.data()!,...(calls?{providerReceipts:calls.docs.map(doc=>({id:doc.id,data:doc.data()}))}:{}),
      job, input: asset, terminalExists: terminal.exists,...(artifact?{artifactRef:this.ref('artifacts',jobId),artifact}:{}) };
  }
  private aiInvocationEnabled(c:Context){return !c.artifact||(c.rawAccountData.aiPilot===true&&c.rawAccountData.simulationOnly===true&&c.artifact.state==='pending'&&c.artifact.quotaMode==='reserved'&&c.artifact.quotaHeld===c.artifact.plan.budgetBytes);}
  private verifiedProviderReceipt(c:Context){
    if(!c.artifact||!c.providerReceipts||!c.job.snapshot)throw new LedgerFault('conflict');
    const voice=c.job.operation.startsWith('narration:'),duration=c.input.metadata?.duration;
    if(!voice&&(!Number.isFinite(duration)||duration!<=0||duration!>AI_TEXT_MAX_DURATION_MS/1000))throw new LedgerFault('conflict');
    const count=voice?narrationChunks(c.job.snapshot.draft).length:Math.ceil(Math.floor(duration!*1000)/AI_TEXT_WINDOW_MS);
    if(count<1||count>1000||c.providerReceipts.length!==count)throw new LedgerFault('conflict');
    const expected=Array.from({length:count},(_,i)=>(voice?'voice-chunk:':'text-window:')+String(i).padStart(4,'0'));
    const model=voice?VOICE_MODEL:textModel,attemptId=c.job.attemptId??c.job.unknownAttemptId??(c.job.state==='succeeded'&&c.artifact.state==='ready'?c.artifact.attemptId:null);
    const sorted=c.providerReceipts.map(row=>({...row.data,id:row.id} as Record<string,unknown>&{id:string})).sort((a,b)=>String(a.callKey).localeCompare(String(b.callKey)));
    const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical((value as Record<string,unknown>)[k])])):value;
    for(let index=0;index<sorted.length;index++){
      const call=sorted[index],usage=call.usage;
      if(call.id!==c.jobRef.id+'-'+expected[index].replace(':','-')||call.callKey!==expected[index]||call.jobId!==c.jobRef.id||call.accountId!==c.job.accountId||call.attemptId!==attemptId||call.model!==model||call.state!=='received'||call.httpStatus!==200||
        typeof call.requestSha256!=='string'||!/^[a-f0-9]{64}$/.test(call.requestSha256)||typeof call.responseSha256!=='string'||!/^[a-f0-9]{64}$/.test(call.responseSha256)||
        !(call.responseId===null||typeof call.responseId==='string'&&call.responseId.length>0&&call.responseId.length<=200)||!usage||typeof usage!=='object'||Array.isArray(usage)||Object.values(usage).some(v=>!Number.isSafeInteger(v)||Number(v)<0))throw new LedgerFault('conflict');
    }
    return {keys:expected,hash:hash(canonical(sorted.map(call=>[call.callKey,call.requestSha256,call.responseSha256,call.responseId,call.usage])))};
  }
  private publishableManifest(c:Context){
    const a=c.artifact;if(!a||a.state!=='staged'||!a.attemptId||a.attemptId!==(c.job.attemptId??c.job.unknownAttemptId))throw new LedgerFault('invariant');
    const receipt=this.verifiedProviderReceipt(c);if(a.callReceiptHash!==receipt.hash||JSON.stringify(a.callKeys)!==JSON.stringify(receipt.keys))throw new LedgerFault('conflict');
    return validateArtifactManifest(a.plan,a.entries);
  }
  /** Trusted worker receipt only: object bytes/hash/generation are verified before calling this method. */
  async stageArtifactReceipt(accountId:string,jobId:string,attemptId:string,entries:readonly AiArtifactReceipt[]){
    identifier(attemptId);return this.db.runTransaction(async tx=>{
      const c=await this.context(tx,accountId,jobId,true);if(!c.artifact)throw new LedgerFault('invalid');
      const normalized=validateArtifactManifest(c.artifact.plan,entries);
      if(c.rawAccountData.aiPilot!==true||c.rawAccountData.simulationOnly!==true){if(c.job.state==='running'&&c.job.attemptId===attemptId&&c.job.invocationPhase==='invoking')this.unknown(tx,c);return false;}
      const replayReady=c.job.state==='succeeded'&&c.artifact.state==='ready'&&c.artifact.attemptId===attemptId;
      if(!replayReady&&(c.job.state!=='running'||c.job.attemptId!==attemptId||c.job.invocationPhase!=='invoking'||!c.job.leaseUntil||c.job.leaseUntil<=Date.now()||!this.usable(c.input,c.job.inputId,c.job)||c.input.unknownCount>0||c.artifact.expiresAtMs<=Date.now()||!['pending','staged'].includes(c.artifact.state)))return false;
      const receipt=this.verifiedProviderReceipt(c);
      if(replayReady){if(c.artifact.callReceiptHash===receipt.hash&&hash(normalized)===hash(validateArtifactManifest(c.artifact.plan,c.artifact.entries)))return true;throw new LedgerFault('conflict');}
      if(c.artifact.state==='staged'){if(c.artifact.attemptId!==attemptId||c.artifact.callReceiptHash!==receipt.hash||hash(normalized)!==hash(validateArtifactManifest(c.artifact.plan,c.artifact.entries)))throw new LedgerFault('conflict');return true;}
      tx.update(c.artifactRef!,{state:'staged',entries:normalized,attemptId,callReceiptHash:receipt.hash,callKeys:receipt.keys});return true;
    });
  }
  /** No provider call was admitted. Releases money while physical output quota awaits barrier cleanup. */
  async failBeforeInvocation(accountId:string,jobId:string,attemptId:string){
    identifier(attemptId);return this.db.runTransaction(async tx=>{const c=await this.context(tx,accountId,jobId,'text');
      if(c.job.state!=='running'||c.job.attemptId!==attemptId||c.job.invocationPhase!=='not_started')return false;
      if(this.textAi(c)&&!this.cleanPendingPreprovider(c)){this.preproviderUnknown(tx,c);return false;}
      this.settle(tx,c,'failed');return true;});
  }
  private textAi(c:Context){return !!c.job.aiProfile&&c.job.operation==='translation:en';}
  private cleanPendingPreprovider(c:Context){
    const a=c.artifact;
    return !!c.providerReceipts&&c.providerReceipts.length===0&&!c.terminalExists&&!!a&&a.state==='pending'&&a.entries.length===0&&a.attemptId===null&&
      !Object.hasOwn(a,'callReceiptHash')&&!Object.hasOwn(a,'callKeys')&&a.quotaMode==='reserved'&&a.quotaHeld===a.plan.budgetBytes;
  }
  private preproviderUnknown(tx:Transaction,c:Context){
    this.unknown(tx,c);tx.update(this.ref('outbox',c.jobRef.id),{state:'sent',leaseUntil:null});
  }
  private sameDigitalSource(c:Context,binding:PrivateInputBinding){
    const source=c.job.inputStorage,current=c.input.storage;
    return !!source&&!!current&&['bucket','key','generation','size','sha256'].every(key=>source[key as keyof PrivateInputBinding]===binding[key as keyof PrivateInputBinding]&&current[key as keyof PrivateInputBinding]===binding[key as keyof PrivateInputBinding])&&binding.sha256===c.job.inputSha256;
  }
  private localTextCurrent(c:Context,attemptId:string){
    return this.textAi(c)&&c.job.state==='running'&&c.job.attemptId===attemptId&&c.job.invocationPhase==='local_check';
  }
  private localTextFences(c:Context){
    return !!c.job.leaseUntil&&c.job.leaseUntil>Date.now()&&this.usable(c.input,c.job.inputId,c.job)&&c.input.unknownCount===0&&this.aiInvocationEnabled(c)&&!!c.artifact&&c.artifact.expiresAtMs>Date.now()&&this.cleanPendingPreprovider(c);
  }
  /** Only confirmed nonzero/multiple-track inspection may leave the durable local fence. */
  async resumeTextAfterLocalCheck(accountId:string,jobId:string,attemptId:string,binding:PrivateInputBinding,decision:'nonzero'|'multiple_audio_tracks'){
    identifier(attemptId);if(decision!=='nonzero'&&decision!=='multiple_audio_tracks')throw new LedgerFault('invalid');
    return this.db.runTransaction(async tx=>{
      const c=await this.context(tx,accountId,jobId,true);if(!this.localTextCurrent(c,attemptId))return false;
      const tracks=c.input.metadata?.audioTracks,coherent=decision==='nonzero'?tracks===1:Number.isInteger(tracks)&&tracks!>1;
      if(!this.localTextFences(c)||!this.sameDigitalSource(c,binding)||!coherent){this.preproviderUnknown(tx,c);return false;}
      tx.update(c.jobRef,{invocationPhase:'not_started'});return true;
    });
  }
  /** A worker-only certificate; never a customer assertion or generic technical refund. */
  async completeDigitalSilence(accountId:string,jobId:string,attemptId:string,value:unknown){
    identifier(attemptId);const proof=validateDigitalSilenceProof(value),proofHash=digitalSilenceProofHash(proof);
    return this.db.runTransaction(async tx=>{
      const c=await this.context(tx,accountId,jobId,true);if(!this.localTextCurrent(c,attemptId))return false;
      const binding:PrivateInputBinding={bucket:proof.sourceBucket,key:proof.sourceKey,generation:proof.sourceGeneration,size:proof.sourceSize,sha256:proof.sourceSha256};
      if(!this.localTextFences(c)||!this.sameDigitalSource(c,binding)||c.input.metadata?.audioTracks!==1){this.preproviderUnknown(tx,c);return false;}
      this.settle(tx,c,'failed','digital-zero:'+proofHash);
      tx.update(c.jobRef,{failureCode:'no_speech',noSpeechSubtype:'digital_zero',digitalSilenceProof:proof,digitalSilenceProofHash:proofHash,digitalSilenceAttemptId:attemptId});return true;
    });
  }
  /** ACK recovery confirms the full terminal proof and release together, never just failed. */
  async confirmedDigitalSilence(accountId:string,jobId:string,attemptId:string,value:unknown){
    identifier(attemptId);const proof=validateDigitalSilenceProof(value),proofHash=digitalSilenceProofHash(proof);
    return this.db.runTransaction(async tx=>{
      const c=await this.context(tx,accountId,jobId,true),data=(await tx.get(c.jobRef)).data()!,movement=await tx.get(c.terminalRef);
      let durableHash;try{durableHash=digitalSilenceProofHash(data.digitalSilenceProof);}catch{return false;}
      if(c.job.state!=='failed'||data.failureCode!=='no_speech'||data.noSpeechSubtype!=='digital_zero'||data.digitalSilenceAttemptId!==attemptId||data.digitalSilenceProofHash!==proofHash||durableHash!==proofHash||data.reconciliationRef!=='digital-zero:'+proofHash||!c.providerReceipts||c.providerReceipts.length!==0)return false;
      const binding:PrivateInputBinding={bucket:proof.sourceBucket,key:proof.sourceKey,generation:proof.sourceGeneration,size:proof.sourceSize,sha256:proof.sourceSha256};
      return this.sameDigitalSource(c,binding)&&!!c.artifact&&['purging','purged'].includes(c.artifact.state)&&c.artifact.entries.length===0&&c.artifact.attemptId===null&&!Object.hasOwn(c.artifact,'callReceiptHash')&&!Object.hasOwn(c.artifact,'callKeys')&&movement.exists&&movement.get('accountId')===accountId&&movement.get('reference')===jobId&&movement.get('credits')===c.job.price&&movement.get('kind')==='release';
    });
  }
  private settle(tx: Transaction, c: Context, state: 'succeeded' | 'failed' | 'cancelled', evidence: string | null = null) {
    if (c.terminalExists) throw new LedgerFault('invariant');
    const capture = state === 'succeeded', price = c.job.price;
    let quota:ReturnType<typeof storageQuota>|undefined;
    if(c.artifact){
      if(capture){const entries=this.publishableManifest(c);const bytes=entries.reduce((n,e)=>n+e.size,0);if(c.artifact.quotaMode!=='reserved'||c.artifact.quotaHeld!==c.artifact.plan.budgetBytes)throw new LedgerFault('invariant');quota=storageQuota(c.rawAccountData,-c.artifact.quotaHeld,bytes);}
      else if(c.artifact.state!=='purged')tx.update(c.artifactRef!,{state:'purging',nextAttemptAt:Date.now()});
    }
    const next = balance({ ...c.account, reserved: c.account.reserved - price,
      available: c.account.available + (capture ? 0 : price), consumed: c.account.consumed + (capture ? price : 0), active: c.account.active - 1 });
    const unknownCount = c.input.unknownCount - (c.job.state === 'unknown' ? 1 : 0); integer(unknownCount);
    tx.update(c.accountRef, {...next,...quota});
    if(c.artifact&&capture)tx.update(c.artifactRef!,{state:'ready',quotaMode:'committed',quotaHeld:c.artifact.entries.reduce((n,e)=>n+e.size,0),nextAttemptAt:Date.now()});
    tx.update(c.jobRef, { state, attemptId: null, leaseUntil: null, reconciliationRef: evidence });
    tx.update(c.inputRef, { unknownCount });
    tx.update(this.ref('outbox', c.jobRef.id), {state: 'sent', leaseUntil: null});
    tx.create(c.terminalRef, { accountId: c.job.accountId, reference: c.jobRef.id, credits: price, kind: capture ? 'capture' : 'release' });
  }
  private unknown(tx: Transaction, c: Context) {
    integer(c.input.unknownCount + 1);
    tx.update(c.jobRef, { state: 'unknown', unknownAttemptId: c.job.attemptId, quarantinedAtMs: Date.now(), attemptId: null, leaseUntil: null });
    tx.update(c.inputRef, { unknownCount: c.input.unknownCount + 1 });
    if(c.artifact&&c.artifact.state!=='purged')tx.update(c.artifactRef!,{state:'purging',nextAttemptAt:Date.now()});
  }
  async claim(accountId: string, jobId: string) {
    const attemptId = randomUUID();
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,'text');
      if (c.job.state !== 'queued') return null;
      if(this.textAi(c)&&!this.cleanPendingPreprovider(c)){this.preproviderUnknown(tx,c);return null;}
      if (!this.usable(c.input,c.job.inputId,c.job)||!this.aiInvocationEnabled(c)) { this.settle(tx, c, 'failed'); return null; }
      if (c.input.unknownCount > 0) return null;
      const leaseUntil = Date.now() + 30_000;
      tx.update(c.jobRef, { state: 'running', attemptId, leaseUntil, invocationPhase: this.textAi(c)?'local_check':'not_started' });
      tx.update(this.ref('outbox', jobId), {state: 'sent', leaseUntil: null});
      return { attemptId, leaseUntil };
    });
  }
  /** Durable permission to invoke. A lost acknowledgement requires inspection, never a new attempt. */
  async beginInvocation(accountId: string, jobId: string, attemptId: string) {
    identifier(attemptId);
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,'text');
      if (c.job.state !== 'running' || c.job.attemptId !== attemptId || c.job.invocationPhase !== 'not_started' ||
          !c.job.leaseUntil || c.job.leaseUntil <= Date.now()) return false;
      if(this.textAi(c)&&!this.cleanPendingPreprovider(c)){this.preproviderUnknown(tx,c);return false;}
      if (!this.usable(c.input,c.job.inputId,c.job)||!this.aiInvocationEnabled(c)) {this.settle(tx,c,'failed');return false;}
      if (c.input.unknownCount > 0) {this.unknown(tx,c);return false;}
      tx.update(c.jobRef,{invocationPhase:'invoking'});return true;
    });
  }
  async heartbeat(accountId: string, jobId: string, attemptId: string) {
    identifier(attemptId);
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,'text');
      if (c.job.state !== 'running' || c.job.attemptId !== attemptId) return false;
      if(this.textAi(c)&&c.job.invocationPhase!=='invoking'){
        if(!this.cleanPendingPreprovider(c)){this.preproviderUnknown(tx,c);return false;}
        if(c.job.invocationPhase==='local_check'&&(!c.job.leaseUntil||c.job.leaseUntil<=Date.now()||!this.usable(c.input,c.job.inputId,c.job)||c.input.unknownCount>0||!this.aiInvocationEnabled(c))){this.preproviderUnknown(tx,c);return false;}
      }
      if (!c.job.leaseUntil || c.job.leaseUntil <= Date.now()) {if(c.artifact&&c.job.invocationPhase==='not_started')this.requeueBeforeInvocation(tx,c);else this.unknown(tx,c);return false;}
      if (!this.usable(c.input,c.job.inputId,c.job) || c.input.unknownCount > 0 || c.artifact&&(c.rawAccountData.aiPilot!==true||c.rawAccountData.simulationOnly!==true)) {if(c.artifact&&c.job.invocationPhase==='not_started')this.settle(tx,c,'failed');else this.unknown(tx, c);return false;}
      tx.update(c.jobRef, { leaseUntil: Date.now() + 30_000 }); return true;
    });
  }
  private requeueBeforeInvocation(tx:Transaction,c:Context){
    tx.update(c.jobRef,{state:'queued',attemptId:null,leaseUntil:null,invocationPhase:null});
    tx.update(this.ref('outbox',c.jobRef.id),{state:'pending',nextAttemptAt:Date.now(),leaseUntil:null,dispatchAttempt:null});
  }
  /** Recovery does not replay a provider whose running lease expired. */
  async recover(accountId: string, jobId: string) {
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,'text');
      if (c.job.state !== 'running' || (c.job.leaseUntil !== null && c.job.leaseUntil > Date.now())) return false;
      if(this.textAi(c)&&c.job.invocationPhase!=='invoking'&&(c.job.invocationPhase==='local_check'||!this.cleanPendingPreprovider(c))){this.preproviderUnknown(tx,c);return true;}
      if (c.job.invocationPhase === 'not_started') {
        this.requeueBeforeInvocation(tx,c);
        return true;
      }
      this.unknown(tx, c); return true;
    });
  }
  /** Dispatcher claims are independent from provider attempt fencing. */
  async claimDispatch(jobId: string) {
    identifier(jobId); const attempt = randomUUID();
    const result=await this.db.runTransaction(async tx => {
      const ref=this.ref('outbox',jobId),[doc,job]=await tx.getAll(ref,this.ref('jobs',jobId));
      if(!doc.exists||doc.get('state')==='sent'||doc.get('nextAttemptAt')>Date.now()||doc.get('leaseUntil')>Date.now())return null;
      const ownAi=doc.get('aiProfile')===AI_CATALOG_VERSION,defer=()=>tx.update(ref,{nextAttemptAt:Date.now()+300000,leaseUntil:null,dispatchAttempt:null});
      if(!job.exists||job.get('accountId')!==doc.get('accountId')||ownAi&&job.get('aiProfile')!==AI_CATALOG_VERSION){if(ownAi){defer();return 'invalid' as const;}return null;}
      if(job.get('state')!=='queued'){if(ownAi)defer();return null;}
      if(job.get('aiProfile')===AI_CATALOG_VERSION){
        if(!ownAi)return null;
        const [input,account]=await tx.getAll(this.ref('inputs',job.get('inputId')),this.ref('accounts',job.get('accountId')));
        if(!input.exists||input.get('accountId')!==job.get('accountId')||!account.exists){defer();return 'invalid' as const;}
        if(input.get('unknownCount')>0||account.get('aiPilot')!==true||account.get('simulationOnly')!==true){defer();return null;}
      }
      const until=Date.now()+30000;tx.update(ref,{dispatchAttempt:attempt,leaseUntil:until,nextAttemptAt:until});
      return {jobId,accountId:doc.get('accountId') as string,dispatchAttempt:attempt};
    });
    if(result==='invalid')throw new LedgerFault('invariant'); // After commit: do not roll back durable deferral.
    return result;
  }

  async acknowledgeDispatch(jobId: string, attempt: string) {
    identifier(jobId); identifier(attempt);
    return this.db.runTransaction(async tx => {
      const ref = this.ref('outbox', jobId), doc = await tx.get(ref);
      if (!doc.exists || doc.get('state') === 'sent' || doc.get('dispatchAttempt') !== attempt || doc.get('leaseUntil') <= Date.now()) return false;
      // Transport acceptance is not proof the worker started. Redeliver until claim.
      tx.update(ref, {leaseUntil: null, nextAttemptAt: Date.now() + 60_000}); return true;
    });
  }
  async pendingDispatches(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new LedgerFault('invalid');
    const docs = await this.root.collection('outbox').where('state', '==', 'pending')
      .where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt').limit(limit).get();
    return docs.docs.filter(doc => doc.get('nextAttemptAt') <= Date.now() && !(doc.get('leaseUntil') > Date.now())).map(doc => doc.id);
  }
  /** Select this worker before LIMIT so another profile can never occupy its page. */
  async pendingAiDispatches(limit=30){
    if(!Number.isSafeInteger(limit)||limit<1||limit>30)throw new LedgerFault('invalid');
    const docs=await this.root.collection('outbox').where('aiProfile','==',AI_CATALOG_VERSION).where('state','==','pending')
      .where('nextAttemptAt','<=',Date.now()).orderBy('nextAttemptAt').limit(limit).get();
    return docs.docs.filter(doc=>!(doc.get('leaseUntil')>Date.now())).map(doc=>doc.id);
  }
  /** Operator migration only: annotate an already-pending, verified AI row; never create or claim work. */
  async backfillAiDispatchProfile(jobId:string){
    identifier(jobId);return this.db.runTransaction(async tx=>{
      const ref=this.ref('outbox',jobId),[outbox,job]=await tx.getAll(ref,this.ref('jobs',jobId));
      if(!outbox.exists||outbox.get('state')!=='pending')return false;
      if(outbox.get('aiProfile')!==undefined){if(outbox.get('aiProfile')!==AI_CATALOG_VERSION&&job.exists&&job.get('aiProfile')===AI_CATALOG_VERSION)throw new LedgerFault('invariant');return false;}
      if(outbox.get('jobId')!==jobId||!job.exists)throw new LedgerFault('invariant');
      if(job.get('aiProfile')!==AI_CATALOG_VERSION)return false; // A known foreign/legacy worker is never annotated.
      if(job.get('accountId')!==outbox.get('accountId')||!['queued','running','unknown','succeeded','failed','cancelled'].includes(job.get('state')))throw new LedgerFault('invariant');
      const [account,input]=await tx.getAll(this.ref('accounts',job.get('accountId')),this.ref('inputs',job.get('inputId')));
      if(!account.exists||!input.exists||input.get('accountId')!==job.get('accountId'))throw new LedgerFault('invariant');
      // Classification does not grant permission: disabled accounts remain blocked at dispatch and paid fences.
      tx.update(ref,{aiProfile:AI_CATALOG_VERSION});return true;
    });
  }

  /** Read eligibility and durably defer known blocked work, without changing its Job or money. */
  async aiDispatchEligible(jobId:string){
    identifier(jobId);const result=await this.db.runTransaction(async tx=>{
      const ref=this.ref('outbox',jobId),[outbox,job]=await tx.getAll(ref,this.ref('jobs',jobId));
      if(!outbox.exists||outbox.get('state')!=='pending'||outbox.get('aiProfile')!==AI_CATALOG_VERSION||outbox.get('nextAttemptAt')>Date.now()||outbox.get('leaseUntil')>Date.now())return 'deferred' as const;
      const defer=()=>tx.update(ref,{nextAttemptAt:Date.now()+300000,leaseUntil:null,dispatchAttempt:null});
      if(!job.exists||job.get('aiProfile')!==AI_CATALOG_VERSION||job.get('accountId')!==outbox.get('accountId')){defer();return 'invalid' as const;}
      if(job.get('state')!=='queued'){defer();return 'deferred' as const;}
      const [input,account]=await tx.getAll(this.ref('inputs',job.get('inputId')),this.ref('accounts',job.get('accountId')));
      if(!input.exists||input.get('accountId')!==job.get('accountId')||!account.exists){defer();return 'invalid' as const;}
      if(input.get('unknownCount')>0||account.get('aiPilot')!==true||account.get('simulationOnly')!==true){defer();return 'deferred' as const;}
      return 'eligible' as const;
    });
    if(result==='invalid')throw new LedgerFault('invariant'); // Report only after the deferral was committed.
    return result==='eligible';
  }

  async recoverExpiredLeasesReport(limit=50){
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new LedgerFault('invalid');
    // Rotating trusted cursor changes no Job lease/deadline/money, even for malformed rows.
    const cursorRef=this.root.collection('maintenanceCursors').doc('expiredJobRecovery'),cursorSnapshot=await cursorRef.get(),cursor=cursorSnapshot.data();
    const opaqueId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&!value.includes('/')&&Buffer.byteLength(value,'utf8')<=1500;
    const validCursor=cursor?.kind==='expired-job-recovery-v1'&&typeof cursor.leaseUntil==='number'&&Number.isFinite(cursor.leaseUntil)&&opaqueId(cursor.jobId);
    if(cursorSnapshot.exists&&!validCursor)throw new LedgerFault('invariant');
    const base=this.root.collection('jobs').where('state','==','running').where('leaseUntil','<=',Date.now()).orderBy('leaseUntil').orderBy(FieldPath.documentId());
    // Query exceptions intentionally propagate unchanged. At most two bounded queries/wrap.
    const first=await (validCursor?base.startAfter(cursor.leaseUntil,cursor.jobId):base).limit(limit).get();
    const rows=[...first.docs];
    if(validCursor&&rows.length<limit){const wrapped=await base.endAt(cursor.leaseUntil,cursor.jobId).limit(limit-rows.length).get();rows.push(...wrapped.docs);}
    const report={scanned:rows.length,recovered:0,failures:[] as {jobId:string|null;stage:'recover';code:number|'UNCLASSIFIED'|'INVALID_ID'}[]};
    for(const doc of rows){
      if(!uuid.test(doc.id)){report.failures.push({jobId:null,stage:'recover',code:'INVALID_ID'});continue;}
      try{if(await this.recover(doc.get('accountId'),doc.id))report.recovered++;}catch(error){const raw=(error as {code?:unknown})?.code;report.failures.push({jobId:doc.id,stage:'recover',code:typeof raw==='number'&&Number.isSafeInteger(raw)?raw:'UNCLASSIFIED'});}
    }
    const last=rows.at(-1);if(last){
      const leaseUntil=last.get('leaseUntil');if(typeof leaseUntil!=='number'||!Number.isFinite(leaseUntil)||!opaqueId(last.id))throw new LedgerFault('invariant');
      await this.db.runTransaction(async tx=>{
        const current=await tx.get(cursorRef);
        if(current.exists!==cursorSnapshot.exists||current.exists&&!current.updateTime?.isEqual(cursorSnapshot.updateTime!))return;
        tx.set(cursorRef,{kind:'expired-job-recovery-v1',leaseUntil,jobId:last.id,updatedAtMs:Date.now()});
      });
    }
    return report;
  }

  async recoverExpiredLeases(limit=50){
    const report=await this.recoverExpiredLeasesReport(limit);
    if(report.failures.length){const error=new LedgerFault('invariant');Object.assign(error,{recoveryReport:report});throw error;}
    return report.recovered;
  }

  async quarantine(accountId: string, jobId: string, attemptId: string) {
    identifier(attemptId);
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId);
      if (c.job.state !== 'running' || c.job.attemptId !== attemptId) return false;
      if(c.job.invocationPhase==='local_check'||this.textAi(c)&&c.job.invocationPhase==='not_started'){this.preproviderUnknown(tx,c);return true;}
      if(c.job.invocationPhase!=='invoking')return false;
      this.unknown(tx, c); return true;
    });
  }
  /** Trusted worker decoder evidence only; no HTTP route exposes this terminal release. */
  async completeNoSpeech(accountId:string,jobId:string,attemptId:string,proof:readonly {readonly callKey:string;readonly responseSha256:string}[]){
    identifier(attemptId);
    if(!Array.isArray(proof)||proof.length<1||proof.length>AI_TEXT_MAX_WINDOWS)throw new LedgerFault('invalid');
    const validatedProof:{callKey:string;responseSha256:string}[]=[];
    for(let index=0;index<proof.length;index++){
      const row=proof[index];if(!Object.hasOwn(proof,index)||!row||Object.keys(row).sort().join(',')!=='callKey,responseSha256'||
        typeof row.callKey!=='string'||!/^text-window:\d{4}$/.test(row.callKey)||typeof row.responseSha256!=='string'||!/^[a-f0-9]{64}$/.test(row.responseSha256))throw new LedgerFault('invalid');
      validatedProof.push({callKey:row.callKey,responseSha256:row.responseSha256});
    }
    return this.db.runTransaction(async tx=>{
      const c=await this.context(tx,accountId,jobId,true);
      if(c.job.state!=='running'||c.job.attemptId!==attemptId||c.job.invocationPhase!=='invoking')return false;
      if(!c.artifact||c.job.operation!=='translation:en'||c.artifact.state!=='pending'||c.artifact.entries.length!==0||
        c.artifact.quotaMode!=='reserved'||c.artifact.quotaHeld!==c.artifact.plan.budgetBytes)throw new LedgerFault('conflict');
      // Invalid/expired fences do not refund. The worker retains UNKNOWN if this release is refused or the SDK outcome stays unconfirmed.
      if(!c.job.leaseUntil||c.job.leaseUntil<=Date.now()||!this.usable(c.input,c.job.inputId,c.job)||c.input.unknownCount!==0||
        c.rawAccountData.aiPilot!==true||c.rawAccountData.simulationOnly!==true||c.artifact.expiresAtMs<=Date.now())return false;
      const receipt=this.verifiedProviderReceipt(c);
      if(validatedProof.length!==receipt.keys.length||validatedProof.some((row,index)=>row.callKey!==receipt.keys[index]||
        row.responseSha256!==c.providerReceipts!.find(call=>call.data.callKey===row.callKey)?.data.responseSha256))throw new LedgerFault('conflict');
      this.settle(tx,c,'failed','no-speech:'+hash(validatedProof));
      tx.update(c.jobRef,{failureCode:'no_speech',noSpeechReceiptHash:receipt.hash});
      return true;
    });
  }
  async finish(accountId: string, jobId: string, attemptId: string, success: boolean) {
    identifier(attemptId); if (typeof success !== 'boolean') throw new LedgerFault('invalid');
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,true);
      if (c.job.state !== 'running' || c.job.attemptId !== attemptId) return false;
      if (c.job.invocationPhase !== 'invoking') return false;
      if (c.input.unknownCount > 0) {this.unknown(tx,c);return false;}
      if (!c.job.leaseUntil || c.job.leaseUntil <= Date.now()) { this.unknown(tx, c); return false; }
      if(c.artifact){
        if(!success||!this.usable(c.input,c.job.inputId,c.job)||c.rawAccountData.aiPilot!==true||c.rawAccountData.simulationOnly!==true){this.unknown(tx,c);return false;}
        try{this.publishableManifest(c);}catch{this.unknown(tx,c);return false;}
        this.settle(tx,c,'succeeded');return true;
      }
      this.settle(tx, c, success && this.usable(c.input,c.job.inputId,c.job) ? 'succeeded' : 'failed'); return true;
    });
  }
  async cancel(accountId: string, jobId: string) {
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,'text');
      if(this.textAi(c)&&(c.job.state==='queued'||c.job.state==='running'&&c.job.invocationPhase!=='invoking')){
        if(c.job.invocationPhase==='local_check'||!this.cleanPendingPreprovider(c)){this.preproviderUnknown(tx,c);return true;}
      }
      if (c.job.state === 'queued') { this.settle(tx, c, 'cancelled'); return true; }
      if (c.job.state === 'running') {
        if (c.job.invocationPhase === 'not_started') this.settle(tx,c,'cancelled');
        else this.unknown(tx, c);
        return true;
      }
      return false;
    });
  }
  /** Trusted reconciliation only. Never expose as a customer mutation. */
  async reconcile(accountId: string, jobId: string, outcome: 'failed' | 'succeeded', evidence: string) {
    if (!['failed','succeeded'].includes(outcome) || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 500) throw new LedgerFault('invalid');
    return this.db.runTransaction(async tx => {
      const c = await this.context(tx, accountId, jobId,outcome==='succeeded'?true:'text');
      if (c.job.state !== 'unknown') return false;
      if(this.textAi(c)&&c.job.invocationPhase!=='invoking'){
        const a=c.artifact;
        if(outcome!=='failed'||!c.providerReceipts||c.providerReceipts.length||c.terminalExists||!a||!['pending','purging','purged'].includes(a.state)||a.entries.length||a.attemptId!==null||Object.hasOwn(a,'callReceiptHash')||Object.hasOwn(a,'callKeys'))throw new LedgerFault('conflict');
      }
      // AI success recovery is allowed only via staged re-read before UNKNOWN/purge, never resurrection afterward.
      if(c.artifact&&outcome==='succeeded')throw new LedgerFault('conflict');
      this.settle(tx, c, outcome === 'succeeded' && this.usable(c.input,c.job.inputId,c.job) ? 'succeeded' : 'failed', evidence); return true;
    });
  }
  async job(accountId: string, jobId: string) {
    identifier(accountId); identifier(jobId); const doc = await this.ref('jobs', jobId).get();
    if (!doc.exists || doc.get('accountId') !== accountId) throw new LedgerFault('not_found'); return doc.data() as Job;
  }
}
