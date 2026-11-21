// Rolling back a bad update, for real (macOS only):  node e2e/rollback.e2e.mjs
// A scratch "origin" and a stable clone with its own Designer.app (built from a copy of this working tree). Then:
//  1. Update & Restart to a version that builds and starts but is unwanted -> Designer > Roll Back to Previous Version…
//     puts the checkout, the build and the running app back; the skipped version is not offered again by the quiet check.
//  2. An update that builds but breaks the app's own code -> the app fails to start twice -> the error offers the rollback.
// Nothing outside the temp folder is touched (not /Applications, not your real data, not this checkout's git).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd }).toString().trim();
const waitFor = async (what, fn, ms = 120000) => {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(250);
  }
};

const work = realpathSync(mkdtempSync(join(tmpdir(), 'designer-rollback-')));
const pub = join(work, 'pub');
const stable = join(work, 'stable');
const origin = join(work, 'origin.git');
const bundle = join(work, 'Designer.app');
const exe = join(bundle, 'Contents', 'MacOS', 'Designer');
const data = join(work, 'data');
const userData = join(work, 'user');
const dialogLog = join(work, 'dialogs.log');
const record = join(userData, 'previous-version.json');
const dismissed = join(userData, 'update-dismissed.txt');
const PORT = '4906';
const dialogs = () => readFileSync(dialogLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const killApp = () => { try { execFileSync('pkill', ['-f', `${bundle}/Contents`], { stdio: 'ignore' }); } catch { /* nothing running */ } };
const uiHas = async (text) => {
  const html = await (await fetch(`http://localhost:${PORT}/`)).text();
  const js = /assets\/index-[^"]+\.js/.exec(html)?.[0];
  return js ? (await (await fetch(`http://localhost:${PORT}/${js}`)).text()).includes(text) : false;
};
const env = (answer) => ({ HOME: process.env.HOME, SHELL: process.env.SHELL ?? '/bin/zsh', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ANTHROPIC_API_KEY: 'sk-test-must-not-reach-anything', PORT, DESIGNER_DATA: data, DESIGNER_USER_DATA: userData, DESIGNER_FAKE: '1', DESIGNER_CWD: pub, DESIGNER_TEST_DIALOG: answer, DESIGNER_TEST_DIALOG_LOG: dialogLog });
const publish = (file, edit, msg) => {
  const p = join(pub, file);
  writeFileSync(p, edit(readFileSync(p, 'utf8')));
  git(pub, 'commit', '-qam', msg);
  git(pub, 'push', '-q', 'origin', 'HEAD:main');
  return git(pub, 'rev-parse', 'HEAD');
};

try {
  // ---- a scratch origin, a stable clone, and an app built from it ----
  cpSync(root, pub, { recursive: true, filter: (p) => !/(^|\/)(node_modules|dist|\.git|\.data)(\/|$)/.test(p.slice(root.length)) });
  git(pub, 'init', '-q', '-b', 'main');
  git(pub, 'add', '-A');
  git(pub, 'commit', '-qm', 'v1: the version you like');
  git(work, 'clone', '-q', '--bare', pub, origin);
  git(pub, 'remote', 'add', 'origin', origin);
  git(pub, 'fetch', '-q', 'origin');
  git(pub, 'branch', '-q', '-u', 'origin/main');
  git(work, 'clone', '-q', origin, stable);
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: stable, stdio: 'ignore' });
  execFileSync('node', [join(stable, 'scripts', 'make-app.mjs'), '--out', bundle], { cwd: stable, stdio: 'pipe' });
  writeFileSync(dialogLog, '');
  const v1 = git(stable, 'rev-parse', 'HEAD');
  log('scratch origin, stable clone and its own Designer.app are ready');

  // ---- 1. an update that works but is not wanted ----
  const v2 = publish('packages/web/src/Composer.tsx', (s) => s.replace("'Message Claude…'", "'Message Claude (v2)…'"), 'v2: the unwanted one');
  const first = spawn(exe, ['--no-sandbox'], { env: env('Update & Restart'), stdio: 'ignore' });
  await waitFor('the update to be applied and recorded', () => git(stable, 'rev-parse', 'HEAD') === v2 && existsSync(record));
  const rec = JSON.parse(readFileSync(record, 'utf8'));
  assert.deepEqual([rec.from, rec.to, rec.installed], [v1, v2, false]);
  await waitFor('the relaunched app to start on v2 and be marked as working', () => JSON.parse(readFileSync(record, 'utf8')).healthy === true);
  assert.equal(await uiHas('Message Claude (v2)'), true, 'the app now runs v2');
  log('Update & Restart recorded the previous version (from, to, time, whether packages changed) and v2 started fine');
  first.kill();
  killApp();
  await sleep(1500);

  writeFileSync(dialogLog, '');
  const app = await _electron.launch({ executablePath: exe, args: ['--no-sandbox'], env: env('Roll Back & Restart'), timeout: 90000 });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Add folder' }).waitFor({ timeout: 60000 });
  const item = () => app.evaluate(({ Menu }) => {
    const find = (m) => m.items.flatMap((i) => [i, ...(i.submenu ? find(i.submenu) : [])]);
    const i = find(Menu.getApplicationMenu()).find((x) => x.label === 'Roll Back to Previous Version…');
    return i ? { enabled: i.enabled } : null;
  });
  await waitFor('the menu item to be enabled', async () => (await item())?.enabled === true, 20000);
  log('Designer > Roll Back to Previous Version… exists and is enabled once a previous version is recorded');
  // a dirty copy disables it. The item is re-checked when a window gains focus (at most every 2 s); emit that event the way focus does.
  const focus = () => app.evaluate(({ app, BrowserWindow }) => app.emit('browser-window-focus', {}, BrowserWindow.getAllWindows()[0]));
  writeFileSync(join(stable, 'package.json'), readFileSync(join(stable, 'package.json'), 'utf8') + '\n');
  await sleep(2100);
  await focus();
  await waitFor('the menu item to be disabled while the copy has uncommitted changes', async () => (await item())?.enabled === false, 20000);
  log('and it is disabled while the checkout has uncommitted changes');
  git(stable, 'checkout', '-q', '--', 'package.json');
  await sleep(2100);
  await focus();
  await waitFor('the menu item to be enabled again', async () => (await item())?.enabled === true, 20000);

  await app.evaluate(({ Menu }) => {
    const find = (m) => m.items.flatMap((i) => [i, ...(i.submenu ? find(i.submenu) : [])]);
    find(Menu.getApplicationMenu()).find((x) => x.label === 'Roll Back to Previous Version…').click();
  });
  await waitFor('main to move back to v1', () => git(stable, 'rev-parse', 'HEAD') === v1);
  const shown = dialogs().find((d) => /Roll back Designer/.test(d.message));
  assert.ok(shown, 'the confirmation was shown');
  assert.ok(shown.detail.includes('v2: the unwanted one') && shown.detail.includes('v1: the version you like') && /chats and settings are kept/.test(shown.detail), `it names both versions and says chats are kept:\n${shown.detail}`);
  await waitFor('the record to be consumed', () => !existsSync(record));
  assert.equal(readFileSync(dismissed, 'utf8').trim(), v2, 'v2 is recorded as skipped');
  assert.equal(git(stable, 'rev-parse', 'origin/main'), v2, 'origin/main untouched: the copy can fast-forward again');
  assert.equal(git(stable, 'status', '--porcelain'), '', 'the copy is clean');
  assert.equal(git(stable, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  log('rolling back moved main to v1 (git reset --keep), rebuilt the UI, recorded v2 as skipped, left origin/main alone');
  await waitFor('the relaunched app to serve the old UI', async () => (await uiHas('Message Claude (v2)')) === false && (await uiHas('Message Claude…')) === true, 90000);
  await sleep(9000); // the quiet update check runs ~5 s after launch; it must stay silent about v2
  assert.ok(!dialogs().some((d) => /new version of Designer is available/.test(d.message)), 'the version we rolled back from was not offered again');
  log('the relaunched app runs v1 and does not offer the skipped version again');
  killApp();
  await sleep(1500);

  // ---- 2. an update that builds but breaks the app's own code ----
  writeFileSync(dialogLog, '');
  const v3 = publish('packages/desktop/main.mjs', (s) => `throw new Error('broken on purpose');\n${s}`, 'v3: breaks the app');
  spawn(exe, ['--no-sandbox'], { env: env('Update & Restart'), stdio: 'ignore' });
  await waitFor('the broken update to be applied', () => git(stable, 'rev-parse', 'HEAD') === v3, 120000);
  await waitFor('the first failed start to be shown', () => dialogs().some((d) => /can't start/.test(d.message) && /broken on purpose/.test(d.detail)));
  assert.equal(JSON.parse(readFileSync(record, 'utf8')).attempts, 1);
  assert.ok(!dialogs().some((d) => /isn't starting/.test(d.message)), 'one failed start does not offer the rollback yet');
  log('a broken update fails to start; the first failure is explained, with no rollback offered yet');
  await sleep(1500);
  spawn(exe, ['--no-sandbox'], { env: env('Roll Back to Previous Version'), stdio: 'ignore' });
  await waitFor('the second failure to offer the rollback and main to go back', () => git(stable, 'rev-parse', 'HEAD') === v1, 120000);
  const offer = dialogs().find((d) => /isn't starting/.test(d.message));
  assert.ok(offer && offer.detail.includes('broken on purpose') && offer.detail.includes('v3: breaks the app') && offer.detail.includes('v1: the version you like'), `the error dialog offers the rollback and names both versions:\n${JSON.stringify(offer)}`);
  await waitFor('the relaunched app to be healthy again', async () => (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) && !existsSync(record), 90000);
  assert.equal(readFileSync(dismissed, 'utf8').trim(), v3);
  log('after two failed starts the error dialog offers the rollback; accepting it restores v1 and the app starts');
  console.log('all passed');
  await app.close().catch(() => {});
} finally {
  killApp();
}
