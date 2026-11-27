// Local-only rules preflight. No cloud, no credentials, no retries.
// Runs as a child of runFinancialRegressionEmulator.mjs under the existing guard.
// stdin: exact bytes of deploy/google-cloud/firestore.rules.
// argv[2]: expected SHA-256 of those bytes.
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import { FINANCIAL_ROOT_COLLECTIONS } from '../server/commercial/financialOwnedRootGuard.mjs';

const PROJECT = 'demo-vistavo-financial';
const HOST = '127.0.0.1';
const PORT = 8198;
const AUTHORITY = `${HOST}:${PORT}`;
const PROBE_COLLECTION = 'lv019bRulesPreflight';
const MAX_INPUT = 1024 * 1024;
const MAX_BODY = 1024 * 1024;
const TIMEOUT_MS = 10_000;

function fail(message) { throw Error(message); }
function assertLocalIdentity() {
  if (process.platform !== 'win32') fail('Windows only');
  if (process.env.FIRESTORE_EMULATOR_HOST !== AUTHORITY) fail('Unexpected emulator host');
  if (process.env.GOOGLE_CLOUD_PROJECT !== PROJECT || process.env.GCLOUD_PROJECT !== PROJECT) fail('Unexpected project');
  if (process.env.METADATA_SERVER_DETECTION !== 'none') fail('Metadata server detection must be disabled');
  if (process.env.LV_FINANCIAL_REGRESSION !== '1') fail('Missing financial regression marker');
  if (process.env.NODE_OPTIONS || process.env.GOOGLE_APPLICATION_CREDENTIALS) fail('Unexpected inherited environment');
  if (typeof PROBE_COLLECTION !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,62}$/.test(PROBE_COLLECTION)) fail('Invalid probe collection identifier');
  if (PROBE_COLLECTION.startsWith('__')) fail('Probe collection identifier is reserved');
  if (FINANCIAL_ROOT_COLLECTIONS.includes(PROBE_COLLECTION)) fail('Probe collection collides with financial roots');
}
function readStdin(maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    process.stdin.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) { reject(Error('Rules input too large')); process.stdin.destroy(); return; }
      chunks.push(chunk);
    });
    process.stdin.once('error', reject);
    process.stdin.once('end', () => resolve(Buffer.concat(chunks)));
  });
}
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(body, 'utf8');
    const req = http.request({
      host: HOST, port: PORT, method, path, agent: false, timeout: TIMEOUT_MS,
      localAddress: HOST,
      headers: {
        Accept: 'application/json', Connection: 'close',
        ...(payload ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length } : {}),
      },
    }, res => {
      const chunks = []; let total = 0;
      res.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_BODY) { res.destroy(Error('Response too large')); return; }
        chunks.push(chunk);
      });
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('timeout', () => req.destroy(Error('Local request timed out')));
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function parseObject(text, label) {
  if (!text) return {};
  let value;
  try { value = JSON.parse(text); } catch { fail(`${label} response is not JSON`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} response is not an object`);
  return value;
}
async function main() {
  assertLocalIdentity();
  if (process.argv.length !== 3 || !/^[a-f0-9]{64}$/.test(process.argv[2])) fail('Expected rules SHA-256');
  const expected = process.argv[2];
  const rules = await readStdin(MAX_INPUT);
  const actual = createHash('sha256').update(rules).digest('hex');
  if (actual !== expected) fail('Rules input hash mismatch');
  const rulesText = rules.toString('utf8');
  if (!rulesText.trim()) fail('Rules input is empty');
  if (!rulesText.includes("rules_version = '2';") || !rulesText.includes('allow read, write: if false;')) {
    fail('Rules input is not the expected deny-all file');
  }

  const load = await request('PUT', `/emulator/v1/projects/${PROJECT}:securityRules`, JSON.stringify({
    rules: { files: [{ name: 'security.rules', content: rulesText }] },
  }));
  if (load.status !== 200) fail(`Rules load returned ${load.status}`);
  const loadBody = parseObject(load.body, 'Rules load');
  const issues = 'issues' in loadBody ? loadBody.issues : [];
  if (!Array.isArray(issues)) fail('Rules load issues is not an array');
  if (issues.length !== 0) fail(`Rules load reported ${issues.length} issue(s): ${JSON.stringify(issues).slice(0, 4000)}`);

  const probe = await request('GET', `/v1/projects/${PROJECT}/databases/(default)/documents/${PROBE_COLLECTION}/probe`);
  if (probe.status !== 403) fail(`Unauthenticated client probe returned ${probe.status}`);

  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (typeof initializeApp !== 'function' || typeof deleteApp !== 'function' || typeof getFirestore !== 'function') {
    fail('Modular firebase-admin entry points unavailable');
  }
  let app = null;
  let db = null;
  let initFailure = null;
  let readFailure = null;
  let exists = null;
  let terminateFailure = null;
  let deleteFailure = null;
  try {
    app = initializeApp({ projectId: PROJECT }, `lv019b-rules-preflight-${randomUUID()}`);
    db = getFirestore(app);
    try {
      const snapshot = await db.collection(PROBE_COLLECTION).doc('missing-probe').get();
      exists = snapshot && typeof snapshot.exists === 'boolean' ? snapshot.exists : null;
    } catch (error) {
      readFailure = error;
    }
  } catch (error) {
    initFailure = error;
  }
  if (db !== null) {
    try {
      await db.terminate();
    } catch (error) {
      terminateFailure = error;
    }
  }
  if (app !== null) {
    try {
      await deleteApp(app);
    } catch (error) {
      deleteFailure = error;
    }
  }
  if (initFailure) fail('Admin SDK initialization failed');
  if (readFailure) fail('Admin SDK read of a missing document failed');
  if (exists !== false) fail('Admin SDK missing-document read did not report a missing document');
  if (terminateFailure) fail('Admin SDK Firestore client did not terminate');
  if (deleteFailure) fail('Admin SDK app did not delete');

  process.stdout.write(`${JSON.stringify({
    version: 1, project: PROJECT, host: AUTHORITY, rulesSha256: actual,
    rulesLoad: { status: load.status, issues: issues.length },
    clientProbe: { status: probe.status },
    adminProbe: { status: 'PASS', wrote: false, exists },
  })}\n`);
}
main().catch(error => { process.stderr.write(`${error?.message ?? error}\n`); process.exitCode = 1; });
