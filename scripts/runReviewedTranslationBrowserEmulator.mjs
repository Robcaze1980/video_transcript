// Local synthetic fixture launcher. No cloud services are modified by this
// script. Network enforcement in the preload covers common Node APIs only:
// esbuild, native children/addons and unsupported native APIs are NOT firewalled.
//
// Run using Node 24, only after the parent has frozen and reviewed the inputs:
//   node scripts/runReviewedTranslationBrowserEmulator.mjs --prepare
//   node scripts/runReviewedTranslationBrowserEmulator.mjs --prepare --reuse-cache <previous-manifest> <previous-manifest-sha256>
//   node scripts/runReviewedTranslationBrowserEmulator.mjs --attest <generated-manifest>
//   node scripts/runReviewedTranslationBrowserEmulator.mjs --run <generated-manifest> <proof>
// --prepare writes only a manifest of hashes; --run creates a new isolated
// profile/log directory and starts the fixture. No directory is deleted here.
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  closeSync, constants, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  realpathSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedBrowserCache, verifiedPreviousBrowserCache } from './reviewBrowserCacheReuse.mjs';
import { assertPinnedBrowserIdentity, readPinnedBrowserIdentity } from '../server/commercial/web/reviewBrowserBinaryIdentity.mjs';

const project = 'demo-vistavo-review-browser';
const host = '127.0.0.1:18765';
const authHost = '127.0.0.1:18766';
const expectedTests = 1;
const guardFile = 'scripts/reviewBrowserEmulatorNetworkGuard.cjs';
const fixtureFile = 'server/commercial/firestoreReviewedTranslationBrowser.emulator.mjs';
const fixedTracked = Object.freeze([
  'server/commercial/firestoreBackend.ts',
  'server/commercial/firestoreAi.ts',
  'server/commercial/firestoreAiHttp.ts',
  'server/commercial/firestoreHttp.ts',
  'server/commercial/firestoreReviewedTranslation.ts',
  'server/commercial/reviewedTranslationHttp.ts',
  'server/commercial/reviewedTranslation.ts',
  'server/commercial/pipelineTextCodec.ts',
  'server/commercial/firestoreFiles.ts',
  'server/commercial/firebaseAccess.ts',
  'server/commercial/accountBillingClient.ts',
  'server/commercial/cloudEnqueueRecovery.ts',
  fixtureFile,
  'server/commercial/aiContracts.ts',
  'server/commercial/privateObjectPlan.ts',
  'server/commercial/gcsObjects.ts',
  'server/commercial/cloudDiagnostics.ts',
  'server/commercial/digitalSilence.ts',
  'server/commercial/pipelineVoiceProvider.ts',
  'server/commercial/pipelineVoiceWav.ts',
  'server/commercial/pipelineTextProvider.ts',
  'server/commercial/geminiFileUpload.ts',
  guardFile,
  'scripts/runReviewedTranslationBrowserEmulator.mjs',
  'scripts/reviewBrowserCacheReuse.mjs',
  'server/commercial/web/cloudCandidate.tsx',
  'server/commercial/web/cloudCandidateApi.ts',
  'server/commercial/web/cloudCandidate.css',
  'server/commercial/web/cloudCandidateAuth.ts',
  'server/commercial/web/reviewedTranslationClient.ts',
  'server/commercial/web/reviewedTranslationEditor.tsx',
  'server/commercial/web/reviewedTranslationFeature.ts',
  'server/commercial/web/reviewBrowserFixtureBuild.mjs',
  'server/commercial/web/reviewBrowserFixtureSafety.test.ts',
  'server/commercial/web/reviewBrowserNodeFixtures.test.ts',
  'server/commercial/web/reviewBrowserBinaryIdentity.mjs',
  'server/commercial/web/reviewBrowserBinaryIdentity.node.mjs',
  'scripts/reviewBrowserEmulatorNetworkGuard.windows.cjs',
  'tsconfig.json',
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
let tracked;

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
      Object.keys(manifest).sort().join(',') !== 'authHost,chrome,cli,config,expectedTests,files,host,jar,java,node,project,version' ||
      manifest.project !== project || manifest.host !== host || manifest.authHost !== authHost || manifest.expectedTests !== expectedTests ||
      !manifest.chrome || Object.keys(manifest.chrome).sort().join(',') !== 'path,sha256' || typeof manifest.chrome.path !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.chrome.sha256) ||
      !['cli','config','jar','java'].every(name => manifest[name] && Object.keys(manifest[name]).sort().join(',') === 'path,sha256' &&
        typeof manifest[name].path === 'string' && /^[a-f0-9]{64}$/.test(manifest[name].sha256)) ||
      !manifest.node || typeof manifest.node.path !== 'string' || typeof manifest.node.version !== 'string' ||
      Object.keys(manifest.node).sort().join(',') !== 'path,sha256,version' ||
      !/^[a-f0-9]{64}$/.test(manifest.node.sha256) || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    return fail('Invalid synthetic manifest');
  }
  assertPinnedBrowserIdentity(manifest.chrome);
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
function syntheticWindowsIdentity(profile, systemRoot) {
  const homeDrive = path.parse(profile).root.slice(0, 2), systemDrive = path.parse(systemRoot).root.slice(0, 2);
  if (!/^[A-Za-z]:$/.test(homeDrive) || !/^[A-Za-z]:$/.test(systemDrive)) fail('Synthetic profile must be on a local Windows drive');
  return { HOMEDRIVE: homeDrive, HOMEPATH: profile.slice(2), SYSTEMDRIVE: systemDrive,
    USERNAME: 'synthetic-review', USERDOMAIN: 'SYNTHETIC', LOGONSERVER: 'SYNTHETIC' };
}
function cleanLauncherEnvironment(workspace) {
  const allowed = new Set(['systemroot','windir','path','appdata','localappdata','userprofile','temp','tmp',
    'homedrive','homepath','systemdrive','username','userdomain','logonserver',
    'lv_review_browser_bootstrap','lv_review_browser_bootstrap_marker']);
  const extra = Object.keys(process.env).filter(key => !allowed.has(key.toLowerCase()));
  if (extra.length) fail(`Launcher requires a clean environment; unexpected variable names: ${extra.sort().join(', ')}`);
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !path.isAbsolute(systemRoot) || !statSync(path.join(systemRoot, 'System32')).isDirectory()) fail('Windows system directory unavailable');
  if (path.resolve(process.env.PATH ?? '').toLowerCase() !== path.resolve(systemRoot, 'System32').toLowerCase()) fail('Launcher PATH must contain only System32');
  const base = path.resolve(workspace, 'outputs/lv019-b-review-browser-bootstrap'), boot = path.resolve(process.env.LV_REVIEW_BROWSER_BOOTSTRAP ?? '');
  if (path.dirname(boot).toLowerCase() !== base.toLowerCase() || !/^boot-[a-f0-9-]{36}$/i.test(path.basename(boot)) ||
      lstatSync(boot).isSymbolicLink() || realpathSync(boot).toLowerCase() !== boot.toLowerCase()) fail('Invalid synthetic launcher directory');
  const profile = path.join(boot, 'profile'), temp = path.join(boot, 'temp');
  for (const directory of [profile,temp]) if (lstatSync(directory).isSymbolicLink() || realpathSync(directory).toLowerCase() !== directory.toLowerCase()) fail('Invalid launcher profile or temp');
  if (process.env.APPDATA !== profile || process.env.LOCALAPPDATA !== profile || process.env.USERPROFILE !== profile || process.env.TEMP !== temp || process.env.TMP !== temp) fail('Launcher profiles must be task-specific');
  for (const [key, value] of Object.entries(syntheticWindowsIdentity(profile, systemRoot))) if (process.env[key] !== value) fail(`Launcher synthetic environment mismatch: ${key}`);
  const marker = process.env.LV_REVIEW_BROWSER_BOOTSTRAP_MARKER;
  if (!/^[a-f0-9]{32}$/.test(marker ?? '') || textFile(path.join(profile, '.synthetic-bootstrap-owner'), 64) !== marker) fail('Launcher profile marker missing');
  if (existsSync(path.join(profile, 'gcloud', 'application_default_credentials.json'))) fail('Launcher must not have default credentials');
  return { systemRoot, boot, profile, temp };
}
function nodeIdentity() {
  if (process.platform !== 'win32' || !/^v24\./.test(process.version)) return fail('Run this launcher with Node 24 on Windows');
  if (process.env.NODE_OPTIONS) return fail('Start the launcher without inherited NODE_OPTIONS');
  const executable = realpathSync(process.execPath);
  if (path.basename(executable).toLowerCase() !== 'node.exe' || !statSync(executable).isFile()) return fail('Invalid Node executable');
  const expected = realpathSync('C:/Users/rob62/AppData/Local/LinguistVision/tools/node-v24.13.0-win-x64/node.exe');
  if (executable.toLowerCase() !== expected.toLowerCase() || process.version !== 'v24.13.0') return fail('Unexpected Node executable or version');
  return { path: executable, version: process.version, sha256: hashFile(executable) };
}
function chromeIdentity() {
  return readPinnedBrowserIdentity();
}
function externalToolIdentity(file) {
  const executable = realpathSync(file);
  if (!statSync(executable).isFile()) return fail('Dedicated emulator tool unavailable');
  return { path: executable, sha256: hashFile(executable) };
}
function summary(stdout, stderr) {
  const combined = `${stdout}\n${stderr}`;
  return {
    guardActive: stderr.includes('VISTAVO_REVIEW_BROWSER_NETWORK_GUARD_ACTIVE SELF_CHECK=PASS'),
    guardDeniedDuringRun: stderr.includes('VISTAVO_REVIEW_BROWSER_NETWORK_DENIED'),
    syntheticTsxIpcRequests: [...stderr.matchAll(/^VISTAVO_REVIEW_BROWSER_TSX_IPC_SYNTHETIC\s*$/gm)].length,
    tests: /^# tests 1\s*$/m.test(stdout),
    allPassed: /^# pass 1\s*$/m.test(stdout),
    noFailures: /^# fail 0\s*$/m.test(stdout),
    namedCases: stdout.split('\n').some(line => /^ok \d+ - /.test(line) && line.trimEnd().endsWith('same-origin browser edits and downloads an authorized Firestore Emulator review')),
    noCancelled: /^# cancelled 0\s*$/m.test(stdout),
    noSkipped: /^# skipped 0\s*$/m.test(stdout),
    noTodo: /^# todo 0\s*$/m.test(stdout),
    story: combined.includes('Synthetic same-origin browser review story: PASS'),
    cleanups: combined.includes('Synthetic browser fixture cleanup verified: firestore=1 auth=2 chrome=1'),
  };
}

const scriptPath = realpathSync(fileURLToPath(import.meta.url));
const workspace = realpathSync(path.resolve(path.dirname(scriptPath), '..'));
if (scriptPath !== repositoryFile(workspace, 'scripts/runReviewedTranslationBrowserEmulator.mjs')) fail('Unexpected launcher location');
const launcher = cleanLauncherEnvironment(workspace);
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--check-environment') {
  nodeIdentity(); process.stdout.write('Synthetic launcher environment: PASS (no manifest, emulator, or fixture started)\n'); process.exit(0);
}
const outputRoot = checkedDirectory(workspace, 'outputs');
const manifests = checkedDirectory(outputRoot, 'lv019-b-review-browser-manifests', true);
const runs = checkedDirectory(outputRoot, 'lv019-b-review-browser-runs', true);
const node = nodeIdentity(), chrome = chromeIdentity();
const cli = externalToolIdentity('C:/Users/rob62/AppData/Roaming/npm/node_modules/firebase-tools/lib/bin/firebase.js');
const java = externalToolIdentity('C:/Program Files/Java/jdk-24/bin/java.exe');
const jarSource = externalToolIdentity('C:/Users/rob62/.cache/firebase/emulators/cloud-firestore-emulator-v1.21.0.jar');
const reuseCache = args.length === 4 && args[0] === '--prepare' && args[1] === '--reuse-cache';
if (!(args.length === 1 && args[0] === '--prepare' || reuseCache || args.length === 2 && args[0] === '--attest' || args.length === 3 && args[0] === '--run')) fail('Use --prepare [--reuse-cache <previous-manifest> <previous-manifest-sha256>], --attest <manifest>, or --run <manifest> <proof>');
// A previous manifest contributes only its cache identity. Its other file hashes
// are not reused; the new manifest snapshots the current complete dependency graph.
const reusedJar = reuseCache ? verifiedPreviousBrowserCache({ manifestsDir: manifests, manifestPath: args[2], manifestSha256: args[3], sourceJar: jarSource }) : undefined;
let manifestFile, manifestText, manifestSha256, manifest;
if (args[0] !== '--prepare') {
  const candidate = path.resolve(args[1]); manifestFile = realpathSync(candidate);
  if (path.dirname(manifestFile).toLowerCase() !== manifests.toLowerCase() || lstatSync(candidate).isSymbolicLink()) fail('Manifest must be in the task manifest directory');
  manifestText = textFile(manifestFile, 2_000_000); manifestSha256 = createHash('sha256').update(manifestText).digest('hex');
  manifest = JSON.parse(manifestText);
  if (!manifest || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files) || Object.keys(manifest.files).length > 10_000) fail('Invalid preliminary manifest');
  for (const name of fixedTracked) if (!Object.hasOwn(manifest.files, name)) fail(`Required frozen input missing: ${name}`);
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) || hashFile(repositoryFile(workspace, name)) !== expected) fail(`Frozen input changed before plugin load: ${name}`);
  }
}
// Dynamic imports and esbuild start only after the launcher environment is clean
// and, for attestation/run, all previously frozen files have been checked.
const { build } = await import('esbuild');
const { syntheticReviewBrowserPlugins, inspectReviewEmulators } = await import('../server/commercial/web/reviewBrowserFixtureBuild.mjs');
const dependencyGraph = await build({absWorkingDir:workspace,entryPoints:[fixtureFile],bundle:true,platform:'node',format:'esm',external:['*.node'],write:false,metafile:true,logLevel:'silent'});
const browserGraph = await build({absWorkingDir:workspace,entryPoints:['server/commercial/web/cloudCandidate.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'synthetic-browser-output',write:false,metafile:true,plugins:syntheticReviewBrowserPlugins(),logLevel:'silent'});
const realBrowserInputs = Object.keys(browserGraph.metafile.inputs).filter(name => !name.startsWith('synthetic-review-browser:'));
tracked = Object.freeze([...new Set([...fixedTracked,...Object.keys(dependencyGraph.metafile.inputs),...realBrowserInputs])].sort());

if (args[0] === '--prepare') {
  const before = snapshot(workspace);
  const configFile = path.join(manifests, `config-${randomUUID()}.json`);
  writeFileSync(configFile, `${JSON.stringify({ emulators: { auth: { host: '127.0.0.1', port: 18766 }, firestore: { host: '127.0.0.1', port: 18765, websocketPort: 18769 }, hub: { host: '127.0.0.1', port: 18767 }, logging: { host: '127.0.0.1', port: 18768 }, ui: { enabled: false }, singleProjectMode: true } }, null, 2)}\n`, { flag: 'wx' });
  const config = { path: realpathSync(configFile), sha256: hashFile(configFile) };
  let jar = reusedJar;
  if (!jar) {
    const cache = checkedDirectory(manifests, `cache-${randomUUID()}`, true), jarCopy = path.join(cache, 'cloud-firestore-emulator-v1.21.0.jar');
    copyFileSync(jarSource.path, jarCopy, constants.COPYFILE_EXCL);
    jar = externalToolIdentity(jarCopy); if (jar.sha256 !== jarSource.sha256) fail('Synthetic emulator binary copy differs from the source');
  }
  const manifest = { version: 1, project, host, authHost, expectedTests, node, chrome, cli, java, jar, config, files: before.files };
  const destination = path.join(manifests, `manifest-${randomUUID()}.json`);
  writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`Synthetic manifest prepared: ${destination}\nDedicated emulator config: ${config.path}\nDedicated emulator cache: ${path.dirname(jar.path)}${reusedJar ? ' (reused and reverified)' : ''}\nReview them before starting any emulator. No fixture was started.\n`);
} else {
  validateManifest(manifest);
  if (manifest.node.path.toLowerCase() !== node.path.toLowerCase() || manifest.node.version !== node.version || manifest.node.sha256 !== node.sha256) fail('Node identity differs from the frozen manifest');
  if (manifest.chrome.path.toLowerCase() !== chrome.path.toLowerCase() || manifest.chrome.sha256 !== chrome.sha256) fail('Chrome differs from the frozen manifest');
  for (const [name, actual] of Object.entries({ cli, java })) if (manifest[name].path.toLowerCase() !== actual.path.toLowerCase() || manifest[name].sha256 !== actual.sha256) fail(`Dedicated emulator ${name} differs from the manifest`);
  const jar = verifiedBrowserCache(manifest.jar, manifests, jarSource);
  const configFile = realpathSync(manifest.config.path);
  if (path.dirname(configFile).toLowerCase() !== manifests.toLowerCase() || !/^config-[a-f0-9-]{36}\.json$/i.test(path.basename(configFile)) || lstatSync(manifest.config.path).isSymbolicLink() || hashFile(configFile) !== manifest.config.sha256) fail('Dedicated emulator config mismatch');
  const before = snapshot(workspace), mismatchBefore = compare(manifest.files, before.files);
  if (mismatchBefore.length) fail(`Frozen inputs changed before launch: ${mismatchBefore.join(', ')}`);
  const expected = { node: node.path, java: java.path, cli: cli.path, jar: jar.path, config: configFile };
  if (args[0] === '--attest') {
    const observed = inspectReviewEmulators(expected, true);
    const proof = { version: 1, project, manifestSha256, configSha256: manifest.config.sha256, jarSha256: manifest.jar.sha256, expected,
      identity: { auth: observed.auth, firestore: observed.firestore } };
    const destination = path.join(manifests, `proof-${randomUUID()}.json`);
    writeFileSync(destination, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`Dedicated emulator processes identified: ${destination}\nNo fixture was started.\n`);
  } else {
  const proofCandidate = path.resolve(args[2]), proofFile = realpathSync(proofCandidate);
  if (path.dirname(proofFile).toLowerCase() !== manifests.toLowerCase() || !/^proof-[a-f0-9-]{36}\.json$/i.test(path.basename(proofFile)) || lstatSync(proofCandidate).isSymbolicLink()) fail('Invalid dedicated emulator proof path');
  const proofText = textFile(proofFile, 100_000), proof = JSON.parse(proofText), proofSha256 = createHash('sha256').update(proofText).digest('hex');
  if (proof.version !== 1 || proof.project !== project || proof.manifestSha256 !== manifestSha256 || proof.configSha256 !== manifest.config.sha256 || proof.jarSha256 !== manifest.jar.sha256 || JSON.stringify(proof.expected) !== JSON.stringify(expected)) fail('Dedicated emulator proof does not match the manifest');
  const beforeEmulators = inspectReviewEmulators(expected, true);
  const identity = value => JSON.stringify({ auth: value.auth, firestore: value.firestore });
  if (identity(beforeEmulators) !== identity(proof.identity)) fail('Dedicated emulator process identity changed');
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !path.isAbsolute(systemRoot) || !statSync(path.join(systemRoot, 'System32')).isDirectory()) fail('Windows system directory unavailable');
  const run = checkedDirectory(runs, `run-${randomUUID()}`, true);
  const profile = checkedDirectory(run, 'profile', true), temp = checkedDirectory(run, 'temp', true);
  if (readdirSync(profile).length !== 0 || readdirSync(temp).length !== 0) fail('Synthetic profile and temp must start empty');
  const profileMarker = randomUUID().replaceAll('-', ''), guardNonce = randomUUID().replaceAll('-', '');
  writeFileSync(path.join(profile, '.synthetic-profile-owner'), profileMarker, { flag: 'wx' });
  writeFileSync(path.join(run, 'emulator-proof.json'), proofText, { flag: 'wx' });
  const env = {
    SystemRoot: systemRoot, WINDIR: systemRoot, PATH: path.join(systemRoot, 'System32'),
    APPDATA: profile, USERPROFILE: profile, LOCALAPPDATA: profile, TEMP: temp, TMP: temp,
    ...syntheticWindowsIdentity(profile, systemRoot),
    NODE_ENV: 'test', FIRESTORE_EMULATOR_HOST: host, FIREBASE_AUTH_EMULATOR_HOST: authHost, GOOGLE_CLOUD_PROJECT: project,
    GCLOUD_PROJECT: project, METADATA_SERVER_DETECTION: 'none', LV_REVIEW_BROWSER_FIXTURE: '1',
    LV_REVIEW_BROWSER_RUN_DIR: run, LV_REVIEW_BROWSER_PROFILE_MARKER: profileMarker,
    LV_REVIEW_BROWSER_GUARD_NONCE: guardNonce, LV_REVIEW_BROWSER_PROOF_SHA256: proofSha256,
  };
  if ('HOME' in env || 'CODEX_HOME' in env || 'NODE_OPTIONS' in env || 'GOOGLE_APPLICATION_CREDENTIALS' in env) fail('Unexpected child environment');
  writeFileSync(path.join(run, 'manifest.json'), manifestText, { flag: 'wx' });
  writeFileSync(path.join(run, 'environment.json'), `${JSON.stringify({
    nodeVersion: node.version, project, host, authHost, testCount: expectedTests, profile, temp,
    environmentKeys: Object.keys(env).sort(), loader: 'tsx', emulatorIdentity: proof.identity,
    limitation: 'Node preload is not an OS firewall; esbuild, Chrome and native children are not covered. Chrome CDP uses a pipe and page requests are intercepted separately.',
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

  let after, manifestAfterSha = null, proofAfterSha = null, runProofAfterSha = null, mismatchAfter = [], pathChanges = [];
  try {
    after = snapshot(workspace);
    mismatchAfter = compare(manifest.files, after.files);
    pathChanges = tracked.filter(name => before.resolved[name].toLowerCase() !== after.resolved[name].toLowerCase());
    manifestAfterSha = createHash('sha256').update(textFile(manifestFile, 2_000_000)).digest('hex');
    proofAfterSha = createHash('sha256').update(textFile(proofFile, 100_000)).digest('hex');
    runProofAfterSha = createHash('sha256').update(textFile(path.join(run, 'emulator-proof.json'), 100_000)).digest('hex');
  } catch { mismatchAfter = ['post-run snapshot unavailable']; }
  let nodeUnchanged = false;
  try { const nodeAfter = nodeIdentity(); nodeUnchanged = node.sha256 === nodeAfter.sha256 && node.path.toLowerCase() === nodeAfter.path.toLowerCase(); } catch { /* Fail closed. */ }
  let chromeUnchanged = false;
  try { const chromeAfter = chromeIdentity(); chromeUnchanged = chrome.sha256 === chromeAfter.sha256 && chrome.path.toLowerCase() === chromeAfter.path.toLowerCase(); } catch { /* Fail closed. */ }
  let emulatorUnchanged = false, toolsUnchanged = false;
  try { emulatorUnchanged = identity(inspectReviewEmulators(expected)) === identity(proof.identity) && !lstatSync(configFile).isSymbolicLink() &&
    realpathSync(configFile).toLowerCase() === configFile.toLowerCase() && hashFile(configFile) === manifest.config.sha256; } catch { /* Fail closed. */ }
  try { toolsUnchanged = [['cli',cli],['java',java],['jar',jar]].every(([name, prior]) => {
    const current = externalToolIdentity(prior.path); return current.path.toLowerCase() === prior.path.toLowerCase() && current.sha256 === manifest[name].sha256;
  }); } catch { /* Fail closed. */ }
  let stdout = '', stderr = '', logsReadable = false;
  try { stdout = textFile(stdoutPath, 5 * 1024 * 1024); stderr = textFile(stderrPath, 5 * 1024 * 1024); logsReadable = true; } catch { /* Fail closed. */ }
  const checks = summary(stdout, stderr);
  const checksPass = checks.guardActive && !checks.guardDeniedDuringRun && checks.tests && checks.allPassed && checks.namedCases && checks.noFailures && checks.noCancelled && checks.noSkipped && checks.noTodo && checks.story && checks.cleanups;
  const confirmed = result.exitCode === 0 && result.signal === null && !result.error && !timedOut && !interrupted && logsReadable &&
    !mismatchAfter.length && !pathChanges.length && manifestAfterSha === manifestSha256 && proofAfterSha === proofSha256 && runProofAfterSha === proofSha256 && nodeUnchanged && chromeUnchanged && emulatorUnchanged && toolsUnchanged && checksPass;
  const report = { version: 1, confirmed, result, timedOut, interrupted, logsReadable, manifestSha256, manifestAfterSha, proofSha256, proofAfterSha, runProofAfterSha, nodeUnchanged, chromeUnchanged, emulatorUnchanged, toolsUnchanged,
    mismatchAfter, pathChanges, checks, before: before.files, after: after?.files ?? null,
    limitation: 'The preload is not an OS firewall; esbuild, Chrome, native addons, native children and unsupported APIs are not covered. CDP uses a pipe; page requests are intercepted separately. Static bundle inputs and listed loader files are hashed, but dynamic/runtime-only dependencies are not guaranteed complete and pre/post hashes do not create an immutable snapshot. An interrupted child may leave its synthetic Chrome process and profile; inspect the recorded PID and profile before any manual cleanup.' };
  writeFileSync(path.join(run, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`Synthetic browser review fixture: ${confirmed ? 'PASS (1 story passed)' : 'INCONCLUSIVE'}; evidence: ${run}\n`);
  if (!confirmed) process.exitCode = 1;
  }
}
