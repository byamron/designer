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
| Design Language | `core-docs/design-language.md` | Visual and interaction source of truth (scaffolded; Mini is the intended substrate) |

## Agents

Agents live in `.claude/agents/` (not yet populated — scaffolded in Phase 1 per `core-docs/roadmap.md`). Designer's multi-layer architecture uses specific agents for each layer: `rust-core`, `claude-integration`, `swift-helper`, `git-ops`, `local-models`, `safety`, `frontend`, plus `planner` and `docs`. See `core-docs/workflow.md` for when to use each.

## How to Work

1. **Read before writing.** Check `core-docs/plan.md` for current focus and `core-docs/feedback.md` for past direction.
2. **Keep docs and code in sync.** When a decision changes, update the spec and log a feedback entry.
3. **Respect the compliance invariants** in `core-docs/spec.md` §5. Never touch Claude OAuth tokens; never run Claude Code anywhere but the user's machine.

## Quality Bar

Code does not ship unless it meets all four simultaneously:

- **Functional.** Does what it's supposed to; edge cases handled.
- **Safe.** Approval gates enforced in Rust core, not frontend. Sandboxed previews. No unsigned code paths.
- **Performant.** UI stays responsive while many agents stream; <100ms interaction latency; <200MB idle memory on a typical project.
- **Crafted.** Feels intentional. Mini-design-system-compliant. No placeholder UI in shipped builds.
