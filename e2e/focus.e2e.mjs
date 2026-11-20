// Tabs through every focusable control and fails if a focus ring is clipped by a scrolling/overflow ancestor
// or the viewport. Same setup as ui.e2e.mjs (REPO, fake provider).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paste, pngFile } from './lib/images.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.URL ?? 'http://localhost:4317';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
await page.goto(URL);
if (!(await page.getByLabel('Message').count())) {
  await page.getByRole('button', { name: 'Add folder' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}
await page.getByLabel('Message').waitFor();
// populate: tools run, approval, several tabs, worktree, preview open
await page.getByLabel('Message').fill('tools and approve');
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Allow' }).waitFor();
await page.getByRole('button', { name: 'New session' }).click();
await page.getByRole('button', { name: 'New session' }).click();
await page.waitForFunction(() => !document.querySelector('.msg') && !document.querySelector('.approval'));
await page.getByLabel('Message').fill('devserver'); // a reply with a local link, chips and an external link
await page.keyboard.press('Enter');
await page.locator('.msg.assistant .preview-chip').waitFor();
await page.getByRole('button', { name: 'Preview', exact: true }).click();
await page.getByLabel('Preview address').waitFor();
await paste(page, [pngFile('a.png')]); // image thumbnails with their remove buttons are in the tab order too
await page.locator('.composer .thumb').waitFor();

// the inspector panel with an element selected (and a text element's Typography section)
if (process.env.REPO) {
  writeFileSync(join(process.env.REPO, 'focus.html'), '<body style="margin:0"><p id="p" style="margin:40px;width:200px;height:60px">Focus me</p></body>');
  await page.getByLabel('Preview address').fill('focus.html');
  await page.getByLabel('Preview address').press('Enter');
  await page.getByRole('button', { name: 'Inspect' }).click();
  await page.locator('aside[aria-label=Inspector]').waitFor();
  await page.frameLocator('iframe[title=Preview]').locator('#p').click();
  await page.getByRole('heading', { name: 'Typography' }).waitFor();
  await page.getByLabel('Font size', { exact: true }).fill('20'); await page.keyboard.press('Enter'); // so the footer buttons are enabled
  await page.getByRole('button', { name: 'Copy changes' }).waitFor();
}
const bad = [];
const seen = new Set();
await page.mouse.click(1, 1); // reset the sequential-focus starting point to the top of the page
await page.evaluate(() => { window.__fx = 0; });
let first;
for (let i = 0; i < 120; i++) {
  await page.keyboard.press('Tab');
  const r = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    if (el.tagName === 'IFRAME') return null; // focus moves into the previewed page, which draws its own ring
    el.__fid ??= ++window.__fx;
    const cs = getComputedStyle(el);
    const w = parseFloat(cs.outlineWidth) || 0;
    const off = parseFloat(cs.outlineOffset) || 0;
    const name = el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.tagName;
    if ((cs.outlineStyle === 'none' || w === 0) && !(el.closest('[data-ring-parent]') && getComputedStyle(el.closest('[data-ring-parent]')).boxShadow !== 'none')) return { fid: el.__fid, name, noRing: true };
    if (cs.outlineStyle === 'none' || w === 0) return { fid: el.__fid, name, cls: el.className, problems: [] }; // the container draws the ring
    const b = el.getBoundingClientRect();
    const grow = off + w; // outline sits `offset` outside the border box and is `w` thick
    const ring = { l: b.left - grow, t: b.top - grow, r: b.right + grow, b: b.bottom + grow };
    const problems = [];
    const clips = (v) => /(auto|scroll|hidden|clip)/.test(v);
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      const ps = getComputedStyle(p);
      if (clips(ps.overflowX) || clips(ps.overflowY)) {
        const c = p.getBoundingClientRect();
        const clip = { l: c.left + p.clientLeft, t: c.top + p.clientTop, r: c.left + p.clientLeft + p.clientWidth, b: c.top + p.clientTop + p.clientHeight };
        const cut = (clips(ps.overflowX) && (ring.l < clip.l - 0.5 || ring.r > clip.r + 0.5)) || (clips(ps.overflowY) && (ring.t < clip.t - 0.5 || ring.b > clip.b + 0.5));
        if (cut) problems.push(`${p.className || p.tagName} clips it`);
      }
      p = p.parentElement;
    }
    if (ring.l < 0 || ring.t < 0 || ring.r > innerWidth || ring.b > innerHeight) problems.push('viewport clips it');
    return { fid: el.__fid, name, cls: el.className, problems };
  });
  if (!r) continue;
  if (first === undefined) first = r.fid;
  else if (r.fid === first) break; // wrapped around
  if (seen.has(r.fid)) continue;
  seen.add(r.fid);
  if (r.noRing) bad.push(`${r.name}: no visible focus ring`);
  else if (r.problems.length) bad.push(`${r.name} [${r.cls}]: ${r.problems.join(', ')}`);
}
console.log(`checked ${seen.size} focusable controls`);
if (process.env.REPO && !(seen.size > 40)) { console.log(`inspector controls were not reached (only ${seen.size} controls)`); process.exitCode = 1; }
if (bad.length) { console.log('FOCUS PROBLEMS:\n - ' + bad.join('\n - ')); process.exitCode = 1; } else console.log('all focus rings fully visible');
await browser.close();
