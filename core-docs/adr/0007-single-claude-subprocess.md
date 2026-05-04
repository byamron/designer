# ADR 0007 — Single Claude subprocess (per app, not per tab)

**Status:** proposed
**Date:** 2026-05-03
**Deciders:** user, after Phase 23.E reliability bugs surfaced during dogfooding

## Context

Phase 23.E (PR #95) established a **per-(workspace, tab) Claude subprocess**. Each tab gets its own `claude` instance with a deterministic `--session-id` derived from `(workspace_id, tab_id)`. Tabs run independently: distinct conversation memory, distinct context window, distinct subprocess.

After dogfooding the resulting build, two reliability bugs surfaced — both rooted in the per-tab model:

1. **Model-swap chat hang.** Switching models on an active tab respawned the team without first releasing the deterministic session id. The new `claude` died with `Error: Session ID … is already in use`. Fixed in PR (this branch) by adding a fast `kill` to the orchestrator and awaiting it before respawn.

2. **Chat history blanks on tab switch / app reopen.** The per-tab strict-equality filter in the projector (`a.tab_id == Some(tab_id)`) hid Message artifacts whose `tab_id == None` — a class that includes legacy events and any Message emitted before the relevant `TabOpened` event in the stream. Patched in same PR with a query-time fallback to the workspace's first tab.

Both were patches to layered consequences of one architectural choice: **the chat surface invents per-tab subprocess machinery that the underlying CLI does not need or natively support.** The user's framing on dogfooding day:

> "this should be a very simple straightforward implementation, and maybe running multiple at once across tabs and workspaces is messing it up… I just want to make sure we're not reinventing basic implementation at the single chat level"

## Inventory of per-tab machinery

The following code exists *because* of the per-tab subprocess model:

| Concern | Code |
|---|---|
| Deterministic per-tab session id (UUIDv5 of workspace++tab) | `crates/designer-claude/src/claude_code.rs:207` (`derive_session_id`) |
| Team map keyed by `(WorkspaceId, TabId)` | `claude_code.rs:153` |
| Per-tab spawn / shutdown / kill / interrupt | `claude_code.rs:281`, `:533`, `:569`, plus mirror in `core_agents.rs:299` (`spawn_tab_team`) |
| Tab-id stamping on user posts | `core_agents.rs:271-280` |
| Tab-id stamping on agent replies via coalescer | `core_agents.rs:590`, `:737` |
| Strict tab-id artifact filter | `crates/designer-core/src/projection.rs:152` |
| Replay-time orphan attribution | `projection.rs:362-376` |
| Per-tab activity state (`ActivityChanged { tab_id }`) | `crates/designer-claude/src/orchestrator.rs:165-170` |
| `last_user_tab` map for reply-attribution | `core_agents.rs:135-137` |
| Per-tab respawn on model change | `core_agents.rs:162-186` (the bug-1 path) |

At a typical dogfood load (5 workspaces × 3 tabs) this is **15 `claude` subprocesses, 15 reader tasks, 15 writer tasks, 15 stderr loops, 15 translator state machines, ~45 stdio FDs**. Each new feature that touches the chat path has to be aware of all of them.

## Decision (proposed)

Run **one `claude` subprocess for the whole Designer app**. The user's CLI session — `claude -p --output-format stream-json` running in a terminal — is a single process; Designer should not invent more.

Tab and workspace context are carried in the user's message body, not in the process topology. Concretely:

- One `TeamHandle` per app (or per workspace as a fallback compromise — see "Open question" below).
- Session id is one UUID at app boot. No derivation. No determinism per tab. Resume on cold start uses that one id.
- User prompts are wrapped with a thin `<context workspace="ws_…" tab="tab_…">…</context>` envelope. Claude is instructed once at session start to honor it.
- Agent replies arrive without a tab id; we attribute them to whichever `(workspace, tab)` the user most recently posted from (we already track this — `core.last_user_tab`).
- Activity events become `ActivityChanged { workspace_id, tab_id, … }` where the *handler* fills in the tab id from the same `last_user_tab` source the coalescer uses.
- Model swap reuses the same subprocess: send a `--model` change at the next turn boundary if the CLI supports it; otherwise respawn the *one* subprocess once. Either way the swap is a workspace-wide affair, not per-tab.
- Per-tab thread isolation in the UI is preserved by the `tab_id` field on Message artifacts (already there). The renderer filters; the subprocess does not.

## Consequences

**Lose:**

- **Hard per-tab context isolation.** The model sees other tabs' transcripts unless we prompt-engineer it not to. For Designer's "manager-not-engineer" target user this is plausibly fine — humans manage many parallel topics in their own head with no isolation. Prompt structure can disambiguate.
- **Per-tab model selection becomes per-app.** If two tabs want different models simultaneously, we either respawn between turns (cheap if the new ADR's "kill is fast" still holds) or commit to one model at a time per app. Pick a default and let the user override per-turn.
- **Cross-tab "stop turn"** stops the whole app's current turn, not just one tab. Acceptable: only one tab can be the active turn at a time anyway (one subprocess, one stream).
- **The per-tab subprocess optimization** — that closing tab A doesn't disturb tab B's stream — goes away. In practice, per dogfood telemetry, tab B is rarely streaming when tab A closes. Worth giving up.

**Gain:**

- **15× fewer processes** at typical dogfood load.
- **An entire class of bugs goes away:** session-id collisions, per-tab orphan attribution, replay-order races against the strict tab filter, the lifecycle synchronization between teardown and respawn.
- **The chat path collapses to its essential shape:** `claude stdin → claude stdout → translator → store`. The translator no longer has to know about tabs.
- **`spawn_team`, `shutdown`, `kill`, `interrupt`, `team_model`, `team_keys`, the team map, `derive_session_id`, `set_last_user_tab`'s reply-attribution role** — all simplify or disappear. Estimated ~600 LOC of orchestration code removed net.
- **Onboarding new contributors becomes easier:** the mental model matches what `claude` actually is.

## Open question (decide before implementing)

**Per-app vs. per-workspace subprocess.** Two reasonable stopping points:

1. **Per-app** (one subprocess for everything Designer does). Maximally simple. Cross-workspace context bleed possible.
2. **Per-workspace** (one subprocess per workspace; tabs share). Modest middle ground. Workspace-level isolation matches the user's mental model — projects are usually about distinct work — and survives the worst case of context bleed (your "rebrand-the-website" workspace doesn't see your "fix-the-billing-bug" workspace).

Recommend **per-workspace** as the v1 target: it captures most of the wins (5× fewer processes at typical load, no session-collision class), keeps a sensible isolation boundary, and is the smaller migration. Per-app is a later move if the data shows workspace-level processes still over-provision.

## Migration plan

Phase 24.X (proposed; sequence within is sequential, not parallel):

1. **Prompt-envelope contract.** Define the `<context workspace tab>` envelope and the system-prompt instruction that teaches Claude to honor it. Lock it in `crates/designer-claude/src/prompt.rs` (new) so the translator and tests reference one definition.
2. **Switch the team map to one entry per workspace.** Drop `tab_id` from the team map key. Update `spawn_team` / `shutdown` / `kill` / `interrupt` signatures. Per-tab activity events still emit; they're filled in from `last_user_tab` at the orchestrator boundary.
3. **Stop deriving per-tab session ids.** One session id per workspace at first spawn, persisted across cold starts.
4. **Drop the strict tab filter from the projector.** `artifacts_in_tab` becomes "all Messages tagged with this tab id, plus orphans on the workspace's first tab" (already today's behavior after this PR's fix; the strict path goes).
5. **Remove the per-tab respawn-on-model-change path.** Model swap is workspace-wide; document the UX (one model per workspace at a time).
6. **Delete the now-dead code.** `derive_session_id`, the per-tab keying machinery, the bug-fix scaffolding from this branch (the `kill` trait method becomes the only teardown path; `shutdown`'s 60s graceful waiting may also be removable if `claude` exits cleanly on stdin EOF every time).

Ship behind a feature flag (`DESIGNER_SINGLE_SUBPROCESS=1`) for one dogfood week, then flip default + delete the flag in the following PR.

## Reversal triggers

- Cross-workspace context bleed becomes a measurable UX problem (user reports the model citing one workspace's work while answering questions in another). Reopen as "go to per-workspace+per-tab subprocess" — return halfway, not all the way back.
- A future Claude CLI capability (real per-conversation `--session-id` namespacing, mid-session model swap support) makes per-tab subprocesses cheap again. Reopen.
- Token spend per turn rises substantially because the model is loading ambient cross-tab context every turn. Reopen with prompt-engineering or trimming as the first response, only revert architecture if prompt fixes don't take.

## Supersedes / relates

- **Tightens** ADR 0001 (Claude runtime primitive) — same primitive, simpler topology.
- **Supersedes the per-tab subprocess decision in Phase 23.E** (`roadmap.md` Phase 23.E entry, `history.md` "Phase 23.E — per-tab Claude subprocess"). 23.E was the right v1 read; dogfooding showed the cost outweighs the benefit.
- **Does not conflict with ADR 0002** v1 scoping decisions. D1 (workspace-lead session model) is consistent with one subprocess per workspace; the workspace-lead is just the only lead now.

## References

- `core-docs/adr/0001-claude-runtime-primitive.md`
- `core-docs/roadmap.md` Phase 23.E
- `core-docs/history.md` — "Phase 23.E — per-tab Claude subprocess"
- This branch's bug-fix PR — adds `Orchestrator::kill` and the orphan-tab filter; both become legacy if this ADR ships.
