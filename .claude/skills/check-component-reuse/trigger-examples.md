# check-component-reuse — trigger examples

Per plan §13.6.

## Should fire

1. "What components do we have for inline form validation?"
2. "Is there a reusable card component already?"
3. "Should I build a new dropdown or extend the existing Select?"
4. "List the components in the manifest with status managed."
5. "Does any existing component already cover the notification-banner use case?"

## Should NOT fire

1. "Build a new notification banner." *(→ generate-ui)*
2. "Audit this component for a11y." *(→ audit-a11y)*
3. "Propagate the new radius across all cards." *(→ propagate-language-update)*
4. "Update the design language to add a new accent." *(→ elicit-design-language)*
5. "Check my token usage in this PR." *(→ enforce-tokens)*

## Phase 3 audit result

`<TO BE FILLED IN during Phase 3 trigger audit per §13.6.>`

## Phase 5 observations

`<Append notes on observed misses or false positives.>`
