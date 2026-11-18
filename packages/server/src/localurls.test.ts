import test from 'node:test';
import assert from 'node:assert/strict';
import { localUrls, isLocalUrl } from '../../web/src/localUrls.js';

test('localUrls finds local http(s) URLs', () => {
  assert.deepEqual(localUrls('Open http://localhost:5173/ now.'), ['http://localhost:5173/']);
  assert.deepEqual(localUrls('see http://127.0.0.1:8080/x?a=1, ok'), ['http://127.0.0.1:8080/x?a=1']);
  assert.deepEqual(localUrls('http://[::1]:4000/app'), ['http://[::1]:4000/app']);
  assert.deepEqual(localUrls('http://localhost:3000 and http://localhost:3000'), ['http://localhost:3000'], 'de-duplicated');
});

test('bare forms count only in code/command output and only with a port', () => {
  assert.deepEqual(localUrls('run on localhost:3000'), []);
  assert.deepEqual(localUrls('Local: localhost:3000', { code: true }), ['http://localhost:3000']);
  assert.deepEqual(localUrls('127.0.0.1:8080/x', { code: true }), ['http://127.0.0.1:8080/x']);
  assert.deepEqual(localUrls('[::1]:4000', { code: true }), ['http://[::1]:4000']);
  assert.deepEqual(localUrls('localhost', { code: true }), []);
});

test('localUrls ignores look-alikes, other schemes and prose', () => {
  for (const s of [
    'http://localhost.evil.com/', 'localhost.evil.com:3000', 'http://localhostfoo', 'file:///etc/passwd',
    'javascript:alert(1)', 'took 3000ms', 'version 1.2.3:4000', 'https://evil.com/localhost:3000', 'http://a@localhost.evil.com',
    'http://localhost:99999/',
  ]) assert.deepEqual(localUrls(s, { code: true }), [], s);
});

test('isLocalUrl accepts only whole local URLs', () => {
  assert.equal(isLocalUrl('http://localhost:5173/'), true);
  assert.equal(isLocalUrl('https://example.com/'), false);
  assert.equal(isLocalUrl('http://localhost.evil.com/'), false);
  assert.equal(isLocalUrl('javascript:alert(1)'), false);
});
