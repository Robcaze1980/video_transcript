// Commercial-page acceptance in an isolated schema. No account, payment, or Gemini calls.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { startPilot } from '../server/commercial/pilotHttp';
import { createSimulatedPayments } from '../server/commercial/pilotPayments';

const connectionString = process.env.LINGUISTVISION_TEST_DATABASE_URL;
if (!connectionString || new URL(connectionString).hostname !== '127.0.0.1' ||
    new URL(connectionString).port !== '15438') throw Error('Dedicated local test database required.');
const evidenceRoot = resolve(process.env.LOCALAPPDATA!, 'LinguistVision/validation/claude-exact-20261111');
await mkdir(evidenceRoot, { recursive: true });
const evidence = await mkdtemp(join(evidenceRoot, 'run-'));
const schema = 'lv_commercial_v2_' + randomUUID().replaceAll('-', '');
const admin = new Pool({ connectionString });
const pool = new Pool({ connectionString, options: '-c search_path=' + schema });
let pilot: Awaited<ReturnType<typeof startPilot>> | undefined;
let browser: ReturnType<typeof spawn> | undefined;
let ws: WebSocket | undefined;
let profile: string | undefined;
const failures: { message: string; context?: unknown }[] = [];
const layouts: unknown[] = [];
const interactions: unknown[] = [];
const heights: unknown[] = [];
const browserErrors: unknown[] = [];
const check = (valid: unknown, message: string, context?: unknown) => {
  if (!valid) failures.push({ message, context });
};
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

try {
  await admin.query('CREATE SCHEMA ' + schema);
  for (const script of ['schema.sql', 'pilotAttributionMigration.sql', 'accountAccess.sql']) {
    await pool.query(await readFile(resolve('server/commercial', script), 'utf8'));
  }
  pilot = await startPilot({
    pool, port: 0, invitations: new Map(), payments: createSimulatedPayments(), services: [],
    editorAssets: new URL('../dist/pilot-editor/', import.meta.url),
    commercialPreview: { sendAccessCode: async () => { throw Error('This test does not request access codes.'); } },
  });
  const base = pilot.origin;
  profile = await mkdtemp(join(evidence, 'chrome-'));
  browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let port = '';
  for (let attempt = 0; attempt < 70; attempt++) {
    try {
      port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      break;
    } catch { await delay(100); }
  }
  assert.ok(port, 'Chrome debugging port');
  const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws!.addEventListener('open', resolve, { once: true }));
  let sequence = 0;
  const pending = new Map<number, (value: any) => void>();
  ws.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
  };
  const call = (method: string, params = {}) => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, 10_000);
    pending.set(id, response => {
      clearTimeout(timer);
      response.error ? reject(Error(JSON.stringify(response.error))) : resolve(response.result);
    });
    ws!.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression: string) => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  const wait = async (expression: string, attempts = 100) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw Error('Timed out waiting for ' + expression);
  };
  const click = (selector: string) => evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const screenshot = async (name: string) => {
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(evidence, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  const dimensions = (width: number) => call('Emulation.setDeviceMetricsOverride', {
    width, height: 1000, deviceScaleFactor: 1, mobile: width < 500,
  });
  const navigate = async (path: string) => {
    await call('Page.navigate', { url: base + path });
    await wait('document.readyState === "complete" && location.pathname === ' + JSON.stringify(path));
    await wait('document.querySelector("[data-hero-widget]")?.dataset.enhanced === "true" && document.querySelector("[data-faq-widget]")?.dataset.enhanced === "true"');
    await evaluate('document.fonts.ready');
  };
  let reportedOverflow = false;
  const setSearch = async (value: string) => {
    await evaluate('document.querySelector("[data-faq-search]").value=' + JSON.stringify(value) +
      ';document.querySelector("[data-faq-search]").dispatchEvent(new Event("input",{bubbles:true}))');
  };
  const sampleAnimation = async (selector: string, milliseconds: number) => {
    const samples: unknown[] = [];
    const end = Date.now() + milliseconds;
    while (Date.now() < end) {
      samples.push(await evaluate('(()=>{const w=document.querySelector(' + JSON.stringify(selector) + ');return {phase:w.dataset.phase,motion:w.dataset.motion,selected:[...w.querySelectorAll("button[aria-selected],button[data-step-target]")].findIndex(t=>t.getAttribute("aria-selected")==="true"||t.getAttribute("aria-pressed")==="true")}})()'));
      await delay(80);
    }
    return samples as { phase: string; motion: string; selected: number }[];
  };

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.qaCsp=[];document.addEventListener("securitypolicyviolation",e=>window.qaCsp.push({directive:e.effectiveDirective,blocked:e.blockedURI}));' });

  const spanish='/es-419/subtitulos-video/';
  const sitemap=await(await fetch(base+'/sitemap.xml')).text();
  const pages=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x=>new URL(x[1]).pathname);
  for(const path of pages) for(const width of [320,390,768,1120,1440]) {
    await dimensions(width);await navigate(path);
    const m=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,csp:window.qaCsp,body:document.body.className})');
    check(m.width<=width&&m.scroll<=width,'Overflow',{path,width,...m});check(m.csp.length===0,'CSP',m);layouts.push({path,width,...m});
  }
  await dimensions(1120);await navigate(spanish);
  const html=await(await fetch(base+spanish)).text();
  check(!html.includes('{{')&&!html.includes('<sc-')&&!html.includes('onClick=')&&!html.includes(' style="'),'No design runtime or inline styles left');
  check((html.match(/data-faq-category=/g)||[]).length===17,'All17 FAQ in HTML');
  for(const text of ['El inspector explica en español. El propietario necesita entenderlo en inglés.','Qué hace en LinguistVision','Un ejemplo: inspección de techos','Busca una frase y salta a ese momento del video.','Otros usos','Taller','Editor o agencia','Sube un video corto y revisa tus primeros subtítulos.']) check(html.includes(text),'Exact supplied copy',{text});
  check(!/[ÃÂ]/.test(html),'No mojibake');
  await click('[data-scene-target="0"]');await delay(500);await screenshot('hero-desktop');
  for(const [id,name] of [['ej','example'],['como-funciona','how'],['usos','uses'],['idiomas','languages'],['precios','pricing'],['preguntas','faq']]) {
    await evaluate('document.getElementById('+JSON.stringify(id)+').scrollIntoView({block:"start"})');await delay(500);await screenshot(name+'-desktop');
  }
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await wait('document.querySelector("[data-how-widget]").dataset.motion==="static"');
  for(let index=0;index<3;index++) {
    await click('[data-step-target="'+index+'"]');
    check(await evaluate('[...document.querySelectorAll("[data-step-panel]")].filter(x=>!x.hidden).length')===1,'Exactly one How panel',{index});
    await evaluate('document.getElementById("como-funciona").scrollIntoView({block:"start"})');await screenshot('how-step-'+index);
  }
  for(let index=0;index<4;index++) {
    await click('[data-scene-target="'+index+'"]');
    check(await evaluate('[...document.querySelectorAll("[data-scene-panel]")].filter(x=>!x.hidden).length')===1,'Exactly one hero scene',{index});
  }
  await setSearch('subtítulos');await evaluate('document.querySelector("[data-faq-search]").form.requestSubmit()');check(await evaluate('[...document.querySelectorAll("details[data-faq-category]")].some(x=>!x.hidden)'),'FAQ source content searchable');
  await click('[data-faq-clear]');await dimensions(390);await navigate(spanish);await screenshot('hero-mobile');
  await evaluate('document.getElementById("ej").scrollIntoView({block:"start"})');await screenshot('example-mobile');
  await evaluate('document.getElementById("como-funciona").scrollIntoView({block:"start"})');await screenshot('how-mobile');
  await call('Emulation.setScriptExecutionDisabled',{value:true});await call('Page.reload');await wait('document.readyState==="complete"');
  check(await evaluate('document.querySelectorAll("details[data-faq-category]").length')===17,'No JS all17 questions');
  check(await evaluate('document.querySelectorAll("[data-scene-panel]").length')===4,'No JS all scenes');
  await call('Emulation.setScriptExecutionDisabled',{value:false});
  check(browserErrors.length===0,'Browser errors',browserErrors);
} catch(error) {failures.push({message:'QA interrupted',context:String(error)});}
finally {
 await writeFile(join(evidence,'acceptance.json'),JSON.stringify({failures,layouts,browserErrors},null,2));ws?.close();browser?.kill();await delay(500);
 if(profile) await rm(profile,{recursive:true,force:true}).catch(()=>{});
 await pilot?.close();await pool.end();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();
}
console.log(JSON.stringify({evidence,failures:failures.length,first:failures.slice(0,3)}));if(failures.length)process.exitCode=1;
