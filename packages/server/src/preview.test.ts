import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { listHtml, probe, resolveInside, startPreviewServer } from './preview.js';

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'pv-')));

function site() {
  const root = tmp();
  writeFileSync(join(root, 'index.html'), '<h1>home</h1>');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'page.html'), '<h1>sub</h1>');
  writeFileSync(join(root, 'style.css'), 'body{}');
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'skip.html'), 'x');
  return root;
}

test('resolveInside: files, directory index, and blocked escapes', () => {
  const root = site();
  assert.equal(resolveInside(root, 'index.html'), join(root, 'index.html'));
  assert.equal(resolveInside(root, ''), join(root, 'index.html'));
  assert.equal(resolveInside(root, 'sub/page.html'), join(root, 'sub', 'page.html'));
  assert.equal(resolveInside(root, '../etc/passwd'), undefined);
  assert.equal(resolveInside(root, '%2e%2e/%2e%2e/etc/passwd'), undefined);
  assert.equal(resolveInside(root, '/etc/passwd'), undefined);
  assert.equal(resolveInside(root, 'missing.html'), undefined);
  // a symlink pointing outside the workspace must not leak the target
  const outside = tmp();
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
  symlinkSync(outside, join(root, 'linkdir'));
  assert.equal(resolveInside(root, 'link.txt'), undefined);
  assert.equal(resolveInside(root, 'linkdir/secret.txt'), undefined);
});

test('listHtml skips node_modules and dotdirs', () => {
  const root = site();
  mkdirSync(join(root, '.hidden'));
  writeFileSync(join(root, '.hidden', 'h.html'), 'x');
  assert.deepEqual(listHtml(root), ['index.html', join('sub', 'page.html')]);
});

test('preview server: serves files with types, 404s escapes and unknown workspaces, checks Host', async () => {
  const root = site();
  const srv = await startPreviewServer(0, (id) => (id === 'ws1' ? root : undefined));
  const port = (srv.address() as AddressInfo).port;
  const get = (path: string, host?: string) => fetch(`http://127.0.0.1:${port}${path}`, host ? { headers: { host } } : {});
  const ok = await get('/ws1/index.html');
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type')!, /text\/html/);
  assert.equal(await ok.text(), '<h1>home</h1>');
  assert.match((await get('/ws1/style.css')).headers.get('content-type')!, /text\/css/);
  assert.equal((await get('/ws1/')).status, 200);
  assert.equal((await get('/nope/index.html')).status, 404);
  assert.equal((await get('/ws1/..%2f..%2fetc%2fpasswd')).status, 404);
  // a rebinding-style Host header is refused (fetch cannot set Host, so use a raw request)
  const status = await new Promise<number>((res) => {
    request({ host: '127.0.0.1', port, path: '/ws1/index.html', headers: { host: 'evil.example' } }, (r) => (r.resume(), res(r.statusCode ?? 0))).end();
  });
  assert.equal(status, 403);
  srv.closeAllConnections();
  srv.close();
});

test('probe: reachable page is framable; X-Frame-Options and CSP frame-ancestors are not; dead port is unreachable', async () => {
  const srv = createServer((req, res) => {
    if (req.url === '/xfo') res.setHeader('x-frame-options', 'DENY');
    if (req.url === '/csp') res.setHeader('content-security-policy', "frame-ancestors 'self'");
    res.end('<html></html>');
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  assert.deepEqual(await probe(base + '/'), { ok: true, framable: true });
  assert.equal((await probe(base + '/xfo')).framable, false);
  assert.equal((await probe(base + '/csp')).framable, false);
  srv.closeAllConnections();
  srv.close();
  const dead = await probe(base + '/');
  assert.equal(dead.ok, false);
  assert.match(dead.reason!, /Cannot reach/);
  assert.equal((await probe('file:///etc/passwd')).ok, false);
  assert.equal((await probe('not a url')).ok, false);
});
