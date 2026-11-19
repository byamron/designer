// Inspector panel, in a real browser: a workspace file and a localhost server through the proxy.
// Run via e2e/run.sh inspector (it starts a fake-provider server and sets URL and REPO). Needs Playwright.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { buildEditsReport } from '../packages/shared/src/edits.ts';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.URL ?? 'http://localhost:4317';
const REPO = process.env.REPO;
assert.ok(REPO, 'set REPO to the folder the server was started with');
const SHOTS = process.env.SHOTS; // optional folder for screenshots
const log = (m) => console.log('ok -', m);

const PAGE = `<!doctype html><html><head><title>Inspect me</title><style>
  body { margin: 0; font: 16px/1.4 sans-serif; }
  #card { position: relative; margin: 40px; width: 300px; padding: 0; background: #eef; }
  #box { width: 120px; height: 60px; background: #ccc; }
  #b { margin: 8px; }
  #p { margin: 8px; }
</style></head><body>
  <div id="card"><div id="box"></div><button id="b">Click me</button><p id="p">Hello inspector</p></div>
  <script>
    window.__clicks = 0;
    document.getElementById('b').addEventListener('click', () => { window.__clicks++; });
    document.getElementById('b').addEventListener('mousedown', () => { window.__clicks += 100; });
    // a page script pretending to be the agent
    window.forge = () => parent.postMessage({ designer: 1, type: 'selected', el: { id: 'x', tag: 'evil', label: 'FORGED', selector: 'x', text: '', html: '', path: [], rect: { x: 0, y: 0, w: 1, h: 1 }, parent: null, style: {}, move: { x: 0, y: 0 }, rot: 0, hasText: false, childCount: 0 } }, '*');
    window.forgeLog = () => parent.postMessage({ designer: 1, nonce: 'guess', type: 'log', edits: [{ id: 'x', order: 0, label: 'FORGED', selector: 'x', text: '', html: '', changes: [{ prop: 'color', from: 'a', to: 'b' }] }] }, '*');
  </script></body></html>`;
mkdirSync(REPO, { recursive: true });
writeFileSync(join(REPO, 'inspect.html'), PAGE);
const dev = createServer((_, r) => (r.setHeader('content-type', 'text/html'), r.end(PAGE)));
await new Promise((ok) => dev.listen(0, '127.0.0.1', ok));
const devPort = dev.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL);
if (!(await page.getByLabel('Message').count())) {
  await page.getByRole('button', { name: 'Add folder' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}
await page.getByLabel('Message').waitFor();
await page.getByRole('button', { name: 'Preview', exact: true }).click();
// every agent message, as the app receives it (the test sees what the app sees)
await page.evaluate(() => { window.__log = []; window.addEventListener('message', (e) => { if (e.data?.type === 'log') window.__log = e.data.edits; }); });

const panel = page.locator('aside[aria-label=Inspector]');
const frame = page.frameLocator('iframe[title=Preview]');
const field = (name) => panel.getByLabel(name, { exact: true });
const set = async (name, v) => { const f = field(name); await f.fill(String(v)); await f.press('Enter'); };
const cs = (sel, prop) => frame.locator(sel).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
// edits reach the page asynchronously (postMessage), so assertions on page state retry briefly
const poll = async (read, want, msg, ms = 3000) => {
  const end = Date.now() + ms;
  let got;
  for (;;) {
    got = await read();
    if (typeof want === 'function' ? want(got) : got === want) return got;
    if (Date.now() > end) return assert.equal(got, typeof want === 'function' ? 'a matching value' : want, msg);
    await page.waitForTimeout(40);
  }
};
const eq = (sel, prop, want, msg) => poll(() => cs(sel, prop), want, msg ?? `${sel} ${prop}`);
const shot = async (name) => SHOTS && (mkdirSync(SHOTS, { recursive: true }), await page.screenshot({ path: join(SHOTS, name) }));

async function run(label, address) {
  await page.getByLabel('Preview address').fill(address);
  await page.getByLabel('Preview address').press('Enter');
  await frame.locator('#box').waitFor();
  assert.equal(await page.locator('aside[aria-label=Inspector]').count(), 0, 'no panel before Inspect is on');

  // page handlers work while Inspect is off
  await frame.locator('#b').click();
  assert.equal(await frame.locator('body').evaluate(() => window.__clicks), 101, `${label}: page click handlers run when not inspecting`);
  await frame.locator('body').evaluate(() => { window.__clicks = 0; });

  await page.getByRole('button', { name: 'Inspect' }).click();
  await panel.waitFor();
  await panel.getByText('Click an element in the page').waitFor();
  if (label !== 'file') assert.match(await page.locator('.preview-note').first().innerText(), /proxy/i, 'proxy note shown');
  await frame.locator('#box').waitFor();

  // handlers are suppressed while inspecting; the click selects instead
  await frame.locator('#b').click();
  assert.equal(await frame.locator('body').evaluate(() => window.__clicks), 0, `${label}: page click handlers are suppressed while inspecting`);
  await panel.getByRole('navigation').getByText(/^button#b/).waitFor();
  await frame.locator('#box').click();
  await panel.getByRole('navigation').locator('.current').filter({ hasText: 'div#box' }).waitFor();
  log(`${label}: Inspect selects an element and the page's own click handlers do not run`);

  // ----- Position
  const rect0 = await frame.locator('#box').evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  assert.equal(Number(await field('X').inputValue()), rect0.x);
  await set('X', rect0.x + 30);
  await set('Y', rect0.y + 15);
  await eq('#box', 'translate', '30px 15px');
  await set('Rotation', 10);
  await eq('#box', 'rotate', '10deg');
  // align: right edge of the card
  await panel.getByRole('button', { name: 'Align left' }).click();
  await poll(() => frame.locator('#box').evaluate((el) => el.getBoundingClientRect().x - el.parentElement.getBoundingClientRect().x), (v) => Math.abs(v) < 0.05, 'align left puts it on the parent edge');
  // ----- size and layout
  await set('Width', 150);
  await set('Height', 70);
  await eq('#box', 'width', '150px');
  await eq('#box', 'height', '70px');
  await panel.getByRole('radio', { name: 'Horizontal (flex row)' }).click();
  await eq('#box', 'display', 'flex');
  await eq('#box', 'flex-direction', 'row');
  await set('Gap', 6);
  await eq('#box', 'row-gap', '6px');
  await set('Padding', 12);
  await eq('#box', 'padding-left', '12px');
  await eq('#box', 'padding-bottom', '12px');
  await panel.getByLabel('Clip content').click();
  await eq('#box', 'overflow-x', 'hidden');
  // ----- appearance
  await set('Opacity', 50);
  await eq('#box', 'opacity', '0.5');
  await set('Corner radius', 8);
  await eq('#box', 'border-top-left-radius', '8px');
  // ----- fill
  await set('Fill hex', 'FF0000');
  await eq('#box', 'background-color', 'rgb(255, 0, 0)');
  await set('Fill opacity', 50);
  await eq('#box', 'background-color', 'rgba(255, 0, 0, 0.5)');
  // ----- stroke (a width on a border without a style also sets solid)
  await set('Stroke width', 3);
  await eq('#box', 'border-top-width', '3px');
  await eq('#box', 'border-top-style', 'solid');
  await set('Stroke hex', '0000FF');
  await eq('#box', 'border-top-color', 'rgb(0, 0, 255)');
  await panel.getByRole('radio', { name: 'dashed stroke' }).click();
  await eq('#box', 'border-top-style', 'dashed');
  // ----- effects
  await panel.getByRole('button', { name: 'Add drop shadow' }).click();
  await eq('#box', 'box-shadow', 'rgba(0, 0, 0, 0.25) 0px 4px 8px 0px');
  await set('Shadow blur', 20);
  await poll(() => cs('#box', 'box-shadow'), (v) => /20px/.test(v), 'shadow blur');
  // a box with no text has no Typography section
  assert.equal(await panel.getByRole('heading', { name: 'Typography' }).count(), 0, 'no typography for an element without text');
  await shot(`inspector-${label}.png`);
  log(`${label}: position, layout, appearance, fill, stroke and effects edits change the real computed style`);

  // ----- typography on the paragraph
  await frame.locator('#p').click();
  await panel.getByRole('heading', { name: 'Typography' }).waitFor();
  // choosing a fill colour for a transparent element makes it visible
  await set('Fill hex', 'FFEE88');
  await eq('#p', 'background-color', 'rgb(255, 238, 136)');
  await set('Font size', 22);
  await eq('#p', 'font-size', '22px');
  await panel.getByLabel('Font weight').selectOption('700');
  await eq('#p', 'font-weight', '700');
  await panel.getByRole('radio', { name: 'Align text center' }).click();
  await eq('#p', 'text-align', 'center');
  await set('Text hex', '00AA00');
  await eq('#p', 'color', 'rgb(0, 170, 0)');
  await set('Line height', 30);
  await eq('#p', 'line-height', '30px');
  await set('Letter spacing', 1);
  await eq('#p', 'letter-spacing', '1px');
  await field('Font family').fill('Georgia');
  await field('Font family').press('Enter');
  await poll(() => cs('#p', 'font-family'), (v) => /Georgia/.test(v), 'font family');
  log(`${label}: typography edits change the real computed style`);

  // ----- keyboard on a number field: arrows step, Shift = 10x, Escape reverts
  await frame.locator('#p').click();
  const sz = field('Font size');
  await sz.focus();
  await sz.press('ArrowUp');
  await eq('#p', 'font-size', '23px');
  await sz.press('Shift+ArrowUp');
  await eq('#p', 'font-size', '33px');
  await sz.press('Escape');
  await eq('#p', 'font-size', '22px', 'Escape puts the value back');
  // scrub by dragging the label
  const lbl = panel.locator('label.nf', { has: page.getByLabel('Font size', { exact: true }) }).locator('.nf-label');
  const bb = await lbl.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + 8, bb.y + bb.height / 2, { steps: 4 });
  await page.mouse.up();
  await eq('#p', 'font-size', '30px', 'dragging the label by 8px scrubs 8 steps');
  log(`${label}: arrows, Shift, Escape and scrubbing work on number fields`);

  // ----- resize/move by dragging in the page
  await frame.locator('#box').click();
  const handle = await frame.locator('#box').evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.right, y: r.bottom }; });
  const fr = await page.locator('iframe[title=Preview]').boundingBox();
  const w0 = parseFloat(await cs('#box', 'width'));
  await page.mouse.move(fr.x + handle.x, fr.y + handle.y);
  await page.mouse.down();
  await page.mouse.move(fr.x + handle.x + 20, fr.y + handle.y + 10, { steps: 5 });
  await page.mouse.up();
  await poll(async () => parseFloat(await cs('#box', 'width')), (v) => v > w0 + 15, 'dragging the corner handle resizes');
  const t0 = await cs('#box', 'translate');
  const c = await frame.locator('#box').evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(fr.x + c.x, fr.y + c.y);
  await page.mouse.down();
  await page.mouse.move(fr.x + c.x + 25, fr.y + c.y + 5, { steps: 5 });
  await page.mouse.up();
  await poll(() => cs('#box', 'translate'), (v) => v !== t0, 'dragging the element moves it');
  await frame.locator('#p').click();
  await frame.locator('body').press('ArrowRight');
  log(`${label}: handles resize and dragging moves`);

  // ----- footer, copy, add to message, reset
  await panel.getByText(/^\d+ changes? on 2 elements$/).waitFor();
  const edits = await page.evaluate(() => window.__log);
  const ws = basename(REPO); // the workspace is named after its folder
  await panel.getByRole('button', { name: 'Copy changes' }).click();
  await panel.getByRole('button', { name: 'Copied' }).waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const expected = buildEditsReport(edits, { file: label === 'file' ? 'inspect.html' : address, workspace: ws });
  assert.ok(expected.startsWith('Visual edits from the Designer inspector'), 'report is not empty');
  assert.equal(clip, expected, `${label}: Copy yields exactly buildEditsReport`);
  await page.getByLabel('Message').fill('');
  await panel.getByRole('button', { name: 'Add to message' }).click();
  await page.waitForFunction((t) => document.querySelector('textarea[aria-label=Message]').value.includes(t), 'Visual edits from the Designer inspector');
  assert.equal((await page.getByLabel('Message').inputValue()).trim(), expected.trim(), 'Add to message fills the composer with the report');
  await page.getByLabel('Message').fill('');
  log(`${label}: Copy equals buildEditsReport; Add to message fills the composer`);

  // ----- the page cannot forge messages
  await frame.locator('body').evaluate(() => window.forge());
  await frame.locator('body').evaluate(() => window.forgeLog());
  await page.waitForTimeout(200);
  assert.equal(await panel.getByText('FORGED').count(), 0, 'a forged message from the page is ignored');
  assert.match(await panel.locator('.ins-count').innerText(), /changes? on 2 elements/, 'forged edits are not counted');
  log(`${label}: forged messages from the page are ignored`);

  // ----- reset one element, then everything
  await frame.locator('#box').click();
  await panel.getByRole('button', { name: 'Reset element' }).click();
  await panel.getByText(/^\d+ changes? on 1 element$/).waitFor();
  await eq('#box', 'translate', 'none');
  await eq('#box', 'box-shadow', 'none');
  await panel.getByRole('button', { name: 'Reset', exact: true }).click();
  await panel.getByText('No changes yet').waitFor();
  await eq('#p', 'font-size', '16px');
  await poll(() => frame.locator('#box').getAttribute('style'), null, 'inline style is restored');
  log(`${label}: Reset restores the original`);

  // ----- turning Inspect off restores the page's handlers
  await page.getByRole('button', { name: 'Inspect' }).click();
  await panel.waitFor({ state: 'detached' });
  await frame.locator('body').evaluate(() => { window.__clicks = 0; });
  await frame.locator('#b').click();
  await poll(() => frame.locator('body').evaluate(() => window.__clicks), 101, `${label}: page click handlers fire again after Inspect is off`);
  log(`${label}: page handlers are restored after Inspect is turned off`);
}

await run('file', 'inspect.html');
await run('localhost', `http://localhost:${devPort}/`);

// ----- the preview does not reload under pending edits
{
  await page.getByLabel('Preview address').fill('inspect.html');
  await page.getByLabel('Preview address').press('Enter');
  await frame.locator('#box').waitFor();
  await page.getByRole('button', { name: 'Inspect' }).click();
  await panel.getByText('Click an element in the page').waitFor();
  await frame.locator('#box').click();
  await set('Opacity', 40);
  await eq('#box', 'opacity', '0.4');
  await page.getByLabel('Message').fill('hello');
  await page.keyboard.press('Enter');
  await page.getByText(/^Worked for|Done|Scripted/).first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.locator('.preview-note', { hasText: 'not reloaded' }).waitFor();
  await eq('#box', 'opacity', '0.4', 'edits survive a finished turn');
  await page.getByRole('button', { name: 'Reload and discard edits' }).click();
  await frame.locator('#box').waitFor();
  await eq('#box', 'opacity', '1', 'reloading discards the edits');
  log('the preview is not reloaded while edits are pending, and says so');
  await page.getByRole('button', { name: 'Inspect' }).click();
}

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
dev.close();
console.log('all passed');
