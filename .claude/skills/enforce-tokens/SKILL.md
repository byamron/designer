---
name: enforce-tokens
description: Check that UI code uses design-language tokens, not arbitrary values. Use when the user asks to enforce tokens, check for hardcoded hex/px/ms values, lint token usage, or verify a file references tokens correctly.
---

# enforce-tokens

**Purpose:** Thin check — verify that UI code references tokens and archetypes rather than raw values or custom implementations. Uses the invariant script (`tools/invariants/check.mjs`) as the core mechanism, plus a few checks that benefit from design-language context. See plan §8.3.

**v1 priority:** lowest (§14.0 principle 5). Decays in value as models improve. Still worth shipping because the invariant runner is cheap and composes with the overall enforcement story.

## When this skill fires

Should fire on:
- "Enforce tokens on this component."
- "Check for hardcoded colors in the card styles."
- "Lint token usage in the changed files."
- "Verify this PR doesn't add any arbitrary px values."

Should NOT fire on:
- "Generate a new component." *(→ generate-ui; runs the invariant check inline at step 4)*
- "Audit for a11y." *(→ audit-a11y)*
- "Propagate the new token." *(→ propagate-language-update)*

## Procedure

### Step 1 — Run the invariant script

```
node tools/invariants/check.mjs <target-path> --md
```

Invariants checked:
- `no-hex-literals-in-css`
- `no-px-literals-in-css`
- `no-duration-literals-in-css`
- `no-zindex-literals-in-css`
- `no-hex-literals-in-tsx`
- `primitives-from-package`

See `tools/invariants/README.md`.

### Step 2 — Context-aware checks (on top of the script)

Read `core-docs/design-language.md` and `core-docs/component-manifest.json`. Additional checks:

- **Token exists.** Every `var(--<token>)` reference resolves to a token defined in `web/tokens.css` (or the design language). Dangling references (`var(--accent-13)` when only 1–12 exist) are violations.
- **Primitive use over raw div.** A bare `<div style={{ padding: ... }}>` in a component is a reuse-check failure: it should be `<Box padding={...} />`. Flag and suggest.
- **Archetype use over custom implementation.** A component that implements its own dropdown rather than using `Menu` or `Select` is flagged. Surface; recommend archetype substitution.

### Step 3 — Report

Per file, show:
- Invariant script output (from step 1).
- Context violations (from step 2).
- Recommended fix for each: token to use, primitive/archetype to substitute.

If invoked as part of a generation (follow-up to `generate-ui`), write the summary to `core-docs/generation-log.md`. Otherwise stdout only.

## Outputs

- Markdown report.
- No file writes by default.

## Failure modes

- **Legitimate deviation.** A component intentionally uses a raw value (e.g., a hand-tuned animation curve that no motion token expresses). Options: (a) add a new token via `elicit-design-language` amendment, (b) accept + log in `pattern-log.md` with rationale. Skill does not auto-accept.
- **Legacy component.** Flagged with `status: legacy` in manifest. Check still runs; report is informational. Do not propose changes (per amendment #10).
- **No design language.** Invariant script runs fine without it; context checks degrade. Warn and proceed with invariant-only report.
