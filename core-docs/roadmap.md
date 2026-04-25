# Roadmap

Backend-first phasing. Infrastructure, safety, orchestration, and local-model ops ship before any user-visible surface. The frontend is built on top of a working, tested core — not alongside an evolving one.

This document sequences the work described in `spec.md`. It is the single source of truth for "what's next"; `plan.md` tracks near-term focus; `history.md` records what shipped. Security-specific work — threat model, invariants, and the 13.H / 16.S / 17.T tranches — lives in `security.md` and is referenced from the phase sections below.

---

## Principles

- **Infrastructure before interface.** Rust core, event store, orchestrator, and safety gates exist and are tested before any React component is written.
- **Safety before user-facing actions.** Approval gates, audit log, and scope enforcement ship before the first UI that could trigger an agent action.
- **De-risk first.** A narrow spike validates the load-bearing assumptions (Claude Code agent-teams observability, Swift ↔ Rust IPC) before committing to the full sequence.
- **Every phase ships something verifiable.** Not necessarily user-visible, but demonstrable with a CLI, test, or Rust integration check.
- **Rough estimates are rough.** Durations below are planning fiction for a solo builder; recalibrate after Phase 1.

## Dependency graph

```
Phases 0–11: preliminary build  (✅ landed 2026-04-21)
  └─ Rust core, safety, git, local-models helper source, sync types,
     frontend shell, design lab, onboarding, polish scaffolding.

Phase 12 — Real-integration validation     (3 parallel tracks)
  ├─ 12.A  Real Claude Code subprocess      ─┐
  ├─ 12.B  Foundation Models helper build   ─┼── gate → Phase 13
  └─ 12.C  Tauri shell binary                ─┘

Phase 13 — Wire the real runtime            (2 prereqs + 5 tracks, gated individually)
  ├─ 13.0  Pre-track scaffolding         (← 12.A + 12.C; blocks all 13.X)
  ├─ 13.1  Artifact foundation           (← 13.0; unifies tab model; blocks D/E/F/G emitters) ✅
  ├─ 13.D  Agent wire                    (← 12.A + 12.C + 13.1)  [emits message + agent artifacts]
  ├─ 13.E  Track primitive + git wire    (← 12.C + 13.1)         [emits code-change + pr]
  ├─ 13.F  Local-model surfaces          (← 12.B + 12.C + 13.1)  [emits report + comment; wires prototype]
  ├─ 13.G  Safety surfaces + Keychain    (← 12.C + 13.1)         [emits approval + comment]
  └─ 13.H  Safety enforcement            (← 13.G)                [GA gate; see security.md]

Phase 14 — Sync transport        (parallel with 13, 15)
Phase 15 — Hardening + polish    (parallel with 13, 14)

Phase 16 — Shippable desktop build  (← 13 + 15;  14 optional)
  ├─ 16.R  Signing, notarization, updater, crash-report, install QA.
  └─ 16.S  Supply-chain posture        [DMG gate; see security.md]

Phase 17 — Team-tier trust           (← 16; gates team pricing)
  └─ 17.T  Encryption, MDM, SIEM export, bug bounty, GitHub App.

Phase 18 — Mobile  (← 14 + 16 + 17;  was Phase 12 in the original spec)

Phase 19 — Workspace scales up  (multi-track UX, forking, reconciliation)
  └─ Gates on 13 + 16; parts pullable into 15 if the manager UX feels pinched.

Phase 20 — Parallel-work coordination layer
  └─ Project-level primitive that analyzes contention, partitions files,
     freezes contracts, and generates a scaffold PR before N parallel agents
     fan out. Builds on Phases 6 (project thread) + 19 (multi-track).
     Gates on 13 + 19 substantially complete.

Phase 21 — Learning layer  (local-model session analysis → workflow proposals)
  └─ Gates on 13.F (local-model surfaces) + 13.D (real agent traffic to analyze).
     Independent of 14, 16, 18, 19, 20; can pull earlier once 13.D/F are green.
```

---

## Status (2026-04-21)

Phases 0–11 landed as a preliminary build on branch `preliminary-build`. See `history.md` for detail; summary below.

| Phase | State | Notes |
|---|---|---|
| 0 — De-risk spike | Abstractions landed | Trait surface (`Orchestrator`, `FoundationHelper`, `ClaudeFileWatcher`) landed in Phases 1–2. **Real validation against a live Claude Code install + Apple Foundation Models is still open** — see Phase 12a. |
| 1 — Foundation | Done | 9-crate Cargo workspace, event-sourced SQLite core (WAL-bootstrapped), Tauri shell library edge. 19 Rust tests passing. |
| 2 — Claude orchestration | Done (mock-first) | `MockOrchestrator` exercises the full event stream; `ClaudeCodeOrchestrator` is wired but unvalidated against real subprocess output. |
| 3 — Safety | Done | `ApprovalGate`, `CostTracker`, `ScopeGuard`, `CspBuilder::strict()` + `SANDBOX_ATTRIBUTE` constant. All enforced in Rust core. |
| 4 — Git ops | Done | `git` + `gh` wrappers, worktree/branch/PR/diff, `recent_overlap()` cross-workspace primitive. |
| 5 — Local-model ops | Done (source-only) | Swift helper source, 4-byte-BE-framed JSON IPC, `NullHelper` fallback, cache + rate limiter. Helper binary not built in this env. |
| 6 — Project/workspace state | Done | Lifecycle events, projector for aggregate state, conflict detection primitive. |
| 7 — Sync | Done | Versioned `SyncFormat`, vector clocks, `SyncSession`, `OfflineQueue`, `PairingMaterial`. |
| 8 — Frontend foundation | Done | React + Vite, Mini CSS wired, custom store over `useSyncExternalStore`, mock IPC client, dark-mode parity, reduced-motion. |
| 9 — Core surfaces | Done | Three-pane layout, Cmd+K quick switcher (focus-trapped), tab primitive with ARIA (`role=tab`/`tabpanel`, arrow-key nav, roving tabindex, `aria-controls`/`aria-labelledby`), Home tab, streaming chat, activity spine with humanized event labels, skip-to-content link, h1→h2→h3 hierarchy. |
| 10 — Design lab | Done | Component catalog, sandboxed prototype preview (meta-CSP + iframe sandbox), annotation layer, variant explorer. |
| 11 — Polish | Scaffolded | Onboarding, `Updater` trait, panic-hook crash reports, `PACKAGING.md` signing runbook. Actual signing + notarization requires an Apple Developer identity. |

11 frontend tests + 19 Rust tests + 6/6 Mini invariants passing; `cargo clippy --workspace --all-targets` clean; production build 58 KB gz JS + 9 KB gz CSS.

### Still-open phases

- **Phase 12** — Real-integration validation. 12.C (Tauri shell binary) landed 2026-04-21; see `history.md`. 12.A (real Claude Code) and 12.B (Foundation Models helper build) remain open and gate their respective Phase 13 tracks.
- **Phase 13.0** — Pre-track scaffolding. Partitions hot-spot files so the four 13.X agents don't collide; freezes event / IPC / permission-handler contracts. Completed by the scaffolding PR; blocks 13.1 + 13.D/E/F/G.
- **Phase 13.1** — Artifact foundation + unified workspace thread. Consolidates tab-model-rethink + find-agentation-server into one PR. Retires Plan/Design/Build tab types; every tab renders `WorkspaceThread` with typed artifact blocks inline. Ships the `ArtifactCreated/Updated/Pinned/Unpinned/Archived` event vocabulary, `PayloadRef` (inline/hash), rail projection, IPC commands, and a 12-renderer block registry. D/E/F/G now emit into the registry instead of painting bespoke UI — **they run in parallel after 13.1 with zero UI contention.**
- **Phase 13** — Wire the real runtime. Two prerequisite sub-phases (13.0, 13.1) plus five tracks (D: agent wire, E: git + repo linking, F: local-model surfaces, G: safety surfaces + Keychain, H: safety enforcement / GA gate). D–G gated on 13.1 plus their Phase-12 inputs and can run in parallel after 13.1; H gates on G and blocks GA. See `security.md` for 13.H detail.
- **Phase 14** — Sync transport. Independent; can run concurrently with Phase 13 or 15.
- **Phase 15** — Hardening + polish (Mini primitives, correlation IDs, dark-mode regression, auto-grow textarea, pairing RNG, event-log incrementalization). Independent; all six items are parallelizable.
- **Phase 16** — Shippable desktop build. Splits into 16.R (Apple Developer ID, signed `.dmg`, update channel, crash-report endpoint, install QA) and 16.S (supply-chain posture — blocking audit CI, SBOM, SLSA, dual-key updater, pentest, SECURITY.md). Gates on 13 + 15; Phase 14 optional for MVP. Signed DMG blocked until 16.S lands. Detail in `security.md`.
- **Phase 17** — Team-tier trust. Encryption at rest, MDM policy, SIEM export, bug bounty, narrowly-scoped GitHub App, inter-workspace isolation. Gates team pricing. Detail in `security.md`.
- **Phase 18** — Mobile (formerly Phase 12; renumbered). Requires Phase 14 in full, Phase 16, and the E2EE-with-untrusted-relay constraint from `security.md`.
- **Phase 19** — Workspace scales up: multi-track UX, forking, reconciliation, workspace-lead routing policy. Primitive lands in Phase 13.E; this phase ships the user-visible affordances. Gates on 13 + 16; pullable into 15 partial.
- **Phase 20** — Parallel-work coordination layer. Project-level primitive that analyzes contention across multiple workspaces / tracks running in parallel, partitions shared files, freezes contracts (events, IPC DTOs, trait seams), generates a pre-integration scaffold, and plans merge order. Automates what Phase 13.0 did by hand. Gates on 13 + 19 substantially complete.
- **Phase 21** — Learning layer: local-model analysis of session transcripts produces editable workflow + context optimization proposals on the project Home tab. Gates on 13.D + 13.F (needs real agent traffic and working local-model surfaces).

See the "Gaps after the preliminary build" section below for the full gap → phase mapping.

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

## Gaps after the preliminary build

Phases 0–11 landed behind stable trait interfaces; every downstream subsystem plugs in without changing the shape above it. What remains is making the mocks real, wiring the plumbing the mocks hid, and shipping a signed binary. The list below is the **complete** gap inventory — every item maps to a named phase below.

| # | Gap | Why it matters | Phase |
|---|---|---|---|
| G1 | Real Claude Code subprocess not validated | `claude team init/task/message` arg shape is guessed; file-watcher paths too | 12.A |
| G2 | Swift Foundation Models helper not built | `LanguageModelSession.respond(to:)` call unverified; helper binary missing | 12.B |
| G3 | Tauri shell binary absent | React app + Rust core can't talk in one process; no window chrome | 12.C |
| G4 | PlanTab chat hardcodes `ackFor()` | No `Orchestrator::post_message` path from UI to agent | 13.D |
| G5 | `create_workspace` doesn't create a track (worktree + branch) | `GitOps` wired but never called from UI; no track on disk. Resolution introduces the Track primitive per spec Decisions 29–30. | 13.E |
| G6 | Local-model jobs (`recap`, `audit_claim`, `summarize_row`) have no caller | Activity spine summaries, morning recap, audit verdicts all stubbed | 13.F |
| G7 | Approval resolution surface is a `setTimeout` in BuildTab | Real approvals need a real inbox; currently non-interactive | 13.G |
| G8 | No repo-linking UI or file picker | User can't point Designer at a codebase | 13.E |
| G9 | No user-repo file persistence (`core-docs/*.md`) | Spec calls for docs-in-repo; only `events.db` is written today | 13.E |
| G10 | No sync transport (WebRTC / relay / pairing QR) | Protocol types exist, no wire | 14 |
| G11 | Keychain integration missing | Spec invariant; no secret store today | 13.G |
| G12 | Mini primitives (Box/Stack/Cluster) not used | Cohesion drift; every layout is inline CSS | 15 |
| G13 | `correlation_id` / `causation_id` never set | Traces can't be reconstructed | 15 |
| G14 | Manual-entropy pairing RNG fallback | Non-crypto for non-unix; worth `OsRng` | 15 |
| G15 | Dark-mode visual regression harness absent | Parity unverified at pixel level | 15 |
| G16 | Auto-grow chat textarea | Polish | 15 |
| G17 | Apple Developer identity + signed build | Shippable gate | 16 |
| G18 | Auto-update channel (signed `latest.json` + endpoint) | Ship gate | 16 |
| G19 | Install QA on a clean Mac | Ship gate | 16 |
| G20 | Crash-report endpoint (opt-in upload) | Ship gate | 16 |
| G21 | Inline commenting on chat spans + design-tab elements | Tactical replies beat re-typing long-message rebuttals; design feedback is element-anchored by nature. Today the user can only type a new whole-thread message. | 15.H |

---

## Work-order + parallelism at a glance

```
 ┌─ 12.A Real Claude Code ─┐
 ├─ 12.B Foundation helper ┤── all three independent ──► Phase 13 gate
 └─ 12.C Tauri shell ──────┘

 Phase 13 — Wire the real runtime (four tracks, gated by inputs)
 ├─ 13.D Agent wire      (needs 12.A + 12.C)
 ├─ 13.E Track primitive + git wire + repo-linking UI + core-docs persistence  (needs 12.C)
 ├─ 13.F Local-model surfaces       (needs 12.B + 12.C)
 └─ 13.G Safety surfaces + Keychain (needs 12.C)

 Phase 14 — Sync transport
 └─ Independent. Can run in parallel with Phase 13 or Phase 15.

 Phase 15 — Hardening & polish
 └─ Independent. Can run in parallel with Phase 13 or Phase 14.

 Phase 16 — Shippable desktop build  (16.R release mechanics + 16.S supply-chain posture)
 └─ Requires Phases 13 + 15 substantially complete; Phase 14 optional for MVP.
 └─ 16.S blocks the first signed DMG; see `security.md`.

 Phase 17 — Team-tier trust
 └─ Requires Phase 16; gates team pricing. Detail in `security.md`.

 Phase 18 — Mobile  (formerly Phase 12; same scope, renumbered for clarity)
 └─ Requires Phase 14 in full (sync) + Phase 16 (signed desktop) + Phase 17 (team-tier trust).
```

Tracks within a phase share a name prefix (12.A / 12.B / 12.C; 13.D–H; 16.R / 16.S). Any letter-suffixed track can start as soon as its inputs are green. Nothing in the graph requires multiple humans — parallelism just means a solo builder can pick up whichever track unblocks the most next work.

---

## Phase 12 — Real-integration validation *(three independent tracks)*

**Goal:** replace three trait mocks with live runtimes. Every track is independent — pick whichever is cheapest to access (hardware, auth, setup time).

### Track 12.A — Real Claude Code subprocess (gap G1) *(completed 2026-04-22)*

**Blocks:** 13.D.
**Needs:** a working Claude Code install + auth on the dev machine.

**Actual outcome** (historical record of what shipped; see `history.md` and `core-docs/adr/0001-claude-runtime-primitive.md` for the full story):

- Initial probe revealed that the placeholder's `claude team init/task/message` CLI subcommands don't exist. A follow-up web check confirmed agent teams are a real, env-var-gated, natural-language-driven feature; file paths in the placeholder were correct.
- Pivoted to the native agent-teams primitive. `Orchestrator` trait shape unchanged.
- Load-bearing spike resolved: option (a) — non-tty `--teammate-mode in-process` works cleanly. No pty, no tmux, no Phase 16 packaging impact.
- `crates/designer-claude/src/stream.rs` — new stream-json translator, 12 unit tests.
- `crates/designer-claude/src/claude_code.rs` — full rewrite: per-workspace long-lived subprocess, stream-json on both sides, `--permission-prompt-tool stdio`, deterministic `--session-id`, 60s graceful shutdown fallback. 6 unit tests.
- `crates/designer-claude/src/watcher.rs::classify` — rewritten against real shapes (config.json / inboxes/{role}.json / tasks/{team}/*.json). `None` for out-of-scope paths, `Some(Unknown)` only inside the watched dirs for unrecognized shapes.
- Live integration test `tests/claude_live.rs` behind `--features claude_live` — spawns a real team end-to-end through `ClaudeCodeOrchestrator`, observes events, shuts down cleanly. Passes in ~28s against Claude 2.1.117.
- 44 workspace tests pass; `cargo clippy --workspace --all-targets -- -D warnings` clean.
- CI workflows in `.github/workflows/`: Tier 1 hermetic (`ci.yml`), Tier 2 self-hosted-runner live integration (`claude-live.yml`), Tier 3 scheduled drift probe (`claude-probe.yml`).
- Docs: `core-docs/integration-notes.md` (reproducible source-of-truth), `core-docs/adr/0001-claude-runtime-primitive.md` (decision record), `.claude/agents/track-lead.md` + `teammate-default.md` (subagent definitions), `.claude/prompts/workspace-lead.md` (reserved stub).

**Deferred into Phase 13** (not blocking 13.D start):
- `designer-hook` binary as secondary feed (hooks are visible in stream-json; file-based backup is a 13.G concern when approval-gate file triggers arrive).
- `PreToolUse` approval-gate spike (moves to 13.G scope; the stdio permission-prompt path is already wired and will carry this).
- Partial-message coalescer at 120ms (moves to 13.D scope; only matters when the UI renders live chat).

### Track 12.B — Swift Foundation Models helper build (gap G2)

**Blocks:** 13.F.
**Needs:** macOS 15+ with Apple Intelligence enabled.

**Steps:**
- `swift build -c release --package-path helpers/foundation`; confirm the binary runs.
- Verify `LanguageModelSession.respond(to:)` still matches the shipping Apple SDK; adjust the Swift call if needed.
- Smoke test: `SwiftFoundationHelper::ping()` returns real version + model strings.
- Smoke test: `FoundationLocalOps::recap` against a small event window produces non-empty output that differs from the `NullHelper` fallback string.
- Add the helper path to `AppConfig::default_in_home` and document how it's bundled in Phase 16 packaging.

**Done when:** a test running on AI-capable hardware round-trips through the built helper, and every `LocalOps::*` job returns a response from the real helper instead of the `[offline …]` fallback.

### Track 12.C — Tauri shell binary (gaps G3, G8 partial)

**Blocks:** 13.D, 13.E, 13.F, 13.G (everything in Phase 13 needs the window to exist).
**Needs:** nothing — no external dependency.

**Steps:**
- Add `tauri = "2"` + `tauri-build = "2"` to `apps/desktop/src-tauri/Cargo.toml`; scaffold `tauri.conf.json` (window size, title, macOS vibrancy, menu).
- Register one `#[tauri::command]` per `designer_desktop::ipc::cmd_*` function. Wire `tauri::Builder::manage(Arc<AppCore>)` so commands share a single core.
- Expose `AppCore.store.subscribe()` as a Tauri event channel named `designer://event-stream`. Update `MockIpcClient.stream` to listen on the channel when running under Tauri.
- Author a restrictive allowlist in `tauri.conf.json`:
  - FS: only `~/.designer/**` + paths passed into `link_repo` (see 13.E).
  - Shell: `git`, `gh`, `claude`, `designer-foundation-helper` — nothing else.
  - Network: the updater endpoint only (see Phase 16).
  - No `tauri-plugin-dialog` globs beyond what the repo-linker flow needs.
- Boot-smoke: `cargo tauri dev` opens a window; clicking "+ Project" creates a real `Project` in `~/.designer/events.db`.

**Done when:** the desktop app is a single signed-able process; the React app renders against a live `AppCore` (not `MockCore`); the event broadcast from Rust reaches React via the Tauri channel.

### Gate before Phase 13

All three tracks complete, with the integration tests passing. Phase 13 tracks can begin individually as their inputs land (e.g., 13.E can start the moment 12.C lands, even before 12.A).

---

## Phase 13.0 — Pre-track scaffolding *(blocks 13.D/E/F/G)*

**Goal:** make the four 13.X tracks buildable in parallel by partitioning hot-spot files and freezing shared contracts. Without this, four parallel agents collide on `core.rs`, `commands.rs`, `designer-ipc/src/lib.rs`, `designer-core/src/event.rs`, and `claude_code.rs`'s permission handler. With it, each agent edits sibling modules with zero code-level contention.

**Needs:** 12.A + 12.C.

**Steps:**
- **Partition `AppCore` and `commands` surfaces.** Sibling modules per track in `apps/desktop/src-tauri/src/`: `core_agents.rs` / `core_git.rs` / `core_local.rs` / `core_safety.rs` for `impl AppCore { … }` blocks; `commands_agents.rs` / `commands_git.rs` / `commands_local.rs` / `commands_safety.rs` for `#[tauri::command]` handlers. Each file empty except a track-reservation docstring; each agent fills in their module without touching the others' files.
- **Freeze event shapes** in `designer-core/src/event.rs`. Add `TrackStarted`, `TrackCompleted`, `PullRequestOpened`, `ScopeDenied` (used by 13.E / 13.G) plus reserved `TrackArchived`, `WorkspaceForked`, `WorkspacesReconciled` (Phase 19 reserves these now so future migration is zero). Round-trip tests for each.
- **Introduce `PermissionHandler` trait** in `designer-claude` so 13.D and 13.G don't fight over the stdio permission-prompt code path. Default impl `AutoAcceptSafeTools` auto-accepts read-only tools (Read/Grep/Glob + safe `Bash`) and denies writes; 13.G swaps in an inbox-routing impl via `ClaudeCodeOrchestrator::with_permission_handler()`.
- **Freeze IPC DTOs** in `designer-ipc/src/lib.rs` for each track's command set; agent fills in behavior, types don't churn.
- **Document the `TODO(13.X):` stub convention** in `CLAUDE.md` so cross-track hooks grep cleanly.
- **ADR 0002** records the four v1 scoping decisions (workspace-lead session model, repo-linking UX, default permission policy, cost chip thresholds).

**Done when:** new sibling modules compile + pass tests empty; event shapes added with round-trip coverage; `PermissionHandler` trait live with default impl; `designer-ipc` DTOs for each track defined; `cargo test --workspace` + `cargo clippy --workspace --all-targets -- -D warnings` + `cargo fmt --check` all green; `CLAUDE.md` documents the convention; ADR 0002 merged.

**Why this is its own sub-phase:** Designer's own Phase 20 will eventually automate this step (analyze contention, propose partition, freeze contracts). For now it's a manual one-time cost that unblocks true parallelism on Phase 13.

---

## Phase 13 — Wire the real runtime *(five tracks, gated individually, parallel-safe after 13.0)*

**Goal:** turn the "scaffold that demos the UX" into "a product that actually does the thing." Each track replaces a stubbed frontend path with a real backend call. After 13.0 lands, all four tracks can be built in parallel by separate agents with zero file contention.

### Track 13.D — Agent wire (gaps G4)

**Needs:** 12.A + 12.C.

**Steps:**
- Replace `PlanTab`'s `ackFor()` with `ipcClient().postMessage(workspace.id, "you", draft)`; add a corresponding `#[tauri::command]` backed by `Orchestrator::post_message`.
- Stream agent replies back via the `designer://event-stream` channel (`MessagePosted` events with `author.role != "you"`).
- Render incoming `MessagePosted` events into the chat as streaming-text bubbles; honor reduced-motion.
- Add a "who's replying" indicator driven by `AgentSpawned` / `TeammateIdle` state.
- Test against a real Claude team: ask "What's the plan for X?" and see a real reply land.

**Done when:** a user message travels UI → Rust → Claude → events → UI with no hardcoded text anywhere; the activity spine shows the lead going active during the reply.

### Track 13.E — Track primitive + git wire + repo linking + core-docs persistence (gaps G5, G8, G9)

**Needs:** 12.C.

**Introduces the `Track` primitive** (per spec §"Workspace and Track" and Decisions 29–30, 32). A workspace owns a list of tracks; v1 creates exactly one track per workspace, but the data shape supports N — future multi-track UI lands in Phase 19 without a data-model migration.

**Steps:**
- Add a "Link repository" flow in the project-creation dialog (native file picker for a directory; validate it's a git repo root).
- Introduce `TrackStarted { workspace_id, track_id, worktree_path, branch }` and `TrackCompleted { track_id }` events; projector tracks a `tracks: Vec<TrackState>` field per workspace. Reserve (do not implement) `WorkspaceForked`, `WorkspacesReconciled`, `TrackArchived`.
- Extend `create_workspace` to append `WorkspaceCreated` plus a first `TrackStarted` event; `GitOps::init_worktree` creates the worktree for the new track.
- Surface the track in the workspace sidebar meta as a status badge (not a navigation primitive); the user sees "the workspace," not "the track," by default.
- On first workspace create, seed `core-docs/spec.md` / `plan.md` / `history.md` / `design-language.md` in the user's repo if absent (per Decision 28).
- Wire "Request merge" in `BuildTab` to `GitOps::open_pr` via a new command; feed `gh pr create --json` output back as `PullRequestOpened { track_id, pr_number }`. On merge, emit `TrackCompleted`.
- Auto-cleanup: `TrackCompleted` removes the track's worktree (branch stays until the user archives). `WorkspaceArchived` cleans up all remaining tracks.

**Done when:** creating a workspace in the UI creates a real worktree + branch on disk (as a length-1 track list); merging creates a real PR in the linked GitHub repo and emits `TrackCompleted`; archiving the workspace cleans up all tracks. User-facing UI reads "workspace" without exposing "track" as a word.

### Track 13.F — Local-model surfaces (gap G6)

**Needs:** 12.B + 12.C.

**Steps:**
- Replace `ActivitySpine`'s hardcoded summaries with `LocalOps::summarize_row` responses; cache for the row's lifetime.
- Populate the Home tab's "Recent reports" card from `LocalOps::recap` over the last 24 h of events.
- In the `needs-you` card, run `LocalOps::audit_claim` on completion claims and surface `contradicted` / `inconclusive` as attention items.
- Add a project-wide "morning recap" command that generates a digest on first launch of the day (stored as a `Recap` event).

**Done when:** spine summaries + recap + audit verdicts are real local-model output, not placeholders.

### Track 13.G — Safety surfaces + Keychain (gaps G7, G11)

**Needs:** 12.C.

**Steps:**
- Build an approval inbox (either a drawer inside `ActivitySpine` or a dedicated `/inbox` route). Lists pending `ApprovalRequested` events with grant/deny actions bound to `cmd_resolve_approval`.
- Replace `BuildTab`'s `setTimeout(900)` with a real pending state that resolves only when the inbox grants.
- Add a usage chip to the topbar (`CostTracker.usage` + rate-limit signals parsed from Claude Code stream-json / stderr). Color ramps as spend approaches `CostCap.max_dollars_cents` *or* as Anthropic's own capacity warnings surface. Toggleable in settings, off by default (Decision 34). Ambient notice in the activity spine when a known 5-hour or weekly threshold is approached; hard-stop messages surface the specific limit + reset time.
- Surface `ScopeDenied` events in the inbox with the denied path and the rule that matched.
- Integrate `security-framework` (macOS Keychain) via a `SecretStore` trait; store any future agent credentials there (initial use: GitHub token discovery hint for `gh`).

**Done when:** merge / publish / deploy gates block real agent writes until the inbox approves; cost chip visibly warns before cap; Keychain is the only place secrets live.

### Track 13.H — Safety enforcement *(GA gate; detail in `security.md`)*

**Needs:** 13.G (approval inbox surface + Keychain trait must exist to build on).

**Why a separate track:** 13.G builds the UX surfaces for safety (inbox, cost chip, Keychain trait). 13.H hardens the *enforcement* — pre-write gates, binary verification, tamper-evidence, scope canonicalization. Shipping 13.G without 13.H would leave the user with a safety UI whose enforcement is advisory. GA cannot ship without 13.H.

**Steps:**

- Flip `ApprovalGate` enforcement from post-append (log-then-allow) to pre-write (check-then-append). Agent writes that fail scope or lack an approval are rejected before hitting the event log.
- Symlink-safe scope: replace relative-path glob matching with `canonicalize()` + worktree-root prefix check; reject symlinks that resolve outside the track's worktree.
- Risk-tiered gate resolution. *In-app approval* (existing 13.G surface) for routine writes; *Touch ID* (`LocalAuthentication.framework`) for irreversible-or-cross-org actions (push to new remote, merge to `main`, spend-cap raise, write outside worktree); *per-track capability grants* for first-use-per-tool in a track (grant scoped to the track; revokes on `TrackCompleted`).
- `claude` binary pinning: `SecStaticCodeCheckValidity` against Anthropic's Developer ID requirement before spawn. Refuse to start the orchestrator if the signature does not match; surface a distinctive error in the UI.
- Context manifest at turn boundaries: when net-new context enters an agent turn (new file in scope, changed `CLAUDE.md`, freshly merged doc), render a diffable manifest in the activity spine before the agent acts. Untrusted-lane content (unmerged PR, fork, non-user-authored commit) is tagged and requires an additional capability grant.
- Event schema adds `(track_id, role, claude_session_id, tool_name)` to every event; tool-call events become a first-class queryable kind.
- HMAC chain over events keyed from a session-sealed Keychain item (the Keychain trait from 13.G). Chain is domain-separated per-workspace so a compromised workspace cannot forge another's history. Periodic external anchor to a user-owned git notes ref; chain breaks surface as attention-level alerts.
- Secrets scanner on pre-write: curated `gitleaks`-equivalent ruleset for strong patterns (AWS keys, PEM blocks, GitHub tokens, Anthropic keys) blocks writes; high-entropy matches warn only, to avoid training users to click through noise.
- Secret-input mode in chat: dedicated composer affordance for pasted secrets; content is session-only, redacted from the event store, evicted from Claude's context after the agent's immediate reply.
- CSP adds `frame-ancestors 'self'`; helper IPC gets a max-frame cap + fuzz-test harness; webview lockdown audit documented.

**Done when:** a deliberately-malicious test agent cannot (a) write outside its worktree, (b) follow a symlink out of scope, (c) write a file containing a strong-pattern secret, (d) spawn against an unsigned `claude` binary, (e) tamper with event history without triggering a chain-break alert. Touch ID fires on exactly the four listed irreversible actions and nothing else. Capability grants are visible and revocable per track.

---

## Phase 14 — Sync transport *(parallel with Phase 13 or 15)* (gap G10)

**Goal:** take the event stream peer-to-peer without a server.

**Why independent:** the protocol shape is settled (see Phase 7). What's missing is a transport. None of the Phase 13 tracks care how the bits move between two Designer instances.

**Steps:**
- Pick a transport. Candidates: WebRTC data channel (Noise handshake seeded by `PairingMaterial`), direct WebSocket over LAN with mDNS discovery, or MASQUE relay. Decide in a short ADR; default proposal is WebRTC for mobile-compat.
- Implement `SyncTransport` trait; first impl is WebRTC via `str0m` or equivalent pure-Rust stack.
- Build a pairing UI: host shows a QR containing `PairingMaterial.secret`; mobile/second-desktop scans or types the 6-digit code.
- Wire `OfflineQueue.drain` on reconnect.
- Integration test: two Designer processes in the same `cargo test` sync a 20-event log bidirectionally without a server.

**Done when:** two desktop instances on the same LAN (or the same user's iPhone tethered to desktop in Phase 18) sync workspaces without a hosted relay.

---

## Phase 15 — Hardening & polish *(parallel with Phase 13 or 14)* (gaps G12–G16)

**Goal:** the quality-of-life pass that doesn't block shipping but defines the feel. Every item is independent — pick based on what the user feels most during dogfooding.

- **Mini primitives migration (G12).** Rewrite `AppShell`, `HomeTab`, `ActivitySpine`, `WorkspaceSidebar` to use `Box` / `Stack` / `Cluster` / `Sidebar` from `@designer/ui/primitives`. Eliminate inline flex.
- **Correlation/causation (G13).** When the orchestrator emits an event in response to a user action, set `causation_id` to the triggering event. The activity spine gains a "why did this happen" drilldown.
- **Pairing RNG (G14).** Swap the manual `/dev/urandom` read in `PairingMaterial::random` for `rand::rngs::OsRng`.
- **Dark-mode regression (G15).** Add a Vitest + Playwright combination that screenshot-diffs every primary surface in light + dark.
- **Auto-grow chat textarea (G16).** Replace the `minHeight` + overflow approach in `PlanTab` with a content-height reflow.
- **Event-log incrementalization.** `AppCore::sync_projector_from_log` is full-replay; once logs cross ~10k events it should incrementalize against the projector's last-seen sequence per stream.
- **15.H — Inline commenting & element annotation (G21).** Let the user reply to a specific span of an agent message in Plan, and to a specific element in Design, without typing a new whole-thread reply. See detail below.

### Phase 15.H — Inline commenting & element annotation *(detail)*

**Why:** agent responses are often long, multi-claim messages. Forcing the user to reply with one long paragraph is slow and loses the "which part" context. The same primitive unlocks Figma/Agentation-style element comments in the Design tab. Unifying both under one anchor + comment model keeps the agent-context format consistent.

**Scope:**
- **Plan tab (chat).** Hover a paragraph, list item, or code block in an agent message → "Reply" affordance appears. Clicking opens a short composer anchored to that span. Multiple anchored replies can accumulate on one message before being sent as one batch so the agent doesn't act on the first reply before seeing the rest.
- **Design / prototype tab.** Click anywhere on a rendered prototype or diagram to drop a pin + composer. Same batch semantics — replies stay local until the user sends them together. Reuses the annotation overlay from Phase 10 rather than re-inventing it.
- **Delivery to the agent.** When the user sends the batch, the outgoing message packs the anchor context with each reply. Format proposal: a fenced block per anchor, e.g. `<anchor kind="message-span" id="msg-42" quote="..."/>` or `<anchor kind="dom-point" x=... y=... selector="..."/>` followed by the reply body. The team lead sees "2 comments on your last message" with inline quotes, not one concatenated blob.

**Data model (spec impact):**
- New event kinds: `CommentDrafted` (local, not yet sent), `CommentSent` (flushes the batch as a single `MessagePosted` whose payload references anchors), `CommentAnchorResolved` (for cases where the underlying span moved or the element mutated).
- Anchor types v1: `message-span` (message id + character range or block index), `prototype-point` (normalized x/y within the iframe), `prototype-element` (stable attribute path). Anchors are stored on the comment, not on the target — the target stays append-only.
- Correlation: each `CommentSent` `MessagePosted` sets `causation_id` to the message it's commenting on, so traces can show "this reply exists because of that message."

**UX rules:**
- Batching is the default — pressing Enter on a single comment does **not** flush to the agent; an explicit "Send comments" button (or ⌘↵ while any draft has focus) flushes the batch.
- Visual state of a drafted-but-unsent comment: a small anchor dot on the target + a floating thread marker in the rail. The target message is not mutated.
- Reply context trumps chronology. When the agent gets a comment batch, its reply should thread under the commented message with inline quotes, not appear as a new bottom message. Activity spine collapses "comment batch replied" into one event.
- Keyboard parity: `r` while a message is focused opens a reply composer anchored to the focused block. Same on the prototype: arrow-key-navigate between elements, `r` drops a pin.

**Open questions (for when we pick this up):**
- Do comments on prototype variants travel with the variant, or with the design tab? Probably the variant; otherwise A vs B comments get conflated.
- Should comments be addressable in `core-docs/` (a design review artifact)? Likely yes — a resolved comment thread writes a markdown line-item to the generated report.
- How does resume handle unsent comment drafts? Spec decision needed: persist in event store as `CommentDrafted`, or keep purely in-memory and lose on resume.

**Done when:** on Plan, the user can hover any agent paragraph, leave 2–5 anchored replies, and send them as one batch that the agent receives with each reply tied to its quoted span; on Design, the user can drop 2+ element pins on a prototype and send them together, and the agent responds to each pin in context. Activity spine reflects the batch as a single `MessagePosted` with multiple anchors, not one event per comment.

---

## Phase 16 — Shippable desktop build *(gates on 13 + 15 being substantially done)* (gaps G17–G20)

**Goal:** a signed `.dmg` a user can download and install, with a supply chain posture that withstands scrutiny.

**Needs:** an Apple Developer identity (user-provided) and a host for the update channel.

Splits into two sub-tracks. Both must land before the first signed DMG leaves the build server. Detail for 16.S lives in `security.md`.

### Track 16.R — Release mechanics

- Acquire Apple Developer identity + provisioning; set up CI secrets for signing.
- First signed + notarized `.dmg` via `cargo tauri build` → `codesign` → `notarytool` (see `apps/desktop/PACKAGING.md`).
- Updater backend: signed `latest.json` on a static host (Cloudflare Pages or similar). See 16.S for the dual-key signing posture.
- Crash-report endpoint: opt-in upload to the same static host. Reports are structured JSON, stack-trace paths anonymized, diff-previewed before leaving the device; no PII fields.
- Install QA checklist run on a fresh Mac:
  - `.dmg` opens without Gatekeeper warnings.
  - First launch creates `~/.designer/`, shows onboarding, Cmd+K works.
  - Dark-mode parity visually verified.
  - Reduced-motion setting honored.
  - Offline: app starts, creates projects, writes to DB.
  - Auto-update check shown in Help menu; no silent install.

**Done when:** someone who has never run `cargo` can install Designer, link a repo, and chat with a team lead.

### Track 16.S — Supply-chain posture *(DMG gate; detail in `security.md`)*

- Blocking CI: `cargo audit`, `cargo deny`, `cargo vet` (starter trust file), `npm audit --production`, `lockfile-lint`. A PR cannot merge with an open advisory.
- SBOM (CycloneDX) generated per release; attached to each GitHub Release artifact.
- SLSA v1.0 Level 3 provenance: ephemeral CI runners + `sigstore/cosign` attestation; build logs signed.
- Updater dual-key Ed25519: primary signing key + separate revocation key, both HSM-backed (YubiKey Bio acceptable pre-scale). Documented rotation + revocation procedure.
- Separate signing identity for the Foundation helper binary (defense in depth).
- Hardened runtime entitlements committed to the repo; minimal surface — no camera, mic, location, AppleEvents, or accessibility unless justified in writing.
- `SECURITY.md`, `.well-known/security.txt`, PGP key, responsible-disclosure SLA (30-day triage, 90-day remediation target for high-severity).
- Third-party pentest scheduled to land before the first signed DMG (~$30–60k, 4–8 weeks; scope = IPC surface, webview + frontend, approval gates, supply chain, updater, helper IPC). Cadence afterward: annual + on every major-version release.
- Self-hosted CI runner hardening: ephemeral VM per job, egress allowlist, scoped short-lived GitHub tokens, quarterly rotation.

**Done when:** a fresh clone produces an identical signed artifact on a rebuild modulo Apple's notarization timestamp; the released DMG carries a verifiable SLSA provenance; every dep has passed audit gates; the pentest report is published alongside the release.

---

## Phase 17 — Team-tier trust *(gates team pricing; detail in `security.md`)*

**Goal:** cross the trust bar a buyer in procurement actually looks for — encryption at rest, fleet policy, SIEM export, revocable credentials, bug bounty — without reneging on the zero-data-collection promise.

**Why a dedicated phase:** the individual-user launch (Phase 16) stands on its own — signed, tamper-evident, no egress. Team tier adds controls that individuals don't need (MDM, SIEM, GitHub App, encrypted event fields) and which, if shipped earlier, would bloat the individual experience. Gating team pricing on these avoids inviting sensitive-data teams before the controls they rely on exist.

**Steps:**

- App-level AES-GCM on sensitive event fields (agent messages, tool outputs, captured file contents). Key is Keychain-sealed, device-only, `kSecAttrSynchronizable = false`. Workspace metadata stays unencrypted for queryability.
- Two-tier logging: default tier writes event envelopes (IDs, timestamps, costs, tool names, file paths) — no bodies. Bodies live in the encrypted store and are purged on a rolling window the user controls. Support bundles are explicit, user-reviewed exports with diff preview before leaving the device.
- MDM / admin-signed managed-preferences policy at `/Library/Managed Preferences/com.designer.app.plist`. Admin-signed policies can pin scope rules, force-enable approval tiers, restrict tool allowlists, disable specific agents fleet-wide. Policy signature verified against a compiled-in admin root.
- SIEM-ready audit-log export (JSON lines, CEF-compatible fields). User-initiated with diff preview; never network.
- Narrowly-scoped GitHub App with per-workspace grants replacing ambient `gh` token reliance; revocable per-workspace. `gh` stays as the individual-tier default; team tier defaults to the App.
- Inter-workspace isolation: per-workspace keyed HMAC domain separation on the event chain (builds on 13.H chain infrastructure).
- Bug bounty live (HackerOne or equivalent); VDP discoverable via `.well-known/security.txt`.
- Foundation helper data-deletion completeness: when a workspace is deleted, helper caches + model-session state go with it. Audit of where helper state lives, documented in `security.md`.
- SOC 2 Type I: reactive to named enterprise deals, scoped narrowly to the zero-data-collection posture. Not pursued preemptively.

**Done when:** an admin can push a signed policy that a user's Designer enforces on next launch; a security team can export an audit log for SIEM ingestion with a one-click flow; sensitive event fields are unreadable on disk without the Keychain-sealed key; the bug bounty is live with at least one external report closed.

---

## Phase 18 — Mobile *(formerly Phase 12; renumbered for clarity)* (originally spec §Mobile Strategy)

Deferred until Phase 16 ships and Phase 17 establishes team-tier trust. Planned deliverables:

- iOS client (read-only reports + approve/reject gates first).
- Light editing (redirect agents, short replies, resume sessions).
- Remote wake of desktop Claude Code sessions over the Phase 14 sync transport.

Transport security is non-negotiable and spec-level (see `security.md` and spec §5):

- Noise_XX or Signal-style double ratchet over WebRTC. Forward secrecy; post-compromise recovery.
- Device pairing by QR + short-authentication-string verification. TOFU with explicit out-of-band re-verify affordance.
- Relay is untrusted — ciphertext-only, no metadata persistence, selectable per session.

Mobile never cloud-hosts Claude. The user's desktop is always the runtime.

---

## Phase 19 — Workspace scales up *(multi-track UX, forking, reconciliation)*

**Goal:** deliver the full workspace/track model to the user. The primitive landed in Phase 13.E; this phase unlocks what it enables.

**Why a dedicated phase:** the spec commits the primitive early (Decisions 29–32) so the data shape is right from Phase 13.E onward. The UI and coordination affordances are staged into this phase to avoid over-investing before concrete use cases land in dogfooding. Can begin once Phase 16 ships; some sub-items (sequential-track succession) are small enough to pull forward into Phase 15 polish if the manager experience feels pinched before 16.

**Steps:**

- **Sequential track succession.** "Start the next track on this workspace." Preserves workspace-level context; seeds the new track with a recap of the previous one via `LocalOps::recap`. UI: a "Next track" action on a workspace whose last track just completed.
- **Parallel tracks.** Allow multiple active tracks simultaneously per workspace. Cross-track conflict detection extends the existing cross-workspace primitive (same-file-last-24h rule, scoped to a workspace's tracks).
- **Workspace lead hybrid routing (exploratory, opt-in).** v1 ships the workspace lead as a persistent Claude Code session; this phase explores selective escalation — local-model default path for routine Q&A, status, recap; Claude invoked only for consequential decisions (spec Decision 31's "future direction"). Opt-in mode in settings, not a default. Token-cost optimization, not a UX change users need to learn.
- **Track archive + history.** Completed tracks become read-only history visible in the workspace. Workspace chat can `@track:name` to reference past work.
- **Workspace forking.** Implement `WorkspaceForked` (event already reserved in Phase 13.E). UI: "Fork workspace" action; fork inherits docs, decisions, chat history as a read-only baseline. First track of the fork branches from the parent's last-merged main (default) or parent's current working state (opt-in).
- **Workspace reconciliation.** Implement `WorkspacesReconciled`: absorb one into another (copy new decisions/tracks/docs; archive the absorbed) or diverge permanently (retain lineage but stop affecting behavior).
- **Activity spine extension.** New altitude: workspace → track → agent → artifact. Spine summaries at the track level show "this track's progress" in one line.

**Done when:** a user can (a) iterate on a feature across multiple sequential tracks without manual workspace bookkeeping, (b) fork a workspace to try an alternative approach, (c) reconcile the fork back or archive it cleanly, (d) chat with the workspace lead about the feature at large and only occasionally drop into specific tracks.

**Gates on:** Phase 13.E (track primitive), Phase 13.F (local-model surfaces, for the workspace-lead default path), Phase 16 (shippable desktop, for most users; power users can dogfood earlier).

---

## Phase 20 — Parallel-work coordination layer

**Goal:** automate what Phase 13.0 did by hand. When a project intends to run N parallel workspaces / tracks toward a shared goal, Designer analyzes file contention across the intended splits, proposes a pre-integration scaffold, freezes shared contracts, assigns per-agent file ownership, and plans merge order.

**Why:** this is Designer's differentiating value at the *project* layer — the coordination work a human manager does when dividing a feature across teammates that session-scoped tools (Conductor, Crystal, Claude Code Desktop) can't. Cross-workspace conflict detection (spec §"Cross-workspace coordination") is *reactive* — this is its *proactive* counterpart. Without it, users scale horizontally by launching parallel workspaces and paying a manual coordination cost on every integration; with it, the cost collapses to a button.

**Steps:**
- **Contention analyzer.** Given a set of intended work items (e.g., "tracks D/E/F/G all land in one sprint"), enumerate the files each is likely to touch — using `core-docs/` indices, file-level ownership metadata attached to recent events, and the per-role system prompts loaded from `.claude/agents/`. Produce a contention report: shared files, shared event shapes, shared IPC surfaces.
- **Scaffold generator.** For each contention zone, propose a partition: sibling modules, per-track submodules, trait seams at shared hot spots. Emit a diff. User reviews, approves, merges — before any track agent starts.
- **Contract freezer.** Event shapes, IPC DTOs, trait interfaces that will be shared across tracks get committed in the scaffold diff. Each track agent codes against frozen types; no schema drift mid-flight.
- **Per-agent brief generator.** From the scaffold + contention report, emit a per-track brief: "you own these files, you read from these events, you implement these trait methods, you stub these cross-track hooks with `TODO(…)`." Each brief becomes the initial system prompt for the track agent.
- **In-flight drift detector.** As each track agent works, cross-track conflict detection (an extension of the existing "same file, last 24h" primitive — spec §"Cross-workspace coordination") watches for an agent editing files outside its assigned surface. Flags to the manager immediately, not at merge time.
- **Merge-order planner.** After all agents complete, produce the recommended merge order with rationale (dependency order, smallest-integration-first, etc.).
- **Auto-integration PR.** After the N track PRs merge, scaffold a follow-up integration PR that runs the cross-track tests (e.g., "chat-triggers-real-Claude ∧ spine-summarizes-real-events ∧ approval-inbox-catches-real-merge ∧ cost-chip-shows-real-spend").

**Done when:** (a) given a multi-track feature, the project layer can output a scaffold PR + per-agent briefs that make N parallel track builds collision-free without human analysis; (b) drift is detected during, not after; (c) first-use case is re-running today's Phase-13-scaffolding workflow end-to-end on a new feature and matching (or improving on) what we did by hand.

**Gates on:** Phase 13 (real runtime wired — needed so agents can actually execute), Phase 19 (multi-track primitives — Phase 20 is the manager layer above them).

---

## Phase 21 — Learning layer *(local-model session analysis → workflow proposals)*

**Goal:** turn every Claude Code session into a feedback signal that makes the next session cheaper, faster, and better-contexted — without burning Claude tokens to do it. A local-model pipeline (built on Phase 13.F's `LocalOps`) watches what actually happened and proposes editable improvements — to CLAUDE.md, rules, skills, agents, hooks, scope guards, cost caps, and context composition — that the user reviews, tweaks, and accepts on the project Home tab.

**Why a dedicated phase:** this is the "workflow" leg of the "Workflow, opinion, trust" principle and the most load-bearing differentiator above the model. Forge — a Claude Code plugin the same user already built and dogfoods daily — proves the core shape: collect → analyze → propose → generate → place, with a two-phase pipeline (deterministic Phase A scripts + LLM Phase B quality gate) and a multi-tier feedback loop. Bringing it in-product gives Designer (a) a persistent, editable proposal surface on the Home tab instead of ephemeral session-start nudges, (b) richer analysis inputs that a plugin can't see (approval-gate history, scope denials, cost-cap hits, activity spine, cross-workspace coincidences), (c) multi-project and multi-track aggregation, and (d) an obvious surface where the product visibly gets smarter over time. The local-model-only constraint is load-bearing: a passive observer that costs Claude tokens every session is a non-starter for a daily-driver cockpit.

**Prior art — Forge:** `/Users/benyamron/Desktop/coding/forge/`. Python-stdlib scripts under `forge/scripts/` (analyze-config, analyze-transcripts, analyze-memory, build-proposals, check-pending, format-proposals, cache-manager, finalize-proposals) + two subagents (`session-analyzer`, formerly `artifact-generator`) + three skills (`/forge`, `/forge:settings`, `/forge:version`) + SessionStart/SessionEnd hooks. v0.4.1 shipped; Phase 4 (quality + polish) in progress; Phase 5 (cross-project aggregation) planned. The pipeline, detector list, proposal types, calibration loop, and storage split are all load-bearing reference designs for Phase 21 — but Forge lives *inside* a Claude Code session, whereas Designer lives *around* it. The detector set below extends Forge's because Designer has richer inputs.

**Needs:** 13.F (`LocalOps` surfaces wired to the real Foundation helper), 13.D (real agent traffic — analyzing mock streams proves nothing), plus Phase 13.G (approval gate + scope guard + cost tracker surfaces existing as event streams the detectors can consume).

### Analysis inputs — what the layer reads

The local model and the deterministic detectors both read from a canonical `SessionAnalysisInput` bundle per track:

- **Event log.** The full event-sourced stream for the track: `MessagePosted`, `TaskCreated/Completed`, `ApprovalRequested/Granted/Denied`, `ScopeDenied`, `AgentSpawned/Idle`, `TrackStarted/Completed`, cost-tracker emissions. Designer owns this natively; Forge has to reconstruct it from `~/.claude/projects/<hash>/*.jsonl`.
- **Tool-call inventory.** Per-tool counts, file-path touch list, re-reads, grep repetition, bash commands executed.
- **Project configuration snapshot.** `CLAUDE.md`, `.claude/rules/*.md`, `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `.claude/settings.json`, project-level `core-docs/*.md`. Used for gap detection and staleness.
- **Project tech-stack fingerprint.** `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, formatter/linter configs (`.prettierrc*`, `eslint.config.*`, `biome.json`, `ruff.toml`, `rustfmt.toml`), test-runner configs (`jest.config.*`, `vitest.config.*`, `pytest.ini`, `cargo test`). Detectors suggest missing auto-format / auto-lint / test hooks when configs exist but hooks don't.
- **Auto-memory.** When Claude writes to `~/.claude/projects/<project>/memory/`, those notes become promotion candidates (note → rule / skill / CLAUDE.md / reference doc).
- **Approval/scope/cost history.** Designer's unique advantage over a plugin: we see the full gate log and can detect approval-gate fatigue, scope false-positives, and cost-cap hot streaks directly.
- **Cross-workspace/track overlap.** From Phase 4's `recent_overlap()` primitive and Phase 19's multi-track view.

### Two-phase pipeline (mirrors Forge's split)

**Phase A — deterministic detectors (pure Rust, zero tokens).** Implemented as functions `Detector: Fn(&SessionAnalysisInput, &DetectorConfig) -> Vec<Finding>`. Fast, reproducible, testable. Each detector has explicit threshold configs and produces evidence anchors (message-span / tool-call / file-path, reusing Phase 15.H anchor primitives). Phase A is gate-free: every finding flows to Phase B.

**Phase B — local-model synthesis + quality gate.** `LocalOps::analyze_session` runs two jobs through the Foundation helper:

1. **Quality gate.** Filters Phase A findings. Removes generic coding patterns (read→write→execute, plan→implement→test), human-in-the-loop workflows where automation would destroy valuable approval steps, duplicates, and weak-evidence findings (<3 occurrences or <2 sessions → downgrade; <1 session → drop). Transparency: emits `removal_reasons` per dropped finding.
2. **Semantic pattern finding.** Detects patterns Phase A can't see from syntax alone:
   - **Position-aware signals.** Same phrase at `turn_index: 0` = startup-routine skill candidate; same phrase after an assistant tool block = post-task workflow hook/rule candidate.
   - **Implicit preferences.** User volunteers state without being asked ("I'm on mobile", "we use pnpm") → CLAUDE.md / rule candidate.
   - **Approval-gated deliberation.** User asks → Claude explains → user says "go ahead" → pattern: "always explain before implementing, wait for explicit approval on non-trivial changes."
   - **Review-to-directive.** Claude delivers a long review → user issues a short action directive without discussion → pattern: "present reviews concisely, don't volunteer next steps."
   - Minimum evidence: 2+ instances across sessions, or 3+ within one session. Never flag single-occurrence observations.

Both jobs emit `Finding` records; Phase B output feeds proposal synthesis.

### Detectors (Phase A) — exhaustive list

Each detector ships with a `DetectorConfig { enabled, min_occurrences, min_sessions, impact_override? }` and a confidence score in `[0.0, 1.0]`. Thresholds mirror Forge where they've been validated; Designer-unique detectors call out their novelty.

| Detector | What it catches | Threshold | Output kind |
|---|---|---|---|
| `repeated_correction` | Correction keywords ("I told you", "don't use X", "we use Y not X", "scratch that") + structural negation-before-verb | 3+ occurrences across 2+ sessions, same phrasing | `feedback-rule` or `claude-md-entry` |
| `post_action_deterministic` | Claude runs Write/Edit → user's next message is a deterministic command (prettier, eslint, cargo fmt, pytest) | 5+ occurrences across 3+ sessions, safe (non-destructive) command | `hook` (PostToolUse) |
| `repeated_prompt_opening` | Session-opening user messages with >0.5 Jaccard similarity | 4+ sessions | `skill-candidate` |
| `multi_step_tool_sequence` | Same 3+ tool-call sequence in same order | 3+ identical sequences across 3+ sessions | `skill-candidate` or `agent-candidate` |
| `config_gap` | Formatter/linter/test config exists in repo but no corresponding hook in `.claude/settings.json` | Static detection; one evidence anchor per config file | `hook` (Post-format, Pre-commit, etc.) |
| `domain_specific_in_claude_md` | CLAUDE.md lines tied to a specific file extension / framework / directory | Heuristic keyword match | `rule-extraction` (move to scoped `.claude/rules/<name>.md`) |
| `rule_scope_broken` | Rules missing `paths:` frontmatter, or with `**/*` when content is domain-specific | Structural | `rule-adjustment` |
| `memory_promotion` | Auto-memory note classified as preference / convention / workflow / debugging-knowledge, not yet covered by infra | Note is persistent + not duplicated by existing config | `claude-md-entry` / `rule` / `skill` / `reference-doc` |
| `claude_md_demotion` | CLAUDE.md entries >3 lines; budget pressure when file nears 200 lines | Scales with file length (low <150, med 150–200, high >200) | `demotion` (extract to `.claude/references/<name>.md`, leave pointer) |
| `stale_artifact` | Rule / skill / agent loaded but referenced in <25% of recent sessions | 10+ sessions of history, <25% reference rate | `removal-candidate` |
| `config_conflict` | CLAUDE.md entry contradicts a rule; two skills with overlapping triggers | Semantic overlap (Phase B assists) | `conflict-resolution` |
| `approval_always_granted` **(Designer-unique)** | Same `ApprovalRequested` class granted N times with zero denials | 5+ approvals, 0 denials, deterministic operation class | `auto-approve-hook` or `scope-expansion` |
| `scope_false_positive` **(Designer-unique)** | `ScopeDenied` for a path the user then manually approved or widened immediately after | 3+ same-path denials | `scope-rule-relaxation` (with the risk note surfaced) |
| `compaction_pressure` **(Designer-unique)** | `/compact` invoked ≥1×/session consistently | 3+ sessions in a week | `context-restructuring` (demotion + rule pruning bundle) |
| `cost_hot_streak` **(Designer-unique)** | `CostTracker` shows a token-spend outlier vs the project baseline on a repeated task | Statistically above rolling p90 | `model-tier-suggestion` (prompt is expensive; consider cheaper model for this class of task) |
| `context_never_read` **(Designer-unique)** | File added to context but never cited in a tool call or quoted back to the user | 3+ sessions where the same file loads but doesn't fire | `context-trim` |
| `team_idle_overcount` **(Designer-unique)** | A teammate role is spawned but `TeammateIdle` fires within N seconds without meaningful work | 3+ sessions | `team-composition-change` (drop that role, or widen its scope) |
| `workspace_lead_routing` **(Designer-unique)** | Workspace lead (Phase 19 hybrid routing) escalates to Claude for patterns the local model should have handled | Track per-pattern escalation rate | `routing-policy-tune` |

Every detector's accept rate is tracked per project and globally. Below a rolling threshold (target: <20% accept over 10 emissions), the detector auto-downweights (`enabled: false` at project level with a "reconsider" button in settings). Mirrors Forge's skip-decay and impact-calibration mechanisms.

**Detector API — streaming, not buffered.** Signature: `Detector: Fn(&mut DetectorState, &Event) -> Option<Finding>`. Each detector processes events one at a time with bounded per-detector state; composes with the tokio event stream. The `SessionAnalysisInput` bundle is a convenience wrapper over the stream, not an in-memory replacement — nothing holds the full 10 k-event track in RAM at once. Every detector runs under `catch_unwind` and a 250 ms `tokio::time::timeout` so a single bad detector cannot block the rest of the pipeline.

**Incremental analysis.** Every detector records `last_analyzed_seq`; subsequent passes resume from there instead of re-reading the full track. A finding cache keyed by `(detector_version, window_digest)` reuses work across app restarts. Detector-version bumps opt in to historical replay, never retroactively; stale findings stay attached to the detector version that produced them.

### Proposal kinds — exhaustive list

Proposals synthesize findings into concrete, reversible edits. Each kind has a fixed target file or setting, a diff format, and a reviewer UI treatment.

| Kind | Target | Auto-loaded? | Reviewer treatment |
|---|---|---|---|
| `claude-md-entry` | CLAUDE.md (project) or `~/.claude/CLAUDE.md` (user) | Yes | One-line preview, full diff on expand |
| `feedback-rule` | `core-docs/feedback.md` (Designer convention) | Yes (Designer-specific) | Paragraph preview, full diff on expand |
| `rule` | `.claude/rules/<name>.md` with `paths:` frontmatter | Yes (scoped) | Full rule file previewed as a diff against a blank baseline |
| `hook` | `.claude/settings.json` (merged) | Yes | JSON diff; a "what this does" plain-English summary above the raw diff |
| `skill-candidate` | `.claude/skills/<name>/SKILL.md` | On match | Draft flag; user must review trigger phrases before accepting |
| `agent-candidate` | `.claude/agents/<name>.md` | On dispatch | Draft flag; reviewer surfaces tool allowlist + system-prompt excerpt |
| `reference-doc` | `.claude/references/<name>.md` or `core-docs/references/` | On demand | Full file preview; lowest-priority tier |
| `rule-extraction` | Move content from CLAUDE.md → new scoped rule | Yes (new target only) | Side-by-side diff: "before" CLAUDE.md vs "after" + new rule file |
| `demotion` | Move verbose CLAUDE.md block to a reference doc + leave a pointer | Yes (pointer only) | Budget-pressure panel: "CLAUDE.md is 214 lines; extract this 18-line block?" |
| `removal-candidate` | Delete / archive a stale rule, skill, or agent | — | "Not used in 12/15 recent sessions. Archive or delete?" |
| `conflict-resolution` | User-chosen merge between two conflicting artifacts | Varies | Three-column diff: "Artifact A" / "Artifact B" / "Proposed merge" |
| `scope-rule-relaxation` | `ScopeGuard` config in settings | Yes (core) | **Safety-gated:** risk note required; user must re-type the path to confirm |
| `auto-approve-hook` | Approval-gate bypass for a specific operation class | Yes (core) | **Safety-gated:** dry-run toggle; shows the last 5 approvals inline |
| `context-trim` | Remove a file/block from `CLAUDE.md` / rule / skill context | Yes | One-line preview: "Remove `[path]` from context — loaded but never cited in last 5 sessions" |
| `context-restructuring` | Bundled demotion + rule pruning (from `compaction_pressure`) | Yes | Multi-file diff; grouped accept/reject |
| `model-tier-suggestion` | Hint-card, not a diff: "Consider Haiku for summarize-row calls — Sonnet runs 4× cost for the same output" | — | Chart: token spend vs baseline; link to model override setting |
| `team-composition-change` | Workspace-lead team definition | Yes | Before/after team chart; evidence list per role |
| `routing-policy-tune` | Phase 19 workspace-lead routing thresholds | Yes | Slider diff + evidence log |
| `prompt-template` | Project-scoped prompt library (new surface) | — | Raw text preview; copy-to-clipboard action; "make this a skill" shortcut |

Draft-flagged kinds (`skill-candidate`, `agent-candidate`) cannot be one-click accepted — they require the user to open the editor at least once. Matches Forge's "drafts must be tested" discipline.

### Surfaces (Home tab, ambient signal, explain mode)

**Primary surface — "Learnings" section on the project Home tab.** Not a nudge; a persistent, editable dashboard. Layout:

- **Proposals list.** One card per open proposal, grouped by confidence tier (high / medium / low, collapsible). Each card: one-line description, kind badge, confidence chip, "seen in N/M sessions" support, Accept / Edit / Dismiss / Snooze actions. Expanding shows the full diff and the evidence anchors (click-to-jump to session span).
- **Config health panel.** Derived from `analyze-config`-equivalent detectors: CLAUDE.md size vs budget, rule scope distribution, stale-artifact count, config-gap count. One glance tells you whether the project's infra is drifting.
- **Top prompts view.** Read-only leaderboard of the N most-repeated prompts in the project. Columns: frequency, recency, variance. Per-row action: "make this a skill" (converts to a `skill-candidate` proposal) or "copy best phrasing."
- **Effectiveness panel.** For each applied artifact: "Rule X used in 8/10 recent sessions" or "Rule X not used in last 12 sessions — archive?" This is how the product visibly gets smarter.
- **Activity log.** Append-only list of `ProposalEmitted` / `ProposalResolved` / `ProposalExpired` — lets the user scroll back through the learning timeline.

**Ambient signal (opt-in).** The activity spine's Home-tab cluster surfaces new-proposal counts at session start without mid-session interruption. Three flavors mirror Forge's `check-pending`:

- **Proactive.** "3 new proposals since yesterday — open Home." Shown only when high-confidence proposals exist.
- **Effectiveness alert.** "Rule 'always-use-vitest' may not be working — same correction appeared 3 times since it was applied." Drives calibration.
- **Health signal.** "Designer is tracking 23 sessions on this project. All 5 applied artifacts effective." Low-priority; shown when nothing else is.

**Explain mode (reverse direction).** The user clicks any rule / skill / CLAUDE.md entry / hook and asks "why is this here?" → Designer traces back to the evidence anchors that produced it (if it came from a Phase 21 proposal) or marks it as user-authored. Implements Forge's planned P5. Reuses Phase 15.H's anchor primitive for the evidence pointers.

**Inline acceptance (opt-in, bounded).** The Plan-tab composer gains a one-line "Forge-style" affordance when a just-completed task produced a high-confidence proposal: a single card appears inline above the composer with "Accept / Edit / Skip." Bounded: max one inline proposal per chat turn, never more than 2 per session, opt-out in settings. This is the *only* place proposals interrupt the main flow.

### Settings (per-project + user-level; mirrors Forge)

- **Nudge frequency.** `quiet` (no session-start signal; proposals only visible on the Home tab) · `balanced` (default; signal when proposals pending or every 5+ new sessions) · `eager` (every 2+ sessions).
- **Proactive inline acceptance.** On / off. Default off until dogfooding confirms the rate-limit is comfortable.
- **Detector enable map.** Per-detector on/off + threshold override, surfaced in settings but collapsed by default. Power-user escape hatch.
- **Write-scope.** Per-project default. `project-only` (writes to `core-docs/feedback.md`, `.claude/*`, project settings) · `user-ok` (may elevate cross-project patterns to `~/.claude/CLAUDE.md` after explicit confirmation).
- **Model tier for analysis.** Defaults to the small Foundation model. Power users can opt into a larger local tier for slower-but-better synthesis.
- **Redaction policy.** Evidence anchors are full quotes by default. User can toggle to "redacted snippets" (first 40 chars + ellipsis) for screen-shareable Home tabs.

All settings are event-sourced (`LearningSettingChanged`), so changes are auditable and reversible.

### Storage split (mirrors Forge's shared/personal divide)

- **Shared, in-repo (git-tracked):** `core-docs/feedback.md` entries, applied `.claude/rules/*`, `.claude/skills/*`, `.claude/agents/*`, `.claude/references/*`, `.claude/settings.json` hook merges. These are team-portable.
- **Project-level, gitignored:** `.designer/learning/dismissed.json`, `.designer/learning/applied-history.json`, `.designer/learning/feedback-signals.json`. Useful for teammates to avoid resurfacing patterns already decided on, but personal enough to keep out of git by default (like Forge's `.claude/forge/`, but Designer defaults to gitignore — the user can opt to track them).
- **User-level, machine-local:** `~/.designer/learning/analyzer-stats.json`, `~/.designer/learning/projects/<hash>/cache/deep-analysis.json` (24 h TTL), `~/.designer/learning/projects/<hash>/settings.json`. Never synced cross-device except via Phase 14.
- **Content-addressable diff store** (`~/.designer/learning/diffs/<sha>.patch`). `ProposalEmitted` carries the `diff_sha`; the diff blob lives on disk. Keeps `events.db` small, enables natural dedup across proposal resurfaces, and makes the event log cheap to replicate over Phase 14 sync.
- **Spotlight + Time Machine exclusions.** `~/.designer/learning/cache/` and `~/.designer/learning/diffs/` carry the `com.apple.metadata:com_apple_backup_excludeItem` xattr plus a `.metadata_never_index` sentinel. Indexing and backing up derived caches is pure overhead.

### Calibration loop (three mechanisms)

1. **Skip decay.** A proposal snoozed 3+ times without action is silently dropped from pending. Mirrors Forge's skip-decay.
2. **Impact calibration.** If >40% of dismissals for a `kind` cite "low impact," the synthesis step deflates future proposals of that kind from high → medium.
3. **Safety gate.** 3+ "missing safety note" dismissals OR 3+ "added approval gate" modifications on a `kind` trigger a persistent safety label on that kind's future proposals — reviewer sees the label + the original reason text.

Each mechanism updates an `AnalyzerStats` projection. Stats are visible in settings under "Detector health" — turns the learning layer into a debuggable system, not a black box.

### Scheduling and resource budget

**Core framing.** Local-model work is scheduled by urgency × power state, not run continuously. Phase A detectors (Rust, zero LLM) are always on; LLM passes are *triggered*. An extra turn or two of latency on a rare signal is an accepted cost; a constantly-warm model pinning RAM and denying the CPU deep sleep is not. The benefit of deferring work is sustained **thermal headroom** (fans don't spin, P-cores stay in deep sleep, chassis stays cool) more than raw watts — active ANE inference is 3–7 W, an idle session single-digit watts.

**Tiers.**

| Tier | Trigger | Wakes the model? | Deferral policy |
|---|---|---|---|
| 0 — Always-on | Every event | No | Never defers; ~1 ms/event Rust detectors only |
| 1 — Wake-on-threshold | Phase A finding crosses confidence + support gate | Yes, debounced 30–60 s, batched | Deferred under `.serious` thermal or battery <30 % |
| 2 — End-of-track | `TrackCompleted` event | Yes, single synthesis pass | Deferred on battery <30 %; queued for next charger connection |
| 3 — Periodic | Weekly cross-project aggregation | Yes, low-priority | Runs on charger + display-sleep; skippable without functional loss |
| 4 — On-demand | User-triggered (counterfactual preview, ad-hoc NL detector, explain mode) | Yes, immediately | User pays latency; ignores quiet-hour rules |

**Model lifecycle.** Two sizes. A small quantized classifier (sub-1B, ~400 MB) stays warm during active sessions for Phase A→B gating and cheap semantic checks. The larger synthesis model is loaded on demand and released by terminating the Swift helper after 5 min idle. Never both warm simultaneously. Important nuance: the Apple Foundation Models model itself is *system-managed* and shared across apps — our "unload" releases the helper's `LanguageModelSession` handle; the underlying model may stay warm system-wide (shared with Safari, Mail, Photos). Activity Monitor will not show the ~400 MB RSS drop users might expect from an "unload" label. MLX fallback is different: that model's RSS *is* ours, and killing the helper genuinely releases it. Messaging must reflect this, not overclaim.

**Power-state awareness — native APIs, not polling.**
- `NSProcessInfo.thermalState` → `.nominal | .fair | .serious | .critical`. At `.serious`+, drop Tier 2/3.
- `NSProcessInfo.isLowPowerModeEnabled` → user said "save battery." Collapse to Tier 0 only; don't second-guess.
- `IOPSGetProvidingPowerSourceType` + `IOPSGetTimeRemainingEstimate` → charger vs battery detection; defer Tier 2+ when battery <30 min remaining.
- Subscribe to `NSProcessInfoThermalStateDidChangeNotification` and `NSProcessInfoPowerStateDidChange`; never poll.
- Display sleep (`CGDisplayIsActive(CGMainDisplayID())`) is a more reliable Tier-3 trigger than keyboard idle.

**QoS classes, not custom throttling.** Tier 2 runs at `DispatchQoS.utility`; Tier 3 at `.background`. Apple Silicon pins these to efficiency cores and the OS auto-pauses them under system pressure. Declare intent; let the OS enforce. Don't fight App Nap when Designer is backgrounded — that's free scheduling we want.

**Compute budget.** Hard daily cap on active inference wall-time (default: 10 min, user-adjustable). Measured with the monotonic clock (`std::time::Instant` / `mach_continuous_time`), never wall-clock — clock-change attacks don't grant or steal budget. Visible in the topbar next to the cost chip: "Local model: 3 min used / 10 min budget." Exceeding queues to next day or prompts.

**Hardware capability gates.** Boot-time probe via `FoundationHelper::capabilities()`. Requires Apple Silicon + macOS 26+ + Apple Intelligence enabled + ≥8 GB RAM. On `NSProcessInfo.physicalMemory < 12 GB`, Tier 2/3 default to *disabled* with an opt-in toggle; docs explain that enabling them on 8 GB machines can slow other apps. If capability check fails, Phase A still runs (≈80 % of value) and the Home tab surfaces "Semantic analysis requires Apple Intelligence — deterministic detectors still active" rather than silently no-opping.

**Helper crash circuit breaker.** Exponential backoff restart (1 s → 5 s → 30 s → 5 min); circuit-break after 3 failures in 10 min and surface as a settings health indicator. A crashlooping helper is the single worst battery-drain failure mode — must be contained.

**Re-mapped opportunities.** Where earlier "what token-freeness unlocks" items land on the tier table:

| Opportunity | Tier | Notes |
|---|---|---|
| Continuous / live analysis | 0 + 1 | Rust detectors always; LLM only on threshold |
| Multi-pass synthesis (generator → critic → judge) | 2 | Bundled with end-of-track; proposals are rare |
| Evidence verification pass | 2 | Bundled with synthesis |
| Embedding-based dedup of findings | 3 | Periodic re-index, not per-finding |
| Negative-signal detectors | 2 | Semantic; runs once per track |
| Counterfactual preview | 4 | User-paid latency |
| Ad-hoc NL detectors | 4 | User-paid |
| Richer explain-mode narratives | 4 | User-paid |
| Fine-tuning on accept/dismiss signals | **Out of scope** | Too expensive for local hardware; revisit in a later phase |

### Reliability and observability

**Idempotency.** `ProposalResolved` with Accept carries an idempotency key `(proposal_id, resolution_kind)`; duplicate writes are no-ops. Side-effect apply events (`RuleFileWritten`, `SkillCreated`, …) check a "last-applied digest" before writing so double-click Accept, retry-after-timeout, and sync races all converge on one side-effect.

**Transactional boundary (apply flow).** Write-then-emit: the file write happens first; the side-effect event is appended only on success. On failure, the pipeline emits `ApplyFailed { proposal_id, reason }` and the Home tab surfaces a retryable banner. The event log and the repo are never allowed to disagree.

**Multi-device conflict resolution.** A proposal can be Accepted on desktop and Dismissed on mobile before Phase 14 sync reconciles. Deterministic rule: the resolution event with the earliest monotonic timestamp wins; ties break by device ID. `ProposalResolved` records `device_id` + `resolved_at_monotonic`.

**Partial-failure containment.** Each detector runs under `catch_unwind` with a 250 ms `tokio::time::timeout`. Panics emit `DetectorFailed { detector, reason }`; timeouts emit `DetectorTimedOut { detector, elapsed_ms }`; the remaining detectors proceed. Same isolation per Phase B pass.

**Schema evolution.** Every event type carries an explicit `schema_version` discriminator. `Finding` and `Proposal` structs are versioned independently of events. Detectors are versioned; stale findings stay attached to the detector version that produced them, with opt-in replay when a version bumps. Projections are rebuildable from scratch — event log is truth, projection is cache, snapshot is lazy cache of cache.

**Projection snapshots.** `open_proposals`, `artifact_effectiveness`, and `analyzer_stats` are snapshotted periodically (every N events or every T seconds). First-boot latency becomes O(events since snapshot), not O(history) — stays under 500 ms even on a project with 100 k+ events.

**Prompt + model + OS versioning.** Every `SessionAnalyzed` records `(prompt_version, fm_version, os_version)`. fm bumps invalidate caches but never retroactively re-evaluate historical findings. Matches event-sourcing orthodoxy: past is immutable.

**Claude session ID mapping.** Claude's session IDs aren't stable across `/resume`; evidence anchors use Designer's event seq as the stable reference. A `ClaudeSessionRemapped { old_session_id, new_session_id, first_event_seq }` event keeps the mapping table. Phase B runs a best-effort re-anchor pass on resume so long-lived anchors survive session renumbering.

**Observability surface.** `tracing` spans on every detector and Phase B pass; `metrics` counters for analysis latency, detector accept rate, model wake frequency, queue depth, helper crash rate, compute-budget consumption. A settings → "Detector health" panel reads the same projections the Home tab reads — turns the learning layer into a debuggable system, not a black box.

**Phase B test story.** Foundation output is non-deterministic, so classic unit tests don't work. Instead: a golden-findings corpus pinned to a fm_version; a `designer analyze --replay <session>` CLI that re-runs historical analyses and diffs output against the corpus; snapshot drift surfaces as CI failure on fm bumps. The corpus lives in `crates/designer-learning/fixtures/`, versioned in the repo.

### Event shape (spec impact)

```
SessionAnalyzed { session_id, track_id, input_digest, phase_a_findings, phase_b_findings, removed_count, removal_reasons, duration_ms, model_version }
ProposalEmitted { proposal_id, kind, detector, evidence: Vec<AnchorRef>, diff, confidence, support, expires_at }
ProposalResolved { proposal_id, resolution: Accepted { applied_diff, side_effect_event_id } | Edited { final_diff, side_effect_event_id } | Dismissed { reason? } | Snoozed { until } }
ProposalExpired { proposal_id }
LearningSettingChanged { key, old, new }
AnalyzerStatsUpdated { detector, accept_rate, dismiss_rate, skip_rate }

// Side-effect events (emitted when a proposal is applied):
FeedbackRuleAdded { path, content }
RuleFileWritten { path, content }
SkillCreated { path }
AgentCreated { path }
HookMerged { settings_path, hook_config }
ReferenceDocCreated { path }
ClaudeMdEdited { path, diff }
ScopeRuleChanged { rule_id, old, new }
CostCapChanged { workspace_id, old_cap, new_cap }
ContextTrimmed { source_file, removed_block }
ArtifactArchived { path, reason }

// Reliability / observability events:
DetectorFailed { detector, reason }
DetectorTimedOut { detector, elapsed_ms }
ApplyFailed { proposal_id, reason }
ClaudeSessionRemapped { old_session_id, new_session_id, first_event_seq }
ProjectionSnapshotWritten { projection, up_to_seq, path }
HelperCrashed { reason, restart_attempt }
HelperCircuitBroken { until }
ComputeBudgetExceeded { budget_sec, used_sec, queued_tasks }
```

Every event carries an explicit `schema_version` discriminator. Proposal diffs are stored by hash (`diff_sha`), not inline — `ProposalEmitted` carries the hash and the blob lives in `~/.designer/learning/diffs/`. All events are append-only; the Home tab reads projections (`open_proposals`, `recent_learnings`, `artifact_effectiveness`, `analyzer_stats`), snapshotted periodically for cold-start latency.

### Steps

**Minimum viable slice (L0–L5).** Ship the vertical first: `LocalRuntime` primitive, Phase A scaffolding with 4 detectors, Phase B synthesis + quality gate, proposal synthesis, Home-tab "Learnings" section, and the apply path. That's the smallest thing that proves the end-to-end loop — session analyzed, proposal emitted, user accepts, repo changes, next session reflects it — and it's the cut we'd put behind a feature flag for dogfooding. Everything after L5 (ambient signal, inline acceptance, Designer-unique detectors, cross-project aggregation, calibration, explain mode, effectiveness tracking, observability polish, content-addressable diff migration, scheduling polish, capability-downgrade UX) is valuable but defers cleanly — ship when dogfooding identifies the specific gap each step fills.

- **L0 — Shared `LocalRuntime` primitive.** A reusable runtime every future local-model surface builds on (Phase 13.F jobs today, Phase 21 detectors next, future voice / live-coach features after). Owns: helper lifecycle (spawn + heartbeat + crash-recovery with exponential backoff and circuit breaker), QoS-aware tier scheduler wired to the native thermal/power/low-power notifications, Apple Intelligence + hardware-memory capability gate, compute-budget accounting via monotonic clock, per-detector `catch_unwind` + `tokio::time::timeout` harness, two-stage model lifecycle (small classifier warm + large synthesis on demand), and the Phase B `--replay` + golden-findings test harness. Phase 21's scheduler becomes a thin policy layer over this primitive. Most of this isn't Phase-21-specific; factoring it out now avoids retrofitting when the next local-model feature lands.
- **L1 — `SessionAnalysisInput` bundle + Phase A detector scaffolding.** Define the input struct, event-stream extractor, and the `Detector` trait. Ship 4 detectors first: `repeated_correction`, `post_action_deterministic`, `repeated_prompt_opening`, `approval_always_granted`. Each with tests against canned event logs.
- **L2 — Phase B local-model synthesis + quality gate.** `LocalOps::analyze_session(input)` routes to the Foundation helper with a frozen, versioned prompt. Output: `AnalyzeSessionResult { filtered_findings, additional_findings, removal_reasons }`. Prompt pins covered in an ADR; model version recorded in the event so traces stay reproducible.
- **L3 — Proposal synthesis.** `LocalOps::synthesize_proposal(finding) -> Proposal`. Generates the concrete diff per proposal kind (CLAUDE.md append, rule file creation, hook JSON, skill/agent frontmatter+body, etc.). Safety gates and confidence tiering applied here.
- **L4 — Home tab "Learnings" section.** Proposals list, config health panel, effectiveness panel, activity log. Accept / Edit / Dismiss / Snooze actions wired to command handlers. Edit opens the proposed diff in an in-app composer.
- **L5 — Application layer.** Accepted proposals emit the concrete side-effect event and write to the correct path (project repo for shared, `~/.designer/` for personal, `~/.claude/` for user-scope with explicit consent). Reversible via the standard event-log undo surface.
- **L6 — Top prompts view + prompt templates.** Reuses `repeated_prompt_opening` output. Adds frequency / recency / variance columns and a "make this a skill" shortcut that converts to a `skill-candidate` proposal.
- **L7 — Ambient signal + effectiveness alerts.** Session-start signal generator; `artifact_effectiveness` projector that flags "applied but not used" rules/skills.
- **L8 — Inline-at-chat acceptance (opt-in).** The one-per-turn, bounded inline card in Plan-tab composer. Gated by setting; off by default.
- **L9 — Designer-unique detectors.** Add `scope_false_positive`, `compaction_pressure`, `cost_hot_streak`, `context_never_read`, `team_idle_overcount`, `workspace_lead_routing`. Each requires event-stream fields Phase 13.D/G surface.
- **L10 — Cross-project aggregation.** Scheduled weekly local-model pass elevates strong single-project patterns into user-scope proposals. Explicit consent to write outside the project boundary. Unlocks what Forge P5 planned but didn't ship.
- **L11 — Calibration loop.** Skip decay, impact calibration, safety gate. Detector accept-rate tracked per project and globally; auto-downweight below threshold. Settings → "Detector health" view for transparency.
- **L12 — Explain mode.** Click any rule / skill / CLAUDE.md entry / hook → trace to the originating proposal and its evidence anchors. Implements Forge P5.
- **L13 — Applied-artifact effectiveness tracking.** For every accepted proposal, track reference count across subsequent N sessions. Low-reference artifacts surface as `removal-candidate` proposals. Closes the learning loop: the system learns which of its own suggestions worked.
- **L14 — Observability + test harness.** Wire `tracing` + `metrics` on every detector and synthesis pass. Ship the "Detector health" settings panel reading the `AnalyzerStats` projection. Build the golden-findings corpus under `crates/designer-learning/fixtures/` + `designer analyze --replay <session>` CLI that surfaces snapshot drift as CI failure on fm bumps.
- **L15 — Content-addressable diff storage.** Hash-keyed diff store under `~/.designer/learning/diffs/<sha>.patch`. `ProposalEmitted` carries `diff_sha`, not inline diffs. Migrate any inline diffs from earlier iterations; add Spotlight + Time Machine exclusion xattrs on the diff and cache dirs.
- **L16 — Prioritized scheduling polish.** Confidence-ordered queue (high-confidence proposals synthesize first under tight budget; low-confidence defer to charger + idle). Opportunistic precompute on charger-connect + thermal-nominal drains the deferred queue proactively. WAL-friendly batched `ProposalEmitted` writes per synthesis pass (one transaction per batch).
- **L17 — Capability-downgrade UX.** Boot-time capability probe surfaces an explicit degraded state on the Home tab ("deterministic detectors only; semantic analysis requires Apple Intelligence — enable instructions below") rather than silently no-opping. Re-probes on OS update, Apple Intelligence toggle, and RAM-tier change (external boot into a different machine). Capability changes emit `LearningCapabilityChanged` events so the degradation is auditable.

### Product-principle checks

- **Manager, not engineer:** proposals are plain-language cards, not config forms. The user's job is "accept / tune / dismiss / snooze."
- **Claude Code is the runtime:** the learning layer never calls Claude. Analysis and synthesis are 100% local. Accepted proposals may change what Claude sees next session; nothing here runs on Claude tokens.
- **Workflow, opinion, trust:** this phase *is* the workflow leg. The opinions are the detector thresholds and the synthesis prompt. Trust is earned by the calibration loop (auto-downweight, safety gate) and by every side-effect being reversible.
- **Context lives in the repo:** every accepted proposal's side-effect lands in `core-docs/*.md`, `.claude/*`, `CLAUDE.md`, or settings — never in a DB-shadowed "learnings" store. Mirrors Forge's placement discipline.
- **Summarize by default, drill on demand:** Home cards are one-line; evidence, diff, and trace are behind a click.
- **Suggest, do not act (by default):** no proposal self-applies; auto-expire only archives, never edits. Safety-gated kinds (`scope-rule-relaxation`, `auto-approve-hook`) require typed confirmation.

### Open questions (before picking this up)

- **Granularity of a "session."** Track-level is the default; a noisy multi-day track should be sub-divided. Proposal: introduce a `SessionWindow { track_id, start_event_seq, end_event_seq }` so the analyzer can work on arbitrary slices without changing detector code.
- **Dedup window.** How long does an emitted-but-unresolved proposal suppress a new one for the same pattern? Default 7 days per kind, overridable.
- **Anchor durability across resume.** Phase 15.H anchors handle in-memory spans; resumed sessions need those anchors to survive re-entry via `CommentAnchorResolved`-style fallback.
- **Runaway-proposal risk.** Rate-limit: max N active proposals per project (default 12); lowest-confidence age out first. Inline-at-chat is separately capped.
- **Skill / agent generation scope.** Project-first writes by default (`<project>/.claude/skills/`) with an "elevate to global" action on Accept. Matches cross-project aggregation.
- **Redaction for screen-share.** Evidence quotes can contain sensitive strings. Settings toggle exists; do we also auto-redact common patterns (emails, API-key shapes)? Probably yes, with a deny list.
- **Team-portable proposals.** A future-facing question — can two teammates co-approve a proposal via the synced event log (Phase 14)? Out of scope for v1, but the event shapes don't preclude it.
- **Forge coexistence.** During migration, a user might run both Forge (plugin) and Designer (learning layer) against the same project. Detection: check for `.claude/forge/` and surface a "Forge proposals detected — import into Designer?" banner. Out of scope for v1 but the event shape should accommodate imported proposals with `source: "forge"`.
- **Desktop / mobile resolution conflict.** Proposal Accepted on desktop + Dismissed on mobile before Phase 14 sync reconciles: earliest monotonic resolution wins, ties break by device ID. Confirm that's acceptable UX before Phase 14 ships — or introduce a "pending reconciliation" banner on the losing device.
- **Apply-failed retry UX.** After `ApplyFailed`, does the Home tab retry silently, surface a banner, or both? Default proposal: surface once, silent retry on next app boot, persistent banner after 3 consecutive failures.
- **Historical re-evaluation on detector upgrades.** When a detector's version bumps, do we re-run against historical sessions? Opt-in per bump, never automatic — expensive in compute and could resurface dismissed findings that the user already decided against.
- **8 GB machine default.** Default-disable Tier 2/3 with opt-in, or default-enable with a throttled budget (3 min/day vs 10 min/day)? Requires dogfooding data on base-model MacBook Airs before committing.

### Done when

- Every completed track emits a `SessionAnalyzed` event within ~1 min of completion, produced entirely by the local model. Phase A detectors run in <500 ms for a 10 k-event track.
- The Home tab "Learnings" section shows ≥3 real, specific, repo-grounded proposals on a project after a week of dogfooding — not generic "consider adding more context" nudges.
- All 18 detector kinds in the table above fire at least once during dogfooding and produce at least one accepted proposal each.
- Accepting a proposal measurably changes the next session: new rule observed by Claude, new skill fires, trimmed CLAUDE.md block absent from the prompt, scope relaxation no longer triggers a false denial, approved operation no longer gates.
- Top prompts view ranks repeated prompts and successfully converts at least one to a skill.
- Effectiveness panel identifies at least one "applied but unused" artifact and surfaces it as a `removal-candidate` proposal that the user acts on.
- Calibration loop auto-downweights at least one detector during dogfooding; user can re-enable it from settings.
- Explain mode traces an existing rule back to its originating session and evidence anchors.
- Cross-project aggregation elevates at least one pattern from project to user scope after explicit consent.
- Zero Claude tokens spent on any analysis pass; verifiable in the cost chip.
- Privacy: `rm -rf ~/.designer/learning/ <project>/.designer/learning/` removes every learning-layer artifact Designer created outside the user's repo. In-repo artifacts (`core-docs/`, `.claude/`) are theirs.
- `LocalRuntime` capability probe correctly identifies Apple Silicon / macOS 26+ / Apple Intelligence / RAM tier; degraded-state UI renders when any gate fails; Phase A still produces findings on degraded machines.
- Helper-crash chaos test: killing the Swift helper 10× in a 10-min window trips the circuit breaker and surfaces a settings health indicator without draining battery (measured: no sustained >5 % CPU during the crashloop).
- Idempotency test: double-clicking Accept, and accepting the same proposal on two synced devices, each produce exactly one side-effect event.
- Transactional test: simulating a disk-full condition on Accept leaves the event log and repo in agreement — no spurious `RuleFileWritten` — and surfaces `ApplyFailed` with a retryable banner.
- Partial-failure test: panicking one detector does not block the other 17 or the synthesis pass; timing-out detector does not consume > 250 ms of pipeline wall-time.
- Compute budget: 10 min/day cap enforced against the monotonic clock; system-clock-change attacks don't grant or steal budget.
- First-boot latency: projection snapshots keep cold start under 500 ms even with 100 k+ events in history.
- Tier scheduler behaves under pressure: `.serious` thermal state, Low Power Mode, and battery <30 % each demonstrably defer Tier 2/3 work within one notification cycle.

**Gates on:** Phase 13.D (real agent traffic), Phase 13.F (`LocalOps` wired to the real Foundation helper), Phase 13.G (approval / scope / cost event streams), and — for the shared `LocalRuntime` primitive itself — concurrent landing with Phase 13.F since they share the same substrate. Can ship before Phase 19 or Phase 20; early steps (L0–L4) are pullable forward during Phase 15 polish if dogfooding surfaces strong patterns worth automating earlier.

---

## Milestones (summary)

| Milestone | Phases | Parallel? | State |
|---|---|---|---|
| Architecture de-risked (abstractions) | 0, 1, 2 | — | ✅ Preliminary build |
| Safety infrastructure in place | 3, 4 | — | ✅ Preliminary build |
| Local-model ops working (source) | 5 | — | ✅ Preliminary build |
| Multi-workspace + sync protocol | 6, 7 | — | ✅ Preliminary build |
| First user-visible surface | 8, 9 | — | ✅ Preliminary build |
| Design lab + polish scaffolding | 10, 11 | — | ✅ Preliminary build |
| **Real-integration validated** | **12.A, 12.B, 12.C** | **Yes (3 tracks)** | **12.A ✅ 2026-04-22; 12.C ✅ 2026-04-21; 12.B infrastructure landed, real-hardware validation pending** |
| Pre-track scaffolding | 13.0 | — (single PR) | Pending |
| Real runtime wired | 13.D, 13.E, 13.F, 13.G | Yes (after 13.0) | Pending |
| **GA safety enforcement** | **13.H** | After 13.G | **Pending — blocks GA** |
| Sync transport | 14 | Yes (parallel with 13/15) | Pending |
| Hardening + polish | 15 | Yes (parallel with 13/14) | Pending |
| Shippable desktop beta | 16.R + 16.S | After 13 + 15 | Blocked on Apple Developer ID; 16.S blocks signed DMG |
| **Team-tier trust** | **17.T** | After 16 | **Pending — gates team pricing** |
| Mobile | 18 | After 14 + 16 + 17 | Phase 2 |
| Workspace scales up (multi-track, forking) | 19 | After 13 + 16; parts pullable into 15 | Pending |
| Parallel-work coordination layer | 20 | After 13 + 19 substantially complete | Pending |
| Learning layer (local-model workflow proposals) | 21 | After 13.D + 13.F; independent of 14/16/18/19/20 | Pending |

---

## What this roadmap does not include

- Marketing, pricing, distribution strategy — separate document when that phase arrives.
- Team hiring — assumed solo for now.
- Anthropic partnership conversations — may become relevant before public launch; tracked in backlog.
- Detailed Linear / Jira / Figma integration scoping — parked until Phase 6+ demonstrates the coordination primitives.
