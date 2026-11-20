// Images in chat: paste, drop, attach, remove, send, view larger, reload, queue, refusals.
// Run with e2e/run.sh images. Set SHOTS=<dir> to also save screenshots.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { drop, paste, png, pngFile } from './lib/images.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.URL ?? 'http://localhost:4317';
const SHOTS = process.env.SHOTS;
const log = (m) => console.log('ok -', m);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL);
if (!(await page.getByLabel('Message').count())) {
  await page.getByRole('button', { name: 'Add folder' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}
await page.getByLabel('Message').waitFor();
await page.getByRole('button', { name: 'New session' }).click();
await page.waitForFunction(() => !document.querySelector('.msg'));
const shot = async (name) => SHOTS && (await page.screenshot({ path: `${SHOTS}/${name}.png` }));
const thumbs = () => page.locator('.composer .thumb').count();
const idle = () => page.waitForSelector('.working', { state: 'detached', timeout: 20000 });
const msg = page.getByLabel('Message');

// 1. paste, drop and attach add thumbnails; a plain text paste is left alone
assert.equal(await paste(page, [], 'just text'), false, 'a text-only paste is not intercepted');
assert.equal(await paste(page, [pngFile('a.png', [255, 0, 0])]), true);
await page.locator('.composer .thumb img').first().waitFor();
assert.equal(await thumbs(), 1);
assert.equal(await page.getByRole('button', { name: 'Send' }).isEnabled(), true, 'images alone can be sent');
await drop(page, [pngFile('b.png', [0, 200, 0])]);
await page.waitForFunction(() => document.querySelectorAll('.composer .thumb').length === 2);
await page.getByTestId('attach-input').setInputFiles({ name: 'c.png', mimeType: 'image/png', buffer: png([0, 0, 255]) });
await page.waitForFunction(() => document.querySelectorAll('.composer .thumb').length === 3);
log('paste, drop and the attach button each add a thumbnail');

// 2. remove one
await page.getByRole('button', { name: 'Remove image 2' }).click();
assert.equal(await thumbs(), 2);
assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Message', 'focus returns to the text box');
log('remove (x) drops one thumbnail');

// 3. refusals say why and drop nothing else
await drop(page, [{ name: 'logo.svg', type: 'image/svg+xml', base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') }]);
await page.getByRole('alert').filter({ hasText: 'logo.svg is not a PNG, JPEG, GIF or WebP' }).waitFor();
await drop(page, [{ name: 'notes.pdf', type: 'application/pdf', base64: Buffer.from('%PDF-1.4').toString('base64') }]);
await page.getByRole('alert').filter({ hasText: 'notes.pdf is not a PNG' }).waitFor();
const big = Buffer.concat([png(), Buffer.alloc(5 * 1024 * 1024)]);
await drop(page, [{ name: 'huge.png', type: 'image/png', base64: big.toString('base64') }]);
await page.getByRole('alert').filter({ hasText: 'huge.png is larger than 5 MB' }).waitFor();
assert.equal(await thumbs(), 2);
for (let i = 0; i < 3; i++) await paste(page, [pngFile(`x${i}.png`, [i * 40, 9, 9])]);
await page.waitForFunction(() => document.querySelectorAll('.composer .thumb').length === 5);
await paste(page, [pngFile('sixth.png', [1, 2, 3])]);
await page.getByRole('alert').filter({ hasText: 'up to 5 images per message' }).waitFor();
assert.equal(await thumbs(), 5);
log('svg, pdf, oversize and a sixth image are refused with a message; nothing is silently dropped');
await shot('composer-thumbnails');
for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Remove image 1' }).click();
assert.equal(await thumbs(), 2);

// 4. send text + 2 images
await msg.fill('what do you see?');
await page.keyboard.press('Enter');
await page.locator('.msg.user .sent-thumb img').nth(1).waitFor();
assert.equal(await thumbs(), 0, 'the composer is cleared');
assert.equal(await page.locator('.msg.user .bubble').textContent(), 'what do you see?');
await page.waitForFunction(() => [...document.querySelectorAll('.msg.user .sent-thumb img')].every((i) => i.naturalWidth > 0));
assert.match(await page.locator('.msg.user .sent-thumb img').first().getAttribute('src'), /^blob:/, 'shown from a fetched blob, not a bare URL');
await page.getByText('Got 2 images').waitFor();
await idle();
log('text + 2 images send together; the message shows both thumbnails; the provider got 2');
await shot('sent-message');

// 5. the larger view: click opens, Esc closes, focus comes back
const first = page.getByRole('button', { name: 'Open image 1 larger' });
await first.click();
const dlg = page.getByRole('dialog', { name: 'Image' });
await dlg.waitFor();
await page.waitForFunction(() => document.querySelector('.viewer img')?.naturalWidth > 0);
assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Close image');
await shot('larger-view');
await page.keyboard.press('Tab');
assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Close image', 'focus stays in the dialog');
await page.keyboard.press('Escape');
await dlg.waitFor({ state: 'detached' });
assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Open image 1 larger', 'focus returns to the thumbnail');
await first.click();
await dlg.waitFor();
await page.mouse.click(5, 5);
await dlg.waitFor({ state: 'detached' });
log('click opens the larger view; Esc or a click outside closes it; focus returns');

// 6. the route needs the token
const sawNoToken = await page.evaluate(async () => {
  const ids = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('/api/attachment/'));
  const r = await fetch(ids[0]); // no token header
  return r.status;
});
assert.equal(sawNoToken, 401, 'the attachment route refuses a request without the token');
log('stored images are only served with the token');

// 7. reload: still there (stored, replayed)
await page.reload();
await page.locator('.msg.user .sent-thumb img').nth(1).waitFor();
await page.waitForFunction(() => [...document.querySelectorAll('.msg.user .sent-thumb img')].every((i) => i.naturalWidth > 0));
log('after a reload the thumbnails are replayed from storage');

// 8. image-only message
await paste(page, [pngFile('only.png', [250, 250, 0])]);
await page.locator('.composer .thumb').waitFor();
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('.msg.user').length === 2);
assert.equal(await page.locator('.msg.user').last().locator('.bubble').count(), 0, 'no empty bubble');
await page.getByText('Got 1 image.').waitFor();
await idle();
log('an image-only message is allowed');

// 9. a queued message keeps its images
await msg.fill('slow please');
await page.keyboard.press('Enter');
await page.locator('.working').waitFor();
await msg.fill('and this one');
await paste(page, [pngFile('late.png', [0, 255, 255])]);
await page.locator('.composer .thumb').waitFor();
await page.keyboard.press('Enter');
await page.locator('.queued').filter({ hasText: 'Queued: and this one · 1 image' }).waitFor();
await page.waitForFunction(() => document.querySelectorAll('.msg.user').length === 4, null, { timeout: 20000 });
await page.getByText('Got 1 image.').nth(1).waitFor();
assert.equal(await page.locator('.msg.user').last().locator('.sent-thumb').count(), 1);
await idle();
log('a queued message goes out with its image after the running turn');

// 10. dark mode renders the new controls
const state = await ctx.storageState(); // keeps the token
await ctx.close();
const dark = await browser.newContext({ viewport: { width: 1000, height: 760 }, colorScheme: 'dark', storageState: state });
const p2 = await dark.newPage();
await p2.goto(URL);
await p2.getByLabel('Message').waitFor();
await p2.getByRole('button', { name: 'New session' }).click();
await p2.waitForFunction(() => !document.querySelector('.msg'));
await paste(p2, [pngFile('d.png', [200, 80, 80])]);
await p2.locator('.composer .thumb img').waitFor();
if (SHOTS) await p2.screenshot({ path: `${SHOTS}/composer-dark.png` });
await dark.close();

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log('all passed');
