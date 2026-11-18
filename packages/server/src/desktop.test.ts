// Pure helpers of the desktop shell (packages/desktop/lib.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const lib: any = await import(join(fileURLToPath(new URL('../../desktop/', import.meta.url)), 'lib.mjs'));

test('external links: only web and mail links ever reach the operating system', () => {
  for (const ok of ['https://example.com/x', 'http://localhost:3000', 'mailto:a@b.co']) assert.equal(lib.isSafeExternal(ok), true, ok);
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'smb://host/share', 'ssh://x', 'x-apple.systempreferences:', '', 'not a url']) assert.equal(lib.isSafeExternal(bad), false, bad);
});

test('the window may only stay on the app origin', () => {
  const o = 'http://localhost:4317';
  assert.equal(lib.sameOrigin('http://localhost:4317/anything?t=1', o), true);
  for (const bad of ['http://localhost:4318/', 'http://127.0.0.1:4317/', 'https://localhost:4317/', 'http://localhost.evil.com:4317/', 'http://localhost:4317@evil.com/', 'junk']) assert.equal(lib.sameOrigin(bad, o), false, bad);
});

test('login-shell PATH is extracted from noisy output and merged without duplicates', () => {
  const noisy = 'Last login: today\nwelcome to zsh!\n__DESIGNER_PATH_START__/opt/homebrew/bin:/usr/bin:/Users/me/.nvm/bin__DESIGNER_PATH_END__\nbye\n';
  assert.equal(lib.parseShellPath(noisy), '/opt/homebrew/bin:/usr/bin:/Users/me/.nvm/bin');
  assert.equal(lib.parseShellPath('no markers here'), undefined);
  assert.equal(lib.parseShellPath('__DESIGNER_PATH_START____DESIGNER_PATH_END__'), undefined);
  assert.equal(lib.mergePaths('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin'), '/opt/homebrew/bin:/usr/bin:/bin');
  assert.equal(lib.mergePaths('/usr/bin', undefined), '/usr/bin');
  assert.equal(lib.mergePaths(undefined, '/a'), '/a');
});

test('login-shell PATH: asks the shell, survives failure and timeout', async () => {
  const ok = await lib.loginShellPath({ shell: '/bin/sh', run: (_s: string, _a: string[], _o: unknown, cb: Function) => cb(null, 'x__DESIGNER_PATH_START__/a:/b__DESIGNER_PATH_END__y') });
  assert.equal(ok, '/a:/b');
  assert.equal(await lib.loginShellPath({ run: (_s: string, _a: string[], _o: unknown, cb: Function) => cb(new Error('boom'), '') }), undefined);
  // a real shell, if there is one: must return a PATH containing the shell's own bin directories
  const real = await lib.loginShellPath({ shell: '/bin/bash' });
  assert.ok(!real || real.includes('/usr/bin'), 'real login shell gives a usable PATH');
});

test('ports: a free pair is found, skipping busy ones', async () => {
  const start = 33000 + Math.floor(Math.random() * 1000) * 2;
  const busy = await new Promise<import('node:net').Server>((res) => { const s = createServer().listen(start, '127.0.0.1', () => res(s)); });
  const p = await lib.findPort(start);
  assert.ok(p > start && p % 2 === start % 2);
  busy.close();
});

test('window bounds: corrupt or off-screen saved state cannot hide the window', () => {
  const screens = [{ x: 0, y: 0, width: 1440, height: 900 }];
  assert.deepEqual(lib.sanitizeBounds({ x: 100, y: 80, width: 1200, height: 800 }, screens), { x: 100, y: 80, width: 1200, height: 800 });
  assert.deepEqual(lib.sanitizeBounds({ x: 5000, y: 80, width: 1200, height: 800 }, screens), { width: 1200, height: 800 }, 'monitor unplugged: keep size, let the OS place it');
  assert.deepEqual(lib.sanitizeBounds({ x: 100, y: 2000, width: 1200, height: 800 }, screens), { width: 1200, height: 800 });
  for (const bad of [undefined, null, {}, { x: 'a', y: 0, width: 900, height: 700 }, { x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 99999, height: 700 }, { x: NaN, y: 0, width: 900, height: 700 }]) assert.equal(lib.sanitizeBounds(bad, screens), undefined, JSON.stringify(bad));
});

test('server crash restarts back off, then give up', () => {
  assert.deepEqual([0, 1, 2].map(lib.restartDelay), [300, 1000, 3000]);
  assert.equal(lib.restartDelay(3), null);
});
