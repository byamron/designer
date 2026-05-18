---
name: taste-staff-review
description: Reviews taste-loop monorepo changes from three parallel staff-level perspectives — staff engineer, staff design critic, staff workflow editor — before human review. Catches code bugs, regressions, accessibility gaps in the showcase, broken cross-references between docs, stale Distilled or Propagated footers, sloppy foundation citations, drift between cycle ledgers and what was actually surfaced, and skill-procedure correctness. Reviews an open PR if one exists, otherwise reviews the current branch. Triages findings into blockers, nits, and follow-ups; fixes blockers and cheap nits in the branch; if no PR exists and reviews conclude the branch is ready, opens one. Never merges. Use whenever a session's work is complete, before requesting human review on any non-trivial change, or as a release-prep pass against a tag.
user_invocable: true
# Vendored from byamron/mini-design-system commit e2aa041a05040f913ab4ee98e011ce517561e355 on 2026-05-10. Renamed from `staff-review` to avoid collision with Designer's existing same-named skill (different lenses, both coexist). Do not edit in place; upstream changes propagate via re-vendor.
---

# Staff review (taste-loop adaptation)

Taste-loop monorepo changes are ready for review. Run three independent reviews **in parallel**, each from a distinct staff-level lens, then triage and fix the findings before human review.

This skill is adapted from Designer's `staff-perspective-review` for the different concerns of this repo: skills, foundations docs, feedback ledgers, cycle work, the showcase. The three modes (PR / branch / range) and the parallel-review structure are preserved; the lenses are tailored.

## Modes

- **PR mode** — a PR is open against the current branch. Review the PR's diff; on success, update the PR body and leave it open.
- **Branch mode** — no PR is open but the branch is ahead of main. Review the branch's diff against main; on success, open a PR.
- **Range mode** — caller passes `--base <ref>` (e.g. `--base v0.3.3` for release staging). Review the range; on success, summarise findings inline.

**Never merge.** The skill ends with a PR open or a written summary. Merging is a separate decision.

## When to invoke

- A session's substantive work is complete and the user wants independent eyes before requesting human review.
- The user opens (or has just opened) a PR and asks for a "staff review" or "multi-perspective review."
- Implementation is complete on a feature branch but the user hasn't opened a PR yet (branch mode).
- Release prep — the cumulative diff since the last tag (range mode).

Skip this skill if:
- The change is a doc-only edit, typo fix, or status refresh — overhead exceeds value.
- The PR is already merged.
- The user explicitly asks for a security review — use `security-review` instead.
- The change is purely a propagation-tracking update (e.g., flipping `Propagated to canonical: pending` to `yes`) — too narrow to warrant three perspectives.

## Why three perspectives, in parallel

Three lenses catch different classes of issue. Running them sequentially or as one merged review lets each one prime the next; running them in parallel keeps each independent so the findings actually triangulate.

## The three perspectives

Each perspective is invoked as a separate `Agent` call (subagent type `Explore`) in **a single tool message with multiple tool uses** so they run concurrently and don't see each other's output.

### Staff engineer

Hunts: code correctness in the showcase (TypeScript, React, vite config), correctness of `tools/*.mjs` scripts, skill-procedure correctness (do the steps reference real files? do the cited tools exist?), broken cross-references between docs (a `decisions.md` entry citing a tension ID that doesn't exist; a `language.md` LP citing `core-docs/design-system/foundations.md §X` that's actually §Y), accessibility implementation in the showcase (focus-visible vs focus, keyboard path, ARIA), missing or stale `**Distilled:**` footers on cycle ledger entries, missing or stale `**Propagated to canonical:**` fields on decisions / LPs.

Specifically asks:
- Does each migrating decision in `decisions.md` cite a real tension or feedback entry?
- Does each LP in `language.md` cite a foundation that actually exists in `core-docs/design-system/foundations.md`? Spot-check by grepping `foundations.md` for the cited concept.
- Do the skills (`drain-feedback`, `distill-feedback`, `uncommon-care`, `staff-review`) reference files / tools / paths that exist? Run a quick spot-check.
- Does `tools/feedback-status.mjs` still classify correctly across edge cases (zero cycles, all distilled, mixed states)? Run it.
- For showcase changes: does `npm run build` (or `tsc --noEmit`) pass? Are there raw `px` / `hex` / `ms` literals snuck in where tokens belong (with the showcase-specific exception for revealing Mini gaps)?
- Are component / variant changes accompanied by appropriate updates to `variants/index.ts` and any registry?
- Are gitignored paths actually gitignored — no `node_modules`, `dist`, or `.context/` content slipping into the diff?

### Staff design critic

Hunts: variant quality (do the variants actually exercise what their names claim?), cycle-ledger faithfulness (do the items in the ledger map to actual chat reactions or annotations? are interpretations honest, not retrofitted?), decision and principle quality (are foundation citations accurate? do LPs satisfy the recurrence threshold? are decisions specific enough to constrain the design space, not vague enough to be inert?), tension-vs-decision boundaries (are open questions sitting in tensions? are settled calls sitting in decisions, not lingering as tensions?), drift between this repo's `projects/<name>/language.md` and Designer's canonical (if applicable), correctness of the foundations doc itself (no factual errors about Gestalt / Norman / Jakob's Law / WCAG, no missed established names being re-invented as project-specific principles).

Specifically asks:
- Is every claimed annotation / chat reaction in a cycle ledger entry actually traceable to source (the Agentation MCP, the conversation history)? Or are interpretations being retrofitted?
- Does each new LP cite a foundation, or claim novelty? If it claims novelty, do three independent literature checks confirm? Common Gestalt / UX-law re-inventions to watch for: proximity, prägnanz, Fitts, Hick, Jakob, Tesler, Doherty, peak-end, von Restorff.
- Does each new D entry actually constrain future design work? "We should make it nice" is not a decision; "We use bordered boxes, not vertical rails, on conversation-layer container artifacts (with a gutter-bar exception for blockquote)" is.
- Are tensions that have actually been resolved still sitting in `tensions.md`? Move them to `decisions.md` if so.
- Are decisions that are actually still open sitting in `decisions.md`? Move them to `tensions.md` if so.
- Do the cycle ledger's "Top 3 takeaways" actually reflect the highest-impact items in the cycle, or do they cherry-pick easier wins?

### Staff workflow editor

Hunts: skill coherence (do `drain-feedback` and `distill-feedback` compose correctly? does the gate work? are the feedback-status thresholds matching what's in CLAUDE.md?), foundations-doc accuracy and tone, CLAUDE.md usability (would a fresh Claude session understand and follow these rules without further explanation?), propagation prompt completeness (would a Designer-side session execute it without hitting friction?), templates / schemas for project-specific docs (do they actually constrain shape, or are they suggestion-text the agent can ignore?), the workflow-improvement directive in CLAUDE.md (is it actively being followed in this PR? are workflow gaps named explicitly when they surface?).

Specifically asks:
- If a fresh Claude session opened this repo with no context, would the first action of every session (`node tools/feedback-status.mjs` per CLAUDE.md) work? What if the session is in a worktree where `tools/` doesn't exist?
- Does each skill's procedure step reference real, callable tools? Are there steps that say "check X" without naming the actual command or file?
- Are the cycle-ledger format and the principle-promotion format used consistently across cycles? Or has the format drifted?
- Does the propagation prompt at `.context/designer-propagation-prompt.md` (gitignored) match what's actually been distilled? If LPs were promoted in this PR, has the prompt been updated to include them?
- Are there workflow gaps the user has named in this session that haven't been addressed in CLAUDE.md or the skills? Capture as FOLLOW-UP.
- Are there pieces of process that exist in the user's chat but not in any committed doc? (Verbal processes that haven't been encoded yet.)

If a perspective genuinely has nothing to look at (a docs-only PR has no design or workflow surface), say so explicitly in the Reviewer notes rather than running an empty review.

## Workflow

### 1. Detect mode and pick the diff base

```sh
gh pr list --head "$(git branch --show-current)" --json number,baseRefName --limit 1
git rev-list --count origin/main..HEAD
```

- **PR mode** — `gh pr list` returns one row. Diff base = the PR's `baseRefName`. Note the PR number.
- **Range mode** — caller passed `--base <ref>`. Diff base = that ref. No PR will be opened.
- **Branch mode** — no PR, commits-ahead > 0, branch ≠ main. Diff base = `origin/main`.
- **Nothing to review** — no PR, branch == main, or commits-ahead == 0. Stop.

If the working tree has uncommitted changes, ask the user whether to include them (commit first) or stash before reviewing.

### 2. Save the diff for the reviewers

```sh
git diff <base>...HEAD > /tmp/pr-diff.patch
git diff <base>...HEAD --name-only > /tmp/pr-files.txt
```

### 3. Launch the three reviews in parallel

A single tool message with three `Agent` calls, each `subagent_type: Explore`. Each prompt names its lens, the diff path, the changed files, the relevant docs to read (`CLAUDE.md`, `core-docs/design-system/foundations.md`, `core-docs/mini-gaps.md`, the cycle ledger entries, `language.md`, `decisions.md`, `tensions.md`, the propagation prompt at `.context/designer-propagation-prompt.md` if present), and asks for findings classified as **BLOCKER / NIT / FOLLOW-UP**. Cap each review at ~1200 words.

### 4. Triage the findings

- **BLOCKER** — would cause: a broken showcase build, a broken `feedback-status` gate, a wrong/stale citation in a promoted LP, a cycle ledger entry that misrepresents what was actually surfaced, a skill procedure that references a tool/file that doesn't exist, a propagation prompt that would mislead the Designer-side session. Fix in the branch.
- **NIT** — real improvement, cheap (single-file, no architectural change). Fix in the branch.
- **FOLLOW-UP** — real issue but expanding scope here is wrong (a different cycle, a separate skill update, a workflow improvement that wants its own discussion). Capture; don't fix here.

Some reviewer claims will be wrong on closer inspection. Spot-check the highest-impact items against the actual code/doc before fixing or filing.

### 5. Apply blocker + cheap-nit fixes; re-run gates

```sh
node tools/feedback-status.mjs   # status script still HEALTHY
cd projects/designer/showcase && npm run build   # showcase still builds (if showcase changed)
cd projects/designer/showcase && npx tsc --noEmit   # types still pass (if TS changed)
```

If gates fail, iterate. Don't move on with red gates.

### 6. Commit the fixes (PR + branch mode)

Stage only the files you touched. Commit with a message naming what the review caught. Do not amend pre-existing commits.

### 7. Hand off based on mode

**PR mode:**
1. `git push` to the PR's branch.
2. Update the PR body — append (or replace) "Reviewer notes" + "Follow-ups" sections (templates below).
3. Tell the user the PR is ready for their review; include the PR URL.
4. **Stop.** Do not merge.

**Branch mode:**
1. Decide whether the branch is ready for a PR (all blockers fixed, gates green, no FOLLOW-UPs that should block opening).
2. If ready: `git push -u origin <branch>`, then `gh pr create --base <base> --title "<short title>" --body "<body>"`. Body must include Summary, Test plan, Reviewer notes, Follow-ups (if any).
3. Tell the user the PR has been opened; include the PR URL.
4. **Stop.** Do not merge.

**Range mode:**
1. No PR is opened.
2. Write findings inline as the assistant's reply.
3. If fixes were applied, mention what was changed but do not push without explicit user instruction.
4. **Stop.**

## "Reviewer notes" PR-body template

```markdown
## Reviewer notes

Three parallel staff-perspective reviews ran before this opened for human review.

**Staff engineer.** _Findings:_ [one-line summary].
_Acted on:_ [what was fixed in commit X]. _Deferred:_ [FOLLOW-UPs].

**Staff design critic.** _Findings:_ ... _Acted on:_ ... _Deferred:_ ...

**Staff workflow editor.** _Findings:_ ... _Acted on:_ ... _Deferred:_ ...

Quality gates re-run after fixes; results [link or one-liner].
```

The bar is honesty over polish — if a review found nothing of consequence, say so. If you disagreed with a reviewer's finding and didn't fix it, say so and why.

## "Branch mode" PR template

```markdown
## Summary
- [1–3 bullets — what changed and why]

## Test plan
- [ ] node tools/feedback-status.mjs reports HEALTHY
- [ ] [showcase build / typecheck if applicable]
- [ ] [other manual checks]

## Reviewer notes
[same template as above]

## Follow-ups
- [bulleted FOLLOW-UPs]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Title: short (under 70 chars), no prefix, concrete. Mirror the style of recent merged PRs in `git log --oneline origin/main`.

## Don't merge

The `gh pr merge` command is not part of this skill. The skill ends with a PR open or a written summary; the user reviews next. If the user explicitly asks to merge after the reviews, that's a separate decision — confirm and run `gh pr merge` directly. Do not infer permission from the success of the reviews.

## Gotchas

- **Reviewers don't see the diff path automatically.** Each prompt must include the path to the saved diff and the list of changed files.

- **Reviewers can be confidently wrong.** Past pattern: a reviewer claims a foundation citation is wrong when it's actually correct under a different name. Spot-check high-impact findings against `core-docs/design-system/foundations.md` directly before acting.

- **Grep finds what reviewers miss.** Three reviewers can collectively miss a stale `Propagated to canonical: pending` field on an entry that should have been updated, or a tension that's been resolved but never moved to decisions. After the reviews, run focused greps:
  - `Propagated to canonical: pending` against entries that should have been updated this PR
  - `Status: proposed` against LPs that should have been promoted this PR
  - `Distilled:` footer presence on every cycle ledger entry
  - Cross-references (LP-XXXX, D-XXXX, T-XXXX, G-XXXX) — do all referenced IDs exist?

- **One review missing isn't a deal-breaker.** If a perspective genuinely doesn't apply (a foundations-doc-only PR has nothing for the design critic beyond the foundations doc itself), say so explicitly.

- **Don't conflate adherence with craft.** The design critic reviews craft; this skill is not a substitute for `enforce-tokens` or `audit-a11y` (adherence checks). If the change touches showcase variants, those should run separately.

- **Scope creep is the failure mode.** A reviewer says "while you're here, you should also restructure the cycle-ledger format." That's a FOLLOW-UP, not a blocker.

- **Cycle-ledger entries are append-only.** Reviewers shouldn't suggest editing past entries to "fix retroactive interpretation." If a past entry got something wrong, the right fix is a corrective entry that references the prior one.

- **Propagation-tracking entries are write-once until propagation lands.** If a reviewer suggests flipping `Propagated to canonical: pending` → `yes` because "it's done now," verify the actual cross-repo PR has merged. The flip is only correct after the Designer-side PR lands.

- **Branch mode: don't open a PR with red gates.** Iterate on fixes until green or stop and report what's blocking.

- **The skill ends with the PR open or a written summary.** No merge, no approval, no comment-with-LGTM. The user reviews next.
