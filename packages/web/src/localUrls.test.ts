import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localUrls } from './localUrls';
import { urlsInMessage, shortUrl } from './PreviewChips';

const U = 'http://127.0.0.1:5190/';

test('trailing markdown emphasis is not part of the URL', () => {
  assert.deepEqual(localUrls('Open **http://127.0.0.1:5190/** now'), [U]);
  assert.deepEqual(localUrls('Open *http://127.0.0.1:5190/* now'), [U]);
  assert.deepEqual(localUrls('Open _http://127.0.0.1:5190/_ now'), [U]);
  assert.deepEqual(localUrls('Open __http://127.0.0.1:5190/__ now'), [U]);
  assert.deepEqual(localUrls('Open ~~http://127.0.0.1:5190/~~ now'), [U]);
  assert.deepEqual(localUrls('**http://localhost:3000/app**'), ['http://localhost:3000/app']);
  assert.deepEqual(localUrls('**http://localhost:3000**'), ['http://localhost:3000']);
});

test('trailing punctuation, brackets and backticks are dropped', () => {
  for (const s of ['(http://127.0.0.1:5190/)', 'see http://127.0.0.1:5190/.', 'http://127.0.0.1:5190/,', '`http://127.0.0.1:5190/`',
    '[http://127.0.0.1:5190/]', '"http://127.0.0.1:5190/"', '<http://127.0.0.1:5190/>', '(see **http://127.0.0.1:5190/**).', 'http://127.0.0.1:5190/;'])
    assert.deepEqual(localUrls(s), [U], s);
});

test('link-wrapped URLs give one clean URL', () => {
  assert.deepEqual(localUrls('[preview](http://127.0.0.1:5190/)'), [U]);
  assert.deepEqual(localUrls('[http://127.0.0.1:5190/](http://127.0.0.1:5190/)'), [U]);
  assert.deepEqual(localUrls('**[preview](http://127.0.0.1:5190/app)**'), ['http://127.0.0.1:5190/app']);
});

test('real URL characters survive', () => {
  assert.deepEqual(localUrls('http://localhost:5173/a_b/c-d?x=1&y=2#top'), ['http://localhost:5173/a_b/c-d?x=1&y=2#top']);
  assert.deepEqual(localUrls('http://localhost:5173/page_'), ['http://localhost:5173/page']);
  assert.deepEqual(localUrls('http://localhost:5173/a*b'), ['http://localhost:5173/a*b']);
});

test('chips: label and URL have no markdown characters', () => {
  const urls = urlsInMessage('Your app is running at **http://127.0.0.1:5190/** (and `localhost:3000`).');
  assert.deepEqual(urls, [U, 'http://localhost:3000']);
  assert.deepEqual(urls.map(shortUrl), ['127.0.0.1:5190', 'localhost:3000']);
});
