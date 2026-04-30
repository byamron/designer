# `memory_promotion` fixtures

The detector reads two inputs: `SessionAnalysisInput::auto_memory` (the
auto-memory notes) and `SessionAnalysisInput::project_root` (so it can
check whether the note is already covered by `CLAUDE.md`,
`.claude/rules/*.md`, or `.claude/skills/*/SKILL.md`).

Each case below is a real on-disk project tree under
`tests/fixtures/memory_promotion/<case>/`. The auto-memory notes are
held programmatically in `tests/memory_promotion.rs::fixture_data` —
auto-memory has no event-stream representation, so a `notes.jsonl`
would just duplicate the source.

## Cases

- `positive/` — `CLAUDE.md` exists but doesn't mention the note's
  content. The note has frontmatter (persistent) and matches the
  preference corpus. Expects exactly one `Finding`.
- `negative_already_covered/` — `CLAUDE.md` already contains the same
  fact the note records. Expects zero findings.
- `negative_ephemeral/` — same `CLAUDE.md`, but the note has no
  frontmatter, so the persistence gate skips it. Expects zero findings.
