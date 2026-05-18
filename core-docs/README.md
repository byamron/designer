# core-docs

Index for everything in this directory. **Agents should start at `/CLAUDE.md`** (project root) for the operative contract; this file is the browse-mode map for the doc set, organized by *what you're looking for*.

If you only read one doc: `vision.md`.
If you're a new contributor (human or agent): follow the *Read-order paths* below for your role.
If you're updating the doc set: read *Maintenance principles* at the bottom.

---

## Where to look for X — topic index

| Question | Document |
|---|---|
| **What is Designer? Why does it exist?** | `vision.md` |
| **Who are the users?** | `research/personas.md` |
| **Why is this direction the right one (with evidence)?** | `research/rationale.md` |
| **What's fragile in the direction? What might break?** | `research/critique.md` |
| **Who else is in this space? What's the competitive landscape?** | `research/competitive-landscape.md` |
| **What architectural decisions have we made and why?** | `adr/` (numbered ADRs), `spec.md` §Decisions Log |
| **What's the architecture / system design?** | `spec.md` |
| **What does the security model look like?** | `security.md` |
| **What do external systems actually do (vs. what we expected)?** | `integration-notes.md` *(this file wins over spec when they disagree)* |
| **What's being built next? What's the phase plan?** | `plan.md` (near-term), `roadmap.md` (full sequence) |
| **What's deferred and why?** | `parking-lot.md` |
| **What's the roadmap file format / conventions?** | `roadmap-format.md` |
| **How do I work on this project?** | `/CLAUDE.md` *(at repo root)*, `workflow.md` |
| **What's the testing strategy?** | `testing-strategy.md` |
| **What's the design system (Mini)?** | `design-system/design-language.md`, `design-system/component-manifest.json`, `design-system/foundations.md` |
| **Why was a non-obvious design decision made?** | `design-system/pattern-log.md` |
| **What UI has been generated and when?** | `design-system/generation-log.md` |
| **What's the Mini enforcement plan?** | `design-system/mini-enforcement-plan.md` |
| **What's shipped so far?** | `history.md` *(append-only log)* |
| **What direction has the user given recently?** | `feedback.md` |
| **What's the current state of Phase 24 (chat pass-through)?** | `phases/phase-24-pass-through-chat.md`, `phases/chat-ui-audit.md` |
| **How does the taste-loop ritual work?** | `taste/` directory; `/CLAUDE.md` §Taste-loop ritual; `design-system/foundations.md` |

---

## Document categories (full inventory)

### Positioning & strategy

| Doc | Purpose |
|---|---|
| `vision.md` | **Canonical positioning. Read first.** Mission, why-undeniable case, day-in-the-life narrative, what Designer is not. |
| `research/personas.md` | Three concrete user profiles (Maya primary; Jordan and Sam secondary). The user category, in specific terms. |
| `research/rationale.md` | Why the strategic direction is right, with inline citations. The case *for*. |
| `research/critique.md` | What's fragile in the positioning. Risk register with validation tasks. The case *against*. |
| `research/competitive-landscape.md` | Companies and tools in or adjacent to Designer's category. Quarterly-updated watch register. |
| `research/README.md` | Research directory orientation — what's here, how to use it. |

### Architecture & decisions

| Doc | Purpose |
|---|---|
| `spec.md` | Full product specification, architecture, UX model, decisions log. Positioning sections (Vision / Problem / Solution / Strategic Moat) are summaries that point at `vision.md`. |
| `security.md` | Threat model, phased security implementation, plain-language trust statement. |
| `integration-notes.md` | **Observed behavior of external systems** Designer integrates with. *This file wins over `spec.md` when they disagree.* |
| `adr/` | Architectural Decision Records (numbered 0001–0010+). Immutable historical record of decisions and their rationale. |

ADR roll call (with one-line purpose each):

- `adr/0001-claude-runtime-primitive.md` — Claude Code as the runtime (sharpened by ADR 0010).
- `adr/0002-v1-scoping-decisions.md` — frozen-contract additive-only event vocabulary; v1 scoping.
- `adr/0003-artifact-foundation-contract.md` — artifact foundation contract for the workspace thread.
- `adr/0005-orchestrator-signal-shape.md` — orchestrator signal shape.
- `adr/0006-mini-primitives-deferred.md` — Mini primitives deferred for v1.
- `adr/0007-single-claude-subprocess.md` — single Claude subprocess per Phase 23.E.
- `adr/0008-phase-24-event-vocabulary.md` — Phase 24 chat pass-through event vocabulary.
- `adr/0009-trustworthy-shipping.md` — Build/Harden alternation; parking-lot mechanism; golden-path verification.
- `adr/0010-intent-preservation-positioning.md` — **the strategic repositioning** (interface for the human function in AI-built software). Supersedes parts of earlier ADRs; see §6 reversals table.

### Planning & sequencing

| Doc | Purpose |
|---|---|
| `plan.md` | Near-term focus, active work items, handoff notes. **Read at session start.** |
| `roadmap.md` | Full phased sequence (large file — 2700+ lines). |
| `parking-lot.md` | Deferred phases with friction-driven primary triggers + time-based fallbacks per ADR 0009. |
| `roadmap-format.md` | Format / conventions for the roadmap file. |

### Process & how-to-work

| Doc | Purpose |
|---|---|
| `/CLAUDE.md` *(repo root, not in core-docs)* | **The operative contract.** Product principles, agents, How-to-Work items, Quality Bar, Mini procedure, Taste-loop ritual. |
| `workflow.md` | Session-start checklist + build-cycle details + agent table. The *procedural* companion to CLAUDE.md. |
| `testing-strategy.md` | Testing approach across the stack. |

### Design system (Mini)

| Doc | Purpose |
|---|---|
| `design-system/design-language.md` | Tokens + axioms (Mini). Source of truth for visual + interaction. *Referenced by Mini skills at `.claude/skills/`.* |
| `design-system/component-manifest.json` | Catalog of UI components Designer ships. *Referenced by Mini skills + `tools/manifest/check.mjs`.* |
| `design-system/foundations.md` | Established-vocabulary reference (Gestalt, UX laws, Norman, WCAG, motion, cognitive load). Cited during distillation. |
| `design-system/pattern-log.md` | Rationale for non-obvious design-language or component decisions. |
| `design-system/generation-log.md` | Append-only record of Mini skill firings that produced UI. |
| `design-system/mini-enforcement-plan.md` | Mini enforcement strategy and remaining work. |

### History & log

| Doc | Purpose |
|---|---|
| `history.md` | Shipped-work log with why / tradeoffs / decisions per PR. **Large file** (~4000 lines); use as reference, not primary reading. |
| `feedback.md` | User direction and preferences synthesized into rules. **Read at session start.** |

### Phase-specific artifacts (current / recent)

| Doc | Purpose |
|---|---|
| `phases/phase-24-pass-through-chat.md` | Phase 24 spec + acceptance criteria + Appendix C chat-UX research synthesis. |
| `phases/chat-ui-audit.md` | Phase 24 chat-UI audit. |

*These accumulate over time. When a phase is fully shipped and stable, they shift to reference material; the next major doc-set cleanup may consolidate them.*

### Taste loop (vendored from Mini × Taste monorepo)

| Doc | Purpose |
|---|---|
| `taste/feedback/` | Per-cycle feedback ledger entries from the taste-loop ritual. |
| `taste/tensions.md` | Where design principles conflict; require case-by-case judgment. |
| `taste/references/` | Reference materials for taste-loop work. |

See `/CLAUDE.md` §Taste-loop ritual for the operative procedure.

---

## Read-order paths

### Path 1 — New contributor (human or agent), zero prior context

1. `/CLAUDE.md` — the operative contract. Sets expectations.
2. `vision.md` — what the product is and why.
3. `research/personas.md` — who we're solving for.
4. `research/rationale.md` — why this direction is right (with sources).
5. `research/critique.md` — what's fragile and what to validate.
6. `adr/0010-intent-preservation-positioning.md` — the most recent strategic decision; supersedes parts of earlier ADRs.
7. `spec.md` — architecture details.
8. `plan.md` and `roadmap.md` — what's being built now and next.

### Path 2 — Agent picking up a task

1. `plan.md` — current focus and handoff notes.
2. `feedback.md` — recent user direction.
3. The relevant phase doc (e.g. `phases/phase-24-pass-through-chat.md`) if working in that phase.
4. `/CLAUDE.md` §How to Work item 8 — the build cycle.
5. `workflow.md` if any process question is unclear.

### Path 3 — Considering a new feature or surface

1. `research/rationale.md` — is this work consistent with the strategic direction?
2. `research/critique.md` — does this work address an open validation task, or does it advance before one is resolved?
3. Invoke `integrate-or-replicate` skill (`.claude/skills/integrate-or-replicate/`) — does this work overlap with an existing tool we should integrate with rather than build?
4. `parking-lot.md` — is this work already deferred? If so, what's the trigger condition for re-activation?
5. If proceeding: file in `roadmap.md` (or `parking-lot.md`) per ADR 0009 + CLAUDE.md §How to Work item 5.

### Path 4 — Making an architectural decision

1. `spec.md` §Decisions Log — has this been decided before?
2. `adr/` — is there an ADR for the relevant area?
3. `research/critique.md` — does the decision intersect with an open validation task?
4. `integration-notes.md` — what is the observed behavior of any external system involved?
5. If the decision is load-bearing or reverses prior choices: write a new ADR.

### Path 5 — UI generation or modification

Follow `/CLAUDE.md` §Mini Design System procedure. The Mini-related docs (`design-system/design-language.md`, `design-system/component-manifest.json`, `design-system/foundations.md`, `design-system/pattern-log.md`, `design-system/generation-log.md`) are the substrate.

### Path 6 — Taste-loop work

Follow `/CLAUDE.md` §Taste-loop ritual. The taste-loop docs (`taste/`, `design-system/foundations.md`) are the substrate.

---

## Maintenance principles

- **Don't move evergreen files.** Many of these are referenced by Rust code, ADRs, scripts, GitHub workflows. Moves break references silently. Add new files in subdirectories; rename only when absolutely necessary.
- **Don't duplicate.** When information is in two places, one will eventually drift. Prefer single-source-of-truth with cross-references.
- **Keep this index current.** When a new doc is added, list it here. When a doc is renamed, update both this file and `/CLAUDE.md` §Core Documents.
- **Each subdirectory has its own `README.md`** (`research/`, `design-system/`, `phases/`, `taste/`). Those describe internal structure; this file is the cross-directory map.
- **Per ADR 0009 §1.D** the source-of-truth for the current state of any phase is in `plan.md` (active work) or `parking-lot.md` (deferred); the spec sections may lag.
- **CLAUDE.md is the operative contract**; this file is a reference. If the two disagree about how docs should be used, CLAUDE.md wins (and this file gets updated).

---

## When this file gets out of date

This file should be the most up-to-date inventory of `core-docs/`. If you notice an undocumented file or category here, update this index. If you find a category that no longer matches reality, restructure. The cost of an outdated index is silent — agents stop finding docs they need — so treat staleness as a real issue.
