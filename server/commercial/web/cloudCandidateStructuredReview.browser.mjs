// Isolated synthetic browser test. No Firebase, real accounts, or cloud resources.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { build } from 'esbuild';

const root = resolve('outputs/lv019-b-structured-mobile-' + randomUUID());
await mkdir(root, { recursive: false });
const authPlugin = { name: 'synthetic-auth', setup(builder) {
  builder.onResolve({ filter: /^\.\/cloudCandidateAuth$/ }, () => ({ path: 'auth', namespace: 'synthetic-auth' }));
  builder.onLoad({ filter: /.*/, namespace: 'synthetic-auth' }, () => ({ loader: 'js', contents: `
    const user={uid:'synthetic-user',email:'synthetic@example.invalid',emailVerified:true};let observer;
    window.testSignOut=()=>observer?.(null);window.testSignIn=()=>observer?.(user);
    export async function candidateAuth(){return {observe(fn){observer=fn;queueMicrotask(()=>fn(user));return ()=>{observer=undefined}},token:async()=>'synthetic-token',logout:async()=>observer?.(null)}}
  ` }));
} };
const enablePlugin = { name: 'synthetic-feature-only', setup(builder) {
  builder.onResolve({ filter: /^\.\/reviewedTranslationFeature$/ }, () => ({ path: 'flag', namespace: 'synthetic-flag' }));
  builder.onLoad({ filter: /.*/, namespace: 'synthetic-flag' }, () => ({ loader: 'js', contents: 'export const REVIEWED_TRANSLATION_CANDIDATE=true;' }));
} };
for (const [name, plugins] of [['off', [authPlugin]], ['on', [authPlugin, enablePlugin]]]) {
  await build({ entryPoints: ['server/commercial/web/cloudCandidate.tsx'], bundle: true, format: 'esm', platform: 'browser', outdir: root, entryNames: name, plugins });
}
const account = '10000000-0000-4000-8000-000000000001', input = '20000000-0000-4000-8000-000000000001', job = '30000000-0000-4000-8000-000000000001';
const first = 'a'.repeat(64), second = 'b'.repeat(64), requests = [], saves = [];
const originalBytes = Buffer.from('Synthetic unreviewed text.');
const originalResult = { name: 'translation-en.txt', mimeType: 'text/plain; charset=utf-8', size: originalBytes.length, sha256: createHash('sha256').update(originalBytes).digest('hex') };
let current = { projectRevision: 3, jobRevision: 3, durationMs: 3500, status: 'original', cues: [
  { id: first, index: 0, startMs: 0, endMs: 1200, es: 'La bomba mide 5 cm.', en: 'The pump measures 5 cm.' },
  { id: second, index: 1, startMs: 1500, endMs: 3500, es: 'Sin fugas.', en: 'No leaks.' },
] };
let mode = 'ok', loseFirstSave = true, accepted, held, heldSave, heldResult; const findings = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1'); requests.push({ method: req.method, path: url.pathname });
  const reply = (status, value) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
  if (url.pathname === '/off' || url.pathname === '/on') {
    const name = url.pathname.slice(1);
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${name}.css"><div id="cloud-candidate"></div><script type="module" src="/${name}.js"></script>`);
  }
  if (/^\/(on|off)\.(js|css)$/.test(url.pathname)) return res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }).end(await readFile(join(root, url.pathname.slice(1))));
  if (url.pathname === '/brand/vistavo-symbol.svg') return res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg"/>');
  if (url.pathname === '/api/cloud/me') return reply(200, { id: account, balance: { available: 60, reserved: 0, unit: 'video_seconds' } });
  if (url.pathname === '/api/cloud/uploads/' + input) return reply(200, { id: input, name: 'synthetic.mp4', state: 'ready', offset: 10, size: 10, metadata: { duration: 3.5, audioTracks: 1 } });
  if (url.pathname === '/api/cloud/projects/' + input) return reply(200, { revision: current.projectRevision, draft: current.status === 'reviewed' ? current.cues.map(c => c.en).join('\n') + '\n' : '' });
  if (url.pathname === '/api/cloud/ai/jobs/' + job) return reply(200, { id: job, inputId: input, operation: 'translation:en', state: 'succeeded', billingState: 'settled', revision: 3, stale: false, units: 4, results: [originalResult] });
  if (url.pathname === '/api/cloud/ai/jobs/' + job + '/results/translation-en.txt') {
    res.writeHead(200, { 'Content-Type': originalResult.mimeType, 'Cache-Control': 'no-store' });
    if (mode === 'ack-denied-held') { res.flushHeaders(); heldResult = () => { if (!res.destroyed && !res.writableEnded) res.end(originalBytes); }; return; }
    return res.end(originalBytes);
  }
  if (url.pathname === '/api/cloud/ai/jobs/' + job + '/review') {
    assert.equal(req.headers.authorization, 'Bearer synthetic-token'); assert.equal(req.headers.cookie, undefined);
    if (req.method === 'GET') {
      if (mode === 'hold') { held = () => reply(200, current); return; }
      if (mode === 'denied' || (['ack-denied', 'ack-denied-held'].includes(mode) && accepted)) return reply(403, { error: 'not_found' });
      if (mode === 'mismatch-job' && accepted) return reply(200, { ...current, jobRevision: current.jobRevision + 1 });
      if (mode === 'balance') return reply(402, { error: 'synthetic_balance' });
      if (mode === 'legacy') return reply(200, { ...current, status: 'legacy', reason: 'unlinked_draft', legacyDraft: 'Borrador anterior de ejemplo' });
      return reply(200, current);
    }
    if (req.method === 'PUT') {
      let text = ''; for await (const chunk of req) text += chunk;
      const body = JSON.parse(text); saves.push(body); if (mode === 'conflict') return reply(409, { error: 'conflict' });
      if (!accepted) {
        accepted = JSON.stringify(body); assert.equal(body.expectedRevision, current.projectRevision); assert.equal(body.inputId, input);
        current = { ...current, projectRevision: current.projectRevision + 1, status: 'reviewed', cues: current.cues.map((cue, index) => ({ ...cue, en: body.edits[index].en })) };
      } else assert.equal(JSON.stringify(body), accepted, 'a retry must preserve key and payload');
      if (loseFirstSave) { req.socket.destroy(); return; }
      if (mode === 'ack-denied-held') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.flushHeaders();
        heldSave = () => { if (!res.destroyed && !res.writableEnded) res.end(JSON.stringify({ committedRevision: current.projectRevision })); }; return;
      }
      return reply(200, { committedRevision: current.projectRevision });
    }
  }
  if (url.pathname === '/api/cloud/ai/jobs/' + job + '/review/download') {
    assert.equal(req.headers.authorization, 'Bearer synthetic-token'); assert.equal(req.headers.cookie, undefined);
    if (mode === 'denied') return reply(403, { error: 'not_found' });
    const format = url.searchParams.get('format'); assert.equal(url.searchParams.get('revision'), '4');
    const body = format === 'txt' ? current.cues.map(c => c.en).join('\n') + '\n' : `1\n00:00:00,000 --> 00:00:01,200\n${current.cues[0].en}\n\n2\n00:00:01,500 --> 00:00:03,500\n${current.cues[1].en}\n`;
    return res.writeHead(200, { 'Content-Type': format === 'txt' ? 'text/plain; charset=utf-8' : 'application/x-subrip; charset=utf-8', 'Cache-Control': 'no-store', 'X-Vistavo-Revision': '4' }).end(body);
  }
  return reply(404, { error: 'synthetic_not_found' });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const origin = 'http://127.0.0.1:' + address.port, profile = await mkdtemp(join(root, 'chrome-'));
let browser, ws;
try {
  browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--disable-background-networking', '--disable-sync', '--disable-extensions', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port; for (let i = 0; i < 100; i++) { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
  assert.ok(port, 'Chrome did not start');
  const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let next = 0; const pending = new Map(), exceptions = [];
  ws.onmessage = event => { const value = JSON.parse(String(event.data)); if (value.id) { pending.get(value.id)?.(value); pending.delete(value.id); } if (value.method === 'Runtime.exceptionThrown') exceptions.push(value.params.exceptionDetails.text); };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, value => value.error ? reject(Error(JSON.stringify(value.error))) : resolve(value.result)); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.text); return result.result.value; };
  const wait = async expression => { for (let i = 0; i < 150; i++) { if (await evalJs(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error('Timed out: ' + expression + '; ' + await evalJs('document.body.innerText.slice(0,3000)')); };
  const click = label => evalJs(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  const edit = text => evalJs(`(()=>{const e=document.querySelector('#cv-cue-0');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await call('Page.enable'); await call('Runtime.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
  const prefix = 'vistavo-candidate-v1:' + account + ':';
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem(${JSON.stringify(prefix + 'input')},${JSON.stringify(input)});
    localStorage.setItem(${JSON.stringify(prefix + 'job:' + input + ':translation:en')},${JSON.stringify(job)});
    window.syntheticDownloads=[];window.syntheticBlobs=[];window.confirm=()=>true;
    const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{window.syntheticBlobs.push(blob);return create(blob)};
    HTMLAnchorElement.prototype.click=function(){if(this.download)window.syntheticDownloads.push(this.download)};
  ` });
  await call('Page.navigate', { url: origin + '/off' }); await wait("document.body.innerText.includes('Recuperamos el último archivo')");
  assert.equal(await evalJs("document.body.innerText.includes('Cargar frases')"), false);
  assert.equal(requests.filter(r => r.path.endsWith('/review')).length, 0, 'default-off must send no review requests');
  await call('Page.navigate', { url: origin + '/on' }); await wait("document.body.innerText.includes('Recuperamos el último archivo')");
  assert.equal(await evalJs("document.body.innerText.includes('Preparar audio para escuchar')"), false);
  await click('Cargar frases'); await wait("document.querySelector('#cv-cue-0')!==null");
  assert.equal(await evalJs("document.querySelector('#cv-cue-0').value"), 'The pump measures 5 cm.');
  assert.equal(await evalJs("document.querySelector('label[for=cv-cue-0]').innerText"), 'Inglés · frase 1');
  assert.equal(await evalJs("document.body.innerText.includes('0:00.000–0:01.200')"), true);
  assert.equal(await evalJs("/KiB|UTF-8|clave/i.test(document.querySelector('.cv-structured-review').innerText)"), false);
  assert.equal(await evalJs('document.documentElement.scrollWidth<=innerWidth'), true);
  assert.equal(await evalJs("getComputedStyle(document.querySelector('.cv-structured-review button')).minHeight"), '44px');
  await evalJs("document.querySelector('#cv-cue-0').focus()");
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evalJs('document.activeElement.id'), 'cv-cue-1');
  await edit('Bad\nline'); await wait("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Guardar revisión').disabled");
  assert.equal(await evalJs("document.querySelector('.cv-structured-review').innerText.includes('saltos de línea')"), true);
  await edit('The pump measures 5 centimeters.');
  await wait("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Guardar revisión').disabled");
  if (!await evalJs("(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})()")) findings.push('dirty edit does not warn before reload');
  await click('Guardar revisión'); await wait("document.body.innerText.includes('Guardado sin confirmar') && document.body.innerText.includes('No pudimos confirmar la respuesta')");
  assert.equal(await evalJs("document.querySelector('.cv-structured-review').innerText.includes('conservaremos la misma edición')"), true);
  assert.equal(await evalJs("document.querySelector('#cv-cue-0').disabled"), true); assert.ok(saves.length >= 1);
  const attemptsBeforeRetry = saves.length; for (const attempt of saves) assert.deepEqual(attempt, saves[0]); loseFirstSave = false;
  await click('Comprobar mismo guardado'); await wait("document.body.innerText.includes('Revisión guardada y reabierta')");
  assert.equal(await evalJs("(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})()"), false);
  assert.ok(saves.length > attemptsBeforeRetry); for (const attempt of saves) assert.deepEqual(attempt, saves[0]);
  await click('Descargar inglés TXT revisado'); await wait("window.syntheticDownloads.includes('vistavo-translation.txt')");
  await click('Descargar inglés SRT revisado'); await wait("window.syntheticDownloads.includes('vistavo-translation.srt')");
  assert.match(await evalJs('window.syntheticBlobs[0].text()'), /5 centimeters/);
  assert.match(await evalJs('window.syntheticBlobs[1].text()'), /00:00:00,000 --> 00:00:01,200/);
  await call('Page.reload'); await wait("document.body.innerText.includes('Recuperamos el último archivo')"); await click('Cargar frases'); await wait("document.querySelector('#cv-cue-0')!==null");
  assert.equal(await evalJs("document.querySelector('#cv-cue-0').value"), 'The pump measures 5 centimeters.');
  mode = 'conflict'; await edit('Conflicting local edit.'); await click('Guardar revisión'); await wait("document.body.innerText.includes('Otra acción cambió el proyecto')");
  assert.equal(await evalJs("document.querySelector('#cv-cue-0').value"), 'Conflicting local edit.');
  mode = 'ok'; await click('Descartar cambios y cargar versión guardada'); await wait("document.querySelector('#cv-cue-0').value==='The pump measures 5 centimeters.'");
  accepted = undefined; mode = 'mismatch-job'; await edit('Cambio con trabajo distinto.'); await click('Guardar revisión');
  await wait("document.body.innerText.includes('Tu guardado se confirmó, pero el proyecto volvió a cambiar') || document.body.innerText.includes('Revisión guardada y reabierta')");
  if (!await evalJs("document.body.innerText.includes('Tu guardado se confirmó, pero el proyecto volvió a cambiar')")) findings.push('changed jobRevision accepted on reread');
  mode = 'ok'; await evalJs("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('cargar versión guardada')||b.textContent.trim()==='Volver a cargar revisión').click()");
  await wait("document.querySelector('#cv-cue-0')?.value==='Cambio con trabajo distinto.'");
  accepted = undefined; mode = 'ack-denied-held'; await edit('Guardado antes de perder acceso.'); await click('Guardar revisión');
  for (let i = 0; i < 100 && !heldSave; i++) await new Promise(resolve => setTimeout(resolve, 100)); assert.ok(heldSave, 'save ACK not held');
  const beforeDownloads = await evalJs('window.syntheticDownloads.length'), beforeBlobs = await evalJs('window.syntheticBlobs.length');
  await evalJs("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Inglés original · TXT')).click()");
  for (let i = 0; i < 100 && !heldResult; i++) await new Promise(resolve => setTimeout(resolve, 100)); assert.ok(heldResult, 'original download not held');
  heldSave(); heldSave = undefined;
  await wait("document.body.innerText.includes('Ya no tienes acceso')"); await new Promise(resolve => setTimeout(resolve, 100));
  if (await evalJs("document.querySelector('#cv-cue-0')!==null")) findings.push('text remains after denied reread');
  if (await evalJs("document.body.innerText.includes('Guardado antes de perder acceso.') || Array.from(document.querySelectorAll('textarea')).some(e=>e.value.includes('Guardado antes de perder acceso.'))")) findings.push('denied text remains visible');
  if (!await evalJs("Array.from(document.querySelectorAll('button')).filter(b=>/Consultar cotización|Generar español e inglés/.test(b.textContent)).every(b=>b.disabled)")) findings.push('stale parent can still start work after denied reread');
  heldResult(); heldResult = undefined; await wait("!document.querySelector('input[type=file]').disabled");
  if (await evalJs('window.syntheticDownloads.length') !== beforeDownloads) findings.push('old in-flight download clicked anchor after denied reread');
  if (await evalJs('window.syntheticBlobs.length') !== beforeBlobs) findings.push('old in-flight download created object URL after denied reread');
  mode = 'ok'; await call('Page.reload'); await wait("document.body.innerText.includes('Recuperamos el último archivo')"); await click('Cargar frases'); await wait("document.querySelector('#cv-cue-0')!==null");
  mode = 'denied'; await click('Descargar inglés TXT revisado'); await wait("document.body.innerText.includes('Ya no tienes acceso')");
  assert.equal(await evalJs("document.querySelector('#cv-cue-0')===null"), true);
  mode = 'ok'; await call('Page.reload'); await wait("document.body.innerText.includes('Recuperamos el último archivo')"); await click('Cargar frases'); await wait("document.querySelector('#cv-cue-0')!==null");
  mode = 'legacy'; await click('Volver a cargar revisión'); await wait("document.querySelector('#cv-legacy-draft')!==null");
  assert.equal(await evalJs("document.querySelector('#cv-legacy-draft').value"), 'Borrador anterior de ejemplo');
  assert.equal(await evalJs("document.querySelector('#cv-legacy-draft').readOnly"), true);
  mode = 'balance'; await call('Page.reload'); await wait("document.body.innerText.includes('Recuperamos el último archivo')"); await click('Cargar frases'); await wait("document.body.innerText.includes('estado del saldo')");
  mode = 'denied'; await click('Cargar frases'); await wait("document.body.innerText.includes('Ya no tienes acceso')");
  assert.equal(await evalJs("document.querySelector('#cv-cue-0')===null"), true);
  mode = 'hold'; await call('Page.reload'); await wait("document.body.innerText.includes('Recuperamos el último archivo')"); await click('Cargar frases'); for (let i = 0; i < 100 && !held; i++) await new Promise(resolve => setTimeout(resolve, 100)); assert.ok(held);
  await evalJs('window.testSignOut()'); await wait("!document.body.innerText.includes('Tu espacio privado')"); held(); held = undefined;
  await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(await evalJs("document.querySelector('#cv-cue-0')===null"), true);
  assert.deepEqual(exceptions, []); assert.deepEqual(findings, []);
  const evidence = { result: 'PASS', syntheticOnly: true, viewport: 320, physicalPhoneTested: false, defaultOffNoReviewRequest: true, labelledInputs: true, keyboardNavigation: true, tapSize: true, noHorizontalOverflow: true, preservedTimes: true, invalidInputBlocked: true, reloadWarningForDirtyOnly: true, lostResponseSamePayloadAndKey: true, reopened: true, changedJobRevisionRejected: true, deniedAfterAckHidesTextAndBlocksWork: true, inFlightOriginalDownloadCannotCreateUrlOrAnchorAfterDenial: true, structuredModeNoAudioWithoutExistingVoiceJob: true, conflictPreservesEdit: true, reviewedTxtSrt: true, legacyPreserved: true, balanceAndRevocation: true, revocationAtDownload: true, signoutDuringRead: true, exceptions };
  await writeFile(join(root, 'browser-result.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ root, ...evidence }));
} catch (error) {
  await writeFile(join(root, 'browser-failure.json'), JSON.stringify({ error: String(error), findings, requests }, null, 2)); throw error;
} finally {
  held?.(); heldSave?.(); heldResult?.(); ws?.close(); if (browser && browser.exitCode === null) { const exited = new Promise(resolve => browser.once('exit', resolve)); browser.kill(); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]); }
  await new Promise(resolve => server.close(resolve)); const safeRoot = resolve(root) + sep, safeProfile = resolve(profile);
  if (!safeProfile.startsWith(safeRoot) || !safeProfile.slice(safeRoot.length).startsWith('chrome-')) throw Error('Unsafe profile cleanup');
  await rm(safeProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
