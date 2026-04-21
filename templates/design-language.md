# Design Language

> Living documentation of this project's design language. Produced by `elicit-design-language`; amended over time as the project matures. See Mini plan §7.6, §8.1, and `core/design-axioms.md`.

## Axioms

The top-level rules from which all tokens derive. Changing an axiom is a propagation event; see `pattern-log.md` for change rationale.

1. **Base line-height:** `<value>` — drives `space-3` and the spacing scale.
2. **Density register:** `<tight | balanced | airy>` — drives the ratio between adjacent spacing steps.
3. **Accent identity:** `[<name>: <intent>, ...]` — the accent scales this project ships.
4. **Gray flavor:** `<slate | mauve | sage | olive | sand | gray>` — the neutral family.
5. **Motion personality:** `<snappy | weighted | spring>` — drives easing curves and duration slots.
6. **Type system:** `[<sans>, <serif>?, <mono>?]` — font family choices.
7. **Type scale ratio:** `<minor-third | perfect-fourth | golden | custom>` — drives type sizes.
8. **Surface hierarchy depth:** `<1 | 2 | 3 | 4>` — how many elevation tiers are in use.
9. **Radius personality:** `<sharp | soft | pillowy>` — drives radius values across roles.
10. **Focus style:** `<ring-outside | ring-inside | highlight>` — focus-visible rendering.

## Tokens

Derived from axioms. Values live in `web/tokens.css` (or the Swift equivalent). This section mirrors the structure.

### Spacing
- `space-1` through `space-8` — modular scale derived from base line-height × density ratio.

### Type
Per role (`caption`, `body`, `lead`, `h4`, `h3`, `h2`, `h1`, `display`):
- `type-<role>-size`
- `type-<role>-leading`
- `type-<role>-weight`
- `type-<role>-tracking`

Families: `type-family-sans`, `type-family-serif` (if used), `type-family-mono` (if used).
Weights: `weight-regular`, `weight-medium`, `weight-semibold`, `weight-bold`.

### Color
- **Accents:** `accent-1` through `accent-12` (+ `accent-a1..a12` alpha). Active scale bound via `[data-accent="<name>"]`.
- **Neutrals:** `gray-1` through `gray-12` (+ alpha).
- **Semantics:** `success-*`, `warning-*`, `danger-*`, `info-*` (each 1–12).
- **Contrast foregrounds:** `accent-contrast`, `danger-contrast` (typically `white` or `gray-12` depending on scale).

### Radius
`radius-none`, `radius-badge`, `radius-button`, `radius-card`, `radius-modal`, `radius-pill`.

### Motion
- Durations: `motion-instant`, `motion-quick`, `motion-standard`, `motion-emphasized`.
- Easings: `ease-out-enter`, `ease-in-exit`, `ease-standard`.
- Composed: `motion-enter`, `motion-exit`, `motion-interactive`.
- (Optional) `motion-spring-snappy`, `motion-spring-weighted`.

### Elevation
- Shadows: `elevation-flat`, `elevation-raised`, `elevation-overlay`, `elevation-modal`.
- Layers: `layer-flat`, `layer-raised`, `layer-overlay`, `layer-modal`.

## Patterns

High-level design patterns this project has explicitly chosen. These are not axioms (they don't drive token values) but recurring decisions worth codifying.

- <pattern 1: e.g., "form fields always show label above input, never placeholder-as-label">
- <pattern 2>

## Evidence (initial archaeology)

Populated by `elicit-design-language` on first run. Summarizes the scan that seeded this language.

- Hex values found: `<N>` (clustered into `<M>` accent candidates)
- Spacing values found: `<N>` (clustered into `<M>` steps)
- Components inventoried: `<N>` (`<X>` Radix-wrapped, `<Y>` primitive compositions, `<Z>` custom)
- <additional notes>

## Change log

Every amendment to axioms or tokens is logged here with date, author, and rationale. Minor token tweaks (one value change) belong in `pattern-log.md`; axiom changes belong here.

- `<YYYY-MM-DD>`: initial archaeology. `<N>` items marked `[NEEDS CONFIRMATION]`.
