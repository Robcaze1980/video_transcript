// Real local browser -> same-origin firestoreHttp -> reviewedTranslationHttp ->
// Firestore Emulator. Auth Emulator identities and all objects/balance are
// synthetic. Run only through the reviewed manifest launcher, never directly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from 'firebase-admin/firestore';
import { build } from 'esbuild';
import { FirestoreBackend } from './firestoreBackend.ts';
import { FirestoreFiles } from './firestoreFiles.ts';
import { FirestoreAi } from './firestoreAi.ts';
import { FirestoreReviewedTranslation } from './firestoreReviewedTranslation.ts';
import { firestoreHttp } from './firestoreHttp.ts';
import { AI_CATALOG_VERSION } from './aiContracts.ts';
import { objectPlan, privateBucket, privateChunkBytes } from './privateObjectPlan.ts';
import { encodeTextBundle } from './pipelineTextCodec.ts';
import { textModel } from './pipelineTextProvider.ts';
import { assertReviewGuard, createReviewHandlerTracker, createReviewResourceJournal, inspectReviewEmulators, syntheticReviewBrowserPlugins } from './web/reviewBrowserFixtureBuild.mjs';
import { cdpPipe, captureChromeStderr } from './web/reviewBrowserCdp.mjs';
import { assertHeadlessBrowserProduct, readPinnedBrowserIdentity } from './web/reviewBrowserBinaryIdentity.mjs';

const project = 'demo-vistavo-review-browser', firestoreHost = '127.0.0.1:18765', authHost = '127.0.0.1:18766';
const collection = 'vistavo_review_browser_synthetic', purpose = 'review-browser-emulator-synthetic-v1';
const workspace = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const sha = value => createHash('sha256').update(value).digest('hex');
const matches = (value, regex) => typeof value === 'string' && regex.test(value);

function assertEnvironment() {
  assert.equal(process.platform, 'win32'); assert.match(process.version, /^v24\./);
  assert.equal(realpathSync(process.cwd()).toLowerCase(), workspace.toLowerCase());
  assert.equal(process.env.NODE_ENV, 'test'); assert.equal(process.env.LV_REVIEW_BROWSER_FIXTURE, '1');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, firestoreHost); assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, authHost);
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT, project); assert.equal(process.env.GCLOUD_PROJECT, project);
  assert.equal(process.env.METADATA_SERVER_DETECTION, 'none');
  const guardNonce = process.env.LV_REVIEW_BROWSER_GUARD_NONCE, guard = globalThis[Symbol.for('vistavo.review.browser.guard.v1')];
  assertReviewGuard(guard, guardNonce, process.pid);
  for (const key of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_CONFIG',
    'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT',
    'GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN','GOOGLE_API_KEY','GOOGLE_CLOUD_API_KEY','GOOGLE_AUTH_CREDENTIALS',
    'GOOGLE_SERVICE_ACCOUNT','GOOGLE_CLOUD_QUOTA_PROJECT','GEMINI_API_KEY','GOOGLE_GENAI_API_KEY','OPENROUTER_API_KEY',
    'AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','FIREBASE_CONFIG','GCE_METADATA_HOST','GCE_METADATA_IP',
    'K_SERVICE','K_REVISION','K_CONFIGURATION','FUNCTION_TARGET','FUNCTION_NAME','GAE_SERVICE','GAE_ENV',
    'VISTAVO_AI_ENABLED','VISTAVO_LOCAL_CLOUD','VISTAVO_PUBLIC_ORIGIN']) assert.equal(process.env[key], undefined, `Forbidden environment: ${key}`);
  const run = resolve(process.env.LV_REVIEW_BROWSER_RUN_DIR ?? ''), base = resolve(workspace, 'outputs/lv019-b-review-browser-runs');
  const part = relative(base, run); assert.match(part, /^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(realpathSync(run).toLowerCase(), run.toLowerCase());
  const profile = resolve(process.env.USERPROFILE ?? '');
  assert.equal(profile, join(run, 'profile')); assert.equal(process.env.APPDATA, profile); assert.equal(process.env.LOCALAPPDATA, profile);
  assert.equal(process.env.HOMEDRIVE, parse(profile).root.slice(0, 2)); assert.equal(process.env.HOMEPATH, profile.slice(2));
  assert.equal(process.env.SYSTEMDRIVE, parse(process.env.SystemRoot ?? '').root.slice(0, 2));
  assert.equal(process.env.USERNAME, 'synthetic-review'); assert.equal(process.env.USERDOMAIN, 'SYNTHETIC'); assert.equal(process.env.LOGONSERVER, 'SYNTHETIC');
  assert.equal(realpathSync(profile).toLowerCase(), profile.toLowerCase());
  assert.equal(existsSync(join(profile, 'gcloud', 'application_default_credentials.json')), false);
  return { run, profile };
}
function assertClient(db) {
  const settings = db._settings;
  assert.equal(db.projectId, project); assert.equal(db.databaseId, '(default)');
  assert.equal(settings?.projectId, project); assert.equal(settings?.servicePath, '127.0.0.1'); assert.equal(settings?.port, 18765);
  assert.equal(settings?.ssl, false); assert.equal(settings?.preferRest, false);
  for (const key of ['auth','credentials','keyFilename','authClient']) assert.equal(settings?.[key], undefined);
}
async function descendants(doc, found = []) {
  for (const collection of await doc.listCollections()) for (const child of await collection.listDocuments()) {
    found.push(child); await descendants(child, found);
  }
  return found;
}
class SyntheticObjects {
  data = new Map(); reads = 0;
  async read(object) {
    this.reads++; const item = this.data.get(object.key);
    if (!item || item.generation !== object.generation) throw Error('Synthetic object generation unavailable');
    return Readable.from([Buffer.from(item.bytes)]);
  }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await predicate()) return; await sleep(100); }
  throw Error(`Synthetic timeout: ${label}`);
}

test('same-origin browser edits and downloads an authorized Firestore Emulator review', async () => {
  const { run, profile } = assertEnvironment();
  const guardMarker = process.env.LV_REVIEW_BROWSER_PROFILE_MARKER;
  assert.ok(matches(guardMarker, /^[a-f0-9]{32}$/));
  assert.equal(await readFile(join(profile, '.synthetic-profile-owner'), 'utf8'), guardMarker);
  assert.deepEqual((await readdir(profile)).sort(), ['.synthetic-profile-owner']);
  const proofBytes = await readFile(join(run, 'emulator-proof.json'));
  assert.ok(matches(process.env.LV_REVIEW_BROWSER_PROOF_SHA256, /^[a-f0-9]{64}$/));
  assert.equal(sha(proofBytes), process.env.LV_REVIEW_BROWSER_PROOF_SHA256);
  const proof = JSON.parse(proofBytes.toString('utf8'));
  assert.equal(proof.version, 1); assert.equal(proof.project, project);
  assert.equal(resolve(proof.expected.node).toLowerCase(), resolve('C:/Users/rob62/AppData/Local/LinguistVision/tools/node-v24.13.0-win-x64/node.exe').toLowerCase());
  assert.equal(resolve(proof.expected.java).toLowerCase(), resolve('C:/Program Files/Java/jdk-24/bin/java.exe').toLowerCase());
  assert.equal(resolve(proof.expected.cli).toLowerCase(), resolve('C:/Users/rob62/AppData/Roaming/npm/node_modules/firebase-tools/lib/bin/firebase.js').toLowerCase());
  const configPath = resolve(proof.expected.config), configDir = resolve(workspace, 'outputs/lv019-b-review-browser-manifests');
  const jarPath = resolve(proof.expected.jar), cacheDir = dirname(jarPath);
  assert.equal(dirname(cacheDir).toLowerCase(), configDir.toLowerCase()); assert.match(cacheDir, /cache-[a-f0-9-]{36}$/i);
  assert.equal(jarPath.slice(cacheDir.length + 1), 'cloud-firestore-emulator-v1.21.0.jar');
  assert.equal(lstatSync(jarPath).isSymbolicLink(), false); assert.equal(realpathSync(jarPath).toLowerCase(), jarPath.toLowerCase());
  const jarHash = createHash('sha256'); for await (const bytes of createReadStream(jarPath)) jarHash.update(bytes);
  assert.equal(jarHash.digest('hex'), proof.jarSha256);
  assert.equal(dirname(configPath).toLowerCase(), configDir.toLowerCase()); assert.match(configPath, /config-[a-f0-9-]{36}\.json$/i);
  assert.equal(lstatSync(configPath).isSymbolicLink(), false); assert.equal(realpathSync(configPath).toLowerCase(), configPath.toLowerCase());
  assert.equal(sha(await readFile(configPath)), proof.configSha256);
  const identity = value => JSON.stringify({ auth: value.auth, firestore: value.firestore });
  const checkProvenance = () => {
    assert.equal(lstatSync(configPath).isSymbolicLink(), false); assert.equal(realpathSync(configPath).toLowerCase(), configPath.toLowerCase());
    assert.equal(sha(readFileSync(configPath)), proof.configSha256, 'Dedicated emulator config changed');
    const current = inspectReviewEmulators(proof.expected);
    assert.equal(identity(current), identity(proof.identity), 'Dedicated emulator process identity changed');
  };
  checkProvenance();
  const chromeProfile = join(profile, 'chrome'), downloads = join(run, 'downloads'), assets = join(run, 'assets');
  await mkdir(chromeProfile); await mkdir(downloads); await mkdir(assets);
  // Every external resource is journaled and flushed BEFORE the first write.
  // No password, token, local credential, or customer data belongs here.
  const resourceJournal = createReviewResourceJournal(join(run, 'synthetic-resources.ndjson'));
  const journal = resourceJournal.append;
  const db = new Firestore({ projectId: project, host: firestoreHost, ssl: false, preferRest: false }); assertClient(db);
  const root = db.collection(collection).doc(randomUUID()), marker = randomUUID();
  assert.equal(root.path, `${collection}/${root.id}`); assert.match(root.id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const backend = new FirestoreBackend(db, root), objects = new SyntheticObjects(), app = initializeApp({ projectId: project }, `review-browser-${randomUUID()}`), auth = getAuth(app);
  const users = [], references = [], logs = [], downloadResponses = [], downloadsStarted = new Map(), downloadsFinished = new Set(), blocked = [];
  let markerConfirmed = false, server, proxy, browser, cdp, chromeStderr, sessionId, candidateOrigin, cleanupErrors = [], chromeExited = false, proxyAttempts = 0;
  let authCleaned = 0, firestoreCleaned = false, chromeCleaned = false, storyCompleted = false, safeToClean = true, accepting = true;
  const handlers = createReviewHandlerTracker();
  const doc = (collection, id) => { const ref = root.collection(collection).doc(id); references.push(ref); return ref; };
  try {
    assert.equal((await root.get()).exists, false); assert.deepEqual(await root.listCollections(), []);
    journal('firestore_root_planned', { path: root.path, marker, purpose, project }); checkProvenance();
    await root.create({ marker, purpose, project });
    const marked = await root.get(); assert.equal(marked.get('marker'), marker); assert.equal(marked.get('purpose'), purpose); assert.equal(marked.get('project'), project); markerConfirmed = true;
    journal('firestore_root_confirmed', { path: root.path });
    for (const role of ['owner', 'other']) {
      const uid = `review-browser-${randomUUID()}`, email = `review-${randomUUID()}@example.invalid`, password = randomBytes(18).toString('base64url') + 'Aa1!';
      const attempt = { uid, email, password, confirmed: false }; users.push(attempt);
      journal('auth_user_planned', { uid, email, marker, project }); checkProvenance();
      await auth.createUser({ uid, email, password, emailVerified: true, displayName: marker });
      const check = await auth.getUser(uid); assert.equal(check.uid, uid); assert.equal(check.email, email); assert.equal(check.emailVerified, true); assert.equal(check.displayName, marker); attempt.confirmed = true;
      journal('auth_user_confirmed', { uid });
      attempt.account = await backend.accountForUid(uid); await doc('accounts', attempt.account).update({ aiPilot: true, simulationOnly: true });
      references.push(doc('identities', sha(JSON.stringify(['firebase', uid]))));
    }
    const [owner, other] = users; assert.notEqual(owner.account, other.account);
    checkProvenance(); await backend.creditVerifiedPurchase(owner.account, `synthetic-${randomUUID()}`, 10, 1, 'synthetic-browser', 'sandbox');
    const input = randomUUID(), video = Buffer.from('synthetic video only'), videoSha = sha(video), generation = '9007199254740993';
    const plan = objectPlan(input, video.length, privateChunkBytes), videoObject = { bucket: privateBucket, key: plan.final, generation, size: video.length, sha256: videoSha };
    objects.data.set(plan.final, { generation, bytes: video });
    await doc('inputs', input).create({ accountId: owner.account, expiresAtMs: Date.now() + 3_600_000, sha256: videoSha,
      deleted: false, ready: true, unknownCount: 0, metadata: { duration: 2, audioTracks: 1 }, storage: videoObject });
    await doc('uploads', input).create({ id: input, accountId: owner.account, name: 'synthetic.mp4', size: video.length,
      expectedSha: videoSha, expiresAtMs: Date.now() + 3_600_000, chunkBytes: privateChunkBytes, plan, state: 'ready', offset: video.length,
      chunks: [{ index: 0, size: video.length, sha256: videoSha, generation }], manifestSha: null,
      quotaHeld: 0, quotaMode: 'none', activeHeld: false, leaseToken: null, leaseUntil: null, attempts: 0,
      receipt: { object: videoObject, sha256: videoSha, video: { duration: 2, width: 160, height: 90, audioTracks: 1 }, manifestSha: 'a'.repeat(64) },
      failure: null, purgeState: 'pending' });
    await backend.saveProject(owner.account, input, 0, ''); references.push(doc('projects', input));
    const reserved = await backend.reserve(owner.account, input, randomUUID(), 2, 'translation:en', 1, AI_CATALOG_VERSION);
    const jobId = reserved; // The backend generates this synthetic job ID.
    for (const [name, id] of [['jobs',jobId],['jobAccounting',jobId],['artifacts',jobId],['outbox',jobId],
      ['movements',`reserve:${jobId}`],['movements',`terminal:${jobId}`],['providerCalls',`${jobId}-text-window-0000`]]) doc(name,id);
    const attempt = await backend.claim(owner.account, jobId); assert.ok(attempt);
    const jobData = await backend.job(owner.account, jobId);
    assert.equal(await backend.resumeTextAfterLocalCheck(owner.account, jobId, attempt.attemptId, jobData.inputStorage, 'nonzero'), true);
    assert.equal(await backend.beginInvocation(owner.account, jobId, attempt.attemptId), true);
    await doc('providerCalls', `${jobId}-text-window-0000`).create({ jobId, accountId: owner.account, attemptId: attempt.attemptId,
      callKey: 'text-window:0000', model: textModel, state: 'received', httpStatus: 200,
      requestSha256: 'a'.repeat(64), responseSha256: 'b'.repeat(64), responseId: 'synthetic-only', usage: { totalTokenCount: 1 }, fixtureOnly: true });
    const bundle = encodeTextBundle(jobId, 2_000, { detectedLanguage: 'es', hasSpeech: true, cues: [
      { startMs: 0, endMs: 900, es: 'José revisa la bomba.', en: 'José checks the pump.' },
      { startMs: 1_000, endMs: 1_800, es: 'Mide cinco centímetros.', en: 'It measures five centimeters.' },
    ] });
    const buffers = new Map([['transcript-es.txt',bundle.es.txtBytes],['transcript-es.srt',bundle.es.srtBytes],
      ['translation-en.txt',bundle.en.txtBytes],['translation-en.srt',bundle.en.srtBytes],
      ['cues.json',Buffer.from(JSON.stringify({ durationMs: bundle.durationMs, cues: bundle.cues }))]]);
    const artifactPlan = (await root.collection('artifacts').doc(jobId).get()).get('plan');
    const entries = artifactPlan.artifacts.map((spec, index) => {
      const bytes = buffers.get(spec.name), version = String(9007199254741000n + BigInt(index)); assert.ok(bytes);
      objects.data.set(spec.key, { generation: version, bytes: Buffer.from(bytes) });
      return { name: spec.name, key: spec.key, mimeType: spec.mimeType, generation: version, size: bytes.length, sha256: sha(bytes) };
    });
    assert.equal(await backend.stageArtifactReceipt(owner.account, jobId, attempt.attemptId, entries), true);
    assert.equal(await backend.finish(owner.account, jobId, attempt.attemptId, true), true);
    const beforeBalance = await backend.readBalance(owner.account), beforeOtherBalance = await backend.readBalance(other.account), beforeCalls = await root.collection('providerCalls').get();
    assert.equal(beforeCalls.size, 1); assert.equal((await root.collection('movements').doc(`terminal:${jobId}`).get()).get('kind'), 'capture');
    const files = new FirestoreFiles(db, root, objects), ai = new FirestoreAi(db, root, backend, objects), reviewed = new FirestoreReviewedTranslation(db, root, backend, objects);

    // Only this build swaps the auth module and the hard-coded off switch.
    assert.match(await readFile(resolve(workspace, 'server/commercial/web/reviewedTranslationFeature.ts'), 'utf8'), /REVIEWED_TRANSLATION_CANDIDATE:\s*boolean\s*=\s*false/);
    for (const [name, enableReview] of [['off',false],['on',true]]) await build({ absWorkingDir: workspace, entryPoints: ['server/commercial/web/cloudCandidate.tsx'], bundle: true, format: 'esm', platform: 'browser',
      outdir: assets, entryNames: name, plugins: syntheticReviewBrowserPlugins({ enableReview }), logLevel: 'silent' });
    let handler;
    server = createServer((req, res) => { void handlers.run(async () => {
      try {
        if (!accepting) return res.writeHead(503, { 'Cache-Control': 'no-store' }).end();
        const address = server.address(); if (!address || typeof address === 'string' || req.headers.host !== `127.0.0.1:${address.port}`) return res.writeHead(400).end();
        const url = new URL(req.url ?? '/', candidateOrigin); const pathname = url.pathname;
        if (['/off','/on'].includes(pathname) && req.method === 'GET') {
          const name = pathname.slice(1);
          const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:18766; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
          return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp, 'Cache-Control': 'no-store' }).end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${name}.css"><div id="cloud-candidate"></div><script type="module" src="/${name}.js"></script>`);
        }
        if (['/off.js','/off.css','/on.js','/on.css'].includes(pathname) && req.method === 'GET') return res.writeHead(200, { 'Content-Type': pathname.endsWith('.js') ? 'text/javascript' : 'text/css', 'Cache-Control': 'no-store' }).end(await readFile(join(assets, pathname.slice(1))));
        if (pathname === '/brand/vistavo-symbol.svg' && req.method === 'GET') return res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg"/>');
        if (pathname === '/favicon.ico') return res.writeHead(404).end();
        const permitted = pathname === '/api/cloud/me' && req.method === 'GET' || pathname === `/api/cloud/uploads/${input}` && ['GET','DELETE'].includes(req.method) ||
          pathname === `/api/cloud/projects/${input}` && req.method === 'GET' || pathname === `/api/cloud/ai/jobs/${jobId}` && req.method === 'GET' ||
          pathname === `/api/cloud/ai/jobs/${jobId}/review` && ['GET','PUT'].includes(req.method) || pathname === `/api/cloud/ai/jobs/${jobId}/review/download` && req.method === 'GET';
        if (!permitted) return res.writeHead(404, { 'Cache-Control': 'no-store' }).end();
        res.on('finish', () => logs.push({ method: req.method, path: pathname, status: res.statusCode, cache: res.getHeader('cache-control') }));
        await handler(req, res);
      } catch { if (!res.headersSent) res.writeHead(500, { 'Cache-Control': 'no-store' }).end(); else res.destroy(); }
    }); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); assert.ok(address && typeof address !== 'string' && address.address === '127.0.0.1');
    candidateOrigin = `http://127.0.0.1:${address.port}`;
    handler = firestoreHttp({ backend, identity: auth, origin: candidateOrigin, files, ai, reviewedTranslation: reviewed });

    // A local proxy destroys every connection; Chrome bypasses it only for
    // loopback. This is defense in depth, not an OS-level firewall.
    proxy = createTcpServer(socket => { proxyAttempts++; socket.destroy(); });
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
    const proxyAddress = proxy.address(); assert.ok(proxyAddress && typeof proxyAddress !== 'string' && proxyAddress.address === '127.0.0.1');
    const chrome = readPinnedBrowserIdentity().path;
    journal('chrome_planned', { profile: chromeProfile });
    browser = spawn(chrome, ['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--disable-extensions',
      '--disable-quic','--disable-component-update','--disable-domain-reliability','--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--proxy-server=http://127.0.0.1:${proxyAddress.port}`,'--proxy-bypass-list=127.0.0.1',
      '--remote-debugging-pipe',`--user-data-dir=${chromeProfile}`,'about:blank'],
      { windowsHide: true, stdio: ['ignore','ignore','pipe','pipe','pipe'] });
    browser.once('exit', () => { chromeExited = true; }); browser.once('error', () => { chromeExited = true; });
    chromeStderr = captureChromeStderr(browser.stderr); cdp = cdpPipe(browser);
    assert.ok(Number.isSafeInteger(browser.pid) && browser.pid > 0);
    journal('chrome_started', { pid: browser.pid, profile: chromeProfile });
    await writeFile(join(run, 'chrome-owned.json'), JSON.stringify({ pid: browser.pid, profile: chromeProfile, profileMarkerSha256: sha(guardMarker) }, null, 2), { flag: 'wx' });
    assertHeadlessBrowserProduct(await cdp.send('Browser.getVersion')); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    sessionId = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    const inflight = new Set(), exceptions = [];
    cdp.on(event => {
      if (event.method === 'Browser.downloadWillBegin') downloadsStarted.set(event.params.guid, event.params.suggestedFilename);
      if (event.method === 'Browser.downloadProgress' && event.params.state === 'completed') downloadsFinished.add(event.params.guid);
      if (event.sessionId === sessionId && event.method === 'Runtime.exceptionThrown') exceptions.push('runtime_exception');
      // Keep only the response metadata under test; never retain tokens, URLs or bodies.
      if (event.sessionId === sessionId && event.method === 'Network.responseReceived') {
        try {
          const response = event.params.response, target = new URL(response.url);
          if (target.origin === candidateOrigin && target.pathname === `/api/cloud/ai/jobs/${jobId}/review/download`) {
            const headers = Object.fromEntries(Object.entries(response.headers).map(([name, value]) => [name.toLowerCase(), value]));
            downloadResponses.push({ format: target.searchParams.get('format'), status: response.status,
              cache: headers['cache-control'] ?? null, type: headers['content-type'] ?? null,
              disposition: headers['content-disposition'] ?? null, length: headers['content-length'] ?? null,
              revision: headers['x-vistavo-revision'] ?? null, noSniff: headers['x-content-type-options'] ?? null });
          }
        } catch { blocked.push('browser_response_metadata_error'); }
      }
      if (event.sessionId !== sessionId || event.method !== 'Fetch.requestPaused') return;
      const id = event.params.requestId; let allowed = false;
      try { const target = new URL(event.params.request.url); allowed = !target.username && !target.password && (target.origin === candidateOrigin || target.origin === `http://${authHost}`); } catch { /* Deny malformed targets. */ }
      if (!allowed) blocked.push('browser_request');
      const request = cdp.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId: id } : { requestId: id, errorReason: 'BlockedByClient' }, sessionId);
      inflight.add(request); request.catch(() => { blocked.push('browser_interception_error'); }).finally(() => inflight.delete(request));
    });
    await cdp.send('Page.enable', {}, sessionId); await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    const prefix = `vistavo-candidate-v1:${owner.account}:`;
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.setItem(${JSON.stringify(prefix+'input')},${JSON.stringify(input)});
      localStorage.setItem(${JSON.stringify(prefix+'job:'+input+':translation:en')},${JSON.stringify(jobId)});
      localStorage.setItem(${JSON.stringify(prefix+'upload:'+input)},${JSON.stringify(videoSha)});
      window.confirm=()=>true;
    ` }, sessionId);
    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result.exceptionDetails) throw Error('Synthetic browser evaluation failed'); return result.result.value;
    };
    const wait = (expression, label) => until(() => evaluate(expression), label);
    const click = label => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
    const login = async user => {
      await wait("document.querySelector('input[name=email]')!==null", 'login form');
      await evaluate(`document.querySelector('input[name=email]').value=${JSON.stringify(user.email)};document.querySelector('input[name=password]').value=${JSON.stringify(user.password)};void 0`);
      await click('Entrar con correo'); await wait("document.body.innerText.includes('Tu espacio privado')", 'verified emulator login');
    };
    const setCue = (index, value) => evaluate(`(()=>{const e=document.querySelector('#cv-cue-${index}');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await cdp.send('Page.navigate', { url: candidateOrigin + '/off' }, sessionId); await login(owner);
    await wait("document.body.innerText.includes('Recuperamos el último archivo')", 'default-off project recovered');
    assert.equal(await evaluate("document.body.innerText.includes('Cargar frases')"), false);
    await sleep(3_500); // Let the candidate's normal polling turn run once.
    assert.equal(logs.filter(item => item.path.includes('/review')).length, 0, 'default-off made no review request');
    await click('Cerrar sesión'); await wait("document.querySelector('input[name=email]')!==null", 'default-off signed out');
    await cdp.send('Page.navigate', { url: candidateOrigin + '/on' }, sessionId); await login(owner);
    await wait("document.body.innerText.includes('Recuperamos el último archivo')", 'owner project recovered');
    assert.equal(await evaluate('location.origin'), candidateOrigin); await click('Cargar frases'); await wait("document.querySelector('#cv-cue-0')!==null", 'source cues');
    assert.equal(await evaluate("document.querySelector('#cv-cue-0').value"), 'José checks the pump.');
    await setCue(0, 'José checks the water pump.'); await setCue(1, 'It measures 5 cm.'); checkProvenance(); await click('Guardar revisión');
    await wait("document.body.innerText.includes('Revisión guardada y reabierta')", 'review saved and reauthorized');
    await click('Volver a cargar revisión'); await wait("document.body.innerText.includes('Revisión guardada cargada')", 'review reloaded');
    assert.equal(await evaluate("document.querySelector('#cv-cue-0').value"), 'José checks the water pump.');
    assert.equal(await evaluate("document.querySelector('#cv-cue-1').value"), 'It measures 5 cm.');
    assert.equal(await evaluate("document.body.innerText.includes('0:00.000–0:00.900')"), true);
    const expected = { txt: 'José checks the water pump.\nIt measures 5 cm.\n',
      srt: '1\n00:00:00,000 --> 00:00:00,900\nJosé checks the water pump.\n\n2\n00:00:01,000 --> 00:00:01,800\nIt measures 5 cm.\n\n' };
    const assertDownloadHeaders = (response, format, status, success) => {
      assert.equal(response.format, format); assert.equal(response.status, status);
      // A malformed header could itself contain private text; never echo it on failure.
      assert.ok(response.cache === 'no-store', `${format}: invalid cache policy`);
      assert.ok(response.noSniff === 'nosniff', `${format}: invalid content protection`);
      assert.ok(response.type === (success ? (format === 'txt' ? 'text/plain; charset=utf-8' : 'application/x-subrip; charset=utf-8') : 'application/json; charset=utf-8'), `${format}: invalid content type`);
      assert.ok(response.disposition === (success ? `attachment; filename="vistavo-translation.${format}"` : null), `${format}: invalid disposition`);
      assert.ok(response.revision === (success ? '2' : null), `${format}: invalid revision header`);
      if (success) assert.ok(response.length === String(Buffer.byteLength(expected[format], 'utf8')), `${format}: invalid length`);
    };
    const oneDownloadResponse = async (start, format, label) => {
      await until(() => downloadResponses.length > start, label);
      assert.equal(downloadResponses.length, start + 1, `Unexpected number of ${label} responses`);
      const response = downloadResponses[start]; assert.equal(response.format, format); return response;
    };
    for (const [format, label, name] of [['txt','Descargar inglés TXT revisado','vistavo-translation.txt'],['srt','Descargar inglés SRT revisado','vistavo-translation.srt']]) {
      const start = downloadResponses.length;
      await click(label); await until(() => [...downloadsStarted].some(([guid, filename]) => filename === name && downloadsFinished.has(guid)), `download ${name}`);
      assertDownloadHeaders(await oneDownloadResponse(start, format, `UI ${format}`), format, 200, true);
    }
    const txt = await readFile(join(downloads, 'vistavo-translation.txt'), 'utf8'), srt = await readFile(join(downloads, 'vistavo-translation.srt'), 'utf8');
    assert.ok(txt === expected.txt, 'Downloaded TXT differs from the synthetic review');
    assert.ok(srt === expected.srt, 'Downloaded SRT differs from the synthetic review');
    const reviewPath = `/api/cloud/ai/jobs/${jobId}/review?inputId=${input}`;
    const downloadPath = format => `/api/cloud/ai/jobs/${jobId}/review/download?inputId=${input}&revision=2&format=${format}`;
    const savePath = `/api/cloud/ai/jobs/${jobId}/review`, foreignSave = { inputId: input, expectedRevision: 2, requestKey: randomUUID(), edits: bundle.cues.map(cue => ({ id: cue.id, en: 'Synthetic unauthorized edit' })) };
    const assertDenied = (value, status, code, label) => {
      assert.equal(value.status, status, label); assert.ok(value.cache === 'no-store', `${label}: invalid cache policy`);
      // Compare the exact serialized error, so duplicate JSON keys cannot hide
      // extra text; never echo a rejected response body in test output.
      assert.ok(value.body === JSON.stringify({error:code}), `${label}: unexpected or potentially private response body`);
    };
    const directDownload = async (format, invalid = false) => {
      const start = downloadResponses.length;
      const value = await evaluate(`window.__vistavoSyntheticReview.read(${JSON.stringify(downloadPath(format))},${JSON.stringify(invalid)})`);
      const response = await oneDownloadResponse(start, format, `direct ${format}`);
      assert.equal(response.status, value.status); assert.ok(response.cache === value.cache, `${format}: cache policy differs in browser`);
      return { value, response };
    };
    for (const format of ['txt','srt']) {
      const { value, response } = await directDownload(format);
      assert.equal(value.status, 200); assert.ok(value.body === expected[format], `Authorized ${format} content differs from the saved review`);
      assertDownloadHeaders(response, format, 200, true);
      const invalid = await directDownload(format, true);
      assertDenied(invalid.value, 401, 'request_rejected', `invalid token ${format}`);
      assertDownloadHeaders(invalid.response, format, 401, false);
    }
    assertDenied(await evaluate(`window.__vistavoSyntheticReview.read(${JSON.stringify(reviewPath)},true)`), 401, 'request_rejected', 'invalid token review');
    await click('Cerrar sesión'); await wait("document.querySelector('input[name=email]')!==null", 'owner signed out'); await login(other);
    assertDenied(await evaluate(`window.__vistavoSyntheticReview.read(${JSON.stringify(reviewPath)})`), 404, 'not_found', 'foreign review');
    for (const format of ['txt','srt']) {
      const { value, response } = await directDownload(format);
      assertDenied(value, 404, 'not_found', `foreign ${format}`);
      assertDownloadHeaders(response, format, 404, false);
    }
    const beforeForeignProject = (await root.collection('projects').doc(input).get()).data(), beforeForeignReceipts = (await root.collection('reviewRequests').get()).size;
    const foreignWrite = await evaluate(`window.__vistavoSyntheticReview.write(${JSON.stringify(savePath)},${JSON.stringify(foreignSave)})`);
    assertDenied(foreignWrite, 404, 'not_found', 'foreign save'); assert.deepEqual((await root.collection('projects').doc(input).get()).data(), beforeForeignProject);
    assert.equal((await root.collection('reviewRequests').get()).size, beforeForeignReceipts);
    assert.deepEqual(await backend.readBalance(other.account), beforeOtherBalance);
    await click('Cerrar sesión'); await login(owner); await wait("document.body.innerText.includes('Recuperamos el último archivo')", 'owner session reopened');
    await click('Cargar frases'); await wait("document.querySelector('#cv-cue-0')!==null", 'saved cues reopened');
    assert.equal(await evaluate("document.querySelector('#cv-cue-0').value"), 'José checks the water pump.');
    assert.deepEqual(await backend.readBalance(owner.account), beforeBalance); assert.equal((await root.collection('providerCalls').get()).size, beforeCalls.size);
    checkProvenance(); await click('Eliminar video y resultados'); await wait("document.body.innerText.includes('El acceso se retiró')", 'input access removed');
    assert.equal((await root.collection('inputs').doc(input).get()).get('deleted'), true);
    assertDenied(await evaluate(`window.__vistavoSyntheticReview.read(${JSON.stringify(reviewPath)})`), 404, 'not_found', 'removed review');
    for (const format of ['txt','srt']) {
      const { value, response } = await directDownload(format);
      assertDenied(value, 404, 'not_found', `removed ${format}`);
      assertDownloadHeaders(response, format, 404, false);
    }
    assertDenied(await evaluate(`window.__vistavoSyntheticReview.write(${JSON.stringify(savePath)},${JSON.stringify(foreignSave)})`), 404, 'not_found', 'removed save');
    assert.equal(await evaluate("document.querySelector('#cv-cue-0')===null"), true);
    assert.deepEqual(await backend.readBalance(owner.account), beforeBalance); assert.deepEqual(await backend.readBalance(other.account), beforeOtherBalance);
    assert.equal((await root.collection('providerCalls').get()).size, beforeCalls.size);
    await until(() => inflight.size === 0, 'browser network interception drained');
    assert.deepEqual(blocked, []); assert.equal(proxyAttempts, 0, 'Synthetic Chrome attempted an unexpected proxy connection'); assert.deepEqual(exceptions, []);
    assert.ok(logs.some(item => item.path.endsWith('/review') && item.method === 'PUT' && item.status === 200));
    assert.ok(logs.some(item => item.path.endsWith('/review/download') && item.status === 200));
    assert.ok(logs.some(item => item.path.endsWith('/review/download') && item.status === 404));
    assert.ok(logs.filter(item => item.path.includes('/review')).every(item => item.cache === 'no-store'));
    storyCompleted = true; console.log('Synthetic same-origin browser review story: PASS');
  } finally {
    if (browser && !chromeExited) {
      try { await cdp?.send('Browser.close'); } catch { /* The verified child is stopped below if needed. */ }
      if (!chromeExited) { browser.kill(); await until(() => chromeExited, 'synthetic Chrome exit', 10_000).catch(() => { safeToClean = false; cleanupErrors.push('chrome_exit_unconfirmed'); }); }
    }
    accepting = false;
    if (server) {
      const closed = new Promise(resolve => server.close(() => resolve(true)));
      server.closeIdleConnections?.();
      await until(() => handlers.size === 0, 'server handlers drained', 15_000).catch(() => { safeToClean = false; cleanupErrors.push('handlers_not_drained'); });
      if (!safeToClean) server.closeAllConnections();
      const stopped = await Promise.race([closed, sleep(5_000).then(() => false)]);
      if (!stopped) { safeToClean = false; cleanupErrors.push('server_close_unconfirmed'); server.closeAllConnections(); }
    }
    if (proxy) await new Promise(resolve => proxy.close(() => resolve()));
    if (safeToClean) { try { checkProvenance(); } catch { safeToClean = false; cleanupErrors.push('emulator_process_changed'); } }
    if (safeToClean) { try { journal('handlers_drained', { safeToClean: true }); } catch { safeToClean = false; cleanupErrors.push('journal_unwritable'); } }
    if (!safeToClean) { try { journal('external_cleanup_skipped', { reason: 'undrained_or_emulator_changed' }); } catch { cleanupErrors.push('journal_unwritable'); } }
    for (const user of safeToClean ? users : []) {
      if (!safeToClean) break;
      if (!user.confirmed) { safeToClean = false; cleanupErrors.push('auth_creation_unconfirmed'); break; }
      try {
        assertEnvironment(); checkProvenance(); const current = await auth.getUser(user.uid);
        assert.equal(current.uid, user.uid); assert.equal(current.email, user.email); assert.equal(current.displayName, marker);
        journal('auth_cleanup_started', { uid: user.uid }); checkProvenance();
        await auth.deleteUser(user.uid);
        await assert.rejects(auth.getUser(user.uid), error => error?.code === 'auth/user-not-found');
        authCleaned++; journal('auth_cleanup_verified', { uid: user.uid });
      } catch { safeToClean = false; cleanupErrors.push('synthetic_auth_cleanup_unverified'); }
    }
    try { if (safeToClean) {
      assertEnvironment(); checkProvenance(); assertClient(db); assert.equal(root.path, `${collection}/${root.id}`);
      if (!markerConfirmed) { journal('firestore_root_unconfirmed', { path: root.path }); assert.equal((await root.get()).exists, false); assert.deepEqual(await root.listCollections(), []); }
      else {
        const current = await root.get(); assert.equal(current.get('marker'), marker); assert.equal(current.get('purpose'), purpose); assert.equal(current.get('project'), project);
        const known = new Map((await descendants(root)).map(ref => [ref.path, ref])); for (const ref of references) known.set(ref.path, ref);
        for (const name of known.keys()) assert.ok(name.startsWith(`${root.path}/`));
        journal('firestore_cleanup_started', { path: root.path }); checkProvenance();
        await db.recursiveDelete(root); assert.equal((await root.get()).exists, false); assert.deepEqual(await root.listCollections(), []);
        for (const ref of known.values()) { assert.equal((await ref.get()).exists, false); assert.deepEqual(await ref.listCollections(), []); }
        firestoreCleaned = true; journal('firestore_cleanup_verified', { path: root.path });
      }
    } } catch { cleanupErrors.push('synthetic_firestore_cleanup_unverified'); }
    try { await db.terminate(); } catch { cleanupErrors.push('firestore_terminate'); }
    try { await deleteApp(app); } catch { cleanupErrors.push('auth_app_terminate'); }
    if (!browser || chromeExited) {
      try {
        const resolved = realpathSync(chromeProfile), expected = resolve(chromeProfile);
        assert.equal(resolved.toLowerCase(), expected.toLowerCase()); assert.equal(dirname(resolved).toLowerCase(), profile.toLowerCase());
        assert.equal(await readFile(join(profile, '.synthetic-profile-owner'), 'utf8'), guardMarker);
        await rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); assert.equal(existsSync(resolved), false); chromeCleaned = true;
      } catch { cleanupErrors.push('chrome_profile_cleanup_unverified'); }
    }
    if (browser && chromeStderr) {
      try { const diagnostics = { version: 1, ...chromeStderr.snapshot(), exitCode: browser.exitCode, signalCode: browser.signalCode };
        await writeFile(join(run, 'chrome-diagnostics.json'), JSON.stringify(diagnostics, null, 2) + '\n', { flag: 'wx' });
      } catch { cleanupErrors.push('chrome_diagnostics_unavailable'); }
    }
    try { journal('fixture_finished', { safeToClean, authCleaned, firestoreCleaned, chromeCleaned, errors: cleanupErrors }); }
    finally { resourceJournal.close(); }
    if (cleanupErrors.length) throw Error(`Synthetic cleanup incomplete: ${cleanupErrors.join(',')}`);
    if (storyCompleted) {
      assert.equal(firestoreCleaned, true); assert.equal(authCleaned, 2); assert.equal(chromeCleaned, true);
      console.log('Synthetic browser fixture cleanup verified: firestore=1 auth=2 chrome=1');
    }
  }
});
