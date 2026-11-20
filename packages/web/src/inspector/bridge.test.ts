import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accept } from './bridge';

const win = {} as Window;
const frame = { win, origin: 'http://localhost:4500' };
const ok = { designer: 1, nonce: 'n1', type: 'selected' };

test('accepts only the frame window, its origin, the Designer tag and this session nonce', () => {
  assert.deepEqual(accept({ source: win, origin: frame.origin, data: ok }, frame, 'n1'), ok);
  assert.equal(accept({ source: {}, origin: frame.origin, data: ok }, frame, 'n1'), null, 'another window');
  assert.equal(accept({ source: win, origin: 'http://evil.test', data: ok }, frame, 'n1'), null, 'another origin');
  assert.equal(accept({ source: win, origin: frame.origin, data: { ...ok, designer: 2 } }, frame, 'n1'), null, 'not tagged');
  assert.equal(accept({ source: win, origin: frame.origin, data: { ...ok, nonce: 'guess' } }, frame, 'n1'), null, 'forged: wrong nonce');
  assert.equal(accept({ source: win, origin: frame.origin, data: { designer: 1, type: 'selected' } }, frame, 'n1'), null, 'forged: no nonce');
  assert.equal(accept({ source: win, origin: frame.origin, data: 'text' }, frame, 'n1'), null);
  assert.equal(accept({ source: win, origin: frame.origin, data: null }, frame, 'n1'), null);
  assert.equal(accept({ source: win, origin: frame.origin, data: ok }, null, 'n1'), null, 'no frame attached');
});
