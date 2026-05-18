# Architecture

*For the cross-directory doc map and read-order paths, see `core-docs/README.md`. This file describes the contents of the `architecture/` directory only.*

This directory holds Designer's **architecture documentation and decision records** — the specifications, security model, observed external-system behavior, and the immutable history of architectural decisions that justify all of them.

## What's here

| File | Purpose |
|---|---|
| `spec.md` | Full product specification, architecture, UX model, decisions log. Positioning sections (Vision / Problem / Solution / Strategic Moat) are summaries that point at `vision.md`. |
| `security.md` | Threat model, phased security implementation, plain-language trust statement. |
| `integration-notes.md` | **Observed behavior of external systems Designer integrates with.** *This file wins over `spec.md` when they disagree* — observed reality beats intended behavior. |
| `adr/` | Architectural Decision Records (numbered 0001–0010+). Immutable historical record of decisions and their rationale. |

## ADR roll call

- `adr/0001-claude-runtime-primitive.md` — Claude Code as the runtime (sharpened by ADR 0010).
- `adr/0002-v1-scoping-decisions.md` — frozen-contract additive-only event vocabulary; v1 scoping.
- `adr/0003-artifact-foundation-contract.md` — artifact foundation contract for the workspace thread.
- `adr/0005-orchestrator-signal-shape.md` — orchestrator signal shape.
- `adr/0006-mini-primitives-deferred.md` — Mini primitives deferred for v1.
- `adr/0007-single-claude-subprocess.md` — single Claude subprocess per Phase 23.E.
- `adr/0008-phase-24-event-vocabulary.md` — Phase 24 chat pass-through event vocabulary.
- `adr/0009-trustworthy-shipping.md` — Build/Harden alternation; parking-lot mechanism; golden-path verification.
- `adr/0010-intent-preservation-positioning.md` — **the strategic repositioning** (interface for the human function in AI-built software). Supersedes parts of earlier ADRs; see §6 reversals table.

## When to consult this directory

- **Before making an architectural decision** — has it been decided before? Look in `adr/` and `spec.md §Decisions Log`. Read `research/critique.md` for open validations that might intersect.
- **When something doesn't behave as expected from an external system** — `integration-notes.md` has observed behavior; if it disagrees with `spec.md`, integration-notes wins.
- **When implementing a phase** — check the relevant ADR for the architectural constraints; check `spec.md` for the implementation contract.
- **When writing a new ADR** — review the immediately-prior ADRs to keep cross-references consistent and to spot reversals.

## Path notes

These files were moved into the `architecture/` subdirectory on 2026-05-16 as part of a top-level cleanup of `core-docs/`. **Cross-references in ~30 files were updated in the same change**, including CLAUDE.md, vision.md, parking-lot.md, workflow.md, research/, Rust source under `apps/desktop/src-tauri/src/` and `crates/designer-claude/src/`, GitHub workflows (`.github/workflows/ci.yml`, `claude-live.yml`, `claude-probe.yml`, `supply-chain.yml`), and `deny.toml`. **If something references a top-level path like `core-docs/spec.md` or `core-docs/adr/0001-…` (without the `architecture/` prefix), it's an unupdated reference — fix it.**

## What's NOT here

- **The positioning** — that's `vision.md` at the top of `core-docs/`.
- **The roadmap** — `core-docs/roadmap.md`.
- **Process / how-to-work** — `core-docs/workflow.md` and `/CLAUDE.md`.
- **Design system docs** — `core-docs/design-system/`.

## Maintenance contract

- **`spec.md`** — update when an architectural decision changes. The Decisions Log inside spec.md is append-mostly (replace entries when superseded; don't delete; reference new ADR if applicable). For load-bearing decisions, write a new ADR and reference it from spec.md.
- **`security.md`** — update as security posture changes; cross-reference spec.md's compliance invariants.
- **`integration-notes.md`** — update whenever real integration testing reveals behavior that differs from documented or expected. **This file is the source of truth for observed external-system behavior.** If you assumed something about how Claude Code / Linear / GitHub / Figma actually behaves and it turned out wrong, that goes here.
- **`adr/`** — ADRs are immutable once written. If a decision changes, write a new ADR that supersedes the old one (don't edit history). Keep numbering sequential.

## How decisions accumulate

Designer uses two related places to record decisions:

1. **`spec.md §Decisions Log`** — a numbered list of decisions with brief rationale. Lightweight. Currently has 60+ entries spanning architectural choices, naming conventions, and product calls.
2. **`adr/`** — full ADRs for load-bearing decisions that need detailed rationale, alternative analysis, and consequences. Numbered sequentially.

Most decisions go in the Decisions Log. ADRs are reserved for decisions that:
- Reverse or supersede a prior architectural commitment.
- Establish a new structural pattern that downstream work depends on.
- Required substantial debate / strategic conversation to settle.
- Need future contributors to understand the *why* in detail, not just the *what*.

ADR 0010 is the most recent strategic ADR and supersedes parts of earlier ones; read it before any positioning-adjacent decision.
