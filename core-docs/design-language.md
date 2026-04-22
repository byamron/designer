# Design Language

> Living documentation of Designer's design language. Source of truth for every token and axiom; all Mini skills read from this file. Produced by `elicit-design-language` on 2026-04-21 (greenfield mode); evolved through a shipped surface pass in 2026-04-22 (the "UI critique" round and its staff-review amendment).

Mini's scaffolding lives at `packages/ui/`. Fork-and-own tokens in `packages/ui/styles/tokens.css`; the structural CSS (`axioms.css`, `primitives.css`) tracks upstream Mini. See `packages/ui/MINI-VERSION.md` for the currently synced commit.

---

## Core Principles

Product-level principles that shape every axiom below. These outrank axioms when in conflict — an axiom that violates a principle is wrong, not the principle.

1. **Manager's cockpit, not developer's IDE.** Every surface must feel first-class to a clear thinker with domain expertise — not a simplified version of a tool built for engineers.
2. **Summarize by default, drill on demand.** Dense dashboards are a failure mode. Rich surfaces are earned; the default should fit at a glance.
3. **Calm by default, alive on engagement.** Ambient surfaces stay quiet. Active surfaces come alive with streaming content, previews, and chain-of-thought. The transition should feel deliberate.
4. **Subtle confirmation over explicit signals.** When the system is optimizing (Forge proposals, auditor checks, context dedup), surface it subtly — never interrupt.
5. **Trust through legibility.** The user should always know what agents are doing, what they have permission to do, and what happened while the user was away.
6. **Motion is mostly functional, with considered liveliness.** Movement communicates state change (active → idle, streaming → complete). It's also a design tool, so small, deliberate decorative touches are welcome where they make the product feel alive rather than inert. No gratuitous motion.

## Axioms

The top-level rules from which all tokens derive. Changing an axiom is a propagation event; see `pattern-log.md` for change rationale.

1. **Base line-height:** `1.4` — tight register; it's a tool, not a reading surface. Drives `--space-3` and the spacing scale.
2. **Density register:** `balanced` — leans tight. Summarize-by-default rules out airy; calm-by-default rules out aggressively tight. Adjacent-step ratio is ~2× in the Mini default spacing.
3. **Accent identity:** `monochrome` — Designer's **base palette** is black, white, and neutrals only, in the Notion/Linear register. No named accent color ships. Two *functional* intensities express emphasis instead: `calm` (the default, muted neutral-on-neutral) and `energized` (high-contrast, reserved for active/streaming/needs-you states). **Semantic colors are always available and always chromatic** — `--success-*` (green), `--warning-*` (amber), `--danger-*` (red, used for destructive actions too), `--info-*` (blue) come from Mini's fixed semantic scales and should be used whenever the color is carrying signal meaning (state, severity, outcome). "Monochrome" constrains the decorative/brand/accent layer, not the signal layer.
4. **Gray flavor:** `sand` — warm neutral. Reads as paper, not cream; a whisper of warmth on a black-and-white register. Swap via the Radix scale imports in `packages/ui/styles/tokens.css`.
5. **Motion personality:** `snappy` (with considered liveliness) — `--motion-quick` / `--motion-standard` dominate; decorative micro-motion is allowed where it reinforces "alive on engagement" without crossing into expressive/spring territory.
6. **Type system:** `sans + mono` — `Geist` (UI) and `Geist Mono` (code, diffs, identifiers, spec blocks). No serif. Font wiring is deferred to Phase 8; token stack falls back to system fonts until Geist is loaded.
7. **Type scale ratio:** `perfect-fourth 1.333` — balanced hierarchy. Tighter than golden, more defined than minor-third.
8. **Surface hierarchy depth:** `3` — `flat` / `raised` / `overlay`. Modals share the overlay tier; no separate modal elevation in the token layer. Re-evaluate after first surfaces ship if overlays and modals need to visually distinguish.
9. **Radius personality:** `soft, sharper side` — button = 6px base. Badge 3px / card 10px / modal 14px. Tool-appropriate — neither brittle (2–4) nor pillowy (12+).
10. **Focus style:** `ring-outside` — 2px outline offset 2px. Highest a11y default; reinforces "trust through legibility." For compose-style containers where the input is visually embedded, apply the ring to the *container* via `:focus-within` rather than the child input, using `box-shadow` at the same intensity.
11. **Spacing rhythm:** `3/4/5/6` — surfaces compose from four canonical steps. `--space-3` (8px) for inline gaps and row horizontal padding. `--space-4` (16px) for panel edge padding and group gap. `--space-5` (24px) for stacked content blocks and main content inset. `--space-6` (32px) for section breaks on home-style surfaces. `--space-1 / --space-2 / --space-7 / --space-8` are exceptions and should be justified in `pattern-log.md`. Documented at the top of `app.css`.
12. **Information architecture scope:** `project : workspace : tab`. **Home is project-level**, lives in the left sidebar, and shows state across every workspace in the project. **Tabs are workspace-level** (Plan, Design, Build, Blank); opening a workspace activates its first tab. There is no workspace-level "home tab" — the home view IS the project overview.
13. **Icon sizing:** three steps — `--icon-sm` (12px), `--icon-md` (14px), `--icon-lg` (16px). All inline SVGs use `currentColor` so color inherits from the surrounding text-color token. Strokes: `1.25` at sm/md, `1.5` at lg.

### Theme

Not a Mini axiom, but locked here because it affects every other decision:

- **Default:** system preference (`prefers-color-scheme`). Both light and dark are first-class.
- **Parity requirement:** no surface ships in one mode without working in the other.

## Depth Model

Three surface tiers, mapped to Designer's layout:

- **Navigation** (project strip, workspace sidebar) → `elevation-flat` / `layer-flat`
- **Content** (main view, tabs, activity spine) → `elevation-raised` / `layer-raised`
- **Float** (modals, OS notifications, live tray when pinned) → `elevation-overlay` / `layer-overlay`

Modal-specific elevation (`elevation-modal` in Mini tokens) exists for future use but is not currently in the tier map — modals borrow the `overlay` tier until we find a reason to distinguish.

## Tokens

Derived from axioms; authoritative values live in `packages/ui/styles/tokens.css`. This section names what exists — do not duplicate values here, they drift.

### Spacing
`--space-1` through `--space-8`. Base `--space-3 = 8px` (tight 1.4 × body). Canonical rhythm is `3/4/5/6` (axiom #11).

### Type
Role-named (`caption`, `body`, `lead`, `h4`, `h3`, `h2`, `h1`, `display`), each with `-size`, `-leading`, `-weight`, `-tracking`. Families: `--type-family-sans` (Geist stack), `--type-family-mono` (Geist Mono stack). Weights are abstract tokens (`--weight-regular` 400, `--weight-medium` 500, `--weight-semibold` 600, `--weight-bold` 700). *Do not write `--type-weight-*` — that prefix was a consumer-side typo that silently fell back to UA defaults. All consumers now reference `--weight-*`.*

### Color
- **Accents:** `--accent-1..12` + `--accent-a1..a12`. **Bound to `--gray-*` in `tokens.css`** — Designer is monochrome by policy (axiom #3). No chromatic Radix import. Do not introduce a chromatic accent without amending this document.
- **Neutrals:** `--gray-1..12` + `--gray-a1..a12`. Sourced from the `sand` Radix scale via an alias block in `:root`. The abstract `--gray-N` token name is stable; swap the underlying scale by changing the 4 imports + rewriting the alias block.
- **Semantics:** `--success-*`, `--warning-*`, `--danger-*`, `--info-*` (chromatic; from green, amber, red, blue). Never swapped.
- **Contrast foregrounds:** `--accent-contrast`, `--danger-contrast`.

### Radius
`--radius-none`, `--radius-badge` (3px), `--radius-button` (6px), `--radius-card` (10px), `--radius-modal` (14px), `--radius-pill`.

### Motion
Durations: `--motion-instant` (50ms), `--motion-quick` (120ms), `--motion-standard` (250ms), `--motion-emphasized` (400ms). Easings: `--ease-out-enter`, `--ease-in-exit`, `--ease-standard`. Composed: `--motion-enter`, `--motion-exit`, `--motion-interactive`. Optional spring: `--motion-spring-snappy`.

### Elevation
Shadows: `--elevation-flat`, `--elevation-raised`, `--elevation-overlay`, `--elevation-modal`. Layers: `--layer-flat`, `--layer-raised`, `--layer-overlay`, `--layer-modal`.

### Icon
`--icon-sm` (12px), `--icon-md` (14px), `--icon-lg` (16px). See axiom #13.

## Patterns

High-level design patterns Designer has explicitly chosen. Not axioms (they don't drive token values) but recurring decisions worth codifying.

- **Panels, not cards.** Inside a content surface, sections are titled blocks separated by whitespace and (when needed) a single hairline divider — not bordered rectangles stacked into a grid. No cards-within-cards. Card chrome is reserved for genuinely floating surfaces (modals, tray items, the compose dock). Rationale: borders compound visually across a dashboard; the dashboard starts shouting; nothing reads as the anchor.
- **Home is a project-level surface, not a tab.** Lives in the left sidebar under the project header; activating it deselects any workspace. Shows vision, near-term focus, active workspaces (with status icons), recent reports, needs-you, autonomy. A small "Project home" kicker above the lede tells first-time users what surface they're on.
- **Home may be a prompt, not a dashboard.** Variant B is palette-first (Dia-inspired): one centered input + 4–6 context-aware suggestions + a collapsed brief. Honors *summarize-by-default, drill-on-demand* more literally than a grid. Variant A (panels dashboard) and Variant B (palette) are switchable at runtime via an explicit toggle in the topbar. Treat variant switchability as an ongoing design tool: when two load-bearing directions both have merit, ship both behind a toggle and let real use decide rather than speculating.
- **Linear-style tabs.** Pill containers that render side-by-side inside the tabs bar. Active = raised background + thin border; inactive = transparent muted label. `flex: 0 1` with min/max widths so tabs grow to natural size and shrink proportionally when crowded (not equal-flex). Each tab has a template icon left + label + an `X` close affordance that becomes visible on hover/focus/active. Close also responds to middle-click and ⌘W.
- **Single "+ New" dropdown, not a button cluster.** One affordance that opens a menu of template options (Plan / Design / Build / Blank), each with its own icon + description. Keyboard: ⌘T toggles; click-outside or Escape closes.
- **Compose as dock, not card.** Multi-line chat input lives at the bottom of a tab via `TabLayout`'s `dock` slot. The dock itself has no panel chrome — the compose container (rounded, bordered) is the visual object, and it floats inside the tab body with matching max-width. Focus ring applies to the container via `:focus-within`, not the child textarea (which has `outline: none`). The footer row (model / effort / plan-mode toggle) sits inside the same container separated by a hairline; drag-over lights the border.
- **Activity spine rows are text, not pills.** No default background, no border. Rows are a two-column grid (`state-dot` + stacked `label` / `summary`). Depth is expressed via `padding-left: calc(var(--space-4) * depth)` and a `repeating-linear-gradient` background that draws hair-thin vertical rails at each ancestor's indent. The rails are decorative and non-interactive; the state-dot remains the primary signal.
- **Spine summary as dot + count, not text only.** The "2 active · 0 needs you · 0 errored" block becomes one inline-dot-plus-count per state, zero-states collapsed to nothing ("All quiet" appears when everything is zero). Colors come from the semantic scales (`--info-11` / `--warning-11` / `--danger-11` / `--success-11`).
- **Workspace status icons.** Workspace rows carry an optional `WorkspaceStatus` orthogonal to lifecycle (`state`). Seven glyphs, each colored from a semantic token: `idle` (muted outline), `in_progress` (info-11), `in_review` (warning-11), `pr_open` (ink), `pr_conflict` (danger-11), `pr_ready` (success-11), `pr_merged` (success-11). When `status` is set, it replaces the state-dot; when absent, state-dot shows.
- **Every interactive element has a concise tooltip.** Icon-only buttons get a `title` that names the action. Text buttons get a `title` that adds something the label doesn't — keyboard shortcut, clarifying phrase, or full target (e.g. "Send (⌘↵)", "Close Plan (⌘W)"). Inputs get a `title` explaining intent. Keep them tight: a short phrase, not a sentence.
- **Keyboard shortcuts are declared in the tooltip, not a cheat sheet.** ⌘K (quick switcher), ⌘T (new tab menu), ⌘W (close active tab), ⌘\ (toggle project strip), ⌘↵ (send compose), ↑↓↵ (navigate quick switcher), ← → (move between tabs when focused). Discoverability via tooltips on hover; no separate help overlay.
- **Agents streaming is a first-class live state**, not a "loading" state. It has its own visual language — subtle pulse, token-distinguished row in the activity spine — and does not use any spinner/skeleton pattern.
- **Empty states are load-bearing.** Designer surfaces many blank canvases (new project, no workspaces, no tabs, all-quiet spine). They are not afterthoughts — each has intentional copy written for the manager's mental model, not generic UI jargon.
- **False affordances are a bug.** A button or input visible on the surface must do something today. If it's a stub, it ships either disabled (with a `Coming soon` title) or not at all. The mic button inside compose is the canonical example: it exists as a placeholder for Phase-13 dictation and is explicitly `disabled` until then.
- **Subtle optimization signals only.** Forge proposals, auditor pings, context-dedup events all announce themselves at a register below the user's current task — never as interrupting toasts.
- **Reduced-motion fallback is required, not optional.** Streaming content falls back to instant replace; subtle pulses fall back to static; any entrance animation falls back to instant.

## Evidence

Designer is no longer greenfield. Axioms 4, 10, 11, 12, and 13 were confirmed or added through a shipped surface pass in April 2026, informed by:

- A UI critique round comparing the initial build against Conductor, Dia, Notion, Linear, Cursor, Claude, and Slack. The critique produced the sand swap (mauve was decorative next to monochrome), panels-not-cards, linear-tabs, home-as-project, compose-as-dock, and the 3/4/5/6 spacing rhythm.
- A 16-annotation pass via Agentation that drove the close-X, status-icon, indent-rail, variant-toggle refinements, and the full tooltip coverage.
- A three-role staff review (UX / engineer / design engineer) that produced the IA scope axiom (#12), the icon-size token family (axiom #13 / #Tokens), the `--weight-*` token-name correction, and the container-level `:focus-within` focus pattern (refinement of axiom #10).

Axioms 1–3 and 5–9 remain from the initial elicitation.

## Review Checklist

Before considering any UI change complete:

- [ ] Uses Mini tokens — no hardcoded values (no arbitrary px / hex / ms / z-index)
- [ ] Uses `--weight-*` for font weights, never `--type-weight-*`
- [ ] Uses the `3/4/5/6` spacing rhythm unless explicitly justified
- [ ] Works in both light and dark mode
- [ ] Meets VoiceOver accessibility standards (focus-visible on every interactive target, keyboard path, contrast)
- [ ] Focus-visible ring-outside at 2px offset 2px — or, for compose-style containers, `:focus-within` box-shadow at equivalent weight
- [ ] Every interactive element has a concise `title` tooltip
- [ ] Animation respects `prefers-reduced-motion`
- [ ] Does not break calm-by-default behavior of ambient surfaces
- [ ] Maintains manager's-cockpit feel — not developer-IDE feel
- [ ] Semantic colors used for signal only (success/warning/danger/info) — not as decoration
- [ ] Monochrome policy respected — no chromatic **accent/brand** color introduced without an axiom amendment; semantic scales remain available and chromatic
- [ ] Home-is-project-level and workspace-tabs scopes respected (axiom #12)
- [ ] No false affordances — disabled buttons carry a `Coming soon` title or do not render
- [ ] SVG icons use `currentColor` and sizes from the `--icon-sm/md/lg` family

## Change log

Every amendment to axioms or tokens is logged here with date, author, and rationale. Minor token tweaks (one value change) belong in `pattern-log.md`; axiom changes belong here.

- `2026-04-21`: initial elicitation (greenfield). 10 axioms set from user interview + draft seeding.
- `2026-04-21`: axiom #4 amended. Gray flavor moved from `mauve` → `sand`. Motivation: mauve cast read as decorative next to the monochrome accent policy; sand gives a warm black-and-white register that aligns with the Notion/Linear/Dia references.
- `2026-04-22`: axiom #10 refined to cover compose-style containers (`:focus-within` on the container rather than the input).
- `2026-04-22`: axiom #11 added — spacing rhythm `3/4/5/6`. Codifies the canonical steps used after the spacing audit; `1/2/7/8` are now explicit exceptions.
- `2026-04-22`: axiom #12 added — IA scope (project : workspace : tab). Home moved from per-workspace to project-level; workspace tabs no longer include a Home.
- `2026-04-22`: axiom #13 added — icon sizing (`--icon-sm/md/lg` family). Codifies the 12/14/16px steps used by the SVG icons introduced in the shipped pass.
