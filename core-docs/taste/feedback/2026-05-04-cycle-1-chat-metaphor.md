# 2026-05-04 — workspace thread: chat metaphor is load-bearing

**Variants critiqued:** `v1-color-hierarchy`, `v2-spatial-rhythm`, `v3-document-register`, `v4-coalesce-disclose`, `v5-active-ambient`
**Source references:** `references/workspace-thread--light.png`, plus a live Designer screenshot of the `rebuild-review` workspace and a Cowork chat reference shared by the user
**Lenses applied:** Reduction & Essence, Metaphor Integrity, Hospitality

## The single load-bearing finding

User's reaction to all 5 variants, verbatim: *"none of these alternatives really look like chat — that's what i want."*

The variants framed the workspace thread as a managerial document, log, or activity stream. Designer's actual reference and the Cowork comparison both confirm the right metaphor is **chat** — but a specific kind:

- **User messages are filled bubbles.** Soft gray fill (caption-material-tint-2 register in the live ref), ~12px radius, right-aligned-ish in a centered narrow column.
- **Agent messages are flat prose**, no bubble. Rich content allowed: headings, numbered lists, paragraph flow.
- **Tool calls coalesce into a header** ("3 tool calls, 2 messages") with individual lines as caption / log-style entries below — grayed monospace command previews, italic verb leaders.
- **Scroll-to-bottom pill** is part of the chat read, not optional chrome.
- **Thinking lines** are styled as quiet log entries with a "Thinking — " leader and a grayed monospace command preview when relevant.

T-0003 (user-vs-agent encoding) and the underlying read of "manager's cockpit, not developer's IDE" had been over-interpreted. "Cockpit" governs *the surrounding shell* (project strip, sidebar, activity spine, tabs). Inside the workspace thread, the conversation register IS chat — and that's intentional, because the manager is *talking with* their team.

## Findings by lens

### Metaphor Integrity
The central metaphor of the workspace thread is "you talking with an agent team." All five variants violated that by pulling toward documentary, log, or report registers. The metaphor is chat; everything inside the thread should reinforce it.
**Concrete next step:** All future variants on this surface MUST start from a chat baseline — bubble-for-user, flat-for-agent, centered narrow column, recognizable compose dock at the bottom. Other lenses get pushed *within* that constraint.

### Reduction & Essence
v4's reduction direction (coalesce tool-call noise) was the closest variant to Designer's actual reference — but it stripped the chat read by inheriting v1-style austere bylines. The reduction itself is good; the metaphor was where it failed.
**Concrete next step:** Bring v4's coalescence pattern forward into cycle 2, but render it inside chat (header line "Used N tools" with caption log entries below, like the live reference's "3 tool calls, 2 messages").

### Hospitality
None of the variants addressed hospitality (T-0006, empty state) — and we now know the surface is a conversation, which raises the hospitality stakes. An empty thread should *welcome*. A returning thread should feel like picking up a conversation, not loading a log.
**Concrete next step:** Cycle 2 should include at least one variant that pushes hospitality hard — empty state, welcome-back moment, time gestures.

## Language deltas surfaced

- **The "manager's cockpit" principle's scope.** It governs the app shell, not the workspace thread interior. Inside the thread, the metaphor is chat. The principle and the metaphor are not in conflict — they live at different altitudes.
  → Update canonical `design-language.md`: clarify principle 1's scope. The thread interior is chat; the surrounding chrome is cockpit.
- **The chat baseline.** Bubble-for-user, flat-for-agent, centered column, scroll pill, coalesced tool-call header — these are now load-bearing patterns of the workspace thread, not stylistic choices.
  → Add a new pattern to `design-language.md`: "Workspace thread is chat. Rendering: filled-bubble user, flat-prose agent, centered narrow column, coalesced tool-call header, scroll-to-bottom pill."

## Mini gaps surfaced

- **Mini's gray scale runs cool.** Designer's canonical language calls for warm sand neutrals; the showcase used Mini's gray default. This was visible but not dispositive — the metaphor problem dwarfed the warmth gap.
  → Log to `core-docs/mini-gaps.md` only as a watch item. If cycle 2 surfaces it more sharply, escalate.
- **No Mini archetype for "speech-bubble container."** The bubble for user messages would be a Mini-level repeating pattern (right-aligned, soft fill, rounded, tight content padding). Currently each variant would re-implement it.
  → Consider after cycle 2: is this a real Mini gap (new archetype: `Bubble`?) or a project-specific composition?

## Top 3

1. **Anchor every cycle-2 variant in the chat baseline.** Filled bubble for user, flat prose for agent, centered narrow column, coalesced tool-call header, scroll-to-bottom pill. Variants push specific lenses *within* that constraint, never *against* it.
2. **Pull v4's coalescence pattern forward.** Render the "Used N tools" header in chat-style caption-log lines, matching Designer's live reference's "3 tool calls, 2 messages" pattern.
3. **Close out T-0003 in `decisions.md`.** Bubble-for-user, flat-for-agent is resolved — write it as D-0001 with the reasoning so future loops don't relitigate it.

## Decisions ready to commit

- **D-0001:** User messages render as filled gray-3 bubbles (right-aligned, ~12px radius, gray-3 fill); agent messages render flat (no bubble, rich prose). Resolves T-0003.
- **D-0002:** The chat metaphor is the load-bearing read of the workspace thread. Variants on this surface push lenses within the chat baseline; never away from it. Subsumes part of principle 1 ("manager's cockpit") at thread-interior altitude.


---
**Distilled:** 2026-05-05 via distill-feedback
**Promoted:** D-0004 (bordered boxes vs rails), LP-0001 (one signal per affordance), LP-0002 (conventional over invented)
