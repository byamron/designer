// The self-hosting script (scripts/dev-instance.mjs) and the framing rule that lets a dev instance appear in the stable app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { pageHeaders } from './auth.js';

const scripts = fileURLToPath(new URL('../../../scripts/', import.meta.url));
// plain JS outside this package: load dynamically so TypeScript does not need types for it
const lib: any = await import(join(scripts, 'lib', 'dev-instance.mjs'));
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'dev-')));

test('pages cannot be framed by default; a dev instance can allow exact parents only', () => {
  const d = pageHeaders(4317);
  assert.match(d['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(d['x-frame-options'], 'DENY');
  const a = pageHeaders(4500, ['http://localhost:4317', 'http://127.0.0.1:4317']);
  assert.match(a['content-security-policy'], /frame-ancestors http:\/\/localhost:4317 http:\/\/127\.0\.0\.1:4317(;|$)/);
  assert.equal('x-frame-options' in a, false);
  // anything that is not a plain origin is ignored, so a typo can never open the page to everyone
  for (const bad of ['*', 'http://*', 'javascript:alert(1)', "'self'", 'http://evil.com/path', 'https://a b']) {
    const h = pageHeaders(4500, [bad]);
    assert.match(h['content-security-policy'], /frame-ancestors 'none'/, `ignored: ${bad}`);
    assert.equal(h['x-frame-options'], 'DENY');
  }
});

test('dev-instance args: defaults, flags, and clear errors', () => {
  const o = lib.parseArgs([], {}, '/home/u');
  assert.deepEqual([o.port, o.watch, o.fake, o.parents], [4500, true, false, []]);
  assert.equal(o.stableData, '/home/u/.designer-chat');
  assert.equal(lib.parseArgs([], { DESIGNER_DATA: '/d' }, '/home/u').stableData, '/d');
  const f = lib.parseArgs(['--port', '4800', '--no-watch', '--fake', '--parent', 'http://localhost:4317', '--worktree', 'try-1'], {}, '/h');
  assert.deepEqual([f.port, f.watch, f.fake, f.parents, f.worktree], [4800, false, true, ['http://localhost:4317'], 'try-1']);
  assert.throws(() => lib.parseArgs(['--port', 'abc']), /--port/);
  assert.throws(() => lib.parseArgs(['--port', '80']), /--port/);
  assert.throws(() => lib.parseArgs(['--parent', '*']), /--parent/);
  assert.throws(() => lib.parseArgs(['--parent', 'http://x/']), /--parent/);
  assert.throws(() => lib.parseArgs(['--bogus']), /unknown option/);
  assert.throws(() => lib.parseArgs(['--dir']), /needs a value/);
  assert.throws(() => lib.parseArgs(['--dir', '/a', '--worktree', 'b']), /not both/);
});

test('dev-instance: worktree lookup finds exactly one, explains none, refuses ambiguity and bad names', () => {
  const data = tmp();
  mkdirSync(join(data, 'worktrees', 'designer', 'try-1'), { recursive: true });
  mkdirSync(join(data, 'worktrees', 'designer', 'only-here'), { recursive: true });
  mkdirSync(join(data, 'worktrees', 'other', 'try-1'), { recursive: true });
  assert.equal(lib.findWorktree(data, 'only-here'), join(data, 'worktrees', 'designer', 'only-here'));
  assert.throws(() => lib.findWorktree(data, 'try-1'), /several repos/);
  assert.throws(() => lib.findWorktree(data, 'missing'), /Create it in Designer first/);
  assert.throws(() => lib.findWorktree(data, '../x'), /bad worktree name/);
  assert.throws(() => lib.findWorktree(tmp(), 'x'), /no worktree/);
});

test('dev-instance: ports come in free pairs and skip busy ones; env keeps instances apart', async () => {
  const start = 31000 + Math.floor(Math.random() * 2000) * 2;
  const busy = await new Promise<import('node:net').Server>((res) => {
    const s = createServer().listen(start + 1, '127.0.0.1', () => res(s)); // the preview port of the first pair
  });
  const p = await lib.findPorts(start);
  assert.ok(p > start, 'skips a pair whose preview port is taken');
  busy.close();
  const env = lib.instanceEnv({ PREVIEW_PORT: '9', DESIGNER_FAKE: '1', KEEP: 'x', ANTHROPIC_API_KEY: 'k' }, { port: 4500, data: '/d', cwd: '/c', parents: ['http://localhost:4317'], fake: false });
  assert.deepEqual([env.PORT, env.DESIGNER_DATA, env.DESIGNER_CWD, env.DESIGNER_FRAME_ANCESTORS, env.KEEP], ['4500', '/d', '/c', 'http://localhost:4317', 'x']);
  assert.equal(env.PREVIEW_PORT, undefined);
  assert.equal(env.DESIGNER_FAKE, undefined);
  assert.equal(lib.instanceEnv({}, { port: 1, data: '', cwd: '', parents: [], fake: true }).DESIGNER_FAKE, '1');
  // hot-reload mode: the UI server and the API know about each other; otherwise stale values are cleared
  const hot = lib.instanceEnv({ DESIGNER_UI_PORT: '1' }, { port: 4500, data: '/d', cwd: '/c', parents: [], fake: false, uiPort: 4502 });
  assert.deepEqual([hot.DESIGNER_DEV_PORT, hot.DESIGNER_UI_PORT, hot.DESIGNER_API_PORT], ['4502', '4502', '4500']);
  const cold = lib.instanceEnv({ DESIGNER_UI_PORT: '1', DESIGNER_DEV_PORT: '2', DESIGNER_API_PORT: '3' }, { port: 4500, data: '/d', cwd: '/c', parents: [], fake: false });
  assert.deepEqual([cold.DESIGNER_DEV_PORT, cold.DESIGNER_UI_PORT, cold.DESIGNER_API_PORT], [undefined, undefined, undefined]);
});

test('dev-instance script: runs the real server on its own ports/data, allows only the stable app to frame it, and stops cleanly', async (t) => {
  const data = tmp();
  const port = await lib.findPorts(32000 + Math.floor(Math.random() * 1000) * 2);
  const child = spawn(process.execPath, [join(scripts, 'dev-instance.mjs'), '--no-watch', '--fake', '--port', String(port), '--data', data, '--parent', 'http://localhost:4317'], {
    cwd: join(scripts, '..'), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  t.after(() => {
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* gone */ }
  });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  const link = await new Promise<string>((res, rej) => {
    const timer = setTimeout(() => rej(new Error('instance did not start:\n' + out)), 60000);
    const poll = setInterval(() => {
      const m = /Open:\s+(http:\/\/localhost:\d+\/\?t=[0-9a-f]{64})/.exec(out);
      if (m) (clearInterval(poll), clearTimeout(timer), res(m[1]));
    }, 100);
    child.on('exit', () => rej(new Error('script exited early:\n' + out)));
  });
  assert.ok(link.startsWith(`http://localhost:${port}/?t=`));
  const token = link.split('t=')[1];
  assert.equal(readFileSync(join(data, 'token'), 'utf8').trim(), token, 'uses its own data dir and token');

  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(page.headers.get('content-security-policy')!, /frame-ancestors http:\/\/localhost:4317/);
  assert.equal(page.headers.get('x-frame-options'), null);
  assert.equal(await new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?t=${token}`);
    ws.on('open', () => (ws.close(), res('open')));
    ws.on('error', () => res('refused'));
  }), 'open');
  assert.equal(await new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?t=${'0'.repeat(64)}`);
    ws.on('open', () => (ws.close(), res('open')));
    ws.on('error', () => res('refused'));
  }), 'refused', 'the stable instance token does not work here and vice versa');

  // Ctrl-C stops everything it started
  process.kill(child.pid!, 'SIGTERM');
  await new Promise((r) => child.once('exit', r));
  await new Promise((r) => setTimeout(r, 500));
  const stillUp = await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false);
  assert.equal(stillUp, false, 'no leftover server after stopping');
});

test('dev-instance script: refuses a folder that is not Designer, with a clear message', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'package.json'), '{"name":"other"}');
  const r = await new Promise<{ code: number | null; out: string }>((res) => {
    const c = spawn(process.execPath, [join(scripts, 'dev-instance.mjs'), '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('exit', (code) => res({ code, out }));
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /is not a Designer checkout/);
});
