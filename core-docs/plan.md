# Plan

Near-term focus and active work items. See `roadmap.md` for the full phased sequence; see `spec.md` for architectural decisions.

## Current Focus

**Phase 0 — De-risk spike.** Validate that we can spawn Claude Code with agent teams enabled from Rust, cleanly observe team/task events, and round-trip a prompt through a Swift Foundation Models helper. These are the two load-bearing integration points; everything downstream assumes they work.

## Handoff Notes

- Spec and roadmap are complete for the planning phase. Treat `spec.md` as architectural source of truth and `roadmap.md` as the sequence source of truth.
- Working name is **Designer**; provisional.
- `.claude/` rules, agents, and skills are not populated yet. First real scaffolding happens in Phase 1; before then, agents work from `CLAUDE.md` + `core-docs/` context only.

## Active Work Items

### Phase 0 — De-risk spike

**Goal:** prove the load-bearing integration points before committing to the build order.

**Steps:**
- [ ] Planner agent: scope the spike — one Rust binary, one Swift helper, one integration test.
- [ ] Rust-core / Claude-integration agent: spawn Claude Code with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; confirm the version in use exposes agent teams.
- [ ] Rust-core / Claude-integration agent: watch `~/.claude/teams/{team}/config.json` and `~/.claude/tasks/{team}/`; parse task-list changes.
- [ ] Rust-core / Claude-integration agent: capture `TaskCreated`, `TaskCompleted`, `TeammateIdle` (or equivalents) into a local log.
- [ ] Swift-helper agent: minimal Swift binary that loads Foundation Models and responds to JSON-over-stdio.
- [ ] Rust-core agent: round-trip a prompt from Rust through the Swift helper and back.
- [ ] Docs agent: write findings as a `history.md` entry; update `spec.md` if the spike surfaces any architectural change.

**Success criteria:** a `cargo test` passes end-to-end for both integration paths; findings documented.

### Phase 1 — Foundation *(starts after Phase 0)*

Deferred. See `roadmap.md` Phase 1 for scope.

---

## Recently Completed

### Project spec, compliance framing, roadmap, and core docs set up — 2026-04-20
Moved from placeholder spec to full `core-docs/` structure with spec, roadmap, plan, history, feedback, workflow, and design-language docs. 28 architectural decisions captured. See `history.md` for details.

## Backlog

- Product naming pass — decide whether to keep "Designer" or pick something more distinct.
- Multi-repo project model (defer until a second-repo use case appears).
- Linear / Jira integration strategy (map Linear project/epic/initiative to Designer workspace).
- Scheduled-task queue for proactive autonomy modes.
- Semantic conflict detection (v2 of cross-workspace coordination).
- Anthropic partnership conversation before public launch.
- `core-docs/design-language.md` — fill in once design work begins (Phase 9+).
