# `cost_hot_streak` trigger fixture

Streams 10 baseline `(MessagePosted long body, CostRecorded 100¢)` pairs
on task class `long:low`, then a 250¢ spike on the same class. The spike
is 2.5× the rolling p90 baseline, well over the 1.5× trigger threshold,
and the class has 10+ prior occurrences — both gates pass.

Expected: one `Finding` with `detector_name = "cost_hot_streak"`,
`severity = "info"`, summary starting with
`Task class 'long:low' cost $2.50, 2.5×`.

Regenerate with:

```sh
cargo test -p designer-learn --test cost_hot_streak -- \
    --ignored regenerate_fixtures
```
