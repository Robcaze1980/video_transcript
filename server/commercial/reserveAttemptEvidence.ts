import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

/**
 * Disconnected candidate. These records are evidence, not authorization,
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
export type ReserveAttemptEvidence = ReserveAttemptEvidenceV1;
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
function copyWitnessV1(value:unknown):ReserveAttemptWitnessV1 {
  const row = exact(value, witnessFields);
  if (typeof row.intentId !== 'string' || !hex64.test(row.intentId) ||
      typeof row.accountId !== 'string' || !uuid.test(row.accountId) ||
      typeof row.inputId !== 'string' || !uuid.test(row.inputId) || row.operation !== 'translation:en' ||
      !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || row.profile !== RESERVE_ATTEMPT_PROFILE_V1 ||
      row.provider !== 'account_seconds' || typeof row.identityKey !== 'string' || !hex64.test(row.identityKey) ||
      typeof row.reservationId !== 'string' || !uuidV4.test(row.reservationId) ||
      !Number.isSafeInteger(row.seconds) || Number(row.seconds) < 1 || Number(row.seconds) > 600) return invalid();
  return Object.freeze({
    intentId:row.intentId, accountId:row.accountId, inputId:row.inputId, operation:row.operation,
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
function copyAttemptV1(value:unknown):ReserveAttemptEvidenceV1 {
  try {
    const row = exact(value, ['version','attemptId','witness','versions']);
    if (row.version !== 1 || typeof row.attemptId !== 'string' || !uuidV4.test(row.attemptId)) return invalid();
    return Object.freeze({version:1, attemptId:row.attemptId, witness:copyWitnessV1(row.witness), versions:copyVersions(row.versions)});
  } catch (error) {
    if (error instanceof ReserveAttemptEvidenceFault) throw error;
    return invalid();
  }
}
function copyAck(value:unknown, expected:ReserveAttemptWitnessV1):ReserveAck {
  try {
    const row = exact(value, ['reservationId','seconds','state']);
    if (row.reservationId !== expected.reservationId || row.seconds !== expected.seconds || row.state !== 'reserved') return invalid();
    return Object.freeze({reservationId:expected.reservationId, seconds:expected.seconds, state:'reserved'});
  } catch (error) {
    if (error instanceof ReserveAttemptEvidenceFault) throw error;
    return invalid();
  }
}
function equalAttempt(actual:unknown, expected:ReserveAttemptEvidenceV1):boolean {
  try { return JSON.stringify(copyAttemptV1(actual)) === JSON.stringify(expected); } catch { return false; }
}
function observation(attempt:ReserveAttemptEvidenceV1) {
  return Object.freeze({version:1 as const, attemptId:attempt.attemptId, ...attempt.witness,
    source:'reserve_ack' as const, state:'reserved' as const, attribution:'unverified' as const,
    snapshot:Object.freeze({versions:attempt.versions})});
}
function equalObservation(actual:unknown, attempt:ReserveAttemptEvidenceV1):boolean {
  try {
    const row = exact(actual, ['version','attemptId',...witnessFields,'source','state','attribution','snapshot']);
    if (row.source !== 'reserve_ack' || row.state !== 'reserved' || row.attribution !== 'unverified') return false;
    const snapshot = exact(row.snapshot, ['versions']);
    const witness:Record<string,unknown> = {};
    for (const field of witnessFields) witness[field] = row[field];
    const reconstructed = copyAttemptV1({version:row.version, attemptId:row.attemptId, witness, versions:snapshot.versions});
    return JSON.stringify(reconstructed) === JSON.stringify(attempt);
  } catch { return false; }
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
  value:ReserveAttemptEvidenceV1):Promise<ReserveAttemptPrepareResult> {
  const attempt = copyAttemptV1(value), target = refs(root, attempt.attemptId);
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
  value:ReserveAttemptEvidenceV1, observed:ReserveAck):Promise<ReserveAckRecordResult> {
  const attempt = copyAttemptV1(value); copyAck(observed, attempt.witness);
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
export function stageReserveAck(tx:Transaction, root:DocumentReference, value:ReserveAttemptEvidenceV1, observed:ReserveAck,
  prepared:DocumentSnapshot, ack:DocumentSnapshot):ReserveAckRecordResult {
  const attempt = copyAttemptV1(value); copyAck(observed, attempt.witness);
  const target = refs(root, attempt.attemptId);
  if (!prepared.exists || !equalAttempt(data(prepared), attempt)) return conflict();
  if (ack.exists) {
    if (!equalObservation(data(ack), attempt)) return conflict();
    return Object.freeze({state:'already_recorded', attribution:'unverified'});
  }
  tx.create(target.ack, observation(attempt));
  return Object.freeze({state:'recorded', attribution:'unverified'});
}
