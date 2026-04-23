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

Phase 13 — Wire the real runtime            (5 tracks, gated individually)
  ├─ 13.D  Agent wire                    (← 12.A + 12.C)
  ├─ 13.E  Track primitive + git wire    (← 12.C)   [introduces Track]
  ├─ 13.F  Local-model surfaces          (← 12.B + 12.C)
  ├─ 13.G  Safety surfaces + Keychain    (← 12.C)
  └─ 13.H  Safety enforcement            (← 13.G)   [GA gate; see security.md]

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
- **Phase 13** — Wire the real runtime. Five tracks (D: agent wire, E: git + repo linking, F: local-model surfaces, G: safety surfaces + Keychain, H: safety enforcement / GA gate). D–G gated on specific Phase-12 tracks and largely parallelizable; H gates on G and blocks GA. See `security.md` for 13.H detail.
- **Phase 14** — Sync transport. Independent; can run concurrently with Phase 13 or 15.
- **Phase 15** — Hardening + polish (Mini primitives, correlation IDs, dark-mode regression, auto-grow textarea, pairing RNG, event-log incrementalization). Independent; all six items are parallelizable.
- **Phase 16** — Shippable desktop build. Splits into 16.R (Apple Developer ID, signed `.dmg`, update channel, crash-report endpoint, install QA) and 16.S (supply-chain posture — blocking audit CI, SBOM, SLSA, dual-key updater, pentest, SECURITY.md). Gates on 13 + 15; Phase 14 optional for MVP. Signed DMG blocked until 16.S lands. Detail in `security.md`.
- **Phase 17** — Team-tier trust. Encryption at rest, MDM policy, SIEM export, bug bounty, narrowly-scoped GitHub App, inter-workspace isolation. Gates team pricing. Detail in `security.md`.
- **Phase 18** — Mobile (formerly Phase 12; renumbered). Requires Phase 14 in full, Phase 16, and the E2EE-with-untrusted-relay constraint from `security.md`.
- **Phase 19** — Workspace scales up: multi-track UX, forking, reconciliation, workspace-lead routing policy. Primitive lands in Phase 13.E; this phase ships the user-visible affordances. Gates on 13 + 16; pullable into 15 partial.

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

## Phase 13 — Wire the real runtime *(four tracks, gated individually)*

**Goal:** turn the "scaffold that demos the UX" into "a product that actually does the thing." Each track replaces a stubbed frontend path with a real backend call.

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
| Real runtime wired | 13.D, 13.E, 13.F, 13.G | Yes (after Phase 12) | Pending |
| **GA safety enforcement** | **13.H** | After 13.G | **Pending — blocks GA** |
| Sync transport | 14 | Yes (parallel with 13/15) | Pending |
| Hardening + polish | 15 | Yes (parallel with 13/14) | Pending |
| Shippable desktop beta | 16.R + 16.S | After 13 + 15 | Blocked on Apple Developer ID; 16.S blocks signed DMG |
| **Team-tier trust** | **17.T** | After 16 | **Pending — gates team pricing** |
| Mobile | 18 | After 16 + 17 + 14 | Phase 2 |
| Workspace scales up (multi-track, forking) | 19 | After 13 + 16; parts pullable into 15 | Pending |

---

## What this roadmap does not include

- Marketing, pricing, distribution strategy — separate document when that phase arrives.
- Team hiring — assumed solo for now.
- Anthropic partnership conversations — may become relevant before public launch; tracked in backlog.
- Detailed Linear / Jira / Figma integration scoping — parked until Phase 6+ demonstrates the coordination primitives.
