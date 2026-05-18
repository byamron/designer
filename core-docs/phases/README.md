# Phase-specific artifacts

*For the cross-directory doc map and read-order paths, see `core-docs/README.md`. This file describes the contents of the `phases/` directory only.*

This directory holds **phase-specific documentation** — specs, audits, and other artifacts produced during the implementation of a specific roadmap phase. When a phase ships and is no longer active, its artifacts shift from "active reference" to "historical record" but stay here for traceability.

## What's here

| File | Phase | Purpose |
|---|---|---|
| `phase-24-pass-through-chat.md` | Phase 24 | Phase 24 spec + acceptance criteria + Appendix C chat-UX research synthesis. |
| `chat-ui-audit.md` | Phase 24 | Phase 24 chat-UI audit. |

## When to consult this directory

- **When working on a specific phase** — pull the relevant phase doc as the spec for the implementation.
- **When making changes to a previously-shipped phase** — the phase doc captures the spec at ship time; check it before assuming current behavior matches original intent.
- **When investigating a regression in a phase's behavior** — the phase doc is the original contract.

## Naming convention

Phase docs are named `phase-<NN>-<descriptive-slug>.md`. Audits and other phase-scoped artifacts are named with a clear phase association in the body even if the filename is more descriptive (e.g. `chat-ui-audit.md` is Phase 24-scoped).

When adding a new phase artifact, prefer the `phase-<NN>-` prefix so directory listing sorts chronologically.

## When to remove or consolidate

Phase artifacts accumulate over time. Periodically (e.g. annually, or before a major release):
- **Consolidate** phase docs that share scope into a single retrospective if the individual docs are no longer load-bearing.
- **Archive** to an `archive/` sub-subdir if a phase is fully sunset and its docs are unlikely to be referenced again.
- **Never delete.** Even sunset phases may need to be referenced for context on later decisions.

## Path notes

These files were moved into the `phases/` subdirectory on 2026-05-16 as part of a top-level cleanup of `core-docs/`. The following surfaces were updated to use the new paths: CLAUDE.md, the staff-review skill, the relevant ADRs, the roadmap, the plan, history, and Rust code in `apps/desktop/src-tauri/src/settings.rs` and `crates/designer-claude/src/stream.rs`. If something still references a bare path like `core-docs/phase-24-pass-through-chat.md` (without `phases/`), it's an unupdated reference — fix it.
