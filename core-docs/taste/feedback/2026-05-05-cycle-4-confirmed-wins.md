# 2026-05-05 — cycle 4: confirmed-wins synthesis + classification A/B/C

**Variants under critique:** `c4-a-clean-report`, `c4-b-status-chip-report`, `c4-c-text-label-report`
**Source of feedback:** Agentation annotations (5) + chat reactions
**Annotation count drained:** 5 unique

## What this cycle was probing

Whether the confirmed wins from cycles 1–3 (c2-d as base, c3 diff-box, c2-b inline code, no rails, no invented glyphs, classification of artifacts) compose into a single coherent variant — and whether the "should the report carry a classification, and how" question can be settled by direct A/B/C comparison.

## Annotations, by variant

### c4-a-clean-report

- **`[fix]` `[mini-gap]`** "too much horizontal padding — the padding all around should be equal, and it should be just a few px (use a base 4/base 8 number) larger than the current vertical padding" (on `<C4ACleanReport> <Message>` user bubble)
  - *Interpretation:* I set `padding: var(--space-3) var(--space-5)` (8px / 24px) on the bubble. User wants equal padding around, ~12px. Mini's spacing scale jumps from `--space-3` (8px) to `--space-4` (16px); there is no 12px step. This is both a tactical fix AND a Mini token-scale gap.
  - *Action:* Set `padding: 0.75rem` (12px) all around in showcase. Logged Mini gap G-0001.

- **`[contested]` `[principle?]`** "i prefer this [c4-a] to the shipped tag in c4-b. i can't decide if i like the 'FIX' label or just this heading text" (on `<C4ACleanReport> <Report>`)
  - *Interpretation:* User prefers the no-label version (c4-a) over the chip version (c4-b), but is genuinely uncertain whether *some* form of classification adds value. Drove the creation of c4-c (small uppercase text label) as a third A/B point.
  - *Action:* Built c4-c. Tension stays open; needs another reaction round to settle.

### c4-b-status-chip-report

- **`[fix]`** "shipped tag and shipped in the header are redundant" (on `<C4BStatusChipReport> <Report>` head)
  - *Interpretation:* My initial chip rendered "Shipped" as label, while the report title body also said "shipped". Two same-word labels stacked is purely redundant.
  - *Action:* Changed chip wording to use the *classification* (Fix / Feature / Improvement) instead of "Shipped". The chip now adds info; it doesn't echo.

- **`[principle?]`** "the blinking cursor and the blinking left vertical bar is too much — just one is sufficient" (on the streaming row)
  - *Interpretation:* c4 inherited c3's streaming treatment (accent rail + accent cursor, both pulsing). Two simultaneous animations on the same row read as too active. The user wants one.
  - *Action:* Dropped the rail, kept the cursor. The cursor is the convention (iMessage / Claude / ChatGPT); the rail was a c3 invention.
  - *Recurrence:* This is the second cycle in a row where the user has flagged "two visual signals where one would do" (cycle 3 was bar+chevron on tool-run). Strong principle candidate now — see distillation.

- **`[principle?]`** "should this diff show red/green added and subtracted like a normal diff?" (on `<C4BStatusChipReport> <CodeChange>` diff block)
  - *Interpretation:* My initial diff rendered as plain `<pre>` with raw `+` / `-` characters. The user expects diff colorization — which is a universal convention (every IDE, every code review tool). A diff that doesn't colorize defies the convention.
  - *Action:* Implemented per-line colorization (success-3 fill for `+`, danger-3 fill for `-`, neutral for context).
  - *Principle candidate:* Conventional patterns over invented ones. When a UI element has an established cross-tool convention, the variant should respect it unless there's a specific reason not to.

### c4-c-text-label-report

(No reactions yet — c4-c was built mid-cycle as a response to the c4-a/c4-b ambiguity.)

## Principle candidates surfaced this cycle

- **One signal per affordance / state.** Now confirmed across two cycles (cycle 3 bar+chevron, cycle 4 cursor+rail). Ready to promote.
- **Conventional patterns over invented ones.** Single mention this cycle (diff colorization), but echoes cycle 1's "chat metaphor is load-bearing" finding. Watch list — likely promotable next cycle.

## Mini gaps logged this cycle

- **G-0001** — No 12px step in the spacing scale. `--space-3` is 8px, `--space-4` is 16px. Standard chat-bubble padding falls between these. See `core-docs/mini-gaps.md`.

## Top 3 takeaways

1. **One signal per affordance is now ready to promote.** It has shown up two cycles in a row in unrelated places (tool-run disclosure, streaming row). Distillation should write it into `language.md`.
2. **The classification question is unsettled.** c4-a (no label) is preferred over c4-b (chip), but c4-c (inline text) hasn't been reacted to yet. Another reaction round is needed.
3. **Mini's spacing scale has a real gap between 8px and 16px.** Showcase tolerated a raw value (0.75rem); production Mini will face the same problem when actual chat surfaces are built.

## What this leaves unresolved

- The classification question (c4-a vs c4-c).
- Whether the diff-box should expand inline (current behavior) or open in a side panel for longer diffs (T-0002 spillover).
- Whether the chat-bubble shape itself wants to be a Mini archetype (`Bubble`) — flagged in cycle 1 mini gaps as a watch item, still watching.


---
**Distilled:** 2026-05-05 via distill-feedback
**Promoted:** D-0004 (bordered boxes vs rails), LP-0001 (one signal per affordance), LP-0002 (conventional over invented)
