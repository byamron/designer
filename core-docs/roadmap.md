# Roadmap

Backend-first phasing. Infrastructure, safety, orchestration, and local-model ops ship before any user-visible surface. The frontend is built on top of a working, tested core — not alongside an evolving one.

This document sequences the work described in `spec.md`. It is the single source of truth for "what's next"; `plan.md` tracks near-term focus; `history.md` records what shipped.

---

## Principles

- **Infrastructure before interface.** Rust core, event store, orchestrator, and safety gates exist and are tested before any React component is written.
- **Safety before user-facing actions.** Approval gates, audit log, and scope enforcement ship before the first UI that could trigger an agent action.
- **De-risk first.** A narrow spike validates the load-bearing assumptions (Claude Code agent-teams observability, Swift ↔ Rust IPC) before committing to the full sequence.
- **Every phase ships something verifiable.** Not necessarily user-visible, but demonstrable with a CLI, test, or Rust integration check.
- **Rough estimates are rough.** Durations below are planning fiction for a solo builder; recalibrate after Phase 1.

## Dependency graph

```
Phase 0 (spike)
    │
    ▼
Phase 1 (foundation) ──► Phase 2 (Claude) ──► Phase 3 (safety) ──► Phase 4 (git)
                                                      │
                                                      ▼
                                              Phase 5 (local models)
                                                      │
                                                      ▼
                                              Phase 6 (project state)
                                                      │
                                                      ▼
                                              Phase 7 (sync protocol)
                                                      │
                                                      ▼
                              [Backend complete; frontend begins]
                                                      │
                                                      ▼
                                Phase 8 (frontend foundation) ──► Phase 9 (core surfaces)
                                                                        │
                                                                        ▼
                                                               Phase 10 (design lab)
                                                                        │
                                                                        ▼
                                                      Phase 11 (polish / sign / notarize)
                                                                        │
                                                                        ▼
                                                               Phase 12 (mobile)
```

---

## Phase 0 — De-risk spike

**Goal:** validate the load-bearing assumptions before committing.

**Why first:** the architecture rests on two unproven integration points. If either fails, the build order changes significantly.

**Deliverables:**
- Spawn Claude Code as a subprocess from Rust with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; confirm it works on the current version.
- Watch `~/.claude/teams/{team}/config.json` and `~/.claude/tasks/{team}/` for changes; parse them.
- Observe `TaskCreated`, `TaskCompleted`, `TeammateIdle` events (or their equivalents) via file watching or hook-based mechanism.
- Build a minimal Swift helper binary that loads Foundation Models and responds to JSON-over-stdio from Rust.

**Done when:** a Rust integration test spawns a Claude Code team, observes the task-list file populating, and independently a Rust test round-trips a prompt through the Swift helper.

**Writes:** a history.md entry capturing findings and any architectural adjustments.

---

## Phase 1 — Foundation *(week 1–2)*

**Goal:** production-ready Rust skeleton.

**Deliverables:**
- Tauri shell (empty window acceptable; just enough to host the core).
- Crate structure per spec (`designer-core`, `designer-claude`, `designer-git`, `designer-local-models`, `designer-audit`, `designer-sync`).
- SQLite schema with migrations (`sqlx` or `refinery`).
- Event-sourced state primitives: events table (append-only), projections (derived aggregate state), replay.
- Tracing + logging (`tracing` crate with structured fields).
- Error handling conventions (`thiserror` / `miette`).
- Test infrastructure (unit + integration).
- `.claude/` scaffolding: initial agents (`rust-core`, `claude-integration`, `docs`), rules for keeping spec/history updated, skills for common recipes.

**Done when:** `cargo test` passes with a working event-store round-trip; the Tauri app opens an empty window; `.claude/` is populated enough that agents can be dispatched for real work.

---

## Phase 2 — Claude Code orchestration *(week 3–4)*

**Goal:** orchestrate Claude Code agent teams through the Rust core.

**Deliverables:**
- `Orchestrator` trait (`spawn_worker`, `assign_task`, `post_message`, `observe_events`).
- Claude Code implementation of `Orchestrator` (subprocess spawn, streaming, lifecycle, cleanup).
- File-watching pipeline for `~/.claude/teams/` and `~/.claude/tasks/`.
- Translation layer: Claude Code events → Designer events (without leaking Claude's file formats into the core).
- Task-list sync (Claude's task list mirrored as Designer task events).
- Mailbox sync (teammate messages captured as Designer events).
- Resume / recovery handling for the known Claude Code limitation that in-process teammates do not survive `/resume`.

**Done when:** a Rust CLI can create a workspace, start a team, assign a task, observe completion, and show the full event timeline from our event store — entirely without the frontend.

---

## Phase 3 — Safety infrastructure *(week 5–6)*

**Goal:** hard safety gates enforced in the core.

**Why before the frontend:** if gates live only in UI, a frontend bug could bypass them. We need non-bypassable enforcement before we expose anything agent-driven to a user.

**Deliverables:**
- Approval gate system — request / review / respond flow wired through the event store.
- Cost tracking — token counts and dollar estimates per workspace, with configurable caps.
- File scope enforcement — allowed-path and no-touch-path rules per workspace.
- Append-only audit log — every agent action, every approval, every scope override; queryable.
- Sandboxing primitives — CSP builder for HTML previews, iframe sandbox attribute set, no script execution in a trust context.
- Claude Code hook integration (`TaskCreated`, `TaskCompleted`, `TeammateIdle`) wired to gate points.

**Done when:** an integration test shows an agent attempting a prod-config change being blocked until explicit approval, and all actions landing in the audit log.

---

## Phase 4 — Git operations *(week 7)*

**Goal:** safe programmatic git workflow.

**Deliverables:**
- Worktree creation and cleanup.
- Branch lifecycle (create, switch, merge, prune).
- PR operations via `gh` CLI (create, update, list).
- Diff extraction for reports (file-level, with context).
- Basic conflict detection primitive ("same file, last 24h").
- Commit conventions (structured commit messages, sign-off).

**Done when:** a test workspace can create a feature branch, commit changes via an agent, open a PR, and clean up the worktree.

---

## Phase 5 — Local-model ops layer *(week 8–9)*

**Goal:** zero-setup local inference for audit, context, and recap.

**Deliverables:**
- Swift helper binary, properly signed, bundled with the app.
- Foundation Models wrapper with streaming output.
- JSON-over-stdio IPC protocol between Rust and Swift (documented and typed on both sides).
- Rust-side rate limiting and response caching.
- First job: **context optimizer** — summarize workspace history into Claude-ready context.
- Second job: **recap generator** — morning report from yesterday's event stream.
- Fallback handling when Foundation Models is unavailable (older macOS, no Apple Intelligence).

**Done when:** the system can generate a morning recap and a fresh-context summary entirely on-device, with no Claude tokens consumed.

---

## Phase 6 — Project / workspace state *(week 10)*

**Goal:** multi-workspace projects with shared state.

**Deliverables:**
- Project creation, configuration, and repo linking.
- Workspace lifecycle (create, pause, archive, delete).
- Project thread primitive (cross-workspace messages from team leads).
- Shared project state — reads from `core-docs/*.md` as source of truth.
- Cross-workspace conflict detection v1.
- Project-level team-lead-to-team-lead posting (through the project thread, not DMs).

**Done when:** two workspaces in one project can operate concurrently, share state reads, and surface a conflict when they touch the same file.

---

## Phase 7 — Sync protocol *(week 11)*

**Goal:** mobile-ready sync foundation, even without a mobile client.

**Deliverables:**
- Event stream serialization (stable format, versioned).
- Sync protocol definition (peer-to-peer initially; no server required).
- Clock / causality (event-sourced with monotonic IDs and optional vector clocks).
- Pairing primitives (QR or code-based; never cloud-auth).
- Offline queue / replay.

**Done when:** two Rust processes can sync a workspace's event stream bidirectionally without a central server.

---

## Backend complete — gate review

Before starting Phase 8, a review:

- All compliance invariants still hold?
- `spec.md` still accurate, or does the decisions log need updating?
- Local-model ops layer is genuinely zero-setup?
- Approval gates genuinely non-bypassable?
- Do we want to build the frontend now, or harden a backend capability first?

Only proceed to Phase 8 after this review.

---

## Phase 8 — Frontend foundation *(week 12)*

**Goal:** minimal React app wired to the Rust core.

**Deliverables:**
- Tauri IPC bindings (typed, code-generated).
- Rust → TypeScript type generation (e.g., `ts-rs`).
- Mini design system integration (tokens, primitives, archetypes).
- App state management (Zustand or similar — event-stream subscription friendly).
- Dark mode + reduced-motion respect from day one.
- Basic routing.

**Done when:** a React component can render a live-updating list of workspaces by subscribing to events from the core.

---

## Phase 9 — Core surfaces *(week 13–14)*

**Goal:** the three-pane layout working end-to-end.

**Deliverables:**
- Project strip with Slack-style switcher and Cmd+K quick-switcher.
- Workspace sidebar.
- Tab primitive with Plan template (chat + markdown) first.
- Home tab (vision, roadmap, active workspaces, recent reports, needs-attention).
- Activity spine at all altitudes (project, workspace, agent, artifact).
- Four-tier attention model wired (inline, ambient, notify, digest).
- Chat UI with streaming artifact previews.

**Done when:** a user can click through projects, open a workspace, create a Plan tab, chat with a team lead, see the spine update live as agents work, and receive a digest on return.

---

## Phase 10 — Design lab *(week 15)*

**Goal:** component viewer plus sandboxed prototype preview.

**Deliverables:**
- Mini component catalog rendered in-app with live tokens.
- Sandboxed prototype iframe with strict CSP.
- Annotation / comment layer (agentation-style batch feedback).
- Variant generation hook.
- Basic dev panel / slider for component props.

**Done when:** an agent-produced prototype renders safely, can be annotated with batch feedback, and variants can be generated and compared.

---

## Phase 11 — Polish, sign, notarize *(week 16)*

**Goal:** shippable macOS build.

**Deliverables:**
- Auto-update (Tauri updater or Sparkle).
- Signed and notarized binary.
- Crash reporting (opt-in, privacy-first).
- Performance pass (cold start, idle memory, streaming load).
- In-app documentation / onboarding.
- Install QA on a clean machine.

**Done when:** a `.dmg` installs cleanly, opens without warnings on a fresh Mac, and the auto-updater picks up a test release.

---

## Phase 12 — Mobile *(phase 2)*

Deferred until desktop is stable. Planned deliverables:

- Sync relay (tunneled connection or WebRTC between mobile and user's desktop).
- iOS client (read-only reports + approve/reject gates first).
- Light editing (redirect agents, short replies, resume sessions).
- Remote wake of desktop Claude Code sessions.

Mobile never cloud-hosts Claude. Desktop is always the runtime.

---

## Milestones (summary)

| Milestone | Phases | Approx. timeline |
|---|---|---|
| Architecture de-risked | 0 | Week 0 |
| Core runs a Claude Code team | 1–2 | Week 4 |
| Safety infrastructure in place | 3–4 | Week 7 |
| Local-model ops working | 5 | Week 9 |
| Multi-workspace + sync ready | 6–7 | Week 11 |
| First user-visible surface | 8–9 | Week 14 |
| Shippable desktop beta | 10–11 | Week 16 |
| Mobile | 12 | Phase 2 |

---

## What this roadmap does not include

- Marketing, pricing, distribution strategy — separate document when that phase arrives.
- Team hiring — assumed solo for now.
- Anthropic partnership conversations — may become relevant before public launch; tracked in backlog.
- Detailed Linear / Jira / Figma integration scoping — parked until Phase 6+ demonstrates the coordination primitives.
