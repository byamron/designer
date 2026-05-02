---
name: staff-perspective-review
description: Reviews an open Designer PR from three parallel staff-level perspectives — staff engineer, staff UX designer, staff design engineer — to catch bugs, regressions, accessibility gaps, Mini-token violations, and craft issues before human review. Triages findings into blockers, nits, and follow-ups; fixes blockers and cheap nits in the same branch; updates the PR body with reviewer notes; never merges. Use whenever a workstream's implementation is complete and the PR is open, whenever the user asks for a "multi-perspective" or "staff" review, or before requesting human review on any non-trivial change. Do not use for security audits (defer to security-review) or for already-merged PRs.
---

# Staff-perspective review

A Designer PR is open and the implementation is complete. Run three independent reviews **in parallel**, each from a distinct staff-level lens, then triage and fix the findings before requesting human review. **Never merge** — leaving the PR open for the user is the whole point. These reviews are the polish step before that hand-off, not a substitute for it.

## When to invoke

- A workstream prompt's last workflow step instructs running this review pattern.
- The user opens (or has just opened) a PR and asks for a review, "multi-perspective" review, or "staff" review.
- A non-trivial change has just been pushed and the user wants independent eyes before it goes for human review.

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

1. **Confirm the PR is open and tied to the current branch.** Run `gh pr view` (or `gh pr list --head $(git branch --show-current)`). If no PR exists, ask the user how to proceed; do not run reviews on a branch that has nothing open.

2. **Save the diff for the reviewers.** `git diff origin/main... > /tmp/pr-diff.patch`. Reviewers reference it by path so the prompt stays small.

3. **Launch the three reviews in parallel.** A single tool message with three `Agent` calls, each `subagent_type: Explore`. Each prompt names its lens, the diff path, the changed files, the relevant docs to read (`CLAUDE.md`, `core-docs/spec.md` §5, `core-docs/plan.md` Dogfood Push section, `core-docs/feedback.md`, `core-docs/design-language.md`, `core-docs/component-manifest.json`, the workstream's PR body), and asks for findings classified as **BLOCKER / NIT / FOLLOW-UP**. Cap each review at ~1200 words.

4. **Triage the findings.** A finding is:
   - **BLOCKER** if it would cause a user-visible regression, a panic / data loss, an accessibility violation, a compliance invariant breach (`spec.md` §5), a contract break (frozen IPC DTO / event vocab / trait), or a Mini token rule violation that would ship to dogfood. Fix in this PR.
   - **NIT** if it's a real improvement that's cheap (single-file, no architectural change, no new tests). Fix in this PR.
   - **FOLLOW-UP** if it's a real issue but expanding scope here is wrong — the right fix belongs to a different workstream / lane, requires a separate ADR, or needs design input. Capture it; do not fix here.

   Some reviewer claims will be wrong on closer inspection. Spot-check the highest-impact items against the actual code before fixing or filing — reviewers can be confidently incorrect about subtle code paths.

5. **Apply blocker + cheap-nit fixes.** Re-run the quality gates after the fixes:

   ```sh
   cargo fmt --check
   cargo clippy --workspace --all-targets -- -D warnings
   cargo test --workspace
   npm --workspace @designer/app run typecheck
   npm --workspace @designer/app run test
   ```

6. **Push the fixes to the same branch** (`git push`).

7. **Capture follow-ups so they aren't lost.** Either:
   - Add a "Follow-ups" section to the PR body listing them with one-line descriptions and (if they cleanly map) the workstream / lane that owns them.
   - Or, if there are several substantive ones, write them to `.context/<branch>-followups.md` and link from the PR body.

8. **Update the PR body with a "Reviewer notes" section.** Summarise what each review found, what was fixed, and what was deferred. Format below.

9. **Stop.** Do **not** run `gh pr merge`. Do **not** approve. Tell the user the PR is ready for their review and link to it.

## "Reviewer notes" PR-body template

Append (or replace an existing) section like this in the PR body:

```markdown
## Reviewer notes

Three parallel reviews ran before this opened for human review.

**Staff engineer.** _Findings:_ [one-line summary].
_Acted on:_ [what was fixed in commit X]. _Deferred:_ [FOLLOW-UPs +
which workstream / lane owns them].

**Staff UX designer.** _Findings:_ ... _Acted on:_ ... _Deferred:_ ...

**Staff design engineer.** _Findings:_ ... _Acted on:_ ... _Deferred:_ ...

Quality gates re-run after fixes; results [link or one-liner].
```

The bar is honesty over polish — if a review found nothing of consequence, say so. If you disagreed with a reviewer's finding and didn't fix it, say so and why.

## Don't merge

The `gh pr merge` command is not part of this skill. The whole point of this review pass is to hand a polished, pre-vetted PR to the user. Merging short-circuits the hand-off and turns the skill into an autonomous-shipping skill, which is not what the user is asking for.

If the user explicitly asks to merge after the reviews, that's a separate decision — confirm and run `gh pr merge` directly. Do not infer permission from the success of the reviews.

## Gotchas

- **Reviewers don't see the diff path automatically.** Each review prompt must include the path to the saved diff and the list of changed files. A reviewer that has to grep for the diff burns its budget on navigation.

- **Reviewers can be confidently wrong.** Past examples in this codebase: a reviewer claimed a `tokio::spawn` was racing the broadcast channel when the channel's bounded backpressure handled it correctly. Spot-check high-impact findings against the actual code before acting on them. Reviewer summaries are hypotheses, not facts.

- **Grep finds what reviewers miss.** Three reviewers can collectively miss a hardcoded `1800ms` literal that the design-system invariant catches in CI (see PR #67's CI failure). After the reviews, run a focused grep against the kinds of patterns this PR claims to migrate (e.g. raw `px` in CSS, `tokio::spawn` in callsites that should use `tauri::async_runtime::spawn`, `Spawn(...)` string-matched errors that should be typed variants) and treat any survivors as findings the reviews didn't flag.

- **One review missing isn't a deal-breaker.** If a perspective genuinely doesn't apply (a pure-backend reliability PR has nothing for the design engineer), say so explicitly in the Reviewer notes rather than running an empty review for completeness theatre.

- **Don't over-trust the test status.** A flaky parallel-runner timeout looks like a regression. Re-run failing tests in isolation before declaring a regression.

- **Scope creep is the failure mode.** A reviewer says "while you're here, you should also restructure the orchestrator's permission handling." That's a FOLLOW-UP, not a blocker. The PR ships its workstream; expanding scope here delays the hand-off and pollutes the diff.

- **Frozen contracts are frozen.** Per `CLAUDE.md` §"Parallel track conventions": event shapes (`designer-core/src/event.rs`), IPC DTOs (`designer-ipc/src/lib.rs`), `PermissionHandler` trait, `Anchor` enum, `Detector` trait. A reviewer suggesting "just add a field" to one of these is suggesting a new ADR, not a fix in this PR.

- **The skill ends with the PR open.** No merge, no approval, no comment-with-LGTM. The user reviews next.
