# CLAUDE.md — Designer

## What This Is

Designer is a local-first macOS application that serves as a cockpit for orchestrating AI-managed product work — ideation, specification, design, prototyping, and engineering execution — inside a GitHub-connected codebase. It is a high-level orchestration layer over a user's local installation of Claude Code, not a hosted AI product or an Agent-SDK client.

**Core thesis:** the bottleneck in AI-assisted work is no longer execution but context, coordination, and trust. Designer is the cockpit where a clear thinker with domain expertise — designer, PM, founder, full-stack builder — manages a team of agents without needing to read diffs or understand git internals.

## Tech Stack

- **Platform:** macOS desktop (mobile client planned for phase 2)
- **Shell:** Tauri (Rust core + WebView frontend)
- **Language / UI:** Rust (core), TypeScript + React (frontend), Swift (helper binary for on-device models)
- **Backend:** none hosted — all execution is local; the user's installed Claude Code is invoked as a subprocess
- **Key APIs:** Claude Code CLI (via subprocess), Apple Foundation Models and MLX (via Swift helper), GitHub (for repo and PR workflows)
- **Persistence:** SQLite (app state, WAL mode); project artifacts as `.md` files in the user's repo; event-sourced architecture for mobile-ready sync

## Product Principles

These are filters. A feature that does not serve a principle does not ship.

- **Manager, not engineer.** The primary user is a clear thinker with domain expertise, not a developer. Every surface must feel first-class to that user.
- **Claude Code is the runtime.** We orchestrate; we do not impersonate, replace, or proxy. The user's Claude Code, their auth, their machine.
- **Workflow, opinion, trust.** The moat is above the model. Serve these three and the product gets more valuable as models improve.
- **Context lives in the repo.** Project docs are `.md` files in the codebase. Agents pick them up natively. No DB-shadowed state that drifts from source.
- **Summarize by default, drill on demand.** Too many agents to watch individually; the user's attention is the scarcest resource.
- **Suggest, do not act (by default).** Trust is earned. Autonomy is per-project configurable.
- **Shipped state is trustworthy.** Every shipped surface works end-to-end without seams, stubs, or false affordances. Unfinished features hide entirely (feature flags, not visible stubs) until they're flawless. When we simplify or hide work, we say why in release notes — never silent removals. See `core-docs/adr/0009-trustworthy-shipping.md` for the verification approach.

## Core Documents

All project documentation lives in `core-docs/`. Review and update these as part of your workflow.

| Document | Path | Purpose |
|---|---|---|
| Spec | `core-docs/spec.md` | Full product specification, architecture, UX model, decisions log |
| Roadmap | `core-docs/roadmap.md` | Phased, backend-first sequence from de-risk spike to shippable desktop beta |
| Plan | `core-docs/plan.md` | Near-term focus, active work items, handoff notes |
| History | `core-docs/history.md` | Shipped-work log with why, tradeoffs, and decisions |
| Feedback | `core-docs/feedback.md` | User direction and preferences synthesized into rules |
| Workflow | `core-docs/workflow.md` | How to work with Claude on this project |
| Design Language | `core-docs/design-language.md` | Visual and interaction source of truth — tokens and axioms (Mini) |
| Component Manifest | `core-docs/component-manifest.json` | Catalog of UI components Designer ships |
| Pattern Log | `core-docs/pattern-log.md` | Rationale for non-obvious design-language or component decisions |
| Generation Log | `core-docs/generation-log.md` | Append-only record of Mini skill firings that produced UI |
| Parking Lot | `core-docs/parking-lot.md` | Deferred phases with friction-driven triggers + time fallbacks (per ADR 0009) |

## Agents

Agents live in `.claude/agents/` (not yet populated — scaffolded in Phase 1 per `core-docs/roadmap.md`). Designer's multi-layer architecture uses specific agents for each layer: `rust-core`, `claude-integration`, `swift-helper`, `git-ops`, `local-models`, `safety`, `frontend`, plus `planner` and `docs`. See `core-docs/workflow.md` for when to use each.

## How to Work

1. **Read before writing.** Check `core-docs/plan.md` for current focus and `core-docs/feedback.md` for past direction.
2. **Keep docs and code in sync.** When a decision changes, update the spec and log a feedback entry.
3. **Respect the compliance invariants** in `core-docs/spec.md` §5. Never touch Claude OAuth tokens; never run Claude Code anywhere but the user's machine.
4. **Build / Harden alternation (per ADR 0009).** The active roadmap alternates Build phases (one feature, one track) with Harden phases (no new features — only test coverage, friction closure, design-language enforcement, demo gatekeeping). A Harden phase ships when no critical friction blocks the next Build — a human judgement, not a count of zero. Bug fixes that cross feature boundaries are allowed under friction closure; new feature tracks are not.
5. **Defer, don't delete.** Before adding a phase to the active roadmap, ask: does the current Build cycle already have an open feature? If yes, the new work is the *next* Build, not a parallel track — and only after the Harden phase that follows. Work that isn't load-bearing for the current cycle moves to `core-docs/parking-lot.md` with a friction-driven primary trigger and a time-based fallback. Phases live there until a trigger fires; they do not live in the active roadmap.
6. **Findings: do them or file them, never lose them.** Applies to *any* pass that produces deferrable findings — `/staff-review`, `/security-review`, ad-hoc multi-perspective review, pre-merge spot-checks, informal audits, "I noticed X while doing Y" observations. BLOCKERs and cheap NITs MUST be fixed in the branch before the pass closes. **For FOLLOW-UPs, prefer doing over filing** — if it's small enough to land in the same PR without meaningfully expanding scope, just do it now; deferring trivial work creates a docs entry someone has to come back to for no reason. Only what genuinely doesn't fit the current PR gets filed, and filed FOLLOW-UPs MUST land in `core-docs/roadmap.md` (active section if it gates a current Build/Harden phase) or `core-docs/parking-lot.md` (with a friction-driven primary trigger + time-based fallback per ADR 0009) before the pass closes. **Surfacing findings only in chat or only in the PR body counts as losing them** — closed PR bodies aren't searchable, "Follow-ups" sections rot, chat is gone when the conversation ends. The PR body MAY cross-reference filed entries — it must not be the only home.

## Parallel track conventions

Designer's Phase 13 is built by four parallel agents (13.D / E / F / G). The Phase 13.0 scaffolding PR partitioned the hot-spot files so agents edit sibling modules with zero contention. A few conventions keep the parallelism clean:

- **Stay in your assigned files.** Each 13.X track owns a sibling module pair in `apps/desktop/src-tauri/src/`: `core_agents.rs` + `commands_agents.rs` for 13.D, `core_git.rs` + `commands_git.rs` for 13.E, `core_local.rs` + `commands_local.rs` for 13.F, `core_safety.rs` + `commands_safety.rs` for 13.G. Do **not** edit another track's sibling; do not add new methods to `core.rs` or `commands.rs` directly.
- **Cross-track hooks are `TODO(13.X):`.** When one track needs a future hook from another, leave `// TODO(13.G): replace AutoAcceptSafeTools with InboxPermissionHandler once the inbox lands`. Grep-able, deterministic cleanup at integration time.
- **Shared contracts are frozen.** Event shapes (`designer-core/src/event.rs`), IPC DTOs (`designer-ipc/src/lib.rs`), and the `PermissionHandler` trait (`designer-claude/src/permission.rs`) were locked by 13.0. Don't extend them without touching ADR 0002 or a new ADR.
- **New IPC commands register in `lib.rs`.** The one shared surface that all four tracks touch is `tauri::generate_handler![...]`. Keep entries alphabetical; that minimizes conflict during integration merges.
- **Read ADR 0002** (`core-docs/adr/0002-v1-scoping-decisions.md`) before re-litigating scoping choices. The workspace-lead session model, repo-linking UX, default permission policy, and cost-chip thresholds are all locked for v1.
- **Integration merge order is D → E → G → F.** D lands first (chat with real Claude), E second (tracks + git), G third (swap the permission handler, wire cost chip), F last (local-model surfaces against real events). Each track ships a green `cargo test --workspace` + `cargo clippy --workspace --all-targets -- -D warnings` + `cargo fmt --check` before handoff.

## Quality Bar

Code does not ship unless it meets all five simultaneously:

- **Functional.** Does what it's supposed to; edge cases handled.
- **Safe.** Approval gates enforced in Rust core, not frontend. Sandboxed previews. No unsigned code paths.
- **Performant.** UI stays responsive while many agents stream; <100ms interaction latency; <200MB idle memory on a typical project.
- **Crafted.** Feels intentional. Mini-design-system-compliant. No placeholder UI in shipped builds.
- **Trustworthy.** Demoable end-to-end without seams. Unfinished features hide entirely (feature flags, not visible stubs) until they're ready — never half-baked surfaces shipped behind partial copy. Subtractions are explained in release notes, never silent. Verification mechanism: see `core-docs/adr/0009-trustworthy-shipping.md` §1.D.

<!-- mini:start -->
## Mini Design System

This project uses Mini. UI tasks follow the procedure below. See the **Core Documents** table above for the source-of-truth files (`design-language.md`, `component-manifest.json`, `pattern-log.md`, `generation-log.md`); runtime skills live at `.claude/skills/`.

### Procedure for UI tasks

Before writing or editing UI code:

1. Check `core-docs/component-manifest.json`. Prefer in order: platform-native archetype (Radix on web, native on Swift) → extend an existing component → generate new.
2. Read `core-docs/design-language.md` for tokens and axioms. Reference tokens, never arbitrary values.
3. Compose using core primitives (Box, Stack, Cluster, Sidebar, Center, Container, Frame; Overlay on web only).
4. After generation: verify no arbitrary px / hex / ms / z-index values remain. Run `node tools/invariants/check.mjs <changed files>` if available.
5. For interactive output: verify focus-visible, keyboard path, contrast across accent × mode, `prefers-reduced-motion`, no animate-in-tree anti-pattern.
6. Update `core-docs/component-manifest.json` for new or modified components.
7. Append an entry to `core-docs/generation-log.md` (schema in that file's header).
8. Log non-obvious decisions to `core-docs/pattern-log.md`.

### Skills

Mini's skills live at `.claude/skills/` and fire on matching user intents. Primary entry for UI tasks is `generate-ui`. If a skill doesn't fire when expected, follow the procedure above manually.

### Syncing Mini updates

`./scripts/sync-mini.sh` refreshes Mini's track-closely files (primitives, archetypes, skills, invariants, templates). Fork-and-own files (`packages/ui/styles/tokens.css`, `packages/ui/styles/archetypes.css`) are never touched. The installed version is pinned in `packages/ui/MINI-VERSION.md`.

The sync script needs to know where Mini is checked out. It reads the `Source:` path from `MINI-VERSION.md` by default (currently `/Users/benyamron/Desktop/coding/mini-design-system`). On any other machine or if Mini moves, export `MINI_PATH` before running:

```sh
MINI_PATH=/path/to/mini-design-system ./scripts/sync-mini.sh
```
<!-- mini:end -->

## Taste-loop ritual

Designer runs an iterative taste loop on its surfaces — variant generation, critique, distillation. The infrastructure lives in Designer (vendored from the Mini × Taste monorepo). Cycle work happens in `core-docs/taste/`.

### First action of every session (when working on taste-loop concerns)

```
node tools/feedback-status.mjs core-docs/taste/feedback/
```

Reports HEALTHY / WARN / DUE based on the distillation backlog. React to the verdict:
- **HEALTHY** → proceed.
- **WARN** → note in chat; one cycle from DUE.
- **DUE** → run `distill-feedback` before any other substantive taste-loop work, unless the user explicitly says "override".

This gate doesn't apply when working on Designer's product code (Tauri / Rust / packages/app — those have their own conventions in this CLAUDE.md). It only governs taste-loop work.

### Skills

- `drain-feedback` — capture per-cycle reactions (annotations + chat) into `core-docs/taste/feedback/`. Run at end of every variant-generation cycle.
- `distill-feedback` — cross-cycle pattern extraction; proposes promotions to `core-docs/design-language.md`, `core-docs/spec.md` Decisions Log, `core-docs/taste/tensions.md`. Run every 2–3 cycles, at end of session, or when ≥3 undistilled cycles accumulate.
- `uncommon-care` — generative craft critique through 8 lenses; writes a feedback-ledger entry. Use when pushing a surface from ship-ready to memorable.
- `taste-staff-review` — three-perspective review for taste-loop changes (engineer / design critic / workflow editor). Vendored from the Mini × Taste monorepo as `staff-review`; renamed here to avoid collision with Designer's existing `staff-review` skill (which uses different lenses for Designer product changes — engineer / UX designer / design engineer). Both coexist; use `taste-staff-review` for cycle / feedback / showcase changes and `staff-review` for Designer product code.

### Foundations reference

`core-docs/foundations.md` is the established-vocabulary reference (Gestalt, UX laws, Norman, WCAG, motion, cognitive load). Cite it during distillation; reference it when deviating from a known pattern. It's not a checklist applied uniformly.

### Scope guard — craft vs. product architecture

Most taste-loop output sharpens Designer's `design-language.md`. Sometimes product-architecture decisions surface during craft work (what an artifact *is*, where it lives, its lifecycle). Those go to `spec.md` Decisions Log, not the design-language doc. When a question is product-shape (not visual), capture briefly with a `> **Scope note:**` blockquote and route to the right home.

### Vendored infrastructure

The four taste-loop skills (`drain-feedback`, `distill-feedback`, `uncommon-care`, `taste-staff-review`), `core-docs/foundations.md`, and `tools/feedback-status.mjs` are vendored from `byamron/mini-design-system`. Each vendored SKILL.md carries a YAML-comment provenance line recording the source commit. Do not edit these files in place — upstream changes propagate via re-vendor.

## Subtraction is welcome

Removing or simplifying shipped code is encouraged when it yields cleaner architecture or better UX. Do not treat shipped work as untouchable — propose deletions, consolidations, and undos as readily as additions.
