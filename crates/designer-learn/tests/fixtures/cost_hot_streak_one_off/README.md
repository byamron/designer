# `cost_hot_streak_one_off` negative fixture

Same 10-event baseline as `cost_hot_streak/` (class `long:low` at 100¢),
but the spike fires on a class never seen before in the window
(`short:low`). The outlier-cost gate would trigger, but the class-
occurrence floor (3 prior occurrences) does not — a one-off expensive
task could just be a hard problem, not a hot streak.

Expected: no findings.
