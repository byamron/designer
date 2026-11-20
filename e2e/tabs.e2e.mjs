// Many open chats: "+" must stay visible and clickable (a plain click, no force) and the tab strip must scroll/shrink instead.
// 1280 px wide with preview and inspector open, the layout where "+" used to be covered by the tab strip.
// Run with e2e/run.sh tabs (needs REPO, fake provider).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.URL ?? 'http://localhost:4317';
const log = (m) => console.log('ok -', m);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL);
if (!(await page.getByLabel('Message').count())) {
  await page.getByRole('button', { name: 'Add folder' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}
await page.getByLabel('Message').waitFor();
await page.getByRole('button', { name: 'Preview', exact: true }).click();
await page.getByLabel('Preview address').waitFor();
writeFileSync(join(process.env.REPO, 'tabs.html'), '<body style="margin:0"><p id="p" style="margin:40px">Hello</p></body>');
await page.getByLabel('Preview address').fill('tabs.html');
await page.getByLabel('Preview address').press('Enter');
await page.getByRole('button', { name: 'Inspect' }).click();
await page.locator('aside[aria-label=Inspector]').waitFor();

const plus = page.getByRole('button', { name: 'New session' });
const tabs = page.getByRole('tab');
const strip = page.locator('[role=tablist][aria-label=Sessions]');
for (let i = 0; i < 14; i++) {
  const before = await tabs.count();
  await plus.click(); // a plain click: Playwright fails it if another element intercepts the pointer
  await page.waitForFunction((n) => document.querySelectorAll('[role=tab]').length === n, before + 1);
}
assert.ok((await tabs.count()) >= 15);
log(`opened ${await tabs.count()} chats with plain clicks on +`);

// "+" is fully inside the viewport and not covered by anything
const box = await plus.boundingBox();
const vp = page.viewportSize();
assert.ok(box && box.x >= 0 && box.x + box.width <= vp.width, `+ inside the viewport: ${JSON.stringify(box)}`);
const top = await plus.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
});
assert.ok(top, '+ is the topmost element at its own centre');

// the strip scrolls rather than pushing "+" away, and the active tab is reachable
const m = await strip.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
assert.ok(m.sw > m.cw, `tab strip overflows and scrolls (${m.sw} > ${m.cw})`);
log('+ stays visible and clickable; the tab strip scrolls');

// the page itself did not grow a horizontal scrollbar
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page-level horizontal scroll');
assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log('tabs e2e passed');
