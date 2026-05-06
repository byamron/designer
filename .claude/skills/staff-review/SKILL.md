---
name: staff-review
description: Reviews Designer changes from three parallel staff-level perspectives — staff engineer, staff UX designer, staff design engineer — to catch bugs, regressions, accessibility gaps, Mini-token violations, and craft issues before human review. Reviews an open PR if one exists, otherwise reviews the current branch (or a custom diff range like `<tag>..HEAD` for release-staging). Triages findings into blockers, nits, and follow-ups; fixes blockers, cheap nits, and trivial follow-ups in the branch; files non-trivial follow-ups into `core-docs/roadmap.md` (active section) or `core-docs/parking-lot.md` (with friction-driven trigger + time fallback) before closing, per CLAUDE.md §How-to-Work item 6. If no PR exists and reviews conclude the branch is ready, opens one. Never merges. Use whenever a workstream's implementation is complete, whenever the user asks for a "multi-perspective" or "staff" review, before requesting human review on any non-trivial change, or as a release-prep pass against a tag. Do not use for security audits (defer to security-review) or for already-merged PRs.
---

# Staff review

Designer changes are ready for review. Run three independent reviews **in parallel**, each from a distinct staff-level lens, then triage and fix the findings before human review. The skill works in three modes depending on git state:

- **PR mode** — a PR is open against the current branch. Review the PR's diff; on success, update the PR body and leave it open for the human reviewer.
- **Branch mode** — no PR is open but the branch is ahead of main. Review the branch's diff against main; on success, open a PR for the user to review.
- **Range mode** — the caller passes `--base <ref>` (e.g. `--base v0.1.1` for release staging across many merged PRs). Review the range; on success, summarise findings inline (no PR is opened — the caller drives next steps like cutting a release).

**Never merge.** The skill ends with a PR open (PR or branch mode) or a written summary (range mode). Merging is a separate decision the user makes after reviewing.

## When to invoke

- A workstream prompt's last workflow step instructs running this review pattern.
- The user opens (or has just opened) a PR and asks for a review, "multi-perspective" review, or "staff" review.
- A non-trivial change has just been pushed and the user wants independent eyes before requesting human review.
- The user is preparing a release and wants a review of the cumulative diff since the last tag (range mode).
- Implementation is complete on a feature branch but the user hasn't opened a PR yet (branch mode).

Skip this skill if:
- The change is a doc-only edit, a typo fix, or a status refresh — overhead exceeds value.
- The PR is already merged — there is no longer a branch to update.
- The user explicitly asks for a security review — use `security-review` instead.

## Why three perspectives, in parallel

Three lenses catch different classes of issue. Running them sequentially or as one merged review lets each one prime the next; running them in parallel keeps each independent so the findings actually triangulate. The Designer codebase has multiple shipped examples of this paying off: PRs #28–#34's four-perspective review surfaced the Friction local-first pivot (Track 13.L) and the "Designer noticed" cap/dedup work (21.A1.1), neither of which any single reviewer caught.

## The three perspectives

Each perspective is invoked as a separate `Agent` call (subagent type `Explore`) in **a single tool message with multiple tool uses**, so they run concurrently and don't see each other's output.

### Staff engineer

Hunts: correctness, async/concurrency (tokio runtime context, channel deadlocks, lock ordering), error handling, IPC contract drift, FFI / subprocess behaviour, edge cases, missing tests, hardcoded values that should be tokens or env vars, panics, dead code, behaviour regressions vs. the pre-change state, Mini design-language violations in Rust-emitted markup.

Specifically asks:
- Does each replaced value match the new abstraction byte-for-byte (when the PR claims that)?
- Are there other places in the codebase that should have been migrated but weren't? Run a `Grep` independent of the diff.
- Are tests covering the actual contracts the PR claims, or are they shallow? Look at branch coverage in the changed code paths, not just whether *a* test exists.
- Are there latent panics, leaks, lock-order issues, or `tokio::spawn`-without-runtime hazards? (PR #23 fixed one of these in `spawn_message_coalescer`; the same class can recur.)
- Does the change respect the parallel-track conventions in `CLAUDE.md` §"Parallel track conventions" — staying in its assigned `core_*.rs` + `commands_*.rs` pair, not extending frozen contracts (event vocabulary, IPC DTOs, `PermissionHandler` trait, `Anchor` enum, `Detector` trait) without an ADR?
- Compliance invariants in `core-docs/spec.md` §5 — never touching Claude OAuth tokens, never running Claude Code anywhere but the user's machine, no Designer-owned network egress except updater + opt-in crash-report.

### Staff UX designer

Hunts: copy quality, empty/loading/error states, accessibility (focus-visible, keyboard path, ARIA, contrast across accent × mode, prefers-reduced-motion, touch targets), modal-stack races, friction in the user path, dark-mode treatment, content-vs-chrome balance, alignment with Designer's product principles ("Manager, not engineer"; "Suggest, do not act by default"; "Summarize by default, drill on demand").

Specifically asks:
- Is every error surface using human language a non-developer manager would understand? Are raw error strings (`OrchestratorError::ChannelClosed`, `IpcError::InvalidRequest`) reaching the user verbatim?
- Does the keyboard path work end-to-end? Tab order, focus rings, ESC dismissal, ⌘↵ submit, ⌘⇧F friction shortcut all wired?
- Does the design hold in dark mode and at the smallest supported window size (`min_inner_size: 960×640` per `main.rs`)?
- Are loading states present and bounded? Does the activity spine reflect what's happening, or does the user see "submitting…" forever when claude is silent?
- Does the change respect "no half-baked features in prod" (`core-docs/plan.md` Dogfood Push P2)? Anything stubbed or placeholder needs a `show_<feature>_section` flag or removal — not a shipped half-feature.
- Does the friction reporting path still work end-to-end (⌘⇧F, ⌘⇧S, triage, mark addressed)?

### Staff design engineer

Hunts: Mini token fidelity, motion craft, palette + contrast across light/dark, archetype reuse vs. one-off chrome, perceptual quality across window sizes, implementation-vs-intent gaps, performance of any new visual layer.

Specifically asks:
- Does the visible craft match the design intent? (Read `core-docs/design-language.md` for the axioms; the Mini procedure in `CLAUDE.md` for the token rules.)
- Are tokens used for every spatial / colour / motion / radius value, or are there raw `px` / `hex` / `ms` / `rgba(` / `z-index:` literals in changed CSS / TSX / Rust-emitted markup? Run `node tools/invariants/check.mjs <changed files>` if available.
- Does any new component compose Mini primitives (Box, Stack, Cluster, Sidebar, Center, Container, Frame, Overlay) instead of bespoke layouts?
- Was `core-docs/component-manifest.json` updated for new/modified components? Is there a `core-docs/generation-log.md` entry per the Mini procedure step 7?
- Does motion respect `prefers-reduced-motion` with a colour-space-correct static fallback?
- Where applicable, does the change appear in screenshots (or could it)? If the PR ships UI, the user expects to see it; mention if this would benefit from a screenshot.

If a perspective genuinely has nothing to look at (a pure-Rust IPC-only change has no design surface), say so explicitly in the Reviewer notes rather than running an empty review for completeness theatre.

## Workflow

### 1. Detect mode and pick the diff base

Run these in parallel and pick the first match:

```sh
gh pr list --head "$(git branch --show-current)" --json number,baseRefName --limit 1
git rev-list --count origin/main..HEAD   # commits ahead of main
```

- **PR mode** — `gh pr list` returns one row. Diff base = the PR's `baseRefName` (usually `main`). Note the PR number for later.
- **Range mode** — caller passed `--base <ref>` in args. Diff base = that ref. No PR will be opened.
- **Branch mode** — no PR, but commits-ahead > 0 and the current branch is not `main`. Diff base = `origin/main`.
- **Nothing to review** — no PR, branch == main, or commits-ahead == 0. Stop and tell the user there's nothing to review on this branch.

If the current branch has uncommitted changes, ask the user whether to include them (commit first) or stash before reviewing — the reviewers see the diff, not the working tree.

### 2. Save the diff for the reviewers

```sh
git diff <base>...HEAD > /tmp/pr-diff.patch
git diff <base>...HEAD --name-only > /tmp/pr-files.txt
```

Reviewers reference both by path so the prompt stays small. (Use `..` instead of `...` for range mode against a tag — `<tag>..HEAD` is the inclusive set of commits since the tag, which is what release reviews want.)

### 3. Launch the three reviews in parallel

A single tool message with three `Agent` calls, each `subagent_type: Explore`. Each prompt names its lens, the diff path, the changed files, the relevant docs to read (`CLAUDE.md`, `core-docs/spec.md` §5, `core-docs/plan.md` Dogfood Push section, `core-docs/feedback.md`, `core-docs/design-language.md`, `core-docs/component-manifest.json`, and — in PR mode — the PR body for the workstream's stated intent), and asks for findings classified as **BLOCKER / NIT / FOLLOW-UP**. Cap each review at ~1200 words.

### 4. Triage the findings

A finding is:
- **BLOCKER** if it would cause a user-visible regression, a panic / data loss, an accessibility violation, a compliance invariant breach (`spec.md` §5), a contract break (frozen IPC DTO / event vocab / trait), or a Mini token rule violation that would ship to dogfood. Fix in the branch.
- **NIT** if it's a real improvement that's cheap (single-file, no architectural change, no new tests). Fix in the branch.
- **FOLLOW-UP** if it's a real issue but expanding scope here is wrong — the right fix belongs to a different workstream / lane, requires a separate ADR, or needs design input. **Prefer doing over filing**: if a follow-up is small enough to land in the same PR without meaningfully expanding scope, just fix it now. Only what genuinely doesn't fit gets filed — and per CLAUDE.md §How-to-Work item 6, filed follow-ups MUST land in `core-docs/roadmap.md` (active section if it gates a current Build/Harden phase) or `core-docs/parking-lot.md` (with a friction-driven primary trigger + time-based fallback per ADR 0009) before the review closes. The PR body cross-references the filed entries; it must not be the only home.

Some reviewer claims will be wrong on closer inspection. Spot-check the highest-impact items against the actual code before fixing or filing — reviewers can be confidently incorrect about subtle code paths.

### 5. Apply blocker + cheap-nit fixes; re-run gates

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm --workspace @designer/app run typecheck
npm --workspace @designer/app run test
```

If gates fail, iterate. Don't move on with red gates.

### 6. Commit the fixes (PR + branch mode)

Stage only the files you touched; commit with a message naming what the review caught (e.g. `fix(review): dead --color-text token; gate Haiku selector; Help → Friction link`). Do not amend pre-existing commits.

### 7. Hand off based on mode

**Before either mode hands off:** verify every filed FOLLOW-UP has a home in `core-docs/roadmap.md` or `core-docs/parking-lot.md` per CLAUDE.md §How-to-Work item 6. The skill is not done until every non-trivial FOLLOW-UP either has a roadmap/parking-lot entry committed OR was inlined into the current PR. "I'll file it later" is not allowed — closed PR bodies aren't searchable.

**PR mode:**
1. `git push` to the PR's branch.
2. Update the PR body — append (or replace existing) "Reviewer notes" section (template below). The body cross-references filed entry locations; it does not list FOLLOW-UPs as the only home.
3. Tell the user the PR is ready for their review; include the PR URL.
4. **Stop.** Do not merge. Do not approve. Do not request review from a human (the user owns that step).

**Branch mode:**
1. Decide whether the branch is ready for a PR:
   - **Ready** — all blockers fixed, gates green, every non-trivial FOLLOW-UP filed in `roadmap.md` or `parking-lot.md`, nothing the human reviewer would immediately bounce back.
   - **Not ready** — unresolved blockers, gates red, FOLLOW-UPs unfiled, or the change still feels half-baked. Stop and report what's missing; do not open a PR.
2. If ready: `git push -u origin <branch>`, then `gh pr create --base <base> --title "<short title>" --body "$(cat <<'EOF' ... EOF)"`. The body must include a Summary section (drawn from the commits / diff), a Test plan, and the "Reviewer notes" section. No standalone "Follow-ups" list — filed entries live in `roadmap.md` / `parking-lot.md` and are cross-referenced inside Reviewer notes.
3. Tell the user the PR has been opened; include the PR URL.
4. **Stop.** Do not merge.

**Range mode:**
1. No PR is opened — the caller is doing release prep or a survey, not shipping a single workstream.
2. Write the findings inline as the assistant's reply (the format the user asked for — release notes, summary, etc.).
3. If fixes were applied to the branch, mention what was changed but do not push without explicit user instruction (range mode is often run on a `release-review` branch local to the user's machine).
4. **Stop.**

## "Reviewer notes" PR-body template

Append (or replace an existing) section like this in the PR body:

```markdown
## Reviewer notes

Three parallel reviews ran before this opened for human review.

**Staff engineer.** _Findings:_ [one-line summary].
_Acted on:_ [what was fixed in commit X — including any trivial
follow-ups inlined per the "do it now if quick" preference].
_Filed:_ [non-trivial FOLLOW-UPs that didn't fit this PR — name
the entry locations in `core-docs/roadmap.md` or
`core-docs/parking-lot.md`, e.g. "roadmap.md § Phase 26H —
macOS spot-check spec"].

**Staff UX designer.** _Findings:_ ... _Acted on:_ ... _Filed:_ ...

**Staff design engineer.** _Findings:_ ... _Acted on:_ ... _Filed:_ ...

Quality gates re-run after fixes; results [link or one-liner].
```

The bar is honesty over polish — if a review found nothing of consequence, say so. If you disagreed with a reviewer's finding and didn't fix it, say so and why. Per CLAUDE.md §How-to-Work item 6, no FOLLOW-UP is filed *only* in the PR body — every entry on the `_Filed:_` line cross-references a roadmap or parking-lot entry that lives in the docs.

## "Branch mode" PR template

When opening a fresh PR (branch mode), the body needs more than just Reviewer notes — the human reviewer is seeing this for the first time.

```markdown
## Summary
- [1–3 bullets — what changed and why, drawn from the commits in the branch]

## Test plan
- [ ] [bulleted, manual test steps if applicable]
- [ ] cargo test --workspace
- [ ] npm --workspace @designer/app run test

## Reviewer notes
[same template as above — _Filed:_ lines cross-reference roadmap.md / parking-lot.md entries]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

No standalone "## Follow-ups" section — filed entries live in `core-docs/roadmap.md` / `core-docs/parking-lot.md` and are cross-referenced inside the Reviewer notes.

Title: short (under 70 chars), no prefix, concrete (e.g. "Settings split + project unlink", not "Update settings"). Mirror the style of recent merged PRs in `git log --oneline origin/main`.

## Don't merge

The `gh pr merge` command is not part of this skill. The whole point of this review pass is to hand a polished, pre-vetted PR to the user. Merging short-circuits the hand-off and turns the skill into an autonomous-shipping skill, which is not what the user is asking for.

This holds in all three modes:
- **PR mode** — the PR was already open; leave it open.
- **Branch mode** — the skill just opened the PR; the user reviews it next.
- **Range mode** — no PR involved; the user drives next steps (cut a tag, ship, etc.).

If the user explicitly asks to merge after the reviews, that's a separate decision — confirm and run `gh pr merge` directly. Do not infer permission from the success of the reviews.

## Gotchas

- **Reviewers don't see the diff path automatically.** Each review prompt must include the path to the saved diff and the list of changed files. A reviewer that has to grep for the diff burns its budget on navigation.

- **Reviewers can be confidently wrong.** Past examples in this codebase: a reviewer claimed a `tokio::spawn` was racing the broadcast channel when the channel's bounded backpressure handled it correctly. Spot-check high-impact findings against the actual code before acting on them. Reviewer summaries are hypotheses, not facts.

- **Grep finds what reviewers miss.** Three reviewers can collectively miss a hardcoded `1800ms` literal that the design-system invariant catches in CI (see PR #67's CI failure). After the reviews, run a focused grep against the kinds of patterns this PR claims to migrate (e.g. raw `px` in CSS, `tokio::spawn` in callsites that should use `tauri::async_runtime::spawn`, `Spawn(...)` string-matched errors that should be typed variants) and treat any survivors as findings the reviews didn't flag.

- **One review missing isn't a deal-breaker.** If a perspective genuinely doesn't apply (a pure-backend reliability PR has nothing for the design engineer), say so explicitly in the Reviewer notes rather than running an empty review for completeness theatre.

- **Don't over-trust the test status.** A flaky parallel-runner timeout looks like a regression. Re-run failing tests in isolation before declaring a regression.

- **Scope creep is the failure mode.** A reviewer says "while you're here, you should also restructure the orchestrator's permission handling." That's a FOLLOW-UP, not a blocker. The PR ships its workstream; expanding scope here delays the hand-off and pollutes the diff.

- **Frozen contracts are frozen.** Per `CLAUDE.md` §"Parallel track conventions": event shapes (`designer-core/src/event.rs`), IPC DTOs (`designer-ipc/src/lib.rs`), `PermissionHandler` trait, `Anchor` enum, `Detector` trait. A reviewer suggesting "just add a field" to one of these is suggesting a new ADR, not a fix in this PR.

- **Branch mode: don't open a PR with red gates.** The whole point of the skill is to deliver a vetted PR. If the human reviewer's first action would be "fix the failing build," the skill failed. Iterate on fixes until gates are green or stop and report what's blocking — do not open a half-baked PR.

- **Branch mode: don't auto-push and auto-PR if the branch is sensitive.** If the branch name suggests release-prep or a hotfix (`release-*`, `hotfix-*`, `v[0-9]*`), or the diff touches release infrastructure (`tauri.conf.json`, `Cargo.toml` version, GitHub Actions release workflows), confirm with the user before opening the PR. The default flow assumes a workstream branch.

- **Range mode: don't push fixes without explicit instruction.** Range mode is often run on a local branch the user created for the review (e.g. `release-review`). Pushing or opening a PR there is rarely what they want. Apply fixes, report them, and let the user decide whether to push, cherry-pick, or discard.

- **The skill ends with the PR open or a written summary.** No merge, no approval, no comment-with-LGTM. The user reviews next.

- **Follow-ups must land in docs before the review closes.** Per CLAUDE.md §How-to-Work item 6, every filed FOLLOW-UP belongs in `core-docs/roadmap.md` (active section, if it gates a current Build/Harden phase) or `core-docs/parking-lot.md` (with a friction-driven primary trigger + time-based fallback per ADR 0009). The skill is not done until the filing is committed and the PR body's Reviewer-notes `_Filed:_` lines cross-reference the entry locations. **Prefer doing over filing**: if a follow-up is small enough to land in the same PR without expanding scope meaningfully, just do it now and report it on the `_Acted on:_` line. Don't accept "I'll file it later" — closed PR bodies aren't searchable.
