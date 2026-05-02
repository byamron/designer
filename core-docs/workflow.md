# Workflow

How to work with Claude and agents on this project.

---

## Session Start Checklist

Before starting any work (~1 minute):

1. **Read `plan.md`** — check current focus and handoff notes.
2. **Scan `feedback.md`** — absorb recent user direction, especially new entries.
3. **Spot-check the spec** — if relying on an architectural or UX claim, verify it against `spec.md`, not memory.
4. **Pick your primary agent** — see agent table below.

## Current Stage

Pre-implementation. Work is primarily docs, decisions, and the de-risk spike. Standard agent workflow starts at Phase 1 per `roadmap.md`.

## Agents

Agents live in `.claude/agents/` (not yet populated; scaffolded in Phase 1). Designer's multi-layer architecture needs specific agents, not the generic Planner/Domain/UI defaults.

| Agent | Primary focus | When to use |
|---|---|---|
| `planner` | Scope work, write success criteria, update `plan.md` | Starting or re-framing any work item |
| `rust-core` | Rust core crates (`designer-core`, event store, domain model, orchestrator trait) | Core logic, data model, trait boundaries |
| `claude-integration` | Claude Code subprocess lifecycle, event observation, Orchestrator impl | Anything that touches Claude Code's process, task list, mailbox, or team config |
| `swift-helper` | Swift binary wrapping Foundation Models, IPC with Rust | Anything in `helpers/foundation/` |
| `git-ops` | Worktree and branch management, PR flows | Any git or GitHub operation |
| `local-models` | MLX integration, prompt routing, local inference ops | When routing work between Claude and local models |
| `safety` | Approval gates, audit log, scope enforcement, sandboxing | Any change that affects what agents can do or what is logged |
| `frontend` | React + Mini design system, Tauri IPC bindings, surfaces | Phase 8+: any UI work |
| `docs` | Update `history.md`, `plan.md`, `spec.md`, `feedback.md`; prepare commits | End of every work item |

Use `/clear` between agent phases to keep context small.

## Standard Workflow

For a feature or work item:

```
1. planner        → scope, success criteria, update plan.md
2. [domain agent] → implementation
3. safety         → if the change affects gates, scope, or audit
4. docs           → update history.md + plan.md; if a decision changed, update spec.md decisions log; commit
```

The specific domain agent in step 2 depends on what layer is changing: `rust-core`, `claude-integration`, `swift-helper`, `git-ops`, `local-models`, or `frontend`.

## Recipes

### De-risk spike (Phase 0 pattern)
1. `planner` — define the specific question being answered; write success criteria.
2. Build narrowest possible prototype; capture findings inline in code comments.
3. `docs` — write findings as a `history.md` entry; update `plan.md`; update `spec.md` if an architectural decision changes.

### New backend capability (Phases 1–7)
1. `planner` — scope in `plan.md`.
2. Appropriate domain agent — implement with tests.
3. `safety` — review if gates, scope, or audit are affected.
4. `docs` — update history, plan, and (if applicable) spec.

### Bugfix
1. Write a regression test reproducing the bug.
2. Domain agent — fix until the test passes.
3. `docs` — update `plan.md` if it was active; commit.

### Feedback iteration (user corrects implementation)
1. Appropriate domain agent — apply the corrected approach.
2. `docs` — record feedback in `feedback.md` with `FB-XXXX` id; update `history.md`.

## Spec-Update Step

If a piece of work changes or adds a decision in `spec.md` (architecture, compliance, UX model, agent model, nomenclature), the `docs` agent must update the Decisions Log appendix before commit. Replacing an entry (not history-preserving) is fine for architectural changes; `feedback.md` preserves the chronology of user direction separately.

## Compliance Checks

The compliance invariants in `spec.md` §5 are non-negotiable. Compliance checks fire specifically in these situations:

- **Any change to agent spawning or prompt construction** — verify that no prompt rewrites Claude's identity, and no code path uses an OAuth token.
- **Any proposal to run work in the cloud on behalf of users** — halt; clarify with the user. Runtime must stay local.
- **Any frontend-enforced gate or authorization logic** — halt; gates live in the Rust core, never in the frontend.
- **Any branding change** — verify Designer remains a distinct product identity and does not imply Anthropic affiliation.
- **Any mobile-related work** — verify the mobile client remains a remote control for the user's desktop, not a cloud-hosted Claude.

If a proposed change would violate any invariant, stop and surface it to the user before proceeding.

## Friction → agent loop

The desktop's Friction triage page (Settings → Activity → Friction) and the `designer` CLI form a closed dogfood loop: file friction in the app, fix it from any agent that can run a subprocess.

### One-time setup

```sh
./scripts/install-cli.sh
```

This `cargo install`s the `designer` CLI into `~/.cargo/bin`. Re-run to upgrade after pulling.

### The loop

1. **In the app** — press ⌘⇧F to file. The record lands at `<linked-repo>/.designer/friction/<id>.md` (or `~/.designer/friction/<id>.md` if no repo is linked) with optional PNG sidecar. The path is gitignored automatically when a repo is first linked.
2. **From any agent** — read the inbox:
   ```sh
   designer friction list --state open --json
   ```
   For one-off triage you can also click *Copy prompt* on a row in the triage page; it puts a self-contained prompt on the clipboard (path + close-the-loop CLI command).
3. **Fix → PR** — normal workflow.
4. **Close the loop** — mark addressed:
   ```sh
   designer friction address frc_<id> --pr https://github.com/owner/repo/pull/123
   ```
   The running app picks this up automatically (the Rust core watches `events.db` and re-fetches the FE list within ~500ms of the CLI write).
5. **After the PR merges and you've verified the fix:**
   ```sh
   designer friction resolve frc_<id>
   ```

### Why a CLI (not just files)

The state machine (Open → Addressed → Resolved → Open) lives in the event store, not in the markdown. `ls .designer/friction/` shows every report ever filed; `designer friction list --state open` shows just the actionable ones, and `designer friction address|resolve|reopen` go through the same event vocabulary as the in-app buttons so the running app stays consistent.

For overrides and flags see `designer help`.
