# Plan

Near-term focus and active work items. See `roadmap.md` for the full phased sequence; see `spec.md` for architectural decisions.

## Current Focus

**Phase 0 — De-risk spike.** Validate that we can spawn Claude Code with agent teams enabled from Rust, cleanly observe team/task events, and round-trip a prompt through a Swift Foundation Models helper. These are the two load-bearing integration points; everything downstream assumes they work.

## Handoff Notes

- Spec and roadmap are complete for the planning phase. Treat `spec.md` as architectural source of truth and `roadmap.md` as the sequence source of truth.
- Working name is **Designer**; provisional.
- `.claude/` agents are not populated yet — first real agent scaffolding happens in Phase 1. `.claude/skills/` is populated via the Mini install (2026-04-21): 6 design-system skills (`elicit-design-language`, `generate-ui`, `check-component-reuse`, `enforce-tokens`, `audit-a11y`, `propagate-language-update`). Frontend wiring is deferred to Phase 8.

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

### Mini installed at `packages/ui/` + initial design language elicited — 2026-04-21
Installed Mini via `tools/sync/install.sh`. Ran greenfield elicitation of all 10 design axioms — amended two draft principles (motion: snappy + considered liveliness; theme: system-default instead of dark-default). Chose monochrome accent identity (Notion/Linear register), mauve gray flavor (olive/sand as alternatives to try), Geist + Geist Mono type system, soft-sharper radii (button=6px). Rebound `--accent-*` to `--gray-*` in `tokens.css` and dropped indigo/crimson imports. Frontend wiring (Radix deps, CSS imports, TS path alias) deferred to Phase 8. See `history.md` for full rationale.

### Project spec, compliance framing, roadmap, and core docs set up — 2026-04-20
Moved from placeholder spec to full `core-docs/` structure with spec, roadmap, plan, history, feedback, workflow, and design-language docs. 28 architectural decisions captured. See `history.md` for details.

## Backlog

- Product naming pass — decide whether to keep "Designer" or pick something more distinct.
- Multi-repo project model (defer until a second-repo use case appears).
- Linear / Jira integration strategy (map Linear project/epic/initiative to Designer workspace).
- Scheduled-task queue for proactive autonomy modes.
- Semantic conflict detection (v2 of cross-workspace coordination).
- Anthropic partnership conversation before public launch.
- Gray-flavor A/B — try `olive` and `sand` against `mauve` once first real surfaces exist (swap imports in `packages/ui/styles/tokens.css`).
- Decide "blocked" spine-state token (`--warning-*` vs. `--gray-11 + icon`) when the activity spine is built.
