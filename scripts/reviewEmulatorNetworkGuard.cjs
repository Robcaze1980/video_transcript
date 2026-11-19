'use strict';

// Test-only Node guard. It is not an OS firewall and cannot constrain esbuild,
// native addons, other processes, or unsupported/internal networking APIs.
// The parent process passes only an isolated profile and synthetic configuration.
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const http2 = require('node:http2');
const tls = require('node:tls');
const dns = require('node:dns');
const dgram = require('node:dgram');
const os = require('node:os');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');

if (process.env.NODE_ENV !== 'test' || process.env.LV_REVIEW_CONTRACT !== '1' ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185' ||
    process.env.METADATA_SERVER_DETECTION !== 'none' ||
    process.env.GOOGLE_CLOUD_PROJECT !== 'demo-vistavo-ledger') {
  throw Error('Synthetic review network guard requires the fixed demo environment');
}

let checking = true;
function denied(category = 'unspecified') {
  // Classify the blocked operation without logging a URL, credentials or data.
  if (!checking) process.stderr.write(`VISTAVO_REVIEW_NETWORK_DENIED category=${category}\n`);
  const error = Error('Synthetic review guard denied a non-emulator network operation');
  error.code = 'LV_REVIEW_NETWORK_DENIED';
  throw error;
}
function address(host, port) {
  if (host !== '127.0.0.1' || String(port) !== '8185') denied(host === '127.0.0.1' ? 'loopback-other-port' : 'other-address');
}
function connectArgs(args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0]; // Node may pass normalized socket arguments.
  if (first && typeof first === 'object') {
    if (first.path || first.socketPath || first.fd !== undefined) denied();
    return address(first.host ?? first.hostname, first.port);
  }
  if (typeof first === 'number') return address(args[1], first);
  denied(); // Named pipes, ambiguous strings and omitted hosts are not allowed.
}
function urlTarget(value) {
  let url;
  try { url = value instanceof URL ? value : new URL(String(value)); } catch { return denied(); }
  if (url.protocol !== 'http:' || url.username || url.password) denied();
  address(url.hostname, url.port || '80');
}

const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { connectArgs(args); return socketConnect.apply(this, args); };
const netConnect = net.connect;
// tsx tries a parent-process IPC pipe while loading. Never connect to it: only
// its exact two-argument request gets an asynchronous synthetic ENOENT socket.
const tsxUser = process.geteuid ? process.geteuid() : os.userInfo().username;
const tsxParentPipe = process.platform === 'win32'
  ? `\\\\?\\pipe\\${path.join(os.tmpdir(), `tsx-${tsxUser}`, `${process.ppid}.pipe`)}`
  : null;
function syntheticTsxIpc(args) {
  return tsxParentPipe !== null && args.length === 2 && args[0] === tsxParentPipe && typeof args[1] === 'function';
}
function noTsxIpcConnection() {
  const socket = new net.Socket();
  process.stderr.write('VISTAVO_REVIEW_TSX_IPC_SYNTHETIC\n');
  process.nextTick(() => {
    const error = Error('Synthetic tsx IPC unavailable');
    error.code = 'ENOENT';
    error.syscall = 'connect';
    socket.destroy(error);
  });
  return socket;
}
net.connect = function (...args) { if (syntheticTsxIpc(args)) return noTsxIpcConnection(); connectArgs(args); return netConnect.apply(this, args); };
net.createConnection = net.connect;

const originalHttpRequest = http.request;
function checkHttp(args) {
  const first = args[0], options = first && typeof first === 'object' && !(first instanceof URL) ? first :
    args[1] && typeof args[1] === 'object' ? args[1] : {};
  if (options.path && typeof options.path === 'string' && !options.path.startsWith('/')) denied();
  if (options.socketPath || options.createConnection) denied();
  if (first instanceof URL || typeof first === 'string') {
    urlTarget(first);
    if (options.host !== undefined || options.hostname !== undefined || options.port !== undefined || options.protocol !== undefined) {
      if (options.protocol && options.protocol !== 'http:') denied();
      address(options.hostname ?? options.host ?? '127.0.0.1', options.port ?? '8185');
    }
  } else {
    if (options.protocol && options.protocol !== 'http:') denied();
    address(options.hostname ?? options.host, options.port ?? 80);
  }
}
http.request = function (...args) { checkHttp(args); return originalHttpRequest.apply(this, args); };
http.get = function (...args) { const request = http.request(...args); request.end(); return request; };
https.request = () => denied('https');
https.get = () => denied('https');
tls.connect = () => denied('tls');
const connectHttp2 = http2.connect;
http2.connect = function (authority, options, listener) {
  urlTarget(authority);
  if (options && typeof options === 'object' && options.createConnection) {
    // grpc-js hands HTTP/2 a socket it already connected. Permit only the
    // exact emulator socket; arbitrary socket factories remain forbidden.
    const connect = options.createConnection;
    if (typeof connect !== 'function') denied('http2-socket-factory');
    options = { ...options, createConnection(...args) {
      const socket = connect.apply(this, args);
      if (!(socket instanceof net.Socket) || socket.connecting || socket.destroyed ||
          socket.remoteAddress !== '127.0.0.1' || socket.remotePort !== 8185) {
        if (socket instanceof net.Socket) socket.destroy();
        denied('http2-other-socket');
      }
      return socket;
    } };
  }
  return connectHttp2.call(this, authority, options, listener);
};

const lookup = dns.lookup;
dns.lookup = function (hostname, ...args) { if (hostname !== '127.0.0.1') denied('dns-lookup'); return lookup.call(this, hostname, ...args); };
for (const name of Object.keys(dns)) {
  if (/^(resolve|reverse|lookupService|setServers)/.test(name) && typeof dns[name] === 'function') dns[name] = () => denied('dns-resolver');
}
if (dns.promises) {
  const lookupPromise = dns.promises.lookup;
  dns.promises.lookup = function (hostname, ...args) { if (hostname !== '127.0.0.1') denied('dns-lookup'); return lookupPromise.call(this, hostname, ...args); };
  for (const name of Object.keys(dns.promises)) {
    if (/^(resolve|reverse|lookupService|setServers)/.test(name) && typeof dns.promises[name] === 'function') dns.promises[name] = () => denied('dns-resolver');
  }
}
if (dns.Resolver) dns.Resolver = function () { denied(); };
if (dns.promises?.Resolver) dns.promises.Resolver = class InertResolver {
  // grpc-js creates this before recognizing that the fixed target is an IP.
  // It cannot perform DNS, including via a custom DNS server.
  setServers() { denied('dns-resolver'); }
  getServers() { denied('dns-resolver'); }
  cancel() {}
  resolve() { denied('dns-resolver'); }
  resolve4() { denied('dns-resolver'); }
  resolve6() { denied('dns-resolver'); }
  resolveTxt() { denied('dns-resolver'); }
  reverse() { denied('dns-resolver'); }
};
dgram.createSocket = () => denied('udp');
for (const name of ['bind', 'connect', 'send']) {
  if (typeof dgram.Socket?.prototype?.[name] === 'function') dgram.Socket.prototype[name] = () => denied('udp');
}

const originalFetch = globalThis.fetch;
if (typeof originalFetch !== 'function') throw Error('Synthetic review guard requires Node fetch');
globalThis.fetch = function (input, init) {
  urlTarget(typeof Request !== 'undefined' && input instanceof Request ? input.url : input);
  if (init?.dispatcher) denied();
  return originalFetch.call(this, input, init);
};
syncBuiltinESMExports();

// Verify rejection before any attempt to open a socket. The positive helper
// checks syntax only; the fixture itself verifies that 8185 is reachable.
function assertBlocked(action) {
  try { action(); } catch (error) { if (error?.code === 'LV_REVIEW_NETWORK_DENIED') return; throw error; }
  throw Error('Synthetic review network guard self-check failed');
}
address('127.0.0.1', 8185);
urlTarget('http://127.0.0.1:8185/');
assertBlocked(() => net.connect({ host: '127.0.0.1', port: 3001 }));
assertBlocked(() => net.connect({ host: '127.0.0.1', port: 3003 }));
assertBlocked(() => net.connect({ host: '203.0.113.1', port: 443 }));
assertBlocked(() => http2.connect('http://127.0.0.1:3000'));
assertBlocked(() => https.request('https://example.invalid/'));
assertBlocked(() => dns.lookup('example.invalid', () => {}));
assertBlocked(() => new dns.promises.Resolver().resolve4('example.invalid'));
assertBlocked(() => http2.connect('http://127.0.0.1:8185', { createConnection: () => new net.Socket() }));
assertBlocked(() => globalThis.fetch('http://127.0.0.1:3003/'));
checking = false;
process.stderr.write('VISTAVO_REVIEW_NETWORK_GUARD_ACTIVE SELF_CHECK=PASS\n');
