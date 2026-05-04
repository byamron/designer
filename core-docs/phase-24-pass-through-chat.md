# Phase 24 — Chat pass-through (architectural)

**Date:** 2026-05-03
**Status:** Draft spec for staff-perspective review
**Author:** session synthesis
**Trigger:** Repeat dogfood failure modes — half-answers, frozen agents, tool-cards sorting under user replies, activity indicator flicker — all traceable to plumbing Designer built on top of Claude Code that fights the runtime instead of riding it.

---

## 1. Why this phase exists

Designer's chat layer has accumulated four pieces of bespoke infrastructure that, taken together, degrade the underlying tool:

1. A **120 ms message coalescer** (`apps/desktop/src-tauri/src/core_agents.rs`) that batches `MessagePosted` events for "smoother" rendering.
2. A **two-event split** for chat-domain content: `MessagePosted` for assistant text, `ArtifactProduced` (kind: `Report`) for every `tool_use` block. Same logical turn, two event vocabularies, two ordering rules.
3. A **synthesized activity-state machine** (`Idle` / `Working`) inferred from stream-event recency, then reset on subprocess respawn.
4. A **custom subprocess lifecycle** — UUIDv5 / random session-ids, kill-and-respawn on model switch, reader loops that exit on EOF without flushing pending coalescer state.

The DP-B pass-through pass (PR #63, 2026-05-01) addressed the *visual* layer — stripped card chrome from message blocks, demoted tool-call groups to inline lines, moved spec/PR/report blocks to the spine. It did not touch the plumbing layer underneath. The result is visual pass-through with non-pass-through plumbing, which is the worst of both: it *looks* like Claude Code in a window but behaves like a custom chat with the failure modes of a custom chat.

Phase 24 is the structural pass DP-B couldn't be without re-litigating events, types, and the reader loop. The thesis is the same one Designer was built on but applied honestly: **anything Claude Code does in a terminal is the floor of what Designer must do, not the ceiling Designer aspires to.**

## 2. First principles

These are the filters every design decision in this phase passes through. If a feature can't be justified against one of these, it doesn't ship in this phase.

### 2.1 Pass-through by default; intercept only at must-intercept seams

A "must-intercept seam" is a place where Claude Code's terminal-CLI behavior is unavailable in Designer's runtime context. There are three such seams:

- **Approval UI** for `--permission-prompt-tool stdio`. Claude's terminal TUI cannot render inside our webview; Designer must provide a UI for the same protocol.
- **Subprocess lifecycle ownership.** Designer owns the process tree and is responsible for spawning, terminating, and isolating subprocesses per `(workspace, tab)`. The terminal CLI does this with one process per shell; we do it with one process per tab.
- **Persistence.** Designer stores conversations across app restarts via the event log. The terminal CLI's history mechanism is `--resume <session-id>`; Designer must persist enough to drive that resume on next boot.

Everything else passes through. Token streaming order, content-block emission timing, tool-use rendering, completion semantics, error surfacing, cost reporting — all of these match what `claude` does in a terminal. We do not invent rendering rhythm, ordering rules, activity heuristics, or session-id schemes that diverge from the runtime.

### 2.2 The Anthropic Messages API content-block model is the contract

Claude Code's stream-json output is a faithful projection of the Anthropic Messages API:

- `message_start` / `message_delta` / `message_stop` per assistant turn.
- `content_block_start { type: "text" | "tool_use" | "thinking" }`, then a sequence of `content_block_delta` events, then `content_block_stop` per block.
- `content_block_delta.delta` is one of `text_delta`, `input_json_delta`, `thinking_delta`.
- `result/success`, `result/error_max_turns`, `result/error_during_execution` for turn outcomes plus cost.
- `system/init` for session start; `control_request` with `subtype: "can_use_tool"` for permission prompts.

Designer's chat-domain event vocabulary maps 1:1 to this model. We do not reinterpret content blocks as separate "artifacts." We do not flatten text bursts into single events. We do not synthesize block boundaries. The translator becomes a typed wrapper, not a re-author.

### 2.3 Observable signals beat inferred state

Designer should never compute and broadcast a state value when an observable fact answers the same question. Examples we currently violate:

- **Activity indicator** is a synthesized `Idle`/`Working` enum derived from stream-event recency. The observable fact is "is the subprocess emitting events within the last N seconds." Read the fact directly.
- **Conversation state** is reconstructed from per-tab `first_seen_at` tables and coalescer pending maps. The observable fact is "what events has Claude emitted." Render the events.
- **Session continuity** is enforced via Designer-minted UUIDs. The observable fact is "Claude's own session id from `system/init`." Use it.

Synthesized state goes stale on subprocess respawn, on event-log replay, on tab-switch tear-down. Observable facts don't.

### 2.4 Streaming order is arrival order

In the new chat plumbing, the order of items in the rendered thread is the order in which events arrived from the subprocess. Period. No timestamp re-sorting. No first-token-stamp gymnastics. No "but the user message is *logically* later." If Claude emits a tool_use block after a user reply, the rendered thread shows the tool_use block after the user reply — which is what actually happened.

This forces the question "should the user be able to send while the agent is mid-turn?" out of the timestamp layer (where it currently lives) and into the UX layer (where it belongs). The answer is in §5.4.

### 2.5 Less code is the goal, not a side effect

A successful Phase 24 deletes more lines than it adds. Estimated net delta: **−1,200 to −1,800 LOC** across `crates/designer-claude/src/stream.rs`, `apps/desktop/src-tauri/src/core_agents.rs`, `crates/designer-core/src/event.rs` (chat-related variants), `packages/app/src/tabs/WorkspaceThread.tsx`, and `packages/app/src/blocks/blocks.tsx`. If a proposed implementation increases LOC, it is suspect and must be re-justified.

## 3. Architectural seam: what Designer intercepts vs. passes through

### 3.1 Must-intercept (kept and kept simple)

| Seam | Why | Implementation |
|---|---|---|
| Tool-use approval prompts | Claude TUI cannot render in our webview | `InboxPermissionHandler` routes `--permission-prompt-tool stdio` requests to the inbox. **Unchanged.** |
| Subprocess lifecycle | Designer owns the process tree | One subprocess per `(workspace, tab)`. Spawn lazy on first send. Kill on tab close. **No model-change respawns** — open a new tab to switch models (D5). |
| Cost extraction | The cost chip is a Designer surface | `result/success` lines are read by a sidecar subscriber that writes `CostRecorded` events. Read-only; never gates the stream. |
| File-system writes that match spec/PR/report patterns | These are first-class spine artifacts, not chat events | Existing watcher in `crates/designer-claude/src/watcher.rs`. Emits `ArtifactCreated { kind: Spec | Pr | Report }`. **Unchanged.** |
| Persistence | Replay across app restarts | Append every chat-domain event to the SQLite event log; replay on boot to rebuild the thread. |

### 3.2 Pass-through (rip out the bespoke layer)

| Today's bespoke layer | Replaced by |
|---|---|
| 120 ms `MessagePosted` coalescer with first-token-timestamp tracking | Direct emission of `AgentContentDelta` per `content_block_delta`. Renderer accumulates. |
| `ArtifactProduced { kind: Report, title: "Used Read" }` for every tool_use block | `AgentContentBlockStarted { kind: ToolUse, name, input_partial }` + sequence of `input_json_delta` deltas + `AgentContentBlockEnded`. Renders as inline `· Read src/foo.rs` in chat. |
| Synthesized `Idle`/`Working` activity enum | Observable: subprocess running AND last event within 5 s. Computed at render time, not stored. |
| UUIDv5 / UUIDv4 session-id minting | Use Claude's own session id from `system/init`. Persist it as the per-tab session pointer. Use `--resume <id>` on respawn. |
| `tool_uses` correlation map (LRU 1024) for matching `tool_result` to originating `tool_use` | Carry `tool_use_id` on the `AgentContentBlock*` events. Renderer correlates by id at the DOM level. No backend correlation table. |
| `MessagePosted` / `ArtifactProduced` split for chat | Single `AgentTurn` aggregate with content blocks. Same shape as Claude's own message envelope. |

### 3.3 Simplify (kept but reshaped)

| Today | Simpler form |
|---|---|
| `EventPayload::MessagePosted { author_role, body }` for every chat surface | Reserve `MessagePosted` for **user** messages only. Agent output is `AgentTurn*` events. User → Agent boundary is now visible in the schema. |
| Per-tab `first_seen_at` HashMap, pending-message coalescer, idle-flush watchdog | Deleted. Renderer subscribes to the agent stream directly. |
| `ClaudeStreamTranslator` ~700 LOC with translation, correlation, bounded LRU caches | ~150 LOC: a typed projection of stream-json content blocks onto `AgentTurn*` events. |

## 4. New event contract

All events keyed on `(workspace_id, tab_id, turn_id)`. `turn_id` is Claude's own `message_id` from the assistant `message_start` envelope; we do not invent it.

```
AgentTurnStarted     { workspace_id, tab_id, turn_id, model, parent_user_event_seq }
AgentContentBlockStarted   { workspace_id, tab_id, turn_id, block_index, kind: Text | ToolUse { name, tool_use_id } | Thinking }
AgentContentBlockDelta     { workspace_id, tab_id, turn_id, block_index, delta }
AgentContentBlockEnded     { workspace_id, tab_id, turn_id, block_index }
AgentToolResult            { workspace_id, tab_id, turn_id, tool_use_id, content, is_error }
AgentTurnEnded       { workspace_id, tab_id, turn_id, stop_reason, usage: TokenUsage }
```

The `delta` payload is **the raw Claude delta string**, not a re-encoded form. For text blocks it is a UTF-8 string fragment. For tool_use blocks it is a JSON-fragment string (the `input_json_delta` value). The renderer reassembles per block_index — exactly what Claude's own client does.

### 4.1 What this replaces in `EventPayload`

`MessagePosted { author_role: AGENT | TEAM_LEAD, body }` for agent output → **deleted**. (User messages keep `MessagePosted`.)
`ArtifactProduced { kind: Report, title: "Used X" }` for tool_use → **deleted**.
`ArtifactUpdated` for tool_result correlation → **deleted**.
`ActivityChanged { state: Idle | Working }` → **deleted**.

### 4.2 Replay safety

The event log on existing dogfood machines contains pre-Phase-24 chat events. Three strategies considered:

1. **Migration script** that rewrites old events into new shape on boot. Fragile; chat events are dense.
2. **Event-version field** on the chat events; renderer handles both shapes. Doubles the rendering surface; doesn't shrink LOC.
3. **Cut-over with read-side compatibility shim.** New events use the new shape. Renderer has a small (~100 LOC) shim that projects old `MessagePosted` / `ArtifactProduced` events into the new `AgentTurn*` model at read time. Shim has a `// REMOVE AFTER 2026-08-01` comment. (D9)

Decision: **option 3.** The shim is read-only and forward-compatible. Old conversations continue to render; new conversations use the new shape. After 90 days, dogfood machines have rolled forward enough that the shim can be deleted.

## 5. UX implications

### 5.1 What chat looks like after

Visually, very close to today after DP-B (PR #63): flowing markdown for agent text, terse `· Read src/foo.rs` lines for tool calls, expand-on-click for tool input/output. The differences are behavioral:

- **Streaming is real.** Tokens land in the rendered thread as they arrive from Claude, not in 120 ms batches. Visual rhythm matches `claude` in a terminal — natural pacing, not artificial smoothing.
- **Tool calls land in turn order.** A tool_use block emitted between two text segments renders between them, not bottom-stacked.
- **No phantom reordering.** If you send a follow-up while the agent is mid-turn (see §5.4), your message appears where it actually arrived in the stream, not retroactively repositioned by timestamp logic.
- **Tool calls expand inline, not in a side drawer.** `· Read src/foo.rs` clicks to expand the input + result in place, collapses on second click. Existing 23.C trail behavior preserved.

### 5.2 The activity indicator becomes honest

Today: a synthesized `Working` state that resets on respawn, occasionally vanishes mid-turn.

After: a render-time computation. The indicator is shown when (a) the subprocess for this tab is running AND (b) the last `AgentContentBlockDelta` was within 5 s. No stored enum; no respawn flicker. If the agent has been silent for >5 s, the indicator hides regardless of subprocess state — which is honest, because in that case the agent is actually stalled.

The 5 s threshold is a constant, not a token. If dogfood signals it should be 3 s or 10 s, change the constant; we are not parametrizing this until we have evidence we need to.

### 5.3 Approvals

Unchanged from 13.G. Approval cards still render inline at the position in the thread where Claude requested them. The single behavioral improvement: because tool_use blocks now stream as they arrive, the approval card lands *before* any tool result, never after. This was a latent ordering ambiguity in the old plumbing.

### 5.4 Send-while-streaming behavior

Today's behavior is undefined: the user can type and send a message while the agent is mid-turn; the message goes into the queue; ordering is messy. This is a UX decision we have been avoiding.

The new design takes a position: **the composer is enabled mid-turn, but submissions are queued, not interleaved.** Concretely:

- Agent is mid-turn (subprocess emitting deltas). User types and presses Enter.
- Composer shows the message as "queued" inline at the bottom of the composer dock with a distinct visual (faded chip with "will send when current turn ends").
- On `AgentTurnEnded`, the queued message dispatches as a normal user message.
- User can clear the queue with ESC; can edit before sending; can replace by typing more.

This removes the temptation to interleave (which produced the ordering bugs) and gives the user a clear mental model: agent finishes, then you talk. It also matches the terminal CLI experience where typing while Claude is responding *does* nothing visible — which is worse than what we're proposing.

The single-character-at-a-time exception: if the user presses ESC while the agent is mid-turn, the subprocess receives SIGINT (matching `claude`'s own ESC-to-interrupt behavior). The current turn ends with `stop_reason: interrupted`, the queued message (if any) clears, and the composer becomes immediate again. (D7)

### 5.5 Reduced motion + a11y

- The streaming text rendering must be GPU-friendly: append-only DOM updates, no full reflow per delta. (UX-1)
- Focus management: the composer keeps focus across turn boundaries; `aria-live="polite"` on the agent-output region announces completed turns, not partial deltas (announcing every delta would flood the screen reader). (UX-2)
- Tool-call expand/collapse honors `prefers-reduced-motion`: instant disclosure, no rotate/transform. (UX-3)
- The activity indicator's pulse honors `prefers-reduced-motion`: static dot. (UX-4)

## 6. Acceptance criteria

These are the regression tests for the failure modes that triggered this phase. Each must have a covering test before the PR can merge.

**A1. Tool-use cards never appear after a subsequent user message in arrival order.**
Fixture: synthetic stream emitting two tool_use blocks, one user MessagePosted, one tool_use block. Assert the thread renders in arrival order with the user message between the second and third tool_use.

**A2. Half-answer freeze cannot drop pending content.**
Fixture: spawn subprocess, emit 200 ms of partial text deltas, kill subprocess. Assert all emitted deltas have been written to the event store and render correctly on replay.

**A3. Activity indicator does not flicker on respawn.**
Fixture: simulate subprocess respawn while the user is mid-conversation. Assert the rendered indicator state never goes Working → Idle → Working within a single user-initiated turn.

**A4. Streaming is real.**
Live test (gated behind `--features claude_live`): send a message that triggers a long response. Assert text deltas land in the renderer at sub-50 ms intervals once Claude starts streaming.

**A5. Send-while-streaming queues, doesn't interleave.**
Test: trigger an agent turn; while the turn is mid-stream, type and submit a user message. Assert the message renders in the composer as queued (not in the thread); after `AgentTurnEnded`, assert the message dispatches and renders in the thread.

**A6. ESC interrupts mid-turn.**
Test: trigger an agent turn; press ESC. Assert SIGINT is sent to the subprocess; turn ends with `stop_reason: interrupted`; queued messages clear; composer is immediate again.

**A7. Cost tracking still works.**
Fixture: emit a `result/success` line. Assert `CostRecorded` event appears in the workspace stream with correct dollar-cents.

**A8. Tool-use approval still works.**
Live test: trigger a Write tool. Assert the approval inbox surfaces; granting the approval allows the tool to proceed; denying blocks it.

**A9. Replay safety.**
Test: load an event log captured before Phase 24. Assert the renderer correctly displays old MessagePosted + ArtifactProduced events via the read-side shim. Assert new events (post-Phase-24) display via the new path.

**A10. LOC reduction.**
Verification: post-merge `git diff --stat origin/main..HEAD` shows net deletion in the four target files (`stream.rs`, `core_agents.rs`, `event.rs`, `blocks.tsx` + `WorkspaceThread.tsx` combined). Soft target: −1,200 LOC. Hard floor: net negative.

## 7. Decisions

- **D1** — Drop the 120 ms `MessagePosted` coalescer. *Why:* source of every ordering bug; introduces complexity to solve a problem (visual rhythm) that doesn't exist in the terminal CLI.
- **D2** — Drop `ArtifactProduced { kind: Report }` for tool_use blocks. *Why:* tool calls in chat are not artifacts in the spine sense (no one references "Used Read on plan.md" later); they are mid-turn breadcrumbs.
- **D3** — Replace synthesized `ActivityChanged` with render-time observable computation. *Why:* synthesized state goes stale on respawn; observable fact does not.
- **D4** — Use Claude's own session id from `system/init`; remove UUIDv5/UUIDv4 minting. *Why:* Claude already manages session continuity via `--resume`; we were racing against it.
- **D5** — No subprocess respawn on model switch. Open a new tab for a different model. *Why:* respawn-on-switch is the source of pending-state loss and the activity-indicator flicker; tab-as-conversation is already the user's mental model post-23.E.
- **D6** — Queue user messages submitted mid-turn; do not interleave. *Why:* removes the ordering ambiguity that drove most of the chat-plumbing complexity; gives the user a clear mental model.
- **D7** — ESC during a mid-turn agent stream sends SIGINT. *Why:* matches `claude`'s own ESC-to-interrupt; gives the user an out without abandoning the conversation.
- **D8** — Reserve `MessagePosted` for user messages only. *Why:* makes the user → agent boundary visible in the schema; agent output is `AgentTurn*` events.
- **D9** — Read-side compatibility shim, not migration. *Why:* migration is fragile on dense chat events; shim is small (~100 LOC), forward-compatible, and removable on a 90-day deadline.

## 8. Open questions

- **Q1** — Should the read-side shim be flag-gated? Argues against: it's read-only and additive. Argues for: it lets us test the new path against a fresh event log without legacy noise. *Recommendation:* no flag; ship the shim universally. Delete after 2026-08-01.
- **Q2** — Tool-use blocks today emit one event per tool_use. The new design emits a stream of `input_json_delta` events per block. Does the renderer ever need the *complete* input before render? *Recommendation:* no — render the canonical title (`· Read src/foo.rs`) from the first delta's prefix; show the full input in the expand pane, which can wait for `AgentContentBlockEnded`.
- **Q3** — Should `AgentTurnStarted.parent_user_event_seq` be the user's `MessagePosted` seq or `event_id`? *Recommendation:* event_id (UUID). Seq is monotonic but local to a stream; UUID is portable across replays.
- **Q4** — The "queued user message" composer state needs a clear visual. Existing `ComposeDock` chip patterns are sparse. *Recommendation:* consult Mini's `audit-a11y` skill before merge; this is a new UI state and warrants explicit design.

## 9. Out of scope

- **Higher-level approvals** (track merge, roadmap edit, spend-cap raise). These belong in Phase 13.I or a dedicated approvals phase. They are orthogonal to chat plumbing and should not gate Phase 24.
- **Multi-agent / sub-agent UI.** The team-lead vs. teammate distinction in today's `MessagePosted.author_role` carries through to `AgentTurnStarted.author_role`. Sub-agent thread filtering (Phase 22.H) is unaffected.
- **Spec / PR / Report block extraction in chat.** Already correct: filesystem watcher emits `ArtifactCreated` for these kinds; chat shows a one-line `→ artifact-name` reference that focuses the spine. Unchanged from DP-B.
- **Cost cap enforcement.** `CostTracker` keeps recording; cap-rejection is Phase 13.I.
- **Tool-result rich rendering.** Tool results render as the textual content Claude emits. Rich rendering (e.g. image previews) is a separate phase.

## 10. Anthropic Claude Code alignment

This phase deliberately aligns Designer's chat plumbing with Claude Code's official extension surfaces:

- **Stream-json I/O** (`--input-format stream-json --output-format stream-json`) is the canonical machine interface. Designer already uses it; this phase commits to consuming the output shape verbatim rather than re-authoring it.
- **`--permission-prompt-tool stdio`** is the supported programmatic permission interception point. Designer keeps it. We do not invent a parallel approval channel.
- **`--setting-sources user,project,local`** is the supported allow-rule composition mechanism. Designer continues to honor user-level allow-rules in `~/.claude/settings.json`, which are evaluated *before* the stdio prompt fires.
- **`--resume <session-id>`** is the supported session continuity mechanism. Designer adopts it (D4).
- **`--dangerously-skip-permissions`** is an explicit anti-pattern. Designer must not use it under any circumstances. (Already true today; restated for the record.)
- **Hooks (`.claude/settings.json` `hooks` block)** — `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop` — are the supported policy-as-code surface. This phase does not adopt hooks (the chat plumbing problem is upstream of hook concerns), but Phase 13.I should adopt them rather than invent parallel mechanisms.

## 11. Implementation strategy (for the dispatched workspace)

This is a single workspace, not parallelizable. Every layer touches every other; the bet only pays out if the rip-out, the new contract, and the renderer change land together.

Sequence within the workspace (rough order):

1. **Define new `EventPayload::AgentTurn*` variants** in `crates/designer-core/src/event.rs`. Additive; old variants stay (deprecated) until the read-side shim is in.
2. **Rewrite `crates/designer-claude/src/stream.rs`** as a typed 1:1 stream-json projection. Delete `tool_uses` correlation map. Delete text reassembly. Delete bounded LRUs.
3. **Delete the coalescer and per-tab `first_seen_at` machinery** in `apps/desktop/src-tauri/src/core_agents.rs`. Reader loop emits events directly.
4. **Update `cmd_post_message`** to dispatch user messages with a new `MessagePosted` (user-only authorship) and have the reader handle the agent side via `AgentTurn*`.
5. **Implement the read-side shim** in the renderer's event-to-thread reducer.
6. **Rewrite the renderer**: `WorkspaceThread.tsx` consumes `AgentTurn*` events, accumulates content blocks per `turn_id`, renders inline.
7. **Implement send-while-streaming queue** in `ComposeDock`.
8. **Implement ESC-to-interrupt.**
9. **Wire activity indicator** as render-time observable.
10. **Migrate tests** — fixture-based stream-translator tests, frontend chat-thread tests, integration tests for A1–A9.

Quality gates before PR:
- `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `pnpm -w typecheck && pnpm -w test`
- `node tools/invariants/check.mjs` on changed UI files
- Manual: real claude subprocess round-trip exercising A1–A8; before/after screenshots in PR description.

Branch: `phase-24-chat-pass-through`. Base: `main`. One PR, expected ~1,500 LOC net deletion.

---

## Appendix A — DP-B retrospective

DP-B (PR #63) implemented:
- Stripped card chrome from `MessageBlock` for agent messages.
- Demoted `ToolCallGroup` to terse inline lines.
- Moved `SpecBlock` / `PrBlock` / `ReportBlock` / `CodeChangeBlock` out of the chat stream into the sidebar.
- Verified streaming visually for assistant messages.

What it did not do:
- Did not delete the 120 ms coalescer.
- Did not change the `MessagePosted` / `ArtifactProduced` split.
- Did not address subprocess respawn semantics.
- Did not address activity-state synthesis.

DP-B's stated mandate (`plan.md` line 74) included "verify streaming works for assistant messages; fix if not (the prior audit suggested messages currently arrive as complete artifacts — fundamental 'fighting CC' issue if true)." The audit was correct; the fix was not in scope for DP-B as it landed. Phase 24 is that fix.

The lesson for future phases: **a "subtraction pass" must be allowed to subtract structural elements, not only visual ones.** A subtraction pass scoped against visual chrome will reliably miss plumbing problems beneath the visual layer.
