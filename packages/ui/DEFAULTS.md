# Mini — platform defaults

> What ships in `tokens.css`, `axioms.css`, and the primitive/archetype CSS — and *why*. Mini is headless in principle (plan §3 principle 1), but shipping default values is itself an opinion. This file records those defaults honestly. Consumers override freely via `core-docs/design-language.md` in their project.

## Why document defaults

- **Starting point.** Every greenfield project inherits these until elicitation tunes them.
- **Transparency.** An undocumented default is still an opinion — adopters should know what they're getting.
- **Propagation.** When a default changes, this file is the change log; consumers can diff to decide whether to inherit.

These defaults are *not* a design language. `core-docs/design-language.md` is the per-project design language. Mini-as-a-repo has no product surface yet, so no design language of its own — but the defaults below will seed one when the docs site and `archetype-matrix` fixture come online.

## Per-token rationale

### Spacing

- **Base `--space-3: 8px`** — half a base line-height unit at 16px body. Widely validated (Material's 8dp grid, Tailwind's default scale).
- **Scale:** 2 → 4 → 8 → 16 → 24 → 32 → 48 → 64. Mixed-ratio modular scale, roughly 2× at small steps then 1.5× at larger. Compromises between "tight density" (1.5× throughout) and "airy" (2× throughout) — balanced register.

### Type

- **Base size `--type-body-size: 16px`** — browser default; most accessible; survives zoom.
- **Base leading `--type-body-leading: 1.5`** — WCAG AAA minimum for body text.
- **Family `--type-family-sans`** — native OS font stack (`ui-sans-serif, system-ui, -apple-system, …`). Zero webfont cost, best performance, universal legibility. Override when brand demands a specific typeface.
- **Scale ratio** — approximately minor third (~1.25) but hybrid. 12 → 16 → 18 → 20 → 24 → 32 → 40 → 56.
- **Weights** — 400 / 500 / 600 / 700. Most variable fonts support all four.

### Color

- **Accent default: `indigo`** (Radix Colors). Neutral; broad visual compatibility; commonly used.
- **Accent configured: `crimson`** (scaffold only; no semantic declared). Demonstrates the `[data-accent]` rebind path; swap or remove per project.
- **Gray: `gray`** (Radix pure — neutral temperature). Override to `slate`, `mauve`, `sand`, `sage`, `olive` per gray-flavor axiom.
- **Semantics: `green` (success) / `amber` (warning) / `red` (danger) / `blue` (info)** — conventional web mappings. Fixed; not accent-swapped.
- **Contrast foreground — `white`** for solid accent/danger fills. Override to `gray-12` for light accent scales (amber, yellow, lime, etc.) so text remains legible on solid.

### Radius

- **`--radius-button: 8px`, `--radius-card: 12px`, `--radius-modal: 16px`** — soft personality. Not sharp (2–4px, architectural) or pillowy (12–16px on buttons, playful).
- Radius scales with surface importance: badge smallest, pill fully rounded.

### Motion

- **Duration slots** — `instant 50ms` / `quick 120ms` / `standard 250ms` / `emphasized 400ms`. Snappy personality; upper bound stays under the WCAG-recommended ~500ms ceiling for non-opt-in motion.
- **Easing** — `ease-out-enter: cubic-bezier(0.20, 0, 0, 1)` (material-like, gentle-land), `ease-in-exit: cubic-bezier(0.40, 0, 1, 0.30)` (fast-exit). Same bezier for enter and standard — distinction lives in duration.
- **Composed role tokens** — `motion-enter` (standard + out-enter), `motion-exit` (quick + in-exit), `motion-interactive` (instant + standard).
- **Spring approximations** — `motion-spring-snappy`, `motion-spring-weighted`. CSS can't spring natively; these are tuned beziers that feel spring-ish.
- **Reduced-motion** — all transitions/animations collapse to `0.01ms` via the global axiom in `axioms.css`.

### Elevation

- **Four-tier shadow scale.** `flat` (none) / `raised` (subtle, 1px offset) / `overlay` (floating panels, 8px offset, 24px blur) / `modal` (deep, 24px offset, 48px blur).
- **Paired z-index layers.** `--layer-raised: 1`, `--layer-overlay: 10`, `--layer-modal: 100`. Things that rise visually also rise in stack order.
- Shadow values use `rgb(0 0 0 / <alpha>)` — neutral black; tune per project if a tinted shadow is desired (e.g., `rgb(30 20 80 / 0.12)` for a cooler feel).

### Focus

- **`--focus-outline-width: 2px`, `--focus-outline-offset: 2px`** — ring-outside, WCAG-safe default.
- **`--focus-outline-color: var(--accent-8)`** — high-contrast against every accent × mode combo in Radix. Rebind per project via the focus-style axiom (design-axioms §10).

## Overriding

In your project, declare axiom values in `core-docs/design-language.md`, then rebind in a layered `tokens.css` override:

```css
/* your-project/styles/overrides.css — loaded after mini's tokens.css */
:root {
  --space-3: 0.625rem;       /* 10px base instead of 8 */
  --radius-button: 4px;       /* sharper personality */
  --focus-outline-color: var(--accent-9); /* stronger ring */
}
```

Logical token *names* never change across projects. Only *values* differ. This is what makes `propagate-language-update` tractable.

## Change log

- **2026-04-20** — Initial defaults documented. Extracted from the in-repo archaeology test on Mini's own source.
