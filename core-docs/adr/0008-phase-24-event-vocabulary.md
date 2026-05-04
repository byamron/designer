# ADR 0008 — Phase 24 chat-domain event vocabulary

**Status:** proposed
**Date:** 2026-05-03
**Deciders:** user, after staff-perspective review of `core-docs/phase-24-pass-through-chat.md` (PR #116) flagged the original "delete chat-domain variants" framing as a frozen-contract violation
**Supersedes:** none. Builds on ADR 0002 addendum (additive `EventPayload` extensions, 2026-04-26) and the 13.L precedent for non-additive payload changes via `EventEnvelope.version` bump.

## Context

Phase 24 (`core-docs/phase-24-pass-through-chat.md`) replaces the chat-domain plumbing with a pass-through layer aligned 1:1 to Claude Code's stream-json output. The chat surface today represents a single agent turn as two parallel event streams — `MessagePosted{author_role: AGENT|TEAM_LEAD}` for assistant text, `ArtifactProduced{kind: Report}` for every `tool_use` block, plus a synthesized `ActivityChanged{state: Idle|Working}` enum for the UI activity indicator.

This split has produced three classes of dogfood failure:

- **Ordering bugs.** Tool-use cards stamp at wall-clock time; user replies stamp through the first-token-timestamp coalescer. Tool cards sort below subsequent user messages even though they were emitted earlier in the turn. (PR #91 partially fixed this for `MessagePosted` but the fix doesn't apply to `ArtifactProduced` for tool_use, which is what users see today.)
- **Half-answer freeze.** The 120 ms message coalescer holds pending state; subprocess crash mid-stream silently drops it. Reader-loop EOF doesn't flush.
- **Activity indicator flicker.** Synthesized state resets on subprocess respawn; observable signal would not.

Phase 24's design replaces these three event flows with a single typed projection of stream-json content blocks: `AgentTurnStarted` + `AgentContentBlockStarted` + N `AgentContentBlockDelta` + `AgentContentBlockEnded` per content block + `AgentToolResult` for tool_result correlation + `AgentTurnEnded` per assistant turn, plus an additive `CostRecorded` for the existing cost-extraction sidecar.

## The frozen-contract concern

CLAUDE.md §"Parallel track conventions" freezes `EventPayload` shape. ADR 0002 addendum (2026-04-26) carved out an additive-only exception: new variants are fine; modifying or removing existing variants requires (a) a new ADR, (b) an `EventEnvelope.version` bump, and (c) a documented decode path for legacy records. Track 13.L's `FrictionLinked → FrictionAddressed` rework set the precedent: bumped `version: 1 → 2`, kept the legacy variant tagged `#[deprecated]` for envelope-version-1 decode, mapped legacy records through a projection at apply time.

The Phase 24 spec's original draft proposed *deleting* `MessagePosted{author_role:AGENT|TEAM_LEAD}` and `ArtifactProduced{kind:Report}` for tool_use, plus deleting `ActivityChanged` outright. This is more aggressive than the 13.L precedent because (a) chat events are dense — months of dogfood logs contain millions of them, (b) four detectors in `crates/designer-learn/src/detectors/` consume `MessagePosted{author_role}` shape today, and (c) legacy event logs need to render correctly forever for replay safety.

Staff-perspective review (engineer lens) flagged this as a frozen-contract violation requiring resolution. ADR 0008 is that resolution.

## Decision

**Additive vocabulary extension, deprecate-don't-delete, plus envelope version bump and renderer-side projection for legacy events.**

### 1. New variants (additive, no migration)

Added to `EventPayload` in `crates/designer-core/src/event.rs`:

```rust
AgentTurnStarted {
    workspace_id: WorkspaceId,
    tab_id: TabId,
    turn_id: ClaudeMessageId,           // Claude's own message_id; not minted by Designer
    model: String,                      // e.g. "claude-opus-4-7"
    parent_user_event_id: EventId,      // the user MessagePosted that triggered this turn
    session_id: ClaudeSessionId,        // Claude's own session id from system/init
}
AgentContentBlockStarted {
    workspace_id: WorkspaceId,
    tab_id: TabId,
    turn_id: ClaudeMessageId,
    block_index: u32,
    kind: AgentContentBlockKind,        // Text | ToolUse{name,tool_use_id} | Thinking
}
AgentContentBlockDelta {
    workspace_id: WorkspaceId,
    tab_id: TabId,
    turn_id: ClaudeMessageId,
    block_index: u32,
    delta: String,                      // raw delta string per Claude's stream-json (text/json/thinking)
}
AgentContentBlockEnded {
    workspace_id: WorkspaceId,
    tab_id: TabId,
    turn_id: ClaudeMessageId,
    block_index: u32,
}
AgentToolResult {
    workspace_id: WorkspaceId,
    tab_id: TabId,
    turn_id: ClaudeMessageId,
    tool_use_id: String,
    content: String,
    is_error: bool,
}
AgentTurnEnded {
    workspace_id: WorkspaceId,
    tab_id: TabId,
    turn_id: ClaudeMessageId,
    stop_reason: AgentStopReason,       // EndTurn | ToolUse | MaxTokens | Interrupted | Error
    usage: TokenUsage,
}
CostRecorded {
    workspace_id: WorkspaceId,
    tab_id: Option<TabId>,              // optional because some cost lines pre-date a turn binding
    turn_id: Option<ClaudeMessageId>,
    dollars_cents: u32,
    tokens_input: u32,
    tokens_output: u32,
}
```

New types (in `crates/designer-core/src/domain.rs`):

```rust
pub struct ClaudeMessageId(pub String);   // Claude's own msg_… id
pub struct ClaudeSessionId(pub String);   // Claude's own session id

pub enum AgentContentBlockKind {
    Text,
    ToolUse { name: String, tool_use_id: String },
    Thinking,
}

pub enum AgentStopReason {
    EndTurn,
    ToolUse,
    MaxTokens,
    Interrupted,
    Error,
}

pub struct TokenUsage {
    pub input: u32,
    pub output: u32,
    pub cache_read: u32,
    pub cache_creation: u32,
}
```

These additions follow ADR 0002 addendum clauses (a)–(d): no existing variants modified or removed by the additive set; all production projector arms over `EventPayload` already include `_ => {}` defaults (verified via grep against `crates/designer-core/src/projection.rs`, `apps/desktop/src-tauri/src/core_safety.rs`, `apps/desktop/src-tauri/src/core_friction.rs`, `crates/designer-learn/src/detectors/`).

### 2. Deprecated variants (kept in schema; emission stops)

Marked `#[deprecated(note = "Phase 24: agent output flows through AgentTurn* events; user MessagePosted unchanged. See ADR 0008.")]`:

- `MessagePosted` — **only** the `author_role: AGENT | TEAM_LEAD` cases. The `User` author case stays load-bearing forever; it is the canonical user-input event.
- `ArtifactProduced` with `kind: Report` AND `author_role: Some("agent" | "workspace-lead")`. The `Report` kind in general stays (used by recap, audit, friction-report). Only the chat-tool_use Report sub-case is deprecated.
- `ArtifactUpdated` for tool-result correlation. Other ArtifactUpdated uses (summary updates from the local-model hook) remain.
- `ActivityChanged` — full variant deprecated. Activity indicator becomes a render-time computation (see Phase 24 spec §2.3, §5.2).

Deprecated does **not** mean removed. The variants stay in the `EventPayload` enum so old envelopes deserialize. Designer 0.2.x will not emit them; Designer 0.1.x and earlier did emit them; both must replay correctly forever.

### 3. Envelope version bump

`EventEnvelope.version: 2 → 3`.

- Envelopes written before Phase 24 ships carry `version: 2` (the 13.L baseline) — no change to their payload shape; they decode through the same `EventPayload` enum, hitting the deprecated variants. The envelope version is informational; decoding is variant-driven.
- Envelopes written by Designer post-Phase-24 carry `version: 3`. Their chat-domain payloads use the new `AgentTurn*` variants exclusively.
- The version bump signals readers that the event log may contain `AgentTurn*` shapes; pre-Phase-24 readers seeing `version: 3` should fail closed (refuse to decode) rather than silently miss events. (Designer's store does not currently enforce envelope-version compatibility checks; see "Open follow-up" below.)

### 4. Renderer-side projection for legacy events

`packages/app/src/blocks/legacy-chat-projection.ts` (new module, ~200 LOC) maps deprecated event sequences to the `AgentTurn*` shape at read time **for display only**. The projection does not write back to the store. Algorithm:

- A run of `MessagePosted{author_role: AGENT | TEAM_LEAD}` events with no intervening user `MessagePosted` projects to one synthetic `AgentTurnStarted` + one `AgentContentBlockStarted{kind: Text}` + a sequence of `AgentContentBlockDelta` carrying the bodies + `AgentContentBlockEnded` + `AgentTurnEnded{stop_reason: EndTurn}`.
- Adjacent `ArtifactProduced{kind: Report}` events with `author_role: Some("agent" | "workspace-lead")` and titles matching the `Used <Tool>` pattern (or a body parseable as tool_use_card output) project to `AgentContentBlockStarted{kind: ToolUse}` + a single `AgentContentBlockDelta` carrying the JSON-encoded input + `AgentContentBlockEnded`.
- `ArtifactUpdated` events on the above artifact_ids project to `AgentToolResult`.
- `ActivityChanged` events are dropped (no equivalent in the new model — render-time computation).

Synthetic events have a deterministic prefix on their `turn_id` (`legacy_<envelope_id>_…`) so the renderer can distinguish them from native `AgentTurn*` events. Conversations containing only legacy events surface a one-time, dismissible banner: *"Imported from earlier version — turn boundaries may be approximate."*

The projection module is self-contained and deletable. No fixed deletion deadline; it goes away when usage data shows the legacy code paths are unreached.

### 5. Detector update plan

Four detectors in `crates/designer-learn/src/detectors/` pattern-match on `MessagePosted{author_role: AGENT | TEAM_LEAD}` today:

- `repeated_correction.rs` — needs to recognize `AgentTurnStarted` as a turn boundary and accumulate text from `AgentContentBlockDelta{kind: Text}` events for the "agent text content" comparison.
- `multi_step_tool_sequence.rs` — needs to recognize `AgentContentBlockStarted{kind: ToolUse}` events as the tool-call sequence carrier; current `ArtifactCreated{kind: Report}` parsing keeps working for legacy logs.
- `repeated_prompt_opening.rs` — unchanged. User `MessagePosted` is unchanged in Phase 24.
- `compaction_pressure.rs` — unchanged. Message-count grouping uses both user and agent messages, so it gains `AgentTurnStarted` as a counted boundary.

Each detector's update is additive: new pattern arms recognize the new shapes; existing arms continue to recognize the deprecated shapes. A shared helper `agent_text_content_for_turn(events: &[Event]) -> String` is added to `crates/designer-learn/src/lib.rs` so each detector doesn't reimplement the cross-shape extraction. Phase 21's locked `Detector` trait shape is unchanged.

`detector_version` field on each detector bumps by 1 to signal the input-recognition change.

## Alternatives considered

### A. Migrate the event log on first boot

Rewrite all `MessagePosted{author_role:AGENT}` + `ArtifactProduced{kind:Report}` events into `AgentTurn*` shapes at app start. Clean schema after migration; no projection module forever.

**Rejected.** Chat events are dense (millions on dogfood machines); migration is fragile; partial migration on power-loss leaves the store in a half-state; rolling back to a pre-Phase-24 build would require a reverse migration that doesn't exist. The renderer-side projection is deletable, low-risk, and forward-compatible with a future migration if dogfood signals one is needed.

### B. Compile-time `--features phase-24-chat` flag instead of runtime flag

Build two variants of Designer; ship the new one to a beta channel, the old one to stable.

**Rejected for the addendum scope.** Flag-gating is a rollout choice (Phase 24 spec Q1), not an event-vocabulary choice. ADR 0008 specifies the event shapes; the flag mechanism is independently decided.

### C. Single new `AgentStreamEvent { raw_json: String }` variant

One variant carrying the raw stream-json line; renderer parses on display.

**Rejected.** Erodes type safety; defeats the projector / detector contract. The variant set above is the typed projection of stream-json content blocks; it is "1:1 with Anthropic Messages API" in the sense the spec means.

### D. Modify existing variants (e.g. add `block_index` field to `MessagePosted`)

Reuse the existing `MessagePosted` shape; add fields to encode block boundaries.

**Rejected.** Modifying existing variant fields violates ADR 0002 addendum clause (a) without a stronger justification. The new vocabulary is structurally different (per-block streams vs. per-message bodies); shoehorning into the old shape would produce a worse contract than starting fresh.

## Consequences

### Positive

- **Frozen contract honored.** No deletion of existing `EventPayload` variants. Old envelopes decode forever. Detectors can be updated additively; production projectors keep their `_ => {}` defaults and pick up the new variants when they want to.
- **Replay safety.** Legacy event logs render correctly via the projection module. No data loss; no migration risk.
- **Detector continuity.** Phase 21's learning layer continues to function on logs spanning the cut-over.
- **Forward-compatible flag rollout.** A runtime flag can ship the new emission path to dogfood while keeping the old path emitting on the stable channel; rollback is the flag's off-state.
- **Smaller surface for staff review.** The actual "1:1 with Anthropic Messages API" claim has a fixture-testable shape (the new variants); reviewers don't have to reason about the deletion semantics.

### Negative

- **The deprecated variants stay in the schema indefinitely.** Future contributors will see them in `EventPayload` and may not understand why. The `#[deprecated]` annotation + this ADR mitigate but do not eliminate the cognitive load.
- **Renderer-side projection adds a code path that has to be maintained.** ~200 LOC; not zero. Mitigated by the deletion plan (delete when unreached) but not bounded by a deadline.
- **Two events for the same logical thing during the transition.** A user upgrading to Phase 24 will have a mixed log with both old (deprecated) and new (`AgentTurn*`) events. The renderer handles both; detectors handle both; future code paths reading the log have to handle both. This is the cost of replay safety.
- **Envelope version 3 is not enforced on read.** Designer's store does not currently fail closed on unknown envelope versions. A pre-Phase-24 binary opening a post-Phase-24 event log will silently miss `AgentTurn*` payloads. Filed as a follow-up: add envelope-version enforcement at decode time.

### Performance + size

The new variants are similar in size to the deprecated ones (UUIDs, strings, small enums). No measurable impact on event-log growth rate. The transient renderer-side projection allocates one `AgentTurn*` shape per legacy event; for typical chat depths (≤500 events per workspace) this is sub-millisecond on app boot.

## Migration plan (operational)

This ADR is the contract; the migration is the Phase 24 implementation workspace's job. Sequence:

1. Add the new variants to `EventPayload` (additive). Land as part of Phase 24 PR or as a separate prep PR.
2. Add `#[deprecated]` annotations to the affected variant cases. Suppress deprecation warnings at the decode path with `#[allow(deprecated)]` so legacy events still deserialize without compiler noise.
3. Bump `EventEnvelope` version constant from 2 to 3.
4. Add the renderer-side projection module + acceptance test for the legacy → new projection.
5. Update each detector with the new pattern arm + shared helper.
6. Stop emitting deprecated variants from the post-Phase-24 reader loop.
7. Verify `cargo test --workspace` and frontend tests pass against a fixture log containing both old and new shapes.

A pre-Phase-24 dogfood event log + a post-Phase-24 dogfood event log become the regression fixtures; both must render identically before and after the switch.

## Open follow-up

- **Envelope-version enforcement at read time.** Designer's store should refuse to decode envelopes whose version exceeds the binary's known max. This isn't critical for Phase 24 (the variant-driven decode is forward-compatible by construction; pre-Phase-24 binaries gracefully see unknown variants as a deserialize error), but it is a hardening item worth scheduling.
- **Deletion of the renderer projection.** Track usage of the projection code path via a one-line counter; delete the module when the counter shows zero hits over a 30-day window.

## References

- `core-docs/phase-24-pass-through-chat.md` (the spec)
- `core-docs/adr/0002-v1-scoping-decisions.md` §"Addendum (2026-04-26): additive `EventPayload` extensions"
- `core-docs/adr/0007-single-claude-subprocess.md` (per-tab subprocess context)
- 13.L precedent: `crates/designer-core/src/event.rs:308–356` (legacy `FrictionLinked` decode + `version: 2` records)
- Anthropic Messages API stream-json reference (consulted for §2.2 of the spec)
