import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateReviewedVoiceCall } from './reviewedVoiceCanonical';

type Version = Readonly<{exists:true;createTime:string;updateTime:string}>;
const versionFields = [
  'identity','account','input','project','review','receipt','marker',
  'attempt','reserveAck','voiceJob','origin','intent','request','jobMarker',
] as const;
const sourceFields = [
  'textJobId','reviewId','receiptId','bindingHash','payloadSha256','voiceTextSha256',
] as const;
const versionKeys = ['exists','createTime','updateTime'] as const;
const admissionFields = [
  'reservationId','seconds','jobId','attemptId','callKey','model','requestSha256','created','receiptOnly',
] as const;
const principalFields = ['accountId','uid'] as const;
const requestFields = ['principal','jobId','operation','model','callKey','body'] as const;
const reserveAckFields = ['attemptId','identityKey','reservationId','seconds','state','source'] as const;
const fragment = 'voice-chunk:0000';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/i;
const versionTime = /^[0-9]{1,15}:[0-9]{9}(?![\s\S])/;
const digest = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const enabled = () => process.env.NODE_ENV==='test'&&process.env.LV_VOICE_C2_MEMORY_TEST==='1';

export type SyntheticFragmentRequest = Readonly<{
  principal:Readonly<{accountId:string;uid:string}>;
  jobId:string;operation:string;model:string;callKey:string;body:string;
}>;

/**
 * Supplied by a trusted C1 read. The adapter obtains originalMarkerVersion
 * from the persisted v2 attempt and validates it against the current marker.
 */
export type SyntheticC1Read = Readonly<{
  accountId:string;inputId:string;jobId:string;operation:string;identityKey:string;
  reservationId:string;seconds:number;revision:number;canonicalEvidence:unknown;
  reserveAck:Readonly<{attemptId:string;identityKey:string;reservationId:string;seconds:number;state:'reserved';source:'reserve_ack'}>;
  /** Verified projection of the C1 voice job's durable reviewed-source marker. */
  reviewedSource:Readonly<Pick<ReturnType<typeof validateReviewedVoiceCall>,(typeof sourceFields)[number]>>;
  originalMarkerVersion:Version;
  versions:Readonly<Record<(typeof versionFields)[number],Version>>;
  /** Optional additional history checked by the concrete fixture adapter. */
  provenanceSha256?:string;
}>;

export type SyntheticFragmentCall = Readonly<{
  reservationId:string;seconds:number;jobId:string;attemptId:string;callKey:string;model:string;requestSha256:string;
}>;
type Call = SyntheticFragmentCall;
type Admission = Call & Readonly<{created:boolean;receiptOnly:boolean}>;
type JournalEntry = {
  principal:SyntheticFragmentRequest['principal'];
  requestFingerprint:string;
  before:NonNullable<ReturnType<typeof capture>>['evidence'];
  call:Call;
  receipt?:Admission;bytes?:Buffer;
};
type Ports = Readonly<{
  readVerifiedC1(request:SyntheticFragmentRequest, admitted?:Call):Promise<SyntheticC1Read|null>;
  admitForTest(identityKey:string,call:Call):Promise<unknown>;
}>;

function dataFields(value:unknown,keys:readonly string[]):Record<string,unknown>|null {
  if(!value||typeof value!=='object')return null;
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null||Reflect.ownKeys(value).length!==keys.length)return null;
  const fields:Record<string,unknown>={};
  for(const key of keys){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!('value' in descriptor))return null;
    fields[key]=descriptor.value;
  }
  return fields;
}

function version(value:unknown):Version|null {
  const fields=dataFields(value,versionKeys);
  if(!fields)return null;
  const {exists,createTime,updateTime}=fields;
  if(exists!==true||typeof createTime!=='string'||typeof updateTime!=='string'||
    !versionTime.test(createTime)||!versionTime.test(updateTime)||
    BigInt(createTime.replace(':',''))>BigInt(updateTime.replace(':','')))return null;
  return {exists,createTime,updateTime};
}

function copyRequest(input:unknown):SyntheticFragmentRequest|null {
  const fields=dataFields(input,requestFields);
  const principal=dataFields(fields?.principal,principalFields);
  if(!fields||!principal)return null;
  const {accountId,uid}=principal,{jobId,operation,model,callKey,body}=fields;
  if(typeof accountId!=='string'||!uuid.test(accountId)||typeof uid!=='string'||!uid||uid.length>128||
    typeof jobId!=='string'||!uuid.test(jobId)||typeof operation!=='string'||typeof model!=='string'||
    callKey!==fragment||typeof body!=='string')return null;
  return Object.freeze({principal:Object.freeze({accountId,uid}),jobId,operation,model,callKey,body});
}

function capture(request:SyntheticFragmentRequest, read:SyntheticC1Read|null) {
  if(!read||read.accountId!==request.principal.accountId||read.jobId!==request.jobId||read.operation!==request.operation||
    read.identityKey!==digest(['firebase',request.principal.uid])||!uuid.test(read.reservationId)||
    !Number.isSafeInteger(read.seconds)||read.seconds<1||read.seconds>600||
    read.provenanceSha256!==undefined&&(typeof read.provenanceSha256!=='string'||!/^[a-f0-9]{64}(?![\s\S])/.test(read.provenanceSha256)))return null;
  if(!isDeepStrictEqual(dataFields(read.reserveAck,reserveAckFields),{
    attemptId:read.reservationId,identityKey:read.identityKey,reservationId:read.reservationId,seconds:read.seconds,
    state:'reserved',source:'reserve_ack',
  }))return null;
  const versions=dataFields(read.versions,versionFields),source=dataFields(read.reviewedSource,sourceFields);
  if(!versions||!source)return null;
  const pins=versionFields.map(field=>version(versions[field])),originalMarkerVersion=version(read.originalMarkerVersion);
  if(!originalMarkerVersion||!pins.every(pin=>pin!==null)||
    !isDeepStrictEqual(originalMarkerVersion,version(versions.marker)))return null;
  const call=validateReviewedVoiceCall({
    evidence:read.canonicalEvidence,operation:request.operation,model:request.model,callKey:request.callKey,body:request.body,
  });
  if(call.accountId!==read.accountId||call.inputId!==read.inputId||call.revision!==read.revision||call.chunkCount!==1||
    !sourceFields.every(key=>call[key]===source[key]))return null;
  const evidence={
    jobId:read.jobId,identityKey:read.identityKey,reservationId:read.reservationId,seconds:read.seconds,
    accountId:call.accountId,inputId:call.inputId,operation:call.operation,revision:call.revision,
    textJobId:call.textJobId,reviewId:call.reviewId,receiptId:call.receiptId,bindingHash:call.bindingHash,
    payloadSha256:call.payloadSha256,voiceTextSha256:call.voiceTextSha256,requestSha256:call.requestSha256,
    originalMarkerVersion,versions:Object.fromEntries(versionFields.map((name,index)=>[name,pins[index]])),
    provenanceSha256:read.provenanceSha256,
  };
  return {
    identityKey:read.identityKey,reservationId:read.reservationId,seconds:read.seconds,call,
    evidence,history:digest(evidence),
  };
}

function admissionFor(call:Call,response:unknown):Admission|null {
  const fields=dataFields(response,admissionFields);
  if(!fields)return null;
  const fresh={...call,created:true,receiptOnly:false} as const;
  if(isDeepStrictEqual(fields,fresh))return fresh;
  const replay={...call,created:false,receiptOnly:true} as const;
  return isDeepStrictEqual(fields,replay)?replay:null;
}

/**
 * A single-process, test-only fence and receiver. The read adapter must verify
 * C1 in its own authorized transaction. The journal and the receiver last
 * only for the lifetime of this instance.
 */
export function createReviewedVoiceFragmentMemoryBridge(ports:Ports) {
  const journal=new Map<string,JournalEntry>();
  const reservations=new Set<string>();

  async function send(input:SyntheticFragmentRequest):Promise<'disabled'|'rejected'|'unknown'|'sent'> {
    if(!enabled())return 'disabled';
    let request;
    try{request=copyRequest(input);}catch{return 'rejected';}
    if(!request)return 'rejected';
    const requestFingerprint=digest(request);
    let original;
    try{original=capture(request,await ports.readVerifiedC1(request));}
    catch{original=null;}
    if(!enabled())return 'disabled';
    const previous=journal.get(request.jobId);
    if(previous&&previous.requestFingerprint!==requestFingerprint)return 'rejected';
    // An admission may be recorded without a verified delivery. Keep the
    // exact request uncertain until bytes have been delivered.
    if(!original)return previous&&!previous.bytes?'unknown':'rejected';
    if(previous||reservations.has(original.reservationId))return 'unknown';

    const call=Object.freeze({
      jobId:request.jobId,attemptId:randomUUID(),reservationId:original.reservationId,seconds:original.seconds,
      callKey:fragment,model:original.call.model,requestSha256:original.call.requestSha256,
    });
    const entry:JournalEntry={principal:request.principal,requestFingerprint,before:original.evidence,call};
    journal.set(request.jobId,entry);
    reservations.add(original.reservationId);
    try{
      const receipt=admissionFor(call,await ports.admitForTest(original.identityKey,call));
      if(receipt)entry.receipt=Object.freeze(receipt);
      // A switch changed during the test call can suppress delivery, but cannot retract admission.
      if(receipt?.created&&enabled()){
        const current=capture(request,await ports.readVerifiedC1(request,call));
        if(current?.history===original.history&&enabled()){
          entry.bytes=Buffer.from(original.call.body,'utf8');
          return 'sent';
        }
      }
    }catch{
      // An unknown admission or interrupted verification never authorizes retry.
    }
    return 'unknown';
  }

  return {
    send,
    // The fixture can inspect its own retained evidence even after a failed C1 read.
    inspectForTest(jobId:string,principal:SyntheticFragmentRequest['principal']){
      const entry=journal.get(jobId);
      if(!enabled()||!entry||principal?.accountId!==entry.principal.accountId||principal.uid!==entry.principal.uid)return undefined;
      return {before:structuredClone(entry.before),call:entry.call,receipt:entry.receipt,bytes:entry.bytes&&Buffer.from(entry.bytes)};
    },
  };
}
