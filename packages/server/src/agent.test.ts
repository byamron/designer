import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentSource } from './agent.js';

test('agent script is plain ASCII (it is served without a charset, so anything else would show as mojibake)', () => {
  const bad = [...agentSource()].filter((c) => c.charCodeAt(0) > 126);
  assert.deepEqual(bad, []);
});

test('agent protocol: the messages the inspector panel relies on are handled, and every reply echoes the session nonce', () => {
  const src = agentSource();
  for (const t of ['hello', 'enable', 'select', 'deselect', 'apply', 'reset', 'place', 'size']) assert.match(src, new RegExp(`case '${t}'`), `handles ${t}`);
  assert.match(src, /m\.nonce = nonce/, 'replies carry the nonce');
  assert.match(src, /e\.source !== window\.parent/, 'only the embedding window is believed');
  assert.match(src, /ORIGINS\.indexOf\(e\.origin\) < 0/, 'only the app origins are believed');
});
