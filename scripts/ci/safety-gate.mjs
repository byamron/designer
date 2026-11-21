#!/usr/bin/env node
// Safety-path gate. When a pull request changes a path listed in .claude/rules/safety.md (plus the files that
// implement the gates themselves), it must say so in the PR body's Safety section, and it must not shrink the
// security tests that docs/security.md cites as pinning each mitigation.
//
//   Env: BASE_SHA, HEAD_SHA (commits to compare, three-dot: the PR's own changes), PR_BODY, PR_LABELS (JSON array of names),
//        PR_AUTHOR. Run from the repository root of the PR head (needs the base commit fetched).
//   The `safety-reviewed` label waives the "tests shrank" check only, never the Safety section.
//   Mechanical backstop against honest mistakes and sloppy agents, not against someone who edits the gate: CI runs the
//   base branch's copy of this script (see .github/actions/trusted-scripts), and edits to it are themselves gated below.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { frontmatterPaths, matchesAny } from './lib/glob.mjs';
import { countTests } from './lib/count-tests.mjs';
import { safetySectionProblems } from './lib/pr-body.mjs';

export const WAIVER_LABEL = 'safety-reviewed';
/** Not in safety.md, but a change here changes what the gates check. */
export const GATE_PATHS = ['.claude/rules/safety.md', '.github/workflows/**', '.github/actions/**', '.github/dependabot.yml', 'scripts/ci/**'];

/** Test files docs/security.md names as pinning mitigations: `foo.test.ts` (in packages/server/src) and e2e suites. */
export function pinnedFiles(securityMd) {
  const out = new Set(['e2e/ui.e2e.mjs']);
  for (const m of securityMd.matchAll(/\b([\w-]+\.test\.ts)\b/g)) out.add(`packages/server/src/${m[1]}`);
  for (const m of securityMd.matchAll(/\be2e\/([\w-]+\.e2e\.mjs)\b/g)) out.add(`e2e/${m[1]}`);
  for (const m of securityMd.matchAll(/`([\w-]+)\.e2e`/g)) out.add(`e2e/${m[1]}.e2e.mjs`);
  return [...out].sort();
}

/**
 * @param {object} i
 * @param {string[]} i.changed        files changed by the PR
 * @param {string[]} i.safetyPaths    globs from safety.md frontmatter (base ∪ head)
 * @param {Record<string,{cases:number,assertions:number,skipped:number,only:number}|null>} i.base counts at the base (null = file absent)
 * @param {Record<string,{cases:number,assertions:number,skipped:number,only:number}|null>} i.head counts at the head
 */
export function evaluate({ changed, safetyPaths, body, labels, author, base, head }) {
  if (author && /\[bot\]$/.test(author)) {
    // Dependabot cannot write a Safety section: it still must not shrink or disable tests (it never touches them).
    return { touched: [], problems: testProblems({ base, head, labels }), notes: [`PR by ${author}: Safety section not required`] };
  }
  const globs = [...safetyPaths, ...GATE_PATHS];
  const touched = changed.filter((f) => matchesAny(f, globs));
  const problems = [];
  if (touched.length) problems.push(...safetySectionProblems(body, { touched: true }));
  problems.push(...testProblems({ base, head, labels }));
  return { touched, problems, notes: [] };
}

function testProblems({ base, head, labels }) {
  const waived = (labels ?? []).includes(WAIVER_LABEL);
  const only = [];
  const shrank = [];
  for (const f of Object.keys({ ...base, ...head }).sort()) {
    const b = base[f] ?? { cases: 0, assertions: 0, skipped: 0, only: 0 };
    const h = head[f] ?? null;
    if (h && h.only > b.only) only.push(`${f}: has .only( (${h.only}), which silently skips every other test in the file. Not waivable.`);
    if (!h && base[f]) shrank.push(`${f}: deleted or renamed (${b.cases} cases, ${b.assertions} assertions at base)`);
    else if (h) {
      if (h.cases < b.cases) shrank.push(`${f}: test cases dropped ${b.cases} -> ${h.cases}`);
      if (h.assertions < b.assertions) shrank.push(`${f}: assertions dropped ${b.assertions} -> ${h.assertions}`);
      if (h.skipped > b.skipped) shrank.push(`${f}: skipped/todo tests rose ${b.skipped} -> ${h.skipped}`);
    }
  }
  if (waived) return only;
  if (shrank.length) shrank.push(`If this is intended (a test was replaced or merged and you reviewed it), a maintainer can add the "${WAIVER_LABEL}" label and re-run.`);
  return [...only, ...shrank];
}

// ---- CLI ---------------------------------------------------------------------------------------------------------

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const show = (rev, path) => { try { return git('show', `${rev}:${path}`); } catch { return null; } };

export function gather({ baseSha, headSha }) {
  const changed = git('diff', '--name-only', '--no-renames', `${baseSha}...${headSha}`).split('\n').filter(Boolean);
  const safetyPaths = [...new Set([...frontmatterPaths(show(baseSha, '.claude/rules/safety.md') ?? ''), ...frontmatterPaths(show(headSha, '.claude/rules/safety.md') ?? '')])];
  const files = [...new Set([...pinnedFiles(show(baseSha, 'docs/security.md') ?? ''), ...pinnedFiles(show(headSha, 'docs/security.md') ?? '')])];
  const count = (rev) => Object.fromEntries(files.map((f) => { const s = show(rev, f); return [f, s === null ? null : countTests(s, f)]; }));
  return { changed, safetyPaths, base: count(baseSha), head: count(headSha) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { BASE_SHA, HEAD_SHA, PR_BODY, PR_LABELS, PR_AUTHOR } = process.env;
  if (!BASE_SHA || !HEAD_SHA || PR_BODY === undefined) (console.error('safety-gate: BASE_SHA, HEAD_SHA and PR_BODY are required'), process.exit(2));
  let labels = [];
  try { labels = JSON.parse(PR_LABELS || '[]'); } catch { console.error('safety-gate: PR_LABELS is not JSON'); process.exit(2); }
  const r = evaluate({ ...gather({ baseSha: BASE_SHA, headSha: HEAD_SHA }), body: PR_BODY, labels, author: PR_AUTHOR });
  for (const n of r.notes) console.log(`safety-gate: ${n}`);
  console.log(r.touched.length ? `safety-gate: this PR touches ${r.touched.length} safety-critical path(s):\n  ${r.touched.join('\n  ')}` : 'safety-gate: no safety-critical paths touched');
  for (const p of r.problems) console.log(`::error title=Safety gate::${p}`);
  if (!r.problems.length) console.log('safety-gate: ok');
  process.exit(r.problems.length ? 1 : 0);
}
