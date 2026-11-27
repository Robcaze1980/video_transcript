// LV-019-B focused rules-loader fixture.
// No cloud, credentials, balances, file writes, or retries.
// Negative first: same rules bytes with a false SHA-256 must fail before load.
// Then exactly one positive preflight with the real SHA-256, before importing
// the original backend tests. A preflight failure aborts module evaluation,
// so no selected test is attempted.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'demo-vistavo-financial';
const AUTHORITY = '127.0.0.1:8198';
const MAX_RULES_BYTES = 1024 * 1024;
const MAX_CHILD_OUTPUT = 2 * 1024 * 1024;
const CHILD_TIMEOUT_MS = 20_000;
const BACKEND = 'server/commercial/firestoreBackend.emulator.mjs';
const FIXTURE = 'server/commercial/financialRulesFocus.emulator.mjs';
const PREFLIGHT = 'scripts/financialEmulatorRulesPreflight.mjs';
const GUARD = 'scripts/financialEmulatorNetworkGuard.cjs';
const RULES = 'deploy/google-cloud/firestore.rules';

function fail(message) { throw Error(message); }
function isInside(root, value) {
  const relative = path.relative(root, value);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
const repo = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
function repositoryFile(relative) {
  if (!/^[A-Za-z0-9@._/-]+$/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    fail('Invalid repository path');
  }
  const candidate = path.join(repo, ...relative.split('/'));
  const info = lstatSync(candidate), real = realpathSync(candidate);
  if (!info.isFile() || info.isSymbolicLink() || !isInside(repo, real)) fail(`Unsafe repository file: ${relative}`);
  return real;
}

if (process.platform !== 'win32' || !/^v24\./.test(process.version)) fail('Rules focus requires Windows Node 24');
if (process.env.FIRESTORE_EMULATOR_HOST !== AUTHORITY) fail('Unexpected emulator host');
if (process.env.GOOGLE_CLOUD_PROJECT !== PROJECT || process.env.GCLOUD_PROJECT !== PROJECT) fail('Unexpected project');
if (process.env.METADATA_SERVER_DETECTION !== 'none') fail('Metadata server detection must be disabled');
if (process.env.LV_FINANCIAL_REGRESSION !== '1') fail('Missing financial regression marker');
if (process.env.NODE_OPTIONS || process.env.GOOGLE_APPLICATION_CREDENTIALS) fail('Unexpected inherited environment');

const fixtureFile = repositoryFile(FIXTURE);
if (fixtureFile !== realpathSync(fileURLToPath(import.meta.url))) fail('Unexpected fixture location');
const backendFile = repositoryFile(BACKEND);
const preflightFile = repositoryFile(PREFLIGHT);
const guardFile = repositoryFile(GUARD);
const rulesFile = repositoryFile(RULES);

const preflightSource = readFileSync(preflightFile, 'utf8');
const hashGuardIndex = preflightSource.indexOf('Rules input hash mismatch');
const loadIndex = preflightSource.indexOf(':securityRules');
if (hashGuardIndex < 0 || loadIndex < 0 || hashGuardIndex >= loadIndex) {
  fail('Rules preflight does not reject the hash before loading rules');
}

const rulesBytes = readFileSync(rulesFile);
if (rulesBytes.length === 0 || rulesBytes.length > MAX_RULES_BYTES) fail('Unexpected rules file size');
const rulesSha256 = createHash('sha256').update(rulesBytes).digest('hex');
const fakeSha256 = '0'.repeat(64);
if (fakeSha256 === rulesSha256) fail('False hash unexpectedly equals the real rules hash');

function runPreflight(expectedSha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) return Promise.reject(Error('Invalid preflight hash'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--no-network-family-autoselection',
      '--require', guardFile,
      preflightFile,
      expectedSha256,
    ], {
      cwd: repo,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let total = 0;
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    timer = setTimeout(() => {
      child.kill();
      finish(Error('Rules preflight timed out'));
    }, CHILD_TIMEOUT_MS);
    child.once('error', error => finish(Error(`Rules preflight launch failed: ${error.message}`)));
    child.stdout.on('data', chunk => {
      total += chunk.length;
      if (total > MAX_CHILD_OUTPUT) {
        child.kill();
        finish(Error('Rules preflight output too large'));
        return;
      }
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => {
      total += chunk.length;
      if (total > MAX_CHILD_OUTPUT) {
        child.kill();
        finish(Error('Rules preflight output too large'));
        return;
      }
      stderr += chunk.toString('utf8');
    });
    child.once('close', (code, signal) => finish(null, { code, signal, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(rulesBytes);
  });
}

function assertChildGuard(result, label) {
  const combined = `${result.stdout}\n${result.stderr}`;
  if (!combined.includes('VISTAVO_FINANCIAL_NETWORK_GUARD_ACTIVE SELF_CHECK=PASS')) {
    fail(`${label} rules preflight did not run under the local network guard`);
  }
  if (combined.includes('VISTAVO_REVIEW_NETWORK_DENIED')) {
    fail(`${label} rules preflight was denied by the local network guard`);
  }
}

const negativePreflight = await runPreflight(fakeSha256);
assertChildGuard(negativePreflight, 'Negative');
if (
  !Number.isInteger(negativePreflight.code)
  || negativePreflight.code === 0
  || negativePreflight.signal !== null
  || !`${negativePreflight.stdout}\n${negativePreflight.stderr}`.includes('Rules input hash mismatch')
) {
  fail(`Negative rules preflight did not fail on the false hash: code=${negativePreflight.code} signal=${negativePreflight.signal}`);
}
if (negativePreflight.stdout.split(/\r?\n/).some(line => /"(?:rulesLoad|clientProbe|adminProbe)"/.test(line))) {
  fail('Negative rules preflight emitted a rules-load or probe result');
}

const positivePreflight = await runPreflight(rulesSha256);
assertChildGuard(positivePreflight, 'Positive');
if (positivePreflight.code !== 0 || positivePreflight.signal !== null) {
  fail(`Positive rules preflight failed: code=${positivePreflight.code} signal=${positivePreflight.signal} stderr=${positivePreflight.stderr.slice(0, 2000)}`);
}
const positiveLines = positivePreflight.stdout.trim().split(/\r?\n/).filter(Boolean);
const jsonLines = positiveLines.filter(line => line.startsWith('{'));
if (jsonLines.length !== 1) fail('Positive rules preflight did not emit exactly one JSON result');
let report;
try {
  report = JSON.parse(jsonLines[0]);
} catch {
  fail('Positive rules preflight JSON is invalid');
}
if (
  report.version !== 1
  || report.project !== PROJECT
  || report.host !== AUTHORITY
  || report.rulesSha256 !== rulesSha256
) {
  fail('Rules preflight identity or hash mismatch');
}
if (!report.rulesLoad || report.rulesLoad.status !== 200 || report.rulesLoad.issues !== 0) {
  fail('Rules load did not report status 200 with zero issues');
}
if (!report.clientProbe || report.clientProbe.status !== 403) {
  fail('Unauthenticated client probe did not return 403');
}
if (
  !report.adminProbe
  || report.adminProbe.status !== 'PASS'
  || report.adminProbe.wrote !== false
  || report.adminProbe.exists !== false
) {
  fail('Admin probe did not report PASS with an unwritten missing document');
}

process.stdout.write('RULES_FOCUS_PREFLIGHT negative=false-sha-rejected clientGet=403 adminRead=PASS rulesLoad=200 issues=0\n');
await import('./firestoreBackend.emulator.mjs');
