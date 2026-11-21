#!/usr/bin/env node
// Lints a pull request body against docs/pr-protocol.md: a Safety section and a parseable `orchestrator` block.
// Env: PR_BODY (required), PR_BASE_REF (the branch the PR targets), PR_AUTHOR (bots are skipped: Dependabot has no template).
import { fileURLToPath } from 'node:url';
import { orchestratorProblems, safetySectionProblems } from './lib/pr-body.mjs';

export function lint(body, { baseRef, author } = {}) {
  if (author && /\[bot\]$/.test(author)) return { skipped: `PR by ${author}: no template expected`, problems: [] };
  const problems = [...safetySectionProblems(body, { touched: false }), ...orchestratorProblems(body, { baseRef })];
  return { skipped: null, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.PR_BODY === undefined) (console.error('pr-body-lint: PR_BODY is not set'), process.exit(2));
  const r = lint(process.env.PR_BODY, { baseRef: process.env.PR_BASE_REF, author: process.env.PR_AUTHOR });
  if (r.skipped) console.log(`pr-body-lint: skipped (${r.skipped})`);
  else if (!r.problems.length) console.log('pr-body-lint: ok (Safety section and orchestrator block are present and well formed)');
  for (const p of r.problems) console.log(`::error title=PR body::${p}`);
  process.exit(r.problems.length ? 1 : 0);
}
