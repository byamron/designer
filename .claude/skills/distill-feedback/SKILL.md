---
name: distill-feedback
description: Cross-cycle pattern extraction. Read recent feedback ledger entries, surface signals that recur, and propose promotions to language.md / decisions.md / tensions.md / mini-gaps.md. The user approves each promotion before it lands. Run every 2-3 cycles, at end of session, or when the ledger has accumulated >3 unprocessed cycle entries.
# Vendored from byamron/mini-design-system commit e2aa041a05040f913ab4ee98e011ce517561e355 on 2026-05-10. Do not edit in place; upstream changes propagate via re-vendor.
user_invocable: true
---

# Distill Feedback

This is the pass that turns repeated reactions into durable principles. The drain-feedback skill captures every cycle's annotations into ledger entries; this skill reads across those entries and asks: what recurs?

Without this pass, the project keeps a clean record but never grows. Patterns that show up across three cycles should become principles in `language.md`, not stay buried in three separate ledger entries.

## When to run

- Every 2–3 cycles (rough cadence, not strict).
- At end of session, before a long break.
- When 3+ unprocessed cycle entries have accumulated since the last distillation.
- When the user explicitly asks ("what have we learned?" / "let's consolidate").

A "processed" entry is one that has a `Distilled in YYYY-MM-DD` footer added by this skill — that's how we track what's been folded in already.

## Procedure

### 1. Read the relevant inputs

- All feedback entries since the last distillation pass (look for the `Distilled in` footer; entries without one are unprocessed).
- `projects/<name>/language.md`
- `projects/<name>/decisions.md`
- `projects/<name>/tensions.md`
- `core-docs/mini-gaps.md`
- `core-docs/design-system/foundations.md` — the established-vocabulary reference. Used in step 3 to check whether a candidate principle echoes a known foundation before promoting it as novel.

### 2. Find the patterns

Look for:

- **Repeated `[principle?]` tags across cycles.** Same critique, different surfaces or different cycles. ≥2 occurrences → strong promotion candidate. ≥3 → almost certainly a real principle.
- **Repeated `[fix]` annotations that share a deeper cause.** Three independent "padding feels off" fixes in three places might mean a token-scale gap. Three "icon meanings unclear" might mean an iconography principle the language doesn't have.
- **Resolved tensions that no recent cycle has questioned.** If `tensions.md` has open items that haven't been touched in 3 cycles, ask whether they've been silently resolved or silently abandoned.
- **Mini gaps that recurred.** A gap surfaced in one cycle is project-specific. The same gap in two cycles, especially if eventually surfaced across two projects, is a real Mini issue.
- **Positive signals that recur.** Things the user repeatedly likes are as load-bearing as things they repeatedly reject.

### 3. Draft promotion proposals

**Before drafting, check foundations.** For each candidate principle, scan `core-docs/design-system/foundations.md` to see whether the pattern echoes an established foundation (Gestalt, UX laws, visual design fundamentals, Norman's interaction principles, etc.). Three possible outcomes:

- **Direct echo of a foundation.** Don't promote as a novel LP — instead, write the project-specific application *citing the foundation*. Example: "LP-XXXX: Group toggles with their stats indicators (proximity principle, see `foundations.md`)." This keeps the project's language doc connected to the broader vocabulary instead of re-inventing names.
- **Refinement of a foundation.** The pattern adds project-specific shape on top of an established principle. Promote with the citation: "LP-XXXX: <project-specific rule>. Refines the <foundation name> principle by <specific application>."
- **Genuinely novel.** Nothing in the foundations covers it. Promote without citation, but be careful — the foundations doc is broad. If three reviews can't find a citation, it might genuinely be new; if you didn't bother to check, you'll just be re-inventing.

Then for each pattern, draft one of:

- **Promote to `language.md`** — a craft principle that should be a first-class part of the project's design language.
- **Promote to `decisions.md`** — a tension that's been resolved by the loop's iterations even if no single cycle closed it explicitly. Use a `D-XXXX` ID. Cross-reference the originating tension.
- **Add to `tensions.md`** — a new open question surfaced by recurring fix patterns.
- **Promote to `core-docs/mini-gaps.md`** — note recurrence on an existing gap, or escalate hypothesis from "project-specific" to "extend Mini".
- **Cross-project candidate** — a principle that may belong in `taste/` (the higher layer). Don't write it there yet; flag it for future cross-project distillation.

For each proposal include:
- The pattern observed (which cycles, which annotations)
- Foundation citation (if any) from `core-docs/design-system/foundations.md`
- The proposed promotion (target file, exact text to add)
- The reasoning (why this beats not-promoting)
- The cost of being wrong (what changes if we promote and it turns out to be one-off)

### 4. Get user approval

Present proposals in chat as a numbered list. The user picks which to apply, modifies wording, or rejects. **Do not write to `language.md`, `decisions.md`, or canonical Designer docs without explicit approval.** The cost of a stale principle is high — they distort future cycles.

For Mini gaps, you can update `core-docs/mini-gaps.md` without explicit approval (it's a tracking doc, not a contract), but flag substantive escalations.

### 5. Apply the approved promotions

Edit the target files. For each promotion:
- Cite the originating cycle entries in the new content (so future readers can trace it).
- Use the file's existing format and ID conventions.
- Keep prose tight — durable principles should be one or two sentences plus reasoning.

### 6. Mark the cycle entries as distilled

Append a footer to each ledger entry that was processed:

```
---
**Distilled:** YYYY-MM-DD via distill-feedback
**Promoted:** <list of D-XXXX, language.md additions, G-XXXX entries created or updated>
```

This prevents re-distilling the same content twice and gives the trail.

### 7. Propagation note

For any promotion to `decisions.md` that has `**Propagated to canonical:** pending`, list the pending propagations in the chat report. The user decides when to push them back into `~/Desktop/coding/designer/core-docs/design-system/design-language.md` (which is the production-Mini consumer).

### 8. Verify with the status script

Run `node tools/feedback-status.mjs` again. Confirm verdict is HEALTHY (or at most WARN with one cycle of warning room). If undistilled count is still ≥ 3 after a distillation pass, something went wrong — likely a footer wasn't appended. Investigate before reporting success.

### 9. Report back

In chat, summarize:
- Patterns surfaced
- Promotions proposed (with proposed wording inline)
- What was left as `[principle?]` (still under-supported by repetition)
- Any Mini gaps that recurred and now warrant escalation

## Rules of engagement

- **Promote sparingly.** A principle in `language.md` is load-bearing — every future cycle reads it. The bar is "this would meaningfully shape the next variant generation we do." If a candidate is interesting but not load-bearing, leave it as `[principle?]` and let it surface again.
- **Wording matters.** A promoted principle should be (a) actionable in a generation step, (b) testable in a critique step, (c) compatible with the canonical Designer language. Vague principles ("design with care") rot the doc.
- **Don't skip the cost-of-being-wrong question.** Some promotions are cheap to undo (a line in `tensions.md`). Some are expensive (an axiom in `language.md` that future cycles assume). Match the bar to the cost.
- **Trace everything.** Every promotion cites the cycle entries it came from. The audit trail is what makes the loop debuggable a year from now.
- **The user owns the language.** The skill proposes; the user disposes. Propose strongly, accept rejection cleanly, never sneak through.
