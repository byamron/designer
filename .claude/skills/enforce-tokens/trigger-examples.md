# enforce-tokens — trigger examples

Per plan §13.6.

## Should fire

1. "Enforce tokens on the changed files in this PR."
2. "Check for hardcoded hex values in Card.tsx."
3. "Lint token usage across the components directory."
4. "Does this file reference any arbitrary px values?"
5. "Verify no duration literals snuck in."

## Should NOT fire

1. "Build a new card." *(→ generate-ui; runs invariants inline)*
2. "Audit a11y on this page." *(→ audit-a11y)*
3. "What tokens do we have?" *(→ elicit-design-language or direct read)*
4. "List components." *(→ check-component-reuse)*
5. "Update every component to the new token value." *(→ propagate-language-update)*

## Phase 3 audit result

`<TO BE FILLED IN during Phase 3 trigger audit per §13.6.>`

## Phase 5 observations

`<Append notes on observed misses or false positives.>`
