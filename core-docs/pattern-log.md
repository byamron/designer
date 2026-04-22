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
