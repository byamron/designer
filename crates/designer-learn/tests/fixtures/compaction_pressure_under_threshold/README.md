# `compaction_pressure` under-threshold fixture

Two `MessagePosted` events one day apart, each carrying a `/compact`
slash command. The 24-hour gap segments them into two distinct
sessions — one short of the 3-session threshold the detector enforces
via `COMPACTION_PRESSURE_DEFAULTS.min_sessions`.

Expected: zero findings.

Regenerate with:

```sh
cargo test -p designer-learn --test compaction_pressure -- \
    --ignored regenerate_fixtures
```
