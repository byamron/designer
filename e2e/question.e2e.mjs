// Question cards (AskUserQuestion) against the fake provider. Easiest: e2e/run.sh question
// Set SHOTS=/some/dir to save screenshots of an open, answered and cancelled card.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.env.URL ?? 'http://localhost:4317';
const SHOTS = process.env.SHOTS;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const log = (m) => console.log('ok -', m);
const shot = async (name) => SHOTS && (await page.waitForTimeout(400), page.screenshot({ path: `${SHOTS}/${name}.png` }));
const send = async (text) => { await page.getByLabel('Message').fill(text); await page.keyboard.press('Enter'); };
const card = () => page.locator('.question:not(.done)');
const idle = () => page.waitForSelector('.working', { state: 'detached' });

await page.goto(URL);
await page.getByRole('button', { name: 'Add folder' }).click();
await page.getByRole('button', { name: 'Add', exact: true }).click();
await page.getByLabel('Message').waitFor();

// 1. renders: chips, questions, options with descriptions, preview, Other / Skip / Reply in chat, labelled groups
await send('please ask a question');
await card().waitFor();
assert.equal(await card().getByRole('group', { name: /Which colour/ }).count(), 1, 'labelled group per question');
assert.equal(await card().locator('.q-chip').allTextContents().then((a) => a.join('|')), 'Colour|Extras');
assert.equal(await card().getByRole('radio').count(), 4, 'single-select = radios (3 options + Other)');
assert.equal(await card().getByRole('checkbox').count(), 4, 'multi-select = checkboxes (3 options + Other)');
await card().getByText('Calm and natural').waitFor();
for (const n of ['Submit', 'Skip', 'Reply in chat instead']) await card().getByRole('button', { name: n }).waitFor();
assert.equal(await page.getByText('Waiting for your answer').count(), 1, 'working indicator says what it waits for');
assert.equal(await card().getByRole('button', { name: 'Submit' }).isDisabled(), true, 'Submit waits for an answer');
assert.match(await card().locator('.q-preview').innerText(), /#c4552d/, 'preview of the focused option');
await card().getByText('Green').hover();
assert.match(await card().locator('.q-preview').innerText(), /#2e7d4f/, 'preview follows the hovered option');
await shot('open');
log('card renders with chips, options, descriptions, preview, Other/Skip/Reply in chat');

// 2. keyboard only: focus lands in the card; arrows pick, number keys pick, Space toggles, Enter submits
assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.question')), true, 'new card takes focus');
await page.keyboard.press('ArrowDown'); // radio group: arrow moves and selects
assert.equal(await card().getByRole('radio', { name: /Green/ }).isChecked(), true, 'arrow key selects');
await page.keyboard.press('1');
assert.equal(await card().getByRole('radio', { name: /Red/ }).isChecked(), true, 'number key selects');
await page.keyboard.press('Tab'); // out of the radio group: the Other text box...
assert.equal(await card().getByRole('radio', { name: /Red/ }).isChecked(), true, 'tabbing past Other does not change the answer');
await page.keyboard.press('Tab'); // ...then the next question
await page.keyboard.press('Space');
await page.keyboard.press('3');
assert.equal(await card().getByRole('checkbox', { name: /Dark mode/ }).isChecked(), true, 'Space toggles');
assert.equal(await card().getByRole('checkbox', { name: /Icons/ }).isChecked(), true, 'number key toggles in multi-select');
await page.keyboard.press('Escape');
assert.equal(await card().count(), 1, 'Escape does not dismiss the card');
await page.keyboard.press('Enter');
await idle();
assert.equal(await page.locator('.question.done').count(), 1, 'card collapsed to a summary');
const summary = await page.locator('.question.done').innerText();
assert.match(summary, /Which colour do you prefer\?.*Red/s);
assert.match(summary, /Which extras do you want\?.*Dark mode, Icons/s);
const reply = await page.locator('.msg.assistant').last().innerText();
assert.ok(reply.includes('Red') && reply.includes('Dark mode, Icons'), 'the next message uses the answer');
await shot('answered');
log('keyboard-only answering (arrows, numbers, Space, Enter), collapse, reply uses the answer');

// 3. reload: replay shows the same summary
await page.reload();
await page.locator('.question.done').waitFor();
assert.equal(await page.locator('.question.done').innerText(), summary, 'replay shows the same summary');
log('reload replays the answered card');

// 4. Other text + multi-select by mouse
await send('another question');
await card().waitFor();
await card().getByLabel('Other answer for Colour').fill('Teal');
assert.equal(await card().getByRole('radio', { name: /Other/ }).first().isChecked(), true, 'typing in Other selects it');
await card().getByRole('checkbox', { name: /Animations/ }).check();
await card().getByRole('checkbox', { name: /Icons/ }).check();
await card().getByLabel('Other answer for Extras').fill('Sound');
await card().getByRole('button', { name: 'Submit' }).click();
await idle();
const t = await page.locator('.msg.assistant').last().innerText();
assert.ok(t.includes('Teal') && t.includes('Animations, Icons, Sound'), t);
log('Other free text and multi-select');

// 5. Other with no text cannot be submitted
await send('question again');
await card().waitFor();
await card().getByRole('radio', { name: /Other/ }).first().check();
await card().getByRole('checkbox', { name: /Icons/ }).check();
assert.equal(await card().getByRole('button', { name: 'Submit' }).isDisabled(), true, 'empty Other is not an answer');
await card().getByRole('button', { name: 'Skip' }).click();
await idle();
assert.match(await page.locator('.question.done').last().innerText(), /Skipped/);
assert.match(await page.locator('.msg.assistant').last().innerText(), /skipped/i);
log('Skip');

// 6. Reply in chat instead: card closes, composer gets focus
await send('question please');
await card().waitFor();
await card().getByRole('button', { name: 'Reply in chat instead' }).click();
await idle();
assert.match(await page.locator('.question.done').last().innerText(), /Replied in chat/);
assert.match(await page.locator('.msg.assistant').last().innerText(), /reply in chat/i);
assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Message', 'composer is focused for your reply');
log('Reply in chat instead');

// 7. Stop cancels a pending card
await send('last question');
await card().waitFor();
await page.getByRole('button', { name: /Stop/ }).click();
await idle();
await page.locator('.question.done.cancelled').waitFor();
assert.match(await page.locator('.question.done.cancelled').innerText(), /Cancelled/);
assert.equal(await card().count(), 0);
await shot('cancelled');
await page.reload();
await page.locator('.question.done.cancelled').waitFor();
log('Stop cancels the card, and it replays as cancelled');

// 8. focus ring on every control in the card (inset, visible)
await send('question focus');
await card().waitFor();
const rings = [];
for (let i = 0; i < 14; i++) {
  const r = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || !el.closest('.question')) return null;
    const own = getComputedStyle(el), row = el.closest('.q-opt'), outer = row ? getComputedStyle(row) : own;
    const w = (s) => s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    return { name: el.getAttribute('aria-label') || el.textContent || el.type, ring: w(own) || w(outer), inset: parseFloat((w(own) ? own : outer).outlineOffset) < 0 };
  });
  if (r) rings.push(r);
  await page.keyboard.press('Tab');
}
assert.ok(rings.length >= 6, 'tabbed through the card');
assert.deepEqual(rings.filter((r) => !r.ring || !r.inset).map((r) => r.name), [], 'every focused control shows an inset ring');
await shot('focus');
await page.getByRole('button', { name: /Stop/ }).click();
await idle();
log(`focus ring visible on ${rings.length} focus stops in the card`);

// 9. reduced motion: nothing animates in the card
await page.emulateMedia({ reducedMotion: 'reduce' });
await send('question motion');
await card().waitFor();
const anim = await card().evaluate((el) => [el, ...el.querySelectorAll('*')].some((n) => { const s = getComputedStyle(n); return s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.001; }));
assert.equal(anim, false, 'reduced motion: no animation');
await page.getByRole('button', { name: /Stop/ }).click();
log('prefers-reduced-motion respected');

assert.deepEqual(errors, [], 'no page errors');
console.log('all passed');
await browser.close();
