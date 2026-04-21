# Invariants

Deterministic floor checks on Mini-generated UI. See plan §7.8 Track A.

## Run

```
node tools/invariants/check.mjs <path>            # human-readable
node tools/invariants/check.mjs <path> --json     # machine-readable
node tools/invariants/check.mjs <path> --md       # markdown for generation-log.md
```

Exit code `0` = all invariants pass, `1` = at least one violation.

## v1 invariant set

| ID | Scope | Checks |
|---|---|---|
| `no-hex-literals-in-css` | `.css` | `#rgb` / `#rrggbb` / `#rrggbbaa` outside `tokens.css`/`axioms.css`/`primitives.css` |
| `no-px-literals-in-css` | `.css` | Arbitrary `Npx` values (not `0px`, not inside `var(...)` fallbacks) |
| `no-duration-literals-in-css` | `.css` | Arbitrary `Nms` / `Ns` values (not `0ms`/`0s`, not inside `var(...)`) |
| `no-zindex-literals-in-css` | `.css` | `z-index: N` with a numeric literal (should reference a token) |
| `no-hex-literals-in-tsx` | `.tsx` | Hex color strings inside TSX (inline styles, JSX attributes) |
| `primitives-from-package` | `.tsx` | Primitive imports come from the Mini web package, not deep relative paths |

## What this script does NOT check

- **Focus-visible / a11y.** Semantic; belongs to `audit-a11y` skill.
- **Taste.** Whether the UI looks good. Not automatable.
- **Manifest registration.** Requires a populated `component-manifest.json`; deferred to Phase 3.
- **Accent × mode contrast iteration.** Requires rendering; deferred.

## Exemptions

Files named `tokens.css`, `axioms.css`, `primitives.css`, `archetypes.css` are skipped entirely — Mini's own platform-layer CSS legitimately contains hex, px, and ms literals (that's where tokens are defined and bound). Directories named `node_modules`, `.next`, `.turbo`, `dist`, `build`, `.git` are skipped. Invariants apply to *consumer project* CSS, not Mini's internals.

## Extending

Add a new invariant by appending to `INVARIANTS` in `check.mjs` and writing the matching scan function. Keep each invariant deterministic and fast — no network, no LLM calls, no file-system side effects.

## Integration

Phase 3: `generate-ui` step 4 calls this script on the generated files and pipes `--md` output into the `invariants` field of the new `generation-log.md` entry. Until then, invoke manually.
