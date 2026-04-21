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
