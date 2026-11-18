// Feedback and motion: working indicator + timer, animated jump-to-latest, smoothed streaming, expand animation.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.URL ?? 'http://localhost:4317';
const log = (m) => console.log('ok -', m);
const browser = await chromium.launch();

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, ...opts });
  const page = await ctx.newPage();
  await page.goto(URL);
  if (!(await page.getByLabel('Message').count())) {
    await page.getByRole('button', { name: 'Add folder' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await page.getByLabel('Message').waitFor();
  await page.getByRole('button', { name: 'New session' }).click(); // every section starts in its own empty session
  await page.waitForFunction(() => !document.querySelector('.msg'));
  return { ctx, page };
}
const say = async (page, t) => { await page.getByLabel('Message').fill(t); await page.keyboard.press('Enter'); };
const idle = (page) => page.waitForSelector('.working', { state: 'detached', timeout: 20000 });

// ---- 1. working indicator and timer ----
{
  const { ctx, page } = await open();
  await say(page, 'slow please');
  await page.locator('.working').waitFor({ timeout: 1500 });
  assert.equal(await page.locator('.working').getAttribute('role'), 'status');
  assert.match(await page.locator('.working .shimmer').textContent(), /Thinking/);
  const anim = await page.$eval('.working .wave i', (el) => getComputedStyle(el).animationName);
  assert.notEqual(anim, 'none', 'the dots are animated');
  const t1 = await page.locator('.working .elapsed').textContent();
  await page.getByText('Running Bash').waitFor({ timeout: 4000 });
  log('indicator shows what the agent is doing (Thinking, then Running Bash)');
  await page.waitForTimeout(1200);
  const t2 = await page.locator('.working .elapsed').textContent();
  const secs = (s) => parseInt(s, 10);
  assert.ok(secs(t2) > secs(t1), `timer ticks (${t1} -> ${t2})`);
  assert.equal(await page.locator('.working .elapsed').getAttribute('aria-hidden'), 'true', 'the ticking number is not announced to screen readers');
  await idle(page);
  await page.locator('.turn-note').waitFor();
  assert.match(await page.locator('.turn-note').textContent(), /^Worked for \d+s$/);
  log('timer counts up while working; "Worked for Ns" remains afterwards');

  // ---- 2. tool group expand animates ----
  const head = page.locator('.tools-head').first();
  assert.equal(await head.getAttribute('aria-expanded'), 'false');
  const heights = [];
  await head.click();
  for (let i = 0; i < 14; i++) { heights.push(await page.$eval('.tools-body', (el) => Math.round(el.getBoundingClientRect().height))); await page.waitForTimeout(16); }
  const final = heights.at(-1);
  assert.ok(final > 10 && heights.some((h) => h > 0 && h < final), `expands through intermediate heights: ${heights}`);
  assert.equal(await page.locator('.tools-body:not(.open) .tools-inner').count(), 0);
  await head.click();
  await page.waitForTimeout(300);
  assert.equal(await page.$eval('.tools-inner', (el) => getComputedStyle(el).visibility), 'hidden', 'collapsed rows leave the tab order');
  log('tool run expands and collapses with an animation');

  // ---- 3. jump to latest scrolls with motion, pill goes away at once ----
  await say(page, 'long please');
  await idle(page);
  await page.hover('.scroller');
  await page.mouse.wheel(0, -3000);
  await page.waitForSelector('.jump');
  await page.waitForTimeout(500);
  const top = await page.$eval('.scroller', (el) => el.scrollTop);
  const trace = page.evaluate(() => new Promise((res) => {
    const el = document.querySelector('.scroller');
    const t0 = performance.now(); const out = [];
    const tick = () => {
      out.push([Math.round(performance.now() - t0), Math.round(el.scrollTop), !!document.querySelector('.jump')]);
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 2 || performance.now() - t0 > 1500) return res(out);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  await page.getByRole('button', { name: /Jump to latest/ }).click();
  const samples = await trace;
  const ys = samples.map((s) => s[1]);
  assert.ok(ys[0] <= top + 5, 'starts from where the view was');
  assert.ok(new Set(ys).size >= 5, `passes through intermediate positions (${new Set(ys).size} distinct)`);
  assert.ok(ys.every((y, i) => i === 0 || y >= ys[i - 1]), 'moves in one direction (down)');
  assert.ok(samples.at(-1)[0] < 700, `finishes quickly (${samples.at(-1)[0]}ms)`);
  assert.ok(samples.filter((s) => s[0] > 100).every((s) => !s[2]), 'the Jump pill goes away while the motion is under way, not only on arrival');
  await page.waitForFunction(() => { const el = document.querySelector('.scroller'); return el.scrollHeight - el.scrollTop - el.clientHeight <= 2; }, null, { timeout: 2000 }).catch(async () => { throw new Error('did not arrive at the bottom, distance ' + (await page.$eval('.scroller', (el) => el.scrollHeight - el.scrollTop - el.clientHeight))); });
  log('Jump to latest animates downward and lands at the bottom');

  // user input during the animation takes over
  await page.mouse.wheel(0, -3000);
  await page.waitForSelector('.jump');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Jump to latest/ }).click();
  await page.waitForTimeout(50);
  await page.mouse.wheel(0, -400);
  await page.waitForSelector('.jump');
  await page.waitForTimeout(500);
  assert.ok((await page.$eval('.scroller', (el) => el.scrollHeight - el.scrollTop - el.clientHeight)) > 50, 'scrolling up mid-animation wins');
  log('scrolling up during the animation cancels it');

  // sending a message while scrolled up brings you back down
  await say(page, 'hello');
  await page.waitForFunction(() => { const el = document.querySelector('.scroller'); return el.scrollHeight - el.scrollTop - el.clientHeight < 3; }, null, { timeout: 4000 });
  log('sending a message returns to the bottom');
  await ctx.close();
}

// ---- 4. lumpy deliveries are eased in ----
{
  const { ctx, page } = await open();
  await say(page, 'burst please');
  await page.waitForSelector('.msg.assistant');
  const run = await page.evaluate(() => new Promise((res) => {
    const len = () => (document.querySelector('.msg.assistant .md')?.textContent ?? '').length;
    let last = len(), maxStep = 0, caret = false, frames = 0;
    const tick = () => {
      const l = len(); maxStep = Math.max(maxStep, l - last); last = l;
      caret ||= !!document.querySelector('.msg.assistant.live');
      frames++;
      if (!document.querySelector('.working')) return res({ maxStep, final: l, caret, frames });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  assert.ok(run.final >= 1190, `all the text arrives (${run.final} chars)`);
  assert.ok(run.maxStep < 120, `a 300-character lump is revealed over several frames (largest jump ${run.maxStep} chars)`);
  assert.ok(run.caret, 'a caret marks text that is still arriving');
  assert.equal(await page.locator('.msg.assistant.live').count(), 0, 'caret is gone once settled');
  log('lumpy text is eased in; caret while streaming, gone after');
  await ctx.close();
}

// ---- 5. reduced motion turns it all off ----
{
  const { ctx, page } = await open({ reducedMotion: 'reduce' });
  await say(page, 'long please');
  await page.hover('.scroller');
  await page.waitForSelector('.msg.assistant');
  await page.waitForTimeout(300);
  const dur = await page.$eval('.working .wave i', (el) => parseFloat(getComputedStyle(el).animationDuration));
  assert.ok(dur < 0.001, `animations are effectively off (${dur}s)`);
  await idle(page);
  await page.mouse.wheel(0, -3000);
  await page.waitForSelector('.jump');
  await page.waitForTimeout(500);
  const samples = await page.evaluate(() => new Promise((res) => {
    const el = document.querySelector('.scroller'); const out = [];
    document.querySelector('.jump').click();
    const tick = () => { out.push(Math.round(el.scrollTop)); out.length < 8 ? requestAnimationFrame(tick) : res(out); };
    requestAnimationFrame(tick);
  }));
  assert.ok(new Set(samples).size <= 2, `jump is instant with reduced motion (${new Set(samples).size} positions)`);
  log('prefers-reduced-motion: no animation, instant jump');
  await ctx.close();
}

await browser.close();
console.log('all passed');
