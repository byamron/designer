# ADR 0006 — Mini layout primitives: defer adoption decision

**Status:** Deferred (2026-04-27)
**Deciders:** user (long-term technical direction) + design-system audit
**Related:** `core-docs/design-language.md` (Mini contract), `core-docs/pattern-log.md` "Mini primitives deferred" (2026-04-21), `packages/ui/src/primitives/`

## Context

Mini ships eight layout primitives — `Box`, `Stack`, `Cluster`, `Sidebar`, `Center`, `Container`, `Frame`, `Overlay` — at `packages/ui/src/primitives/`. They wrap a div and apply structural CSS (gap, direction, alignment, padding) via classes from `primitives.css`, with token-typed props that prevent arbitrary values at the call site.

Designer has shipped 30+ components (Phases 8–13.K + 21.A1) without consuming any of them. Every consumer file uses raw HTML + `className` against rules in `packages/app/src/styles/app.css`. The pattern is internally consistent and produces a coherent product, but it leaves Mini's primitives package at 0% adoption and the question of "should we adopt them" formally unresolved.

This ADR records the decision to **defer** that resolution, the reasoning, and the explicit conditions under which it should be reopened.

## The two real options

### Option A — Skip primitives; commit to CSS-class layout
Layout intent lives in CSS, expressed as BEM-style classes per component. Tokens are enforced via `tools/invariants/check.mjs` (no arbitrary px/hex/ms/z-index). Visual styling and layout share the same file per component family.

**Strengths at Designer's current scale:**
- DOM stays semantic (`<article>`, `<button>`, `<dialog>` instead of wrapper-div trees).
- Modern CSS features (`:has()`, `@container`, `color-mix()`, `subgrid`, `field-sizing`) compose naturally; primitive libraries lag the platform.
- Pseudo-selectors and `[data-*]`-driven state belong in CSS — primitives force a hybrid of JSX classes and CSS rules.
- Single layout system, fewer things to learn, faster onboarding.
- Debugging is one click in DevTools — class → rule → source.

**Weaknesses:**
- The token-enforcement bar is a runtime invariant pass, not a TypeScript type error at the call site. A regressed pre-commit hook drops the bar.
- Mini's primitives package becomes dead code in this repo; either deleted or maintained as upstream-we-don't-consume.
- Less leverage if Designer ever ships a second product surface (mobile, marketing site, web cockpit).

### Option B — Commit to primitives across the codebase
Layout migrates from CSS rules into JSX props (`<Stack gap="3">`). Component-specific visual CSS stays. Token enforcement moves into the prop signature (`gap` only accepts a token name).

**Strengths at scale (multi-product, multi-author, larger surface):**
- Token enforcement is a TypeScript error, not a runtime check.
- Shared layout abstraction across products (web + mobile + marketing) — primitives are the portable layer.
- Layout intent is co-located with markup; refactoring a layout pattern is a primitive rename.
- New components are faster to write; consistency-by-prop-shape is more reliable than consistency-by-convention when the team grows.

**Weaknesses at Designer's current scale:**
- Mixed-state codebase during migration is real and lasts months ("old components express layout in CSS, new in JSX"). Wholesale migration is the only escape, and it's expensive.
- Wrapper-div proliferation degrades the DOM unless the library has a robust `as` story (most don't).
- A non-trivial fraction of Designer's layout cannot use primitives anyway: position-fixed overlays, the negative-margin tab seam, two-layer shadows, the surface-gutter math, container queries, anything with `color-mix()`. Those stay CSS — primitives don't replace them.
- Debugging gains a layer of indirection.

## Decision

**Defer the choice.** Designer currently ships well under Option A; the Phase 13/21 work landed coherently with token enforcement carrying the load. Committing to Option B today buys ergonomics, not correctness, at the cost of a months-long mixed-state migration during active feature work.

The decision becomes more expensive to defer — and Option B becomes more clearly correct — when one or more of the **tripwires** below fires.

## Reopen tripwires

Revisit this ADR when **any one** of the following is true. The first to fire is the right moment to commit.

1. **A second product surface starts.** Mobile app, marketing site, or web cockpit project gets greenlit. At that point primitives become the portable layer between products and the cost calculus inverts. **Most likely tripwire** per user direction (2026-04-27).
2. **Component count crosses ~50.** Designer has ~30 today. At ~50 the cost of "every new component reinvents flex" starts compounding noticeably; consistency-by-convention becomes harder to enforce by review.
3. **A second contributor regularly authors UI.** When more than one person is shipping components weekly, prop-shape enforcement beats convention enforcement. (Concurrent Claude sessions count; AI-driven UI generation that has to respect the language counts more — see FB-0034.)
4. **`packages/app/src/styles/app.css` regrows past ~2000 lines after Stage 2 splits it.** Signal that organization isn't holding under feature pressure.
5. **Mini upstream evolves the primitives** in a way Designer wants to consume (e.g., a `<Frame>` variant that handles the floating-surface register natively). Pull-driven adoption.

## Until a tripwire fires

- The primitives package stays in the repo (sync target via `scripts/sync-mini.sh`) but is not imported by app code.
- New components ship using the existing CSS-class pattern. Convention is enforced by:
  - `tools/invariants/check.mjs` (CI-gated as of 2026-04-27 per Stage 1) — no arbitrary px/hex/ms/z-index.
  - Manifest coverage check (CI-gated) — every component file appears in `core-docs/component-manifest.json`.
  - Per-component CSS files after Stage 2 splits `app.css` — bounded surface area for review.
- `pattern-log.md`'s "Mini primitives deferred" entry is superseded by this ADR. The "Mini primitives" line in the manifest schema (`primitives_used` array, enum of eight names) stays defined; entries can leave it empty without violating the schema.

## Consequences

- The frontend's enforcement story for the next ~1–2 phases is: tokens via invariants, manifest via CI, semantic colors via Radix scales, role layer via app.css. Primitives are *not* part of that story.
- If a tripwire fires, migration scope is bounded by the component count at that moment — which is why the tripwires fire early (50 components, second surface) rather than late.
- The longer-term north star — see FB-0034 — is an AI enforcement loop tight enough that prompts produce cohesive, language-compliant components on the first try. Primitives are *one* possible enforcement substrate for that loop; CSS classes + invariants + manifest are *another*. The substrate decision is downstream of the loop's actual bottleneck once a few AI-driven components have been generated and reviewed.

## Re-evaluation prompt

When a tripwire fires, run this audit:

1. Count current components and lines of `app.css` (or its post-split successors).
2. Count primitive-shaped layout patterns (flex columns/rows, two-column sidebars, centered content) in the existing CSS — that's the migration target size.
3. Count layout patterns that *cannot* be expressed as primitives (position-fixed, transforms, negative-margin tricks, container queries) — that's the residual CSS that stays no matter what.
4. If migration target / residual ratio > ~3:1, primitives earn their slot. Otherwise the mixed state is permanent and not worth entering.
5. Sync Mini before committing. Adopting yesterday's primitives, then re-syncing, is double migration.
