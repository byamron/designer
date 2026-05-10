# 2026-05-04 — workspace thread: conversation layer vs. operation layer

**Variants critiqued:** `c2-a-hospitality`, `c2-b-rich-density`, `c2-c-active-ambient-chat`, `c2-d-coalesce-right`
**Source references:** Designer's `rebuild-review` reference; Conductor's chat surface (the user is operating inside Conductor while critiquing)
**Lenses applied:** Reduction & Essence, Hospitality, Three-Slider Problem

## The single load-bearing finding

User direction, paraphrased: *"balance a casual/familiar/accessible chat experience with the power to zoom in on tool calls (Conductor collapses them well) — approachable and clean at a glance, powerful under the hood."*

This clarifies a separation that wasn't articulated before: **every artifact in the workspace thread is either part of the conversation layer or part of the operation layer.** They get different treatment.

| Layer | Artifacts | Treatment |
|---|---|---|
| **Conversation** | user message, agent message, code-change, report, approval | Warm, body-size, accessible, default-visible. This is what the manager came to see. |
| **Operation** | tool call, thinking trace, internal process | Quiet, smaller, monospace-where-relevant, default-collapsed. Footnote register. Inspectable on click. |

The casual chat read comes from the conversation layer being uncluttered. The power comes from the operation layer being **always present, never lost, one click deep**.

## How each c2 variant landed

- **c2-b** had the right conversation-layer treatment (rich agent prose, visible code-change, visible report, prominent approval) but defaulted the operation layer to expanded — clutters the at-a-glance read.
- **c2-d** collapsed everything aggressively. Tool-call collapse was right; collapsing reports and code-changes was wrong — those are the agent's *output*, conversational events, the answer to "what did you ship." Hiding them by default loses the agent's voice for what it accomplished.
- **c2-a** had the right warmth direction (date stamp, "resumed after 12 min", italic compose copy) but didn't address the conversation/operation distinction.
- **c2-c** had reasonable motion but the ambient pulse on the streaming row was too aggressive for "calm by default" — needs to be toned to a hairline accent rail + accent cursor only.

## Findings by lens

### Reduction & Essence
The reduction lever is operation-layer-only. Conversation-layer reduction (collapsing reports, code-changes) costs more than it saves because the manager actually came to see those.
**Concrete next step:** Collapse tool-runs by default, hard. Keep code-changes and reports visible by default. Approvals always prominent.

### Three-Slider Problem
The "should this artifact be visible at a glance?" question collapses into the conversation-vs-operation classification. One classification governs disclosure default, chrome treatment, and motion register. That's three sliders becoming one decision.
**Concrete next step:** Make the classification explicit in the artifact types — add a `layer: "conversation" | "operation"` field to thread artifacts so renderers can branch on it once.

### Hospitality
Conductor's pattern (cited by the user) is the proof point: tool calls collapsed quietly, conversation rendered with warmth. Hospitality isn't an additional layer; it's how the conversation layer feels. The manager opens the workspace and sees a conversation, not a CI log.
**Concrete next step:** c2-a's warmth gestures (date stamp, "resumed after X min", soft compose copy) layer into the conversation-layer treatment by default. They are not a separate variant axis going forward.

## Language deltas surfaced

- **New axiom-level rule (proposed):** *Workspace thread artifacts classify as conversation or operation. Conversation defaults visible; operation defaults collapsed. The classification governs disclosure, chrome, and motion.* This is a load-bearing pattern — propose adding to the canonical `design-language.md` as a thread-specific pattern alongside the chat baseline.
- **Microcopy register:** "Approval requested" reads institutional. "Needs your call" or similar reads conversational. The labels in the operation layer can stay neutral-mono; the labels in the conversation layer should be in the voice of the product.

## Mini gaps surfaced

None new. Mini's primitives can express the conversation/operation distinction via composition (Box variants, Stack with different spacing). The bubble for user messages is still a candidate Mini archetype but is not blocking.

## Top 3

1. **Build c3 as the synthesis.** Rich agent prose (from c2-b) + tool-runs collapsed by default (from c2-d) + visible code-changes / reports / approvals + small warmth gestures (date stamp, soft compose copy) + toned streaming (hairline rail + accent cursor only, no ambient pulse).
2. **Add a `layer` classification to artifact types.** Renderers branch on it once instead of guessing per-component.
3. **Soften microcopy in conversation-layer artifacts.** "Approval requested" → something more conversational. "↓ Jump to latest" stays — it's chrome, not voice.

## Decisions ready to commit

- **D-0003:** Workspace thread artifacts classify as conversation or operation. Conversation defaults visible with warm chrome; operation defaults collapsed with quiet chrome. Tool calls and thinking are operation. User messages, agent messages, code-changes, reports, and approvals are conversation.


---
**Distilled:** 2026-05-05 via distill-feedback
**Promoted:** D-0004 (bordered boxes vs rails), LP-0001 (one signal per affordance), LP-0002 (conventional over invented)
