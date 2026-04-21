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

### Mini installed + initial design language elicited
**Date:** 2026-04-21
**Branch:** mini-install
**Commit:** pending

**What was done:**
Installed Mini design system at `packages/ui/` via Mini's `install.sh`. Installed 6 design-system skills at `.claude/skills/` (`elicit-design-language`, `generate-ui`, `check-component-reuse`, `enforce-tokens`, `audit-a11y`, `propagate-language-update`), the invariant runner at `tools/invariants/`, and Mini templates at `templates/`. Ran greenfield elicitation against the prior `design-language.draft.md`; produced the final `core-docs/design-language.md` with all 10 axioms set and the draft's Core Principles / Depth Model / Review Checklist carried through. Seeded `core-docs/component-manifest.json`, `core-docs/pattern-log.md`, and `core-docs/generation-log.md`. Appended a marker-delimited Mini section to `CLAUDE.md` and extended the Core Documents table to list the new docs. Updated `packages/ui/styles/tokens.css` to reflect elicited values: fonts Geist + Geist Mono, radii 3/6/10/14, gray→mauve alias, accent→gray monochrome binding (dropped indigo + crimson imports). Synced Mini pin to `83df0b2` (latest; adds worktree-safe install check).

**Why:**
Designer's design-language scaffolding needed to become real before any surface ships. Mini is the intended substrate; installing it now — before Phase 8 frontend wiring — means the tokens, axioms, skills, and invariants are ready and the design decisions are made when real UI work starts. Elicitation converts the draft's prose principles into Mini's axiom → token cascade.

**Design decisions:**
- **Monochrome accent (axiom #3).** Notion/Linear-style greyscale, rejected chromatic accent candidates (purple overlaps Linear; terracotta/red overlap Claude brand or read too hot). Semantic colors (success/warning/danger/info) stay chromatic because they're doing signal work, not decoration. Enforced in code: `--accent-*` binds to `--gray-*`; no Radix chromatic import.
- **Mauve gray flavor (axiom #4).** Warmer than pure gray, still feels professional. Olive and sand are explicit alternatives to A/B once real surfaces exist. Swap mechanism documented in `pattern-log.md`.
- **Geist + Geist Mono (axiom #6).** Starting choice, font wiring deferred to Phase 8. System fallbacks in the stack mean nothing breaks if Geist isn't loaded.
- **Motion principle amended.** Draft said "motion is functional, not decorative." User amended during elicitation: snappy remains the personality, but considered liveliness is welcome — "it's a design tool and should feel nice." No gratuitous motion.
- **Theme principle amended.** Draft said "dark-default, light-parity required." User amended: system-default (`prefers-color-scheme`), both first-class, parity required.
- **Surface hierarchy = 3 tiers.** Navigation / Content / Float map directly to Mini's flat / raised / overlay. Modals borrow the overlay tier until a reason to distinguish appears.

**Technical decisions:**
- **Mini installed at `packages/ui/`.** Standard Mini layout. Fork-and-own tokens in `tokens.css` and `archetypes.css`; everything else tracks upstream via `./scripts/sync-mini.sh`.
- **Frontend wiring deferred.** No Radix npm install, no CSS import wiring, no `@mini/*` TS path alias. That's Phase 8 work per roadmap. Today's work is design data, not build plumbing.
- **Accent rebinding enforced in code, not left as policy.** Originally considered documenting "monochrome" in the design language but leaving indigo/crimson imports in tokens.css "for Phase 8." Rejected — leaves a latent contradiction between language and tokens. Rebound `--accent-*` to `--gray-*` in the fork-and-own `tokens.css` directly.
- **Gray flavor swap via alias, not rename.** Imports changed from `gray.css` to `mauve.css`; `--gray-N: var(--mauve-N)` alias added so downstream Mini CSS (axioms.css, primitives.css) keeps referencing `--gray-N` unchanged. This is Mini's sanctioned swap pattern.

**Tradeoffs discussed:**
- **Invoke `/elicit-design-language` via the Skill tool vs. run the procedure manually.** Chose manual — the task required cross-referencing specific inferred axioms from the draft before asking cold, which the skill's stock interview doesn't do. Downside: no skill-tool telemetry firing. Compensated by adding a real `pattern-log.md` entry capturing the elicitation rationale — Mini's canonical log for this.
- **Update tokens.css now vs. defer to Phase 8.** Deferred fonts + radii initially; user review pushed toward "enforce the design language in code now rather than document aspirationally." Agreed — drift between language and tokens is the failure mode Mini is designed to prevent.
- **Chromatic accent candidates explored and rejected:** purple (Linear overlap), terracotta (Claude-brand overlap), pure red (too intense), indigo (Mini default — chose not to inherit).

**Lessons learned:**
- Mini's `install.sh` had a `-d "$DEST/.git"` check that fails in git worktrees (where `.git` is a file). Worked around with a sed-patched temp copy; the upstream fix had already landed in Mini's main branch (commit `83df0b2`) but wasn't pinned yet. Syncing bumped the pin.
- The draft's principles survived elicitation with surprisingly few amendments — two principles adjusted (motion, theme), two added to the Review Checklist (semantic-color policing, monochrome policing). Evidence that the product-level thinking was right; only the defaults needed to be made concrete.
- `elicit-design-language` skill's interview script works well for cold elicitation. For an already-primed draft, it's better to state inferences upfront and ask the user to confirm/refine — saves one round trip per axiom and produces better answers because the user is reacting to a concrete proposal.

---

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

### Initial build — backend + frontend foundation + design lab + polish scaffolding
**Date:** 2026-04-21
**Branch:** preliminary-build
**Commit:** pending

**What was done:**
Executed Phases 0–11 of `core-docs/roadmap.md` as a single preliminary build. Produced:

- **Rust workspace** (`Cargo.toml` + 9 crates): `designer-core`, `designer-claude`, `designer-git`, `designer-local-models`, `designer-audit`, `designer-safety`, `designer-sync`, `designer-ipc`, `designer-cli`. Tauri shell lives at `apps/desktop/src-tauri/` (library + thin `main`; real Tauri runtime wiring is a binary-edge concern documented in `apps/desktop/PACKAGING.md`).
- **Event-sourced core** (`designer-core`): typed IDs (UUIDv7), `StreamId` enum, `EventEnvelope` + 25 `EventPayload` variants, `EventStore` trait with `SqliteEventStore` impl (WAL mode, r2d2 pool, optimistic concurrency, broadcast subscription), `Projector` projection producing live `Project` + `Workspace` aggregates, manual migration ledger.
- **Orchestrator abstraction** (`designer-claude`): `Orchestrator` trait + `OrchestratorEvent` wire shape; `MockOrchestrator` for tests/demo; `ClaudeCodeOrchestrator` that shells out to `claude` with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; file watcher for `~/.claude/teams/` and `~/.claude/tasks/`.
- **Safety infrastructure** (`designer-safety`): `ApprovalGate` (request/grant/deny → events), `CostTracker` with configurable `CostCap` and read-before-write enforcement, `ScopeGuard` with allow/deny glob rules + deny-overrides-allow, `CspBuilder::strict()` matching the iframe sandbox attributes in the frontend.
- **Audit log** (`designer-audit`): append-only writer + category filter over the same SQLite store (one source of truth).
- **Git ops** (`designer-git`): `GitOps` trait with real `git`/`gh` subprocess impl, worktree create/remove, branch lifecycle, commit, diff numstat, PR create via `gh`, plus a `recent_overlap()` primitive for cross-workspace conflict detection.
- **Local-model ops** (`designer-local-models`): `FoundationHelper` trait, `SwiftFoundationHelper` with 4-byte-length-framed JSON-over-stdio, `NullHelper` fallback, typed jobs (`context_optimize`, `recap`, `audit_claim`, `summarize_row`) with response cache (SHA-256 keyed, TTL) and token-bucket rate limiter. Swift helper source (`helpers/foundation/Sources/main.swift`) wraps Apple Foundation Models behind a `#if canImport(FoundationModels)` gate.
- **Sync protocol** (`designer-sync`): versioned `SyncFormat`, `NodeId` + `VectorClock` causality, `SyncSession` state machine, `OfflineQueue`, `PairingMaterial` with deterministic 6-digit code derivation.
- **IPC types** (`designer-ipc`): shared Rust ↔ TS shape for Tauri commands.
- **CLI** (`designer-cli` → `designer` binary): Phase-2 verification surface — creates a project + workspace, spawns a mock team, assigns a task, prints the full event timeline.
- **React app** (`packages/app` as `@designer/app`): Vite + TS, Mini CSS imported, three-pane layout (project strip, workspace sidebar, main view, activity spine), Cmd+K quick switcher, four tab templates (Plan/Design/Build/Blank), Home tab with six Notion-style blocks, ambient activity spine with state-pulse + recent events, streaming chat UI (character-by-character, reduced-motion aware), sandboxed prototype preview with strict meta-CSP + iframe sandbox + live variant explorer + pin-drop annotation layer, component catalog rendering Mini tokens live, onboarding slab. Deterministic `MockIpcClient` lets the app run fully in a browser with no Tauri.
- **Tests** (19 Rust, 5 frontend): event store round-trip, optimistic concurrency, projector replay, live subscription; mock orchestrator emits team/task events; approval gate state transitions; cost cap enforcement; scope allow/deny; strict CSP builder; vector-clock concurrency detection; handshake version mismatch; pairing-code determinism; git commit + diff round-trip (runs only when git binary is present); foundation helper null fallback + audit parsing; mock core seeds + event delivery; React app boots into seeded state.
- **Polish scaffolding**: `Updater` trait + `NoopUpdater`, `CrashReport` + `install_panic_hook` (opt-in, local-first, never uploads without consent), `PACKAGING.md` signing/notarizing runbook.
- **Invariants**: 6/6 Mini invariants pass on `packages/app/src` after routing all borders, breakpoints, and durations through tokens, and converting the sandboxed prototype CSS to use CSS system colors (`Canvas`/`CanvasText`/`GrayText`) so agent-authored previews follow the host's light/dark scheme without hex literals.

**Why:**
The roadmap sequenced 12 phases over ~16 weeks. A preliminary end-to-end pass validates every seam between subsystems and lets later phases focus on substance rather than scaffolding. Doing all of it in one pass also surfaces cross-phase concerns early — the event store's schema shape is the biggest one, and it settled on the first attempt.

**Design decisions:**
- **`AppCore` is a plain-Rust library, Tauri is the edge.** The shell binary will register IPC commands that delegate to `AppCore` methods. All behavior is exercisable from the CLI + tests without a WebView. This kept the whole backend building + testing on CI-class environments without WebKit.
- **One SQLite table, not five.** Approvals, costs, scope denials, and audit entries are all events in the same `events` table. Projections derive per-concern aggregates. Two wins: single source of truth for replay/sync, and projections can evolve without schema migrations.
- **Strict CSP + iframe sandbox for prototype preview, system colors for agent content.** The agent produces any HTML it wants; the sandbox denies all script, connect, frame, worker, and object origins. The fixture CSS uses `Canvas`/`CanvasText`/`GrayText` so the sandboxed content honors the host theme without needing to know Designer's token set — matching design-language axiom §Theme (system-default, both modes first-class).
- **Mock-first orchestrator + IPC.** Demo data is an opinionated 2-project / 2-workspace seed so empty-state design wasn't the first thing a reviewer sees. Empty states remain load-bearing (design-language patterns §3) but the mock serves the demo + contract tests.
- **Monochrome + Mini semantic scales for all signal.** State dots use `--color-foreground` (active, animates) → `--gray-8` (idle) → `--warning-9` (blocked) → `--info-9` (needs-you) → `--danger-9` (errored). Each is derived from Mini tokens; no chromatic-accent dependency despite the signal-rich UI.

**Technical decisions:**
- **`rusqlite` + `r2d2` over `sqlx`.** `sqlx` macros need compile-time DB prep; we'd have to ship a `.sqlx/` directory or set `SQLX_OFFLINE` gymnastics. Plain `rusqlite` inside `spawn_blocking` is faster to iterate and keeps the build hermetic. The async story works out because SQLite is single-writer anyway.
- **UUIDv7 for all IDs.** Monotonic-by-creation so `ORDER BY id` matches `ORDER BY timestamp` within a host — useful for event-stream scans — and cross-host uniqueness is still guaranteed.
- **Optimistic concurrency via `expected_sequence`.** Prevents lost writes when two callers try to append to the same stream. Tests assert this path explicitly.
- **`globset` for scope rules.** Git-style glob matches, same mental model the user already has for `.gitignore`.
- **JSON-over-stdio with 4-byte BE length framing for the Swift helper.** Protocol is Rust-typed on both sides; versioned response shapes. A future move to XPC (macOS-native) can replace the transport without touching the domain.
- **Stable empty values for `useSyncExternalStore`.** Selector functions that returned fresh `[]` or `{}` literals caused infinite render loops; a shared `emptyArray()` from `util/empty.ts` fixed it. Documented in code.
- **CSS custom properties + fork-and-own `tokens.css` for Designer-specific tokens.** Added `--border-thin`, `--border-strong`, `--breakpoint-*`, `--motion-pulse`, `--motion-blink`. These don't belong in Mini's core contract but they belong somewhere — fork-and-own is the sanctioned extension point.
- **`em`-based media queries** (CSS limitation: custom properties can't appear inside `@media` conditions). Kept in sync with `--breakpoint-*` by comment convention.

**Tradeoffs discussed:**
- **Actually spawning Claude Code in tests vs. mocking.** We didn't have the user's Claude auth or the right SDK version, and shipping tests that call external binaries flakes CI. `MockOrchestrator` implements the full `Orchestrator` contract; `ClaudeCodeOrchestrator` is ready for the Phase 0 spike to validate against. Phase 0's deliverable was "findings"; this preliminary build folds Phase 0's design artifacts (trait shape, watcher classifier) into Phases 1–2.
- **Full Tauri runtime vs. library-first core.** Wiring the Tauri runtime inline would've made the demo a single binary, but also pulled WebKit + macOS SDK requirements into every build. The library-first approach compiles + tests anywhere; the shell binary is a thin `tauri::Builder` addition at the edge.
- **Rich demo seed data vs. pure empty state.** The mock seeds two projects and two workspaces so the first thing a reviewer sees is texture, not a blank canvas. This is the right default for a design-tool demo; the empty-state pattern (design-language §Patterns) still applies when there's truly nothing.
- **Custom store vs. Zustand.** A 40-line `createStore` + `useSyncExternalStore` covers everything Designer needs; Zustand would add an npm dep for the same surface area.

**Lessons learned:**
- **SQLite PRAGMAs can't run inside a transaction.** First pass put `PRAGMA journal_mode = WAL;` in the migration SQL; tests failed with "Safety level may not be changed inside a transaction." Moved PRAGMAs to the connection initializer (`with_init` on `SqliteConnectionManager`).
- **`useSyncExternalStore` is aggressive about snapshot equality.** Any selector returning a fresh `[]`/`{}` on a cold state loops infinitely. Stable empty constants are the fix; writing that down in `util/empty.ts` with a comment prevents re-discovery.
- **CSS custom properties don't expand inside `@media` conditions.** Had to revert to `em`-based media queries; these are also accessibility-friendly so the regression became a small improvement.
- **Invariant scanner flagged agent-sandbox hex colors.** The sandboxed prototype preview is *agent-authored content*, not Designer's UI; enforcing Mini tokens on it would be wrong. Swapped to CSS system colors (`Canvas`, `CanvasText`, `GrayText`) — themed-aware, scanner-clean, and keeps the agent's HTML decoupled from Designer's token set.
- **Demo CLI end-to-end check is worth the weight.** Catching one real scenario — create project, create workspace, spawn team, assign task, replay log — exercises every crate together and surfaced the PRAGMA issue immediately.

**Next:**
- Wire the Tauri shell binary (register commands from `designer-desktop::ipc` as `#[tauri::command]`, hook the updater/crash modules).
- Run the Phase 0 spike against a real Claude Code install to validate the agent-teams file shapes; update `watcher::classify` and the `ClaudeCodeOrchestrator` arg list if the observed reality differs.
- Verify the Swift helper builds on an Apple Intelligence-capable Mac; tune the `FoundationModels` API call to match the shipping SDK.
- Performance pass: measure cold start + idle memory + streaming load on a real build; currently unmeasured because no Tauri runtime is linked.

---

### Multi-role review pass on the preliminary build
**Date:** 2026-04-21
**Branch:** preliminary-build
**Commit:** pending

**What was done:**
Three-perspective review (staff engineer, staff designer, staff design engineer) of the Phases 0–11 preliminary build. Produced a prioritized punch list and implemented it. Summary of changes:

- **Correctness.** Fixed a SQLite "database is locked" race on first open: WAL journal_mode is a database-level setting, so flipping it inside `SqliteConnectionManager::with_init` caused pool-concurrent connections to fight over it. Now we flip WAL + synchronous on a one-shot bootstrap connection in `SqliteEventStore::open` before the pool is built. `with_init` only sets `foreign_keys=ON`.
- **Performance.** `AppCore::create_project` / `create_workspace` stopped doing an O(N) log replay after every append; they now `projector.apply(&env)` the returned envelope directly. Kept `sync_projector_from_log` for external-writer repair paths.
- **Clippy hygiene.** Removed dead `Tracker` trait, dead `GlobSetExt` helper; derived `Default` on `ClaudeCodeOptions` + `NodeId`; `or_insert_with(Vec::new)` → `or_default`; `&self.secret` → `self.secret` (Copy); deleted `#[allow]`-shielded unused-import. Exposed `SANDBOX_ATTRIBUTE` through `designer-safety::lib` so it's live surface, not dead code. `cargo clippy --workspace --all-targets` now clean.
- **Accessibility.** Added a skip-to-content link (WCAG 2.4.1). Fixed the h1/h2/h3 hierarchy — topbar `h1` = workspace name, tab body `h2` = tab title, card `h3` = block title (was two `h1`s per page). `role=tab` ↔ `role=tabpanel` now linked via `aria-controls` + `aria-labelledby`; roving `tabIndex` + Arrow-key navigation across tabs. Focus trap on the Cmd+K dialog (Tab/Shift-Tab cycle within the dialog).
- **UX craft.** Humanized event-kind strings in the activity spine + Home's needs-you card (`project_created` → "Project created", `agent_spawned` → "Agent joined", etc.) via a new `humanizeKind` util. Added a "+ Project" affordance on the project strip. Chat bubble alignment moved from inline style to a CSS `data-author` selector — the flex container needed `align-items: stretch` for `align-self` to activate.
- **Mini procedural docs.** Updated `generation-log.md` with two entries (Phase 8–10 build + this review pass); populated `component-manifest.json` with 17 managed components; added six new `pattern-log.md` entries (project-token extensions, color-role aliases in app.css vs. tokens.css, CSS system colors for sandboxed agent content, Mini-primitive deferral decision, SQLite WAL boot-once reasoning, em-based breakpoints).
- **Tests.** Added 6 frontend tests: `humanizeKind` mapping (known + fallback), tab-panel ↔ tab ARIA linkage, skip-link presence, onboarding dismissal persistence. Helper `boot()` tolerates already-dismissed onboarding via `localStorage.clear()` in `beforeEach`. Now 11 frontend tests + 19 Rust tests; all pass.

**Why:**
The preliminary build landed with breadth; this pass chased depth. A bug-prone startup race, an O(N) hot path on every write, and a11y gaps that a manager-cockpit audience would feel were the concrete risks. The Mini procedural docs were out of sync — `generation-log.md` still had its example-only state — which would have caused `propagate-language-update` and `check-component-reuse` skills to miss the entire Phase 8–10 output on their next run.

**Design decisions:**
- **Humanize event kinds client-side.** The events table keeps `snake_case` identifiers (stable across frontends and sync peers); the mapping lives in TS so we can tune the phrasing per surface without schema changes.
- **h2 for tab bodies, h3 for cards.** Tab bodies conceptually nest under the workspace (`h1` in topbar). Cards nest under the tab. One heading outline per page; screen-reader nav is now coherent.
- **Skip-link pattern.** Standard WCAG pattern: visually hidden until `:focus`, then animates into the top-left with a visible focus ring. Only triggered by keyboard — mouse users never see it.
- **Focus trap in Cmd+K dialog.** Tab/Shift-Tab cycle within the dialog. Escape closes. Mouse-backdrop closes. No programmatic focus-hijack on route changes; focus returns naturally when the dialog unmounts.

**Technical decisions:**
- **WAL bootstrap connection.** The alternative was a mutex around pool-construction or a single-writer pool (`max_size=1`); both are coarser than the one-shot init connection.
- **Apply-on-append projector.** Keeps the projector strictly in sync with the store without double-scan. The broadcast subscription still exists for consumers that didn't drive the write themselves (CLI, future sync peers).
- **Humanize map in a plain object.** `Record<string, string>` is trivially tree-shakable + testable; no i18n framework commitment yet. When i18n lands, the map becomes its resource file.
- **`data-author` attribute on chat bubbles.** Keeps styling in CSS; component stays behavior-focused. Also cleaner for screenshot tests later.

**Tradeoffs discussed:**
- **Mini primitives now vs. later.** Considered converting AppShell/HomeTab/ActivitySpine to `Stack`/`Cluster`/`Box` this pass. Deferred to Phase 12b — the current inline-flex patterns are tight and swapping introduces renaming noise across many files. If the drift grows with more surfaces, we do it then.
- **Real Claude Code integration test.** Considered running against a real install. Skipped because the test environment lacks Claude auth; a `CLAUDE_CODE_INSTALLED=1`-gated test is the right pattern and is queued in Phase 12a.
- **Event ID correlation.** Would let the activity spine show "approval denied because cost cap hit" as a chain. Adds schema churn now; scheduled for 12b when the spine gets richer drilldown.

**Lessons learned:**
- **`useSyncExternalStore` ergonomics.** Second time a "fresh literal → infinite render" bug surfaced here (first was empty arrays; this time tests held state across runs). The fix pattern — `beforeEach(() => localStorage.clear())` + tolerant `boot()` — is worth codifying if we add more tests that depend on app boot state.
- **SQLite PRAGMAs aren't per-connection.** First pass put `journal_mode=WAL` in `with_init`; second pass learned that WAL is a database-level mode, stored persistently in the file header. One bootstrap flip is correct; per-connection PRAGMAs are only for session-scoped settings like `foreign_keys`.
- **Clippy as a reviewer.** Caught three dead-code trails (a trait, a helper trait-extension, a constant) that had snuck in during rapid scaffolding. Worth running `cargo clippy --workspace --all-targets` in CI.

---

<!-- Add new entries above this line, newest first. -->
