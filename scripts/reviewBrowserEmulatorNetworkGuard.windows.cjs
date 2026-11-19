'use strict';

// Standalone synthetic guard test. It never starts the browser story, Auth,
// Firestore, Firebase, or any provider. It owns two loopback HTTP servers;
// if the designated test port is occupied it fails without stopping anything.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

async function childMain() {
  const http = require('node:http'), net = require('node:net'), https = require('node:https');
  assert.equal(os.homedir().toLowerCase(), path.resolve(process.env.USERPROFILE).toLowerCase());
  assert.equal(path.resolve(process.env.HOMEDRIVE + process.env.HOMEPATH).toLowerCase(), path.resolve(process.env.USERPROFILE).toLowerCase());
  let reachedRedirect = 0, reachedTarget = 0;
  const target = http.createServer((_req, res) => { reachedTarget++; res.writeHead(200).end('synthetic'); });
  const redirect = http.createServer((_req, res) => { reachedRedirect++; res.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/` }).end(); });
  const listen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let targetOpen = false, redirectOpen = false;
  try {
    await listen(target, 0); targetOpen = true;
    await listen(redirect, 18765); redirectOpen = true;
    require('./reviewBrowserEmulatorNetworkGuard.cjs');
    const guard = globalThis[Symbol.for('vistavo.review.browser.guard.v1')];
    assert(guard && Object.isFrozen(guard)); assert.equal(guard.pid, process.pid); assert.equal(guard.nonce, process.env.LV_REVIEW_BROWSER_GUARD_NONCE);
    await assert.rejects(fetch('http://127.0.0.1:18765/', { redirect: 'follow' }));
    await assert.rejects(fetch(new Request('http://127.0.0.1:18765/', { redirect: 'follow' })));
    assert.equal(reachedRedirect, 2); assert.equal(reachedTarget, 0, 'Redirect target must never receive a request');
    const negatives = [
      () => net.connect({ host: '127.0.0.1', port: 8185 }),
      () => net.connect({ host: '127.0.0.1', port: 9099 }),
      () => net.connect({ host: '127.0.0.1', port: 3001 }),
      () => net.connect({ host: '203.0.113.1', port: 443 }),
      () => new net.Server().listen({ host: '127.0.0.1', port: 0, fd: 42 }),
      () => http.request({ hostname: '127.0.0.1', port: 18765, agent: new http.Agent() }),
      () => https.request('https://example.invalid/'),
      () => fetch('http://127.0.0.1:3003/'),
    ];
    for (const action of negatives) assert.throws(action, error => error?.code === 'LV_REVIEW_NETWORK_DENIED');
    process.stdout.write(JSON.stringify({ result: 'PASS', ownedLoopbackServers: 2, blockedRedirects: 2, redirectTargetRequests: 0, negativeCases: negatives.length, guardAttested: true }) + '\n');
  } finally {
    for (const [server, open] of [[redirect, redirectOpen], [target, targetOpen]]) if (open) {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
  }
}

function parentMain() {
  assert.equal(process.platform, 'win32'); assert.match(process.versions.node, /^24\./);
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR; assert(systemRoot && path.isAbsolute(systemRoot));
  const tempRoot = fs.realpathSync(os.tmpdir()), scratch = fs.mkdtempSync(path.join(tempRoot, 'vistavo-browser-guard-'));
  const marker = crypto.randomUUID(), markerPath = path.join(scratch, '.synthetic-guard-owner'); let marked = false;
  try {
    fs.writeFileSync(markerPath, marker, { flag: 'wx' }); marked = true;
    const profile = path.join(scratch, 'profile'), temp = path.join(scratch, 'temp'); fs.mkdirSync(profile); fs.mkdirSync(temp);
    const homeDrive = path.parse(profile).root.slice(0, 2), systemDrive = path.parse(systemRoot).root.slice(0, 2);
    const env = { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: path.join(systemRoot, 'System32'),
      APPDATA: profile, USERPROFILE: profile, LOCALAPPDATA: profile, TEMP: temp, TMP: temp,
      HOMEDRIVE: homeDrive, HOMEPATH: profile.slice(2), SYSTEMDRIVE: systemDrive,
      USERNAME: 'synthetic-review', USERDOMAIN: 'SYNTHETIC', LOGONSERVER: 'SYNTHETIC',
      NODE_ENV: 'test', FIRESTORE_EMULATOR_HOST: '127.0.0.1:18765', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:18766',
      GOOGLE_CLOUD_PROJECT: 'demo-vistavo-review-browser', METADATA_SERVER_DETECTION: 'none', LV_REVIEW_BROWSER_FIXTURE: '1',
      LV_REVIEW_BROWSER_GUARD_NONCE: crypto.randomUUID().replaceAll('-', ''), LV_REVIEW_BROWSER_GUARD_TEST_CHILD: '1' };
    const child = spawnSync(process.execPath, [__filename], { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', timeout: 30_000, windowsHide: true, maxBuffer: 1_000_000 });
    assert.equal(child.error, undefined, 'Synthetic guard child failed'); assert.equal(child.status, 0, 'Synthetic guard assertions failed');
    const result = JSON.parse(child.stdout.trim()); assert.deepEqual(result, { result: 'PASS', ownedLoopbackServers: 2, blockedRedirects: 2, redirectTargetRequests: 0, negativeCases: 8, guardAttested: true });
    assert(child.stderr.includes('VISTAVO_REVIEW_BROWSER_NETWORK_GUARD_ACTIVE SELF_CHECK=PASS'));
    assert.equal((child.stderr.match(/^VISTAVO_REVIEW_BROWSER_NETWORK_DENIED /gm) || []).length, 8);
    console.log(JSON.stringify(result));
  } finally {
    if (marked) {
      assert(!fs.lstatSync(scratch).isSymbolicLink()); const resolved = fs.realpathSync(scratch);
      assert.equal(resolved.toLowerCase(), path.resolve(scratch).toLowerCase()); assert.equal(path.dirname(resolved).toLowerCase(), tempRoot.toLowerCase());
      assert.match(path.basename(resolved), /^vistavo-browser-guard-[A-Za-z0-9]{6}$/); assert.equal(fs.readFileSync(markerPath, 'utf8'), marker);
      fs.rmSync(resolved, { recursive: true });
    }
  }
}

if (process.env.LV_REVIEW_BROWSER_GUARD_TEST_CHILD === '1') childMain().catch(error => { console.error(error); process.exitCode = 1; });
else parentMain();
