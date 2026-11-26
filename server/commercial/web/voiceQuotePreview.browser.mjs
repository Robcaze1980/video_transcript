import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createProxy } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { cdpPipe } from './reviewBrowserCdp.mjs';

const files = new Map([
  ['/', ['voiceQuotePreview.html', 'text/html']],
  ['/voiceQuotePreview.css', ['voiceQuotePreview.css', 'text/css']],
  ['/voiceQuotePreview.mjs', ['voiceQuotePreview.mjs', 'text/javascript']],
]);
const assets = new Map(await Promise.all([...files].map(async ([path, [file, type]]) =>
  [path, { type, bytes: await readFile(new URL(file, import.meta.url)) }])));
const requests = [];
const serving = process.argv[2] === '--serve';
const server = createServer((request, response) => {
  const { method, url } = request;
  if (!serving) requests.push({ method, url });
  const asset = assets.get(url);
  if (method !== 'GET' || !asset) {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8`, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' }).end(asset.bytes);
});

async function listen(instance) {
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  return instance.address().port;
}

const origin = `http://127.0.0.1:${await listen(server)}`;
if (serving) {
  console.log(origin);
} else {
  try {
    await runBrowser();
  } finally {
    server.close();
  }
}

async function runBrowser() {
  const { LOCALAPPDATA, SystemRoot } = process.env;
  assert.equal(process.platform, 'win32');
  assert.ok(LOCALAPPDATA && SystemRoot, 'Windows browser paths are required');
  const binary = join(LOCALAPPDATA, 'ms-playwright', 'chromium_headless_shell-1234',
    'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
  const tempBase = await realpath(tmpdir());
  const temp = await realpath(await mkdtemp(join(tempBase, 'vistavo-voice-quote-')));
  const proxy = createProxy(socket => socket.destroy());
  let processExit, browser;
  const requestsOutsidePreview = [], pageErrors = [];
  try {
    const proxyPort = await listen(proxy);
    browser = spawn(binary, [
      '--headless=new', '--no-first-run', '--disable-background-networking', '--disable-sync', '--disable-extensions',
      '--disable-quic', '--disable-component-update', '--disable-domain-reliability',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      `--proxy-server=http://127.0.0.1:${proxyPort}`, '--proxy-bypass-list=127.0.0.1',
      '--remote-debugging-pipe', `--user-data-dir=${join(temp, 'browser')}`, 'about:blank',
    ], { cwd: temp, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
      env: { SystemRoot, WINDIR: SystemRoot, PATH: join(SystemRoot, 'System32'),
        APPDATA: temp, LOCALAPPDATA: temp, USERPROFILE: temp, TEMP: temp, TMP: temp } });
    processExit = new Promise(resolve => browser.once('close', resolve));
    const cdp = cdpPipe(browser, { timeoutMs: 10_000 });
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params = {}) => cdp.send(method, params, sessionId);
    const evaluate = async expression => {
      const response = await call('Runtime.evaluate', { expression, returnByValue: true });
      assert.equal(response.exceptionDetails, undefined, response.exceptionDetails?.text);
      return response.result.value;
    };
    cdp.on(message => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails.text);
      if (message.method === 'Network.requestWillBeSent') {
        const target = new URL(message.params.request.url);
        if (target.origin !== origin || !assets.has(target.pathname) || target.search) requestsOutsidePreview.push(target.origin);
      }
    });
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Network.enable');
    await call('Accessibility.enable');
    const setWidth = width => call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    const value = id => evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
    const sizes = () => evaluate(`({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      targets: [...document.querySelectorAll('select, .option')].map(control => control.getBoundingClientRect().height)
    })`);
    const expectLoaded = async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await evaluate("document.getElementById('total-price')?.textContent")) return;
        await delay(50);
      }
      assert.fail('Preview did not render');
    };
    const key = async (value, code) => {
      for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: value, code: value, windowsVirtualKeyCode: code });
    };

    await setWidth(320);
    await call('Page.navigate', { url: origin });
    await expectLoaded();
    assert.equal(await value('text-price'), 'US$0.22');
    assert.equal(await value('voice-rate'), '+ US$0.10/min');
    assert.equal(await value('voice-price'), 'Sin añadir');
    assert.equal(await value('total-price'), 'US$0.22');
    assert.equal(await evaluate("document.documentElement.lang"), 'es');
    await key('Tab', 9);
    assert.equal(await evaluate('document.activeElement.id'), 'duration');
    assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), 'solid');
    await key('Tab', 9);
    assert.equal(await evaluate('document.activeElement.id'), 'text-only');
    await key('ArrowDown', 40);
    assert.equal(await evaluate('document.activeElement.id'), 'with-voice');
    assert.equal(await value('voice-price'), 'US$0.22');
    assert.equal(await value('total-price'), 'US$0.44');
    const { nodes } = await call('Accessibility.getFullAXTree');
    for (const [role, name] of [
      ['combobox', 'Duración del video'], ['group', 'Servicios en la estimación'],
      ['radio', 'Solo texto y subtítulos'], ['radio', 'Texto, subtítulos y voz'],
    ]) assert.ok(nodes.some(node => node.role.value === role && node.name?.value === name), `${role} ${name}`);
    assert.ok(nodes.some(node => node.role.value === 'status' &&
      node.properties?.some(property => property.name === 'live' && property.value.value === 'polite')));

    const widths = [];
    for (const width of [320, 390]) {
      await setWidth(width);
      const metrics = await sizes();
      assert.equal(metrics.viewport, width);
      assert.ok(metrics.document <= metrics.viewport);
      assert.ok(metrics.targets.every(height => height >= 44));
      widths.push(width);
    }
    await evaluate(`(() => {
      const duration = document.getElementById('duration');
      duration.value = '180000';
      duration.dispatchEvent(new Event('change'));
    })()`);
    assert.equal(await value('total-price'), 'US$0.60');
    assert.deepEqual(await evaluate('[localStorage.length, sessionStorage.length, document.forms.length]'), [0, 0, 0]);
    await call('Page.reload');
    await expectLoaded();
    assert.equal(await value('total-price'), 'US$0.22');
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(requestsOutsidePreview, []);
    assert.ok(requests.length >= 3 && requests.every(request => request.method === 'GET' && assets.has(request.url)));
    console.log(JSON.stringify({ outcome: 'PASS', widths, requests: requests.length, browser: 'Chromium Headless Shell' }));
    await cdp.send('Browser.close').catch(() => undefined);
  } finally {
    proxy.close();
    if (browser) {
      if (browser.exitCode === null && browser.signalCode === null) browser.kill();
      await processExit;
    }
    assert.equal(dirname(await realpath(temp)), tempBase);
    await rm(temp, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}
