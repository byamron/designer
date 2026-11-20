// Designer.app, built and launched for real (macOS only; skipped elsewhere):  node e2e/app.e2e.mjs
// Builds a Designer.app from this checkout into a temp folder, then checks name, server environment, quit, the
// "checkout is missing" message and the "rebuild after an Electron bump" prompt. Does not touch /Applications.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
if (process.platform !== 'darwin') {
  console.log('skipped: Designer.app is macOS only');
  process.exit(0);
}
const { _electron } = createRequire(import.meta.url)('playwright');
const log = (m) => console.log('ok -', m);
const root = resolve(new globalThis.URL('..', import.meta.url).pathname);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const lib = await import(join(root, 'packages', 'desktop', 'lib.mjs'));

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' });
const work = realpathSync(mkdtempSync(join(tmpdir(), 'designer-app-')));
const bundle = join(work, 'Designer.app');
const exe = join(bundle, 'Contents', 'MacOS', 'Designer');
execFileSync('node', [join(root, 'scripts', 'make-app.mjs'), '--out', bundle], { stdio: 'pipe' });
execFileSync('codesign', ['--verify', '--deep', '--strict', bundle]);
log('npm run make-app builds a bundle whose signature verifies');

const data = join(work, 'data');
const userData = join(work, 'user');
const repo = join(work, 'repo');
execFileSync('git', ['init', '-q', '-b', 'main', repo]);
const dialogLog = join(work, 'dialogs.log');
writeFileSync(dialogLog, '');
// what a Dock launch looks like: no Homebrew/nvm on PATH, and (here) credentials present that must not reach the server
const env = { HOME: process.env.HOME, SHELL: process.env.SHELL ?? '/bin/zsh', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ANTHROPIC_API_KEY: 'sk-test-must-not-reach-the-server', ANTHROPIC_AUTH_TOKEN: 'tok-test-must-not-reach-the-server', DESIGNER_NO_UPDATE_CHECK: '1', DESIGNER_TEST_DIALOG: 'Later', DESIGNER_TEST_DIALOG_LOG: dialogLog, PORT: '4900', DESIGNER_DATA: data, DESIGNER_USER_DATA: userData, DESIGNER_FAKE: '1', DESIGNER_CWD: repo };
const envOf = (pid) => Object.fromEntries(execFileSync('ps', ['-wwE', '-o', 'command=', '-p', String(pid)]).toString().split(' ').filter((t) => /^[A-Z_][A-Z0-9_]*=/.test(t)).map((t) => [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)]));

let app = await _electron.launch({ executablePath: exe, args: ['--no-sandbox'], env, timeout: 90000 });
try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Add folder' }).waitFor({ timeout: 60000 });
  assert.equal(await app.evaluate(({ app }) => app.getName()), 'Designer');
  assert.equal(await app.evaluate(() => process.execPath), exe, 'running from the bundle');
  log('Designer.app opens the app window, named Designer');

  const serverPid = Number(readFileSync(join(data, 'desktop-server.pid'), 'utf8'));
  const serverEnv = envOf(serverPid);
  assert.ok(serverEnv.DESIGNER_DATA, 'read the server process environment');
  assert.ok(!('ANTHROPIC_API_KEY' in serverEnv) && !('ANTHROPIC_AUTH_TOKEN' in serverEnv), 'no Anthropic credentials in the server environment');
  const shellPath = await lib.loginShellPath();
  assert.ok(shellPath, 'this Mac has a login-shell PATH');
  const first = shellPath.split(':').find((p) => !['/usr/bin', '/bin', '/usr/sbin', '/sbin'].includes(p));
  assert.ok(!first || serverEnv.PATH.split(':').includes(first), `the server's PATH has your login-shell PATH (${first}) although the app was started with only /usr/bin:/bin`);
  log('started with a bare Dock-style PATH, the server still gets your login-shell PATH and no Anthropic credentials');

  // single instance, then quit stops the server
  const second = spawn(exe, ['--no-sandbox'], { env, stdio: 'ignore' });
  const code = await new Promise((r) => { second.on('exit', r); setTimeout(() => (second.kill('SIGKILL'), r('timeout')), 30000); });
  assert.notEqual(code, 'timeout', 'a second launch exits by itself');
  assert.equal(Number(readFileSync(join(data, 'desktop-server.pid'), 'utf8')), serverPid, 'and did not start another server');
  log('a second launch exits and leaves the running app alone');
  await app.evaluate(({ app }) => app.quit());
  for (let i = 0; i < 80 && alive(serverPid); i++) await sleep(100);
  assert.equal(alive(serverPid), false, 'the server stopped with the app');
  log('quitting the app stops the server');
} finally {
  try { await app.close(); } catch { /* already closed */ }
}

// the checkout is missing or moved: a plain message that says what to do, then Quit
writeFileSync(dialogLog, '');
const gone = join(work, 'moved-away');
const lost = spawn(exe, ['--no-sandbox'], { env: { ...env, DESIGNER_CHECKOUT: gone, DESIGNER_TEST_DIALOG: 'Quit' }, stdio: 'ignore' });
const lostCode = await new Promise((r) => { lost.on('exit', r); setTimeout(() => (lost.kill('SIGKILL'), r('timeout')), 30000); });
assert.notEqual(lostCode, 'timeout', 'quits after the message');
const shown = JSON.parse(readFileSync(dialogLog, 'utf8').trim().split('\n')[0]);
assert.ok(shown.detail.includes(gone) && shown.detail.includes('npm run make-app'), `names the missing folder and the fix: ${shown.detail}`);
log('a missing or moved checkout shows what it looked for and how to fix it');

// Electron bump: make the bundle look like it was built for another Electron, launch, accept the rebuild prompt
const infoFile = join(bundle, 'Contents', 'Resources', 'designer.json');
const info = JSON.parse(readFileSync(infoFile, 'utf8'));
writeFileSync(infoFile, JSON.stringify({ ...info, electron: '0.0.1' }));
writeFileSync(dialogLog, '');
const stale = spawn(exe, ['--no-sandbox'], { env: { ...env, DESIGNER_TEST_DIALOG: 'Rebuild & Restart' }, stdio: 'ignore' });
let rebuilt = false;
for (let i = 0; i < 300 && !rebuilt; i++) {
  await sleep(200);
  rebuilt = JSON.parse(readFileSync(infoFile, 'utf8')).electron === info.electron;
}
assert.ok(rebuilt, 'the bundle was rebuilt for the installed Electron');
assert.match(readFileSync(dialogLog, 'utf8'), /Electron .*0\.0\.1/, 'the prompt said why');
execFileSync('codesign', ['--verify', '--deep', '--strict', bundle]);
// it relaunches itself from the new bundle and comes up healthy
const pid1 = Number(readFileSync(join(data, 'desktop-server.pid'), 'utf8')); // the old app's server, or already the new one's
for (let i = 0; i < 300 && Number(readFileSync(join(data, 'desktop-server.pid'), 'utf8')) === pid1; i++) await sleep(200);
assert.notEqual(Number(readFileSync(join(data, 'desktop-server.pid'), 'utf8')), pid1, 'a new server was started by the relaunched app');
log('a bundle built for another Electron offers a rebuild, rebuilds with a valid signature and relaunches');
stale.kill();
try { execFileSync('pkill', ['-f', `${bundle}/Contents/MacOS/Designer`], { stdio: 'ignore' }); } catch { /* nothing left running */ }
console.log('all passed');
