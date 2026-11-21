# Spec: continuous integration

**Goal:** every push and pull request runs the checks we run by hand, so a green check means "safe to merge", and a set of
**independent, mechanical gates** backs up the per-PR reviews agents do at author time. Why it matters now: *Update & Restart*
fast-forwards the owner's checkout from `origin/main` and runs `npm install`, so anything that merges runs on the owner's Mac
([updates.md](../updates.md), [security.md](../security.md) "Residual risks"). CI is the backstop that does not depend on the
author (human or agent) remembering anything.

**Constraint: free through GitHub.** `byamron/designer` is public, so GitHub-hosted runners (including `macos-latest`), CodeQL,
dependency review, Dependabot and secret scanning cost nothing. Nothing here uses a paid or third-party service, a secret, a
token other than the default `GITHUB_TOKEN`, or a self-hosted runner. Third-party actions are only GitHub's own (`actions/*`,
`github/codeql-action`), pinned by full commit SHA with the version in a trailing comment. Tools that are not actions (zizmor,
actionlint) are installed from a hash-pinned wheel / a checksum-verified release.
*If the repo ever went private:* macOS runner minutes bill at 10x, Linux minutes beyond the free allowance bill, CodeQL and
dependency review need GitHub Advanced Security (paid per active committer), and secret scanning push protection needs it too.
Everything else (zizmor, actionlint, `npm audit`, the guard scripts, Dependabot) keeps working.

## Workflows and jobs

| Workflow (file) | Job (= check name) | Runs on | Blocks? | What it catches |
|---|---|---|---|---|
| CI (`ci.yml`) | `checks` | push, PR | **required today** | typecheck, build, unit tests |
| | `browser` | push, PR | **required today** | `e2e/run.sh` browser suites |
| Workflow security (`workflow-security.yml`) | `zizmor` | PR, main, weekly | recommended | unpinned actions, template injection, over-broad `permissions`, persisted credentials, `pull_request_target`, known-vulnerable actions |
| | `actionlint` | PR, main, weekly | recommended | workflow syntax, expression and shell mistakes |
| Dependencies (`dependencies.yml`) | `dependency-review` | PR | recommended | a PR that adds or bumps a dependency with a known high/critical advisory (runtime and dev) |
| | `npm-audit` | PR, main, weekly | recommended | high/critical advisories in production deps, unless allowlisted (with reason and expiry) |
| | `install-scripts` | PR | recommended | new/changed install scripts, non-registry or hash-less lockfile entries |
| PR gates (`pr-gates.yml`) | `safety-gate` | PR | recommended | safety paths touched without a real Safety section; pinned security tests that shrank |
| | `pr-body` | PR | recommended | missing Safety section, missing/malformed `orchestrator` block |
| | `guard-tests` | PR | recommended | the guard scripts' own unit tests |
| CodeQL (`codeql.yml`) | `codeql (javascript-typescript)`, `codeql (actions)` | PR, main, weekly | **not yet** (visible only) | injection, path traversal, unsafe deserialization, SSRF, etc. in our JS/TS and in the workflows |
| macOS app smoke (`macos-smoke.yml`) | `macos-app-smoke` | PR, main | **not yet** | the real `Designer.app` cannot be built, signed, launched or quit |
| Promote stable (`promote-stable.yml`) | `promote` | after CI on main | n/a | advances `stable` (see below) |

Every job has `permissions` declared per job (workflow level is `{}`), a `timeout-minutes`, checkouts with
`persist-credentials: false`, and no workflow uses `pull_request_target`. Only `codeql` (`security-events: write`) and `promote`
(`contents: write`, `checks: read`) get more than `contents: read`. Concurrency groups cancel superseded runs.

### Recommended required checks
Add to the ruleset (the orchestrator does this; ruleset `27782183`) **after each has been green on a few unrelated PRs**:
`zizmor`, `actionlint`, `safety-gate`, `pr-body`, `install-scripts`, `dependency-review`, `npm-audit`, `guard-tests`. Keep
`macos-app-smoke` and the `codeql` checks visible-only until they have a clean track record (see "macOS smoke" for what to
watch). Dependabot PRs have no template: `pr-body` skips bot authors, and `safety-gate` skips the Safety-section requirement
for them but not the test-count check. Checks skipped by an `if:` count as passing for required-check purposes
(`dependency-review` and `install-scripts` only run on PRs, which is the only place they can be required).

## 1. Workflow hardening
- `.github/workflows/*.yml`: least-privilege `permissions`, `timeout-minutes`, `persist-credentials: false`, every action pinned
  by SHA. `zizmor` (v1.32.0, hash-pinned in `.github/zizmor/requirements.txt`) runs over all of `.github` and any finding fails.
  `.github/zizmor.yml` disables one audit (`self-repository`, which only suggests newer `$/` syntax) with the reason in the file.
  The single inline ignore is `workflow_run` in `promote-stable.yml` (see below).
- `.github/dependabot.yml`: `github-actions` (weekly, one grouped PR, 7-day cooldown), `npm` (weekly, minor+patch grouped,
  majors separate, 7-day / 21-day-major cooldown so a freshly published malicious release is not adopted on day one), and `pip`
  for the zizmor pin (monthly). Security updates are separate and already on; they ignore cooldown. PR titles start `[deps]`.
- Run locally: `zizmor .github` and `actionlint` (`brew install zizmor actionlint`).

## 2. Dependency gates
- **`dependency-review`**: `actions/dependency-review-action`, `fail-on-severity: high`, scopes runtime and development (the Mac
  installs both).
- **`npm-audit`**: `scripts/ci/audit-gate.mjs` runs `npm audit --omit=dev --json`; high/critical fail. Waivers live in
  `scripts/ci/audit-allowlist.json` (empty today): `{ "advisory": "GHSA-…" | "package": "name", "reason": "…", "expires": "YYYY-MM-DD" }`.
  A reason (15+ chars) and an expiry are required; an expiry more than 120 days out is rejected; an **expired entry fails the gate**
  again, so a waiver cannot be forgotten. The weekly run exists because a new advisory can turn `main` red with no change of ours.
- **`install-scripts`**: `scripts/ci/install-scripts-guard.mjs` compares `package-lock.json` (and the root and workspace
  `package.json` lifecycle scripts: `preinstall`, `install`, `postinstall`, `prepare`) with the base branch. A package that is new
  or changed and has `hasInstallScript` must be in `scripts/ci/install-scripts-allowlist.json` (`name` + `reason`; esbuild,
  fsevents and electron are there, each with why). It also fails any lockfile entry that does not resolve over https from exactly
  `registry.npmjs.org` or lacks a `sha256/384/512` integrity hash (git URLs, look-alike hosts, plain http, sha1).
  Limits: it compares what the lockfile says, so it cannot see a script that the registry package gains without a lockfile change
  (the lockfile pins the tarball by hash, so that cannot happen silently), and it cannot judge whether an allowlisted script is
  harmless; it only forces a human to look when one appears.

## 3. CodeQL
`github/codeql-action` v4 (init + analyze), `build-mode: none`, default query suite, languages `javascript-typescript` and
`actions` (it scans the workflow files too). PRs, pushes to main and a weekly schedule. Results show under Security > Code
scanning. Not required yet: let it run on a few PRs, triage what it reports, then decide. Free on public repos only.

## 4. Safety-path gate and PR-body lint
- **`safety-gate`** (`scripts/ci/safety-gate.mjs`). The PR's own diff (`base...head`) is matched against the `paths:` list in
  `.claude/rules/safety.md` (read from the base *and* the head, so a PR cannot hide a path by deleting it from the list), plus
  the files that implement the gates (`.claude/rules/safety.md`, `.github/workflows/**`, `.github/actions/**`,
  `.github/dependabot.yml`, `scripts/ci/**`; a decision to review, see below). If any matches, the PR body must have a **Safety**
  section that is not empty, not the template placeholder, and not just "no safety-critical paths touched" (30+ characters that
  name the paths and the pinning tests).
  It also compares, per pinned test file, the number of **test cases**, **assertions**, and **skipped/todo** tests with the base:
  fewer cases, fewer assertions, a deleted or renamed file, or more skips fails; `.only(` always fails. Pinned files are the
  `packages/server/src/*.test.ts` and `e2e/*.e2e.mjs` that `docs/security.md` names, plus `e2e/ui.e2e.mjs`
  (today: `security`, `preview`, `proxy`, `server`, `desktop`, `desktopapp`, `ui.e2e`, `desktop.e2e`, `app.e2e`).
  A maintainer adds the label **`safety-reviewed`** and re-runs to accept a deliberate reduction (a test merged or replaced). The
  label waives the count check only; it never waives the Safety section or `.only(`.
  Counting is a heuristic (regexes over the source, comments stripped), not a parser: it is meant to make a silent deletion
  visible, not to prove coverage. Counts at the time of writing, cases/assertions: security 7/31, preview 5/36, proxy 4/24, server
  14/39, desktop 13/62, desktopapp 11/77, ui.e2e 22/41 (log lines count as cases), desktop.e2e 11/24, app.e2e 7/14.
- **`pr-body`** (`scripts/ci/pr-body-lint.mjs`): the Safety section exists and is not the placeholder; the fenced `orchestrator`
  block parses and has every key in the template (`project`, `merge-order`, `base`, `base-sha` as a 40-hex SHA, `depends-on`,
  `owns`, `touched-outside-owned`, `conflict-risk`, `new-dependencies`, `docs-changed`, `checks`, `needs-mac`), values have the
  right shape, no `<placeholder>` or `N/N` is left, and `base:` equals the PR's actual base branch (stacked PRs name their parent).
  Re-runs on `edited`, `labeled` and `unlabeled`, so fixing the body or adding the label turns it green without a push.
- **The guards run from the base branch.** `.github/actions/trusted-scripts` extracts `scripts/ci` from the PR's *base commit* and
  the jobs run that copy against the PR's files, so a PR that loosens a guard is judged by the old guard. While the base has no
  `scripts/ci` (the PR that introduces them) it falls back to the PR's copy and prints a warning. Allowlists are data from the
  PR head; changing them is a `scripts/ci/**` change and therefore needs a real Safety section.
- **What this cannot do.** Anyone who can change a PR can also edit the workflow that calls the guard, and anyone with triage
  access (including an agent using the owner's `gh` login) can add `safety-reviewed`. These gates stop honest mistakes and sloppy
  automation, not a determined author. The control for that is the ruleset (required checks, and later required reviews or a
  code-owner rule on `.github/` and `scripts/ci/` when there is more than one person), plus reading the diff of those paths.

## 5. macOS app smoke (`macos-app-smoke`)
`macos-latest` (Apple silicon, has a logged-in GUI session, so Electron windows work without Xvfb): `npm ci`,
`npm run make-app -- --out "$RUNNER_TEMP/Designer.app"`, `codesign --verify --deep --strict`, bundle name and id, then
`node e2e/app.e2e.mjs` (builds its own bundle, launches it with a Dock-style bare `PATH`, checks the server's environment has no
`ANTHROPIC_*`, single instance, quit stops the server, moved-checkout message, Electron-bump rebuild) and
`node e2e/desktop.e2e.mjs` (the shell from the checkout). See "macOS smoke: what ran" at the end for what was observed on the
runner and what, if anything, is skipped. Not required until it has been green across several PRs and a few pushes to main.

## 6. Promote stable (`promote-stable.yml`), written but not consumed
After a push to `main` where the required checks (`checks`, `browser`; add `macos-app-smoke` by setting `REQUIRE_MACOS: 'true'`
in the file once it is reliable) are all `success` on that commit, the workflow fast-forwards the branch **`stable`** to it using
only `GITHUB_TOKEN` (`contents: write` to move the ref, `checks: read` to look at the results).
- *Branch, not tag:* the updater already does `git fetch` + `git merge --ff-only` of a branch; a moved tag is not updated by a
  plain fetch. *Fast-forward only* (`force: false`): `stable` can only move forward along main's history; an older commit whose
  checks finish late is refused and logged, not forced. The ruleset targets only the default branch, so `stable` is not covered by
  it; nothing but this workflow (and people with write access) should push it.
- *Trigger:* `workflow_run` of `CI` and `macOS app smoke` on `main` (whichever finishes last finds everything green) plus
  `workflow_dispatch` (run it once from `main` to create `stable`). `workflow_run` always executes the default branch's copy of the
  file, checks nothing out and only calls the API, so a PR cannot influence it; zizmor's warning for that trigger is ignored in
  the file with that reason.
- **Follow-up, owned by the `designer-app` session (`packages/desktop`, not done here):** change `packages/desktop/updater.mjs`
  from `BRANCH = 'main'` to `'stable'` (`origin/stable`), keep the fast-forward-only and clean-checkout rules, and update
  `docs/updates.md` and `docs/security.md` ("Update & Restart trusts `origin/stable`"). The in-app dialog already lists the
  incoming commits, so users see the same change list. Until then nothing reads `stable`.
  A rollback story (`feat/rollback`) composes with this: `stable` never moves to a commit that failed CI.

## Known flaky steps (do not add blanket retries)
Two browser steps are known to fail intermittently and have **no automatic retry**, because a retry hides real regressions:
1. the **motion** suite's preview-chip step;
2. the **ui** suite's "pinned to bottom while streaming" step.

Proposed quarantine policy (not implemented; decide before the browser job is gated by anything stricter):
- A flake is a step that failed and passed on a re-run of the same commit. The first person to see one adds a line to this list
  with the date, the run URL and the failing assertion. Re-running a failed job is fine; merging on the strength of a re-run is
  not unless the failing step is on this list.
- Never retry a whole suite automatically. If a step must be quarantined it moves to its own `*.flaky.e2e.mjs` suite that runs in
  a separate **non-required** job (visible, never blocking), with an owner and a date.
- A quarantined step that has not been fixed in 14 days is either deleted deliberately (with the `safety-reviewed` label if it is a
  pinned file) or promoted back with its fix. Quarantine is never allowed for a pinned security test.
- Fix the cause (wait on state, not time) rather than the symptom.

## Operating notes
- Add an install-script or audit waiver: edit the JSON file in `scripts/ci/`, with a reason; the PR then needs a real Safety
  section because `scripts/ci/**` is gate-protected. Audit waivers expire (max 120 days) and fail again when they do.
- Run the guards' tests: `node --test "scripts/ci/*.test.mjs"` (fixtures are built in temp dirs, including the deliberately
  failing ones: a new script-bearing package, a non-npm registry URL, a safety path with "none touched", deleted assertions).
- `e2e/run.sh` starts and stops its own servers; it needs `playwright` resolvable (a root devDependency, pinned).
- `packages/server/src/security.test.ts` starts the real server on random ports; fine in CI.
- Do not add secrets. No deploy steps.

## Acceptance (original)
- A pull request with a deliberate failing test turns the check red; reverting turns it green.
- Each new gate has been shown failing on a deliberately bad fixture and passing on the real PR (links in the PR body).
