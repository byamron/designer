import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lint } from './pr-body-lint.mjs';
import { section } from './lib/pr-body.mjs';

const SHA = 'a'.repeat(40);
const block = (over = {}) => {
  const d = { project: 'ci-hardening', 'merge-order': '1', base: 'main', 'base-sha': SHA, 'depends-on': '[]', owns: '[.github/]', 'touched-outside-owned': '[]', 'conflict-risk': '[]', 'new-dependencies': 'none', 'docs-changed': 'docs/specs/ci.md', checks: '{ typecheck: pass, unit: "102/102", e2e: "ui pass" }', 'needs-mac': '[]', ...over };
  return '```orchestrator\n' + Object.entries(d).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}   # note`).join('\n') + '\n```';
};
const body = ({ safety = 'Touches packages/server/src/auth.ts; security.test.ts pins the token checks.', orch = block() } = {}) =>
  `## [x] title\n\n### What this does\nstuff\n\n### Safety (see .claude/rules/safety.md)\n${safety}\n\n### Deliberately not done\nnothing\n\n### Orchestrator block (machine-read)\n${orch}\n---\n`;
const msgs = (b, o) => lint(b, o).problems;

test('a filled-in body passes', () => assert.deepEqual(msgs(body(), { baseRef: 'main' }), []));
test('"no safety-critical paths touched" is a valid Safety section for lint (the path gate decides if it is true)', () => assert.deepEqual(msgs(body({ safety: 'no safety-critical paths touched' })), []));

test('missing Safety section, empty, or template placeholder fails', () => {
  assert.match(msgs('### What\nx\n' + block())[0], /no "Safety" section/);
  assert.match(msgs(body({ safety: '' }))[0], /empty or still the template placeholder/);
  assert.match(msgs(body({ safety: '<which safety-critical paths you touched and which tests pin the behavior, or "no safety-critical paths touched">' }))[0], /placeholder/);
  assert.match(msgs(body({ safety: '<!-- fill me in -->' }))[0], /empty/);
});

test('missing or unparsable orchestrator block fails', () => {
  assert.match(msgs(body({ orch: 'none' }))[0], /no fenced ```orchestrator block/);
  assert.match(msgs(body({ orch: block({ checks: '{ typecheck: pass' }) }))[0], /unclosed \{/);
});

test('each required key is required', () => {
  for (const k of ['project', 'merge-order', 'base', 'base-sha', 'depends-on', 'owns', 'touched-outside-owned', 'conflict-risk', 'new-dependencies', 'docs-changed', 'checks', 'needs-mac']) {
    assert.ok(msgs(body({ orch: block({ [k]: null }) })).some((p) => p.includes(`missing key "${k}"`)), k);
  }
});

test('values are validated: sha, merge-order, lists, placeholders, base mismatch', () => {
  assert.ok(msgs(body({ orch: block({ 'base-sha': '<output of git rev-parse origin/main>' }) })).some((p) => /base-sha/.test(p)));
  assert.ok(msgs(body({ orch: block({ 'base-sha': 'abc123' }) })).some((p) => /40-character/.test(p)));
  assert.ok(msgs(body({ orch: block({ 'merge-order': '<n>' }) })).some((p) => /merge-order/.test(p)));
  assert.ok(msgs(body({ orch: block({ 'depends-on': 'none' }) })).some((p) => /depends-on: must be a list/.test(p)));
  assert.ok(msgs(body({ orch: block({ checks: '{ typecheck: pass, unit: "N/N" }' }) })).some((p) => /placeholder/.test(p)));
  assert.ok(msgs(body({ orch: block({ project: '<id>' }) })).some((p) => /placeholder/.test(p)));
  assert.ok(msgs(body(), { baseRef: 'feat/parent' }).some((p) => /says "main" but the PR targets "feat\/parent"/.test(p)));
});

test('a stacked PR names its parent branch as base', () => assert.deepEqual(msgs(body({ orch: block({ base: 'feat/parent' }) }), { baseRef: 'feat/parent' }), []));

test('bot PRs (Dependabot) are skipped', () => assert.equal(lint('bump x', { author: 'dependabot[bot]' }).skipped !== null, true));

test('the repository PR template, unfilled, fails; headings in code fences do not end a section', () => {
  const tpl = readFileSync(new URL('../../.github/pull_request_template.md', import.meta.url), 'utf8');
  assert.ok(msgs(tpl).length >= 3, 'placeholders are all caught');
  assert.equal(section('### Safety\n```sh\n# a comment, not a heading\n```\nreal text\n### Next\nx', 'Safety').includes('real text'), true);
});
