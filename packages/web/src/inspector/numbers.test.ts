import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, commitLength, formatShadow, nudge, parseColor, parseHexInput, parseLength, parseShadow, scrub, toCss, toHex6 } from './numbers';

test('parseLength reads px, %, bare numbers and rejects words', () => {
  assert.deepEqual(parseLength('12px'), { n: 12, unit: 'px' });
  assert.deepEqual(parseLength(' 50% '), { n: 50, unit: '%' });
  assert.deepEqual(parseLength('-3.5'), { n: -3.5, unit: '' });
  assert.deepEqual(parseLength('.5em'), { n: 0.5, unit: 'em' });
  assert.equal(parseLength('auto'), null);
  assert.equal(parseLength('12 px px'), null);
  assert.equal(parseLength(''), null);
});

test('commitLength applies the default unit only to bare numbers', () => {
  assert.equal(commitLength('12'), '12px');
  assert.equal(commitLength('50%'), '50%');
  assert.equal(commitLength('1.23456'), '1.235px');
  assert.equal(commitLength('nope'), null);
});

test('scrub: one step per pixel, Shift 10x, Alt 0.1x, clamped', () => {
  assert.equal(scrub(10, 5), 15);
  assert.equal(scrub(10, 5, {}, { shift: true }), 60);
  assert.equal(scrub(10, 5, {}, { alt: true }), 10.5);
  assert.equal(scrub(10, -50, { min: 0 }), 0);
  assert.equal(scrub(50, 90, { max: 100 }), 100);
  assert.equal(scrub(0, 4, { step: 0.25 }), 1);
  assert.equal(scrub(0, 8, { sens: 4 }), 2, 'sens is pixels per step');
});

test('nudge steps by 1, Shift by 10, within bounds', () => {
  assert.equal(nudge(5, 1), 6);
  assert.equal(nudge(5, -1, {}, true), -5);
  assert.equal(nudge(0, -1, { min: 0 }), 0);
  assert.equal(nudge(0.1, 1, { step: 0.1 }), 0.2);
  assert.equal(clamp(5, 0, 3), 3);
});

test('colours: parse, hex and css round trips', () => {
  assert.deepEqual(parseColor('rgb(255, 0, 128)'), { r: 255, g: 0, b: 128, a: 1 });
  assert.deepEqual(parseColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(parseColor('rgb(0 0 0 / 50%)'), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(parseColor('#f80'), { r: 255, g: 136, b: 0, a: 1 });
  assert.equal(parseColor('#11223380')?.a.toFixed(2), '0.50');
  assert.deepEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  assert.equal(parseColor('red'), null);
  assert.equal(toHex6({ r: 255, g: 0, b: 128, a: 0.2 }), '#ff0080');
  assert.equal(toCss({ r: 1, g: 2, b: 3, a: 1 }), '#010203');
  assert.equal(toCss({ r: 1, g: 2, b: 3, a: 0.5 }), 'rgba(1, 2, 3, 0.5)');
});

test('hex input: with or without #, short form, keeps alpha unless one is typed', () => {
  assert.deepEqual(parseHexInput('FF8800', 0.4), { r: 255, g: 136, b: 0, a: 0.4 });
  assert.deepEqual(parseHexInput('#f80'), { r: 255, g: 136, b: 0, a: 1 });
  assert.equal(parseHexInput('ff880080', 1)?.a.toFixed(2), '0.50');
  assert.equal(parseHexInput('zzz'), null);
  assert.equal(parseHexInput('12'), null);
});

test('shadows: parse the computed form, format back, ignore none/inset', () => {
  const s = parseShadow('rgba(0, 0, 0, 0.25) 0px 4px 8px 2px');
  assert.deepEqual(s, { x: 0, y: 4, blur: 8, spread: 2, color: { r: 0, g: 0, b: 0, a: 0.25 } });
  assert.equal(formatShadow(s!), 'rgba(0, 0, 0, 0.25) 0px 4px 8px 2px');
  assert.equal(parseShadow('none'), null);
  assert.equal(parseShadow('inset 0 1px 2px red'), null);
  assert.equal(parseShadow('rgb(10, 20, 30) 1px 2px 3px')?.spread, 0, 'spread defaults to 0');
});
