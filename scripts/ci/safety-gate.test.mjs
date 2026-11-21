// Unit tests for the decision, plus end-to-end runs of the CLI against throwaway git repositories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, pinnedFiles } from './safety-gate.mjs';

const gate = fileURLToPath(new URL('./safety-gate.mjs', import.meta.url));
const SAFE = 'Touches auth.ts; security.test.ts keeps pinning the token checks and I added a case for the new header.';
const NONE = 'no safety-critical paths touched';
const paths = ['packages/server/src/auth.ts', 'packages/server/src/*.test.ts', 'packages/desktop/**', 'e2e/ui.e2e.mjs'];
const counts = (cases, assertions, extra = {}) => ({ cases, assertions, skipped: 0, only: 0, ...extra });
const ev = (o) => evaluate({ changed: [], safetyPaths: paths, body: `### Safety\n${SAFE}`, labels: [], base: {}, head: {}, ...o });

test('no safety path touched: passes even with "no safety-critical paths touched"', () => {
  const r = ev({ changed: ['packages/web/src/App.tsx'], body: `### Safety\n${NONE}` });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.touched, []);
});

test('touching a safety path with a missing, placeholder, "none touched" or too-short Safety section fails', () => {
  const changed = ['packages/server/src/auth.ts'];
  assert.match(ev({ changed, body: 'no section' }).problems[0], /no "Safety" section/);
  assert.match(ev({ changed, body: '### Safety\n<which safety-critical paths you touched>' }).problems[0], /empty or still the template/);
  assert.match(ev({ changed, body: `### Safety\n${NONE}` }).problems[0], /says no safety-critical paths were touched/);
  assert.match(ev({ changed, body: '### Safety\nfine' }).problems[0], /too short/);
  assert.deepEqual(ev({ changed }).problems, []);
});

test('the gate files themselves count as safety paths (workflows, scripts/ci, the rule file)', () => {
  for (const f of ['.github/workflows/ci.yml', 'scripts/ci/safety-gate.mjs', '.claude/rules/safety.md', '.github/dependabot.yml']) {
    assert.equal(ev({ changed: [f], body: `### Safety\n${NONE}` }).touched.length, 1, f);
  }
});

test('bot PRs need no Safety section but still may not shrink tests', () => {
  assert.deepEqual(ev({ changed: ['.github/workflows/ci.yml'], body: 'bump', author: 'dependabot[bot]' }).problems, []);
});

test('pinned tests: fewer cases, fewer assertions, deleted file, more skips all fail; label waives them but not .only', () => {
  const f = 'packages/server/src/security.test.ts';
  const base = { [f]: counts(7, 31) };
  assert.match(ev({ base, head: { [f]: counts(6, 31) } }).problems[0], /cases dropped 7 -> 6/);
  assert.match(ev({ base, head: { [f]: counts(7, 30) } }).problems[0], /assertions dropped 31 -> 30/);
  assert.match(ev({ base, head: { [f]: null } }).problems[0], /deleted or renamed/);
  assert.match(ev({ base, head: { [f]: counts(7, 31, { skipped: 1 }) } }).problems[0], /skipped\/todo tests rose/);
  assert.deepEqual(ev({ base, head: { [f]: counts(8, 40) } }).problems, []);
  const shrunk = { base, head: { [f]: counts(1, 1) }, labels: ['safety-reviewed'] };
  assert.deepEqual(ev(shrunk).problems, []);
  assert.match(ev({ ...shrunk, head: { [f]: counts(9, 40, { only: 1 }) } }).problems[0], /\.only\(/);
});

test('pinned files are read from docs/security.md', () => {
  const md = 'Tests: `security.test.ts`, `preview.test.ts`, `e2e/desktop.e2e.mjs`, `ui.e2e` and `desktop.test.ts`.';
  assert.deepEqual(pinnedFiles(md), ['e2e/desktop.e2e.mjs', 'e2e/ui.e2e.mjs', 'packages/server/src/desktop.test.ts', 'packages/server/src/preview.test.ts', 'packages/server/src/security.test.ts']);
});

// ---- CLI against real repositories ----------------------------------------------------------------------------------
function repo(files) {
  const d = mkdtempSync(join(tmpdir(), 'gate-'));
  const g = (...a) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  const put = (m) => { for (const [p, c] of Object.entries(m)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); } };
  put(files);
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  const base = g('rev-parse', 'HEAD');
  return { d, base, change(m, rm = []) { put(m); for (const p of rm) g('rm', '-q', p); g('add', '-A'); g('commit', '-q', '-m', 'head'); return g('rev-parse', 'HEAD'); } };
}
const run = (r, head, { body = `### Safety\n${NONE}`, labels = [] } = {}) =>
  spawnSync('node', [gate], { cwd: r.d, encoding: 'utf8', env: { ...process.env, BASE_SHA: r.base, HEAD_SHA: head, PR_BODY: body, PR_LABELS: JSON.stringify(labels) } });
const BASE_FILES = {
  '.claude/rules/safety.md': '---\npaths:\n  - "packages/server/src/auth.ts"\n  - "packages/server/src/*.test.ts"\n---\n',
  'docs/security.md': 'pinned by `security.test.ts` and `ui.e2e`\n',
  'packages/server/src/auth.ts': 'export const a = 1;\n',
  'packages/server/src/security.test.ts': "test('a', () => { assert.ok(1); assert.ok(2); });\ntest('b', () => { assert.ok(3); });\n",
  'e2e/ui.e2e.mjs': "assert.ok(1);\nlog('one');\n",
  'README.md': 'x\n',
};

test('CLI: an unrelated change passes', () => {
  const r = repo(BASE_FILES);
  const out = run(r, r.change({ 'README.md': 'y\n' }));
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /no safety-critical paths touched/);
});

test('CLI: a safety path with the "none touched" body fails', () => {
  const r = repo(BASE_FILES);
  const out = run(r, r.change({ 'packages/server/src/auth.ts': 'export const a = 2;\n' }));
  assert.equal(out.status, 1);
  assert.match(out.stdout, /::error title=Safety gate::the "Safety" section says no safety-critical paths were touched/);
});

test('CLI: deleting a pinned assertion fails, passes with the safety-reviewed label, and a real Safety section is still required', () => {
  const r = repo(BASE_FILES);
  const head = r.change({ 'packages/server/src/security.test.ts': "test('a', () => { assert.ok(1); });\ntest('b', () => { assert.ok(3); });\n" });
  const fail = run(r, head, { body: `### Safety\n${SAFE}` });
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /security\.test\.ts: assertions dropped 3 -> 2/);
  assert.equal(run(r, head, { body: `### Safety\n${SAFE}`, labels: ['safety-reviewed'] }).status, 0);
  assert.equal(run(r, head, { body: `### Safety\n${NONE}`, labels: ['safety-reviewed'] }).status, 1);
});

test('CLI: deleting a pinned test file, or the ui suite scenarios, fails', () => {
  const r = repo(BASE_FILES);
  const head = r.change({ 'e2e/ui.e2e.mjs': 'assert.ok(1);\n' }, ['packages/server/src/security.test.ts']);
  const out = run(r, head, { body: `### Safety\n${SAFE}` });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /security\.test\.ts: deleted or renamed/);
  assert.match(out.stdout, /ui\.e2e\.mjs: test cases dropped 1 -> 0/);
});

test('CLI: emptying the path list in safety.md in the same PR does not hide the change (base list is used)', () => {
  const r = repo(BASE_FILES);
  const head = r.change({ '.claude/rules/safety.md': '---\npaths: []\n---\n', 'packages/server/src/auth.ts': 'export const a = 3;\n' });
  assert.equal(run(r, head).status, 1);
});
