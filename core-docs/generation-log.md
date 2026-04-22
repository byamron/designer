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
- feedback: pending
