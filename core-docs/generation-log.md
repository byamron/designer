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


## 2026-04-25T02:00:00Z — manual (phase 13.D agent wire)
- prompt: "Phase 13.D — Agent wire. Wire WorkspaceThread.onSend end-to-end against the artifact foundation: cmd_post_message IPC, AppCore::post_message + 120ms message coalescer, agent-emitted diagram/report artifacts, frontend wiring with optimistic state and error recovery."
- trigger: manual (skill not invoked; backend-heavy track that touches one frontend surface — the existing WorkspaceThread)
- archetype-reused: none (no new layout — extends ComposeDock's onSend contract and the WorkspaceThread send/notice region)
- components-reused: WorkspaceThread, ComposeDock (used `setDraft` + `focus` imperative handle for failure-restore), `workspace-thread__notice` slot
- components-new: none
- primitives: none (frontend change is one render path inside WorkspaceThread; no new layout primitives needed)
- tokens: existing — `workspace-thread__notice` styling unchanged from 13.1
- invariants: not run (no new UI surfaces; existing surfaces unchanged)
- typecheck: clean (`npx tsc --noEmit`)
- tests: vitest 15/15 (added `workspace-thread.test.tsx` with 2 cases — postMessage call shape + empty-draft guard); cargo `--workspace` clean (added round-trip + empty-text tests under `ipc_agents::tests`)
- deviations: none
- feedback: pending


## 2026-04-25T10:15:00Z — manual (phase 13.D review-fix pass)
- prompt: "Address review feedback: stream_id bug, failed-send duplicate artifacts, ComposeDock concurrent-send race, typed IpcError translator, length cap on text, cancellable coalescer, attachments-dropped warning, tool_use translator gap. Add the 7 valuable tests called out in the review."
- trigger: manual (review-driven follow-up on the same 13.D PR)
- archetype-reused: none
- components-reused: WorkspaceThread (added `useRef` re-entry guard, draft-restore on failure, typed-error translation), ComposeDock (used existing `setDraft`/`focus` imperative handle for failure recovery — no internal change)
- components-new: `packages/app/src/ipc/error.ts::describeIpcError` — typed IpcError → user-copy translator
- primitives: none
- tokens: existing — `workspace-thread__notice` reused for `role="alert"` error banner
- invariants: not run (UI surface unchanged from prior 13.D entry)
- typecheck: clean (`npx tsc --noEmit`)
- tests: vitest 18/18 (added `restores_draft_on_failure`, `ignores_concurrent_sends`, `refreshes_on_production_stream_id`); cargo workspace clean — new tests: `coalescer_drops_user_echoes`, `coalescer_separates_keys`, `post_message_no_artifact_on_dispatch_failure`, `event_to_payload_artifact_produced_is_broadcast_only`, `ipc_error_serialization_shape_has_kind_tag`, `rejects_oversized_text`, `busy_timeout_is_5_seconds_on_pool_connections`. Foundation fix: `SqliteEventStore::append` now uses `transaction_with_behavior(Immediate)` + `PRAGMA busy_timeout=5000` (DEFERRED transactions deadlock under concurrent writers in WAL mode with `SQLITE_LOCKED`, which `busy_timeout` can't retry).
- deviations: none
- feedback: pending — pattern-log gained four entries (IpcError struct variants, draft-restore via imperative handle, sync useRef re-entry guard, IMMEDIATE transactions on SQLite append, `kind` field collision with serde tag)

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

## 2026-04-25T09:06:45Z — manual (Phase 13.G)
- prompt: "Phase 13.G — Safety surfaces + Keychain. Wire approval inbox, cost chip, scope-denied flow, macOS Keychain integration."
- trigger: manual (skill not invoked; backend-heavy track. UI changes scoped to ApprovalBlock wiring + new CostChip + Settings rows.)
- archetype-reused: none (CostChip is a custom topbar widget; Keychain row reuses existing SettingsRow archetype)
- components-reused: ApprovalBlock, BlockHeader, SegmentedToggle, SettingsRow, MainView (tabs-bar)
- components-new: CostChip (topbar widget + popover), KeychainStatusReadout (Settings → Account row), CostChipToggle (Settings → Preferences row)
- primitives: none (consistent with 13.1 — primitives migration tracked in plan.md Phase 15)
- tokens: --space-1..3, --space-8, --color-content-surface, --color-border-soft, --color-border, --color-foreground, --color-muted, --color-background, --success-9, --warning-9, --danger-9, --radius-button, --radius-card, --border-thin, --type-family-mono, --type-caption-size, --type-body-size, --layer-overlay, --elevation-overlay, --motion-enter
- invariants: not run (no arbitrary px / hex remain; status colors route through `--success-9 / --warning-9 / --danger-9` from `packages/ui/styles/tokens.css`; the cost-chip and Keychain-status dot dimensions use `var(--space-3)` rather than `8px`; existing invariants pass under workspace check)
- typecheck: clean
- tests: 19/19 frontend pass (added 6 in `safety.test.tsx`); cargo test workspace clean — `designer-claude::inbox_permission` 10 tests (5 added: pre-park observation, two-click race, missing-ws audit, workspace-stream resolution, gate-sink update); `designer-safety::tests::gates` 6 tests (2 added: cost replay reflects historical spend, gate replay reflects historical resolutions); `designer-desktop::core_safety` 8 tests (2 added: sweep skips approvals with terminal events, cost_status reflects spend across AppCore::boot)
- deviations: none. The initial pass shipped `var(--color-success, var(--accent-9, #2f9e44))` fallback chains because the role tokens aren't defined; the post-review pass switched to the Radix scale tokens already in `tokens.css` (`--success-9 / --warning-9 / --danger-9`) and replaced the `8px` dot dimension with `--space-3`. No new design-language tokens were added; no `elicit-design-language` amendment is required.
- feedback: pending
## 2026-04-25T02:00:00Z — manual (Phase 13.F — Local-model surfaces)
- prompt: "Phase 13.F — Local-model surfaces. Wire the on-device Foundation Models helper into write-time semantic summaries, Home recap, audit verdicts, and the prototype renderer."
- trigger: manual (back-end track; the only frontend touch is the PrototypeBlock renderer)
- archetype-reused: existing iframe-sandbox pattern from `packages/app/src/lab/PrototypePreview.tsx`
- components-reused: PrototypeBlock (kept under 30 LOC of changes), PrototypePreview (extended with optional `inlineHtml` prop; existing `{ workspace }` callers unchanged)
- components-new: none
- primitives: (none — backend-led track)
- tokens: no new tokens. The block iframe reuses `.prototype-frame` from the lab.
- invariants: 16/16 frontend tests pass; tsc clean.
- backend: cargo test --workspace green (10 new core_local tests + existing 100+); cargo clippy --workspace --all-targets -- -D warnings clean; cargo fmt --check clean.
- deviations: PrototypePreview gained a discriminated-union prop signature so the existing lab demo path stays a workspace-driven variant explorer while the new artifact path is a pure inline-HTML iframe. The component is exclusively the sandbox primitive in 13.F mode — no annotation layer, no variant explorer.
- feedback: pending


## 2026-04-25T10:15:00Z — manual (Phase 13.F — review pass)
- prompt: Reviewer flagged: PrototypeBlock CSP regression, debounce-burst race (concurrent calls each spawn their own helper), cross-workspace audit boundary missing, archived-target audit/recap silently succeeds, author-role registry missing, UTC tz, no eviction, late-return holds Arc<Self>, and a wiring TODO for tracks emitting code-change directly. Plus add 6 specific tests.
- trigger: manual (review feedback addressed in same branch as PR #18)
- archetype-reused: existing iframe-sandbox pattern + the established `watch::channel` pattern from 12.B's helper supervisor
- components-reused: PrototypeBlock (CSP injection is a 1-prop add to PrototypePreview's existing `inlineHtml` form; 0 LOC delta in PrototypeBlock itself)
- components-new: none
- primitives: (none — same backend-track scope)
- tokens: no new tokens. Sandbox+CSP injection lives entirely in `wrapInlineHtmlWithCsp` next to the existing `INLINE_HTML_CSP` constant in PrototypePreview.tsx (parity with the lab demo's CSP shape).
- backend: cargo test --workspace green (5 new tests, 32 lib tests in designer-desktop, was 27); cargo clippy --workspace --all-targets -- -D warnings clean; cargo fmt --check clean.
- frontend: tsc clean; vitest 17 passed (was 16). New `hardens against form-action XSS` case asserts `sandbox=""` and CSP `form-action 'none'` are both present.
- deviations: `summary_provenance` recommended deferred to a pre-launch ADR rather than fixing in-band. The artifact event vocabulary is frozen by ADR 0003; adding the field non-breakingly requires a new variant `ArtifactSummaryProvenanceSet` which warrants its own decision record. Documented in plan.md, ADR 0003, and an explicit deferral note. Tracked: open the ADR before any user-visible build.
- feedback: FB-0027 (cross-workspace boundaries belong on the IPC, not in-memory), FB-0028 (cache in-flight separately from resolved — concurrent callers must share one round-trip)


## 2026-04-27T07:30:00Z — manual (Track 13.K — Friction)
- prompt: "Pick up Track 13.K — Friction (internal feedback capture). Locked spec in roadmap.md § Track 13.K."
- trigger: manual (frontend + backend track; locked-spec landing per roadmap)
- archetype-reused: floating-action-button pattern from `IconButton.tsx`; modal-dialog focus-management pattern from `RepoLinkModal.tsx`/`CreateProjectModal.tsx`
- components-reused: SegmentedToggle (Settings → Activity → Friction triage page reuses the existing `btn[data-variant="primary"]` pattern); IconButton glyph conventions (lucide-react `MessageSquareDashed`, `X`, `Trash2`, `ImageIcon`)
- components-new: FrictionButton, SelectionOverlay, FrictionWidget. Plus the FrictionTriageSection inside SettingsPage (not a top-level component — locked to the Settings IA per spec).
- primitives: (none — same convention as the rest of the app; layout uses CSS grid + flex)
- tokens: --space-1..4, --target-sm/md, --radius-pill/button/card, --color-accent, --color-foreground, --color-background, --color-muted, --color-surface-overlay, --color-surface-raised, --color-border, --danger-9, --elevation-raised, --motion-interactive, --type-body-size, --type-caption-size, --type-family-mono, --weight-medium, --focus-outline-width/color/offset, --border-thin, --layer-overlay
- invariants: backend `cargo test --workspace` green (78 designer-desktop tests, including 10 new core_friction tests + 4 anchor tests); `cargo clippy --workspace --all-targets -- -D warnings` clean; `cargo fmt --all -- --check` clean. Frontend `npm run typecheck` clean; `vitest run` 46 passed (8 new anchor.test.ts cases — round-trip, smart-snap, selectorFor priority, resolveAnchor staleness, title synthesis truncation, descriptor fallback chain).
- deviations: `large_enum_variant` clippy lint allowed on `EventPayload` because `FrictionReported` is intentionally heavy (Anchor + screenshot ref + provenance) and low-frequency. Documented inline.
- review-pass: three-perspective review (staff engineer, staff UX designer, staff design engineer) caught (a) Anchor wire-format mismatch — Rust struct-variant fields default to snake_case, TS spec uses camelCase → fixed with `#[serde(rename_all_fields = "camelCase")]` + a wire-format pinning test; (b) selection mode wasn't bailing when a modal scrim opens; (c) click-outside grace required two clicks instead of one (logic bug); (d) finalizeAnchor re-ran elementFromPoint at a stale rect center; (e) the "Capture this view" button was a dead affordance in v1 (Tauri webview-capture not wired) — removed entirely; (f) `--color-accent-foreground`, `--color-danger`, `--motion-fast` were never-defined tokens — swapped to `--color-background`, `--danger-9`, `--motion-interactive`. Subsequent `/simplify` pass extracted `spawn_filer` shared between submit + retry; `locate_friction` collapsed three independent `read_all` calls into one; `ScreenshotRef::local_path()`/`sha256()` accessors replace duplicated match arms; `FrictionFileError` Display impl replaces user-facing `Debug` formatting; SHA + screenshot write moved off the tokio runtime via `spawn_blocking`; PNG header-only dimension probe avoids decoding screenshots that don't need downscaling; URL.createObjectURL unmount cleanup added.
- feedback: pending (PR #34 open; awaiting user dogfood signal)


## 2026-04-27T20:55:00Z — manual (Track 13.L — Friction local-first + master-list)
- prompt: "Pick up Track 13.L — drop the gh gist + gh issue filer, persist friction records as <repo>/.designer/friction/<id>.md with PNG sidecar, rework the triage view as a filterable master list with Open/Addressed/Resolved/All filters and Mark addressed (optional PR URL) + Mark resolved + Reopen + Open file row actions."
- trigger: manual (cross-cutting backend + frontend track; locked-spec landing per roadmap § Track 13.L)
- archetype-reused: filter-pills pattern (mirrors `SegmentedToggle` aesthetic but rendered inline as `role="tab"` chips so the count chip can sit alongside each label); modal scrim/focus pattern from `RepoLinkModal.tsx` and `CreateProjectModal.tsx` for the "Mark addressed" PR-URL prompt.
- components-reused: SettingsSectionHeader (existing settings header pattern); `btn` + `btn[data-variant="primary"]` action buttons; `revealInFinder` Tauri shim from `commands::reveal_in_finder` (now exposed on `IpcClient`).
- components-new: `AddressFrictionDialog` (new internal dialog inside SettingsPage). Re-shaped `FrictionTriageSection` from a chronological list into a filtered master list. No new top-level manifest entries.
- primitives: (none — same convention as the rest of the app; layout uses CSS grid + flex inside `.friction-triage*` rules)
- tokens: --space-1/2/3, --type-caption-size, --type-body-size, --type-family-mono, --type-h3-size, --weight-medium, --color-foreground, --color-muted, --color-surface, --color-surface-raised, --color-border, --color-accent-9, --radius-pill, --radius-button, --border-thin, --shadow-overlay, --layer-modal
- invariants: `cargo fmt --all -- --check` clean; `cargo clippy --workspace --all-targets -- -D warnings` clean; `cargo test --workspace` green (16 new/updated core_friction tests plus a new `legacy_friction_linked_envelope_decodes` test in designer-core that pins old version-1 records still decoding); `npm run typecheck` clean; `vitest run` 46 passed. Mini invariants on `SettingsPage.tsx` 6/6 clean. Pre-existing px-token violations in `app.css` are unchanged by this PR.
- deviations: `EventPayload::FrictionLinked` and `FrictionFileFailed` retained as `#[deprecated]` variants for legacy-record decode — necessary for the version 1 → 2 migration described in ADR 0002 addendum (2026-04-27).
- backend: dropped `GhRunner` trait + `RealGhRunner` + `GhRunnerSlot` + `gh_runner_override` field on `AppCore` + `set_gh_runner_for_tests` + `spawn_filer` background task + `IpcError::ExternalToolFailed` + `image` workspace dep + the `maybe_downscale` PNG decoder. `EventEnvelope.version` bumped 1→2; `FrictionAddressed { friction_id, pr_url }` and `FrictionReopened { friction_id }` added. `cmd_link_repo` now writes `.designer/friction/` into `<repo>/.gitignore` on first link via `core_friction::ensure_friction_gitignore`.
- frontend: `FrictionState` is now `"open" | "addressed" | "resolved"`; `FrictionEntry` carries `pr_url` (no more `github_issue_url`/`error`); `IpcClient` gains `addressFriction` / `reopenFriction` / `revealInFinder` and drops `retryFileFriction`. `FrictionWidget` lost the "Also file as GitHub issue" checkbox; submit now produces a "Saved as #<tail>" toast.
- feedback: pending (PR awaiting user dogfood signal)


## 2026-04-27T21:50:00Z — manual (Track 13.L review + fix pass)
- prompt: "review the change from the perspective of a staff engineer, a staff UX designer, a staff UI designer, and a staff design engineer. identify any bugs or breaking changes and fix them."
- trigger: manual (multi-perspective review on the prior 13.L commit)
- archetype-reused: `app-dialog__*` chrome and `lib/modal.ts` focus-trap helpers (`AddressFrictionDialog` rebuilt to match `RepoLinkModal` / `CreateProjectModal`); `SegmentedToggle` (filter chips replaced the hand-rolled pill row)
- components-reused: `SegmentedToggle`, `IconButton`, `IconX`, `RepoLinkModal`-style modal chrome
- components-new: `FrictionRow`, `AddressFrictionDialog` (rebuilt from scratch with shared infra). Plus a new `useFocusTrap` hook in `lib/modal.ts` extracted from the three-modal duplication.
- primitives: (none beyond the existing app convention)
- tokens: --accent-7, --accent-9, --accent-11, --gray-9, --color-foreground, --color-muted, --color-surface-overlay, --color-surface-raised, --color-border, --color-background, --space-1/2/3/8, --type-caption-size, --type-body-size, --type-family-mono, --weight-medium, --radius-button, --radius-pill, --radius-modal, --border-thin, --elevation-modal, --motion-interactive, --layer-modal, --danger-9
- invariants: 6/6 clean on `SettingsPage.tsx`, `FrictionWidget.tsx`, `lib/modal.ts`. `cargo fmt --all -- --check` clean; `cargo clippy --workspace --all-targets -- -D warnings` clean; `cargo test --workspace` green; `npm run typecheck` clean; `vitest run` 46 passed.
- review-pass: four perspectives (staff engineer, staff UX, staff UI, staff design engineer) surfaced the punch list below. All P0s addressed; key P1s addressed; P2 polish folded in opportunistically.
  - **P0 fixes:**
    - `local_path` is now persisted on `EventPayload::FrictionReported` (additive `Option<PathBuf>`, `#[serde(default)]`) so the projection's `local_path` reflects reality. Was previously empty `PathBuf::new()` for every entry, which silently disabled "Show in Finder" for every row (`core_friction.rs:200, 393`).
    - Three undefined CSS tokens fixed: `--color-accent-9` → `--accent-9` / `--accent-11`; `--color-surface` → `--color-surface-overlay`; `--shadow-overlay` → reused `--elevation-modal` via `app-dialog__*` archetype. Was rendering modal cards transparent in dark mode and hiding the "open" state cue (`app.css`).
    - `AddressFrictionDialog` now uses the shared `app-dialog__*` chrome + `useFocusTrap` hook (extracted to `lib/modal.ts`) + `aria-modal="true"` + return-focus on close. Was a hand-rolled scrim/card with no focus trap (`SettingsPage.tsx:760-877`).
    - Reopen affordance now shows on `addressed` rows too (was gated `state === "resolved"` only). UPDATE PR action shows on `addressed` rows so the user can change the recorded PR url without losing state.
    - "Open file" renamed to "Show in Finder" — matches the underlying `reveal_in_finder` Tauri command (`open -R <path>` selects the markdown record in Finder). Spec's "shell.open(parent_dir)" was a v2 hand-wave; reveal-in-Finder is the craftier UX.
    - Filter chips replaced with `SegmentedToggle` — drops the wrong `role="tablist"` markup (no `tabpanel`), the broken pill styles, and ~30 lines of duplicated CSS.
    - Row structure rebuilt: row is a `<li>` with `__toggle` button + `__actions` sibling row, not a `<button>` containing other `<button>` elements (invalid HTML). `aria-controls` wires the toggle to its detail block.
    - Default-filter dead-state fix: when the user lands on the default `Open` filter with zero open items but history exists in addressed/resolved, the page auto-falls-through to `All`. One-shot, only on initial load.
  - **P1 fixes:**
    - `revealInFinder` now has a clipboard fallback both in the Tauri client and the mock client — was no-op in the web/dev runtime.
    - `useFocusTrap` hook extracted to `lib/modal.ts` (Esc + Tab cycle + return-focus). Three modals now share it; `RepoLinkModal` and `CreateProjectModal` could fold onto it next.
    - Backend dropped `locate_friction` (full event-log scan per click) — `cmd_address_friction` / `cmd_resolve_friction` / `cmd_reopen_friction` now accept `workspace_id` directly (FE has it on `FrictionEntry`). At 100k events this dropped click latency from O(N) deserialize to O(1) append.
    - FE applies state transitions optimistically via `setEntries(...)` before the IPC call, so click → row state updates instantly. Removed the `refresh()` re-fetch path.
    - Backend `report_friction` cleans up the on-disk record + screenshot if `store.append` fails — orphan markdown is now bounded.
    - `ensure_friction_gitignore` is race-safe via a process-global mutex on the gitignore path — two concurrent `link_repo` calls can't both observe "needle missing" and both append a duplicate line.
    - PR URL chip in the row meta now shows `owner/repo#123` (parsed from URL via `shortPrLabel`) instead of the literal "PR linked".
    - PR URL validation in the dialog: regex check against `^https?://[^\s]+$`; invalid-shape URLs render an inline `role="alert"` error.
    - `messageFromError` now wraps IPC errors in the dialog (was swallowing failures).
    - Single source-of-truth `FILTERS` table drives the SegmentedToggle options and the empty-state copy lookup (was repeated four times).
    - `FrictionRow` callback sprawl collapsed to a single `onAction(action: RowAction)` dispatch.
    - Backend `report_friction` rewrite: markdown rendered on the async runtime, `spawn_blocking` only carries the I/O. Five `*_for_blocking` clones collapsed to a single `WriteArgs` struct.
    - Submit toast in `FrictionWidget` now has an inline "Review" button that opens Settings → Activity → Friction directly. No more hunt-and-peck.
- backend: 1 file added (`WriteArgs` struct + `write_record_to_disk`); `locate_friction` removed (-50 LOC); state-machine validation tests removed (FE is the gating authority); `cargo fmt`/`clippy`/`test --workspace` clean (84 designer-desktop tests, was 86 before locate_friction removal).
- frontend: `lib/modal.ts` gains `useFocusTrap`. `IpcClient` gains a clipboard fallback in `revealInFinder`. `IpcClient.{resolve,reopen}Friction` now accept `FrictionTransitionRequest` (carries `workspace_id`).
- deviations: state-machine validation moved from backend to FE (server trusts the client to gate buttons by `entry.state`). Acceptable for a single-user local app where the cost of validation (full event-log scan per click) outweighs the defense.
- feedback: pending (PR awaiting user dogfood signal)

## 2026-04-29T07:00:00Z — manual (first-launch unblock)

- prompt: "the create workspace button does nothing… in settings, it says i need to run claude login… all this information is still placeholder — unacceptable for running the actual app. let's go with option A (minimum viable cleanup)."
- trigger: manual (no skill matched — three small surgical fixes spanning Rust + TS + CSS)
- archetype-reused: none
- components-reused: `IconButton`, `Section`, `SegmentedToggle`, `WorkspaceStatusIcon`, `DesignerNoticedHome`
- components-new: none
- primitives: none (CSS-only deletion + handler rewire)
- tokens: none introduced; tokens previously referenced by `.home-a__steps` are still in use elsewhere
- invariants: `cargo fmt --check` clean; `cargo clippy --workspace --all-targets -- -D warnings` clean; `cargo test --workspace --lib` green; `npm test` 55/55; `tsc --noEmit` clean
- review-pass: four perspectives (staff engineer, staff UX, staff UI, staff design engineer) — found three follow-ups, all addressed before PR.
  - **WorkspaceSidebar create-flow**: replaced `window.prompt("Workspace name?")` (a no-op in Tauri's prod WebView — silently returned `null`, leaving the user with a button that "did nothing") with one-click create + immediate `Tab 1` thread + select. Auto-name `Workspace ${workspaces.length + 1}` (renamable when rename lands). Added `useRef`-backed busy guard so rapid double-clicks can't compute the same `Workspace N` twice; button disables via `isCreating` while the IPC round-trip is in flight. `try/finally` ensures the guard releases on error; `console.error` surfaces failures (the old prompt path silently swallowed them too — same UX bug, different cause).
  - **Keychain detection**: switched `core_safety::keychain::query_claude_credential` from `get_generic_password(service, "")` to `ItemSearchOptions::new().class(generic_password()).service(...).limit(1).search()`. The previous wildcard-account query was a false claim — macOS requires an exact `kSecAttrAccount` match, but Claude Code's entry has `acct=$USER` (e.g. `benyamron`), so every check returned "Not connected" even when the credential existed. The new path only checks for *presence* (no `load_data`), preserving the spec invariant that Designer never reads the token.
  - **HomeTabA placeholder strip**: deleted hardcoded `Near-term focus` (steps `Draft plan + reviewable artifacts` / `Design exploration with variants` / `Implementation + audit-checked PR`) and `Recent reports` (`Monday recap · team-lead`, `Audit: scope on auth module · auditor`). Per `core-docs/roadmap.md` §16 these were always intended to be wired to `LocalOps::recap` and `core-docs/plan.md` parsing; until those land the honest empty state (Active workspaces → Autonomy → Designer noticed) reads better than fake content. Dead `.home-a__steps` selectors removed from `home.css` (no longer referenced).
- backend: keychain probe rewrite (`use security_framework::passwords::get_generic_password` → `use security_framework::item::{ItemClass, ItemSearchOptions, Limit}`); no schema changes, no test additions (path is `#[cfg(target_os = "macos")]` and depends on real Keychain state — covered by manual verification on the dev machine).
- frontend: `WorkspaceSidebar` gains `useRef` import + busy guard; `HomeTabA` loses two `<Section>` blocks; `home.css` loses 4 selectors (29 LOC).
- deviations: none.
- feedback: pending

## 2026-05-01T04:10:57Z — manual (DP-B chat pass-through subtraction)

- prompt: "DP-B: subtract chat chrome; pass-through Claude Code register; intercept only approvals"
- trigger: manual (subtraction pass; Mini procedure followed by hand)
- archetype-reused: none (subtraction; existing primitives untouched)
- components-reused: MessageBlock, ApprovalBlock, CommentBlock, ActivitySpine.ArtifactRow
- components-new: ToolUseLine, ArtifactReferenceBlock, ReportBlock-as-dispatcher
- components-retired: BlockHeader, SpecBlock-as-card, PrBlock-as-card, ReportBlock-as-card, CodeChangeBlock-as-card, PrototypeBlock-as-card, DiagramBlock, VariantBlock, TaskListBlock-as-card, TrackRollupBlock-as-card, ToolCallGroup
- primitives: none (CSS-only)
- tokens: --space-1, --space-2, --space-3, --space-4, --color-muted, --color-foreground, --color-surface-hover, --color-surface-raised, --color-border-soft, --type-caption-size, --type-family-mono, --type-family-sans, --motion-interactive, --motion-standard, --focus-outline-width, --focus-outline-offset, --focus-outline-color
- invariants: pending (deferred to integration PR)
- deviations: none
- feedback: pending (DP-B branch; awaiting integration merge)

## 2026-05-01T04:10:57Z — manual (DP-C reliability audit + flag/hide pass)

- prompt: "DP-C: inventory shipped features; flag or hide half-baked ones"
- trigger: manual (audit + targeted implementation; no full-skill firing)
- archetype-reused: none
- components-reused: SegmentedToggle, SettingsRow, ipcClient
- components-new: ModelsSectionToggle (Settings → Preferences row driving `show_models_section` flag)
- components-retired: SettingsPage Models nav-item (default off; behind `show_models_section` flag), Preferences "Default autonomy" placeholder row, ActivitySpine "Code files" placeholder section
- primitives: none
- tokens: inherits SegmentedToggle / SettingsRow tokens
- invariants: pending
- deviations: none
- feedback: pending (DP-C work merged into the same PR as DP-B for the dogfood push)

## 2026-05-01T07:30:00Z — manual (settings-scope split + project unlink)

- prompt: "Settings architecture: global vs per-project + project unlink"
- trigger: manual (driven by two friction reports — Settings should be global; no way to unlink a project)
- archetype-reused: none
- components-reused: RepoLinkModal (now surfaces from Project Home), Section (HomeTabA helper), IconButton, app-dialog__* CSS scaffolding
- components-new: RepoUnlinkModal (destructive confirm; fans out across project's workspaces), ProjectRepoSection (HomeTabA inline; Link / Re-link / Disconnect buttons)
- components-retired: AccountSection.Repository row in SettingsPage (and its local state for `linkOpen`, `summaries`, `targetWorkspace`)
- primitives: none (composed from existing app-dialog scaffolding + inline flex consistent with HomeTabA's other rows)
- tokens: --space-2, --space-3, --color-text, --color-muted, --color-danger (pre-existing pattern), --type-caption-size, --type-caption-leading; danger-3/7/12 inherited via `data-variant="danger"` button styling in atoms.css
- invariants: clean (`node tools/invariants/check.mjs` passes 6/6 across the three modified TSX files)
- deviations: none
- feedback: addresses frc_019de6f7-1d53-7153-a2ba-495101321696 + frc_019de6fa-608d-7872-aece-600d69f49ad4

## 2026-05-02T00:30:00Z — manual (spine open-on-click + allowlist)

- prompt: "Friction frc_019de704 (clicking artifacts in ActivitySpine had no effect) + frc_019de6fe (spine polluted with per-tool-use cards)"
- trigger: manual (structural change to ArtifactRow: title becomes a button; new SettingsRow toggle; no full-skill firing)
- archetype-reused: none
- components-reused: ActivitySpine.ArtifactRow (now a button-as-row pattern, mirroring the existing `.spine-row` agent affordance), Tooltip (using its `shortcut` slot for the ⌘ hint), SegmentedToggle, SettingsRow, ipcClient
- components-new: SpineAllArtifactsToggle (Settings → Preferences row driving `show_all_artifacts_in_spine` flag, mirroring ModelsSectionToggle)
- components-retired: none
- primitives: none
- tokens: --focus-outline-width, --focus-outline-offset, --focus-outline-color, --radius-button, --motion-interactive, --motion-standard, --color-surface-raised, --color-surface-hover, --color-foreground, --color-muted, --type-caption-size, --space-1, --space-2, --space-4
- invariants: 6/6 pass (`node tools/invariants/check.mjs` on changed CSS + TSX)
- deviations: none
- feedback: pending

## 2026-05-02T17:00:00Z — manual (release-prep: Help → Friction + dead-token cleanup)

- prompt: "Closes friction frc_019de6ff (Help dialog 'Ask' input was a half-baked feature). Plus the dead-token cleanup pass surfaced by the v0.1.1 → HEAD multi-perspective review."
- trigger: manual (release-prep cleanup driven by the staff-perspective-review skill in range mode)
- archetype-reused: app-dialog__section (the new Report-issues section + the existing Keyboard-shortcuts and About sections)
- components-reused: AppDialog, IconButton, toggleFrictionComposer, app-dialog__* CSS scaffolding
- components-new: none (added two new CSS classes to the existing AppDialog component — `.app-dialog__hint` for caption-size muted multiline copy + `.app-dialog__inline-link` for inline button-as-link with focus-visible / hover / focus ring)
- components-retired: HelpBody "Ask the help agent" input (was unwired placeholder; per FB-0036 no half-baked features in prod)
- primitives: none
- tokens: --color-foreground, --color-accent, --color-muted, --type-caption-size, --type-caption-leading, --border-thin, --focus-outline-offset, --radius-badge, --space-1 (replaced an inline `0.15em` text-underline-offset with `var(--space-1)` per token-fidelity audit)
- invariants: clean (no raw px / hex / ms / rgba in changed CSS or TSX after the friction.css `rgba(255,255,255,0.12)` → `color-mix(in srgb, var(--color-accent) 12%, transparent)` swap)
- deviations: none
- feedback: addresses frc_019de6ff; manifest entry on AppDialog updated to list the new classes + tokens

## 2026-05-02T17:30:00Z — manual (per-message model selection wired)

- prompt: "Wire the model selector for real (not hide-behind-flag). For testing purposes, want Haiku/Sonnet so we don't burn Opus tokens during round-trip iteration."
- trigger: manual (FB-0038-driven — cheap real fix beats hide-via-flag)
- archetype-reused: none (composer chrome unchanged; only the flag gating around the existing ComposeSelect was removed)
- components-reused: ComposeDock, ComposeSelect, WorkspaceThread, ipcClient
- components-new: none (test helper `mockIpcClient` is test-infra, not user-facing UI)
- components-retired: the temporary `showModels` `getFeatureFlags` gate inside ComposeDock (added then removed in the same session as FB-0038's triage)
- primitives: none
- tokens: none added (composer chrome is unchanged; the change is functional wiring, not visual)
- invariants: not run (no CSS or TSX visual surface changed)
- deviations: none
- feedback: addresses frc_019de705 (Haiku selector errored on send) — the in-PR `frontend_model_to_claude_cli` mapper is locked by a Rust unit test so future Claude model renames force a single-test failure, not silent dispatch-as-default

## 2026-05-02T20:00:00Z — manual (workspace archiving sidebar UI)

- prompt: "Add workspace archiving as core sidebar functionality: per-row Archive button, collapsible Archived section pinned to the bottom with Restore + Delete actions."
- trigger: manual (no Mini skill fired — sidebar chrome extends WorkspaceSidebar's existing flex-column register; staff-perspective-review caught the missing log entry and the missing prefers-reduced-motion guard)
- archetype-reused: none (composes onto the existing .workspace-row pattern)
- components-reused: WorkspaceSidebar, WorkspaceRow (extended with hover-revealed actions slot), IconButton, Tooltip
- components-new: ArchivedWorkspaceRow (renders inert label + Restore/Delete IconButtons), `.sidebar-group--archived` collapsible group
- primitives: none (consistent with this file's flex/grid idiom; Mini primitives still deferred at the layout level)
- tokens: --space-1, --space-2, --space-4, --motion-interactive, --color-muted, --color-foreground, --color-border, --color-surface-overlay, --weight-medium, --focus-outline-* (existing in tokens.css; no new tokens)
- icons: lucide-react Archive, ChevronDown, ChevronRight, RotateCcw, Trash2 — all sized 12 (icon-sm) or 14 (icon-md) at strokeWidth 1.5 per axiom #13
- invariants: 6/6 pass (no raw px / hex / ms in changed CSS or TSX; the one literal `1px` is a hairline border, the named exception per design-language.md §axioms)
- deviations: hover-only reveal of row actions is bespoke chrome rather than a Mini primitive — consistent with the rest of WorkspaceSidebar's idiom but a candidate for an explicit Mini archetype later
- feedback: addresses frc_019dea6a-0f1d (no way to close/archive workspaces); also covers frc_019dea66/67/69 indirectly because PR #87 ships the chat-strip + archive together (per user instruction "archiving should also be in this PR because that's core functionality")

## 2026-05-02T22:45:00Z — manual (Phase 23.C tool-use expand-to-payload)

- prompt: "Implement Phase 23.C: ToolUseLine expand renders the full artifact payload as monospace under the head, with 40-line truncation + Show full disclosure."
- trigger: manual (Mini procedure followed; no skill fired — single-component edit on an existing surface)
- archetype-reused: none (extends the existing tool-line disclosure idiom)
- components-reused: ToolUseLine
- components-new: none (added `.tool-line__pre` + `.tool-line__show-full` styles only)
- primitives: none
- tokens: --space-2, --space-3, --space-4, --color-surface-sunken, --color-border-soft, --radius-button, --color-muted, --color-foreground, --type-family-mono, --type-family-sans, --type-caption-size, --type-caption-leading, --border-thin, --motion-interactive, --focus-outline-* (all pre-existing in tokens.css)
- invariants: 6/6 pass
- deviations: none
- feedback: addresses frc_019dea67 (tool-use rows feel decorative without a way to drill into evidence); per-mount cache + in-flight `useRef` flag dedupes a fast double-click into a single `getArtifact` IPC call

## 2026-05-02T22:54:00Z — manual (Phase 23.C review fixes: loading affordance + a11y)

- prompt: "Apply staff-perspective-review blockers on PR #92: state-update-after-unmount guard, in-flight loading affordance, screen-reader announcement on the new region."
- trigger: manual (staff-perspective-review follow-up; first-round review caught three blockers, fixed in commit 46a034f5)
- archetype-reused: none (extends the existing tool-line disclosure idiom from the prior entry)
- components-reused: ToolUseLine
- components-new: none (added `.tool-line__loading` style only)
- primitives: none
- tokens: --space-4, --color-muted, --type-family-sans, --type-caption-size, --type-caption-leading (all pre-existing)
- invariants: 6/6 pass
- deviations: none — initial draft used `font-style: italic` for the loading affordance, dropped during the round-2 review because italic isn't sanctioned in design-language.md §axioms #6 (sans + mono register, no italic in chrome). Muted color alone carries the transient signal.
- feedback: addresses staff-perspective-review blockers — `mountedRef` guard so `setState` doesn't fire after the row unmounts mid-fetch; `Loading output…` affordance fills the otherwise-empty expanded state; `aria-live="polite"` on both the loading `<p>` and the payload `<pre>` so screen readers hear the new region without us hijacking focus from the head button

## 2026-05-02T23:15:00Z — manual (Phase 23.C polish: region wrapper, error state, manifest refresh)

- prompt: "Follow-up PR after #92: fix the deferred review items that are cheap (layout shift, aria-live placement, error state, manifest refresh) and park the rest in the roadmap so they don't rot in the closed PR body."
- trigger: manual (post-merge follow-up to PR #92; addresses round-2 / round-3 review FOLLOW-UPs)
- archetype-reused: none
- components-reused: ToolUseLine
- components-new: `.tool-line__region` wrapper (carries box chrome + `role="region"` + `aria-live="polite"` + `aria-busy` + `min-height` so loading / loaded / error phases share one footprint); `.tool-line__status` (replaces `.tool-line__loading`; same caption register, used for both "Loading output…" and "No output captured." copy). `.tool-line__pre` and `.tool-line__loading` styles repurposed: `.tool-line__pre` drops box chrome (now plain monospace content inside the region wrapper), `.tool-line__loading` deleted.
- primitives: none
- tokens: --space-1, --space-2, --space-3, --space-4, --color-surface-sunken, --color-border-soft, --radius-button, --color-muted, --type-family-mono, --type-family-sans, --type-caption-size, --type-caption-leading, --border-thin (all pre-existing)
- invariants: 6/6 pass
- deviations: none. The region wrapper's `min-height` is computed from `calc(--type-caption-leading + 2*--space-2 + 2*--border-thin)` — token arithmetic only, no raw values.
- feedback: addresses three deferred review items — (1) layout shift on payload arrival eliminated by sharing the box footprint across phases; (2) `aria-live` moved up from the inner `<pre>` to the region wrapper so screen readers don't read long pre content verbatim on insertion; (3) `getArtifact` rejection now surfaces "No output captured." instead of an empty box (failed-fetch result is also cached so re-expanding doesn't refetch a known 404). Component-manifest entry refreshed to list the new tokens + behaviors.

## 2026-05-02T23:48:00Z — manual (Phase 23.C polish: chevron discoverability + retry-on-error)

- prompt: "Fix the outstanding Phase 23.C follow-ups (23.C.f1 discoverability + 23.C.f4 transient-error retry); leave 23.C.f2 + 23.C.f3 in the roadmap with refreshed context."
- trigger: manual (cleanup pass on the parked items from the Phase 23.C review trail)
- archetype-reused: none (extends the existing tool-line idiom)
- components-reused: ToolUseLine; lucide-react ChevronRight (already used elsewhere via lucide-react)
- components-new: `.tool-line__chevron` (replaces `.tool-line__dot`; rotates 90° via CSS transform on `[aria-expanded="true"]`); `.tool-line__error` (flex row holding the status text + retry button); `.tool-line__retry` (text-link affordance, shares register with `.tool-line__show-full`)
- primitives: none
- tokens: --space-2 (error-row gap), --motion-interactive (chevron rotation transition), --color-muted, --color-foreground, --type-family-sans, --type-caption-size, --type-caption-leading, --border-thin, --focus-outline-* (all pre-existing)
- invariants: 6/6 pass. The chevron uses a literal `transform: rotate(90deg)` — angle, not duration / size / color, so no token applies; this is the established disclosure-rotation idiom (Radix collapsibles, etc.).
- deviations: none. The `·` dot is gone — that was a placeholder visual marker, not a documented design-language axiom; the chevron carries the same monochrome weight at rest while signaling click-to-expand without ambiguity.
- feedback: ships 23.C.f1 (chevron discoverability) and 23.C.f4 (retry on error) from the parked roadmap section. f2 + f3 stay parked — f2 is speculative without a parent-collapse consumer, f3 is explicit Phase-23 v2 polish needing a coalescing primitive in `WorkspaceThread`. NB: visual-regression baselines (`workspace-thread--{light,dark}.png`) need regeneration via `gh workflow run regenerate-visual-baselines.yml -f branch=tool-line-discoverability` since the head now renders a chevron icon where the dot used to be.

## 2026-05-03T00:05:00Z — manual (Phase 23.E follow-up: migration banner + ChannelClosed copy)

- prompt: "Address PR #95 follow-ups: one-time migration banner explaining pre-23.E session reset; humanize the ChannelClosed Display that was leaking UUIDs to user-facing alerts."
- trigger: manual (post-merge follow-up to PR #95; closes two of the three deferred FOLLOW-UPs from the staff-perspective-review notes — the third, a memory chip, stays deferred until dogfood signal)
- archetype-reused: none (mirrors `UpdatePrompt`'s floating-pill pattern — bespoke `<div>` chrome, not a shared archetype yet; consolidate if a third banner-like surface lands)
- components-reused: Onboarding (localStorage persistence + Escape-to-dismiss pattern)
- components-new: PreTabSessionBanner (top-center floating pill, fires once for upgraders; aria-live polite, dismissible by button or Escape; detection signal is "any project carries a workspace" — fresh installs land silent)
- primitives: none
- tokens: --space-1, --space-3, --space-4, --color-foreground, --color-muted, --color-surface-overlay, --color-surface-raised, --color-border, --border-thin, --radius-pill, --radius-button, --type-family-sans, --type-caption-size, --weight-medium, --motion-interactive, --focus-outline-width, --focus-outline-color, --focus-outline-offset, --surface-shadow, --layer-raised (all pre-existing)
- invariants: 6/6 pass
- deviations: none on the CSS side. Detection signal carries a known false-positive: a fresh-install user who creates their first workspace post-23.E will see the banner whose copy ("your existing chats start fresh") technically doesn't apply to them. Documented as FOLLOW-UP in the PR body; revisit if dogfood reports friction. The Rust side has no design surface — `humanize_dispatch_error` is a pattern-matched copy helper invoked from `core_agents::post_message` recovery paths.
- feedback: addresses staff-perspective-review BLOCKERs caught on the second-round review — (1) Escape-key parity with Onboarding (added `keydown` listener gated on render); (2) test assertion `||` → `&&` so a partial UUID leak (e.g. only "workspace 0192…" without "tab …") still fails; (3) dead `useEffect` removed from PreTabSessionBanner. Component-manifest entry added; this entry closes the Mini procedure §6–7 obligations.

## 2026-05-03T08:00:00Z — Phase 23.B activity indicator + tab-strip badge

- prompt: "Implement Phase 23.B from core-docs/roadmap.md (the 'Chat UX hardening' phase)."
- trigger: manual (Phase 23.B implementation; multi-perspective review pending pre-merge)
- archetype-reused: none
- components-reused: ComposeDock (extended with optional `workspaceId` + `tabId` props that pin a `ComposeDockActivityRow` above the textarea); MainView TabButton (now subscribes to the per-tab activity slice and paints a `.tab-button__activity-badge` dot when state != idle on a non-active tab)
- components-new: ComposeDockActivityRow (new file at packages/app/src/components/ComposeDockActivityRow.tsx) — pinned status row above the compose textarea. Renders three states: `idle` hides the row, `working` shows pulse + 'Working… {MM:SS|H:MM:SS}' counter, `awaiting_approval` shows warning-tinted pulse + 'Approve to continue' with chevron. Mono + tabular-nums for the counter so the digits don't shift width as they tick. The 1Hz interval only runs while state == working — no setInterval cost during AwaitingApproval. Reduced motion: explicit `animation: none` rule on `.compose-dock-activity-row__pulse` and `.tab-button__activity-badge` under `prefers-reduced-motion: reduce` (chosen over relying on axioms.css's collapse-to-0.01ms so the T-23B-3 acceptance test reads naturally; documented in pattern-log.md).
- primitives: none (the row is its own primitive — a pinned status strip; the badge is an absolutely-sized dot inside an existing tab button)
- tokens: --space-1, --space-2, --type-family-mono, --type-caption-size, --weight-regular, --color-muted, --color-border-soft, --border-thin, --accent-9, --warning-9, --radius-pill, --motion-pulse (all pre-existing)
- invariants: 6/6 pass on ComposeDockActivityRow.tsx, ComposeDock.tsx, MainView.tsx, and chat.css (the appended `compose-dock-activity-row__*` and `tab-button__activity-badge` styles)
- deviations: none. The pulse keyframe is one new `@keyframes compose-dock-activity-pulse` definition; opacity + transform deltas only, no raw colors or pixel sizes. Tab-strip badge re-uses the same keyframe so the pulse cadence is consistent across surfaces.
- feedback: pending. Acceptance tests T-23B-1 (translator transitions, in `crates/designer-claude/src/stream.rs`), T-23B-2 (elapsed counter, in `packages/app/src/test/compose-dock-activity.test.tsx`), T-23B-3 (reduced-motion class hook), T-23B-4 (cross-tab badge, in `packages/app/src/test/tab-activity-badge.test.tsx`) all pass. Backend translator tests + frontend test suite green (171/171 frontend, all Rust crates). Subprocess-death case covered by `t_23b_flush_idle_only_emits_when_not_already_idle` in `crates/designer-claude/src/stream.rs`.

## 2026-05-03T10:30:00Z — Phase 23.F Stop turn affordance

- prompt: "Build the 'Stop turn' affordance for Designer's chat. Wire an interrupt control_request through the orchestrator + IPC, surface a Stop button on the activity row that sends interruptTurn and optimistically hides the row."
- trigger: manual (Phase 23.F; the most-frequently-wished-for missing feature after 23.B–E shipped)
- archetype-reused: none
- components-reused: ComposeDockActivityRow (now renders a Stop button when state == 'working'; click dispatches `ipcClient.interruptTurn` and toggles a local optimistic-hide flag that resets on the next ActivityChanged edge)
- components-new: none
- primitives: none
- tokens: --space-1, --color-muted, --color-foreground, --radius-pill, --motion-interactive, --focus-outline-width, --focus-outline-color, --focus-outline-offset (all pre-existing). The button is a transparent icon affordance — muted at rest, foreground on hover/focus-visible (with `transition: color var(--motion-interactive)` so the lift eases instead of popping), and standard focus-outline-* tokens for keyboard discoverability so the styling stays in sync with every other focus-visible affordance in the app. `space-1` padding wraps the 14px StopCircle to reach the `target-sm` (24px) hit-box mandated by axiom #14.
- invariants: 6/6 pass on ComposeDockActivityRow.tsx and chat.css. No raw px / hex / ms / z-index introduced; the icon size (14) lives inside the lucide-react `<StopCircle>` API surface, which the chevron precedent (size=12) already established as the project's idiom for compose-dock micro-icons.
- deviations: none. The optimistic-hide flag is local component state (not in the activity slice) — it lives only between click and the next ActivityChanged edge, after which the authoritative slice takes over. Mirrors the established pattern from PR #97's retry-on-error chevron, which also uses local state for optimistic UI ahead of the orchestrator's authoritative update.
- feedback: pending. Tests cover the three contracts named in the spec: (1) Stop renders only when state === Working; (2) click fires `interruptTurn` IPC and hides the row optimistically; (3) Stop is keyboard-reachable from the textarea. Mock-orchestrator round-trip locked in `apps/desktop/src-tauri/src/ipc_agents.rs::interrupt_clears_activity_and_keeps_session_alive` — interrupt synthesizes Idle, post_message after still succeeds (no ChannelClosed), proving the session stays alive. The interrupt envelope shape `{"type":"control_request","request_id":"<uuid>","request":{"subtype":"interrupt"}}` is locked by `interrupt_request_line_is_newline_terminated_control_request` in `crates/designer-claude/src/claude_code.rs`.

## 2026-05-03T16:00:00Z — Phase 15.J cherry-pick: approval drill-down + resolved-state copy fix

- prompt: "Improve the visual + copy register of ApprovalBlock so the first time a user hits a write/edit approval request, the experience reads as manager-grade rather than developer-grade." (Phase 15.J cherry-pick — drill-down, resolved-state copy, working-state, scope reassurance.)
- trigger: manual (Phase 15.J subset; cost-chip warn/glyph + Ask-Again + inbox routing stay parked.)
- archetype-reused: none (extends the existing ApprovalBlock card chrome)
- components-reused: ApprovalBlock; lucide-react ChevronRight (already imported); the activity-pulse keyframe (`thread-activity-pulse`) lifted from `.thread__activity-dots` for the post-grant Working… affordance so the pulse cadence stays consistent with the compose-dock indicator.
- components-new: `.block__approval-header` (drops the kind badge — the new title stands on its own); `.block__approval-target` (path/command + scope-reassurance line column); `.block__approval-path` / `.block__approval-command` (mono code-pill register); `.block__approval-scope` (muted reassurance copy in caption register, deliberately avoids the word "worktree"); `.block__approval-description` (Bash description); `.block__approval-preview` + `.block__approval-pre` (file content / diff hunk in sunken pre, capped at 10 lines collapsed); `.block__approval-show-full` (text-link disclosure mirroring `.tool-line__show-full`); `.block__approval-footer`, `.block__approval-working`, `.block__approval-working-dots` (post-grant Working… status row). Backend: `inbox_permission::compute_title` produces a manager-grade tool+target headline ("Claude wants to write to `src/main.rs`"); `inbox_permission::strip_worktree_prefix` returns repo-relative paths (never absolute, basename fallback for unknown layouts); `inbox_permission::truncate_middle` middle-elides long Bash commands at 80 chars in the title.
- primitives: none
- tokens: --space-1, --space-2, --space-3, --space-4, --color-foreground, --color-muted, --color-surface-sunken, --color-surface-raised, --color-border-soft, --color-accent, --color-danger (new alias of --danger-9 in the block-layer scope), --border-thin (× 3 via calc for the deny left-border accent — see Mini axiom #4), --radius-button, --radius-pill, --type-family-mono, --type-family-sans, --type-body-size, --type-caption-size, --type-caption-leading, --weight-medium, --motion-interactive, --motion-pulse, --focus-outline-* (all pre-existing except --color-danger which is a new alias).
- invariants: 6/6 pass on packages/app/src/blocks/blocks.tsx + packages/app/src/styles/blocks.css.
- deviations: opacity:0.5 on `.block--approval[data-state="denied"]` is gone — replaced by a left-border accent (danger for user-deny, muted for timeout-deny) per the spec's "denied reads as decision, not history" principle. The differentiator is `data-deny-kind` driven by the `ApprovalDenied.reason='timeout'` event payload (Some("timeout") = backend timeout, None = user click). The Grant button label moved to "Allow" so the action register reads symmetrical with the resolved-state copy ("Allowed by you · …"). Path-strip lives in the Designer side, not in Claude's input — `encode_response` echoes the original input back to Claude unmodified.
- feedback: pending. Backend `cargo test -p designer-claude` covers `strip_worktree_prefix` (designer-marker, nested, relative pass-through, basename fallback, trailing-slash + `.designer` leak suppression), `truncate_middle` (including small-max underflow guard), `compute_title` (Write/Edit/Bash/unknown + long-command truncation + whitespace-only Bash + empty-strip fallback), and an integration test that the artifact emitted on a Write decide-call carries the friendly title and the stripped `path` field. Frontend `chat-rendering.test.tsx` adds 9 cases (drill-down render, Show full disclosure, Bash description, allow + user-deny + timeout-deny copy, Working… mount/unmount on activity transitions, CSS-source guard for the deny-kind left-border rule). `safety.test.tsx` updated for the Grant→Allow rename and the new "Allowed by you · …" status copy.

## 2026-05-03T17:15:00Z — manual (Polish bundle: focus-visible compose + dark-mode tab token + friction confirmation animation)

- prompt: "Bundle the still-actually-broken cosmetic friction items into one PR. … A. NEEDS FIX (focus-visible on compose textarea, dark-mode active tab token, smoother friction confirmation animation). B/C. VERIFY THEN RESOLVE for items already shipped in code."
- trigger: manual (cosmetic friction sweep — three small fixes pinned to friction frc_019dea6e / frc_019de6fb / frc_019de6f8; verifies and resolves frc_019de701, frc_019de6fe, frc_019de6fa-e3c7, frc_019de6ff, frc_019de6fa-608d, frc_019de6f7, frc_019de6f6 already-implemented)
- archetype-reused: none (extends three existing surfaces — `.compose`, `.tab-button`, `.friction-widget`)
- components-reused: ComposeDock (no JSX touched — focus rule swap is CSS-only); FrictionWidget (added Check icon to filed slab, wired data-closing + onTransitionEnd to drive unmount, replaced 650ms setTimeout-to-clearFriction with a 400ms read-window timer that flips closing=true and lets CSS opacity transition + transitionend handle the unmount)
- components-new: none. The filed slab now contains a Check icon from lucide-react alongside the existing "Filed." label; the `.friction-widget__filed-icon` class is a single tinted-icon hook, not a new component
- primitives: none
- tokens: --color-foreground, --color-surface-raised, --color-border, --color-surface-overlay, --focus-outline-width, --focus-outline-color, --motion-emphasized, --ease-out-enter, --space-2, --accent-9, --dev-tab-opacity, --radius-card (all pre-existing)
- invariants: 6/6 pass on tabs.css, friction.css, FrictionWidget.tsx, polish-bundle.test.tsx, setup.ts
- deviations: none. The dark-mode tab fix re-bases inactive `.tab-button` on `--color-surface-raised` instead of `--color-content-surface`, keeping the same color-mix shape (preserves the SurfaceDevPanel `--dev-tab-opacity` knob). Active tab continues to use `--color-content-surface` (sand-1 in dark mode, near-black) so it now reads as the deepest material in the row — mirroring light mode where active is the brightest white.
- feedback: addresses three friction reports — frc_019dea6e (focus-visible on compose; replaces `.compose:focus-within` with `.compose:has(:focus-visible)` so pointer clicks no longer ring the box on WebKit's focus-visible heuristic), frc_019de6fb (dark-mode tab token inversion), frc_019de6f8 (smoother friction confirmation; filed slab + check icon hold for `FRICTION_FILED_HOLD_MS` then the widget itself fades via `--motion-emphasized` and unmounts on `transitionend`; reduced-motion users skip the transition and unmount on next tick via the `prefersReducedMotion()` helper). Test `polish-bundle.test.tsx > 'cross-fades to a Filed. slab on submit, then unmounts on transitionend'` was rewritten to dispatch a real `TransitionEvent` with `propertyName: "opacity"` since jsdom doesn't compute styles or fire transitionend on its own. matchMedia stub added to `setup.ts` so any test rendering FrictionWidget (or other motion-aware components) doesn't crash on `window.matchMedia is not a function`. 178/178 frontend tests green.

## 2026-05-03T18:00:00Z — manual (Phase 23.E.f1: PreTabSessionBanner reframe to universal tutorial)

- prompt: "Address Phase 23.E.f1 follow-up: detection-signal brittleness on PreTabSessionBanner (false-positive for fresh-install users who created a workspace post-23.E and saw 'your existing chats start fresh' copy that didn't apply)."
- trigger: manual (closes the only actionable Phase 23.E follow-up; 23.E.f2 stays parked until a third banner-like surface lands, 23.E.f3 stays parked pending dogfood signal on memory pressure)
- archetype-reused: none (no JSX or CSS structure changed — copy + JSDoc + selector comment edits only)
- components-reused: PreTabSessionBanner (existing component, copy updated)
- components-new: none
- primitives: none
- tokens: unchanged from 2026-05-03T00:05:00Z entry — same set, no additions or removals
- invariants: 6/6 pass (no CSS or markup structural changes; existing token refs preserved)
- deviations: none. Considered tightening the detection signal to "any pre-23.E MessagePosted event exists" (would require a new IPC + bootData round-trip) — rejected as disproportionate to the false-positive's blast radius (small, one-time, dismissible). Reframed copy instead so the banner is true for all users regardless of upgrade history.
- feedback: closes 23.E.f1. Title changed from "Tabs are now parallel agents" to "Each tab is its own conversation"; body changed from "Each tab gets its own conversation. Your existing chats start fresh on the next message." to "Tabs run independent claude agents — open more from + to work on parallel things side by side." Test `pretab-banner.test.tsx > 'uses universal tutorial copy that doesn't claim existing chats for fresh installs'` locks the reframe against regression. Roadmap entry for 23.E.f1 marked closed.

## 2026-05-03T22:30:00Z — manual (Phase 22.A: Roadmap canvas foundation)

- prompt: "Implement Phase 22.A — Roadmap canvas foundation per core-docs/roadmap.md lines 1905–1959. Parse roadmap.md into a structural cache, render it as a live tree of nodes with stable HTML-comment anchors, overlay workspace/track/sub-agent presence, support drill-in actions. Read-only canvas; direct edits open the markdown in a tab."
- trigger: manual (orchestrated by /staff-perspective-review across three reviewer perspectives — staff engineer, staff UX designer, staff design engineer — before any code was written; reviewer findings synthesized into the implementation plan)
- archetype-reused: none (canvas is a net-new surface)
- components-reused: IconButton (chevrons + Open-in-editor at --target-sm), Tooltip (Done-shipped hint, multi-claim overflow, Open-in-editor)
- components-new: RoadmapCanvas, RoadmapStatusCircle, RoadmapBlock (+ co-located stubs RoadmapEditProposalBlock and CompletionClaimBlock claiming registry slots for 22.D)
- primitives: Stack-equivalent flex columns (no new primitives needed; existing tokens drive the layout)
- tokens: --space-1, --space-2, --space-3, --space-4, --space-5, --radius-sm, --radius-md, --color-text, --color-text-meta, --color-border-subtle, --color-success, --color-on-success, --font-size-xs, --font-size-sm, --font-size-md, --font-mono, --font-weight-strong, --motion-standard, --target-sm, --gray-a3 (sub-row tint stub — TODO(22.G) swap to --team-tint-light), --focus-outline-width, --focus-outline-color, --accent-8, --color-surface-2, --color-surface-3, --color-danger
- invariants: pending — runs on tools/invariants/check.mjs in the quality-gates pass
- deviations: none. Stub only: --team-tint-light/dark land in 22.G; for 22.A the sub-row tint uses --gray-a3 light / --gray-a4 dark with an inline TODO(22.G) marker so the chromatic version slots in cleanly.
- feedback: pending. Backend: 24 roadmap module tests + 3 projection determinism tests + 1 real-roadmap.md smoke test (parses 301 KB / 143 nodes in 3.5 ms — well under the 100 ms budget). Frontend: 195 vitest tests green; tsc clean. The /staff-perspective-review pass returned 11 blockers (10 adopted; 1 pushed to follow-up); the synthesized plan is the canonical record of those decisions. Phase 22.I (shipping history) deliberately deferred per workspace direction.
