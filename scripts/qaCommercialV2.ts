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
const evidenceRoot = resolve(process.env.LOCALAPPDATA!, 'LinguistVision/validation/commercial-v2-20261111');
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
  const sitemap = await (await fetch(base + '/sitemap.xml')).text();
  const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => new URL(match[1]).pathname);
  assert.equal(pages.length, 10);
  for (const path of pages) {
    const response = await fetch(base + path);
    const html = await response.text();
    const csp = response.headers.get('content-security-policy') || '';
    check(response.status === 200, 'Landing response', { path, status: response.status });
    check((html.match(/<details data-faq-category=/g) || []).length === 17, 'Seventeen FAQ answers in server HTML', { path });
    check((html.match(/class="offer-price"/g) || []).length === 3, 'Three prices in server HTML', { path });
    check((html.match(/data-scene-target=/g) || []).length === 4, 'Four hero tabs in server HTML', { path });
    check(!csp.includes("'unsafe-inline'") && csp.includes('script-src'), 'CSP blocks unsafe inline scripts', { path, csp });
    check(html.includes('content="noindex"'), 'Preview remains noindex', { path });
    for (const textScale of [100, 200]) {
      for (const width of [320, 390, 768, 1280]) {
        await dimensions(width);
        await navigate(path);
        if (textScale === 200) await evaluate('document.documentElement.style.fontSize="200%"');
        const metric = await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,csp:window.qaCsp,background:getComputedStyle(document.body).backgroundColor})');
        layouts.push({ path, requestedWidth: width, textScale, ...metric });
        const overflow = metric.scroll > width || metric.width > width;
        check(!overflow, 'Horizontal overflow', { path, requestedWidth: width, textScale, ...metric });
        if (overflow && !reportedOverflow) {
          const offenders = await evaluate('Array.from(document.querySelectorAll("body *")).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>' + width + '+.5||r.left<-.5)}).slice(0,20).map(e=>({tag:e.tagName,class:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width}))');
          console.log(JSON.stringify({ firstOverflow: { path, requestedWidth: width, textScale, ...metric }, offenders }));
          reportedOverflow = true;
        }
        check(metric.csp.length === 0, 'CSP violation', { path, width, textScale, csp: metric.csp });
        const sceneSizes: number[] = [];
        for (let scene = 0; scene < 4; scene++) {
          await click('[data-scene-target="' + scene + '"]');
          const state = await evaluate('(()=>{const w=document.querySelector("[data-hero-widget]");return {motion:w.dataset.motion,phase:w.dataset.phase,visible:[...w.querySelectorAll("[data-scene-panel]")].filter(p=>!p.hidden).map(p=>p.dataset.scenePanel),height:document.querySelector(".hero-storyboard").getBoundingClientRect().height,scroll:document.documentElement.scrollWidth}})()');
          check(state.motion === 'paused' && state.phase === 'result' && state.visible.join() === String(scene), 'Manual scene selects a complete paused frame', { path, width, textScale, scene, state });
          check(state.scroll <= width, 'Overflow after scene change', { path, width, textScale, scene, scroll: state.scroll });
          sceneSizes.push(state.height);
        }
        const variation = Math.max(...sceneSizes) - Math.min(...sceneSizes);
        heights.push({ path, width, textScale, widget: 'hero', values: sceneSizes, variation });
        check(variation <= 2, 'Hero height varies across scenes', { path, width, textScale, values: sceneSizes, variation });
        if (textScale === 100 && ((path.includes('/es-419/') && [390, 1280].includes(width)) ||
            (path.includes('/ar/') && width === 390) || (path.includes('/de/') && [320, 1280].includes(width)))) {
          await click('[data-scene-target="0"]');
          await delay(500);
          await screenshot('landing-' + path.split('/')[1] + '-' + width);
        }
        if (path.includes('/es-419/') && width === 320 && textScale === 200) await screenshot('landing-es-320-text200');
      }
    }
  }

  for (const path of [pages.find(path => path.includes('/en-us/'))!, pages.find(path => path.includes('/ar/'))!]) {
    await dimensions(1280);
    await navigate(path);
    await click('[data-scene-target="0"]');
    await evaluate('document.querySelector(' + JSON.stringify('[data-scene-target="0"]') + ').focus()');
    for (const [key, code, expected] of [
      ['ArrowRight', 39, path.includes('/ar/') ? '3' : '1'], ['Home', 36, '0'], ['End', 35, '3'],
    ] as const) {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
      const selected = await evaluate('document.querySelector("[data-scene-target][aria-selected=true]").dataset.sceneTarget');
      check(selected === expected, 'Hero keyboard navigation', { path, key, expected, selected });
    }
    await click('[data-category="files"]');
    await evaluate('document.querySelector("details[data-faq-category=files]").open=true');
    await setSearch('zzzz-no-question-qa');
    check(await evaluate('[...document.querySelectorAll("details[data-faq-category]")].every(x=>x.hidden)&&!document.querySelector("[data-faq-empty]").hidden'), 'FAQ empty search', { path });
    await setSearch('SRT');
    const visible = await evaluate('[...document.querySelectorAll("details[data-faq-category]")].filter(x=>!x.hidden).length');
    const status = await evaluate('document.querySelector("[data-faq-status]").textContent');
    const localizedCount = await evaluate('new Intl.NumberFormat(document.documentElement.lang).format(' + visible + ')');
    check(visible > 0 && status.includes(localizedCount), 'FAQ search announces result count', { path, visible, localizedCount, status });
    await click('[data-faq-clear]');
    const restored = await evaluate('({value:document.querySelector("[data-faq-search]").value,category:document.querySelector("[data-category][aria-pressed=true]")?.dataset.category,visible:[...document.querySelectorAll("details[data-faq-category]")].filter(x=>!x.hidden).length,open:document.querySelector("details[data-faq-category=files]").open})');
    check(restored.value === '' && restored.category === 'files' && restored.visible === 4 && restored.open, 'FAQ clearing restores category and disclosure state', { path, restored });
    interactions.push({ path, keyboard: true, faq: restored });
  }

  const spanish = pages.find(path => path.includes('/es-419/'))!;
  await dimensions(1280);
  await navigate(spanish);
  const offscreenHow = await sampleAnimation('[data-how-widget]', 1000);
  check(offscreenHow.every(sample => sample.motion === 'paused' && sample.selected === 0 && sample.phase === offscreenHow[0].phase), 'How autoplay stays suspended outside viewport', offscreenHow);
  const heroPhases = await sampleAnimation('[data-hero-widget]', 8400);
  check(['input', 'line1', 'review', 'corrected', 'line2', 'result'].every(phase => heroPhases.some(sample => sample.phase === phase)), 'Automatic hero visits all phases', heroPhases);
  check(heroPhases.some(sample => sample.selected > 0), 'Automatic hero advances scene', heroPhases);
  await evaluate('document.querySelector("[data-how-widget]").scrollIntoView({block:"center"})');
  await wait('document.querySelector("[data-how-widget]").dataset.motion==="running"');
  const howPhases = await sampleAnimation('[data-how-widget]', 7800);
  check(['0', '1', '2', '3', '4', '5'].every(phase => howPhases.some(sample => sample.phase === phase)), 'How autoplay visits all phases', howPhases);
  check(howPhases.some(sample => sample.selected > 0), 'How autoplay advances step', howPhases);
  interactions.push({ offscreenHow, heroPhases, howPhases });
  for (const width of [320, 390, 768, 1280]) {
    await dimensions(width);
    const values: number[] = [];
    for (let step = 0; step < 3; step++) {
      await click('[data-step-target="' + step + '"]');
      values.push(await evaluate('document.querySelector(".how-preview").getBoundingClientRect().height'));
    }
    const variation = Math.max(...values) - Math.min(...values);
    heights.push({ widget: 'how', width, values, variation });
    check(variation <= 2, 'How preview height varies across steps', { width, values, variation });
  }
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await wait('document.querySelector("[data-hero-widget]").dataset.motion==="static" && document.querySelector("[data-how-widget]").dataset.motion==="static"');
  const reducedHero = await sampleAnimation('[data-hero-widget]', 1200);
  const reducedHow = await sampleAnimation('[data-how-widget]', 1200);
  check(reducedHero.every(sample => sample.motion === 'static' && sample.phase === 'result' && sample.selected === reducedHero[0].selected), 'Reduced motion completes and freezes the hero', reducedHero);
  check(reducedHow.every(sample => sample.motion === 'static' && sample.phase === '5' && sample.selected === reducedHow[0].selected), 'Reduced motion completes and freezes how', reducedHow);
  check(await evaluate('[...document.querySelectorAll("[data-motion-toggle]")].every(button=>button.disabled)'), 'Reduced motion disables automatic switching controls');
  const hiddenChildren = await evaluate('[...document.querySelectorAll("[data-scene-panel][hidden] *,[data-step-panel][hidden] *")].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=="hidden").map(e=>({tag:e.tagName,class:e.className}))');
  check(hiddenChildren.length === 0, 'Reduced motion keeps inactive panel descendants invisible', hiddenChildren);
  interactions.push({ reducedHero, reducedHow, hiddenChildren });
  await dimensions(1280);
  await navigate(spanish);
  for (const [selector, name] of [
    ['[data-how-widget]', 'how'], ['#plans', 'pricing'], ['[data-faq-widget]', 'faq'], ['.v2-footer', 'footer'],
  ]) {
    await evaluate('document.querySelector(' + JSON.stringify(selector) + ').scrollIntoView({block:"start"})');
    await delay(500);
    await screenshot(name + '-es-1280');
  }
  await call('Emulation.setScriptExecutionDisabled', { value: true });
  await call('Page.navigate', { url: base + spanish });
  await wait('document.readyState==="complete" && Boolean(document.querySelector("[data-hero-widget]"))');
  const fallback = await evaluate('({enhanced:document.querySelector("[data-hero-widget]").dataset.enhanced,scenes:[...document.querySelectorAll("[data-scene-panel]")].filter(p=>!p.hidden&&p.getBoundingClientRect().height>0).length,steps:[...document.querySelectorAll("[data-step-panel]")].filter(p=>!p.hidden&&p.getBoundingClientRect().height>0).length,answers:document.querySelectorAll("details[data-faq-category]").length,hiddenControls:[...document.querySelectorAll("[data-motion-toggle],[data-faq-search],button[data-category]")].every(e=>!e.getClientRects().length)})');
  check(!fallback.enhanced && fallback.scenes === 4 && fallback.steps === 3 && fallback.answers === 17 && fallback.hiddenControls, 'No-JavaScript readable fallback', fallback);
  await evaluate('document.querySelector("details[data-faq-category] summary").click()');
  check(await evaluate('document.querySelector("details[data-faq-category]").open'), 'Native FAQ works without JavaScript');
  interactions.push({ fallback });
  await call('Emulation.setScriptExecutionDisabled', { value: false });
  check(browserErrors.length === 0, 'Browser exceptions', browserErrors);
} catch (error) {
  failures.push({ message: 'QA execution interrupted', context: error instanceof Error ? error.message : String(error) });
} finally {
  await writeFile(join(evidence, 'acceptance.json'), JSON.stringify({ failures, layouts, heights, interactions, browserErrors }, null, 2));
  ws?.close();
  browser?.kill();
  await delay(400);
  if (profile) {
    assert.ok(resolve(profile).startsWith(resolve(evidence) + sep), 'Chrome profile must stay inside this evidence folder.');
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
  await pilot?.close();
  await pool.end();
  await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
  await admin.end();
}
console.log(JSON.stringify({ evidence, layouts: layouts.length, failures: failures.length, firstFailures: failures.slice(0, 8) }));
if (failures.length) process.exitCode = 1;
