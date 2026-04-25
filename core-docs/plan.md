# Plan

Near-term focus and active work items. See `roadmap.md` for the full phased sequence; see `spec.md` for architectural decisions.

## Current Focus

**Phase 13.1 shipped (2026-04-24).** Tab model unified: Plan / Design / Build retired, every tab renders `WorkspaceThread`, typed artifact blocks live inline. Backend artifact foundation in place — `ArtifactCreated/Updated/Pinned/Unpinned/Archived` events, `PayloadRef` inline/hash discriminant, rail projection (`pinned_artifacts` per workspace), four new IPC commands. Block renderer registry with 12 renderers (7 real, 5 stubs) lifted from the tab-model-rethink sketch into production modules; sketch file and URL-hash gate deleted. Pin/unpin wired into the workspace rail. ComposeDock adopted as the shared compose input. See `history.md` for the consolidation sourcing from tab-model-rethink + find-agentation-server branches.

**13.F shipped 2026-04-25** — local-model surfaces wired (write-time summary hook, recap, audit, PrototypeBlock). 13.D / 13.E / 13.G / 13.H remain unblocked and parallelizable. Each track emits into the block registry — no UI work required in those tracks:

- **13.D — Agent wire** (needs 12.A + 12.C + 13.1): emits `ArtifactCreated { kind: "message" }` and agent-produced artifacts (diagrams, reports) into the thread. Replaces `WorkspaceThread::onSend` stub with `Orchestrator::post_message` + streams replies via `designer://event-stream`. Partial-message coalescer lands here.
- **13.E — Track primitive + git wire** (needs 12.C + 13.1): `TrackStarted`, `GitOps::init_worktree`, `core-docs/*.md` seeding, "Request merge" → `gh pr create` → `TrackCompleted`. **Emits `ArtifactCreated { kind: "code-change" }` per semantic edit batch and `{ kind: "pr" }` when a PR opens** — no new UI, just events feeding the registry. Wires `reveal_in_finder` IPC beyond the macOS-only shim shipped with 13.1.
- **13.F — Local-model surfaces** *(landed 2026-04-25)*: write-time summaries via `LocalOps::summarize_row` (per-track debounce + 500ms deadline + late-return `ArtifactUpdated`), `cmd_recap_workspace` via `LocalOps::recap`, `cmd_audit_artifact` via `LocalOps::audit_claim`. Recaps emit `ArtifactCreated { kind: "report" }`; audit verdicts emit `comment` artifacts anchored via `author_role: Some("auditor")`. `PrototypePreview` is wired into `PrototypeBlock` via an optional inline-HTML prop.
- **13.G — Safety surfaces + Keychain** (needs 12.C + 13.1): approval inbox, cost chip in topbar, `security-framework` keychain. **Approval requests emit `ArtifactCreated { kind: "approval" }` with the interactive action surface already rendering; scope denials attach as `comment` artifacts on the offending code-change artifact.**
- **13.H — Safety enforcement** (after 13.G; detail in `security.md`).

12.B's real-binary round-trip still needs one run on an Apple-Intelligence-capable Mac to close the SDK-shape delta in `integration-notes.md` §12.B.

## Handoff Notes

- Spec and roadmap are complete for the planning phase. Treat `spec.md` as architectural source of truth and `roadmap.md` as the sequence source of truth.
- Working name is **Designer**; provisional.
- `.claude/` agents are not populated yet — first real agent scaffolding happens in Phase 1. `.claude/skills/` is populated via the Mini install (2026-04-21): 6 design-system skills (`elicit-design-language`, `generate-ui`, `check-component-reuse`, `enforce-tokens`, `audit-a11y`, `propagate-language-update`). Frontend wiring is deferred to Phase 8.

## Active Work Items

### Phase 12.A — Real Claude Code subprocess *(completed 2026-04-22; unblocks 13.D)*

- [x] Install Claude Code + auth on dev machine (was already installed: 2.1.117, keychain OAuth).
- [x] Probe + spike: `scripts/probe-claude.sh` with Phase A (safe inventory) + Phase B (live team spawn). Captured `~/.claude/teams/{team}/config.json`, inbox shapes, stream-json event vocabulary (including `rate_limit_event`).
- [x] Resolve in-process-in-subprocess spike: option (a) — works cleanly, no pty/tmux needed.
- [x] `core-docs/integration-notes.md` written; pinned `claude --version 2.1.117`.
- [x] `core-docs/adr/0001-claude-runtime-primitive.md` written.
- [x] Rewrite `ClaudeCodeOrchestrator` against real primitive (native agent teams, natural-language team creation, stream-json in/out via persistent stdin pipe, `--permission-prompt-tool stdio`, deterministic session-id per workspace, 60s graceful shutdown).
- [x] Write `crates/designer-claude/src/stream.rs` translator with fixture-based tests.
- [x] Rewrite `crates/designer-claude/src/watcher.rs::classify` for real shapes; `None` for out-of-scope paths.
- [x] Live integration test `tests/claude_live.rs` (gated by `--features claude_live`) passes against real Claude install.
- [x] CI workflows: `.github/workflows/ci.yml` (Tier 1 hermetic), `claude-live.yml` (Tier 2 self-hosted), `claude-probe.yml` (Tier 3 scheduled drift detection).
- [x] Commit subagent definitions: `.claude/agents/track-lead.md`, `teammate-default.md`; reserve `.claude/prompts/workspace-lead.md` stub (per D4).
- [ ] Register self-hosted runner (user action: GitHub → Settings → Actions → Runners → new self-hosted runner, macOS arm64, labels `self-hosted macOS claude`).
- [ ] (Deferred to 13.G / 13.D) `designer-hook` binary for secondary feed; `PreToolUse` approval-gate spike; partial-message coalescer at 120ms.

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

### Phase 13 — Wire the real runtime *(all four tracks parallel after 13.1)*

Each track now emits `ArtifactCreated` events into the block registry instead of painting bespoke UI. Per-track `TODO(13.X)` markers in the code mark the handoff points.

- [ ] **13.D Agent wire** (needs 12.A + 12.C + 13.1): replace `WorkspaceThread::onSend` with `Orchestrator::post_message`; stream replies via `designer://event-stream` as `MessagePosted` thread events, agent-produced artifacts (diagrams, reports) as `ArtifactCreated`. Partial-message coalescer (deferred from 12.A) lands here.
- [ ] **13.E Track primitive + git wire** (needs 12.C + 13.1): introduces the `Track` primitive per spec Decisions 29–30 (workspace owns a list of tracks; v1 creates length-1). Repo-linking UI + `TrackStarted` events + `GitOps::init_worktree` per track + `core-docs/*.md` seeding + "Request merge" → `gh pr create` → `TrackCompleted`. **Emits `ArtifactCreated { kind: "code-change" }` per semantic edit batch and `{ kind: "pr" }` when a PR opens.** Reserves `WorkspaceForked` / `WorkspacesReconciled` / `TrackArchived` event types for Phase 19.
- [x] **13.F Local-model surfaces** *(landed 2026-04-25)*: write-time `code-change` summaries via `LocalOps::summarize_row` (per-track debounce, 500ms append deadline, ArtifactUpdated on late return); `cmd_recap_workspace` emits `ArtifactCreated { kind: "report" }`; `cmd_audit_artifact` emits `ArtifactCreated { kind: "comment", author_role: Some("auditor") }` anchored to the target. PrototypePreview accepts inline HTML; PrototypeBlock renders it. ADR 0003 amended with the hook seam contract. Real-helper validation on Apple-Intelligence hardware still deferred (12.B's outstanding item).
- [ ] **13.G Safety surfaces + Keychain** (needs 12.C + 13.1): approval inbox, cost chip in topbar, scope-denied in inbox, `security-framework` keychain integration. **Approval requests emit `ArtifactCreated { kind: "approval" }` with the interactive action surface already rendering; scope denials attach as `comment` artifacts on the offending code-change artifact.**

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

### Phase 13.H — Safety enforcement *(after 13.G; GA gate; detail in `security.md`)*

- [ ] Flip approval-gate enforcement from post-append to pre-write.
- [ ] Symlink-safe scope (`canonicalize()` + worktree-prefix check).
- [ ] Risk-tiered gates: in-app approval / Touch ID for irreversible-or-cross-org / per-track capability grants.
- [ ] `claude` binary pinning via `SecStaticCodeCheckValidity`.
- [ ] Context manifest surfaced at turn boundaries with untrusted-lane tagging.
- [ ] Event schema: `(track_id, role, claude_session_id, tool_name)` on every event; tool-call events first-class.
- [ ] HMAC chain over events with session-sealed key; periodic external anchor.
- [ ] Secrets scanner on pre-write (`gitleaks`-equivalent ruleset); secret-input mode in chat.
- [ ] CSP `frame-ancestors 'self'`; helper IPC max-frame + fuzz harness; webview lockdown audit.

### Phase 16.R — Release mechanics *(after 13 + 15)*

- [ ] Apple Developer identity + CI signing secrets.
- [ ] First signed + notarized `.dmg` (`cargo tauri build` → `codesign` → `notarytool`).
- [ ] Updater backend: signed `latest.json` on static host (dual-key in 16.S).
- [ ] Crash-report endpoint (opt-in upload; stack-trace paths anonymized, diff-preview before send).
- [ ] Install QA checklist on a fresh Mac (see `apps/desktop/PACKAGING.md`).

### Phase 16.S — Supply-chain posture *(DMG gate; detail in `security.md`)*

- [ ] Blocking CI: `cargo audit` / `cargo deny` / `cargo vet` / `npm audit` / `lockfile-lint`.
- [ ] SBOM (CycloneDX) per release + SLSA v1.0 L3 provenance.
- [ ] Updater dual-key Ed25519 (primary + revocation), HSM-backed signing, rotation doc.
- [ ] Separate signing identity for the Foundation helper binary.
- [ ] Hardened runtime entitlements published; minimal surface.
- [ ] `SECURITY.md`, `.well-known/security.txt`, PGP key, 30/90-day disclosure SLA.
- [ ] Third-party pentest (~$30–60k, 4–8 weeks) scheduled pre-DMG.
- [ ] Self-hosted CI runner hardening: ephemeral VMs, egress allowlist, scoped short-lived tokens.

### Phase 17.T — Team-tier trust *(gates team pricing; detail in `security.md`)*

- [ ] App-level AES-GCM on sensitive event fields; Keychain-sealed device-only key.
- [ ] Two-tier logging (envelopes default, encrypted bodies with user-controlled purge).
- [ ] MDM / admin-signed managed-preferences policy at `/Library/Managed Preferences/com.designer.app.plist`.
- [ ] SIEM-ready JSONL / CEF audit-log export (user-initiated, diff-previewed).
- [ ] Narrowly-scoped GitHub App with per-workspace grants (individual-tier stays on `gh`).
- [ ] Inter-workspace HMAC domain separation.
- [ ] Bug bounty live (HackerOne or equivalent); VDP discoverable.
- [ ] Foundation helper data-deletion completeness audit.

### Phase 19 — Workspace scales up *(after 13 + 16; parts pullable into 15)*

Delivers the user-visible affordances of the workspace/track model (spec §"Workspace and Track"). Primitive lands in 13.E; this phase unlocks what it enables.

- [ ] Sequential track succession ("start the next track on this workspace") with context recap via `LocalOps::recap`.
- [ ] Parallel tracks per workspace + cross-track conflict detection (extends the existing cross-workspace primitive).
- [ ] Workspace lead hybrid routing (exploratory, opt-in — spec Decision 31 "future direction"): local-model default path for routine chat; Claude Code escalation for consequential decisions; settings toggle, not a default.
- [ ] Track archive + history surface; `@track:name` references.
- [ ] Workspace forking (`WorkspaceForked`): inherits parent docs/decisions/chat history as read-only baseline.
- [ ] Workspace reconciliation (`WorkspacesReconciled`): absorb or diverge cleanly.
- [ ] Activity spine extension: new altitude for tracks; one-line summaries per track.

---

## Recently Completed

### Phase 13.F — Local-model surfaces — 2026-04-25

Wires Apple Foundation Models (via the 12.B helper) into the four 13.1-prepared surfaces.

- **Write-time summary hook.** `AppCore::append_artifact_with_summary_hook` is the new emitter seam for `code-change` artifacts. It calls `LocalOps::summarize_row` with a 500ms deadline; on success the helper output replaces the supplied summary before the event lands. On timeout, the artifact appends with a deterministic 140-char ellipsis-truncated summary and a detached task emits `ArtifactUpdated` when the helper eventually returns. Per-track debounce (Option B — each artifact in a 2s burst from the same `(workspace_id, author_role)` reuses the cached batch summary; no event suppression, just one helper call per burst). Helper-down (boot-time fallback) short-circuits to truncation immediately; never even dispatches the call. Documented in ADR 0003.
- **`cmd_recap_workspace`.** New IPC command: collects the workspace's recent artifacts, calls `LocalOps::recap`, emits `ArtifactCreated { kind: "report", title: "<Weekday> recap", author_role: Some("recap") }` with the headline as the inline summary and full markdown as the inline payload.
- **`cmd_audit_artifact`.** New IPC command: takes a target artifact + claim, calls `LocalOps::audit_claim`, emits `ArtifactCreated { kind: "comment", title: "Audit: <claim>", summary: "<verdict>", author_role: Some("auditor") }` in the target's workspace. Anchoring is implicit via workspace_id + the inline rationale's `Anchored to:` line.
- **`PrototypeBlock` integration.** `PrototypePreview` extended with a discriminated-union prop signature: `{ workspace }` keeps the existing lab-demo path, `{ inlineHtml, title? }` renders just the sandboxed iframe (`sandbox="allow-forms allow-pointer-lock"`, no `allow-scripts`). `PrototypeBlock` passes the artifact's inline payload through this second form; the placeholder shows only when no inline HTML is available. Block renderer changes: 7 LOC.
- **Tests.** 10 new Rust unit tests in `core_local::tests` cover the in-deadline path, late-return → ArtifactUpdated, helper-error fallback, debounce reuse, recap happy path + missing-workspace error, audit emission, the 140-char truncate, and non-code-change bypass. 3 new vitest tests cover the iframe-renders / no-payload / hash-payload paths in `PrototypeBlock`.
- **Deferred.** Real-binary validation on an Apple-Intelligence-capable Mac (12.B's outstanding item) still pending. Per-artifact provenance UI (showing "fallback summary" vs "on-device summary" inline) is a 13.G/UI follow-up — the system-level helper-status surface from 12.B already drives the global indicator.

### Phase 13.1 — Unified workspace thread + artifact foundation — 2026-04-24/25

Consolidates `tab-model-rethink` + `find-agentation-server`. Tabs are views, not modes (spec Decision 36): every tab renders a single `WorkspaceThread` component with typed artifact blocks inline. Twelve block renderers shipped (7 real, 5 stubs registered for 13.D/E/F/G to fill). Backend artifact events + `PayloadRef` + rail projection + 4 new IPC commands + `reveal_in_finder` shim. Six surface-architecture sliders + tab-corner variant toggle in the dev panel. Sand-toned dark palette rebuilt on real `--sand-*` references (the previous `--sand-dark-N` references were broken — that token doesn't exist in Radix Colors v3). Decisions 36–39 added; Decision 11 amended; Decision 12 superseded. FB-0024 / FB-0025 codified. See `history.md` for the full sourcing map (memphis-v2 polish pass + tab-model-rethink direction) and rationale.

### UI overhaul — floating-surface register, dark mode, Lucide icons — 2026-04-23
Multi-session frontend rewrite. Introduced a two-tier page + floating-surface register (sidebars flat on sand, main content a raised white-in-light / off-black-in-dark rectangle with soft hairline border). Fixed dark mode — Radix Colors v3 activates scales via `.dark-theme` class, not `prefers-color-scheme`; theme bootstrap rewritten to apply both class + `[data-theme]` + `colorScheme` on documentElement, with a live `MediaQueryList` listener in System mode. Wired a System / Light / Dark `SegmentedToggle` into Settings → Appearance. Adopted `lucide-react`; all ~30 inline `<svg>` tags across 7 files removed. BuildTab rebuilt as a chat/terminal surface with slash commands (`/plan · /diff · /test · /merge`) replacing the task-board + approval-card layout. HomeTabA restructured: kicker removed, Needs-your-attention sorts to top and hides when empty, workspace rows compress to status + name + one-line summary, Autonomy becomes an interactive SegmentedToggle with optimistic local override. Palette default density flipped to `open` (bare input on surface). New tokens: `--radius-surface` (24 px), `--color-content-surface`, `--color-border-soft`, `--surface-{gutter,tab-gap,text-pad,inner-pad,shadow}`. Compose corner radius is concentric with the floating surface via `calc()`. SurfaceDevPanel and TypeDevPanel retired after their tuning landed in tokens.css / app.css; the `dev/` directory no longer exists. Design-language axiom #8 amended, new patterns documented, change-log entry + FB-0016..FB-0020 added. 13/13 frontend tests pass, 6/6 invariants clean on 33 files, typecheck clean. See `history.md` for the full decision + tradeoff narrative.

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
