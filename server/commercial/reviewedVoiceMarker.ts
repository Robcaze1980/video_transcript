import {createHash} from 'node:crypto';

/**
 * Pure, disconnected codec for a future reviewed-voice admission marker.
 * Neither constructing nor validating a marker authenticates the identity,
 * proves a payment or capture, grants access, or authorizes a reservation.
 * The future caller must obtain the binding and make its financial write in
 * the SAME authorized Firestore transaction. No storage or network here.
 */
export class ReviewedVoiceMarkerFault extends Error {
  constructor() { super('invalid_reviewed_voice_marker'); }
}

type VoiceOperation = 'narration:en:female' | 'narration:en:male';
export type ReviewedVoiceMarker = Readonly<{
  version:'reviewed-voice-marker-v1'; markerId:string; bindingVersion:'reviewed-voice-binding-v1';
  canonVersion:'reviewed-voice-canon-v1'; model:'gemini-3.8-flash-tts';
  identityKey:string; accountId:string; inputId:string; textJobId:string; revision:number;
  reviewId:string; receiptId:string; bindingHash:string; payloadSha256:string; voiceTextSha256:string;
  inputGeneration:string; inputSha256:string; durationMs:number; billableSeconds:number;
  operation:VoiceOperation; voiceId:'Kore'|'Charon'; fingerprint:string;
}>;
type MarkerFields = Omit<ReviewedVoiceMarker,'fingerprint'>;

const invalid=():never=>{throw new ReviewedVoiceMarkerFault();};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/i;
const hex=/^[a-f0-9]{64}(?![\s\S])/;
const generation=/^[1-9]\d{0,30}(?![\s\S])/;
const controls=/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const bindingFields=['version','identityKey','accountId','inputId','textJobId','revision','reviewId','receiptId','bindingHash',
  'payloadSha256','voiceTextSha256','inputGeneration','inputSha256','durationMs','billableSeconds','versions','canonicalEvidence'] as const;
const markerFields=['version','markerId','bindingVersion','canonVersion','model','identityKey','accountId','inputId','textJobId','revision',
  'reviewId','receiptId','bindingHash','payloadSha256','voiceTextSha256','inputGeneration','inputSha256','durationMs','billableSeconds',
  'operation','voiceId','fingerprint'] as const;

/** Only own data properties are considered; accessors are never invoked. */
function dataProperties(value:unknown,names:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)return invalid();
  const keys=Reflect.ownKeys(value);
  if(keys.length!==names.length||keys.some(key=>typeof key!=='string'||!names.includes(key)))return invalid();
  const result:Record<string,unknown>=Object.create(null);
  for(const name of names){const descriptor=Object.getOwnPropertyDescriptor(value,name);if(!descriptor||!('value'in descriptor))return invalid();
    // These fields can hold private text or mutable document metadata. Their
    // presence is checked for compatibility but their values are never read.
    if(name!=='canonicalEvidence'&&name!=='versions')result[name]=descriptor.value;
  }
  return result;
}
function key(value:unknown):string{
  if(typeof value!=='string'||!value.trim()||value.length>200||controls.test(value)||Buffer.from(value,'utf8').toString('utf8')!==value)return invalid();
  return value;
}
function identifier(value:unknown):string{return typeof value==='string'&&uuid.test(value)?value:invalid();}
function digest(value:unknown):string{return typeof value==='string'&&hex.test(value)?value:invalid();}
function operation(value:unknown):VoiceOperation{return value==='narration:en:female'||value==='narration:en:male'?value:invalid();}
function duration(milliseconds:unknown,seconds:unknown):{durationMs:number;billableSeconds:number}{
  if(typeof milliseconds!=='number'||!Number.isSafeInteger(milliseconds)||milliseconds<1||milliseconds>600_000||
    typeof seconds!=='number'||!Number.isSafeInteger(seconds)||seconds<1||seconds>600)return invalid();
  // Milliseconds are truncated. At an exact-second boundary the original
  // duration may have had a sub-millisecond fraction, e.g. 2000 ms -> 2 or 3 s.
  const least=Math.ceil(milliseconds/1000),greatest=Math.min(600,Math.floor(milliseconds/1000)+1);
  if(seconds<least||seconds>greatest)return invalid();
  return {durationMs:milliseconds,billableSeconds:seconds};
}
function markerId(accountId:string,requestKey:string){return hash(['reviewed-voice-marker-id-v1',accountId,requestKey]);}
function reviewId(accountId:string,inputId:string,textJobId:string,revision:number){return hash(['review-revision-v1',accountId,inputId,textJobId,revision]);}
function fingerprint(value:MarkerFields){return hash(['reviewed-voice-marker-content-v1',value.version,value.markerId,value.bindingVersion,value.canonVersion,
  value.model,value.identityKey,value.accountId,value.inputId,value.textJobId,value.revision,value.reviewId,value.receiptId,value.bindingHash,
  value.payloadSha256,value.voiceTextSha256,value.inputGeneration,value.inputSha256,value.durationMs,value.billableSeconds,value.operation,value.voiceId]);}

function build(binding:Record<string,unknown>,requestKey:string,requestedOperation:VoiceOperation):ReviewedVoiceMarker{
  if(binding.version!=='reviewed-voice-binding-v1')return invalid();
  const accountId=identifier(binding.accountId),inputId=identifier(binding.inputId),textJobId=identifier(binding.textJobId);
  const revision=binding.revision;if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<2)return invalid();
  const chosenReview=digest(binding.reviewId);if(chosenReview!==reviewId(accountId,inputId,textJobId,revision))return invalid();
  const inputGeneration=binding.inputGeneration;if(typeof inputGeneration!=='string'||!generation.test(inputGeneration))return invalid();
  const times=duration(binding.durationMs,binding.billableSeconds);
  // Construct every persisted field explicitly; never spread the binding.
  const fields:MarkerFields={version:'reviewed-voice-marker-v1',markerId:markerId(accountId,requestKey),bindingVersion:'reviewed-voice-binding-v1',
    canonVersion:'reviewed-voice-canon-v1',model:'gemini-3.8-flash-tts',identityKey:digest(binding.identityKey),accountId,inputId,textJobId,revision,
    reviewId:chosenReview,receiptId:digest(binding.receiptId),bindingHash:digest(binding.bindingHash),payloadSha256:digest(binding.payloadSha256),
    voiceTextSha256:digest(binding.voiceTextSha256),inputGeneration,inputSha256:digest(binding.inputSha256),durationMs:times.durationMs,
    billableSeconds:times.billableSeconds,operation:requestedOperation,voiceId:requestedOperation==='narration:en:female'?'Kore':'Charon'};
  return Object.freeze({...fields,fingerprint:fingerprint(fields)});
}

/** Copies only validated primitive fields; neither raw key nor private text is returned. */
export function createReviewedVoiceMarker(binding:unknown,requestKey:unknown,requestedOperation:unknown):ReviewedVoiceMarker{
  try{return build(dataProperties(binding,bindingFields),key(requestKey),operation(requestedOperation));}
  catch(error){if(error instanceof ReviewedVoiceMarkerFault)throw error;return invalid();}
}

/**
 * Rejects a malformed/stale-shaped marker and a mismatching account, key or
 * operation. It does not prove the marker was written by a trusted actor.
 */
export function validateReviewedVoiceMarker(value:unknown,expectedAccount:unknown,requestKey:unknown,requestedOperation:unknown):ReviewedVoiceMarker{
  try{
    const row=dataProperties(value,markerFields),accountId=identifier(expectedAccount),selected=operation(requestedOperation),safeKey=key(requestKey);
    if(row.version!=='reviewed-voice-marker-v1'||row.bindingVersion!=='reviewed-voice-binding-v1'||row.canonVersion!=='reviewed-voice-canon-v1'||
       row.model!=='gemini-3.8-flash-tts'||row.accountId!==accountId||row.operation!==selected||row.markerId!==markerId(accountId,safeKey))return invalid();
    // Reconstruct through the same scalar checks as construction, without
    // claiming that persisted hashes authenticate their own provenance.
    const candidate=build({version:row.bindingVersion,identityKey:row.identityKey,accountId:row.accountId,inputId:row.inputId,textJobId:row.textJobId,
      revision:row.revision,reviewId:row.reviewId,receiptId:row.receiptId,bindingHash:row.bindingHash,payloadSha256:row.payloadSha256,
      voiceTextSha256:row.voiceTextSha256,inputGeneration:row.inputGeneration,inputSha256:row.inputSha256,durationMs:row.durationMs,billableSeconds:row.billableSeconds},safeKey,selected);
    if(row.voiceId!==candidate.voiceId||row.fingerprint!==candidate.fingerprint)return invalid();
    return candidate;
  }catch(error){if(error instanceof ReviewedVoiceMarkerFault)throw error;return invalid();}
}

/**
 * Check an idempotent replay against the current binding supplied by the caller.
 * Both the stored marker and the current binding must pass the scalar checks;
 * every persisted field, including the fingerprint, must match exactly.
 *
 * This function does not authenticate the binding or prove a financial action.
 * It does not compare source document versions, detect changes that were later
 * restored, or inspect canonicalEvidence. Those require an independent durable
 * version/history witness and an authorized transactional read by the caller.
 * Strings are compared exactly, without Unicode or case normalization.
 */
export function validateReviewedVoiceMarkerReplay(value:unknown,currentBinding:unknown,expectedAccount:unknown,requestKey:unknown,requestedOperation:unknown):ReviewedVoiceMarker{
  const stored=validateReviewedVoiceMarker(value,expectedAccount,requestKey,requestedOperation);
  const current=createReviewedVoiceMarker(currentBinding,requestKey,requestedOperation);
  if(current.accountId!==stored.accountId||markerFields.some(field=>current[field]!==stored[field]))return invalid();
  return stored;
}
