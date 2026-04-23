# ADR 0001 — Claude runtime primitive

**Status:** accepted
**Date:** 2026-04-22
**Deciders:** user (product direction) + Phase 12.A plan review

## Context

Phase 12.A of the roadmap validates the assumption that Designer can orchestrate Claude Code as a subprocess. The placeholder code in `crates/designer-claude/` (landed during the preliminary build) invoked `claude team init/task/message` CLI subcommands and watched `~/.claude/teams/{team}/` for state. None of that was validated against a live Claude install.

Initial probe (2026-04-21) found: no `team` subcommand exists in Claude Code 2.1.117's top-level help, with or without `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. That raised the question of which primitive Designer should actually build against:

- Option A — **Pivot to per-role `claude -p` workers**. Spawn N independent sessions, coordinate them in Designer. Rebuilds agent-team coordination on top of raw sessions.
- Option B — **Wait for `claude team` CLI to ship**. Freeze progress until Anthropic ships a CLI surface matching the spec's assumptions.
- Option C — **Use the native agent-teams primitive**. Follow Anthropic's documented model: spawn a lead via `claude`, drive team creation via natural-language prompts, observe via `~/.claude/teams/{team}/config.json` + `~/.claude/tasks/{team}/` + hooks.

A web check revealed that agent teams are shipped (experimental; env-var-gated since Claude Code 2.1.32; we're on 2.1.117). Documentation at <https://code.claude.com/docs/en/agent-teams> specifies the interaction model: natural-language-driven, not CLI-driven. The filesystem paths the placeholder code assumed were correct; the CLI invocation shape was not.

A load-bearing unknown remained: the docs say in-process teammates "work in any terminal, no extra setup required," but Designer spawns Claude from Rust without a tty. If in-process mode required a tty, Designer would face a tmux-bundling decision at Phase 16 packaging.

## Decision

**Option C: use the native agent-teams primitive.**

Specifically:
1. Each **track** (per spec Decisions 29–30) runs one Claude Code agent team. The lead is a `claude -p` subprocess spawned with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; team creation is driven by natural-language prompts to the lead.
2. The `Orchestrator` trait (`crates/designer-claude/src/orchestrator.rs`) stays untouched. Its methods map onto the native primitive:
   - `spawn_team` → spawn lead; prompt it to create a team with the specified roles.
   - `assign_task` → `claude -p --resume <lead-session-id>` with a natural-language task body.
   - `post_message` → same mechanism; body addresses a specific teammate role.
   - `subscribe` → broadcast channel fed by stream-json events + file-watcher diffs.
   - `shutdown` → natural-language "clean up the team" prompt via resume, followed by timeout-gated `start_kill()`.
3. **Hook contract** — Designer registers `TeammateIdle` / `TaskCreated` / `TaskCompleted` hooks in a workspace-scoped `.claude/settings.json`. Hook invocations fire our small `designer-hook` binary; core tails the binary's append-only output.
4. **Primary lifecycle feed** is the lead's `stream-json` output (confirmed 2026-04-22 to include `system/task_started`, `system/task_updated`, `system/task_notification`, `system/hook_started`, `system/hook_response`, `rate_limit_event`). Hook files are the secondary feed; they catch events the stream misses (e.g., translator down).
5. **Permission prompts** are answered via `--permission-prompt-tool stdio` (Conductor's approach, cleaner than `--dangerously-skip-permissions`). Stdio-protocol specifics get a follow-up probe inside 12A.3.

## Load-bearing spike result

Spike question: does `--teammate-mode in-process` work in a non-tty subprocess?

Spike method: `scripts/probe-claude.sh --live` (2026-04-22). Non-tty `bash` invocation of:
```
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude -p \
    --teammate-mode in-process \
    --output-format stream-json --include-partial-messages \
    --verbose --dangerously-skip-permissions \
    < /dev/null  # no tty, no stdin
```
Prompt asked the lead to create a 1-teammate team and have the teammate describe the cwd.

Result: **(a) works cleanly.**
- Team config written to `~/.claude/teams/dir-recon/config.json` with `backendType: "in-process"`, `tmuxPaneId: "in-process"`.
- Stream-json emitted 1,517 lines including all expected event types.
- Teammate spawned, responded, went idle.
- Shutdown handshake lagged (documented limitation); main flow unaffected.

**Implication:** no pty wrapper, no tmux dependency, no Phase 16 packaging impact. Simplest possible `Orchestrator` implementation.

## Consequences

### Positive

- The `Orchestrator` trait absorbs the real primitive with zero shape change. Nothing downstream (`AppCore`, projector, `MockOrchestrator`, frontend) changes.
- Coordination (shared task list, mailbox, hook firing, teammate-to-teammate messaging) is Claude's responsibility, not Designer's. We inherit ~hundreds of lines of work not done.
- The integration-notes doc (`core-docs/integration-notes.md`) gives the translator a concrete, tested contract to code against.
- `rate_limit_event` in the stream-json provides the capacity signal Decision 34 needs — no parallel tracking layer required.

### Negative / accepted costs

- Teammate shutdown is async with occasional lag. Orchestrator needs a timeout-gated cleanup path.
- In-process teammates don't survive `/resume`. Orchestrator must detect stale team state on reconnect and respawn.
- Agent teams are experimental; Anthropic may change the shape in a minor release. Mitigation: pinned `claude --version` in integration-notes, scheduled contract-probe workflow (12A.5 Tier 3).
- Stream-json from the lead doesn't carry teammate-session detail directly. Teammate chat is observed via the inbox file. Fine for v1 UI; may need a teammate-session resume for deeper drill-in later.

### Compliance posture

All spec §5 invariants hold:
- No Claude OAuth tokens read.
- `claude` binary handles its own auth; Designer invokes the binary and reads output.
- Runs on the user's machine; no proxy.
- `--append-system-prompt` (not `--system-prompt`) preserves Claude's identity.

## Alternatives considered and rejected

**Option A — pivot to per-role `claude -p` workers.**
- Rejected. Would discard Claude's built-in shared task list, mailbox, hook firing, and messaging primitives. Designer would rebuild all of that. Cost: hundreds of LOC, ongoing maintenance, fragility against Claude model changes.

**Option B — wait for a `claude team` CLI subcommand.**
- Rejected. No such subcommand is on Anthropic's public roadmap. The feature is exposed via natural language, and the underlying files/hooks are stable. Waiting for a CLI surface that may never ship blocks Phase 13.D indefinitely.

**Option D (nearby) — bundle Claude Code with Designer.**
- Rejected. Conductor does this (`~/Library/Application Support/com.conductor.app/bin/claude`). We explicitly defer to the user's installed Claude per spec §5 and FB-0013 — the product thesis is that Claude Code is *their* runtime, not something Designer ships.

## Reversal trigger

Reopen this ADR if any of:
- Anthropic deprecates the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` feature or makes breaking changes to `~/.claude/teams/{team}/config.json` shape without a migration path.
- The `in-process` teammate mode stops working in non-tty subprocesses (would flip the spike to option (b)).
- A future phase discovers that the workspace-level coordinator (per spec §"Workspace lead") needs a primitive the agent-teams surface doesn't support.
- `claude team` ships as an actual CLI subcommand with a significantly cleaner shape than the natural-language interaction model.

In each case, re-run `scripts/probe-claude.sh --live`, update `core-docs/integration-notes.md`, and revise this ADR with a new `Status: superseded by ADR NNNN` pointer.

## References

- `core-docs/integration-notes.md` — full probe findings
- `core-docs/spec.md` Decisions 8, 26, 29–34
- `core-docs/feedback.md` FB-0013, FB-0014
- <https://code.claude.com/docs/en/agent-teams> — canonical docs
- `scripts/probe-claude.sh` — reproducible probe
- `crates/designer-claude/tests/fixtures/` — captured fixtures for unit tests
