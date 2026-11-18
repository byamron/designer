// The self-hosting loop: a stable Designer shows a dev instance (a separate copy of the code, own ports and data)
// inside its preview pane, and the dev instance fully works in there.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.URL ?? 'http://localhost:4317';
const stableOrigin = new globalThis.URL(URL).origin;
const log = (m) => console.log('ok -', m);
const root = resolve(new globalThis.URL('..', import.meta.url).pathname);

// A separate copy, as when editing a worktree: running from the same folder would rebuild the stable app's own UI files.
const copy = mkdtempSync(join(tmpdir(), 'selfhost-'));
cpSync(root, copy, { recursive: true, filter: (p) => !/(^|\/)(node_modules|dist|\.git|\.data)(\/|$)/.test(p.slice(root.length)) });
symlinkSync(join(root, 'node_modules'), join(copy, 'node_modules'));

const dev = spawn(process.execPath, [join(copy, 'scripts', 'dev-instance.mjs'), '--no-watch', '--fake', '--port', '4700', '--data', mkdtempSync(join(tmpdir(), 'devdata-')), '--parent', stableOrigin], { cwd: copy, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
dev.stdout.on('data', (d) => (out += d));
dev.stderr.on('data', (d) => (out += d));
const stop = () => { try { process.kill(-dev.pid, 'SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);

try {
  const link = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('dev instance did not start:\n' + out)), 90000);
    const poll = setInterval(() => { const m = /Open:\s+(http:\/\/localhost:\d+\/\?t=[0-9a-f]{64})/.exec(out); if (m) (clearInterval(poll), clearTimeout(t), res(m[1])); }, 100);
  });
  log('dev instance started from its own copy: ' + link.replace(/t=.*/, 't=…'));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } });
  await page.goto(URL);
  await page.getByRole('button', { name: 'Add folder' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Message').waitFor();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByLabel('Preview address').fill(link);
  await page.keyboard.press('Enter');

  const frame = page.frameLocator('iframe[title=Preview]');
  await frame.getByRole('button', { name: 'Add folder' }).waitFor({ timeout: 15000 });
  log('the dev instance shows inside the stable app preview pane (framing allowed for this parent only)');

  // it really works in there: token from the link, own storage, websocket, folder, chat
  await frame.getByRole('button', { name: 'Add folder' }).click();
  await frame.getByRole('button', { name: 'Add', exact: true }).click();
  await frame.getByLabel('Message').waitFor({ timeout: 10000 });
  await frame.getByLabel('Message').fill('hello from inside');
  await frame.getByLabel('Message').press('Enter');
  await frame.getByText('scripted reply').first().waitFor({ timeout: 10000 });
  log('the nested dev instance chats normally (own token, storage, WebSocket, data)');

  // the two instances are independent
  assert.equal(await page.locator('.bubble', { hasText: 'hello from inside' }).count(), 0, 'the stable app does not see the dev instance chat');
  await page.getByLabel('Message').fill('stable chat');
  await page.keyboard.press('Enter');
  await page.getByText('scripted reply').first().waitFor();
  assert.equal(await frame.locator('.bubble', { hasText: 'stable chat' }).count(), 0, 'the dev instance does not see the stable chat');
  log('stable and dev instances keep separate data');

  // a page that is NOT the allowed parent cannot frame the dev instance
  const evil = await browser.newPage();
  await evil.route('http://evil.test/**', (r) => r.fulfill({ contentType: 'text/html', body: `<iframe id=f src="http://localhost:4700/"></iframe>` }));
  await evil.goto('http://evil.test/');
  await evil.waitForTimeout(1500);
  const framed = evil.frames().some((f) => f.url().startsWith('http://localhost:4700'));
  assert.equal(framed, false, 'another site cannot frame the dev instance (the browser refused the frame)');
  log('other sites cannot frame the dev instance');
  await browser.close();
  console.log('all passed');
} finally {
  stop();
}
