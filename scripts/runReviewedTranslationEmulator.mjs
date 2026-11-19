// Local synthetic fixture launcher. No cloud services are modified by this
// script. Network enforcement in the preload covers common Node APIs only:
// esbuild, native children/addons and unsupported native APIs are NOT firewalled.
//
// Run using Node 24, only after the parent has frozen and reviewed the inputs:
//   node scripts/runReviewedTranslationEmulator.mjs --prepare
//   node scripts/runReviewedTranslationEmulator.mjs --run <generated-manifest>
// --prepare writes only a manifest of hashes; --run creates a new isolated
// profile/log directory and starts the fixture. No directory is deleted here.
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  realpathSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = 'demo-vistavo-ledger';
const host = '127.0.0.1:8185';
const expectedTests = 28;
const guardFile = 'scripts/reviewEmulatorNetworkGuard.cjs';
const fixtureFile = 'server/commercial/firestoreReviewedTranslation.emulator.mjs';
const tracked = Object.freeze([
  'server/commercial/firestoreBackend.ts',
  'server/commercial/firestoreAi.ts',
  'server/commercial/cloudEnqueueRecovery.ts',
  'server/commercial/firestoreReviewedTranslation.ts',
  'server/commercial/reviewedVoiceCanonical.ts',
  fixtureFile,
  'server/commercial/reviewedTranslation.ts',
  'server/commercial/pipelineTextCodec.ts',
  'server/commercial/aiContracts.ts',
  'server/commercial/privateObjectPlan.ts',
  'server/commercial/gcsObjects.ts',
  'server/commercial/cloudDiagnostics.ts',
  'server/commercial/digitalSilence.ts',
  'server/commercial/jobs.ts',
  'server/commercial/pipelineVoiceProvider.ts',
  'server/commercial/pipelineVoiceWav.ts',
  'server/commercial/pipelineTextProvider.ts',
  'server/commercial/geminiFileUpload.ts',
  guardFile,
  'scripts/runReviewedTranslationEmulator.mjs',
  'package.json',
  'package-lock.json',
  'node_modules/tsx/package.json',
  'node_modules/tsx/dist/loader.mjs',
  'node_modules/esbuild/lib/main.js',
  'node_modules/@esbuild/win32-x64/esbuild.exe',
  'node_modules/firebase-admin/package.json',
  'node_modules/@google-cloud/firestore/package.json',
  'node_modules/@grpc/grpc-js/package.json',
  'node_modules/@grpc/grpc-js/build/src/resolver-dns.js',
  'node_modules/@grpc/grpc-js/build/src/transport.js',
  'node_modules/google-gax/package.json',
]);

function fail(message) { throw Error(message); }
function isInside(root, value) {
  const relative = path.relative(root, value);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function checkedDirectory(parent, name, create = false) {
  const value = path.join(parent, name);
  if (create && !existsSync(value)) mkdirSync(value);
  const info = lstatSync(value);
  if (!info.isDirectory() || info.isSymbolicLink()) return fail('Expected a real task directory');
  const real = realpathSync(value);
  if (!isInside(parent, real)) return fail('Task directory escapes the intended parent');
  return real;
}
function repositoryFile(root, relative) {
  if (!/^[A-Za-z0-9@._/-]+$/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    return fail('Invalid tracked path');
  }
  const candidate = path.join(root, ...relative.split('/'));
  const info = lstatSync(candidate), real = realpathSync(candidate);
  if (!info.isFile() || info.isSymbolicLink() || !isInside(root, real)) return fail(`Unsafe tracked file: ${relative}`);
  return real;
}
function hashFile(file) {
  const fd = openSync(file, 'r'), hash = createHash('sha256'), chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    if (!fstatSync(fd).isFile()) return fail('Expected a regular file');
    for (;;) { const read = readSync(fd, chunk, 0, chunk.length, null); if (!read) break; hash.update(chunk.subarray(0, read)); }
    return hash.digest('hex');
  } finally { closeSync(fd); }
}
function snapshot(root) {
  const files = Object.create(null), resolved = Object.create(null);
  for (const relative of tracked) { const file = repositoryFile(root, relative); files[relative] = hashFile(file); resolved[relative] = file; }
  return { files, resolved };
}
function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.version !== 1 ||
      Object.keys(manifest).sort().join(',') !== 'expectedTests,files,host,node,project,version' ||
      manifest.project !== project || manifest.host !== host || manifest.expectedTests !== expectedTests ||
      !manifest.node || typeof manifest.node.path !== 'string' || typeof manifest.node.version !== 'string' ||
      Object.keys(manifest.node).sort().join(',') !== 'path,sha256,version' ||
      !/^[a-f0-9]{64}$/.test(manifest.node.sha256) || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    return fail('Invalid synthetic manifest');
  }
  const names = Object.keys(manifest.files);
  if (names.length !== tracked.length || names.some(name => !tracked.includes(name)) ||
      tracked.some(name => typeof manifest.files[name] !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.files[name]))) {
    return fail('Manifest does not contain exactly the required file hashes');
  }
}
function compare(expected, actual) {
  return tracked.filter(name => expected[name] !== actual[name]);
}
function textFile(file, maxBytes) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) return fail('Invalid task file');
  return readFileSync(file, 'utf8');
}
function nodeIdentity() {
  if (process.platform !== 'win32' || !/^v24\./.test(process.version)) return fail('Run this launcher with Node 24 on Windows');
  if (process.env.NODE_OPTIONS) return fail('Start the launcher without inherited NODE_OPTIONS');
  const executable = realpathSync(process.execPath);
  if (path.basename(executable).toLowerCase() !== 'node.exe' || !statSync(executable).isFile()) return fail('Invalid Node executable');
  return { path: executable, version: process.version, sha256: hashFile(executable) };
}
function summary(stdout, stderr) {
  const combined = `${stdout}\n${stderr}`;
  const cleanups = [...combined.matchAll(new RegExp(`Synthetic review cleanup verified (\\d+)\\/${expectedTests}`, 'g'))].map(match => Number(match[1]));
  const exact = cleanups.length === expectedTests && cleanups.every((number, index) => number === index + 1);
  return {
    guardActive: stderr.includes('VISTAVO_REVIEW_NETWORK_GUARD_ACTIVE SELF_CHECK=PASS'),
    guardDeniedDuringRun: stderr.includes('VISTAVO_REVIEW_NETWORK_DENIED'),
    syntheticTsxIpcRequests: [...stderr.matchAll(/^VISTAVO_REVIEW_TSX_IPC_SYNTHETIC\s*$/gm)].length,
    tests: new RegExp(`^# tests ${expectedTests}\\s*$`, 'm').test(stdout),
    passed: new RegExp(`^# pass ${expectedTests}\\s*$`, 'm').test(stdout),
    noFailures: /^# fail 0\s*$/m.test(stdout),
    noCancelled: /^# cancelled 0\s*$/m.test(stdout),
    noSkipped: /^# skipped 0\s*$/m.test(stdout),
    noTodo: /^# todo 0\s*$/m.test(stdout),
    cleanups: exact && combined.includes(`Synthetic review cleanup total: ${expectedTests}/${expectedTests}`),
  };
}

const scriptPath = realpathSync(fileURLToPath(import.meta.url));
const workspace = realpathSync(path.resolve(path.dirname(scriptPath), '..'));
if (scriptPath !== repositoryFile(workspace, 'scripts/runReviewedTranslationEmulator.mjs')) fail('Unexpected launcher location');
const outputRoot = checkedDirectory(workspace, 'outputs');
const manifests = checkedDirectory(outputRoot, 'lv019-b-review-manifests', true);
const runs = checkedDirectory(outputRoot, 'lv019-b-review-runs', true);
const node = nodeIdentity();
const args = process.argv.slice(2);

if (args.length === 1 && args[0] === '--prepare') {
  const before = snapshot(workspace);
  const manifest = { version: 1, project, host, expectedTests, node, files: before.files };
  const destination = path.join(manifests, `manifest-${randomUUID()}.json`);
  writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`Synthetic manifest prepared: ${destination}\nReview its hashes before --run. No fixture was started.\n`);
} else if (args.length === 2 && args[0] === '--run') {
  const candidate = path.resolve(args[1]), manifestFile = realpathSync(candidate);
  if (path.dirname(manifestFile).toLowerCase() !== manifests.toLowerCase() || lstatSync(candidate).isSymbolicLink()) fail('Manifest must be in the task manifest directory');
  const manifestText = textFile(manifestFile, 100_000), manifestSha256 = createHash('sha256').update(manifestText).digest('hex');
  const manifest = JSON.parse(manifestText); validateManifest(manifest);
  if (manifest.node.path.toLowerCase() !== node.path.toLowerCase() || manifest.node.version !== node.version || manifest.node.sha256 !== node.sha256) fail('Node identity differs from the frozen manifest');
  const before = snapshot(workspace), mismatchBefore = compare(manifest.files, before.files);
  if (mismatchBefore.length) fail(`Frozen inputs changed before launch: ${mismatchBefore.join(', ')}`);
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !path.isAbsolute(systemRoot) || !statSync(path.join(systemRoot, 'System32')).isDirectory()) fail('Windows system directory unavailable');
  const run = checkedDirectory(runs, `run-${randomUUID()}`, true);
  const profile = checkedDirectory(run, 'profile', true), temp = checkedDirectory(run, 'temp', true);
  if (readdirSync(profile).length !== 0 || readdirSync(temp).length !== 0) fail('Synthetic profile and temp must start empty');
  const env = {
    SystemRoot: systemRoot, WINDIR: systemRoot, PATH: path.join(systemRoot, 'System32'),
    APPDATA: profile, USERPROFILE: profile, LOCALAPPDATA: profile, TEMP: temp, TMP: temp,
    NODE_ENV: 'test', FIRESTORE_EMULATOR_HOST: host, GOOGLE_CLOUD_PROJECT: project,
    GCLOUD_PROJECT: project, METADATA_SERVER_DETECTION: 'none', LV_REVIEW_CONTRACT: '1',
  };
  if ('HOME' in env || 'CODEX_HOME' in env || 'NODE_OPTIONS' in env || 'GOOGLE_APPLICATION_CREDENTIALS' in env) fail('Unexpected child environment');
  writeFileSync(path.join(run, 'manifest.json'), manifestText, { flag: 'wx' });
  writeFileSync(path.join(run, 'environment.json'), `${JSON.stringify({
    nodeVersion: node.version, project, host, testCount: expectedTests, profile, temp,
    environmentKeys: Object.keys(env).sort(), loader: 'tsx',
    limitation: 'Node preload is not an OS firewall; esbuild and native children are not covered.',
  }, null, 2)}\n`, { flag: 'wx' });

  const stdoutPath = path.join(run, 'fixture.stdout.tap'), stderrPath = path.join(run, 'fixture.stderr.log');
  let out, err, timedOut = false, interrupted = false;
  let result = { exitCode: null, signal: null, error: 'Child was not started' };
  try {
    out = openSync(stdoutPath, 'wx'); err = openSync(stderrPath, 'wx');
    const child = spawn(node.path, ['--no-network-family-autoselection', '--require', repositoryFile(workspace, guardFile),
      '--import', 'tsx', '--test-reporter=tap', repositoryFile(workspace, fixtureFile)], {
      cwd: workspace, env, stdio: ['ignore', out, err], windowsHide: true,
    });
    const stop = () => { interrupted = true; child.kill(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 10 * 60_000);
    try {
      result = await new Promise(resolve => {
        child.once('error', () => resolve({ exitCode: null, signal: null, error: 'Child launch failed' }));
        child.once('exit', (exitCode, signal) => resolve({ exitCode, signal, error: null }));
      });
    } finally { clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  } catch { result = { exitCode: null, signal: null, error: 'Child launch failed' }; }
  finally { if (out !== undefined) closeSync(out); if (err !== undefined) closeSync(err); }

  let after, manifestAfterSha = null, mismatchAfter = [], pathChanges = [];
  try {
    after = snapshot(workspace);
    mismatchAfter = compare(manifest.files, after.files);
    pathChanges = tracked.filter(name => before.resolved[name].toLowerCase() !== after.resolved[name].toLowerCase());
    manifestAfterSha = createHash('sha256').update(textFile(manifestFile, 100_000)).digest('hex');
  } catch { mismatchAfter = ['post-run snapshot unavailable']; }
  let nodeUnchanged = false;
  try { const nodeAfter = nodeIdentity(); nodeUnchanged = node.sha256 === nodeAfter.sha256 && node.path.toLowerCase() === nodeAfter.path.toLowerCase(); } catch { /* Fail closed. */ }
  let stdout = '', stderr = '', logsReadable = false;
  try { stdout = textFile(stdoutPath, 5 * 1024 * 1024); stderr = textFile(stderrPath, 5 * 1024 * 1024); logsReadable = true; } catch { /* Fail closed. */ }
  const checks = summary(stdout, stderr);
  const checksPass = checks.guardActive && !checks.guardDeniedDuringRun && checks.syntheticTsxIpcRequests === 2 && checks.tests && checks.passed && checks.noFailures &&
    checks.noCancelled && checks.noSkipped && checks.noTodo && checks.cleanups;
  const pass = result.exitCode === 0 && result.signal === null && !result.error && !timedOut && !interrupted && logsReadable &&
    !mismatchAfter.length && !pathChanges.length && manifestAfterSha === manifestSha256 && nodeUnchanged && checksPass;
  const report = { version: 1, pass, result, timedOut, interrupted, logsReadable, manifestSha256, manifestAfterSha, nodeUnchanged,
    mismatchAfter, pathChanges, checks, before: before.files, after: after?.files ?? null,
    limitation: 'The preload is not an OS firewall; esbuild, native addons, native children and unsupported APIs are not covered. Transitive dependencies are not all hashed and pre/post hashes do not create an immutable snapshot.' };
  writeFileSync(path.join(run, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`Synthetic review fixture: ${pass ? 'PASS' : 'FAIL'}; evidence: ${run}\n`);
  if (!pass) process.exitCode = 1;
} else {
  fail('Use --prepare or --run <task-manifest>; the fixture was not started');
}
