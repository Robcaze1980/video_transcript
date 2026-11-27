'use strict';

// Repeatable Windows/Node 24 guard test. Run:
//   node scripts/appliedOwnerEmulatorNetworkGuard.windows.cjs
// The child uses only a new empty profile and standard Node modules. Its native
// Socket.connect is replaced BEFORE loading the guard by a counter that throws,
// so even the positive control cannot open a socket or pipe. No emulator needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function childMain() {
  const net = require('node:net');
  const dns = require('node:dns');
  const http2 = require('node:http2');
  const https = require('node:https');
  const dgram = require('node:dgram');
  let realConnectCalls = 0, syntheticListenCalls = 0;
  const sentinel = Error('Synthetic positive-control sentinel');
  net.Socket.prototype.connect = function () { realConnectCalls++; throw sentinel; };
  // No real listener is opened: the guard captures this synthetic listen and
  // sees the synthetic address only after the asynchronous listening event.
  net.Server.prototype.listen = function () {
    syntheticListenCalls++;
    Object.defineProperty(this, 'listening', { configurable: true, get: () => true });
    this.address = () => ({ address: '127.0.0.1', family: 'IPv4', port: 43210 });
    process.nextTick(() => this.emit('listening')); return this;
  };
  require('./appliedOwnerEmulatorNetworkGuard.cjs');
  const user = process.geteuid ? process.geteuid() : os.userInfo().username;
  const pipe = `\\\\?\\pipe\\${path.join(os.tmpdir(), `tsx-${user}`, `${process.ppid}.pipe`)}`;

  // Prove that the counter would catch a destination passing the guard; the
  // sentinel throws before Node's actual connection implementation can run.
  assert.throws(() => net.connect({ host: '127.0.0.1', port: 8195 }), error => error === sentinel);
  assert.equal(realConnectCalls, 1);
  realConnectCalls = 0;

  async function syntheticError(connect) {
    let synchronous = true, connected = false;
    const socket = connect(pipe, () => { connected = true; });
    assert(socket instanceof net.Socket);
    assert.equal(socket._handle, null);
    socket.unref();
    const errorSeen = new Promise((resolve, reject) => {
      socket.on('connect', () => { connected = true; });
      socket.on('error', error => {
        try {
          assert.equal(synchronous, false);
          assert.equal(error.code, 'ENOENT');
          assert.equal(error.syscall, 'connect');
          assert.equal(socket._handle, null);
          resolve();
        } catch (failure) { reject(failure); }
      });
    });
    synchronous = false;
    await errorSeen;
    assert.equal(connected, false);
  }

  return (async () => {
    await syntheticError(net.connect);
    await syntheticError(net.createConnection);
    assert.equal(realConnectCalls, 0, 'Synthetic IPC must not reach the real socket method');
    const server = new net.Server();
    const ready = new Promise(resolve => server.once('listening', resolve));
    server.listen(0, '127.0.0.1'); await ready;
    assert.equal(syntheticListenCalls, 1);
    assert.throws(() => net.connect({ host: '127.0.0.1', port: 43210 }), error => error === sentinel);
    assert.equal(realConnectCalls, 1); realConnectCalls = 0;
    server.emit('close');
    const negatives = [
      () => net.connect(pipe + 'x', () => {}),
      () => net.connect('\\\\?\\pipe\\unrelated-test-pipe', () => {}),
      () => net.connect({ path: pipe }, () => {}),
      () => net.connect(pipe),
      () => net.connect(pipe, () => {}, {}),
      () => new net.Socket().connect(pipe, () => {}),
      () => net.connect({ host: '127.0.0.1', port: 3001 }),
      () => net.connect({ host: '127.0.0.1', port: 8185 }),
      () => net.connect({ host: '127.0.0.1', port: 8186 }),
      () => net.connect({ host: '127.0.0.1', port: 8187 }),
      () => net.connect(443, '203.0.113.1'),
      () => globalThis.fetch('http://127.0.0.1:3003/'),
      () => dns.lookup('example.invalid', () => {}),
      () => https.request('https://example.invalid/'),
      () => dgram.createSocket('udp4'),
      () => http2.connect('http://127.0.0.1:8195', { createConnection: () => new net.Socket() }),
      () => new dns.Resolver(),
      () => net.connect({ host: '127.0.0.1', port: 43210 }),
      () => new net.Server().listen(3001, '127.0.0.1'),
      () => new net.Server().listen(0, '0.0.0.0'),
      () => new net.Server().listen(0),
    ];
    for (const action of negatives) assert.throws(action, error => error?.code === 'LV_REVIEW_NETWORK_DENIED');
    assert.equal(realConnectCalls, 0, 'Rejected destinations must not reach the real socket method');
    assert.equal(syntheticListenCalls, 1, 'Rejected listeners must not reach the listen method');
    process.stdout.write(JSON.stringify({ result: 'PASS', syntheticErrors: 2, negativeCases: negatives.length, realConnectCalls: 0, positiveControl: true, ownedListener: true }) + '\n');
  })();
}

function parentMain() {
  assert.equal(process.platform, 'win32', 'This test requires Windows');
  assert.match(process.versions.node, /^24\./, 'This test requires Node 24');
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  assert(systemRoot && path.isAbsolute(systemRoot));
  const tempRoot = fs.realpathSync(path.join(__dirname, '..', 'outputs'));
  const scratch = fs.mkdtempSync(path.join(tempRoot, 'vistavo-financial-guard-'));
  const marker = crypto.randomUUID(), markerPath = path.join(scratch, '.vistavo-guard-marker');
  let markerWritten = false;
  try {
    fs.writeFileSync(markerPath, marker, { flag: 'wx' });
    markerWritten = true;
    const profile = path.join(scratch, 'profile'), temp = path.join(scratch, 'temp');
    fs.mkdirSync(profile); fs.mkdirSync(temp);
    assert.equal(fs.readdirSync(profile).length, 0);
    const env = {
      SystemRoot: systemRoot, WINDIR: systemRoot, PATH: path.join(systemRoot, 'System32'),
      APPDATA: profile, USERPROFILE: profile, LOCALAPPDATA: profile, TEMP: temp, TMP: temp,
      NODE_ENV: 'test', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8195', GOOGLE_CLOUD_PROJECT: 'demo-vistavo-applied-owner',
      GCLOUD_PROJECT: 'demo-vistavo-applied-owner', METADATA_SERVER_DETECTION: 'none', LV_REVIEW_CONTRACT: '1',
      LV_REVIEW_GUARD_TEST_CHILD: '1', LV_FINANCIAL_REGRESSION: '1',
    };
    const child = spawnSync(process.execPath, [__filename], { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 1_000_000 });
    assert.equal(child.error, undefined, 'Child process failed');
    assert.equal(child.status, 0, 'Child assertions failed');
    const summary = JSON.parse(child.stdout.trim());
    assert.deepEqual(summary, { result: 'PASS', syntheticErrors: 2, negativeCases: 21, realConnectCalls: 0, positiveControl: true, ownedListener: true });
    assert(child.stderr.includes('VISTAVO_FINANCIAL_NETWORK_GUARD_ACTIVE SELF_CHECK=PASS'));
    assert.equal((child.stderr.match(/^VISTAVO_REVIEW_TSX_IPC_SYNTHETIC\s*$/gm) || []).length, 2);
    assert.equal((child.stderr.match(/^VISTAVO_REVIEW_NETWORK_DENIED /gm) || []).length, 21);
    console.log(JSON.stringify(summary));
  } finally {
    // Preserve the unique marked output directory as synthetic evidence. No
    // user profile or filesystem tree is recursively removed by this test.
    if (markerWritten) {
      assert(!fs.lstatSync(scratch).isSymbolicLink());
      const resolved = fs.realpathSync(scratch);
      assert.equal(resolved.toLowerCase(), path.resolve(scratch).toLowerCase());
      assert.equal(path.dirname(resolved).toLowerCase(), tempRoot.toLowerCase());
      assert.match(path.basename(resolved), /^vistavo-financial-guard-[A-Za-z0-9]{6}$/);
      assert.equal(fs.readFileSync(markerPath, 'utf8'), marker);
    }
  }
}

if (process.env.LV_REVIEW_GUARD_TEST_CHILD === '1') {
  childMain().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  parentMain();
}
