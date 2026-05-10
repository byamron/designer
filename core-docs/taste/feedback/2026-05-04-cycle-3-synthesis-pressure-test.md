# 2026-05-04 — cycle 3: c3 synthesis pressure-test

**Variants under critique:** `c3-synthesis`
**Source of feedback:** Agentation annotations (3) + chat reactions
**Annotation count drained:** 3 unique

## What this cycle was probing

Whether c3 (synthesizing c2-d's collapsibility + c2-b's rich prose + c2-c's toned streaming + c2-a's warmth) lands the "casual at a glance, powerful underneath" balance set in cycle 2. Specifically: does the conversation/operation classification (D-0003) hold up when concretely rendered?

## Annotations, by variant

### c3-synthesis

- **`[positive]`** "i like this diff box — clear how to expand it and clearly distinct from not code changes in the chat" (on `<C3Synthesis> <CodeChange>`)
  - *Interpretation:* The bordered diff-box pattern (border-soft + content-surface fill + "Show diff" toggle) reads correctly. The user confirms a code-change is visually distinct from a normal message and the disclosure affordance is legible.
  - *Action:* Pull this exact pattern forward into c4. Don't change the diff-box; build everything else around it.

- **`[fix]`** "i really don't like the border on one side where it curves partially around the corners — bad aesthetic" (on `<C3Synthesis> <Report>`)
  - *Interpretation:* The c3 report's left accent rail (`border-left: 3px solid success-9`) combined with the container's rounded `radius-button` corners produces an awkward shape — the rail's straight edge meets the rounded corner ambiguously. The rail-as-semantic-carrier idea is wrong on rounded containers.
  - *Action:* Rejected as treatment. Cycle 4 must drop the rail and find a different way to express semantic ("Fix" / "Feature") if it should be expressed at all.

- **`[principle?]`** "vertical bar not necessary here — bar + chevron is too much, and the chevron alone sets the text apart" (on `<C3Synthesis> <ToolRun>`)
  - *Interpretation:* The c3 tool-run combined `border-left: 1px solid border-soft` (left rail) AND a chevron disclosure indicator. The user reads this as redundant — two signals communicating the same affordance. The chevron alone is sufficient.
  - *Action:* Tactical fix: drop the rail in c4. Principle candidate: "where a single visual signal communicates an affordance, don't stack two." This pattern is broader than the tool-run — watch for it elsewhere (it will recur).

## Principle candidates surfaced this cycle

- **One signal per affordance.** Bar + chevron is too much when chevron alone communicates "expandable." Watch this in motion (cycle 4 streaming row), in disclosure (anywhere with a chevron), in semantic encoding (anywhere with a chip *and* a color rail).

## Mini gaps logged this cycle

None new. The c3 report's curved-corner-rail is a Mini design-choice failure (the variant chose poorly), not a Mini-vocabulary gap.

## Top 3 takeaways

1. **The bordered diff-box pattern from c3 is locked.** Carry it forward unchanged.
2. **Drop both rails (report rail, tool-run rail) in c4.** Both surfaced as wrong, for different reasons. The success rail had a corner-aesthetics issue; the tool-run rail was redundant with the chevron.
3. **Carry forward the "one signal per affordance" principle as a watch item.** It will likely surface again in the streaming row treatment.

## What this leaves unresolved

- How should the report semantic ("Fix" / "Feature" / "Improvement") be expressed, if at all? Three plausible options to test in c4: (a) no expression — let prose carry; (b) chip; (c) inline text label.
- T-0005 (where hierarchy is carried) is partially addressed — the conversation/operation split carries the macro hierarchy. The micro hierarchy *within* the conversation layer is still under-articulated.


---
**Distilled:** 2026-05-05 via distill-feedback
**Promoted:** D-0004 (bordered boxes vs rails), LP-0001 (one signal per affordance), LP-0002 (conventional over invented)
