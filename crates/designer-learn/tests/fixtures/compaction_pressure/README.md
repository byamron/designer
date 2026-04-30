# `compaction_pressure` trigger fixture

Streams three `MessagePosted` events spaced one day apart, each carrying
a `/compact` slash command. The 24-hour gap between adjacent messages
trips the 60-minute idle-window heuristic, so each one starts a new
Designer session. All three timestamps fall inside the trailing-7-day
window anchored on the most-recent event.

Expected: one `Finding` with `detector_name = "compaction_pressure"`,
`severity = "notice"`, summary
`"/compact invoked across 3 sessions in 7 days (3 occurrences)"`, and
three `Anchor::MessageSpan` entries — one per `/compact` message.

Regenerate with:

```sh
cargo test -p designer-learn --test compaction_pressure -- \
    --ignored regenerate_fixtures
```
