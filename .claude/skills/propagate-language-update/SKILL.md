---
name: propagate-language-update
description: When a design-language axiom or token value changes, propagate the change across every dependent surface. Use when the user asks to roll out a token change, update every usage of a token, apply a new radius or spacing value project-wide, or sync components to a changed axiom. Brownfield-aware — asks per-component; never silently modifies legacy code.
---

# propagate-language-update

**Purpose:** When `core-docs/design-language.md` changes (especially an axiom), surface everywhere the change must land and apply it with user consent. See plan §8.5. Brownfield rule (§4.5): never silently modify `status: legacy` components.

## When this skill fires

Should fire on:
- "Propagate the new --radius-button across every component."
- "We just changed the density register — update all spacing usages."
- "Roll out the new accent across the codebase."
- "Sync every card to the new elevation-raised shadow."
- "Apply the design language change to existing components."

Should NOT fire on:
- "Build a new component." *(→ generate-ui)*
- "What was this radius before?" *(→ consult pattern-log manually or git log)*
- "Update the design language." *(→ elicit-design-language amendment mode)*

## Procedure

### Step 1 — Read the change

Two inputs:
1. `core-docs/design-language.md` current state.
2. Git diff (or user-provided description) of what changed.

Classify the change:
- **Axiom change** (e.g., density register went tight → balanced): all derived tokens recompute. High-propagation event.
- **Single-token change** (e.g., `--radius-button` 8px → 6px): narrow propagation; only components using that token.
- **New token added**: no propagation; new token is available but nothing existing uses it yet.
- **Token removed**: find every usage and propose replacement.

### Step 2 — Identify affected surfaces

Search for:
- Direct token references in CSS (`var(--<token>)`).
- Indirect references via primitive-set custom properties (e.g., `--mini-box-padding` which resolves to `--space-N`).
- Manifest entries with matching `tokens_referenced` values.

Produce a list of every file that references the changed token. Group by manifest `status`:
- **Managed:** Mini will propose changes.
- **Legacy:** Mini will ask per-component. Default: defer.
- **Excluded:** Mini skips.

### Step 3 — Propose per-surface changes

For each affected file, show the diff: what the current usage looks like, what the proposed change looks like.

For **managed** components: default is "apply". User can reject per-component.
For **legacy** components: default is "defer". User opts in per-component. (Amendment #10.)

If a change is semantically ambiguous (e.g., an axiom change that cascades to a token a component might legitimately override), surface the ambiguity; don't guess.

### Step 4 — Apply

On user approval, write the changes. Update `core-docs/component-manifest.json` `last_updated` for every touched component.

### Step 5 — Update logs

- Append to `core-docs/pattern-log.md`: one entry per significant propagation event, explaining the trigger and scope.
- Append to `core-docs/generation-log.md`: one entry per propagation firing (same schema as other skills; `trigger: propagate-language-update`).

## Outputs

- Modified component files (only on user approval).
- Updated `component-manifest.json` entries.
- `pattern-log.md` entry.
- `generation-log.md` entry.

## Failure modes

- **Diff is ambiguous.** Multiple axioms changed simultaneously. Propagate each separately; ask user to confirm order if they interact.
- **A token value conflict.** Propagation would make a component break an invariant (e.g., new `--space-3` value makes a specific layout overflow). Surface the conflict; ask user to decide (rework component, keep old value, opt out).
- **Legacy components use the changed token.** Never silently update. Always ask; default defer.
- **Component uses token indirectly.** A component references `--mini-box-padding` which was `var(--space-3)`. If the user changes `--space-3`, the component inherits. The propagation may or may not be intended; surface and ask.
