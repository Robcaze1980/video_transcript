import {createHash,randomUUID} from 'node:crypto';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {FieldPath,getFirestore,type DocumentReference,type DocumentSnapshot,type Firestore} from 'firebase-admin/firestore';

/**
 * Preparation only. No CLI, scheduler, reader switch or production mode.
 * A scan result can be invalidated by a late observer. A real cutover must retire
 * legacy writers, drain all executors, reconcile incidents and re-read both barriers.
 */
export type BillingMigrationTarget='billingIntents'|'billingOutbox';
export type BillingMigrationPhase='backfill'|'verify';
type Status='scanning'|'blocked'|'scan_complete';
type Reason='invalid_id'|'invalid_state'|'invalid_next_attempt'|'missing_next_attempt'|'invalid_attempts'|'invalid_last_attempt'|'invalid_backoff'|'selected_row_missing'|'selected_row_replaced'|'selected_row_identity_unknown';
type Block={kind:'data';issueId:string;docIdHash:string;reason:Reason}|{kind:'page_failure'};
type Barrier={kind:'billing-next-attempt-barrier-v1';target:BillingMigrationTarget;blocked:true;firstIssueId:string;docIdHash:string;reason:Reason;createdAtMs:number};
type Checkpoint={kind:'billing-next-attempt-v1';target:BillingMigrationTarget;phase:BillingMigrationPhase;epoch:number;cursor:string|null;sequence:number;scanned:number;modified:number;status:Status;block?:Block;startedAtMs:number;updatedAtMs:number};
type Classification={kind:'unchanged'}|{kind:'update';nextAttemptAt:number}|{kind:'invalid';reason:Reason};
type Hooks={beforePageRead?:()=>Promise<void>;afterPageRead?:()=>Promise<void>};
export type BillingMigrationReport={target:BillingMigrationTarget;phase:BillingMigrationPhase;epoch:number;status:Status|'stale';scanned:number;modified:number;issue?:{reason:Reason;docIdHash:string};writerGate:'unverified';readerEnabled:false};

export class BillingMigrationFault extends Error{constructor(readonly code:'emulator_boundary'|'invalid'|'checkpoint_invalid'|'backfill_incomplete'|'verification_not_complete'|'review_required'|'page_failed'|'row_failed'|'report_failed'){super(code);}}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const documentId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value!=='.'&&value!=='..'&&!value.includes('/')&&Buffer.byteLength(value,'utf8')<=1500;
const issueReasons:Reason[]=['invalid_id','invalid_state','invalid_next_attempt','missing_next_attempt','invalid_attempts','invalid_last_attempt','invalid_backoff','selected_row_missing','selected_row_replaced','selected_row_identity_unknown'];
const targetStates={billingIntents:{active:['reserve_pending','release_pending'],terminal:['job_created','insufficient','closed','needs_review']},billingOutbox:{active:['pending','retry_wait'],terminal:['settled','needs_review']}} as const;
const maxBackoffMs=15*60_000;

function inputs(target:BillingMigrationTarget,phase:BillingMigrationPhase,limit:number){
 if(!Object.hasOwn(targetStates,target)||!['backfill','verify'].includes(phase)||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new BillingMigrationFault('invalid');
}
function validCheckpoint(doc:DocumentSnapshot,target:BillingMigrationTarget,phase:BillingMigrationPhase):Checkpoint{
 const value=doc.data() as Checkpoint|undefined;
 if(!doc.exists||!value||value.kind!=='billing-next-attempt-v1'||value.target!==target||value.phase!==phase||!count(value.epoch)||value.epoch<1||!(value.cursor===null||documentId(value.cursor))||!count(value.sequence)||!count(value.scanned)||!count(value.modified)||value.modified>value.scanned||!count(value.startedAtMs)||!count(value.updatedAtMs)||!['scanning','blocked','scan_complete'].includes(value.status))throw new BillingMigrationFault('checkpoint_invalid');
 if(value.status==='blocked'){
  const b=value.block;if(!b||!(b.kind==='page_failure'||b.kind==='data'&&typeof b.issueId==='string'&&/^[a-f0-9]{64}(?![\s\S])/.test(b.issueId)&&typeof b.docIdHash==='string'&&/^[a-f0-9]{64}(?![\s\S])/.test(b.docIdHash)&&issueReasons.includes(b.reason)))throw new BillingMigrationFault('checkpoint_invalid');
 }else if(value.block!==undefined)throw new BillingMigrationFault('checkpoint_invalid');
 return value;
}
function validBarrier(doc:DocumentSnapshot,target:BillingMigrationTarget):Barrier|null{
 if(!doc.exists)return null;const value=doc.data() as Barrier|undefined;
 if(!value||value.kind!=='billing-next-attempt-barrier-v1'||value.target!==target||value.blocked!==true||typeof value.firstIssueId!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(value.firstIssueId)||typeof value.docIdHash!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(value.docIdHash)||!['selected_row_missing','selected_row_replaced','selected_row_identity_unknown'].includes(value.reason)||!count(value.createdAtMs))throw new BillingMigrationFault('checkpoint_invalid');
 return value;
}
function samePosition(a:Checkpoint,b:Checkpoint){
 if(a.epoch!==b.epoch||a.sequence!==b.sequence||a.cursor!==b.cursor||a.status!==b.status||a.scanned!==b.scanned||a.modified!==b.modified||a.startedAtMs!==b.startedAtMs)return false;
 if(a.status!=='blocked')return true;
 if(!a.block||!b.block||a.block.kind!==b.block.kind)return false;
 return a.block.kind==='page_failure'||b.block.kind==='data'&&a.block.issueId===b.block.issueId&&a.block.docIdHash===b.block.docIdHash&&a.block.reason===b.block.reason;
}
function classify(doc:DocumentSnapshot,target:BillingMigrationTarget,phase:BillingMigrationPhase,now:number):Classification{
 if(!documentId(doc.id))return {kind:'invalid',reason:'invalid_id'};
 const value=doc.data();if(!value||typeof value.state!=='string')return {kind:'invalid',reason:'invalid_state'};
 const states=targetStates[target],active=(states.active as readonly string[]).includes(value.state),terminal=(states.terminal as readonly string[]).includes(value.state);
 if(!active&&!terminal)return {kind:'invalid',reason:'invalid_state'};
 // Historical terminal rows are evidence: neither their state nor their scheduling fields are changed.
 if(terminal)return {kind:'unchanged'};
 if(Object.hasOwn(value,'attempts')&&!count(value.attempts))return {kind:'invalid',reason:'invalid_attempts'};
 if(Object.hasOwn(value,'lastAttemptAtMs')&&!count(value.lastAttemptAtMs))return {kind:'invalid',reason:'invalid_last_attempt'};
 if(Object.hasOwn(value,'nextAttemptAt'))return count(value.nextAttemptAt)?{kind:'unchanged'}:{kind:'invalid',reason:'invalid_next_attempt'};
 if(phase==='verify')return {kind:'invalid',reason:'missing_next_attempt'};
 const attempts=value.attempts,last=value.lastAttemptAtMs;
 let nextAttemptAt:number;
 if(count(last)&&count(attempts)&&attempts>0){
  const delay=Math.min(maxBackoffMs,1000*2**Math.min(attempts,10));nextAttemptAt=last+delay;
 }else if(attempts===0&&last===undefined)nextAttemptAt=now;
 else nextAttemptAt=Math.max(now,count(last)?last:now)+maxBackoffMs;
 return count(nextAttemptAt)?{kind:'update',nextAttemptAt}:{kind:'invalid',reason:'invalid_backoff'};
}

export class BillingNextAttemptMigration{
 private readonly app:App;private readonly db:Firestore;private readonly root:DocumentReference;
 constructor(rootId:string,private readonly options:{now?:()=>number;hooks?:Hooks}={}){
  // This class owns its client; injected clients and arbitrary roots cannot reach a real project.
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185'||typeof rootId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/.test(rootId))throw new BillingMigrationFault('emulator_boundary');
  this.app=initializeApp({projectId:'demo-vistavo-ledger'},'billing-next-attempt-emulator-'+randomUUID());this.db=getFirestore(this.app);this.root=this.db.collection('vistavo_billing_migration_test').doc(rootId);this.boundary();
 }
 private boundary(){
  const configured=this.db as unknown as {projectId?:string;_settings?:{projectId?:string;servicePath?:string;port?:number;ssl?:boolean}};
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185'||configured.projectId!=='demo-vistavo-ledger'||configured._settings?.projectId!=='demo-vistavo-ledger'||configured._settings?.servicePath!=='127.0.0.1'||configured._settings?.port!==8185||configured._settings?.ssl!==false||this.db.databaseId!=='(default)'||this.root.firestore!==this.db)throw new BillingMigrationFault('emulator_boundary');
 }
 async close(){await this.db.terminate();await deleteApp(this.app);}
 private time(){const now=(this.options.now??Date.now)();if(!count(now)||!Number.isSafeInteger(now+maxBackoffMs))throw new BillingMigrationFault('invalid');return now;}
 private checkpoint(target:BillingMigrationTarget,phase:BillingMigrationPhase){return this.root.collection('billingNextAttemptCheckpoints').doc(target+'-'+phase);}
 private barrier(target:BillingMigrationTarget){return this.root.collection('billingNextAttemptBarriers').doc(target);}
 private async open(target:BillingMigrationTarget,phase:BillingMigrationPhase){
  const checkpoint=this.checkpoint(target,phase),backfill=this.checkpoint(target,'backfill');
  return this.db.runTransaction(async tx=>{
   const [doc,barrier,prior]=await tx.getAll(checkpoint,this.barrier(target),...(phase==='verify'?[backfill]:[]));const blocked=validBarrier(barrier,target);
   if(phase==='verify'&&(!prior?.exists||validCheckpoint(prior,target,'backfill').status!=='scan_complete'))throw new BillingMigrationFault('backfill_incomplete');
   if(doc.exists)return {checkpoint:validCheckpoint(doc,target,phase),barrier:blocked};
   const now=this.time(),value:Checkpoint={kind:'billing-next-attempt-v1',target,phase,epoch:1,cursor:null,sequence:0,scanned:0,modified:0,status:'scanning',startedAtMs:now,updatedAtMs:now};tx.create(checkpoint,value);return {checkpoint:value,barrier:blocked};
  });
 }
 private report(checkpoint:Checkpoint,status:Status|'stale'=checkpoint.status,barrier:Barrier|null=null):BillingMigrationReport{
  return {target:checkpoint.target,phase:checkpoint.phase,epoch:checkpoint.epoch,status:barrier?'blocked':status,scanned:checkpoint.scanned,modified:checkpoint.modified,...(barrier?{issue:{reason:barrier.reason,docIdHash:barrier.docIdHash}}:checkpoint.block?.kind==='data'?{issue:{reason:checkpoint.block.reason,docIdHash:checkpoint.block.docIdHash}}:{}),writerGate:'unverified',readerEnabled:false};
 }
 /** A report describes one coherent read, not a promise against later writes. */
 private async finalReport(expected:Checkpoint,status:Status|'stale'=expected.status):Promise<BillingMigrationReport>{
  try{return await this.db.runTransaction(async tx=>{
   const [cursor,barrierDoc]=await tx.getAll(this.checkpoint(expected.target,expected.phase),this.barrier(expected.target));
   const current=validCheckpoint(cursor,expected.target,expected.phase),blocked=validBarrier(barrierDoc,expected.target);
   if(blocked)return this.report(current,'blocked',blocked);
   return this.report(current,samePosition(current,expected)?status:'stale');
  },{readOnly:true});}catch{await this.noteFailure(this.checkpoint(expected.target,expected.phase),expected,true);throw new BillingMigrationFault('report_failed');}
 }
 private async noteFailure(ref:DocumentReference,expected:Checkpoint,includeCompleted=false){
  try{await this.db.runTransaction(async tx=>{const [doc,barrier]=await tx.getAll(ref,this.barrier(expected.target)),current=validCheckpoint(doc,expected.target,expected.phase);if(validBarrier(barrier,expected.target)||!samePosition(current,expected)||current.status==='scan_complete'&&!includeCompleted)return;
   const now=this.time();if(current.block?.kind==='data')tx.update(ref,{lastPageFailureAtMs:now,updatedAtMs:now});else tx.update(ref,{status:'blocked',block:{kind:'page_failure'},lastPageFailureAtMs:now,updatedAtMs:now});
  });}catch{/* A database outage cannot persist a new diagnostic; the cursor is not advanced. */}
 }
 async scanPage(target:BillingMigrationTarget,phase:BillingMigrationPhase,limit=50):Promise<BillingMigrationReport>{
  this.boundary();inputs(target,phase,limit);const opened=await this.open(target,phase);let checkpoint=opened.checkpoint;if(opened.barrier)return this.finalReport(checkpoint,'blocked');
  // Reappearance of the same ID cannot prove that a deleted financial record was restored.
  if(checkpoint.status==='scan_complete'||checkpoint.block?.kind==='data'&&checkpoint.block.reason==='selected_row_missing')return this.finalReport(checkpoint);
  const checkpointRef=this.checkpoint(target,phase),collection=this.root.collection(target);let page;
  try{
   await this.options.hooks?.beforePageRead?.();const query=collection.orderBy(FieldPath.documentId());
   page=await (checkpoint.cursor===null?query:query.startAfter(checkpoint.cursor)).limit(limit).get();await this.options.hooks?.afterPageRead?.();
  }catch{await this.noteFailure(checkpointRef,checkpoint);throw new BillingMigrationFault('page_failed');}
  if(page.empty){
   if(checkpoint.block?.kind==='data')return this.finalReport(checkpoint);
   let outcome:{checkpoint:Checkpoint;status:Status|'stale'};
   try{outcome=await this.db.runTransaction(async tx=>{const [cursor,barrierDoc]=await tx.getAll(checkpointRef,this.barrier(target)),current=validCheckpoint(cursor,target,phase),blocked=validBarrier(barrierDoc,target);if(blocked)return {checkpoint:current,status:'blocked' as const};if(!samePosition(current,checkpoint))return {checkpoint:current,status:'stale' as const};
    const now=this.time(),next:Checkpoint={...current,status:'scan_complete',updatedAtMs:now};delete next.block;tx.set(checkpointRef,next);return {checkpoint:next,status:'scan_complete' as const};
   });}catch{await this.noteFailure(checkpointRef,checkpoint);throw new BillingMigrationFault('row_failed');}
   return this.finalReport(outcome.checkpoint,outcome.status);
  }
  for(const observed of page.docs){
   if(checkpoint.block?.kind==='data'&&digest(['billing-row-id',observed.id])!==checkpoint.block.docIdHash)return this.finalReport(checkpoint);
   try{
    const result=await this.db.runTransaction(async tx=>{
     const barrierRef=this.barrier(target),[cursor,row,barrierDoc]=await tx.getAll(checkpointRef,observed.ref,barrierRef),current=validCheckpoint(cursor,target,phase),existingBarrier=validBarrier(barrierDoc,target);
     const now=this.time(),docIdHash=digest(['billing-row-id',observed.id]);
     // An observation made by a stale executor is still evidence; it never changes a newer cursor or epoch.
     // Different createTime proves an observed replacement. Equality is not a proof
     // against all replacement histories or privileged writes; external gates remain required.
     const identityIssue:Reason|null=!row.exists?'selected_row_missing':!row.createTime||!observed.createTime||!row.updateTime||!observed.updateTime?'selected_row_identity_unknown':!row.createTime.isEqual(observed.createTime)?'selected_row_replaced':null;
     if(identityIssue){
      const issueId=digest(['billing-next-attempt-identity-v1',target,phase,checkpoint.epoch,docIdHash,identityIssue]),issueRef=this.root.collection('billingNextAttemptIssues').doc(issueId),issue=await tx.get(issueRef);
      if(issue.exists&&(issue.get('target')!==target||issue.get('phase')!==phase||issue.get('epoch')!==checkpoint.epoch||issue.get('docIdHash')!==docIdHash||issue.get('reason')!==identityIssue||issue.get('state')!=='open'))throw new BillingMigrationFault('checkpoint_invalid');
      const blocked:Barrier=existingBarrier??{kind:'billing-next-attempt-barrier-v1',target,blocked:true,firstIssueId:issueId,docIdHash,reason:identityIssue,createdAtMs:now};
      if(!existingBarrier)tx.create(barrierRef,blocked);
      if(!issue.exists)tx.create(issueRef,{kind:'billing-next-attempt-identity-v1',target,phase,epoch:checkpoint.epoch,currentEpoch:current.epoch,docIdHash,reason:identityIssue,state:'open',createdAtMs:now,updatedAtMs:now});
      let next=current;
      if(samePosition(current,checkpoint)&&current.status!=='scan_complete'&&current.block?.kind!=='data'){
       next={...current,status:'blocked',block:{kind:'data',issueId,docIdHash,reason:identityIssue},updatedAtMs:now};tx.set(checkpointRef,next);
      }
      return {state:'hard_blocked' as const,checkpoint:next,barrier:blocked};
     }
     if(existingBarrier)return {state:'hard_blocked' as const,checkpoint:current,barrier:existingBarrier};
     if(!samePosition(current,checkpoint))return {state:'stale' as const,checkpoint:current};
     const blockRow=async(reason:Reason)=>{
      const issueId=current.block?.kind==='data'?current.block.issueId:digest(['billing-next-attempt-issue-v1',target,phase,current.epoch,docIdHash]);
      const issueRef=this.root.collection('billingNextAttemptIssues').doc(issueId),issue=await tx.get(issueRef);
      if(issue.exists&&(issue.get('target')!==target||issue.get('phase')!==phase||issue.get('epoch')!==current.epoch||issue.get('docIdHash')!==docIdHash||issue.get('state')!=='open'))throw new BillingMigrationFault('checkpoint_invalid');
      const block:Block={kind:'data',issueId,docIdHash,reason},next:Checkpoint={...current,status:'blocked',block,updatedAtMs:now};
      if(issue.exists)tx.update(issueRef,{lastReason:reason,updatedAtMs:now});else tx.create(issueRef,{kind:'billing-next-attempt-issue-v1',target,phase,epoch:current.epoch,docIdHash,reason,state:'open',createdAtMs:now,updatedAtMs:now});
      tx.set(checkpointRef,next);return {state:'blocked' as const,checkpoint:next};
     };
     if(!row.updateTime!.isEqual(observed.updateTime!))return {state:'stale' as const,checkpoint:current};
     const decision=classify(row,target,phase,now);
     if(decision.kind==='invalid')return blockRow(decision.reason);
     let issueRef:DocumentReference|undefined;
     if(current.block?.kind==='data'){
      issueRef=this.root.collection('billingNextAttemptIssues').doc(current.block.issueId);const issue=await tx.get(issueRef);
      if(!issue.exists||issue.get('target')!==target||issue.get('phase')!==phase||issue.get('docIdHash')!==docIdHash||issue.get('state')!=='open')throw new BillingMigrationFault('checkpoint_invalid');
     }
     if(!count(current.sequence+1)||!count(current.scanned+1)||!count(current.modified+(decision.kind==='update'?1:0)))throw new BillingMigrationFault('checkpoint_invalid');
     if(decision.kind==='update')tx.update(observed.ref,{nextAttemptAt:decision.nextAttemptAt});
     if(issueRef)tx.update(issueRef,{state:'resolved',resolvedAtMs:now,updatedAtMs:now});
     const next:Checkpoint={...current,status:'scanning',cursor:row.id,sequence:current.sequence+1,scanned:current.scanned+1,modified:current.modified+(decision.kind==='update'?1:0),updatedAtMs:now};delete next.block;
     tx.set(checkpointRef,next);return {state:'advanced' as const,checkpoint:next};
    });
    checkpoint=result.checkpoint;if(result.state==='hard_blocked')return this.finalReport(checkpoint,'blocked');if(result.state==='stale')return this.finalReport(checkpoint,'stale');if(result.state==='blocked')return this.finalReport(checkpoint);
   }catch{await this.noteFailure(checkpointRef,checkpoint);throw new BillingMigrationFault('row_failed');}
  }
  return this.finalReport(checkpoint);
 }
 /** A restarted verification starts at the first ID; old executors retain the old epoch and cannot advance it. */
 async restartVerification(target:BillingMigrationTarget,expectedEpoch:number){
  this.boundary();inputs(target,'verify',1);if(!count(expectedEpoch)||expectedEpoch<1)throw new BillingMigrationFault('invalid');const checkpointRef=this.checkpoint(target,'verify');
  return this.db.runTransaction(async tx=>{const [doc,backfill,barrierDoc]=await tx.getAll(checkpointRef,this.checkpoint(target,'backfill'),this.barrier(target));
   if(validBarrier(barrierDoc,target))throw new BillingMigrationFault('review_required');
   if(!backfill.exists||validCheckpoint(backfill,target,'backfill').status!=='scan_complete')throw new BillingMigrationFault('backfill_incomplete');
   const current=validCheckpoint(doc,target,'verify');if(current.epoch!==expectedEpoch)return false;if(current.status!=='scan_complete')throw new BillingMigrationFault('verification_not_complete');
   if(!count(current.epoch+1))throw new BillingMigrationFault('checkpoint_invalid');const now=this.time();
   const next:Checkpoint={kind:'billing-next-attempt-v1',target,phase:'verify',epoch:current.epoch+1,cursor:null,sequence:0,scanned:0,modified:0,status:'scanning',startedAtMs:now,updatedAtMs:now};tx.set(checkpointRef,next);return true;
  });
 }
}
