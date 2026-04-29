# `repeated_correction` — negative fixture

Two corrections of the same phrasing in a **single** workspace.
Threshold-gate sanity: must fail BOTH `min_occurrences ≥ 3` AND
`min_sessions ≥ 2`, so no finding is emitted. Pairs with the positive
fixture next door — the diff between the two is exactly one event in a
second workspace.

Regenerate via:

```sh
cargo test -p designer-learn --test repeated_correction \
    -- --ignored regenerate
```
