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

### Phase 13.E — Track primitive + git wire
**Date:** 2026-04-25
**Branch:** track-primitive-git-wire
**Commit:** TBD

**What was done:**

*Domain.* `crates/designer-core/src/domain.rs` gained the `Track` aggregate (`id`, `workspace_id`, `branch`, `worktree_path`, `state`, `pr_number?`, `pr_url?`, `created_at`, `completed_at?`, `archived_at?`) and the `TrackState` enum (`Active → RequestingMerge → PrOpen → Merged → Archived`). Projection extended with `tracks: BTreeMap<TrackId, Track>` + `tracks_by_workspace: BTreeMap<WorkspaceId, Vec<TrackId>>`, projecting `TrackStarted / PullRequestOpened / TrackCompleted / TrackArchived` (event vocabulary frozen by 13.0; this PR adds the emitters and projection only).

*GitOps.* `designer-git` got `validate_repo`, `init_worktree` (already present, used now), `commit_seed_docs` (skips no-op staged trees so re-seeds are clean), and `current_status` (committed + uncommitted diff vs base). `open_pr` switched to `gh pr create` followed by `gh pr view --json` so we get structured PR fields without parsing free-form output.

*AppCore.* `core_git.rs` filled in. Five new methods: `link_repo`, `start_track`, `request_merge`, `list_tracks`, `get_track`, plus `check_track_status` for the edit-batch coalescer. `RealGitOps` is a process-singleton via `OnceLock`; tests override with `set_git_ops_for_tests`. Tests are serialized via a tokio mutex so the global-override pattern stays sound under parallel execution.

*Edit-batch coalescing.* Explicit, on `check_track_status`. We diff the worktree against base, hash a stable signature (file count, +/- totals, sorted paths), compare against the per-track baseline, and emit one `ArtifactCreated { kind: "code-change", … }` only when the signature changes. Repeated checks with no diff produce no artifact. A 60-second timer was rejected because (a) wall-clock heuristics are flaky on suspended laptops and in tests, (b) timers create phantom artifacts when nothing changed, and (c) explicit-on-check matches the user mental model of "snapshot a moment of work."

*IPC.* New DTOs in `designer-ipc`: `LinkRepoRequest`, `StartTrackRequest`, `RequestMergeRequest`, `TrackSummary`. New IPC handlers in `apps/desktop/src-tauri/src/ipc.rs` and Tauri commands in `commands_git.rs`: `cmd_link_repo`, `cmd_start_track`, `cmd_request_merge`, `cmd_list_tracks`, `cmd_get_track`. All five registered in `main.rs`'s `tauri::generate_handler![…]` (kept alphabetical).

*Frontend.* New `RepoLinkModal` in `packages/app/src/components/`. Wired into `Onboarding` as the final-slide CTA (becomes "Link a repository" when a workspace exists) and into Settings → Account (replaces the static "GitHub: not connected" placeholder with a live, action-attached row). New `RequestMergeButton` in the workspace sidebar header — surfaces only when the active workspace has a mergeable track, runs `cmd_request_merge` on the most recent eligible track. IPC client/types/mock wired in `packages/app/src/ipc/{client,types,mock}.ts`. No new CSS tokens introduced; reuses `app-dialog*`, `btn`, `state-dot`, etc.

*Tests.* Five backend tests in `core_git.rs`: track lifecycle round-trip (Started → PRopened → Completed → Archived), PR-open emitting a `pr` artifact, edit-batch coalescer (two distinct diffs → two artifacts; repeat → none), `link_repo` rejecting non-repo paths, `start_track` requiring a linked repo. Two designer-core integration tests: full track replay through the projector. Three vitest tests covering `RepoLinkModal` (happy path, invalid-path error, empty-input disabled state).

**Why:**

13.E unblocks the workspace-as-feature model in spec Decisions 29–30. Until this lands, "request merge" is a UI-only fiction: there's no Rust state to drive the chrome and no `gh pr create` plumbing. With the Track aggregate + emitters in place, every other 13.X track can hang work off a real, replayable lifecycle (track started → code change → PR open → merged → archived) instead of inventing a parallel surface.

**Design decisions:**

- **Repo-link surfaces.** Two surfaces: onboarding's final slide for first-run, Settings → Account for re-link. Onboarding-only would force users to dismiss → re-open the modal to re-link; Settings-only would bury the first-run path. Two surfaces, one component (`RepoLinkModal`) — same code, different triggers.
- **Request Merge placement.** Lightest-touch option chosen: an icon button in the sidebar header next to the workspace name, surfacing only when a mergeable track exists. The track-rollup block-action surface was the alternative but would have required 13.E to dictate block UX, which ADR 0003 explicitly forbids. The header icon costs one `IconButton` and stays out of the thread.
- **Repo path stored on workspace.** We re-purposed the existing `WorkspaceWorktreeAttached { workspace_id, path }` event to mean "this workspace is linked to repo at `path`." Track-level worktrees live on `Track.worktree_path`. Adding a new event variant was off the table per ADR 0003; this re-use is semantically close (the workspace's worktree IS the source repo from the track's perspective) and preserves replay compatibility.
- **No new design tokens.** The repo-link modal reuses `app-dialog*`, `btn`, `quick-switcher__input`. The request-merge button reuses `IconButton`. All inline styles reference existing tokens (`var(--space-N)`, `var(--color-*)`, etc.) — no arbitrary px / hex / ms.

**Technical decisions:**

- **Track-id-derived worktree paths.** `<repo>/.designer/worktrees/<track-id>-<slug>`. Including the UUID guarantees no two concurrent `start_track` calls collide on a directory even when the slug matches. The slug is decorative — humans recognize it in `git worktree list` output, but uniqueness rides on the track id.
- **Process-singleton GitOps.** `RealGitOps` is stateless; one instance is fine. A `OnceLock` lazily initializes it. Tests override via a separate `OnceLock<Mutex<Option<Arc<dyn GitOps>>>>` and a tokio-Mutex serializes parallel test runs. We did not push `Arc<dyn GitOps>` into `AppCore` because that would have required modifying `core.rs`, which ADR 0002 + the parallel-track conventions explicitly disallow during 13.D/E/F/G.
- **`gh pr create` parsing.** The `--json` flag is rejected by `gh pr create`; we run `pr create` then `pr view --json` to get structured fields. One extra subprocess on the merge-request path — fine, the user is already waiting for GitHub.
- **Edit-batch coalescer signature.** File count + total +/- + sorted paths joined by commas. Distinguishes "edited foo.rs" from "added foo.rs" only via +/- totals, which is correct: both are legitimate semantic batches. The signature is deliberately not a content hash — diffs evolve continuously and we want the coalescer to fire on each meaningful step, not on every keystroke.

**Tradeoffs discussed:**

- *60-second timer vs. explicit check.* Timer is "set it and forget it" but produces phantom artifacts and depends on wall-clock fidelity. Explicit check ("agent finished tool call → call cmd_status_check") is what 13.D will wire and matches how a thinking user models a code-change moment. Picked explicit; 13.D can layer a debounced auto-check on top if the explicit pattern feels too manual.
- *Track owns repo path vs. project owns it.* Project already has `root_path` from `ProjectCreated`. Promoting "repo linked" to project level would mean every workspace in a project shares a repo, which is the common case but doesn't compose with the future spec Decision 32 ("Forking reserved") where forks may diverge. Workspace-level link keeps the option open without changing event shapes today.

**Lessons learned:**

- The serial-test pattern (tokio mutex around shared global state) keeps the test-only override layer simple. Worth keeping in mind the next time a track is tempted to thread an injectable through `AppCore` just to test it.

---

### Phase 13.1 — unified workspace thread + artifact foundation
**Date:** 2026-04-24/25
**Branch:** consolidate-tab-server
**Commit:** dc356f1..HEAD (consolidates tab-model-rethink + find-agentation-server + 13.1 build-out)

**What was done:**

*Architectural cutover (the big rock).* Plan / Design / Build / Blank tab types are retired. Every tab in a workspace renders one component — `WorkspaceThread` — which displays a continuous scrollable thread of typed artifact blocks with a docked compose surface. The four legacy tab files (`PlanTab.tsx`, `DesignTab.tsx`, `BuildTab.tsx`, `BlankTab.tsx`) and `HomeTabB.tsx` were deleted. `TemplateMenu` and the template picker are gone — `+` opens a fresh thread.

*Backend artifact foundation.* `crates/designer-core` gained `Artifact`, `ArtifactKind` (12 kinds — message / spec / code-change / pr / approval / report / prototype / comment / task-list / diagram / variant / track-rollup), `PayloadRef` (Inline body / Hash + size schema-only until 13.1-storage), and five new events: `ArtifactCreated / Updated / Pinned / Unpinned / Archived`. `ProjectorState` gained `artifacts: BTreeMap<ArtifactId, Artifact>` and `pinned_artifacts: BTreeMap<WorkspaceId, Vec<ArtifactId>>` with incremental update on every artifact event. Round-trip test covers the full lifecycle; PayloadRef serialization round-trip locks the schema.

*IPC.* Four new commands: `cmd_list_artifacts`, `cmd_list_pinned_artifacts`, `cmd_get_artifact`, `cmd_toggle_pin_artifact`. Plus a macOS `reveal_in_finder` shim so the workspace-sidebar root-path button actually opens Finder. `OpenTabRequest.template` defaults to `Thread` (legacy variants still parse for replay).

*Frontend block registry.* `packages/app/src/blocks/registry.ts` exposes `registerBlockRenderer(kind, Component) / getBlockRenderer(kind)`. Twelve renderers in `blocks.tsx` — seven render real data today (Message, Spec, CodeChange, Pr, Approval, Comment, TaskList), five are registered stubs (Report, Prototype, Diagram, Variant, TrackRollup) so 13.D/E/F/G can wire emitters without touching UI code. `GenericBlock` is the unknown-kind fallback. All visual decisions route through tokens (no inline styles).

*Surface architecture.* Six dev-only sliders in `SurfaceDevPanel` (⌘.) plus a tab-radius variant toggle decompose the surface register into independent knobs:
- Compose fill (compose ↔ parent), Main tab fill (white ↔ sandy), Surface sand (parent brightness)
- Tab opacity, Border intensity, Shadow intensity (two-layer diffuse, modern, not bottom-heavy)
- Tab corner variants: Soft 12 / Concentric 18 / Folder 14-6 / Match 24 / Custom
- Main tab radius slider (0-40px), Compose radius slider (0-32px) — independent of each other and the tab radius

*UX polish (memphis-v2 17-item Agentation feedback pass).* SettingsPage replaces the modal (Help stays modal). Palette gets a leading search icon. PaneResizer haptic snap (`navigator.vibrate(8)`). Reveal-in-Finder on the workspace path. Icon size audit (12→16). Activity spine rewritten: workspace-scoped, sections for Pinned / Artifacts / Code files / Agents / Recent events; pinned/files items use the same edge-to-edge hover treatment as the left sidebar.

*Sidebar restructure.* Horizontal padding moved off `.app-sidebar` and `.app-spine` onto inner blocks (header, group head, rows, sections, lists) so workspace-row and spine-artifact hovers fill the full rail edge-to-edge. Status icons line up with the "Workspaces" section label and Home above. Same pattern in the activity spine.

*Concentric corners.* `--radius-surface` 16 → 24px. Compose corner derives to 8px. Tab corners default to 24 (Match) so the active tab and main surface read as the same material.

*Dark palette rebuild.* Previous dark mode collapsed all surfaces near `sand-dark-1` because `var(--sand-dark-N)` doesn't exist — Radix Colors v3 only ships `--sand-N` and rebinds it under `.dark-theme`. Dark override now references `--sand-N` correctly, with reanchored slider math so the same default values produce real luminance separation: parent `≈sand-3.4` (warm dark page), main tab `≈sand-5.2` (~1.8 steps lifted figure). Foreground `--sand-12` (near-white), border-soft promoted to `--sand-a7`.

*Documentation.* Spec Decisions 36–39 (workspace thread, three-tier artifact presence, block-renderer registry as track contract, write-time semantic summaries). Decision 11 amended to "tabs as views, not modes"; Decision 12 superseded. FB-0024 (tabs as views), FB-0025 (three-tier artifact presence). Phase 13.1 inserted between 13.0 and 13.D-G in the roadmap.

**Why:**

The previous tab model forced users to pick a mode (Plan / Design / Build) before they could work — a cognitive tax with no payoff. The original spec already imagined "templates, not types" (Decision 12) but the implementation kept the mode distinction in the rendering layer. Two parallel branches (tab-model-rethink, find-agentation-server) had each started addressing the gap from different angles. Consolidating them avoided duplicated effort and merge conflict pain, and forced the design to converge before 13.D/E/F/G fan out.

The artifact foundation is the contract that lets those four tracks ship in parallel: each emits typed `ArtifactCreated` events into a registry that already knows how to render them. No track touches UI code. No track touches another track's events. Same scope, no contention.

**Design decisions:**

- **Tabs are views, not modes (Decision 36).** A tab is a lens onto the workspace's shared artifact pool. Multiple tabs = multiple lenses (side thread, agent lens, split). New tabs default to the suggestion view sourced from current activity; first send flips to thread.
- **Three-tier artifact presence (Decision 37).** Inline (where produced) → Pinned (rail) → On-demand (search/timeline). Maps directly to the four-tier attention model. The rail surfaces pinned items above agent activity so pins are the working-context shelf.
- **Block-renderer registry is the contract tracks emit against (Decision 38).** Tracks never paint UI; they emit `ArtifactCreated { kind, payload }`. Adding a new kind is one PR with the renderer + the emitter side-by-side.
- **Semantic summaries written once at write time (Decision 39).** No re-summarization on read. Per-track debounce coalesces edit bursts. Ships empty until 13.F wires the local-model helper.

**Technical decisions:**

- **Promote sketch ideas, delete the sketch.** `tab-model-rethink` shipped a 1,931-line URL-hash-gated demo (`packages/app/src/sketch/WorkspaceThreadSketch.tsx`). Block renderers and the unified thread surface were lifted into production modules and rewritten to use Mini tokens. The sketch file was not committed.
- **Preserve replay compatibility.** `TabTemplate` enum keeps `Plan / Design / Build / Blank` variants alongside `Thread` so old `TabOpened` events replay. Frontend renders all of them as `WorkspaceThread`; legacy titles normalize to "Tab N" on display.
- **Dev panel slider math is mode-aware.** Same slider semantics in light and dark, but the dark anchors span `sand-dark-1↔4` (parent) and `sand-dark-5↔9` (main tab) so the same default percentages produce hierarchy in both modes.
- **PayloadRef::Hash schema-only.** The `Hash` variant exists in the enum and serializes correctly, but the content-addressed store under `~/.designer/artifacts/<hash>` is not implemented. Producers should only emit `Inline` until 13.1-storage lands. Consumers tolerate `Hash` (the renderer fetches via `cmd_get_artifact` regardless).
- **Coalesce stream-event refresh.** `WorkspaceThread` and `ActivitySpine` both subscribe to `artifact_*` events but coalesce bursts onto a single `requestAnimationFrame` so a flurry from one track produces one refresh, not N.

**Tradeoffs discussed:**

- **Single PR vs. four-PR split.** Single PR was the right call — D/E/F/G can't run in parallel until 13.1 is in place, and splitting 13.1 into "events" + "registry" + "tab unification" + "spine" wouldn't have helped because each piece is unusable without the others.
- **Drop legacy tab files vs. keep as adapters.** Dropped. Pre-launch dev, no production replay liability. Each retired entry is preserved in the component manifest with `status: "retired"`.
- **Sketch as code vs. sketch as docs.** Considered shipping the sketch behind `#sketch` for review. Rejected — once the production thread is in, the sketch is just a worse copy. Reference the git blob in the plan if anyone wants to look back.

**Lessons learned:**

- **Radix Colors v3 only exports the base scale name; `.dark` rebinds those names.** There is no `--sand-dark-N`. The first dark-mode pass referenced `--sand-dark-1` etc. and silently failed (text fell through to browser defaults). The fix was a one-line search-and-replace, but the audit for invalid token references should be a project-level invariant.
- **Per-component re-render hotspots emerge fast under live event streams.** `WorkspaceThread.fetchPayload` originally depended on the `payloads` map; every payload load re-created the callback identity, cascaded through `onToggleExpanded`, and re-rendered every block. Functional `setState` reads make these effects safe; treat any `useCallback([state, ...])` over fast-changing state as a smell.
- **Component manifests are load-bearing.** The manifest had been invalid JSON for at least one prior commit (duplicate fields collided in a copy-paste). Nothing flagged it because nothing read the file. Adding `node -e "JSON.parse(...)"` to the invariants would have caught it instantly.

---

### UI overhaul — floating-surface register, dark mode, Lucide icons
**Date:** 2026-04-23
**Branch:** review-frontend-mini
**Commit:** pending

**What was done:**
Multi-session UI overhaul replacing the flat three-pane layout with a two-tier page + floating-surface register, landing a proper dark mode, adopting `lucide-react`, and rebuilding BuildTab around a chat/terminal interaction. User-facing deliverables:

- **Floating main surface.** Workspace sidebar + activity spine now sit directly on the sand page (no fill, no borders). The main content panel is a raised rounded rectangle — pure white in light, sand-dark-1 (off-black) in dark — with a soft hairline border and a subtle shadow. Tabs sit above the surface with a 6 px gap; the active tab is a bordered pill in `--color-content-surface` so it reads as "the same material" as the surface below without merging.
- **Dark mode actually works.** Previous theme bootstrap applied `[data-theme]` only; Radix Colors v3 activates its scales via `.dark-theme` class. A user in system-dark saw the light-mode scales regardless. Rewrote `theme/index.ts` to apply both signals (plus `colorScheme` on documentElement), added a `prefers-color-scheme` listener when in System mode, and wired a System / Light / Dark `SegmentedToggle` into Settings → Appearance. The index.html zero-flash boot script applies the same three assignments synchronously so the first paint is resolved.
- **Lucide adoption.** All ~30 inline `<svg>` tags across 7 files (workspace status glyphs, tab template icons, compose controls, home suggestions, project-strip chrome) replaced with `lucide-react` imports. `components/icons.tsx` becomes thin wrappers around the canonical 7-icon set (stroke 1.25 at sm/md, 1.5 at lg per axiom #13). One-offs import from `lucide-react` directly.
- **BuildTab as chat/terminal.** Dropped the task-list + merge-approval-card layout. Build renders a mono-typed chat stream; user sends instructions or slash commands (`/plan · /diff · /test · /merge`) via the same compose dock PlanTab uses. The merge approval gate is still enforced in the Rust core (spec §5) — `/merge` just asks.
- **HomeTabA restructure.** Kicker removed. Section order re-prioritizes: Needs-your-attention jumps to top and hides entirely when empty; workspace rows compress to status icon + name + one-line summary (first open tab's title); Autonomy becomes a real interactive SegmentedToggle with optimistic local override via `setAutonomyOverride` so it doesn't ship as a false affordance before the Phase 13 IPC lands.
- **Palette bare input.** Default density flipped to `open`; input is bare text + blinking caret on the surface, no container. Notion / Linear feel.
- **Token additions.** New `--radius-surface` (24 px) in `tokens.css`; new `--color-content-surface`, `--color-border-soft`, and `--surface-{gutter, tab-gap, text-pad, inner-pad, shadow}` in app.css. Compose corner radius is derived from the surface radius minus the compose-dock pad (`calc(var(--radius-surface) - var(--surface-inner-pad))` = 8 px) so the compose sits concentric with the floating surface.
- **Retired.** `TypeDevPanel` (type tuning) and `SurfaceDevPanel` (layout tuning) both removed after the values they were tuning landed in tokens.css / app.css. The `packages/app/src/dev/` directory no longer exists. Home variant A/B toggle pruned — Panels committed.

**Why:**
The flat three-pane register (sidebars, main, spine all on the same background separated by hairlines) made every region visually equal; nothing carried "this is the work." The floating-surface register (Linear / Dia / Inflight) delegates the hierarchy to the surface itself — sidebars stop competing with the content, the selected tab reads as part of the floating object, and dark mode's symmetry flip (darker-than-page surface instead of brighter) keeps the figure-vs-ground read intact across modes. Dark mode was simply broken; fixing the Radix class activation was a prerequisite for shipping a theme picker.

**Design decisions:**
- **Two-tier register, committed in both modes.** Amended axiom #8 to codify the page + floating-surface split as load-bearing for the workspace view. Project strip stays on its own Tier-1 surface (it's navigation, not content).
- **Content surface inverts by mode, chrome stays monotonic.** Surface is brighter than page in light, darker than page in dark. Other surface tokens (`--color-surface-flat/raised/overlay`) stay "one step above background" in both modes because they're secondary containers.
- **Style A committed.** Of three tab styles prototyped behind `[data-tab-style]` (selected-only, flat inactive + floating selected, all floating), A won on coherence at the sand + white register. Kept the data-attribute selectors in CSS so the branch can return.
- **Autonomy is interactive, not display-only.** Stub onChange violated the false-affordance axiom; a project-scoped local override makes the control feel responsive now and lets the Phase 13 IPC mutation replace the setter without UI changes.
- **Dev panels are a legitimate design tool, but they retire.** The 24-hour window during which gutter / tab-gap / compose-pad / shadow / tab-style were live-tunable ended the moment the values felt right. Shipping the panel in prod is scope creep; keeping it after the decision is dead weight.

**Technical decisions:**
- **Class-based theme activation, not media-query only.** Radix Colors v3 doesn't honor `prefers-color-scheme` on its own. Our CSS overrides, the index.html inline script, and `theme/index.ts` all apply `.dark-theme` / `.light-theme` + `[data-theme]` + `colorScheme`. System mode installs a `MediaQueryList` listener so OS-appearance changes propagate live.
- **`--color-content-surface` as a first-class role, not a one-off.** The main surface, the active tab pill, and future floating-content surfaces all bind to it; they invert together.
- **Pane-resizer cursor-only.** The ::before hairline and drag-fill were visual noise; a col-resize cursor + focus-visible ring is enough. Handle moved to `calc(var(--surface-gutter) * -1)` so the grabbable zone sits at the floating-surface edge.
- **Concentric compose math via calc().** No magic numbers — inner radius is derived from outer radius minus the separating pad.
- **Shared `WorkspaceStatusIcon`.** Extracted from WorkspaceSidebar so the 7-glyph status vocabulary reads identically on the sidebar and on HomeTabA.
- **`persisted.ts` try/catch around `localStorage`.** Strict sandbox origins (file://, Safari private mode) now fall back silently instead of throwing.

**Tradeoffs discussed:**
- **Surface darker than page in dark vs. brighter.** Brighter would match Slack / Linear convention; darker matches the explicit user ask ("off-black main surface"). The inversion preserves "figure vs ground" in both modes rather than trying to keep surface polarity constant.
- **Lucide vs Phosphor.** Phosphor has more decorative weights (duotone, fill); Lucide's stroke-only register matches our axioms more cleanly. Went with Lucide.
- **Bake dev-panel values into CSS vs. keep the panel in dev forever.** Keeping the panel mounted means every dev build prompts a decision. Baking the values commits; we can re-mount the panel behind a `?dev=1` query in a future pass if another axis needs tuning.
- **Optimistic autonomy update vs. disabled until Phase 13.** Disabled is the safer "false affordances are a bug" response; optimistic gives real feedback now and converges trivially when IPC lands. Chose optimistic because the UX is materially better and the rollback path is a one-line store change.

**Lessons learned:**
- **Radix's activation model is not `prefers-color-scheme`.** This cost real time — dark mode appeared to work in light-system but silently broke on dark-system. Lesson codified as FB-0018: theme-dependent CSS must use the same activation signal as the color library driving the scales.
- **Live tuning beats staff guesswork when contentious values are on the table.** The gutter / tab-gap / compose-pad / shadow / tab-style decisions would have been five rounds of "I think 12 feels right" without the dev panel; ~24 hours of real use closed the decision.
- **Section order on a dashboard is load-bearing UX.** Moving Needs-your-attention to the top only when non-empty is a materially different surface from a static Needs-attention card that sometimes shows "All clear."

---

### Phase 12.A landed — real Claude Code integration validated + workspace/track primitive committed
**Date:** 2026-04-22
**Branch:** phase-12a-plan
**Commit:** pending

**What was done:**

1. **Real Claude Code subprocess integration, validated end-to-end.**
   - `crates/designer-claude/src/stream.rs` — stream-json event translator (Claude stream-json → `OrchestratorEvent`s + side-channel `ClaudeSignal::RateLimit` / `Cost`).
   - `crates/designer-claude/src/claude_code.rs` — full rewrite of `ClaudeCodeOrchestrator`. Native agent-teams primitive, `--teammate-mode in-process`, `--input-format`/`--output-format stream-json` on both sides (Conductor-style persistent pipe), `--permission-prompt-tool stdio`, deterministic `--session-id` per workspace, graceful shutdown with 60s timeout fallback.
   - `crates/designer-claude/src/watcher.rs` — `classify()` rewritten for real file shapes: `teams/{team}/config.json`, `teams/{team}/inboxes/{role}.json`, `tasks/{team}/{n}.json`. Returns `None` (not `Some(Unknown)`) for out-of-scope paths to avoid channel spam.

2. **Fixtures + tests.**
   - Live probe (`scripts/probe-claude.sh`): safe Phase A inventory + live Phase B team spawn. Captured real `config.json`, inbox shapes, stream-json event vocabulary including `rate_limit_event` and `system/task_*` subtypes.
   - Unit tests: 26 in `designer-claude` (stream translator, prompt builders, session-id determinism, watcher classify including UUID-dir exclusion).
   - Live integration test (`tests/claude_live.rs`, gated by `--features claude_live`) spawns a real team via the orchestrator, observes `TeamSpawned`, and shuts down cleanly. Runs in ~28s against a real Claude install.
   - Full workspace: 44 tests pass; `cargo clippy --workspace --all-targets -- -D warnings` clean.

3. **Docs.**
   - `core-docs/integration-notes.md` — source-of-truth for Claude Code 2.1.117's real surface: CLI flags, `~/.claude/` layout, config/inbox/task schemas, stream-json event types with representative shapes, rate-limit event structure, Conductor comparison, known-limitations catalog.
   - `core-docs/adr/0001-claude-runtime-primitive.md` — first ADR. Native teams primitive adopted; spike resolved (option (a) — non-tty in-process works cleanly); alternatives rejected; reversal triggers documented.
   - `.claude/agents/track-lead.md` + `.claude/agents/teammate-default.md` — committed minimum subagent definitions.
   - `.claude/prompts/workspace-lead.md` — reserved stub (per D4; wired in Phase 13.D).

4. **CI scaffolding (self-hosted runner).**
   - `.github/workflows/ci.yml` — Tier 1 hermetic tests on GitHub-hosted macOS.
   - `.github/workflows/claude-live.yml` — Tier 2 live integration on a self-hosted runner (`[self-hosted, macOS, claude]`). Uses the user's keychain OAuth; no API-key path.
   - `.github/workflows/claude-probe.yml` — Tier 3 scheduled daily probe; opens a GitHub issue on version drift from the pinned `integration-notes.md`.

5. **Spec evolution (landed in the same session before code):**
   - New primitive: **track**. A workspace owns many tracks over its lifetime; each track is one worktree + branch + agent team + PR series. Spec §"Workspace and Track" + Decisions 29–32. Phase 19 added to the roadmap for multi-track UX (originally numbered Phase 18; shifted when the security phases — 13.H, 16.S, 17.T — were folded in on 2026-04-22).
   - Workspace lead committed as a persistent Claude Code session (Decision 31); hybrid routing reserved as future token optimization.
   - Fleet-scale stance: rely on Anthropic's own `rate_limit_event` signal + opt-in usage chip; no Designer-imposed concurrency caps (Decision 34). Phase 13.G updated.
   - Self-hosted-runner CI decision codified (Decision 33).
   - Two feedback entries: FB-0016 (test infrastructure mirrors product architecture) and FB-0017 (workspace as persistent feature-level primitive). Renumbered from 13/14 after rebase because main's UI-critique commit had already taken 13/14/15.

**Why:**
Phase 12.A of the roadmap required validating three bedrock assumptions: real Claude Code subprocess works as spec'd; file shapes match what the placeholder code assumed; the `Orchestrator` trait can absorb the real primitive without downstream ripple. The initial probe found the placeholder's `claude team init/task/message` CLI was speculative — no such subcommand exists. A follow-up web check showed agent teams are a real, shipped, env-var-gated feature with a natural-language-driven interaction model. The rewrite pivoted to the real primitive; the trait survived unchanged.

In the middle of the planning, the user pushed back on the "workspace = worktree = PR" 1:1 model as limiting for a non-engineer manager-persona. That surfaced the track primitive. Committed the direction in the spec now; UI implementation staged into Phase 19 (was Phase 18 at the time; shifted when the security phases folded in).

**Design decisions:**
- Native agent-teams primitive over pivoting to per-role `claude -p` workers (ADR 0001). Keeps Claude's built-in shared task list + mailbox + hook firing; rebuilds nothing.
- Stream-json as the primary lifecycle feed; file watcher is secondary. `rate_limit_event` + `system/task_*` subtypes appear in the stream and are richer than on-disk state.
- Backend coalesce partial messages at 120ms (decision D3, deferred to 13.D implementation).
- Workspace lead ships as a full Claude Code session in v1; hybrid routing reserved.
- Track primitive decouples the manager-level "feature" from the engineer-level "branch/PR" — differentiates Designer from Conductor/Crystal/Claude Code Desktop at the abstraction level.

**Technical decisions:**
- Deterministic UUIDv5 derivation for Claude's external IDs (`task_id` strings, `role@team` agent names) using the workspace UUID as namespace. Stable across restarts, no ID-mapping store needed.
- Long-lived subprocess per workspace; stream-json on stdin and stdout; mpsc channel fronts stdin to serialize writes.
- `--permission-prompt-tool stdio` instead of `--dangerously-skip-permissions` (Conductor's pattern) — clean path for 13.G approval gates.
- `kill_on_drop(true)` + 60s graceful shutdown timeout with `start_kill()` fallback.
- Self-hosted GitHub Actions runner for live CI: uses the user's real keychain OAuth; compliance-matched to production auth path; zero CI minute cost.

**Tradeoffs discussed:**
- Pivot-to-raw-sessions vs. native-teams-primitive: native wins because we'd otherwise rebuild Claude's coordination infrastructure.
- API-key CI auth vs. self-hosted-runner CI: self-hosted wins because API-key mode tests a different code path than ships (OpenClaw-adjacent for cloud subscription proxying).
- Fleet concurrency caps vs. rely-on-Anthropic-signals: signals win; users on Conductor routinely run ~10–12 concurrent tracks and that's within intended use.
- Hard concurrency-cap defaults vs. conservative single-track default with opt-in parallelism: conservative default wins (matches Decision 19 "suggest, do not act").

**Lessons learned:**
- The placeholder code's biggest mistake was assuming a CLI subcommand tree the product doesn't have. The real surface is natural-language-driven. Should have probed before coding the stubs. Noted as a general principle: all integration modules start with a probe + `integration-notes.md` before any stub.
- The workspace/track reframe was not on the original roadmap; it emerged from user feedback mid-plan. The right thing was to commit the primitive to the data model now (event shape extensibility) and stage the UI for later rather than defer the data work too.
- `ps` gave us Conductor's actual command line by accident — useful signal that we now know Conductor uses stdio permissions. Adopted.

---

### Phase 12.B — Staff UX designer + staff engineer review pass SAFETY
**Date:** 2026-04-21
**Branch:** phase-12b-plan
**Commit:** pending

**What was done:**
Two-lens post-implementation review (staff UX designer + staff engineer) run in parallel against the freshly-landed Phase 12.B backend. Converged on a prioritized fix list, applied all P0/P1/P2 items, added 13 new tests to lock the fixes. Concretely:

**Correctness fixes (P0).**
- `HelperHealth::running` no longer lies under lock contention. Added a `parking_lot::RwLock<HelperHealth>` published in lock-step with `SupervisorState` mutations; `health()` reads lock-free and always reports truthful state even during in-flight round-trips.
- `HelperError::Timeout(Duration)` is now a distinct variant. Boot-probe deadline overruns, write deadlines, and read deadlines all map to `Timeout`, not `Unavailable`. `select_helper` discriminates `PingTimeout` vs `PingFailed` structurally instead of substring-matching "deadline" in error strings.
- Split `FallbackReason::PingFailed` into three reasons: `UnsupportedOs` (matches `Reported("macos-too-old")`), `ModelsUnavailable` (matches `Reported("foundation-models-unavailable")`), and residual `PingFailed` for genuinely unknown errors. Each now carries a `RecoveryKind` (`User` / `Reinstall` / `None`) so the UI can route retry affordances correctly.
- `stub_helper` parses requests with `serde_json` instead of substring-matching `"kind":"ping"` — a prompt containing that literal no longer misfires.
- `audit_claim` parser handles real-model responses with trailing punctuation or sentence wrapping (`"Supported."` → `Supported`, `"contradicted by evidence"` → `Contradicted`). Normalized by taking the first alphabetic word of the lowercased response.
- NullHelper vocabulary now matches the user-facing taxonomy: `ping()` returns `"unavailable"` (not `"null / disabled"`); `generate()` returns `[unavailable <job>] <prompt prefix>` (not `[offline …]`). Added explicit docstring that the `generate()` output is a **diagnostic marker**, not a summary — 13.F surfaces must branch on `kind == "fallback"` and render a skeleton instead of the returned string.

**API hygiene (P1).**
- `cmd_helper_status` returns `HelperStatusResponse` directly, not `Result<_, IpcError>` — it cannot fail, and the false `Result` forced dead error handling at callers.
- `HelperStatusResponse` gained three Rust-owned fields: `provenance_label` ("Summarized on-device" / "Local model briefly unavailable" / "On-device models unavailable"), `provenance_id` (stable kebab-case for `aria-describedby`), and `recovery` (`user` / `reinstall` / `none`). 13.F's three surfaces (spine row, Home recap, audit tile) can drive provenance off one DTO without re-implementing the string map.
- `SwiftFoundationHelper::subscribe_events()` exposes a `broadcast::Receiver<HelperEvent>` with `Ready { version, model }` / `Degraded { consecutive_failures }` / `Demoted` / `Recovered`. `AppCore::subscribe_helper_events()` forwards via a small bridge task so callers receive events without depending on the concrete helper type. 13.F can re-render provenance on transitions without polling per-artifact.
- Swift helper: `JSONEncoder().encode` wrapped in `do/catch` producing a last-resort `{"kind":"error","message":"encode-failed"}` frame; `writeFrame` returns `Bool` so main loop breaks on closed stdout instead of spinning. Foundation-Models errors use `String(describing:)` rather than `localizedDescription` (often empty on Apple SDK errors).
- `probe_helper` is now generic over `Arc<H: FoundationHelper + ?Sized>` — accepts `Arc<dyn FoundationHelper>` for symmetry with the rest of the crate.
- `HelperTuning::new()` debug-asserts non-empty backoff, ≥1 max-failures, non-zero deadline.

**Test quality (P1/P2).**
- Replaced the wall-clock sleep loop in `supervisor_demotes_after_max_failures` with a bounded polling loop; no longer races on slow CI.
- Added two deterministic event tests: `events_emit_ready_on_first_success_and_degraded_on_failure` and `events_emit_demoted_once_threshold_crossed`.
- Added seven new DTO unit tests in `ipc.rs` covering every `FallbackReason` variant (taxonomy, recovery routing, provenance label/id).
- Added two new `core.rs` unit tests for `fallback_reason_from_probe_error` and `RecoveryKind::recovery`.
- `ops.rs` gained `audit_trims_trailing_punctuation_and_sentence_wrap` to regression-test the parse fix via a fixed `FoundationHelper` impl.

**Doc moves / vocabulary refinement.**
- "Fallback summary" draft vocabulary replaced with the three-way taxonomy above. Pattern-log entry updated accordingly.
- "Supervisor fails fast" pattern-log entry moved into `integration-notes.md` §12.B (it's a code contract, not a UX pattern).
- `integration-notes.md` extended with: granular fallback-reason table with `recovery` column; explicit "NullHelper output is a marker, not a summary" guidance for 13.F; "`fallback_detail` is diagnostic-only" constraint; helper-events protocol description.
- New pattern-log entry: "Helper events fan-out via broadcast, not event-stream" — explains why helper-health transitions don't live in the persisted event log.
- PACKAGING.md no longer leaks the `NullHelper` class name into docs ("continues with on-device features disabled").

**Metrics.**
- Rust tests: 31 → **43 passing**, all green (+12 net: 2 core unit, 7 ipc unit, 2 event integration, 1 audit regression).
- Frontend tests: 11 passing (unchanged — no frontend files touched).
- Mini invariants: 6/6 passing.
- `cargo clippy --workspace --all-targets -- -D warnings` clean.
- `tsc --noEmit` clean.

**Why:**
The three-lens plan caught the right strategic calls but the first-pass implementation left real correctness bugs (health snapshot lying under load, string-matched error discrimination, trailing-punctuation parse miss) and vocabulary that didn't survive UX scrutiny ("Fallback summary" over-promises; `[offline]` contradicts our own rationale for avoiding that word). Better to catch those on the same branch than to let them bleed into 13.F's implementation.

**Design decisions:**
- **Three-way provenance taxonomy, not two.** Live → transient → terminal, keyed by recovery affordance. Lets 13.F branch cleanly on whether to offer retry without parsing error strings.
- **Rust owns the vocabulary.** `provenance_label` + `provenance_id` are computed server-side in the IPC handler. All three 13.F surfaces get identical copy and identical `aria-describedby` anchors without coordinating.
- **`NullHelper::generate` is explicitly marked as a diagnostic marker.** 13.F renderers that consume `LocalOps::*` must branch on `kind == "fallback"` and show a skeleton. Documented in integration-notes so a 13.F reader can't miss it.
- **Broadcast channel, not event-log, for helper transitions.** Helper health is per-process runtime state; persisting it as `EventPayload` variants would pollute per-workspace event replay with process-scoped noise.

**Technical decisions:**
- **Separate `record_success` from `Ready` emission.** Event firing needs version/model strings, which are only known after the Pong is parsed. `record_success` now only handles health publishing + `Recovered` (no data dependency); `Ready` is emitted explicitly from `ping()` after the Pong fields are captured and `has_succeeded_once` transitions for the first time.
- **`build_event_bridge`.** One tokio spawn per boot that forwards from the supervisor's internal `broadcast::Receiver` to an `AppCore`-owned `broadcast::Sender`. Prevents `AppCore` from having to know the concrete helper type to hand out receivers, keeps `helper: Arc<dyn FoundationHelper>` clean.
- **Pure `fallback_reason_from_probe_error` mapper.** Tested in isolation; the one place we still string-match (`Reported("macos-too-old")`, `Reported("foundation-models-unavailable")`) is against documented Swift-side machine tags, not against our own format strings — so changing a Rust error format can't silently reroute.
- **Cached `HelperHealth` via `parking_lot::RwLock`.** `health()` is now a pointer read, doesn't block on the async supervisor mutex. Updated by `publish_health(state)` at every state-mutation point (success, failure, spawn).

**Tradeoffs discussed:**
- **Three provenance strings vs. two.** Two was simpler, but conflated recoverable and terminal fallbacks — which the UI needs to distinguish to decide whether to offer retry. Three costs one more string and one more `provenance_id`, pays off by removing a renderer-side branch.
- **Separate broadcast channel in AppCore vs. expose supervisor's channel directly.** Direct would save the forwarding task but tie AppCore to `SwiftFoundationHelper` concrete type. The forward is ~20 lines and keeps the `Arc<dyn FoundationHelper>` interface clean.
- **Ready event in `ping()` vs. `record_success`.** Record_success is where the success counter resets, so it felt like the natural home — but it doesn't have the Pong fields. Splitting keeps each function responsible for exactly what it sees.

**Lessons learned:**
- Review on the same branch is cheaper than follow-up PR. The UX reviewer caught that "Fallback summary" implied `NullHelper::generate` returns a real summary, which it doesn't. Left alone, that would have shipped into 13.F's render path.
- String-matching on error messages for variant discrimination is always fragile, no matter how brief the strings look. The `"deadline"` substring match was technically correct but broke the principle of using types for discrimination. Added a `Timeout` variant; the match now compiles or doesn't — no silent drift.
- Cached-state patterns for hot reads (`parking_lot::RwLock<HelperHealth>`) are almost free and pay back immediately. Don't defer until performance is a problem.

---

### Phase 12.B — Foundation helper infrastructure (three-perspective plan + supervisor) SAFETY
**Date:** 2026-04-21
**Branch:** phase-12b-plan
**Commit:** pending

**What was done:**
Reviewed Phase 12.B through three lenses (staff UX designer, staff engineer, staff designer engineer), captured the plan at `.context/phase-12b-plan.md` with an optimization pass applied, then implemented the backend half. Shipped: (1) Swift helper polish — `--version` flag, `unknown-request` handling, `localizedDescription`-wrapped Foundation-Models errors. (2) `HelperSupervisor` — async with 5-step exponential backoff `[250, 500, 1000, 2000, 5000]` ms, permanent demotion to `NullHelper` after 5 consecutive failures, 2 KB bounded stderr ring drained by a background task, fail-fast on in-flight failures (no UI blocking), configurable `HelperTuning` for tests. (3) `AppConfig::helper_binary_path` with priority-ordered resolution: `DESIGNER_HELPER_BINARY` env → `.app` bundle sibling in `Contents/MacOS/` → Cargo workspace dev path. `DESIGNER_DISABLE_HELPER=1` kill-switch. (4) `select_helper()` with structured `FallbackReason` variants, 750ms boot probe. (5) `AppCore.local_ops: Arc<dyn LocalOps>` wired at boot — `FoundationLocalOps<H: ?Sized>` relaxed for trait objects. (6) `cmd_helper_status` IPC + flat `HelperStatusResponse` DTO in `designer-ipc`. (7) Stub helper at `crates/designer-local-models/src/bin/stub_helper.rs` — CLI-arg driven, parallel-test-safe, modes: `ok`, `slow_ping`, `die_after_ping`, `always_die`, `panic_to_stderr`, `bad_frame`. (8) 6 new `runner_boot.rs` integration tests + 6 `real_helper.rs` tests (env-gated silent skip). (9) `scripts/build-helper.sh` — swift build + smoke `--version` check. (10) Docs: new `core-docs/integration-notes.md` §12.B, `apps/desktop/PACKAGING.md` helper section with Phase-16 `externalBin` plan, `plan.md` / `pattern-log.md` / `generation-log.md` updates. Zero UI changes.

**Why:**
Phase 12.B blocks 13.F (local-model surfaces). Today's work landed everything that doesn't need the Apple Intelligence hardware — the supervisor, config wiring, fallback diagnostics, IPC surface, and a stub-based test harness that exercises the supervisor on any host. The final validation (run on an AI-capable Mac, confirm the SDK call shape) is a manual follow-up that updates `integration-notes.md` with observed deltas.

**Design decisions:**
- **Zero UI changes in 12.B.** FB-0007 (invisible infrastructure) and FB-0002 (suggest, don't act) argued against announcing Apple Intelligence. Nothing on screen yet has provenance that depends on helper availability; the indicator anchors better on real 13.F output than on an abstract capability pill.
- **Vocabulary pre-drafted for 13.F.** "Summarized on-device" / "Fallback summary" locked in `pattern-log.md`.
- **Provenance at the artifact, not the chrome.** Explicitly rejected the global topbar chip. Pattern logged for 13.F.
- **No Settings UI, no onboarding slide.** `DESIGNER_DISABLE_HELPER=1` covers the diagnostic case; no user-facing toggle for a dependency 99% of users will never think about.

**Technical decisions:**
- **Inside-the-bundle install, not `~/.designer/bin/`.** First plan said user-space install. Industry-conventions pass (Chrome / Electron / VS Code all bundle helpers inside `Contents/MacOS/`) corrected it to a dev-time `.build/release/` path that maps directly to the Phase-16 bundle path. One signing pass, atomic updates, hardened-runtime compatible, zero Phase-16 re-path work.
- **Fail-fast supervisor over blocking retry.** Initial draft had a single-shot retry. Rejected as a hack per user directive ("do whatever is most robust and scalable"). The supervisor never sleeps under the request lock: failing requests return `Unavailable` with the stderr snapshot, the cooling-off window is consulted at the *start* of the next request, respawn happens lazily. UI call time bounded at the per-request deadline (5s default) even during a crash storm.
- **Configurable `HelperTuning`.** Hardcoded const backoffs would make the demotion test take 8.75s. Extracted a small struct with `Default`; tests use 10ms steps and finish under 500ms.
- **Stub via `src/bin/stub_helper.rs` + `CARGO_BIN_EXE_stub_helper`.** Standard Cargo pattern. Stub reads mode from argv (per-spawn) not env (process-global) — parallel tokio tests otherwise stomp each other.
- **`H: ?Sized` on `FoundationLocalOps`.** `AppCore::helper` is `Arc<dyn FoundationHelper>`; relaxed the bound so trait objects pass through without re-concretizing. Zero runtime cost.
- **Flat `HelperStatusResponse` DTO.** Keeps the TS render trivial; boot status + live health merged for the UI's single-poll case.

**Tradeoffs discussed:**
- **Stub binary vs. mock trait impl.** Mock would be faster but wouldn't exercise pipe handling, `tokio::process` semantics, stderr drain, or read/write timeout paths. Stub costs one 70-line binary; catches real IO bugs.
- **Demotion flag vs. swapping the Arc in AppCore.** Swapping is architecturally cleaner but needs mutable `AppCore.helper` or a Mutex layer. Kept the internal flag: demoted `SwiftFoundationHelper` short-circuits all exchanges with `Unavailable`; `helper_health()` returns `running: false`. 13.F can build "re-enable helper" on top of this without architectural change.
- **Boot ping deadline 750ms vs. 500ms.** 750ms accommodates a cold Swift spawn + Foundation Models warm-up on a freshly booted Mac, still imperceptibly short for UX.
- **Status + health as one struct vs. two.** Conceptually separate (boot selection = immutable; health = mutable), merged in the IPC DTO where the UI wants one row.

**Lessons learned:**
- Env-var-based per-test config is a trap in tokio — parallel tests race on global env. Argv is the right knob for per-child test modes.
- Hardcoded consts in a supervisor make demotion untestable in finite time. Extract a tuning struct with `Default` *before* writing the first backoff test.
- "What's the industry standard?" is a cheap but valuable question. First-draft defaults ("install to `$HOME/.designer/bin/`") were structurally worse than the standard pattern (inside the `.app`), and the difference rippled into Phase 16. Asking early saved a re-plumbing step.

---

### Phase 12.C simplify pass — Tauri adapter, parallel boot, wire tests
**Date:** 2026-04-21
**Branch:** tauri-shell

**What was done:**
Three parallel agents reviewed the Phase 12.C diff (code reuse, code quality, efficiency). Consolidated findings, fixed each actionable item, added the two highest-value missing tests. Extracted `packages/app/src/ipc/tauri.ts` — a runtime adapter that owns `__TAURI_INTERNALS__` detection, dynamic-imports `invoke` / `listen` behind module-cached promises, and handles the "torn before ready" async-listener race in one place. `TauriIpcClient` and `App.tsx`'s menu listener now both consume this helper; the duplicated 20-line teardown dance in `App.tsx` + the dead `listenerTeardowns: Set<() => void>` field in `TauriIpcClient` are gone. Parallelized `bootData` in the frontend store: the three nested awaits (projects → workspaces → spines) became two `Promise.all` waves, cutting cold-start IPC latency from ~N+M+1 sequential calls to three parallel batches. Added Rust tests: `StreamEvent::from(&EventEnvelope)` round-trip in `designer-ipc` (2 tests — kind/sequence/timestamp/payload flattening + `summary: None` omission) and `AppCore::open_tab` / `spine` in `designer-desktop` (4 tests — tab append + project spine + workspace spine + unknown-workspace-empty). 29 Rust tests + 11 frontend tests + 6/6 Mini invariants + clippy clean in both dev and release.

**Why:**
The 12.C review pass caught runtime bugs; this simplify pass tightens the code that compiled. The Tauri adapter eliminates a pattern-duplication drift risk (two call sites of the torn-flag dance could drift as Tauri's event API evolves); the parallel bootData is a straight latency win; the new tests cover wire boundaries (StreamEvent shape) and new AppCore operations (`open_tab`, `spine`) that previously had no Rust-side coverage.

**Design decisions:**
- `ipc/tauri.ts` is the only module that touches `@tauri-apps/api`. Clients never dynamic-import the package directly. Keeps web/test builds from loading native bridges and gives a single place to evolve if Tauri's JS surface changes.
- The adapter returns a synchronous-to-the-caller teardown fn from `listen()`, even though the underlying registration is async. Pattern handles "user tore down the listener before the subscription registered" without leaking.
- `bootData` waits on `listProjects` + `spine(null)` first (they're independent), then fans out `listWorkspaces(p)` over projects, then fans out `spine(w)` over all workspaces. Three waves, not four — every wave does all its work in parallel.

**Technical decisions:**
- Module-level `invokePromise` / `listenPromise` are thunks (`() => import(...)`) rather than immediately-invoked so test environments that don't stub the Tauri package aren't forced to evaluate the import. Subsequent `await`s hit the ES-module cache after first call.
- `StreamEvent::from` test uses `Timestamp::UNIX_EPOCH` so the RFC3339 output is deterministic (`"1970-01-01..."`); no clock flakiness.
- `AppCore` tests leak the `tempdir()` rather than letting it drop at end of test. The core holds open SQLite connections; dropping the tempdir mid-test would race the pool shutdown. Leak is acceptable — tests are short-lived processes.

**Tradeoffs discussed:**
- Considered caching `Settings::load` in `AppCore::settings` field per the efficiency agent's finding. Rejected — the settings file is <200 bytes and load is O(1); caching adds state consistency responsibility (when does it invalidate?) without material perf win.
- Considered moving `spine`'s summary formatting to a `SpineRow` builder method per the quality agent. Rejected — all current formatting is placeholder; Phase 13.F replaces wholesale with `LocalOps::summarize_row`. Extracting a builder now would be premature.
- Agent 2 flagged a potential camelCase/snake_case mismatch (TS sends `projectId`, Rust expects `project_id`). Verified: Tauri v2 auto-converts between camelCase (JS default) and snake_case (Rust default) for command args. My code is correct for v2.

**Roadmap alignment check:**
All Phase 12.C deliverables from `roadmap.md` are met with one intentional deviation: the capability set is tighter than the roadmap suggested. Roadmap listed a restrictive "allowlist" (v1 terminology) including pre-declared FS / shell / network scopes. Tauri v2 uses capability plugins — you can only grant what you've pulled in as a dep. I pulled in no FS / shell / dialog / network plugins because 12.C doesn't need them; each arrives with the phase that uses it (13.E: FS + dialog for repo picker; 13.D: shell for claude; 13.F: shell for the Foundation helper; Phase 16: network for updater). This is stricter than the roadmap asked and gives the 12.C build the smallest possible surface to audit.

**Lessons learned:**
- Dynamic-import hygiene matters more than it looks. The old inline `(async () => { const { listen } = await import(...) })()` pattern was fine per file; across two call sites it was a drift risk.
- Spawning review agents in parallel and aggregating is faster than doing review serially and catches different classes of issues — code-reuse agent caught the adapter-extraction opportunity; efficiency agent caught the bootData parallelization; quality agent caught the comment-cleanup work.
- Adding tests at wire boundaries (serde round-trips, IPC command surfaces) pays more than adding tests of internal helpers. The StreamEvent test would catch a TS contract break that no other test would.

### Phase 12.C review pass — bug fixes + UX polish
**Date:** 2026-04-21
**Branch:** phase-12c-plan

**What was done:**
Joint staff-engineer + staff-UX re-review of the Phase 12.C implementation surfaced four defects and three polish items. Fixed all of them. (1) Window double-creation: `tauri.conf.json` declared a "main" window and `.setup()` also built "main" → Tauri creates config windows before setup runs, so the programmatic builder would error at boot. Removed `windows[]` from the config; window creation is now entirely programmatic (required anyway to pass the resolved theme as a URL hash). (2) Duplicate `title_bar_style(Overlay)` call eliminated. (3) File > New Project… menu item was emitting `designer://menu/new-project` with nothing listening on the frontend; added an `App.tsx` effect that listens under Tauri and triggers a new `promptCreateProject()` store action (shared with the `+` strip button so the two flows stay synced). (4) NSWindow background hex was `#FAFAFA` / `#0B0B0B` — close to but not matching `--color-background = --gray-1 = mauve-1` (`#fdfcfd` / `#18181a`). Dark-mode diff was visibly noticeable (0x0B → 0x18 is ~8% luminance). Switched to exact RGBA tuple returned from `ResolvedTheme::background_rgba()`. (5) Extracted a `make_main_window` helper used by both boot and dock-reopen so the two call sites cannot drift. (6) Dropped unused `_app: AppHandle` arg from `set_theme`. (7) Menu label now "New Project…" per macOS HIG (ellipsis = command prompts for input).

**Why:**
The initial 12.C ship compiled and passed lint/test gates, but a careful code review caught four bugs — one of which (double-creation) would have crashed the app on first launch. The review also surfaced paper-cut UX (dead menu item) and a subtle but visible cold-boot color mismatch in dark mode. Each fix is small and local; the aggregate effect is a shell that actually boots correctly, renders without a flash, and has a fully-wired menu.

**Design decisions:**
- Shared `promptCreateProject()` store action rather than a pub/sub between `App.tsx` and `ProjectStrip`. Single source of truth for the creation flow; adding more entry points (command palette, contextual menu) is a one-line addition.
- `make_main_window` helper takes `impl Manager<R>` so both the `App` (at setup) and `AppHandle` (at reopen) can pass themselves in. No code duplication; configuration changes land in one place.

**Technical decisions:**
- Window config moved entirely from `tauri.conf.json` to programmatic construction. Rationale: the theme-via-URL-hash pattern requires runtime construction anyway, and mixed config/code window creation is a common Tauri v2 footgun.
- `ResolvedTheme::background_rgba() -> (u8, u8, u8, u8)` instead of a hex string. Tauri's API wants bytes; the string-to-parse round-trip was unnecessary machinery.
- Frontend menu listener uses the same `'__TAURI_INTERNALS__' in globalThis` guard as `ipcClient()` — the effect is a no-op in vitest/jsdom.

**Tradeoffs discussed:**
- Considered adding a second entry for `promptCreateProject` via an app-level event bus; rejected — the store action is simpler, testable, and doesn't introduce a new pattern for callers to learn.
- Considered consolidating `#[cfg(debug_assertions)]` menu branches; kept as-is because the debug-only "Toggle DevTools" genuinely should not ship in release.

**Lessons learned:**
- When a Tauri v2 app uses programmatic windows, the `windows[]` array in the config should be empty. Declaring a window in both places is a quiet footgun — no build-time error, crash at runtime.
- Token-derived hex is worth the small lookup cost; approximating with "close enough" values loses the designer-engineer's trust fast.
- Review caught what tests couldn't: nothing in the Rust or React test suite exercised the actual Tauri boot path or the menu IPC. Interactive smoke (`cargo tauri dev`) on the user's machine remains the final verification.

### Phase 12.C shipped — Tauri v2 shell binary
**Date:** 2026-04-21
**Branch:** phase-12c-plan

**What was done:**
Replaced the CLI-demo `main.rs` in `apps/desktop/src-tauri/` with a full Tauri v2 application shell. React frontend now renders against a live `AppCore` (not `MockCore`) when running under Tauri; events stream from the Rust event store to the frontend via the `designer://event-stream` channel. All eight `#[tauri::command]` handlers are registered; `open_tab` and `spine` are new `AppCore` operations (`request_approval` / `resolve_approval` deliberately stubbed — those are 13.G). Theme persists in a sidecar `~/.designer/settings.json`; resolved at boot and passed to both NSWindow background and a URL hash so `index.html` can set `documentElement.dataset.theme` before React boots — zero cold-boot color flash. Standard macOS menu set (App/File/Edit/Window/Help + debug-only View); ⌘R reserved for the frontend. `data-tauri-drag-region` spacer at the top of the project strip clears the overlay-styled traffic lights. 23 Rust tests (+4 new settings tests) + 11 frontend tests + 6/6 Mini invariants + clippy all clean.

**Why:**
Phase 12.C was the single gate unblocking every track in Phase 13 — the frontend needed a real Rust runtime to talk to, and every Phase 13 track (agent wire, git + repo linking, local-model surfaces, safety + Keychain) starts with a live `AppCore` wired to the UI. Without the shell, the React app could only exercise `MockCore`, and the event store had no way to broadcast to any consumer.

**Design decisions:**
- Zero-flash cold boot uses three synchronized layers: NSWindow background color via `WebviewWindowBuilder::background_color`, `#theme=...` URL hash consumed by an inline `<script>` in `index.html` before React mounts, and `tauri.conf.json` `backgroundColor` as the no-window-yet fallback. Pattern-log entry explains why this matters (cold-boot color mismatch is the most visible "cheap desktop app" tell).
- Theme choice stored in sidecar `settings.json`, not the event store. Theme is per-install UI state; syncing it to a phone over Phase 14 would be wrong.
- Standard macOS menu omits ⌘R so the frontend can reclaim it for a workspace-level refresh action later.
- `titleBarStyle: Overlay` + `.app-strip-drag` spacer gives the Mini-on-desktop traffic-light inset look without custom title-bar chrome. Simpler than a full custom chrome, cleaner than a regular title bar.
- Vibrancy via `NSVisualEffectView` deferred — the plan said "ship with vibrancy", but visual testing requires actual window inspection; stubbed out until Phase 15 with a clear pattern-log entry to pick it up then.

**Technical decisions:**
- Tauri v2 (not v1). The roadmap's "allowlist" language was pre-v2; v2 uses per-command capabilities in `src-tauri/capabilities/default.json`.
- `#[tauri::command]` wrappers in `commands.rs` delegate to the existing `ipc::cmd_*` async functions — tests continue to invoke the latter directly without a Tauri runtime.
- Bundle identifier: `com.benyamron.designer` (user-chosen; see `.context/phase-12c-plan.md` confirmed decisions).
- Rust `StreamEvent` flattened to match TS `{kind, stream_id, sequence, timestamp, summary, payload}` via `From<&EventEnvelope>` in `designer-ipc`. Chose to update Rust (localized) rather than TS (distributed) consumers.
- `@tauri-apps/api@^2` installed in `@designer/app`; `invoke` and `listen` are dynamic-imported so jsdom/web builds don't break.
- Feature flag for no-Tauri builds was in the plan; dropped during implementation — Tauri v2 on macOS builds cleanly with system frameworks, no WebView2-style pain that would warrant the complexity.
- Event bridge (`events.rs`) forwards `broadcast::Receiver<EventEnvelope>` → `app.emit(...)`; handles `RecvError::Lagged` by logging and continuing rather than crashing (frontend re-syncs on next user action).

**Tradeoffs discussed:**
- IPC scope gap: option B chosen (add `open_tab` + `spine` to AppCore; stub approvals) over A (narrowest, 4 commands only, broken UI) or C (pull 13.G's approval work forward). B keeps 12.C's "shell works end-to-end" promise without expanding scope into safety-surface design.
- Theme persistence: sidecar file over event-store event. Rationale tracked in pattern-log — events are domain truth and will sync to mobile in Phase 14; user's theme preference should not.
- Icon: shipped with a placeholder (Python-generated black square with stylized "D"), not blocking on real brand assets. Real icon is a Phase 16 signing-and-bundle item.

**Lessons learned:**
- Tauri v2's `Emitter` + `Manager` traits need explicit `use` imports — easy miss. Tauri's compile errors are good but the trait-in-scope message is far from the call site.
- `WebviewWindowBuilder` instead of relying on `tauri.conf.json` window config gives precise control over the boot sequence. Needed for the theme-passed-via-URL-hash approach.
- Tests for the settings module were worth the time — covered the corrupt-file path that would otherwise silently eat a bad settings file on boot.
- Did not run `cargo tauri dev` (requires interactive GUI environment). End-to-end visual smoke test is deferred to first run on the user's machine; code compiles, unit tests pass, clippy is clean, and the build produces a binary.

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
