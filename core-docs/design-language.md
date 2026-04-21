# Design Language

> Living documentation of Designer's design language. Source of truth for every token and axiom; all Mini skills read from this file. Produced by `elicit-design-language` on 2026-04-21 (greenfield mode); amended over time as the project matures.

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
3. **Accent identity:** `monochrome` — Designer's chromatic system is black, white, and neutrals only, in the Notion/Linear register. No named accent color ships by default. Two *functional* intensities exist: `calm` (the default, muted neutral-on-neutral) and `energized` (high-contrast, reserved for active/streaming/needs-you states). Semantic colors (`success` / `warning` / `danger` / `info`) remain chromatic and come from Mini's fixed semantic scales.
4. **Gray flavor:** `mauve` — starting seed. `olive` and `sand` are both explicitly on the table; swap via the Radix scale imports in `packages/ui/styles/tokens.css`. Pure `gray` was rejected (too cold for a design tool that wants to feel considered).
5. **Motion personality:** `snappy` (with considered liveliness) — `--motion-quick` / `--motion-standard` dominate; decorative micro-motion is allowed where it reinforces "alive on engagement" without crossing into expressive/spring territory.
6. **Type system:** `sans + mono` — `Geist` (UI) and `Geist Mono` (code, diffs, identifiers, spec blocks). No serif. Font wiring is deferred to Phase 8; token stack falls back to system fonts until Geist is loaded.
7. **Type scale ratio:** `perfect-fourth 1.333` — balanced hierarchy. Tighter than golden, more defined than minor-third.
8. **Surface hierarchy depth:** `3` — `flat` / `raised` / `overlay`. Modals share the overlay tier; no separate modal elevation in the token layer. Re-evaluate after first surfaces ship if overlays and modals need to visually distinguish.
9. **Radius personality:** `soft, sharper side` — button = 6px base. Badge 3px / card 10px / modal 14px. Tool-appropriate — neither brittle (2–4) nor pillowy (12+).
10. **Focus style:** `ring-outside` — 2px outline offset 2px. Highest a11y default; reinforces "trust through legibility."

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
`--space-1` through `--space-8`. Base `--space-3 = 8px` (tight 1.4 × body).

### Type
Role-named (`caption`, `body`, `lead`, `h4`, `h3`, `h2`, `h1`, `display`), each with `-size`, `-leading`, `-weight`, `-tracking`. Families: `--type-family-sans` (Geist stack), `--type-family-mono` (Geist Mono stack). Weights: `regular` 400, `medium` 500, `semibold` 600, `bold` 700.

### Color
- **Accents:** `--accent-1..12` + `--accent-a1..a12`. **Bound to `--gray-*` in `tokens.css`** — Designer is monochrome by policy (axiom #3). No chromatic Radix import. Do not introduce a chromatic accent without amending this document.
- **Neutrals:** `--gray-1..12` + `--gray-a1..a12`. Sourced from the `mauve` Radix scale via an alias block in `:root`. The abstract `--gray-N` token name is stable; swap the underlying scale (olive, sand) by changing the 4 imports + rewriting the alias block.
- **Semantics:** `--success-*`, `--warning-*`, `--danger-*`, `--info-*` (chromatic; from green, amber, red, blue). Never swapped.
- **Contrast foregrounds:** `--accent-contrast`, `--danger-contrast`.

### Radius
`--radius-none`, `--radius-badge` (3px), `--radius-button` (6px), `--radius-card` (10px), `--radius-modal` (14px), `--radius-pill`.

### Motion
Durations: `--motion-instant` (50ms), `--motion-quick` (120ms), `--motion-standard` (250ms), `--motion-emphasized` (400ms). Easings: `--ease-out-enter`, `--ease-in-exit`, `--ease-standard`. Composed: `--motion-enter`, `--motion-exit`, `--motion-interactive`. Optional spring: `--motion-spring-snappy`.

### Elevation
Shadows: `--elevation-flat`, `--elevation-raised`, `--elevation-overlay`, `--elevation-modal`. Layers: `--layer-flat`, `--layer-raised`, `--layer-overlay`, `--layer-modal`.

## Patterns

High-level design patterns Designer has explicitly chosen. Not axioms (they don't drive token values) but recurring decisions worth codifying.

- **Agents streaming is a first-class live state**, not a "loading" state. It has its own visual language — subtle pulse, active-layer elevation, token-distinguished state row in the activity spine — and does not use any spinner/skeleton pattern.
- **Activity spine is the core awareness primitive.** Consistent row shape across altitudes (project / workspace / agent / artifact). States: `active` (subtle pulse), `idle` (muted), `blocked` (distinguishing token TBD — `--warning-*` vs. `--gray-11 + icon` to be decided when the spine is built), `needs-you` (notification dot), `errored` (`--danger-*`).
- **Empty states are load-bearing.** Designer surfaces many blank canvases (new project, new workspace, empty spine). They are not afterthoughts and receive equal craft weight with populated states.
- **Subtle optimization signals only.** Forge proposals, auditor pings, context-dedup events all announce themselves at a register below the user's current task — never as interrupting toasts.
- **Reduced-motion fallback is required, not optional.** Streaming content falls back to instant replace; subtle pulses fall back to static; any entrance animation falls back to instant.

## Evidence (initial elicitation)

Greenfield mode. No codebase scan performed — Designer is pre-implementation (Phase 0–1 per `core-docs/roadmap.md`). Axioms were elicited from the user directly, seeded in part by the `core-docs/design-language.draft.md` principles.

Axioms seeded from the draft (confirmed or amended by user):
- Motion personality (draft said "functional only"; user amended to "snappy + considered liveliness").
- Surface hierarchy depth = 3 (draft proposed this tier map directly).
- Focus style = ring-outside (aligned with "trust through legibility").
- Density register = balanced (aligned with "calm by default" + "summarize by default").
- Theme preference (draft said "dark-default, light-parity"; user amended to "system-default, both available").

Axioms elicited fresh: base line-height (1.4), accent identity (monochrome), gray flavor (mauve seed), type system (Geist + Geist Mono), type scale ratio (perfect-fourth), radius personality (soft-sharper, button=6px).

## Review Checklist

Before considering any UI change complete:

- [ ] Uses Mini tokens — no hardcoded values (no arbitrary px / hex / ms / z-index)
- [ ] Works in both light and dark mode
- [ ] Meets VoiceOver accessibility standards (focus-visible, keyboard path, contrast)
- [ ] Follows spacing, type, and radius scales
- [ ] Animation respects `prefers-reduced-motion`
- [ ] Does not break calm-by-default behavior of ambient surfaces
- [ ] Maintains manager's-cockpit feel — not developer-IDE feel
- [ ] Semantic colors used only for their semantic meaning (no decorative red/green)
- [ ] Monochrome policy respected — no chromatic accent introduced without an axiom amendment

## Change log

Every amendment to axioms or tokens is logged here with date, author, and rationale. Minor token tweaks (one value change) belong in `pattern-log.md`; axiom changes belong here.

- `2026-04-21`: initial elicitation (greenfield). 10 axioms set from user interview + draft seeding. No items marked `[NEEDS CONFIRMATION]`.
