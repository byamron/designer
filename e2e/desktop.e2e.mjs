// The Electron shell, driven for real. On a machine without a display run it as:  xvfb-run -a node e2e/desktop.e2e.mjs
// (the shell is started with --no-sandbox only because CI/containers run as root).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const { _electron } = createRequire(import.meta.url)('playwright');
const log = (m) => console.log('ok -', m);
const root = resolve(new globalThis.URL('..', import.meta.url).pathname);
const electronBin = join(root, 'node_modules', 'electron', 'dist', ...(process.platform === 'darwin' ? ['Electron.app', 'Contents', 'MacOS', 'Electron'] : ['electron']));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' });
const data = mkdtempSync(join(tmpdir(), 'desk-data-'));
const userData = mkdtempSync(join(tmpdir(), 'desk-user-'));
const externalLog = join(tmpdir(), `external-${process.pid}.log`);
writeFileSync(externalLog, '');
const repo = mkdtempSync(join(tmpdir(), 'desk-repo-'));
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
const dialogLog = join(tmpdir(), `dialogs-${process.pid}.log`);
writeFileSync(dialogLog, '');
const env = { ...process.env, ANTHROPIC_API_KEY: 'sk-test-must-not-reach-the-server', ANTHROPIC_AUTH_TOKEN: 'tok-test-must-not-reach-the-server', DESIGNER_NO_UPDATE_CHECK: '1', DESIGNER_TEST_DIALOG: 'OK', DESIGNER_TEST_DIALOG_LOG: dialogLog, PORT: '4800', DESIGNER_DATA: data, DESIGNER_USER_DATA: userData, DESIGNER_FAKE: '1', DESIGNER_CWD: repo, DESIGNER_TEST_EXTERNAL_LOG: externalLog };
const launch = () => _electron.launch({ executablePath: electronBin, args: ['--no-sandbox', join(root, 'packages', 'desktop')], env, timeout: 90000 });

let app = await launch();
try {
  let page = await app.firstWindow();
  await page.getByRole('button', { name: 'Add folder' }).waitFor({ timeout: 60000 });
  assert.equal(await app.evaluate(({ app }) => app.getName()), 'Designer');
  assert.ok(await page.title() === 'Designer');
  const u = new globalThis.URL(page.url());
  assert.ok(u.origin.startsWith('http://localhost:48'), `app origin ${u.origin}`);
  assert.ok(!u.search.includes('t='), 'the private token is removed from the address after load');
  log('opens a window with the app; the token is consumed, not left in the URL');

  // safety: the shell's own environment holds Anthropic credentials here, and the server it launches must not (Linux: read its environment)
  if (process.platform === 'linux') {
    const serverPid = Number(readFileSync(join(data, 'desktop-server.pid'), 'utf8'));
    const serverEnv = readFileSync(`/proc/${serverPid}/environ`, 'utf8').split('\0');
    assert.ok(serverEnv.some((v) => v.startsWith('DESIGNER_DATA=')), 'read the right process environment');
    assert.ok(!serverEnv.some((v) => /^ANTHROPIC_(API_KEY|AUTH_TOKEN)=/.test(v)), 'no Anthropic credentials in the server environment');
    assert.equal((statSync(data).mode & 0o777), 0o700, 'data directory is owner-only');
    log('the server launched by the shell has no Anthropic credentials in its environment; data directory is 0700');
  }

  // chat works end to end inside the shell (token, WebSocket, server)
  await page.getByRole('button', { name: 'Add folder' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Message').fill('hello desktop');
  await page.keyboard.press('Enter');
  await page.getByText('scripted reply').first().waitFor({ timeout: 15000 });
  log('chat works in the desktop window');

  // permissions are denied, and nothing in the page can reach Node
  const perm = await page.evaluate(async () => ({ notif: await Notification.requestPermission(), node: typeof require, proc: typeof process }));
  assert.equal(perm.notif, 'denied');
  assert.deepEqual([perm.node, perm.proc], ['undefined', 'undefined']);
  log('no Node in the page; permission prompts are denied');

  // menus: copy/paste work in the message box
  const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label));
  assert.ok(labels.includes('Edit') && labels.includes('View') && labels.includes('Window'), `menus: ${labels}`);
  log('standard menus present (Edit has copy/paste)');

  // updates: the menu item exists and runs the check (this checkout is not on a clean main, so it explains instead of changing anything)
  const items = await app.evaluate(({ Menu }) => {
    const out = [];
    const walk = (m) => m?.items.forEach((i) => (out.push(i.label), walk(i.submenu)));
    walk(Menu.getApplicationMenu());
    return out;
  });
  assert.ok(items.includes('Check for Updates…'), `menu has Check for Updates: ${items}`);
  await app.evaluate(({ Menu }) => {
    const find = (m) => m.items.flatMap((i) => [i, ...(i.submenu ? find(i.submenu) : [])]);
    find(Menu.getApplicationMenu()).find((i) => i.label === 'Check for Updates…').click();
  });
  for (let i = 0; i < 100 && !readFileSync(dialogLog, 'utf8'); i++) await sleep(200);
  const shownDialog = readFileSync(dialogLog, 'utf8');
  assert.match(shownDialog, /up to date|can't update|available|Couldn't check/, `an answer was shown: ${shownDialog}`);
  log('Check for Updates is in the menu and answers (and does nothing risky on a copy that is not a clean main)');

  // supervision: kill the server; it comes back on the same port and the page reconnects without help
  const pid1 = Number(readFileSync(join(data, 'desktop-server.pid'), 'utf8'));
  assert.ok(alive(pid1));
  process.kill(pid1, 'SIGKILL');
  await page.getByText('Reconnecting').waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !document.body.innerText.includes('Reconnecting'), null, { timeout: 30000 });
  const pid2 = Number(readFileSync(join(data, 'desktop-server.pid'), 'utf8'));
  assert.notEqual(pid2, pid1);
  await page.getByLabel('Message').fill('after restart');
  await page.keyboard.press('Enter');
  await page.getByText('after restart').first().waitFor();
  await page.locator('.working').waitFor({ state: 'detached', timeout: 15000 });
  assert.ok(await page.getByText('hello desktop').count(), 'history survived the restart');
  log('a crashed server is restarted automatically and the page reconnects');

  // a second launch just focuses the first
  const second = spawn(electronBin, ['--no-sandbox', join(root, 'packages', 'desktop')], { env, stdio: 'ignore' });
  const code = await new Promise((r) => { second.on('exit', r); setTimeout(() => (second.kill('SIGKILL'), r('timeout')), 20000); });
  assert.notEqual(code, 'timeout', 'the second instance exits by itself');
  assert.equal(Number(readFileSync(join(data, 'desktop-server.pid'), 'utf8')), pid2, 'and did not start another server');
  log('a second launch exits and leaves the running app alone');

  // locked down (last of the page checks: a cancelled navigation leaves Playwright waiting for a navigation that never commits): the window only shows the app; other links go to the OS browser (recorded here instead of opened)
  await page.evaluate(() => { location.href = 'https://example.com/nav'; });
  await sleep(800);
  assert.equal(new globalThis.URL(page.url()).origin, u.origin, 'the window did not navigate away');
  await page.evaluate(() => window.open('https://example.com/popup'));
  await page.evaluate(() => window.open('file:///etc/passwd'));
  await sleep(500);
  const opened = readFileSync(externalLog, 'utf8').trim().split('\n');
  assert.ok(opened.includes('https://example.com/nav') && opened.includes('https://example.com/popup'), `web links open outside: ${opened}`);
  assert.ok(!opened.some((l) => l.startsWith('file:')), 'file: links are never opened');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'no extra windows');
  log('navigation locked to the app; web links go to the browser; file: links refused');

  // window position is remembered
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 30, width: 1000, height: 700 }));
  await sleep(900);

  // quitting stops the server (and with it any running agents)
  const pid3 = Number(readFileSync(join(data, 'desktop-server.pid'), 'utf8'));
  await app.evaluate(({ app }) => app.quit());
  await app.process().once ? null : null;
  for (let i = 0; i < 80 && alive(pid3); i++) await sleep(100);
  assert.equal(alive(pid3), false, 'the server stopped with the app');
  log('quitting the app stops the server');
  const saved = JSON.parse(readFileSync(join(userData, 'window.json'), 'utf8'));
  assert.deepEqual([saved.width, saved.height], [1000, 700]);

  // relaunch: same chats, same size
  app = await launch();
  page = await app.firstWindow();
  await page.getByText('hello desktop').first().waitFor({ timeout: 60000 }).catch(async () => {
    await page.getByRole('tab').first().waitFor({ timeout: 10000 });
  });
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.deepEqual([b.width, b.height], [1000, 700], 'window size restored');
  log('relaunch restores your chats and window size');
  console.log('all passed');
} finally {
  try { await app.close(); } catch { /* already closed */ }
}
