# Pattern log

> Decision rationale for non-obvious design-language or component choices. See Mini plan §13.1 for usage.

## How this differs from the design language

- `design-language.md` is the **current state**: axioms, tokens, approved patterns.
- `pattern-log.md` is the **history of decisions**: why we chose each axiom value, why we made that tradeoff, what we tried and abandoned.
- `generation-log.md` is the **mechanical record** of every skill firing (prompt, tokens used, invariants, feedback).

A minor token tweak (one value change) is logged here. An axiom change is logged in `design-language.md`'s change log AND here.

## How to write an entry

Each entry is a dated heading plus 3–6 sentences. Focus on the *why*. Reference code or commits where helpful.

## Entries

<!--
Example entry — delete this block once the first real entry is appended.

## 2026-04-20 — Radius scale is aggressive-soft

We picked radius-button = 12px (vs. the 6–8px default) because the product personality is warm/friendly (see landing copy and illustration direction). Tested with 8px and 12px side-by-side for a week; 12px tested better with every reviewer. Trade-off: larger buttons feel slightly less precise for dense data UI, but we don't have any data-dense surfaces in scope for v1.
-->
