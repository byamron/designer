# Design system (Mini)

*For the cross-directory doc map and read-order paths, see `core-docs/README.md`. This file describes the contents of the `design-system/` directory only.*

This directory holds Designer's **Mini design system** — the source-of-truth files for tokens, components, axioms, and the rationale behind design decisions.

## What's here

| File | Purpose |
|---|---|
| `design-language.md` | Tokens + axioms (Mini). Visual and interaction source of truth. *Referenced by Mini skills at `.claude/skills/`.* |
| `component-manifest.json` | Catalog of UI components Designer ships. *Referenced by Mini skills + `tools/manifest/check.mjs`.* |
| `foundations.md` | Established-vocabulary reference (Gestalt, UX laws, Norman, WCAG, motion, cognitive load). Cited during distillation. |
| `pattern-log.md` | Rationale for non-obvious design-language or component decisions. *(Why we did X this specific way.)* |
| `generation-log.md` | Append-only record of Mini skill firings that produced UI. *(History of what was generated and when.)* |
| `mini-enforcement-plan.md` | Mini enforcement strategy and remaining work. |

## When to consult this directory

- **Before writing or editing UI code** — see `/CLAUDE.md` §Mini Design System for the full procedure. The skill `generate-ui` is the primary entry point.
- **When reviewing design decisions** — `pattern-log.md` carries the *why* behind non-obvious choices.
- **When evaluating tokens or axioms** — `design-language.md` is the source of truth; do not introduce arbitrary values.
- **When citing design principles in feedback or critique** — `foundations.md` is the shared vocabulary.

## Path notes

These files were moved into the `design-system/` subdirectory on 2026-05-16 as part of a top-level cleanup of `core-docs/`. **All Mini skills, the `tools/manifest/check.mjs` script, and the ADRs that reference these paths were updated in the same change.** If something references a bare path like `core-docs/design-language.md` (without `design-system/`), it's an unupdated reference — fix it.

## What's NOT here

- **How to work with the design system** — that's `/CLAUDE.md` §Mini Design System.
- **The Mini skills themselves** — those live in `.claude/skills/` (audit-a11y, check-component-reuse, enforce-tokens, generate-ui, elicit-design-language, propagate-language-update).
- **The taste-loop ritual** — that has its own directory at `core-docs/taste/`, with its own README. Some files reference foundations.md (which is here); that cross-reference is intentional.

## Maintenance contract

- **`design-language.md`** — sync from upstream Mini periodically (see `packages/ui/MINI-VERSION.md` for the pin); apply local amendments via `propagate-language-update` skill.
- **`component-manifest.json`** — updated by `generate-ui` when a new component is added or modified. Also enforced by `tools/manifest/check.mjs`.
- **`generation-log.md`** — append-only. Every UI generation should add an entry.
- **`pattern-log.md`** — append when a non-obvious decision is made. Don't delete entries; supersede.
- **`mini-enforcement-plan.md`** — update when the enforcement plan shifts. Drop it (or move to history) when enforcement is complete.
