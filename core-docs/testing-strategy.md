# Testing Strategy — Designer

Risk-driven, solo-builder-shaped. Decisions, not theory.

## The bar

Designer is a downloadable macOS desktop app shipped by one non-technical builder. "Quality" here means: a user installs, opens, uses, and updates the app without hitting a class of bug the builder couldn't have detected by using the app themselves. Tests exist to catch what eyes can't.

Five risks define the floor. Everything else is a "nice to have" until it isn't.

| Risk | If it breaks | Today's coverage |
|---|---|---|
| **Updater regression** | Every user stranded on whatever version they have | none |
| **Approval gate / safety regression** | Silent permission escalation; trust surface compromised | 4 tests for ~700 LOC of gates |
| **Crafted UI regression** (token drift, layout breaks, dark/light bugs) | Ships looking off; non-technical builder cannot detect via code review | none (Mini invariants only) |
| **Performance regression** (cold start, IPC latency, idle memory) | "App feels janky" — invisible in diffs, obvious in use | none |
| **App-shell regression** (project create, post-message, restart, approvals) | Top of funnel breaks; nothing else matters | zero integration tests over 42 commands |

## The repo seam that makes this cheap

`apps/desktop/src-tauri/src/commands*.rs` are pure pass-throughs to `ipc::cmd_*` async functions. Rust integration tests can drive the entire 42-command surface without booting Tauri. This single fact is why the plan below is ~7 hours, not 70.

## The six-item floor — do these or don't ship

Ranked by impact. Each is independently shippable.

### 1. Branch protection on `main` (5 min)

Tests that don't gate merges are theater. Configure `main` to require:
- `rust / test`, `rust / clippy`, `rust / fmt` from `ci.yml`
- `frontend`
- `design-system`

No bypass for the maintainer. Including yourself.

### 2. Updater dry-run + version-compare tests (~1 hour)

The updater is a brick risk. One bad release = every user permanently stranded.

**Action:**
- Lift the manifest-parse + version-compare logic out of `apps/desktop/src-tauri/src/updater.rs` into a pure function (in the desktop crate or, better, `designer-core`).
- Tests cover: equal versions = no-op; newer remote = update offered; malformed manifest = graceful error; signature-verification failure path returns a typed error (don't actually verify in test, just confirm the failure branch is reachable).
- One end-to-end test against a fixture manifest JSON.

### 3. Approval-gate exhaustive tests (~1 hour)

This is a security surface. Today: 4 tests for `crates/designer-safety/`'s ~700 LOC across `approval.rs`, `cost.rs`, `scope.rs`, `csp.rs`. Quality, not coverage:

- Approval state machine: `request → pending → granted → state advances`; `request → pending → denied → state does not advance`; double-resolve is a no-op (idempotent); concurrent requests on the same workspace serialize correctly.
- Scope guard: symlink escape attempts rejected; case-sensitivity edge case on macOS APFS; absolute vs relative path normalization.
- Cost tracker: per-workspace isolation (one workspace's spend doesn't leak into another); reset semantics.
- CSP builder: known-good output snapshot (use `insta` *here only* — this is the one place schema lock pays off).

Aim for 8–10 focused tests, not 15 by-the-numbers.

### 4. IPC smoke tests in `apps/desktop/src-tauri/tests/` (~2 hours)

The largest gap. Build an `AppCore` with a `tempfile::TempDir`, the existing `Mock` orchestrator from `designer-claude`, and the `CountingOps` fake from `test_support.rs`. Then exercise:

- **Project create + workspace create + tab open** — round-trip persists to sqlite; projection rebuilds correctly.
- **`post_message` with `Mock` orchestrator** — emits ordered `StreamEvent`s; spine projection updates; tab state advances.
- **Approval round-trip via IPC** — `request_approval` → pending event → `resolve_approval(granted)` → state event → underlying op proceeds.
- **Restart persistence** — drop `AppCore`, reconstruct from sqlite, verify projections match.

Four tests. All under 10 seconds locally. No network, no real Claude, no window.

### 5. Visual regression on three screens (~2 hours)

A non-technical builder cannot review CSS or token-replacement diffs to verify "does this still look right." Tests must catch it.

Three screens that, between them, exercise every primitive and every variant:
- **Home** — first surface, sets the tone
- **Workspace thread** — densest UI, most token usage, dark/light + accent variations
- **Approval inbox** — most error-prone (state-driven UI)

**Tooling.** Vitest + `vitest-image-snapshot` running against the React frontend with `MockCore` seeded data. Capture in light + dark. Run in CI on Linux for deterministic font rendering. Reject anti-aliasing-noise diffs with a sensible threshold (~0.5%).

**Not** Chromatic, not Percy — the snapshot files live in the repo, free, and a non-technical builder can review the diff visually in any PR comment with image-diff rendered.

### 6. Performance budget test (~1 hour)

One test, two assertions. Don't over-engineer.

- **Cold-start budget**: spawn the app binary in headless mode (or, simpler: time `AppCore::new() + initial projection rebuild`) and assert it completes under a generous threshold (e.g., 800ms on CI macOS). The threshold isn't tight; it catches order-of-magnitude regressions.
- **IPC roundtrip budget**: 100x `cmd_list_projects` calls in a hot loop, assert p99 under, say, 5ms. Again — generous, but trips on a real regression.

Generous thresholds + one test = catches "I just made the app 3x slower" without becoming a flaky-test factory.

---

## Layer model (reference, not action items)

| Layer | What lives here | Status after the six |
|---|---|---|
| L1 — Pure crate tests | unit tests in each `crates/*` for logic without I/O | Already strong (~161 tests). #3 strengthens the weakest crate. |
| L2 — IPC integration | `apps/desktop/src-tauri/tests/` driving `ipc::cmd_*` directly | New. #4 establishes pattern. |
| L3 — Frontend component | Vitest + RTL + `MockCore` (`packages/app/src/test/`) | Already strong (19 files). #5 adds visual axis. |
| L4 — Desktop E2E (real shell) | not viable on macOS — WKWebView has no WebDriver | Skip. Not a gap; a constraint. |
| L5 — Agent / computer-use | exploratory, never CI gating | Use `tauri-pilot` for friction-bug repro, locally only. |

## Local vs CI workflow

### Local while writing code (target <10s)
```
just test-fast
```
Hot crates + frontend `--changed`. Run on save or before each commit.

### Local before pushing (target <60s)
```
just check
```
Mirrors CI. Fmt + clippy + full Rust tests + frontend tests + invariants. If green, CI is green.

### CI on every PR
Already correct in `.github/workflows/ci.yml`. After the six land, the visual regression + perf budget tests run as part of `npm run test` and `cargo test --workspace` automatically — no new workflow file needed.

### Less often
- **Release tag**: `cargo test --workspace` once before building (already implicit). Manual smoke of the *previous* release upgrading to the new one — manually, not in CI, ten minutes per release.
- **Nightly (next step after the six)**: a self-hosted-runner job that runs the `claude_live` feature-gated tests against a real Claude install. Catches subprocess-parse regressions before users do. Worth adding once the six are in.

## Tool decisions

| Tool | Verdict | Why |
|---|---|---|
| `cargo test`, `tokio::test`, `tempfile` | use | Already in tree. Drives L1 + L2. |
| Vitest + Testing Library + jsdom | use | In tree. Drives L3. |
| `MockCore` (`packages/app/src/ipc/mock.ts`) | keep | Higher fidelity than `@tauri-apps/api/mocks`; do not replace. |
| `vitest-image-snapshot` | adopt for #5 | Repo-resident snapshots, free, PR-reviewable. |
| `insta` | adopt narrowly in #3 | One use: lock CSP output. |
| `tauri-pilot` | local triage tool only | Not a CI gate. Useful when a friction report needs repro. |
| `tauri::test::MockRuntime` | skip | Shim seam removes the need. |
| `tauri-driver` / Playwright on desktop shell | skip | macOS WKWebView has no driver. Not a tradeoff — a fact. |
| `cargo-nextest`, `proptest`, MockCore↔tauri.ts contract test | defer | Adopt only when a real bug demands them. |
| `@tauri-apps/api/mocks` | skip | Splits the mock surface; lower fidelity than what's already here. |
| Computer-use agents as CI gate | skip | Reliability variance too high. |

## What's explicitly deferred — and what would unlock each

- **Real Claude subprocess nightly tests** → unlock when the six are green; biggest next-step quality lift.
- **Cross-OS test matrix / Linux desktop smoke** → unlock if a Tauri version bump regresses on a platform.
- **Property-based tests on `designer-sync`** → unlock if a vector-clock merge bug ships.
- **`StreamEvent` shape snapshot** → unlock if frontend/Rust drift causes a real bug.
- **MockCore↔tauri.ts contract test** → unlock if a new IPC command lands on one side but not the other.

None of these are required to ship a quality v1.

## Risks & honest tradeoffs

- **Skipping macOS desktop E2E means the Tauri shell boundary is untested.** Acceptable: commands are shims, frontend tests cover UI, the boundary changes rarely. The release-day manual smoke (5 min: install previous release, accept update, click around) is the compensating control.
- **Visual snapshots can be flaky across font/AA changes.** Mitigated by running in CI on Linux only (deterministic), generous threshold, and a `npm run test:visual:update` recipe for legitimate visual changes.
- **Generous perf budgets won't catch small drift.** That's the point — flaky perf tests are worse than missing ones for a solo builder. Tighten only when an actual regression hits.
- **Branch protection means the maintainer can't bypass CI on a hotfix.** That's also the point.

## Phased rollout

**Phase A — the six (one focused day, ~7 hours):**
1. Branch protection on `main`. (5m)
2. Updater dry-run + version-compare tests. (1h)
3. Approval-gate exhaustive tests + CSP snapshot. (1h)
4. IPC smoke tests `apps/desktop/src-tauri/tests/ipc_smoke.rs`. (2h)
5. Visual regression on home / workspace thread / approval inbox. (2h)
6. Performance budget test. (1h)

**Phase B — after the six are green and have caught one real regression:**
7. Self-hosted nightly running `claude_live` feature tests.

**Phase C — only when motivated by a real bug:**
Anything from "What's explicitly deferred."

---

**One-line summary.** Six tests covering the five real risks (updater, safety, IPC shell, visual craft, performance) plus branch protection. ~7 hours of work, no new infrastructure beyond `vitest-image-snapshot` and `insta`. Everything else defers until a regression earns it.
