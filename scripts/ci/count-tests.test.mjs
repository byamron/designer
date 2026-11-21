import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countTests } from './lib/count-tests.mjs';
import { frontmatterPaths, matchesAny } from './lib/glob.mjs';

test('counts node:test cases and assertions, ignoring comments', () => {
  const src = `import { test } from 'node:test';
// test('commented out', () => assert.ok(1));
/* test('block', () => { assert.ok(2); }); */
test('a', () => { assert.equal(1, 1); assert.ok(true); });
test('b', async () => { assert.rejects(x); });
`;
  assert.deepEqual(countTests(src, 'x.test.ts'), { cases: 2, assertions: 3, skipped: 0, only: 0 });
});

test('detects skip, todo, { skip: true } and only', () => {
  const src = `test.skip('a', () => {});\ntest('b', { skip: true }, () => {});\nit.todo('c');\ntest.only('d', () => {});\n`;
  const c = countTests(src, 'x.test.ts');
  assert.equal(c.skipped, 3);
  assert.equal(c.only, 1);
});

test('e2e files count their log() scenario lines as cases', () => {
  const src = `const log = (m) => console.log(m);\n{\n  assert.equal(1, 1);\n  log('works');\n}\n  log('also');\n`;
  assert.deepEqual(countTests(src, 'e2e/ui.e2e.mjs'), { cases: 2, assertions: 1, skipped: 0, only: 0 });
});

test('glob: ** crosses directories, * does not; frontmatter paths are read', () => {
  assert.ok(matchesAny('packages/desktop/shim/a/b.mjs', ['packages/desktop/**']));
  assert.ok(matchesAny('packages/server/src/security.test.ts', ['packages/server/src/*.test.ts']));
  assert.ok(!matchesAny('packages/server/src/deep/x.test.ts', ['packages/server/src/*.test.ts']));
  assert.ok(!matchesAny('packages/desktopx/a.mjs', ['packages/desktop/**']));
  assert.ok(matchesAny('.github/workflows/ci.yml', ['.github/workflows/**']));
  assert.deepEqual(frontmatterPaths('---\ndescription: x\npaths:\n  - "a/b.ts"\n  - c/**\n---\nbody\n'), ['a/b.ts', 'c/**']);
});
