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
