// Historical adapted static fixture only. Current independent reference: qaLandingAnimated.ts.
// Commercial-page acceptance in an isolated schema. No account, payment, or Gemini calls.
import { createServer } from 'node:http';
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
const evidenceRoot = resolve(process.env.LOCALAPPDATA!, 'LinguistVision/validation/header-fidelity-20261111');
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

  const source = await readFile(resolve(process.env.LOCALAPPDATA!, 'LinguistVision/design-import-v2-20261111/linguistvision-diseno/pantallas/Landing.dc.html'), 'utf8');
  const style = source.match(/<style>([\s\S]*?)<\/style>/)![1];
  const header = source.slice(source.indexOf('<header style='), source.indexOf('\n<main>'));
  const heroStart = source.indexOf('<div class="hx">');
  const heroEnd = source.indexOf('<p class="s m">Desde US$1', heroStart);
  const hero = source.slice(heroStart, source.indexOf('</div>', heroEnd) + 6);
  const fonts = [400,500,600,700].map(weight => `@font-face{font-family:Inter;font-style:normal;font-weight:${weight};src:url('/inter-${weight}.ttf') format('truetype')}`).join('');
  let referenceHtml = '<!doctype html><html lang="es-419"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+fonts+style+'body{min-height:2000px}</style></head><body>'+header+'<main><section class="w">'+hero+'</section></main></body></html>';
  const reference = createServer(async(req,res) => {
    if (req.url === '/demo/faq-ilustracion.jpg') {res.setHeader('Content-Type','image/jpeg');res.end(await readFile(resolve('server/pilot-site/assets/faq-ilustracion.jpg')));}
    else if (/^\/inter-(400|500|600|700)\.ttf$/.test(req.url || '')) {
      res.setHeader('Content-Type','font/ttf'); res.end(await readFile(resolve('server/pilot-site/assets', req.url!.slice(1))));
    } else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(referenceHtml);}
  });
  await new Promise<void>(done => reference.listen(0,'127.0.0.1',done));
  try {
    const referenceOrigin = 'http://127.0.0.1:'+(reference.address() as any).port;
    const metrics = (selectors:string[]) => evaluate(`(()=>{return ${JSON.stringify(selectors)}.map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),c=getComputedStyle(el);return {x:r.x,y:r.y,width:r.width,height:r.height,font:c.font,fontFamily:c.fontFamily,color:c.color,gap:c.gap,padding:c.padding,margin:c.margin}})})()`);
    for(const width of [1120,1440]) {
      await dimensions(width);
      await call('Page.navigate',{url:referenceOrigin});
      await wait('document.readyState === "complete" && !!document.querySelector(".hx")');await evaluate('document.fonts.ready');
      const expected=await metrics(['header','header .w','header .w>a','header nav','header select','header .b2','.hx','.hx h1','.hx>p','.hx>div','.hx .b','.hx .b2','.hx>.s']);
      await screenshot('reference-'+width);
      await navigate('/es-419/subtitulos-video/');
      const actual=await metrics(['header','header .w','header .w>a','header nav','header select','header .b2','.hx','.hx h1','.hx>p','.hx>div','.hx .b','.hx .b2','.hx>.s']);
      const differences=actual.map((value:any,index:number)=>({index,expected:expected[index],actual:value,max:Math.max(...['x','y','width','height'].map(key=>Math.abs(value[key]-expected[index][key])))}));
      layouts.push({width,differences});
      check(differences.every((x:any)=>x.max<1.1),'Header/hero geometry differs from supplied design',{width,differences:differences.filter((x:any)=>x.max>=1.1)});
      await screenshot('implemented-'+width);
    }
    let fullBody=await readFile(resolve(process.env.LOCALAPPDATA!,'LinguistVision/design-import-v2-20261111/reference-full.html'),'utf8');
    fullBody=fullBody.replace('class="fcat"','class="fcat on"');
    referenceHtml='<!doctype html><html lang="es-419"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+fonts+style+'[hidden]{display:none!important}.canonical-step-panel{display:contents}.canonical-step-panel>.hcard{position:relative}</style></head><body>'+fullBody+'</body></html>';
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    for(const width of [390,1120,1440]) {
      await dimensions(width);await call('Page.navigate',{url:referenceOrigin});await wait('document.readyState==="complete"&&!!document.getElementById("ej")');await evaluate('document.fonts.ready');
      const selectors=['header','.hx','#ej','#como-funciona','.hs','.hst','.hcard','#usos','#idiomas','#precios','#preguntas','.fqh','.fqg','footer'];
      const expected=await metrics(selectors);await screenshot('reference-full-'+width);
      const refShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:await evaluate('document.documentElement.scrollHeight'),scale:1}});await writeFile(join(evidence,'reference-entire-'+width+'.png'),Buffer.from(refShot.data,'base64'));
      await navigate('/es-419/subtitulos-video/');const actual=await metrics(selectors);
      const differences=actual.map((value:any,index:number)=>({selector:selectors[index],expected:expected[index],actual:value,max:Math.max(...['x','y','width','height'].map(key=>Math.abs(value[key]-expected[index][key])))}));
      layouts.push({width,full:true,differences});check(differences.every((x:any)=>x.max<1.1),'Full-page geometry differs from supplied design',{width,differences:differences.filter((x:any)=>x.max>=1.1)});
      const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:await evaluate('document.documentElement.scrollHeight'),scale:1}});await writeFile(join(evidence,'implemented-full-'+width+'.png'),Buffer.from(shot.data,'base64'));
    }
  } finally {await new Promise<void>(done=>reference.close(()=>done()));}
} catch(error) { failures.push({message:'Visual comparison failed',context:String(error)}); }
finally {
 await writeFile(join(evidence,'acceptance.json'),JSON.stringify({failures,layouts},null,2));ws?.close();browser?.kill();await delay(500);
 if(profile) await rm(profile,{recursive:true,force:true}).catch(()=>{});
 await pilot?.close();await pool.end();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();
}
console.log(JSON.stringify({evidence,failures:failures.length}));if(failures.length)process.exitCode=1;
