# 2026-05-05 — cycle 5: report architecture + Designer chrome experiment + workflow infrastructure

**Variants under critique:** `c4-a-clean-report`, `c4-b-status-chip-report`, `c4-c-text-label-report`, `c5-a-report-as-prose`, `c5-b-report-as-structured`
**Source of feedback:** chat only (annotations all dismissed in cycle 4 drain; this session's signal is conversational)
**Items drained:** 22 unique (0 from annotations, 22 from chat)

## What this cycle was probing

Three threads ran in parallel:
1. **Visual:** finishing the report-treatment question. c4-a/b/c (chip vs no-label vs text-label inside a bordered box), then c5-a/b (drop the box vs earn the box with affordances).
2. **Architectural:** what reports and approvals *are* across the product — chat elements vs project artifacts. Surfaced because the visual decision was blocked by the question.
3. **Workflow / infrastructure:** tightening how feedback is captured and propagated across this repo and into Designer. Includes the foundations doc, the propagation prompt, the feedback-status gate, scope guard in CLAUDE.md.

## Items, by variant or topic

### Variant resolution: c4 family + c5-a/b

- **`[fix]` *(chat)*** "I can't decide between c4-b and c4-c, but it's clear that the reports will need some kind of label, whatever the visual treatment ends up being."
  - *Interpretation:* c4-a (no classification at all) is rejected — labels add value. The chip-vs-text-label choice (c4-b vs c4-c) is unsettled at the level of pure label treatment, but the larger question of "is the report a box at all" supersedes it.
  - *Action:* c4-a retired. c4-b chip and c4-c text-label both kept as alternative label treatments; the pick between them is deferred until cycle 6 work re-engages it.

- **`[positive]` *(chat)*** "It looks like we definitely want c5-b (which takes more the shape of c4-b visually — i'm good with this)."
  - *Interpretation:* The structured-artifact direction (c5-b) is settled. The visual carrier is c4-b's chip pattern. c5-a (drop the box, render as prose) is rejected.
  - *Action:* c5-b is the cycle 5 winner. The chip lives. Future iterations refine c5-b for D-0006's supersession needs.

### Architectural decisions captured

- **`[decision]` *(chat)*** Reports surface in chat AND on home — and need to stay current. Reports are not chat artifacts; they're project artifacts.
  - *Interpretation:* The user surfaced this as a question ("are reports linked across surfaces? should they be?") — and the analysis showed that yes, they are, which means reports cross the line from chat element to project artifact.
  - *Action:* Captured as **D-0006** in `decisions.md` — reports are frozen snapshots with append-only supersession. Marked as product-architecture, queued for Designer migration.

- **`[decision]` *(chat)*** "Imagine a world where there are multiple agent teams working ... the user shouldn't be expected to go into every individual chat and approve things one by one."
  - *Interpretation:* Approvals must aggregate. The cockpit thesis (canonical principle 1) demands a global inbox, not per-chat action surfaces. Per-chat approvals fail at multi-team scale.
  - *Action:* Captured as **D-0005** in `decisions.md` — approvals are project artifacts surfaced via global inbox. Marked as product-architecture, queued for Designer migration.

### Chat-source principle candidates (cycle 5's main contribution)

These are candidates surfaced through chat conversation. Distillation will evaluate which to promote and check each against `core-docs/foundations.md` for citations.

- **`[principle?]` *(chat)*** Click never leaves a focus ring. Recurs across rail items, diff toggle, "throughout the designer app itself."
  - *Interpretation:* Visible focus is reserved for keyboard navigation. Mouse clicks fire actions but don't leave persistent focus indicators. This is a Designer-wide pattern, not just a showcase issue (user explicitly said: "The focused state issue is present throughout the designer app itself — on the compose box, main tab, and elsewhere").
  - *Action:* Three surface fixes in showcase (rail switched to listbox pattern; diff toggle gets `onMouseUp blur`; explicit `:focus-visible` overrides). Tension **T-0007** raised the priority — Designer-wide audit + primitive-level fix is the right resolution. Strong promotion candidate; foundations citation: WCAG / focus-visible best practice + Norman's signifier vs affordance.

- **`[principle?]` *(chat)*** Less is more — every element on the showcase must earn its presence.
  - *Interpretation:* Static representations of dynamic features are worth zero. Default to removal. Four removals in this cycle (compose dock, project strip, cycle sublabels, jump-to-latest pill) all came from the same family of feedback. The user named the principle directly: "showcase elements should serve the critique, not decorate."
  - *Action:* Each removal applied via CSS or directly in source. Promotion candidate; foundations citation: prägnanz (Gestalt) + reduction. Four independent occurrences in one session = overwhelming evidence.

- **`[principle?]` *(chat)*** Group controls with the indicators they affect (proximity).
  - *Interpretation:* "On that diff box, the show/hide should go near the line add/subtraction indicator — that groups the button near the indicator that suggests what the button shows (proximity principle)." User cited Gestalt directly.
  - *Action:* Diff toggle moved into the stats group across c4-a/b/c (and inherited by c5-a/b). Word "diff" dropped from button label since `+18 −2` already declares it. Promotion candidate; foundations citation: proximity (Gestalt).

- **`[principle?]` *(chat)*** Don't restate context the surrounding elements already provide.
  - *Interpretation:* Sub-rule of less-is-more. "Show diff" → "Show" because the +/− stats already declare it's a diff. "Shipped" tag on a report titled "...shipped" was redundant (cycle 4 fix). Two surfaces converging.
  - *Action:* Applied to diff toggle wording. Promotion candidate as a sub-clause of less-is-more or as standalone.

- **`[principle?]` *(chat)*** Chrome doesn't scroll. Structural elements (page background, navigation rail, surrounding shell) must be locked at the viewport.
  - *Interpretation:* "It shouldn't be... only scrollable surfaces (like within a sidebar, in the main tab, etc.) should be scrollable. Not the navigational elements that appear fixed. Letting them scroll on the web page (rubber banding at the edges) breaks the structure of the UI."
  - *Action:* Implementation: `html, body { overflow: hidden; overscroll-behavior: none }` plus `overscroll-behavior: contain` on every internal scrollable surface. Foundational rule for the cockpit thesis (chrome must feel fixed). Foundations citation: Norman's mappings + Designer principle 1.

- **`[principle?]` *(chat)*** Use the listbox pattern (`role="listbox"` + `aria-activedescendant`) for lists where each item swaps a panel.
  - *Interpretation:* Came from the rail's focus-vs-active overlap bug. Roving tabindex moves DOM focus item-to-item; the listbox pattern keeps focus on the container and uses `aria-selected` for items. The latter is right for nav/tabs/variant rails because arrow-key activation IS the selection — focus and active coincide.
  - *Action:* Rail restructured to listbox pattern. Promotion candidate; foundations citation: directly named in `foundations.md` §5 (a11y / specific patterns).

- **`[principle?]` *(chat)*** The cockpit aggregates open state. Anywhere multiple parallel work streams produce items needing the user's attention, those items aggregate into a single inbox-pattern surface.
  - *Interpretation:* Generalizes D-0005 from "approvals" to "any open-state-needing-action primitive." Errors, blockers, clarification requests — all should follow the inbox pattern. The cockpit thesis at the architectural level.
  - *Action:* Promotion candidate; foundations citation: visibility, recognition over recall, Zeigarnik, conservation of complexity, Designer principle 1, Jakob's Law (inbox pattern is universal).

- **`[principle?]` *(chat)*** Vertical bars belong in gutters with real inset, not on container edges. Refines D-0004.
  - *Interpretation:* User pointed to Conductor's blockquote rendering as a clean implementation: bar in the gutter, content genuinely inset, signals "this is quoted / different voice." This is a different shape from the bar-on-bordered-container pattern D-0004 rejected. The two patterns coexist; rejection was specific to one shape, not the bar-as-marker concept generally.
  - *Action:* No code change yet (no use case in current surfaces). Captured as a refinement to D-0004 for distillation. Watch for future surfaces that need quoted-content rendering.

- **`[principle?]` *(chat)*** Focus indicators shouldn't leak across element boundaries. When items are packed tightly (gap < focus-offset), prefer inset focus indicators over offset outlines.
  - *Interpretation:* Tactical rule from a specific overlap bug. The 2px outline-offset extended into the 1px gap between items, and adjacent hover fills painted into the same space.
  - *Action:* Inset `box-shadow` instead of offset outline (initial fix, before the fuller listbox restructure rendered the rule moot for the rail). Watch for recurrence in other tightly-packed layouts.

### Workflow / infrastructure improvements

- **`[meta]` *(chat)*** Foundations doc requested. "Do deep research into common foundational UX principles and principles of visual design such as gestalt."
  - *Interpretation:* The taste-loop was at risk of re-inventing named principles (proximity, prägnanz, etc.). A working reference connects the project's vocabulary to established literature. User explicitly wanted it referenceable AND challengeable.
  - *Action:* Wrote `core-docs/foundations.md` (~5,000 words) — Gestalt, UX laws, visual fundamentals, Norman's interaction, A11y / WCAG, motion, cognitive load, when to break a principle. Wired into CLAUDE.md (consult during distillation/deviation) and into `distill-feedback` (citation-check before promoting candidates as novel).

- **`[meta]` *(chat)*** "Make sure that in addition to agentation annotations, comments in this chat (and others) are added into our understanding of the design language."
  - *Interpretation:* Chat reactions were at risk of being captured less rigorously than MCP annotations. User explicitly elevated chat-source feedback to equal rank.
  - *Action:* Updated `drain-feedback` skill to scan chat as a co-equal channel. Added rule to CLAUDE.md with the user's date-stamped statement. Ledger format extended to mark items `(annotation | chat)` for source provenance.

- **`[meta]` *(chat)*** "How will the 'every 2-3 cycles' be enforced? is there a counter or a way to check for stale status?"
  - *Interpretation:* The distillation cadence was hope, not enforcement. Without a counter, drift was inevitable.
  - *Action:* Built `tools/feedback-status.mjs` (counts cycles, distillation status, prints HEALTHY/WARN/DUE verdict). Wired into both skills as a gate. Added "first action of every session" rule to CLAUDE.md. Added "Improving the workflow itself" section asking future Claude to proactively name workflow gaps.

- **`[meta]` *(chat)*** "Have we floated into product thinking? Will it be easy to transfer knowledge between repos?"
  - *Interpretation:* Some decisions captured here are product architecture, not design language. Designer's repo is where they should live. Need a clean migration mechanism.
  - *Action:* Added scope-guard section to CLAUDE.md (capture briefly, tag as scope-foreign, don't expand to full decisions). Marked D-0005 and D-0006 with `> Scope note:` blockquotes. Wrote `.context/designer-propagation-prompt.md` (refined twice for accuracy) for the cross-repo migration.

### Designer chrome experiment (showcase rail + main panel)

- **`[positive]` *(chat)*** "Use designer navigation/sidebar styles/chrome and get feedback on that too so that we can put it into the design language understanding as well."
  - *Interpretation:* The showcase chrome itself is now a feedback target. Rail restyled with Designer-flavored conventions: page-tier flat, color-before-weight hierarchy, accent-tinted active state, compact density, concentric corner math.
  - *Action:* Rail switched to listbox pattern, Designer chrome applied. Items show single-row layout (headline + small mono id). Cycle group separators (hairlines + breathing space). Cycle sublabels removed (too generic). Floating raised main panel (radius-card + surface-shadow + content-surface fill) added to test two-tier register.

- **`[fix]` *(chat)*** "We don't need to include the project selector — i'm not asking you to fully create designer here, just use the relevant styles and patterns when it makes sense."
  - *Interpretation:* The 56-px project strip I added (D / T / H / P circles) was decoration not load-bearing for the critique. Same family as compose / pill / sublabels — non-functional chrome.
  - *Action:* Strip removed; layout back to two columns (rail + stage with floating panel inside).

### Variant infrastructure improvements

- **`[fix]` *(chat)*** Sidebar should preserve scroll, support arrow-key navigation, group cycles with separators.
  - *Action:* Implemented per-variant scroll preservation (Map keyed by variant id, restored on switch). Arrow-key navigation via window keydown. Cycle grouping in `cycles[]` data structure. All landed in App.tsx.

- **`[fix]` *(chat)*** Diff data inconsistency — header said +18 −2 but only `+` lines rendered.
  - *Action:* Updated `_shared/thread.ts` diffPreview to include 2 removed lines + 7 added, matching the realistic refactor pattern.

### Future work queued (tensions added)

- **T-0008** — Home page + roadmap feature. Big undesigned feature; expect more variant spread than chat surface needed.
- **T-0009** — Loading microinteractions + Unicode loading animations + loading language. Cross-cutting craft work; foundations to lean on (Doherty, anticipation, follow-through, peak-end).
- **T-0010** — Approval inbox surfacing details (depends on D-0005). Anchoring vs floating; badge model; chat ↔ inbox rendering relationship.
- **T-0011** — Report supersession chain visualization (depends on D-0006). What triggers supersession; how the chain expands; linear vs branching.

## Principle candidates surfaced this cycle

(Gathered for distillation. Each will be evaluated against `core-docs/foundations.md` and recurrence threshold before promotion.)

- **Click never leaves a focus ring.** Recurs across 3+ surfaces in this session and was named explicitly as Designer-wide. Strong promote.
- **Less is more — earn presence.** Four independent occurrences in one session. Strong promote.
- **Group controls with their indicators (proximity).** User cited the principle by name. Promote.
- **Don't restate context the surrounding elements provide.** Sub-rule of less-is-more or standalone. Promote (probably as sub-clause).
- **Chrome doesn't scroll.** Foundational rule for the cockpit thesis. Promote.
- **Listbox pattern over roving tabindex** for lists-as-nav. Tactical/structural rule with a clear use case. Promote with foundation citation already in foundations.md.
- **The cockpit aggregates open state.** Generalizes D-0005. Promote (likely as a Designer principle, possibly cross-project).
- **Vertical bars belong in gutters** (refinement of D-0004). Promote as refinement.
- **Focus indicators shouldn't leak across boundaries.** Tactical; recurrence yet to be seen elsewhere. Watch list.

Plus retro-citation work — LP-0001 and LP-0002 already in source as proposed; user has agreed to retro-cite them with foundations:
- LP-0001 (one signal per affordance/state) → prägnanz + Norman's signifier vs affordance
- LP-0002 (conventional patterns over invented) → Jakob's Law

## Mini gaps logged this cycle

None new. G-0001 (12px space step) remains the only surfaced gap; cycle 5 didn't add to the list. The chat-bubble Bubble archetype watch item (G-0002) has not recurred.

## Top 3 takeaways

1. **Cycle 5 was disproportionately about workflow infrastructure rather than variant work.** Foundations doc, propagation prompt, feedback-status gate, scope guard, drain-feedback chat-channel rule — these are workflow improvements that compound across all future cycles. Worth noting in the "Improving the workflow itself" sense (CLAUDE.md): *cycles where the workflow gets sharpened are as valuable as cycles where the artifacts get sharper.*
2. **The product-vs-craft scope line surfaced for the first time and was handled.** D-0005 and D-0006 are clean examples of decisions that surfaced inside craft work but belong in Designer's repo. The scope-note pattern (block-quote at the top of an entry) plus the migration prompt establish the channel before it gets clogged.
3. **Cycle 5's seven principle candidates make distillation a meaningful pass for the first time.** Cycles 1–4 produced a few; cycle 5 produced enough that distillation matters. The retro-cite-with-foundations move (already user-approved) ties the language doc to broader vocabulary.

## What this leaves unresolved

- **c4-b vs c4-c label treatment** when c5-b inherits the chip pattern — c5-b uses c4-b's chip; if a future iteration wants to test text-label inside the structured form, that's a c5-c worth building.
- **c5-b refinements for D-0006's supersession needs.** The structured artifact form needs a "← previous version" affordance, prominent timestamp, current-vs-outdated visual distinction. Tracked in T-0011.
- **All seven principle candidates** are pending the distillation pass and user approval before promotion.
- **Cycle 5 arguably should have been split into multiple cycles.** Variant work + architectural calls + workflow improvements all in one cycle is a lot. Worth a process note: **cycle scope is too loose right now**. A future workflow improvement might be: when a single session produces 3+ distinct kinds of output (variants, decisions, infrastructure), split into multiple cycle ledger entries instead of one. Captured for the next "Improving the workflow itself" pass.


---
**Distilled:** 2026-05-05 via distill-feedback
**Promoted:**
- LP-0001 retro-cited (prägnanz + Norman); status → promoted
- LP-0002 retro-cited (Jakob's Law); status → promoted
- LP-0003 (click never leaves a focus ring) — new
- LP-0004 (less is more — every element earns its presence; sub-rule on context restating) — new
- LP-0005 (group controls with their indicators — proximity) — new
- LP-0006 (chrome doesn't scroll) — new
- LP-0007 (use the listbox pattern for lists where each item swaps a panel) — new
- LP-0008 (the cockpit aggregates open state) — new
- D-0004 amended with the gutter-bar exception
**Watch list (not promoted this round):**
- "Focus indicators don't leak across element boundaries" — single occurrence, tactical; promote if recurs in another packed-list surface.
