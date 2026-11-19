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

// ---------- updater: real git repositories, npm stubbed ----------
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const updater: any = await import(join(fileURLToPath(new URL('../../desktop/', import.meta.url)), 'updater.mjs'));
const sh = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd }).toString().trim();

/** origin (bare) + an installed copy on main + a second clone used to publish new commits. */
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'upd-')));
  const origin = join(base, 'origin.git');
  mkdirSync(origin);
  sh(origin, 'init', '-q', '--bare', '-b', 'main');
  const publisher = join(base, 'publisher');
  sh(base, 'clone', '-q', origin, publisher);
  writeFileSync(join(publisher, 'package.json'), '{"name":"designer"}');
  writeFileSync(join(publisher, 'a.txt'), '1');
  sh(publisher, 'add', '.');
  sh(publisher, 'commit', '-qm', 'first');
  sh(publisher, 'push', '-q', 'origin', 'HEAD:main');
  const root = join(base, 'installed');
  sh(base, 'clone', '-q', origin, root);
  const publish = (file: string, content: string, msg: string) => {
    writeFileSync(join(publisher, file), content);
    sh(publisher, 'add', '.');
    sh(publisher, 'commit', '-qm', msg);
    sh(publisher, 'push', '-q', 'origin', 'HEAD:main');
  };
  return { root, publish, publisher, origin };
}
/** Real git, fake npm: records the calls, optionally failing one. */
function stubbed(fail?: string, times = Infinity) {
  const calls: string[] = [];
  let failures = 0;
  const r = (cmd: string, args: string[], o: unknown) => {
    if (cmd !== 'npm') return updater.run(cmd, args, o);
    const line = args.join(' ');
    calls.push(line);
    return fail && line.startsWith(fail) && failures++ < times ? Promise.reject(Object.assign(new Error('boom'), { stderr: 'build exploded' })) : Promise.resolve('');
  };
  return { r, calls };
}

test('updater: up to date, then behind; shows what is new', async () => {
  const f = fixture();
  assert.equal((await updater.checkForUpdate({ root: f.root })).behind, 0);
  assert.equal(updater.blocker(await updater.checkForUpdate({ root: f.root })), 'Already up to date.');
  f.publish('a.txt', '2', 'Add the inspector');
  f.publish('b.txt', 'x', 'Fix a bug');
  const c = await updater.checkForUpdate({ root: f.root });
  assert.equal(c.behind, 2);
  assert.deepEqual(c.commits.map((l: string) => l.replace(/^\w+ /, '')), ['Fix a bug', 'Add the inspector']);
  assert.equal(updater.blocker(c), undefined);
});

test('updater: fast-forwards and rebuilds; reinstalls only when dependencies changed', async () => {
  const f = fixture();
  f.publish('a.txt', '2', 'code change');
  const s1 = stubbed();
  const ok = await updater.applyUpdate({ root: f.root, r: s1.r });
  assert.equal(ok.ok, true);
  assert.equal(ok.installed, false);
  assert.deepEqual(s1.calls, ['run build']);
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), '2');
  assert.equal(sh(f.root, 'rev-parse', 'HEAD'), sh(f.publisher, 'rev-parse', 'HEAD'));

  f.publish('package.json', '{"name":"designer","dependencies":{"x":"1"}}', 'add a dependency');
  const s2 = stubbed();
  const ok2 = await updater.applyUpdate({ root: f.root, r: s2.r });
  assert.equal(ok2.installed, true);
  assert.deepEqual(s2.calls, ['install --no-audit --no-fund', 'run build']);
  assert.equal((await updater.applyUpdate({ root: f.root, r: stubbed().r })).error, 'Already up to date.');
});

test('updater: a failed build puts the checkout back exactly as it was', async () => {
  const f = fixture();
  const before = sh(f.root, 'rev-parse', 'HEAD');
  f.publish('a.txt', '2', 'breaks the build');
  const s = stubbed('run build', 1); // the new version's build fails once; rebuilding the old one works
  const bad = await updater.applyUpdate({ root: f.root, r: s.r });
  assert.equal(bad.ok, false);
  assert.equal(bad.rolledBack, true);
  assert.equal(bad.rebuilt, true);
  assert.deepEqual(s.calls, ['run build', 'run build']);
  assert.match(bad.error, /undone/);
  assert.match(bad.error, /build exploded/);
  assert.equal(sh(f.root, 'rev-parse', 'HEAD'), before, 'back on the previous commit');
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), '1');
  assert.equal(sh(f.root, 'status', '--porcelain'), '', 'and clean');
});

test('updater refuses, and changes nothing, when the copy is dirty, off main, or has diverged', async () => {
  const f = fixture();
  f.publish('a.txt', '2', 'new');
  const head = sh(f.root, 'rev-parse', 'HEAD');
  // uncommitted work
  writeFileSync(join(f.root, 'a.txt'), 'my edit');
  let r = await updater.applyUpdate({ root: f.root, r: stubbed().r });
  assert.equal(r.ok, false);
  assert.match(r.error, /uncommitted changes/);
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'my edit', 'your edit is untouched');
  sh(f.root, 'checkout', '-q', '--', 'a.txt');
  // a different branch
  sh(f.root, 'switch', '-q', '-c', 'feat/x');
  r = await updater.applyUpdate({ root: f.root, r: stubbed().r });
  assert.match(r.error, /not main/);
  sh(f.root, 'switch', '-q', 'main');
  // local commits origin does not have
  writeFileSync(join(f.root, 'local.txt'), 'mine');
  sh(f.root, 'add', '.');
  sh(f.root, 'commit', '-qm', 'local only');
  const mine = sh(f.root, 'rev-parse', 'HEAD');
  r = await updater.applyUpdate({ root: f.root, r: stubbed().r });
  assert.match(r.error, /cannot move forward cleanly/);
  assert.equal(sh(f.root, 'rev-parse', 'HEAD'), mine, 'your local commit is untouched');
  assert.notEqual(head, mine);
});

test('updater: if the restore itself cannot rebuild, you are told so (nothing is hidden behind "undone")', async () => {
  const f = fixture();
  const before = sh(f.root, 'rev-parse', 'HEAD');
  f.publish('a.txt', '2', 'breaks the build');
  const bad = await updater.applyUpdate({ root: f.root, r: stubbed('run build').r }); // every build fails
  assert.equal(bad.ok, false);
  assert.equal(bad.rolledBack, true);
  assert.equal(bad.rebuilt, false);
  assert.doesNotMatch(bad.error, /was undone/);
  assert.match(bad.error, /rebuilding it failed/);
  assert.match(bad.error, /npm install && npm run build/);
  assert.equal(sh(f.root, 'rev-parse', 'HEAD'), before, 'the code is still back on the previous commit');
});

test('updater env: login-shell PATH is added and Anthropic credentials never reach npm install scripts', () => {
  const env = lib.updateEnv({ PATH: '/usr/bin', HOME: '/h', ANTHROPIC_API_KEY: 'sk-secret', ANTHROPIC_AUTH_TOKEN: 'tok' }, '/opt/homebrew/bin:/usr/bin');
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.PATH, '/opt/homebrew/bin:/usr/bin');
  assert.equal(env.HOME, '/h');
  assert.equal(lib.updateEnv({ PATH: '/usr/bin' }, undefined).PATH, '/usr/bin');
});
