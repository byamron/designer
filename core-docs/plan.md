# Plan

Near-term focus and active work items. See `roadmap.md` for the full phased sequence; see `spec.md` for architectural decisions.

## Current Focus

**Phase 12.C shipped (2026-04-21).** Tauri v2 shell binary, event bridge, theme persistence, macOS menu, drag regions — all in. Remaining Phase 12 tracks (12.A real Claude Code; 12.B Foundation Models helper) still open.

Phase 12 tracks:

- **12.A — Real Claude Code subprocess.** Needs a local Claude Code install. Blocks 13.D (agent wire).
- **12.B — Swift Foundation Models helper build.** Needs macOS 15+ with Apple Intelligence. Blocks 13.F (local-model surfaces).
- **12.C — Tauri shell binary.** ✅ Done. Unblocks 13.D / 13.E / 13.F / 13.G.

13.E is now a valid parallel start (needs only 12.C + a linked repo picker + GitOps calls from UI). 13.D / 13.F remain gated on 12.A / 12.B respectively.

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

- [ ] Build `helpers/foundation` on macOS 15+ with Apple Intelligence.
- [ ] Verify the `LanguageModelSession.respond(to:)` call; adjust if Apple shipped changes.
- [ ] Smoke-test `SwiftFoundationHelper::ping()` and `FoundationLocalOps::recap`.
- [ ] Document helper path in `AppConfig::default_in_home`.

### Phase 12.C — Tauri shell binary ✅ *(landed 2026-04-21)*

- [x] Add `tauri = "2"` + `tauri-build` workspace deps; `build.rs`.
- [x] Scaffold `tauri.conf.json` with overlay title-bar, macOS 13+ min, strict CSP.
- [x] Register `#[tauri::command]`s for all 8 handlers (4 live + 2 new `open_tab`/`spine` + 2 stubs for 13.G).
- [x] Expose `AppCore.store.subscribe()` as Tauri event channel `designer://event-stream` via `events::spawn_event_bridge`.
- [x] Tauri v2 capabilities file — `core:default` + event listen only; no FS/shell/dialog (deferred to 13.E).
- [x] Theme persistence with zero-flash boot (sidecar `~/.designer/settings.json` + URL hash + inline script).
- [x] macOS menu (App/File/Edit/Window/Help; View with DevTools in debug).
- [x] Drag-region spacer in the project strip to clear overlay traffic lights.
- [x] Compile/test gates: clippy clean, 23 Rust tests, 11 frontend tests, 6/6 Mini invariants.
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
