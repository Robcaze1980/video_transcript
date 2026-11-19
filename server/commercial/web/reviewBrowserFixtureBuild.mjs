// Test-only replacement modules. This file is not used by the normal build.
// The emulator's API key is a non-secret placeholder and never names a cloud project.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Prevent accidental fixture execution without the reviewed Node preload. */
export function assertReviewGuard(guard, nonce, pid) {
  if (typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce) || !Number.isSafeInteger(pid) || pid < 1 ||
      !guard || !Object.isFrozen(guard) || guard.version !== 1 || guard.pid !== pid || guard.nonce !== nonce) {
    throw Error('The synthetic network guard must already be active');
  }
}

/** Append-only, flushed, synthetic resource inventory; rejects credential fields. */
export function createReviewResourceJournal(file) {
  const fd = openSync(file, 'wx'); let closed = false;
  const allowed = new Set(['path','marker','purpose','project','uid','email','profile','pid','reason','safeToClean','authCleaned','firestoreCleaned','chromeCleaned','errors']);
  return Object.freeze({
    append(kind, value = {}) {
      if (closed || typeof kind !== 'string' || !/^[a-z_]{1,80}$/.test(kind) || !value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).some(key => !allowed.has(key))) throw Error('Invalid synthetic resource journal entry');
      for (const item of Object.values(value)) {
        if (!(typeof item === 'string' && item.length <= 2048 || typeof item === 'number' && Number.isSafeInteger(item) || typeof item === 'boolean' ||
              Array.isArray(item) && item.length <= 30 && item.every(part => typeof part === 'string' && part.length <= 200))) throw Error('Invalid synthetic resource journal field');
      }
      const bytes = Buffer.from(JSON.stringify({ version: 1, kind, ...value }) + '\n');
      let offset = 0; while (offset < bytes.length) { const written = writeSync(fd, bytes, offset, bytes.length - offset); if (written <= 0) throw Error('Synthetic journal write failed'); offset += written; }
      fsyncSync(fd);
    },
    close() { if (!closed) { closeSync(fd); closed = true; } },
  });
}

/** Validates sanitized process metadata; command lines themselves are never returned. */
export function validateReviewEmulators(snapshot, expected, requireIdle = false) {
  const fail = () => { throw Error('Dedicated synthetic emulator provenance mismatch'); };
  if (!snapshot || !Array.isArray(snapshot.listeners) || !Array.isArray(snapshot.processes) || !Number.isSafeInteger(snapshot.established) || snapshot.established < 0) return fail();
  const listeners = snapshot.listeners.filter(item => item?.port === 18765 || item?.port === 18766);
  if (listeners.length !== 2 || listeners.some(item => item.address !== '127.0.0.1' || !Number.isSafeInteger(item.pid) || item.pid < 1)) return fail();
  const authListener = listeners.find(item => item.port === 18766), fireListener = listeners.find(item => item.port === 18765);
  if (!authListener || !fireListener || authListener.pid === fireListener.pid || requireIdle && snapshot.established !== 0) return fail();
  const byPid = new Map();
  for (const process of snapshot.processes) {
    if (!Number.isSafeInteger(process?.pid) || byPid.has(process.pid) || typeof process.created !== 'string' || !process.created ||
        typeof process.exe !== 'string' || !Number.isSafeInteger(process.parent)) return fail();
    byPid.set(process.pid, process);
  }
  const auth = byPid.get(authListener.pid), firestore = byPid.get(fireListener.pid);
  const samePath = (left, right) => typeof left === 'string' && typeof right === 'string' && resolve(left).toLowerCase() === resolve(right).toLowerCase();
  if (!auth || !firestore || String(auth.name).toLowerCase() !== 'node.exe' || !samePath(auth.exe, expected.node) ||
      auth.projectCli !== true || auth.configMatch !== true || auth.cliMatch !== true || String(firestore.name).toLowerCase() !== 'java.exe' ||
      !samePath(firestore.exe, expected.java) || firestore.projectFirestore !== true || firestore.jarMatch !== true || firestore.portMatch !== true) return fail();
  let cursor = firestore, linked = false; const seen = new Set();
  for (let depth = 0; cursor && depth < 10; depth++) {
    if (seen.has(cursor.pid)) return fail(); seen.add(cursor.pid);
    if (cursor.pid === auth.pid) { linked = true; break; } cursor = byPid.get(cursor.parent);
  }
  if (!linked) return fail();
  return Object.freeze({ auth: { pid: auth.pid, created: auth.created, exe: auth.exe },
    firestore: { pid: firestore.pid, created: firestore.created, exe: firestore.exe }, established: snapshot.established });
}

const processProbe = String.raw`
$ErrorActionPreference = 'Stop'
$listeners = @()
foreach ($port in @(18765,18766)) {
  $matches = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  foreach ($item in $matches) { $listeners += [pscustomobject]@{port=[int]$port;address=$item.LocalAddress;pid=[int]$item.OwningProcess} }
}
$seen = [System.Collections.Generic.HashSet[int]]::new()
$processes = @()
foreach ($listener in $listeners) {
  $next = [int]$listener.pid
  for ($depth=0; $depth -lt 10 -and $next -gt 0; $depth++) {
    if (-not $seen.Add($next)) { break }
    $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $next) -ErrorAction SilentlyContinue
    if (-not $p) { break }
    $line = [string]$p.CommandLine
    $has = { param($value) $line.IndexOf($value,[StringComparison]::OrdinalIgnoreCase) -ge 0 }
    $processes += [pscustomobject]@{pid=[int]$p.ProcessId;parent=[int]$p.ParentProcessId;name=$p.Name;exe=[string]$p.ExecutablePath;
      created=([DateTime]$p.CreationDate).ToUniversalTime().ToString('o');
      projectCli=($line -match '(?i)--project(?:=|\s+)"?demo-vistavo-review-browser"?(?:\s|$)');
      projectFirestore=($line -match '(?i)--project_id(?:=|\s+)"?demo-vistavo-review-browser"?(?:\s|$)');
      portMatch=($line -match '(?i)--port(?:=|\s+)18765(?:\s|$)');
      configMatch=(& $has $env:LV_REVIEW_EXPECT_CONFIG);cliMatch=(& $has $env:LV_REVIEW_EXPECT_CLI);jarMatch=(& $has $env:LV_REVIEW_EXPECT_JAR)}
    $next = [int]$p.ParentProcessId
  }
}
$established = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(18765,18766) -or $_.RemotePort -in @(18765,18766) }).Count
@{listeners=@($listeners);processes=@($processes);established=$established} | ConvertTo-Json -Compress -Depth 6
`;

/** Read-only OS probe. It never outputs or logs command-line contents. */
export function inspectReviewEmulators(expected, requireIdle = false) {
  if (process.platform !== 'win32' || !process.env.SystemRoot) throw Error('Windows synthetic process probe required');
  const systemRoot = process.env.SystemRoot, executable = resolve(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  if (!process.env.USERPROFILE || process.env.USERPROFILE !== process.env.APPDATA || process.env.USERPROFILE !== process.env.LOCALAPPDATA || !process.env.TEMP || process.env.TEMP !== process.env.TMP) throw Error('Synthetic process-probe profile required');
  if (!process.env.HOMEDRIVE || !process.env.HOMEPATH || resolve(process.env.HOMEDRIVE + process.env.HOMEPATH).toLowerCase() !== resolve(process.env.USERPROFILE).toLowerCase() ||
      process.env.USERNAME !== 'synthetic-review' || process.env.USERDOMAIN !== 'SYNTHETIC' || process.env.LOGONSERVER !== 'SYNTHETIC') throw Error('Synthetic process-probe identity required');
  const env = { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: resolve(systemRoot, 'System32'),
    USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, TEMP: process.env.TEMP, TMP: process.env.TMP,
    HOMEDRIVE: process.env.HOMEDRIVE, HOMEPATH: process.env.HOMEPATH, SYSTEMDRIVE: process.env.SYSTEMDRIVE,
    USERNAME: process.env.USERNAME, USERDOMAIN: process.env.USERDOMAIN, LOGONSERVER: process.env.LOGONSERVER,
    LV_REVIEW_EXPECT_CONFIG: expected.config, LV_REVIEW_EXPECT_CLI: expected.cli, LV_REVIEW_EXPECT_JAR: expected.jar };
  const output = execFileSync(executable, ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(processProbe,'utf16le').toString('base64')],
    { env, encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 256 * 1024 });
  return validateReviewEmulators(JSON.parse(output), expected, requireIdle);
}

/** Track completion of handler promises, not merely socket closure or CDP ACKs. */
export function createReviewHandlerTracker() {
  const pending = new Set();
  return Object.freeze({
    run(work) {
      const task = Promise.resolve().then(work); pending.add(task);
      void task.then(() => pending.delete(task), () => pending.delete(task));
      return task;
    },
    get size() { return pending.size; },
  });
}
const authSource = `
import {initializeApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,inMemoryPersistence,onIdTokenChanged,setPersistence,signInWithEmailAndPassword,signOut} from 'firebase/auth';
const config={apiKey:'synthetic-emulator-only',authDomain:'127.0.0.1',projectId:'demo-vistavo-review-browser',appId:'synthetic-browser-review'};
const app=initializeApp(config,'synthetic-browser-review'),auth=getAuth(app);
connectAuthEmulator(auth,'http://127.0.0.1:18766',{disableWarnings:true});
await setPersistence(auth,inMemoryPersistence);
window.__vistavoSyntheticReview={
  async read(path,invalid=false){
    if(typeof path!=='string'||!/^\\/api\\/cloud\\/ai\\/jobs\\/[a-f0-9-]{36}\\/review(?:\\/download)?\\?/.test(path)||path.includes('..')||path.includes('//'))throw Error('unsafe synthetic path');
    const token=invalid?'invalid-synthetic-token':await auth.currentUser?.getIdToken();
    if(!token)throw Error('synthetic user missing');
    const response=await fetch(path,{headers:{Authorization:'Bearer '+token},credentials:'omit',cache:'no-store',redirect:'error'});
    const body=await response.text();return {status:response.status,body,cache:response.headers.get('cache-control')};
  },
  async write(path,body){
    if(typeof path!=='string'||!/^\\/api\\/cloud\\/ai\\/jobs\\/[a-f0-9-]{36}\\/review$/.test(path))throw Error('unsafe synthetic path');
    const token=await auth.currentUser?.getIdToken();if(!token)throw Error('synthetic user missing');
    const response=await fetch(path,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error'});
    return {status:response.status,body:await response.text(),cache:response.headers.get('cache-control')};
  },
};
export async function candidateAuth(){return {config:{web:config},observe:fn=>onIdTokenChanged(auth,fn),
  email:(email,password)=>signInWithEmailAndPassword(auth,email,password),logout:()=>signOut(auth),
  token:async uid=>{if(auth.currentUser?.uid!==uid)throw Error('signed_out');const token=await auth.currentUser.getIdToken();if(auth.currentUser?.uid!==uid)throw Error('signed_out');return token;},
  google:async()=>{throw Error('unsupported synthetic auth');},register:async()=>{throw Error('unsupported synthetic auth');},
  verify:async()=>{},refresh:async()=>auth.currentUser,reset:async()=>{}};}
`;

/** The override is used only in the isolated, manually reviewed test bundle. */
export function syntheticReviewBrowserPlugins({ enableReview = true } = {}) {
  return [{ name: 'synthetic-review-browser-only', setup(build) {
    build.onResolve({ filter: /^\.\/cloudCandidateAuth$/ }, () => ({ path: 'auth', namespace: 'synthetic-review-browser' }));
    if (enableReview) build.onResolve({ filter: /^\.\/reviewedTranslationFeature$/ }, () => ({ path: 'feature', namespace: 'synthetic-review-browser' }));
    build.onLoad({ filter: /.*/, namespace: 'synthetic-review-browser' }, ({ path }) => path === 'auth'
      ? { loader: 'js', contents: authSource, resolveDir: workspace }
      : { loader: 'js', contents: 'export const REVIEWED_TRANSLATION_CANDIDATE=true;' });
  } }];
}
