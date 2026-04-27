# Plan

Near-term focus and active work items. See `roadmap.md` for the full phased sequence; see `spec.md` for architectural decisions.

## Current Focus

**Phase 13.1 shipped (2026-04-24).** Tab model unified: Plan / Design / Build retired, every tab renders `WorkspaceThread`, typed artifact blocks live inline. Backend artifact foundation in place — `ArtifactCreated/Updated/Pinned/Unpinned/Archived` events, `PayloadRef` inline/hash discriminant, rail projection (`pinned_artifacts` per workspace), four new IPC commands. Block renderer registry with 12 renderers (7 real, 5 stubs) lifted from the tab-model-rethink sketch into production modules; sketch file and URL-hash gate deleted. Pin/unpin wired into the workspace rail. ComposeDock adopted as the shared compose input. See `history.md` for the consolidation sourcing from tab-model-rethink + find-agentation-server branches.

**Phase 13.D / 13.E / 13.F / 13.G all shipped 2026-04-25.** Phase 13 wire-up complete:

- **13.D — Agent wire** *(landed 2026-04-25, PR #17)*: `cmd_post_message` IPC, AppCore::post_message + 120 ms message coalescer, `OrchestratorEvent::ArtifactProduced` variant, frontend draft-restore + typed `IpcError` translator. See `history.md`.
- **13.E — Track primitive + git wire** *(landed 2026-04-25, PR #16)*: Track aggregate + projection (Active → PrOpen → Merged → Archived; `RequestingMerge` reserved as in-process-only). `cmd_link_repo` canonicalizes + validates; `cmd_start_track` creates per-track worktrees + seeds `core-docs/*.md` + commits with full rollback; `cmd_request_merge` runs `gh pr create` under a 30 s timeout with concurrent-call dedupe. Edit-batch coalescer emits one `code-change` artifact per unique per-file `+a:-r` signature. Branch-name argument-injection guard, per-repo serialization, RepoLinkModal focus trap.
- **13.F — Local-model surfaces** *(landed 2026-04-25, PR #18)*: write-time summary hook (500 ms deadline + late-return `ArtifactUpdated` + per-track debounce), `cmd_recap_workspace` (emits `report` artifact), `cmd_audit_artifact` (emits `comment` artifact with `author_role: Some("auditor")`), `PrototypePreview` wired into `PrototypeBlock` via optional inline-HTML prop.
- **13.G — Safety surfaces + Keychain** *(landed 2026-04-25, PR #19)*: production `InboxPermissionHandler` swapped in for `AutoAcceptSafeTools` (5-min timeout + single-writer-per-id + pre-park reorder); orphan-approval boot sweep with serialized iteration + per-step recheck; `cmd_request_approval` deliberate error stub (XSS-injection guard); `record_scope_denial` emits `ScopeDenied` audit + `comment` artifact; macOS Keychain read-only via `security-framework`; cost chip with replay-on-boot via `CostTracker::replay_from_store`; `GateStatusSink` keeps `gate.status` truthful. See `history.md` 13.G entry.

**Phase 13 integration meta-PR ([#20](https://github.com/byamron/designer/pull/20)) opened 2026-04-26.** Mergeable / CLEAN with all five CI checks green (rust test / clippy / fmt / frontend / claude-live). Six-agent post-merge review surfaced four production wiring gaps that the underlying parallel PRs deferred — captured below as **Phase 13.H — Phase 13 hardening pass**. None block the integration merge; the mock-orchestrator path works fully, the typed-artifact UI is intact, and all parallel-track conventions held.

**Phase 13.H shipped 2026-04-26.** Five items in one PR (F1 + F2 + F5 + F3 + F4) — real-Claude usability gates closed. Permission prompts now route through `InboxPermissionHandler::decide` via a spawned decide-task (non-blocking; reader keeps draining during the 5-minute approval window); the inbox handler receives `workspace_id: Some(...)` so it doesn't fail-closed; `tool_use` blocks surface as inline "Used Read" / "Used Edit" `Report` artifacts; `result/success` cost lines flow into `CostTracker::record` and `EventPayload::CostRecorded`; git-emitted code-change artifacts go through the on-device summary hook. Original 13.H safety-enforcement work was renumbered to **13.I** (pre-write gates, symlink-safe scope, risk-tiered approvals, binary pinning, HMAC tamper-evidence) — see `security.md`; continues to gate GA.

**Real-Claude default + dogfood readiness shipped 2026-04-26 (PR #23).** AppConfig flipped to `use_mock_orchestrator: false` by default; settings + `DESIGNER_USE_MOCK=1` env var override. `TeamSpec.cwd` plumbed through so agents operate in the workspace's repo, not the desktop process's cwd. `claude_home` defaults to `~/.designer/claude-home` to isolate from Conductor / interactive `claude` CLI state. Boot preflight + clear orchestrator-mode logging. Cost chip on by default. `spawn_message_coalescer` swapped from `tokio::spawn` → `tauri::async_runtime::spawn` (latent bug from 13.D that only surfaced on the first real GUI launch).

**First-run polish shipped 2026-04-26 (PR #24).** Five day-1 blockers caught by the user's first launch from `/Applications`:

1. macOS `.app` doesn't inherit shell PATH → `claude` not found. `resolve_claude_binary_path()` now probes common install paths (`~/.npm-global/bin`, `~/.bun/bin`, `~/.yarn/bin`, `~/.asdf/shims`, `/opt/homebrew/bin`, etc.) plus `$SHELL -lc 'command -v claude'` as a last-resort shell expansion. Honors `DESIGNER_CLAUDE_BINARY` override; warns on invalid override (was silent).
2. Whole app scrolled like a web page → `position: fixed; inset: 0; overflow: hidden` on `html, body, #app`.
3. Traffic-lights overlapped UI / window couldn't be moved → full-width `.app-titlebar` zone (`data-tauri-drag-region`, `position: fixed`, `z-index: var(--layer-titlebar)`) above the shell grid; shell `padding-top: var(--app-titlebar-height)` reserves the inset. Strip's redundant local drag spacer removed.
4. "Add project" silently failed because `window.prompt` is unimplemented in Tauri's bundled webview. Replaced with `CreateProjectModal` — path-first field order, name autofills from `basename(path)`, scrim + focus trap + ESC dismiss, `onCreated` callback for onboarding reuse.
5. `cmd_create_project` and a new `cmd_validate_project_path` IPC now expand `~` to `$HOME` and validate the path is a real directory before accepting. Without this, a user typing `~/code/foo` got the literal string stored as the project root and every git op subsequently exploded.

Plus: `--app-titlebar-height` and `--layer-titlebar` defined as design tokens, `createProjectOpen` boolean migrated to extending `AppDialog` discriminant, shared `collectFocusable` + `messageFromError` helpers extracted to `lib/modal.ts` (used by both `RepoLinkModal` and `CreateProjectModal`).

**Next: dogfood-driven.** Designer is now actually runnable in `/Applications` against real Claude. The next phase priority is whatever real workflow friction surfaces — Phase 14 (sync transport) vs. Phase 15 (polish) vs. Track 13.J (the 13.H/PR-24 follow-ups), driven by daily-driver signal.

12.B's real-binary round-trip still needs one run on an Apple-Intelligence-capable Mac to close the SDK-shape delta in `integration-notes.md` §12.B.

### Phase 15 — First-run onboarding *(planned, post-dogfood)*

The first real launch (2026-04-26) surfaced that the empty state is a dead-end for new users — nothing tells them "the strip + button is how you start." We patched the symptom with a CTA on the empty surface (FB-0032 / PR pending) but the underlying flow needs a real onboarding pass. Goals:

1. **Zero dead empty states.** Every initial surface (no projects, no workspaces, no tabs, no artifacts) ships a primary CTA that takes the next obvious action.
2. **Guided first project.** A single coachmarked path: launch → "create your first project" → Finder folder picker → name → land in project home with a hint at the next step (linking the repo, opening the first workspace).
3. **Picker-first inputs.** Filepath, color, date, model — every input modality with a native affordance defaults to that affordance (FB-0032). Free text is the fallback, not the primary path.
4. **Trust, not noise.** Onboarding must respect "calm by default" — one surface, one idea per slide, dismissible. The existing `Onboarding` walkthrough is the right scaffold; it just needs concrete actions wired to each slide instead of marketing copy.
5. **First-run permission model.** Approval gates should be explained on first contact, not silently enforced — surface a one-time inline tooltip the first time an approval lands in the inbox.

Owns: `frontend`, `ux`. Lands after Phase 14 unless dogfooders block on it.

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

- [x] **13.D Agent wire** *(landed 2026-04-25)*: replace `WorkspaceThread::onSend` with `Orchestrator::post_message`; stream replies via `designer://event-stream` as `MessagePosted` thread events, agent-produced artifacts (diagrams, reports) as `ArtifactCreated`. Partial-message coalescer (deferred from 12.A) lands here.
- [x] **13.E Track primitive + git wire** *(landed 2026-04-25; track-primitive-git-wire branch)*: `Track` aggregate (`id`, `workspace_id`, `branch`, `worktree_path`, `state ∈ Active|RequestingMerge|PrOpen|Merged|Archived`, PR refs, timestamps) + projection across `TrackStarted / PullRequestOpened / TrackCompleted / TrackArchived`. `designer-git` extended with `init_worktree`, `validate_repo`, `commit_seed_docs`, `current_status`. New IPC: `cmd_link_repo`, `cmd_start_track`, `cmd_request_merge`, `cmd_list_tracks`, `cmd_get_track`. Frontend: repo-link modal in onboarding (extends final slide) and Settings → Account; Request Merge icon in workspace sidebar header. Edit-batch coalescer is explicit (`check_track_status`) — emits one `code-change` artifact per unique diff signature. PR open emits a companion `pr` artifact.
- [x] **13.F Local-model surfaces** *(landed 2026-04-25)*: write-time `code-change` summaries via `LocalOps::summarize_row` (per-track debounce, 500ms append deadline, ArtifactUpdated on late return); `cmd_recap_workspace` emits `ArtifactCreated { kind: "report" }`; `cmd_audit_artifact` emits `ArtifactCreated { kind: "comment", author_role: Some("auditor") }` anchored to the target. PrototypePreview accepts inline HTML; PrototypeBlock renders it. ADR 0003 amended with the hook seam contract. Real-helper validation on Apple-Intelligence hardware still deferred (12.B's outstanding item).
- [x] **13.G Safety surfaces + Keychain** *(landed 2026-04-25)*: `InboxPermissionHandler` replaces `AutoAcceptSafeTools` as the production permission handler — every Claude prompt emits `ApprovalRequested` + `ArtifactCreated{kind:"approval"}`, parks the agent on a `oneshot` with a 5-minute deadline, resolves via `cmd_resolve_approval`. Boot-time orphan-approval sweep (`process_restart` reason) keeps the inbox honest after restarts. Cost chip lives in the workspace topbar, off by default per Decision 34, toggle in Settings → Preferences. macOS Keychain is read-only (Decision 26): Settings → Account renders the credential's presence + last-verified time, never reads the token contents. Scope denials emit `ScopeDenied` AND a `comment` artifact anchored to the offending change. See `history.md` for the full design + tradeoff narrative.

#### Integration meta-PR ([#20](https://github.com/byamron/designer/pull/20)) — 2026-04-26

D/E/G/F merged in order onto `phase-13-integration` with conflicts resolved cleanly. Six-agent review pass (3 perspectives + reuse / quality / efficiency simplify) ran post-merge and surfaced four wiring gaps inherent to the underlying PRs (not regressions from the integration). Four low-risk wins applied as a cleanup commit (`8c712d4`): typed `IpcError::From<CoreError>` mapping (fixes 7 silent error-downgrades), broken `--font-mono` token reference, expanded `author_roles` registry adoption at production sites, removed dead `__reset_inbox_handler_for_tests` stub. CI green: rust test / clippy / fmt / frontend / claude-live integration all pass on the integration branch. Mergeable / CLEAN.

### Phase 13.H — Phase 13 hardening pass *(landed 2026-04-26)*

**Shipped 2026-04-26.** Real-Claude usability gates closed. ~500 LOC across two crates, one PR, sequential as planned (F1 → F2 → F5 → F3 → F4). All five items landed; quality gates green (`cargo fmt --check` / `cargo clippy --workspace --all-targets -- -D warnings` / `cargo test --workspace` / `tsc --noEmit` / `vitest run`). See `history.md` for the per-item retro.

- [x] **F1 — Wire `permission_handler.decide()` into the stdio reader.** Added `TranslatorOutput::PermissionPrompt { request_id, tool, input, summary, tool_use_id }` and a `control_request` parse arm covering Claude's `--permission-prompt-tool stdio` shape (`subtype: "can_use_tool"`, `tool_name`, `input`, `tool_use_id`, opaque `request_id`). The reader-loop body factored into `run_reader_loop` so it can be driven from a synthetic stdout in unit tests; on the new variant it `tokio::spawn`s a decision task (must not await inline — the handler can park 5 minutes), encodes `{"behavior":"allow"|"deny"}` via `encode_permission_response`, and writes through the existing `stdin_tx` channel.
- [x] **F2 — Populate `PermissionRequest::workspace_id`.** Set at the F1 construction site; the spawned decide task captures `workspace_id: Some(workspace_id)` so `InboxPermissionHandler` can anchor the approval artifact instead of fail-closing with `MISSING_WORKSPACE_REASON`.
- [x] **F5 — Tool-use translator + `ArtifactProduced` emission.** `translate_assistant` now walks the message's `content` array and emits one `OrchestratorEvent::ArtifactProduced { kind: Report, title: "Used {tool}", summary, body, author_role: Some(author_roles::AGENT) }` per `tool_use` block alongside the existing `MessagePosted` for concatenated text. `tool_use_summary` picks the most informative one-line summary by tool kind (`file_path` for Write/Edit, `command` for Bash, `pattern` for Grep, etc.). Stretch (`tool_use_id` → eventual `tool_result` correlation) deferred — filed as `TODO(13.H+1)` inline.
- [x] **F3 — Subscribe `ClaudeSignal::Cost` to `CostTracker::record`.** Added `Orchestrator::subscribe_signals()` to the trait (default impl returns a never-firing receiver — additive, no breaking change). `MockOrchestrator` overrides with a real `signal_tx` and exposes `signals()` so tests inject `Cost` directly. `AppCore::boot` (and the new `boot_with_orchestrator(config, override)` test seam) spawns a `Weak<AppCore>`-holding task that converts `total_cost_usd: f64` to dollar-cents (round-to-nearest, clamping non-finite or negative) and routes through a new `CostTracker::record()` method that appends `EventPayload::CostRecorded` and updates the in-memory usage map without a cap check (already-incurred spend cannot be refused).
- [x] **F4 — Route `core_git::check_track_status` through `append_artifact_with_summary_hook`.** Replaced the direct `store.append` in `check_track_status` with the hook-seam call (and changed the receiver to `self: &Arc<Self>`). The 500ms deadline + late-return `ArtifactUpdated` + per-track debounce now fire for git-emitted code-change artifacts, so the rail's edit-batch summary reads as on-device LLM output instead of `+12 −3 across 2 files`.

#### Acceptance criterion (manual dogfood)

With all five items shipped, `cargo tauri dev` against the real `claude` CLI runs the full loop: create workspace → link the Designer repo itself → send "read CLAUDE.md and summarize it" → assistant narration streams to the thread → `ArtifactProduced { kind: Report, title: "Used Read" }` lands inline → inbox surfaces a permission approval → granting unblocks the agent → response streams back → cost chip increments.

#### Recommended automated test additions (folded into 13.H):

- **F1 stdio-reader test** — synthetic Claude stdout fixture that emits a `tool_use_request` permission prompt; assert `permission_handler.decide` is called once with the expected `tool` and `input`, and the writer task's stdin receives the encoded response. Plus three fixture-based translator tests (Write / Edit / Bash).
- **F2 round-trip test** — `claude_code::tests` builds a `PermissionRequest` from a real Claude prompt JSON; assert `workspace_id` is `Some(ws)`. Regression guard against silent-deny re-introduction.
- **F5 tool-use emission test** — fixture with mixed text + tool_use blocks; assert one `MessagePosted` for text + one `ArtifactProduced` per tool_use block.
- **F3 cost subscriber** — boot `AppCore`, broadcast a fake `ClaudeSignal::Cost { workspace_id, total_cost_usd: 0.42 }`; assert `cost_status(workspace_id).spent_dollars_cents == 42` and a `CostRecorded` event is in the store.
- **F4 hook routing** — `core_git::tests::check_track_status_routes_through_summary_hook` asserts that `check_track_status` calls `append_artifact_with_summary_hook` rather than `store.append` for `CodeChange` artifacts (use a counting `LocalOps` mock).
- **Integration smoke** — gated behind `--features claude_live`, run a single user message → tool prompt → grant → tool result round-trip end-to-end against real Claude; assert the inbox surfaces, the grant unblocks, and a `CodeChange` artifact lands with an on-device summary.
- **Frontend regression suite** — Playwright + screenshot diff harness (already on the Phase 15 list); the integration UI regressions identified in the review pass would have surfaced here. Pull-forward candidate.

### Phase 14 — Sync transport *(parallel with 13 or 15)*

- [ ] Pick transport (WebRTC via `str0m` default; document alternatives in short ADR).
- [ ] Implement `SyncTransport` trait + first impl.
- [ ] Pairing UI: host QR with `PairingMaterial.secret`; scanner/code entry on the peer.
- [ ] Integration test: two processes sync a 20-event log without a server.

### Phase 15 — Hardening + polish *(parallel with 13 or 14)*

Independent items, picked by what dogfooding surfaces first:

- [ ] Mini primitives migration (`Box`, `Stack`, `Cluster`, `Sidebar`) for AppShell / HomeTab / ActivitySpine / WorkspaceSidebar.
- [ ] `correlation_id` / `causation_id` wiring for derived events.
- [ ] Pairing RNG: swap manual entropy for `rand::rngs::OsRng`.
- [ ] Dark-mode visual-regression harness (Playwright + screenshot diffing).
- [ ] Auto-grow chat textarea.
- [ ] `AppCore::sync_projector_from_log` incrementalization (last-seen sequence per stream).
- [ ] **15.J — Real-Claude UX polish.** Tool-use card visual demotion, ApprovalBlock drill-down + resolved-label fix + busy state, cost chip a11y glyph + cap-warn popover + first-enable tip, code-change rail cross-fade, `ArtifactKind::Report` disambiguation, AskUserQuestion choice as feedback entry. Detail in `roadmap.md` § 15.J.
- [ ] **15.K — Onboarding & first-run.** Welcome → claude auth verification → github auth verification → "create your first project" chain. Currently Onboarding ends in a dismiss; an empty `~/.designer/` should walk the user through to a working state. Detail in `roadmap.md` § 15.K.

### Track 13.J — Phase 13.H + 13.K follow-ups *(non-blocking; structural cleanups + first-run polish carry-overs)*

Surfaced by the PR #22 six-perspective review (13.H wiring) and the PR #24 three-perspective review (first-run polish). Each ~half-day, batchable into one PR. **Pick first when you want clean infrastructure work.**

13.H follow-ups:

- [ ] **F5+1** — tool_use_id → tool_result correlation; emit `ArtifactUpdated` on the original "Read X" card with the result's summary (~50 LOC stateful pass; flagged as `TODO(13.H+1)` in `stream.rs`).
- [ ] **ADR addendum** — decide whether `Orchestrator::subscribe_signals` keeps `ClaudeSignal` or factors a neutral `OrchestratorSignal` enum. Lock before a second orchestrator (Cursor, Ollama) lands.
- [ ] **Live `permission_prompt_round_trip` test** — gated by `--features claude_live` on the self-hosted runner; confirms the response wire shape against real `claude`.
- [ ] **`spawn_cost_subscriber` ↔ `build_event_bridge` unify** — extract `forward_broadcast<T>(rx, handler)` so the `Lagged`/`Closed` arms aren't duplicated.
- [ ] **F4 test reuse** — expose `core_local::tests::boot_with_helper_status` as `pub(crate)` and a shared `mod test_support` for `CountingHandler`/`CountingOps`.
- [ ] **`run_reader_loop` context struct** — bundle the 9 args into `ReaderLoopCtx`, drop `#[allow(clippy::too_many_arguments)]`.
- [ ] **Bounded translator state** — LRU cap (~1k) on `ClaudeStreamTranslator::tasks`/`agents` HashMaps so multi-day sessions can't grow them unboundedly.
- [ ] **`CostTracker::replay_from_store` bulk-update** — collapse N shard-locks into one bulk projection at end of replay.

13.K (first-run polish — PR #24) follow-ups:

- [ ] **Browse… button on `CreateProjectModal`** (and `RepoLinkModal`) — install `@tauri-apps/plugin-dialog`, register the capability, fall back gracefully in the web build. The user should not have to copy-paste an absolute path.
- [ ] **Inline path validation as the user types** — debounced call to `cmd_validate_project_path`; show the canonical resolved path on success, error inline on failure. Backend already validates on submit; this just moves feedback earlier.
- [ ] **`<Modal>` primitive** — three modals now (AppDialog/help, RepoLinkModal, CreateProjectModal) share scrim + focus-trap + ESC + Tab-cycle plumbing. `lib/modal.ts` extracted the 30-LOC dedup; the next consolidation is a real composition primitive (header + body + button-row slot pattern). File a short ADR on whether it owns the scrim or accepts one.
- [ ] **Onboarding chained to create-project** — `Onboarding.tsx`'s final slide should call `openCreateProject()` so first-launch flows directly into the "create your first project" surface instead of dumping the user on an empty strip with a small `+` icon.
- [ ] **Empty-state CTA** — when `projects.length === 0`, the main pane should render a single calm "Create your first project" hero, not a generic empty pane. Discoverability fix for users who dismiss the welcome slabs.
- [ ] **Settings → Reset Designer** — confirmation-gated wipe of `~/.designer/events.db`. Replaces today's "tell the user to `rm`" workaround for stale mock-mode data.

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

### Phase 13.D — Agent wire — 2026-04-25

`WorkspaceThread.onSend` now `await`s a real `cmd_post_message` IPC. AppCore appends the user's message synchronously as both `MessagePosted` + `ArtifactCreated { kind: "message" }` so drafts survive subprocess failure, then dispatches to `Orchestrator::post_message` (lazy-spawning a team on first message in demo mode). A boot-spawned message coalescer subscribes to the orchestrator's broadcast, drops user echoes, accumulates per-(workspace, author_role) bursts, and flushes one `ArtifactCreated` after 120 ms of idle. New `OrchestratorEvent::ArtifactProduced` variant carries agent-emitted typed artifacts (diagram / report only — other kinds belong to E/F/G); MockOrchestrator emits these from a keyword detector so the round-trip exercises the full path offline. On send failure the draft is restored into ComposeDock and an alert banner explains the error. New `PostMessageRequest` / `PostMessageResponse` DTOs in `designer-ipc`; mirror types in `packages/app/src/ipc/types.ts`. `commands_agents::post_message` registered alphabetically in main.rs's `generate_handler!`. `cargo test --workspace` green, clippy `-D warnings` clean, fmt clean, vitest 15/15, tsc clean. See `history.md` for full decisions/tradeoffs/lessons.

### Phase 13.F — Local-model surfaces — 2026-04-25 (review pass 2026-04-25 follow-up)

Wires Apple Foundation Models (via the 12.B helper) into the four 13.1-prepared surfaces.

**Review-driven follow-ups landed in the same branch:**

- **Debounce-burst race fixed.** `SummaryDebounce` now distinguishes `Resolved` (cached) from `Inflight` (a watch::Sender backing a pending helper call). Concurrent callers within the 2s window join the in-flight watch instead of dispatching their own request — `helper.call_count() == 1` for a 100ms-apart burst over an 800ms helper.
- **Eviction.** `SUMMARY_DEBOUNCE_MAX_ENTRIES = 1024`. Expired `Resolved` entries are pruned opportunistically on each `claim`; over the cap, the oldest `Resolved` is dropped (never an `Inflight` — that would error every awaiting caller). Test at 1000 unique keys verifies the bound holds.
- **`Weak<AppCore>` for the late-return spawn.** The detached task that emits `ArtifactUpdated` after a >500ms helper return now downgrades `Arc<Self>` to `Weak`, so a shutting-down `AppCore` doesn't have its lifetime extended by an in-flight helper call.
- **Archived target rejection.** `audit_artifact` now returns `NotFound` when the target is archived (the projector's per-id lookup doesn't filter archived; the policy lives at the audit boundary). `recap_workspace` rejects archived/errored workspaces with `Invariant`.
- **Cross-workspace audit boundary.** `AuditArtifactRequest` requires `expected_workspace_id`; mismatch returns `IpcError::InvalidRequest`. Future-proofs the seam for per-workspace authorization in 13.G.
- **Author-role registry** at `designer_core::author_roles` (`RECAP`, `AUDITOR`, `AGENT`, `TRACK`, `SAFETY`, `WORKSPACE_LEAD`). Replaces inline string literals in `core_local.rs`; downstream tracks should reuse.
- **Local timezone for "Wednesday recap"** via `time::OffsetDateTime::now_local()` (added `local-offset` to the workspace `time` feature set), with UTC fallback when the host can't resolve a local offset.
- **CSP injection in `PrototypeBlock`.** Inline-HTML mode now uses `sandbox=""` (no token at all — drops `allow-forms` to harden against `<form action>` exfiltration) AND wraps the agent HTML with a CSP `<meta>` setting `form-action 'none'` + the same default-src 'none' / script-src 'none' rules as the lab demo. Two new vitest cases assert sandbox is empty and CSP is present in the rendered srcdoc.
- **Wiring TODO.** A grep-able `TODO(13.F-wiring)` comment block in `core_local.rs` documents that tracks D / E / G must route `code-change` artifacts through `append_artifact_with_summary_hook`. Tracks emitting via direct `store.append` will bypass the on-device summary.

**Deferred (recommended before user-visible launch):**

- **`summary_provenance` field on `Artifact`** — flagged as Medium. The artifact event vocabulary is frozen by ADR 0003; adding the field requires either (a) a new event variant `ArtifactSummaryProvenanceSet { artifact_id, provenance }` (additive, replay-safe) or (b) a schema bump on `ArtifactCreated/Updated`. Either path is its own ADR; the system-level helper-status indicator from 12.B already drives the global "On-device models unavailable" copy. Tracked: open a pre-launch ADR proposing option (a).

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
