import { test } from 'node:test';
import assert from 'node:assert/strict';
import http, { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { AGENT_PATH, injectAgent } from './agent.js';
import { ProxyPool } from './proxy.js';
import { startPreviewServer } from './preview.js';

const ORIGINS = ['http://localhost:4317', 'http://127.0.0.1:4317'];

test('injectAgent puts the tag before the last </body>, or at the end', () => {
  const a = injectAgent('<html><body><p>x</p></body></html>', ORIGINS);
  assert.match(a, /<p>x<\/p><script src="\/__designer\/agent\.js" data-designer-agent data-origins="http:\/\/localhost:4317,http:\/\/127\.0\.0\.1:4317"><\/script><\/body>/);
  assert.ok(injectAgent('<p>fragment</p>', ORIGINS).endsWith('</script>'));
  assert.equal(injectAgent('<BODY>x</BODY>', ORIGINS).match(/<script/g)?.length, 1);
});

test('preview server injects the agent into HTML only and serves the agent script', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ag-')));
  writeFileSync(join(root, 'a.html'), '<html><body><h1>hi</h1></body></html>');
  writeFileSync(join(root, 's.css'), 'body{}');
  const srv = await startPreviewServer(0, (id) => (id === 'w' ? root : undefined), () => ORIGINS);
  const port = (srv.address() as AddressInfo).port;
  const html = await (await fetch(`http://127.0.0.1:${port}/w/a.html`)).text();
  assert.match(html, /data-designer-agent/);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/w/s.css`)).text(), 'body{}');
  const js = await fetch(`http://127.0.0.1:${port}${AGENT_PATH}`);
  assert.equal(js.status, 200);
  assert.match(await js.text(), /Designer page agent/);
  srv.closeAllConnections();
  srv.close();
});

test('proxy: injects the agent, drops framing/CSP headers, rewrites redirects and cookies, passes other content through', async () => {
  let seenHost = '';
  const target = http.createServer((req, res) => {
    seenHost = String(req.headers.host);
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'", 'set-cookie': 'sid=1; Domain=example.com; Secure; SameSite=None; Path=/' });
      return void res.end('<html><body><h1>dev server</h1></body></html>');
    }
    if (req.url === '/go') return void res.writeHead(302, { location: `http://${req.headers.host}/` }).end();
    if (req.url === '/data.json') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"a":1}');
    res.writeHead(404).end('nope');
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  const tport = (target.address() as AddressInfo).port;
  const pool = new ProxyPool(() => ORIGINS);
  const proxy = await pool.get(new URL(`http://127.0.0.1:${tport}/some/page?x=1`));
  assert.equal((await pool.get(new URL(`http://127.0.0.1:${tport}/other`))).port, proxy.port, 'one proxy per target origin');
  const base = `http://127.0.0.1:${proxy.port}`;

  const r = await fetch(base + '/');
  const body = await r.text();
  assert.match(body, /dev server/);
  assert.match(body, /data-designer-agent/);
  assert.equal(r.headers.get('x-frame-options'), null);
  assert.equal(r.headers.get('content-security-policy'), null);
  assert.equal(r.headers.get('content-length'), String(Buffer.byteLength(body)));
  assert.equal(seenHost, `127.0.0.1:${tport}`, 'the target sees its own host name');
  const cookie = r.headers.get('set-cookie')!;
  assert.doesNotMatch(cookie, /domain|secure/i);
  assert.match(cookie, /SameSite=Lax/);

  const redirect = await fetch(base + '/go', { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), `http://localhost:${proxy.port}/`);

  assert.equal(await (await fetch(base + '/data.json')).text(), '{"a":1}');
  assert.equal((await fetch(base + '/missing')).status, 404);
  assert.match(await (await fetch(base + AGENT_PATH)).text(), /Designer page agent/);

  const bad = await new Promise<number>((res) => request({ host: '127.0.0.1', port: proxy.port, path: '/', headers: { host: 'evil.example' } }, (x) => (x.resume(), res(x.statusCode ?? 0))).end());
  assert.equal(bad, 403, 'rebinding-style Host header is refused');

  await assert.rejects(pool.get(new URL('file:///etc/passwd')), /http and https/);
  pool.closeAll();
  target.closeAllConnections();
  target.close();
});

test('proxy tunnels WebSockets (dev-server hot reload) and rewrites Origin', async () => {
  let seenOrigin: string | undefined;
  const target = http.createServer((_, res) => res.end('x'));
  const wss = new WebSocketServer({ server: target });
  wss.on('connection', (ws, req) => {
    seenOrigin = req.headers.origin;
    ws.on('message', (m) => ws.send('echo:' + m));
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  const tport = (target.address() as AddressInfo).port;
  const pool = new ProxyPool(() => ORIGINS);
  const proxy = await pool.get(new URL(`http://127.0.0.1:${tport}/`));
  const reply = await new Promise<string>((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/hmr`, { headers: { origin: `http://localhost:${proxy.port}` } });
    ws.on('open', () => ws.send('ping'));
    ws.on('message', (m) => (res(String(m)), ws.close()));
    ws.on('error', rej);
  });
  assert.equal(reply, 'echo:ping');
  assert.equal(seenOrigin, `http://127.0.0.1:${tport}`, 'the dev server sees its own origin, not the proxy');
  pool.closeAll();
  wss.close();
  target.closeAllConnections();
  target.close();
});
