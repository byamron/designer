// Count the test cases and assertions in a test file, so a pull request that quietly deletes or disables pinned
// security tests is visible. A heuristic by design (no parser): it counts, it does not run.

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}

/**
 * - cases: node:test `test(`/`it(` at statement start; in `*.e2e.mjs` files the `log('...')` line that closes each scenario.
 * - assertions: `assert(`, `assert.x(`, `expect(`.
 * - skipped: `.skip(`, `.todo(`, `{ skip: ... }`. `only`: `.only(` (silently disables every other test).
 */
export function countTests(src, file = '') {
  const c = code(src);
  const n = (re) => (c.match(re) ?? []).length;
  const e2e = /\.e2e\.mjs$/.test(file);
  return {
    cases: e2e ? n(/^\s*log\(/gm) : n(/^\s*(?:test|it)(?:\.only)?\s*\(/gm),
    assertions: n(/\bassert(?:\.\w+)?\s*\(/g) + n(/\bexpect\s*\(/g),
    skipped: n(/\b(?:test|it|describe)\.(?:skip|todo)\s*\(/g) + n(/\bskip\s*:\s*(?:true|['"`])/g),
    only: n(/\b(?:test|it|describe)\.only\s*\(/g),
  };
}
