# Generation log

> Append-only record of UI generation events in this project. Do not edit existing entries. See Mini plan §7.8 for schema and use.

## How to read this file

Each entry is one firing of a Mini skill that produced or modified UI code. Entries are appended in chronological order — newest at the bottom. Fields are consistent across all entries so the file is machine-readable as well as human-readable.

| Field | Meaning |
|---|---|
| Timestamp header | `## YYYY-MM-DDTHH:MM:SSZ — <skill-name>` |
| `prompt` | The user intent that triggered the skill. Quoted verbatim. |
| `trigger` | Which skill fired. `generate-ui` is primary; individual skill names appear when invoked directly. |
| `archetype-reused` | Archetype the generation wrapped, or `none`. |
| `components-reused` | Existing components extended or composed. `[]` if none. |
| `components-new` | New components introduced by this generation. `[]` if none. |
| `primitives` | Mini primitives used in the output. |
| `tokens` | Design-language tokens referenced by the output. |
| `invariants` | `N/M pass`. Full pass = `M/M pass`. Failures listed on indented lines. |
| `deviations` | Values or patterns that don't match the design language. `none` if clean. |
| `feedback` | `accepted` / `rejected` / `change-requested` / `pending`. User fills this in on the next turn if not already set. |

## How to use this log

- **`elicit-design-language` amendment mode** reads this file for recurring deviations. Repeated `#2a2a2a` appearances with `feedback: accepted` become a candidate new token.
- **Skill regression testing** re-runs recent prompts against modified skills. Compare invariant results and trigger fires before/after.
- **Trigger audit** (plan §13.6) uses `trigger` field + `prompt` to measure `generate-ui` hit rate on real intents.

## Entries

## 2026-04-21T02:00:00Z — manual (phase 8–10 build)
- prompt: "Execute phases 8–10 of the roadmap: frontend foundation, core surfaces, design lab."
- trigger: manual (skill not invoked; Mini procedure followed by hand per CLAUDE.md §Procedure)
- archetype-reused: radix-dialog pattern (hand-rolled because Mini's Dialog archetype wasn't wired yet in Phase 8)
- components-reused: none (first pass)
- components-new: AppShell, ProjectStrip, WorkspaceSidebar, MainView, ActivitySpine, QuickSwitcher, HomeTab, PlanTab, DesignTab, BuildTab, BlankTab, StreamingText, Onboarding, ComponentCatalog, PrototypePreview, AnnotationLayer, VariantExplorer
- primitives: (none used — inline markup throughout. Tracked as tech debt; see pattern-log.md "Mini primitives deferred".)
- tokens: --space-1..8, --radius-badge/button/card/modal/pill, --type-caption/body/lead/h1..4-size/leading, --motion-interactive/enter/pulse/blink, --gray-1..12, --success-*, --warning-*, --danger-*, --info-*, --focus-outline-*, --elevation-raised/overlay, --border-thin/strong, --breakpoint-md/lg
- invariants: 6/6 pass
- deviations: Mini primitives (Box/Stack/Cluster/Sidebar/Center/Container/Frame) not used; layout handled with CSS grid + flex in app.css. Agent-produced prototype HTML uses CSS system colors instead of tokens (intentional — sandboxed content is outside Designer's design surface).
- feedback: accepted

## 2026-04-21T14:15:00Z — manual (review pass)
- prompt: "Review the Phases 0–11 build and implement prioritized fixes."
- trigger: manual (multi-role review: staff engineer, staff designer, staff design engineer)
- archetype-reused: none
- components-reused: all existing components (a11y + semantic fixes in place)
- components-new: none
- primitives: (unchanged — still deferred; see pattern-log.md)
- tokens: --border-thin, --motion-pulse, --motion-blink added to fork-and-own tokens.css; all new usage passes invariants
- invariants: 6/6 pass
- deviations: documented h1→h2→h3 hierarchy repair, `aria-labelledby`/`aria-controls` on tabs↔panels, skip-to-content link, focus trap on quick-switcher dialog
- feedback: pending

## 2026-04-21T19:25:00Z — manual (phase 12.C shell)

- prompt: "Create a plan for phase 12C on the roadmap… proceed with implementation."
- trigger: manual (Tauri shell bootstrap, not a Mini UI skill)
- archetype-reused: none
- components-reused: ProjectStrip (added drag-region spacer inside)
- components-new: none (no new React components; additions are Rust-shell surfaces)
- primitives: (unchanged)
- tokens: --space-2, --space-3, --space-6 (strip padding + drag-spacer sizing); no new tokens
- invariants: 6/6 pass
- deviations: `data-tauri-drag-region` attribute is Tauri-runtime-specific markup, not an a11y or design concern — the attribute is inert in the web/mock build
- feedback: accepted

## 2026-04-21T20:00:00Z — manual (phase 12.B, three-lens plan + backend impl)
- prompt: "review the codebase and core docs and create a plan for phase 12B on the roadmap from the perspective of a staff UX designer, staff engineer, and staff designer engineer. Once you complete the plan, review it for optimizations and apply them, then surface any questions or decisions that need my consultation"
- trigger: manual (three-lens plan → backend implementation; no UI surfaces touched)
- archetype-reused: none
- components-reused: none
- components-new: none — intentional zero-UI deliverable
- primitives: none used (no frontend files touched)
- tokens: none touched
- invariants: n/a (no frontend files modified)
- deviations: none. The design-engineer lens specifically argued for zero UI: FB-0007 (invisible infrastructure) and FB-0002 (suggest, don't act) govern. Helper provenance belongs at the artifact (Phase 13.F output) not the chrome — see pattern-log entry "Local-model provenance belongs at the artifact, not the chrome". Vocabulary strings ("Summarized on-device" / "Fallback summary") drafted in pattern-log for 13.F to adopt.
- feedback: pending

## 2026-04-21T22:45:00Z — manual (home variants + sand palette)
- prompt: "UI critique — too many text sizes, everything feels cramped; move off mauve to a warm sand/beige neutral; test Direction A (quieter dashboard) and Direction B (palette-first home) as switchable variants."
- trigger: manual (Mini procedure followed by hand; generate-ui not invoked because this was a paired design + refactor across the token layer and two new components)
- archetype-reused: none
- components-reused: state-dot pattern from app.css, main-topbar structure, store/app pattern (toggleInbox, toggleQuickSwitcher)
- components-new: HomeTabA (quieter dashboard, panels-not-cards), HomeTabB (palette-first with collapsible brief), VariantToggle (in MainView, Panels / Palette pill)
- components-removed: HomeTab (bordered-card grid; replaced by A and B)
- primitives: (still deferred — see pattern-log.md "Mini primitives deferred")
- tokens: swapped mauve → sand at the Radix import layer; new usage of --type-lead-size, --type-caption-size, --radius-modal, --radius-pill, --radius-badge, --weight-medium, --color-surface-flat/raised/overlay, --color-border, --motion-interactive, --border-thin, --focus-outline-* ; no arbitrary px/hex/ms introduced
- invariants: pending (node_modules not installed in this workspace — defer run to next CI/dev boot)
- deviations: variant-toggle uses runtime localStorage persistence (not event-sourced); acceptable for a pre-ship UX decision tool, not durable state.
- feedback: pending

## 2026-04-21T23:15:00Z — manual (phase 12.B, two-lens review pass)
- prompt: "review the implementation from the perspective of a staff ux designer, and a staff engineer. converge on a prioritized list of improvements and optimizations, and fix any errors. When everything is optimized, update core docs and prepare a PR"
- trigger: manual (two-lens post-implementation review + applied fixes)
- archetype-reused: none
- components-reused: none
- components-new: none — review was backend-only, zero UI touched
- primitives: none used
- tokens: none touched
- invariants: 6/6 pass (re-verified after all fixes)
- deviations: none. Vocabulary refined to three provenance strings ("Summarized on-device" / "Local model briefly unavailable" / "On-device models unavailable") matching the new `recovery` taxonomy, all logged in pattern-log. "Fallback summary" draft retired — the UX reviewer caught that `NullHelper::generate` returns a diagnostic marker, not a summary.
- feedback: pending

## 2026-04-22T02:30:00Z — manual (agentation 16-annotation pass)
- prompt: "Annotations from Agentation: 16 notes on compose panel, spine summary, topbar alignment, tabs bar, template menu, close affordances, sidebar home alignment, workspace 'new' button, project strip toggle, workspace status icons, tab sizing, spine indentation, send icon, compose icons + drag-drop, compose footer."
- trigger: manual (user-directed batch fix; Agentation MCP not connected — annotations pasted into conversation)
- archetype-reused: variant-toggle, template-menu (reused with icon additions)
- components-reused: MainView, WorkspaceSidebar, ActivitySpine, PlanTab, AppShell, ProjectStrip, ipc types/mock/client
- components-new: TemplateIcon + IconBranch + IconPlus + IconHome + WorkspaceStatus glyphs inlined in call sites
- primitives: (still deferred)
- tokens: new uses of --info-11 / --warning-11 / --danger-11 / --success-11 (semantic colors for workspace status); --motion-pulse / --motion-interactive; no arbitrary values introduced
- invariants: 6/6 on all touched files
- deviations: PlanTab mic button left as a visible placeholder (disabled + "Coming soon") until Phase-13 dictation lands; workspace-status model extended in TS only (Rust-side IPC drift tracked under Phase 13.E).
- feedback: accepted

## 2026-04-22T23:15:00Z — manual (staff review + polish pass)
- prompt: "Review the implementation from the perspective of a staff UX designer, a staff engineer, and a staff design engineer. Converge on a prioritized list of improvements, fix errors, update the design language to reflect what we've built."
- trigger: manual (three-role staff review via parallel Explore audits; converged fix list implemented)
- archetype-reused: existing compose dock, tab button, variant toggle
- components-reused: MainView, ActivitySpine, HomeTabA, HomeTabB, PlanTab, Onboarding
- components-new: none (pure polish + correctness pass)
- primitives: (still deferred; tracked as G12)
- tokens: added --icon-sm / --icon-md / --icon-lg to packages/ui/styles/tokens.css as the icon-size family (axiom #13). Fixed 5 consumer-side references from --type-weight-* → --weight-* (non-existent token); applied the same fix in Onboarding.tsx. Added box-shadow focus-within ring on .compose wrapper using existing --focus-outline-* tokens.
- invariants: 6/6 on all touched files; typecheck clean; 14/14 tests pass (new tests for closeTab and variant-toggle).
- deviations: TabContent keyed by `${workspace.id}:${activeTab}` to force remount on workspace switch (prevents PlanTab draft state from bleeding across workspaces). PlanTab serializes model/effort/planMode into the outgoing message body as a temporary measure until Phase 13.D carries them as first-class fields.
- feedback: accepted

## 2026-04-22T07:45:00Z — manual (22-annotation UX-feedback pass)
- prompt: "Review the code and implement this frontend feedback from the perspective of a staff UX designer and staff design engineer team. Keep the code clean and performant and stay aligned with the design system and design language. Evolve the system docs based on the feedback."
- trigger: manual (22 annotations in a single paste, implementation + doc evolution in one pass)
- archetype-reused: compose dock, tab button, variant toggle, state-dot, workspace-status glyphs
- components-reused: AppShell, ProjectStrip, WorkspaceSidebar, ActivitySpine, MainView, HomeTabA, HomeTabB, PlanTab, DesignTab
- components-new: Tooltip (immediate-on-hover popover with shortcut-as-kbd slot), IconButton (single icon-only archetype, sm/md hit targets, primary filled variant), AppDialog (Settings + Help modal stubs)
- components-removed: sidebar-group__add class (superseded by IconButton); home-b__brief / home-b__brief-row / home-b__brief-label / home-b__brief-body / home-b__brief-toggle (drawer cut — Panels mode is the canonical drill-in); compose__inline-actions and compose__icon-btn (consolidated into .btn-icon + .compose__actions); main-topbar__title / main-topbar__sep / main-topbar__project / main-topbar__meta (topbar minimized)
- primitives: (still deferred; tracked as G12)
- tokens: added --target-sm (24px) and --target-md (32px) to packages/ui/styles/tokens.css (axiom #14 — hit-target sizing). No other token additions — every surface change composes from existing tokens.
- axioms: three updates. #14 new (hit-target sizing). #15 new (three text roles in app chrome — caption / body / h3). §Patterns expanded with: Tooltip-component-not-title, IconButton-as-single-archetype, entire-control-is-focus-target, chat asymmetry (user bubbles, agent on surface), project-strip utility cluster, project-scoped spine, sidebar/spine toggles + drag handles, topbar minimalism, trailing '+' IS a tab, palette bounded/open densities.
- app-store: added paletteDensity, sidebarVisible, spineVisible, dialog to AppState; three localStorage-persisted keys (designer.paletteDensity, designer.sidebarVisible, designer.spineVisible).
- keyboard: added ⌘[ (toggle workspaces), ⌘] (toggle activity), ⌘? (open Help). Existing ⌘K / ⌘T / ⌘W / ⌘\\ / ⌘↵ retained.
- invariants: 6/6 on the 27 files in packages/app/src.
- typecheck: clean (tsc --noEmit).
- tests: 14/14 pass. Updated tabs.test.tsx "renders the project name as h1 in the topbar" → "renders the active project name in the sidebar" to match the new IA.
- deviations: the hover-revealed .pane-toggle handles toggle-on-click only; drag-to-reorder to different shell sides is deferred — the handles are the anchor for that future pass. Settings + Help dialogs ship as read-only stubs (Appearance / Account / Models / Preferences in Settings; question input + kbd list + About in Help); wiring to the real settings core is Phase 13 scope. The Tooltip uses a magic-number 6px gap in its JS positioning math (client pixels, not a token) — acceptable because getBoundingClientRect returns client-pixel coordinates; a follow-up could read --space-2 from computed style.
- feedback: accepted

## 2026-04-22T08:45:00Z — manual (second UX-feedback pass, 8 annotations)
- prompt: "Review comments on the updated build: spine events should be newest-first; compose actions too cramped; blank tab should be the palette; annotation pins aren't viewable after save; workspace topbar reads as a bullet, kill it and make tabs the top; panes should actually be resizable; model info shouldn't appear inside user message; tabs-bar container shouldn't fill or have a separator."
- trigger: manual (annotation pass #2 on the evolved surface)
- archetype-reused: compose dock, tab button, IconButton, Tooltip, variant toggle
- components-reused: AppShell, WorkspaceSidebar, ActivitySpine, MainView, HomeTabB, PlanTab, AnnotationLayer, BlankTab
- components-new: Palette (shared prompt+suggestions primitive), PaneResizer (drag-to-resize edge handle)
- components-removed: pane-toggle click-button pattern (replaced by PaneResizer); BlankTab's card-based prompt-suggestions layout (replaced by Palette)
- primitives: (still deferred; tracked as G12)
- tokens: no new tokens. Width constants (PANE_MIN_WIDTH=180, PANE_MAX_WIDTH=480, PANE_DEFAULT_WIDTH=256) are product constants in store/app.ts — resizing is a product behavior, not a tokenized value.
- app-store: added sidebarWidth, spineWidth to AppState; clampPaneWidth helper; setSidebarWidth / setSpineWidth actions; two new localStorage keys (designer.sidebarWidth, designer.spineWidth).
- axioms: no new axioms. §Patterns added: palette-is-the-blank-tab-surface, workspace-view-has-no-topbar, tabs-bar-is-transparent, panes-are-resizable-not-just-togglable, compose-metadata-in-payload-not-body, annotations-are-first-class-objects.
- invariants: 6/6 on 29 files in packages/app/src.
- typecheck: clean.
- tests: 14/14 pass.
- deviations: Duplicate-key warning in spine events is fixed by including the index in the key, because the mock seeds duplicate stream_id+sequence pairs across workspaces — a mock-data fix would be cleaner and is tracked for the next ipc/mock.ts pass.
- feedback: accepted

## 2026-04-22T09:15:00Z — /simplify (staff review on the UX-feedback pass)
- prompt: "Review the changes from the perspective of a staff UX designer and a staff design engineer, and make any fixes or optimizations. Use /simplify and ensure that the design system (and its docs) are in alignment and updated to evolve based on the feedback."
- trigger: /simplify (three parallel audits: reuse, quality, efficiency; converged fix list applied in sequence)
- archetype-reused: all existing (IconButton, Tooltip, Palette, PaneResizer)
- components-reused: everything in the diff
- components-new: components/icons.tsx (shared icon set), components/SegmentedToggle.tsx (generic two-to-N pill), util/cx.ts, util/persisted.ts
- components-removed: VariantToggle's bespoke markup (replaced by SegmentedToggle); all inline copies of IconX, IconPlus, IconCollapseLeft/Right across AppShell, ActivitySpine, WorkspaceSidebar, MainView, ProjectStrip, AppDialog, PlanTab
- css-renames: .variant-toggle → .segmented-toggle; .home-b* → .palette* (palette surface class renamed from palette__palette → palette__surface)
- store changes: replaced 4 bespoke readStored* helpers with `persisted()` instantiations; every setter now short-circuits on same-value via `Object.is(s, s)` so store listeners don't fire on no-op updates; split `setSidebarWidth` / `setSpineWidth` into `{setSidebarWidthLive, commitSidebarWidth}` and the equivalent for the spine — live updates during drag, persist on release.
- PaneResizer: `onLiveChange` + `onCommit` prop split (was single `onCommit`), `aria-valuemin`/`aria-valuemax` added, `hasPointerCapture` guard before releasing.
- Tooltip: scroll/resize listener now rAF-coalesced and passive.
- IconButton: `aria-pressed` only rendered when `pressed !== undefined`.
- HomeTabB: `needsYou` memoized so the downstream `useMemo` doesn't invalidate on every event tick.
- primitives: (still deferred; tracked as G12)
- invariants: 6/6 on 31 files.
- typecheck: clean.
- tests: 14/14 pass.
- deviations: none added. Tooltip cloneElement + ref-forwarding still works as-is; noted in the audit as a Slot-pattern candidate but deferred — no caller is breaking. AppDialog kind/open split skipped: two dialogs is fine as a union.
- feedback: pending

## 2026-04-22T22:00:00Z — manual (floating-surface register + SurfaceDevPanel)
- prompt: "Transition the main chat/content panel to appear as a floating rectangle with rounded corners ... sidebars should appear as the main page surface ... tabs sit above the floating surface ... selected tab has a clear selected state ... build in a dev panel to test the gutter ... shadow intensity ... three tab-style options"
- trigger: manual (UI direction change + live-tuning dev panel request)
- archetype-reused: SegmentedToggle (gutter + tab-style), native range input (shadow)
- components-reused: IconButton, SegmentedToggle, Tooltip (via SegmentedToggle)
- components-new: SurfaceDevPanel (replaces TypeDevPanel — the type knobs no longer earn their slot)
- components-removed: TypeDevPanel.tsx + the entire .type-dev__* CSS block
- css-new: .main-surface (Tier-2 floating rectangle), [data-tab-style="A"|"B"|"C"] branches on .app-shell, three .tab-button[data-active="true"] selectors + one .tab-button default, .surface-dev__* class family
- css-modified: .app-sidebar / .app-spine / .pane-rail — background and borders removed (sidebars now sit on --color-background); .app-main — padding driven by --surface-gutter with a branch for the collapsed-sidebar case; .main-topbar — background dropped, padding tightened to align with surface edge
- store changes: none (dev panel persists to localStorage directly)
- tokens-new: --surface-gutter (defaults to --space-3, 8px; panel switches between 8 / 12 / 16 px); --surface-shadow (defaults to --elevation-raised; panel switches between none / subtle / subtle+ / subtle-medium)
- axioms: #8 amended — two-tier page / floating-surface register codified for the workspace view. Pattern-log entry "Two-tier surface register" details the active-tab seam trick.
- invariants: to be run on the final set of changed files.
- typecheck: clean.
- tests: to be re-run.
- deviations: shadow values in SurfaceDevPanel.tsx are inline rgba literals — intentional: they live in a JS Record, not a .css file (the invariants scanner checks .css and .tsx hex literals, not runtime-injected inline styles). If a value is pinned to production it moves to tokens.css as a new --elevation-* step.
- feedback: pending

## 2026-04-22T23:30:00Z — manual (lucide-react adoption + inline-SVG sweep)
- prompt: "tell me what icon library we are using. we should be using lucide or phosphor" → "yes - go with lucide"
- trigger: manual (library consolidation + inline-SVG sweep)
- archetype-reused: none
- components-reused: IconButton, Tooltip, SegmentedToggle (unchanged; consumers now pass Lucide icons as children)
- components-new: none
- components-removed: 22 hand-rolled inline `<svg>` glyphs across ProjectStrip (Settings, Help), WorkspaceSidebar (Home + 7 status), MainView (4 template icons + 2 variant-toggle icons), PlanTab (Attach, Mic, Send, PlanMode, Chevron), BlankTab (Summary, Compass, Report, Spec), HomeTabB (Alert, Branch, Plan, Report)
- icons.tsx: rewritten as thin wrappers around lucide-react. IconX, IconPlus, IconBranch, IconChevronLeft/Right, IconCollapseLeft/Right keep their existing call sites; defaults follow axiom #13 (12/14/16 px, 1.25 stroke at sm/md, 1.5 at lg). One-off glyphs import from lucide-react directly in the consumer file rather than sharing through the wrapper (rule of three).
- lucide mappings: Settings → Settings, HelpCircle → HelpCircle, Home → House, Circle/LoaderCircle/Eye/GitPullRequest/AlertTriangle/Check/GitMerge for the 7 workspace statuses, ClipboardList/Compass/ListChecks/Square for the 4 tab templates, Rows2/Search for the home variant toggle, Paperclip/Mic/ArrowUp/ChevronDown for compose controls, AlignLeft/Compass/FileText/BookOpen for BlankTab suggestions, AlertCircle/ClipboardList/FileText for HomeTabB suggestions.
- deps: added `lucide-react ^0.471.0` to `packages/app/package.json`.
- tokens: no new tokens. Icons consume size (number) and strokeWidth (number) props, matching --icon-sm/md/lg by numeric equivalence.
- axioms: #13 unchanged — all icons still flow through the 12/14/16 size family with 1.25/1.5 stroke policy.
- invariants: 6/6 on 33 files in packages/app/src.
- typecheck: clean.
- tests: 14/14 pass.
- deviations: none introduced. 0 remaining `<svg>` tags in packages/app/src.
- feedback: pending

## 2026-04-22T23:59:00Z — manual (14-item Agentation feedback pass)
- prompt: "address these comments" (feedback dump: default widths, pane-resizer visuals, border softness, compose concentricity, header alignment, Settings icon, icon sizing, Autonomy explanation, workspace rows, kicker removal, commit to Panels on home)
- trigger: manual (directed UI pass)
- archetype-reused: IconButton, Tooltip, SegmentedToggle (in Settings), TabLayout
- components-reused: WorkspaceSidebar, HomeTabA, PaneResizer, compose + tab-layout
- components-new: WorkspaceStatusIcon (extracted shared 7-glyph component from WorkspaceSidebar so HomeTabA can consume the same status vocabulary)
- components-removed: VariantToggle (inline in MainView) — home is now always the Panels layout. Palette primitive stays for BlankTab.
- css-new: --color-border-soft (gray-a5 alpha), --radius-surface (20px, in tokens.css), --surface-inner-pad (space-4). .home-a__explain. .home-a__list--workspaces grid override.
- css-modified: .main-surface (softer border, bigger radius), .tab-button borders → soft, style-B inactive opacity 60% → 80%, .tab-layout__scroll + __dock use --surface-inner-pad, .tab-layout__dock-inner drops max-width so compose fills width, .compose border-radius = calc(--radius-surface - --surface-inner-pad) = 4px (concentric), .compose border → soft. .pane-resizer: removed ::before hairline + hover/drag fills — cursor-only feedback; positioned at calc(--surface-gutter * -1) so the handle sits at the floating-surface edge. .sidebar-header__row + .spine-header__row gained min-height var(--target-md) so their titles center-align with tab labels.
- store changes: removed dashboardVariant / setDashboardVariant / cycleDashboardVariant / variantStore (home is always Panels).
- HomeTabA: dropped kicker + kicker hint; workspace-list rows now render WorkspaceStatusIcon (matches sidebar) instead of a bare state-dot; Autonomy section gained a one-paragraph explanation above the pill.
- ProjectStrip: Settings icon swapped from Lucide `Settings` (sun-like) → `Cog` (explicit gear). Settings/Help/New-project bumped from 14px → 16px with strokeWidth 1.5 so they read at the same visual weight as each other.
- MainView: removed home-view main-topbar (no variant toggle needed). HomeTabA always renders. Lucide Rows2 + Search imports removed.
- tests: removed "Home variant toggle" test. 13/13 now pass.
- axioms: #8 unchanged (register still two-tier). --radius-surface, --color-border-soft added as project tokens — candidate upstream if Mini ever adopts. Axiom #13 unchanged (icon family still 12/14/16).
- invariants: 6/6 on 33 files.
- typecheck: clean.
- tests: 13/13 pass.
- deviations: none. Golden-ratio layout request is satisfied by the existing PANE_DEFAULT_WIDTH=256 + project-strip ~64px ratio at the 1500px viewport target (main ≈ 924px ≈ 0.62 × width). Not hard-coded; uses existing defaults.
- feedback: pending

## 2026-04-23T05:30:00Z — manual (second Agentation feedback pass, 11 items)
- prompt: "address these comments" (second feedback dump: inner padding knob, lede deletion, compressed workspace rows, needs-you prominence, Autonomy SegmentedToggle, sidebar branch chip removal, bare Palette input, BuildTab as chat)
- trigger: manual (directed UI pass)
- archetype-reused: SegmentedToggle (Autonomy, dev panel), StreamingText, TabLayout, compose dock
- components-reused: WorkspaceStatusIcon, Palette
- components-new: none
- components-removed: `.home-a__lede`, `.home-a__autonomy` (pill), `.workspace-row__branch`, BuildTab's task-board + merge-gate-panel layout (replaced by chat surface)
- css-new: `.chat--build`, `.chat__body--mono`, `.compose__hint`. Palette open-density overrides now strip border/background/padding from the input (Notion/Linear bare-text feel).
- css-modified: Palette open-density rule set bare (no chrome on input). `.workspace-row` grid template shrunk from 3 columns to 2 (branch chip dropped). `.home-a__list--workspaces` meta column now carries a workspaceSummary text instead of the branch.
- store changes: `densityStore` default flipped from "bounded" → "open" — Palette surfaces now open by default.
- SurfaceDevPanel: added fifth knob, "Inner" (range 4–40px) → `--surface-inner-pad` on `:root`. Defaults 16px (unchanged ship default). All knob values persist together under the same `designer.dev.surfaceOverrides` key; old stored values without `innerPad` fall back to the default on read.
- HomeTabA: rewrote the section order so "Needs your attention" renders first when non-empty and is hidden entirely when empty. Lede paragraph removed. Workspace rows now show a one-line `workspaceSummary(w)` (first open tab title or "no open tabs") instead of the branch chip. Autonomy section swapped the bespoke pill for a real SegmentedToggle (matching the Theme picker's UX); onChange is a Phase-13 TODO (no IPC write yet), so the control renders the current value read-only for now.
- WorkspaceSidebar: workspace row drops `.workspace-row__branch`. Branch still travels in the `title` attribute for hover.
- BuildTab: rewritten as a chat/terminal surface — no task board, no approval-panel card. Builder streams output; user sends instructions or `/merge`. Approval gate is still enforced in the Rust core (spec §5); `/merge` is just the UI trigger. Uses the compose dock + `StreamingText` + `.chat` classes for visual continuity with PlanTab.
- Palette: `open` density input is now chrome-free (padding only on left/right to match suggestion rows, no border, no fill). `bounded` density unchanged. Global default density flipped to `open` in the store.
- deferred / backlog:
  - Feedback #4 (replace lede with project-state summary sourced from core-docs): needs Phase 13.D to wire roadmap/plan `.md` reads into the home projection. Removed the lede now; replacement deferred.
  - Feedback #8 (move ComponentCatalog from DesignTab to home): surface-restructuring change, tracked as backlog.
  - Feedback #9 (consolidate ProjectStrip into WorkspaceSidebar bottom): user noted as "not committed"; parked as exploratory.
- invariants: 6/6 on 33 files.
- typecheck: clean.
- tests: 13/13 pass.
- deviations: none.
- feedback: pending

## 2026-04-23T06:00:00Z — manual (lock surface config, retire SurfaceDevPanel)
- prompt: "let's go with 16px - lock in the config and get rid of this dev panel for now"
- trigger: manual (config freeze after live tuning)
- archetype-reused: n/a
- components-reused: n/a
- components-new: none
- components-removed: `packages/app/src/dev/SurfaceDevPanel.tsx` (the component itself) + `packages/app/src/dev/` (empty directory removed) + the entire `.surface-dev__*` CSS block (~190 lines). Dead `type-dev__hint` rule also removed. Agentation still mounted in dev.
- css-modified: `:root` surface defaults locked: `--surface-gutter` → `calc(var(--space-3) * 1.5)` (12 px), `--surface-tab-gap` → `calc(var(--space-2) * 1.5)` (6 px), `--surface-text-pad` stays `var(--space-5)` (24 px, fixed), `--surface-inner-pad` stays `var(--space-4)` (16 px), `--surface-shadow` stays `var(--elevation-raised)`. Tab style A is still the default (no `data-tab-style` attribute set).
- App.tsx: removed `SurfaceDevPanel` import + dev-only mount.
- localStorage: the `designer.dev.surfaceOverrides` key is orphaned (no consumer reads it). Left in place to avoid touching user state; a future cleanup can drop it.
- axioms: #8 unchanged — register + tokens are the same; only the default values moved from "applied via inline style on :root" to "written into app.css :root directly". pattern-log.md entry "Surface config locked, dev panel retired" records the final values + rationale.
- invariants: 6/6 on 32 files (was 33; the dev panel file is gone).
- typecheck: clean.
- tests: 13/13 pass.
- deviations: none.
- feedback: pending

## 2026-04-23T17:55:00Z — manual (17-item Agentation feedback pass, ottawa-v1 recovery)
- prompt: 17 Agentation comments recovered from Dia's leveldb for origin `http://localhost:5184` (kingston/ottawa/prague-era session). User asked to address them all.
- trigger: manual (feedback attachment at `.context/attachments/pasted_text_2026-04-23_17-46-09.txt`)
- archetype-reused: Sidebar (SettingsPage left rail), Overlay (full-screen page layer)
- components-reused: IconButton, Tooltip, SegmentedToggle, PaneResizer (extended)
- components-new: `SurfaceDevPanel.tsx` (re-introduced with two knobs: compose fill, surface sand), `SettingsPage.tsx` (full-screen replacement for the settings modal)
- components-modified:
  - `icons.tsx`: default size for IconPlus, IconChevronLeft/Right, IconCollapseLeft/Right bumped 12 → 16 so chrome affordances match the ProjectStrip Plus (the user's reference)
  - `WorkspaceStatusIcon.tsx`: glyph size 12 → 16, container class sized from `--icon-sm` → `--icon-lg`
  - `WorkspaceSidebar.tsx`: Home icon 14 → 16 stroke 1.5; sidebar-path upgraded to a `<button>` that calls `reveal_in_finder` in Tauri (TODO: 13.E Rust shim) with a clipboard fallback in the web build
  - `PlanTab.tsx`: compose action icons (Paperclip, Mic, ArrowUp) bumped 14 → 16
  - `ActivitySpine.tsx`: rewritten — strictly workspace-scoped (no project fallback); new section stack is Artifacts → Code files → Agents → Recent events; artifacts open as tabs via `openTab({ template: "blank" })` until a real artifact TabTemplate lands
  - `AppDialog.tsx`: now only renders Help; settings body + theme picker extracted into SettingsPage
  - `PaneResizer.tsx`: adds snap-to-default-width with a 12px snap radius and 20px release threshold; fires `navigator.vibrate(8)` haptic on snap entry
  - `App.tsx`: mounts SurfaceDevPanel (dev-only) and swaps SettingsPage in for AppShell when `dialog === "settings"`
  - `Palette.tsx`: adds a leading Search icon in the prompt (aligned to the suggestion-icon column); removes the `.palette__suggestion-meta` role-label column
- css-modified:
  - `--surface-tab-gap`: `calc(var(--space-2) * 1.5)` → `0` (tabs flush against main surface per item #1)
  - `--surface-inner-pad`: `var(--space-4)` → `var(--space-3)` (preserve concentric math after the surface-radius reduction)
  - `--radius-surface`: `1.5rem` → `1rem` (reduced per item #15; compose radius is now a clean `--radius-button` neighbor)
  - `.strip-icon` radius: `--radius-card` → `--radius-button` (item #6, match tabs)
  - `.tab-button`: inactive fill = `color-mix(…content-surface 80%, transparent)`; font size `body` → `caption`; bottom radius squared so active tab merges visually into surface
  - `.compose__input` padding equalized to `var(--space-3)` (item #17); `.compose__select` + `.compose__toggle` radii bumped to `--radius-button`
  - `.sidebar-path` restyled as a clickable button with hover/focus states
  - `.app-sidebar` / `.app-spine`: `overflow` switched from `auto` → `visible` so PaneResizer isn't clipped; scroll ownership moved to `.sidebar-group` / `.spine-list`
  - `.pane-resizer` width `--space-2` → `--space-3` (wider grab target, still no visible bar)
  - `.workspace-row` + `.workspace-status` icon columns/containers sized at `--icon-lg`
  - dark-mode `--color-content-surface` flipped to `color-mix(in oklab, var(--sand-dark-1) var(--dev-surface-sand), var(--sand-dark-3))` so the new dev slider spans both modes
  - new `.surface-dev-panel__*`, `.settings-page__*`, `.spine-items`, `.spine-item` blocks
- tokens: `--radius-surface` reduced to 1rem (16px) in `packages/ui/styles/tokens.css` — only Designer project-level token, not a Mini primitive
- feedback-mapping (1 → 17):
  - 1 (tabs flush with main) — `--surface-tab-gap` = 0, bottom-corners of active tab squared
  - 2 (icons too small across the site) — WorkspaceStatusIcon + icons.tsx defaults → 16; see 8, 9
  - 3 (Palette search icon) — added leading Search icon in `palette__prompt`
  - 4 (remove role labels) — dropped `.palette__suggestion-meta` and the third grid column
  - 5 (unselected tab fill) — semi-transparent color-mix on `.tab-button`
  - 6 (strip-icon corner radius) — switched to `--radius-button`
  - 7 (sidebar-path clickable) — `<button>` + `reveal_in_finder` IPC (TODO) + clipboard fallback
  - 8 (Home icon size) — `<House size={16} strokeWidth={1.5} />`
  - 9 (reference icon size) — baseline for the icon-size sweep
  - 10 (compose color dev panel) — SurfaceDevPanel "Compose fill" slider → `--dev-compose-mix`
  - 11 (surface sand dev panel) — SurfaceDevPanel "Surface sand" slider → `--dev-surface-sand`; default 50% so there's symmetric travel in both directions
  - 12 (resizable + sticky default) — fixed overflow-clipping on pane containers; added snap + `navigator.vibrate(8)` on snap entry
  - 13 (ActivitySpine restructure) — workspace-only scope + four-section stack (Artifacts / Code files / Agents / Recent events)
  - 14 (Settings dialog → page) — new SettingsPage full-viewport surface with left rail, section content, "Back to app" button
  - 15 (main surface radius too large) — `--radius-surface` 24px → 16px; compose radius now 8px (concentric)
  - 16 (smaller tab font) — `.tab-button` font-size stepped down to `--type-caption-size`
  - 17 (compose model button concentric + equal padding) — compose__input padding unified at `var(--space-3)`; model button + plan-mode toggle radii → `--radius-button`
- invariants: pending node run
- typecheck: clean
- tests: 13/13 pass
- deviations: `reveal_in_finder` Rust shim not yet wired (TODO(13.E)); artifacts still open as Blank tabs until a first-class `artifact` TabTemplate lands (TODO(13.D))
- feedback: pending

---

## 2026-04-24T01:00:00Z — Phase 13.1 consolidation: unified workspace thread + artifact foundation

Consolidates the tab-model-rethink (branch `tab-model-rethink`, workspace `lisbon`) and find-agentation-server (branch `find-agentation-server`, workspace `memphis-v2`) branches into a single PR.

**From memphis-v2** (17-item Agentation feedback pass, all shipped):
- Full-page Settings (`SettingsPage.tsx`); `AppDialog.tsx` narrowed to Help-only.
- Re-introduced `SurfaceDevPanel.tsx` (⌘.) for sand / compose-mix tuning.
- ActivitySpine rewrite — workspace-scoped, four sections became three (Pinned / Artifacts / Agents / Recent events) after 13.1 collapsed the artifact-source.
- `Palette.tsx` leading search icon, meta column dropped.
- `PaneResizer.tsx` haptic snap (12/20 + `navigator.vibrate(8)`).
- 12→16 icon size audit.
- `WorkspaceSidebar.tsx` path → reveal-in-Finder button. **Backed by a real Rust shim in this PR** (macOS-only `open -R`).
- `--radius-surface: 1.5rem → 1rem`.
- Dead code removal: `HomeTabB.tsx`.

**From tab-model-rethink** (ideas promoted into production; sketch file deleted):
- Tabs are views, not modes: Plan / Design / Build / Blank tab components retired, every tab renders `WorkspaceThread`.
- Block renderer registry (`packages/app/src/blocks/`) with 12 kinds.
- `ComposeDock.tsx` adopted as the shared compose input (no longer orphaned).
- Empty-state starter suggestions on new threads.
- Pin / unpin UX surfaced in the workspace rail.
- Spec Decisions 36–39 + Decision 11 amended; Phase 13.1 in plan / roadmap; FB-0024 / FB-0025.

**Dropped:**
- Sketch file (`packages/app/src/sketch/WorkspaceThreadSketch.tsx`) — ideas absorbed, file deleted.
- lisbon's floating-surface CSS diff — PR #11 already shipped it on main with `--radius-surface` / `--color-content-surface` / `--surface-inner-pad` / concentric compose corner.
- lisbon's hand-drawn gear icon — main is Lucide.
- lisbon's embedded-in-AppDialog Settings branch — memphis's separate `SettingsPage.tsx` is cleaner.

**New Rust/IPC surface:** `Artifact`, `ArtifactKind` (12 kinds), `PayloadRef` (Inline/Hash), `ArtifactId`, five new events, `ProjectorState.pinned_artifacts`, `AppCore::toggle_pin_artifact`, four new Tauri commands (`list_artifacts`, `list_pinned_artifacts`, `get_artifact`, `toggle_pin_artifact`) + `reveal_in_finder`. Artifact round-trip test + PayloadRef serialization test.

**Handoff:**
- D/E/F/G/H can now run in parallel with zero UI contention. Each track emits `ArtifactCreated` events into the registry — no tab component work.
- `PayloadRef::Hash` path is schema-only; content-addressed store (`~/.designer/artifacts/<hash>`) is a 13.1-storage follow-up, not blocking.
- `LocalOps::summarize_row` write-time hook: reserved in 13.F scope (not blocked on UI).
- Speculative block kinds (`report`, `prototype`, `diagram`, `variant`, `track-rollup`) ship as registered stub renderers that show title + summary; their emitters land in 13.D/E/F/G.

**Design-language compliance:**
- No inline styles; no hex / px / ms values.
- New CSS selectors: `.thread`, `.thread__empty*`, `.block`, `.block__*`, `.block--*`, `.workspace-thread`, `.spine-artifact*`. All token-driven.
- A11y: every block is an `<article>` with header + author + kind badge; pin toggle has `aria-pressed`; approval-block action surface is keyboard-reachable.

- invariants: pending node run
- typecheck: clean
- tests: 13/13 frontend + 6/6 backend pass
- deviations: `PayloadRef::Hash` path is schema-only (TODO(13.1-storage)); partial-message coalescer still deferred to 13.D
- feedback: FB-0024 (tabs as views, not modes), FB-0025 (three-tier artifact presence)

---

## 2026-04-25T01:00:00Z — Phase 13.1 staff-design-engineer review pass + finalization

Polish pass after the consolidation landed; covers everything that happened between the initial Phase 13.1 generation-log entry (2026-04-24T01:00) and the PR.

**Surface architecture iterations (live design loop, behind SurfaceDevPanel):**
- Dev panel grew from 3 → 6 sliders + a tab-corner variant toggle + 2 radius sliders. Every slider is bound to a distinct `--dev-*` CSS variable.
- Tab radius default flipped Soft (12) → Match (24) — tabs and main tab container now share corner shape.
- Shadow swapped from `--elevation-raised` (single bottom-heavy 1px / 5%) to a two-layer diffuse stack (`0 1px 3px / 2%` + `0 6px 16px -2px / 6%`).
- `--radius-surface` 16 → 24px; compose corner derives to 8px.
- Selected tab now matches the main tab container exactly (fill + border + shadow); only `--surface-tab-gap` (6px) separates them.

**Sidebar restructure (#4 + #6 page feedback):**
- `.app-sidebar` horizontal padding moved onto inner blocks so workspace-row hover spans full rail width without negative-margin tricks getting clipped by sidebar-group's `overflow-y: auto`.
- Project title / root-path / Home / Workspaces label / workspace status icons all share the same 16px X column.

**Activity spine restructure (#1 page feedback round 2):**
- Same edge-to-edge hover treatment as the left sidebar applied to `.spine-artifact`. Pinned/files items use `--color-surface-raised` background, no border-radius, full rail width.
- Section labels and the spine header carry their own horizontal padding to keep the content column aligned.

**Page feedback fixes:**
- Tabs left-aligned with main tab container (tabs-bar left padding → 0).
- Tab close X bumped 10 → 16 in a 24px hit target.
- ArtifactRow secondary text removed (lives in tooltip only) so titles get the full row width.
- Compose has no top divider, fills container with 16px padding all sides.
- Sidebar Designer title + path now share 16px indent with the rest of the sidebar content.
- New-tab suggestions render as borderless rows with text + right-arrow, sourced from workspace's recent activity (latest spec / open PR / pending approval / latest code-change).

**Dark palette rebuild:**
- Bug: previous override used `var(--sand-dark-N)` which doesn't exist — Radix Colors v3 ships `--sand-N` only and rebinds under `.dark-theme`. Fixed by replacing every reference.
- Slider math reanchored: parent `sand-1↔sand-4`, main tab `sand-5↔sand-9` so the same default values (80% / 5%) produce real luminance hierarchy in dark mode.

**Staff design-engineer review fixes:**
- `core-docs/component-manifest.json` was invalid JSON (duplicated trailing fields after `WorkspaceStatusIcon`). Repaired; added 5 new entries (`WorkspaceThread`, `BlockRenderers`, `ComposeDock`, `SettingsPage`, `SurfaceDevPanel`); marked 5 deleted tabs as `retired`.
- `WorkspaceThread` re-render hot spots tightened: `fetchPayload` no longer depends on `payloads`; stream-event refresh coalesces bursts via `requestAnimationFrame`; functional `setExpanded` reads keep callback identity stable.
- Block a11y pass: expand buttons now carry `aria-controls` pointing at `useId`-generated panel ids on `Spec` / `CodeChange` / `TaskList`; pin button uses stable `aria-label` ("Pin to rail") with `aria-pressed` state; approval resolved state is `role="status"`.

**Phase 13.D/E/F/G/H readiness verified:** the four tracks now emit `ArtifactCreated` events into the registry instead of painting bespoke UI. Per-track emitter responsibilities annotated in `plan.md` and `roadmap.md`.

- invariants: pending node run
- typecheck: clean
- tests: 13/13 frontend pass; 6/6 backend pass
- deviations: dev panel mounts in dev mode only — production build retains the user-chosen defaults baked into `:root` and `.dark-theme`
- feedback: FB-0026 (dev-panel-driven design exploration is the canonical mechanism)

## 2026-04-25T01:55:00Z — manual (Phase 13.E — track + git wire)
- prompt: "Build Phase 13.E — Track primitive + git wire."
- trigger: manual (Mini procedure followed; no UI generation skill fired since changes are minimal action affordances over existing components)
- archetype-reused: app-dialog (existing dialog scrim + frame from 13.1)
- components-reused: IconButton, AppDialog conventions, app-dialog__head/body/section, btn / btn[data-variant=primary], quick-switcher__input, state-dot
- components-new: RepoLinkModal (action-attached form modal — accepts a repo path, validates via cmd_link_repo, confirms or surfaces error)
- primitives: (none new — inline composition continues per pattern-log "Mini primitives deferred")
- tokens: --space-1..5, --color-foreground, --color-muted, --color-danger, --type-caption-size, --type-caption-leading, --type-body-size (no new tokens introduced)
- invariants: 6/6 expected (vitest + tsc clean)
- typecheck: clean (npx tsc --noEmit)
- tests: 16/16 frontend pass (3 new RepoLinkModal cases); cargo test --workspace green; cargo clippy + fmt clean
- deviations: none — all touched surfaces already used token-driven CSS; new component reuses the existing app-dialog__* classes
- feedback: pending

## 2026-04-25T10:05:00Z — manual (Phase 13.E review-pass hardening)
- prompt: "Address review issues: state machine, branch injection, subprocess timeout, idempotence, gh URL parse, concurrent start_track race, signature collisions, partial-init rollback, batch_signatures unbounded, no symlink resolution, modal focus trap, scrim onClick."
- trigger: manual (security + a11y review pass; no UI generation skill fired — fixes were targeted at existing components)
- archetype-reused: app-dialog (unchanged shell)
- components-reused: RepoLinkModal (focus trap + scrim semantics tightened in place; no visual changes)
- components-new: []
- primitives: none
- tokens: no new tokens; same set as the initial 13.E build
- invariants: 6/6 expected (frontend tsc + vitest clean)
- typecheck: clean
- tests: 18/18 vitest pass (2 new RepoLinkModal cases — focus trap, scrim onClick); 32 desktop + 7 core + 3 git url tests pass; cargo clippy + fmt clean
- deviations: none
- feedback: FB-0027 (bound subprocesses, validate inputs, dedupe action commands), FB-0028 (modals trap Tab focus), FB-0029 (scrim dismiss on click, not mousedown)
