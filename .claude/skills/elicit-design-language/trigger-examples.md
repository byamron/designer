# elicit-design-language — trigger examples

Per plan §13.6. 10 example prompts: 5 should-fire, 5 should-not-fire. Iterate the skill description until matcher hit rate ≥80% on both directions.

## Should fire

1. "Set up Mini on this project."
2. "Initialize the design system for this repo."
3. "Scan my codebase and extract tokens into a design language."
4. "Our generation-log has a lot of recurring hex values — propose updates to our tokens."
5. "Run archaeology on the existing components and create core-docs/design-language.md."

## Should NOT fire

1. "Generate a new settings page." *(→ generate-ui)*
2. "Audit this page for a11y issues." *(→ audit-a11y)*
3. "Check my tokens in this component." *(→ enforce-tokens)*
4. "Propagate the new radius value across every button." *(→ propagate-language-update)*
5. "What components do we have?" *(→ check-component-reuse)*

## Phase 3 audit result

`<TO BE FILLED IN during Phase 3 trigger audit per §13.6. Record matcher hit rate on each prompt; iterate description if below 80% on either direction.>`

## Phase 5 observations

`<Append notes when dogfooding reveals misses or false positives.>`
