# History

Detailed record of shipped work. Reverse chronological (newest first). This is not a changelog — it captures the **why**, **tradeoffs**, and **decisions** behind each change so future sessions have full context on how the project evolved.

---

## How to Write an Entry

```
### [Short title of what was shipped]
**Date:** YYYY-MM-DD
**Branch:** branch-name
**Commit:** [SHA or range]

**What was done:**
[Concrete deliverables — what changed in user-facing terms.]

**Why:**
[The problem this solved or the goal it served.]

**Design decisions:**
- [UX or product choice + reasoning]

**Technical decisions:**
- [Implementation choice + reasoning]

**Tradeoffs discussed:**
- [Option A vs Option B — why this one won]

**Lessons learned:**
- [What didn't work, what did, what to do differently]
```

Use the `SAFETY` marker on any entry that modifies error handling, persistence, data loss prevention, or fallback behavior.

---

## Entries

### Project spec, compliance framing, and core docs set up
**Date:** 2026-04-20
**Branch:** initial-build
**Commit:** pending

**What was done:**
Moved the repo from a single placeholder `SPEC.md` (policy and compliance framing only) to a full product specification plus the `core-docs/` template structure. `SPEC.md` content is now integrated into `core-docs/spec.md` alongside vision, product architecture, UX model, agent model, tech stack, decisions log, and open questions. Added `CLAUDE.md` at repo root. Populated `core-docs/plan.md` with the build roadmap, `core-docs/feedback.md` with captured user direction, `core-docs/workflow.md` as the session guide, and `core-docs/design-language.md` as scaffolding for future design work.

**Why:**
The prior `SPEC.md` covered only the Anthropic compliance model — enough to avoid bad patterns, not enough to build against. A week of collaborative spec'ing produced 28 architectural and product decisions. The project needed a durable home for those decisions plus the conventional `core-docs/` shape so future agents can load context predictably.

**Design decisions:**
- Target user is a non-technical operator (designer, PM, founder, full-stack builder), not a developer. This re-frames every surface decision.
- Manager-of-agents metaphor drives nomenclature (project / workspace / tab), UX (three-pane + activity spine), and agent behavior (persistent team lead, ephemeral subagents, role identities only).
- Four-tier attention model (inline / ambient / notify / digest) — agents can surface richly in active contexts but do not unilaterally open tabs.
- Tabs are the sole working-surface primitive; panels-within-tabs rejected as unnecessary complexity.
- Templates over types for new tabs — defaults without constraints.
- Project docs live in the repo as `.md` files. Agents pick them up as codebase context.

**Technical decisions:**
- Stack: Tauri + Rust core + TS/React frontend + Swift helper for Apple Foundation Models. Tauri chosen over Electron for subprocess-under-load behavior, footprint, and security defaults.
- Event-sourced workspace state for audit, time-travel, and mobile-ready sync.
- Abstract `Orchestrator` trait with Claude Code agent teams as the first implementation. Anthropic will iterate; we keep an interface seam.
- Local models serve only the ops layer (audit, context optimizer, patterns, recaps). They never replace Claude for building.
- SQLite holds app-only state; project artifacts live as `.md` in the repo.

**Tradeoffs discussed:**
- Tauri vs Electron vs SwiftUI: chose Tauri. Electron was the faster-to-ship fallback; SwiftUI would have lost Monaco/Mermaid/markdown ecosystem. Wails considered and rejected given Rust's subprocess story matches Designer's workload better.
- Rich GUI vs terminal-like Conductor feel: rich. Compliance guidance restricts auth and proxying, not presentation.
- Agent-teams primitive adoption: adopt, but abstract. Anthropic's multi-agent primitives are experimental and will move; we do not want to be locked in.
- Mobile-from-day-one: yes, in the data layer. No mobile client in early phases.

**Lessons learned:**
- The 2026 OpenClaw ban clarified the real compliance line: OAuth token handling and subscription proxying, not UI richness. Designer is well inside the line.
- The Claude Code agent-teams documentation revealed that our intended workspace primitive maps almost exactly onto Anthropic's team primitive. This shortened the architecture significantly — we build above, not around.
- "Panels vs tabs" was a distraction. Tabs + `@` + split view is the cleaner answer.

---

<!-- Add new entries above this line, newest first. -->
