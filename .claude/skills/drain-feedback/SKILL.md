---
name: drain-feedback
description: Drain pending Agentation annotations into a structured per-cycle feedback ledger entry, classify each annotation, surface Mini gaps, then dismiss the annotations from the MCP. Run at the end of every variant-generation cycle so durable signal lands in the project ledger and ephemeral signal doesn't pile up. Pair with distill-feedback (run every 2-3 cycles) for cross-cycle pattern extraction.
# Vendored from byamron/mini-design-system commit e2aa041a05040f913ab4ee98e011ce517561e355 on 2026-05-10. Do not edit in place; upstream changes propagate via re-vendor.
user_invocable: true
---

# Drain Feedback

This skill exists to make sure every annotation the user drops in the showcase gets captured durably, not just acted on in the moment. Without this skill, raw annotations live in the Agentation MCP server's memory only — useful for cycle N+1, useless for cycle N+5. This skill turns ephemeral signal into durable signal.

It is one of two skills in the feedback-capture loop:
- **`drain-feedback`** (this one) — runs every cycle. Mechanical. Captures.
- **`distill-feedback`** — runs every 2–3 cycles or end-of-session. Judgment-heavy. Promotes patterns.

## When to run

Run this skill whenever a critique / variant-iteration cycle ends. Triggers:

- The user says "next cycle" / "let's move on" / "now build…" after a round of annotations.
- The user is about to leave the conversation or start a different task.
- The MCP has accumulated more than ~10 pending annotations.
- A fresh batch of variants is about to be generated (drain the prior cycle's signal first).

If you are about to generate a new round of variants and the prior round's annotations haven't been drained: drain first. Do not skip this. The cost of skipping is silent — the user will not remind you, and the signal will rot.

## Procedure

### 0. Gate — check distillation backlog before doing anything

Run `node tools/feedback-status.mjs` from the repo root. Read the output.

- If verdict is **HEALTHY** or **WARN** → proceed to step 1.
- If verdict is **DUE** → **stop**. Tell the user "feedback-status reports DUE — distillation is overdue (X undistilled cycles for project Y). Running `distill-feedback` first is the default. Say 'override' if these cycles are noise and you want to drain anyway." Then wait for the user's call. The override exists for cases where multiple cycles were tactical fixes only with no recurring patterns; the default is to distill.

This gate is what makes the loop self-policing. Skipping it means draining yet another cycle on top of an already-stale ledger, which is exactly the failure mode the gate exists to prevent.

### 1. Gather feedback from BOTH channels — annotations and conversation

Two equal-rank input sources. A cycle isn't drained until both are captured.

**Channel A — Agentation annotations.** Call `mcp__agentation__agentation_get_all_pending`. Note that the MCP can return duplicates from prior sessions — dedupe by `comment` text, taking the most recent timestamp.

**Channel B — Live conversation feedback.** Re-read the current session's chat transcript and extract every user reaction that maps to a design judgment. The user explicitly stated (2026-05-05) that chat comments must be captured equal to MCP annotations. Common shapes of chat feedback that count as cycle signal:

- Aesthetic reactions ("ugly", "clean", "feels off", "this is solid")
- Comparative judgments ("this is better than c2-d", "I prefer this to the chip")
- Specific corrections ("more padding here", "the labels are redundant")
- Process-meta requests that reveal a craft principle ("don't show two signals at once")
- Hesitations / non-answers that signal a tension ("let me think", "I can't decide", "I don't know about this")
- Cross-references to outside products ("Conductor collapses tool calls well", "make it feel like iMessage")
- Enthusiasm or frustration in tone (positive signals are easy to miss; capture them too)

What does NOT count as cycle signal — skip these:
- Logistics ("restart the server", "send me the link")
- Tool / setup questions ("how does the dev server work?")
- General planning / what-next discussions
- Direction-setting that produced a decision already captured in `decisions.md`

If a reaction is ambiguous, capture it. Better to log a `[principle?]` that gets filtered by the distillation pass than to silently drop something the user said.

**Combined output:** a single deduplicated list of feedback items, each tagged with its source (`source: annotation | chat`). Carry the source through to the ledger entry — it preserves provenance.

If there are zero items from both channels, this skill has nothing to do. Stop.

### 2. Read context

Read these files before classifying — without them the classifications will be off:
- `projects/<name>/language.md`
- `projects/<name>/decisions.md`
- `projects/<name>/tensions.md`
- The most recent 1-2 entries in `projects/<name>/feedback/`
- `core-docs/mini-gaps.md`

### 3. Classify each annotation

Tag each annotation with one of:

- **`[fix]`** — concrete, surface-specific, doesn't generalize. Apply, log briefly, no promotion needed. (Most annotations are this.)
- **`[principle?]`** — has a flavor of generality. Single-cycle ambiguity, multi-cycle signal. The distillation pass watches for repeats.
- **`[mini-gap]`** — Mini's primitives, archetypes, or tokens couldn't cleanly express what the user wanted. Always logged to `core-docs/mini-gaps.md` as well, even on first occurrence.
- **`[contested]`** — annotation that conflicts with a prior decision, or that you disagree with after reading context. Don't drop it; flag it for the user to adjudicate.
- **`[positive]`** — explicitly says something works. These are critical — they tell the loop what to *keep*, not just what to fix. Easy to overlook.

A single annotation can carry more than one tag (e.g. a `[fix]` that surfaces a `[mini-gap]`).

### 4. Write the ledger entry

Append a file at `projects/<name>/feedback/<YYYY-MM-DD>-cycle-<n>-<slug>.md` with this shape:

```markdown
# <YYYY-MM-DD> — cycle <n>: <one-line headline>

**Variants under critique:** <list of variant ids>
**Source of feedback:** annotations + chat | annotations only | chat only
**Items drained:** <n unique, after dedup> (<a> from annotations, <b> from chat)

## What this cycle was probing
<the tension(s) we were testing, in 1-3 sentences>

## Items, by variant or topic

### <variant-id> (or "Sidebar / chrome", "Workflow / process", etc. for non-variant feedback)
- **`[tag]`** *(annotation | chat)* [verbatim or near-verbatim quote]
  - *Interpretation:* <what this means for the loop>
  - *Action:* <fix applied | principle candidate | mini-gap logged | tabled | rejected — with reasoning>

(Repeat per variant or topic. Group related items on the same component.
 Non-variant signal — sidebar chrome, workflow rituals, process meta — gets its own
 section. Don't shoehorn chat feedback into the closest variant if it's actually
 about something else.)

## Principle candidates surfaced this cycle

<bullet list of every `[principle?]` tag — these are watched by the distillation pass. Note the surface and lens each one points at.>

## Mini gaps logged this cycle

<bullet list of every `[mini-gap]` tag, cross-referenced to `core-docs/mini-gaps.md` entry IDs.>

## Top 3 takeaways

1. <change>
2. <change>
3. <change>

## What this leaves unresolved

<short list of open questions still in tension. Cross-reference `tensions.md` IDs.>
```

### 5. Update Mini gaps

For every `[mini-gap]` annotation, append an entry to `core-docs/mini-gaps.md` using its existing format. Use a new `G-XXXX` ID. Cross-reference the feedback entry just written.

### 6. Update the feedback README index

Append the new file to `projects/<name>/feedback/README.md`'s index list. One line: `- [<date> — <headline>](<filename>)`.

### 7. Dismiss the annotations

Use `mcp__agentation__agentation_dismiss` (or `agentation_resolve` for ones that have been fully addressed) to clear the drained annotations from the MCP. Do this in batches — call once per annotation if the API requires it.

If the MCP is unavailable, leave the annotations and report that to the user. Do not drop them silently.

### 8. Report back

In chat, give the user a short summary:
- How many annotations were drained
- Which were promoted to `[principle?]` (these matter most)
- Which were logged as Mini gaps
- The Top 3 takeaways
- Whether anything was left `[contested]` and needs their adjudication

Keep the chat report under ~200 words. The ledger entry is the source of truth; the chat is just orientation.

## Rules of engagement

- **Mechanical, not judgmental.** This skill captures and classifies. It does not promote principles to `language.md` or close out tensions in `decisions.md` — that's the distillation pass's job. Don't over-step.
- **Dedup, but don't suppress.** Annotations with similar wording from the same cycle are duplicates. Annotations with similar wording from *different* cycles are signal that something is recurring — preserve both, and flag the recurrence for the distillation pass.
- **Positive annotations are signal.** The loop fails if it only encodes corrections. Save what works.
- **No content the MCP didn't carry.** Don't invent annotations. If the user said something in chat that maps to a Mini gap or principle, that's still feedback — but capture it under "Source of feedback: live conversation" rather than fabricating Agentation entries.
- **Do not extend Mini reactively.** Logging a Mini gap is the right move; *fixing* Mini's primitives based on a single project's gap is not. The distillation pass and the user decide that, not this skill.
