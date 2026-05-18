# Research

*For the cross-directory doc map and read-order paths, see `core-docs/README.md`. This file describes the contents of the `research/` directory only.*

This directory holds the **evidence base, user research, and risk register** that underlies Designer's strategic positioning (`core-docs/vision.md`) and the decision recorded in `core-docs/architecture/adr/0010-intent-preservation-positioning.md`. It is **upstream-of-positioning**, not a restatement.

The vision and ADR are the *what* and the *why*; this directory is the *evidence* (what we observed in the field that makes the why credible), the *users* (who we're solving for, in specific terms), and the *open questions* (what we don't yet know that could change the answer).

## What's here

| File | Purpose |
|---|---|
| `personas.md` | Three concrete user profiles (Maya primary; Jordan, Sam secondary). The user category, in specific terms. *Note: validation status is open — see `critique.md §1.1`.* |
| `rationale.md` | Why the strategic direction is right. Each claim cited inline to its source. Use when you want to *defend*, *understand*, or *teach* the positioning. |
| `critique.md` | What's fragile in the positioning. Risk register, validation tasks, counter-arguments. Use when you want to *stress-test* or *audit* the positioning before committing to architecture. |
| `competitive-landscape.md` | Ongoing-watch register of companies and tools in or adjacent to Designer's category. Update quarterly. |

## What's planned but not yet here

The user-research artifacts evolve as a sequence. Personas was the first; subsequent methods produce additional files in this directory:

| # | Method | Future file | Purpose |
|---|---|---|---|
| 1 | Personas | `personas.md` ✓ | Concrete user profiles |
| 2 | Jobs to be done | `jtbd.md` | Underlying jobs each persona is hiring Designer to do |
| 3 | Day-in-the-life journey | `journey-day.md` | High-fidelity walkthrough for the primary persona |
| 4 | Feature-iteration journey | `journey-feature.md` | One feature traced idea → ship across multiple sessions |
| 5 | Service blueprint | `blueprint.md` | Cross-tool flow for 1–2 key jobs |
| 6 | Comparison: ideal vs. existing | `comparison.md` | Per major job, ideal flow vs. existing-primitives flow. The synthesis artifact for the architecture decision. |

Each method builds on the prior; we can pause between for review and refinement.

## When to consult this directory

- **Before adding a phase to the roadmap** — does the rationale support this work? Does the critique flag a risk that should be validated first? Do the personas show this is for our users?
- **When a strategic conversation runs in circles** — point at the relevant doc as the captured state of the thinking, not the chat that produced it.
- **When someone (human or agent) joins the project mid-flight** — start them on `vision.md` for the positioning, then `personas.md` to know who we're for, then `rationale.md` and `critique.md` for the why-and-risks.
- **When new external research, competitor news, or user signal lands** — update the relevant doc here so the evidence base stays current.

## How research feeds into product decisions

These artifacts feed the **`integrate-or-replicate`** skill (`.claude/skills/integrate-or-replicate/SKILL.md`), which fires whenever a new Designer feature, surface, or integration is proposed. The skill consumes:

- `personas.md` for the user-stack inventory (which tools each persona uses).
- `rationale.md` and `critique.md` for whether the proposed work aligns with the validated direction or advances ahead of an unresolved validation.
- `competitive-landscape.md` for which existing tools the proposal might overlap with.

It produces an *integrate / hosted-light / hosted / displacement* recommendation per ADR 0010 §3.10's principle. This is the workflow mechanism that turns the research work into actual decisions — see CLAUDE.md §How to Work item 9.

## How it relates to other core-docs

```
core-docs/vision.md ............ The positioning (the what + why)
core-docs/architecture/adr/0010-... ......... The decision record (frozen at decision time)
core-docs/research/ ............ This directory: evidence + users + risks underneath
core-docs/architecture/spec.md .............. Architecture (downstream of positioning)
core-docs/roadmap.md ........... Sequencing (downstream of architecture)
```

Read order for a new contributor: `vision.md` → `research/personas.md` → `research/rationale.md` → `research/critique.md` → `adr/0010-…` → `spec.md` → `roadmap.md`.

## What's NOT here

- **The positioning itself** — that's `vision.md`.
- **The decision record** — that's `adr/0010-…`.
- **The roadmap** — that's `roadmap.md`.
- **The doctrine for how to work on the project** — that's `CLAUDE.md`.

These docs reference each other heavily; this directory is the *evidence and users layer* underneath.

## Maintenance contract

- **`personas.md`** changes when (a) validation conversations reveal a persona was wrong, (b) a new persona emerges from real use, (c) an existing persona's tool stack or pain shape shifts significantly. Add new personas only after they show up in real conversations, not as speculation.
- **`rationale.md`** changes when the underlying claims change. Update inline citations when newer or better sources land. Add new arguments only after they've been tested in conversation. Remove arguments that prove fragile (move to `critique.md`).
- **`critique.md`** changes constantly. New risks get added; resolved risks get marked closed with the resolving evidence. Open validations get crossed off as they're done. This is a *living* risk register.
- **`competitive-landscape.md`** — quarterly review at minimum. Add newly-discovered competitors, integration targets, adjacent tools. Flag positioning changes from existing tracked tools.
- **Future method files** (jtbd.md, journeys, etc.) — added as the work happens; each gets its own maintenance contract documented in its header.

## What this is not

- **Not formal user research.** Personas are dogfood-informed and theoretically extended, not interview-derived. The primary persona mirrors the project lead's own usage pattern; secondary personas are theoretical extensions of the user category. If the product gets to a point where formal research is justified, these artifacts become the starting hypotheses to test.
- **Not positioning.** Positioning lives in `vision.md`. Research is upstream of positioning; it sharpens positioning by being specific about who/what.
- **Not feature specifications.** Those derive from this work but live in `roadmap.md` and `spec.md`.
- **Not exhaustive.** Each method captures what's needed for current decisions, not everything.

## Origin

Created 2026-05-16 after a multi-turn strategic conversation produced (a) a positioning thesis with multiple framings, (b) a serious critique of the fragile assumptions, and (c) the first user personas to ground the positioning. The user asked for this to be captured comprehensively and presented in a way that's easy to reference. **Originally split into `discovery/` (personas) and `research/` (rationale, critique, landscape); merged into a single `research/` directory the same day** when the distinction proved weak in practice and cross-references between the two were constant.
