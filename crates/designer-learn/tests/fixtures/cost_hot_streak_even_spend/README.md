# `cost_hot_streak_even_spend` negative fixture

12 `(MessagePosted, CostRecorded 100¢)` pairs cycling through three
body-length tiers (`short`, `medium`, `long`). All costs are flat at
100¢ — the rolling p90 equals the new cost on every step, so the
ratio gate (1.5×) never fires.

Expected: no findings.
