# propagate-language-update — trigger examples

Per plan §13.6.

## Should fire

1. "Propagate the new --radius-card value across every card component."
2. "We changed the density register to airy — update all spacing usages."
3. "Roll out the new primary accent across the codebase."
4. "Apply the design-language update from this morning's amendment."
5. "Sync every managed component with the new type-body size."

## Should NOT fire

1. "Update core-docs/design-language.md with a new accent." *(→ elicit-design-language)*
2. "Generate a new card component." *(→ generate-ui)*
3. "Audit this component for token usage." *(→ enforce-tokens)*
4. "Which components use --radius-card?" *(→ check-component-reuse — it's a reuse/inventory query)*
5. "Check a11y on this page." *(→ audit-a11y)*

## Phase 3 audit result

`<TO BE FILLED IN during Phase 3 trigger audit per §13.6.>`

## Phase 5 observations

`<Append notes on observed misses or false positives.>`
