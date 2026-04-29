# `repeated_correction` fixture

Positive trigger: three "don't use moment.js" corrections across **two**
distinct workspaces. Both threshold gates clear
(`min_occurrences=3`, `min_sessions=2` from `RULE_DEFAULTS`); the
detector emits one finding citing each occurrence as evidence.

`expected.json` was captured via `serde_json::to_value(&findings)` after
running the live detector. To refresh after a detector output-shape
change:

```sh
cargo test -p designer-learn --test repeated_correction \
    -- --ignored regenerate
```

Fixture-stable fields asserted by the test: `detector_name`,
`detector_version`, `severity`, `summary` prefix, `confidence` band,
`evidence` length, `suggested_action: None`. Volatile fields (`id`,
`timestamp`, UUIDs in evidence) are not asserted.
