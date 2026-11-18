# Spec: continuous integration

**Goal:** every push and pull request runs the checks we run by hand, so a green check means "safe to merge".

## Workflow (`.github/workflows/ci.yml`)
- Triggers: push to any branch, pull requests.
- Job `checks` (ubuntu, Node 22, `npm ci`, cache npm): `npm run typecheck`, `npm test`, `npm run build`.
- Job `browser` (needs `checks`): install Playwright Chromium (`npx playwright install --with-deps chromium`), run
  `e2e/run.sh` (suites: ui, focus, motion, selfhost). Upload `*.log` and Playwright traces/screenshots on failure.
- Job `audit` (non-blocking): `npm audit --omit=dev`, printed to the summary.
- Later (not now): a desktop job with `xvfb-run -a node e2e/desktop.e2e.mjs` once that suite is stable.
- Keep it fast: cache `~/.npm` and the Playwright browsers; total under ~6 minutes.

## Notes
- `e2e/run.sh` starts and stops its own servers; it needs `playwright` resolvable (add it as a root devDependency or install
  in CI; prefer a devDependency pinned to the version the tests were written against).
- `packages/server/src/security.test.ts` starts the real server on random ports; fine in CI.
- Do not add secrets. No deploy steps.

## Acceptance
- A pull request with a deliberate failing test turns the check red; reverting turns it green.
- The workflow file is the only change plus README badge/notes and the Playwright devDependency.
