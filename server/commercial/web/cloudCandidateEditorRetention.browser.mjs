// Synthetic browser coverage for the disabled candidate. No cloud or real accounts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

assert.equal(process.env.NODE_ENV, 'test');
for (const key of ['HOME','CODEX_HOME','NODE_OPTIONS','GOOGLE_APPLICATION_CREDENTIALS','OPENROUTER_API_KEY','GEMINI_API_KEY']) assert.equal(process.env[key], undefined);
const workspace = realpathSync(process.cwd());
const legacyVoice=process.env.VISTAVO_SYNTHETIC_LEGACY_VOICE==='1';
const root = await mkdtemp(resolve(workspace, 'outputs/lv019-b-editor-retention-'));
assert.equal(realpathSync(root).toLowerCase(), root.toLowerCase());
await writeFile(join(root, '.synthetic-owner'), 'editor-retention-v1', { flag: 'wx' });
const { cdpPipe, captureChromeStderr } = await import(pathToFileURL(join(workspace, 'server/commercial/web/reviewBrowserCdp.mjs')).href);
const { readPinnedBrowserIdentity, assertHeadlessBrowserProduct } = await import(pathToFileURL(join(workspace, 'server/commercial/web/reviewBrowserBinaryIdentity.mjs')).href);
const assets = join(root, 'assets'), browserProfile = join(root, 'browser-profile');
await mkdir(assets); await mkdir(browserProfile);
const authPlugin = { name: 'synthetic-auth-only', setup(builder) {
  builder.onResolve({ filter: /^\.\/cloudCandidateAuth$/ }, () => ({ path: 'auth', namespace: 'synthetic' }));
  builder.onResolve({ filter: /^\.\/reviewedTranslationFeature$/ }, () => ({ path: 'feature', namespace: 'synthetic' }));
  builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, ({ path }) => path === 'feature'
    ? { loader: 'js', contents: `export const REVIEWED_TRANSLATION_CANDIDATE=${legacyVoice?'false':'true'};` }
    : { loader: 'js', contents: `const first={uid:'synthetic-owner',email:'owner@example.invalid',emailVerified:true};
      const other={uid:'synthetic-other',email:'other@example.invalid',emailVerified:true};let observer;
      window.syntheticOwner=()=>observer?.(first);window.syntheticOther=()=>observer?.(other);window.syntheticSignOut=()=>observer?.(null);
      export async function candidateAuth(){return {observe(fn){observer=fn;queueMicrotask(()=>fn(first));return ()=>{observer=undefined}},token:async(uid)=>'token-'+uid,logout:async()=>observer?.(null)}}` });
} };
await build({ absWorkingDir: workspace, entryPoints: ['server/commercial/web/cloudCandidate.tsx'], bundle: true,
  format: 'esm', platform: 'browser', outdir: assets, entryNames: 'candidate', plugins: [authPlugin], logLevel: 'silent' });
const account = '10000000-0000-4000-8000-000000000001', otherAccount = '10000000-0000-4000-8000-000000000002';
const input = '20000000-0000-4000-8000-000000000001', job = '30000000-0000-4000-8000-000000000001', voice = '30000000-0000-4000-8000-000000000002';
const cueId = 'a'.repeat(64), original = 'Synthetic original.', edit = 'Synthetic unsaved edit.', nextEdit = 'Synthetic next draft.';
const source = { projectRevision: 3, jobRevision: 3, durationMs: 1500, status: 'original', cues: [
  { id: cueId, index: 0, startMs: 0, endMs: 1500, es: 'Texto sintético.', en: original },
] };
let billing = 'settled', deniedJob = false, deniedReview = false, unavailableReview = false, meStatus = 200, jobReads = 0, reviewReads = 0, projectReads = 0, uploadReads = 0, meReads = 0, inputState = 'ready', inputName = 'synthetic.mp4', jobState = 'succeeded';
let cancelPollDenial = 0, sawPollDenial = false, deleteCancelMode = '', afterCancelDelete = false, heldCancelRead, holdReferenceRead = false, heldReferenceRead;
let voiceStage = 0, voiceDenialMode = '', voiceDeleteDenied = false, voiceDenialTriggered = false, globalVoiceDenial = false, holdVoiceInput = false, heldVoiceInput;
let unexpected = 0, proxyAttempts = 0, deletes = 0, reviewWrites = 0, downloads = 0, browser, cdp, exited = false;
const findings = { syntheticOnly: true, physicalPhone: false, realCloud: false, unchangedPoll: false, noRedundantBalanceRead: false, manualBalanceRefresh: false, changedJobRefreshesBalance: false,
  hiddenDuringReview: false, noReviewActions: false, editRestored: false, revokedWhileHidden: false,
  remoteRemovalHidesEdit: false, remoteRemovalKeepsJobRead: false,
  remoteReferenceRetained: false, referenceMobileUsable: false, authorizedFinancialStatus: false, unknownNotConfirmed: false, deniedFinancialStatus: false, referenceAccountSwitchSafe: false, referenceFailureReported: false,
  balanceDenialHidesDraft: false, automaticBalanceDenialHidesDraft: false, reviewUnavailableKeepsHidden: false, reviewReauthorizationRestoresDraft: false, unconfirmedBalanceBlocksActions: false, reviewDenialDestroysDraft: false, global401DestroysDraft: false,
  voiceDeleteDenialPreservesDraft: false, voiceReadDenialHidesDuringCheck: false, voiceOnlyDenialReauthorizesDraft: false, voiceRecheckUnavailableKeepsHidden: false, voiceRecheckRetryRestoresDraft: false, globalVoiceDenialDestroysDraft: false,
  noResurrectionAfterRevocation: false, editorReadDenialDestroysEdit: false, cancelPollDenialHidesEdit: false,
  deleteDenialTemporarilyHides: false, readableAfterDeleteRestoresEdit: false, unavailableReadKeepsHidden: false, retryRestoresEdit: false, cancelReadDenialHidesEdit: false,
  accountSwitchDestroysEdit: false, noDraftInLocalStorage: false,
  confirmedDeleteWithStorageFailureHidesEdit: false, localFailureReported: false,
  unexpectedRequests: null, blockedBrowserRequests: null, proxyAttempts: null, browserExited: false, result: 'INCONCLUSIVE' };
const server = createHttpServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  const reply = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
  if (path === '/') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/candidate.css"><div id="cloud-candidate"></div><script type="module" src="/candidate.js"></script>');
  if (path === '/candidate.js' || path === '/candidate.css') return res.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : 'text/css', 'Cache-Control': 'no-store' }).end(await readFile(join(assets, path.slice(1))));
  if (path === '/brand/vistavo-symbol.svg') return res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg"/>');
  if (path === '/favicon.ico') return res.writeHead(404).end();
  if (path === '/api/cloud/me') { meReads++; if(globalVoiceDenial)return reply(403,{error:'synthetic_global_denial'}); if(meStatus!==200)return reply(meStatus,{error:'synthetic_account_unavailable'}); return reply(200, { id: req.headers.authorization === 'Bearer token-synthetic-other' ? otherAccount : account, balance: { available: 60, reserved: 0, unit: 'video_seconds' } }); }
  if (req.headers.authorization !== 'Bearer token-synthetic-owner') { unexpected++; return reply(403, { error: 'synthetic_denied' }); }
  if(globalVoiceDenial)return reply(403,{error:'synthetic_global_denial'});
  if (path === `/api/cloud/uploads/${input}` && req.method === 'DELETE') { deletes++; return reply(202, { id: input, state: 'deleting' }); }
  if (path === `/api/cloud/uploads/${input}` && req.method === 'GET') { uploadReads++; const value={ id: input, name: inputName, state: inputState, offset: 10, size: 10, metadata: { duration: 1.5, audioTracks: 1 } }; if(voiceDenialTriggered&&holdVoiceInput){holdVoiceInput=false;heldVoiceInput=()=>{if(!res.destroyed&&!res.writableEnded)reply(200,value);};return;}return reply(200,value); }
  if (path === `/api/cloud/projects/${input}` && req.method === 'GET') { projectReads++;if(legacyVoice&&unavailableReview)return reply(503,{error:'synthetic_unavailable'});return reply(200, { revision: 3, draft: '' }); }
  if(path === `/api/cloud/ai/jobs/${voice}` && req.method==='DELETE' && voiceDeleteDenied)return reply(403,{error:'synthetic_voice_delete_denied'});
  if(path === `/api/cloud/ai/jobs/${voice}` && req.method==='GET'){
    if(voiceStage===1)voiceStage=2;else if(voiceStage===2){voiceStage=0;voiceDenialTriggered=true;if(voiceDenialMode==='global')globalVoiceDenial=true;return reply(403,{error:'synthetic_voice_read_denied'});}
    return reply(200,{id:voice,inputId:input,operation:'narration:en:female',state:'running',billingState:'pending',billing:{mode:'account_seconds',unit:'video_seconds'},revision:3,stale:false,units:2,results:[]});
  }
  if (path === `/api/cloud/ai/jobs/${job}` && req.method === 'DELETE' && deleteCancelMode) { afterCancelDelete = true; return reply(403, { error: 'synthetic_denied' }); }
  if (path === `/api/cloud/ai/jobs/${job}` && req.method === 'GET') {
    jobReads++; if (deniedJob) return reply(403, { error: 'synthetic_denied' });
    if (cancelPollDenial === 1) cancelPollDenial = 2;
    else if (cancelPollDenial === 2) { cancelPollDenial = 0; sawPollDenial = true; return reply(403, { error: 'synthetic_denied' }); }
    if (afterCancelDelete && deleteCancelMode === 'denied') { afterCancelDelete = false; return reply(403, { error: 'synthetic_denied' }); }
    if (afterCancelDelete && deleteCancelMode === 'unavailable') { afterCancelDelete = false; return reply(503, { error: 'synthetic_unavailable' }); }
    const value = { id: job, inputId: input, operation: 'translation:en', state: jobState, billingState: billing, billing: { mode: 'account_seconds', unit: 'video_seconds' }, revision: 3, stale: false, units: 2, results: [] };
    if(holdReferenceRead){holdReferenceRead=false;heldReferenceRead=()=>{if(!res.destroyed&&!res.writableEnded)reply(200,value);};return;}
    if (afterCancelDelete && deleteCancelMode === 'readable') { afterCancelDelete = false; heldCancelRead = () => reply(200, value); return; }
    return reply(200, value);
  }
  if (path === `/api/cloud/ai/jobs/${job}/review` && req.method === 'GET') { reviewReads++; if (deniedReview) return reply(403, { error: 'synthetic_denied' }); if(unavailableReview)return reply(503,{error:'synthetic_unavailable'}); return reply(200, source); }
  if (path === `/api/cloud/ai/jobs/${job}/review` && req.method === 'PUT') { reviewWrites++; return reply(500, { error: 'unexpected_synthetic_write' }); }
  if (path === `/api/cloud/ai/jobs/${job}/review/download`) { downloads++; return reply(500, { error: 'unexpected_synthetic_download' }); }
  unexpected++; return reply(404, { error: 'unexpected_synthetic_request' });
});
const proxy = createTcpServer(socket => { proxyAttempts++; socket.destroy(); });
let sessionId, blocked = 0, failure = null, phase = 'listen';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  const address = server.address(), proxyAddress = proxy.address();
  assert.ok(address && typeof address !== 'string' && address.address === '127.0.0.1');
  assert.ok(proxyAddress && typeof proxyAddress !== 'string' && proxyAddress.address === '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  phase = 'browser_spawn'; browser = spawn(readPinnedBrowserIdentity().path, ['--headless=new','--no-first-run','--disable-background-networking','--disable-sync','--disable-extensions',
    '--disable-quic','--disable-component-update','--disable-domain-reliability','--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--proxy-server=http://127.0.0.1:${proxyAddress.port}`,'--proxy-bypass-list=127.0.0.1',
    '--remote-debugging-pipe',`--user-data-dir=${browserProfile}`,'about:blank'],
    { windowsHide: true, stdio: ['ignore','ignore','pipe','pipe','pipe'] });
  browser.once('exit', () => { exited = true; }); browser.once('error', () => { exited = true; });
  const stderr = captureChromeStderr(browser.stderr); cdp = cdpPipe(browser, { timeoutMs: 55_000 });
  phase = 'browser_version'; assertHeadlessBrowserProduct(await cdp.send('Browser.getVersion'));
  const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
  sessionId = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  cdp.on(event => {
    if (event.sessionId !== sessionId || event.method !== 'Fetch.requestPaused') return;
    let allowed = false; try { const url = new URL(event.params.request.url); allowed = url.origin === origin && !url.username && !url.password; } catch { /* fail closed */ }
    if (!allowed) blocked++;
    void cdp.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId: event.params.requestId } : { requestId: event.params.requestId, errorReason: 'BlockedByClient' }, sessionId).catch(() => { blocked++; });
  });
  await cdp.send('Page.enable', {}, sessionId); await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  const prefix = `vistavo-candidate-v1:${account}:`;
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem(${JSON.stringify(prefix+'input')},${JSON.stringify(input)});localStorage.setItem(${JSON.stringify(prefix+'job:'+input+':translation:en')},${JSON.stringify(job)});
    window.confirm=()=>true;window.failInputGeneration=false;window.failReferenceSave=false;const oldSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if((window.failInputGeneration&&String(k).endsWith(':input-generation'))||(window.failReferenceSave&&String(k).endsWith(':review-references')))throw Error('synthetic storage failure');return oldSet.call(this,k,v)};` }, sessionId);
  const evaluate = async expression => { const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); if (result.exceptionDetails) throw Error('Synthetic browser expression failed'); return result.result.value; };
  const wait = async (predicate, label) => { const end = Date.now() + 20_000; while (Date.now() < end) { if (await predicate()) return; await sleep(100); } throw Error(`Synthetic timeout: ${label}`); };
  const click = label => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  const selector=legacyVoice?'#cv-english':'#cv-cue-0';
  const type = value => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const noDraftStored = () => evaluate(`!Object.values(localStorage).some(v=>${JSON.stringify([original,edit,nextEdit])}.some(t=>String(v).includes(t)))`);
  const load = async () => { if(!legacyVoice){await wait(() => evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Cargar frases')"), 'load button'); await click('Cargar frases');}await wait(() => evaluate(`document.querySelector(${JSON.stringify(selector)})!==null`), 'editor'); };
  phase = 'initial_recovery'; await cdp.send('Page.navigate', { url: origin + '/' }, sessionId);
  await wait(() => evaluate("document.body?.innerText.includes('Recuperamos el último archivo')===true"), 'initial recovery');
  await load(); await type(edit);
  if (process.env.VISTAVO_SYNTHETIC_VOICE_DENIAL === '1') {
    phase = 'voice_delete_denial';
    await evaluate(`localStorage.setItem(${JSON.stringify(prefix+'job:'+input+':narration:en:female')},${JSON.stringify(voice)});localStorage.setItem(${JSON.stringify(prefix+'cancel:'+input)},${JSON.stringify(voice)})`);
    await wait(() => evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Reintentar cancelación'&&!b.disabled)"), 'voice cancellation pending');
    const beforeDeleteReview=reviewReads;voiceDeleteDenied=true;await click('Reintentar cancelación');
    await wait(() => evaluate("document.body.innerText.includes('La cancelación aún no se ha confirmado')"), 'voice delete denied but readable');
    findings.voiceDeleteDenialPreservesDraft = reviewReads===beforeDeleteReview&&await evaluate(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(edit)}`);assert.equal(findings.voiceDeleteDenialPreservesDraft,true);
    phase = 'voice_read_denial'; voiceDenialMode='voice';voiceStage=1;holdVoiceInput=true;
    await wait(()=>!!heldVoiceInput,'voice denial reauthorization held');findings.voiceReadDenialHidesDuringCheck=await evaluate(`document.querySelector(${JSON.stringify(selector)})===null&&!document.body.innerText.includes(${JSON.stringify(edit)})`);assert.equal(findings.voiceReadDenialHidesDuringCheck,true);
    const beforeVoiceReview=legacyVoice?projectReads:reviewReads;heldVoiceInput();heldVoiceInput=undefined;
    await wait(()=>(legacyVoice?projectReads:reviewReads)>beforeVoiceReview,'voice denial content reauthorization');await wait(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})!==null`),'voice-only draft restored');
    findings.voiceOnlyDenialReauthorizesDraft=await evaluate(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(edit)}`);assert.equal(findings.voiceOnlyDenialReauthorizesDraft,true);
    await evaluate(`localStorage.removeItem(${JSON.stringify(prefix+'cancel:'+input)});localStorage.removeItem(${JSON.stringify(prefix+'job:'+input+':narration:en:female')})`);voiceDenialTriggered=false;voiceDeleteDenied=false;
    await wait(()=>evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Volver a consultar'&&!b.disabled)"),'recovery after voice denial');await click('Volver a consultar');
    await wait(()=>evaluate("!document.body.innerText.includes('No pudimos consultar todos los trabajos')"),'recovered after voice denial');
    phase = 'voice_review_unavailable';
    await evaluate(`localStorage.setItem(${JSON.stringify(prefix+'job:'+input+':narration:en:female')},${JSON.stringify(voice)});localStorage.setItem(${JSON.stringify(prefix+'cancel:'+input)},${JSON.stringify(voice)})`);
    voiceDenialMode='voice';voiceStage=1;unavailableReview=true;const beforeUnavailable=legacyVoice?projectReads:reviewReads;
    await wait(()=>(legacyVoice?projectReads:reviewReads)>beforeUnavailable,'voice content authorization unavailable');await wait(()=>evaluate("document.body.innerText.includes('No pudimos consultar todos los trabajos')"),'unavailable voice recheck');
    findings.voiceRecheckUnavailableKeepsHidden=await evaluate(`document.querySelector(${JSON.stringify(selector)})===null`);assert.equal(findings.voiceRecheckUnavailableKeepsHidden,true);
    unavailableReview=false;await evaluate(`localStorage.removeItem(${JSON.stringify(prefix+'cancel:'+input)});localStorage.removeItem(${JSON.stringify(prefix+'job:'+input+':narration:en:female')})`);
    await click('Volver a consultar');await wait(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})!==null`),'voice content recheck restored');
    findings.voiceRecheckRetryRestoresDraft=await evaluate(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(edit)}`);assert.equal(findings.voiceRecheckRetryRestoresDraft,true);
    phase = 'voice_global_denial';
    await evaluate(`localStorage.setItem(${JSON.stringify(prefix+'job:'+input+':narration:en:female')},${JSON.stringify(voice)});localStorage.setItem(${JSON.stringify(prefix+'cancel:'+input)},${JSON.stringify(voice)})`);
    voiceDenialMode='global';voiceStage=1;
    await wait(()=>evaluate("document.body.innerText.includes('No podemos confirmar el acceso')"),'global voice denial');
    findings.globalVoiceDenialDestroysDraft=await evaluate(`document.querySelector(${JSON.stringify(selector)})===null&&!document.body.innerText.includes(${JSON.stringify(edit)})`);assert.equal(findings.globalVoiceDenialDestroysDraft,true);
    assert.equal(await noDraftStored(),true);findings.result='PASS';
  } else if (process.env.VISTAVO_SYNTHETIC_BALANCE_DENIAL === '1') {
    phase = 'balance_denied'; meStatus = 403; await click('Actualizar saldo');
    await wait(() => evaluate("document.body.innerText.includes('Esta cuenta no tiene acceso')"), 'account balance denied');
    findings.balanceDenialHidesDraft = await evaluate(`document.querySelector('#cv-cue-0')===null&&!document.body.innerText.includes(${JSON.stringify(edit)})`); assert.equal(findings.balanceDenialHidesDraft, true);
    meStatus = 200; unavailableReview = true; const firstReview = reviewReads;
    await click('Volver a consultar'); await wait(() => reviewReads > firstReview, 'review authorization attempted');
    await wait(() => evaluate("document.body.innerText.includes('No pudimos consultar todos los trabajos')"), 'review check unavailable');
    findings.reviewUnavailableKeepsHidden = await evaluate("document.querySelector('#cv-cue-0')===null"); assert.equal(findings.reviewUnavailableKeepsHidden, true);
    unavailableReview = false; const secondReview = reviewReads; await click('Volver a consultar');
    await wait(() => reviewReads > secondReview, 'review authorization retried'); await wait(() => evaluate("document.querySelector('#cv-cue-0')!==null"), 'authorized draft restored');
    findings.reviewReauthorizationRestoresDraft = await evaluate(`document.querySelector('#cv-cue-0').value===${JSON.stringify(edit)}`); assert.equal(findings.reviewReauthorizationRestoresDraft, true);
    phase = 'automatic_balance_denial'; meStatus = 403; inputName = 'synthetic-renamed.mp4';
    await wait(() => evaluate("document.body.innerText.includes('Esta cuenta no tiene acceso')"), 'automatic account denial');
    findings.automaticBalanceDenialHidesDraft = await evaluate("document.querySelector('#cv-cue-0')===null"); assert.equal(findings.automaticBalanceDenialHidesDraft, true);
    meStatus = 200; const automaticReview = reviewReads; await click('Volver a consultar'); await wait(() => reviewReads > automaticReview, 'automatic denial review check');
    await wait(() => evaluate(`document.querySelector('#cv-cue-0')?.value===${JSON.stringify(edit)}`), 'automatic denial restored draft');
    meStatus = 403; await click('Actualizar saldo'); await wait(() => evaluate("document.querySelector('#cv-cue-0')===null"), 'draft hidden while balance unconfirmed');
    const thirdReview = reviewReads; await click('Volver a consultar'); await wait(() => reviewReads > thirdReview, 'phrases independently authorized');
    await wait(() => evaluate("document.querySelector('#cv-cue-0')!==null"), 'draft restored despite unavailable balance'); await type(original);
    await wait(() => evaluate("!document.body.innerText.includes('cambios sin guardar')"), 'clean editor');
    findings.unconfirmedBalanceBlocksActions = await evaluate("document.body.innerText.includes('No pudimos verificar tu saldo')&&Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Consultar cotización').disabled&&Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Generar español e inglés').disabled");
    assert.equal(findings.unconfirmedBalanceBlocksActions, true);
    phase = 'review_denied_during_recheck'; await type(edit); await click('Actualizar saldo'); await wait(() => evaluate("document.querySelector('#cv-cue-0')===null"), 'hidden for denied balance');
    meStatus = 200; deniedReview = true; const deniedReviewRead = reviewReads; await click('Volver a consultar'); await wait(() => reviewReads > deniedReviewRead, 'denied review recheck');
    await wait(() => evaluate("document.body.innerText.includes('No podemos confirmar el acceso')"), 'review denial hides draft');
    findings.reviewDenialDestroysDraft = await evaluate(`document.querySelector('#cv-cue-0')===null&&!document.body.innerText.includes(${JSON.stringify(edit)})`); assert.equal(findings.reviewDenialDestroysDraft, true);
    phase = 'global_401'; deniedReview = false; await evaluate('window.syntheticSignOut()'); await evaluate('window.syntheticOwner()');
    await wait(() => evaluate("document.body?.innerText.includes('Recuperamos el último archivo')===true"), 'recovery before global 401'); await load(); await type(edit);
    meStatus = 401; await click('Actualizar saldo'); await wait(() => evaluate("document.body.innerText.includes('No podemos confirmar el acceso')"), 'global 401 hides draft');
    findings.global401DestroysDraft = await evaluate(`document.querySelector('#cv-cue-0')===null&&!document.body.innerText.includes(${JSON.stringify(edit)})`); assert.equal(findings.global401DestroysDraft, true); findings.result = 'PASS';
  } else if (process.env.VISTAVO_SYNTHETIC_REMOTE_DELETE === '1') {
    phase = 'remote_delete'; const before = jobReads, beforeUpload = uploadReads;
    if(process.env.VISTAVO_SYNTHETIC_REMOTE_REF_FAILURE === '1')await evaluate('window.failReferenceSave=true');
    inputState = 'deleting';
    await wait(() => jobReads > before, 'job still checked after remote deletion'); await sleep(200);
    findings.remoteRemovalKeepsJobRead = jobReads > before;
    findings.remoteRemovalHidesEdit = uploadReads > beforeUpload && await evaluate(`document.querySelector('#cv-cue-0')===null&&!document.body.innerText.includes(${JSON.stringify(edit)})`);
    assert.equal(findings.remoteRemovalKeepsJobRead, true); assert.equal(findings.remoteRemovalHidesEdit, true);
    if(process.env.VISTAVO_SYNTHETIC_REMOTE_REF_FAILURE === '1'){
      findings.referenceFailureReported = await evaluate("document.body.innerText.includes('No pudimos conservar todas las referencias')");
      assert.equal(findings.referenceFailureReported, true);
    }else{
      phase = 'remote_reference'; findings.remoteReferenceRetained = await evaluate(`document.body.innerText.includes(${JSON.stringify(job)})`);
      assert.equal(findings.remoteReferenceRetained, true);
      findings.referenceMobileUsable = await evaluate("(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()==='Consultar estado de este trabajo');b.focus();return document.activeElement===b&&b.getBoundingClientRect().height>=44&&document.documentElement.scrollWidth<=innerWidth})()"); assert.equal(findings.referenceMobileUsable, true);
      await click('Consultar estado de este trabajo'); await wait(() => evaluate("document.body.innerText.includes('Estado del saldo: confirmado')"), 'authorized financial status');
      findings.authorizedFinancialStatus = await evaluate(`document.querySelector('#cv-cue-0')===null&&!document.body.innerText.includes(${JSON.stringify(edit)})`); assert.equal(findings.authorizedFinancialStatus, true);
      jobState = 'unknown'; await click('Consultar estado de este trabajo'); await wait(() => evaluate("document.body.innerText.includes('Estado del saldo: necesita revisión')"), 'unknown state stays uncertain');
      findings.unknownNotConfirmed = await evaluate("!document.body.innerText.includes('Estado del saldo: confirmado')"); assert.equal(findings.unknownNotConfirmed, true);
      deniedJob = true; await click('Consultar estado de este trabajo');
      await wait(() => evaluate("document.body.innerText.includes('No podemos consultar este trabajo con esta cuenta')"), 'denied financial status');
      findings.deniedFinancialStatus = await evaluate("!document.body.innerText.includes('Estado del saldo: confirmado')&&document.querySelector('#cv-cue-0')===null"); assert.equal(findings.deniedFinancialStatus, true);
      deniedJob = false; jobState = 'succeeded'; holdReferenceRead = true; await click('Consultar estado de este trabajo');
      await wait(() => !!heldReferenceRead, 'held reference read'); await wait(() => evaluate("document.body.innerText.includes('Consultando estado')"), 'reference read in progress');
      await evaluate('window.syntheticOther()'); await wait(() => evaluate(`!document.body.innerText.includes(${JSON.stringify(job)})`), 'new account has no old reference');
      heldReferenceRead(); heldReferenceRead = undefined; await sleep(200);
      findings.referenceAccountSwitchSafe = await evaluate(`!document.body.innerText.includes(${JSON.stringify(job)})&&!document.body.innerText.includes('Estado del saldo: confirmado')`); assert.equal(findings.referenceAccountSwitchSafe, true);
    }
    findings.result = 'PASS';
  } else {
  const readsBefore = jobReads, meBefore = meReads; await wait(() => jobReads > readsBefore, 'normal poll'); await sleep(150);
  findings.unchangedPoll = await evaluate(`document.querySelector('#cv-cue-0')?.value===${JSON.stringify(edit)}`); assert.equal(findings.unchangedPoll, true);
  findings.noRedundantBalanceRead = meReads === meBefore; assert.equal(findings.noRedundantBalanceRead, true);
  const beforeManual = meReads; await click('Actualizar saldo'); await wait(() => meReads > beforeManual, 'manual balance refresh'); findings.manualBalanceRefresh = true;
  phase = 'cancel_poll_denial'; billing = 'pending';
  await evaluate(`localStorage.setItem(${JSON.stringify(prefix+'cancel:'+input)},${JSON.stringify(job)})`); cancelPollDenial = 1;
  await wait(() => evaluate("document.body.innerText.includes('No pudimos consultar todos los trabajos')"), 'cancellation read denial');
  findings.cancelPollDenialHidesEdit = sawPollDenial && await evaluate("document.querySelector('#cv-cue-0')===null");
  assert.equal(findings.cancelPollDenialHidesEdit, true);
  await evaluate(`localStorage.removeItem(${JSON.stringify(prefix+'cancel:'+input)});localStorage.removeItem(${JSON.stringify(prefix+'cancel-confirmed:'+input)})`);
  billing = 'settled'; await evaluate('window.syntheticSignOut()'); await evaluate('window.syntheticOwner()');
  await wait(() => evaluate("document.body?.innerText.includes('Recuperamos el último archivo')===true"), 'recovery after cancellation denial'); await load(); await type(edit);
  phase = 'delete_denied_readable'; billing = 'pending';
  await evaluate(`localStorage.setItem(${JSON.stringify(prefix+'cancel:'+input)},${JSON.stringify(job)})`);
  await wait(() => evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Reintentar cancelación'&&!b.disabled)"), 'retry cancellation');
  deleteCancelMode = 'readable'; await click('Reintentar cancelación'); await wait(() => !!heldCancelRead, 'held authorization read');
  findings.deleteDenialTemporarilyHides = await evaluate("document.querySelector('#cv-cue-0')===null"); assert.equal(findings.deleteDenialTemporarilyHides, true);
  heldCancelRead(); heldCancelRead = undefined;
  await wait(() => evaluate("document.querySelector('#cv-cue-0')!==null"), 'read authorization restored');
  findings.readableAfterDeleteRestoresEdit = await evaluate(`document.querySelector('#cv-cue-0').value===${JSON.stringify(edit)}`); assert.equal(findings.readableAfterDeleteRestoresEdit, true);
  phase = 'delete_denied_unavailable'; deleteCancelMode = 'unavailable'; await click('Reintentar cancelación');
  await wait(() => evaluate("document.body.innerText.includes('No pudimos consultar todos los trabajos')"), 'unavailable cancellation read');
  findings.unavailableReadKeepsHidden = await evaluate("document.querySelector('#cv-cue-0')===null"); assert.equal(findings.unavailableReadKeepsHidden, true);
  deleteCancelMode = ''; await wait(() => evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Volver a consultar'&&!b.disabled)"), 'retry available');
  await click('Volver a consultar'); await wait(() => evaluate("document.querySelector('#cv-cue-0')!==null"), 'retry restored editor');
  findings.retryRestoresEdit = await evaluate(`document.querySelector('#cv-cue-0').value===${JSON.stringify(edit)}`); assert.equal(findings.retryRestoresEdit, true);
  phase = 'delete_denied_unreadable'; deleteCancelMode = 'denied'; await click('Reintentar cancelación');
  await wait(() => evaluate("document.body.innerText.includes('No podemos confirmar el acceso')"), 'cancel status denied');
  findings.cancelReadDenialHidesEdit = await evaluate("document.querySelector('#cv-cue-0')===null"); assert.equal(findings.cancelReadDenialHidesEdit, true);
  deleteCancelMode = ''; await evaluate(`localStorage.removeItem(${JSON.stringify(prefix+'cancel:'+input)});localStorage.removeItem(${JSON.stringify(prefix+'cancel-confirmed:'+input)})`);
  billing = 'settled'; await evaluate('window.syntheticSignOut()'); await evaluate('window.syntheticOwner()');
  await wait(() => evaluate("document.body?.innerText.includes('Recuperamos el último archivo')===true"), 'recovery after denied cancellation'); await load(); await type(edit);
  phase = 'financial_review'; const beforeReviewBalance = meReads; billing = 'review';
  await wait(() => evaluate("document.body.innerText.includes('Necesita revisión')"), 'review');
  await wait(() => meReads > beforeReviewBalance, 'changed job refreshes balance'); findings.changedJobRefreshesBalance = true;
  findings.hiddenDuringReview = await evaluate(`document.querySelector('#cv-cue-0')===null&&!document.body.innerText.includes(${JSON.stringify(original)})&&!document.body.innerText.includes(${JSON.stringify(edit)})`);
  findings.noReviewActions = await evaluate("!Array.from(document.querySelectorAll('button')).some(b=>/Guardar revisión|Descargar inglés|Descartar cambios/.test(b.textContent))");
  assert.equal(findings.hiddenDuringReview, true); assert.equal(findings.noReviewActions, true);
  findings.noDraftInLocalStorage = await noDraftStored(); assert.equal(findings.noDraftInLocalStorage, true); assert.equal(reviewWrites, 0); assert.equal(downloads, 0);
  phase = 'financial_recovery'; billing = 'settled'; await click('Consultar estado');
  await wait(() => evaluate("document.querySelector('#cv-cue-0')!==null"), 'edit restored');
  findings.editRestored = await evaluate(`document.querySelector('#cv-cue-0').value===${JSON.stringify(edit)}`); assert.equal(findings.editRestored, true);
  phase = 'denied_while_hidden'; billing = 'review';
  await click('Consultar estado'); await wait(() => evaluate("document.querySelector('#cv-cue-0')===null"), 'hidden again');
  deniedJob = true; await wait(() => evaluate("document.body.innerText.includes('No podemos confirmar el acceso')"), 'confirmed denial');
  findings.revokedWhileHidden = await evaluate(`document.querySelector('#cv-cue-0')===null&&!document.body.innerText.includes(${JSON.stringify(edit)})`); assert.equal(findings.revokedWhileHidden, true);
  deniedJob = false; billing = 'settled'; await evaluate('window.syntheticSignOut()'); await evaluate('window.syntheticOwner()');
  await wait(() => evaluate("document.body?.innerText.includes('Recuperamos el último archivo')===true"), 'recovery after signout'); await load();
  findings.noResurrectionAfterRevocation = await evaluate(`document.querySelector('#cv-cue-0').value===${JSON.stringify(original)}`); assert.equal(findings.noResurrectionAfterRevocation, true);
  phase = 'denied_editor_read'; await type(nextEdit); deniedReview = true; await click('Descartar cambios y cargar versión guardada');
  await wait(() => evaluate("document.body.innerText.includes('No podemos confirmar el acceso')"), 'editor denial');
  findings.editorReadDenialDestroysEdit = await evaluate(`document.querySelector('#cv-cue-0')===null&&!document.body.innerText.includes(${JSON.stringify(nextEdit)})`);
  assert.equal(findings.editorReadDenialDestroysEdit, true); deniedReview = false; await evaluate('window.syntheticSignOut()'); await evaluate('window.syntheticOwner()');
  await wait(() => evaluate("document.body?.innerText.includes('Recuperamos el último archivo')===true"), 'recovery after editor denial'); await load();
  assert.equal(await evaluate(`document.querySelector('#cv-cue-0').value===${JSON.stringify(original)}`), true);
  phase = 'account_switch'; await type(nextEdit); await evaluate('window.syntheticOther()');
  await wait(() => evaluate("document.querySelector('#cv-cue-0')===null"), 'other account');
  findings.accountSwitchDestroysEdit = await evaluate(`!document.body.innerText.includes(${JSON.stringify(nextEdit)})`); assert.equal(findings.accountSwitchDestroysEdit, true);
  assert.equal(await noDraftStored(), true); await evaluate('window.syntheticOwner()');
  await wait(() => evaluate("document.body?.innerText.includes('Recuperamos el último archivo')===true"), 'owner recovery'); await load();
  assert.equal(await evaluate(`document.querySelector('#cv-cue-0').value===${JSON.stringify(original)}`), true);
  phase = 'delete_storage_failure'; await type(nextEdit); await evaluate('window.failInputGeneration=true'); await click('Eliminar video y resultados');
  await wait(() => evaluate("document.body.innerText.includes('No pudimos actualizar toda la información')"), 'local failure warning');
  findings.confirmedDeleteWithStorageFailureHidesEdit = await evaluate(`document.querySelector('#cv-cue-0')===null&&!document.body.innerText.includes(${JSON.stringify(nextEdit)})`);
  findings.localFailureReported = deletes === 1; assert.equal(findings.confirmedDeleteWithStorageFailureHidesEdit, true); assert.equal(findings.localFailureReported, true);
  assert.equal(await noDraftStored(), true); assert.equal(reviewWrites, 0); assert.equal(downloads, 0);
  findings.browserDiagnostics = stderr.snapshot(); findings.reviewReads = reviewReads; findings.result = 'PASS';
  }
} catch (error) {
  failure = error?.code === 'ERR_ASSERTION' ? 'assertion_failed' : 'synthetic_fixture_inconclusive';
  findings.failurePhase = phase; findings.errorType = typeof error?.name === 'string' ? error.name : 'unknown';
  findings.errorCode = typeof error?.code === 'string' ? error.code : null;
  findings.errorMessage = typeof error?.message === 'string' && /^Synthetic (?:browser|CDP|Chrome|timeout)/.test(error.message) ? error.message.slice(0, 200) : 'suppressed';
  if (failure === 'assertion_failed') findings.result = 'FAIL'; process.exitCode = 1;
} finally {
  if (browser && !exited) { browser.kill(); const end = Date.now() + 10_000; while (!exited && Date.now() < end) await sleep(50); }
  findings.browserExited = !browser || exited;
  if (server.listening) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  if (proxy.listening) await new Promise(resolve => proxy.close(resolve));
  findings.unexpectedRequests = unexpected; findings.blockedBrowserRequests = blocked; findings.proxyAttempts = proxyAttempts;
  findings.failure = failure; findings.browserPid = browser?.pid ?? null; findings.browserProfile = browserProfile;
  findings.networkLimitation = 'Loopback proxy and browser interception are not an operating-system firewall.';
  await writeFile(join(root, 'result.json'), JSON.stringify(findings, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ root, ...findings }));
  if (!findings.browserExited || unexpected || blocked || proxyAttempts) process.exitCode = 1;
}
