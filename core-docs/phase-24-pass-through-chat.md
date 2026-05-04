# Phase 24 — Chat pass-through (architectural)

**Date:** 2026-05-03
**Status:** Spec post staff-perspective review (engineer + UX + design-engineer); ready for ADR drafting + dispatch
**Trigger:** Repeat dogfood failure modes — half-answers, frozen agents, tool-cards sorting under user replies, activity indicator flicker — all traceable to plumbing Designer built on top of Claude Code that fights the runtime instead of riding it.

---

## 1. Why this phase exists

Designer's chat layer has accumulated four pieces of bespoke infrastructure that, taken together, degrade the underlying tool:

1. A **120 ms message coalescer** (`apps/desktop/src-tauri/src/core_agents.rs`) that batches `MessagePosted` events for "smoother" rendering.
2. A **two-event split** for chat-domain content: `MessagePosted` for assistant text, `ArtifactProduced` (kind: `Report`) for every `tool_use` block. Same logical turn, two event vocabularies, two ordering rules.
3. A **synthesized activity-state machine** (`Idle` / `Working`) inferred from stream-event recency, then reset on subprocess respawn.
4. A **custom subprocess lifecycle** — UUIDv5 / random session-ids, kill-and-respawn on model switch, reader loops that exit on EOF without flushing pending coalescer state.

The DP-B pass-through pass (PR #63, 2026-05-01) addressed the *visual* layer — stripped card chrome from message blocks, demoted tool-call groups to inline lines, moved spec/PR/report blocks to the spine. It did not touch the plumbing layer underneath. The result is visual pass-through with non-pass-through plumbing: it *looks* like Claude Code in a window but behaves like a custom chat with the failure modes of a custom chat.

Phase 24 is the structural pass DP-B couldn't be without re-litigating events, types, and the reader loop. The thesis: **anything Claude Code does in a terminal is the floor of what Designer must do, not the ceiling Designer aspires to.**

## 2. First principles

### 2.1 Pass-through by default; intercept only at must-intercept seams

A "must-intercept seam" is a place where Claude Code's terminal-CLI behavior is unavailable in Designer's runtime context. There are three:

- **Approval UI** for `--permission-prompt-tool stdio`. Claude's terminal TUI cannot render inside our webview; Designer must provide a UI for the same protocol.
- **Subprocess lifecycle ownership.** Designer owns the process tree per `(workspace, tab)`.
- **Persistence.** Designer stores conversations across app restarts via the event log; the terminal CLI uses `--resume <session-id>`.

Everything else passes through. Token streaming order, content-block emission timing, tool-use rendering, completion semantics, error surfacing, cost reporting — all match what `claude` does in a terminal. We do not invent rendering rhythm, ordering rules, activity heuristics, or session-id schemes that diverge from the runtime.

### 2.2 The Anthropic Messages API content-block model is the contract

Claude Code's stream-json output is a faithful projection of the Anthropic Messages API. Designer's chat-domain event vocabulary maps onto this model. Three representative scenarios prove the mapping is unambiguous:

**Scenario A — text-only turn.**
```
system/init { session_id }
message_start { id: msg_01ABC, model, role: assistant }
content_block_start { index: 0, type: text }
content_block_delta { index: 0, delta: {type: text_delta, text: "Hello"} }
content_block_delta { index: 0, delta: {type: text_delta, text: ", world."} }
content_block_stop { index: 0 }
message_delta { delta: {stop_reason: end_turn} }
message_stop
result/success { tokens_input, tokens_output, total_cost_usd }
```

**Scenario B — tool-use turn with thinking.**
```
message_start { id: msg_01XYZ, model, role: assistant }
content_block_start { index: 0, type: thinking }
content_block_delta { index: 0, delta: {type: thinking_delta, thinking: "I should read the file..."} }
content_block_stop { index: 0 }
content_block_start { index: 1, type: text }
content_block_delta { index: 1, delta: {type: text_delta, text: "Let me check that for you."} }
content_block_stop { index: 1 }
content_block_start { index: 2, type: tool_use, id: toolu_01..., name: Read, input: {} }
content_block_delta { index: 2, delta: {type: input_json_delta, partial_json: "{\"file_path\""} }
content_block_delta { index: 2, delta: {type: input_json_delta, partial_json: ":\"plan.md\"}"} }
content_block_stop { index: 2 }
message_delta { delta: {stop_reason: tool_use} }
message_stop
```
Followed by Designer routing the tool result back via the next `user`-typed envelope.

**Scenario C — parallel tool_use blocks.** Multiple `tool_use` blocks at distinct `index` values in a single message. Order across blocks is the message's content-array order; deltas within a block carry that block's `index`. Tool results arrive in the next `user` envelope; correlation is by `tool_use_id`, not by index.

The translator's job is a typed projection of these shapes onto the events in §4. It does not reinterpret content blocks, flatten text bursts, synthesize block boundaries, or correlate tool_results across turn boundaries.

### 2.3 Observable signals beat inferred state

Designer should never compute and broadcast a state value when an observable fact answers the same question.

- **Activity indicator** is shown when the subprocess is running AND no `AgentTurnEnded` has been received for the current turn. This handles thinking pauses, slow tools, and web-search stalls correctly — which a wall-clock-recency threshold does not. (D3, revised post-review.)
- **Conversation state** is the sequence of events in the store. No coalescer pending maps; no per-tab `first_seen_at` tables.
- **Session continuity** uses Claude's own `session_id` from `system/init` plus `--resume`. (D4.)

Synthesized state goes stale on subprocess respawn, on event-log replay, on tab-switch tear-down. Observable facts don't.

### 2.4 Streaming order is arrival order

In the new chat plumbing, the order of items in the rendered thread is the order in which events arrived from the subprocess. No timestamp re-sorting, no first-token-stamp gymnastics, no "but the user message is *logically* later." If Claude emits a tool_use block after a user reply, the rendered thread shows the tool_use block after the user reply — which is what actually happened. The "should the user be able to send while the agent is mid-turn?" question moves out of the timestamp layer and into the UX layer (§5.4).

### 2.5 Coherence is the goal, not a LOC target

This phase removes synthetic state and consolidates two parallel event vocabularies into one. LOC may decrease as a side effect (the coalescer + LRU + correlation table go away); LOC may increase from new event variants and acceptance tests. The success metric is **architectural coherence**, not a LOC delta. Conservative estimate post-review: **net +200 to −500 LOC**, dominated by tests and the read-side projection. (Revised from earlier −1,200 target — that target was wishful.)

## 3. Architectural seam: what Designer intercepts vs. passes through

### 3.1 Must-intercept (kept and kept simple)

| Seam | Why | Implementation |
|---|---|---|
| Tool-use approval prompts | Claude TUI cannot render in our webview | `InboxPermissionHandler` routes `--permission-prompt-tool stdio` requests to the inbox. **Unchanged from 13.G.** |
| Subprocess lifecycle | Designer owns the process tree | One subprocess per `(workspace, tab)`. Spawn lazy on first send. Kill on tab close. **Model switching mid-tab uses Claude's `--resume <session_id>` to preserve conversation context** (D5, revised). |
| Cost extraction | The cost chip is a Designer surface | `result/success` lines emit `CostRecorded` directly to the broadcast channel; `CostTracker` subscribes like any consumer. (Cleared up post-review — was previously a `TranslatorOutput::Cost` side-channel.) |
| File-system writes that match spec/PR/report patterns | First-class spine artifacts, not chat events | Existing watcher in `crates/designer-claude/src/watcher.rs`. Emits `ArtifactCreated { kind: Spec | Pr | Report }`. **Unchanged.** |
| Persistence | Replay across app restarts | Append every chat-domain event to the SQLite event log; replay on boot to rebuild the thread. |

### 3.2 Pass-through (no longer transform)

| Today's bespoke layer | Replaced by |
|---|---|
| 120 ms `MessagePosted` coalescer with first-token-timestamp tracking | Direct emission of `AgentContentBlockDelta` per stream `content_block_delta`. Renderer accumulates. |
| `ArtifactProduced { kind: Report, title: "Used Read" }` for every tool_use block | `AgentContentBlockStarted { kind: ToolUse, name, tool_use_id }` + `AgentContentBlockDelta`s carrying `input_json_delta` partials + `AgentContentBlockEnded`. Renders as inline `· Read src/foo.rs` in chat. |
| Synthesized `Idle`/`Working` activity enum in the event log | Render-time computation: `subprocess_running(tab) && !turn_ended(turn_id)`. No stored enum. |
| UUIDv5 / UUIDv4 session-id minting | Use Claude's own `session_id` from `system/init`. Persist per tab. Use `--resume <id>` on respawn. |
| Bounded LRU `tool_uses` map for `tool_result` ↔ `tool_use` correlation | Per-turn transient correlation map (lives only while the turn is open). Tool results during the same turn correlate by id; out-of-turn results are discarded with a logged warning (rare; should not occur with stream-json discipline). |
| `MessagePosted` / `ArtifactProduced` split for chat | Single content-block stream per turn. (D8: `MessagePosted` reserved for **user** messages only; agent output is `AgentTurn*` events.) |

### 3.3 Markdown rendering strategy (post-review addition)

Streaming character-by-character forces the renderer to make a parse-stability choice. The decision: **render incrementally as plain text; re-parse and re-render markdown at `AgentContentBlockEnded` for text blocks.** This matches the terminal CLI experience (where streaming text has no markdown syntax stabilization, because there's no markdown rendering at all) and avoids the `*` → `**` → `**bold` → `**bold**` flicker that would otherwise dominate dogfood feedback. Code blocks and inline code use the same pattern; full syntax highlighting fires at block-end. The only exception is `tool_use` block titles (`· Read src/foo.rs`), which are derivable from the first prefix of `input_json_delta` and render immediately.

## 4. New event contract

All events keyed on `(workspace_id, tab_id, turn_id)`. `turn_id` is Claude's own `message_id` from the `message_start` envelope; we do not invent it.

```
AgentTurnStarted     { workspace_id, tab_id, turn_id, model, parent_user_event_id, session_id }
AgentContentBlockStarted   { workspace_id, tab_id, turn_id, block_index, kind: Text | ToolUse { name, tool_use_id } | Thinking }
AgentContentBlockDelta     { workspace_id, tab_id, turn_id, block_index, delta }
AgentContentBlockEnded     { workspace_id, tab_id, turn_id, block_index }
AgentToolResult            { workspace_id, tab_id, turn_id, tool_use_id, content, is_error }
AgentTurnEnded       { workspace_id, tab_id, turn_id, stop_reason: EndTurn | ToolUse | MaxTokens | Interrupted | Error, usage: TokenUsage }
CostRecorded         { workspace_id, tab_id, turn_id, dollars_cents, tokens_input, tokens_output }
```

The `delta` payload is the raw Claude delta string (text fragment for `text_delta`, JSON-fragment string for `input_json_delta`, text fragment for `thinking_delta`). Renderer reassembles per `block_index`.

### 4.1 Additive, not destructive

All existing chat-related variants in `EventPayload` (`MessagePosted{author_role:AGENT|TEAM_LEAD}`, `ArtifactProduced{kind:Report}` for tool_use, `ActivityChanged`) **stay in the schema** under a `#[deprecated]` annotation. The new `AgentTurn*` variants are emitted by the post-Phase-24 reader; the deprecated variants stop being *written* by Designer. This sidesteps the frozen-contract concern (event vocabulary is expanded, not modified) and keeps every existing consumer working.

The four detectors in `crates/designer-learn/src/detectors/` (`repeated_correction`, `multi_step_tool_sequence`, `repeated_prompt_opening`, `compaction_pressure`) all pattern-match on `MessagePosted{author_role:AGENT}` today. As part of Phase 24, each detector gains an additional pattern arm that recognizes the new `AgentTurn*` events, with shared helper methods for "is this an agent message" and "what is the agent's text content for this turn." The detectors keep working on legacy event logs (via the deprecated variants) and new logs (via the additive variants) without code-level branching at the call sites.

### 4.2 Replay safety

The event log on existing dogfood machines contains pre-Phase-24 chat events. Strategy: **read-side projection, with a one-time, dismissible banner on conversations that contain only legacy events.**

- New conversations emit `AgentTurn*` events; render through the new path.
- Legacy conversations continue to render via a renderer-side projection that maps `MessagePosted{author_role:AGENT}` + adjacent `ArtifactProduced{kind:Report}` events into synthetic `AgentTurn*` shapes for display purposes only. The synthesis is best-effort and does not write back to the store.
- A conversation containing only legacy events shows a dismissible banner: *"Imported from earlier version — turn boundaries may be approximate."* Banner state is per-conversation, persisted, dismissible once.
- Mixed conversations (started before Phase 24, continued after) render legacy turns via the projection and new turns natively. No banner — the user sees Phase 24 behavior the moment they continue.
- The deprecated event variants stay in the schema indefinitely; they are not load-bearing for new code, just present so old logs don't fail to deserialize.
- The renderer-side projection is a separate module (~200 LOC) that can be deleted in a future phase if dogfood signals it's unused. No 90-day deadline; this is technical debt with a clear location, not a ticking clock. (D9, revised post-review.)

## 5. UX implications

### 5.1 What chat looks like after

Visually close to today after DP-B (PR #63) and the 23.C trail (PRs #92→#94→#97): flowing markdown for agent text, terse `· Read src/foo.rs` lines for tool calls, expand-on-click for tool input/output. Differences are behavioral:

- **Streaming is real.** Text deltas land character-by-character as Claude emits them. Markdown stabilizes at block-end (§3.3). Visual rhythm matches `claude` in a terminal.
- **Tool calls land in turn order.** A tool_use block emitted between two text segments renders between them, not bottom-stacked.
- **No phantom reordering.** Send-while-streaming uses a queue (§5.4); messages never retroactively reposition.
- **Tool calls expand inline.** Existing 23.C trail behavior preserved end-to-end: `aria-live` on the disclosure region, layout-stable expand animation, "Try again" retry on transient errors, 40-line truncation with "Show full". (Tracked as A8 acceptance criterion below.)
- **Thinking blocks render in a collapsed disclosure** with a subtle `·` prefix and `Thinking` label. Expand reveals the thinking content. Default collapsed; honors `prefers-reduced-motion`.

### 5.2 Activity indicator

Today: a synthesized `Working` state that resets on respawn, occasionally vanishes mid-turn.

After: a render-time computation. Indicator is shown when (a) the subprocess for this tab is running AND (b) the current turn (the most recent `AgentTurnStarted` whose `turn_id` has no matching `AgentTurnEnded`) is open. No wall-clock recency check — the turn is open until Claude says it isn't, regardless of whether deltas pause for thinking, web search, or slow tools. (Engineer-review BLOCKER 1 fix.)

The existing **"Working… 0:24" elapsed-time chip** in the composer is preserved: shows mm:ss from `AgentTurnStarted` to `AgentTurnEnded`. Gives the user a sense of how long the current turn has been running. On `AgentTurnEnded` the chip fades over `--motion-fast` (replaces the snap-off behavior; UX-blocker fix).

The pulse animation uses a token: `--motion-pulse` (defined as 1.6s ease-in-out). Reduced-motion fallback: static dot. Color: monochrome `--color-muted` — does not encode state; activity is a binary signal, not a status.

### 5.3 Approvals

Unchanged from 13.G. Approval cards still render inline at the position in the thread where Claude requested them. Behavioral improvement: because tool_use blocks now stream as they arrive, the approval card lands *before* any tool result, never after — closing a latent ordering ambiguity.

### 5.4 Send-while-streaming

The composer is enabled mid-turn, but submissions are queued, not interleaved. (D6.)

**Visual treatment.** The queued message renders as a `Cluster` of icon (clock or paper-plane outline) + text, placed **above** the ComposeDock textarea, full-width minus dock padding. Tokens:
- Surface: `--color-surface-muted`.
- Border: `--color-border-soft`, 1px.
- Radius: `--radius-button`.
- Padding: `--space-3` vertical, `--space-4` horizontal.
- Type: `--type-caption-size` for the "queued" prefix, `--type-body-size` for the message body, `--color-foreground-muted`.
- Cancel affordance: trailing `IconButton` (×) sized `--target-sm` per axiom #14, label `"Discard queued message"`.

**Multi-tab.** Queue is per-tab, persisted to localStorage keyed `(workspace_id, tab_id)`. Switching tabs preserves both the visible queue (in the active tab) and the dormant queue (in the inactive tab). Closing the tab discards the queue (matches draft-text behavior in the audit). Reloading the app preserves it (replay on boot). (Open question Q1 closed.)

**Dispatch.** On `AgentTurnEnded` (any `stop_reason`, including `Error` and `Interrupted`), the queued message dispatches as a normal user message. A short `aria-live="polite"` announcement: *"Queued message sent."* The chip fades over `--motion-standard`. (Engineer-review NIT 4 closed: dispatch is unconditional; if the prior turn errored, the user can retry by editing in the new turn.)

**Cancel.** Three paths: click the `×` affordance; press ESC while the composer is focused (only — see §5.4.1 for ESC priority); type more in the composer (replaces the queued message — clear visual transition, queue chip dissolves into the active textarea).

### 5.4.1 ESC priority chain

ESC is overloaded. Resolution order, top to bottom — first match consumes the keypress:

1. If a modal is open (`AppDialog` / `RepoLinkModal` / `CreateProjectModal` / `RepoUnlinkModal`), close the modal.
2. If a tooltip is showing, dismiss it.
3. If Friction selection-overlay mode is active, exit selection mode.
4. If the composer has focus and a queued message exists, discard the queue.
5. If a turn is currently open in the focused tab (`AgentTurnStarted` without matching `AgentTurnEnded`), send `SIGINT` to the subprocess (subject to the verification in §11 prerequisites).
6. Otherwise, no-op.

Documented in `core-docs/pattern-log.md` so future ESC-consuming surfaces know the chain.

### 5.4.2 Interrupt UX

When ESC sends `SIGINT` (rule 5 above), the current turn ends with `stop_reason: Interrupted`. The composer immediately becomes ready for input. The thread shows a discreet inline marker at the interrupt position: *"Interrupted"* in `--color-foreground-muted` `--type-caption-size`. No modal, no confirmation — instant matches `claude` in a terminal. Queued messages clear (rule 4 already discarded; if the user pressed ESC against rule 5 with no queue, nothing to clear).

`aria-live="assertive"` announcement on interrupt: *"Agent interrupted."*

### 5.5 Empty + idle states

Empty tab (no events): *"Start by asking something."* (Distinct from "say something to the team" which read awkwardly post-conversation.)
Post-conversation idle (no open turn, last event was `AgentTurnEnded`): *"Send a follow-up."*
The renderer derives `hasTurn` from "any `AgentTurnStarted` exists for this tab" — single boolean, no `hasStarted` synthesis.

### 5.6 Error and recovery copy

Engineer-speak (`stop_reason: error_during_execution`, `ChannelClosed`) must not reach the user. Mapping:

| Underlying state | User-facing copy |
|---|---|
| Subprocess crash mid-turn | *"Claude stopped unexpectedly. Restarting…"* (auto-restart on next send; if restart also fails: *"Couldn't reach Claude. Check your installation in Settings → Account."*) |
| `stop_reason: error_during_execution` | *"Something went wrong on Claude's side. Try again, or shorten the request."* |
| `stop_reason: max_tokens` | *"Reached the response length limit. Ask for a continuation if you need more."* |
| Tool execution error | *"Tool {name} failed: {tool error message}."* (tool error message is from the tool, not engineer-y) |
| Cost cap reached (Phase 13.I, future) | *"You've reached this project's spend cap. Adjust in Settings → Cost."* |
| Approval expired (5 min timeout) | *"Approval expired. The agent stopped waiting; send your message again to continue."* |

All error states render in `--color-foreground-muted` with `--color-warning` accent for the pill icon. No error red unless the error is destructive (file deletion blocked, etc.).

### 5.7 Accessibility announcements

| Event | Region | Politeness | Copy |
|---|---|---|---|
| `AgentTurnEnded { stop_reason: EndTurn }` | thread region | polite | "Agent responded" or "Agent responded with code" / "with tool calls" if applicable |
| `AgentTurnEnded { stop_reason: Interrupted }` | thread region | assertive | "Agent interrupted" |
| `AgentTurnEnded { stop_reason: Error }` | thread region | assertive | "Agent stopped: {user-facing copy from §5.6}" |
| Queued message dispatched | composer region | polite | "Queued message sent" |
| Queued message added | composer region | polite | "Message queued, will send when current turn ends" |
| Activity indicator appears | indicator region | (visual only — `aria-label="Agent working"` as a static label, not live) | n/a |

Partial deltas are **not** announced — that would flood the screen reader. Only turn-boundary events announce.

### 5.8 Reduced-motion + a11y craft

- Streaming text rendering: append-only DOM updates; renderer uses `will-change: transform` on the streaming text container; markdown re-render at block-end is wrapped in `requestAnimationFrame`. (UX-1)
- Focus management: composer keeps focus across turn boundaries; `aria-live="polite"` on the agent-output region announces only completed turns (§5.7). (UX-2)
- Tool-call expand/collapse and thinking-block disclosure honor `prefers-reduced-motion`: instant disclosure, no rotate/transform. (UX-3)
- Activity indicator pulse honors `prefers-reduced-motion`: static dot. (UX-4)
- Hit targets per axiom #14: cancel-queue × button, expand chevrons, all `IconButton`-based.

## 6. Acceptance criteria

These are the regression tests for the failure modes that triggered this phase. Each must have a covering test before the PR can merge.

**A1. Tool-use cards never appear after a subsequent user message in arrival order.**
Fixture: stream emits two tool_use blocks, one user `MessagePosted`, one tool_use block. Assert thread renders in arrival order with the user message between the second and third tool_use.

**A2. Half-answer freeze cannot drop pending content.**
Fixture: spawn subprocess, emit `AgentContentBlockStarted{kind:Text}` + one `AgentContentBlockDelta`, kill subprocess. Assert: (a) both events are in the store, (b) replay renders the partial block with an "Interrupted" marker (no missing `AgentContentBlockEnded` does not break rendering), (c) no `AgentTurnEnded` event was synthesized — the renderer treats subprocess-EOF as an implicit end-of-turn with `stop_reason: Error` only at render-time.

**A3. Activity indicator does not flicker during legitimate pauses.**
Fixture: emit `AgentTurnStarted`, then a 30-second silence (simulating extended thinking), then `AgentContentBlockStarted{kind:Text}` with deltas. Assert indicator stays visible throughout the silence; no Working → Idle → Working transition.

**A4. Streaming is real with bounded jitter.**
Live test (`--features claude_live`): send a message that triggers a 500+ token response. Assert: text deltas render at sub-50 ms intervals once Claude starts streaming; renderer maintains 60 fps for ≥95% of the turn (Performance API frame timing); DOM update time per delta < 5 ms (DevTools Timeline).

**A5. Send-while-streaming queues, doesn't interleave.**
Test: trigger an agent turn; while mid-stream, type and submit a user message. Assert: message renders as queued chip in composer (not in thread); `aria-live` announcement fires; after `AgentTurnEnded`, message dispatches and renders in thread; second `aria-live` announcement fires.

**A6. ESC interrupts mid-turn (priority chain rule 5).**
Test: trigger an agent turn with no modal/tooltip/friction-overlay/queue active; press ESC. Assert: SIGINT sent to subprocess; turn ends with `stop_reason: Interrupted`; thread shows "Interrupted" marker; composer is immediately ready; `aria-live` announcement fires.

**A6.b. ESC respects priority chain.**
Test: with a modal open, press ESC during a mid-turn agent stream. Assert: modal closes; subprocess receives no signal; turn continues. (Re-test for tooltip, friction overlay, queued message — each should consume ESC before SIGINT.)

**A7. Cost tracking still works.**
Fixture: emit a `result/success` line. Assert `CostRecorded` event in workspace stream with correct dollar-cents; `CostTracker` updates.

**A8. Tool-use approval still works AND tool-call rendering preserves 23.C a11y.**
Live test: trigger a Write tool. Assert: approval inbox surfaces; granting allows tool to proceed; denying blocks. PLUS: tool-call inline render has `aria-live="polite" aria-relevant="additions"`; expand/collapse maintains layout stability; transient tool error displays "Try again" retry affordance with keyboard path.

**A9. Replay safety.**
Test: load an event log captured before Phase 24 (legacy `MessagePosted{author_role:AGENT}` + `ArtifactProduced{kind:Report}`). Assert: renderer-side projection synthesizes `AgentTurn*` shapes; thread renders with banner *"Imported from earlier version — turn boundaries may be approximate."* Banner is dismissible, dismissal is persisted.

**A10. Detector compatibility.**
Test: run all four `crates/designer-learn/src/detectors/` against a mixed log (legacy + Phase 24 events). Assert: each detector recognizes both shapes; counts match expected fixtures; no panics, no missed events.

**A11. Markdown stability.**
Test: emit a stream of text deltas containing markdown (`**bold** _italic_ `code` [link](...)`). Assert: during streaming, plain text renders incrementally with no markdown reflow; at `AgentContentBlockEnded`, markdown renders in final form with no flicker; `prefers-reduced-motion` users see no transition between plain and rendered.

**A12. Error-state copy.**
Test: trigger each error state in §5.6 via fixture or live test. Assert user-facing copy matches the table; no engineer-language strings (`stop_reason:`, `Error::`, `panicked`, etc.) leak to the DOM.

## 7. Decisions

- **D1** — Drop the 120 ms `MessagePosted` coalescer. *Why:* source of every ordering bug; introduces complexity to solve a problem (visual rhythm) that doesn't exist in the terminal CLI.
- **D2** — Stop emitting `ArtifactProduced { kind: Report }` for tool_use blocks. *Why:* tool calls in chat are not artifacts in the spine sense (no one references "Used Read on plan.md" later); they are mid-turn breadcrumbs. (Variant kept in schema; emission stops.)
- **D3** — Replace synthesized `ActivityChanged` with render-time computation: `subprocess_running && !turn_ended`. *Why:* synthesized state goes stale on respawn; observable fact does not. Wall-clock recency was a worse signal because it falsely flags thinking pauses. (Revised post-review.)
- **D4** — Use Claude's own `session_id` from `system/init`; remove UUIDv5/UUIDv4 minting. *Why:* Claude already manages session continuity via `--resume`; we were racing against it.
- **D5** — Model switch within a tab respawns the subprocess and resumes the session via `--resume <claude-session-id>`. Conversation context is preserved. (Revised post-review — the original "open a new tab" was worse UX.) Tab close still kills its subprocess; no model-change respawn for tabs without an active session.
- **D6** — Queue user messages submitted mid-turn; do not interleave. *Why:* removes ordering ambiguity; clear mental model. Queue dispatches on any `stop_reason` (including Error and Interrupted).
- **D7** — ESC during mid-turn agent stream sends SIGINT to the subprocess (subject to ESC priority chain in §5.4.1 and prerequisite verification in §11). Matches `claude`'s own ESC-to-interrupt.
- **D8** — Reserve `MessagePosted` for user messages only in Phase-24-and-later writes. *Why:* makes the user → agent boundary visible in the schema; agent output is `AgentTurn*` events. Old `MessagePosted{author_role:AGENT}` events stay readable forever.
- **D9** — Renderer-side projection (read-only) for legacy events; banner on legacy-only conversations; **no deletion deadline**. *Why:* shim is small (~200 LOC), forward-compatible. A deadline implies a guaranteed cleanup that may not align with dogfood reality. Track deletion as a follow-up phase when usage data shows the projection is unreached.

## 8. Open questions

- **Q1** — Flag-gating strategy. Options: (a) compile-time `--features phase-24-chat` for clean rollout in dev/staging; (b) runtime `show_chat_v2` feature flag with default-off in dogfood for one week, default-on after; (c) hard cut-over with rollback via `git revert`. *Recommendation:* (b) — runtime flag gives observability and a kill switch. Dispatch decision before workspace start.
- **Q2** — Multi-agent / sub-agent chat in Phase 25+. The single-subprocess-per-tab model assumes one agent per tab; future phases may want N agents per tab. The new event contract supports this (`turn_id` is per-message; a tab can have interleaved turns from multiple agent sessions if Designer routes them so). Out of scope for Phase 24, tracked here as a forward-compat checkpoint.
- **Q3** — Thinking-block default disclosure. Spec says default-collapsed; some users may prefer default-expanded for transparency. *Recommendation:* default-collapsed for v1, add a per-project preference in a follow-up if dogfood signal asks.
- **Q4** — Scroll-anchor behavior when a 5000-token response streams in. Out of scope for the architectural spec; assigned as a Phase 24.a polish pass after first dogfood.

## 9. Out of scope

- **Higher-level approvals** (track merge, roadmap edit, spend-cap raise). Belongs in Phase 13.I.
- **Multi-agent / sub-agent UI.** See Q2.
- **Spec / PR / Report block extraction in chat.** Already correct: filesystem watcher emits `ArtifactCreated`; chat shows a one-line `→ artifact-name` reference.
- **Cost cap enforcement.** `CostTracker` keeps recording; enforcement is Phase 13.I.
- **Tool-result rich rendering.** Tool results render as the textual content Claude emits. Image/diagram previews are a separate phase.

## 10. Anthropic Claude Code alignment

This phase deliberately aligns Designer's chat plumbing with Claude Code's official extension surfaces:

- **Stream-json I/O** (`--input-format stream-json --output-format stream-json`) — consume verbatim per §2.2.
- **`--permission-prompt-tool stdio`** — kept (must-intercept seam).
- **`--setting-sources user,project,local`** — kept; user-level allow-rules in `~/.claude/settings.json` evaluate before stdio prompt.
- **`--resume <session-id>`** — adopted (D4, D5).
- **`--dangerously-skip-permissions`** — explicit anti-pattern; never use.
- **Hooks (`.claude/settings.json` `hooks` block)** — not adopted in Phase 24 (chat plumbing is upstream of hook concerns), but Phase 13.I should adopt them rather than invent parallel mechanisms.

## 11. Implementation strategy

This is a single workspace, not parallelizable. Every layer touches every other.

### 11.0 Prerequisites (must complete before workspace dispatch)

**P1. ADR 0008** — Additive event-vocabulary extension and chat-domain deprecation. Documents the `AgentTurn*` variants as additive per the Lane 0 ADR (ADR 0002 addendum), the `#[deprecated]` annotation on `MessagePosted{author_role:AGENT}` / `ArtifactProduced{kind:Report}` / `ActivityChanged`, the renderer-side projection for legacy events, and the detector-update plan. ~half-day write-up.

**P2. SIGINT verification.** Run `claude` as a piped subprocess (no PTY) and verify SIGINT actually interrupts a streaming turn cleanly. If verification fails (subprocess ignores SIGINT under piped stdio), D7 falls back to: send `{"type":"control_request","subtype":"interrupt"}` over stdin if Claude supports it; if not, kill the subprocess and respawn via `--resume`. Update D7 with the verified mechanism before workspace dispatch.

**P3. Decide flag-gating strategy** (Q1) and document in `plan.md` Lane 2 entry.

### 11.1 Workspace sequence

1. **Define new `EventPayload` variants** in `crates/designer-core/src/event.rs`. Mark old chat variants `#[deprecated]`. Bump `EventEnvelope.version` to 2.
2. **Rewrite `crates/designer-claude/src/stream.rs`** as a typed 1:1 stream-json projection emitting `AgentTurn*` events. Drop the bounded LRU; use a per-turn transient correlation map. Cover the three §2.2 scenarios with fixture tests.
3. **Delete the coalescer + per-tab `first_seen_at` tables** in `apps/desktop/src-tauri/src/core_agents.rs`. Reader loop emits events directly.
4. **Update `cmd_post_message`** to dispatch user messages with `MessagePosted{author: User}` only. Reader handles agent side via `AgentTurn*`.
5. **Renderer: implement legacy-event projection** in `packages/app/src/tabs/WorkspaceThread.tsx` (or a sibling reducer). Show banner on legacy-only conversations.
6. **Renderer: rewrite chat thread** to consume `AgentTurn*` events. Per-block accumulator; markdown re-render at block-end (§3.3).
7. **Implement send-while-streaming queue** in `ComposeDock` per §5.4. localStorage persistence; multi-tab.
8. **Implement ESC priority chain** (§5.4.1) in the global key handler.
9. **Implement interrupt UX** (§5.4.2) using verified mechanism from P2.
10. **Wire activity indicator** as render-time observable (§5.2). Preserve elapsed-time chip.
11. **Update detectors** in `crates/designer-learn/src/detectors/` to recognize both shapes (§4.1).
12. **Error-state copy mapping** (§5.6) implemented in `WorkspaceThread` and `ComposeDock` error surfaces.
13. **Migrate tests** — fixture-based stream-translator tests, frontend chat-thread tests, integration tests for A1–A12.

### 11.2 Procedural artifacts (Mini)

- `core-docs/component-manifest.json` — mark `ToolCallGroup`, `MessageBlock` (agent variant), `ArtifactReferenceBlock` (tool_use variant) as `retired` with comment linking Phase 24. Add `ChatStreamRenderer` (or whatever the renderer ends up named), `QueuedMessageChip`, `InterruptedMarker`. Update `BlockRenderers` purpose field.
- `core-docs/generation-log.md` — append entry per CLAUDE.md procedure step 7.
- `core-docs/pattern-log.md` — entries for D1 (coalescer drop), D3 (observable activity), D5 (model-switch resume), D6 (queue not interleave). Each entry documents the rationale that won't be obvious from the diff.

### 11.3 Quality gates before PR

- `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `pnpm -w typecheck && pnpm -w test`
- `node tools/invariants/check.mjs` on changed UI files
- Manual: real claude subprocess round-trip exercising A1–A12; before/after screenshots in PR description for streaming, queue chip, and interrupt; recorded video for A4 (streaming jitter).

Branch: `phase-24-chat-pass-through`. Base: `main`. One PR.

---

## Appendix A — DP-B retrospective

DP-B (PR #63) implemented:
- Stripped card chrome from `MessageBlock` for agent messages.
- Demoted `ToolCallGroup` to terse inline lines.
- Moved `SpecBlock` / `PrBlock` / `ReportBlock` / `CodeChangeBlock` out of the chat stream into the sidebar.

What it did not do:
- Did not delete the 120 ms coalescer.
- Did not change the `MessagePosted` / `ArtifactProduced` split.
- Did not address subprocess respawn semantics or activity-state synthesis.

DP-B's stated mandate (`plan.md` line 74) included "verify streaming works for assistant messages; fix if not." The audit was correct; the fix was scope-truncated. Phase 24 is that fix.

The lesson: **a "subtraction pass" must be allowed to subtract structural elements, not only visual ones.** Visual subtraction over non-pass-through plumbing produces the worst of both — a polished surface over a bespoke runtime — which is exactly the failure mode that triggered Phase 24.

---

## Appendix B — Review history

Spec drafted 2026-05-03. Three-perspective review (staff engineer + staff UX designer + staff design engineer) ran the same day and surfaced 19 findings (10 blockers, 6 important nits, 3 follow-ups). Spec was revised to address every blocker and important nit; the three follow-ups appear as Q1–Q4 in §8 or as out-of-scope notes in §9.

Specific revisions from review:
- **Frozen-contract concern:** spec was reframed from "delete variants" to "additive new variants + deprecate old" (§4.1).
- **Stream-json 1:1 claim:** §2.2 expanded with three concrete scenarios.
- **Activity threshold:** wall-clock 5s replaced with turn-open observable (§5.2, D3 revised).
- **SIGINT verification:** promoted from acceptance criterion to prerequisite (§11.0 P2).
- **Markdown rendering strategy:** added §3.3.
- **Send-while-streaming queue:** §5.4 expanded with token spec, multi-tab persistence, cancel affordance, dispatch behavior.
- **ESC priority chain:** added §5.4.1.
- **Interrupt UX:** added §5.4.2.
- **Empty-state copy:** added §5.5.
- **Error-state copy:** added §5.6.
- **a11y announcements:** added §5.7 with explicit table.
- **Tool-call a11y preservation:** A8 acceptance criterion expanded.
- **Replay safety messaging:** §4.2 banner + indefinite shim (D9 revised).
- **Model switch:** D5 revised to keep in-tab via `--resume`.
- **Detector compatibility:** §4.1 + A10 + §11.1 step 11.
- **Procedural artifacts:** §11.2.
- **LOC target:** §2.5 reframed; A10 (LOC target) deleted.
