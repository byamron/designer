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
- feedback: pending
