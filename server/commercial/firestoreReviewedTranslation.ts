import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type { DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import {
  AI_CATALOG_VERSION, AI_TEXT_FILE_MAX, artifactPlanHash, validateArtifactManifest, validateArtifactPlan,
  type AiArtifactReceipt,
} from './aiContracts';
import type { FirestoreBackend, Job } from './firestoreBackend';
import type { CloudObject, CloudObjects } from './gcsObjects';
import { JobError } from './jobs';
import { privateSha, privateUuid, readyPrivateInput } from './privateObjectPlan';
import {
  REVIEWED_CUE_MAX_BYTES, REVIEWED_DRAFT_MAX_BYTES, reviewTranslation, validateTranslationSource,
  type ReviewedTranslation, type ValidatedTranslationSource,
} from './reviewedTranslation';

/** Local candidate only. Consolidate authorization with FirestoreAi before integration. */
export class ReviewedTranslationFault extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'conflict' | 'disabled' | 'unavailable') { super(code); }
}
/** The HTTP router must verify Firebase first; Firestore only rechecks this UID's account binding. */
export type ReviewedTranslationPrincipal = Readonly<{ accountId: string; uid: string }>;

/** In-memory observations are evidence to compare, never an authorization token. */
export type ReviewedVoiceDocumentVersion = Readonly<{
  exists: boolean; createTime: string | null; updateTime: string | null;
}>;
export type ReviewedVoiceSourceVersions = Readonly<{
  principalIdentity: ReviewedVoiceDocumentVersion; account: ReviewedVoiceDocumentVersion;
  input: ReviewedVoiceDocumentVersion; project: ReviewedVoiceDocumentVersion;
  textJob: ReviewedVoiceDocumentVersion; artifact: ReviewedVoiceDocumentVersion;
  terminal: ReviewedVoiceDocumentVersion; accounting: ReviewedVoiceDocumentVersion;
  reserveMovement: ReviewedVoiceDocumentVersion; billingOutbox: ReviewedVoiceDocumentVersion;
  review: ReviewedVoiceDocumentVersion; receipt: ReviewedVoiceDocumentVersion;
  /** Present only for a verified account_seconds text job. */
  external?: Readonly<{
    payerIdentity: ReviewedVoiceDocumentVersion; intent: ReviewedVoiceDocumentVersion;
    origin: ReviewedVoiceDocumentVersion; request: ReviewedVoiceDocumentVersion;
    jobMarker: ReviewedVoiceDocumentVersion; intentGuard: ReviewedVoiceDocumentVersion;
  }>;
}>;
export type ReviewedVoiceBinding = Readonly<{
  version: 'reviewed-voice-binding-v1'; identityKey: string; accountId: string; inputId: string;
  textJobId: string; revision: number; reviewId: string; receiptId: string; bindingHash: string;
  payloadSha256: string; voiceTextSha256: string; inputGeneration: string; inputSha256: string;
  durationMs: number; billableSeconds: number; versions: ReviewedVoiceSourceVersions;
  /** Sensitive synthetic/real text can occur here; never log or persist this copy. */
  canonicalEvidence: Readonly<{
    accountId: string; inputId: string; textJobId: string; revision: number; bindingHash: string;
    reviewId: string; review: Readonly<Record<string, unknown>>;
    receiptId: string; receipt: Readonly<Record<string, unknown>>;
  }>;
}>;

type Edit = Readonly<{ id: string; en: string }>;
type SaveRequest = Readonly<{ inputId: string; jobId: string; expectedRevision: number; requestKey: string; edits: readonly Edit[] }>;
type DownloadRequest = Readonly<{ inputId: string; jobId: string; revision: number; format: 'txt' | 'srt' }>;
type AuthorizedSource = Readonly<{
  jobId: string; projectRevision: number; projectReviewJobId: string | null; jobRevision: number; durationMs: number; billableSeconds: number;
  projectDraft: string; projectReviewedRevision: number | null; projectReviewedSha256: string | null; jobSnapshotSha256: string;
  bindingHash: string; entry: AiArtifactReceipt;
}>;

const maxStoredPayloadBytes = 512 * 1024;
const controls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => sha(JSON.stringify(value));

function fault(code: ReviewedTranslationFault['code']): never { throw new ReviewedTranslationFault(code); }
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !privateUuid.test(value)) return fault('invalid');
  return value;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) return fault('invalid');
  return value as number;
}
function exactObject(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fault('invalid');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fault('invalid');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) return fault('invalid');
  const copy: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !('value' in descriptor)) return fault('invalid');
    copy[name] = descriptor.value;
  }
  return copy;
}

function voiceDocumentVersion(doc: DocumentSnapshot): ReviewedVoiceDocumentVersion {
  if (!doc.exists) return Object.freeze({ exists: false, createTime: null, updateTime: null });
  const version = (value: DocumentSnapshot['createTime']): string => {
    if (!value || !Number.isSafeInteger(value.seconds) || value.seconds < 0 ||
        !Number.isSafeInteger(value.nanoseconds) || value.nanoseconds < 0 || value.nanoseconds >= 1_000_000_000) return fault('not_found');
    return `${value.seconds}:${String(value.nanoseconds).padStart(9, '0')}`;
  };
  return Object.freeze({ exists: true, createTime: version(doc.createTime), updateTime: version(doc.updateTime) });
}

const voiceReviewFields = ['version', 'accountId', 'inputId', 'jobId', 'expectedRevision', 'revision', 'bindingHash',
  'fingerprint', 'baseHash', 'receiptId', 'payload', 'payloadSha256', 'voiceSha256', 'createdAtMs'] as const;
const voiceReceiptFields = ['version', 'accountId', 'inputId', 'jobId', 'expectedRevision', 'committedRevision', 'bindingHash',
  'fingerprint', 'baseHash', 'reviewId', 'payloadSha256', 'voiceSha256', 'createdAtMs'] as const;
function copyPrincipal(value: unknown): ReviewedTranslationPrincipal {
  const caller = exactObject(value, ['accountId', 'uid']), accountId = identifier(caller.accountId), uid = caller.uid;
  if (typeof uid !== 'string' || !uid || uid.length > 128 || controls.test(uid) || Buffer.from(uid, 'utf8').toString('utf8') !== uid) return fault('invalid');
  return Object.freeze({ accountId, uid });
}
function copyEdits(value: unknown): readonly Edit[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1_000 || Reflect.ownKeys(value).length !== value.length + 1) return fault('invalid');
  const edits: Edit[] = [];
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) return fault('invalid');
    const edit = exactObject(descriptor.value, ['id', 'en']);
    if (typeof edit.id !== 'string' || !privateSha.test(edit.id) || typeof edit.en !== 'string' ||
        edit.en.length > REVIEWED_CUE_MAX_BYTES || !edit.en.trim() || controls.test(edit.en)) return fault('invalid');
    const encoded = Buffer.from(edit.en, 'utf8');
    if (encoded.length > REVIEWED_CUE_MAX_BYTES || encoded.toString('utf8') !== edit.en) return fault('invalid');
    bytes += encoded.length + 1;
    if (bytes > REVIEWED_DRAFT_MAX_BYTES) return fault('invalid');
    edits.push(Object.freeze({ id: edit.id, en: edit.en }));
  }
  return Object.freeze(edits);
}
function copySaveRequest(value: unknown): SaveRequest {
  const input = exactObject(value, ['inputId', 'jobId', 'expectedRevision', 'requestKey', 'edits']);
  const inputId = identifier(input.inputId), jobId = identifier(input.jobId), expectedRevision = revision(input.expectedRevision);
  if (expectedRevision >= Number.MAX_SAFE_INTEGER) return fault('invalid');
  if (typeof input.requestKey !== 'string' || !input.requestKey.trim() || input.requestKey.length > 200 || controls.test(input.requestKey) ||
      Buffer.from(input.requestKey, 'utf8').toString('utf8') !== input.requestKey) return fault('invalid');
  return Object.freeze({ inputId, jobId, expectedRevision, requestKey: input.requestKey, edits: copyEdits(input.edits) });
}
function copyDownloadRequest(value: unknown): DownloadRequest {
  const input = exactObject(value, ['inputId', 'jobId', 'revision', 'format']);
  if (input.format !== 'txt' && input.format !== 'srt') return fault('invalid');
  return Object.freeze({ inputId: identifier(input.inputId), jobId: identifier(input.jobId), revision: revision(input.revision), format: input.format });
}
function captureMovement(doc: DocumentSnapshot, accountId: string, jobId: string, price: number, kind: 'capture' | 'external_capture') {
  return doc.exists && doc.get('accountId') === accountId && doc.get('reference') === jobId && doc.get('credits') === price && doc.get('kind') === kind;
}
function requestId(accountId: string, requestKey: string) { return digest(['review-request-v1', accountId, requestKey]); }
function reviewId(accountId: string, inputId: string, jobId: string, committedRevision: number) {
  return digest(['review-revision-v1', accountId, inputId, jobId, committedRevision]);
}
function contentFingerprint(accountId: string, inputId: string, jobId: string, expectedRevision: number, edits: readonly Edit[]) {
  return digest(['review-save-v1', accountId, inputId, jobId, expectedRevision, edits.map(edit => [edit.id, edit.en])]);
}
function requestFingerprint(accountId: string, input: SaveRequest) {
  return contentFingerprint(accountId, input.inputId, input.jobId, input.expectedRevision, input.edits);
}

/**
 * Private candidate; no HTTP route is registered here. Stored reviewed text and
 * receipts need an explicit deletion/retention and index policy before use.
 * The authorization code duplicates FirestoreAi's private checks on purpose;
 * consolidation and independent review are required before integration.
 */
export class FirestoreReviewedTranslation {
  constructor(
    private readonly db: Firestore,
    private readonly root: DocumentReference,
    private readonly backend: FirestoreBackend,
    private readonly objects: Pick<CloudObjects, 'read'>,
  ) {}

  /** Used only by the local voice fixture to reject mixed-root service wiring. */
  usesLocalVoiceFixture(root:DocumentReference,backend:FirestoreBackend):boolean {
    return root.firestore===this.db&&root.isEqual(this.root)&&backend===this.backend;
  }

  private ref(collection: string, id: string) { return this.root.collection(collection).doc(id); }

  private async authorize(tx: Transaction, principal: ReviewedTranslationPrincipal, inputId: string, jobId: string): Promise<AuthorizedSource> {
    const { accountId, uid } = principal;
    const [requester, accountDoc, inputDoc, jobDoc, artifactDoc, projectDoc, movementDoc, billingDoc] = await tx.getAll(
      this.ref('identities', digest(['firebase', uid])), this.ref('accounts', accountId), this.ref('inputs', inputId), this.ref('jobs', jobId), this.ref('artifacts', jobId),
      this.ref('projects', inputId), this.ref('movements', `terminal:${jobId}`), this.ref('billingOutbox', jobId),
    );
    if (!requester.exists || requester.get('uid') !== uid || requester.get('accountId') !== accountId) return fault('not_found');
    if (!accountDoc.exists || accountDoc.get('aiPilot') !== true || accountDoc.get('simulationOnly') !== true) return fault('disabled');
    const input = inputDoc.data(), job = jobDoc.data(), artifact = artifactDoc.data(), project = projectDoc.data();
    if (!input || !job || !artifact || !project || input.accountId !== accountId || job.accountId !== accountId ||
        artifact.accountId !== accountId || project.accountId !== accountId || job.inputId !== inputId ||
        artifact.inputId !== inputId || artifact.jobId !== jobId || project.inputId !== inputId) return fault('not_found');
    if (job.operation !== 'translation:en' || job.aiProfile !== AI_CATALOG_VERSION || job.state !== 'succeeded' || artifact.state !== 'ready' ||
        input.deleted !== false || !Number.isSafeInteger(input.expiresAtMs) || input.expiresAtMs <= Date.now() ||
        !Number.isSafeInteger(artifact.expiresAtMs) || artifact.expiresAtMs <= Date.now() || !readyPrivateInput(input, inputId)) return fault('not_found');
    if (!Number.isSafeInteger(job.revision) || job.revision < 1 || !Number.isSafeInteger(project.revision) || project.revision < 1 ||
        typeof project.draft !== 'string' || Buffer.byteLength(project.draft, 'utf8') > REVIEWED_DRAFT_MAX_BYTES ||
        !Number.isSafeInteger(job.price) || job.price < 1 || artifact.revision !== job.revision ||
        typeof job.snapshotSha256 !== 'string' || !privateSha.test(job.snapshotSha256) || artifact.snapshotSha256 !== job.snapshotSha256 ||
        typeof artifact.attemptId !== 'string' || !privateUuid.test(artifact.attemptId)) return fault('not_found');
    const metadata = (input as { metadata?: { duration?: number; audioTracks?: number } }).metadata;
    const duration = metadata?.duration, audioTracks = metadata?.audioTracks;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 600 || !Number.isSafeInteger(audioTracks) || audioTracks < 1 ||
        job.price !== Math.ceil(duration)) return fault('not_found');
    const durationMs = Math.floor(duration * 1_000);
    if (!Number.isSafeInteger(durationMs) || durationMs < 1) return fault('not_found');
    const source = input.storage, jobSource = job.inputStorage;
    if (!jobSource || source.bucket !== jobSource.bucket || source.key !== jobSource.key || source.generation !== jobSource.generation ||
        source.size !== jobSource.size || source.sha256 !== jobSource.sha256 || input.sha256 !== job.inputSha256 ||
        input.sha256 !== artifact.inputSha256 || source.generation !== artifact.sourceGeneration) return fault('not_found');

    // The durable accounting classification and reserve evidence determine the
    // branch. A missing externalBilling field alone is never proof of simulation.
    const accounting = await this.backend.jobAccounting(tx, jobId, job as Job);
    if (accounting === 'unverified') return fault('not_found');
    let payment: readonly unknown[];
    if (accounting === 'simulation') {
      if (billingDoc.exists || !captureMovement(movementDoc, accountId, jobId, job.price, 'capture')) return fault('not_found');
      payment = ['simulation', job.price];
    } else {
      const billing = job.externalBilling;
      if (!billing || typeof billing !== 'object' || Array.isArray(billing) || billing.provider !== 'account_seconds' ||
          typeof billing.identityKey !== 'string' || !privateSha.test(billing.identityKey) || typeof billing.reservationId !== 'string' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/i.test(billing.reservationId) ||
          !Number.isSafeInteger(billing.seconds) || billing.seconds !== job.price || billing.seconds > 600 ||
          !captureMovement(movementDoc, accountId, jobId, job.price, 'external_capture') ||
          typeof job.completedAttemptId !== 'string' || !privateUuid.test(job.completedAttemptId) ||
          artifact.attemptId !== job.completedAttemptId || !billingDoc.exists || billingDoc.get('state') !== 'settled' ||
          billingDoc.get('action') !== 'capture' || billingDoc.get('accountId') !== accountId || billingDoc.get('jobId') !== jobId ||
          billingDoc.get('provider') !== billing.provider || billingDoc.get('identityKey') !== billing.identityKey ||
          billingDoc.get('reservationId') !== billing.reservationId || billingDoc.get('seconds') !== billing.seconds ||
          billingDoc.get('attemptId') !== job.completedAttemptId) return fault('not_found');
      const identity = await tx.get(this.ref('identities', billing.identityKey)), billingUid = identity.get('uid');
      if (!identity.exists || identity.get('accountId') !== accountId || typeof billingUid !== 'string' || !billingUid || billingUid.length > 128 ||
          digest(['firebase', billingUid]) !== billing.identityKey) return fault('not_found');
      if (!await this.backend.externalJobResultAllowed(tx, jobId, job as Job)) return fault('not_found');
      payment = ['account_seconds', billing.identityKey, billing.reservationId, billing.seconds, job.completedAttemptId];
    }

    let entries: AiArtifactReceipt[];
    try {
      const plan = validateArtifactPlan(artifact.plan);
      if (plan.jobId !== jobId || plan.inputId !== inputId || plan.operation !== job.operation || artifact.planHash !== artifactPlanHash(plan)) return fault('not_found');
      entries = validateArtifactManifest(plan, artifact.entries);
    } catch { return fault('not_found'); }
    const entry = entries.find(item => item.name === 'cues.json');
    if (!entry || entry.mimeType !== 'application/json; charset=utf-8' || entry.size > AI_TEXT_FILE_MAX ||
        artifact.quotaMode !== 'committed' || artifact.quotaHeld !== entries.reduce((sum, item) => sum + item.size, 0)) return fault('not_found');
    const bindingHash = digest([
      'review-source-v1', accountId, inputId, jobId, job.revision, job.price, job.snapshotSha256,
      source.bucket, source.key, source.generation, source.size, source.sha256, durationMs,
      artifact.planHash, artifact.attemptId, entries, payment,
    ]);
    return Object.freeze({
      jobId,
      projectRevision: project.revision, projectReviewJobId: typeof project.reviewJobId === 'string' ? project.reviewJobId : null,
      projectDraft: project.draft,
      projectReviewedRevision: Number.isSafeInteger(project.reviewedTextRevision) ? project.reviewedTextRevision : null,
      projectReviewedSha256: typeof project.reviewedTextSha256 === 'string' ? project.reviewedTextSha256 : null,
      jobSnapshotSha256: job.snapshotSha256,
      // Price is in source-video seconds and was checked above against the
      // ORIGINAL duration, before millisecond truncation.
      jobRevision: job.revision, durationMs, billableSeconds: job.price, bindingHash, entry: Object.freeze({ ...entry }),
    });
  }

  private async readSourceBytes(authorization: AuthorizedSource): Promise<ValidatedTranslationSource> {
    const entry = authorization.entry;
    const object: CloudObject = { key: entry.key, generation: entry.generation, size: entry.size };
    let stream;
    try { stream = await this.objects.read(object); } catch { return fault('unavailable'); }
    if (!stream || typeof stream.destroy !== 'function' || typeof stream[Symbol.asyncIterator] !== 'function') return fault('unavailable');
    const pieces: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => stream.destroy(Error('Source read timed out')), 120_000);
    timer.unref();
    try {
      for await (const part of stream) {
        if (!(part instanceof Uint8Array)) return fault('unavailable');
        size += part.byteLength;
        if (size > entry.size || size > AI_TEXT_FILE_MAX) return fault('unavailable');
        pieces.push(Buffer.from(part));
      }
      if (size !== entry.size) return fault('unavailable');
      const bytes = Buffer.concat(pieces, size);
      if (sha(bytes) !== entry.sha256) return fault('unavailable');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const parsed: unknown = JSON.parse(text);
      const source = validateTranslationSource(authorization.jobId, parsed);
      if (source.durationMs !== authorization.durationMs) return fault('unavailable');
      return source;
    } catch (error) {
      if (error instanceof ReviewedTranslationFault) throw error;
      return fault('unavailable');
    } finally {
      clearTimeout(timer);
      stream.destroy();
    }
  }

  async readSource(caller: ReviewedTranslationPrincipal, inputId: string, jobId: string) {
    const principal = copyPrincipal(caller), { accountId } = principal; inputId = identifier(inputId); jobId = identifier(jobId);
    const first = await this.db.runTransaction(async tx => {
      const authorization = await this.authorize(tx, principal, inputId, jobId);
      const reviewed = await this.verifiedCurrentReview(tx, accountId, inputId, jobId, authorization);
      return { authorization, reviewed };
    });
    const before = first.authorization;
    if (first.reviewed) return Object.freeze({ projectRevision: before.projectRevision, jobRevision: before.jobRevision,
      durationMs: first.reviewed.durationMs, status: 'reviewed' as const, cues: first.reviewed.cues });
    const source = await this.readSourceBytes(before);
    return this.db.runTransaction(async tx => {
      const current = await this.authorize(tx, principal, inputId, jobId);
      if (before.bindingHash !== current.bindingHash || before.projectRevision !== current.projectRevision ||
          before.projectDraft !== current.projectDraft || before.projectReviewJobId !== current.projectReviewJobId ||
          before.projectReviewedRevision !== current.projectReviewedRevision || before.projectReviewedSha256 !== current.projectReviewedSha256) return fault('conflict');
      const common = { projectRevision: current.projectRevision, jobRevision: current.jobRevision, durationMs: source.durationMs };
      const unlinked = (reason: 'unlinked_draft' | 'incomplete_review_link') => Object.freeze({
        ...common, status: 'legacy' as const, reason, cues: source.cues, legacyDraft: current.projectDraft,
      });
      if (current.projectReviewJobId === jobId) {
        const saved = await this.verifiedCurrentReview(tx, accountId, inputId, jobId, current);
        if (!saved) return unlinked('incomplete_review_link');
        return Object.freeze({ ...common, status: 'reviewed' as const, cues: saved.cues });
      }
      if (current.jobRevision === current.projectRevision && current.projectDraft === '' && sha(current.projectDraft) === current.jobSnapshotSha256) {
        return Object.freeze({ ...common, status: 'original' as const, cues: source.cues });
      }
      // An unlinked flat draft (including a deliberately empty one) has no
      // trustworthy segment/timing mapping. Return it separately, untouched.
      return unlinked('unlinked_draft');
    });
  }

  private savedReview(snapshot: DocumentSnapshot, accountId: string, inputId: string, jobId: string, expectedRevision: number,
    committedRevision: number, authorization: AuthorizedSource, receipt: DocumentSnapshot, expectedFingerprint?: string): ReviewedTranslation {
    const row = snapshot.data(), proof = receipt.data();
    if (!row || !proof || row.version !== 1 || row.accountId !== accountId || row.inputId !== inputId || row.jobId !== jobId ||
        row.expectedRevision !== expectedRevision || row.revision !== committedRevision || row.bindingHash !== authorization.bindingHash ||
        row.receiptId !== receipt.id || proof.version !== 1 || proof.accountId !== accountId || proof.inputId !== inputId ||
        proof.jobId !== jobId || proof.expectedRevision !== expectedRevision || proof.committedRevision !== committedRevision ||
        proof.reviewId !== snapshot.id || proof.bindingHash !== authorization.bindingHash || proof.fingerprint !== row.fingerprint ||
        proof.baseHash !== row.baseHash || typeof row.baseHash !== 'string' || !privateSha.test(row.baseHash) ||
        proof.payloadSha256 !== row.payloadSha256 || proof.voiceSha256 !== row.voiceSha256 ||
        typeof row.payload !== 'string' || Buffer.byteLength(row.payload, 'utf8') > maxStoredPayloadBytes ||
        typeof row.payloadSha256 !== 'string' || !privateSha.test(row.payloadSha256) || sha(row.payload) !== row.payloadSha256 ||
        typeof row.voiceSha256 !== 'string' || !privateSha.test(row.voiceSha256) ||
        typeof row.fingerprint !== 'string' || !privateSha.test(row.fingerprint) ||
        (expectedFingerprint !== undefined && row.fingerprint !== expectedFingerprint)) return fault('not_found');
    try {
      const parsed: unknown = JSON.parse(row.payload);
      if (JSON.stringify(parsed) !== row.payload) return fault('not_found');
      const source = validateTranslationSource(jobId, parsed);
      if (source.durationMs !== authorization.durationMs) return fault('not_found');
      const reviewed = reviewTranslation(jobId, parsed, source.cues.map(cue => ({ id: cue.id, en: cue.en })));
      if (sha(reviewed.voiceText) !== row.voiceSha256 ||
          contentFingerprint(accountId, inputId, jobId, expectedRevision, reviewed.cues) !== row.fingerprint) return fault('not_found');
      return reviewed;
    } catch (error) {
      if (error instanceof ReviewedTranslationFault) throw error;
      return fault('not_found');
    }
  }

  private async priorReceipt(tx: Transaction, receipt: DocumentSnapshot, accountId: string, input: SaveRequest,
    authorization: AuthorizedSource, fingerprint: string, expectedBaseHash?: string): Promise<number | null> {
    if (!receipt.exists) return null;
    const row = receipt.data()!;
    if (row.version !== 1 || row.accountId !== accountId || row.inputId !== input.inputId || row.jobId !== input.jobId ||
        row.expectedRevision !== input.expectedRevision || row.fingerprint !== fingerprint || row.bindingHash !== authorization.bindingHash ||
        (expectedBaseHash !== undefined && row.baseHash !== expectedBaseHash) ||
        row.committedRevision !== input.expectedRevision + 1 ||
        row.reviewId !== reviewId(accountId, input.inputId, input.jobId, row.committedRevision)) return fault('conflict');
    const review = await tx.get(this.ref('reviewedTranslations', row.reviewId));
    this.savedReview(review, accountId, input.inputId, input.jobId, input.expectedRevision, row.committedRevision, authorization, receipt, fingerprint);
    return row.committedRevision;
  }

  private async verifiedCurrentReview(tx: Transaction, accountId: string, inputId: string, jobId: string,
    authorization: AuthorizedSource): Promise<ReviewedTranslation | null> {
    if (authorization.projectReviewJobId !== jobId || authorization.projectReviewedRevision !== authorization.projectRevision ||
        authorization.projectReviewedSha256 !== sha(authorization.projectDraft)) return null;
    const prior = await tx.get(this.ref('reviewedTranslations', reviewId(accountId, inputId, jobId, authorization.projectRevision)));
    const receiptId = prior.get('receiptId');
    if (typeof receiptId !== 'string' || !privateSha.test(receiptId)) return null;
    const receipt = await tx.get(this.ref('reviewRequests', receiptId));
    try {
      const saved = this.savedReview(prior, accountId, inputId, jobId, authorization.projectRevision - 1,
        authorization.projectRevision, authorization, receipt);
      return saved.voiceText === authorization.projectDraft ? saved : null;
    } catch (error) {
      if (error instanceof ReviewedTranslationFault && (error.code === 'not_found' || error.code === 'conflict')) return null;
      throw error;
    }
  }

  /**
   * Read a voice source using the caller's Firestore transaction. The caller
   * must have verified Firebase separately and must make its admission/write in
   * this SAME transaction. Returning a binding does not authorize a later call.
   *
   * `canonicalEvidence` contains private text and is for in-memory validation
   * only; only identifiers, hashes and document versions may be persisted.
   * `versions` describe this read, not a durable witness or a remote ACK. An
   * identity/document update, Account request or provider request after the
   * last transaction cannot be cancelled by this method.
   */
  async voiceBindingInTransaction(tx: Transaction, caller: ReviewedTranslationPrincipal, input: string, textJob: string,
    selectedRevision: number): Promise<ReviewedVoiceBinding> {
    // Copy all caller-provided primitives before the first await. This method is
    // internal: tx itself is trusted to belong to this service's Firestore.
    const principal = copyPrincipal(caller), { accountId, uid } = principal;
    const inputId = identifier(input), textJobId = identifier(textJob), selected = revision(selectedRevision);
    const identityKey = digest(['firebase', uid]);
    const authorization = await this.authorize(tx, principal, inputId, textJobId);
    if (selected < 2 || authorization.projectRevision !== selected || authorization.projectReviewJobId !== textJobId) return fault('not_found');
    const reviewed = await this.verifiedCurrentReview(tx, accountId, inputId, textJobId, authorization);
    if (!reviewed) return fault('not_found');

    const selectedReviewId = reviewId(accountId, inputId, textJobId, selected);
    const reviewDoc = await tx.get(this.ref('reviewedTranslations', selectedReviewId));
    const selectedReceiptId = reviewDoc.get('receiptId');
    if (typeof selectedReceiptId !== 'string' || !privateSha.test(selectedReceiptId)) return fault('not_found');
    const [principalIdentity, accountDoc, inputDoc, projectDoc, jobDoc, artifactDoc, terminalDoc, accountingDoc,
      reserveMovementDoc, billingDoc, receiptDoc] = await tx.getAll(
      this.ref('identities', identityKey), this.ref('accounts', accountId), this.ref('inputs', inputId), this.ref('projects', inputId),
      this.ref('jobs', textJobId), this.ref('artifacts', textJobId), this.ref('movements', `terminal:${textJobId}`),
      this.ref('jobAccounting', textJobId), this.ref('movements', `reserve:${textJobId}`),
      this.ref('billingOutbox', textJobId), this.ref('reviewRequests', selectedReceiptId),
    );
    // Keep the exact source version; do not normalize unknown future record
    // shapes into a version that the canonical voice validator could accept.
    let review: Readonly<Record<string, unknown>>, receipt: Readonly<Record<string, unknown>>;
    try {
      review = Object.freeze(exactObject(reviewDoc.data(), voiceReviewFields));
      receipt = Object.freeze(exactObject(receiptDoc.data(), voiceReceiptFields));
    } catch { return fault('not_found'); }
    if (!Number.isSafeInteger(review.createdAtMs) || Number(review.createdAtMs) < 0 ||
        !Number.isSafeInteger(receipt.createdAtMs) || review.createdAtMs !== receipt.createdAtMs ||
        typeof review.payloadSha256 !== 'string' || !privateSha.test(review.payloadSha256) ||
        typeof review.voiceSha256 !== 'string' || !privateSha.test(review.voiceSha256)) return fault('not_found');
    const source = inputDoc.data()?.storage, job = jobDoc.data();
    if (!source || typeof source.generation !== 'string' || typeof source.sha256 !== 'string' ||
        !privateSha.test(source.sha256) || !job) return fault('not_found');

    let external: ReviewedVoiceSourceVersions['external'];
    if (job.externalBilling !== undefined) {
      const billing = job.externalBilling;
      if (!billing || typeof billing.identityKey !== 'string' || !privateSha.test(billing.identityKey) ||
          typeof job.requestKey !== 'string' || !job.requestKey) return fault('not_found');
      const intentId = digest([accountId, job.requestKey]);
      const [payerIdentity, intent, origin, request, jobMarker, intentGuard] = await tx.getAll(
        this.ref('identities', billing.identityKey), this.ref('billingIntents', intentId),
        this.ref('billingIntentWitnesses', intentId), this.ref('requests', intentId),
        this.ref('billingIntentJobMarkers', intentId), this.ref('billingIntentAdmissionGuards', intentId),
      );
      external = Object.freeze({ payerIdentity: voiceDocumentVersion(payerIdentity), intent: voiceDocumentVersion(intent),
        origin: voiceDocumentVersion(origin), request: voiceDocumentVersion(request), jobMarker: voiceDocumentVersion(jobMarker),
        intentGuard: voiceDocumentVersion(intentGuard) });
    }
    const versions: ReviewedVoiceSourceVersions = Object.freeze({
      principalIdentity: voiceDocumentVersion(principalIdentity), account: voiceDocumentVersion(accountDoc),
      input: voiceDocumentVersion(inputDoc), project: voiceDocumentVersion(projectDoc), textJob: voiceDocumentVersion(jobDoc),
      artifact: voiceDocumentVersion(artifactDoc), terminal: voiceDocumentVersion(terminalDoc),
      accounting: voiceDocumentVersion(accountingDoc), reserveMovement: voiceDocumentVersion(reserveMovementDoc),
      billingOutbox: voiceDocumentVersion(billingDoc), review: voiceDocumentVersion(reviewDoc), receipt: voiceDocumentVersion(receiptDoc),
      ...(external ? { external } : {}),
    });
    const canonicalEvidence = Object.freeze({ accountId, inputId, textJobId, revision: selected,
      bindingHash: authorization.bindingHash, reviewId: selectedReviewId, review, receiptId: selectedReceiptId, receipt });
    const binding = { version: 'reviewed-voice-binding-v1' as const, identityKey, accountId, inputId, textJobId,
      revision: selected, reviewId: selectedReviewId, receiptId: selectedReceiptId, bindingHash: authorization.bindingHash,
      payloadSha256: review.payloadSha256, voiceTextSha256: review.voiceSha256, inputGeneration: source.generation,
      inputSha256: source.sha256, durationMs: authorization.durationMs, billableSeconds: authorization.billableSeconds, versions };
    // Avoid leaking the payload through an accidental JSON.stringify/object
    // spread. Explicit access remains sensitive and must never be logged.
    Object.defineProperty(binding, 'canonicalEvidence', { value: canonicalEvidence, enumerable: false, writable: false, configurable: false });
    return Object.freeze(binding) as ReviewedVoiceBinding;
  }

  private async assertSaveBase(tx: Transaction, accountId: string, input: SaveRequest,
    authorization: AuthorizedSource): Promise<ValidatedTranslationSource | null> {
    if (authorization.projectRevision !== input.expectedRevision) return fault('conflict');
    if (authorization.jobRevision === input.expectedRevision) {
      if (authorization.projectDraft !== '' || sha(authorization.projectDraft) !== authorization.jobSnapshotSha256) return fault('conflict');
      return null;
    }
    const prior = await this.verifiedCurrentReview(tx, accountId, input.inputId, input.jobId, authorization);
    if (!prior) return fault('conflict');
    return Object.freeze({ durationMs: prior.durationMs, cues: prior.cues });
  }

  async saveReview(caller: ReviewedTranslationPrincipal, request: unknown): Promise<Readonly<{ committedRevision: number }>> {
    const principal = copyPrincipal(caller), { accountId } = principal;
    const input = copySaveRequest(request), fingerprint = requestFingerprint(accountId, input);
    const receiptRef = this.ref('reviewRequests', requestId(accountId, input.requestKey));
    const first = await this.db.runTransaction(async tx => {
      const authorization = await this.authorize(tx, principal, input.inputId, input.jobId);
      const previous = await this.priorReceipt(tx, await tx.get(receiptRef), accountId, input, authorization, fingerprint);
      if (previous !== null) return { authorization, previous, base: null };
      const base = await this.assertSaveBase(tx, accountId, input, authorization);
      return { authorization, previous: null, base };
    });
    if (first.previous !== null) return Object.freeze({ committedRevision: first.previous });

    const source = first.base ?? await this.readSourceBytes(first.authorization);
    const baseHash = digest([source.durationMs, source.cues]), usingStoredBase = first.base !== null;
    let reviewed: ReviewedTranslation;
    try { reviewed = reviewTranslation(input.jobId, source, input.edits); }
    catch (error) { return fault(error instanceof JobError && error.code === 'invalid_input' ? 'invalid' : 'unavailable'); }
    const payload = JSON.stringify({ durationMs: reviewed.durationMs, cues: reviewed.cues });
    if (Buffer.byteLength(payload, 'utf8') > maxStoredPayloadBytes) return fault('invalid');
    const payloadSha256 = sha(payload), voiceSha256 = sha(reviewed.voiceText), committedRevision = input.expectedRevision + 1;
    const reviewedId = reviewId(accountId, input.inputId, input.jobId, committedRevision);
    const reviewRef = this.ref('reviewedTranslations', reviewedId), projectRef = this.ref('projects', input.inputId);

    return this.db.runTransaction(async tx => {
      const authorization = await this.authorize(tx, principal, input.inputId, input.jobId);
      if (authorization.bindingHash !== first.authorization.bindingHash) return fault('conflict');
      const previous = await this.priorReceipt(tx, await tx.get(receiptRef), accountId, input, authorization, fingerprint, baseHash);
      if (previous !== null) return Object.freeze({ committedRevision: previous });
      const currentBase = await this.assertSaveBase(tx, accountId, input, authorization);
      if ((currentBase !== null) !== usingStoredBase ||
          (currentBase && digest([currentBase.durationMs, currentBase.cues]) !== baseHash)) return fault('conflict');
      if ((await tx.get(reviewRef)).exists) return fault('conflict');
      const now = Date.now();
      tx.create(reviewRef, { version: 1, accountId, inputId: input.inputId, jobId: input.jobId,
        expectedRevision: input.expectedRevision, revision: committedRevision, bindingHash: authorization.bindingHash,
        fingerprint, baseHash, receiptId: receiptRef.id, payload, payloadSha256, voiceSha256, createdAtMs: now });
      tx.create(receiptRef, { version: 1, accountId, inputId: input.inputId, jobId: input.jobId,
        expectedRevision: input.expectedRevision, committedRevision, bindingHash: authorization.bindingHash,
        fingerprint, baseHash, reviewId: reviewedId, payloadSha256, voiceSha256, createdAtMs: now });
      tx.update(projectRef, { revision: committedRevision, draft: reviewed.voiceText, updatedAtMs: now,
        reviewedTextRevision: committedRevision, reviewedTextSha256: voiceSha256, reviewedAtMs: now, reviewJobId: input.jobId });
      return Object.freeze({ committedRevision });
    });
  }

  async downloadReview(caller: ReviewedTranslationPrincipal, request: unknown): Promise<Readonly<{ revision: number; mime: string; bytes: Buffer }>> {
    const principal = copyPrincipal(caller), { accountId } = principal;
    const input = copyDownloadRequest(request);
    const reviewed = await this.db.runTransaction(async tx => {
      const authorization = await this.authorize(tx, principal, input.inputId, input.jobId);
      const review = await tx.get(this.ref('reviewedTranslations', reviewId(accountId, input.inputId, input.jobId, input.revision)));
      const receiptId = review.get('receiptId');
      if (typeof receiptId !== 'string' || !privateSha.test(receiptId)) return fault('not_found');
      const receipt = await tx.get(this.ref('reviewRequests', receiptId));
      return this.savedReview(review, accountId, input.inputId, input.jobId, input.revision - 1, input.revision, authorization, receipt);
    });
    const text = input.format === 'txt' ? reviewed.txt : reviewed.srt;
    return Object.freeze({ revision: input.revision, mime: input.format === 'txt' ? 'text/plain; charset=utf-8' : 'application/x-subrip; charset=utf-8', bytes: Buffer.from(text, 'utf8') });
  }
}
