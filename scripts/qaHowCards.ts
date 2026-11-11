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
const evidenceRoot = resolve(process.env.LOCALAPPDATA!, 'LinguistVision/validation/how-cards-20261111');
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


  const reference=createServer(async(req,res)=>{
    const path=req.url||'/';
    if(/^\/demo\/inter-(400|500|600|700)\.ttf$/.test(path)){res.setHeader('Content-Type','font/ttf');res.end(await readFile(resolve('server/pilot-site/assets',path.split('/').pop()!)));return;}
    const url=new URL(path,'http://127.0.0.1');const index=/^\/([012])$/.exec(url.pathname)?.[1]||'0';const offset=Number(url.searchParams.get('offset')||0);let referenceHtml=await readFile(resolve(process.env.LOCALAPPDATA!,'LinguistVision/design-import-v2-20261111/how-raw-reference-'+index+'.html'),'utf8');referenceHtml=referenceHtml.replace('</style>','body{padding-top:'+offset+'px}</style>');res.setHeader('Content-Type','text/html;charset=utf-8');res.end(referenceHtml);
  });
  await new Promise<void>(done=>reference.listen(0,'127.0.0.1',done));
  const refBase='http://127.0.0.1:'+(reference.address() as any).port;
  const cardShot=async(selector:string,name:string)=>{
    await evaluate('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center"})');
    const rect=await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()');
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:rect});await writeFile(join(evidence,name+'.png'),Buffer.from(shot.data,'base64'));return rect;
  };
  try {
    for(const width of [390,1280])for(let step=0;step<3;step++){
      await dimensions(width);await call('Page.navigate',{url:refBase+'/'+step});await wait('document.readyState==="complete"&&!!document.querySelector(".hcard")');await evaluate('document.fonts.ready');
      const ref=await cardShot('.hcard','reference-'+width+'-'+step);
      await navigate('/es-419/subtitulos-video/');
      await click('[data-how-widget] [data-motion-toggle]');
      await click('[data-step-target="'+step+'"]');
      await evaluate('[...document.querySelectorAll("[data-how-widget]")][0].getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=5000})');
      const actualSelector='[data-step-panel="'+step+'"] .hcard';
      const actual=await cardShot(actualSelector,'actual-'+width+'-'+step);
      const visibility=await evaluate('(()=>{const panel=document.querySelector('+JSON.stringify('[data-step-panel="'+step+'"]')+');return [...panel.querySelectorAll(".q,.ty")].map(el=>({text:el.textContent.trim(),opacity:getComputedStyle(el).opacity,clip:getComputedStyle(el).clipPath,animation:getComputedStyle(el).animationPlayState}))})()');
      check(visibility.every((v:any)=>Number(v.opacity)>0.99&&v.clip==='none'),'Manual selection freezes an incomplete How card',{width,step,visibility});
      check(Math.abs(ref.width-actual.width)<1&&Math.abs(ref.height-actual.height)<1,'Card dimensions differ',{width,step,ref,actual});
      // Align the independent card's document position so text lands on the same pixel grid.
      await call('Page.navigate',{url:refBase+'/'+step+'?offset='+(actual.y-ref.y)});await wait('document.readyState==="complete"&&!!document.querySelector(".hcard")');await evaluate('document.fonts.ready');
      const alignedReference=await cardShot('.hcard','reference-'+width+'-'+step);
      layouts.push({width,step,reference:alignedReference,actual,visibility});
    }
    await dimensions(1280);await navigate('/es-419/subtitulos-video/');
    await evaluate('document.getElementById("como-funciona").scrollIntoView({block:"center"})');
    const automatic=await sampleAnimation('[data-how-widget]',22000);
    check([0,1,2].every(step=>automatic.some(x=>x.selected===step&&x.motion==='running')),'Automatic cycle visits every How card',automatic);
    layouts.push({automatic});
    check(browserErrors.length===0,'Browser exceptions',browserErrors);
  }finally{await new Promise<void>(done=>reference.close(()=>done()));}
}catch(error){failures.push({message:'How QA interrupted',context:String(error)});}
finally{
 await writeFile(join(evidence,'acceptance.json'),JSON.stringify({failures,layouts},null,2));ws?.close();browser?.kill();await delay(400);if(profile)await rm(profile,{recursive:true,force:true}).catch(()=>{});await pilot?.close();await pool.end();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();
}
console.log(JSON.stringify({evidence,failures:failures.length,first:failures.slice(0,2)}));if(failures.length)process.exitCode=1;
