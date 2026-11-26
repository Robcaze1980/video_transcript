/**
 * LV-019.B phase 2, piece B: a strictly read-only report of every non-terminal
 * billing row (intents, terminal recovery, hold outbox, settlement outbox, unknown
 * jobs). It never writes, never calls the Account service and never moves balance.
 * Every non-terminal row is listed (cursor over all pages), so a due row cannot be
 * hidden behind future rows the way the batched selectors can.
 * Design: docs/specs/LV-019-B-conciliacion-fase2-barrido-diseno.md
 */
import {createHash} from 'node:crypto';
import type {DocumentReference,DocumentSnapshot} from 'firebase-admin/firestore';

export type PendingKind='intent'|'terminal_recovery'|'hold'|'outbox'|'job_unknown'|'guard';
export type PendingAttention='needs_review'|'malformed'|'unknown_age'|'pending';

/** `terminalStates` lets the opt-in audit tell a finished row from an unexpected one; null = audit not supported (jobs have too many valid states). */
export interface PendingSource{kind:PendingKind;collection:string;states:readonly string[];terminalStates:readonly string[]|null;/** A single equality field for sources without a `state` (the D-4 guard); served by Firestore's automatic single-field index. */filter?:{field:string;value:string|number|boolean}}
/** Only non-terminal states are ever queried; terminal ones (settled, applied, closed...) are absent on purpose. */
export const PENDING_SOURCES:readonly PendingSource[]=Object.freeze([
  {kind:'intent',collection:'billingIntents',states:['reserve_pending','release_pending','needs_review'],terminalStates:['closed','insufficient','job_created']},
  {kind:'terminal_recovery',collection:'billingIntentTerminalRecovery',states:['pending'],terminalStates:[]},
  {kind:'hold',collection:'billingHoldOutbox',states:['pending','needs_review'],terminalStates:['applied']},
  {kind:'outbox',collection:'billingOutbox',states:['pending','retry_wait','needs_review'],terminalStates:['settled']},
  {kind:'job_unknown',collection:'jobs',states:['unknown'],terminalStates:null},
  // LV-019.B D-4: one blocked account, one alert. `blocked == true` is one equality on one field, no composite index; the row has no `state`.
  {kind:'guard',collection:'billingGuards',states:[],terminalStates:[],filter:{field:'blocked',value:true}},
]);

export interface PendingRow{kind:PendingKind;id:string;state:string;createdAtMs:number|null;nextAttemptAt:number|null;attempts:number|null;lastErrorCode:string|null;accountId:string|null;malformed:boolean}
export interface ReportRow extends PendingRow{ageMs:number|null;attention:PendingAttention}
export interface PendingReport{generatedAtMs:number;total:number;byKind:Record<PendingKind,number>;oldest:ReportRow|null;attention:ReportRow[];rows:ReportRow[]}

const nonNegativeInteger=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The only codes the writers can store (firestoreBackend.ts failure recorders coerce anything else to 'unavailable'). */
const errorCode=/^(unavailable|insufficient|conflict|invalid|quota|not_found|forbidden|reserved_unconfirmed|closure_unverified)$/;

/** Copies only what an operator needs; identity keys, uids and emails are never copied. */
export function normalizePending(kind:PendingKind,id:string,data:Record<string,unknown>|undefined):PendingRow{
  const d=data&&typeof data==='object'?data:{};
  const state=typeof d.state==='string'&&d.state?d.state:'';
  const createdAtMs=nonNegativeInteger(d.createdAtMs)?d.createdAtMs:null;
  const present=(value:unknown)=>value!==undefined&&value!==null;
  const nextAttemptAt=nonNegativeInteger(d.nextAttemptAt)?d.nextAttemptAt:null;
  const attempts=nonNegativeInteger(d.attempts)?d.attempts:null;
  const lastErrorCode=typeof d.lastErrorCode==='string'&&errorCode.test(d.lastErrorCode)?d.lastErrorCode:null;
  const accountId=typeof d.accountId==='string'&&uuid.test(d.accountId)?d.accountId:null;
  // Old intent rows may omit the provider. A supplied but unsupported value
  // is refused by the drainer, so surface the row without an account hint.
  const invalidIntentProvider=kind==='intent'&&Object.hasOwn(d,'provider')&&d.provider!=='account_seconds';
  const malformed=!data||typeof data!=='object'||!state||invalidIntentProvider||(present(d.createdAtMs)&&createdAtMs===null)||(present(d.nextAttemptAt)&&nextAttemptAt===null)||(present(d.attempts)&&attempts===null)||
    (present(d.lastErrorCode)&&lastErrorCode===null)||(present(d.accountId)&&accountId===null);
  if(kind==='guard'){
    // A blocked account is its own row. Its state carries the guard GENERATION, so an account blocked again after a release is a new
    // alert; a guard with neither incident nor hold ref cannot be attributed to anything and is malformed (the writers create incident
    // and hold in the same transaction). Since step 1.4b every writer stamps `epoch` (1, then +1 per new incident) AND `createdAtMs`,
    // and since the epoch restarts at 1 after the guard is deleted, the creation mark is part of the state: `blocked:<epoch>:<createdAtMs>`.
    // A guard written before 1.4b has NEITHER: it reads as the declared legacy generation `blocked:1:0`. An epoch or a createdAtMs that is
    // PRESENT and invalid is a malformed guard, never silently read as the legacy value.
    const hasEpoch=present(d.epoch),validEpoch=hasEpoch&&Number.isSafeInteger(d.epoch)&&(d.epoch as number)>=1,epoch=validEpoch?d.epoch as number:1;
    const hasCreated=present(d.createdAtMs),validCreated=hasCreated&&nonNegativeInteger(d.createdAtMs),createdAtMs=validCreated?d.createdAtMs as number:0;
    // billingGuards is keyed by owner. A disagreement leaves the guard visible without attributing it.
    const guardAccount=accountId===id?accountId:null,incident=present(d.lastIncidentId)||present(d.lastOutboxIncidentId);
    // The incident key is part of the state too: the epoch restarts at 1 when a released guard is recreated and the
    // creation mark can repeat within one millisecond, so the named incident is what makes a different block a different
    // alert (and a repeat sweep of the SAME incident identical). It is a public id, already visible on the guard.
    const incidentKey=typeof d.lastOutboxIncidentId==='string'?d.lastOutboxIncidentId:typeof d.lastIncidentId==='string'?d.lastIncidentId:'';
    // The guard row keeps no `createdAtMs` age of its own (the alert is raised as soon as it appears), but the mark is in its state.
    return {kind,id,state:'blocked:'+epoch+':'+createdAtMs+':'+incidentKey,createdAtMs:null,nextAttemptAt:null,attempts:null,lastErrorCode:null,accountId:guardAccount,
      malformed:!data||typeof data!=='object'||d.blocked!==true||guardAccount===null||!incident||(hasEpoch&&!validEpoch)||(hasCreated&&!validCreated)||hasEpoch!==hasCreated};
  }
  return {kind,id,state,createdAtMs,nextAttemptAt,attempts,lastErrorCode,accountId:invalidIntentProvider?null:accountId,malformed};
}

const kindOrder:Record<PendingKind,number>={intent:0,terminal_recovery:1,hold:2,outbox:3,job_unknown:4,guard:5};
function attentionOf(row:PendingRow):PendingAttention{
  if(row.malformed)return 'malformed';
  if(row.state==='needs_review'||row.state.startsWith('blocked:'))return 'needs_review';
  if(row.createdAtMs===null)return 'unknown_age';
  return 'pending';
}
/** Pure and deterministic: total order (unknown age first, then oldest, kind, id) and exact-duplicate removal. */
export function buildPendingReport(input:readonly PendingRow[],nowMs:number):PendingReport{
  if(!nonNegativeInteger(nowMs))throw new RangeError('invalid clock');
  const unique=new Map<string,PendingRow>();
  for(const row of input){const key=row.kind+'\u0000'+row.id;if(!unique.has(key))unique.set(key,row);}
  const rows:ReportRow[]=[...unique.values()].map(row=>{
    // Match the age sweep's clock boundary. A future creation time cannot
    // establish age or a billable owner. Later retry dates are still allowed.
    if(row.createdAtMs!==null&&row.createdAtMs>nowMs)
      return {...row,createdAtMs:null,ageMs:null,accountId:null,malformed:true,attention:'malformed'};
    return {...row,ageMs:row.createdAtMs===null?null:nowMs-row.createdAtMs,attention:attentionOf(row)};
  });
  rows.sort((a,b)=>{
    if((a.createdAtMs===null)!==(b.createdAtMs===null))return a.createdAtMs===null?-1:1;
    if(a.createdAtMs!==b.createdAtMs&&a.createdAtMs!==null&&b.createdAtMs!==null)return a.createdAtMs-b.createdAtMs;
    if(a.kind!==b.kind)return kindOrder[a.kind]-kindOrder[b.kind];
    return a.id<b.id?-1:a.id>b.id?1:0;
  });
  const byKind:Record<PendingKind,number>={intent:0,terminal_recovery:0,hold:0,outbox:0,job_unknown:0,guard:0};
  for(const row of rows)byKind[row.kind]++;
  return {generatedAtMs:nowMs,total:rows.length,byKind,oldest:rows.find(row=>row.createdAtMs!==null)??null,attention:rows.filter(row=>row.attention!=='pending'),rows};
}

/**
 * Exhaustive read. Default mode: one EQUALITY query per source and listed non-terminal state, paged by document id.
 * Equality + `orderBy('__name__')` is served by Firestore's automatic single-field index, so no composite index has to be
 * deployed (an `in` filter combined with that ordering is not documented as covered, so it is deliberately not used).
 * A row that changes state while the sweep is reading may be seen twice (deduplicated) or missed for this sweep only. KNOWN LIMIT: a document whose `state` is missing, not a string or not listed cannot be matched by that
 * query. `audit:true` closes that gap at the cost of reading every document of the audited collections: anything that
 * is neither a listed non-terminal state nor a known terminal one becomes a malformed row. Run it rarely.
 */
export async function readPendingReport(root:DocumentReference,nowMs:number,options:{pageSize?:number;audit?:boolean}={}):Promise<PendingReport>{
  const pageSize=options.pageSize??200;
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>500)throw new RangeError('invalid page size');
  const rows:PendingRow[]=[];
  for(const source of PENDING_SOURCES){
    const audit=options.audit===true&&source.terminalStates!==null;
    const terminal=new Set(source.terminalStates??[]),listed=new Set(source.states),filter=source.filter;
    // A filtered source (the guard) has no `state`: one equality on one field, paged by document id, in both modes.
    if(filter){
      let lastFiltered:DocumentSnapshot|null=null;
      for(;;){
        let query=root.collection(source.collection).where(filter.field,'==',filter.value).orderBy('__name__');
        if(lastFiltered)query=query.startAfter(lastFiltered);
        const page=await query.limit(pageSize).get();
        for(const doc of page.docs)rows.push(normalizePending(source.kind,doc.id,doc.data() as Record<string,unknown>|undefined));
        if(page.docs.length<pageSize)break;
        lastFiltered=page.docs[page.docs.length-1];
      }
      continue;
    }
    // Audit mode scans the whole collection once; the default mode runs one equality query per listed state.
    for(const only of audit?[null]:source.states){
      let last:DocumentSnapshot|null=null;
      for(;;){
        const base=root.collection(source.collection);
        let query=only===null?base.orderBy('__name__'):base.where('state','==',only).orderBy('__name__');
        if(last)query=query.startAfter(last);
        const page=await query.limit(pageSize).get();
        for(const doc of page.docs){
          const data=doc.data() as Record<string,unknown>|undefined,state=data?.state;
          if(audit&&typeof state==='string'&&terminal.has(state)&&!listed.has(state))continue;
          const row=normalizePending(source.kind,doc.id,data);
          rows.push(audit&&!(typeof state==='string'&&listed.has(state))?{...row,malformed:true}:row);
        }
        if(page.docs.length<pageSize)break;
        last=page.docs[page.docs.length-1];
      }
    }
  }
  return buildPendingReport(rows,nowMs);
}

/** Read-only terminal evidence used by the private alert sweep and the financial reader. */
export type ExternalVideoBilling = {provider:'account_seconds';identityKey:string;reservationId:string;seconds:number};
export type TerminalRecoveryDocumentVersion = {exists:false}|{exists:true;createTime:string;updateTime:string};
export type TerminalPollTurn={terminalId:string;intentId:string;action:'release'|'seal';binding:string;generation:number;token:string;lastPollAtMs:number;nextAttemptAt:number;outcome?:'reserved'|'not_found'|'captured'|'unavailable'|'unverified'};
// Wire profile of terminal recovery protocol 1. A catalog change also requires a versioned reader.
type TerminalWitness=ExternalVideoBilling&{intentId:string;accountId:string;inputId:string;operation:string;revision:number;profile:'ai-candidate-v1'};
export type PollReadSnapshot=Readonly<Pick<DocumentSnapshot,'id'|'exists'|'get'|'data'|'createTime'|'updateTime'>>;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminalUuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/i;
export function matchesExternalBilling(value:unknown,expected:ExternalVideoBilling){
  if(!value||typeof value!=='object')return false;
  const actual=value as Partial<ExternalVideoBilling>;
  return actual.provider===expected.provider&&actual.identityKey===expected.identityKey&&actual.reservationId===expected.reservationId&&actual.seconds===expected.seconds;
}
export function sameIntentWitness(value:unknown,expected:TerminalWitness){
  if(!value||typeof value!=='object')return false;const row=value as Partial<TerminalWitness>;
  return row.intentId===expected.intentId&&row.accountId===expected.accountId&&row.inputId===expected.inputId&&row.operation===expected.operation&&row.revision===expected.revision&&row.profile===expected.profile&&matchesExternalBilling(row,expected);
}
export function validStoredIntentWitness(doc:PollReadSnapshot,expected:TerminalWitness){
  return doc.exists&&sameIntentWitness(doc.data(),expected)&&doc.get('historyProtocol')===1&&doc.get('baseline')==='before_reservation'&&Number.isSafeInteger(doc.get('createdAtMs'))&&doc.get('createdAtMs')>=0;
}
export function validTerminalRecoveryOrigin(doc:PollReadSnapshot,expected:TerminalWitness){
  if(!validStoredIntentWitness(doc,expected))return false;
  const row=doc.data()!,fields=['intentId','accountId','inputId','operation','revision','profile','provider','identityKey','reservationId','seconds','historyProtocol','baseline','createdAtMs','terminalRecovery'];
  if(Object.keys(row).length!==fields.length||fields.some(field=>!Object.hasOwn(row,field)))return false;
  const marker=row.terminalRecovery;
  return !!marker&&typeof marker==='object'&&!Array.isArray(marker)&&Object.keys(marker).length===3&&
    ['protocol','sealPrepared','releasePrepared'].every(field=>Object.hasOwn(marker,field))&&marker.protocol===1&&
    typeof marker.sealPrepared==='boolean'&&typeof marker.releasePrepared==='boolean';
}
export function intentTerminalKey(intentId:string,action:'release'|'seal'){return hash(['billing-intent-terminal-v1',intentId,action]);}
export function validInitialTerminalRecovery(value:unknown,terminalId:string,createdAtMs:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const row=value as Record<string,unknown>;
  const fields=['terminalId','protocol','state','generation','attempts','createdAtMs','nextAttemptAt'];
  return Object.keys(row).length===fields.length&&fields.every(field=>Object.hasOwn(row,field))&&
    row.terminalId===terminalId&&row.protocol===1&&row.state==='pending'&&row.generation===0&&row.attempts===0&&
    Number.isSafeInteger(row.createdAtMs)&&Number(row.createdAtMs)>=0&&row.createdAtMs===createdAtMs&&row.nextAttemptAt===row.createdAtMs;
}
export function validInitialReaderPair(prepared:boolean,terminal:PollReadSnapshot,recovery:PollReadSnapshot,witness:TerminalWitness,action:'seal'|'release'){
  if(!prepared)return !terminal.exists&&!recovery.exists;
  const id=intentTerminalKey(witness.intentId,action),row=terminal.data();
  if(!terminal.exists||!recovery.exists||terminal.id!==id||recovery.id!==id||!row)return false;
  const fields=['intentId','accountId','inputId','operation','revision','profile','provider','identityKey','reservationId','seconds','action','historyProtocol','stage','createdAtMs'];
  return Object.keys(row).length===fields.length&&fields.every(field=>Object.hasOwn(row,field))&&
    sameIntentWitness(row,witness)&&row.action===action&&row.historyProtocol===1&&row.stage==='prepared'&&
    Number.isSafeInteger(row.createdAtMs)&&row.createdAtMs>=0&&validInitialTerminalRecovery(recovery.data(),id,row.createdAtMs);
}
export function terminalDocumentVersion(doc:PollReadSnapshot):TerminalRecoveryDocumentVersion|null{
  if(!doc.exists)return {exists:false};
  const encode=(value:DocumentSnapshot['createTime'])=>value&&Number.isSafeInteger(value.seconds)&&value.seconds>=0&&Number.isSafeInteger(value.nanoseconds)&&value.nanoseconds>=0&&value.nanoseconds<1_000_000_000?`${value.seconds}:${String(value.nanoseconds).padStart(9,'0')}`:null;
  const createTime=encode(doc.createTime),updateTime=encode(doc.updateTime);
  return createTime&&updateTime?{exists:true,createTime,updateTime}:null;
}
/** LV-019.B: the shared growing wait of every billing retry, `min(15 min, 1 s * 2^min(attempts,10))`. */
export function billingAttemptDelay(attempts:number){return Math.min(15*60_000,1000*2**Math.min(attempts,10));}
/** The poll coordinates reads only. It is deliberately outside the documents authenticated by a direct ACK. */
export function validTerminalPoll(row:FirebaseFirestore.DocumentData|undefined,intentId:string,action:'release'|'seal'):row is TerminalPollTurn{
  if(!row)return false;
  const fields=['terminalId','intentId','action','binding','generation','token','lastPollAtMs','nextAttemptAt'];
  if(Object.hasOwn(row,'outcome')){
    if(!['reserved','not_found','captured','unavailable','unverified'].includes(row.outcome))return false;
    fields.push('outcome');
  }
  if(Object.keys(row).length!==fields.length||fields.some(field=>!Object.hasOwn(row,field)))return false;
  return row.intentId===intentId&&row.action===action&&row.terminalId===intentTerminalKey(intentId,action)&&
    typeof row.binding==='string'&&/^[a-f0-9]{64}(?![\s\S])/.test(row.binding)&&typeof row.token==='string'&&terminalUuid.test(row.token)&&
    Number.isSafeInteger(row.generation)&&row.generation>0&&Number.isSafeInteger(row.lastPollAtMs)&&row.lastPollAtMs>=0&&
    Number.isSafeInteger(row.nextAttemptAt)&&row.nextAttemptAt===row.lastPollAtMs+billingAttemptDelay(row.generation);
}
export function terminalEvidenceBinding(witness:TerminalWitness,action:'release'|'seal',witnessDoc:PollReadSnapshot,recovery:PollReadSnapshot,proof:PollReadSnapshot,dispatch:PollReadSnapshot){
  // A legacy pair has neither dispatch record. Both forms still authorize only a read.
  if(proof.exists||dispatch.exists){
    if(!proof.exists||!dispatch.exists||!proof.createTime?.isEqual(proof.updateTime!)||!dispatch.createTime?.isEqual(proof.createTime!)||
      !witnessDoc.createTime?.isEqual(proof.createTime!)||!recovery.createTime?.isEqual(proof.createTime!)||
      typeof proof.get('transitioned')!=='boolean'||!/^[a-f0-9]{64}(?![\s\S])/.test(proof.get('history'))||
      !terminalUuid.test(dispatch.get('attemptId'))||!/^[a-f0-9]{64}(?![\s\S])/.test(dispatch.get('history'))||
      dispatch.get('terminalId')!==intentTerminalKey(witness.intentId,action)||dispatch.get('action')!==action||dispatch.get('state')!=='possibly_sent')return null;
  }
  return hash([witness,action,terminalDocumentVersion(witnessDoc),terminalDocumentVersion(recovery),terminalDocumentVersion(dispatch),terminalDocumentVersion(proof)]);
}

/** The auditor follows only keys derived from the authoritative intent document ID. */
export function validPollIntentId(value:unknown):value is string{
  return typeof value==='string'&&/^[a-f0-9]{64}(?![\s\S])/.test(value);
}
/** Audit-only tolerance for the writer clock running ahead of this document's Firestore commit.
 * Compare to updateTime even on a sweep whose own start preceded this commit. */
export const TERMINAL_POLL_CLOCK_LEAD_MS=10*60_000;
function pollClockPlausible(lastPollAtMs:number,updated:PollReadSnapshot['updateTime']){
  if(!updated||!Number.isSafeInteger(updated.seconds)||updated.seconds<0||
    !Number.isSafeInteger(updated.nanoseconds)||updated.nanoseconds<0||updated.nanoseconds>=1_000_000_000)
    throw new Error('Unavailable terminal poll commit time');
  const commitMs=updated.seconds*1000+Math.floor(updated.nanoseconds/1_000_000);
  if(!Number.isSafeInteger(commitMs))throw new Error('Invalid terminal poll commit time');
  return lastPollAtMs-commitMs<=TERMINAL_POLL_CLOCK_LEAD_MS;
}
/** The caller provides snapshots without document references and a read-only capability for exactly five evidence records. */
export async function inspectTerminalPoll(intentId:string,action:'release'|'seal',parent:PollReadSnapshot,poll:PollReadSnapshot,
  readEvidence:()=>Promise<readonly [PollReadSnapshot,PollReadSnapshot,PollReadSnapshot,PollReadSnapshot,PollReadSnapshot]>){
  if(!validPollIntentId(intentId)||(action!=='seal'&&action!=='release'))throw new RangeError('invalid terminal locator');
  if(parent.id!==intentId||poll.id!==intentTerminalKey(intentId,action))return 'invalid' as const;
  if(!parent.exists||parent.get('state')!=='release_pending'||!poll.exists)return 'unverified' as const;
  const turn=poll.data();
  if(!validTerminalPoll(turn,intentId,action))return 'invalid' as const;
  // The financial writer requires a safe generation + 1 before a read-only polling turn.
  if(turn.generation===Number.MAX_SAFE_INTEGER)return 'invalid' as const;
  if(!pollClockPlausible(turn.lastPollAtMs,poll.updateTime))return 'invalid' as const;
  const row=parent.data()!;
  const {requestKey,accountId,inputId,operation,revision,provider,identityKey,reservationId,seconds}=row;
  const validText=(value:unknown):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=200;
  if(row.id!==intentId||!validText(requestKey)||typeof accountId!=='string'||!terminalUuid.test(accountId)||
    typeof inputId!=='string'||!terminalUuid.test(inputId)||!validText(operation)||!Number.isSafeInteger(revision)||revision<1||
    provider!=='account_seconds'||!validPollIntentId(identityKey)||typeof reservationId!=='string'||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/i.test(reservationId)||
    !Number.isSafeInteger(seconds)||seconds<1||seconds>600||hash([accountId,requestKey])!==intentId)return 'invalid' as const;
  const witness:TerminalWitness={intentId,accountId,inputId,operation,revision,profile:'ai-candidate-v1',provider,identityKey,reservationId,seconds};
  const [origin,terminal,recovery,proof,dispatch]=await readEvidence();
  if(origin.id!==intentId||[terminal,recovery,proof,dispatch].some(doc=>doc.id!==poll.id))return 'invalid' as const;
  if(!validTerminalRecoveryOrigin(origin,witness)||origin.get('terminalRecovery')[action==='seal'?'sealPrepared':'releasePrepared']!==true||
    !validInitialReaderPair(true,terminal,recovery,witness,action))return 'invalid' as const;
  // A binding authenticates the selected evidence versions. This check grants no financial permission.
  if([terminal,recovery,proof,dispatch].some(doc=>!terminalDocumentVersion(doc)))return 'invalid' as const;
  const binding=terminalEvidenceBinding(witness,action,terminal,recovery,proof,dispatch);
  return binding===turn.binding?'intact' as const:'invalid' as const;
}
