// Phase 24 (ADR 0008) — per-tab chat thread reducer.
//
// Holds the live AgentTurn* projection: in-flight turn accumulators,
// per-block streaming deltas, tool-result correlation, and arrival-
// order interleaving with user `MessagePosted` events. Replaces the
// "scroll the artifact list" mental model with "fold a typed event
// stream into a per-tab thread."
//
// Why a separate slice (not a field on `dataStore`):
// - The chat fold is much hotter than the rest of the data state
//   (one update per token-delta, vs. one per artifact). Isolating it
//   means selectors elsewhere don't re-run on every delta.
// - Boot replay walks `dataStore.events` and folds into here in one
//   pass; live deltas append via the same reducer.
// - Tests can prime per-tab state without bringing up the full data
//   store.

import { createStore, useStore } from "./index";
import type {
  AgentContentBlockKind,
  AgentStopReason,
  AgentTurnPayload,
  ClaudeMessageId,
  ClaudeSessionId,
  EventId,
  StreamEvent,
  TabId,
  TeamLifecycle,
  TokenUsage,
  WorkspaceId,
} from "../ipc/types";
import { AGENT_TURN_KINDS, asAgentTurnPayload } from "../ipc/types";

/** Per-block accumulator inside an open turn. */
export interface BlockAccumulator {
  block_index: number;
  kind: AgentContentBlockKind;
  /** Raw concatenated deltas. For `text` blocks the renderer streams
   *  this verbatim until `ended`, then re-parses through markdown.
   *  For `tool_use` blocks this is the JSON-encoded input (possibly
   *  partial during streaming). For `thinking` blocks it's the raw
   *  thinking text. */
  delta: string;
  /** Flips on `agent_content_block_ended`. The renderer reads this
   *  to decide whether to re-render markdown for text blocks. */
  ended: boolean;
}

/** Per-turn accumulator. `turn_id` is Claude's own message_id; we
 *  never mint these. */
export interface TurnAccumulator {
  turn_id: ClaudeMessageId;
  workspace_id: WorkspaceId;
  tab_id: TabId;
  model: string;
  parent_user_event_id: EventId;
  session_id: ClaudeSessionId;
  /** Wall-clock at `agent_turn_started`, ms-epoch. Drives the
   *  elapsed-time chip ("Working… 0:24") via `Date.now() - started_at`. */
  started_at: number;
  /** Arrival order of block_index values. The Anthropic API emits
   *  blocks in content-array order, but the renderer must not assume
   *  the array is dense — out-of-order deltas are defensively handled. */
  block_order: number[];
  blocks: Record<number, BlockAccumulator>;
  /** Tool results keyed by `tool_use_id` so the renderer correlates
   *  without scanning blocks. Out-of-turn tool_results are dropped
   *  by the reducer (see `reduceAgentTurnEvent`). */
  tool_results: Record<string, { content: string; is_error: boolean }>;
  /** `null` while the turn is open; set on `agent_turn_ended`. The
   *  renderer derives "Interrupted" UI from
   *  `(stop_reason === null && !subprocess_running)` per spec §5.2 +
   *  the boot-time orphan-turn synthesis (see `applyOrphanTurnGuard`). */
  stop_reason: AgentStopReason | null;
  usage: TokenUsage | null;
  /** True when this turn was synthesized by the legacy-event projection.
   *  Renderer suppresses live-only affordances (interrupt button,
   *  elapsed chip) for legacy turns. */
  is_legacy: boolean;
}

/** Stand-in entry for a user `MessagePosted{author: User}` so the
 *  renderer can interleave it with turns in arrival order. The full
 *  body / attachments live on the persisted artifact; the entry just
 *  pins a position in the ordering. */
export interface UserMessageEntry {
  event_id: EventId;
  body: string;
  /** Wall-clock at the user post (ms-epoch from envelope timestamp). */
  timestamp: number;
}

/** Single flat ordered row list — the renderer iterates this. Each
 *  row is either a user message or an agent turn. Other domain
 *  events (artifacts, costs, approvals) flow through their existing
 *  surfaces and don't appear here. */
export type ChatThreadRow =
  | { kind: "user_message"; event_id: EventId }
  | { kind: "turn"; turn_id: ClaudeMessageId };

export interface ChatThreadState {
  /** Arrival-order row list, append-only. The reducer pushes on
   *  `agent_turn_started` and `MessagePosted{User}`. */
  row_order: ChatThreadRow[];
  /** Per-turn state keyed by `turn_id`. Open turns have
   *  `stop_reason === null`. */
  turns: Record<ClaudeMessageId, TurnAccumulator>;
  /** User messages keyed by their persisted `event_id`. */
  user_messages: Record<EventId, UserMessageEntry>;
}

export function emptyChatThread(): ChatThreadState {
  return { row_order: [], turns: {}, user_messages: {} };
}

interface ChatThreadStore {
  /** Per-tab slice. Key is `TabId` (not the activity-style
   *  `${workspace}:${tab}` composite) — chat is tab-scoped and the
   *  workspace context lives on each turn record. */
  byTab: Record<TabId, ChatThreadState>;
  /** Set of `${workspace_id}:${tab_id}` strings whose subprocess is
   *  currently alive. Driven by `team_lifecycle` events. The
   *  render-time activity indicator's
   *  `subprocess_running(tab) && !turn_ended(tab)` reads membership
   *  here. */
  runningSubprocesses: Set<string>;
}

export const chatThreadStore = createStore<ChatThreadStore>({
  byTab: {},
  runningSubprocesses: new Set(),
});

export const useChatThreadState = <U,>(selector: (s: ChatThreadStore) => U) =>
  useStore(chatThreadStore, selector);

/** Build the activity-style composite key. Mirrors `data.ts`'s
 *  `activityKey` so consumers reading both stores can compare. */
export function subprocessKey(workspaceId: WorkspaceId, tabId: TabId): string {
  return `${workspaceId}:${tabId}`;
}

/** Read the most recent open turn in a tab, or `null` if no turn is
 *  open. The activity-indicator selector reads this. */
export function currentOpenTurn(
  state: ChatThreadState | undefined,
): TurnAccumulator | null {
  if (!state || state.row_order.length === 0) return null;
  // Walk the row_order tail to find the last turn entry — there can
  // be user-message entries after the last turn (e.g. the user
  // posted again after the turn ended).
  for (let i = state.row_order.length - 1; i >= 0; i--) {
    const row = state.row_order[i];
    if (row.kind === "turn") {
      const t = state.turns[row.turn_id];
      return t && t.stop_reason === null ? t : null;
    }
  }
  return null;
}

/** True iff a turn is currently open in the tab. Used by the
 *  render-time activity indicator: `subprocess_running && isCurrentTurnOpen`. */
export function isCurrentTurnOpen(state: ChatThreadState | undefined): boolean {
  return currentOpenTurn(state) !== null;
}

// ---- Reducer ---------------------------------------------------------

/** Apply one `AgentTurn*` event to the tab's chat-thread state.
 *  Pure function: returns a new `ChatThreadState`. The reducer is
 *  defensive against out-of-order delta-before-start (lazy-creates
 *  the block) and unknown turn (lazy-creates the turn) so a dropped
 *  envelope doesn't strand subsequent ones. */
export function reduceAgentTurnEvent(
  state: ChatThreadState,
  payload: AgentTurnPayload,
  envelopeTimestampMs: number,
): ChatThreadState {
  switch (payload.kind) {
    case "agent_turn_started": {
      // Idempotent: if turn_id already present (replay), no-op.
      if (state.turns[payload.turn_id]) return state;
      const turn: TurnAccumulator = {
        turn_id: payload.turn_id,
        workspace_id: payload.workspace_id,
        tab_id: payload.tab_id,
        model: payload.model,
        parent_user_event_id: payload.parent_user_event_id,
        session_id: payload.session_id,
        started_at: envelopeTimestampMs,
        block_order: [],
        blocks: {},
        tool_results: {},
        stop_reason: null,
        usage: null,
        is_legacy: false,
      };
      return {
        ...state,
        turns: { ...state.turns, [payload.turn_id]: turn },
        row_order: [
          ...state.row_order,
          { kind: "turn", turn_id: payload.turn_id },
        ],
      };
    }
    case "agent_content_block_started": {
      const turn = state.turns[payload.turn_id] ?? lazyTurn(payload, envelopeTimestampMs);
      // Idempotent on block_index — overwriting kind on a re-emit is
      // harmless (Started can land twice if the lazy path created a
      // text-default block first).
      const block: BlockAccumulator = {
        block_index: payload.block_index,
        kind: payload.block_kind,
        delta: turn.blocks[payload.block_index]?.delta ?? "",
        ended: turn.blocks[payload.block_index]?.ended ?? false,
      };
      const next: TurnAccumulator = {
        ...turn,
        blocks: { ...turn.blocks, [payload.block_index]: block },
        block_order: turn.block_order.includes(payload.block_index)
          ? turn.block_order
          : [...turn.block_order, payload.block_index],
      };
      return updateTurn(state, payload.turn_id, next, envelopeTimestampMs);
    }
    case "agent_content_block_delta": {
      const turn = state.turns[payload.turn_id] ?? lazyTurn(payload, envelopeTimestampMs);
      const existing = turn.blocks[payload.block_index];
      const block: BlockAccumulator = existing
        ? { ...existing, delta: existing.delta + payload.delta }
        : {
            // Out-of-order: delta before Started. Default to text;
            // a later Started will overwrite the kind.
            block_index: payload.block_index,
            kind: { kind: "text" },
            delta: payload.delta,
            ended: false,
          };
      const next: TurnAccumulator = {
        ...turn,
        blocks: { ...turn.blocks, [payload.block_index]: block },
        block_order: turn.block_order.includes(payload.block_index)
          ? turn.block_order
          : [...turn.block_order, payload.block_index],
      };
      return updateTurn(state, payload.turn_id, next, envelopeTimestampMs);
    }
    case "agent_content_block_ended": {
      const turn = state.turns[payload.turn_id];
      if (!turn) return state; // can't end what isn't started; drop.
      const existing = turn.blocks[payload.block_index];
      if (!existing) return state;
      const block: BlockAccumulator = { ...existing, ended: true };
      const next: TurnAccumulator = {
        ...turn,
        blocks: { ...turn.blocks, [payload.block_index]: block },
      };
      return updateTurn(state, payload.turn_id, next, envelopeTimestampMs);
    }
    case "agent_tool_result": {
      const turn = state.turns[payload.turn_id];
      // Out-of-turn tool_result (no matching turn) — drop. With
      // stream-json discipline this shouldn't happen.
      if (!turn) return state;
      const next: TurnAccumulator = {
        ...turn,
        tool_results: {
          ...turn.tool_results,
          [payload.tool_use_id]: {
            content: payload.content,
            is_error: payload.is_error,
          },
        },
      };
      return updateTurn(state, payload.turn_id, next, envelopeTimestampMs);
    }
    case "agent_turn_ended": {
      const turn = state.turns[payload.turn_id];
      if (!turn) return state;
      const next: TurnAccumulator = {
        ...turn,
        stop_reason: payload.stop_reason,
        usage: payload.usage,
      };
      return updateTurn(state, payload.turn_id, next, envelopeTimestampMs);
    }
  }
}

function lazyTurn(
  payload: AgentTurnPayload & { workspace_id: WorkspaceId; tab_id: TabId; turn_id: ClaudeMessageId },
  envelopeTimestampMs: number,
): TurnAccumulator {
  return {
    turn_id: payload.turn_id,
    workspace_id: payload.workspace_id,
    tab_id: payload.tab_id,
    model: "",
    parent_user_event_id: "",
    session_id: "",
    started_at: envelopeTimestampMs,
    block_order: [],
    blocks: {},
    tool_results: {},
    stop_reason: null,
    usage: null,
    is_legacy: false,
  };
}

function updateTurn(
  state: ChatThreadState,
  turn_id: ClaudeMessageId,
  next: TurnAccumulator,
  _envelopeTimestampMs: number,
): ChatThreadState {
  // If the turn was lazily created (not in row_order yet), append it.
  const known = state.turns[turn_id];
  const row_order = known
    ? state.row_order
    : [...state.row_order, { kind: "turn" as const, turn_id }];
  return {
    ...state,
    turns: { ...state.turns, [turn_id]: next },
    row_order,
  };
}

/** Apply a user `MessagePosted` event to the chat thread. Called for
 *  every persisted user-author message so it interleaves with turns
 *  in arrival order (per spec §2.4). */
export function reduceUserMessage(
  state: ChatThreadState,
  event_id: EventId,
  body: string,
  timestampMs: number,
): ChatThreadState {
  // Idempotent on event_id (replay-safe).
  if (state.user_messages[event_id]) return state;
  return {
    ...state,
    user_messages: {
      ...state.user_messages,
      [event_id]: { event_id, body, timestamp: timestampMs },
    },
    row_order: [...state.row_order, { kind: "user_message", event_id }],
  };
}

// ---- Top-level dispatcher ---------------------------------------------

/** Fold one `StreamEvent` into the chat thread for its tab. Returns
 *  unchanged state when the event isn't chat-domain or has no tab
 *  binding. The data subscriber calls this for every event. */
export function applyStreamEvent(
  store: ChatThreadStore,
  event: StreamEvent,
): ChatThreadStore {
  // User messages flow through the persisted MessagePosted event.
  if (event.kind === "message_posted") {
    const payload = event.payload as
      | {
          tab_id?: TabId;
          author?: { kind: string };
          body?: string;
        }
      | undefined;
    // Only `Actor::User`-authored MessagePosted events become rows
    // in the chat thread. Agent-authored ones are legacy and project
    // through legacy-chat-projection separately.
    if (
      !payload ||
      !payload.tab_id ||
      payload.author?.kind !== "user" ||
      typeof payload.body !== "string"
    ) {
      return store;
    }
    const tabId = payload.tab_id;
    const tabState = store.byTab[tabId] ?? emptyChatThread();
    const eventId = (event as { id?: EventId }).id ?? `${event.stream_id}:${event.sequence}`;
    const ts = Date.parse(event.timestamp);
    return {
      ...store,
      byTab: {
        ...store.byTab,
        [tabId]: reduceUserMessage(
          tabState,
          eventId,
          payload.body,
          Number.isFinite(ts) ? ts : Date.now(),
        ),
      },
    };
  }

  const turnPayload = asAgentTurnPayload(event);
  if (turnPayload) {
    const tabId = turnPayload.tab_id;
    const tabState = store.byTab[tabId] ?? emptyChatThread();
    const ts = Date.parse(event.timestamp);
    const next = reduceAgentTurnEvent(
      tabState,
      turnPayload,
      Number.isFinite(ts) ? ts : Date.now(),
    );
    // No-op: reducer dropped the event (e.g. orphan tool_result with
    // no matching turn). Don't materialize an empty tab entry — the
    // store should look identical to "the event never landed."
    if (next === tabState) return store;
    return {
      ...store,
      byTab: { ...store.byTab, [tabId]: next },
    };
  }

  return store;
}

/** Apply a `TeamLifecycle` event to the running-subprocess set. */
export function applyTeamLifecycle(
  store: ChatThreadStore,
  event: TeamLifecycle,
): ChatThreadStore {
  const key = subprocessKey(event.workspace_id, event.tab_id);
  const next = new Set(store.runningSubprocesses);
  if (event.kind === "ready") {
    next.add(key);
  } else {
    next.delete(key);
  }
  return { ...store, runningSubprocesses: next };
}

// ---- Boot replay + orphan-turn synthesis ------------------------------

/** Walk a chronological event stream, folding chat-domain events
 *  into a fresh `ChatThreadStore`. Used at boot to rebuild the
 *  thread from the persisted log without going through the live
 *  subscriber. */
export function buildChatThreadFromEvents(
  events: StreamEvent[],
): ChatThreadStore {
  let store: ChatThreadStore = {
    byTab: {},
    runningSubprocesses: new Set(),
  };
  for (const event of events) {
    if (
      event.kind === "message_posted" ||
      AGENT_TURN_KINDS.has(event.kind)
    ) {
      store = applyStreamEvent(store, event);
    }
  }
  return store;
}

/** Phase 24 §4.2 + spec A2 — for each tab, if the most recent turn
 *  has no `stop_reason` AND no live subprocess, synthesize an
 *  `Interrupted` stop_reason at the renderer level only. We do NOT
 *  write back to the event log; the subprocess died without an
 *  AgentTurnEnded and the renderer treats subprocess-EOF as an
 *  implicit end-of-turn. Run after `applyTeamLifecycle` events have
 *  populated `runningSubprocesses`.
 *
 *  Mutates a copy and returns it; pure. */
export function applyOrphanTurnGuard(store: ChatThreadStore): ChatThreadStore {
  let mutated: ChatThreadStore | null = null;
  for (const [tabId, tabState] of Object.entries(store.byTab)) {
    const open = currentOpenTurn(tabState);
    if (!open) continue;
    const key = subprocessKey(open.workspace_id, tabId as TabId);
    if (store.runningSubprocesses.has(key)) continue;
    // Orphan turn — synthesize Interrupted.
    if (!mutated) mutated = { ...store, byTab: { ...store.byTab } };
    mutated.byTab[tabId] = {
      ...tabState,
      turns: {
        ...tabState.turns,
        [open.turn_id]: { ...open, stop_reason: "interrupted" },
      },
    };
  }
  return mutated ?? store;
}
