---
name: audit-a11y
description: Run an accessibility audit on UI code — focus order, keyboard path, ARIA correctness, color encoding, motion anti-patterns, contrast across accent and mode combinations, and touch target sizing. Use when the user asks to audit, check, verify, or lint for a11y, or to check contrast across themes.
---

# audit-a11y

**Purpose:** Verify generated or existing UI against the a11y contract (`core/a11y.md`). Plan §8.4.

## When this skill fires

Should fire on audit/check verbs applied to a11y:
- "Audit this page for a11y."
- "Check keyboard navigation on the settings flow."
- "Verify contrast across all accents and dark mode."
- "Lint for motion anti-patterns in this component."
- "Does this dialog meet the a11y contract?"

Should NOT fire on:
- "Build an accessible dialog." *(→ generate-ui, which runs inline a11y checks via step 5)*
- "What's our focus style?" *(→ elicit-design-language or manual read of design-language.md)*
- "Check tokens." *(→ enforce-tokens)*

## Procedure

Read `core/a11y.md` for the full contract. Then run six check classes on the target files.

### 1. Structural

- Every `<button>` is a real `<button>` (not `<div onClick>`).
- Every `<a>` has an `href`.
- Headings have a coherent hierarchy (h1 → h2 → h3), exactly one h1 per page.
- Landmark regions present: `<header>`, `<nav>`, `<main>`, `<footer>`, `<aside>` as appropriate.
- Every `<img>` has `alt` (descriptive or `alt=""` for decorative).
- Every form control has an associated `<label>`.
- No positive `tabindex` values.

### 2. Keyboard

- Every interactive path has a keyboard equivalent.
- Focus-visible style is present on every interactive element.
- Keyboard shortcuts don't conflict with browser/OS defaults.
- For archetypes: arrow-key navigation where the contract requires it (Menu, Select, RadioGroup, Tabs).

### 3. ARIA correctness

For each archetype detected, verify per `core/archetypes.md`:
- Required roles and states are set correctly.
- `aria-expanded`, `aria-pressed`, `aria-selected`, `aria-checked` reflect state.
- Label association via `aria-labelledby` / `aria-describedby` / visible label.
- No ARIA where native semantics suffice (e.g., don't `role="button"` on a `<button>`).

### 4. Motion

- `prefers-reduced-motion` respected (the global axiom in `axioms.css` should cover this; warn if a component overrides it).
- No duration over ~500ms on non-opt-in motion.
- No auto-play video with sound.
- No parallax without reduced-motion fallback.
- Indicator animations (`role="status"`) have appropriate ARIA.

### 5. Contrast — across accent × mode (amendment #7)

For every color usage:
- Compute foreground-on-background contrast ratio.
- Check WCAG AA: 4.5:1 (body text), 3:1 (large text, non-text UI).
- **Iterate** across every `[data-accent="<name>"]` × `[data-theme="light|dark"]` combination declared in `design-language.md`.
- Report per cell: pass/fail with the computed ratio.

This is the most expensive check; optionally parameterize by accent subset if the user specifies.

### 6. Touch targets

- Every interactive element ≥44×44 CSS pixels on mobile (total hit area including padding).
- Adjacent interactive targets separated by ≥8px OR non-overlapping hit areas.

## Depth

- **Static checks (1–3):** parse the source, static analysis. Always run.
- **Motion checks (4):** parse the source + reference `axioms.css`. Always run.
- **Contrast (5):** requires computed style; may require headless render in v1. Best-effort static + numeric computation from token values.
- **Touch targets (6):** requires computed size. Best-effort from CSS + primitive props.

Checks 5 and 6 may fall back to "deferred; manual review recommended" in v1 for complex cases. Static checks 1–4 never defer.

## Report format

Produce a markdown report per file with:
- Pass/fail per check class.
- Per violation: location (file:line), rule, current value, recommended fix.
- Summary table: total issues, blocker issues (contrast failures, missing keyboard paths), warning issues (suggestions).

Append a compact summary to `core-docs/generation-log.md` if invoked by the user after a generation event; otherwise don't pollute the log.

## Outputs

- Markdown report (stdout or file per user preference).
- Optional `generation-log.md` append if invoked as a follow-up to generation.

## Failure modes

- **Component uses runtime-computed classes (CSS-in-JS string concat).** Static analysis degrades. Warn; defer the class to manual review.
- **Accent × mode matrix is large.** 5 accents × 2 modes = 10 combinations per color pair. Cap at e.g. the 10 most-referenced color pairs if the number explodes.
- **Design language missing contrast-critical info.** If `--accent-contrast` is not defined, can't compute button-text contrast. Surface; ask user.
