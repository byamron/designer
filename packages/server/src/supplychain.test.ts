// Pins the supply-chain settings from the 2026-11 audit: install scripts off, a clean lockfile, CI actions pinned to commits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const { lockfileProblems }: { lockfileProblems: (lock: unknown) => string[] } = await import(root('scripts/lib/lockfile.mjs'));

test('the lockfile only points at the npm registry and every entry has an integrity hash', () => {
  assert.deepEqual(lockfileProblems(JSON.parse(readFileSync(root('package-lock.json'), 'utf8'))), []);
});

test('lockfile check catches a swapped source, a missing hash and plain http', () => {
  const lock = (p: object) => ({ lockfileVersion: 3, packages: { '': {}, ...p } });
  const ok = { resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz', integrity: 'sha512-abc' };
  assert.deepEqual(lockfileProblems(lock({ 'node_modules/a': ok })), []);
  assert.match(lockfileProblems(lock({ 'node_modules/a': { ...ok, resolved: 'git+ssh://git@github.com/x/a.git#abc' } }))[0], /not https:\/\/registry\.npmjs\.org/);
  assert.match(lockfileProblems(lock({ 'node_modules/a': { ...ok, resolved: 'http://registry.npmjs.org/a/-/a-1.0.0.tgz' } }))[0], /a:/);
  assert.match(lockfileProblems(lock({ 'node_modules/a': { resolved: ok.resolved } }))[0], /no integrity/);
  assert.match(lockfileProblems(lock({ 'node_modules/a': { integrity: 'sha512-abc' } }))[0], /no "resolved"/);
  assert.match(lockfileProblems(lock({ 'node_modules/a': { ...ok, resolved: 'https://user:pw@evil.example/a.tgz' } }))[0], /<credentials>/);
  assert.equal(lockfileProblems({}).length, 1);
});

test('dependency install scripts are switched off for everyone (npm ci, npm install, Update & Restart)', () => {
  assert.match(readFileSync(root('.npmrc'), 'utf8'), /^ignore-scripts=true$/m);
});

test('every GitHub Action in CI is pinned to a full commit SHA, and the workflow token is read-only', () => {
  const dir = root('.github/workflows');
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const text = readFileSync(`${dir}/${f}`, 'utf8');
    for (const m of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      if (m[1].startsWith('./')) continue;
      assert.match(m[1], /@[0-9a-f]{40}$/, `${f}: ${m[1]} must be pinned to a commit SHA`);
    }
    assert.match(text, /^permissions:\s*\n\s+contents: read\s*$/m, `${f}: top-level permissions are read-only`);
    assert.doesNotMatch(text, /pull_request_target/, `${f}: pull_request_target runs fork code with secrets`);
  }
});
