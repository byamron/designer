# Plan

Near-term focus and active work items. See `roadmap.md` for the full phased sequence; see `spec.md` for architectural decisions.

## Current Focus

**Phase 12.B + 12.C shipped (2026-04-21).** 12.C: Tauri v2 shell binary, event bridge, theme persistence, macOS menu, drag regions. 12.B: Swift Foundation Models helper supervisor, config wiring, IPC surface, stub-tested boot path. Remaining Phase 12 track (12.A real Claude Code) still open; 12.B's real-binary round-trip still needs one run on an Apple-Intelligence-capable Mac to close the integration-notes SDK-shape delta.

Phase 12 tracks:

- **12.A — Real Claude Code subprocess.** Needs a local Claude Code install. Blocks 13.D (agent wire). **Not started.**
- **12.B — Swift Foundation Models helper build.** Infrastructure complete; real-hardware validation pending. Blocks 13.F.
- **12.C — Tauri shell binary.** ✅ Done. Unblocks 13.D / 13.E / 13.F / 13.G.

13.E and 13.F are now valid parallel starts (12.C unblocks both; 12.B pre-supplies the `helper_status` IPC and `HelperEvent` broadcast 13.F needs). 13.D remains gated on 12.A. Next recommended step: run `./scripts/build-helper.sh` on an AI-capable Mac to close 12.B, then pick whichever of 12.A / 13.E / 13.F unblocks the most downstream work.

## Handoff Notes

- Spec and roadmap are complete for the planning phase. Treat `spec.md` as architectural source of truth and `roadmap.md` as the sequence source of truth.
- Working name is **Designer**; provisional.
- `.claude/` agents are not populated yet — first real agent scaffolding happens in Phase 1. `.claude/skills/` is populated via the Mini install (2026-04-21): 6 design-system skills (`elicit-design-language`, `generate-ui`, `check-component-reuse`, `enforce-tokens`, `audit-a11y`, `propagate-language-update`). Frontend wiring is deferred to Phase 8.

## Active Work Items

### Phase 12.A — Real Claude Code subprocess *(blocks 13.D)*

- [ ] Install Claude Code + auth on dev machine.
- [ ] Run `ClaudeCodeOrchestrator::spawn_team` against a throwaway team; catalog file shapes under `~/.claude/teams/` and `~/.claude/tasks/` into `core-docs/integration-notes.md`.
- [ ] Update `crates/designer-claude/src/watcher.rs::classify`.
- [ ] Adjust `claude team init/task/message` CLI args in `claude_code.rs` to match the real shape.
- [ ] Add integration test gated by `CLAUDE_CODE_INSTALLED=1`.

### Phase 12.B — Swift Foundation Models helper *(blocks 13.F)*

Infrastructure landed on 2026-04-21 (branch `phase-12b-plan`); real-binary validation remains — needs one run on an Apple-Intelligence-capable Mac.

- [x] Upgrade Swift helper: `--version` flag, `unknown-request` handling, `localizedDescription`-wrapped errors.
- [x] Replace the simple `SwiftFoundationHelper` with an async supervisor: 5-step exponential backoff, max-5-failure demotion to `NullHelper`, bounded 2 KB stderr capture, fail-fast (no blocking on backoff), configurable tuning for tests.
- [x] Extend `AppConfig` with `helper_binary_path`; `default_in_home()` resolves the path from `DESIGNER_HELPER_BINARY` env → `.app` bundle sibling → Cargo workspace dev path. `DESIGNER_DISABLE_HELPER=1` forces fallback.
- [x] Extract `select_helper(config) -> (Arc<dyn FoundationHelper>, HelperStatus)` with structured `FallbackReason` variants.
- [x] Wire `FoundationLocalOps` into `AppCore.local_ops` (`Arc<dyn LocalOps>`). No consumers yet; zero-risk add that unblocks 13.F.
- [x] Add `cmd_helper_status` IPC + `HelperStatusResponse` DTO combining boot selection with live supervisor health.
- [x] Stub binary at `crates/designer-local-models/src/bin/stub_helper.rs` (CLI-arg driven, parallel-test-safe) + `tests/runner_boot.rs` covering happy path, ping timeout, child-crash restart, max-failure demotion, fail-fast backoff window, stderr capture.
- [x] `tests/real_helper.rs` (env-gated, silent skip on non-AI hardware).
- [x] `scripts/build-helper.sh` (swift build + smoke `--version` check).
- [x] Docs: `core-docs/integration-notes.md` §12.B, `apps/desktop/PACKAGING.md` helper section.
- [ ] Run `./scripts/build-helper.sh` on an AI-capable Mac; export `DESIGNER_HELPER_BINARY` and run `cargo test -p designer-local-models --test real_helper`. Update `integration-notes.md` with the observed SDK call shape and any deltas.

### Phase 12.C — Tauri shell binary ✅ *(landed 2026-04-21)*

- [x] Add `tauri = "2"` + `tauri-build` workspace deps; `build.rs`.
- [x] Scaffold `tauri.conf.json` with overlay title-bar, macOS 13+ min, strict CSP.
- [x] Register `#[tauri::command]`s for all 8 handlers (4 live + 2 new `open_tab`/`spine` + 2 stubs for 13.G).
- [x] Expose `AppCore.store.subscribe()` as Tauri event channel `designer://event-stream` via `events::spawn_event_bridge`.
- [x] Tauri v2 capabilities file — `core:default` + event listen only; no FS/shell/dialog (deferred to 13.E).
- [x] Theme persistence with zero-flash boot (sidecar `~/.designer/settings.json` + URL hash + inline script).
- [x] macOS menu (App/File/Edit/Window/Help; View with DevTools in debug).
- [x] Drag-region spacer in the project strip to clear overlay traffic lights.
- [x] Compile/test gates: clippy clean (dev + release), 29 Rust tests, 11 frontend tests, 6/6 Mini invariants.
- [x] Wire-boundary tests added: `StreamEvent::from(&EventEnvelope)` round-trip; `AppCore::open_tab` + `AppCore::spine`.
- [x] `packages/app/src/ipc/tauri.ts` — shared runtime adapter (detection + dynamic-import cache + teardown-safe `listen`).
- [x] `bootData` parallelized: three waves via `Promise.all` instead of three nested sequential awaits.
- [ ] Interactive smoke (`cargo tauri dev`) on user's machine — deferred; requires GUI session.

### Phase 13 — Wire the real runtime *(after corresponding Phase 12 tracks)*

Four tracks with individual input gates:

- [ ] **13.D Agent wire** (needs 12.A + 12.C): replace `PlanTab::ackFor()` with `Orchestrator::post_message`; stream replies via `designer://event-stream`.
- [ ] **13.E Git + repo linking** (needs 12.C): repo-linking UI + `GitOps::init_worktree` + `core-docs/*.md` seeding + "Request merge" → `gh pr create`.
- [ ] **13.F Local-model surfaces** (needs 12.B + 12.C): spine summaries via `LocalOps::summarize_row`; Home recap via `LocalOps::recap`; audit verdicts via `LocalOps::audit_claim`.
- [ ] **13.G Safety surfaces + Keychain** (needs 12.C): approval inbox, cost chip in topbar, scope-denied in inbox, `security-framework` keychain integration.

### Phase 14 — Sync transport *(parallel with 13 or 15)*

- [ ] Pick transport (WebRTC via `str0m` default; document alternatives in short ADR).
- [ ] Implement `SyncTransport` trait + first impl.
- [ ] Pairing UI: host QR with `PairingMaterial.secret`; scanner/code entry on the peer.
- [ ] Integration test: two processes sync a 20-event log without a server.

### Phase 15 — Hardening + polish *(parallel with 13 or 14)*

Six independent items:

- [ ] Mini primitives migration (`Box`, `Stack`, `Cluster`, `Sidebar`) for AppShell / HomeTab / ActivitySpine / WorkspaceSidebar.
- [ ] `correlation_id` / `causation_id` wiring for derived events.
- [ ] Pairing RNG: swap manual entropy for `rand::rngs::OsRng`.
- [ ] Dark-mode visual-regression harness (Playwright + screenshot diffing).
- [ ] Auto-grow chat textarea.
- [ ] `AppCore::sync_projector_from_log` incrementalization (last-seen sequence per stream).

### Phase 16 — Shippable desktop build *(after 13 + 15)*

- [ ] Apple Developer identity + CI signing secrets.
- [ ] First signed + notarized `.dmg` (`cargo tauri build` → `codesign` → `notarytool`).
- [ ] Updater backend: signed `latest.json` on static host + Ed25519 keypair.
- [ ] Crash-report endpoint (opt-in upload).
- [ ] Install QA checklist on a fresh Mac (see `apps/desktop/PACKAGING.md`).

---

## Recently Completed

### Phase 12.B — Staff UX designer + staff engineer review pass — 2026-04-21
Two-lens parallel review of the freshly-landed 12.B backend. Applied P0/P1/P2 fixes: `HelperHealth::running` no longer lies under lock contention (cached via `parking_lot::RwLock`); `HelperError::Timeout(Duration)` split out as a distinct variant so `select_helper` discriminates structurally instead of substring-matching "deadline"; `FallbackReason` split into `UnsupportedOs` / `ModelsUnavailable` / `PingFailed` with `RecoveryKind` routing (`user` / `reinstall` / `none`); stub helper parses requests with `serde_json` instead of substring matching; `audit_claim` parser normalizes trailing punctuation and sentence wrapping; `NullHelper` vocabulary aligned (`"unavailable"` not `"null / disabled"`; `[unavailable …]` not `[offline …]`) with explicit diagnostic-marker docstring. API hygiene: `cmd_helper_status` returns `HelperStatusResponse` directly (infallible); DTO gained `provenance_label` / `provenance_id` / `recovery` Rust-owned fields; `SwiftFoundationHelper::subscribe_events()` + `AppCore::subscribe_helper_events()` broadcast `HelperEvent::{Ready,Degraded,Demoted,Recovered}`; Swift helper no longer uses `try!` and breaks loop on closed stdout; `probe_helper` generic over `?Sized`; `HelperTuning::new` debug-asserts preconditions. Test quality: flaky demote-after-max test replaced with bounded poll; two new event integration tests; seven new DTO unit tests; two new core unit tests; one regression test for the audit parse fix. Doc cleanup: vocabulary pattern-log entry rewritten to three strings matching the `recovery` taxonomy; "supervisor fails fast" moved from pattern-log to integration-notes (it's a code contract, not a UX pattern); PACKAGING.md no longer leaks "NullHelper" class name; integration-notes gained granular fallback-reason table, diagnostic-only warning on `fallback_detail`, helper-events protocol. 43 Rust tests + 11 frontend tests + 6/6 Mini invariants + clippy `-D warnings` clean.

### Phase 12.B — Foundation helper infrastructure — 2026-04-21
Replaced single-shot `exchange()` with an async `HelperSupervisor` (5-step exponential backoff, 5-failure demotion, 2 KB stderr ring, configurable tuning, fail-fast on in-flight failures). Added `helper_binary_path` to `AppConfig` with env/bundle/dev path resolution, `DESIGNER_DISABLE_HELPER=1` kill-switch, and `select_helper()` returning structured `FallbackReason`. Wired `AppCore.local_ops` as `Arc<dyn LocalOps>` (relaxed `FoundationLocalOps<H: ?Sized>` to accept trait objects). Added `cmd_helper_status` IPC + flat `HelperStatusResponse` DTO. New stub binary (`src/bin/stub_helper.rs`, CLI-arg driven) + 6 runner_boot tests + 6 real_helper tests (env-gated silent skip). New `scripts/build-helper.sh`. Zero UI changes — provenance of helper output is a Phase 13.F concern per the three-lens plan at `.context/phase-12b-plan.md`. All workspace tests pass; cargo build clean.

### Review pass on preliminary build (staff engineer / staff designer / staff design engineer) — 2026-04-21

Multi-role code review of the Phases 0–11 build. Implemented fixes: SQLite "database is locked" race (WAL enabled on one-shot connection before pool open); `AppCore::create_*` apply new events directly instead of full-log replay; clippy cleanup (dead `Tracker`/`GlobSetExt`, derivable `Default` on `ClaudeCodeOptions`/`NodeId`, `or_insert_with(Vec::new)` → `or_default`, `&self.secret` → `self.secret` copy); a11y (skip-to-content link, h1→h2→h3 hierarchy across Home and tab bodies, `role=tabpanel`/`aria-labelledby`/`aria-controls` on tabs, roving tabindex + arrow-key nav, focus trap on Cmd+K dialog); UX (humanized event kinds via `humanizeKind`, "+ Project" affordance on the strip, chat `data-author` moved to CSS); Mini procedural docs (`generation-log.md`, `component-manifest.json`, `pattern-log.md` updated with 17 components and 6 new pattern entries). Added 6 frontend tests: humanize mapping, tab-panel/tab linkage, skip-link presence, onboarding persistence. All 30 tests + 6/6 invariants + clippy clean.

### Preliminary build (Phases 0–11) — 2026-04-21
Rust workspace with 9 crates + event-sourced SQLite core + safety gates + git ops + sync protocol + local-model helper + React app with three-pane layout, Cmd+K switcher, four tab templates, Home tab, streaming chat, sandboxed design lab, onboarding. 19 Rust tests + 5 frontend tests + 6/6 Mini invariants passing; demo CLI end-to-end works. See `history.md` for full decisions/tradeoffs and the report that accompanied it.

### Mini installed at `packages/ui/` + initial design language elicited — 2026-04-21
Installed Mini via `tools/sync/install.sh`. Ran greenfield elicitation of all 10 design axioms — amended two draft principles (motion: snappy + considered liveliness; theme: system-default instead of dark-default). Chose monochrome accent identity (Notion/Linear register), mauve gray flavor (olive/sand as alternatives to try), Geist + Geist Mono type system, soft-sharper radii (button=6px). Rebound `--accent-*` to `--gray-*` in `tokens.css` and dropped indigo/crimson imports. Frontend wiring (Radix deps, CSS imports, TS path alias) deferred to Phase 8. See `history.md` for full rationale.

### Project spec, compliance framing, roadmap, and core docs set up — 2026-04-20
Moved from placeholder spec to full `core-docs/` structure with spec, roadmap, plan, history, feedback, workflow, and design-language docs. 28 architectural decisions captured. See `history.md` for details.

## Backlog

- Product naming pass — decide whether to keep "Designer" or pick something more distinct.
- Multi-repo project model (defer until a second-repo use case appears).
- Linear / Jira integration strategy (map Linear project/epic/initiative to Designer workspace).
- Scheduled-task queue for proactive autonomy modes.
- Semantic conflict detection (v2 of cross-workspace coordination).
- Anthropic partnership conversation before public launch.
- Gray-flavor A/B — try `olive` and `sand` against `mauve` once first real surfaces exist (swap imports in `packages/ui/styles/tokens.css`).
- Decide "blocked" spine-state token (`--warning-*` vs. `--gray-11 + icon`) when the activity spine is built.
