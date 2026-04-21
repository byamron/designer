---
name: elicit-design-language
description: Produce or maintain a Mini design language for this project. Use when the user asks to set up Mini, initialize a design system, elicit or extract design tokens from existing code, update design axioms based on recurring patterns, or propagate a language change. Three modes automatically: greenfield (empty project), archaeology (existing code — default for brownfield), amendment (evolve an existing language based on generation-log signals).
---

# elicit-design-language

**Purpose:** Produce and maintain this project's `core-docs/design-language.md`. The design language is the source of truth for every token and axiom; every other Mini skill reads from it. See plan §8.1.

## Modes

The skill has three modes. It auto-selects based on project state.

| State | Mode | What it does |
|---|---|---|
| No `core-docs/design-language.md` AND no existing UI code | **greenfield** | Structured interview; produces the initial language from user answers. |
| No `core-docs/design-language.md` AND existing UI code | **archaeology** (default for brownfield — plan §4.5) | Scans the codebase, proposes a language, confirms with user. |
| `core-docs/design-language.md` exists | **amendment** | Reads `generation-log.md` for recurring deviations; proposes axiom/token changes. |

If the user wants to force a mode, they can say "run amendment mode explicitly" or similar.

## When this skill fires

Should fire on:
- "set up Mini on this project"
- "initialize the design system"
- "elicit a design language from this codebase"
- "extract tokens from my existing UI"
- "amend the design language based on recent decisions"
- "propose updates to our tokens"
- "reconcile the design language with pattern-log"

Should NOT fire on:
- "generate a new component" (→ `generate-ui`)
- "propagate this token change across the codebase" (→ `propagate-language-update`)
- "audit this for a11y" (→ `audit-a11y`)

See `trigger-examples.md` for the Phase 3 audit record.

## Procedure

### Step 0 — Determine mode

1. Check `core-docs/design-language.md`. Present ? → amendment mode. Absent → step 2.
2. Check project for existing UI (non-empty `src/`, `app/`, `components/`, `styles/`, or `*.tsx`/`*.swift` files outside tests/config). Present → archaeology mode. Absent → greenfield mode.

### Greenfield mode

Run the structured interview. Walk through all 10 design axioms (`core/design-axioms.md`):

1. **Base line-height.** "What's the reading-comfort register for this product? (tight 1.4 / balanced 1.5 / relaxed 1.6–1.7)" Explain the downstream: drives spacing base.
2. **Density register.** "How dense should the UI breathe?" Examples: dashboards = tight, marketing = airy.
3. **Accent identity.** "How many accent colors does this project use? Name each and describe its intent (calm, energetic, grounding, etc.)."
4. **Gray flavor.** "Which neutral temperature? (slate — cool default, mauve — warm, sand — very warm editorial)"
5. **Motion personality.** "Snappy (tools/dashboards), weighted (editorial), or spring (expressive product)?"
6. **Type system.** "Which font families? Sans only, sans+serif, or sans+mono?"
7. **Type scale ratio.** "How dramatic is the type hierarchy? (minor third 1.2, perfect fourth 1.333, golden 1.618)"
8. **Surface hierarchy depth.** "How many shadow/elevation tiers? (flat 1, flat+raised 2, +overlay 3, +modal 4)"
9. **Radius personality.** "Sharp (2–4px), soft (6–8px default), or pillowy (12–16px)?"
10. **Focus style.** "Ring-outside (default, most accessible), ring-inside, or highlight?"

After every answer, compute derived tokens and show the cascade so the user sees the implications. On completion, write the result to `core-docs/design-language.md` using `templates/design-language.md`.

### Archaeology mode

Run the scan from the thin Phase-2 procedure (below) and produce the proposal. Differences from Phase 2 version:

- Seed `core-docs/component-manifest.json` from the component inventory (each with `status: legacy` per amendment #10).
- Seed `core-docs/pattern-log.md` and `core-docs/generation-log.md` as empty-but-valid files.
- Write CLAUDE.md per plan §13.5 (marker-delimited append).

**Scan details:**

Walk the project's source. Catalog:

- **Colors:** every hex, `rgb`, `hsl`, `var(--...)`, Tailwind color class. Cluster into accent candidates (by visual similarity) + gray + semantic.
- **Spacing:** every px/rem used for padding/margin/gap. Bucket into ~8 steps.
- **Type:** font-family declarations, font-size values. Map to role usage.
- **Radius:** every border-radius. Map to role tokens.
- **Motion:** transition-duration, animation-duration, easing functions. Identify personality.
- **Elevation:** every box-shadow. Count distinct shadows → surface hierarchy depth.
- **Components:** every `*.tsx`, `*.swift` (excluding tests, config). Note purpose + archetype usage + likely `status` (managed/legacy).

Produce the proposal. Mark any ambiguous axiom as `[NEEDS CONFIRMATION]` with evidence. Confirm with user before writing.

### Amendment mode

Triggered when `core-docs/design-language.md` exists. Input: `core-docs/generation-log.md` + `core-docs/pattern-log.md`.

1. **Read the log.** Parse the last N entries (default: all entries since the last change-log entry in `design-language.md`).
2. **Cluster deviations.** Group recurring deviations by kind:
   - Recurring color literal → candidate new color token.
   - Recurring spacing literal → candidate new spacing step or adjust density register.
   - Recurring radius literal → candidate radius adjustment.
   - Etc. Map each cluster to the axiom it implicates (per `core/design-axioms.md`).
3. **Cluster rejections.** If the log shows repeated `feedback: rejected` on the same component type, this is a taste signal worth surfacing — user may want to amend the relevant axiom.
4. **Propose amendments.** Present cluster → proposed axiom/token change → evidence (log entries).
5. **Apply with consent.** On approval, edit `core-docs/design-language.md`, bump the change log, and suggest running `propagate-language-update` if any derived tokens changed.
6. **Do not automatically propagate.** That's a separate skill (plan §8.5). Emit the next step, don't run it.

## CLAUDE.md integration (plan §13.5)

In greenfield and archaeology modes, this skill owns writing the CLAUDE.md Mini section. The template is `templates/claude-md-mini-section.md`.

Integration algorithm:
1. Read existing CLAUDE.md (if any).
2. If markers present → ask whether to rewrite (default: leave alone).
3. If markers absent, scan for contradictions with Mini procedure (examples in §13.5). Report each; resolve with user.
4. Append the Mini section with markers. Never modify content outside the markers.

## Outputs

- `core-docs/design-language.md` — new (greenfield/archaeology) or amended (amendment mode).
- `core-docs/component-manifest.json` — seeded in archaeology mode; unchanged in other modes.
- `core-docs/pattern-log.md` — seeded on first run.
- `core-docs/generation-log.md` — seeded on first run.
- `CLAUDE.md` — appended with Mini section in greenfield/archaeology modes.

## Failure modes

- **Mode ambiguity.** Existing `design-language.md` + no generation-log = amendment mode has nothing to read. Tell user: "design-language exists but generation-log is empty. No signals to amend. Run `generate-ui` on real work first; re-invoke me once there's log data."
- **Archaeology scan produces multiple coherent candidate languages.** E.g., two distinct visual systems coexist in the codebase. Surface both; ask user which to formalize (or whether this is a signal to split).
- **Existing CLAUDE.md rules contradict Mini procedure.** Do not silently overwrite. Surface contradictions; ask user per-item.
- **User rejects most of archaeology proposal.** Offer to fall back to greenfield interview mode.
