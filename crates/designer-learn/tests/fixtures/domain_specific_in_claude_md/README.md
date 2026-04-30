# `domain_specific_in_claude_md` fixtures

On-disk project trees the `tests/domain_specific_in_claude_md.rs` harness
points `SessionAnalysisInput::project_root` at. The detector reads
`<root>/CLAUDE.md` directly, so each fixture is a tiny project tree with
a real `CLAUDE.md` at its root — same convention as the `config_gap`
fixtures, intentionally distinct from the `input.jsonl` event captures.

| Fixture | `CLAUDE.md` shape | Expected |
|---|---|---|
| `positive/` | Six lines that name `.tsx`, Tailwind, Radix, `crates/`, tokio, `apps/desktop/`, pytest, `.py` (one keyword per line, sometimes two) | one finding per matching line |
| `negative_generic/` | Principles + axioms — no extension, framework, or directory anchor | zero findings |

The harness asserts the count plus, for the positive case, the
detector-stable fields (`detector_name`, `severity`, `summary` shape,
`Anchor::FilePath` with a single-line `line_range`).
