// Contract tests for the isolated local candidate. Run only through the reviewed
// launcher after preparing and checking its frozen manifest.
// This file does not authenticate HTTP requests or prove production IAM behavior.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { Firestore } from 'firebase-admin/firestore';
import { FirestoreBackend } from './firestoreBackend.ts';
import { AI_CATALOG_VERSION, AI_TEXT_WINDOW_MS } from './aiContracts.ts';
import { privateBucket } from './privateObjectPlan.ts';
import { encodeTextBundle } from './pipelineTextCodec.ts';
import { validateReviewedVoiceCall } from './reviewedVoiceCanonical.ts';
import { narrationChunks, VOICE_MODEL, VOICE_NARRATION_STYLE } from './pipelineVoiceProvider.ts';

const host = '127.0.0.1:8185';
const project = 'demo-vistavo-ledger';
const testCollection = 'vistavo_review_contract_synthetic';
const testCount = 28;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const contexts = [];
let verifiedCleanups = 0;
const ref = (c, collection, id) => c.root.collection(collection).doc(id);

function assertSafeEnvironment() {
  assert.equal(process.env.NODE_ENV, 'test', 'NODE_ENV must be test');
  assert.equal(process.env.LV_REVIEW_CONTRACT, '1', 'Explicit synthetic review test required');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, host, 'No native cloud fallback');
  assert.equal(process.env.METADATA_SERVER_DETECTION, 'none', 'Metadata discovery must be disabled');
  const projects = ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'GCP_PROJECT', 'CLOUDSDK_CORE_PROJECT']
    .map(name => process.env[name]).filter(Boolean);
  assert.ok(projects.length > 0 && projects.every(value => value === project), 'Only the demo project is allowed');
  const forbidden = [
    'GOOGLE_APPLICATION_CREDENTIALS', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE', 'CLOUDSDK_AUTH_ACCESS_TOKEN',
    'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT', 'GOOGLE_OAUTH_ACCESS_TOKEN', 'GOOGLE_CLOUD_ACCESS_TOKEN',
    'GOOGLE_API_KEY', 'GOOGLE_CLOUD_API_KEY', 'GOOGLE_AUTH_CREDENTIALS', 'GOOGLE_SERVICE_ACCOUNT',
    'GEMINI_API_KEY', 'GOOGLE_GENAI_API_KEY', 'VERTEX_API_KEY',
    'OPENROUTER_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
    'GOOGLE_CLOUD_QUOTA_PROJECT', 'GCE_METADATA_HOST', 'GCE_METADATA_IP', 'FIREBASE_CONFIG',
    'VISTAVO_PROJECT_ID', 'VISTAVO_AI_ENABLED', 'VISTAVO_FILES_MODE', 'VISTAVO_LOCAL_CLOUD',
    'VISTAVO_ACCOUNT_ID', 'VISTAVO_JOB_ID', 'VISTAVO_GEMINI_KEY', 'VISTAVO_UPLOAD_ID',
    'VISTAVO_RESULT_JOB_ID', 'VISTAVO_PUBLIC_ORIGIN',
    'K_SERVICE', 'K_REVISION', 'K_CONFIGURATION', 'FUNCTION_TARGET', 'FUNCTION_NAME', 'GAE_SERVICE', 'GAE_ENV',
  ];
  assert.deepEqual(forbidden.filter(name => Boolean(process.env[name])), [], 'Credential or cloud runtime environment detected');
  // Accept only the child profile created by this task's Windows launcher;
  // never inspect a real user's ADC file or use a shared profile.
  assert.equal(process.platform, 'win32');
  const configRoot = process.env.APPDATA;
  assert.ok(configRoot && configRoot === process.env.USERPROFILE && configRoot === process.env.LOCALAPPDATA);
  const profile = resolve(configRoot), base = resolve('outputs/lv019-b-review-runs');
  const segments = relative(base, profile).split(sep);
  assert.equal(segments.length, 2);
  assert.match(segments[0], /^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(segments[1], 'profile');
  assert.equal(realpathSync(profile).toLowerCase(), profile.toLowerCase());
  assert.equal(existsSync(join(profile, 'gcloud', 'application_default_credentials.json')), false,
    'Default application credentials must not be available to the test');
}

function assertSafeClient(db) {
  // The installed SDK normalizes host into servicePath/port. Check the effective
  // client, not just constructor arguments or environment variables.
  const settings = db._settings;
  assert.equal(db.projectId, project);
  assert.equal(db.databaseId, '(default)');
  assert.equal(settings?.projectId, project);
  assert.equal(settings?.servicePath, '127.0.0.1');
  assert.equal(settings?.port, 8185);
  assert.equal(settings?.ssl, false);
  assert.equal(settings?.preferRest, false);
  for (const key of ['auth', 'credentials', 'keyFilename', 'authClient']) {
    assert.equal(settings?.[key], undefined, `Unexpected Firestore ${key}`);
  }
}

function assertSyntheticRoot(c) {
  assert.match(c.root.id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(c.root.path, `${testCollection}/${c.root.id}`);
}

async function descendants(document, found = []) {
  for (const collection of await document.listCollections()) {
    // Includes references to missing parent documents with extant subcollections.
    for (const child of await collection.listDocuments()) {
      found.push(child);
      await descendants(child, found);
    }
  }
  return found;
}

class FakeObjects {
  data = new Map();
  reads = 0;
  gate = null;

  pauseNextRead() {
    if (this.gate) throw Error('A synthetic read is already paused');
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    const resume = new Promise(resolve => { release = resolve; });
    this.gate = { enter, resume };
    return { entered, release };
  }

  async read(object) {
    this.reads++;
    const item = this.data.get(object.key);
    if (!item || item.generation !== object.generation) throw Error('Synthetic generation missing');
    // Capture bytes for the requested generation before pausing. Replacing a
    // separately stored object is not claimed to participate in Firestore CAS.
    const bytes = Buffer.from(item.bytes), gate = this.gate;
    if (gate) { this.gate = null; gate.enter(); await gate.resume; }
    return Readable.from([bytes]);
  }
}

before(async () => {
  assertSafeEnvironment();
  const response = await fetch(`http://${host}/`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200);
});

afterEach(async () => {
  for (const c of contexts.splice(0)) {
    globalThis.fetch = c.originalFetch;
    try {
      assertSafeEnvironment(); assertSafeClient(c.db); assertSyntheticRoot(c);
      const marker = await c.root.get();
      if (!c.markerConfirmed) {
        // Even a lost create acknowledgement is not permission to delete.
        assert.equal(marker.exists, false, 'Unconfirmed root preserved for manual inspection');
        assert.deepEqual(await c.root.listCollections(), []);
        continue;
      }
      assert.equal(marker.exists, true, 'Missing test marker: no recursive deletion');
      assert.equal(marker.get('marker'), c.marker, 'Unexpected test marker: no recursive deletion');
      assert.equal(marker.get('purpose'), 'review-contract-synthetic-v1');
      assert.equal(marker.get('project'), project);
      const known = new Map((await descendants(c.root)).map(document => [document.path, document]));
      for (const document of c.syntheticRefs) known.set(document.path, document);
      for (const path of known.keys()) assert.ok(path.startsWith(`${c.root.path}/`), 'Reference outside synthetic root');
      // No collection/database-wide deletion: only the confirmed UUID root.
      await c.db.recursiveDelete(c.root);
      assert.equal((await c.root.get()).exists, false);
      assert.deepEqual(await c.root.listCollections(), []);
      for (const document of known.values()) {
        assert.equal((await document.get()).exists, false, `Synthetic reference remains: ${document.path}`);
        assert.deepEqual(await document.listCollections(), []);
      }
      verifiedCleanups++;
      console.log(`Synthetic review cleanup verified ${verifiedCleanups}/${testCount}`);
    } finally { await c.db.terminate(); }
  }
});

after(() => {
  console.log(`Synthetic review cleanup total: ${verifiedCleanups}/${testCount}`);
  assert.equal(verifiedCleanups, testCount, 'Every synthetic root must be independently cleaned and verified');
});

async function fixture({ longOriginal = false, durationSeconds = 2 } = {}) {
  assertSafeEnvironment();
  assert.ok(Number.isFinite(durationSeconds) && durationSeconds >= 1.8 && durationSeconds <= 600);
  const durationMs = Math.floor(durationSeconds * 1_000), billableSeconds = Math.ceil(durationSeconds);
  const db = new Firestore({ projectId: project, host, ssl: false, preferRest: false });
  const root = db.collection(testCollection).doc(randomUUID());
  const backend = new FirestoreBackend(db, root), objects = new FakeObjects();
  const c = { db, root, backend, objects, originalFetch: globalThis.fetch, outbound: [], syntheticRefs: [], marker: randomUUID(), markerConfirmed: false };
  contexts.push(c);
  assertSafeClient(db); assertSyntheticRoot(c);
  assert.equal((await root.get()).exists, false, 'Synthetic root must be unused');
  assert.deepEqual(await root.listCollections(), [], 'Synthetic root must have no pre-existing descendants');
  await root.create({ marker: c.marker, purpose: 'review-contract-synthetic-v1', project });
  const marker = await root.get();
  assert.equal(marker.get('marker'), c.marker);
  assert.equal(marker.get('purpose'), 'review-contract-synthetic-v1');
  assert.equal(marker.get('project'), project);
  c.markerConfirmed = true;
  // This guard applies to fetch; it is not evidence about unrelated native APIs.
  globalThis.fetch = async (request, init) => {
    const raw = request instanceof Request ? request.url : String(request);
    const url = new URL(raw);
    if (url.hostname !== '127.0.0.1' || url.port !== '8185') {
      c.outbound.push(url.origin);
      throw Error('Synthetic test blocks outbound fetch');
    }
    return c.originalFetch(request, init);
  };
  const { FirestoreReviewedTranslation } = await import('./firestoreReviewedTranslation.ts');
  c.Service = FirestoreReviewedTranslation;
  c.service = new FirestoreReviewedTranslation(db, root, backend, objects);
  const uid = `review-owner-${randomUUID()}`, foreignUid = `review-other-${randomUUID()}`;
  c.uid = uid;
  c.account = await backend.accountForUid(uid);
  c.foreign = await backend.accountForUid(foreignUid);
  c.principal = Object.freeze({ accountId: c.account, uid });
  c.foreignPrincipal = Object.freeze({ accountId: c.foreign, uid: foreignUid });
  c.syntheticRefs.push(ref(c, 'accounts', c.account), ref(c, 'accounts', c.foreign),
    ref(c, 'identities', sha(JSON.stringify(['firebase', uid]))), ref(c, 'identities', sha(JSON.stringify(['firebase', foreignUid]))));
  for (const accountId of [c.account, c.foreign]) {
    await ref(c, 'accounts', accountId).update({ aiPilot: true, simulationOnly: true });
  }
  await backend.creditVerifiedPurchase(c.account, `review-fixture-${randomUUID()}`, Math.max(10, billableSeconds), 1, 'synthetic-review', 'sandbox');
  c.input = randomUUID();
  c.syntheticRefs.push(ref(c, 'inputs', c.input), ref(c, 'projects', c.input));
  const sourceSha = sha('synthetic video');
  await ref(c, 'inputs', c.input).create({
    accountId: c.account, expiresAtMs: Date.now() + 3_600_000, sha256: sourceSha,
    deleted: false, ready: true, unknownCount: 0,
    metadata: { duration: durationSeconds, audioTracks: 1 },
    storage: { bucket: privateBucket, key: `candidate-files-v1/${c.input}/video.mp4`, generation: '9007199254740993', size: 100, sha256: sourceSha },
  });
  await backend.saveProject(c.account, c.input, 0, '');
  c.jobId = await backend.reserve(c.account, c.input, randomUUID(), billableSeconds, 'translation:en', 1, AI_CATALOG_VERSION);
  c.syntheticRefs.push(ref(c, 'jobs', c.jobId), ref(c, 'jobAccounting', c.jobId), ref(c, 'artifacts', c.jobId), ref(c, 'outbox', c.jobId),
    ref(c, 'movements', `reserve:${c.jobId}`), ref(c, 'movements', `terminal:${c.jobId}`), ref(c, 'billingOutbox', c.jobId), ref(c, 'providerCalls', `${c.jobId}-text-window-0000`));
  const attempt = await backend.claim(c.account, c.jobId);
  assert.ok(attempt);
  const job = await backend.job(c.account, c.jobId);
  assert.equal(await backend.resumeTextAfterLocalCheck(c.account, c.jobId, attempt.attemptId, job.inputStorage, 'nonzero'), true);
  assert.equal(await backend.beginInvocation(c.account, c.jobId, attempt.attemptId), true);
  for (let index = 0; index < Math.ceil(durationMs / AI_TEXT_WINDOW_MS); index++) {
    const ordinal = String(index).padStart(4, '0'), callRef = ref(c, 'providerCalls', `${c.jobId}-text-window-${ordinal}`);
    c.syntheticRefs.push(callRef);
    await callRef.create({ jobId: c.jobId, accountId: c.account, attemptId: attempt.attemptId, callKey: `text-window:${ordinal}`,
      model: 'gemini-3.8-flash', state: 'received', httpStatus: 200,
      requestSha256: 'a'.repeat(64), responseSha256: 'b'.repeat(64), responseId: 'synthetic-review-receipt',
      usage: { totalTokenCount: 1 }, fixtureOnly: true });
  }
  c.attemptId = attempt.attemptId;
  const bundle = encodeTextBundle(c.jobId, durationMs, { detectedLanguage: 'es', hasSpeech: true, cues: [
    { startMs: 0, endMs: 900, es: 'José revisa la bomba.', en: longOriginal ? 'x'.repeat(4_097) : 'José checks the pump.' },
    { startMs: 1_000, endMs: 1_800, es: 'Mide cinco centímetros.', en: 'It measures five centimeters.' },
  ] });
  const buffers = new Map([
    ['transcript-es.txt', bundle.es.txtBytes], ['transcript-es.srt', bundle.es.srtBytes],
    ['translation-en.txt', bundle.en.txtBytes], ['translation-en.srt', bundle.en.srtBytes],
    ['cues.json', Buffer.from(JSON.stringify({ durationMs: bundle.durationMs, cues: bundle.cues }))],
  ]);
  const plan = (await ref(c, 'artifacts', c.jobId).get()).get('plan');
  const entries = plan.artifacts.map((spec, index) => {
    const bytes = buffers.get(spec.name), generation = String(9007199254741000n + BigInt(index));
    assert.ok(bytes);
    objects.data.set(spec.key, { generation, bytes: Buffer.from(bytes) });
    return { name: spec.name, key: spec.key, mimeType: spec.mimeType, generation, size: bytes.length, sha256: sha(bytes) };
  });
  assert.equal(await backend.stageArtifactReceipt(c.account, c.jobId, attempt.attemptId, entries), true);
  assert.equal(await backend.finish(c.account, c.jobId, attempt.attemptId, true), true);
  c.cues = bundle.cues;
  c.cuesEntry = entries.find(entry => entry.name === 'cues.json');
  c.edits = [
    { id: bundle.cues[0].id, en: 'José checks the water pump.' },
    { id: bundle.cues[1].id, en: 'It measures 5 cm.' },
  ];
  c.expectedTxt = 'José checks the water pump.\nIt measures 5 cm.\n';
  c.expectedSrt = '1\n00:00:00,000 --> 00:00:00,900\nJosé checks the water pump.\n\n' +
    '2\n00:00:01,000 --> 00:00:01,800\nIt measures 5 cm.\n\n';
  c.baseline = await financialState(c);
  return c;
}

async function financialState(c) {
  const rows = {};
  for (const collection of ['movements', 'providerCalls', 'outbox', 'billingOutbox', 'jobAccounting']) {
    const snapshot = await c.root.collection(collection).orderBy('__name__').get();
    rows[collection] = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
  }
  return { balance: await c.backend.readBalance(c.account), rows };
}

// Produce a second paid-looking synthetic job for the same owner using the
// local ledger only. No Account endpoint or provider is contacted.
async function secondSyntheticJob(c) {
  const input = randomUUID(), sourceSha = sha('second synthetic video');
  const storage = { bucket: privateBucket, key: `candidate-files-v1/${input}/video.mp4`,
    generation: '9007199254740999', size: 100, sha256: sourceSha };
  await ref(c, 'inputs', input).create({ accountId: c.account, expiresAtMs: Date.now() + 3_600_000,
    sha256: sourceSha, deleted: false, ready: true, unknownCount: 0, metadata: { duration: 2, audioTracks: 1 }, storage });
  await c.backend.saveProject(c.account, input, 0, '');
  const jobId = await c.backend.reserve(c.account, input, randomUUID(), 2, 'translation:en', 1, AI_CATALOG_VERSION);
  const attempt = await c.backend.claim(c.account, jobId);
  assert.ok(attempt);
  const job = await c.backend.job(c.account, jobId);
  assert.equal(await c.backend.resumeTextAfterLocalCheck(c.account, jobId, attempt.attemptId, job.inputStorage, 'nonzero'), true);
  assert.equal(await c.backend.beginInvocation(c.account, jobId, attempt.attemptId), true);
  await ref(c, 'providerCalls', `${jobId}-text-window-0000`).create({ jobId, accountId: c.account, attemptId: attempt.attemptId,
    callKey: 'text-window:0000', model: 'gemini-3.8-flash', state: 'received', httpStatus: 200,
    requestSha256: 'a'.repeat(64), responseSha256: 'b'.repeat(64), responseId: 'synthetic-second-review-receipt',
    usage: { totalTokenCount: 1 }, fixtureOnly: true });
  const bundle = encodeTextBundle(jobId, 2_000, { detectedLanguage: 'es', hasSpeech: true, cues: [
    { startMs: 0, endMs: 1_000, es: 'La válvula está abierta.', en: 'The valve is open.' },
  ] });
  const buffers = new Map([
    ['transcript-es.txt', bundle.es.txtBytes], ['transcript-es.srt', bundle.es.srtBytes],
    ['translation-en.txt', bundle.en.txtBytes], ['translation-en.srt', bundle.en.srtBytes],
    ['cues.json', Buffer.from(JSON.stringify({ durationMs: bundle.durationMs, cues: bundle.cues }))],
  ]);
  const plan = (await ref(c, 'artifacts', jobId).get()).get('plan');
  const entries = plan.artifacts.map((spec, index) => {
    const bytes = buffers.get(spec.name), generation = String(9007199254742000n + BigInt(index));
    assert.ok(bytes); c.objects.data.set(spec.key, { generation, bytes: Buffer.from(bytes) });
    return { name: spec.name, key: spec.key, mimeType: spec.mimeType, generation, size: bytes.length, sha256: sha(bytes) };
  });
  assert.equal(await c.backend.stageArtifactReceipt(c.account, jobId, attempt.attemptId, entries), true);
  assert.equal(await c.backend.finish(c.account, jobId, attempt.attemptId, true), true);
  c.syntheticRefs.push(ref(c, 'inputs', input), ref(c, 'projects', input), ref(c, 'jobs', jobId), ref(c, 'jobAccounting', jobId),
    ref(c, 'artifacts', jobId), ref(c, 'movements', `reserve:${jobId}`), ref(c, 'movements', `terminal:${jobId}`), ref(c, 'billingOutbox', jobId));
  return { input, jobId, attemptId: attempt.attemptId, edits: [{ id: bundle.cues[0].id, en: 'The valve remains open.' }] };
}

// Correlated local evidence only: these documents are deliberately synthetic,
// not a claim that a real Account service acknowledged a payment.
async function attachSyntheticExternalHistory(c, target) {
  const jobRef = ref(c, 'jobs', target.jobId), job = (await jobRef.get()).data();
  const accountingRef = ref(c, 'jobAccounting', target.jobId), accounting = (await accountingRef.get()).data();
  assert.equal(accounting?.mode, 'simulation');
  const requestKey = job.requestKey, intentId = sha(JSON.stringify([c.account, requestKey]));
  const billing = { provider: 'account_seconds', identityKey: sha(JSON.stringify(['firebase', c.uid])), reservationId: randomUUID(), seconds: 2 };
  const witness = { intentId, accountId: c.account, inputId: target.input, operation: 'translation:en', revision: 1,
    profile: AI_CATALOG_VERSION, ...billing };
  const now = Date.now(), batch = c.db.batch();
  batch.update(jobRef, { externalBilling: billing, completedAttemptId: target.attemptId });
  // Deliberately construct a coherent *synthetic* external history. This is
  // test setup, not a claim that real immutable accounting can be converted.
  batch.update(accountingRef, { mode: 'account_seconds', ...billing });
  batch.delete(ref(c, 'movements', `reserve:${target.jobId}`));
  batch.set(ref(c, 'movements', `terminal:${target.jobId}`), { accountId: c.account, reference: target.jobId, credits: 2, kind: 'external_capture' });
  batch.set(ref(c, 'billingOutbox', target.jobId), { accountId: c.account, jobId: target.jobId, ...billing,
    action: 'capture', state: 'settled', attemptId: target.attemptId });
  batch.create(ref(c, 'billingIntents', intentId), { id: intentId, accountId: c.account, inputId: target.input,
    requestKey, operation: 'translation:en', revision: 1, ...billing, state: 'job_created', jobId: target.jobId,
    createdAtMs: now, updatedAtMs: now, nextAttemptAt: now, attempts: 1 });
  batch.create(ref(c, 'billingIntentWitnesses', intentId), { ...witness, historyProtocol: 1, baseline: 'before_reservation',
    createdAtMs: now, terminalRecovery: { protocol: 1, sealPrepared: false, releasePrepared: false } });
  batch.create(ref(c, 'billingIntentJobMarkers', intentId), { ...witness, jobId: target.jobId, historyProtocol: 1, createdAtMs: now });
  batch.create(ref(c, 'billingIntentAdmissionGuards', intentId), { protocol: 1, intentId, state: 'clear', createdAtMs: now });
  await batch.commit();
  return { billing, requestKey, intentId };
}

async function unchangedFinancialState(c, baseline = c.baseline) {
  assert.deepEqual(await financialState(c), baseline);
  assert.deepEqual(c.outbound, []);
}

function saveArgs(c, overrides = {}) {
  return { inputId: c.input, jobId: c.jobId, expectedRevision: 1, requestKey: randomUUID(), edits: c.edits, ...overrides };
}

function observed(promise) {
  return promise.then(value => ({ value }), error => ({ error }));
}

async function waitForRead(gate, pending, label = 'source-read') {
  let timer;
  try {
    await Promise.race([
      gate.entered,
      pending.then(() => { throw Error(`The request ended before the ${label} barrier`); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} barrier timed out`)), 10_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function failClosed(promise) {
  const result = await observed(promise);
  assert.ok(result.error, 'A rejected authorization or conflict must not return content');
  assert.equal(result.value, undefined);
  return result.error;
}

test('saved review generates matching TXT, SRT and voice snapshot without another charge or AI call', async () => {
  const c = await fixture(), source = await c.service.readSource(c.principal, c.input, c.jobId);
  assert.equal(source.status, 'original');
  assert.equal(source.projectRevision, 1);
  assert.equal(source.jobRevision, 1);
  assert.equal(source.durationMs, 2_000);
  assert.deepEqual(source.cues.map(cue => cue.id), c.cues.map(cue => cue.id));
  const saved = await c.service.saveReview(c.principal, saveArgs(c));
  assert.equal(saved.committedRevision, 2);
  const originalObject = c.objects.data.get(c.cuesEntry.key);
  assert.ok(originalObject);
  c.objects.data.delete(c.cuesEntry.key); // Only the synthetic original cue object disappears.
  const readsWithoutObject = c.objects.reads;
  const newSession = new c.Service(c.db, c.root, c.backend, c.objects);
  const restored = await newSession.readSource(c.principal, c.input, c.jobId);
  assert.equal(restored.status, 'reviewed');
  assert.equal(restored.projectRevision, 2);
  assert.deepEqual(restored.cues.map(cue => ({ id: cue.id, en: cue.en })), c.edits);
  assert.deepEqual(restored.cues.map(({ id, index, startMs, endMs, es }) => ({ id, index, startMs, endMs, es })),
    c.cues.map(({ id, index, startMs, endMs, es }) => ({ id, index, startMs, endMs, es })));
  const txt = await c.service.downloadReview(c.principal, { inputId: c.input, jobId: c.jobId, revision: 2, format: 'txt' });
  const srt = await c.service.downloadReview(c.principal, { inputId: c.input, jobId: c.jobId, revision: 2, format: 'srt' });
  assert.equal(txt.revision, 2); assert.equal(srt.revision, 2);
  assert.equal(txt.mime, 'text/plain; charset=utf-8'); assert.equal(srt.mime, 'application/x-subrip; charset=utf-8');
  assert.equal(Buffer.from(txt.bytes).toString('utf8'), c.expectedTxt);
  assert.equal(Buffer.from(srt.bytes).toString('utf8'), c.expectedSrt);
  const edited = structuredClone(c.edits); edited[1].en = 'It measures 6 cm.';
  const savedAgain = await newSession.saveReview(c.principal, saveArgs(c, { expectedRevision: 2, edits: edited }));
  assert.equal(savedAgain.committedRevision, 3);
  const restoredAgain = await newSession.readSource(c.principal, c.input, c.jobId);
  assert.equal(restoredAgain.status, 'reviewed');
  assert.deepEqual(restoredAgain.cues.map(cue => ({ id: cue.id, en: cue.en })), edited);
  assert.deepEqual(restoredAgain.cues.map(({ id, index, startMs, endMs, es }) => ({ id, index, startMs, endMs, es })),
    c.cues.map(({ id, index, startMs, endMs, es }) => ({ id, index, startMs, endMs, es })));
  const revisedTxt = 'José checks the water pump.\nIt measures 6 cm.\n';
  const revisedSrt = '1\n00:00:00,000 --> 00:00:00,900\nJosé checks the water pump.\n\n' +
    '2\n00:00:01,000 --> 00:00:01,800\nIt measures 6 cm.\n\n';
  const newerTxt = await newSession.downloadReview(c.principal, { inputId: c.input, jobId: c.jobId, revision: 3, format: 'txt' });
  const newerSrt = await newSession.downloadReview(c.principal, { inputId: c.input, jobId: c.jobId, revision: 3, format: 'srt' });
  assert.equal(Buffer.from(newerTxt.bytes).toString('utf8'), revisedTxt);
  assert.equal(Buffer.from(newerSrt.bytes).toString('utf8'), revisedSrt);
  assert.equal(c.objects.reads, readsWithoutObject, 'Reopen, edit and download must use the authorized saved revision');
  const missingBaseReviews = await c.root.collection('reviewedTranslations').get();
  const currentWithoutObject = missingBaseReviews.docs.find(doc => doc.get('revision') === 3);
  assert.ok(currentWithoutObject);
  const intactWithoutObject = currentWithoutObject.data();
  await currentWithoutObject.ref.update({ receiptId: 'invalid' });
  await failClosed(newSession.readSource(c.principal, c.input, c.jobId));
  assert.equal((await c.backend.readProject(c.account, c.input)).draft, revisedTxt);
  await currentWithoutObject.ref.set(intactWithoutObject);
  c.objects.data.set(c.cuesEntry.key, originalObject); // Restore the fake only for the following legacy checks.
  const project = await c.backend.readProject(c.account, c.input);
  assert.equal(project.draft, revisedTxt); assert.equal(project.reviewedTextRevision, 3);
  assert.equal(project.reviewedTextSha256, sha(revisedTxt));
  const reviews = await c.root.collection('reviewedTranslations').get();
  assert.equal(reviews.size, 2);
  const currentReview = reviews.docs.find(doc => doc.get('revision') === 3);
  assert.ok(currentReview);
  const reviewRef = currentReview.ref, intactReview = currentReview.data();
  await reviewRef.update({ receiptId: 'invalid' });
  const incomplete = await newSession.readSource(c.principal, c.input, c.jobId);
  assert.equal(incomplete.status, 'legacy'); assert.equal(incomplete.reason, 'incomplete_review_link');
  assert.equal(incomplete.legacyDraft, revisedTxt); assert.deepEqual(incomplete.cues, c.cues);
  await failClosed(newSession.saveReview(c.principal, saveArgs(c, { expectedRevision: 3 })));
  await reviewRef.set(intactReview);
  // A later flat save removes the structured link; preserve it separately and
  // never invent timestamps or silently overwrite it with the old segments.
  await c.backend.saveProject(c.account, c.input, 3, 'Flat legacy text without timing.');
  const legacy = await newSession.readSource(c.principal, c.input, c.jobId);
  assert.equal(legacy.status, 'legacy'); assert.equal(legacy.reason, 'unlinked_draft');
  assert.equal(legacy.legacyDraft, 'Flat legacy text without timing.');
  assert.deepEqual(legacy.cues, c.cues);
  await failClosed(newSession.saveReview(c.principal, saveArgs(c, { expectedRevision: 4 })));
  assert.equal((await c.backend.readProject(c.account, c.input)).draft, 'Flat legacy text without timing.');
  const historical = await newSession.downloadReview(c.principal, { inputId: c.input, jobId: c.jobId, revision: 2, format: 'txt' });
  assert.equal(Buffer.from(historical.bytes).toString('utf8'), c.expectedTxt);
  await unchangedFinancialState(c);
});

test('a long valid source can be opened and shortened before the 4 KiB edit limit applies', async () => {
  const c = await fixture({ longOriginal: true });
  const source = await c.service.readSource(c.principal, c.input, c.jobId);
  assert.equal(Buffer.byteLength(source.cues[0].en), 4_097);
  assert.equal((await c.service.saveReview(c.principal, saveArgs(c))).committedRevision, 2);
  await unchangedFinancialState(c);
});

test('a different owner cannot read, save, download or replay the owner receipt', async () => {
  const c = await fixture(), args = saveArgs(c);
  await failClosed(c.service.readSource(c.foreignPrincipal, c.input, c.jobId));
  await failClosed(c.service.saveReview(c.foreignPrincipal, args));
  await c.service.saveReview(c.principal, args);
  await failClosed(c.service.saveReview(c.foreignPrincipal, args));
  await failClosed(c.service.downloadReview(c.foreignPrincipal, { inputId: c.input, jobId: c.jobId, revision: 2, format: 'txt' }));
  await unchangedFinancialState(c);
});

test('duplicate request keys replay a receipt after authorization; changed bodies conflict', async () => {
  const c = await fixture(), args = saveArgs(c);
  const first = await c.service.saveReview(c.principal, args);
  c.objects.data.delete(c.cuesEntry.key);
  const readsWithoutObject = c.objects.reads;
  const projectBefore = await ref(c, 'projects', c.input).get();
  const replay = await c.service.saveReview(c.principal, structuredClone(args)); // Simulates a lost response, not a second commit.
  const projectAfter = await ref(c, 'projects', c.input).get();
  assert.equal(first.committedRevision, 2); assert.equal(replay.committedRevision, 2);
  assert.ok(projectBefore.updateTime.isEqual(projectAfter.updateTime));
  assert.equal(c.objects.reads, readsWithoutObject);
  const different = structuredClone(args); different.edits[1].en = 'Changed after the first request.';
  await failClosed(c.service.saveReview(c.principal, different));
  await ref(c, 'accounts', c.account).update({ aiPilot: false });
  await failClosed(c.service.saveReview(c.principal, args));
  await ref(c, 'accounts', c.account).update({ aiPilot: true });
  await ref(c, 'inputs', c.input).update({ deleted: true });
  await failClosed(c.service.saveReview(c.principal, args));
  await unchangedFinancialState(c);
});

test('concurrent saves with the same expected revision cannot both replace the project', async () => {
  const c = await fixture(), a = saveArgs(c), b = saveArgs(c);
  b.edits = structuredClone(b.edits); b.edits[0].en = 'A different reviewed phrase.';
  const results = await Promise.all([observed(c.service.saveReview(c.principal, a)), observed(c.service.saveReview(c.principal, b))]);
  assert.equal(results.filter(result => result.value?.committedRevision === 2).length, 1);
  assert.equal(results.filter(result => result.error).length, 1);
  assert.equal((await c.backend.readProject(c.account, c.input)).revision, 2);
  await unchangedFinancialState(c);
});

test('a coherently altered saved base cannot be overwritten after the first transaction', async () => {
  const c = await fixture();
  await c.service.saveReview(c.principal, saveArgs(c));
  c.objects.data.delete(c.cuesEntry.key); // This edit must use the saved base, not GCS.
  const readsWithoutObject = c.objects.reads;
  const reviewsBefore = await c.root.collection('reviewedTranslations').get();
  const receiptsBefore = await c.root.collection('reviewRequests').get();
  assert.equal(reviewsBefore.size, 1); assert.equal(receiptsBefore.size, 1);
  const review = reviewsBefore.docs[0], reviewRef = review.ref, prior = review.data();
  const receiptRef = ref(c, 'reviewRequests', prior.receiptId), receipt = await receiptRef.get();
  assert.equal(receipt.exists, true);
  const changed = JSON.parse(prior.payload);
  changed.cues[1].en = 'It measures 9 cm.';
  const changedPayload = JSON.stringify(changed), changedDraft = changed.cues.map(cue => cue.en).join('\n') + '\n';
  const changedFingerprint = sha(JSON.stringify(['review-save-v1', c.account, c.input, c.jobId, 1,
    changed.cues.map(cue => [cue.id, cue.en])]));

  let enter, release;
  const gate = { entered: new Promise(resolve => { enter = resolve; }), release: () => release() };
  const resume = new Promise(resolve => { release = resolve; });
  const run = c.db.runTransaction.bind(c.db);
  let calls = 0;
  // Pause only this local service instance before its second transaction.
  c.db.runTransaction = (callback, options) => {
    calls++;
    if (calls !== 2) return run(callback, options);
    enter();
    return resume.then(() => run(callback, options));
  };
  const edited = structuredClone(c.edits); edited[0].en = 'A new requested correction.';
  const pending = observed(c.service.saveReview(c.principal, saveArgs(c, { expectedRevision: 2, edits: edited })));
  try {
    await waitForRead(gate, pending, 'saved-base transaction');
    // Deliberately corrupt three trusted emulator records in one transaction.
    // This is not a claim that a browser can mutate these records.
    await run(async tx => {
      tx.update(reviewRef, { payload: changedPayload, payloadSha256: sha(changedPayload),
        voiceSha256: sha(changedDraft), fingerprint: changedFingerprint });
      tx.update(receiptRef, { payloadSha256: sha(changedPayload), voiceSha256: sha(changedDraft), fingerprint: changedFingerprint });
      tx.update(ref(c, 'projects', c.input), { draft: changedDraft, reviewedTextSha256: sha(changedDraft) });
    });
    const projectAfterChange = await ref(c, 'projects', c.input).get();
    const reviewAfterChange = await reviewRef.get(), receiptAfterChange = await receiptRef.get();
    gate.release();
    assert.ok((await pending).error, 'A stale saved base must not be committed');
    assert.ok(projectAfterChange.updateTime.isEqual((await ref(c, 'projects', c.input).get()).updateTime));
    assert.ok(reviewAfterChange.updateTime.isEqual((await reviewRef.get()).updateTime));
    assert.ok(receiptAfterChange.updateTime.isEqual((await receiptRef.get()).updateTime));
    assert.equal((await ref(c, 'projects', c.input).get()).get('revision'), 2);
    assert.equal((await ref(c, 'projects', c.input).get()).get('draft'), changedDraft);
    assert.equal((await c.root.collection('reviewedTranslations').get()).size, 1);
    assert.equal((await c.root.collection('reviewRequests').get()).size, 1);
    assert.equal(c.objects.reads, readsWithoutObject);
  } finally {
    gate.release();
    c.db.runTransaction = run;
  }
  await unchangedFinancialState(c);
});

test('flags, expired or deleted input and a missing simulated capture deny review access', async () => {
  const c = await fixture();
  for (const flag of ['aiPilot', 'simulationOnly']) {
    await ref(c, 'accounts', c.account).update({ [flag]: false });
    await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
    await ref(c, 'accounts', c.account).update({ [flag]: true });
  }
  const input = (await ref(c, 'inputs', c.input).get()).data();
  for (const change of [{ deleted: true }, { expiresAtMs: Date.now() - 1 }]) {
    await ref(c, 'inputs', c.input).set({ ...input, ...change });
    await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  }
  await ref(c, 'inputs', c.input).set(input);
  const terminal = ref(c, 'movements', `terminal:${c.jobId}`), original = (await terminal.get()).data();
  for (const change of [{ kind: 'release' }, { accountId: c.foreign }, { reference: randomUUID() }, { credits: 3 }]) {
    await terminal.set({ ...original, ...change });
    await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  }
  await terminal.delete(); await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  await terminal.set(original);
  const accountingRef = ref(c, 'jobAccounting', c.jobId), accounting = (await accountingRef.get()).data();
  await accountingRef.delete(); await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  await accountingRef.set({ ...accounting, mode: 'account_seconds' });
  await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  await accountingRef.set(accounting);
  const reserveRef = ref(c, 'movements', `reserve:${c.jobId}`), reserve = (await reserveRef.get()).data();
  await reserveRef.delete(); await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  await reserveRef.set(reserve);
  assert.equal(c.objects.reads, 0);
  await unchangedFinancialState(c);
});

test('external settlement and per-intent review preserve an unrelated paid job for the same owner', async () => {
  const c = await fixture();
  const jobA = { input: c.input, jobId: c.jobId, attemptId: c.attemptId, edits: c.edits };
  const jobB = await secondSyntheticJob(c);
  const historyA = await attachSyntheticExternalHistory(c, jobA);
  const historyB = await attachSyntheticExternalHistory(c, jobB);
  assert.notEqual(jobA.jobId, jobB.jobId);
  assert.notEqual(historyA.intentId, historyB.intentId);
  const billing = historyA.billing;
  const receipt = { accountId: c.account, jobId: c.jobId, ...billing, action: 'capture', state: 'settled', attemptId: c.attemptId };
  const receiptRef = ref(c, 'billingOutbox', c.jobId);
  const baseline = await financialState(c);
  assert.equal((await c.service.readSource(c.principal, c.input, c.jobId)).durationMs, 2_000);
  assert.equal((await c.service.readSource(c.principal, jobB.input, jobB.jobId)).durationMs, 2_000);
  // Removing the external tuple and fabricating the shape of simulated ledger
  // evidence must not downgrade a durably classified external job.
  const jobRef = ref(c, 'jobs', c.jobId), jobBefore = (await jobRef.get()).data();
  const terminalRef = ref(c, 'movements', `terminal:${c.jobId}`), terminalBefore = (await terminalRef.get()).data();
  const reserveRef = ref(c, 'movements', `reserve:${c.jobId}`);
  const { externalBilling: _discarded, ...forgedSimulation } = jobBefore;
  const forged = c.db.batch();
  forged.set(jobRef, forgedSimulation);
  forged.delete(receiptRef);
  forged.set(terminalRef, { accountId: c.account, reference: c.jobId, credits: 2, kind: 'capture' });
  forged.set(reserveRef, { accountId: c.account, reference: c.jobId, credits: 2, kind: 'reserve' });
  await forged.commit();
  await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  assert.equal((await c.service.readSource(c.principal, jobB.input, jobB.jobId)).durationMs, 2_000);
  const restore = c.db.batch();
  restore.set(jobRef, jobBefore); restore.set(receiptRef, receipt); restore.set(terminalRef, terminalBefore); restore.delete(reserveRef);
  await restore.commit();
  const argsA = saveArgs(c), argsB = { inputId: jobB.input, jobId: jobB.jobId, expectedRevision: 1,
    requestKey: randomUUID(), edits: jobB.edits };
  assert.equal((await c.service.saveReview(c.principal, argsA)).committedRevision, 2);
  assert.equal((await c.service.saveReview(c.principal, argsB)).committedRevision, 2);
  const downloadA = { inputId: c.input, jobId: c.jobId, revision: 2, format: 'txt' };
  const downloadB = { inputId: jobB.input, jobId: jobB.jobId, revision: 2, format: 'txt' };
  const priorB = await c.service.downloadReview(c.principal, downloadB);
  const accountingRef = ref(c, 'jobAccounting', c.jobId), accounting = (await accountingRef.get()).data();
  for (const change of [null, { mode: 'simulation' }, { accountId: c.foreign }, { price: 3 }]) {
    if (change === null) await accountingRef.delete();
    else await accountingRef.set({ ...accounting, ...change });
    await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
    await failClosed(c.service.saveReview(c.principal, argsA)); // An idempotent replay reauthorizes too.
    await failClosed(c.service.downloadReview(c.principal, downloadA));
    assert.deepEqual(Buffer.from((await c.service.downloadReview(c.principal, downloadB)).bytes), Buffer.from(priorB.bytes));
  }
  await accountingRef.set(accounting);
  for (const change of [{ state: 'pending' }, { action: 'release' }, { seconds: 3 }, { identityKey: 'f'.repeat(64) }, { attemptId: randomUUID() }]) {
    await receiptRef.set({ ...receipt, ...change });
    await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  }
  await receiptRef.set(receipt);
  const identityRef = ref(c, 'identities', billing.identityKey), identity = (await identityRef.get()).data();
  for (const change of [{ accountId: c.foreign }, { uid: `changed-${randomUUID()}` }]) {
    await identityRef.set({ ...identity, ...change });
    await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  }
  await identityRef.set(identity);
  // Force a local per-intent anomaly for A; it also blocks new processing for
  // the account. Reading an unrelated already-captured B must remain possible.
  const incident = await c.backend.recordExternalBillingReview(c.account, historyA.requestKey, billing,
    { reservationId: billing.reservationId, state: 'captured', seconds: 3 });
  assert.equal(incident.state, 'needs_review');
  assert.equal((await ref(c, 'billingGuards', c.account).get()).get('blocked'), true);
  assert.equal((await ref(c, 'billingIntentAdmissionGuards', historyA.intentId).get()).get('state'), 'needs_review');
  assert.equal((await ref(c, 'billingIntentAdmissionGuards', historyB.intentId).get()).get('state'), 'clear');
  await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  await failClosed(c.service.downloadReview(c.principal, downloadA));
  await failClosed(c.service.saveReview(c.principal, argsA));
  assert.equal((await c.service.readSource(c.principal, jobB.input, jobB.jobId)).status, 'reviewed');
  const afterB = await c.service.downloadReview(c.principal, downloadB);
  assert.deepEqual(Buffer.from(afterB.bytes), Buffer.from(priorB.bytes));
  assert.equal((await c.service.saveReview(c.principal, argsB)).committedRevision, 2);
  await failClosed(c.service.downloadReview(c.foreignPrincipal, downloadA));
  await failClosed(c.service.downloadReview(c.foreignPrincipal, downloadB));
  await unchangedFinancialState(c, baseline);
});

test('source generation and exact SHA are checked before exposing or saving cues', async () => {
  const c = await fixture(), item = c.objects.data.get(c.cuesEntry.key), original = { ...item, bytes: Buffer.from(item.bytes) };
  item.generation = String(BigInt(item.generation) + 1n);
  await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  item.generation = original.generation;
  const at = item.bytes.indexOf(Buffer.from('José'));
  assert.ok(at >= 0); item.bytes[at] = 'K'.charCodeAt(0); // Same byte length, different SHA.
  await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  await failClosed(c.service.saveReview(c.principal, saveArgs(c)));
  c.objects.data.set(c.cuesEntry.key, original);
  assert.equal((await c.backend.readProject(c.account, c.input)).revision, 1);
  await unchangedFinancialState(c);
});

test('a validly hashed source with a duration different from the input is rejected', async () => {
  const c = await fixture(), item = c.objects.data.get(c.cuesEntry.key);
  const source = JSON.parse(item.bytes.toString('utf8'));
  source.durationMs += 1;
  item.bytes = Buffer.from(JSON.stringify(source));
  const artifactRef = ref(c, 'artifacts', c.jobId), artifact = (await artifactRef.get()).data();
  await artifactRef.update({ entries: artifact.entries.map(entry => entry.name === 'cues.json' ? { ...entry, size: item.bytes.length, sha256: sha(item.bytes) } : entry) });
  await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  await failClosed(c.service.saveReview(c.principal, saveArgs(c)));
  assert.equal((await c.backend.readProject(c.account, c.input)).revision, 1);
  await unchangedFinancialState(c);
});

test('revocation during a source read is checked again before content returns', async () => {
  const c = await fixture(), gate = c.objects.pauseNextRead();
  const pending = observed(c.service.readSource(c.principal, c.input, c.jobId));
  try {
    await waitForRead(gate, pending);
    await ref(c, 'accounts', c.account).update({ aiPilot: false });
    gate.release();
    assert.ok((await pending).error);
  } finally { gate.release(); }
  await unchangedFinancialState(c);
});

test('a source binding change during a save cannot publish the earlier read', async () => {
  const c = await fixture(), gate = c.objects.pauseNextRead(), args = saveArgs(c);
  const pending = observed(c.service.saveReview(c.principal, args));
  try {
    await waitForRead(gate, pending);
    const artifactRef = ref(c, 'artifacts', c.jobId), artifact = (await artifactRef.get()).data();
    await artifactRef.update({ entries: artifact.entries.map(entry => entry.name === 'cues.json' ? { ...entry, sha256: 'f'.repeat(64) } : entry) });
    gate.release();
    assert.ok((await pending).error);
    assert.equal((await c.backend.readProject(c.account, c.input)).revision, 1);
  } finally { gate.release(); }
  await unchangedFinancialState(c);
});

test('a concurrent project revision during a source read prevents an overwrite', async () => {
  const c = await fixture(), gate = c.objects.pauseNextRead(), args = saveArgs(c);
  const pending = observed(c.service.saveReview(c.principal, args));
  try {
    await waitForRead(gate, pending);
    await c.backend.saveProject(c.account, c.input, 1, 'A concurrent saved draft.');
    gate.release();
    assert.ok((await pending).error);
    const project = await c.backend.readProject(c.account, c.input);
    assert.equal(project.revision, 2); assert.equal(project.draft, 'A concurrent saved draft.');
    const restored = await c.service.readSource(c.principal, c.input, c.jobId);
    assert.equal(restored.status, 'legacy');
    assert.equal(restored.legacyDraft, 'A concurrent saved draft.');
    assert.deepEqual(restored.cues, c.cues);
    await failClosed(c.service.saveReview(c.principal, saveArgs(c, { expectedRevision: 2 })));
    assert.equal((await c.backend.readProject(c.account, c.input)).draft, 'A concurrent saved draft.');
  } finally { gate.release(); }
  await unchangedFinancialState(c);
});

test('deleting the input during a source read prevents saving that review', async () => {
  const c = await fixture(), gate = c.objects.pauseNextRead();
  const pending = observed(c.service.saveReview(c.principal, saveArgs(c)));
  try {
    await waitForRead(gate, pending);
    await ref(c, 'inputs', c.input).update({ deleted: true });
    gate.release();
    assert.ok((await pending).error);
    assert.equal((await ref(c, 'projects', c.input).get()).get('revision'), 1);
  } finally { gate.release(); }
  await unchangedFinancialState(c);
});

test('saved downloads recheck grant, deletion and requested revision', async () => {
  const c = await fixture();
  await c.service.saveReview(c.principal, saveArgs(c));
  c.objects.data.delete(c.cuesEntry.key);
  const request = { inputId: c.input, jobId: c.jobId, revision: 2, format: 'txt' };
  await failClosed(c.service.downloadReview(c.principal, { ...request, revision: 1 }));
  await ref(c, 'accounts', c.account).update({ simulationOnly: false });
  await failClosed(c.service.downloadReview(c.principal, request));
  await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  await failClosed(c.service.saveReview(c.principal, saveArgs(c, { expectedRevision: 2 })));
  await ref(c, 'accounts', c.account).update({ simulationOnly: true });
  await ref(c, 'jobs', c.jobId).update({ state: 'failed' });
  await failClosed(c.service.downloadReview(c.principal, request));
  await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  await failClosed(c.service.saveReview(c.principal, saveArgs(c, { expectedRevision: 2 })));
  await ref(c, 'jobs', c.jobId).update({ state: 'succeeded' });
  await ref(c, 'inputs', c.input).update({ deleted: true });
  await failClosed(c.service.downloadReview(c.principal, request));
  await failClosed(c.service.readSource(c.principal, c.input, c.jobId));
  await failClosed(c.service.saveReview(c.principal, saveArgs(c, { expectedRevision: 2 })));
  await unchangedFinancialState(c);
});

test('removed, reassigned or mismatched caller identity denies reads, saves and downloads', async () => {
  const c = await fixture(), args = saveArgs(c), identity = ref(c, 'identities', sha(JSON.stringify(['firebase', c.uid])));
  await c.service.saveReview(c.principal, args);
  const download = { inputId: c.input, jobId: c.jobId, revision: 2, format: 'txt' }, original = (await identity.get()).data();
  assert.equal((await c.service.readSource(c.principal, c.input, c.jobId)).status, 'reviewed');
  for (const mutation of ['removed', 'reassigned', 'mismatched_uid']) {
    if (mutation === 'removed') await identity.delete();
    if (mutation === 'reassigned') await identity.update({ accountId: c.foreign });
    if (mutation === 'mismatched_uid') await identity.update({ uid: c.foreignPrincipal.uid });
    const reads = c.objects.reads;
    for (const operation of [() => c.service.readSource(c.principal, c.input, c.jobId), () => c.service.saveReview(c.principal, args),
      () => c.service.downloadReview(c.principal, download)]) {
      const error = await failClosed(operation()); assert.equal(error.code, 'not_found', mutation);
    }
    assert.equal(c.objects.reads, reads); await identity.set(original);
  }
  await failClosed(c.service.readSource({ accountId: c.account, uid: c.foreignPrincipal.uid }, c.input, c.jobId));
  await failClosed(c.service.downloadReview({ accountId: c.foreign, uid: c.uid }, download));
  assert.equal((await c.service.downloadReview(c.principal, download)).revision, 2);
  await unchangedFinancialState(c);
});

test('identity revocation while reading the source prevents returning or saving its content', async () => {
  const c = await fixture(), identity = ref(c, 'identities', sha(JSON.stringify(['firebase', c.uid]))), original = (await identity.get()).data();
  const first = c.objects.pauseNextRead(), reading = observed(c.service.readSource(c.principal, c.input, c.jobId));
  try {
    await waitForRead(first, reading); await identity.delete(); first.release();
    const result = await reading; assert.equal(result.error?.code, 'not_found'); assert.equal(result.value, undefined);
  } finally { first.release(); }
  await identity.set(original);
  const second = c.objects.pauseNextRead(), saving = observed(c.service.saveReview(c.principal, saveArgs(c)));
  try {
    await waitForRead(second, saving); await identity.update({ accountId: c.foreign }); second.release();
    const result = await saving; assert.equal(result.error?.code, 'not_found'); assert.equal(result.value, undefined);
  } finally { second.release(); }
  assert.equal((await ref(c, 'projects', c.input).get()).get('revision'), 1);
  assert.equal((await c.root.collection('reviewedTranslations').get()).size, 0);
  assert.equal((await c.root.collection('reviewRequests').get()).size, 0);
  await unchangedFinancialState(c);
});

// These tests exercise the transaction-local read only. No reservation, voice
// provider, HTTP route, production credentials or real customer text is used.
const voiceBinding = (c, principal = c.principal, inputId = c.input, jobId = c.jobId, selected = 2) =>
  c.db.runTransaction(tx => c.service.voiceBindingInTransaction(tx, principal, inputId, jobId, selected));
async function savedVoiceFixture(options) {
  const c = await fixture(options);
  assert.equal((await c.service.saveReview(c.principal, saveArgs(c))).committedRevision, 2);
  return c;
}

test('voice source returns frozen canonical evidence from the captured review without reading storage', async () => {
  const c = await savedVoiceFixture(), reads = c.objects.reads, binding = await voiceBinding(c);
  assert.equal(c.objects.reads, reads);
  assert.equal(binding.version, 'reviewed-voice-binding-v1');
  assert.equal(binding.accountId, c.account); assert.equal(binding.inputId, c.input); assert.equal(binding.textJobId, c.jobId);
  assert.equal(binding.revision, 2); assert.equal(binding.durationMs, 2_000); assert.equal(binding.billableSeconds, 2);
  assert.equal(binding.inputGeneration, '9007199254740993'); assert.equal(binding.inputSha256, sha('synthetic video'));
  assert.equal(binding.voiceTextSha256, sha(c.expectedTxt));
  assert.equal(binding.versions.review.exists, true); assert.equal(binding.versions.receipt.exists, true);
  assert.equal(binding.versions.billingOutbox.exists, false); assert.equal(binding.versions.external, undefined);
  for (const value of [binding, binding.versions, binding.versions.review, binding.canonicalEvidence,
    binding.canonicalEvidence.review, binding.canonicalEvidence.receipt]) assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.keys(binding).includes('canonicalEvidence'), false);
  assert.equal(JSON.stringify(binding).includes(c.expectedTxt), false);
  assert.equal(JSON.stringify(binding).includes('payload\"'), false);
  const body = JSON.stringify({ contents: [{ parts: [{ text: narrationChunks(c.expectedTxt)[0],
    speech_metadata: { style: VOICE_NARRATION_STYLE } }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'Kore' } } } });
  const canonical = validateReviewedVoiceCall({ evidence: binding.canonicalEvidence, operation: 'narration:en:female',
    model: VOICE_MODEL, callKey: 'voice-chunk:0000', body });
  assert.equal(canonical.body, body); assert.equal(canonical.payloadSha256, binding.payloadSha256);
  assert.equal(canonical.voiceTextSha256, binding.voiceTextSha256);
  assert.throws(() => { binding.canonicalEvidence.review.payload = 'changed'; }, TypeError);
  await unchangedFinancialState(c);
});

test('voice source rejects plain drafts, missing revision links and noncurrent revisions', async () => {
  const c = await fixture();
  await failClosed(voiceBinding(c, c.principal, c.input, c.jobId, 1));
  await c.service.saveReview(c.principal, saveArgs(c));
  await failClosed(voiceBinding(c, c.principal, c.input, c.jobId, 1));
  await failClosed(voiceBinding(c, c.principal, c.input, randomUUID(), 2));
  const projectRef = ref(c, 'projects', c.input), saved = (await projectRef.get()).data();
  await projectRef.update({ reviewJobId: randomUUID() }); await failClosed(voiceBinding(c));
  await projectRef.set(saved);
  await projectRef.update({ draft: 'synthetic unlinked draft', reviewedTextSha256: sha('synthetic unlinked draft') });
  await failClosed(voiceBinding(c)); await projectRef.set(saved);
  assert.equal((await voiceBinding(c)).revision, 2);
  await unchangedFinancialState(c);
});

test('voice source rechecks requester identity and refuses a different or revoked principal', async () => {
  const c = await savedVoiceFixture(), identity = ref(c, 'identities', sha(JSON.stringify(['firebase', c.uid])));
  const original = (await identity.get()).data(), reads = c.objects.reads;
  for (const mutation of ['removed', 'reassigned', 'uid_mismatch']) {
    if (mutation === 'removed') await identity.delete();
    if (mutation === 'reassigned') await identity.update({ accountId: c.foreign });
    if (mutation === 'uid_mismatch') await identity.update({ uid: c.foreignPrincipal.uid });
    assert.equal((await failClosed(voiceBinding(c))).code, 'not_found');
    await identity.set(original);
  }
  await failClosed(voiceBinding(c, c.foreignPrincipal));
  await failClosed(voiceBinding(c, { accountId: c.account, uid: c.foreignPrincipal.uid }));
  const accessorPrincipal = { uid: c.uid }; Object.defineProperty(accessorPrincipal, 'accountId', { enumerable: true, get() { return c.account; } });
  await failClosed(voiceBinding(c, accessorPrincipal));
  assert.equal(c.objects.reads, reads); assert.equal((await voiceBinding(c)).accountId, c.account);
  await unchangedFinancialState(c);
});

test('voice source needs the captured text job, matching private input and its classified accounting', async () => {
  const c = await savedVoiceFixture();
  const terminal = ref(c, 'movements', `terminal:${c.jobId}`), input = ref(c, 'inputs', c.input);
  const terminalBefore = (await terminal.get()).data(), inputBefore = (await input.get()).data();
  await terminal.delete(); await failClosed(voiceBinding(c)); await terminal.set(terminalBefore);
  await terminal.update({ credits: terminalBefore.credits + 1 }); await failClosed(voiceBinding(c)); await terminal.set(terminalBefore);
  await input.update({ 'storage.generation': '9007199254740994' }); await failClosed(voiceBinding(c)); await input.set(inputBefore);
  await input.update({ deleted: true }); await failClosed(voiceBinding(c)); await input.set(inputBefore);
  await input.update({ expiresAtMs: 0 }); await failClosed(voiceBinding(c)); await input.set(inputBefore);
  const fakeExternalOutbox = ref(c, 'billingOutbox', c.jobId);
  await fakeExternalOutbox.create({ accountId: c.account, jobId: c.jobId }); await failClosed(voiceBinding(c)); await fakeExternalOutbox.delete();
  assert.equal((await voiceBinding(c)).inputGeneration, '9007199254740993');
  await unchangedFinancialState(c);
});

test('voice source rejects lost, altered or future review and receipt shapes', async () => {
  const c = await savedVoiceFixture(), first = await voiceBinding(c);
  const review = ref(c, 'reviewedTranslations', first.reviewId), receipt = ref(c, 'reviewRequests', first.receiptId);
  const savedReview = (await review.get()).data(), savedReceipt = (await receipt.get()).data();
  await review.delete(); await failClosed(voiceBinding(c)); await review.set(savedReview);
  await receipt.delete(); await failClosed(voiceBinding(c)); await receipt.set(savedReceipt);
  await review.update({ voiceSha256: 'c'.repeat(64) }); await failClosed(voiceBinding(c)); await review.set(savedReview);
  await receipt.update({ payloadSha256: 'd'.repeat(64) }); await failClosed(voiceBinding(c)); await receipt.set(savedReceipt);
  await receipt.update({ createdAtMs: savedReceipt.createdAtMs + 1 }); await failClosed(voiceBinding(c)); await receipt.set(savedReceipt);
  await review.update({ futureField: true }); await failClosed(voiceBinding(c)); await review.set(savedReview);
  await receipt.update({ futureField: true }); await failClosed(voiceBinding(c)); await receipt.set(savedReceipt);
  assert.equal((await voiceBinding(c)).reviewId, first.reviewId);
  await unchangedFinancialState(c);
});

test('voice binding reports document versions even if identity or review is changed and restored', async () => {
  const c = await savedVoiceFixture(), before = await voiceBinding(c);
  const identity = ref(c, 'identities', before.identityKey), review = ref(c, 'reviewedTranslations', before.reviewId);
  const initialIdentity = (await identity.get()).data(), initialReview = (await review.get()).data();
  await identity.update({ uid: c.foreignPrincipal.uid }); await identity.set(initialIdentity);
  await review.update({ bindingHash: 'e'.repeat(64) }); await review.set(initialReview);
  const after = await voiceBinding(c);
  assert.equal(after.identityKey, before.identityKey); assert.equal(after.payloadSha256, before.payloadSha256);
  assert.notEqual(after.versions.principalIdentity.updateTime, before.versions.principalIdentity.updateTime);
  assert.notEqual(after.versions.review.updateTime, before.versions.review.updateTime);
  // The reader reports versions; only a future caller can compare them inside
  // its own transaction. This is not a durable witness or a remote ACK.
  await unchangedFinancialState(c);
});

test('a caller can bind its own write to the same transaction; revocation before the read blocks that write', async () => {
  const c = await savedVoiceFixture(), marker = ref(c, 'syntheticAdmissions', randomUUID());
  await c.db.runTransaction(async tx => {
    const binding = await c.service.voiceBindingInTransaction(tx, c.principal, c.input, c.jobId, 2);
    tx.create(marker, { reviewId: binding.reviewId, payloadSha256: binding.payloadSha256 });
  });
  assert.equal((await marker.get()).exists, true);
  const identity = ref(c, 'identities', sha(JSON.stringify(['firebase', c.uid]))), original = (await identity.get()).data();
  await identity.delete(); const blocked = ref(c, 'syntheticAdmissions', randomUUID());
  await failClosed(c.db.runTransaction(async tx => {
    const binding = await c.service.voiceBindingInTransaction(tx, c.principal, c.input, c.jobId, 2);
    tx.create(blocked, { reviewId: binding.reviewId });
  }));
  assert.equal((await blocked.get()).exists, false); await identity.set(original);
  await unchangedFinancialState(c);
});

test('voice source revalidates synthetic external capture and its correlated admission history', async () => {
  const c = await fixture(), target = await secondSyntheticJob(c);
  await attachSyntheticExternalHistory(c, target);
  await c.service.saveReview(c.principal, { inputId: target.input, jobId: target.jobId, expectedRevision: 1,
    requestKey: randomUUID(), edits: target.edits });
  const baseline = await financialState(c), first = await voiceBinding(c, c.principal, target.input, target.jobId, 2);
  assert.equal(first.versions.external.intent.exists, true); assert.equal(first.versions.external.intentGuard.exists, true);
  assert.equal(first.versions.billingOutbox.exists, true); assert.equal(first.versions.reserveMovement.exists, false);
  const job = (await ref(c, 'jobs', target.jobId).get()).data(), intentId = sha(JSON.stringify([c.account, job.requestKey]));
  const guard = ref(c, 'billingIntentAdmissionGuards', intentId), saved = (await guard.get()).data();
  await guard.update({ state: 'needs_review' });
  await failClosed(voiceBinding(c, c.principal, target.input, target.jobId, 2));
  await guard.set(saved);
  assert.equal((await voiceBinding(c, c.principal, target.input, target.jobId, 2)).reviewId, first.reviewId);
  await unchangedFinancialState(c, baseline);
});

test('every review and receipt field rejects nested values and every returned property is immutable', { timeout: 240_000 }, async () => {
  const c = await savedVoiceFixture(), binding = await voiceBinding(c);
  const reviewRef = ref(c, 'reviewedTranslations', binding.reviewId), receiptRef = ref(c, 'reviewRequests', binding.receiptId);
  const reviewBefore = (await reviewRef.get()).data(), receiptBefore = (await receiptRef.get()).data();
  const unexpected = [];
  for (const [label, document, original] of [['review', reviewRef, reviewBefore], ['receipt', receiptRef, receiptBefore]]) {
    for (const field of Object.keys(original)) {
      for (const [kind, replacement] of [['object', { nested: 'synthetic' }], ['array', ['synthetic']]]) {
        await document.set({ ...original, [field]: replacement });
        const result = await observed(voiceBinding(c));
        if (!result.error) unexpected.push(`${label}.${field}:${kind}`);
        await document.set(original);
      }
    }
  }
  // Do not serialize a returned binding or its payload into this result; report
  // only field names if a synthetic malformed record is incorrectly accepted.
  assert.deepEqual(unexpected, [], 'Nested objects or arrays were accepted for a scalar source field');
  const seen = new Set();
  function immutableTree(value, path) {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value); assert.equal(Object.isFrozen(value), true, `Object is not frozen at ${path}`);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key), label = `${path}.${String(key)}`;
      assert.ok(descriptor && 'value' in descriptor, `Accessor encountered at ${label}`);
      assert.equal(descriptor.writable, false, `Writable value at ${label}`);
      assert.equal(descriptor.configurable, false, `Configurable value at ${label}`);
      assert.equal(Reflect.set(value, key, 'synthetic replacement'), false, `Mutation accepted at ${label}`);
      assert.equal(Reflect.deleteProperty(value, key), false, `Deletion accepted at ${label}`);
      immutableTree(descriptor.value, label);
    }
  }
  immutableTree(binding, 'binding');
  assert.equal((await voiceBinding(c)).reviewId, binding.reviewId);
  await unchangedFinancialState(c);

  // The external-account branch adds another nested version object. Check all
  // of its properties too, using correlated synthetic records only.
  const external = await secondSyntheticJob(c); await attachSyntheticExternalHistory(c, external);
  await c.service.saveReview(c.principal, { inputId: external.input, jobId: external.jobId, expectedRevision: 1,
    requestKey: randomUUID(), edits: external.edits });
  const externalBaseline = await financialState(c), externalBinding = await voiceBinding(c, c.principal, external.input, external.jobId, 2);
  assert.ok(externalBinding.versions.external); immutableTree(externalBinding, 'externalBinding');
  await unchangedFinancialState(c, externalBaseline);
});

test('fractional source duration bills the verified whole seconds without millisecond truncation', { timeout: 60_000 }, async () => {
  const c = await savedVoiceFixture({ durationSeconds: 2.0004 }), binding = await voiceBinding(c);
  // 2.0004 s truncates to 2,000 ms for cue timing but still reserves 3 source seconds.
  assert.equal(binding.durationMs, 2_000); assert.equal(binding.billableSeconds, 3);
  assert.equal((await ref(c, 'jobs', c.jobId).get()).get('price'), 3);
  const input = ref(c, 'inputs', c.input), initialInput = (await input.get()).data();
  for (const duration of [0, -1, NaN, Infinity, 600.0001, null, '2']) {
    await input.update({ 'metadata.duration': duration }); await failClosed(voiceBinding(c)); await input.set(initialInput);
  }
  const job = ref(c, 'jobs', c.jobId), initialJob = (await job.get()).data();
  for (const price of [2, 4]) { await job.update({ price }); await failClosed(voiceBinding(c)); await job.set(initialJob); }
  const restored = await voiceBinding(c); assert.equal(restored.billableSeconds, 3);
  await unchangedFinancialState(c);
});

test('the maximum supported source duration bills 600 seconds and rejects values above it', { timeout: 60_000 }, async () => {
  const c = await savedVoiceFixture({ durationSeconds: 600 }), binding = await voiceBinding(c);
  assert.equal(binding.durationMs, 600_000); assert.equal(binding.billableSeconds, 600);
  assert.equal((await c.root.collection('providerCalls').where('jobId', '==', c.jobId).get()).size, 20);
  const input = ref(c, 'inputs', c.input), initial = (await input.get()).data();
  await input.update({ 'metadata.duration': 600.0001 }); await failClosed(voiceBinding(c)); await input.set(initial);
  assert.equal((await voiceBinding(c)).billableSeconds, 600); await unchangedFinancialState(c);
});
