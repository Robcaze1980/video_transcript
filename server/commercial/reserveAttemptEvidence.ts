import { createHash } from 'node:crypto';
import type { ReviewedVoiceBinding } from './firestoreReviewedTranslation';
import { createReviewedVoiceMarker } from './reviewedVoiceMarker';
import { videoReservationId } from './videoReservationId';
import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

/**
 * These records are evidence, not authorization,
 * proof of a POST, proof of ownership, or a financial operation.
 *
 * The trusted caller must validate the witness, every source document and its
 * version in the SAME transaction before preparing the attempt, after all
 * its other reads. This module validates shape only; it cannot authenticate a
 * caller-supplied snapshot or verify that the caller really did those reads.
 */
export const RESERVE_ATTEMPT_DOCUMENTS = Object.freeze([
  'account', 'identity', 'input', 'project', 'intent', 'origin', 'guard', 'intentGuard',
  'request', 'jobMarker', 'sealWitness', 'sealRecovery', 'releaseWitness', 'releaseRecovery',
] as const);
export type ReserveAttemptDocumentName = typeof RESERVE_ATTEMPT_DOCUMENTS[number];
export type ReserveAttemptDocumentVersion = Readonly<{exists:false}> |
  Readonly<{exists:true; createTime:string; updateTime:string}>;
export type ReserveAttemptVersions = Readonly<Record<ReserveAttemptDocumentName, ReserveAttemptDocumentVersion>>;
/** Persisted protocol v1 keeps its historical profile even if the live catalog changes. */
export const RESERVE_ATTEMPT_PROFILE_V1 = 'ai-candidate-v1' as const;
export type ReserveAttemptWitnessV1 = Readonly<{
  intentId:string; accountId:string; inputId:string; operation:'translation:en'; revision:number;
  profile:typeof RESERVE_ATTEMPT_PROFILE_V1; provider:'account_seconds'; identityKey:string; reservationId:string; seconds:number;
}>;
export type ReserveAttemptEvidenceV1 = Readonly<{
  version:1; attemptId:string; witness:ReserveAttemptWitnessV1; versions:ReserveAttemptVersions;
}>;
type ReviewedVoiceOperation = 'narration:en:female' | 'narration:en:male';
type ReserveAttemptWitnessV2 = Readonly<Omit<ReserveAttemptWitnessV1, 'operation'> & {operation:ReviewedVoiceOperation}>;
type ReviewedVoiceReserveProof = Readonly<{
  markerId:string; markerFingerprint:string; markerVersion:Extract<ReserveAttemptDocumentVersion,{exists:true}>;
  sourceVersionsSha256:string;
}>;
export type ReserveAttemptEvidenceV2 = Readonly<{
  version:2; attemptId:string; witness:ReserveAttemptWitnessV2; versions:ReserveAttemptVersions; voice:ReviewedVoiceReserveProof;
}>;
export type ReserveAttemptEvidence = ReserveAttemptEvidenceV1 | ReserveAttemptEvidenceV2;
export type ReserveAck = Readonly<{reservationId:string; seconds:number; state:'reserved'}>;
export type ReserveAttemptPrepareResult = Readonly<{state:'created'|'already_prepared'; observation:'unknown'|'ack_recorded'}>;
export type ReserveAckRecordResult = Readonly<{state:'recorded'|'already_recorded'; attribution:'unverified'}>;

export class ReserveAttemptEvidenceFault extends Error {
  constructor(readonly code:'invalid'|'conflict'){super(code);}
}
const invalid = ():never => { throw new ReserveAttemptEvidenceFault('invalid'); };
const conflict = ():never => { throw new ReserveAttemptEvidenceFault('conflict'); };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/i;
const uuidV4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
const hex64 = /^[a-f0-9]{64}(?![\s\S])/;
const time = /^(?:0|[1-9]\d{0,14}):\d{9}(?![\s\S])/;
const witnessFields = ['intentId','accountId','inputId','operation','revision','profile','provider','identityKey','reservationId','seconds'] as const;

/** Copy only own data properties; do not evaluate getters or persist extras. */
function exact(value:unknown, names:readonly string[]):Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) return invalid();
  const copy:Record<string,unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !('value' in descriptor)) return invalid();
    copy[name] = descriptor.value;
  }
  return copy;
}
function version(value:unknown):ReserveAttemptDocumentVersion {
  const base = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'exists') : undefined;
  if (!base || !('value' in base)) return invalid();
  if (base.value === false) {
    exact(value, ['exists']);
    return Object.freeze({exists:false});
  }
  const row = exact(value, ['exists','createTime','updateTime']);
  if (row.exists !== true || typeof row.createTime !== 'string' || typeof row.updateTime !== 'string' ||
      !time.test(row.createTime) || !time.test(row.updateTime)) return invalid();
  const [createdSeconds, createdNanos] = row.createTime.split(':');
  const [updatedSeconds, updatedNanos] = row.updateTime.split(':');
  const created = BigInt(createdSeconds), updated = BigInt(updatedSeconds);
  if (created > updated || created === updated && createdNanos > updatedNanos) return invalid();
  return Object.freeze({exists:true, createTime:row.createTime, updateTime:row.updateTime});
}
function copyWitness<Operation extends string>(value:unknown, operation:Operation, minRevision:number):Readonly<Omit<ReserveAttemptWitnessV1, 'operation'> & {operation:Operation}> {
  const row = exact(value, witnessFields);
  if (typeof row.intentId !== 'string' || !hex64.test(row.intentId) ||
      typeof row.accountId !== 'string' || !uuid.test(row.accountId) ||
      typeof row.inputId !== 'string' || !uuid.test(row.inputId) || row.operation !== operation ||
      !Number.isSafeInteger(row.revision) || Number(row.revision) < minRevision || row.profile !== RESERVE_ATTEMPT_PROFILE_V1 ||
      row.provider !== 'account_seconds' || typeof row.identityKey !== 'string' || !hex64.test(row.identityKey) ||
      typeof row.reservationId !== 'string' || !uuidV4.test(row.reservationId) ||
      !Number.isSafeInteger(row.seconds) || Number(row.seconds) < 1 || Number(row.seconds) > 600) return invalid();
  return Object.freeze({
    intentId:row.intentId, accountId:row.accountId, inputId:row.inputId, operation,
    revision:row.revision as number, profile:RESERVE_ATTEMPT_PROFILE_V1, provider:'account_seconds',
    identityKey:row.identityKey, reservationId:row.reservationId, seconds:row.seconds as number,
  });
}
function copyVersions(value:unknown):ReserveAttemptVersions {
  const row = exact(value, RESERVE_ATTEMPT_DOCUMENTS);
  const versions = {} as Record<ReserveAttemptDocumentName, ReserveAttemptDocumentVersion>;
  for (const name of RESERVE_ATTEMPT_DOCUMENTS) versions[name] = version(row[name]);
  for (const name of ['account','identity','input','project','intent','origin','intentGuard'] as const) {
    if (!versions[name].exists) return invalid();
  }
  if (versions.request.exists || versions.jobMarker.exists ||
      versions.sealWitness.exists !== versions.sealRecovery.exists ||
      versions.releaseWitness.exists !== versions.releaseRecovery.exists) return invalid();
  return Object.freeze(versions);
}
function hash(value:unknown):string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function voiceOperation(value:unknown):ReviewedVoiceOperation {
  const operation = exact(value, witnessFields).operation;
  if (operation !== 'narration:en:female' && operation !== 'narration:en:male') return invalid();
  return operation;
}

function voiceProof(value:unknown):ReviewedVoiceReserveProof {
  const {markerId, markerFingerprint, markerVersion, sourceVersionsSha256} =
    exact(value, ['markerId','markerFingerprint','markerVersion','sourceVersionsSha256']);
  if (typeof markerId !== 'string' || !hex64.test(markerId) || typeof markerFingerprint !== 'string' ||
      !hex64.test(markerFingerprint) || typeof sourceVersionsSha256 !== 'string' || !hex64.test(sourceVersionsSha256)) return invalid();
  const recordedVersion = version(markerVersion);
  if (!recordedVersion.exists || recordedVersion.createTime !== recordedVersion.updateTime) return invalid();
  return Object.freeze({markerId, markerFingerprint, markerVersion:recordedVersion, sourceVersionsSha256});
}

const requiredVoiceSources = [
  'principalIdentity','account','input','project','textJob','artifact','terminal','accounting','review','receipt',
] as const;
const externalVoiceSources = ['payerIdentity','intent','origin','request','jobMarker','intentGuard'] as const;
const voiceSourceFields = [...requiredVoiceSources, 'reserveMovement','billingOutbox'] as const;

function reviewedSourceVersion(value:unknown):ReserveAttemptDocumentVersion {
  const row = exact(value, ['exists','createTime','updateTime']);
  if (row.exists === false) {
    if (row.createTime !== null || row.updateTime !== null) return invalid();
    return Object.freeze({exists:false});
  }
  return version(row);
}

function requiredSourceVersion(value:unknown) {
  const doc = reviewedSourceVersion(value);
  if (!doc.exists) return invalid();
  return doc;
}

function reviewedSourceHistory(binding:ReviewedVoiceBinding, preflight?:ReserveAttemptVersions):string {
  const value = binding.versions;
  const hasExternal = Object.hasOwn(value, 'external');
  const source = exact(value, hasExternal ? [...voiceSourceFields, 'external'] : voiceSourceFields);
  const required = requiredVoiceSources.map(name => [name, requiredSourceVersion(source[name])] as const);
  const docs = Object.fromEntries(required) as Record<typeof requiredVoiceSources[number], Extract<ReserveAttemptDocumentVersion, {exists:true}>>;
  const reserveMovement = reviewedSourceVersion(source.reserveMovement);
  const billingOutbox = reviewedSourceVersion(source.billingOutbox);
  if (reserveMovement.exists === hasExternal || billingOutbox.exists !== hasExternal) return invalid();
  const external = hasExternal ? exact(source.external, externalVoiceSources) : undefined;
  const externalVersions = external ? externalVoiceSources.map(name => [name, requiredSourceVersion(external[name])]) : null;
  if (preflight && (JSON.stringify(docs.principalIdentity) !== JSON.stringify(preflight.identity) ||
      JSON.stringify(docs.input) !== JSON.stringify(preflight.input) ||
      JSON.stringify(docs.project) !== JSON.stringify(preflight.project) ||
      JSON.stringify(docs.account) !== JSON.stringify(preflight.account))) return invalid();

  // Account balance changes are routine. Lock the account's creation time here
  // and recheck eligibility in the caller's transaction after the POST.
  return hash(['reviewed-voice-reserve-sources-v1', required.map(([name, doc]) =>
    [name, name === 'account' ? doc.createTime : doc]), reserveMovement, billingOutbox, externalVersions]);
}

/**
 * Called inside the trusted preflight transaction with its just-read reviewed
 * source and financial documents. This builds evidence for the existing
 * attempt journal; it cannot authenticate a principal or make a reservation.
 */
export function createReviewedVoiceReserveAttempt(attemptId:unknown, value:unknown, sourceVersions:unknown,
  binding:ReviewedVoiceBinding, requestKey:string, markerVersion:unknown):ReserveAttemptEvidenceV2 {
  try {
    const operation = voiceOperation(value);
    const witness = copyWitness(value, operation, 2), versions = copyVersions(sourceVersions);
    const marker = createReviewedVoiceMarker(binding, requestKey, operation);
    if (witness.accountId !== marker.accountId || witness.inputId !== marker.inputId ||
        witness.identityKey !== marker.identityKey || witness.revision !== marker.revision ||
        witness.seconds !== marker.billableSeconds || witness.intentId !== hash([marker.accountId, requestKey]) ||
        witness.reservationId !== videoReservationId(marker.accountId, marker.identityKey, marker.inputId, operation, marker.revision, requestKey)) return invalid();
    const voice = voiceProof({markerId:marker.markerId, markerFingerprint:marker.fingerprint, markerVersion,
      sourceVersionsSha256:reviewedSourceHistory(binding, versions)});
    if (attemptId !== witness.reservationId) return invalid();
    return Object.freeze({version:2, attemptId, witness, versions, voice});
  } catch (error) {
    if (error instanceof ReserveAttemptEvidenceFault) throw error;
    return invalid();
  }
}

/**
 * Compare the original history to a fresh authorized reading before work is
 * committed. The caller must separately check the financial preflight window,
 * the persisted marker's contents and the authority of the direct Account response.
 */
export function matchesReviewedVoiceReserveSource(value:ReserveAttemptEvidenceV2, binding:ReviewedVoiceBinding,
  requestKey:string, markerVersion:unknown):boolean {
  try {
    const attempt = copyAttempt(value);
    if (attempt.version !== 2) return false;
    const marker = createReviewedVoiceMarker(binding, requestKey, attempt.witness.operation);
    const {witness, voice} = attempt, currentMarker = version(markerVersion);
    return voice.markerId === marker.markerId && voice.markerFingerprint === marker.fingerprint &&
      currentMarker.exists && voice.markerVersion.createTime === currentMarker.createTime &&
      voice.markerVersion.updateTime === currentMarker.updateTime &&
      witness.accountId === marker.accountId && witness.inputId === marker.inputId &&
      witness.identityKey === marker.identityKey && witness.revision === marker.revision && witness.seconds === marker.billableSeconds &&
      witness.intentId === hash([marker.accountId, requestKey]) &&
      witness.reservationId === videoReservationId(marker.accountId, marker.identityKey, marker.inputId, marker.operation, marker.revision, requestKey) &&
      voice.sourceVersionsSha256 === reviewedSourceHistory(binding);
  } catch {
    return false;
  }
}

function copyAttempt(value:unknown):ReserveAttemptEvidence {
  try {
    const format = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'version') : undefined;
    if (!format || !('value' in format) || (format.value !== 1 && format.value !== 2)) return invalid();
    const common = ['version','attemptId','witness','versions'];
    const row = exact(value, format.value === 1 ? common : [...common, 'voice']);
    if (typeof row.attemptId !== 'string' || !uuidV4.test(row.attemptId)) return invalid();
    if (format.value === 1) {
      return Object.freeze({version:1, attemptId:row.attemptId,
        witness:copyWitness(row.witness, 'translation:en', 1), versions:copyVersions(row.versions)});
    }
    const witness = copyWitness(row.witness, voiceOperation(row.witness), 2);
    if (row.attemptId !== witness.reservationId) return invalid();
    return Object.freeze({version:2, attemptId:row.attemptId, witness,
      versions:copyVersions(row.versions), voice:voiceProof(row.voice)});
  } catch (error) {
    if (error instanceof ReserveAttemptEvidenceFault) throw error;
    return invalid();
  }
}
function copyAck(value:unknown, expected:ReserveAttemptEvidence['witness']):ReserveAck {
  try {
    const row = exact(value, ['reservationId','seconds','state']);
    if (row.reservationId !== expected.reservationId || row.seconds !== expected.seconds || row.state !== 'reserved') return invalid();
    return Object.freeze({reservationId:expected.reservationId, seconds:expected.seconds, state:'reserved'});
  } catch (error) {
    if (error instanceof ReserveAttemptEvidenceFault) throw error;
    return invalid();
  }
}
function equalAttempt(actual:unknown, expected:ReserveAttemptEvidence):boolean {
  try { return JSON.stringify(copyAttempt(actual)) === JSON.stringify(expected); } catch { return false; }
}
function observation(attempt:ReserveAttemptEvidence) {
  const snapshot = attempt.version === 1 ? {versions:attempt.versions} : {versions:attempt.versions, voice:attempt.voice};
  return Object.freeze({version:attempt.version, attemptId:attempt.attemptId, ...attempt.witness,
    source:'reserve_ack' as const, state:'reserved' as const, attribution:'unverified' as const,
    snapshot:Object.freeze(snapshot)});
}
function equalObservation(actual:unknown, attempt:ReserveAttemptEvidence):boolean {
  try {
    const row = exact(actual, ['version','attemptId',...witnessFields,'source','state','attribution','snapshot']);
    if (row.source !== 'reserve_ack' || row.state !== 'reserved' || row.attribution !== 'unverified') return false;
    const snapshot = exact(row.snapshot, attempt.version === 1 ? ['versions'] : ['versions','voice']);
    const witness:Record<string,unknown> = {};
    for (const field of witnessFields) witness[field] = row[field];
    const versioned = attempt.version === 1 ? {} : {voice:snapshot.voice};
    const reconstructed = copyAttempt({version:row.version, attemptId:row.attemptId, witness, versions:snapshot.versions, ...versioned});
    return JSON.stringify(reconstructed) === JSON.stringify(attempt);
  } catch { return false; }
}
/** Correlation of detached evidence does not authorize replay or attribute an owner. */
export function matchesReviewedVoiceReserveAck(prepared:ReserveAttemptEvidenceV2,ack:unknown):boolean {
  try{return equalObservation(ack,copyAttempt(prepared));}catch{return false;}
}
/** A replay may disclose existing work only after reading both durable records. */
export function verifyReviewedVoiceReserveReplay(prepared:unknown, ack:unknown, binding:ReviewedVoiceBinding,
  requestKey:string, operation:string, markerVersion:unknown):boolean {
  try {
    const attempt = copyAttempt(prepared);
    return attempt.version === 2 && attempt.witness.operation === operation &&
      matchesReviewedVoiceReserveSource(attempt,binding,requestKey,markerVersion) && equalObservation(ack,attempt);
  } catch {
    return false;
  }
}
function refs(root:DocumentReference, attemptId:string) {
  return {prepared:root.collection('billingReserveAttempts').doc(attemptId), ack:root.collection('billingReserveAckObservations').doc(attemptId)};
}
function data(doc:DocumentSnapshot):unknown { return doc.exists ? doc.data() : undefined; }

/**
 * Last step in a trusted caller's pre-POST transaction. Generate attemptId
 * outside the Firestore transaction so SDK retries retain the same ID.
 * A repeated attempt is a receipt only, never permission to send another POST.
 * Treat the return value as committed only after runTransaction resolves.
 */
export async function prepareReserveAttemptInTransaction(tx:Transaction, root:DocumentReference,
  value:ReserveAttemptEvidence):Promise<ReserveAttemptPrepareResult> {
  const attempt = copyAttempt(value), target = refs(root, attempt.attemptId);
  const [prepared, ack] = await tx.getAll(target.prepared, target.ack);
  if (!prepared.exists) {
    if (ack.exists) return conflict(); // Never reconstruct a missing prior witness.
    tx.create(target.prepared, attempt);
    return Object.freeze({state:'created', observation:'unknown'});
  }
  if (!equalAttempt(data(prepared), attempt) || ack.exists && !equalObservation(data(ack), attempt)) return conflict();
  return Object.freeze({state:'already_prepared', observation:ack.exists?'ack_recorded':'unknown'});
}

/**
 * Call only for a direct, validated POST response, never for status. Its three
 * fields alone cannot prove response provenance or the reservation owner. An
 * unavailable DB or lost commit response after ACK is UNKNOWN to the caller;
 * do not invent a receipt. Retrying the same observed ACK is idempotent.
 */
export async function recordReserveAckInTransaction(tx:Transaction, root:DocumentReference,
  value:ReserveAttemptEvidence, observed:ReserveAck):Promise<ReserveAckRecordResult> {
  const attempt = copyAttempt(value); copyAck(observed, attempt.witness);
  const target = refs(root, attempt.attemptId), [prepared, ack] = await tx.getAll(target.prepared, target.ack);
  if (!prepared.exists || !equalAttempt(data(prepared), attempt)) return conflict();
  if (ack.exists) {
    if (!equalObservation(data(ack), attempt)) return conflict();
    return Object.freeze({state:'already_recorded', attribution:'unverified'});
  }
  tx.create(target.ack, observation(attempt));
  return Object.freeze({state:'recorded', attribution:'unverified'});
}
/**
 * Same validation and writes as `recordReserveAckInTransaction`, but the caller has
 * already read `prepared` and `ack` in ITS transaction, so the ACK create can be
 * bundled with the job's writes. Pass exactly the two documents read there.
 */
export function stageReserveAck(tx:Transaction, root:DocumentReference, value:ReserveAttemptEvidence, observed:ReserveAck,
  prepared:DocumentSnapshot, ack:DocumentSnapshot):ReserveAckRecordResult {
  const attempt = copyAttempt(value); copyAck(observed, attempt.witness);
  const target = refs(root, attempt.attemptId);
  if (!prepared.exists || !equalAttempt(data(prepared), attempt)) return conflict();
  if (ack.exists) {
    if (!equalObservation(data(ack), attempt)) return conflict();
    return Object.freeze({state:'already_recorded', attribution:'unverified'});
  }
  tx.create(target.ack, observation(attempt));
  return Object.freeze({state:'recorded', attribution:'unverified'});
}
