import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateReviewedVoiceCall } from './reviewedVoiceCanonical';

type Version = Readonly<{exists:true;createTime:string;updateTime:string}>;
const versionFields = [
  'identity','account','input','project','review','receipt','marker',
  'attempt','reserveAck','voiceJob','origin','intent','request','jobMarker',
] as const;
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
 * Supplied by a trusted C1 read. The preparation base lacks a durable
 * markerVersion in its C1 attempt, so there is no Firestore adapter here.
 * An adapter must obtain originalMarkerVersion from that attempt, not infer
 * it from today's marker or from the supplied review payload.
 */
export type SyntheticC1Read = Readonly<{
  accountId:string;inputId:string;jobId:string;operation:string;identityKey:string;
  reservationId:string;seconds:number;revision:number;canonicalEvidence:unknown;
  reserveAck:Readonly<{attemptId:string;identityKey:string;reservationId:string;seconds:number;state:'reserved';source:'reserve_ack'}>;
  originalMarkerVersion:Version;
  versions:Readonly<Record<(typeof versionFields)[number],Version>>;
}>;

type Call = Readonly<{
  reservationId:string;seconds:number;jobId:string;attemptId:string;callKey:string;model:string;requestSha256:string;
}>;
type Admission = Call & Readonly<{created:boolean;receiptOnly:boolean}>;
type JournalEntry = {receipt?:Admission};
type Ports = Readonly<{
  readVerifiedC1(request:SyntheticFragmentRequest):Promise<SyntheticC1Read|null>;
  admitForTest(identityKey:string,call:Call):Promise<unknown>;
}>;

function version(v:Version|undefined):v is Version {
  return !!v&&v.exists===true&&versionTime.test(v.createTime)&&versionTime.test(v.updateTime)&&
    BigInt(v.createTime.replace(':',''))<=BigInt(v.updateTime.replace(':',''));
}

function capture(request:SyntheticFragmentRequest, read:SyntheticC1Read|null) {
  if(!read||read.accountId!==request.principal.accountId||read.jobId!==request.jobId||read.operation!==request.operation||
    read.identityKey!==digest(['firebase',request.principal.uid])||!uuid.test(read.reservationId)||
    !Number.isSafeInteger(read.seconds)||read.seconds<1||read.seconds>600)return null;
  if(!isDeepStrictEqual(read.reserveAck,{
    attemptId:read.reservationId,identityKey:read.identityKey,reservationId:read.reservationId,seconds:read.seconds,
    state:'reserved',source:'reserve_ack',
  }))return null;
  const pins=versionFields.map(field=>read.versions[field]);
  if(!version(read.originalMarkerVersion)||!pins.every(version)||
    !isDeepStrictEqual(read.originalMarkerVersion,read.versions.marker))return null;
  const call=validateReviewedVoiceCall({
    evidence:read.canonicalEvidence,operation:request.operation,model:request.model,callKey:request.callKey,body:request.body,
  });
  if(call.accountId!==read.accountId||call.inputId!==read.inputId||call.revision!==read.revision||call.chunkCount!==1)return null;
  return {
    identityKey:read.identityKey,reservationId:read.reservationId,seconds:read.seconds,call,
    history:digest([read.identityKey,read.reservationId,read.seconds,call.reviewId,call.receiptId,call.bindingHash,
      call.payloadSha256,call.voiceTextSha256,call.requestSha256,pins.map(pin=>[pin.createTime,pin.updateTime])]),
  };
}

function admissionFor(call:Call,response:unknown):Admission|null {
  const fresh={...call,created:true,receiptOnly:false} as const;
  if(isDeepStrictEqual(response,fresh))return fresh;
  const replay={...call,created:false,receiptOnly:true} as const;
  return isDeepStrictEqual(response,replay)?replay:null;
}

/**
 * A single-process, test-only fence and receiver. The read adapter must verify
 * C1 in its own authorized transaction. The journal and the receiver last
 * only for the lifetime of this instance.
 */
export function createReviewedVoiceFragmentMemoryBridge(ports:Ports) {
  const journal=new Map<string,JournalEntry>();
  const reservations=new Set<string>();
  const received:Buffer[]=[];

  async function send(input:SyntheticFragmentRequest):Promise<'disabled'|'rejected'|'unknown'|'sent'> {
    if(!enabled())return 'disabled';
    const request=Object.freeze({...input,principal:Object.freeze({...input.principal})});
    if(request.callKey!==fragment||!uuid.test(request.jobId)||!uuid.test(request.principal.accountId)||
      typeof request.principal.uid!=='string'||!request.principal.uid||request.principal.uid.length>128)return 'rejected';
    let original;
    try{original=capture(request,await ports.readVerifiedC1(request));}
    catch{return 'rejected';}
    if(!original)return 'rejected';
    if(!enabled())return 'disabled';
    if(journal.has(request.jobId)||reservations.has(original.reservationId))return 'unknown';

    const entry:JournalEntry={};
    journal.set(request.jobId,entry);
    reservations.add(original.reservationId);
    const call=Object.freeze({
      jobId:request.jobId,attemptId:randomUUID(),reservationId:original.reservationId,seconds:original.seconds,
      callKey:fragment,model:original.call.model,requestSha256:original.call.requestSha256,
    });
    try{
      const receipt=admissionFor(call,await ports.admitForTest(original.identityKey,call));
      if(receipt)entry.receipt=Object.freeze(receipt);
      if(receipt?.created&&enabled()){
        const current=capture(request,await ports.readVerifiedC1(request));
        if(current?.history===original.history&&enabled()){
          received.push(Buffer.from(original.call.body,'utf8'));
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
    readReceipt: (jobId:string) => journal.get(jobId)?.receipt,
    received: () => received.map(bytes=>Buffer.from(bytes)),
  };
}
