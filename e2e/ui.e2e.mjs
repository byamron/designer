// Browser tests against the fake provider. Needs Playwright (npx playwright install chromium).
// Easiest: e2e/run.sh ui.  Manual: R=$(mktemp -d); git -C $R init -q -b main; git -C $R -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
//      DESIGNER_CWD=$R DESIGNER_FAKE=1 DESIGNER_DATA=$(mktemp -d) npm start &  then  REPO=$R node e2e/ui.e2e.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.URL ?? 'http://localhost:4317';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const dist = () => page.$eval('.scroller', (el) => el.scrollHeight - el.scrollTop - el.clientHeight);
const log = (m) => console.log('ok -', m);

// 0. without the token the page cannot reach the app, and says why
{
  const ctx = await browser.newContext();
  const bare = await ctx.newPage();
  await bare.goto(new globalThis.URL(URL).origin + '/');
  await bare.getByText("Can't connect").waitFor({ timeout: 8000 });
  assert.equal(await bare.getByRole('button', { name: 'Add folder' }).count(), 0, 'no app UI without a token');
  await bare.goto(new globalThis.URL(URL).origin + '/?t=' + 'f'.repeat(64));
  await bare.getByText("Can't connect").waitFor({ timeout: 8000 });
  log('without a valid token: "Can\'t connect" screen, no app');
  await ctx.close();
}
await page.goto(URL);
assert.ok(!page.url().includes('t='), 'the token is removed from the address bar');
await page.getByRole('button', { name: 'Add folder' }).click();
await page.getByRole('button', { name: 'Add', exact: true }).click();
await page.getByLabel('Message').waitFor();
log('add folder opens a session');

// 1. streaming follows the bottom
await page.getByLabel('Message').fill('long please');
await page.keyboard.press('Enter');
await page.waitForSelector('.msg.assistant');
await page.waitForTimeout(400);
assert.ok((await dist()) <= 2, 'pinned to bottom while streaming');
log('follows streaming output');

// 2. scrolling up detaches and growth does not move the view
await page.hover('.scroller');
await page.mouse.wheel(0, -600);
await page.waitForSelector('.jump');
const before = await page.$eval('.scroller', (el) => el.scrollTop);
await page.waitForTimeout(500);
const after = await page.$eval('.scroller', (el) => el.scrollTop);
assert.equal(after, before, 'scroll position stable while detached and content grows');
await page.waitForSelector('.working', { state: 'detached' }); // ...and when the reply finishes (it once jumped to the top here)
assert.equal(await page.$eval('.scroller', (el) => el.scrollTop), before, 'scroll position stable when the reply settles');
log('detaches on upward wheel and holds position');

// 3. jump to latest re-attaches
await page.getByRole('button', { name: /Jump to latest/ }).click();
await page.waitForFunction(() => !document.querySelector('.jump'));
await page.waitForFunction(() => { const el = document.querySelector('.scroller'); return el.scrollHeight - el.scrollTop - el.clientHeight <= 2; }, null, { timeout: 3000 }); // the jump is animated
await page.waitForSelector('.working', { state: 'detached' });
log('jump to latest re-attaches');

// 4. rendered markdown, no raw HTML injection
await page.getByLabel('Message').fill('tools and approve');
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Allow' }).waitFor();
assert.ok(await page.getByText('Read 1 file').count(), 'tool run summary');
await page.getByRole('button', { name: 'Allow' }).click();
await page.getByText('Allowed').waitFor();
log('tool group + approval round trip');

// 5. stop button interrupts
await page.waitForSelector('.working', { state: 'detached' });
await page.getByLabel('Message').fill('long again');
await page.keyboard.press('Enter');
await page.getByRole('button', { name: /Stop/ }).waitFor();
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Send' }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
await page.waitForSelector('.working', { state: 'detached' });
log('Esc interrupts a running turn');

// 6. reload replays history and remembers the open session
await page.reload();
await page.waitForSelector('.msg.user');
assert.ok((await page.locator('.msg.user').count()) >= 3);
log('history replays after reload, last session reopens');

// 7. tabs: second session in the same workspace is independent
await page.getByRole('button', { name: 'New session' }).click();
await page.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 2);
assert.equal(await page.locator('.msg.user').count(), 0, 'new session starts empty');
await page.getByLabel('Message').fill('second session');
await page.keyboard.press('Enter');
await page.getByRole('tab', { name: /second session/ }).waitFor();
await page.getByRole('tab').first().click();
await page.waitForSelector('.msg.user');
assert.equal(await page.locator('.bubble', { hasText: 'second session' }).count(), 0, 'sessions do not leak into each other');
log('multiple session tabs per workspace');

// 7b. the new-worktree and add-folder boxes can be dismissed without creating anything
{
  const open = () => page.getByRole('button', { name: /New worktree in/ }).click();
  const box = page.getByLabel('Worktree name');
  await open(); await box.waitFor(); await page.keyboard.press('Escape');
  await box.waitFor({ state: 'detached' });
  await open(); await box.waitFor(); await page.getByRole('button', { name: 'Cancel new worktree' }).click();
  await box.waitFor({ state: 'detached' });
  await open(); await box.waitFor(); await page.locator('.top').click(); // click away while empty
  await box.waitFor({ state: 'detached' });
  await open(); await box.fill('keep-me'); await page.locator('.top').click(); // typed text is never thrown away by a stray click
  await page.waitForTimeout(150);
  assert.equal(await box.count(), 1, 'a named worktree box stays open when you click away');
  await page.keyboard.press('Escape'); // (focus is not in the box any more) close it via the cancel button
  await page.getByRole('button', { name: 'Cancel new worktree' }).click();
  await box.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Add folder' }).click();
  await page.getByLabel('Folder path').waitFor();
  await page.keyboard.press('Escape');
  await page.getByLabel('Folder path').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Add folder' }).click();
  await page.getByLabel('Folder path').waitFor();
  await page.locator('.top').click(); // untouched suggested path: click away cancels
  await page.getByLabel('Folder path').waitFor({ state: 'detached' });
  log('worktree and add-folder boxes dismiss via Esc, the X button and clicking away');
}

// 8. worktrees appear in the sidebar and run sessions in their own folder
await page.getByRole('button', { name: /New worktree in/ }).click();
await page.getByLabel('Worktree name').fill('variant-a');
await page.keyboard.press('Enter');
await page.getByText('designer/variant-a').waitFor();
assert.ok((await page.locator('.top-cwd').textContent()).includes('variant-a'), 'session cwd is the worktree');
const gap = await page.$$eval('.project .ws', (rows) => rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom);
assert.ok(gap >= 2, `workspace rows have a gap between them (${gap}px)`);
log('worktree created, opened in its own folder; rows are separated');

// 9. removing a clean worktree works
await page.locator('.ws', { hasText: 'variant-a' }).hover(); // the remove button only shows on hover
await page.getByRole('button', { name: /Remove variant-a/ }).click();
await page.getByText('designer/variant-a').waitFor({ state: 'detached', timeout: 5000 });
log('worktree removed');

// 10. preview pane: open an HTML file from the workspace, refresh after the agent's next turn
const REPO = process.env.REPO;
assert.ok(REPO, 'set REPO to the folder the server was started with');
writeFileSync(join(REPO, 'demo.html'), '<h1 id="t">Demo v1</h1><button id="b">hi</button>');
await page.getByRole('button', { name: 'Preview', exact: true }).click();
await page.getByLabel('Preview address').fill('demo.html');
await page.keyboard.press('Enter');
const frame = page.frameLocator('iframe[title=Preview]');
await frame.locator('#t').waitFor();
assert.equal(await frame.locator('#t').textContent(), 'Demo v1');
log('preview shows an HTML file from the workspace');
writeFileSync(join(REPO, 'demo.html'), '<h1 id="t">Demo v2</h1>');
await page.getByLabel('Message').fill('hello');
await page.keyboard.press('Enter');
await frame.getByText('Demo v2').waitFor({ timeout: 8000 }); // cross-origin iframe: read it through Playwright, not the DOM
log('preview refreshes when the agent finishes a turn');

// 11. previewed code is on another origin and cannot drive the agent over the app WebSocket
await page.waitForSelector('.working', { state: 'detached' });
const handle = await page.locator('iframe[title=Preview]').elementHandle();
const inner = await handle.contentFrame();
const appPort = new globalThis.URL(URL).port;
const wsResult = await inner.evaluate((appPort) => new Promise((res) => {
  const w = new WebSocket(`ws://localhost:${appPort}/ws`);
  w.onopen = () => res('open');
  w.onerror = () => res('refused');
  setTimeout(() => res('timeout'), 3000);
}), appPort);
assert.equal(wsResult, 'refused', 'previewed page must not be able to open the app WebSocket');
log('previewed page cannot connect to the app WebSocket');

// 12. localhost dev-server style URL, and a site that forbids framing
const ok = createServer((_, r) => r.end('<title>x</title><h1 id="ext">external ok</h1>')).listen(0);
const blocked = createServer((_, r) => (r.setHeader('x-frame-options', 'DENY'), r.end('no'))).listen(0);
await new Promise((r) => setTimeout(r, 100));
await page.getByLabel('Preview address').fill(`localhost:${ok.address().port}`);
await page.keyboard.press('Enter');
await frame.locator('#ext').waitFor();
log('preview shows a localhost URL');
await page.getByLabel('Preview address').fill(`http://127.0.0.1:${blocked.address().port}`);
await page.keyboard.press('Enter');
await page.getByText(/does not allow being shown/).waitFor();
assert.equal(await page.locator('iframe[title=Preview]').count(), 0, 'no blank iframe for a blocked site');
await page.getByLabel('Preview address').fill('localhost:1');
await page.keyboard.press('Enter');
await page.getByText(/Cannot reach/).waitFor();
ok.close(); blocked.close();
log('blocked and unreachable pages say so instead of showing a blank pane');

// 13. resize, swap, persist
const width = () => page.$eval('.chat-col', (el) => el.getBoundingClientRect().width);
const total = await page.$eval('.panes', (el) => el.getBoundingClientRect().width);
const w0 = await width();
const sep = await page.locator('.sep').boundingBox();
await page.mouse.move(sep.x + 3, sep.y + 100);
await page.mouse.down();
await page.mouse.move(sep.x - 97, sep.y + 100, { steps: 5 });
await page.mouse.up();
const w1 = await width();
assert.ok(w0 <= total / 2 + 1, `chat starts at most half the width (${w0} of ${total})`);
assert.ok(w1 < w0 - 50, `dragging left narrows the chat (${w0} -> ${w1})`);
await page.locator('.sep').focus();
await page.keyboard.press('ArrowLeft');
const w2 = await width();
assert.ok(w2 < w1, 'keyboard resizes too');
const sep2 = await page.locator('.sep').boundingBox();
await page.mouse.move(sep2.x + 3, sep2.y + 100);
await page.mouse.down();
await page.mouse.move(sep2.x + 900, sep.y + 100, { steps: 5 });
await page.mouse.up();
assert.ok((await width()) <= total / 2 + 1, 'chat never exceeds half the width');
await page.getByRole('button', { name: 'Swap chat and preview' }).click();
const cx = (await page.locator('.chat-col').boundingBox()).x;
const px = (await page.locator('.preview-col').boundingBox()).x;
assert.ok(px < cx, 'preview is on the left after swapping');
await page.reload();
await page.locator('.preview-col').waitFor();
assert.ok((await page.locator('.preview-col').boundingBox()).x < (await page.locator('.chat-col').boundingBox()).x, 'layout persists across reload');
await page.getByLabel('Preview address').waitFor();
log('resize (drag + keyboard, capped at half), swap sides, persists across reload');

// 14. quote and reply
await page.waitForSelector('.msg.assistant p');
await page.evaluate(() => {
  const p = document.querySelector('.msg.assistant p');
  const r = document.createRange();
  r.selectNodeContents(p);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
});
await page.getByRole('button', { name: 'Quote' }).click();
await page.waitForFunction(() => document.querySelector('textarea')?.value.startsWith('> '), null, { timeout: 3000 }).catch(() => {});
const composed = await page.getByLabel('Message').inputValue();
assert.ok(composed.startsWith('> Here is a scripted reply'), `quoted text lands in the composer: ${composed.slice(0, 40)}`);
assert.equal(await page.getByRole('button', { name: 'Quote' }).count(), 0, 'quote button goes away');
await page.keyboard.type('what about this?');
assert.ok((await page.getByLabel('Message').inputValue()).includes('what about this?'));
log('quote selected reply text into the composer');

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log('all passed');
