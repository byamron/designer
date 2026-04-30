# `config_gap` fixtures

Three on-disk project trees the `tests/config_gap.rs` harness points
`SessionAnalysisInput::project_root` at. The detector walks the tree
itself — these fixtures are *real files*, not JSONL event captures, so
they intentionally diverge from the `cost_hot_streak` /
`scope_false_positive` fixture format.

| Fixture | Files | Expected |
|---|---|---|
| `positive/` | `.prettierrc` + `.claude/settings.json` (empty `PostToolUse` array) | exactly one finding citing `.prettierrc` |
| `negative_hook_present/` | `.prettierrc` + `.claude/settings.json` with a `pnpm exec prettier --write` `PostToolUse` hook | zero findings |
| `negative_no_configs/` | empty (a `.gitkeep` placeholder so git tracks the dir) | zero findings |

The harness runs each fixture through `ConfigGapDetector::analyze` and
asserts the count plus, for the positive case, the detector-stable
fields (`detector_name`, `severity`, `summary` shape, anchor type and
relative path).
