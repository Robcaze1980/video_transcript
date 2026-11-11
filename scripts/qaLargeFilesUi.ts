// Isolated browser acceptance: synthetic media, temporary account/schema, no Gemini or external payments.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { startPilot } from '../server/commercial/pilotHttp';
import { createSimulatedPayments } from '../server/commercial/pilotPayments';
import { PrivateFileStore } from '../server/commercial/privateFileStore';
import { ResumableUploads } from '../server/commercial/resumableUploads';
import { measureVideoSeconds } from '../server/commercial/pilotVideo';

const connectionString = process.env.LINGUISTVISION_TEST_DATABASE_URL;
if (!connectionString || new URL(connectionString).hostname !== '127.0.0.1' || new URL(connectionString).port !== '15438') throw Error('Dedicated local test database required.');
const evidenceRoot = resolve(process.env.LOCALAPPDATA!, 'LinguistVision/validation/large-files-ui-20261111');
await mkdir(evidenceRoot, { recursive: true });
const evidence = await mkdtemp(join(evidenceRoot, 'run-'));
const schema = 'lv_design_qa_' + randomUUID().replaceAll('-', '');
const admin = new Pool({ connectionString });
const pool = new Pool({ connectionString, options: '-c search_path=' + schema });
let pilot: Awaited<ReturnType<typeof startPilot>> | undefined;
let browser: ReturnType<typeof spawn> | undefined;
let ws: WebSocket | undefined;
let profile: string | undefined;
const results: unknown[] = [];
try {
  await admin.query('CREATE SCHEMA ' + schema);
  for (const script of ['schema.sql', 'pilotAttributionMigration.sql', 'accountAccess.sql', 'privateUploads.sql']) {
    await pool.query(await readFile(resolve('server/commercial', script), 'utf8'));
  }
  let code = '';
  pilot = await startPilot({ pool, port: 0, invitations: new Map(), payments: createSimulatedPayments(),
    uploads: new ResumableUploads(pool, new PrivateFileStore(join(evidence, 'private'))),
    editorAssets: new URL('../dist/pilot-editor/', import.meta.url),
    commercialPreview: { sendAccessCode: async message => { code = message.code; } },
    services: [{ adapter: { key: 'video-to-srt:design-qa', price: 1, validate() {}, measurePrice: measureVideoSeconds, validateFile() {}, async measureFilePrice(file) { return Math.ceil(file.metadata.duration); }, async executeFile() { return { result: Buffer.from('1\n00:00:00,500 --> 00:00:04,000\nPrueba de subtítulos.\n'), original: Buffer.from('1\n00:00:00,500 --> 00:00:04,000\nTest subtitles.\n') }; },
      async execute() { return { result: Buffer.from('1\n00:00:00,500 --> 00:00:04,000\nPrueba de subtítulos.\n'), original: Buffer.from('1\n00:00:00,500 --> 00:00:04,000\nTest subtitles.\n') }; } },
      label: 'Video', accepts: '.mp4,video/mp4', editableVideo: true, filename: 'result.srt', contentType: 'application/x-subrip',
      directions: [{ id: 'en-es', label: 'English → Spanish' }, { id: 'es-en', label: 'Spanish → English' }] }],
  });
  const base = pilot.origin;
  let cookie = '';
  const post = (path: string, body: URLSearchParams | string) => fetch(base + path, { method: 'POST', redirect: 'manual',
    headers: { origin: base, cookie, ...(typeof body === 'string' ? { 'content-type': 'application/json' } : {}) }, body });
  await post('/pilot/register/?lang=es', new URLSearchParams({ email: 'design-qa@example.test' }));
  const verified = await post('/pilot/register/?lang=es', new URLSearchParams({ email: 'design-qa@example.test', code }));
  assert.equal(verified.status, 303);
  cookie = verified.headers.get('set-cookie')!.split(';')[0];
  const order = await (await post('/pilot/api/checkout', '{"packageId":"10-min"}')).json();
  await post('/pilot/api/checkout/' + order.id + '/simulate', '{}');
  let balance;
  for (let i = 0; i < 40; i++) {
    balance = await (await fetch(base + '/pilot/api/account', { headers: { cookie } })).json();
    if (balance.balance.available === 600) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(balance.balance.available, 600);
  profile = await mkdtemp(join(evidence, 'chrome-'));
  browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port = '';
  for (let i = 0; i < 70; i++) { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  assert.ok(port);
  const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws!.addEventListener('open', r, { once: true }));
  let sequence = 0;
  const pending = new Map<number, (value: any) => void>();
  const errors: string[] = [];
  const downloads: any[] = [];
  let acceptDialog = false;
  let dialogCount = 0;
  ws.onmessage = event => { const message = JSON.parse(String(event.data));
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ': ' + message.params.exceptionDetails.exception?.description);
    if (message.method === 'Browser.downloadProgress') downloads.push(message.params);
    if (message.method === 'Page.javascriptDialogOpening') { dialogCount++; ws!.send(JSON.stringify({id:++sequence,method:'Page.handleJavaScriptDialog',params:{accept:acceptDialog}})); }
  };
  const call = (method: string, params = {}) => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, result => result.error ? reject(Error(JSON.stringify(result.error))) : resolve(result.result));
    ws!.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression: string) => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  const wait = async (expression: string, attempts = 100) => {
    for (let i = 0; i < attempts; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); }
    throw Error('Timed out: ' + expression + '\n' + await evaluate('document.body.innerText.slice(-1800)'));
  };
  const click = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const screenshot = async (name: string) => { const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(evidence, name + '.png'), Buffer.from(shot.data, 'base64')); };
  const dimensions = (width: number) => call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
  const navigate = async (path: string) => { await call('Page.navigate', { url: base + path }); await wait('document.readyState === "complete" && location.pathname + location.search === ' + JSON.stringify(new URL(base + path).pathname + new URL(base + path).search)); };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: "window.qaCsp=[];document.addEventListener('securitypolicyviolation',e=>window.qaCsp.push(e.effectiveDirective));" });
  await call('Network.setCookie', { name: cookie.split('=')[0], value: cookie.split('=')[1], url: base + '/pilot/', path: '/pilot/', httpOnly: true, sameSite: 'Lax' });
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: evidence, eventsEnabled: true });
  const sitemap = await (await fetch(base + '/sitemap.xml')).text();
  const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => new URL(match[1]).pathname);
  assert.equal(pages.length, 10);
  for (const path of pages) {
    for (const width of [320,390,768,1280]) {
      await dimensions(width); await navigate(path);
      const metric = await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,csp:window.qaCsp,background:getComputedStyle(document.body).backgroundColor})');
      results.push({page:path,width,...metric});
      assert.ok(metric.scroll <= metric.width, JSON.stringify({path,...metric}));
      assert.deepEqual(metric.csp, []); assert.equal(metric.background, 'rgb(255, 255, 255)');
      if(path.includes('/es-419/') && [390,1280].includes(width)) await screenshot('landing-es-' + width);
    }
  }
  await dimensions(1280);
  await navigate('/pilot/?lang=es');
  await wait('document.querySelector("#home-balance").textContent === "10:00"');
  await screenshot('panel-es-desktop');
  await click('.workspace-nav [data-view="balance"]');
  await evaluate(`window.qaFetch=window.fetch;window.fetch=(path,...args)=>String(path).endsWith('api/account')?Promise.resolve(new Response('{"error":"Unavailable"}',{status:503,headers:{'Content-Type':'application/json'}})):window.qaFetch(path,...args)`);
  await click('#refresh');
  await wait('document.querySelector("#home-balance").textContent === "No disponible"');
  await evaluate("document.querySelector('#interface-language').value='ar';document.querySelector('#interface-language').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelector('#home-balance').textContent"), 'غير متاح');
  assert.equal(await evaluate("document.querySelector('#checkout').disabled"), true);
  await evaluate("window.fetch=window.qaFetch;document.querySelector('#interface-language').value='es';document.querySelector('#interface-language').dispatchEvent(new Event('change'))");
  await click('#refresh'); await wait('document.querySelector("#home-balance").textContent === "10:00"');

  const views = ['home','projects','balance','account','create','import'];
  for (const language of ['es','en','ar','pt','fr','de','ja','ko','cmn','vi']) {
    await evaluate(`document.querySelector('#interface-language').value=${JSON.stringify(language)};document.querySelector('#interface-language').dispatchEvent(new Event('change'))`);
    for (const width of [320,390,768,1280]) {
      await dimensions(width);
      for (const view of views) {
        await click('.workspace-nav [data-view="' + (view === 'import' ? 'projects' : view === 'create' ? 'home' : view) + '"]');
        if (view === 'create' || view === 'import') await click((view === 'import' ? '#projects' : '#home-panel') + ' [data-view="' + view + '"]');
        const metric = await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,csp:window.qaCsp})');
        results.push({ language, width, view, ...metric });
        assert.ok(metric.scroll <= metric.width, JSON.stringify({ language, width, view, ...metric }));
        assert.deepEqual(metric.csp, []);
      }
    }
  }
  await dimensions(320);
  await evaluate("document.documentElement.style.fontSize='200%'");
  for (const language of ['es','en','ar','pt','fr','de','ja','ko','cmn','vi']) {
    await evaluate(`document.querySelector('#interface-language').value=${JSON.stringify(language)};document.querySelector('#interface-language').dispatchEvent(new Event('change'))`);
    for (const view of ['home','projects','balance','account']) {
      await click('.workspace-nav [data-view="' + view + '"]');
      const metric = await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
      assert.ok(metric.scroll <= metric.width, JSON.stringify({ language, view, textScale: 200, ...metric }));
    }
  }
  await evaluate("document.documentElement.style.fontSize=''");
  await dimensions(390); await navigate('/pilot/?lang=es'); await wait('document.querySelector("#home-balance").textContent === "10:00"');
  await screenshot('panel-es-mobile');
  await click('#home-panel [data-view="import"]');
  const translated = join(evidence, 'prueba-es.srt'); const original = join(evidence, 'prueba-en.srt');
  await writeFile(translated, '1\n00:00:00,500 --> 00:00:04,000\nMantengan el paso libre.\n');
  await writeFile(original, '1\n00:00:00,500 --> 00:00:04,000\nKeep the walkway clear.\n');
  const setFile = async (selector: string, files: string[]) => {
    const root = await call('DOM.getDocument'); const node = await call('DOM.querySelector', { nodeId: root.root.nodeId, selector });
    await call('DOM.setFileInputFiles', { nodeId: node.nodeId, files });
  };
  await setFile('#project-video', [resolve('server/pilot-site/assets/jobsite.mp4')]);
  await setFile('#project-srt', [translated]); await setFile('#project-original-srt', [original]);
  await click('#project-import button[type=submit]');
  await wait('!!document.querySelector("#project-editor .subtitle-matches button")');
  await click('#project-editor .subtitle-matches button');
  await evaluate(`const input=document.querySelector('#subtitle-correction');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'Mantengan libre el paso.');input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await wait('document.querySelector(".subtitle-matches").textContent.includes("Mantengan libre el paso.")');
  await evaluate(`document.querySelector('.editor-save-bar button').click()`);
  await wait('document.querySelector(".editor-save-bar button").disabled');
  await screenshot('editor-es-mobile');
  await click('#project-review [data-view="projects"]');
  await wait('!!document.querySelector("#project-list button")'); await click('#project-list button');
  await wait('!!document.querySelector("#project-editor .subtitle-matches button")');
  assert.ok(await evaluate('document.querySelector(".subtitle-matches").textContent.includes("Mantengan libre el paso.")'));
  await click('.subtitle-matches button');
  await evaluate(`Array.from(document.querySelectorAll('.pilot-editor button')).find(b=>b.textContent==='Descargar SRT editado').click()`);
  await wait(`fetch('/pilot/api/account').then(r=>r.json()).then(x=>x.balance.available===600)`);
  for (let i=0;i<50 && !downloads.some(x=>x.state==='completed');i++) await new Promise(r=>setTimeout(r,100));
  assert.ok((await readFile(join(evidence, 'linguistvision.srt'), 'utf8')).includes('Mantengan libre el paso.'));
  await evaluate(`Array.from(document.querySelectorAll('.pilot-editor button')).find(b=>b.textContent==='Descargar MP4').click()`);
  await wait('document.querySelector(".pilot-editor").textContent.includes("MP4 listo")', 1200);
  for (let i=0;i<50;i++) { try { assert.ok((await readFile(join(evidence,'linguistvision.mp4'))).length>1000); break; } catch { if(i===49)throw Error('MP4 not downloaded');await new Promise(r=>setTimeout(r,100)); } }
  await click('#project-review [data-view="projects"]');
  await click('.workspace-nav [data-view="home"]');
  await click('#home-panel [data-view="create"]');
  await setFile('#file', [resolve('server/pilot-site/assets/jobsite.mp4')]);
  await click('#wizard-next');
  await wait('!document.querySelector("#create-language-step").hidden');
  await evaluate("document.querySelector('#launch-source').value='es';document.querySelector('#launch-source').dispatchEvent(new Event('change'));document.querySelector('#launch-target').value='en';document.querySelector('#launch-target').dispatchEvent(new Event('change'))");
  await evaluate("document.querySelector('#interface-language').value='ar';document.querySelector('#interface-language').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelector('#launch-source').value + '-' + document.querySelector('#launch-target').value"), 'es-en');
  await evaluate("document.querySelector('#launch-target').value='vi';document.querySelector('#launch-target').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelector('#submit-job').disabled"), true);
  await evaluate("document.querySelector('#launch-target').value='en';document.querySelector('#launch-target').dispatchEvent(new Event('change'));document.querySelector('#interface-language').value='es';document.querySelector('#interface-language').dispatchEvent(new Event('change'))");
  await click('#wizard-next');
  await wait('!document.querySelector("#create-summary-step").hidden');
  await screenshot('create-review-es-mobile');
  await evaluate(`window.qaFetch=window.fetch;window.qaFailAccount=1;window.qaFailHistory=1;window.fetch=(path,...args)=>{
    if(String(path).endsWith('api/account') && window.qaFailAccount-- > 0) return Promise.resolve(new Response('{"error":"Unavailable"}',{status:503,headers:{'Content-Type':'application/json'}}));
    if(String(path).endsWith('api/jobs') && !args[0]?.method && window.qaFailHistory-- > 0) return Promise.resolve(new Response('{"error":"Unavailable"}',{status:503,headers:{'Content-Type':'application/json'}}));
    return window.qaFetch(path,...args);
  }`);
  await click('#submit-job');
  await wait('!document.querySelector("#download").hidden');
  await wait('document.querySelector("#projects-empty").textContent === "No disponible"');
  await evaluate("document.querySelector('#interface-language').value='ar';document.querySelector('#interface-language').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelector('#projects-empty').textContent"), 'غير متاح');
  await evaluate("window.fetch=window.qaFetch;document.querySelector('#interface-language').value='es';document.querySelector('#interface-language').dispatchEvent(new Event('change'))");
  const processedBalance = await evaluate("fetch('/pilot/api/account').then(r=>r.json()).then(x=>x.balance.available)");
  assert.ok(processedBalance < 600 && processedBalance >= 570);
  await click('#edit');
  await wait('!!document.querySelector("#editor .subtitle-matches button")');
  await click('#editor .subtitle-matches button');
  await evaluate(`const correction=document.querySelector('#subtitle-correction');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(correction,'Corrección sin guardar.');correction.dispatchEvent(new Event('input',{bubbles:true}));`);
  await wait('document.querySelector("#editor .subtitle-matches").textContent.includes("Corrección sin guardar.")');
  await click('.workspace-nav [data-view="balance"]');
  assert.equal(await evaluate('document.querySelector("#workspace").dataset.view'), 'editor');
  assert.ok(dialogCount > 0);
  acceptDialog = true;
  await click('.workspace-nav [data-view="balance"]');
  assert.equal(await evaluate('document.querySelector("#workspace").dataset.view'), 'balance');
  await screenshot('balance-es-mobile');
  // UI wiring only. External OAuth/Drive calls are separately unit-tested, not faked as a real cloud save.
  await evaluate(`(async()=>{
    const projects=await fetch('/pilot/api/projects').then(r=>r.json());
    const id=projects[0].id;window.qaDriveProject=id;
    const target=document.createElement('div');target.id='qa-drive-editor';document.querySelector('main').prepend(target);
    const {mountEditor}=await import('/pilot/editor-assets/editor.js');
    const {pilotLocale}=await import('/pilot/pilotLocales.js');
    window.qaDriveCalls=[];window.qaAuthorizations=0;
    window.qaDriveEditor=mountEditor(target,'/pilot/api/projects/'+id+'/source','/pilot/api/projects/'+id,pilotLocale('es'),async(_draft,revision)=>({revision:revision+1}),undefined,undefined,false,{
      authorize:async()=>{window.qaAuthorizations++},
      save:async(blob,name,key,signal,progress)=>{signal.throwIfAborted();progress(1);window.qaDriveCalls.push({size:blob.size,name,key});return{webViewLink:'https://drive.google.com/file/d/qa/view'}},clear:()=>{}
    });
  })()`);
  await wait('Array.from(document.querySelectorAll("#qa-drive-editor button")).some(b=>b.textContent==="Guardar SRT en Drive")');
  await evaluate(`Array.from(document.querySelectorAll('#qa-drive-editor button')).find(b=>b.textContent==='Guardar SRT en Drive').click()`);
  await wait('window.qaDriveCalls.length===1');
  assert.ok(await evaluate('window.qaDriveCalls[0].size>0 && window.qaDriveCalls[0].name.endsWith(".srt")'));
  await evaluate(`Array.from(document.querySelectorAll('#qa-drive-editor button')).find(b=>b.textContent==='Guardar MP4 en Drive').click()`);
  await wait('window.qaDriveCalls.length===2',1200);
  assert.ok(await evaluate('window.qaDriveCalls[1].size>1000 && window.qaDriveCalls[1].name.endsWith(".mp4") && window.qaAuthorizations===2'));
  await screenshot('drive-buttons-and-confirmation');
  await evaluate(`(async()=>{
    window.qaDriveEditor.unmount();
    window.qaProfileFetch=window.fetch;
    window.fetch=(url,init)=>init?.headers?.Range==='bytes=0-0'
      ? Promise.resolve(new Response(new Uint8Array([0]),{status:206,headers:{'Content-Range':'bytes 0-0/2000000'}}))
      : window.qaProfileFetch(url,init);
    const {mountEditor}=await import('/pilot/editor-assets/editor.js');
    const {pilotLocale}=await import('/pilot/pilotLocales.js');
    const id=window.qaDriveProject;
    window.qaDriveEditor=mountEditor(document.querySelector('#qa-drive-editor'),'/pilot/api/projects/'+id+'/source','/pilot/api/projects/'+id,pilotLocale('es'),async(_draft,revision)=>({revision:revision+1}),undefined,undefined,false,{
      authorize:async()=>{},save:async()=>({webViewLink:'https://drive.google.com/file/d/qa/view'}),clear:()=>{}
    });
  })()`);
  await wait('document.querySelector("#qa-drive-editor").textContent.includes("exportación MP4 de videos grandes")');
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('#qa-drive-editor button')).find(b=>b.textContent==='Guardar MP4 en Drive').disabled`));
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('#qa-drive-editor button')).find(b=>b.textContent==='Guardar SRT en Drive').disabled`), false);
  await screenshot('large-mp4-profile-pending');
  await evaluate('window.qaDriveEditor.unmount();document.querySelector("#qa-drive-editor").remove();window.fetch=window.qaProfileFetch');
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'acceptance.json'), JSON.stringify({ layouts: results, errors, largeMp4BlockedUntilValidated: true, largeUploadRoute: true, driveUiWithInjectedSave: true, realDriveAuthorization: false, syntheticImportSaveReopenSrtMp4: true, balanceAfterImport: 600, processedBalance, text200NoOverflow: true, pendingDirectionBlocked: true, localePreservesDirection: true, failedBalanceNotRevivedByLocale: true, failedHistoryNotRevivedByLocale: true, pollingSurvivesBalanceFailure: true, unsavedResultGuard: true }, null, 2));
  console.log(JSON.stringify({ layouts: results.length, errors, importSaveReopenSrtMp4: true, evidence }));
} finally {
  ws?.close(); browser?.kill();
  await new Promise(r=>setTimeout(r,500));
  if(profile) { if(!resolve(profile).startsWith(resolve(evidence)+sep)) throw new Error('Unexpected browser profile path.'); await rm(profile, { recursive:true, force:true }).catch(()=>{}); }
  await pilot?.close(); await pool.end();
  await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end();
}
