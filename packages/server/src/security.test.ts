// Black-box security tests: start the real server and try to get in the ways a browser page, another local
// user, or a DNS-rebinding site would. Parity goal: nothing can reach the agent that could not already
// run the same commands in a terminal as this user.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { connect, createServer } from 'node:net';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

let child: ChildProcess;
let port = 0;
let data = '';
let token = '';
const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));

async function freePort(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const p = 20000 + Math.floor(Math.random() * 20000);
    const ok = await Promise.all([p, p + 1].map((q) => new Promise<boolean>((res) => {
      const s = createServer().once('error', () => res(false)).listen(q, '127.0.0.1', () => s.close(() => res(true)));
    })));
    if (ok.every(Boolean)) return p;
  }
  throw new Error('no free port');
}

before(async () => {
  port = await freePort();
  data = mkdtempSync(join(tmpdir(), 'sec-'));
  child = spawn(tsx, ['src/index.ts'], { cwd, env: { ...process.env, PORT: String(port), DESIGNER_DATA: data, DESIGNER_FAKE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not start')), 15000);
    child.stdout!.on('data', (d) => /Open this link/.test(String(d)) && (clearTimeout(t), res()));
    child.on('exit', () => rej(new Error('server exited')));
  });
  token = readFileSync(join(data, 'token'), 'utf8').trim();
});
after(() => {
  try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* already gone */ }
});

const base = () => `http://127.0.0.1:${port}`;
/** Raw request so we can set Host, which fetch forbids. */
function raw(path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((res, rej) => {
    request({ host: '127.0.0.1', port, path, headers }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => res({ status: r.statusCode ?? 0, body: b }));
    }).on('error', rej).end();
  });
}
function wsResult(url: string, origin?: string): Promise<'open' | 'refused'> {
  return new Promise((res) => {
    const ws = new WebSocket(url, origin ? { headers: { origin } } : undefined);
    ws.on('open', () => (ws.close(), res('open')));
    ws.on('error', () => res('refused'));
    ws.on('unexpected-response', () => res('refused'));
  });
}

test('the token is random, long, stable across restarts, and stored owner-only', () => {
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(statSync(join(data, 'token')).mode & 0o777, 0o600);
  assert.equal(statSync(data).mode & 0o777, 0o700);
});

test('WebSocket: refused without a token, with a wrong token, and with the right token from a foreign Origin', async () => {
  const url = (t?: string) => `ws://127.0.0.1:${port}/ws${t === undefined ? '' : `?t=${t}`}`;
  assert.equal(await wsResult(url()), 'refused');
  assert.equal(await wsResult(url('nope')), 'refused');
  assert.equal(await wsResult(url(token.slice(0, -1) + (token.endsWith('0') ? '1' : '0'))), 'refused', 'one wrong character');
  assert.equal(await wsResult(url(token), 'https://evil.example'), 'refused', 'a web page elsewhere, even holding the token');
  assert.equal(await wsResult(url(token), `http://localhost:${port + 1}`), 'refused', 'the preview origin (previewed pages) is not the app');
  assert.equal(await wsResult(url(token), `http://localhost:${port}`), 'open', 'the app itself works');
  assert.equal(await wsResult(url(token)), 'open', 'a local process that holds the token (no Origin) works');
});

test('WebSocket: DNS-rebinding style Host is refused even with the token', async () => {
  const r = await new Promise<string>((res) => {
    const req = request({ host: '127.0.0.1', port, path: `/ws?t=${token}`, headers: { host: 'evil.example', connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } });
    req.on('upgrade', () => res('upgraded'));
    req.on('response', () => res('refused'));
    req.on('error', () => res('refused'));
    req.end();
  });
  assert.equal(r, 'refused');
});

test('API: needs the token header, same-origin fetches only, and the Host check', async () => {
  const probe = '/api/probe?url=' + encodeURIComponent('http://127.0.0.1:1/');
  assert.equal((await raw(probe, { host: `127.0.0.1:${port}` })).status, 401, 'no token');
  assert.equal((await raw(probe, { host: `127.0.0.1:${port}`, 'x-designer-token': 'wrong' })).status, 401, 'wrong token');
  assert.equal((await raw(probe, { host: `127.0.0.1:${port}`, 'x-designer-token': token, 'sec-fetch-site': 'cross-site' })).status, 403, 'cross-site page with the token');
  assert.equal((await raw(probe, { host: `127.0.0.1:${port}`, 'x-designer-token': token, 'sec-fetch-site': 'same-site' })).status, 403, 'a page on another local port (preview/proxy)');
  assert.equal((await raw(probe, { host: 'evil.example', 'x-designer-token': token })).status, 403, 'rebinding Host');
  assert.equal((await raw(probe, { host: `127.0.0.1:${port}`, 'x-designer-token': token, 'sec-fetch-site': 'same-origin' })).status, 200, 'the app itself');
  assert.equal((await raw('/api/proxy?url=http%3A%2F%2F127.0.0.1%3A1%2F', { host: `127.0.0.1:${port}` })).status, 401);
  assert.equal((await raw('/api/html?workspace=x', { host: `127.0.0.1:${port}` })).status, 401);
});

test('the app page is public but locked down: no framing, no inline script, no sniffing, no referrer, no secrets in it', async () => {
  const r = await fetch(base() + '/');
  assert.ok([200, 404].includes(r.status)); // 404 only if the UI has not been built
  const h = r.headers;
  assert.match(h.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.match(h.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.doesNotMatch(h.get('content-security-policy') ?? '', /script-src[^;]*unsafe-inline/);
  assert.equal(h.get('x-frame-options'), 'DENY');
  assert.equal(h.get('x-content-type-options'), 'nosniff');
  assert.equal(h.get('referrer-policy'), 'no-referrer');
  assert.equal(h.get('cross-origin-resource-policy'), 'same-origin');
  assert.ok(!(await r.text()).includes(token), 'the token is never embedded in a page');
});

test('Host check on pages; path traversal never leaks files', async () => {
  assert.equal((await raw('/', { host: 'evil.example' })).status, 403);
  for (const path of ['/../../../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc%2fpasswd']) {
    const r = await raw(path, { host: `127.0.0.1:${port}` });
    assert.doesNotMatch(r.body, /root:.*:0:0/, `no file contents for ${path}`);
  }
});

test('servers listen on loopback only', async () => {
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  if (!lan) return; // no non-loopback interface in this environment
  const reachable = await new Promise<boolean>((res) => {
    const c = connect(port, lan, () => (c.destroy(), res(true)));
    c.on('error', () => res(false));
  });
  assert.equal(reachable, false, 'the app is not reachable on the LAN address');
});

test('a malformed message from the page gets an error back and never takes the server down', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?t=${token}`, { headers: { origin: `http://127.0.0.1:${port}` } });
  const errors: string[] = [];
  let threadId = '';
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.type === 'error') errors.push(m.message);
    if (m.type === 'thread_updated' && !threadId) threadId = m.thread.id;
  });
  await new Promise<void>((res, rej) => (ws.once('open', res), ws.once('error', rej)));
  ws.send(JSON.stringify({ type: 'add_folder', path: tmpdir() }));
  for (let i = 0; i < 50 && !threadId; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(threadId, 'a thread to send to');
  for (const m of [{ type: 'send', threadId }, { type: 'send', threadId, text: 5 }, { type: 'set_mode', threadId, mode: 'nope' }, null, 7, [], { type: 'bogus' }]) ws.send(JSON.stringify(m));
  ws.send('{not json');
  for (let i = 0; i < 50 && errors.length < 8; i++) await new Promise((r) => setTimeout(r, 100));
  ws.close();
  assert.equal(errors.length, 8, 'every bad message was answered with an error');
  assert.equal((await raw('/', { host: `127.0.0.1:${port}` })).status === 0, false);
  assert.equal(child.exitCode, null, 'the server process is still running');
});

test('the proxy cannot be pointed back at Designer (app, preview or any spelling of this machine)', async () => {
  const get = (u: string) => raw('/api/proxy?url=' + encodeURIComponent(u), { host: `127.0.0.1:${port}`, 'x-designer-token': token, 'sec-fetch-site': 'same-origin' });
  for (const u of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://0.0.0.0:${port}/`, `http://[::1]:${port}/`, `http://127.0.0.1:${port + 1}/`]) {
    const r = await get(u);
    assert.equal(r.status, 400, u);
    assert.match(r.body, /Designer itself/);
  }
  assert.equal((await get('file:///etc/passwd')).status, 400);
});
