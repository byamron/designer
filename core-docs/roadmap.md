# Roadmap

Backend-first phasing. Infrastructure, safety, orchestration, and local-model ops ship before any user-visible surface. The frontend is built on top of a working, tested core — not alongside an evolving one.

This document sequences the work described in `spec.md`. It is the single source of truth for "what's next"; `plan.md` tracks near-term focus; `history.md` records what shipped. Security-specific work — threat model, invariants, and the 13.H / 16.S / 17.T tranches — lives in `security.md` and is referenced from the phase sections below.

> **Current top priority (2026-04-30): Dogfood Push.** Three parallel lanes (DP-A distribution + auto-updater, DP-B chat pass-through, DP-C reliability audit + flag/hide) converge into a `v0.1.0` dogfood build, followed by a sequential UI bug sweep + Friction reliability check (DP-D). Detail and lane assignments live in `plan.md` § Dogfood Push. The phase sequence below resumes after the push lands.

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
  ├─ 13.D  Agent wire                    (← 12.A + 12.C + 13.1)  [emits message + agent artifacts] ✅
  ├─ 13.E  Track primitive + git wire    (← 12.C + 13.1)         [emits code-change + pr] ✅
  ├─ 13.F  Local-model surfaces          (← 12.B + 12.C + 13.1)  [emits report + comment; wires prototype] ✅
  ├─ 13.G  Safety surfaces + Keychain    (← 12.C + 13.1)         [emits approval + comment] ✅
  ├─ 13.H  Phase 13 hardening pass       (← 13.D/E/F/G integration) [F1–F4 production wiring]
  └─ 13.I  Safety enforcement            (← 13.H)                [GA gate; see security.md]

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

Phase 22 — Project Home redesign  (Recent Reports / Roadmap / Designer Noticed / Merge queue)
  ├─ 22.G  Color system (axiom #3 amendment)        [pullable into 15.x; gates team-tinted UI]
  ├─ 22.B  Recent Reports redesign                  (← 13.F report artifact; independent of 22.A)
  ├─ 22.A  Roadmap canvas foundation                (← 13.E track primitive)
  ├─ 22.I  Track completion + shipping history      (← 22.A + 13.E)
  ├─ 22.D  Edit & proposal flow                     (← 22.A)
  ├─ 22.E  Adjacent attention column                (← 22.A + 22.D + 13.G safety surfaces)
  ├─ 22.H  Click-into-agent                         (← 22.A + 13.D)
  ├─ 22.C  Roadmap origination                      (← 22.A; minimal — empty + paste only)
  ├─ 22.N  Merge queue                              (← 13.E + 13.G + 20 + 22.A; 22.E soft gate)
  ├─ 22.N.1 Merge queue — UI craft + Tier-2 → 22.E   (← 22.N + 22.E)
  ├─ 22.F  Designer Noticed                         **satisfied by Phase 21** — see cross-ref
  └─ 22.L  Phase 20 hookup                          [delivered as part of Phase 20, not 22]

Considered, deferred (NOT on roadmap):
  · Linear integration (read or write)              [interop, not moat — revisit only on explicit user signal]
  · Designer Noticed five-category re-skin          [defer until 21.A1.2 dogfood signal motivates it]
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
- **Phase 13** — Wire the real runtime. Two prerequisite sub-phases (13.0, 13.1) plus six tracks (D: agent wire, E: git + repo linking, F: local-model surfaces, G: safety surfaces + Keychain, H: Phase 13 hardening pass / F1–F4 production wiring, I: safety enforcement / GA gate). D–G gated on 13.1 plus their Phase-12 inputs and ran in parallel after 13.1; H gates on the D/E/F/G integration; I gates on H and blocks GA. **All four parallel tracks shipped 2026-04-25 and integrated via meta-PR [#20](https://github.com/byamron/designer/pull/20) on 2026-04-26.** 13.H wires the four production gaps the integration review surfaced: stdio reader → `permission_handler.decide()` (F1), `PermissionRequest::workspace_id` population (F2), `ClaudeSignal::Cost` subscriber (F3), `core_git::check_track_status` routing through `append_artifact_with_summary_hook` (F4). 13.I covers pre-write enforcement, binary pinning, tamper-evidence — see `security.md`.
- **Phase 14** — Sync transport. Independent; can run concurrently with Phase 13 or 15.
- **Phase 15** — Hardening + polish (Mini primitives, correlation IDs, dark-mode regression, auto-grow textarea, pairing RNG, event-log incrementalization). Independent; all six items are parallelizable.
- **Phase 16** — Shippable desktop build. Splits into 16.R (Apple Developer ID, signed `.dmg`, update channel, crash-report endpoint, install QA) and 16.S (supply-chain posture — blocking audit CI, SBOM, SLSA, dual-key updater, pentest, SECURITY.md). Gates on 13 + 15; Phase 14 optional for MVP. Signed DMG blocked until 16.S lands. Detail in `security.md`.
- **Phase 17** — Team-tier trust. Encryption at rest, MDM policy, SIEM export, bug bounty, narrowly-scoped GitHub App, inter-workspace isolation. Gates team pricing. Detail in `security.md`.
- **Phase 18** — Mobile (formerly Phase 12; renumbered). Requires Phase 14 in full, Phase 16, and the E2EE-with-untrusted-relay constraint from `security.md`.
- **Phase 19** — Workspace scales up: multi-track UX, forking, reconciliation, workspace-lead routing policy. Primitive lands in Phase 13.E; this phase ships the user-visible affordances. Gates on 13 + 16; pullable into 15 partial.
- **Phase 20** — Parallel-work coordination layer. Project-level primitive that analyzes contention across multiple workspaces / tracks running in parallel, partitions shared files, freezes contracts (events, IPC DTOs, trait seams), generates a pre-integration scaffold, and plans merge order. Automates what Phase 13.0 did by hand. Gates on 13 + 19 substantially complete.
- **Phase 21** — Learning layer: local-model analysis of session transcripts produces editable workflow + context optimization proposals on the project Home tab. Gates on 13.D + 13.F (needs real agent traffic and working local-model surfaces).
- **Phase 22** — Project Home redesign. Reshapes the project Home tab into three surfaces — **Recent Reports** (curated digest of shipped work), **Roadmap** (live plan-anchored canvas with team presence), **Designer Noticed** (already in flight as Phase 21) — and adds a fourth: **Merge queue** (cross-PR conflict-resolution train, 22.N + 22.N.1). The shippable-v1 cut is 22.G + 22.B + 22.A + 22.I + 22.D + 22.E + 22.H + 22.C + 22.N — each independently shippable. Phase 22.F (Designer Noticed surface) is **satisfied by Phase 21.A1.2** (proposals over findings, boundary-driven cadence) — do not duplicate; the spec's five-category re-skin is **deferred until dogfood signal** on the existing surface motivates it. **Linear integration is cut entirely** from v1 (interop ≠ moat — revisit only on explicit user signal). 22.L is delivered as part of Phase 20, not Phase 22. Gates: 22.B on 13.F; 22.A on 13.E; 22.D on 22.A; 22.E on 22.A + 22.D + 13.G; 22.N on 13.E + 13.G + 20 + 22.A (22.E is a soft gate — v1 ships an inline Tier-2 surface, 22.N.1 migrates to 22.E once it lands).

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
| G5 | `create_workspace` doesn't create a track (worktree + branch) | `GitOps` wired but never called from UI; no track on disk. Resolution introduces the Track primitive per spec Decisions 29–30. **Resolved 2026-04-25 (13.E):** `Track` aggregate + projection, `cmd_start_track` calls `init_worktree`, `gh pr create` automation, edit-batch coalescer. | 13.E ✅ |
| G6 | Local-model jobs (`recap`, `audit_claim`, `summarize_row`) have no caller | Activity spine summaries, morning recap, audit verdicts all stubbed | 13.F |
| G7 | ~~Approval resolution surface is a `setTimeout` in BuildTab~~ ✅ closed 2026-04-25 (PR #19) | `InboxPermissionHandler` parks each prompt on a `oneshot`; `ApprovalBlock` resolves via `cmd_resolve_approval` with optimistic UI + projector truth | 13.G ✅ |
| G8 | No repo-linking UI or file picker | User can't point Designer at a codebase. **Resolved 2026-04-25 (13.E):** `RepoLinkModal` in onboarding final slide + Settings → Account; `cmd_link_repo` canonicalizes + validates path. | 13.E ✅ |
| G9 | No user-repo file persistence (`core-docs/*.md`) | Spec calls for docs-in-repo; only `events.db` is written today. **Resolved 2026-04-25 (13.E):** `start_track` seeds `core-docs/{plan,spec,feedback,history}.md` and commits them on the new branch. | 13.E ✅ |
| G10 | No sync transport (WebRTC / relay / pairing QR) | Protocol types exist, no wire | 14 |
| G11 | ~~Keychain integration missing~~ ✅ closed 2026-04-25 (PR #19) | `security-framework` read-only check for Claude Code's OAuth credential; Settings → Account renders presence + last-verified time. Decision 26 — Designer never reads contents and never writes | 13.G |
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
- ~~`PreToolUse` approval-gate spike~~ ✅ landed in 13.G via `InboxPermissionHandler` — stdio permission prompts now route through the user inbox with a 5-min timeout.
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

### Track 13.D — Agent wire (gaps G4) — landed 2026-04-25

**Needs:** 12.A + 12.C + 13.1.

**Shipped:**
- New `cmd_post_message(workspace_id, text, attachments)` IPC. Wrapper in `commands_agents.rs`; async fn in `ipc_agents.rs`; registered in `main.rs`'s `tauri::generate_handler!` (alphabetical). DTOs (`PostMessageRequest` / `PostMessageAttachment` / `PostMessageResponse`) in `crates/designer-ipc/src/lib.rs`.
- `AppCore::post_message` dispatches to `Orchestrator::post_message` first; on success, persists `MessagePosted { author: User }` + `ArtifactCreated { kind: Message, author_role: "user" }` synchronously. Lazy-spawns a `team-lead` team on `TeamNotFound` for the demo / first-message flow. The dispatch-first ordering rules out duplicate user artifacts on retry after orchestrator failure.
- Boot-spawned message coalescer in `core_agents.rs::spawn_message_coalescer` (called from `main.rs::setup`): subscribes to `orchestrator.subscribe()`, drops user echoes, accumulates per-(workspace, author_role) bursts, flushes one `ArtifactCreated { kind: Message }` per burst at 120 ms idle (`DEFAULT_COALESCE_WINDOW`; tests override via `DESIGNER_MESSAGE_COALESCE_MS`). Tasks hold `Weak<AppCore>` so they don't leak across test boots.
- New `OrchestratorEvent::ArtifactProduced { workspace_id, artifact_kind, title, summary, body, author_role }` variant — broadcast-only; `event_to_payload` returns `None`. AppCore is the single writer of `EventPayload::ArtifactCreated`. MockOrchestrator emits this for keyword-matched ("diagram" / "report") prompts; real Claude tool-use translation lands per-tool (TODO(13.D-followup) marker in `crates/designer-claude/src/stream.rs::translate_assistant`).
- `WorkspaceThread.onSend` awaits `ipcClient().postMessage`. Synchronous `useRef` re-entry guard prevents concurrent dispatch on rapid double-clicks. On error: typed `IpcError` translated by `packages/app/src/ipc/error.ts::describeIpcError` (cost-cap / scope-deny / etc. each get distinct copy); draft restored via `composeRef.current?.setDraft(payload.text)` + refocus; alert banner surfaces the message.
- Foundation fix needed by the above: `SqliteEventStore::append` now uses `transaction_with_behavior(Immediate)` (DEFERRED transactions deadlock under concurrent writers in WAL mode with `SQLITE_LOCKED`, which `busy_timeout` can't retry); `PRAGMA busy_timeout=5000` added to per-connection init. `IpcError` enum variants converted to struct form so the tagged-union representation actually serializes (newtype-tuple variants fail at runtime).
- Tests: 6 cargo (round-trip, coalescer-drops-echoes, coalescer-separates-keys, no-artifact-on-failure, oversized-text, ArtifactProduced-broadcast-only) + 5 vitest (postMessage shape, empty-draft guard, restores-draft-on-failure, ignores-concurrent-sends, refreshes-on-production-stream-id).

**Deferred to 13.D-followup or downstream tracks:**
- `tool_use` / `tool_result` content blocks in `ClaudeStreamTranslator` — currently dropped with a `TODO(13.D-followup)` marker. Per "summarize by default, drill on demand," these should at minimum emit `ArtifactProduced` summaries; wiring lands per-tool as Claude tool-use shapes are observed.
- Attachment byte storage. The IPC accepts `attachments: Vec<PostMessageAttachment>` and logs at WARN; no storage path yet.
- "Agent is typing…" liveness indicator. ADR 0001 deferred this; revisit once real subprocess timing is observed in 13.E/F/G integration.

**Original spec for reference:** the pre-13.D plan was to replace `PlanTab`'s `ackFor()` with `ipcClient().postMessage(...)`. PlanTab was retired in 13.1 (spec Decision 36); the unified `WorkspaceThread` is the surface that now owns the send path.

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

### Track 13.G — Safety surfaces + Keychain (gaps G7, G11) ✅ *landed 2026-04-25*

**Needs:** 12.C.

**Shipped (PR #19):**
- `InboxPermissionHandler` (in `crates/designer-claude/src/inbox_permission.rs`) replaces `AutoAcceptSafeTools` as the production permission handler via `ClaudeCodeOrchestrator::with_permission_handler()`. Every Claude permission prompt parks the agent on a per-request `tokio::sync::oneshot` channel with a 5-minute deadline. Resolutions resolve via `cmd_resolve_approval`; timeouts emit `ApprovalDenied{reason:"timeout"}` and tell the agent to deny. Boot-time `sweep_orphan_approvals` auto-denies any `ApprovalRequested` without a matching grant/deny (reason `"process_restart"`) so the inbox doesn't surface phantom rows after restart.
- `ApprovalBlock` (already-rendered Phase 13.1 surface) wired to `cmd_resolve_approval` with optimistic flip + projector-truth via `approval_granted/denied` stream subscription. Buttons disabled when payload lacks a parsable `approval_id`. The earlier `BuildTab` `setTimeout` stub was retired with the tab refactor — there is no dedicated build tab in the post-13.1 unified workspace thread.
- `CostChip` (`packages/app/src/components/CostChip.tsx`) in the workspace topbar shows `$<spent> / $<cap>` with a colored band (50% green / 80% amber / >80% red). Off by default per Decision 34; toggle in Settings → Preferences. `CostTracker::replay_from_store` runs at boot so `cost_status` reflects historical spend across restarts.
- Scope denials: `record_scope_denial` emits both `ScopeDenied` (audit) and a `comment` artifact anchored to the offending change (UX). The artifact appears inline in the workspace thread, non-blocking.
- macOS Keychain integration (`security-framework = { … default-features = false }`, `[target.'cfg(target_os = "macos")']`). **Read-only per Decision 26** — `get_generic_password` only confirms the credential is present. Never reads secret contents, never writes. The handler does **not** introduce a `SecretStore` trait — Designer doesn't store agent secrets; the only credentials in the Keychain are Claude Code's own OAuth, which Anthropic owns end-to-end. Settings → Account renders the credential's presence + last-verified time. Service name overridable via `DESIGNER_CLAUDE_KEYCHAIN_SERVICE` for non-default Claude installs.

Five new Tauri commands: `cmd_list_pending_approvals`, `cmd_get_cost_status`, `cmd_get_keychain_status`, `cmd_get_cost_chip_preference`, `cmd_set_cost_chip_preference`. `cmd_request_approval` is an explicit error stub — the IPC was forgeable from the webview, and the only legitimate producer of approval requests is the orchestrator's `InboxPermissionHandler`. Single-writer guarantee in `resolve` (atomic-remove-then-write) prevents contradictory terminal events for one approval id; resolutions write to the workspace stream so subscribers see them on the same stream as the request. `gate.status` stays truthful via `GateStatusSink` — the inbox handler notifies the in-memory `InMemoryApprovalGate` after each resolve via a desktop-side `GateSinkAdapter`. Boot-time `gate.replay_from_store` keeps the legacy gate-trait surface honest across restarts.

See `history.md` 2026-04-25 entry for the full design rationale, the post-merge security review fixes (cmd_request_approval injection, sweep race, single-writer ordering, stream consistency, missing-workspace audit row, gate-status drift, cost-replay), and the test coverage that locked them down.

### Track 13.H — Phase 13 hardening pass ✅ *(landed 2026-04-26)*

**Needs:** 13.D + 13.E + 13.F + 13.G integration meta-PR [#20](https://github.com/byamron/designer/pull/20) merged ✅ 2026-04-26.

**Shipped:** all five items (F1 + F2 + F5 + F3 + F4) in one sequential PR. ~500 LOC across `crates/designer-claude` (`stream.rs`, `claude_code.rs`, `orchestrator.rs`, `mock.rs`), `crates/designer-safety/src/cost.rs` (new `record()` method), and `apps/desktop/src-tauri/src/{core.rs, core_git.rs}` (cost-subscriber task + `boot_with_orchestrator` test seam + summary-hook routing). Five new tests lock the wire format + invariants: stdio prompt routes to decide / spawn-not-await invariant / workspace_id populated / tool_use → ArtifactProduced / cost subscriber records to store / git status routes through hook. Quality gates green (fmt / clippy / test --workspace / tsc / vitest).

**Why this track is the gating step before dogfooding:** the four parallel tracks shipped against the mock orchestrator. With real Claude Code, the moment the agent wants to use any tool (`Read` / `Edit` / `Write` / `Bash`) it sends a stdio permission prompt that nothing in `claude_code.rs::reader_task` answers — the agent hangs until Claude's internal timeout (~10 min). **Until F1+F2 land, real-Claude usage is "first text reply works, then everything stalls."** F3/F4 add cost tracking and on-device summarization but are not gating; F5 (tool-use surfacing in the thread) is a UX completeness fix the PR 17 review flagged.

**Parallelization decision: ONE workspace, sequential.** The 13.D/E/F/G fan-out made sense because each track was 1500+ LOC of orthogonal domain work. 13.H is ~500 LOC of cohesive runtime hardening, three of the five items live in the same two files (`crates/designer-claude/src/{stream,claude_code}.rs`), and the integration cost of parallel branches (six-agent review, conflict resolution, doc merging) is real — we just paid it for the meta-PR. The remaining two items (F3, F4) are each ~50 LOC of independent file work and finish faster serially in the same workspace than they would as separate PRs. Recommended internal sequence: **F1 → F2 (one-line plumbing) → F5 → F3 → F4**.

#### F1 — Wire `permission_handler.decide()` into the stdio reader *(hard blocker, ~1.5 days)*

Without this, no real Claude tool use works.

| File | Change |
|---|---|
| `crates/designer-claude/src/stream.rs` | Add `TranslatorOutput::PermissionPrompt { id, tool, input, summary }` variant. Add a parse arm in the translator for Claude's `--permission-prompt-tool stdio` request shape. Capture three new JSON fixtures from `scripts/probe-claude.sh --permission-prompt` (Write / Edit / Bash) under `crates/designer-claude/tests/fixtures/permission_prompt/`. |
| `crates/designer-claude/src/claude_code.rs::reader_task` | Match new arm; spawn `tokio::task` to call `self.permission_handler.decide(req)` so the reader stays unblocked; on resolve, encode `{"behavior":"allow"}` or `{"behavior":"deny","message":"..."}` and send through `stdin_tx`. The writer task already exists; just adds one channel send per prompt. |
| `crates/designer-claude/tests/permission_prompt_translator.rs` | Three fixture-based round-trip tests (translate fixture → assert variant fields). |
| `crates/designer-claude/src/claude_code.rs` (test module) | `stdio_permission_prompt_routes_to_decide`: synthetic Claude stdout, assert `decide` called once with expected tool/input, assert writer's stdin receives the encoded response. |

**Critical implementation note:** `decide()` must be spawned (not awaited inline) on the reader-task. The handler can park for up to 5 minutes; awaiting inline would block the stream-json reader and stall every other event from Claude during that window (text replies, rate-limit signals, idle notifications). The reader's loop must keep draining `BufRead::read_line()` while the approval is pending. Pattern: `tokio::spawn(async move { let decision = handler.decide(req).await; let reply = encode(decision); stdin_tx.send(reply).await; })`. The `stdin_tx` is `mpsc::Sender<Vec<u8>>` (already exists at `claude_code.rs:98`, cloneable).

**Note on F2 site:** there is currently no production constructor of `PermissionRequest` (only test fixtures at `permission.rs:162` and `inbox_permission.rs:386`). F2 is "make sure F1's new construction site populates `workspace_id`" rather than "fix an existing line." Plumb `spec.workspace_id` from the per-team handle (`claude_code.rs:380-410`) through to the reader's spawn closure.

Acceptance: `cargo test -p designer-claude --test permission_prompt_translator` and `cargo test -p designer-claude claude_code::tests::stdio_permission_prompt_routes_to_decide` green.

#### F2 — Populate `PermissionRequest::workspace_id` *(trivial, ~5 min — folds into F1's PR)*

Without this, F1 routes prompts but `InboxPermissionHandler::decide` fail-closes on `workspace_id.is_none()` with `MISSING_WORKSPACE_REASON`, surfacing in audit but not in the inbox.

| File | Change |
|---|---|
| `crates/designer-claude/src/claude_code.rs::reader_task` | When constructing the `PermissionRequest` at the F1 site, set `workspace_id: Some(spec.workspace_id)`. The team-spec is already in scope. |
| `crates/designer-claude/src/claude_code.rs` (test module) | `permission_prompt_carries_workspace_id`: round-trip a parsed prompt; assert the field is populated. Lock guard against future regression. |

#### F5 — Tool-use translator + ArtifactProduced emission *(folds into F1's PR; same files)* — formerly the PR 17 review's `TODO(13.D-followup)`

Today `ClaudeStreamTranslator::extract_assistant_text` extracts only `text` content blocks from assistant messages, dropping `tool_use` blocks entirely. Result: the user sees Claude's narration but never which tool was invoked — only the approval block in the inbox tells them, and the thread reads as discontinuous. This breaks the "summarize by default, drill on demand" principle for tool transparency.

| File | Change |
|---|---|
| `crates/designer-claude/src/stream.rs` | Extend `extract_assistant_text` to also surface `tool_use` blocks. Two options: (a) emit one `OrchestratorEvent::ArtifactProduced { kind: Report, title: format!("Used {tool}"), summary: <input snippet>, ... }` per `tool_use` block; (b) emit a new `Tool` artifact kind. Option (a) is the lower-friction choice since `Report` already has a registered renderer; promote to a typed `Tool` kind in a future ADR if churn warrants it. |
| `crates/designer-claude/src/stream.rs` (test module) | Fixture with mixed text + tool_use blocks; assert one `MessagePosted` for text + one `ArtifactProduced` per tool_use. |
| **Stretch (in-scope if time permits):** correlate `tool_use_id` → eventual `tool_result` in the next user-turn. Emit `ArtifactUpdated` on the original `Report` artifact with the result's summary. Stateful translator field; ~50 LOC. If skipped, file as `TODO(13.H+1)` with a clear marker. | |

Acceptance: a real Claude session that invokes Write + Edit + Bash produces three `Report` artifacts in the thread alongside the assistant's narration text, **before** the F1 permission prompts fire.

#### F3 — Subscribe `ClaudeSignal::Cost` to `CostTracker::record` *(independent, ~half day)*

Without this, the cost chip reads `$0.00` forever and the cap check silently allows a workspace to spend past its budget.

| File | Change |
|---|---|
| `crates/designer-claude/src/orchestrator.rs` | `subscribe_signals()` currently lives on the concrete `ClaudeCodeOrchestrator` (line 169) but **not** on the `Orchestrator` trait. Add `fn subscribe_signals(&self) -> broadcast::Receiver<ClaudeSignal>` to the trait with a default impl returning a never-firing receiver, so `MockOrchestrator` doesn't have to plumb a real signal channel for tests that don't need it. |
| `crates/designer-claude/src/mock.rs` | Override the default with a real `signal_tx` field so the F3 test can inject `ClaudeSignal::Cost`. ~10 LOC. |
| `apps/desktop/src-tauri/src/core.rs::AppCore::boot` | After orchestrator construction, call `orchestrator.subscribe_signals()` and spawn a `tokio::task` holding `Weak<AppCore>` that loops `recv()` and on `ClaudeSignal::Cost { workspace_id, total_cost_usd }` calls `core.cost.record(workspace_id, total_cost_usd, …)` and writes `EventPayload::CostRecorded` via `store.append`. The `Weak` upgrade gracefully terminates the task when the core drops. |
| `crates/designer-safety/tests/gates.rs` (or new `crates/designer-safety/tests/cost_subscriber.rs`) | `signal_subscriber_records_to_store`: boot `AppCore` with a `MockOrchestrator` that exposes a manual `signal_tx`; broadcast `ClaudeSignal::Cost { workspace_id, total_cost_usd: 0.42 }`; poll `cost_status(workspace_id).spent_dollars_cents == 42`; assert `CostRecorded` event in store. |

Acceptance: cost chip increments in the topbar after each agent turn that emits a `result/success` line.

#### F4 — Route `core_git::check_track_status` through `append_artifact_with_summary_hook` *(independent, ~half day)*

Without this, code-change rail summaries show raw `+12 −3 across 2 files` instead of on-device LLM lines like `"Refactored Tauri command registration to alphabetize handlers."`.

| File | Change |
|---|---|
| `apps/desktop/src-tauri/src/core_git.rs::check_track_status` | Replace the direct `self.store.append(EventPayload::ArtifactCreated { … kind: CodeChange … })` with `self.append_artifact_with_summary_hook(ArtifactDraft { … })`. The hook (defined in `core_local.rs`) already handles the 500ms deadline + late-return ArtifactUpdated + per-track debounce. The seam is opt-in by call site; this just opts the git-emitted code-change artifact in. |
| `apps/desktop/src-tauri/src/core_git.rs` (test module) | `check_track_status_routes_through_summary_hook`: counting `LocalOps` mock injected via the hook seam; assert one `summarize_row` call per `CodeChange` emit. |

Acceptance: the rail's edit-batch summary reads as the on-device LLM line on AI-capable hardware, or the deterministic 140-char fallback elsewhere — never the raw diff stat.

#### Test additions summary table

| Test | F-item | What it locks down |
|---|---|---|
| `claude_code::tests::stdio_permission_prompt_routes_to_decide` | F1 | `decide` called once, response written through stdin |
| `permission_prompt_translator::*` (3 fixtures) | F1 | Translator parses Write / Edit / Bash prompt JSON |
| `claude_code::tests::permission_prompt_carries_workspace_id` | F2 | `workspace_id` field populated; regression guard |
| `stream::tests::tool_use_block_emits_artifact_produced` | F5 | Mixed text + tool_use → MessagePosted + ArtifactProduced |
| `signal_subscriber_records_to_store` | F3 | Cost broadcast → in-memory + persisted |
| `check_track_status_routes_through_summary_hook` | F4 | Counting LocalOps mock asserts hook usage |
| `tests/claude_live.rs::permission_prompt_round_trip` *(`--features claude_live`)* | F1+F2+F4+F5 | End-to-end real Claude smoke; gated by self-hosted runner |

#### Other test gaps surfaced by the integration review *(file as separate test-only PR before GA; some fold cheaply into 13.H)*

- **Frontend Playwright + screenshot-diff harness** — already on Phase 15's list; pull forward to catch regressions in the integration UI surfaces (CostChip color bands, RepoLinkModal focus trap, ApprovalBlock state transitions, dark-mode rendering). Recommend opening this as a parallel PR while 13.H's backend work happens.
- **`SummaryDebounce` concurrent-burst race** — third caller arriving mid-flight after `Resolved` lands but before the next request.
- **`TabOpened` double-apply regression** — projector-vs-broadcast race; opens N tabs in sequence and asserts `workspace.tabs.len() == N`. The integration review caught one flaky failure here; pre-existing, not introduced by 13.D/E/F/G.
- **`cmd_list_pending_approvals` perf regression test** — once the in-memory `pending_ids()` join optimization lands, assert it returns without an event-log scan.
- **`cost_status` boundary test** — `cap_dollars_cents=0 && spent=0` should return `None` (no-spend hold), not `Some(1.0)` (currently silently red-banded).
- **`tools/invariants/check.mjs` in CI** — the UI regression review flagged that the design-language invariants checker exists but isn't run in any CI workflow. Add to `.github/workflows/ci.yml::frontend` job. ~5-line change.

#### Acceptance for 13.H as a whole

- `cargo test --workspace` 30 test groups (no regressions).
- `cargo test --workspace --features claude_live` (self-hosted runner) — `permission_prompt_round_trip` green.
- Manual dogfood: open the Tauri app with `cargo tauri dev`, create a workspace, link the Designer repo itself, send "read CLAUDE.md and summarize it" — assistant's narration appears in the thread, an `ArtifactProduced { kind: Report, title: "Used Read" }` lands inline, the inbox surfaces an approval, granting it unblocks the agent, the response streams back, the cost chip increments.
- All quality gates (fmt / clippy / test / tsc / vitest) green.

#### After 13.H ships

The app is genuinely runnable end-to-end against real Claude Code. Open issues become **user-driven** (real workflow friction, not infrastructure gaps). The natural next step pivots from infrastructure to either Phase 14 (sync transport) or Phase 15 polish — driven by what dogfooding surfaces.

#### Post-13.H reality (2026-04-26)

PR #23 (real-Claude default + workspace cwd + isolated claude_home + preflight) and PR #24 (`/Applications`-launch fixes: claude PATH resolution, body scroll lock, titlebar zone, `CreateProjectModal` replacing the broken `window.prompt`, path validation + tilde expansion) shipped on the same day, both surfaced bugs that no test harness caught. Lessons applied: every "phase done" claim should now be smoke-tested with a fresh `cargo tauri build && open /Applications/Designer.app` cold launch, not just `cargo tauri dev`. See `history.md` for the full retros.

### Track 13.I — Safety enforcement *(GA gate; detail in `security.md`)*

**Needs:** 13.G (approval inbox + scope-deny path + Keychain status surface must exist to build on).

**Why a separate track:** 13.G builds the UX surfaces for safety (inbox, cost chip, scope-denied comment artifact, Keychain status row) and the production permission handler that routes every Claude prompt through the user. 13.I hardens the *enforcement* — pre-write gates, binary verification, tamper-evidence, scope canonicalization, and a Designer-owned Keychain item for the HMAC chain key (separate from Claude's OAuth credential, which 13.G only reads metadata from). Shipping 13.G without 13.I would leave the user with a safety UI whose enforcement is advisory. GA cannot ship without 13.I.

**Steps:**

- Flip `ApprovalGate` enforcement from post-append (log-then-allow) to pre-write (check-then-append). Agent writes that fail scope or lack an approval are rejected before hitting the event log.
- Symlink-safe scope: replace relative-path glob matching with `canonicalize()` + worktree-root prefix check; reject symlinks that resolve outside the track's worktree.
- Risk-tiered gate resolution. *In-app approval* (existing 13.G surface) for routine writes; *Touch ID* (`LocalAuthentication.framework`) for irreversible-or-cross-org actions (push to new remote, merge to `main`, spend-cap raise, write outside worktree); *per-track capability grants* for first-use-per-tool in a track (grant scoped to the track; revokes on `TrackCompleted`).
- `claude` binary pinning: `SecStaticCodeCheckValidity` against Anthropic's Developer ID requirement before spawn. Refuse to start the orchestrator if the signature does not match; surface a distinctive error in the UI. **Required substory (don't ship without it — flagged in the 2026-04-28 safety review):** (1) the pinned identity (Apple TeamID + designated requirement string) lives in a versioned manifest at `crates/designer-claude/src/anthropic_signing.rs`, not buried in code; (2) updating the manifest is a documented procedure with test fixtures, so a Claude Code release that rotates Anthropic's signing identity has a known turn-around path (Designer point release within 24h); (3) install-source variance documented — verify the npm-installed native binary path resolution (`~/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js` shim → resolve to the bundled native helper before checking signature); fail-closed with an actionable error for unrecognized install paths (e.g. user-built-from-source) plus a settings escape hatch (`safety.allow_unsigned_claude_binary = true`, off by default, requires Touch ID to flip). Ship without this story and a routine Anthropic key rotation bricks every Designer install.
- Context manifest at turn boundaries: when net-new context enters an agent turn (new file in scope, changed `CLAUDE.md`, freshly merged doc), render a diffable manifest in the activity spine before the agent acts. Untrusted-lane content (unmerged PR, fork, non-user-authored commit) is tagged and requires an additional capability grant.
- Event schema adds `(track_id, role, claude_session_id, tool_name)` to every event; tool-call events become a first-class queryable kind.
- HMAC chain over events keyed from a session-sealed Keychain item — a *new* Designer-owned generic-password entry (e.g. `com.designer.event-chain`), distinct from Claude Code's `Claude Code-credentials` entry that 13.G only reads metadata from. Chain is domain-separated per-workspace so a compromised workspace cannot forge another's history. Periodic external anchor to a user-owned git notes ref; chain breaks surface as attention-level alerts.
- Secrets scanner on pre-write: curated `gitleaks`-equivalent ruleset for strong patterns (AWS keys, PEM blocks, GitHub tokens, Anthropic keys) blocks writes; high-entropy matches warn only, to avoid training users to click through noise.
- Secret-input mode in chat: dedicated composer affordance for pasted secrets; content is session-only, redacted from the event store, evicted from Claude's context after the agent's immediate reply.
- CSP adds `frame-ancestors 'self'`; helper IPC gets a max-frame cap + fuzz-test harness; webview lockdown audit documented.

**Done when:** a deliberately-malicious test agent cannot (a) write outside its worktree, (b) follow a symlink out of scope, (c) write a file containing a strong-pattern secret, (d) spawn against an unsigned `claude` binary, (e) tamper with event history without triggering a chain-break alert. Touch ID fires on exactly the four listed irreversible actions and nothing else. Capability grants are visible and revocable per track.

---

### Lane 0 — ADR addendum: additive `EventPayload` extensions *(prereq for 13.K + 21.A1; ~30 min)*

Both Track 13.K (`FrictionReported`, `FrictionLinked`, `FrictionFileFailed`) and Phase 21.A1 (`FindingRecorded` or similar) add new variants to `crates/designer-core/src/event.rs::EventPayload`. ADR 0002 §"Frozen contracts" forbids extending event shapes without an ADR. **Append to ADR 0002 (or land a new ADR 0004) before either implementation begins**:

> Additive `EventPayload` variants are non-breaking and permitted under this rule, provided (a) no existing variant is modified, (b) the new variant is documented inline in `event.rs`, (c) all production projector arms include `_ => {}` defaults already (verified: `projection.rs:354`), (d) old `events.db` files written before the variant exists replay correctly (proof: pattern-match arms can't fail on a variant that never appears in the stream).
>
> Modifying or removing existing variants still requires `EventEnvelope.version` bump + migration plan.

This unblocks both tracks. Without it, Friction and 21.A1 race to add variants without coordination.

---

### Track 13.K — Friction *(internal feedback capture; P0 for dogfood capture; ~3 days for a single agent)*

**Why P0:** Designer just landed in `/Applications` for daily-driver use (PR #24). The user's friction with the app is the single most valuable input signal for everything that follows — every Phase 15.J polish item, the Phase 15.K onboarding pass, even the Phase 21 learning layer's training data. **Without an in-app capture, friction goes unrecorded.** Forge-style end-of-session retros are too coarse for the kind of "this button is in the wrong place" / "this affordance isn't discoverable" signal we need. Friction lives next to the user's hand, captures element-anchored notes mid-flight, and exports them as actionable GitHub issues.

**Inspiration:** `agentation`'s visual-feedback toolbar — already wired into Designer's dev mode (`packages/app/src/App.tsx`). Agentation is SaaS-backed and only renders in dev; Friction replaces it for production-build dogfooding with a local-first, GitHub-integrated path that doesn't depend on a third-party service.

#### Locked contracts (frozen by this spec)

The shapes below are normative — implementing agents do not redesign them. They're locked here because Friction, Phase 15.H inline-comments, and Phase 21 finding evidence all share the `Anchor` enum.

**Shared `Anchor` enum** — `packages/app/src/lib/anchor.ts` (TypeScript) + `crates/designer-core/src/anchor.rs` (Rust mirror, same shape):

```ts
export type Anchor =
  | { kind: "message-span"; messageId: string; quote: string; charRange?: [number, number] }
  | { kind: "prototype-point"; tabId: string; nx: number; ny: number }
  | { kind: "prototype-element"; tabId: string; selectorPath: string; textSnippet?: string }
  | { kind: "dom-element"; selectorPath: string; route: string; component?: string; stableId?: string; textSnippet?: string }
  | { kind: "tool-call"; eventId: string; toolName: string }
  | { kind: "file-path"; path: string; lineRange?: [number, number] };

export function anchorFromElement(el: Element, route: string): Anchor;
export function resolveAnchor(a: Anchor): Element | null;  // null if stale
```

13.K uses the `dom-element` variant. Resolution priority for `selectorPath`: (1) existing `data-component` attrs, (2) `data-block-kind` attrs, (3) stable `data-id`/`data-workspace-id`/`data-track-id` attrs, (4) structural CSS path as last resort. **Do NOT introduce a new `data-friction-id` attribute** — reuse the existing component-annotation surface. (Lane 1 prereq below adds `data-component` to the top ~30 surfaces if not already present; some are.)

**`EventPayload` additions** (additive per Lane 0 ADR):

```rust
FrictionReported {
    friction_id: FrictionId,
    workspace_id: Option<WorkspaceId>,
    project_id: Option<ProjectId>,
    anchor: Anchor,
    body: String,
    screenshot_ref: Option<ScreenshotRef>,    // Local(PathBuf) | Gist { url, sha256 }
    route: String,
    app_version: String,
    claude_version: Option<String>,
    last_user_actions: Vec<String>,           // last 5 from projector
    file_to_github: bool,                     // user toggle at submit time
}
FrictionLinked { friction_id: FrictionId, github_issue_url: String }
FrictionFileFailed { friction_id: FrictionId, error_kind: FrictionFileError }
FrictionResolved { friction_id: FrictionId }   // local-only resolution
```

The `gh issue create` call is async + multi-second; emit `FrictionReported` synchronously, then a background task emits `FrictionLinked` (success) or `FrictionFileFailed` (network / `gh` not authed / gist fail). Triage view derives status by projecting all three.

**`cmd_report_friction` IPC**:

```rust
struct ReportFrictionRequest {
    anchor: Anchor,
    body: String,
    screenshot_data: Option<Vec<u8>>,         // raw bytes from FE
    screenshot_filename: Option<String>,
    workspace_id: Option<WorkspaceId>,
    file_to_github: bool,
}
struct ReportFrictionResponse {
    friction_id: FrictionId,
    local_path: PathBuf,
}
// New IpcError variant:
IpcError::ExternalToolFailed { tool: String, message: String }  // gh-not-authed / offline
```

Lives in `crates/designer-ipc/src/lib.rs`, alphabetical with existing commands.

#### User-facing behavior *(per the spec from the user, 2026-04-26):*

1. **Floating button — bottom-right, always-on.**
   - Designer's `SurfaceDevPanel` is **relocated to bottom-left** as part of this work (one-line CSS change: `right: var(--space-4)` → `left: var(--space-4)` on `.surface-dev-panel`). Friction owns bottom-right unconditionally. CSS-only solution; document the reservation rule in `pattern-log.md`.
   - Visual: small 💭 / annotation glyph, neutral surface, `--elevation-raised` shadow, subtle hover. **Persistent toggle** — armed state shows `aria-pressed="true"` + accent fill + glyph swap; user can tell at a glance they're in selection mode.
   - **Keyboard shortcut**: `⌘⇧F` toggles selection mode without clicking the button. Power users will use this 20×/day; mouse-first is wrong as the only path.
   - `bottom: max(var(--space-4), env(safe-area-inset-bottom))` to guard against future titlebar / system UI overlap.

2. **Element selection mode** *(directly inspired by agentation):*
   - **Banner strip at top of viewport while armed**: "Click anything to anchor feedback. ESC to cancel." Forge has this pattern; copy it. Discoverability fix.
   - Hovering any DOM element renders a focus ring on it (`outline: 2px solid var(--color-accent); outline-offset: 2px;` via a tracking overlay div, not direct `:hover`).
   - **Smart snap**: hovering computes the nearest ancestor with `data-component` / `data-block-kind` / `[role="row"]` / `[role="button"]` / `dialog`. The atomic hovered element gets a thinner "child" ring; the snapped target gets the primary ring. Hold `⌥/Alt` to override and anchor to the precise hovered node.
   - Tooltip near cursor shows the snapped element's component name + text snippet so the user knows what they're about to anchor to.
   - **Three exits, all valid**: ESC, click the Friction button again, click outside any anchorable element with a 600ms grace period. Spec all three.
   - Selection mode is inert when any modal scrim is open (`appStore.dialog !== null` → bail).

3. **Friction widget** (input surface, pinned to selected element with collision-avoidance):
   - **Multi-line text input** — "What's friction-y?" Mandatory.
   - **Screenshot input** — four paths in priority order (all ship in v1; total cost <50 LOC):
     1. **Paste from clipboard** (primary; hint shown in widget: "⌘V to paste"). `⌘⌃⇧4` puts a screenshot on clipboard — one fewer keystroke than `⌘⇧4` and no Desktop clutter.
     2. **Auto-capture** — "📷 Capture this view" button calls Tauri's `webview.capture()`. **Captures BEFORE the widget covers the element** (snapshot at click-anchor time, not at widget-open time). Without this, every screenshot has the widget itself in frame.
     3. **Drag-and-drop** — drop a file from Finder / screenshot tool.
     4. **File picker** — clicking the drag-drop zone opens a native file picker (uses `<input type="file">`, no Tauri plugin needed for this fallback).
   - **Auto-file-to-GitHub checkbox** — "🟢 Also file as GitHub issue" defaults checked, but uncheckable for "park this for later." Captures user's hybrid intent (auto/manual).
   - **Auto-captured context chips** (visible, editable):
     - Anchor descriptor + element text snippet
     - Active route / workspace / project IDs
     - App version + git SHA + claude version
     - Timestamp
   - **Submit button** — text mandatory; at least one of {screenshot, anchor with snap-target} required.
   - **Cancel** — closes widget, returns to selection mode (does NOT exit armed state — user often wants to re-anchor).

4. **Submit pipeline:**
   - **Synchronous local persistence:** emit `FrictionReported` event to the workspace stream. Write markdown record to `~/.designer/friction/<timestamp>-<slug>.md`. Write screenshot to `~/.designer/friction/screenshots/<sha256>.png` (content-addressed; dedupes identical screenshots).
   - **Async GitHub** (only if `file_to_github: true`):
     - `gh gist create --secret <screenshot.png>` — **`--secret` is mandatory** (default `gh gist create` is secret already, but explicit). Document in spec: "secret ≠ private — anyone with the URL can read. Sensitive content stays local."
     - **Downscale to 1920px max width before upload** (gist file cap is 10MB; Retina screenshots can exceed). Use the existing `image` crate (already a workspace dep via Tauri).
     - **Atomicity**: capture gist URL into local markdown record before attempting issue create. If issue create fails, gist is orphaned; document orphan as acceptable (low cost; Settings → Friction can retry filing later).
     - `gh issue create --label friction --title "<synthesized>" --body <markdown-with-gist-url>` on a background tokio task.
   - **Title synthesis** (deterministic, no LLM): `<element-descriptor>: <first 60 chars of body>` — e.g. `WorkspaceSidebar row: cmd-click should open in new tab not focus existing`. Element descriptor is the snapped component's `data-component` value or fallback role; if no anchor, use the route.
   - **Result handling**: on success → emit `FrictionLinked { friction_id, url }` + toast "Filed as #N — [Open]". On failure → emit `FrictionFileFailed { friction_id, error_kind }` + toast "Filed locally; couldn't reach GitHub — retry from Settings → Activity → Friction."

5. **Triage surface:** Settings → **Activity** → **Friction** page (new IA section — see "Settings IA" below). Lists entries chronologically with status (`local-only` / `filed:#N` / `failed` / `resolved`). Per-entry actions: open issue link, **"File on GitHub"** (for local-only entries), **"Mark resolved"** (local-only — does NOT close GitHub issue; close-on-GitHub is a separate explicit action), **"Delete record"**. Batch-select for "file all parked items now."

#### Implementation surface

| File | Responsibility |
|---|---|
| `crates/designer-core/src/anchor.rs` | Shared `Anchor` enum (Rust). Mirror of TypeScript shape. |
| `packages/app/src/lib/anchor.ts` | Shared `Anchor` enum + `anchorFromElement` + `resolveAnchor`. |
| `packages/app/src/components/Friction/FrictionButton.tsx` | Bottom-right floating button. Toggles selection mode via app store. `aria-pressed` armed state. |
| `packages/app/src/components/Friction/SelectionOverlay.tsx` | Hover focus ring + tooltip. `mousemove` listener; `document.elementFromPoint(x, y)`; smart-snap to nearest `data-component` ancestor (`Alt` key overrides). Banner strip at top. ESC + 3-exits handling. |
| `packages/app/src/components/Friction/FrictionWidget.tsx` | Anchored input. Text + paste + auto-capture + drag-drop + file-picker (4-way screenshot input) + checkbox + submit. |
| `packages/app/src/store/app.ts` | `frictionMode: "off" \| "selecting" \| "editing"` + `frictionAnchor: Anchor \| null` + actions. Add `⌘⇧F` keyboard binding. |
| `packages/app/src/layout/SettingsPage.tsx` | New "Activity" IA section with "Friction" sub-page. |
| `packages/app/src/styles/app.css` | `.friction-button`, `.friction-overlay`, `.friction-widget`, `.friction-banner`. **Move `.surface-dev-panel { left: var(--space-4); }`** (was `right`). |
| `apps/desktop/src-tauri/src/core_friction.rs` (new module) | `AppCore::report_friction(req)` — emit event, write file, content-address screenshot, spawn `gh` task. |
| `apps/desktop/src-tauri/src/commands.rs` + `ipc.rs` | `cmd_report_friction(req) -> ReportFrictionResponse`, `cmd_list_friction()`, `cmd_resolve_friction(id)`, `cmd_retry_file_friction(id)`. |
| `crates/designer-ipc/src/lib.rs` | New `ReportFrictionRequest` / `ReportFrictionResponse` / `FrictionEntry` DTOs. New `IpcError::ExternalToolFailed { tool, message }` variant. |
| `crates/designer-core/src/event.rs` | `FrictionReported` / `FrictionLinked` / `FrictionFileFailed` / `FrictionResolved` variants per Lane 0 ADR. |
| `core-docs/pattern-log.md` | Append: "bottom-right reserved for Friction; dev panels go bottom-left." Append: "Anchor enum lives in `lib/anchor.ts` + `core/anchor.rs`; reused across Friction (13.K), inline comments (15.H), finding evidence (21)." |

#### Settings IA (locked)

Settings gains a new **Activity** top-level section with two children:
- **Friction** (this PR) — triage list described above.
- **Designer noticed** (Phase 21.A1) — finding list (read-only v1 + thumbs-up/down for signal).

Locked here so 13.K's agent and 21.A1's agent don't independently invent two different IA homes. Append to `pattern-log.md`.

#### Tests

- Unit: `Anchor` round-trip (encode → resolve → identical element); stale-anchor detection returns `null`.
- Unit: `FrictionButton` toggles store state on click + on `⌘⇧F`.
- Unit: `SelectionOverlay` follows `mousemove`, snaps to `data-component` ancestor, `Alt` overrides snap, ESC cancels, banner strip mounts/unmounts on armed state change.
- Unit: `FrictionWidget` four screenshot inputs (paste, auto-capture, drop, file-picker) all populate the same state.
- Unit: title synthesis produces `<descriptor>: <first 60 chars>`; route fallback when no anchor.
- Integration: `cmd_report_friction` writes the markdown file + screenshot file + emits the event. `gh` shim verifies `--secret` flag, downscale-to-1920px happens, gist-URL captured before issue create.
- E2E (Playwright, in 15.J's harness): full flow click button → hover element with snap → click → paste screenshot → check "file to GitHub" off → submit → assert local-only state in triage page.

#### Done when

The user can `⌘⇧F`, hover any UI element (with snap to component), paste a screenshot, type a sentence, and within 5s see "Filed as #N" (or "Filed locally" if offline / GitHub disabled). Local-only entries can be filed later from Settings → Activity → Friction. Mark-resolved is local-only; close-on-GitHub is a separate explicit action. Friction overhead per capture is below 30s end-to-end.

---

### Track 13.J — Phase 13.H follow-ups *(non-blocking; surfaced by the six-perspective review of PR #22)*

**Why a separate track:** the 13.H review pass surfaced two classes of follow-up — small structural / test cleanups that are out-of-scope for the wiring PR but worth a discrete pass, plus heavier UX items that belong in the Phase 15 polish bucket (see `Phase 15.J` below). 13.J collects the structural items so they don't get lost. None block dogfooding.

**Steps (each ~half-day, batchable into one PR):**

- **F5+1 — Tool-use → tool-result correlation.** Stateful translator field that maps `tool_use_id` to the originating `Report` artifact id; on the next user-turn's `tool_result`, emit `ArtifactUpdated` with the result's summary so the "Read CLAUDE.md" card gains a result line in place. ~50 LOC; flagged in `stream.rs::translate_assistant` as `TODO(13.H+1)`.
- **ADR addendum on `ClaudeSignal` trait leak.** ✅ landed as ADR 0005 (2026-04-26): adopt option (b) — introduce `OrchestratorSignal` as the neutral trait surface with `pub type ClaudeSignal = OrchestratorSignal;` as a one-release-cycle alias. Implementation PR is mechanical (move + rename + alias). See `core-docs/adr/0005-orchestrator-signal-shape.md`.
- **Live `permission_prompt_round_trip` test.** Gated by `--features claude_live` on the self-hosted runner. Single user message → tool prompt → grant → tool result round-trip against real `claude` 2.1.119+. Confirms the response wire shape (`subtype: "success"`, nested `response.response.behavior`) hasn't drifted. Probe-captured fixtures + the in-app dogfood walk are the current proxies.
- **`spawn_cost_subscriber` ↔ `build_event_bridge` unification.** Both are `tokio::spawn` + `loop { rx.recv() match Ok / Lagged(continue or warn) / Closed(break) }` over a `broadcast::Receiver`. Extract `forward_broadcast<T>(rx, handler: impl FnMut(T))` so the `Lagged`/`Closed` arms aren't duplicated. ~10 LOC saved; lives in `core.rs`. **Landed:** PR [#31](https://github.com/byamron/designer/pull/31). Two follow-up call sites surfaced (`apps/desktop/src-tauri/src/events.rs::spawn_event_bridge` and `core::spawn_projector_task`) — kept out of scope to honor the single-file constraint; first is a clean migration, second needs a separate Lagged-triggered resync design.
- ~~**F4 test reuse `boot_with_helper_status`.**~~ ✅ Shipped as PR [#32](https://github.com/byamron/designer/pull/32). `core_local::tests` is `pub(crate)`; `boot_with_helper_status` and a new `boot_with_local_ops` variant are exposed; `apps/desktop/src-tauri/src/test_support.rs` hosts `CountingOps`. F4 test shrunk ~83 LOC. `CountingHandler`/`RecordingHandler` were *not* moved — single-use within `crates/designer-claude/`, no actual duplication to consolidate.
- **`run_reader_loop` context struct.** 9-arg signature with `#[allow(clippy::too_many_arguments)]`. Bundle the immutable per-team context (`workspace_id`, `team_name`, `lead_role`, `permission_handler`, `store`, channels) into `ReaderLoopCtx` and pass `(reader, ctx)`. The clippy allow goes away and the call site reads cleaner.
- **Bounded translator state.** `ClaudeStreamTranslator::tasks` and `agents` HashMaps grow monotonically over a long-lived session. Add an LRU cap (~1k each) so a multi-day session can't OOM the translator. Pre-existing; flagged by efficiency review.
- **Cost-replay bulk-update.** ✅ *(landed 2026-04-26 — PR #30, branch `cost-tracker-bulk-replay`)*. `CostTracker::replay_from_store` now folds events into a local `HashMap<WorkspaceId, CostUsage>` and bulk-publishes to the shared `DashMap` once at the end. Equivalence with the old per-event entry path locked by `cost::tests::replay_matches_old_path` (100-event interleaved fixture).

**Done when:** all eight items merged; `cargo test --workspace --features claude_live` includes the round-trip on the self-hosted runner; ADR 0002 carries the trait-leak decision.

---

### Track 13.L — Friction local-first + master-list workflow *(post-13.K storage/triage rework; ~1 day, one agent; Lane 1.5 Wave 1)*

**Why:** the four-perspective review of PR #34 surfaced two real product issues. (1) "Secret gist" is misleading privacy — anyone with the URL can read; not what a solo dogfood user wants for screenshot content. (2) The triage view doesn't track *addressed* state, which mirrors exactly the Agentation pain point the user called out (comments stored locally per dev server, no cross-off, no PR linkage). 13.L drops the GitHub round-trip and rebuilds the triage as a master list with state.

#### Changes

**Backend (`apps/desktop/src-tauri/src/core_friction.rs` + IPC)**
- Drop the `gh gist create --secret` + `gh issue create` filer. Remove `GhRunner` trait, `GhRunnerSlot`, the `tokio::spawn` background task in `submit_friction`, and the `set_gh_runner_for_tests` cfg-test hook. Net deletion (~250 LOC).
- Drop `IpcError::ExternalToolFailed` (no remaining producer).
- Friction records persist to `<repo_root>/.designer/friction/<id>.md` with screenshot sidecar at `<repo_root>/.designer/friction/<id>.png` (still content-addressed by sha256). Fall back to `~/.designer/friction/` when no repo is linked.
- `cmd_link_repo` writes `.designer/friction/` into the project's `.gitignore` on first link unless the user opts in to commit (a per-project setting; default = gitignored).
- Repurpose `EventPayload::FrictionLinked { friction_id, github_issue_url }` → `EventPayload::FrictionAddressed { friction_id, pr_url: Option<String> }`. **This is the only non-additive change in 13.L** — bump `EventEnvelope.version` from 1 to 2 and add a one-paragraph addendum to ADR 0002. Old records continue to decode via the legacy variant; new records use the new shape.
- Add `EventPayload::FrictionReopened { friction_id }` (additive; no version bump beyond the one above) so resolved entries can come back to the open list.
- `EventPayload::FrictionFileFailed` stays in the vocabulary but loses its producer; mark `#[deprecated(note = "removed in 13.L; reserved for future external-filing path")]`.

**IPC (`crates/designer-ipc/src/lib.rs` + `apps/desktop/src-tauri/src/commands_friction.rs`)**
- New `cmd_address_friction(friction_id, pr_url: Option<String>) -> ()` emits `FrictionAddressed`.
- New `cmd_reopen_friction(friction_id) -> ()` emits `FrictionReopened`.
- Existing `cmd_resolve_friction` and `cmd_list_friction` unchanged.
- Drop `cmd_retry_file_friction` (no filer to retry).
- Keep `tauri::generate_handler![...]` registrations alphabetical.

**Frontend (`packages/app/src/layout/SettingsPage.tsx` Friction triage — the `FrictionTriageSection` block)**
- Replace the chronological list with a filterable master list. Filter chips: `Open` (default) / `Addressed` / `Resolved` / `All`.
- Each row: synthesized title, state pill (`open` / `addressed` / `resolved`), anchor descriptor, created-at, optional PR link chip, expand-on-click for body + screenshot thumbnail + full anchor. Row actions:
  - **Open file** — `shell.open(parent_dir)` (Tauri shell capability) on the markdown record's parent directory. Full reveal-in-Finder is a v2.
  - **Mark addressed** — modal prompts for optional PR URL. If the linked repo has open PRs (cheap probe via `gh pr list --json url,title --limit 20`), autocomplete from that list. Emits `FrictionAddressed`.
  - **Mark resolved** — emits `FrictionResolved`.
  - **Reopen** — emits `FrictionReopened` (only on resolved entries).
- Sort: most-recent-first within each filter.

#### Tests
- `cmd_address_friction` round-trips `pr_url` through the event store and the projection.
- State machine: `FrictionReported` → `open`; `+FrictionAddressed` → `addressed`; `+FrictionResolved` → `resolved`; `+FrictionReopened` → `open`.
- Old `FrictionLinked` records (version 1) continue to decode and project as `addressed` with `pr_url: None` (migration semantics).
- `<repo>/.designer/friction/<id>.md` lands at the right path when a workspace is linked; falls back to `~/.designer/friction/` when no link is present.
- `.gitignore` write is idempotent and skipped if `.designer/friction/` is already listed.

#### Done when
The user can: ⌘⇧F → submit a friction note → see it in the master list as Open → click *Mark addressed* and optionally paste a PR URL → see it filtered out of the default view → toggle to *Addressed* and find it → click *Mark resolved* once the PR merges. No GitHub round-trip; no `gh` dependency. Records are local-first and survive across machines via the repo (when committed) or stay private (when gitignored). Old records from 13.K continue to render correctly.

---

### Track 13.M — Friction trivial-by-default UX *(post-13.L UX rewrite; ~1.5 days, one agent; Lane 1.5 Wave 2; depends on 13.L)*

**Why:** the four-perspective review found that 13.K's mid-flight selection mode adds cognitive load before the user has typed a single character. For a solo dogfood user, the most common case is "the thing I'm looking at right now is bad" — they don't need to anchor, they need a fast capture. 13.M makes "type a sentence" the default path; selection mode demotes to opt-in. Folds in the deferred 13.K v2 items (auto-capture + stream-subscribed toast).

#### Changes

**Default flow (no selection mode by default)**
- ⌘⇧F → composer mounts bottom-right anchored to FrictionButton. Body textarea auto-focused on mount. Selection-mode banner does NOT appear in this flow.
- Submit enabled when body has any non-whitespace content (screenshot is optional). ⌘↵ submits; ESC dismisses.
- Inside the composer:
  - **⌘⇧S** captures the current viewport via Tauri's `webview.capture()` API. To avoid the composer appearing in its own screenshot, hide the composer for one frame (CSS `visibility: hidden`), capture, restore. Picks the simplest path that ships.
  - Paste, drag-and-drop, file-picker remain as alternate screenshot inputs.
  - **⌘.** toggles into selection mode (opt-in path below).
- Persistent key-hint footer in the composer: `⌘↵ submit · ⌘⇧S screenshot · ⌘. anchor · ESC dismiss`. Always visible; no discoverability hide-and-seek.

**Opt-in anchor mode**
- A small "📍 anchor to element" button in the composer header AND the ⌘. shortcut both enter selection mode. The composer hides while selection is active; on click, selection captures the anchor + restores the composer with the anchor descriptor as a chip ("ProjectStrip · Plan tab" with × to clear).
- Selection-mode banner (kept; only renders in opt-in path) gains a persistent legend: `Click element to anchor · Alt: anchor exact child · ESC to cancel`. Alt-overrides-snap is now discoverable, not buried in a hint.
- **Drop the 600ms outside-click grace entirely.** Replace with a 50ms click-outside suppression after the selection mode mounts (just enough to swallow the click that triggered arming). After 50ms, click-outside-exits-immediately. No silent ambiguity.

**FrictionButton glyph state**
- Always-on, but no longer the primary trigger. Visually demoted: smaller footprint, lower-contrast hover state. ⌘⇧F is the primary trigger going forward.

**Stream-subscribed "Filed as #N" toast** *(folded in from 13.K v2 follow-ups)*
- After submit, the toast subscribes to the workspace event stream and updates from "Filed locally" → confirmed-with-id once `FrictionReported` lands in the projection (within ~50ms typically). Removes the "did it actually save?" ambiguity from the local-only path.

#### Files touched
- `packages/app/src/components/Friction/FrictionButton.tsx` — visual demotion; still toggles via ⌘⇧F.
- `packages/app/src/components/Friction/FrictionWidget.tsx` — composer becomes the default surface; `webview.capture()` integration; key-hint footer; anchor chip; stream-subscribed toast.
- `packages/app/src/components/Friction/SelectionOverlay.tsx` — only mounts in opt-in path; persistent legend; 50ms suppression replaces 600ms grace.
- `packages/app/src/store/app.ts` — `frictionMode: "off" | "composing" | "selecting"` (was `"off" | "selecting" | "editing"`); ⌘. binding scoped to composer.
- `apps/desktop/src-tauri/Cargo.toml` + `tauri.conf.json` — enable webview-capture capability if not already.
- `apps/desktop/src-tauri/src/commands_friction.rs` — `cmd_capture_viewport() -> Vec<u8>` returning PNG bytes (per Tauri v2's capture API).

#### Tests
- Default flow opens composer focused on body; ⌘↵ submits with body alone (no anchor required, no screenshot required).
- ⌘. toggles into selection mode and back; anchor chip renders and clears via ×.
- 50ms suppression window: synthetic click-outside fired at t=20ms is ignored; at t=80ms it exits.
- Capture flow: composer hidden for one frame; restored after capture; screenshot bytes round-trip into `FrictionReported`.
- Stream-subscribed toast: emit a fake `FrictionReported` post-submit; assert the toast text updates from "Filed locally" → "Filed as #N".

#### Done when
The user can hit ⌘⇧F, type a sentence, hit ⌘↵, and have a friction record persisted in <2s with zero DOM-walking. The 📍 button or ⌘. exposes the existing anchor flow as opt-in. No silent grace period; instructions are visible at all times. The toast confirms the persisted ID rather than implying it.

### Track 13.N — Friction → agent loop follow-ups *(post-PR #67; non-blocking; pull as bandwidth allows)*

**Why:** PR #67 shipped the dogfood loop end to end (file friction in app → fix from `designer` CLI → mark addressed → row updates live). Three larger items were called out in the PR body and the in-PR review and explicitly deferred. They're small enough not to block 13.M completion but big enough to need a name on the roadmap so they don't get lost.

#### N.1 — Bundle the `designer` CLI inside Designer.app

**Why:** today the CLI ships via `cargo install --path crates/designer-cli` (wrapped in `scripts/install-cli.sh`). Works for devs with Rust installed; non-dev users have no path. Until this lands, the agent loop is dev-only.

**Steps:**
- Configure Tauri's `bundle.externalBin` in `tauri.conf.json` to ship `designer-<target-triple>` in `Designer.app/Contents/Resources/`.
- Pre-build hook (or CI step) that runs `cargo build -p designer-cli --release --target <target>` and renames the binary to the suffixed form Tauri expects.
- In-app affordance in Settings → Account (or a new "CLI" section): detect whether `designer` is on PATH; if not, offer to symlink the bundled binary into `~/.local/bin/designer` (no sudo needed).
- Update `scripts/install-cli.sh` to skip the symlink step when running inside the app bundle context.
- Codesign + notarize the bundled binary as part of 16.R.

**Done when:** a non-dev user can install Designer.app, open Settings → CLI, click "Install on PATH", and have `designer friction list` work in their next terminal session.

#### N.2 — Friction triage row action consolidation

**Why:** open rows now have five buttons (Mark addressed · Mark resolved · Show in Finder · Copy path · Copy prompt). Wraps at narrow widths and is approaching cognitive overload. The two state actions are the primary verbs; the three file/path actions are secondary.

**Steps:**
- Keep the two state-transition buttons inline (Mark addressed, Mark resolved / Reopen — depending on row state).
- Collapse the three file actions (Show in Finder, Copy path, Copy prompt) into a single icon-button with a popover menu — pattern matches `IconButton` + the workspace sidebar overflow menu.
- Tooltip on the trigger: "File actions"; ⌘⌥F or similar shortcut from row focus to open it.
- Accessibility: menu uses `role="menu"`; arrow-key nav between items; ESC to close.

**Done when:** the row never wraps at the default Settings width (≥640px main column); all five actions still reachable in ≤2 clicks and via keyboard.

#### N.3 — fs-watcher self-trigger guard

**Why:** the watcher in `apps/desktop/src-tauri/src/store_watcher.rs` fires on the desktop's *own* writes too, causing one redundant `list_friction()` per state transition. Cheap (small payload, in-process projection) but real overhead at scale and slightly noisy in tracing logs.

**Steps:**
- Track the last sequence the in-process event bridge has emitted (per stream or just a max).
- On a watcher tick, peek at events.db's max sequence; if it equals (or trails) the bridge's last-emitted, skip the `store-changed` emit.
- Keep the 500ms debounce as the outer cap.
- Test with a tempdir-backed store: assert that an in-process append + emit produces zero `store-changed` notifications, and an externally-injected event produces exactly one.

**Done when:** running the desktop app with the FE Friction tab open and clicking *Mark resolved* triggers exactly one frontend re-fetch (the optimistic update), not two.

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

- **Mini hygiene + primitives decision (G12, 15.M).** Re-sync upstream Mini (axioms / primitives / skills / invariants) then re-evaluate primitives adoption per ADR 0006 tripwires. Detail in 15.M below. Tripwire-driven, not date-driven.
- **Correlation/causation (G13).** When the orchestrator emits an event in response to a user action, set `causation_id` to the triggering event. The activity spine gains a "why did this happen" drilldown.
- **Pairing RNG (G14).** Swap the manual `/dev/urandom` read in `PairingMaterial::random` for `rand::rngs::OsRng`.
- **Dark-mode regression (G15).** Add a Vitest + Playwright combination that screenshot-diffs every primary surface in light + dark.
- **Auto-grow chat textarea (G16).** Replace the `minHeight` + overflow approach in `PlanTab` with a content-height reflow.
- **`UpdatePrompt` error-pill flash on race (PR #74 follow-up).** When the 60s install deadline fires, `setState({ kind: "error" })` runs unconditionally; if install then completes, `relaunch()` is called but the error state isn't cleared first, so the failure pill flashes briefly before the window closes. The component's own race-contract comment promises "the error state is only shown when the install genuinely never completes within the deadline" — a claim the code doesn't fulfil. Fix: either (a) check `installed` before the timeout setState, or (b) clear the error state in the success path before `relaunch()`. ~5 LOC in `packages/app/src/components/UpdatePrompt.tsx`. Once shipped, tighten `update-prompt.test.tsx`'s race-contract test to assert no `Update failed` text is visible after the race resolves (currently deliberately permissive — see test comment).
- **Event-log incrementalization.** `AppCore::sync_projector_from_log` is full-replay; once logs cross ~10k events it should incrementalize against the projector's last-seen sequence per stream.
- **15.H — Inline commenting & element annotation (G21).** Let the user reply to a specific span of an agent message in Plan, and to a specific element in Design, without typing a new whole-thread reply. See detail below.
- **15.J — Real-Claude UX polish.** UX-heavy follow-ups surfaced by the PR #22 review pass; first-real-Claude session smoothness. See detail below.
- **15.K — Onboarding & first-run.** Welcome → claude auth check → github auth check → create-your-first-project chain. Surfaced by the PR #24 first-run testing — current welcome slabs dismiss into an empty strip with no guidance. See detail below.

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

### Phase 15.J — Real-Claude UX polish *(detail)*

**Why:** the PR #22 review pass (six perspectives) identified a set of UX gaps in the F1–F5 user-facing surfaces — the inbox approval row, the inline tool-use cards, the cost chip, and the code-change rail. None block dogfooding (the flow technically works), but every one of them violates one of CLAUDE.md's principles ("summarize by default, drill on demand", "manager not engineer", "suggest, do not act") in a way a non-engineer manager will feel on first run. Bundle them into one polish PR after dogfood signal lands so we can prioritize by what surfaces friction first.

**Items (each independent; ranked by likely friction):**

- **Tool-use card visual demotion.** Today every `tool_use` block emits a full-bordered `Report` card; a 9-tool turn = 9 cards with the same visual weight as a `Spec` artifact. Demote to borderless, single-line, monospace path, indented under the agent narration paragraph that produced them. CSS-only; branch on `data-author-role="agent"` + a new `data-tool-use="true"` data attr (set in the renderer when the title matches the verb-first pattern). Stretch: projector-side coalesce of consecutive same-author tool_use cards into a `track-rollup`-style "9 actions" group.
- **`ApprovalBlock` drill-down.** `InboxPermissionHandler` packs full tool input into the request artifact's payload; `ApprovalBlock` reads only `summary` today. Render a tool-specific preview: file path on a dedicated row + content/diff `<pre>` (truncated to ~10 lines, "Show full" disclosure) for Write/Edit; full command in monospace + `description` if present for Bash. Title becomes "Claude wants to write to `src/main.rs`" (constructed in `inbox_permission.rs`, using the path *relative to the worktree root* — never the absolute `~/.designer/worktrees/...` path; raw paths are noise to a non-engineer manager), not "Approval: Write". **Append a one-line scope reassurance under the path for Write/Edit/Bash that mutates state**: "in this track's isolated workspace · your main checkout is untouched". Surfaced by the safety review (2026-04-28) — the worktree boundary is the trust guarantee but the user never hears it in the UI today. Use plain language; do not say "worktree." This is reassurance copy, **not** an enforcement boundary — actual enforcement is Phase 13.I's canonicalization + prefix check.
- **Approval-resolved label fix.** Today `ApprovalBlock` resolved state renders the literal lowercase `granted` / `denied`. Four issues to fix together: (a) human copy ("Allowed by you" / "Denied by you" / "Denied — you didn't respond in 5 min"); (b) timeout-deny vs user-deny visual differentiation (subscribe to `approval_denied` events with their `reason`); (c) drop the opacity-0.5 styling for `denied` — it reads as "old/dim", not "rejected" — and use a `--color-danger` border instead; (d) **timeout-deny gets an inline "Ask again" affordance** that re-emits the approval request without the user having to re-prompt the agent — closes the "I stepped away and lost the thread" recovery gap surfaced in the safety review (2026-04-28). No banner / no notification — the discovery point is the artifact itself when the user returns to the thread, consistent with calm-by-default.
- **Approval block "Working…" busy state.** Between approve and the agent's next narration there's a 2–10s gap that reads as frozen UI. Add a `role="status"` "Working…" line under the resolved state until the next `MessagePosted` from `team-lead` lands. Frontend-only; subscribe to the same stream the block already listens to.
- **Cost chip a11y glyph.** `cost-chip__dot` encodes the band (ok / warn / danger) only via color. Add a glyph variant: dot for ok, half-fill for warn, exclamation for danger. The `data-band` attribute already differentiates; CSS-only.
- **Cost chip cap-warn popover.** Crossing into `warn` (>80% of cap) just turns the dot. Add a one-time popover hint on first cross ("approaching cap — agents will stop at $X if cap is set"). Today the popover is open-on-click only.
- **Cost chip first-enable onboarding.** Hidden by default per spec Decision 34; appears suddenly on settings toggle. Add a one-line tip on first enable so the chip's meaning is explained before its first increment.
- **Code-change rail late-summary cross-fade.** The hook writes a fallback summary then later emits `ArtifactUpdated` with the LLM line. `CodeChangeBlock` re-renders reactively, which reads as a flash. Add a `motion-cross-fade` transition on `.block__summary` (token already exists) honoring `prefers-reduced-motion`. ~10 LOC of CSS.
- **`ArtifactKind::Report` semantic disambiguation.** `Report` is now used for two different things: workspace recap output (`recap_workspace`) and tool-use evidence cards (F5). The renderer is currently a stub; when it gets a real recap-style design, the routing needs to disambiguate on `author_role` (`recap` vs `agent`) or title prefix. File a `pattern-log.md` entry locking the disambiguation rule before the recap renderer ships, so we don't re-litigate the artifact-kind boundary.
- **Confirm `--disallowedTools AskUserQuestion` UX.** The orchestrator forces the agent to ask clarifying questions through the message channel rather than a separate AskUserQuestion surface. Capture this as a feedback entry in `feedback.md` so the choice is explicit; revisit if a real session shows the agent struggling without the AUQ tool.

**Carry-overs from PR #24 (first-run polish) review:**

- **Browse… button on `CreateProjectModal`** (and `RepoLinkModal`). Install `@tauri-apps/plugin-dialog`, register the capability in `tauri.conf.json` + `apps/desktop/src-tauri/capabilities/`, fall back gracefully in the web build (hide the button via `isTauri()` check). Today the user has to type/paste an absolute path; with backend `~` expansion this works but it's still rough first-15-seconds. Plugin install is real scope (~50 LOC, capability registration, Rust plugin init), which is why it didn't ship in PR #24.
- **Inline path validation on type.** `cmd_validate_project_path` IPC already exists and the modal can call it on each keystroke (debounced) to show the canonical resolved path on success or an inline error on failure. Backend already validates on submit; this just moves feedback earlier in the cycle. ~20 LOC frontend.
- **`<Modal>` primitive consolidation.** Three modals now share scrim + focus-trap + ESC handler + Tab cycle (Help/AppDialog, RepoLinkModal, CreateProjectModal). PR #24 extracted `lib/modal.ts` with `collectFocusable` + `messageFromError`; the next consolidation is a real composition primitive (header + body + button-row slot pattern). Worth a short ADR on whether the primitive owns the scrim or accepts one as a parent — the AppDialog scrim is currently siblings-of-content, while RepoLinkModal/CreateProjectModal scrims wrap content.

**Done when:** a first-time user running the dogfood loop (read CLAUDE.md → tool prompt → grant → write → cost increment) sees coherent, principle-respecting visuals at every step — no card overload, every approval shows the *what*, the cost chip has a non-color band signal, late summaries cross-fade rather than flash. Acceptance is per-item; pair with the Phase 16 install QA checklist.

### Phase 15.K — Onboarding & first-run *(detail)*

**Why:** when the user wipes `~/.designer/` (intentionally — fresh start — or unintentionally — first install), the current welcome slab dismisses into a strip with no projects, no workspaces, and a small `+` icon as the only affordance. The user has to discover that `+` opens a modal that asks for a path. There's no claude-auth verification, no github-auth verification, no "your first project" hero. Filed during the PR #24 review as the largest UX gap once first-run actually works. The first real `/Applications` launch (2026-04-26, post-PR #24) confirmed: the empty state is a dead-end for new users — nothing tells them "the strip + button is how you start." PR #26 patched the symptom with a CTA on the empty surface; this phase lands the underlying flow.

**Goals (the principles 15.K is judged against):**

1. **Zero dead empty states.** Every initial surface (no projects, no workspaces, no tabs, no artifacts) ships a primary CTA that takes the next obvious action — never a blank pane with chrome around it.
2. **Guided first project.** A single coachmarked path: launch → "create your first project" → Finder folder picker → name → land in project home with a hint at the next step (linking the repo, opening the first workspace).
3. **Picker-first inputs.** Filepath, color, date, model — every input modality with a native affordance defaults to that affordance (FB-0032). Free text is the fallback, not the primary path. Browse… button on `CreateProjectModal` (Track 13.J carry-over) is the canonical example.
4. **Trust, not noise.** Onboarding respects "calm by default" — one surface, one idea per slide, dismissible. The existing `Onboarding` walkthrough is the right scaffold; it just needs concrete actions wired to each slide instead of marketing copy.
5. **First-run permission model.** Approval gates explained on first contact, not silently enforced — a one-time inline tooltip the first time an approval lands in the inbox so the user understands why the agent paused.

**Items (sequenced; each independent but they compose into a coherent flow):**

- **First-run detection.** When `events.db` is empty (zero `ProjectCreated` events) AND the onboarding-dismissed flag isn't set, treat it as first-run and route into the welcome flow rather than the regular AppShell. Boolean flag in `useAppState` driven by `dataStore`'s `loaded && projects.length === 0`.
- **Welcome slabs → create-project chain.** `Onboarding.tsx`'s last slide currently dismisses; should end with a primary CTA "Create your first project" that calls `openCreateProject()`. The CreateProjectModal already accepts an `onCreated` callback so the welcome flow can chain into a follow-up step (e.g., "now link a repo").
- **Claude-auth verification.** Boot already runs `claude --version`. Surface the result on the welcome flow: green check + version line if it works, actionable "Install or log in to Claude Code" panel if not (with copy-paste command + link to docs). Doesn't block onboarding completion — the user can dismiss and run the agent later — but warns clearly.
- **GitHub-auth verification.** Equivalent for `gh auth status`. Designer's `cmd_request_merge` shells out to `gh pr create`; without auth that fails confusingly. A welcome-flow check + "log in" affordance prevents the first-merge surprise.
- **Empty-state CTA on every initial surface.** Per Goal 1: not just `projects.length === 0` (PR #26 covered that one). Also the no-workspaces-in-project pane, no-tabs-in-workspace pane, no-artifacts-in-tab pane. Each renders a single primary action, not chrome around emptiness.
- **First-approval explainer tooltip.** Per Goal 5: the first time an `ApprovalRequested` event lands in the user's inbox, render a one-time inline tooltip explaining the approval-gate model. Persisted dismissal flag in settings.
- **Settings → Reset Designer.** Confirmation-gated wipe of `~/.designer/events.db` with a clear "this deletes all your workspaces" warning. Replaces today's `rm` workaround for stale mock-mode data and gives the user a sanctioned way to start fresh.
- **Automatic `events.db` corruption recovery.** When `AppCore::boot` opens the SQLite store and hits a corruption signal (connection-open failure with `SQLITE_CORRUPT`/`SQLITE_NOTADB`, `PRAGMA integrity_check` fails, or schema mismatch), do *not* crash to a black window and do *not* hand the user a CLI recipe. Instead: (1) rename the bad file to `events.db.corrupt-YYYY-MM-DD-HHmm` (preserve for diagnostics — never delete); (2) create a fresh `events.db` and continue boot; (3) surface a single one-line banner on first render: "Designer recovered from an interrupted shutdown. Your code is safe — it lives in git, not in Designer. Workspaces will be empty; recreate them anytime." with a "What happened?" disclosure linking to a short Help-dialog explainer. The HMAC chain shipping in Phase 13.I will make the corruption signal stronger (chain-break = tamper or storage error, distinguishable). Surfaced by the safety review (2026-04-28) — the original recommendation was a recovery doc; reframed to in-app recovery because asking a non-engineer manager to find a doc and run `rm` when their app is broken is the worst possible UX. The doc still exists as the "What happened?" disclosure target, but it's a secondary artifact, not the recovery path. Implementation lives in `crates/designer-core/src/store.rs::open_or_recover`; ~80 LOC + a corruption fixture in tests.

**Out of scope for 15.K (file separately):**
- Per-workspace claude home customization (would interact with team-spec wiring).
- Multi-account claude / per-project model overrides.

**Done when:** a fresh `~/.designer/` install walks the user from zero state through claude auth check, github auth check, "create your first project" with their repo, and into a working session — without forcing them to know about `events.db`, env vars, or PATH. No initial surface in the app shows a blank pane with chrome around it.

### Phase 15.M — Mini hygiene + primitives decision *(detail)*

**Why:** Stages 1–2 of the design-system audit (2026-04-27) shipped CI-gated invariants + manifest coverage and split the 4066-line `app.css` into 18 per-surface partials. The two remaining stages — re-syncing Mini and deciding on primitives adoption — were intentionally bundled and deferred to this phase. ADR 0006 records the deferral with five reopen tripwires; this section sequences the work for when one of them fires.

**Tripwires (any one fires the work):**
1. **Second product surface starts** — mobile, marketing site, or web cockpit. Most likely tripwire per user direction (FB-0034). At that point primitives become the portable layer between products and the cost calculus inverts.
2. **Component count crosses ~50** — Designer was at ~37 components on 2026-04-27. Compounding "every new component reinvents flex" cost.
3. **Second contributor regularly authors UI** — concurrent Claude sessions count; AI-driven generation that has to respect the language counts more.
4. **`app.css` regrows past ~2000 lines** — signal that organization isn't holding under feature pressure even after the Stage 2 split.
5. **Mini upstream evolves the primitives** — pull-driven adoption of a specific upstream change Designer wants to consume.

**Stage 3 — Mini sync (always do this first when 15.M fires):**
- Run `./scripts/sync-mini.sh` from the project root. The script overwrites the upstream-tracked surface (`packages/ui/src/primitives/`, `packages/ui/src/archetypes/`, `packages/ui/styles/axioms.css`, `packages/ui/styles/primitives.css`, `.claude/skills/`, `tools/invariants/`, `templates/`); fork-and-own files (`packages/ui/styles/tokens.css`, `packages/ui/styles/archetypes.css`) are never touched.
- Diff the result. Categorize each upstream change as adopt-as-is / adopt-with-port / skip-with-rationale. Log non-obvious choices in `pattern-log.md`.
- Update `MINI-VERSION.md` (the script does this) and verify both CI gates still pass against the synced upstream — invariants check first, manifest coverage second.
- Done when: synced commit pinned in `MINI-VERSION.md`, `node tools/invariants/check.mjs packages/app/src` 6/6, `node tools/manifest/check.mjs` clean.

**Stage 4 — Primitives adoption decision (after Stage 3):**

Run the ADR 0006 re-evaluation audit:

1. Count current components and lines across `packages/app/src/styles/*.css` (the Stage 2 split's resulting surfaces).
2. Count primitive-shaped layout patterns in the existing CSS — flex columns / rows, two-column sidebars, centered content. That's the migration target size.
3. Count layout patterns that *cannot* be expressed as primitives — `position: fixed`, transforms, the negative-margin tab seam, container queries, anything `color-mix()`-based. That's the residual CSS that stays no matter what.
4. If migration target / residual ratio is greater than ~3:1, primitives earn their slot. Otherwise the mixed state is permanent and not worth entering.

If the audit clears: do the migration as a planned project — one PR per surface family (shell → tabs → home → blocks → friction in that order, smallest blast radius first), visual-snapshot-tested, in a 1–2 week stretch where no other UI work is happening. Don't trickle.

If the audit fails: formally retire the primitives package. Either delete `packages/ui/src/primitives/` or downgrade the package to "upstream we happen not to consume." Update ADR 0006 with the result and the reasoning. Mini still ships tokens / axioms / archetypes / skills / invariants — that's the part actually carrying the design system.

**Why the two stages are bundled:** Stage 4's audit only makes sense against the freshest Mini. Adopting yesterday's primitives, then re-syncing, is double migration; running the audit on stale primitives risks deciding on an outdated abstraction.

**Done when:** Mini is synced, the primitives decision is recorded in an ADR 0006 amendment, and either (a) the migration project is queued with a per-surface task list or (b) the primitives package is retired with a one-line replacement in `MINI-VERSION.md`.

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
- Inter-workspace isolation: per-workspace keyed HMAC domain separation on the event chain (builds on 13.I chain infrastructure).
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
- **Visual PR review.** Side-by-side / toggle comparison of a track's PR against its base, attached to `PrBlock`. **Reuse existing preview infrastructure** — Vercel/Netlify/Cloudflare per-PR preview URLs the user's project already produces — rather than building a capture engine (Chromium sidecar, headless browser, snapshot store). Two iframes against `pr_preview_url` and `base_preview_url`; toggle / side-by-side / overlay modes; drill-into-route navigation. Degrades gracefully for projects without preview deploys (show only head, link to GitHub PR). Web only at v1; native mobile is a different problem and out of scope. Pullable into Phase 15 if dogfooding surfaces "I can't tell if the PR is right" as top friction. Branch breadcrumb: `visual-pr-diffs` (decision trail — capture-engine path explicitly rejected). Future extension to iteration-time previews (mid-track agent steps) is additive — same iframe surface, different trigger, no backend rework.

**Done when:** a user can (a) iterate on a feature across multiple sequential tracks without manual workspace bookkeeping, (b) fork a workspace to try an alternative approach, (c) reconcile the fork back or archive it cleanly, (d) chat with the workspace lead about the feature at large and only occasionally drop into specific tracks, (e) confirm a track's PR visually before merging without reading the code diff.

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

### Phase 21.A — Frontloadable detectors *(agent-parallelizable; ship while dogfooding)*

**Why frontload:** the deterministic detectors in the table below are pure Rust + run against the event store. Each is independent, ~half-day of agent work, fully testable on captured event-store fixtures, and produces immediate signal once wired. **They do not need Phase B (LocalOps synthesis) or the proposal-acceptance UI to be useful** — finding storage + a basic listing surface in Settings is enough to start collecting "Designer noticed…" hits while you dogfood.

This is the highest-leverage parallel-agent work available right now. The user's daily sessions become training-quality signal from day one.

#### Locked contracts (frozen by 21.A1; 21.A2 detectors do not redesign them)

`Detector` trait — async-ready so Phase B (which uses `LocalOps` async) can reuse the trait without refactor:

```rust
#[async_trait::async_trait]
pub trait Detector: Send + Sync {
    fn name(&self) -> &'static str;
    fn version(&self) -> u32;
    /// Phase A: ignore `ops`. Phase B: take Some(&dyn LocalOps) for synthesis.
    async fn analyze(
        &self,
        input: &SessionAnalysisInput,
        config: &DetectorConfig,
        ops: Option<&dyn designer_local_models::LocalOps>,
    ) -> Result<Vec<Finding>, DetectorError>;
}
```

`Finding` struct:

```rust
pub struct Finding {
    pub id: FindingId,
    pub detector_name: String,
    pub detector_version: u32,
    pub project_id: ProjectId,
    pub workspace_id: Option<WorkspaceId>,
    pub timestamp: Timestamp,
    pub severity: Severity,                     // Info | Notice | Warn
    pub confidence: f32,                        // [0.0, 1.0]
    pub summary: String,                        // human-readable headline
    pub evidence: Vec<Anchor>,                  // shared enum from Track 13.K
    pub suggested_action: Option<ProposalRef>,  // None in Phase A
    pub window_digest: String,                  // cache key per detector_version
}
```

`EventPayload` additions (per Lane 0 ADR):
```rust
FindingRecorded { finding: Finding }
FindingSignaled { finding_id: FindingId, signal: ThumbSignal }   // Up | Down — calibration
```

`DetectorConfig`: `{ enabled: bool, min_occurrences: u32, min_sessions: u32, impact_override: Option<Severity> }`. Defaults migrated verbatim from Forge with citation comments (`// Forge v0.4.1: forge/scripts/analyze-transcripts.py L142`).

**Crate split:** new top-level `crates/designer-learn/` with `designer-local-models` as an optional feature-gated dep (Phase A doesn't need it; Phase B does). NOT a module inside `designer-core` (events are core; learning is a *consumer*) and NOT inside `designer-local-models` (Phase A has zero LocalOps cost).

#### Sequencing

1. **Phase 21.A1 — Foundation** *(1 agent, ~3 days — re-estimated from initial 1 day; blocks 21.A2)*. Deliverables:
   - New `crates/designer-learn/` with the trait + struct + config above
   - `SessionAnalysisInput` builder reading from `EventStore` (8 input fields enumerated in "Analysis inputs" below)
   - `cmd_list_findings()` IPC + `FindingDto` shape in `crates/designer-ipc/`
   - Settings → **Activity → "Designer noticed"** page (Settings IA section shared with 13.K's Friction page; locked in Track 13.K spec). Read-only listing + thumbs-up/down per finding (writes `FindingSignaled` event for calibration). No accept/reject UI yet.
   - **`crates/designer-learn/CONTRIBUTING.md`** — load-bearing deliverable. Without it, parallel 21.A2 detectors invent incompatible shapes. Must include:
     - Locked `Detector` trait + `Finding` + `Anchor` shapes (link to Track 13.K spec for `Anchor`)
     - Fixture format: `tests/fixtures/<detector>/input.jsonl` (event stream) + `tests/fixtures/<detector>/expected.json` (Findings)
     - Threshold defaults migrated verbatim from Forge in `defaults.rs` constants with citation comments
     - Keyword corpora as static slices (`pub const CORRECTION_KEYWORDS: &[&str] = &["I told you", ...];`)
     - A worked example: `example_detector.rs` with full structure + fixture, that 21.A2 agents copy-rename
   - **Forge co-installation rule**: if `~/.claude/plugins/forge/` exists, detectors with name overlap (`repeated_correction`, `repeated_prompt_opening`, `multi_step_tool_sequence`, `config_gap`, `domain_specific_in_claude_md`, `memory_promotion`) downweight to `enabled: false` by default with a Settings toggle: "Forge is also installed — show overlapping findings? [off]". Designer-unique detectors (`approval_always_granted`, `scope_false_positive`, `cost_hot_streak`, `compaction_pressure`) always run.
2. **Phase 21.A1.1 — Workspace-home placement + architectural fixes** *(post-21.A1 polish; ~1 day, one agent; Lane 1.5 Wave 1; lands before 21.A2)*. The four-perspective review of #33 surfaced three issues: (1) "Designer noticed" sits two levels deep but its product value is *catching the user's attention* — placement undermines the proposition; (2) thumbing produces no visible state change so the calibration loop feels broken from the user's seat; (3) no detector budget or write-time dedup means a noisy A2 detector can flood the feed. Land before A2 ships ten detectors on top of these gaps. Detail in §"Phase 21.A1.1" below.
3. **Phase 21.A2 — Detector squad** *(parallel; one agent per detector; each ~half-day)*. Each detector is `crates/designer-learn/src/detectors/<name>.rs` + `tests/fixtures/<name>/`. Recommended order by signal value:
   - `repeated_correction` (fastest signal — corrections are loud)
   - `approval_always_granted` *(Designer-unique — uses `ApprovalRequested` events)*
   - `scope_false_positive` *(Designer-unique — uses `ScopeDenied` events)*
   - `cost_hot_streak` *(Designer-unique — uses `CostRecorded` events)*
   - `repeated_prompt_opening`
   - `multi_step_tool_sequence`
   - `config_gap`
   - `compaction_pressure` *(Designer-unique)*
   - `domain_specific_in_claude_md`
   - `memory_promotion`
4. **Phase 21.A3 — Cross-project aggregation** *(after A1 + ≥3 detectors, 1 agent)*. Forge's Phase 5 work — meta-findings when N projects show the same detector firing.

**Out of scope for 21.A** (deferred to Phase 21 proper):
- Phase B LocalOps synthesis + quality gate (needs the Foundation helper's real-binary validation)
- Proposal generation (the "what to do about the finding") and editable acceptance UI
- Calibration loop logic that *uses* thumbs-up/down to adjust thresholds (the events are emitted now; the loop ships in Phase B)
- File-write side: turning accepted proposals into actual `CLAUDE.md` / rule / skill edits

**Done when:** all ten Phase A detectors ship, the Settings → Activity → "Designer noticed" page renders findings, thumbs-up/down emits calibration events, and at least one Designer-unique detector (recommended: `approval_always_granted`) has fired against the user's real session data.

### Phase 21.A1.1 — Workspace-home placement + architectural fixes *(shipped 2026-04-27, PR #37; the live-feed surface model is partially superseded by 21.A1.2 below — see callout)*

> **Surface model superseded by Phase 21.A1.2 (2026-04-28 architecture review).** The live-feed-of-findings model below ("Designer noticed" updates per-event with thumbs on individual findings) is the wrong shape: it asks the user to grade evidence rather than recommendations and it competes for attention continuously. The detector + cap + dedup infrastructure stays. The user-facing surface — what gets shown, when, and what gets thumbed — is rebuilt in 21.A1.2 to be **proposals at boundaries** (track-complete + daily) rather than findings live. Read 21.A1.2 first; it overrides every "live feed" claim below.

**Why:** the four-perspective review of PR #33 surfaced three gaps in 21.A1's landing. Land them before A2 ships ten detectors on top.

#### Changes

**Workspace-home placement**
- New "Designer noticed" section at the bottom of the workspace home tab. Renders the top 5–10 findings for the current workspace, severity-sorted (`Warning` > `Notice` > `Info`), then most-recent-first within severity. Empty state: "Nothing noticed yet — keep working and Designer will surface patterns it sees."
- Each row: severity dot, summary, detector name, confidence %, thumbs-up/down buttons, optional `calibrated 👍/👎` badge if already thumbed.
- The Settings → Activity → Designer noticed sub-tab becomes the *full archive*: all findings across all workspaces, with filters (severity, detector, calibrated/uncalibrated). Home is the live feed; Settings is the historian.
- Sidebar badge (on the Activity rail icon, or wherever the workspace home tab indicator lives) with unread count where unread = `FindingRecorded` since the last home-view, not yet thumbed. Cleared when the user opens the workspace home or the Settings archive.

**Calibrated badge**
- Findings with any `FindingSignaled` event in their projection render with a `calibrated 👍` or `calibrated 👎` badge. Subsequent thumbs on the same finding update the timestamp (idempotent at the projection — last write wins per `(FindingId, signal direction)`).
- The badge is purely visual feedback in 21.A1.1; Phase B is still the consumer that uses signals to retune detector thresholds. The badge closes the user-facing loop ("my thumb did something") without needing the threshold-tuning logic.

**Detector budget + dedup at write time**
- Extend `DetectorConfig` with `max_findings_per_session: u32` (default 5; configurable per-detector). Enforce in `core_learn::report_finding` — if the count of `FindingRecorded` events in the current session for this detector ≥ cap, return `Err(LearnError::SessionCapReached)` instead of writing. (Session = current Designer process lifetime; reset on restart.)
- Dedup using the existing `window_digest` field: before writing `FindingRecorded`, scan the open (unresolved) findings projection for the same digest in the current project; if present, no-op the write and log a debug-level message.
- Both checks are cheap (in-memory projection lookup); no SQL change.

**CONTRIBUTING.md severity guidance (`crates/designer-learn/CONTRIBUTING.md`)**
- Append a "Severity calibration" section: A2 detectors default to `Severity::Notice`. `Severity::Warning` requires justification in the detector PR (criterion: false-positive rate <5% on the captured fixture suite; A2 reviewer enforces). Designer's noise tolerance is lower than Forge's because the surface is in the cockpit, not a CI log. `Severity::Info` for low-confidence ambient signal.

#### Files touched
- New: `packages/app/src/components/Workspace/DesignerNoticedHome.tsx` (or wherever the workspace home tab's components live — confirm with the existing layout). Imports the same `DesignerNoticedPage` row component but in a top-N capped variant.
- `packages/app/src/components/DesignerNoticed/DesignerNoticedPage.tsx` — split the row component into a reusable `<FindingRow />` so home + archive share rendering. Add the calibrated badge.
- `packages/app/src/store/app.ts` — `noticedUnreadCount` derived from `FindingRecorded` events since `noticedLastViewedAt`; cleared on home/archive view.
- `apps/desktop/src-tauri/src/core_learn.rs` — `report_finding` enforces session cap + dedup; new `LearnError::SessionCapReached` variant.
- `crates/designer-learn/src/lib.rs` — extend `DetectorConfig` with `max_findings_per_session` (default 5); document defaults in `defaults.rs`.
- `crates/designer-learn/CONTRIBUTING.md` — append severity-calibration section.

#### Tests
- Workspace home renders the top-N findings for the current workspace; empty state copy passes accessibility audit (focus, contrast, no animate-in-tree).
- Sidebar badge increments on `FindingRecorded` and clears on home/archive view.
- `report_finding` returns `SessionCapReached` after N writes for the same detector in the same session.
- `report_finding` no-ops on duplicate `window_digest` within the same project's open findings.
- `FindingSignaled` projection produces the calibrated badge state; double-thumbing same direction updates timestamp without duplicating events.

#### Done when
- "Designer noticed" is visible on the workspace home (no Settings detour required for the live feed). Settings remains the full archive.
- Findings carry a `calibrated` badge after thumbing.
- A detector cannot flood the feed beyond its session cap; duplicate `window_digest` writes no-op.
- A2 agents have explicit severity guidance in `CONTRIBUTING.md`.

### Phase 21.A1.2 — Surface rework: proposals over findings, boundary-driven cadence *(architecture correction; ~2 days, one agent; lands in parallel with 21.A2)*

**Why:** the 2026-04-28 architecture review surfaced two principle violations in the 21.A1.1 surface model. (1) Surfacing raw findings asks the user to grade *evidence*, which is engineering work — directly against the "Manager, not engineer" principle in CLAUDE.md. (2) Updating the surface per-event creates a continuous attention tax — directly against "Summarize by default, drill on demand." The fix is structural, not visual: detectors keep firing continuously (their output is genuinely cheap and streaming detection is more accurate than batch replay), but the user-facing surface only updates at natural boundaries, and what it shows is *proposals*, not findings.

The detector code shipped in 21.A1 stays unchanged. The detector PRs landing in 21.A2 stay unchanged. What changes is downstream: where findings flow, when the surface refreshes, and what the user thumbs.

#### Architecture

**Findings become evidence, not artifacts.** Detectors continue to call `core_learn::report_finding`. The cap (`max_findings_per_session: 5`) and write-time dedup stay — same chokepoint, same protection. But the rationale shifts from "cap how many user-facing items appear" to "cap how many findings reach the scratch buffer." Findings are no longer rendered individually on any user-facing surface.

**Scratch buffer.** Findings live in the existing event store (`FindingRecorded` events) but are read only by the synthesis pass. No UI subscribes to `FindingRecorded` directly. The "Designer noticed" sidebar badge stops counting `FindingRecorded` and starts counting unviewed *proposals*.

**Proposals are the user-facing surface.** A proposal is what the user sees, accepts/edits/dismisses, and thumbs. Each proposal cites the findings that produced it as collapsible evidence underneath. Phase 21.A1.2 ships the proposal *surface* against a stub synthesizer (groups findings by `detector_name + workspace_id`, picks the highest-severity finding's summary as the proposal headline, attaches the rest as evidence). Real LLM synthesis lands in Phase B; the surface contract is forward-compatible.

**Cadence: track-complete + daily, never per-event.** The synthesis pass runs at exactly two triggers:

1. `TrackCompleted` event — natural "what did I learn from this work" moment; user is between contexts.
2. First Designer launch each day OR first workspace-home view of the day, whichever fires first — catches anything that didn't tie cleanly to a track.

Never mid-task. Never on a `MessagePosted` or `ToolUsed` event. The synthesis pass debounces 30s after the trigger to absorb burst events from a multi-step track close.

#### Changes

**Backend (`apps/desktop/src-tauri/src/core_learn.rs` + new `core_proposals.rs`)**
- New `EventPayload::ProposalEmitted { proposal: Proposal }` and `ProposalResolved { proposal_id, resolution }` per the Lane 0 ADR (additive — no version bump).
- New `Proposal` struct in `designer-core`: `{ id, source_findings: Vec<FindingId>, title, summary, severity, kind: ProposalKind, suggested_diff: Option<String>, created_at }`. `ProposalKind` enumerates the kinds from the §"Proposal kinds" table; Phase 21.A1.2 ships the enum but only the `Hint` variant (no auto-edits) is wired.
- New `core_proposals::synthesize_pending(project_id)` that reads unprocessed `FindingRecorded` events, groups by `(detector_name, workspace_id, window_digest)`, emits one `ProposalEmitted` per group with the source-finding IDs attached. Idempotent — replays are safe.
- New `core_proposals::on_track_completed(track_id)` and `core_proposals::on_first_view_of_day(project_id)` hook points; both call `synthesize_pending` after a 30s debounce.
- The `report_finding` chokepoint stays exactly as shipped. The cap rationale comment shifts from "live feed protection" to "scratch buffer protection."

**IPC (`crates/designer-ipc/src/lib.rs` + `commands_learn.rs`)**
- New `cmd_list_proposals(project_id, status_filter) -> Vec<ProposalDto>` (status: open / accepted / dismissed / snoozed).
- New `cmd_resolve_proposal(proposal_id, resolution: ProposalResolution)` — emits `ProposalResolved`.
- `cmd_signal_finding` is **kept but soft-deprecated** — calibration thumbs move to proposals. Document the deprecation in the IPC; keep working for the existing 21.A1.1 surface during the transition.
- New `cmd_signal_proposal(proposal_id, signal: ThumbSignal)` — Phase B will use this for calibration; Phase 21.A1.2 just persists the signal.

**Frontend**
- `packages/app/src/components/Workspace/DesignerNoticedHome.tsx` — rewrite to render *proposals*, not findings. Each row: severity dot, proposal title, "from N observations" disclosure (expandable evidence drawer with the source findings), Accept / Edit / Dismiss / Snooze actions, optional `calibrated 👍/👎` badge after thumbing.
- Empty state copy updates: "Nothing to suggest yet — Designer reviews patterns when you finish a track or once per day." Removes the implication of continuous watching.
- `packages/app/src/components/DesignerNoticed/DesignerNoticedPage.tsx` (Settings → Activity → Designer noticed) — same row-component reuse pattern. Settings becomes the proposal archive (all proposals across projects + statuses + filters); the *findings* archive sits behind a "Show evidence" disclosure on each proposal, not as its own list.
- `packages/app/src/store/app.ts` — `noticedUnreadCount` derives from `ProposalEmitted` events since `noticedLastViewedSeq`, not `FindingRecorded`. Cleared on home/archive view.

**Removed**
- The per-event sidebar badge increment from 21.A1.1. Badge updates only on `ProposalEmitted`, which only fires at boundaries.
- The standalone `<FindingRow />` user-facing component (kept internally as a sub-component of the evidence drawer; never rendered as a top-level row).

#### Tests
- Workspace home renders proposals (not findings); empty state copy passes accessibility audit.
- Sidebar badge increments on `ProposalEmitted`, not on `FindingRecorded`. Verified by emitting 10 findings without a track-complete trigger and asserting badge stays at 0.
- `synthesize_pending` is idempotent: running it twice with no new findings produces no duplicate proposals.
- `on_track_completed` debounces — burst of 5 `FindingRecorded` within 10s of a `TrackCompleted` produces exactly one synthesis pass.
- `on_first_view_of_day` fires once per calendar day per project; subsequent views in the same day no-op.
- Calibration thumbs persist via `cmd_signal_proposal`; the deprecated `cmd_signal_finding` keeps working for the transition window.

#### Done when
- Detectors continue to fire on every event (unchanged), but the user never sees an individual finding rendered on the workspace home or in Settings as a top-level item.
- "Designer noticed" updates at exactly two cadences: after a `TrackCompleted` event (debounced 30s) and on first workspace-home view of each calendar day. Nothing else triggers a refresh.
- The unit a user thumbs is a **proposal** (a recommendation), not a finding (an observation). Findings are visible only as collapsed evidence under each proposal.
- The cap and dedup logic from 21.A1.1 is preserved — runaway protection still works, just on the scratch buffer instead of on a live feed.
- 21.A2 detectors (any that have shipped at the time 21.A1.2 lands) integrate transparently — no detector PR needs to be amended.

#### Coordination with 21.A2
- 21.A1.2 and 21.A2 land in parallel (different layers). Detector PRs continue to follow the original prompts; only the *summary copy* convention changes (write clinical evidence text, not user-facing prose — see updated CONTRIBUTING.md addendum below).
- Append to `crates/designer-learn/CONTRIBUTING.md`: a "Summary copy" section explaining that detector summaries are evidence text rendered under proposals, not user-facing lines. Use passive voice, describe the pattern (not the user), no second-person address.

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

## Phase 22 — Project Home redesign *(Recent Reports / Roadmap / Designer Noticed)*

**Goal:** reshape the project Home tab into three surfaces, top to bottom — **Recent Reports** (curated digest of shipped work), **Roadmap** (live plan-anchored canvas with team presence), **Designer Noticed** (already in flight as Phase 21). Together they answer the manager's three opening questions: *what's new since I last looked, where are we in the plan, what should we standardize.*

**Why a dedicated phase:** today's Home tab (`packages/app/src/home/HomeTabA.tsx`) is a flat list of operational state — Needs-your-attention, Active workspaces, Autonomy, plus the existing Designer Noticed section. None of it answers "where are we relative to the plan" — the question a manager opens any tool to ask. As the agent fleet scales (10+ teams routine), the absence of plan-anchored awareness forces the user to mentally reconstruct progress every session. The Roadmap surface is also where Phase 20 (parallel-work coordination) becomes *visible* — when N tracks fan out against the same phase, the canvas is where contention, drift, and integration order surface.

**Naming convention.** Capitalized **Roadmap** for the surface; `roadmap.md` for the file. Same convention as "the spec" vs `spec.md`.

**v3 spec review — 2026-05-02.** The v3 draft of this spec (archived at `.context/attachments/pasted_text_2026-05-02_08-41-00.txt`) was reviewed on 2026-05-02. All first-principles cuts catalogued in *Considered, deferred* below hold — v3 re-litigated three-voice reports, hover-preview disclosure, the project-level Reports tab, the five-category Designer Noticed re-skin, Linear integration, and spring confirmation animation, but brought no new evidence to overturn the original cuts. **22.G + 22.B were pulled forward into Lane 2 in `plan.md` on 2026-05-02**; the rest of Phase 22 stays in Lane 5 deferred until dogfood signal motivates the canvas surface.

**Relationship to Phase 21.** Spec's "Phase F — Designer Noticed" is **satisfied by Phase 21**. The existing 21.A1.2 architecture (proposals over findings, boundary-driven cadence at `TrackCompleted` + first-view-of-day) is the user-facing Designer Noticed surface this spec calls for. Phase 22 does **not** redesign that surface; it places Designer Noticed as the bottom of three Home-tab sections and reconciles its taxonomy with the spec's five user-facing categories (Skill / Rule / Anchor / Routine / Agent) — see "Reconciliation with Phase 21" below.

**Sections removed from `HomeTabA.tsx`:** Active workspaces (replaced by Roadmap pills), Autonomy (moves to project settings), Needs-your-attention (migrates to Roadmap's adjacent attention column), `DesignerNoticedHome` (re-anchored as the bottom surface; component reused). The activity spine collapses by default at project altitude on the Home tab — its information is redundant with the Roadmap surface — but stays primary at workspace altitude and below. *Note:* the spec also calls for removal of "Near-term focus"; this section does not exist in `HomeTabA.tsx` today, so no removal action is needed.

### Reconciliation with Phase 21

Phase 22 places the existing 21.A1.2 Designer Noticed surface (`DesignerNoticedHome`) at the bottom of the new three-surface Home tab — no re-skin, no taxonomy change in v1. Existing components are reused as-is: `DesignerNoticedHome` / `DesignerNoticedPage` / `FindingRow` / `ProposalRow`. The verb-baked proposal title pattern that 21.A1.2 already uses (*"Add Rule: …"*, *"Add Skill: …"*) carries the action verb directly; no separate category icon system is introduced.

**The original spec's five-category re-skin (Skill / Rule / Anchor / Routine / Agent) is deferred** — see "Considered, deferred" below. Reasons: (a) one of the five (Anchor) has no backing detector today; (b) verb-baked titles already carry the action; (c) dogfood signal on the existing surface hasn't asked for grouping. If proposal volume crosses a legibility threshold during dogfood, revisit the re-skin then; the mapping table from the original spec stays here as reference for future work:

| Display category *(deferred)* | Phase 21 proposal kinds that would surface under it |
|---|---|
| Skill | `skill-candidate`, `prompt-template` |
| Rule | `feedback-rule`, `rule`, `rule-extraction`, `claude-md-entry`, `demotion`, `removal-candidate`, `conflict-resolution`, `context-trim`, `context-restructuring` |
| Anchor *(no detector today)* | `reference-doc`; future "pinned-context anchor" proposals |
| Routine | `hook`, `auto-approve-hook` |
| Agent | `agent-candidate`, `team-composition-change`, `routing-policy-tune`, `model-tier-suggestion` |

### Sub-phase decomposition (each independently shippable)

> **Recommended first slice:** **22.G + 22.B + 22.A + 22.I** behind a feature flag. Lands team identity, "what shipped" highlights, and a live plan view with shipping badges. Edit/attention infrastructure (22.D + 22.E) defers until dogfood signal motivates it.

Each sub-phase has its own goal, deliverables, and gate. Phases A, B, G can run in parallel — file ownership is disjoint.

### Procedure (applies to every UI sub-phase)

Per CLAUDE.md §"Procedure for UI tasks": before generating any new component for Phase 22, check `core-docs/component-manifest.json`. Existing components Phase 22 must extend (not parallel-invent):

- `WorkspaceStatusIcon` → status-circle treatment for nodes (extend with conic-arc states; do not introduce a new dot component).
- `SegmentedToggle` → "Hide completed" toggle on the canvas header (do not roll a new segmented control).
- `Tooltip` → "Done = shipped" inline education affordance, audit-trail hover on edited nodes, *Shipped here* badge expansion.
- `IconButton` → all canvas action affordances (chevrons, attention-card actions). Enforces hit-target sizing (axiom #14) automatically.
- `DesignerNoticedHome` / `DesignerNoticedPage` / `FindingRow` / `ProposalRow` → reuse for the Home tab's bottom surface; do not author parallel components.
- `WorkspaceThread` → filtered lens for click-into-agent (22.H); no new tab kind.
- `AppDialog` → any modal flow in 22.C (origination paths).

Token namespacing for 22.G: new tokens are `--team-1`..`--team-16` (light + dark variants), explicitly **not** `--accent-team-*` — accents stay monochrome per axiom #3. Add an entry to `pattern-log.md` clarifying that team identity tokens and accent tokens are orthogonal and never substitute for each other.

---

### Phase 22.G — Color system *(axiom #3 amendment; pullable into 15.x polish)*

**Goal:** introduce a constrained chromatic palette for team and team-presence identity, layered on top of the existing monochrome chrome. App chrome stays monochrome; only team identity and semantic state pop.

**Why first:** every other Phase 22 piece (team-tinted rows, status circles, team-label dots, attention-card pills) consumes this palette. Without it, the canvas falls back to monochrome and the manager-of-agents metaphor doesn't read. Small enough to land as a Phase 15.x polish bite.

**Deliverables:**
- ~16-hue palette stepped around an OKLCH wheel at fixed chroma + lightness; chroma deliberately below the existing semantic palette so success/warning/danger still pop.
- Two mode-specific scales (light + dark) so contrast against the content surface holds.
- Two derivable values per hue: a soft tint (~7–8 % alpha for row backgrounds) and an inked color (status circles, dots, pill borders).
- Wrap behavior past 16 workspaces with a small lightness shift.
- Workspace color picker in project settings; team color persists per `(project_id, team_id)`.
- Pulse-rate generator: each team's dot pulses at its own rate in the 1.4–2.0 s range, deliberately incommensurate so dots drift in and out of phase rather than syncing. Honors `prefers-reduced-motion` (renders as a static dot).
- `core-docs/design-language.md` axiom #3 amendment + entry in `core-docs/pattern-log.md` (semantic vs identity color separation rationale).

**Where team color appears:** row tints on claimed nodes, status circles for In Progress / In Review states, team-label dots, attention-card pills.

**Where team color does NOT appear:** activity spine rows (stay monochrome with state dots), node text or backgrounds, Designer Noticed categories (icon shape carries the category), card chrome.

**Semantic colors stay orthogonal:** Done / shipped = green (universal — same green as the status checkmark); Savings / impact = green (Designer Noticed anchor proposals); Warning = amber (audit flags); Danger = red (scope denial, errors); Info = blue (conflict warnings, agent questions).

**Done when:** axiom #3 amendment lands; tokens render correctly in both modes against design-language regression fixtures; `prefers-reduced-motion` static-dot fallback verified; design-lab catalog renders all 16 hues with their light + dark variants for review.

**Gates on:** none meaningful — pullable into Phase 15 polish at any time. Recommend landing **before** 22.A so the canvas debuts with team color.

---

### Phase 22.B — Recent Reports redesign

**Goal:** the lead Home-tab surface — curated highlights of shipped work, written in plain language about user-facing impact. Modeled on a team lead reporting to leadership: not every change, the consequential ones.

**Why this can ship before the canvas:** the `report` artifact already exists (Phase 13.F). 22.B extends it with one summary field and a read-state projection — no canvas dependency.

**Scope discipline (single voice, two-step disclosure, no Reports tab).** v1 ships **one voice** — high-level manager copy. Multi-voice (medium / technical) is reserved as a settings-future affordance behind a "show technical detail" toggle, off by default. Three voices generated at write time was rejected as feature creep: the primary user is one person (the manager), the Foundation Models cost (one extra call shape per ship event) is real, and dogfood signal hasn't asked for engineer-facing copy on the Home tab yet. Disclosure is **two-step** (inline summary → click to expand inline) — the hover-preview middle step was dropped as undiscoverable friction. Reports overflow expands **in place**; no project-level Reports tab is introduced (would silently violate Decision 36's retired-templates discipline; there is no project-altitude tab kind today).

**Deliverables:**
- **Single high-level summary field** on the `report` artifact: `summary_high` (additive, optional). Manager voice — leads with impact, skips implementation. Generated at write time, cached on the artifact (extends the existing `summarize_row` hook from Decision 39). The existing `summary` field (Decision 39) is **untouched** — it continues to drive the rail / collapsed-block views. `summary_high` is read **only** by the Recent Reports surface. **Migration of pre-22.B reports:** when the Recent Reports surface encounters a report without `summary_high`, it falls back to the existing `summary` field (no UI break, no backfill required). On-demand backfill is a settings affordance for users who want richer manager-voice copy on historical reports; default off.
- **Source classification** by the local model into one of: Feature / Fix / Improvement / Reverted. Internal refactors, doc-only changes, in-progress work do not surface here. Existing reports without classification fall back to "Improvement" for surfacing purposes; UI does not crash.
- **Read-state as a projection, not events.** v1 ships project-scoped only: `read_seq_by_project: HashMap<ProjectId, EventSeq>` — single integer per project, last-seen sequence in the report stream. Implicit advance on inline expand or tab open; explicit *Mark all read* footer action advances to the head of the report list. Section header reads *"3 unread"* or *"All caught up"*. **Why not user-scoped at v1:** there is no `UserId` concept in single-machine Designer until team-tier (Phase 17). Shaping the projection key as `(UserId, ProjectId)` today bakes in infrastructure that doesn't exist. When team-tier lands, extend the projection key — additive schema change, no event-log rewrite needed (the projection rebuilds from the existing report stream). **Why a projection, not events:** per-report `ReportRead` events would bloat the event log linearly with reports × users; a single seq-per-project projection captures the same information in O(1) state.
- **Two-step disclosure pattern:** (1) inline 1–2 line summary always visible with classification chip + workspace label + PR link; (2) click expands the report inline with the full body and an *Open in tab* button — only this last step creates a tab. Tabs stay opt-in; scanning and reading do not pollute the tab bar. The hover-preview middle step from the original spec is dropped.
- **Item count + overflow.** Three reports visible by default. *Show more* reveals the next 4–5 in place; *Show all (N)* expands the section to its full list inline. **No project-level Reports tab.** Decision-log entry: *"Reports overflow stays inline; no project-level tab kind introduced"* (Decision 56).
- **Importance ordering.** Category-weight × recency-decay × scope. Features outrank fixes outrank improvements; recent items outrank older; large-scope items (multiple workspaces touched, big diff) outrank small. v1 ships a simple version; the scoring earns more sophistication if it feels off in dogfood.
- **Empty state.** *"Nothing shipped yet — highlights will surface here as work lands."*
- **Performance contract.** First paint < 100 ms; summary text already cached on the artifact.

**Future affordance (out of v1):** if dogfood signal asks for engineer-facing copy, add a settings toggle "show technical detail in reports" — when on, generate `summary_technical` at write time and surface a per-report toggle. Two voices, not three. Defer until the signal lands.

**Done when:** every newly-shipped PR or completed track produces a `report` artifact with `summary_high`, classification, and link metadata; the read-state projection advances on inline expand and tab open; the section header reflects unread count; the *Show all* expansion renders inline without opening a new tab.

**Gates on:** Phase 13.F (`report` artifact exists, summary hook in place). The summary generation extends the existing `summarize_row` hook — no new IPC surface.

---

### Phase 22.A — Roadmap canvas foundation

**Goal:** parse `roadmap.md` into a structural cache, render it as a live tree of nodes with stable HTML-comment anchors, overlay workspace / track / sub-agent presence, and jump-off into deeper drill surfaces. The canvas is read-only by default; direct edits open the markdown in a tab.

**Core concept.** The roadmap is a tree of nodes with stable IDs at every depth. Top-level nodes are typically phases or major features; nested nodes are progressively finer slices; leaves are roughly PR-sized work units. Depth is user-controlled. Any agent or team can attach to any node. A workspace can claim a whole sub-tree; sub-agents can claim leaves inside it. Presence rolls up — a leaf with an active sub-agent makes its parent show aggregate "1 active here" without the parent being claimed itself.

**Deliverables:**

- **Parser + structural cache.** Web Worker parse < 100 ms for a 64 K `roadmap.md`. Structural cache only — bodies parsed lazily on expansion. Re-parse only on `roadmap.md` mtime change.
- **Stable anchors.** HTML comments on the line (`<!-- anchor: payments.refunds.api -->`). Auto-injected on first parse where missing. Travel with the line if the user moves it.
- **Data model.**
  ```rust
  RoadmapNode { id, parent_id, depth, headline, body_offset, body_length,
                child_ids, external_source: Option<ExternalSource>,
                status: NodeStatus, shipped_at: Option<Timestamp>,
                shipped_pr: Option<PrRef> }
  NodeStatus { Backlog, Todo, InProgress, InReview, Done, Canceled, Blocked }
  NodeClaim { node_id, workspace_id, track_id, subagent_role, claimed_at }
  NodeShipment { node_id, workspace_id, track_id, pr_url, shipped_at }
  ```
- **Three derived projections in `designer-core`:** `node_to_claimants` (live), `claimants_to_node` (live), `node_to_shipments` (historical, holds `NodeShipment` records). All O(1) lookups, all updated incrementally. Multi-claim ordering is deterministic: stacked team labels sort by `claimed_at` ascending; ties break by `team_id` lexicographic. Stable across event-replay. Naming convention matches existing 13.E projections (`tracks_by_workspace`, etc.) — projection names use `_by_` / `_to_` joins; struct names are PascalCase singular.
- **Claim event source.** `TrackStarted` gains an additive `anchor_node_id: Option<NodeId>` field per the Lane 0 ADR (additive `EventPayload` extension). When `cmd_start_track` is called with an anchor argument, the field is populated; the projection derives the `NodeClaim`. `node_to_claimants` cleans the entry on `Track::Merged` (claim becomes a `NodeShipment`) or `Track::Archived` (claim is dropped). Mid-flight re-claiming (a track changes which node it works on) is **out of scope for v1** — end the track and start a new one against the new anchor. Sub-agent claim derivation lives with 22.H, not 22.A.
- **Status set with the Done = shipped invariant.** A node may only sit at `Done` if a corresponding `NodeShipment` record exists in `node_to_shipments`. **Two enforcement paths, both gating on shipment evidence:**
  1. **Projection path (auto-derivation):** the `Track.state → NodeStatus` projection only emits `Done` when *both* `Track::Merged` and the matching `NodeShipmentRecorded` events are present. Without a shipment, projection emits `InReview` even on Merged.
  2. **IPC write path (manual):** writes from `cmd_resolve_proposal` (accepting a `completion-claim`) or `cmd_set_node_status` reject with `ApplyFailed { reason: "node has no shipment recorded" }` if no `NodeShipment` exists. Surfaces in the user's inbox.
  *Why not let the projector silently demote authored Done:* a projector that rewrites event-derived state without explanation makes events lie about themselves. Both paths gate on the same shipment evidence; both make the gating visible (UI label + inbox error). Linear-aligned visual treatment: open circle → partial-fill conic-arc (SVG, animated `stroke-dasharray` — CSS `conic-gradient()` does not transition between stops) → full-fill solid → green check.
- **`Track.state` → `NodeStatus` projection.** A claimed node's status is derived from the claiming track's lifecycle so the user sees one consistent vocabulary on the canvas:
  - `Track::Active` → `NodeStatus::InProgress`
  - `Track::RequestingMerge` → `NodeStatus::InReview`
  - `Track::PrOpen` → `NodeStatus::InReview`
  - `Track::Merged` (with shipment) → `NodeStatus::Done`
  - `Track::Merged` (without shipment yet) → `NodeStatus::InReview` (transient state until the shipment lands; in practice both events are emitted in the same transaction)
  - `Track::Archived` → `NodeStatus::Canceled` (when archived without merge) or untouched (when archived after merge — Done sticks)
  **Multi-claim status precedence (the bug fix).** When multiple tracks claim the same node, the projection takes the **maximum** state across claiming tracks under a "all-must-ship" Done gate:
  - Order: `Backlog < Todo < InProgress < InReview < Done < Canceled` (Canceled is terminal).
  - The node projects the max of the claiming tracks' statuses, **except** Done is only emitted when *every* claiming track has a corresponding `NodeShipment`. If any claim is unshipped, the node projects `InReview`.
  - *Rationale:* multi-claim is parallel work toward one node, not a race. The node is Done only when the work — all of it — is shipped.
  - Document this rule in `roadmap-format.md` so users splitting work across tracks understand the semantic.
  **Authored-status precedence rule.** Unclaimed nodes carry their authored `NodeStatus` from `roadmap.md` directly **with one exception**: if the markdown authors `Done` for a node that has no `NodeShipment`, the projection emits `InReview` (the Done = shipped invariant overrides authored status to keep the rendering honest). The "Done = shipped" tooltip surfaces in this case explaining why the markdown's `Done` reads as `InReview` on the canvas.
- **"Done = shipped" inline education affordance.** A parent with all sub-items checked but no shipment renders with an inline tooltip on the status circle: *"Ships when the PR for [headline] merges."* Avoids the "checklist looks done, parent's still grey" UX surprise. Re-uses existing `Tooltip` component.
- **Renderer.** New `roadmap` artifact kind in the block-renderer registry (Decision 38). Phase strip header at top (every phase as a clickable headline with status chip and `m/n` ratio). Active phase expanded inline; adjacent phases (immediately previous and next) as collapsed headlines so context is one click away. *Hide completed* toggle in the header (use existing `SegmentedToggle`). Expansion state persists per project.
- **Node anatomy.** Status circle, title, optional sub-rows, and (when claimed) a team identity. Status circle and title align flush at the same x; only sub-rows are indented. Chevrons appear in the left margin (in the card's padding area) for expandable rows — they don't push the status circle inward. Sub-items indent with a hairline vertical rail; sub-rows under an in-progress parent get a subtle team-color tint — `--team-tint-light` (~7 % alpha) and `--team-tint-dark` (~10 % alpha) — paired so dark mode keeps a perceptible tint above the noise floor.
- **Team identity rendering.** Inline label format: a small team-colored dot + the team name, no pill background. Status circles for In Progress / In Review use the team's color; Done is universal semantic green regardless of team. Multi-claim: horizontally stacked team labels; collapse to `+N` past **3** (revised down from 5 — 4–5 visible labels at once is project-altitude clutter; tune in dogfood) with an overflow popover.
- **Anchor splitting rule.** When the user splits a node into two in the markdown, the original anchor stays with the headline that retains the original first-line text. **Edge case (both halves diverge):** if neither resulting headline retains the original first-line text, the anchor follows the **first** headline in file order (the one that appears earlier). Existing claims and shipments resolve against the surviving anchor. The rule is deterministic on every parse, so the same edit always produces the same outcome. Document in `roadmap-format.md`.
- **Manual track-to-node linkage** via `cmd_start_track` anchor argument: starting a track against a known node populates the claim immediately. Phase 22.H adds sub-agent claim discovery; Phase 22.I adds shipment history.
- **Block-renderer registry registration.** Three new artifact kinds register renderers per Decision 38 (`registerBlockRenderer(kind, Component)`): `roadmap` (canvas surface), `roadmap-edit-proposal` (inline diff card on the canvas, ships with 22.D), `completion-claim` (status-change card on the canvas, ships with 22.D). All three land in the same module under `packages/app/src/blocks/`. Unknown-kind fallthrough to `GenericBlock` keeps replay safe if a renderer is missing.
- **Drill-in actions.** Click a workspace pill → focuses the workspace in the project strip. Click a node headline → expands the node body inline. Click *Open in editor* → opens `roadmap.md` at that node's range. Sub-agent pill (and click-into-agent surface) ships with 22.H. The canvas itself never opens new tabs unilaterally.
- **`core-docs/roadmap-format.md`** ships with new projects, describing the convention (anchor injection, `Track.state → NodeStatus` mapping, anchor-split rule) without enforcing it.
- **Performance contract.** Cold open: first paint < 200 ms for a 64 K `roadmap.md` (active phase expanded; other sections placeholdered). Presence updates: < 16 ms (single frame). Per-node `useSyncExternalStore` subscriptions; CSS-only attribute flips for state changes. Section-level virtual scroll; `content-visibility: auto` on off-screen sections **with explicit `contain-intrinsic-size` to prevent scrollbar jump as bodies paint in**. Projection lookups: O(1); maintained incrementally. Performance regressions in any of these gate the release.
- **Reduced-motion fallbacks (required, not optional — per axiom #5):** pulses → static dot; conic-arc state transitions → instant flip; expand/collapse → instant; `Track.state → NodeStatus` transition animations → instant fill. No exceptions.
- **Pulse implementation.** CSS keyframe animation on the dot's `box-shadow` or `opacity` — never JS-driven. 10+ concurrent pulses must compile to GPU-accelerated transforms; verify on integrated GPU before merge.

**Done when:** the project Home tab renders the Roadmap surface against this project's `core-docs/roadmap.md`; the four-perspective review of a real edit cycle (parse → claim → status update → render) holds the performance contract; the canvas degrades gracefully on a malformed `roadmap.md` (parse-error state with *Open in editor*; pills, claims, and side attention suppress until parse succeeds).

**Gates on:** Phase 13.E (track primitive — for `cmd_start_track` anchor argument); Phase 22.G recommended (so canvas debuts with team color); Phase 13.1 (block-renderer registry).

---

### Phase 22.I — Track completion + shipping history

**Goal:** make the canvas demonstrably *alive* — when a track ships, its node lights up with a green check + a "Shipped here" badge that persists even after the live claim cleans up.

**Deliverables:**
- `NodeShipment { node_id, workspace_id, track_id, pr_url, shipped_at }` projection — append-only; cleans nothing.
- Live-claim cleanup on `Track::Merged` event: `node_to_claimants` drops the entry; `node_to_shipments` gains the entry.
- *Shipped here* badge on completed nodes — small pill below the headline, monochrome by default, expands to show the team identity + PR URL on hover.
- Pill annotation during `PrOpen` — node shows In Review with the team color; flips to Done (green) on Merge.
- Audit-trail surfacing on hover: *"Shipped by team X via PR #N on YYYY-MM-DD"*.

**Done when:** a real track lifecycle (Active → PrOpen → Merged) produces the right visual progression on the canvas; shipping history persists permanently; live claims clean up cleanly on Merge.

**Gates on:** Phase 22.A; Phase 13.E (`Track::Merged` event already in place).

---

### Phase 22.D — Edit & proposal flow

**Goal:** agents can propose roadmap edits via a new artifact kind that the user accepts inline; direct user edits open the markdown in a tab; reversible status updates auto-apply under Act / Auto autonomy.

**Deliverables:**
- **New artifact kinds:** `roadmap-edit-proposal` (agent-proposed edit with unified diff), `completion-claim` (agent-proposed status change for a node).
- **New events:** `RoadmapEditProposed/Accepted/Rejected/Superseded`, `NodeStatusChanged { node_id, from, to, source }`.
- **Inline accept/reject UI** on the canvas — the proposal renders attached to the affected node as an expandable card; Accept applies the diff; Reject archives it; Edit opens an in-app composer with the diff pre-loaded.
- **Autonomy gradient applied to edits:**

  | Autonomy | Status updates | Adding sub-items | Renaming | Restructuring | Removing |
  |---|---|---|---|---|---|
  | Suggest | Proposed | Proposed | Proposed | Proposed | Proposed |
  | Act | Auto-applied | Proposed | Proposed | Proposed | Proposed |
  | Auto | Auto-applied | Auto-applied | Auto-applied | Proposed | Proposed |

- **Conflict / supersession.** Two agents propose edits to the same node within a window → both surface as alternatives in the inbox. User direct-edits a node with a pending proposal → proposal invalidates. Pending proposals on archived nodes auto-reject.
- **Audit trail.** Every edit lands as an event. Node hover surfaces *"last edited by: agent in workspace X, auto-accepted under Act 3 days ago"*.
- **Open question (track in spec):** whether `RoadmapEditProposed` artifacts should also surface in Recent Reports if accepted (a "the plan changed" highlight). Probably yes for restructuring, no for status updates.

**Done when:** an agent in a real workspace can propose a status update via `completion-claim`, the user accepts inline, the canvas reflects the change, and the audit trail surfaces on hover. Conflict between two simultaneous proposals renders as side-by-side alternatives.

**Gates on:** Phase 22.A (canvas + node data model); Phase 13.G (autonomy infrastructure already exists).

---

### Phase 22.E — Adjacent attention column

**Goal:** migrate "Needs your attention" from the Home tab into a column adjacent to the Roadmap canvas, with one card per attention item carrying a binary action pair.

**Unified accept-pattern across the Home tab.** Adjacent attention cards, Designer Noticed proposals, and roadmap edit proposals (22.D) all use the **same binary primary**: Dismiss / Accept (verb-customized per-context: Deny / Approve, Hold / Merge, etc.). Edit elevates to a separate inline action only when a diff is involved (22.D). Snooze drops to a kebab-menu item, not a top-level button. Rationale: three different accept-patterns on one tab was incoherent — one pattern with documented variations restores legibility. Logged as Decision 57.

**Deliverables:**
- **`AttentionItem` data model + projection.**
  ```rust
  AttentionItem {
    id, kind: AttentionKind,  // Approval | AuditFlag | ConflictWarning | AgentQuestion | ScopeDenial
    workspace_id, team_id,
    anchor_node: Option<NodeId>,
    title: String,                // ≤ 80 chars, hard-bounded
    body_summary: String,         // ≤ 240 chars, generated/truncated; full body opens a drawer
    context: AttentionContext,
    created_at, resolved_at: Option<Timestamp>,
  }
  ```
  Projection `workspace_to_attention_items` (open items only, ordered by `created_at`). On workspace archival or fork, open items are resolved with `resolution: WorkspaceArchived` so the projection stays clean.
- **New events:** `AttentionItemOpened/Resolved`.
- **Card design.** One card per item, stacking vertically with breathing room. Each card carries the requesting team's identity pill at the top (pill backgrounds are reserved for this column where cards float against white), a concrete title (≤ 80 chars), a body summary (≤ 240 chars — full body opens a drawer click; prevents giant cards from pushing the rest off-screen), and a **binary action pair** (Hold / Merge, Deny / Approve, etc.) — uniform Dismiss / Accept under verb-customized labels per "Unified accept-pattern" above.
- **Confirmation treatment (snappy, not spring):** on merge / approve actions, the button fills green over `--motion-emphasized` (400 ms ease-out) — no scale pop. Green persists as the "selected" state until the card slides out (`--motion-standard` translate-out). Reuses the same green as the Done checkmark for visual continuity. **Why no spring:** axiom #5 explicitly prohibits crossing into expressive/spring territory; a celebratory bounce would require amending #5 alongside #3, which is a much larger move than introducing chromatic team identity. The fill-and-slide treatment carries the same "your action took" semantic without violating the motion personality.
- **Reduced-motion fallback (required per axiom #5):** instant green fill (no transition); instant card removal (no slide-out). Audited by Mini's `audit-a11y` skill before merge.
- **Empty-column treatment.** *"All clear — agents will surface approvals, audit flags, and questions here."*
- **Card kinds wired** with explicit per-kind title / body derivation so cards read consistently across sources:

  | Kind | Source event | Title (≤ 80 chars) | Body summary (≤ 240 chars) | Action labels |
  |---|---|---|---|---|
  | Approval | `ApprovalRequested` | `"{tool} request"` (e.g. "Edit request") | First line of `summary` field, then `path` if present | **Deny** / **Approve** |
  | AuditFlag | `comment` artifact, `author_role: Some("auditor")` | `"Audit: {first_line(body)}"` | Remainder of `body` truncated; full body opens drawer | **Dismiss** / **Address** |
  | ConflictWarning | `recent_overlap()` cross-workspace | `"{filename} edited in {N} workspaces"` | List of workspace names with last-edit timestamps | **Dismiss** / **Coordinate** (opens involved workspaces) |
  | AgentQuestion | `MessagePosted` with question heuristic (ends in `?`, contains "should I" / "do you want") | First sentence of message, ≤ 80 chars | Remainder of message, truncated | **Dismiss** / **Reply** (opens workspace thread at the message) |
  | ScopeDenial | `ScopeDenied` | `"Blocked: {operation} on {path}"` | `reason` field; if user has approved the path elsewhere recently, append "(approved in {workspace} 2h ago)" | **Dismiss** / **Allow once** / **Allow always** (kebab-menu for Allow always) |

  Heuristics live in `crates/designer-core/src/attention.rs`; each kind has a fixture-tested `from_source(...) -> AttentionItem` constructor. Variants beyond the binary primary (e.g. ScopeDenial's "Allow always") drop into the kebab-menu — top-level chrome stays binary per Decision 57.
- **Removal from Home tab.** `Needs your attention` section in `HomeTabA.tsx` deletes when this column ships against real data; the existing `toggleInbox()` action redirects to a filtered lens on the column.

**Done when:** approvals, audit flags, conflict warnings, agent questions, and scope denials each render correctly in the adjacent column with the right action pair under the unified Dismiss / Accept primary; the snappy fill confirmation lands on merge approval against a real PR; the Home tab's `Needs your attention` section is deleted; reduced-motion fallback verified by `audit-a11y`.

**Gates on:** Phase 22.A (canvas placement); Phase 22.D (the proposal/accept flow this column extends); Phase 13.G (approval / scope event streams).

---

### Phase 22.H — Click-into-agent

**Goal:** clicking a sub-agent pill on the canvas opens that agent's filtered thread as a new tab.

**Deliverables:**
- **Sub-agent claim discovery** via task-list anchor references — when an agent-team task list (watched by `crates/designer-claude/src/watcher.rs` per Phase 12.A) contains an anchor (`<!-- anchor: ... -->`) in a teammate's task body, the projection updates that teammate's claim to the named node. Sub-agent claims do not replace the parent track's claim on the same node — they layer (parent track stays claimed; sub-agent shows as a finer-grained pill nested under the team label).
- **Watcher event extension** (prereq, may need a small task body parse): the current 12.A watcher emits `TaskCreated` / `TaskCompleted` events with task IDs, not bodies. Sub-agent claim discovery requires the watcher to emit (or expose for query) the **task body text** so the projection can extract `<!-- anchor: ... -->` references. If the watcher's current shape doesn't include body text, this lands as an additive field on the existing event variant per the Lane 0 ADR. Confirm shape against `~/.claude/teams/{team}/config.json` and `~/.claude/tasks/{team}/` parser before scoping.
- Per-agent filter on the existing `WorkspaceThread` surface (no new tab kind — reuses the unified thread primitive from Phase 13.1).
- Click handler on team-label pill / sub-agent pill → opens the filtered thread.

**Done when:** clicking a sub-agent pill on the canvas opens the workspace thread filtered to that agent; the filter persists in the URL hash so the tab is shareable; sub-agent claim derived from a real task list with an anchor reference renders the correct pill on the correct node.

**Gates on:** Phase 22.A; Phase 13.D (real agent traffic); Phase 13.1 (`WorkspaceThread` primitive); Phase 12.A watcher exposing task body text (may require an additive event field — confirm before scoping).

---

### Phase 22.C — Roadmap origination *(minimal — empty + paste only)*

**Goal:** smooth the cold-start path with the two paths the spec actually needs at v1. Detect-existing, draft-with-workspace-lead, and normalize-with-diff-preview defer until users ask for them.

**Deliverables:**
- **No `roadmap.md`, no tracks.** Empty-state slab in the Roadmap section. Lead with what the canvas does, not what's missing: *"The Roadmap shows your project's plan with live agent presence. Draft one to begin."* One button: *Paste a draft* (uses existing `AppDialog` modal + `ComposeDock`-style multiline input).
- **User pastes.** Treated as canonical text. No silent reformatting. Writes to `core-docs/roadmap.md` and commits silently per Decision 18.
- **Malformed `roadmap.md`.** Quiet error state with parse error and *Open in editor*. Pills, claims, and side attention suppress until parse succeeds. Surface degrades, doesn't disappear.

**Future affordances (deferred):**
- Workspace-lead-drafted roadmap from project context.
- TrackStarted-triggered "what part of the roadmap is this?" picker.
- Repo-link detection of existing roadmap-shaped content in `docs/` / `README.md`.
- *Normalize for richer linking* with diff preview.

Each of these adds surface area before users have asked for it. Defer until dogfood signal makes the case.

**Done when:** cold-start renders the empty-state slab; paste produces a usable canvas; malformed-roadmap renders the error state with *Open in editor*.

**Gates on:** Phase 22.A.

---

### Phase 22.L — Phase 20 hookup *(delivered as part of Phase 20)*

This is a Phase 20 deliverable, not a Phase 22 deliverable — kept here as a forward reference. When Phase 20 ships, contention reports surface as canvas annotations (cluster of file-name pills under the affected node), drift warnings render as `ConflictWarning` cards in the adjacent attention column (22.E), and per-track scoped briefs are visible at track creation against contended nodes. Update the Phase 20 section's deliverables list when 22.A + 22.E are live.

---

### Phase 22.N — Merge queue

**Goal:** project-scoped sequential merge train that resolves conflicts between parallel-completed PRs with cross-PR context, preserves PR identity, and surfaces tier-2 semantic conflicts for review — without forcing the manager to dispatch "address conflicts" prompts to each track agent serially after every merge. Phase 20 *prevents* most conflicts via partition-before-fan-out; the merge queue *resolves* the residual conflicts that occur anyway, or that occur when Phase 20 wasn't applied (the dogfood case). Complementary, not redundant.

**Why a Phase 22 sub-phase:** the queue is project-level state that needs a project-level surface — a tab alongside Home / Roadmap. It composes against the same project-altitude primitives as the rest of Phase 22.

**Differentiator vs. existing tooling:** GitHub merge queue / Mergify / Bors / Graphite serialize merges to prevent semantic conflicts but reject PRs with textual conflicts; a human resolves. Composio agent-orchestrator and Overstory are the closest match (FIFO + tiered conflict-resolution) but are CLI-first with no manager surface and no cross-PR briefing of the resolution agent. Designer's edge is **cross-PR context briefing** for the resolution agent (every queued PR's description, diff summary, and project context is in scope before a single conflict is touched), surfaced through the project tab.

**Hard gates:** 13.E (Track + `cmd_request_merge`), 13.G (approval inbox primitives), Phase 20 (cross-PR project primitive), Phase 22.A (tab framework).
**Soft gate:** 22.E. v1 ships an inline Tier-2 approval `<Frame>` inside the queue tab; 22.N.1 migrates routing to the 22.E adjacent column once 22.E lands.

**Deliverables:**

- **`MergeQueue` aggregate** (project-scoped). Ordered list of `QueueItem`s; one queue per project. State machine: `Queued → InProgress → {AwaitingApproval | Testing} → Merged | Failed | Paused`. Failure / pause reasons are split into separate enums (`FailureReason` terminal, `PauseReason` recoverable).
- **Sequential FIFO processing.** Resolve conflicts → run tests → merge → advance. No speculative parallelism in v1; three v2 escape hatches frozen in the v1 data model (`base_ref` field on `QueueItem`, `BranchTarget` enum on `ResolutionCommit`, `(test_set_hash, commit_sha)` keys on `TestRunRecord`). v1 must populate all three fields fully so v2 reads with zero migration.
- **PR-identity preservation.** No meta-PRs. Resolution lands as one new commit on the original PR branch via `git push`; force-push is forbidden by an invariant check. Commit message: `Resolve conflicts with PR #<N>, #<M>` + `Co-authored-by: Designer Integration Agent`.
- **Cross-PR briefing payload.** `BriefingPayload` struct with `queued_prs: Vec<PrSummary>`, truncated `plan_md` + `claude_md` (≤ 8KB each). Volatile (never persisted in `EventPayload` or audit log). Forward-extensibility rule: additive-only fields, `Option<…>` for new ones, no removals without ADR — same rule as `EventPayload` per ADR 0002.
- **Conflict-tier classification:** Tier 0 (no conflict, just `git`), Tier 1 (mechanical — agent resolves; auto-merge on green), Tier 2 (semantic — agent flags `requires_review`; routes to inline approval in v1 / 22.E in v2.N.1), Tier 3 (unresolved — fails back to track with attempt context).
- **Pre-write gate (load-bearing).** Agent edits must lie inside `<<<<<<<` / `=======` / `>>>>>>>` regions. Out-of-marker edits fail the gate. Extends 13.G's pre-write gates.
- **Per-project autonomy slider.** `QueueAutonomyPolicy` lives in Project Home (per Decision 63). Defaults: Tier 0 always auto, Tier 1 auto-on-green, Tier 2 inline review, Tier 3 fail. Per-project setting can dial up/down within tier-valid combinations. `cmd_set_queue_autonomy` validates at IPC; rejects "auto-merge Tier 3."
- **Subprocess lifecycle and recovery.** One Claude Code subprocess per active queue (not per-PR), 15-min idle timeout. Boot recovery: items stuck in `InProgress`/`Testing` > 5 min auto-emit `QueueItemRecoveryStarted` and pause with `PauseReason::SubprocessRestarted`. Mid-session crash → same. v1 assumes a single Designer instance per project; multi-instance lease coordination deferred to v1.x.
- **Context freshness guarantee.** Diff summaries computed at enqueue, never refreshed (ground truth is conflict markers). External branch updates detected via batched `git ls-remote origin` every 5s (adaptive to 30s after 6 stable polls); cached 2s. On drift: pause with `ExternalUpdate`. PR closed externally: terminal Failed with `PrClosedExternally`. Internal-vs-external head detection: `QueueItemResolved` lands before next poll; projection suppresses `ExternalUpdate` for matching ref. Test required.
- **CI rerun suppression.** Queued PRs flip to draft on enqueue (`gh pr ready --undo`); back to ready at head. Most CI configs skip drafts; suppresses GitHub's auto-rerun on base-branch updates.
- **Cost accounting.** Queue spend rolls into existing `CostTracker` per-workspace lanes (workspace originating the track owns the lane; manual enqueues attribute to a `manual` project bucket). Queue-tab cost chip is an aggregate filter view — no `CostTracker` multi-lane extension needed. Default budget cap = 40% of project per-turn cap; over-budget pauses with `BudgetExceeded`. Tooltip: "Queue spend is included in workspace and project totals — not double-counted."
- **`Anchor::QueueItem` extension** (additive to the 13.K-frozen `Anchor`) — friction reports from the queue tab anchor to the focused item with `resolution_commit_sha` + `conflict_tier` auto-attached.
- **New IPC commands** (alphabetical registration in `tauri::generate_handler!`):
  ```
  cmd_enqueue_pr            cmd_pause_queue_item     cmd_resume_queue_item
  cmd_get_queue_state       cmd_remove_queue_item    cmd_set_queue_autonomy
  cmd_reorder_queue
  ```
- **Tab surface (v1, minimal-but-complete).** Composes `<Box role="tabpanel">` / `<Stack>` / `<Cluster>` / `<Frame>` (inline approval card on `AwaitingApproval` only) / `<IconButton>`. State pip palette uses existing `--success-*`, `--warning-*`, `--danger-*`, `--info-*`, `--gray-*` tokens — zero new scales. Header: title + autonomy chip + cost chip + total + ETA; reflows to two rows on 960–1100 px viewports. Item rows: drag handle (`⌥↑`/`⌥↓` keyboard; tooltip on focused row) + state pip + PR title + sub-text disambiguation + tier badge + workspace chip + kebab (`Pause` / `Resume` / `Remove` / `Open PR` / `Report issue` — **no in-app drill-in in v1**; use `Open PR` for full diff/rationale review on GitHub). Auto-enqueue from autonomous workspaces fires a toast notification.
- **Workspace integration.** Each workspace's track-completion surface gains an "Add to merge queue" button next to "Request merge". Auto-enqueue mode replaces (not removes) the button with a passive "Queued" indicator; toast confirms.

**Spec source:** `.context/specs/phase-22n-merge-queue.md` (v3 draft, two staff-perspective review passes, all blockers folded in 2026-05-02). ADR 0007 (proposed) captures `BranchTarget` enum, sequential-only v1 with v2 escape hatches, conflict-marker scope as load-bearing, `BriefingPayload` forward-extensibility rule, single-instance v1 assumption, soft-gate-on-22.E with v1 inline-approval fallback.

**Done when:** the acceptance tests below pass; `--features merge_queue_live` integration test (mirrors `claude_live` infrastructure) merges 3 conflicting PRs (Tier 0 / 1 / 2) end-to-end on a test repo and fails the 4th (Tier 3) cleanly back to its track; `audit-a11y` green; pattern-log + generation-log + component-manifest entries landed; ADR 0007 merged.

---

### Phase 22.N.1 — Merge queue UI craft + Tier-2 → 22.E migration

**Goal:** layer visual craft and migrate the Tier-2 routing surface from inline `<Frame>` to the 22.E adjacent attention column.

**Gates on:** 22.N (backend + minimal surface) + 22.E (adjacent attention column).

**Deliverables:**
- Full in-app drill-in surface (resolution diff + agent rationale + test output excerpt + audit-log slice for the item). Replaces the v1 "Open PR opens GitHub" detail path; "Open PR" remains as a secondary affordance.
- Drag-to-reorder visual craft: drop indicator hairline, ghost of dragged row, magnetic snap. Reference: Linear backlog drag UX.
- Motion details: drill-in slide, item slide-out on Merge / Remove, head-of-queue advancement transition. Reduced-motion fallbacks for each (instant flip / instant remove / no slide), per Decision 60.
- Density tuning: target row height matched to Recent Reports digest cards; 8–12 visible rows before scroll.
- First-run / onboarding empty-state explainer: 3–4 sentences ("Merge queue resolves conflicts between parallel PRs. Add PRs here to sequence their merges and let the agent resolve conflicts automatically. Tier-2 conflicts route to your attention column for review.").
- **Tier-2 routing migration:** items in `AwaitingApproval` collapse from inline `<Frame>` to a normal-height row + chevron pointing right; the approval card moves into the 22.E adjacent column. Backend events unchanged.
- Inline sub-state copy refinement: live-updating elapsed-time text on `InProgress` ("Resolving conflicts on PR #42 — 30s elapsed") and `Testing`.

**Done when:** `audit-a11y` passes the new drill-in surface and motion fallbacks; visual-regression snapshots cover the 22.E migration; row-density matches the Recent Reports baseline; onboarding tip renders on the empty state with a one-time dismiss.

---

### Considered, deferred (NOT on the Phase 22 roadmap)

These were in the original spec but cut from v1 after first-principles review (does it serve the moat — manager-of-agents, workflow above the model, context lives in the repo?). Each can be revisited if explicit user signal lands.

**Linear integration (was 22.J / 22.K).** Read direction, write direction, per-issue confirmation guard for org workspaces, all cut. *Why:* Linear is interop, not moat. Linear users live in Linear; Designer's value-prop is markdown-first plans living in the repo (Decision 17). A Linear-source-of-truth canvas creates two-source-of-truth confusion the original spec acknowledged but couldn't fully resolve. Logged as Decision 58.

**Designer Noticed five-category re-skin (was Phase F as user-facing taxonomy).** Five categories (Skill / Rule / Anchor / Routine / Agent) were the original spec's display layer over the Phase 21 detector list. Cut from v1 because (a) one of the five — Anchor — has no backing detector today, (b) the existing 21.A1.2 surface uses verb-baked proposal titles ("Add Rule: …") which already carry the action verb, potentially obviating the category icons, and (c) dogfood signal on the 21.A1.2 surface hasn't asked for grouping yet. Defer; revisit if proposal volume crosses the legibility threshold where grouping starts to earn its weight. Logged as Decision 59.

**Three-voice Reports / hover preview / project-level Reports tab.** All cut from 22.B (see the 22.B "Scope discipline" callout). One voice (high-level), two-step disclosure, expand-in-place. Multi-voice reserved as a future settings affordance.

**Gutter-pinned side comments on the canvas.** Adjacent attention column (22.E) covers v1; defer.

---

### New artifact kinds (Phase 22 summary)

- `roadmap` — renderer kind for the canvas (block-renderer registry, Decision 38).
- `roadmap-edit-proposal` — agent-proposed edit with unified diff.
- `completion-claim` — agent-proposed status change for a node.
- `report` — extended with `summary_high` field (22.B). `summary_technical` reserved for future settings affordance.

### New event types (Phase 22 summary)

- `RoadmapEditProposed/Accepted/Rejected/Superseded` (22.D)
- `NodeStatusChanged { node_id, from, to, source }` (22.D)
- `NodeShipmentRecorded { node_id, workspace_id, track_id, pr_url, shipped_at }` (22.I — emitted in the same transaction as `Track::Merged` so the Done-shipped invariant gate has the shipment to look up)
- `AttentionItemOpened/Resolved` (22.E)
- `QueueItemEnqueued / AdvancedToHead / Resolving / Resolved / AwaitingReview / TestsStarted / TestsCompleted / Merged / Failed / Reordered / Paused / Resumed / Removed / RecoveryStarted` (22.N — 14 variants, all carrying `queue_id`; per ADR 0002 addendum rule, each variant has an inline doc-comment naming Phase 22.N and existing projectors gain `_ => {}` arms)
- `Anchor::QueueItem { queue_id, item_id, resolution_commit_sha, conflict_tier }` — additive extension to the 13.K-frozen `Anchor` enum (22.N)

**Notably NOT events** (intentional — were in the original spec):
- `ReportRead` — replaced by `read_seq_by_user_by_project` projection (per-user seq, not per-report event). Avoids linear event-log bloat with reports × users.

### Out of scope (v1, definite)

Linear / Notion / Jira / Asana / GitHub Projects integration. Multiplayer cursor presence. Multiplayer markdown editing (canvas is read-only with *Open in editor*). Cycle / sprint overlay. Time-anchored views (Gantt, calendar). Roadmap history view in-app (git provides this). Per-node permission locks. Multiple roadmaps per project. Mobile equivalent (separate Phase 18 work). Notifications for Designer Noticed. Designer Noticed five-category re-skin (deferred per above). Designer Noticed categories beyond the initial five. Gutter-pinned side comments on the canvas (adjacent column covers v1). Three-voice Reports (deferred per above). Project-level Reports tab (deferred per above; expand-in-place covers v1).

### Open questions (before picking sub-phases up)

- Multi-claim visual at scale (5+ teams on one node) — `+N` collapse threshold (currently 3) tunes in dogfood.
- Spring vs. snappy on merge-confirm (22.E) — snapped to snappy fill per axiom #5; revisit only if dogfood says the fill doesn't carry enough "your action took" semantic.
- Whether to surface gutter-pinned side comments as a future addition to the adjacent column (22.E), or replace it entirely. Defer until usage signals.
- Whether `RoadmapEditProposed` artifacts should also surface in Recent Reports if accepted. Probably yes for restructuring, no for status updates.
- Whether the read/unread signal extends to other artifact kinds (PRs, approvals) or stays specific to reports. Defer until usage signal.

### Done when *(Phase 22 as a whole)*

- The project Home tab is the three-surface composition: Recent Reports → Roadmap → Designer Noticed. Activity spine collapses by default at project altitude.
- Recent Reports surfaces the last week's shipped work in a single high-level voice, with read-state tracking via the per-project projection.
- The Roadmap canvas renders `roadmap.md` with team-tinted rows, status circles, sub-agent presence, and shipping history. Performance contract holds.
- Adjacent attention column carries approvals, audit flags, conflict warnings, agent questions, and scope denials with a snappy fill confirmation (no spring — axiom #5 preserved); the unified Dismiss / Accept primary works across the column.
- Agents can propose roadmap edits inline; the autonomy gradient applies; the audit trail surfaces on hover.
- Click-into-agent opens the filtered workspace thread as a tab.
- Designer Noticed (Phase 21 surface, unchanged in v1) sits at the bottom of the Home tab.
- The Merge queue tab (22.N) accepts PRs regardless of textual conflict state, runs sequential FIFO conflict resolution with cross-PR briefing, preserves PR identity, surfaces Tier-2 review inline (v1) / in 22.E (post-22.N.1), and lands all PRs in their original branches with attributed resolution commits. Cost rolls into existing per-workspace lanes; no double-counting.
- All animations honor `prefers-reduced-motion` (verified by `audit-a11y`).

**Gates on:** Phase 13 (real runtime + safety + agent traffic); Phase 21 (Designer Noticed already shipped); Phase 22.G recommended before any visible-surface sub-phase. Phase 19 (multi-track) is *complementary* — sequential / parallel tracks are what produces the contention and presence the canvas visualizes; canvas can ship before Phase 19 with single-track presence.

### Acceptance tests (per sub-phase — gating before merge)

Each sub-phase ships these tests as part of its PR. Tests are the spec's contract: an agent picking up a sub-phase reads this list and knows when they're done.

**Phase 22.A — Roadmap canvas foundation**
- **T-A-1 — Anchor auto-injection.** Parse a `roadmap.md` with N headlines and zero anchors; assert N anchors injected on first parse, persisted to disk, and stable across re-parse.
- **T-A-2 — Anchor split rule (deterministic).** Fixture: split node "Foo" into "Foo prime" + "Bar." Assert anchor stays on "Foo prime" (higher similarity). Second fixture: split into "Alpha" + "Beta" (both diverge). Assert anchor follows the first headline in file order. Re-running the parse on the same input produces the same anchor placement.
- **T-A-3 — Done-shipped IPC enforcement.** Call `cmd_set_node_status(node, Done)` with no `NodeShipment`; assert `Err(ApplyFailed { reason: "node has no shipment recorded" })`. With a `NodeShipment` recorded first, the same call succeeds.
- **T-A-4 — `Track.state → NodeStatus` projection.** Fixtures for each Track.state: assert correct projected NodeStatus. Specifically Merged-without-shipment → InReview (not Done); Merged-with-shipment → Done; Archived-without-merge → Canceled; Archived-after-merge → Done sticks.
- **T-A-5 — Multi-claim status precedence.** Fixture: two tracks claim node X; track A is Active, track B is Merged with shipment. Assert node projects InReview (one claim unshipped — all-must-ship). Then ship track A; assert node projects Done.
- **T-A-6 — Multi-claim ordering determinism.** Fixture: 4 claims with mixed `claimed_at` and `team_id`. Assert stacked-label order is sorted by `claimed_at` asc, ties by `team_id` lexicographic. Replay the event log; assert identical order.
- **T-A-7 — Authored-Done-without-shipment demotion.** `roadmap.md` authors a node as Done with no shipment recorded. Assert projection emits InReview and the "Done = shipped" tooltip is rendered.
- **T-A-8 — Performance contract.** Fixture: `crates/designer-core/tests/fixtures/roadmap_64k.md` (deterministic, ~64 K). Assert parse < 100 ms in Web Worker; first paint < 200 ms; presence update on a single-claim event < 16 ms.
- **T-A-9 — Malformed roadmap graceful degrade.** Fixture: `roadmap.md` with broken markdown. Assert canvas renders parse-error state with *Open in editor* button; pills, claims, attention column suppress until parse succeeds.
- **T-A-10 — Reduced-motion fallbacks.** With `prefers-reduced-motion: reduce`: assert pulses are static (computed style); conic-arc transitions instant; expand/collapse instant. Verified by Mini's `audit-a11y` skill.

**Phase 22.B — Recent Reports**
- **T-B-1 — `summary_high` migration safety.** Fixture: existing report artifact (Phase 13.F shape) with no `summary_high` field. Assert Recent Reports renders the report using `summary` fallback; no crash, no blank card.
- **T-B-2 — Read-state advance (implicit).** Write 5 reports (seq 100–104). Click-expand on report 102. Assert `read_seq_by_project` advances to 102; unread count is 2 (103, 104).
- **T-B-3 — Read-state advance (explicit Mark all read).** Click *Mark all read*. Assert `read_seq_by_project` advances to head (104); unread count is 0; section header reads "All caught up."
- **T-B-4 — Importance ordering.** Fixture with mixed Feature/Fix/Improvement/Reverted reports across last 30 days. Assert Feature outranks Fix outranks Improvement; recent outranks older; large-scope outranks small-scope.
- **T-B-5 — Two-step disclosure.** Click on inline summary expands the report inline. Click *Open in tab* creates a tab. Hovering inline summary does **not** open a popover (the hover step from the original spec was dropped).

**Phase 22.G — Color system**
- **T-G-1 — AA contrast across all combinations.** For all 16 hues × {light, dark} × {text-on-tint, dot-on-surface}: assert WCAG AA pass (4.5:1 for text, 3:1 for UI elements). Automated as a Mini invariant in `tools/invariants/check.mjs`.
- **T-G-2 — Token namespacing.** Assert `--team-1`..`--team-16` exist; `--accent-*` tokens remain bound to monochrome `--gray-*`; no `--accent-team-*` token exists.
- **T-G-3 — Sub-row tint visibility.** Assert `--team-tint-light` ≥ 7% alpha and `--team-tint-dark` ≥ 10% alpha. Render against light + dark surfaces; assert tint is perceptible (≥ 1.05:1 contrast against surface) without breaking text contrast.
- **T-G-4 — Pulse rate incommensurability.** Assign 10 random teams pulse rates from the 1.4–2.0 s pool; assert no two are equal; assert the pairwise GCD-based phase-coincidence interval is > 100 s (no visible sync within typical viewing).
- **T-G-5 — Reduced-motion → static dot.** Assert a team dot with `prefers-reduced-motion: reduce` has no animation in computed style.

**Phase 22.I — Track completion + shipping history**
- **T-I-1 — `Track::Merged` → claim cleanup + shipment record.** Emit `Track::Merged` for a claimed node; assert `node_to_claimants` drops the claim; `node_to_shipments` gains a `NodeShipment`. Both happen atomically (assert via projection state at single seq).
- **T-I-2 — Shipped here badge.** Render a node with one shipment; assert "Shipped here" pill renders below the headline; hover expands to show team identity + PR URL.
- **T-I-3 — Shipping history persists across replay.** Replay the event log; assert `node_to_shipments` rebuilds identical `NodeShipment` records in the same order.

**Phase 22.D — Edit & proposal flow**
- **T-D-1 — Conflict surfacing.** Two agents emit `roadmap-edit-proposal` against the same node within 5 minutes. Assert both render as alternatives in the inbox; accepting one auto-rejects the other (`RoadmapEditSuperseded`).
- **T-D-2 — Direct user edit invalidates pending proposal.** With a pending proposal on node X, user direct-edits node X via *Open in editor* + save. Assert the proposal flips to Rejected with reason "user edited the node directly."
- **T-D-3 — Idempotent accept.** Accept the same `completion-claim` twice (double-click retry). Assert exactly one `NodeStatusChanged` event emitted; second acceptance is a no-op.
- **T-D-4 — Autonomy gradient.** Under Suggest: status-update proposals require accept. Under Act: status-update proposals auto-apply; structural proposals (add/rename/restructure/remove) still require accept. Under Auto: status + add + rename auto-apply; restructure/remove still require accept.

**Phase 22.E — Adjacent attention column**
- **T-E-1 — Per-kind derivation correctness.** For each of the 5 kinds: feed source event into `from_source(...)`; assert title + body_summary + action labels match the table in the spec.
- **T-E-2 — Bounding enforced.** Pass title > 80 chars; assert truncated to 80 with ellipsis. Pass body > 240 chars; assert truncated to 240; full body opens via drawer click.
- **T-E-3 — Workspace archival cleanup.** Open AttentionItems exist for workspace W. Archive W. Assert all open items resolve with `WorkspaceArchived`; column re-renders without them.
- **T-E-4 — Snappy fill (no spring).** Click Approve; assert button transitions over `--motion-emphasized` (400 ms ease-out fill, no scale transform). Computed style verifies no `transform: scale()` keyframes.
- **T-E-5 — Reduced-motion fallback.** With `prefers-reduced-motion: reduce`: assert fill is instant (no transition); card removal is instant (no slide-out).
- **T-E-6 — Empty state.** Empty `workspace_to_attention_items`; assert "All clear" copy renders.

**Phase 22.H — Click-into-agent**
- **T-H-1 — Sub-agent claim derivation.** Watcher emits a task with body containing `<!-- anchor: foo.bar.baz -->`. Assert the projection updates the assigned teammate's claim to the node with anchor `foo.bar.baz`.
- **T-H-2 — Pill click opens filtered thread.** Click sub-agent pill; assert a tab opens rendering `WorkspaceThread` filtered by that agent's role; URL hash includes the filter.

**Phase 22.C — Roadmap origination**
- **T-C-1 — Empty state copy + paste path.** With no `roadmap.md`: empty state renders with the lead-with-purpose copy; *Paste a draft* opens `AppDialog`; submitting writes to `core-docs/roadmap.md` and commits silently per Decision 18.
- **T-C-2 — Malformed paste degrades, doesn't crash.** Paste markdown that fails the parser; assert error state with *Open in editor*; surface degrades; no toast spam.

**Phase 22.N — Merge queue**
- **T-N-1 — Sequential FIFO end-to-end (`--features merge_queue_live`).** Three conflicting PRs (one Tier 0, one Tier 1, one Tier 2) enqueued in arbitrary order on a fixture repo; the queue resolves, surfaces Tier 2 inline, accepts a programmatic approve, runs tests at each head, and merges all three to `main` in queue order with attributed resolution commits on each PR branch. A fourth PR forced to Tier 3 fails cleanly back to its track with the failed attempt context.
- **T-N-2 — Conflict-marker scope gate.** 10+ fixture diffs in `crates/designer-integration/tests/fixtures/`: edits inside markers pass; edits outside markers (surrounding-line modifications, header rewrites, import-block changes outside the `<<<` region) fail the pre-write gate as a validation error.
- **T-N-3 — State-machine property tests.** Every declared transition is reachable; no unreachable states; `QueueItemResolved` sets `conflict_tier` exactly once; `Paused → Resume` returns to the prior state.
- **T-N-4 — Boot recovery emits audit event.** Crash Designer with an item in `InProgress`; restart; assert `QueueItemRecoveryStarted { prior_state: InProgress }` is emitted before the item transitions to `Paused { SubprocessRestarted }`.
- **T-N-5 — External-update poll: drift detection + cache + backoff.** Deterministic test against fake `git ls-remote` output. Drift on a queued PR's head pauses with `ExternalUpdate { new_head }`; results cached for 2s; after 6 stable polls, interval shifts from 5s to 30s.
- **T-N-6 — Internal-vs-external head detection race.** Resolution commit pushed by the agent fires a `QueueItemResolved` event; a poll fires immediately after; the projection suppresses an `ExternalUpdate` for the matching ref. Without this guard, the test detects a false `ExternalUpdate`.
- **T-N-7 — `cmd_set_queue_autonomy` validation.** Submit `auto-merge Tier 3`; assert `Err(AutonomyValidationError)`. Valid combinations accepted.
- **T-N-8 — Rationale size cap.** 5 KB rationale → resolution fails as a validation error (no silent truncation). 4 KB rationale → resolution succeeds.
- **T-N-9 — Force-push rejected.** Resolution commit attempted via force-push (test injects an out-of-band reset); invariant check rejects; item transitions to `Failed { AgentFailed }`.
- **T-N-10 — Draft toggle for CI suppression.** Enqueue: `gh pr ready --undo` called. Advance to head: `gh pr ready` called. Both calls observed via a fake `gh` shim.
- **T-N-11 — Anchor extension + friction context.** ⌘⇧F from a focused queue item in `AwaitingApproval` produces a Friction record with `Anchor::QueueItem { resolution_commit_sha: Some(_), conflict_tier: Some(Tier2) }`.
- **T-N-12 — 960px header reflow.** Viewport snapshot test at 960px: title + autonomy chip on row 1; cost chip + total + ETA on row 2. At 1100px+: single row.
- **T-N-13 — Reduced-motion fallback.** With `prefers-reduced-motion: reduce`: state-pip transitions instant; inline `<Frame>` expand instant; no slide-out on Merge/Remove (item static disappear in v1).
- **T-N-14 — `_ => {}` projector arms verified.** Static check: every existing `match` on `EventPayload` in projectors and consumers (canonical: `projection.rs`, `core_safety.rs`, `core_learn.rs`; plus any others surfaced by `rg 'EventPayload::' --type rust`) compiles against the 14 new variants.

**Phase 22.N.1 — Merge queue UI craft + Tier-2 migration**
- **T-N1-1 — Drill-in surface.** Click "Drill in" on a `Merged` item; assert resolution-diff + rationale + test-excerpt + audit-slice render. ESC dismisses; focus returns to the row.
- **T-N1-2 — Tier-2 migration to 22.E.** Item enters `AwaitingApproval`; assert no inline `<Frame>` is rendered in the queue tab; assert a card appears in the 22.E adjacent column with Approve / Open PR. Approve from 22.E advances the item to `Testing`.
- **T-N1-3 — Drag-to-reorder craft.** Drag an item; assert ghost is rendered at 50% opacity, drop indicator is a 2px hairline using `--success-*`, snap is row-aligned (no fractional positions).
- **T-N1-4 — Motion fallbacks (full coverage).** With `prefers-reduced-motion: reduce`: drill-in opens instantly; item Merge/Remove disappears instantly; head-of-queue advancement is instant. Without reduced-motion: drill-in slides at `--motion-emphasized`; merge/remove slide-out at `--motion-standard`.
- **T-N1-5 — Onboarding empty-state.** First-run user opens the queue tab with zero items; assert 3–4-sentence explainer renders; one-time dismiss persists across sessions.

These tests are the gate. PR review for each sub-phase asserts every test in its block passes before merge. Tests live alongside the implementation: Rust tests in `crates/designer-core/tests/` or `apps/desktop/src-tauri/src/`; frontend tests in `packages/app/src/__tests__/`; perf fixtures in `crates/designer-core/tests/fixtures/`.

---

## Phase 23 — Chat UX hardening *(dogfood-blocking; pulled forward 2026-05-02)*

**Goal:** make chat in a workspace tab bulletproof basic — every send round-trips, every turn is visibly progressing, every tool call is in the context where it ran, every tab is its own real agent. Tabs become genuine parallel work surfaces; "manager of many agents" stops being an illusion at the workspace level and becomes the actual model at the tab level.

**Why:** PR #87 stripped Designer's experimental agent-teams framing from the chat path so default workspaces behave as plain pass-through `claude`. That fixed the "team lead replies once and goes silent" failure but exposed the next layer of regressions during dogfood (2026-05-02): (a) when the user switches tabs the agent feels paused because there's no live activity surface, (b) tool-use rows render *after* the agent text that produced them and *after* the next user message because of coalescer-flush timestamp drift, (c) a single Claude subprocess per workspace means tabs share a session — "work in multiple tabs at once" is a frontend illusion that confuses both Claude (interleaved messages from two conversations) and the user (no real parallelism). Designer's whole product principle is *manager of many agents*; the v1 implementation caps that at one agent per workspace and the workspace list explodes long before the user has the parallelism they came for. Phase 23 closes the gap.

**Long-term alignment:** Phase 19 (multi-track) and Phase 20 (parallel-work coordination) assume per-tab independent agents with their own branches and worktrees. Phase 23 lays the per-tab claude-session foundation those phases compose against. Per-workspace single-session was a v1 compromise; per-tab is the architecture the rest of the roadmap was always going to need.

**Hard gates:** PR #87 merged (✅ 2026-05-02). No other phase blocks 23; 13.D's coalescer (target of 23.A) and 13.D's per-workspace orchestrator (target of 23.E) are both shipped.

**Soft gates:** Phase 13.G's `InboxPermissionHandler` 5-minute timeout is unchanged; 23.B's activity indicator surfaces *that the agent is parked on approval*, but the timeout policy itself is unchanged.

### Phase 23.A — Coalescer first-token timestamp *(small backend; ~½ day)*

**Files:** `apps/desktop/src-tauri/src/core_agents.rs` (PendingMessage + recv path + flush task), `apps/desktop/src-tauri/src/core_agents.rs::tests` only.

**Problem:** `spawn_message_coalescer` accumulates streamed agent tokens in `PendingMessage.body` and flushes one `ArtifactCreated` per (workspace, author_role) once a 120ms idle window passes. The artifact id is `ArtifactId::new()` — UUIDv7 with the *flush-time* timestamp. Tool-use artifacts emitted during the agent's turn carry their *execution-time* UUIDv7. If the user replies between the last agent token and the flush, the user's artifact lands chronologically before the agent text artifact; tool-use artifacts that ran during the response get earlier timestamps than the flushed agent text. Result: the chat reads bottom-up-and-jumbled.

**Fix:** capture the first chunk's timestamp in `PendingMessage` on the same `entry.body.is_empty()` guard that captures `tab_id` today. At flush, build the `ArtifactId` via `Uuid::new_v7(captured_timestamp)` (the actual `uuid` 1.x API — *not* `new_v7_with_timestamp`, which doesn't exist). Pre-existing artifacts retain their (incorrect) timestamps; only new flushes are correct.

**Deliverables:**
- New field `PendingMessage.first_seen_at: Option<uuid::Timestamp>` populated on first chunk in the same `entry.body.is_empty()` branch that captures `tab_id`, cleared on flush.
- Helper `fn first_seen_artifact_id(first_seen: uuid::Timestamp) -> ArtifactId` — wraps `Uuid::new_v7(first_seen)`. Build the `Timestamp` from a `SystemTime::now()` captured alongside `Instant::now()` on first chunk (they're not derivable from each other).
- Flush path uses the helper; all existing coalescer tests stay green.
- New test: `coalescer_flushed_artifact_predates_subsequent_user_post` — burst starts at T0, user posts at T+50ms, flush fires at T+120+ms (after idle window), assert flushed artifact's id < user's artifact's id.

**Acceptance tests:**
- T-23A-1 — first-seen capture. PendingMessage entry created on first chunk has `first_seen_at = Some(...)`; subsequent chunks don't overwrite it.
- T-23A-2 — flush uses captured timestamp. Flushed artifact's UUIDv7 timestamp matches first-chunk `Instant`, ±2ms tolerance for UUIDv7 sub-millisecond precision.
- T-23A-3 — multi-burst isolation. Two consecutive bursts on the same (workspace, author_role) key — flush 1 fires, then chunk 1 of burst 2 arrives — `first_seen_at` is reset on flush, captured fresh on burst 2.
- T-23A-4 — does not regress existing tab-attribution test (`coalescer_attributes_reply_to_tab_at_first_recv_not_at_flush`).

### Phase 23.B — Activity indicator + elapsed time *(medium full-stack; ~1 day)*

**Files:** `crates/designer-claude/src/orchestrator.rs` (new `OrchestratorEvent::ActivityChanged` variant), `crates/designer-claude/src/stream.rs` (translator emits the variant on stream-event boundaries), `crates/designer-claude/src/claude_code.rs` (reader_loop fans the variant through), `apps/desktop/src-tauri/src/core_agents.rs` (subscriber → `StreamEvent` push to UI), `crates/designer-ipc/src/lib.rs` (DTO), frontend `packages/app/src/tabs/WorkspaceThread.tsx` + `packages/app/src/components/ComposeDock.tsx` (consumer), `packages/app/src/styles/compose.css`.

**Problem:** today the only chat-activity signal is the artifact-stream itself. When the user switches tabs or the agent goes quiet mid-turn, there is no way to tell whether the agent is computing, parked on a permission prompt, or has died. The user sees a frozen tab and assumes "stopped responding" — which is friction `019dea69`.

**Fix:** orchestrator emits a coarse activity state per tab. Three backend states: `Idle`, `Working`, `AwaitingApproval` (Rust enum names; user-facing labels are different — see Copy deliverable below). Frontend renders a status row pinned to the top of the compose dock with a pulsing dot, an elapsed-time counter, and an optional current-action label. *Plus* a small badge on the tab strip so the user can see at a glance that work is happening in a tab they're not currently viewing — without that, switching away makes the activity invisible and re-creates the original "stops responding" friction.

**Deliverables:**
- `OrchestratorEvent::ActivityChanged { workspace_id, tab_id, state, since: SystemTime }` — *additive* variant on `OrchestratorEvent` (broadcast-only enum in `crates/designer-claude/src/orchestrator.rs`; not subject to ADR 0002's `EventPayload` freeze because there is no projector arm to break and no replay invariant to preserve. Document the precedent in `pattern-log.md` so future broadcast-only additions don't re-litigate).
- Translator emits `Working` on first stream event of a turn, `AwaitingApproval` when a `control_request` permission-prompt fires (the same site that already routes to `PermissionHandler::decide`), `Idle` on `result/success` or `result/error`. **Subprocess death** (reader task exits on EOF) also emits `Idle` — covers the crash-mid-turn case so the UI doesn't show a phantom "Working" forever.
- Frontend activity slice in `useDataState` keyed by `(workspace_id, tab_id)`; `ComposeDockActivityRow` renders pulse + elapsed time from `since`.
- **User-facing copy** (translate from backend states): `Working` → `"Working… {elapsed}"`; `AwaitingApproval` → `"Approve to continue"` (with a chevron pointing at the inbox / approval block); `Idle` → render nothing (the row hides). Never expose the Rust enum name to the user.
- **Elapsed-time format**: `MM:SS` for the first hour, `H:MM:SS` after. Typography: `--type-family-mono` (changing numbers feel calmer in mono), `--type-caption-size`, `--weight-regular`, `--color-muted`. Tabular figures.
- **Tab-strip badge**: when `state != Idle` for a tab the user isn't currently viewing, the tab button in the tab strip shows a small `●` badge (uses `--color-accent` for `Working`, `--color-warning` for `AwaitingApproval`). Same `prefers-reduced-motion` handling as the dock pulse — solid dot, no animation.
- **Reduced-motion**: project-wide `axioms.css` already sets `animation-duration: 0.01ms !important` under `@media (prefers-reduced-motion: reduce)`, which collapses the `--motion-pulse` keyframe effectively to a static dot. Acceptance test T-23B-3 must accept this *or* explicitly add `.compose-dock-activity-row__pulse { animation: none; }` under the same media query to satisfy the strict `animation: none` assertion. Pick one and document the choice; do not ship both.
- No "Stop" button in v1 — Designer can't actually interrupt claude mid-turn yet without a wider protocol change. v2 adds it; v1 ships honest read-only. **Known tradeoff**: a "Working… 0:47" indicator with no Stop affordance can read as "frozen but I can't act on it" for users who habitually interrupt; revisit if dogfood surfaces this as its own friction.
- **Mini procedure**: append a `core-docs/generation-log.md` entry covering the activity row + tab-badge pattern; append a `core-docs/pattern-log.md` entry for the `OrchestratorEvent` additive-variant precedent. Update the `ComposeDock` entry in `core-docs/component-manifest.json` to include the activity row in its purpose; if `ComposeDockActivityRow` is a separately-extractable component, give it its own manifest entry with the tokens it references.

**Acceptance tests:**
- T-23B-1 — state transitions. Translator fixtures: assert each (input event → emitted ActivityChanged) pair.
- T-23B-2 — elapsed counter increments. Mount with `state: Working, since: T0`; advance fake timer 30s; assert `0:30` rendered.
- T-23B-3 — reduced motion. With `prefers-reduced-motion: reduce`: assert pulse computed-style is `animation: none` and the dot is solid.
- T-23B-4 — switching tabs preserves the indicator. Tab A is `Working`; user switches to B; comes back to A; the indicator is still `Working` with elapsed time still counting (per Phase 23.D, the listener must not have been torn down).

### Phase 23.C — Tool-use rows expand to full payload *(small frontend; ~½ day)*

**Files:** `packages/app/src/blocks/blocks.tsx` (`ToolUseLine` expanded view), `packages/app/src/styles/blocks.css` (.tool-line__detail--expanded extension), `packages/app/src/test/chat-rendering.test.tsx`.

**Problem:** today `ToolUseLine`'s expanded view shows one extra summary line. Conductor's reference design (matching `frc_019dea67` intent) renders the full tool output — file/line citations in monospace, command output, grep results — under the expanded row. Without expand-to-full-payload, tool calls feel like decoration rather than evidence the user can drill into.

**Fix:** when expanded, fetch the full artifact payload (`getArtifact(id)`) and render in a monospace `<pre>` block under the tool-line head. File:line refs stay plain text in v1; clickable in v2.

**Deliverables:**
- `ToolUseLine` expand-on-click triggers `getArtifact(artifact.id)` (cached after first fetch in `payloads` state, same as `MessageBlock`).
- Expanded body renders `payload.body` as `<pre>` with `--type-family-mono`, `--space-4` left padding, `--color-muted` foreground. **Wrapping**: `white-space: pre-wrap` so long lines wrap inside the parent's max-width (`.tool-line` already caps at `min(48rem, 100%)`); horizontal scroll is acceptable on overflow rather than the row stretching the whole thread.
- Long output (>40 lines) truncates to 40 with a "Show full" disclosure that drops the cap. (40 lines mirrors a typical terminal viewport at common laptop sizes; revisit if dogfood says it's wrong.)
- Visual snapshot test against existing fixture; new test for "expand fetches and renders payload."
- **Mini procedure**: append a `core-docs/generation-log.md` entry for the tool-use expand-to-payload pattern; no new pattern-log entry needed (the disclosure pattern is already established).

**Acceptance tests:**
- T-23C-1 — expand triggers payload fetch (mock IPC asserts `getArtifact` called once per artifact).
- T-23C-2 — long-output truncate + disclosure. 100-line fixture; collapsed shows 40 lines + "Show full"; click renders all 100.
- T-23C-3 — collapse + re-expand reuses cached payload (no second IPC call).
- T-23C-4 — accessibility: expanded `<pre>` has `role="region"` and an `aria-label` referencing the tool name.

### Phase 23.D — Tab switch keeps WorkspaceThread mounted *(tiny frontend; ~½ day)*

**Files:** `packages/app/src/layout/MainView.tsx` (key change + per-tab state scoping verification), `packages/app/src/test/tabs.test.tsx`.

**Problem:** `MainView` keys `<WorkspaceThread key={\`${workspace.id}:${activeTab}\`}>` — React unmounts and remounts the whole component on tab switch, tearing down the artifact-stream listener, scroll position, expanded-block state, and any in-flight payload fetches. Friction surfaced 2026-05-02: "I send a message and leave the tab, the agent stops" — actually the agent keeps working, but the listener is gone so the user sees nothing live; on remount they see a stale fetch. The architectural fix is per-tab agents (Phase 23.E), but the frontend half is independent: keep the component mounted across tab switches and react to `tabId` prop changes via the existing `[workspace.id, tabId]` effect dependencies.

**Fix:** drop `activeTab` from the React key. `WorkspaceThread` already takes `tabId` as a prop and the `refresh` callback already depends on `[workspace.id, tabId]` — re-fetch on tab change is already wired. Per-tab state (`stateKey`, draft, hasStarted, scroll) is already scoped by tab id internally. The remount was redundant.

**Deliverables:**
- One-line change to `MainView.tsx`: `key={workspace.id}` (or remove the explicit key entirely — React keys siblings by index, which is fine for one element).
- Test that asserts the component identity persists across tab switches (snapshot of `data-component` instance ref, or use `useRef` + a counter to verify it didn't remount).
- Verify scroll position survives tab switch (existing `chat-scroll.test.tsx` extended).

**Acceptance tests:**
- T-23D-1 — component identity. Render with `tabId=A`, switch to B, switch back to A; assert the same component instance survived (counter or testing-library `unmount` spy not called).
- T-23D-2 — listener survives. While on tab B, an artifact-stream event for workspace W lands; switch back to A; assert refresh was triggered (no manual reload).
- T-23D-3 — scroll position preserved per tab. Scroll halfway in tab A; switch to B; switch back; assert scroll position restored to the same offset.
- T-23D-4 — composer draft preserved per tab. Type "hello" in A; switch to B; switch back; assert draft is still "hello" (already exercised by `draft-preserved` test, just confirm it doesn't regress).

### Phase 23.E — Per-tab Claude subprocess *(medium backend; ~1.5 days)*

**Files:** `crates/designer-claude/src/claude_code.rs` (teams map keyed by `(WorkspaceId, TabId)`, session_id derivation), `crates/designer-claude/src/orchestrator.rs` (`TeamSpec.tab_id` field; new method signatures take `tab_id`), `crates/designer-claude/src/mock.rs` (matching), `apps/desktop/src-tauri/src/core_agents.rs` (`post_message` dispatches by tab; `spawn_workspace_team` → `spawn_tab_team`), `apps/desktop/src-tauri/src/ipc_agents.rs`, `apps/desktop/src-tauri/src/core.rs` (archive/restore/delete fan out across all tabs in a workspace).

**Problem:** Designer's `--session-id` is `UUIDv5(SESSION_NAMESPACE, workspace_id)` — workspace-scoped. All tabs in a workspace share one claude subprocess and one conversation. Posting in tab A and tab B interleaves into one stream. Claude has no concept of tabs; the "shared session" is the bug, not the feature. From the user's perspective tabs *should* be parallel agents — that's why they exist.

**Fix:** key the orchestrator's teams map and the session-id derivation by `(workspace_id, tab_id)`. Each tab gets its own claude subprocess, its own session memory, its own context window. Tabs become true parallel agents; Phase 19 / 20 / Phase 22.A / Phase 22.N all compose against this shape.

**Deliverables:**
- `SESSION_NAMESPACE` rotated (one-line change) to invalidate every pre-23.E session — pre-23.E sessions had team-mode framing baked into their conversation memory; rotation is the clean break. Document in `pattern-log.md` (entry: "Per-tab session migration; pre-23.E sessions retired").
- `derive_session_id(workspace_id, tab_id) -> Uuid` — UUIDv5 of `(NAMESPACE, workspace_id, tab_id)`.
- `TeamSpec` gains `tab_id: TabId` (required field; tests + mock updated). The default chat path is per-tab; multi-agent dispatch (which would have keyed differently) stays out of scope, deferred behind a future opt-in.
- `ClaudeCodeOrchestrator::teams: HashMap<(WorkspaceId, TabId), TeamHandle>` (key change).
- `post_message(workspace_id, tab_id, ...)` looks up the right handle.
- `spawn_tab_team(workspace_id, tab_id, model)` replaces `spawn_workspace_team`.
- Closing a tab (`cmd_close_tab`) calls `orchestrator.shutdown(workspace_id, tab_id)` — no leaked subprocesses.
- Archiving a workspace fans out shutdown across every open tab in that workspace.
- Each tab's claude inherits the workspace's `cwd` (one repo, N independent agents working in it). Per-tab `cwd` overrides are out of scope; would require Phase 19's track / worktree primitives.
- Memory budget: each tab is a full claude subprocess (~50–200 MB). Workspaces with 10 tabs × 100 MB = 1 GB headroom. Document the cost; revisit if it bites in dogfood.

**Acceptance tests:**
- T-23E-1 — distinct session ids per tab. `derive_session_id(W, A) != derive_session_id(W, B)`; both stable across calls.
- T-23E-2 — parallel post round-trips. Two tabs in one workspace; post in A; post in B before A finishes; assert the mock orchestrator routes the messages to two distinct subprocesses; replies attribute to their respective tabs.
- T-23E-3 — close tab kills its subprocess. Spawn tab; close tab; assert `Orchestrator::shutdown((workspace_id, tab_id))` called and the team-handle is gone from the map.
- T-23E-4 — archive workspace shuts down all tabs. Workspace with 3 open tabs; archive; assert 3 shutdown calls.
- T-23E-5 — model change respawns only the affected tab. Set tab A to Haiku, tab B to Opus; switch A to Sonnet; assert B's subprocess is untouched.
- T-23E-6 — back-compat with no tabs. Workspaces with zero open tabs (legacy projection / replay edge case) don't crash; lazy-spawn happens on first post into the first tab opened.

### Sequencing & parallelism

Lane structure mirrors the Lane 1 / Lane 1.5 / Lane 2 pattern from Dogfood Push:

**Wave 1 — parallel** *(file-disjoint; three agents simultaneously)*:
- **Phase 23.C** — frontend, `blocks.tsx` + `blocks.css` + chat-rendering test.
- **Phase 23.D** — frontend, `MainView.tsx` (single-line key change) + `tabs.test.tsx`.
- **Phase 23.A** — backend, `core_agents.rs` coalescer only (PendingMessage struct + flush helper).

**Wave 2 — single track** *(blocked on Wave 1 merging — touches `core_agents.rs::post_message` which 23.A also touches)*:
- **Phase 23.E** — backend architecture change. Largest of the five. Lands solo because every other workstream that touches `core_agents.rs` or `claude_code.rs` would conflict.

**Wave 3 — single track** *(after 23.E lands; depends on per-tab activity surfaces)*:
- **Phase 23.B** — full-stack. Defers because the activity event needs `tab_id` (added by 23.E) on the wire. Could land before 23.E with `tab_id: None` as a temporary signature, but the cleanup churn isn't worth the parallelism.

**Why not run 23.A and 23.E in parallel:** both touch `core_agents.rs::post_message`. 23.A modifies the `PendingMessage` struct; 23.E modifies the function signature. The merge conflict is mechanical but expensive enough to serialize.

### Done when *(Phase 23 as a whole)*

- A user sends a message in any tab and gets a reply with no manual intervention or remount workaround.
- Tool-use rows render in chronological position (above the agent message that uses them) and expand to full payload on click.
- Switching tabs does not interrupt the agent; the activity indicator shows live progress and elapsed time on the originating tab.
- Two tabs in one workspace process two messages truly in parallel — different claude subprocesses, no interleaved-context confusion, both replying simultaneously.
- Friction `019dea67`, `019dea69`, `019dea66`, and the un-filed "tab switch loses progress" friction all `friction resolve`.
- The per-tab subprocess shape is documented in `pattern-log.md` so Phase 19 + 20 + 22.A inherit the contract, not re-litigate it.

**Out of scope (v1):**
- A real "Stop turn" interrupt that mid-flight cancels claude. Requires a wider protocol change; tracked as 23.F follow-up.
- Per-tab `cwd` / worktree assignment. Phase 19 territory.
- Coalescing consecutive same-tool tool-use rows under one disclosure ("Read 4 files"). 23.C ships one-row-per-call; coalescing is a v2 polish.
- Inline status sublines within the agent's current turn (Conductor's "● Thinking ● by AutoAcceptSafeTools…" stack). 23.B v2.
- Cost chip on the compose dock. Already shipped in DP-A; v2 for inline cost mid-turn.

### Phase 23.C follow-ups — Deferred review items *(parked from PR #92's two-round staff review and PR #94's round-3 review — captured here so they don't rot in closed PR bodies)*

The expand-to-payload pattern landed (PR #92) and the layout-stability + error-state polish landed (PR #94). Across three review rounds the staff-perspective passes surfaced four items that need design judgment, an architectural decision, or a separate workstream:

- **23.C.f1 — Discoverability affordance on `.tool-line__head`.** Today the only signal a tool-line is interactive is `cursor: pointer` + a hover color shift from muted to foreground. UX reviewer flagged that managers won't discover the click. A chevron / caret / hover-fill would solve it but changes the visual register the original Phase 23.C spec asked for ("compact one-line `· Read foo.rs`"). Decide as part of a broader chat-line treatment pass; design input wanted before picking a glyph. Owner: future Phase 23 polish PR. ~½ day frontend.

- **23.C.f2 — Honor `BlockProps.expanded` / `onToggleExpanded`.** ToolUseLine ignores the BlockProps contract and tracks expand state locally. Engineer reviewer noted this means the parent `WorkspaceThread` can't collapse all expanded rows on tab switch (or any other parent-driven sweep). The original deliverable explicitly said "disclosed state persists per-mount only," so the local state is correct for v1, but if/when a parent needs to drive collapse (e.g., focus-mode, "collapse all"), wiring through is the migration path. Touches `WorkspaceThread.tsx` (state map + props) + `BlockProps` callers. Owner: whichever workstream first needs parent-driven collapse. ~½ day frontend.

- **23.C.f3 — Coalesce consecutive same-tool rows.** Already listed under "Out of scope (v1)" above; restated here so the Phase 23.C follow-up trail is one place. v2 polish (e.g., "Read 4 files" disclosure expanding to four citations), needs a coalescing primitive that respects per-call expand state.

- **23.C.f4 — Distinguish transient from permanent fetch failures.** PR #94 caches `getArtifact` rejections via `fetchedRef.current = true` so a known 404 (speculative kind without a wired emitter) doesn't refetch on every re-expand. The trade-off the engineer reviewer flagged: a transient failure (network glitch, IPC hiccup) is now permanently sticky for the row's lifetime — the user sees "Nothing to show." forever even after the backend recovers. Fix shape: error classification (404 = permanent, 5xx / IPC-error = transient) plus a "Try again" affordance in the region for transient errors, or a TTL on the cached error. Needs Rust-side error-typing on `getArtifact` to distinguish, so it's not a pure-frontend change. ~1 day full-stack.

Acceptance gate (whole follow-up batch shipped): user manager can drill into a tool-use row without hovering to discover it; parent thread can collapse all rows programmatically; Read/Edit runs of length ≥3 coalesce under one disclosure; transient errors offer a retry while permanent 404s stay quietly cached.

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
| Pre-track scaffolding | 13.0 | — (single PR) | ✅ 2026-04-23 |
| Artifact foundation | 13.1 | — (single PR after 13.0) | ✅ 2026-04-24/25 |
| Real runtime wired | 13.D, 13.E, 13.F, 13.G | Yes (after 13.1) | ✅ 2026-04-25, integration meta-PR #20 opened 2026-04-26 |
| Phase 13 hardening pass | 13.H | After integration merge | **Pending — F1–F4 production wiring** |
| **GA safety enforcement** | **13.I** | After 13.H | **Pending — blocks GA** |
| Sync transport | 14 | Yes (parallel with 13/15) | Pending |
| Hardening + polish | 15 | Yes (parallel with 13/14) | Pending |
| Shippable desktop beta | 16.R + 16.S | After 13 + 15 | Blocked on Apple Developer ID; 16.S blocks signed DMG |
| **Team-tier trust** | **17.T** | After 16 | **Pending — gates team pricing** |
| Mobile | 18 | After 14 + 16 + 17 | Phase 2 |
| Workspace scales up (multi-track, forking) | 19 | After 13 + 16; parts pullable into 15 | Pending |
| Parallel-work coordination layer | 20 | After 13 + 19 substantially complete | Pending |
| Learning layer (local-model workflow proposals) | 21 | After 13.D + 13.F; independent of 14/16/18/19/20 | Pending |
| Project Home redesign (Recent Reports / Roadmap / Designer Noticed) | 22.G + 22.B + 22.A + 22.I + 22.D + 22.E + 22.H + 22.C | Sub-phases independently shippable; 22.G + 22.B + 22.A + 22.I as recommended first slice; 22.F satisfied by 21; Linear (was 22.J/K) and five-category re-skin cut from v1; 22.L delivered with Phase 20 | Pending — 22.G pullable into Phase 15 polish |
| Merge queue (cross-PR conflict resolution train) | 22.N + 22.N.1 | Independently shippable; 22.N hard-gates on 13.E + 13.G + 20 + 22.A; 22.N.1 gates on 22.N + 22.E. Spec source: `.context/specs/phase-22n-merge-queue.md` (v3, two staff-review passes complete) | Pending — promoted to roadmap 2026-05-02 |
| **Chat UX hardening** | **23.A + 23.C + 23.D (Wave 1 parallel) → 23.E (Wave 2) → 23.B (Wave 3)** | Wave 1 truly parallel (file-disjoint); 23.E and 23.B serialize on `core_agents.rs` + `claude_code.rs` | **Active 2026-05-02 — dogfood-blocking** |

---

## What this roadmap does not include

- Marketing, pricing, distribution strategy — separate document when that phase arrives.
- Team hiring — assumed solo for now.
- Anthropic partnership conversations — may become relevant before public launch; tracked in backlog.
- Detailed Linear / Jira / Figma integration scoping — parked until Phase 6+ demonstrates the coordination primitives.
