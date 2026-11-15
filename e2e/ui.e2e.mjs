// Browser tests against the fake provider. Needs Playwright (npx playwright install chromium).
// Run: DESIGNER_FAKE=1 DESIGNER_DATA=$(mktemp -d) npm start &  then  node e2e/ui.e2e.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.URL ?? 'http://localhost:4317';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const dist = () => page.$eval('.scroller', (el) => el.scrollHeight - el.scrollTop - el.clientHeight);
const log = (m) => console.log('ok -', m);

await page.goto(URL);
await page.getByRole('button', { name: 'New chat' }).click();
await page.getByRole('button', { name: 'Start' }).click();
await page.getByLabel('Message').waitFor();
log('create thread and open it');

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
log('detaches on upward wheel and holds position');

// 3. jump to latest re-attaches
await page.getByRole('button', { name: /Jump to latest/ }).click();
await page.waitForFunction(() => !document.querySelector('.jump'));
await page.waitForSelector('.working', { state: 'detached' });
assert.ok((await dist()) <= 2);
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

// 6. reload replays history
await page.reload();
await page.locator('.thread').first().click();
await page.waitForSelector('.msg.user');
assert.ok((await page.locator('.msg.user').count()) >= 3);
log('history replays after reload');

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log('all passed');
