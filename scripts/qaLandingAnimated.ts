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
const evidenceRoot = resolve(process.env.LOCALAPPDATA!, 'LinguistVision/validation/landing-active-audit-20261111');
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


  const raw=await readFile(resolve(process.env.LOCALAPPDATA!,'LinguistVision/design-import-v2-20261111/linguistvision-diseno/pantallas/Landing.dc.html'),'utf8');
  const source=raw.replaceAll('\r\n','\n');
  const style=source.match(/<style>([\s\S]*?)<\/style>/)![1];
  const template=source.slice(source.indexOf('<div>\n<header'),source.indexOf('</x-dc>')).replace(/<sc-for\b/g,'<template data-reference-for').replace(/<\/sc-for>/g,'</template>');
  const component=source.slice(source.indexOf('class Component extends DCLogic'),source.lastIndexOf('</script>'));
  const runtime=await readFile(resolve('scripts/fixtures/claudeReferenceRuntime.js'),'utf8');
  const js=runtime+'\n'+component+'\nwindow.referenceComponent=new Component({});renderReference(referenceComponent);referenceComponent.componentDidMount();';
  const fonts=[400,500,600,700].map(w=>`@font-face{font-family:Inter;font-style:normal;font-weight:${w};src:url('/demo/inter-${w}.ttf')}`).join('');
  const html='<!doctype html><html lang="es-419"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+fonts+style+'</style></head><body><template id="reference-template">'+template+'</template><div id="reference-root"></div><script src="/reference.js"></script></body></html>';
  const reference=createServer(async(req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'");
    const path=new URL(req.url||'/', 'http://127.0.0.1').pathname;
    if(path==='/reference.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(js);return;}
    if(/^\/demo\/(inter-(400|500|600|700)\.ttf|faq-ilustracion\.jpg)$/.test(path)){res.setHeader('Content-Type',path.endsWith('ttf')?'font/ttf':'image/jpeg');res.end(await readFile(resolve('server/pilot-site/assets',path.split('/').pop()!)));return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
  });
  await new Promise<void>(done=>reference.listen(0,'127.0.0.1',done));
  const refBase='http://127.0.0.1:'+(reference.address() as any).port;
  async function openPage(isRef:boolean,width:number){
    await dimensions(width);await call('Page.navigate',{url:isRef?refBase:base+'/es-419/subtitulos-video/'});
    await wait(isRef?'!!window.referenceComponent&&document.querySelectorAll(".tabs button").length===4':'document.querySelector("[data-hero-widget]")?.dataset.enhanced==="true"');await evaluate('document.fonts.ready');
    check(await evaluate('document.querySelectorAll("#idiomas tbody tr").length')===9,'Reference and production must render all nine language rows',{isRef});
  }
  const frames:any[]=[];
  const freeze=async(selector:string,time:number)=>{
    return evaluate(`(async()=>{const root=document.querySelector(${JSON.stringify(selector)}),animations=root.getAnimations({subtree:true});animations.forEach(a=>{a.pause();a.currentTime=${time}});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {count:animations.length,nodes:[...root.querySelectorAll('.zn,.ln,.bad,.fix,.act,.okk,.q,.ty')].filter(n=>!n.closest('[hidden]')).map(n=>({className:n.className,opacity:getComputedStyle(n).opacity,clip:getComputedStyle(n).clipPath,color:getComputedStyle(n).color,transform:getComputedStyle(n).transform}))}})()`);
  };
  try{
    const sectionSelectors=['header','.hx','section[aria-labelledby="ej"]','#como-funciona','section[aria-labelledby="usos"]','#idiomas','#precios','#preguntas','main>section:last-child','footer'];
    for(const width of [390,1280]){
      const results=[];
      for(const isRef of [true,false]){
        await openPage(isRef,width);
        results.push(await evaluate(`(()=>${JSON.stringify(sectionSelectors)}.map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),c=getComputedStyle(el);return {selector,x:r.x,y:r.y,width:r.width,height:r.height,background:c.backgroundColor,font:c.font}}))()`));
      }
      const diffs=results[1].map((r:any,i:number)=>({selector:r.selector,expected:results[0][i],actual:r,delta:Math.max(...['x','y','width','height'].map(k=>Math.abs(r[k]-results[0][i][k])))}));
      layouts.push({width,sections:diffs});check(diffs.every((r:any)=>r.delta<1),'Section layout differs from raw ZIP runtime',{width,differences:diffs.filter((r:any)=>r.delta>=1)});
    }
    if(process.env.LV_AUDIT_LAYOUT_ONLY!=='1'){
    for(const width of [390,1280])for(const kind of ['hero','how'])for(let index=0;index<(kind==='hero'?4:3);index++){
      const outputs:any[]=[];
      for(const isRef of [true,false]){
        await openPage(isRef,width);
        const widget=kind==='hero'?(isRef?'#reference-root>div>main>section:first-child>div:nth-child(2)':'[data-hero-widget]'):(isRef?'.hw':'[data-how-widget] .hw');
        if(kind==='hero')await click(isRef?'.tabs button:nth-child('+(index+1)+')':'[data-scene-target="'+index+'"]');
        else{
          await evaluate('document.getElementById("como-funciona").scrollIntoView({block:"center"})');
          await click(isRef?'#como-funciona>div:last-child button':'[data-how-widget] [data-motion-toggle]');
          await click(isRef?'.hs li:nth-child('+(index+1)+') button':'[data-step-target="'+index+'"]');
        }
        await evaluate('document.querySelector('+JSON.stringify(kind==='hero'?'.tabs':'.hw')+').scrollIntoView({block:"center"})');
        await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        const active=await evaluate('document.querySelector('+JSON.stringify(widget)+').getAnimations({subtree:true}).filter(a=>a.playState==="running").length');
        check(active>0,'Selected scene must start real animations',{isRef,width,kind,index,active,debug:await evaluate('({body:document.body.className,widget:document.querySelector("[data-how-widget]")?.outerHTML.slice(0,240),q:[...document.querySelectorAll(".hw .q")].filter(n=>!n.closest("[hidden]")).map(n=>({css:getComputedStyle(n).animationPlayState,name:getComputedStyle(n).animationName,animations:n.getAnimations().map(a=>({play:a.playState,time:a.currentTime}))}))})')});
        const series=[];
        for(const time of [0,500,1200,2500,5000]){
          const frame=await freeze(widget,time);series.push({time,...frame});
          if(time===1200||time===5000)await screenshot((isRef?'reference':'actual')+'-'+kind+'-'+width+'-'+index+'-'+time);
        }
        outputs.push(series);
      }
      // Compare CSS frames from the independent source runtime, not production fixtures.
      for(let frame=0;frame<5;frame++){
        const expected=outputs[0][frame].nodes,actual=outputs[1][frame].nodes;
        const normalize=(nodes:any[])=>nodes.map(({className,...rest})=>({className:className.replace(/\b(A|B|HA|HB)\b/g,'').trim(),...rest}));
        check(JSON.stringify(normalize(expected))===JSON.stringify(normalize(actual)),'Active animation frame differs from ZIP',{width,kind,index,time:outputs[0][frame].time,expected,actual});
      }
      frames.push({width,kind,index,outputs});
    }
    const faqStates=[];
    for(const isRef of [true,false]){
      await openPage(isRef,1280);const input=isRef?'#fq':'[data-faq-search]';
      await evaluate('const input=document.querySelector('+JSON.stringify(input)+');input.value="zz-no-match-qa";input.dispatchEvent(new Event("input",{bubbles:true}));input.form.requestSubmit();');
      const selector=isRef?'#preguntas .fqg>div>p':'[data-faq-empty]';
      faqStates.push(await evaluate('(()=>{const el=document.querySelector('+JSON.stringify(selector)+'),c=getComputedStyle(el),r=el.getBoundingClientRect();return{text:el.textContent,fontSize:c.fontSize,color:c.color,padding:c.padding,borderWidth:c.borderWidth,borderRadius:c.borderRadius,width:r.width,height:r.height}})()'));
    }
    check(JSON.stringify(faqStates[0])===JSON.stringify(faqStates[1]),'No-results FAQ layout/copy differs from ZIP',faqStates);
    layouts.push({faqStates});
    // Real elapsed time: clicking How preserves autoplay, and selecting Hero stops its rotation.
    await openPage(false,1280);await evaluate('document.getElementById("como-funciona").scrollIntoView({block:"center"})');await click('[data-step-target="0"]');
    const automatic=await sampleAnimation('[data-how-widget]',22000);check([0,1,2].every(i=>automatic.some(s=>s.selected===i&&s.motion==='running')),'How auto cycle after manual selection',automatic);
    await click('[data-how-widget] [data-motion-toggle]');
    check(await evaluate('document.querySelector("[data-how-widget]").dataset.motion')==='paused','How explicit pause');
    await evaluate('document.querySelector(".tabs").scrollIntoView({block:"start"})');await click('[data-scene-target="1"]');
    const before=await evaluate('document.querySelector("[data-hero-widget]").className');await click('[data-hero-widget] [data-motion-toggle]');const after=await evaluate('document.querySelector("[data-hero-widget]").className');check(before!==after,'Resume must restart A/B keyframes',{before,after});
    await openPage(false,1280);await click('[data-scene-target="0"]');await click('[data-hero-widget] [data-motion-toggle]');
    await evaluate('window.nativeNow=performance.now.bind(performance);Object.defineProperty(performance,"now",{configurable:true,value:()=>window.nativeNow()+15900});window.dispatchEvent(new PageTransitionEvent("pagehide"));window.dispatchEvent(new PageTransitionEvent("pageshow"));');
    const selectedAfterDelay=await evaluate('document.querySelector("[data-scene-target][aria-selected=true]").dataset.sceneTarget');await delay(350);
    check(await evaluate('document.querySelector("[data-scene-target][aria-selected=true]").dataset.sceneTarget')===selectedAfterDelay,'Delayed callback must give the next scene a full reading interval');
    await openPage(false,1280);
    // Search changes only on submit, matching fqd -> fq, and one result has singular copy.
    await evaluate('const s=document.querySelector("[data-faq-search]");s.value="certificada";s.dispatchEvent(new Event("input",{bubbles:true}));');
    check(await evaluate('document.querySelector("[data-faq-results]").hidden'),'Draft query must not apply before submit');await evaluate('document.querySelector("[data-faq-search]").form.requestSubmit()');
    check(await evaluate('document.querySelector("[data-faq-status]").textContent')==='1 pregunta encontrada','Singular results');
    await click('[data-faq-clear]');check(await evaluate('document.querySelector("[data-faq-results]").hidden'),'Clear search');
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait('document.querySelector("[data-hero-widget]").dataset.motion==="static"');
    check(await evaluate('[...document.querySelectorAll("[data-motion-toggle]")].every(b=>b.disabled)'),'Reduced motion stays static');
    check(browserErrors.length===0,'Browser exceptions',browserErrors);
    }
  }finally{await new Promise<void>(done=>reference.close(()=>done()));}
  await writeFile(join(evidence,'frames.json'),JSON.stringify(frames,null,2));
}catch(error){failures.push({message:'Animated audit interrupted',context:String(error)});}
finally{await writeFile(join(evidence,'acceptance.json'),JSON.stringify({failures,layouts,browserErrors},null,2));ws?.close();browser?.kill();await delay(500);if(profile)await rm(profile,{recursive:true,force:true}).catch(()=>{});await pilot?.close();await pool.end();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();}
console.log(JSON.stringify({evidence,failures:failures.length,first:failures.slice(0,1)}));if(failures.length)process.exitCode=1;
