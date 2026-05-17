# CLAUDE.md — Designer

## What This Is

> **Designer is the judgment layer for software built by agents.**

Designer is the interface for the human function in AI-built software — the cockpit where humans hold the line on taste as more of the software-creation pipeline gets automated. It is a local-first macOS application that sits above the user's existing AI-build tools (Cursor, Claude Code, Codex, Lovable, v0, Figma Make for generation; Figma, Linear, GitHub, Notion for design and tracking; Agentation, Inflight, Variant for critique and curation; OpenClaw and other personal agents for cross-tool automation), routes judgment moments from across those tools into a single inbox, hosts the act of giving taste inside an item viewer frame that embeds the right best-in-class tool per moment, and codifies the user's judgment into living documentation that propagates back to every connected agent runtime.

**Core thesis:** as AI automates building, the human function shifts from execution to taste and judgment. The interface for that function is structurally inevitable — every wave of automation produces one (word processors for writing, spreadsheets for calculating, IDEs for programming, design tools for designing). Designer is the next entry in that lineage. The moat is the cockpit-grade interaction pattern, not the backend automation; a competent builder could replicate the codification engine with OpenClaw plus APIs, but the cockpit-grade surface for *giving taste in a system* is what is hard to retrofit.

**Canonical positioning lives in `core-docs/vision.md`** (mission, the why-this-is-undeniable case, day-in-the-life narrative, what Designer is not, six-surfaces vs. embedded-tools disposition). The strategic decision behind this positioning is `core-docs/architecture/adr/0010-intent-preservation-positioning.md`. Earlier framings (orchestration cockpit, Claude-Code-as-the-runtime-as-structural-anchor) are superseded by ADR 0010 and the v1 narrowing in its §3.10.

## Tech Stack

- **Platform:** macOS desktop (mobile client planned for phase 2)
- **Shell:** Tauri (Rust core + WebView frontend)
- **Language / UI:** Rust (core), TypeScript + React (frontend), Swift (helper binary for on-device models)
- **Backend:** none hosted — all execution is local; the user's installed Claude Code is invoked as a subprocess
- **Key APIs:** Claude Code CLI (via subprocess), Apple Foundation Models and MLX (via Swift helper), GitHub (for repo and PR workflows)
- **Persistence:** SQLite (app state, WAL mode); project artifacts as `.md` files in the user's repo; event-sourced architecture for mobile-ready sync

## Product Principles

These are filters. A feature that does not serve a principle does not ship.

- **Intent-holder, not orchestrator.** The primary user is a clear thinker with domain expertise (designer, founder, PM, full-stack builder with taste) whose value to the product is *knowing what good looks like and ensuring shipped work reflects it.* Every surface serves the give-taste verb cluster (variant curation, critique, decision, codification), not the manage-agents one. Every surface must feel first-class to that user. Earlier framing was "manager, not engineer" — same user, sharpened from *who they are* to *what they do.* (ADR 0010 §2.)
- **The user's chosen runtime is the runtime.** Designer integrates with the user's agent runtimes — Claude Code, Cursor, Codex, others — as source adapters (router-mode v1) and can drive the user's local Claude Code as one runtime among many (hybrid-mode, post-v1). We never impersonate, replace, or proxy any of them. Auth and execution stay with the runtime; Designer is the layer above. Earlier framing was "Claude Code is the runtime" — broadened to acknowledge that v1 ingests from many runtimes rather than driving one. (ADR 0010 §4.)
- **Workflow, opinion, trust.** The moat is above the model. Serve these three and the product gets more valuable as models improve.
- **Context lives in the repo.** Project docs are `.md` files in the codebase. Agents pick them up natively. No DB-shadowed state that drifts from source.
- **Summarize by default, drill on demand.** Too many agents to watch individually; the user's attention is the scarcest resource.
- **Suggest, do not act (by default).** Trust is earned. Autonomy is per-project configurable.
- **Shipped state is trustworthy.** Every shipped surface works end-to-end without seams, stubs, or false affordances. Unfinished features hide entirely (feature flags, not visible stubs) until they're flawless. When we simplify or hide work, we say why in release notes — never silent removals. See `core-docs/architecture/adr/0009-trustworthy-shipping.md` for the verification approach.

## Core Documents

All project documentation lives in `core-docs/`. **For the full doc inventory + topic index + read-order paths, see `core-docs/README.md`.** The table below is the categorized agent-facing summary; use it to locate the right doc for the current task.

### Positioning & strategy *(start here for "what is this and why")*

| Document | Path | Purpose |
|---|---|---|
| **Vision** | `core-docs/vision.md` | **Canonical positioning. Read first.** Mission, why-undeniable case, day-in-the-life narrative, what Designer is not. |
| Personas | `core-docs/research/personas.md` | Three concrete user profiles (Maya primary; Jordan, Sam secondary) with cross-persona observations. |
| Rationale | `core-docs/research/rationale.md` | Why this direction is right, with inline citations to external research. |
| Critique | `core-docs/research/critique.md` | What's fragile in the positioning; risk register with validation tasks. **Read before any architectural decision.** |
| Competitive landscape | `core-docs/research/competitive-landscape.md` | Companies/tools in or adjacent to Designer's category. Quarterly-updated watch register. |

### Architecture & decisions *(how it's built, what's been decided)*

| Document | Path | Purpose |
|---|---|---|
| Spec | `core-docs/architecture/spec.md` | Full product specification, architecture, UX model, decisions log. Positioning sections are summaries; canonical is `vision.md`. |
| ADRs | `core-docs/architecture/adr/` | Architectural Decision Records (numbered 0001–0010). Immutable historical record. **0010 is the most recent strategic ADR and supersedes parts of earlier ones.** |
| Security | `core-docs/architecture/security.md` | Threat model, phased security implementation, plain-language trust statement. |
| Integration Notes | `core-docs/architecture/integration-notes.md` | **Observed behavior of external systems Designer integrates with.** *This file wins over `spec.md` when they disagree.* |

### Planning & sequencing *(what's next, what's deferred)*

| Document | Path | Purpose |
|---|---|---|
| Plan | `core-docs/plan.md` | Near-term focus, active work items, handoff notes. **Read at session start.** |
| Roadmap | `core-docs/roadmap.md` | Full phased sequence (large; 2700+ lines). |
| Parking Lot | `core-docs/parking-lot.md` | Deferred phases with friction-driven triggers + time fallbacks (per ADR 0009). |
| Roadmap Format | `core-docs/roadmap-format.md` | Format/conventions for the roadmap file. |

### Process & how-to-work

| Document | Path | Purpose |
|---|---|---|
| Workflow | `core-docs/workflow.md` | Session-start checklist + build-cycle details + agent table. The *procedural* companion to this file. |
| Testing Strategy | `core-docs/testing-strategy.md` | Testing approach across the stack. |

### Design system (Mini)

| Document | Path | Purpose |
|---|---|---|
| Design Language | `core-docs/design-system/design-language.md` | Visual and interaction source of truth — tokens and axioms. *Referenced by Mini skills via known paths.* |
| Component Manifest | `core-docs/design-system/component-manifest.json` | Catalog of UI components Designer ships. *Referenced by Mini skills.* |
| Foundations | `core-docs/design-system/foundations.md` | Established-vocabulary reference (Gestalt, UX laws, WCAG, motion, cognitive load). Cited during distillation. |
| Pattern Log | `core-docs/design-system/pattern-log.md` | Rationale for non-obvious design-language or component decisions. |
| Generation Log | `core-docs/design-system/generation-log.md` | Append-only record of Mini skill firings that produced UI. |
| Mini Enforcement | `core-docs/design-system/mini-enforcement-plan.md` | Mini enforcement strategy and remaining work. |

### History & log

| Document | Path | Purpose |
|---|---|---|
| History | `core-docs/history.md` | Shipped-work log per PR. **Large file** (~4000 lines); use as reference, not primary reading. |
| Feedback | `core-docs/feedback.md` | User direction and preferences synthesized into rules. **Read at session start.** |

### Phase-specific artifacts *(current or recently shipped)*

| Document | Path | Purpose |
|---|---|---|
| Phase 24 spec | `core-docs/phases/phase-24-pass-through-chat.md` | Phase 24 spec + acceptance criteria + Appendix C chat-UX research synthesis. |
| Chat UI audit | `core-docs/phases/chat-ui-audit.md` | Phase 24 chat-UI audit. |

### Taste loop *(vendored)*

| Path | Purpose |
|---|---|
| `core-docs/taste/` | Per-cycle feedback ledger, tensions doc, references. See §Taste-loop ritual below for the operative procedure. |

## Agents

Agents live in `.claude/agents/` (not yet populated — scaffolded in Phase 1 per `core-docs/roadmap.md`). Designer's multi-layer architecture uses specific agents for each layer: `rust-core`, `claude-integration`, `swift-helper`, `git-ops`, `local-models`, `safety`, `frontend`, plus `planner` and `docs`. See `core-docs/workflow.md` for when to use each.

## How to Work

1. **Read before writing.** For *current focus + recent user direction*, read `core-docs/plan.md` and `core-docs/feedback.md` at session start. For *what the project is and why*, read `core-docs/vision.md` (especially first time in the project). For *who we're solving for*, see `core-docs/research/personas.md`. For *what's risky or unvalidated about the direction*, see `core-docs/research/critique.md` — particularly before any architectural decision. The full doc map and read-order paths are in `core-docs/README.md`.
2. **Keep docs and code in sync.** When a decision changes, update the spec and log a feedback entry.
3. **Respect the compliance invariants** in `core-docs/architecture/spec.md` §5. Never touch Claude OAuth tokens; never run Claude Code anywhere but the user's machine.
4. **Build / Harden alternation (per ADR 0009).** The active roadmap alternates Build phases (one feature, one track) with Harden phases (no new features — only test coverage, friction closure, design-language enforcement, demo gatekeeping). A Harden phase ships when no critical friction blocks the next Build — a human judgement, not a count of zero. Bug fixes that cross feature boundaries are allowed under friction closure; new feature tracks are not. **Release tag at every phase close** (Build or Harden), per ADR 0009 §1.E (2026-05-12 amendment). Build-phase tags ship the new behavior into dogfood as soon as the feature flag default flips ON and contract-level acceptance tests pass; Harden-phase tags ship the polished state with filed FOLLOW-UPs closed. Version numbers increment per release (e.g., Phase 24 Build → v0.1.2; Phase 24H Harden → v0.1.3).
5. **Defer, don't delete.** Before adding a phase to the active roadmap, ask: does the current Build cycle already have an open feature? If yes, the new work is the *next* Build, not a parallel track — and only after the Harden phase that follows. Work that isn't load-bearing for the current cycle moves to `core-docs/parking-lot.md` with a friction-driven primary trigger and a time-based fallback. Phases live there until a trigger fires; they do not live in the active roadmap.
6. **Findings: do them or file them, never lose them.** Applies to *any* pass that produces deferrable findings — `/staff-review`, `/security-review`, ad-hoc multi-perspective review, pre-merge spot-checks, informal audits, "I noticed X while doing Y" observations. BLOCKERs and cheap NITs MUST be fixed in the branch before the pass closes. **For FOLLOW-UPs, prefer doing over filing** — if it's small enough to land in the same PR without meaningfully expanding scope, just do it now; deferring trivial work creates a docs entry someone has to come back to for no reason. Only what genuinely doesn't fit the current PR gets filed, and filed FOLLOW-UPs MUST land in `core-docs/roadmap.md` (active section if it gates a current Build/Harden phase) or `core-docs/parking-lot.md` (with a friction-driven primary trigger + time-based fallback per ADR 0009) before the pass closes. **Surfacing findings only in chat or only in the PR body counts as losing them** — closed PR bodies aren't searchable, "Follow-ups" sections rot, chat is gone when the conversation ends. The PR body MAY cross-reference filed entries — it must not be the only home.
7. **Workflow infrastructure is living. Update it proactively.** When a new failure pattern surfaces, add a memory entry + a preflight check. When a step in the workflow is friction without value, prune it. When a `/staff-review` finding could have been caught by a sharper skill prompt, sharpen the prompt. When a CLAUDE.md rule no longer matches how the work actually flows, edit the rule. The surfaces in scope: CLAUDE.md, the skills under `.claude/skills/`, `core-docs/workflow.md`, `tools/preflight/check.mjs`, and the failure-pattern memory entries (`~/.claude/projects/.../memory/feedback_*.md`). **The cost of evolving the framework is one PR; the cost of running on a stale framework is every PR after.** Treat infrastructure changes with the same rigor as feature work (same `/staff-review`, same item-6 filing, same merge bar), but don't hesitate to propose them. The highest-quality bar is the one that's actively maintained.

8. **Build cycle: plan → implement → self-review → staff-review → merge.** A bulletproof PR follows this sequence:
   1. **Plan.** Read the relevant spec section (`core-docs/architecture/spec.md`, `core-docs/phases/<phase>.md`, an ADR in `core-docs/architecture/adr/`, or a roadmap sub-bullet). List every numbered/bulleted requirement as a checkbox you'll verify against code at the end. Test-first: for every "must X" / "shall Y" requirement, decide what test pins it.
   2. **Implement.** Write code + tests for each checkbox. When in doubt, walk back to the spec — don't implement from memory.
   3. **Self-review.** BEFORE invoking `/staff-review`, run `node tools/preflight/check.mjs` (catches undefined CSS tokens, orphan PR-body follow-ups, false PR-body claims) plus the standard quality gates (`cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `npm typecheck`, `npm test`, `node tools/manifest/check.mjs`, `node tools/invariants/check.mjs packages/app/src`). All must pass. Then walk the spec section line-by-line against the code; check every box. If a requirement is missing, decide: implement now or file per item 6.
   4. **Staff-review.** Invoke `/staff-review` only when self-review is clean. The skill's Step 0 verifies preflight + spec-walk are done; agents focus on subtler issues, not the obvious ones.
   5. **Merge.** Only after staff-review concludes the PR is ready and all gates are green. Per ADR 0009, every release tag also ships a checked-in golden-path screencast bound to a Playwright test.

   See `.claude/skills/staff-review/SKILL.md` for the staff-review steps in detail and `tools/preflight/check.mjs` for the preflight script. Failure patterns surfaced during recent cycles are saved as user-memory feedback entries (`feedback_verify_tokens.md`, `feedback_aria_live_for_spec_announcements.md`, `feedback_doc_orphans_after_merge.md`); add a new entry whenever a new pattern surfaces so the next cycle catches it earlier.

9. **Integrate, don't replicate.** Before any new Designer surface, integration adapter, or product capability is added to the roadmap *or* planned in a PR, invoke `integrate-or-replicate` (`.claude/skills/integrate-or-replicate/SKILL.md`). The skill applies ADR 0010 §3.10's principle: **Designer hosts only what no existing tool does well; everything else integrates rather than replicates.** It produces an explicit recommendation — *integrate (passthrough)*, *integrate (embed)*, *hosted-light*, *hosted (full)*, or *displacement bid* — with evidence (which tools were considered, where they fall short, where Designer's leverage comes from). The recommendation is recorded in the ADR / spec / roadmap entry that proposed the capability. **Displacement bids require a dedicated ADR** and are rare; the default for ambiguous cases is *the more integrated option*, not *build it in Designer*. This is the workflow enforcement of the *don't ship a worse version of an existing tool* principle from the new positioning (`core-docs/vision.md` §2.5). Two natural firing points: (a) at roadmap-planning time, before any phase or arc is added (interacts with item 5 — *Defer, don't delete*); (b) at PR-planning time, before requirements are written in item 8.1. The skill is diagnostic, not implementation — it produces a recommendation, not code.

## Parallel track conventions

Designer's Phase 13 is built by four parallel agents (13.D / E / F / G). The Phase 13.0 scaffolding PR partitioned the hot-spot files so agents edit sibling modules with zero contention. A few conventions keep the parallelism clean:

- **Stay in your assigned files.** Each 13.X track owns a sibling module pair in `apps/desktop/src-tauri/src/`: `core_agents.rs` + `commands_agents.rs` for 13.D, `core_git.rs` + `commands_git.rs` for 13.E, `core_local.rs` + `commands_local.rs` for 13.F, `core_safety.rs` + `commands_safety.rs` for 13.G. Do **not** edit another track's sibling; do not add new methods to `core.rs` or `commands.rs` directly.
- **Cross-track hooks are `TODO(13.X):`.** When one track needs a future hook from another, leave `// TODO(13.G): replace AutoAcceptSafeTools with InboxPermissionHandler once the inbox lands`. Grep-able, deterministic cleanup at integration time.
- **Shared contracts are frozen.** Event shapes (`designer-core/src/event.rs`), IPC DTOs (`designer-ipc/src/lib.rs`), and the `PermissionHandler` trait (`designer-claude/src/permission.rs`) were locked by 13.0. Don't extend them without touching ADR 0002 or a new ADR.
- **New IPC commands register in `lib.rs`.** The one shared surface that all four tracks touch is `tauri::generate_handler![...]`. Keep entries alphabetical; that minimizes conflict during integration merges.
- **Read ADR 0002** (`core-docs/architecture/adr/0002-v1-scoping-decisions.md`) before re-litigating scoping choices. The workspace-lead session model, repo-linking UX, default permission policy, and cost-chip thresholds are all locked for v1.
- **Integration merge order is D → E → G → F.** D lands first (chat with real Claude), E second (tracks + git), G third (swap the permission handler, wire cost chip), F last (local-model surfaces against real events). Each track ships a green `cargo test --workspace` + `cargo clippy --workspace --all-targets -- -D warnings` + `cargo fmt --all -- --check` before handoff.

## Quality Bar

Code does not ship unless it meets all five simultaneously:

- **Functional.** Does what it's supposed to; edge cases handled.
- **Safe.** Approval gates enforced in Rust core, not frontend. Sandboxed previews. No unsigned code paths.
- **Performant.** UI stays responsive while many agents stream; <100ms interaction latency; <200MB idle memory on a typical project.
- **Crafted.** Feels intentional. Mini-design-system-compliant. No placeholder UI in shipped builds.
- **Trustworthy.** Demoable end-to-end without seams. Unfinished features hide entirely (feature flags, not visible stubs) until they're ready — never half-baked surfaces shipped behind partial copy. Subtractions are explained in release notes, never silent. Verification mechanism: see `core-docs/architecture/adr/0009-trustworthy-shipping.md` §1.D.

<!-- mini:start -->
## Mini Design System

This project uses Mini. UI tasks follow the procedure below. See the **Core Documents** table above for the source-of-truth files (`design-language.md`, `component-manifest.json`, `pattern-log.md`, `generation-log.md`); runtime skills live at `.claude/skills/`.

### Procedure for UI tasks

Before writing or editing UI code:

1. Check `core-docs/design-system/component-manifest.json`. Prefer in order: platform-native archetype (Radix on web, native on Swift) → extend an existing component → generate new.
2. Read `core-docs/design-system/design-language.md` for tokens and axioms. Reference tokens, never arbitrary values.
3. Compose using core primitives (Box, Stack, Cluster, Sidebar, Center, Container, Frame; Overlay on web only).
4. After generation: verify no arbitrary px / hex / ms / z-index values remain. Run `node tools/invariants/check.mjs <changed files>` if available.
5. For interactive output: verify focus-visible, keyboard path, contrast across accent × mode, `prefers-reduced-motion`, no animate-in-tree anti-pattern.
6. Update `core-docs/design-system/component-manifest.json` for new or modified components.
7. Append an entry to `core-docs/design-system/generation-log.md` (schema in that file's header).
8. Log non-obvious decisions to `core-docs/design-system/pattern-log.md`.

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
- `distill-feedback` — cross-cycle pattern extraction; proposes promotions to `core-docs/design-system/design-language.md`, `core-docs/architecture/spec.md` Decisions Log, `core-docs/taste/tensions.md`. Run every 2–3 cycles, at end of session, or when ≥3 undistilled cycles accumulate.
- `uncommon-care` — generative craft critique through 8 lenses; writes a feedback-ledger entry. Use when pushing a surface from ship-ready to memorable.
- `taste-staff-review` — three-perspective review for taste-loop changes (engineer / design critic / workflow editor). Vendored from the Mini × Taste monorepo as `staff-review`; renamed here to avoid collision with Designer's existing `staff-review` skill (which uses different lenses for Designer product changes — engineer / UX designer / design engineer). Both coexist; use `taste-staff-review` for cycle / feedback / showcase changes and `staff-review` for Designer product code.

### Foundations reference

`core-docs/design-system/foundations.md` is the established-vocabulary reference (Gestalt, UX laws, Norman, WCAG, motion, cognitive load). Cite it during distillation; reference it when deviating from a known pattern. It's not a checklist applied uniformly.

### Scope guard — craft vs. product architecture

Most taste-loop output sharpens Designer's `design-language.md`. Sometimes product-architecture decisions surface during craft work (what an artifact *is*, where it lives, its lifecycle). Those go to `spec.md` Decisions Log, not the design-language doc. When a question is product-shape (not visual), capture briefly with a `> **Scope note:**` blockquote and route to the right home.

### Vendored infrastructure

The four taste-loop skills (`drain-feedback`, `distill-feedback`, `uncommon-care`, `taste-staff-review`), `core-docs/design-system/foundations.md`, and `tools/feedback-status.mjs` are vendored from `byamron/mini-design-system`. Each vendored SKILL.md carries a YAML-comment provenance line recording the source commit. Do not edit these files in place — upstream changes propagate via re-vendor.

## Subtraction is welcome

Removing or simplifying shipped code is encouraged when it yields cleaner architecture or better UX. Do not treat shipped work as untouchable — propose deletions, consolidations, and undos as readily as additions.
