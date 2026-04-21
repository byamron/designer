# Plan

Near-term focus and active work items. See `roadmap.md` for the full phased sequence; see `spec.md` for architectural decisions.

## Current Focus

**Phase 0 validation + Tauri shell wiring.** Preliminary build (Phases 0–11) landed on `preliminary-build` branch (2026-04-21); see `history.md`. Backend, frontend, design lab, and polish scaffolding all in place with tests passing. Remaining: (a) run the Phase 0 spike against a real Claude Code install to validate the agent-teams file shapes and refine `watcher::classify`; (b) wire the Tauri shell binary (register `#[tauri::command]`s that delegate to `designer-desktop::ipc`); (c) build the Swift helper on Apple Intelligence hardware to validate the Foundation Models call; (d) measured performance pass on a real Tauri build.

## Handoff Notes

- Spec and roadmap are complete for the planning phase. Treat `spec.md` as architectural source of truth and `roadmap.md` as the sequence source of truth.
- Working name is **Designer**; provisional.
- `.claude/` agents are not populated yet — first real agent scaffolding happens in Phase 1. `.claude/skills/` is populated via the Mini install (2026-04-21): 6 design-system skills (`elicit-design-language`, `generate-ui`, `check-component-reuse`, `enforce-tokens`, `audit-a11y`, `propagate-language-update`). Frontend wiring is deferred to Phase 8.

## Active Work Items

### Phase 12a — Real-integration validation *(current focus)*

**Goal:** close the gap between the mock-first backend and the real runtimes behind each trait. See `roadmap.md` Phase 12a for full scope.

**Steps:**
- [ ] Install Claude Code locally and run `ClaudeCodeOrchestrator::spawn_team`. Catalog observed file shapes under `~/.claude/teams/` and `~/.claude/tasks/`; update `watcher::classify` and the CLI args in `claude_code.rs`.
- [ ] Add an integration test gated by `CLAUDE_CODE_INSTALLED=1`.
- [ ] Build `helpers/foundation` on an Apple-Intelligence-capable Mac (macOS 15+). Validate the `LanguageModelSession.respond(to:)` call.
- [ ] Wire the Tauri shell binary: add `tauri = "2"` dep, scaffold `tauri.conf.json`, register `#[tauri::command]`s from `designer-desktop::ipc`.
- [ ] Author a restrictive Tauri allowlist (FS to `~/.designer/` + linked repo roots; shell to `git`/`gh`/`claude`/helper only; no network beyond updater host).
- [ ] Measure cold start + idle memory + streaming load on the real Tauri build.

**Success criteria:** one integration test hits real Claude Code; one hits the built Swift helper; a Tauri window opens rendering the React app from a live `AppCore`; perf measured against the <1.5s cold-start / <200MB idle-memory targets.

### Phase 12b — Hardening second pass *(after 12a)*

- [ ] Migrate `AppShell` / `HomeTab` / `ActivitySpine` to Mini primitives (`Box`, `Stack`, `Cluster`, `Sidebar`).
- [ ] Move the approval-resolution surface out of the simulated timeout in `BuildTab` into a real inbox (likely inside the activity spine).
- [ ] Set `correlation_id` / `causation_id` on derived events for trace reconstruction.
- [ ] Auto-grow chat textarea.
- [ ] Replace manual-entropy pairing RNG fallback with `rand::rngs::OsRng`.
- [ ] Dark-mode visual regression harness (screenshot diffing).

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
