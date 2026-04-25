# Pattern log

> Decision rationale for non-obvious design-language or component choices. See Mini plan §13.1 for usage.

## How this differs from the design language

- `design-language.md` is the **current state**: axioms, tokens, approved patterns.
- `pattern-log.md` is the **history of decisions**: why we chose each axiom value, why we made that tradeoff, what we tried and abandoned.
- `generation-log.md` is the **mechanical record** of every skill firing (prompt, tokens used, invariants, feedback).

A minor token tweak (one value change) is logged here. An axiom change is logged in `design-language.md`'s change log AND here.

## How to write an entry

Each entry is a dated heading plus 3–6 sentences. Focus on the *why*. Reference code or commits where helpful.

## Entries

## 2026-04-24/25 — Phase 13.1 surface architecture: dev panel re-introduced as design tool

The 2026-04-23 entry below recorded the dev panel's *retirement*. This entry undoes that decision — the panel is now the canonical design-exploration mechanism (axiom #20; FB-0026). Reasoning:

The 2026-04-23 lockdown captured one snapshot of the surface register (gutter 12, tab-gap 6, shadow 5%, tab-style A). That snapshot was correct for the time but treated the panel as scaffolding to be torn down. In 13.1's iteration cycles, the user repeatedly preferred *adding a slider* over *picking a value*: compose fill, main-tab fill, tab opacity, border intensity, shadow intensity, tab-corner variants, main-tab radius, compose radius — every one of these started as "let me dial it" rather than "make it 14px". Treating the panel as the design tool (not the scaffolding) shortens the loop from "I want X to feel different" to "X is now bound to a slider — try values". Production defaults are baked in only after the user dials the chosen value live.

Concrete deltas vs. the 2026-04-23 lockdown:

- **Six independent surface knobs** (was one tab-style + two color-mix percentages):
  - `--dev-compose-mix` 20% — compose fill blend between main-tab and parent.
  - `--dev-main-tab-sand` 5% — main tab warmth (white ↔ sandier).
  - `--dev-surface-sand` 80% — parent surface warmth (brighter ↔ sandier).
  - `--dev-tab-opacity` 70% — unselected-tab fill + border alpha.
  - `--dev-border-strength` 10% — border alpha on main + selected tab. Unselected tab border = strength × tab-opacity (so border weight tracks fill weight).
  - `--dev-shadow-intensity` 50% — drop shadow on main + selected tab. Unselected tabs are flat.
- **Tab corner variant toggle** with five named presets:
  - Soft 12 (small soft card register).
  - Concentric 18 (= `--radius-surface` − `--surface-tab-gap`).
  - Folder 14 / 6 (asymmetric — folder-tab register).
  - Match 24 (= `--radius-surface` — production default).
  - Custom (drag the slider). Folder is the only asymmetric variant; the rest mirror top to bottom.
- **Independent main-tab and compose radius sliders** (`--dev-main-tab-radius` 24, `--dev-compose-radius` 8). Either can move without breaking the other.
- **`--radius-surface` 16 → 24 px.** With `--surface-inner-pad` at 16 the compose corner derives to 8 — within the user's 6-8 target range and 16 px ≥ 12 px gap floor.
- **Two-layer diffuse shadow.** Was `--elevation-raised` (single 0 1px 2px / 5%). Now stacks `0 1px 3px / 2%` (sharp definition) + `0 6px 16px −2px / 6%` (soft ambient, pulled inward). Both layers scale via the slider; shape is constant, opacity tracks.
- **Selected tab matches main tab container exactly** — same fill, same border, same shadow. Only `--surface-tab-gap` (6px) separates them. Border on the active tab was previously absent (fill + shadow alone); now there's a token-driven border that keeps the active tab and the main tab reading as one material.

The user-chosen production config (compose 20 / main 5 / surface 80 / tab 70 / border 10 / shadow 50, radii 24/24/8) is the new factory default. Reset-to-defaults restores all of it.

## 2026-04-24/25 — Dark-mode token-resolution bug + reanchored slider math

Dark mode looked completely flat in the first 13.1 pass — text was invisible, surfaces collapsed near pure black. Two bugs:

1. **Token names that don't exist.** The dark override used `var(--sand-dark-1)` through `var(--sand-dark-12)` (and `var(--sand-dark-aN)`). Radix Colors v3 only ships `--sand-1`…`--sand-12` and rebinds those *same names* under `.dark, .dark-theme`. There is no separate `--sand-dark-N` token — every reference resolved to the empty token list, the `var()` substitution failed, and CSS cascade fell back to invalid → text inherited browser defaults. Fix: replace every `--sand-dark-N` with `--sand-N`.
2. **Slider math collapsed under the wrong anchors.** Even with correct token names, the original anchors mixed `sand-dark-1` and `sand-dark-3` (≈ identical near-blacks). At default 80% / 5% the parent and main-tab both ended up at sand-dark-1.4 — no figure/ground. Reanchored: parent surface spans `sand-1↔sand-4` (defaults to ~sand-3.4 at 80%), main tab spans `sand-5↔sand-9` (defaults to ~sand-5.2 at 5%). About 1.8 luminance steps of separation — visible without being garish.

Project-level lesson logged in `history.md`: token-reference validity should be a project invariant. Adding a `node tools/invariants/check.mjs` pass that resolves every `var(--*)` against the defined token set would have caught this in seconds.

## 2026-04-24/25 — Sidebar / spine padding restructured for edge-to-edge hover

Worked around an overflow-clipping interaction. Previous pattern: `.app-sidebar` had `padding: var(--space-4)` (16px all around); `.workspace-row` used `margin: 0 calc(var(--space-4) * -1)` to break out and span the full sidebar width on hover. That worked for the sidebar root but broke inside `.sidebar-group` (which has `overflow-y: auto`) — `overflow-y: auto` clips horizontally too, so the negative margin hover got cut off at the group edge.

New pattern: horizontal padding moved off `.app-sidebar` (vertical-only now). Inner blocks each get their own horizontal padding to maintain the same X column for content:
- `.sidebar-header { padding: 0 var(--space-4); }`
- `.sidebar-home { padding: var(--space-2) var(--space-4); }`
- `.sidebar-group__head { padding: 0 var(--space-4); }`
- `.sidebar-empty { padding: 0 var(--space-4); }`
- `.workspace-row { padding: var(--space-2) var(--space-4); width: 100%; }`

Result: workspace-row hover/active fills genuinely span the full sidebar width, all content (Home icon, "Workspaces" label, status icons, project title, root-path) shares the 16px X column, and `overflow-y: auto` on `.sidebar-group` works without clipping.

Same restructure applied to `.app-spine` and its inner blocks (`.spine-header`, `.spine-section > .sidebar-label / .sidebar-empty`, `.spine-list`, `.spine-artifact`). Spine pinned/files items now use the same edge-to-edge hover pattern as the left sidebar (`--color-surface-raised`, no border-radius).

## 2026-04-23 — Surface config locked, dev panel retired

After ~24 hours of live tuning behind the SurfaceDevPanel, the numbers settled:

- `--surface-gutter: calc(var(--space-3) * 1.5)` → 12 px — page-to-surface inset. Sits between `space-3` (8, tight Linear) and `space-4` (16, airy Dia). The tighter end reads as "the content is the page"; 12 gives just enough air to separate chrome from content without turning the sidebars into their own surface.
- `--surface-tab-gap: calc(var(--space-2) * 1.5)` → 6 px — horizontal gap between tabs and the vertical gap between tab pills and the surface top. 4 crowded, 8 disconnected; 6 lets the tab read as "pointing to" the surface.
- `--surface-text-pad: var(--space-5)` → 24 px — tab-body inset from the surface edge. Locked separately from the compose pad after the two were fighting for the same knob.
- `--surface-inner-pad: var(--space-4)` → 16 px — compose-dock inset. Drives the compose's concentric corner radius via `calc(--radius-surface − --surface-inner-pad)` = 8 px.
- `--surface-shadow: var(--elevation-raised)` → 1 px offset, ~5 % black. Anything subtler read as flat; anything heavier muddied the warm-sand register.
- Tab style **A** (selected-only). Inactive tabs are labels on the page; active tab is the only rectangle, in `--color-content-surface`. Read cleaner than B (flat inactive) or C (all floating) once the surface and sidebar tonalities were dialed in.

The `SurfaceDevPanel` (and its `.surface-dev__*` CSS block, and the `designer.dev.surfaceOverrides` localStorage key) was removed. Live tuning can be re-wired behind a similar panel if we need to iterate again; the shape is in git.

## 2026-04-22 — Two-tier surface register: page + floating main panel

Switched the workspace layout from flat-three-pane (sidebars + main all on `--color-surface-flat` separated by hairlines) to a two-tier register: sidebars + spine render on `--color-background` with no fill or border; the main content is a rounded rectangle on `--color-surface-raised` with a 1px border, `--surface-shadow`, and `--surface-gutter` breathing room. Project strip stays on its own Tier-1 surface-flat + hairline — it's navigation chrome, not content.

The flat-pane read made every region visually equal; nothing carried "this is the work." The floating-surface read (Linear / Dia / Inflight) delegates the hierarchy to the surface itself — the sidebars stop competing with the content and the active tab reads as "part of" the floating surface via negative-margin merging.

Three tab styles ship gated behind `[data-tab-style]` on `.app-shell` so we can A/B them live before pinning:

- **A — selected-only container** (default). Inactive tabs are unfilled, unbordered labels on the page; active tab is the only rectangle, merging into the surface top.
- **B — flat-filled inactive, floating selected.** Inactive tabs carry `--color-surface-flat` fill but no border (flush with the tabs-bar baseline); active tab is brighter, bordered, and merges into the surface.
- **C — all floating.** Every tab is a bordered pill on the page; active is brighter but nothing merges — the surface keeps its full top border.

The active-tab seam (styles A and B): `border-bottom-color` set to the surface fill + `margin-bottom: -1px` + `z-index: 2` so the tab's bottom edge overwrites the surface's top border invisibly. Works in both light and dark mode because the tab and surface share `--color-surface-raised`.

Two custom properties on `:root` control the surface feel — `--surface-gutter` (default `--space-3` / 8px; panel switches between 8 / 12 / 16) and `--surface-shadow` (default `--elevation-raised`; panel switches between none / subtle / subtle+ / subtle-medium). SurfaceDevPanel (dev-only) writes both plus `[data-tab-style]` and persists to localStorage.

## 2026-04-21 — Initial elicitation (greenfield)

Ran `elicit-design-language` in greenfield mode. Pre-implementation (roadmap Phase 0–1), no UI code to scan. Seeded five axioms from `design-language.draft.md` (density, motion, surface-depth, focus, theme); amended two during the interview (motion now allows considered liveliness — "it's a design tool and should feel nice"; theme is now system-default instead of dark-default). Elicited six axioms fresh: base line-height 1.4 (tool register, not reading), accent identity monochrome (Notion/Linear-style — rejected purple for Linear overlap, terracotta for Claude-brand overlap, pure red for intensity), gray flavor mauve (olive and sand explicitly on the table), type Geist + Geist Mono (starting choice; may change), perfect-fourth type scale, soft-sharper radii (button=6px).

Reasoning for monochrome: Designer's primary user is a manager, not a brand; the product should feel like a cockpit, not a showcase. A chromatic accent would compete with the content (agent streams, diffs, design previews). Semantic colors stay chromatic because they're doing different work — signaling success/warning/danger/info, not decoration.

## 2026-04-21 — Accent tokens rebound to gray in tokens.css

Removed `@radix-ui/colors/indigo` and `@radix-ui/colors/crimson` imports from `packages/ui/styles/tokens.css`; rebound `--accent-1..12` and `--accent-a1..a12` to `var(--gray-N)` directly in `:root`. Removed the two `[data-accent="..."]` variant blocks. This makes the monochrome policy enforceable rather than aspirational — a consumer who writes `bg-[var(--accent-9)]` now gets gray-9, not indigo-9. If a chromatic accent is ever introduced, axiom #3 in `design-language.md` must be amended first; then the Radix import and a `[data-accent="name"]` block get re-added.

## 2026-04-21 — Designer project tokens added to fork-and-own tokens.css

Added `--border-thin`, `--border-strong`, `--breakpoint-sm/md/lg`, `--motion-pulse`, `--motion-blink` to the project-level block at the bottom of `packages/ui/styles/tokens.css`. Mini's contract doesn't define these (borders and breakpoints are often project-specific), but references to them started appearing in Designer's CSS. Putting them in the fork-and-own tokens file — not in `app.css` — keeps them visible to the propagate-language-update skill and makes them candidate upstream contributions if the pattern holds. Invariants now pass 6/6 on `packages/app/src`.

## 2026-04-21 — Color role aliases (--color-background etc.) live in app.css, not tokens.css

Added `--color-background`, `--color-foreground`, `--color-muted`, `--color-border`, `--color-surface-flat/raised/overlay` in a `:root` block at the top of `app.css`. Kept out of `tokens.css` because these roles are Designer-specific naming — Mini keeps `--gray-*` abstract so consumers can choose their own semantic layer. If these role names feel stable after a few more surfaces, they can move up.

## 2026-04-21 — Agent-produced sandbox content uses CSS system colors

Prototype preview iframe renders agent-authored HTML under strict CSP. Tokens would be wrong here — the HTML is outside Designer's design surface, and forcing Mini tokens on it would couple agents to our token names. Used CSS system colors (`Canvas`, `CanvasText`, `GrayText`) instead — they auto-theme with the host and are spec-defined. The invariant scanner is content with system colors; it only flags literal `#hex` sources.

## 2026-04-21 — Mini primitives (Box/Stack/Cluster/...) not used in Phase 8–10

Deliberately deferred using Mini's primitive components (`@designer/ui/primitives`) in favor of CSS grid + inline flex with tokens. Reasoning: primitives shine as a shared abstraction across many screens; the first Designer surfaces wanted tighter layout control than Box/Stack provide (three-pane grid, tabs bar, spine rail). Cost is cohesion drift — if subsequent surfaces repeat the same inline-flex patterns, Mini's primitives become the right second pass. Captured as an explicit deviation in `generation-log.md`.

## 2026-04-21 — SQLite WAL enabled once, not per pooled connection

First pass set `journal_mode = WAL` inside `SqliteConnectionManager::with_init`. On cold-start with 8 pool connections opening near-simultaneously, only one could take the lock to flip journal mode; others surfaced "database is locked." Fix: open a one-shot connection in `SqliteEventStore::open`, flip journal_mode + synchronous there, close it, *then* build the pool with only `foreign_keys=ON` in `with_init`. WAL is a database-level setting (survives connection close), so one flip is enough.

## 2026-04-21 — Breakpoints in em, not px

CSS Custom Properties can't appear inside `@media` conditions (spec limitation — `@media (max-width: var(--breakpoint-lg))` does nothing). Kept the token in tokens.css as the source of truth, and used em-based media queries (68.75em ≈ 1100px, 56.25em ≈ 900px) with a comment linking to the token. em-based breakpoints also scale with user font size — a small a11y win.

## 2026-04-21 — Gray flavor set to mauve via aliasing

Swapped the `@radix-ui/colors/gray` imports for `@radix-ui/colors/mauve`; added a `--gray-N: var(--mauve-N)` alias block in `:root` so every downstream Mini file (axioms.css, primitives.css, archetypes.css) continues to reference `--gray-N` unchanged. This is the Mini-sanctioned way to swap neutrals — the abstract `--gray-N` token name is stable; only the underlying Radix scale changes. If we want to try olive or sand later, it's a 4-line import swap + 24-line alias rewrite.

## 2026-04-21 — Local-model provenance belongs at the artifact, not the chrome (pre-commit for 13.F)

Phase 12.B landed the Swift Foundation Models helper infrastructure with zero UI. During the three-lens plan we debated where — and whether — to surface a "this summary is on-device" indicator. Rejected every global chrome placement (topbar chip, Settings → Privacy toggle, onboarding slide). Rationale: FB-0007 says absorbed tools should feel invisible with subtle surfacing; FB-0002 says suggest, don't act. A global chip announces a dependency the user never chose and can't meaningfully reconfigure. The user feels the helper through its *output* (faster spine summaries, on-device recap, audit verdicts), not through the app's plumbing.

Decision for 13.F: provenance strings live adjacent to the artifact they describe — spine summary row, Home recap card, audit verdict tile — programmatically associated via `aria-describedby`. Three vocabulary strings now live on the Rust side of the IPC (`apps/desktop/src-tauri/src/ipc.rs::provenance_for`), keyed by the three-way `recovery` routing:

- `"Summarized on-device"` (`provenance-live`) — helper is live; artifact is real model output.
- `"Local model briefly unavailable"` (`provenance-transient`) — recoverable fallback (missing binary, timeout, crash). UI should show a skeleton / empty artifact body and may offer a retry affordance.
- `"On-device models unavailable"` (`provenance-terminal`) — terminal fallback (unsupported macOS, Apple Intelligence unavailable). UI must not offer retry.

Rejected the single "Fallback summary" phrase from the first draft: (a) "fallback" is engineer vocabulary, (b) `NullHelper::generate` returns a diagnostic marker rather than a summary, so any literal "fallback summary" label over-promises. The three-way split is driven by the IPC's `recovery` field (`user` / `reinstall` / `none`) so renderers branch on routing, not parse error strings.

Not a tooltip-only affordance — the text must be present in the DOM for screen readers. `provenance_id` is stable kebab-case across sessions so `aria-describedby` references don't shift when state changes.

## 2026-04-21 — Helper binary lives inside the `.app` bundle, not `$HOME/.designer/bin/`

Initial Phase 12.B plan had the Swift helper installed to `$HOME/.designer/bin/designer-foundation-helper`. Industry-conventions pass replaced that with the Chrome/Electron/VS Code pattern: production binary lives inside `Contents/MacOS/designer-foundation-helper` alongside the main executable. Reasons: (1) single `codesign --deep` pass covers both binaries; (2) app + helper version are atomically bound — never skew across updates; (3) hardened-runtime compatible without an explicit entitlement to exec an unsigned sibling; (4) no install step for the user and no pre-flight path-resolution in the updater. Dev keeps the binary at `helpers/foundation/.build/release/designer-foundation-helper` where `swift build` puts it; `AppConfig::default_in_home()` detects `.app`-bundle vs. Cargo-dev context via `std::env::current_exe().ancestors()` and resolves the correct path automatically. Phase 16 packaging will copy the release artifact into the bundle during `cargo tauri build`.

<!-- "Supervisor fails fast" was here. Moved to `core-docs/integration-notes.md` §12.B per UX review: it's a code contract, not a UX decision pattern. -->

## 2026-04-21 — Helper events fan-out via broadcast, not event-stream

Initially considered adding `HelperStateChanged` as an `EventPayload` variant to the persisted event log so 13.F could subscribe to helper transitions through the existing projector channel. Rejected: the event log is per-workspace and event-sourced (SQLite-backed), whereas helper health is per-process runtime state with no meaningful history. Persisting demotion/recovery events would pollute workspace replay with process-scoped noise and make "what did the workspace do" harder to audit. Chose a separate `tokio::sync::broadcast` channel on `AppCore` (`subscribe_helper_events()`), fed by the supervisor's own internal channel through a small forwarding task. Costs one tokio spawn per boot; decouples transport (runtime) from persistence (workspace). 13.F subscribers get cheap O(1) fan-out without polling per-artifact.

## 2026-04-21 — Gray flavor moved mauve → sand

User feedback on the first dashboard screenshot: the mauve cast felt decorative next to the monochrome accent policy, reading as "a theme" rather than a neutral register. Against the Notion / Linear / Dia / Claude inspiration set the product should be a warm black-and-white — paper, not cream. Swapped the Radix imports in `packages/ui/styles/tokens.css` from mauve → sand and rewrote the `--gray-N: var(--sand-N)` alias block. Zero app-code changes: every consumer references `--gray-N` / `--color-*` role aliases, so the cascade propagated cleanly. Design-language.md axiom #4 amended to reflect the choice.

## 2026-04-21 — Home as two switchable variants (Panels vs. Palette)

Same critique pass surfaced two plausible directions for the workspace home:

- **Variant A (Panels)** keeps the dashboard metaphor but drops every card border, uses titled panels on a single surface, hairline dividers between logical groups, and one type scale. Summary of what was wrong with the old home: ~5 type sizes fighting, every card equally weighted, mauve accent without a job.
- **Variant B (Palette)** abandons the dashboard entirely. Centered prompt + 4–6 context-aware suggestions + a collapsible brief. Directly inspired by Dia's new-tab pattern and a more literal reading of the product principle *summarize by default, drill on demand*.

Rather than pick upfront, both variants ship behind a runtime toggle (`dashboardVariant` in `appStore`, persisted to localStorage; pill toggle in the main top bar). Reasoning: this is a load-bearing UX decision; one of the variants only reveals its strengths after a few days of real use, and A/B-in-hand beats speculative judgment. A component manifest entry exists for each variant; generation-log records the paired decision. Whichever wins becomes canonical and the loser is deleted.

## 2026-04-21 — Panels-not-cards pattern promoted to axiom

Adopted "panels, not cards" as a general pattern (new bullet in design-language.md §Patterns). Inside a content surface, sections are titled blocks with whitespace + hairline dividers; bordered rectangles are reserved for genuinely floating surfaces (modals, tray items, quick-switcher). Driver: bordered cards compound visually across a dashboard, borders compete with the top-bar + tabs-bar + sidebar + activity-spine borders that are already present at the shell level, and a dashboard of equally-weighted cards has no anchor. The lab tiles (`.lab-tile`) remain bordered because they represent discrete things-you-can-pick — matching the pattern rather than violating it.

## 2026-04-22 — Spacing rhythm codified as axiom #11 (3/4/5/6)

An ad-hoc spacing audit found ~6 different canonical gaps in use (`space-1` through `space-6` with no rhyme). Codified a four-step rhythm: `--space-3` (8px) for inline gaps and row horizontal padding, `--space-4` (16px) for panel edge padding and group gap, `--space-5` (24px) for stacked content blocks and main inset, `--space-6` (32px) for section breaks on home surfaces. `--space-1 / --space-2 / --space-7 / --space-8` remain legal but should be justified at their call site. Documented at the top of `app.css` so it's visible to anyone editing CSS. Design-language axiom #11.

## 2026-04-22 — Home moved from workspace-tab to project-level surface

User feedback on the Linear reference: "Home is a project-level tab, not a workspace-level tab — it should be in the left sidebar." Refactored so `HomeTabA` and `HomeTabB` take a `Project` rather than a `Workspace`; `WorkspaceSidebar` gained a Home button above the Workspaces list; `MainView` routes to project-home when `activeWorkspace` is null and workspace tabs no longer include a Home entry. The `activeTabByWorkspace` type narrowed from `TabId | "home"` to `TabId`. New axiom #12 codifies the IA scope as `project : workspace : tab`.

## 2026-04-22 — Linear-style tabs with close-on-hover + single +New dropdown

Rewrote the tabs bar twice: first to flex-equal pills, then (per user feedback) to fixed-width-with-shrink pills that take their natural size and shrink proportionally when crowded (`flex: 0 1 calc(var(--space-8) * 3)` + min/max widths). Each tab has a template icon + label + a hover-revealed `X` close affordance (also responds to middle-click and ⌘W). Replaced the four-button template cluster with a single `+ New tab` button opening a menu of Plan/Design/Build/Blank (⌘T to toggle, click-outside or Escape to close). Added `TabLayout` primitive to give tabs a scrollable content region plus an optional bottom dock slot (compose).

## 2026-04-22 — Compose as dock, not panel

Earlier iterations put the PlanTab chat input inside its own bordered panel at the bottom of the tab. Feedback: "the input shouldn't be in its own panel — it should float within the workspace container." Removed the dock's background + border-top; the compose container (rounded card, focus-within ring via `box-shadow`) now floats directly in the tab body with matching max-width. The footer row (model / effort / plan-mode) sits inside the same container, separated by a hairline. Drag-over lights the outer border (`data-dragging="true"`). This also refined axiom #10 to cover container-level focus-within for compose-style surfaces.

## 2026-04-22 — Workspace status icons (PR progression orthogonal to lifecycle)

Added a `WorkspaceStatus` type (`idle | in_progress | in_review | pr_open | pr_conflict | pr_ready | pr_merged`) orthogonal to the existing `WorkspaceState` (`active | paused | archived | errored`). When `status` is set on a workspace, a 12×12 semantic-colored SVG glyph renders in its sidebar row in place of the state-dot; otherwise the state-dot renders. Colors come from semantic scales (`--info-11` / `--warning-11` / `--danger-11` / `--success-11`) so they stay legible in dark mode. This is TS-only for now — the Rust IPC schema carries `state` but not `status` yet; Phase 13.E tracks bringing it across the IPC boundary.

## 2026-04-22 — Spine indent rails via repeating-linear-gradient

ActivitySpine rows render as a flat list with `padding-left: calc(var(--space-4) * depth)` for indent. To draw the faint vertical trunk lines that connect children to ancestors, each row gets a `repeating-linear-gradient` background limited to `width: calc(var(--space-4) * depth)` — so depth=0 draws nothing, depth=1 draws one line at x=space-2, depth=N draws N lines at 8px / 24px / 40px / …. CSS-only, respects theme (uses `--color-border`), and avoids adding per-ancestor pseudo-elements.

## 2026-04-22 — False affordances are bugs (mic disabled pattern)

PlanTab's compose surface shows an icon for dictation that isn't wired yet (Phase 13). First iteration left the button interactive with an empty onClick and a "TBD" comment — a dead click target. Revised: the button is explicitly `disabled`, with an aria-label + title of "Dictation — coming soon". CSS drops opacity to 0.45 and disables hover interactions. This is now a design-language pattern: any visible affordance must do something, even if that something is "explain why it's disabled."

## 2026-04-22 — Staff review pass: correctness + token + a11y cleanup

Ran three parallel audits (UX / engineer / design engineer) against the shipped surface. Fixed: (a) five CSS rules that referenced the non-existent `--type-weight-*` family; replaced with `--weight-*` (Onboarding.tsx had one too). (b) `.compose__input:focus { outline: none }` stripped the focus ring — moved the ring to `.compose:focus-within` via `box-shadow` so the container glows on focus (axiom #10 refinement). (c) `TabContent` lacked a React `key` tied to workspace.id, so PlanTab draft state bled across workspaces when switching; now keyed as `${workspace.id}:${activeTab}`. (d) HomeTabB's suggestion list used `key={i}` — replaced with stable `Suggestion.id` strings. (e) `ActivitySpine.countState` and `flattenSpine` now null-safe on `children`. (f) PlanTab's mic disabled + labeled "Coming soon." Added a `--icon-sm/md/lg` token family (axiom #13). Added tests for closeTab and variant-toggle.

## 2026-04-21 — Traffic-light inset via `titleBarStyle: Overlay` + drag spacer

Tauri's overlay title-bar style hides the title text but keeps macOS traffic lights, floating them over the webview. To prevent the lights from colliding with the first project icon, the project strip now renders an empty `.app-strip-drag` element with `data-tauri-drag-region` at the top of the list — tall enough (`--space-6`) to clear the ~28px lights, wide enough to serve as a grip for window drags. In the web/mock build the element is a harmless blank spacer; Tauri promotes it to a system drag region at runtime. Rejected: using `tauri-plugin-window-state` or a full custom title bar — both add configuration surface without improving the visual.

## 2026-04-21 — Theme persistence in a sidecar `settings.json`, not the event store

Theme choice is stored in `~/.designer/settings.json` — deliberately outside the SQLite event store. Rationale: theme is per-install, per-user UI state. The event store is domain-truth that syncs over the Phase 14 transport; shipping a user's "prefers dark mode" choice to their phone over pairing would be wrong. Keep local UI prefs local. Schema is `{"theme": "light|dark|system", "version": 1}` with `version` reserved for future migration. The Rust main() loads this synchronously (no tokio) before the window opens so the first NSWindow + WKWebView paint is already the right color; `index.html` has a matching synchronous script that reads `location.hash` (Tauri passes `#theme=<resolved>`) to set `documentElement.dataset.theme` before React boots.

## 2026-04-21 — Zero-flash cold boot: three synchronized layers

The first-frame color is determined in three places simultaneously so there's no mismatch. (1) `WebviewWindowBuilder::background_color` — NSWindow's bg, visible until the webview paints. (2) The URL hash `#theme=light|dark` — picked up by an inline `<script>` in `index.html`, sets `dataset.theme` before the React bundle evaluates. (3) `tauri.conf.json`'s `backgroundColor` — the no-window-yet fallback. Runtime theme changes don't touch NSWindow bg because once the webview is painted, NSWindow is invisible — CSS variables handle everything from that point. This matters because cold-boot theme mismatches are the most visible "cheap desktop app" tell.

## 2026-04-21 — Approvals deliberately stubbed at the Tauri boundary

`request_approval` and `resolve_approval` are registered as Tauri commands that return `IpcError::Unknown("approvals are a Phase 13.G surface")`. The frontend can detect this and render a "not yet wired" degraded state rather than the Tauri runtime returning "command not found" which would crash the dialog surface. Decision: the existing `InMemoryApprovalGate` is Rust-side complete, but Phase 12.C's scope is shell + real-core wiring, not safety surfaces — those design questions (inbox placement, cost chip, Keychain integration) belong in 13.G.

## 2026-04-21 — `tauri.conf.json` windows[] must be empty when using programmatic builders

Tauri v2 creates windows declared in `tauri.conf.json`'s `app.windows` array before `.setup()` runs. If `.setup()` then tries to build a window with the same label, the runtime errors out. For the zero-flash theme pattern we need programmatic creation (to pass the resolved theme as a URL hash on the initial URL), so `windows[]` is now empty. All window configuration lives in `make_main_window()` in `main.rs` — one source of truth, no drift between config and code.

## 2026-04-21 — Bg color must derive from the token table, not be eyeballed

First pass used `#FAFAFA` / `#0B0B0B` as approximations of "near-white" and "near-black". In light mode the 5/255 diff was invisible; in dark mode the 0x0B-vs-0x18 diff was visibly too dark on cold boot. Swapped to the exact mauve-1 values (`#fdfcfd` / `#18181a`) returned by `ResolvedTheme::background_rgba()`. Lesson: don't approximate chrome colors. If the gray flavor is ever swapped (mauve → olive/sand), update `background_rgba()` in the same change — the invariants won't catch drift between tokens.css and Rust constants. *Post-sand-swap addendum (2026-04-22): the sand-1 values need to replace the mauve-1 constants here too — tracked as a follow-up in the UI-critique PR.*

## 2026-04-21 — Menu IPC uses shared store actions, not event-bus pub/sub

`File > New Project…` emits `designer://menu/new-project`. `App.tsx` listens and calls the same `promptCreateProject()` store action the `+` strip button calls. No custom-event indirection, no pub/sub. Each new menu entry point is one listener + one existing store action. Kept the frontend listener behind an `'__TAURI_INTERNALS__' in globalThis` check so vitest/jsdom doesn't try to bind.

## 2026-04-22 — Tooltip component replaces the HTML `title` attribute

The UX pass called out that `title`-attribute tooltips (a) delay before appearing, (b) can't be styled, (c) can't render a keyboard shortcut as a kbd chip, and (d) don't appear on keyboard focus at all in most browsers. Added a `Tooltip` component (`packages/app/src/components/Tooltip.tsx`) that: renders in a fixed-position popover anchored to the trigger via `getBoundingClientRect`, appears immediately on hover and focus (no delay — the user asked for this explicitly), takes a separate `shortcut` prop that renders as a right-aligned `kbd`, and exports a `side="auto|top|bottom|left|right"` placement. Announces to screen readers via `aria-describedby`. `prefers-reduced-motion` skips the scale-in animation. Adopted across ProjectStrip, WorkspaceSidebar, ActivitySpine, MainView, PlanTab, and HomeTabB. Old `title` attributes remain on a handful of non-focus-trap surfaces as graceful fallback.

## 2026-04-22 — IconButton archetype + hit-target axiom (#14)

The pass flagged the 12×12 `+ New workspace` button as too small — it failed tap accessibility and looked undersized next to every other icon. Rather than nudging one button, codified a two-step hit-target system (`--target-sm` = 24px, `--target-md` = 32px) and built an `IconButton` component (`packages/app/src/components/IconButton.tsx`) that takes `size="sm" | "md"`, a required `label`, an optional `shortcut`, and wraps its child in the `Tooltip` component. Every icon-only button in the app now flows through it; hand-rolled icon buttons are a lint target going forward. Axiom #14 added to `design-language.md`.

## 2026-04-22 — Three text roles for app chrome (axiom #15)

An audit of in-use sizes on the shipped surface: the app was using `caption`, `body`, `lead`, `h4`, `h3`, `h2`, and `h1` — seven steps, most with only one or two call sites. The UX pass: "I don't think we need more than 2 or 3 sizes, and they don't have to be super different." Constrained everyday chrome to three roles: `caption` for meta/labels/kbd, `body` for every other control/label/message/title, and `h3` for empty-state and onboarding hero. Hierarchy inside the body band is carried by `--weight-medium` and `--color-muted`, not by introducing intermediate sizes. Tab title went from `h3` → body+medium; card title went from `h4` → body+medium; branch chip went from body → caption (the user flagged it as feeling "too big relative to standard text"). Existing tokens are retained for edge surfaces and future exploration.

## 2026-04-22 — Chat asymmetry: user bubbles, agent on surface

Prior pass painted both authors as identical surface-raised cards. The UX pass asked for the canonical asymmetry (Claude, ChatGPT, Cursor): user messages in bubbles (right-aligned, max-width 80%, surface-overlay background, hairline border, card radius) and agent replies printed directly on the surface (no bubble, no border, caption-size author label). Rationale: the visual register reinforces semantics. User messages are contained and discrete because "I said this"; agent output is content the surface is producing, not a card it's showing you. Implemented as two CSS rules gated by `data-author`.

## 2026-04-22 — Palette has two densities (bounded vs open)

Same pattern as the original Panels/Palette split: the UX pass asked "should suggestions be inside the input container (like Dia), or on the surface with no container at all?" Both reads have merit — Dia's bounded object feels like a single click-target; the open layout reads as a generous empty canvas with affordances nearby. Shipped both behind a local toggle (`paletteDensity` in `appStore`, persisted). `bounded` wraps prompt + suggestions in one rounded surface with a hairline between prompt and list; `open` strips the surface and uses a separate bordered input + surface-less suggestion list. Whichever wins becomes canonical. Dropped the "workspace brief" drawer entirely — Panels mode already covers that drill-in, and keeping two surfaces for the same information split the product's voice.

## 2026-04-22 — Topbar minimalism (workspace name lives only in the sidebar)

The workspace topbar was duplicating the sidebar: project name + path + workspace name + branch chip were all redundant with the left rail. Stripped the topbar to lifecycle dot + branch chip on workspace views, and removed the heading block entirely on project-home (the Panels/Palette variant toggle is its only chrome). This also resolved the UX-pass note about the "main" chip feeling too big — the branch chip is now caption-size monospace, visually in scale with the meta text next to it.

## 2026-04-22 — The trailing `+` is a tab, not a topbar button

The previous `New tab` button sat in the topbar as a labeled pill with a kbd hint, disconnected from the tabs bar. Moved it into `.tabs-bar` as a trailing IconButton that opens the existing template menu. Standardized vocabulary: code, copy, aria labels all say "tab" (not "panel"). Menu items now render as two-line rows (title + caption-size description) so the menu reads without hover tooltips. Keyboard shortcut ⌘T is announced in the tooltip.

## 2026-04-22 — Project strip reshuffled: transparent new-project, no quick-switcher, settings + help at bottom

The strip carried three square buttons at the top — `+` (new project) and `⌘` (quick switcher) stood out next to the filled project squares, and the `⌘` button was redundant with the keyboard shortcut. Removed the quick-switcher button entirely (⌘K remains). Rebuilt `+` as a transparent `IconButton` so it matches the `+ New workspace` pattern in the sidebar. Added a bottom cluster: `Settings` (opens a dialog with Appearance / Account / Models / Preferences sections, stubs wired to the same tokens) and `Help` (opens a dialog with a question input placeholder, keyboard-shortcut table, and an About row). Each project square now also carries a tiny pulsing status dot when any workspace in that project is active or needs attention — the only surface that aggregates activity across projects.

## 2026-04-22 — Activity spine is project-scoped; spine toggle + sidebar toggle

The pass noted that showing every project's activity in the spine was wrong: users are in one project at a time, and global activity is better surfaced as a strip status dot. The spine now filters events by the active project's stream IDs (or the active workspace's when one is selected). Copy change: the zero-state fallback is now "Nothing streaming" rather than "All quiet" — the prior phrase was a riddle. Both the workspace sidebar and the activity spine gained an IconButton in their header that toggles the pane closed; the collapsed state renders as a narrow `.pane-rail` with a single reveal button. Keyboard: ⌘[ toggles the workspaces pane, ⌘] toggles the activity pane (⌘\ still toggles the projects strip). Hover-revealed 4px drag handles (`.pane-toggle`) sit at each pane edge — currently wired only to toggle on click, but positioned as the anchor for a future drag-to-reorder pass.

## 2026-04-22 — Compose: actions stacked with send, no footer divider, select focus on wrapper

PlanTab's compose footer had two problems: the attach/mic buttons floated absolutely inside the textarea while the send button lived at the right end of the footer (two visual groupings for one intent), and the inner native `<select>` received the focus ring on focus — making it look like a button inside a button. Rebuilt the footer: attach, mic, and send are a single right-aligned trio in the footer, all three the same 32×32 IconButton shape, with send filled (`btn-icon--primary`) and attach/mic transparent. Removed the hairline divider above the footer — the compose container's border already frames it. Rewrote `ComposeSelect` to put the native `<select>` absolute-positioned (opacity 0) inside the chip label; the chip label is the focus target, ring applies to the wrapper via `:focus-within`. Removed the PlanTab `tab-header` except when the thread is empty (keeps the orientation text as an empty-state, not as permanent chrome on an active conversation).

## 2026-04-22 — Simplify pass: shared icons, SegmentedToggle, persisted helper, live/commit resize, Tooltip rAF

Staff review (UX + design-engineer lens, three parallel audits: reuse, quality, efficiency) on the second UX-feedback pass. Converged fixes:

- **Shared icon module.** `components/icons.tsx` now hosts `IconX`, `IconPlus`, `IconBranch`, `IconChevronLeft/Right`, `IconCollapseLeft/Right`. Replaces three hand-rolled copies of the close-X across `MainView.tab-button__close`, `PlanTab.compose__chip`, and `AppDialog` — and the same kind of copy for the plus, plus the duplicated collapse chevrons in AppShell / ActivitySpine / WorkspaceSidebar. Each icon uses `currentColor`, respects the icon-size tokens, and takes a `size` / `strokeWidth` prop rather than hard-coding viewBox.
- **`SegmentedToggle` generic.** Collapses the identical Panels/Palette and Bounded/Open toggles into one component (`components/SegmentedToggle.tsx`). The `.variant-toggle` CSS class family is renamed to `.segmented-toggle` — there is no longer a "variant" toggle; there is a segmented control that any two-to-N pill chooser uses.
- **`home-b__*` CSS renamed to `palette__*`.** The class was a lie once Palette became a shared primitive used by HomeB + BlankTab. Also renamed the `home-b__palette` inner class to `palette__surface` so we don't ship a `.palette .palette__palette` awkwardness.
- **`persisted<T>()` helper.** `util/persisted.ts` is the single shape for read/write-through-to-localStorage. The four bespoke `readStored*` helpers in `store/app.ts` collapsed to one-liner instantiations; decoders (`stringDecoder`, `booleanDecoder`, `intDecoder`) handle type-safety without re-proving `typeof window !== "undefined"` at every call site.
- **`cx(...)` helper.** `util/cx.ts` — the ten-line classname joiner. Landed before the third `.filter(Boolean).join(" ")` copy.
- **Live-update vs commit split for pane resize.** The initial `PaneResizer` wrote to `localStorage` on every pointermove — mobile Safari serializes localStorage across tabs with a file lock, so per-pixel writes janked the drag. Split into `setSidebarWidthLive` (in-memory store update during drag) and `commitSidebarWidth` (flushes latest value to disk on pointerup). Same split for the spine. Keyboard ± steps and double-click reset commit immediately because they're discrete.
- **Tooltip: rAF-coalesced, passive scroll listener.** Was attaching `window.addEventListener("scroll", …, true)` (capture, non-passive). With many tooltips alive, every scroll event in the app ran a layout-forcing `getBoundingClientRect`. Now coalesces with `requestAnimationFrame` and flags the listener `{ capture: true, passive: true }`.
- **Store setters short-circuit on same value.** `createStore.set` bails when `Object.is(state, computed)`, but every action was spreading a fresh `{...s, …}` so listeners fired on every `setSidebarWidth(sameValue)`. Every action now returns the prior `s` reference when the value is unchanged. Defensive, but fixes a class of no-op re-render.
- **`IconButton` doesn't spread `aria-pressed` unless `pressed` is set.** A Close button getting `aria-pressed="false"` reads like a toggle to AT.
- **`PaneResizer` a11y + safety.** Added `aria-valuemin` / `aria-valuemax` on the `role="separator"`; guarded `releasePointerCapture` with a `hasPointerCapture` check so `onPointerCancel` can't throw.
- **`needsYou` memoized in HomeTabB.** The filter was re-running + producing a new reference on every event tick, which invalidated the downstream `useMemo` it feeds into.

Skipped from the audit (call these out so future-you doesn't second-guess): split `AppDialog` into `{open, kind}` (2 dialogs is fine as a union); cap `AnnotationLayer.pins` (session-scoped; move-to-persisted when the review pipeline lands); rename `side` → `grows` on PaneResizer (the comment explains the inversion clearly enough); move spine `sort` into the store (not a bottleneck at N≈60).

## 2026-04-22 — Second pass: blank tab is a palette, tabs bar is flat, panes are draggable

Eight-annotation follow-up round. Changes:
- **Blank tab = Palette.** Extracted `Palette` (`packages/app/src/components/Palette.tsx`) as the shared surface used by both HomeTabB (project-scoped) and BlankTab (workspace-scoped). Same bounded/open density toggle. BlankTab suggestions speak in terms of the workspace ("Summarize the last 10 events in {workspace}", "Propose three directions…", etc.). The prompt-suggestions card pattern is gone.
- **Workspace topbar removed.** The lifecycle-dot + branch chip in the workspace topbar was reading as a bullet point and breaking the rhythm. The tabs bar is now the top row of the workspace view. Workspace identity lives in the sidebar already; there is no reason to duplicate.
- **Tabs bar container is flat.** No fill, no bottom separator. Selected state lives on the individual tab (surface-overlay background, strong border) so the "which tab is live" read is carried by the tab, not the container.
- **Panes are draggable.** Replaced `.pane-toggle` (click-to-collapse edge button) with `PaneResizer` (pointer-captured drag, double-click resets to default, arrow-key ±16px / ±48px with shift). Width persisted per pane in localStorage; clamped to `[180, 480]` so main content never squishes. The explicit collapse affordance lives in the pane header (IconButton + ⌘[/⌘]) — the resize handle is single-purpose, so "drag by 1px" never gets confused with "close this pane."
- **Model/effort/plan-mode no longer leaks into chat text.** The UX pass flagged the `[model=opus-4.7 · effort=medium]` prefix as noise inside the user's own message. Moved to `Message.meta` (typed, not rendered) so the IPC payload can carry it out-of-band when Phase 13.D lands. The visible chat body is now exactly what the user typed.
- **Annotation pins are clickable.** Previously only the creation flow was wired — existing pins showed an info-9 dot with a `title` attribute that hid the note's content. Now each pin is a numbered button; clicking opens a popover with the note and a remove button. Draft popover keeps Enter-to-save / Escape-to-cancel and adds a Cancel button.
- **Spine events sort by timestamp, not push order.** Replaced `.slice(-6).reverse()` with an explicit `sort((a,b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0,6)` so out-of-order event backfills can't reorder the feed.
- **Compose actions spacing.** Bumped the icon-group gap from `--space-1` to `--space-3`, with an extra `--space-2` left-margin on the primary Send button. The buttons read as a group but no longer touch.

## 2026-04-22 — Low-value suggestions and the workspace-brief drawer were cut

The "Switch workspace (N in this project)" suggestion in HomeTabB was flagged as low-value — the user doesn't actually need a suggestion to open the quick switcher, and the row took up a slot better used for an attention item or a continue-on-active prompt. Removed. Similarly, the workspace brief drawer (vision / focus / attention / autonomy rows) was flagged as unclear — it duplicated what Panels mode already shows and the Show/Hide button introduced a second click target without a clear payoff. Removed entirely; Panels mode remains the canonical drill-in for that information, one toggle away.

## 2026-04-25 — Phase 13.F: write-time hook seam, debounce in-flight join, prototype-block hardening

- **Write-time hook seam, not store interceptor.** The `code-change` summary hook lives on `AppCore`, not inside `EventStore`. Tracks call `append_artifact_with_summary_hook(draft)` instead of `store.append`. Consequence: replays are bit-for-bit deterministic (the stored summary is whatever was written, never regenerated), and `EventStore` stays agnostic to `LocalOps`. Cost: a bypass is possible (a track that calls `store.append` directly skips the hook). Mitigation: a grep-able `TODO(13.F-wiring)` marker + module-doc note in `core_local.rs` + ADR 0003 amendment.
- **Debounce shares one in-flight future across concurrent callers.** First-pass `SummaryDebounce` cached only resolved values, so two callers 100ms apart over an 800ms helper would each spawn a helper round-trip. The fix: `SummarySlot` is a sum type — `Resolved { ts, summary }` for cached values, `Inflight { tx: watch::Sender<Option<String>>, started }` for pending calls. Subsequent claimants subscribe to the inflight watch instead of dispatching their own request. Pattern: any "expensive call coalesces under a key" cache should track in-flight separately from resolved.
- **`watch::Ref` is not `Send`** — when joining an in-flight future, clone the value out and drop the borrow guard before any further `.await` that might cross thread boundaries. Otherwise `tokio::spawn` rejects the future.
- **`Weak<AppCore>` for detached lifetime-extending tasks.** Late-return tasks (helper exceeded 500ms but eventually returned) used to hold `Arc<AppCore>` — a slow helper would extend AppCore's lifetime past shutdown. Now: `Arc::downgrade(self)` + `weak.upgrade()` at task-resume; bail when None. Pattern for any spawn that outlives the originating call.
- **Cross-workspace boundary on the IPC, not in-memory.** `AuditArtifactRequest` requires `expected_workspace_id`; mismatch returns `IpcError::InvalidRequest`. Frontends that don't know the target's workspace shouldn't be auditing it. Future-proofs the seam for per-workspace authorization in 13.G.
- **`projector.artifact()` is policy-free; archival policy lives at the boundary.** The projector preserves history including archived artifacts (a `Some(_)` lookup tells you the artifact exists at all); the audit/recap surface decides "don't audit something archived" by checking `target.archived_at.is_some()`. Avoids building per-call filtering into the core projection.
- **Restrictive sandbox + injected CSP for inline-HTML iframes.** The lab demo path uses `sandbox="allow-forms allow-pointer-lock"` because variant exploration is interactive. The artifact-thread path is preview-only, so it drops every token (`sandbox=""`) — which incidentally blocks form submission and protects against `<form action="https://attacker">` exfiltration. CSP `<meta>` is also injected (`form-action 'none'`, `script-src 'none'`, …) as defense-in-depth: two independent layers.
- **Eviction policy: prune expired before evict-oldest.** `SummaryDebounce` opportunistically prunes expired `Resolved` entries on each `claim`; only when the table is at the hard cap does it evict the oldest live `Resolved`. `Inflight` is never evicted (would error every awaiter). Pattern for any bounded cache where some entries are "in flight" with awaiters.
- **Author-role registry as a constant module.** The pattern `Some("auditor".into())` was scattered across multiple call sites; the per-track review flagged it as drift surface. `designer_core::author_roles` exports `RECAP`, `AUDITOR`, `AGENT`, `TRACK`, `SAFETY`, `WORKSPACE_LEAD` constants; downstream tracks should import these instead of inlining strings.
- **`ArtifactDraft` packed-arg struct.** Clippy's `too_many_arguments` ceiling is 7; the natural shape of `ArtifactCreated` is 7 fields, so adding a single field (e.g., `causation_id`) would push past it. Packing into `ArtifactDraft` future-proofs the boundary and gives downstream tracks a typed builder symmetric with the event payload.
- **Local timezone for "Wednesday recap" with UTC fallback.** `time::OffsetDateTime::now_local().unwrap_or_else(|_| now_utc())` — the local-offset feature can fail in sandboxed CI envs where TZ resolution doesn't work; UTC fallback keeps the label non-empty (and at most an hour off) without panicking. Pattern: any user-facing time label should fall back gracefully.
