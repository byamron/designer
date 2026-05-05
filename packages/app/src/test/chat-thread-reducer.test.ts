// Phase 24 (ADR 0008) — chat-thread reducer fixture tests.
//
// Mirrors the Rust translator's §2.2 scenarios A/B/C plus replay-
// safety + orphan-turn synthesis. Lives at the data-layer altitude
// so we lock the per-tab fold against the Rust translator's
// emission pattern.

import { describe, expect, test } from "vitest";
import {
  applyOrphanTurnGuard,
  applyStreamEvent,
  applyTeamLifecycle,
  buildChatThreadFromEvents,
  currentOpenTurn,
  isCurrentTurnOpen,
  emptyChatThread,
} from "../store/chatThread";
import type { StreamEvent, TabId, WorkspaceId } from "../ipc/types";

const ws = "wks_test" as WorkspaceId;
const tab = "tab_test" as TabId;
const turn = "msg_01ABC";

function streamEvent(
  kind: string,
  payload: Record<string, unknown>,
  sequence = 1,
): StreamEvent {
  return {
    kind,
    stream_id: `workspace:${ws}`,
    sequence,
    timestamp: "2026-05-04T00:00:00.000Z",
    payload: { kind, ...payload },
  };
}

function emptyStore() {
  return { byTab: {} as Record<TabId, ReturnType<typeof emptyChatThread>>, runningSubprocesses: new Set<string>() };
}

describe("chat-thread reducer — Phase 24 §2.2 scenarios", () => {
  test("scenario A — text-only turn folds into one turn + one text block", () => {
    const events: StreamEvent[] = [
      streamEvent("agent_turn_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        model: "claude-opus-4-7",
        parent_user_event_id: "evt_user_01",
        session_id: "sess_01",
      }, 1),
      streamEvent("agent_content_block_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 0,
        block_kind: { kind: "text" },
      }, 2),
      streamEvent("agent_content_block_delta", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 0,
        delta: "Hello, ",
      }, 3),
      streamEvent("agent_content_block_delta", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 0,
        delta: "world.",
      }, 4),
      streamEvent("agent_content_block_ended", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 0,
      }, 5),
      streamEvent("agent_turn_ended", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        stop_reason: "end_turn",
        usage: { input: 12, output: 4, cache_read: 0, cache_creation: 0 },
      }, 6),
    ];

    const store = buildChatThreadFromEvents(events);
    const tabState = store.byTab[tab];
    expect(tabState).toBeDefined();
    expect(tabState.row_order).toEqual([{ kind: "turn", turn_id: turn }]);
    const t = tabState.turns[turn];
    expect(t.block_order).toEqual([0]);
    expect(t.blocks[0].kind).toEqual({ kind: "text" });
    expect(t.blocks[0].delta).toBe("Hello, world.");
    expect(t.blocks[0].ended).toBe(true);
    expect(t.stop_reason).toBe("end_turn");
    expect(t.usage?.output).toBe(4);
    expect(isCurrentTurnOpen(tabState)).toBe(false);
  });

  test("scenario B — thinking + text + tool_use blocks at distinct indices, with tool_result correlation", () => {
    const events: StreamEvent[] = [
      streamEvent("agent_turn_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        model: "claude-opus-4-7",
        parent_user_event_id: "evt_user_01",
        session_id: "sess_01",
      }, 1),
      streamEvent("agent_content_block_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 0,
        block_kind: { kind: "thinking" },
      }, 2),
      streamEvent("agent_content_block_delta", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 0,
        delta: "Reading the file…",
      }, 3),
      streamEvent("agent_content_block_ended", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 0,
      }, 4),
      streamEvent("agent_content_block_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 1,
        block_kind: { kind: "text" },
      }, 5),
      streamEvent("agent_content_block_delta", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 1,
        delta: "Let me check that.",
      }, 6),
      streamEvent("agent_content_block_ended", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 1,
      }, 7),
      streamEvent("agent_content_block_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 2,
        block_kind: {
          kind: "tool_use",
          name: "Read",
          tool_use_id: "toolu_01",
        },
      }, 8),
      streamEvent("agent_tool_result", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        tool_use_id: "toolu_01",
        content: "# Plan\n\nNear-term focus…",
        is_error: false,
      }, 9),
    ];

    const store = buildChatThreadFromEvents(events);
    const t = store.byTab[tab].turns[turn];
    expect(t.block_order).toEqual([0, 1, 2]);
    expect(t.blocks[0].kind).toEqual({ kind: "thinking" });
    expect(t.blocks[1].kind).toEqual({ kind: "text" });
    expect(t.blocks[2].kind).toMatchObject({
      kind: "tool_use",
      name: "Read",
      tool_use_id: "toolu_01",
    });
    expect(t.tool_results["toolu_01"].content).toContain("Plan");
    expect(t.tool_results["toolu_01"].is_error).toBe(false);
  });

  test("scenario C — parallel tool_use blocks; tool_results correlate by id, not array position", () => {
    const events: StreamEvent[] = [
      streamEvent("agent_turn_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        model: "claude-opus-4-7",
        parent_user_event_id: "evt_user_01",
        session_id: "sess_01",
      }, 1),
      streamEvent("agent_content_block_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 0,
        block_kind: { kind: "tool_use", name: "Read", tool_use_id: "toolu_a" },
      }, 2),
      streamEvent("agent_content_block_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 1,
        block_kind: { kind: "tool_use", name: "Read", tool_use_id: "toolu_b" },
      }, 3),
      // Tool results arrive in reverse order — correlation is by id.
      streamEvent("agent_tool_result", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        tool_use_id: "toolu_b",
        content: "B body",
        is_error: false,
      }, 4),
      streamEvent("agent_tool_result", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        tool_use_id: "toolu_a",
        content: "A body",
        is_error: true,
      }, 5),
    ];

    const t = buildChatThreadFromEvents(events).byTab[tab].turns[turn];
    expect(t.tool_results["toolu_a"].content).toBe("A body");
    expect(t.tool_results["toolu_a"].is_error).toBe(true);
    expect(t.tool_results["toolu_b"].content).toBe("B body");
  });
});

describe("chat-thread reducer — defensive paths", () => {
  test("idempotent on duplicate AgentTurnStarted (replay-safe)", () => {
    const start = streamEvent("agent_turn_started", {
      workspace_id: ws,
      tab_id: tab,
      turn_id: turn,
      model: "x",
      parent_user_event_id: "evt",
      session_id: "s",
    }, 1);
    const after1 = applyStreamEvent(emptyStore(), start);
    const after2 = applyStreamEvent(after1, start);
    expect(after2.byTab[tab].row_order.length).toBe(1);
    expect(after2.byTab[tab].turns[turn]).toBe(after1.byTab[tab].turns[turn]);
  });

  test("delta-before-started lazy-creates a text block (defensive)", () => {
    const events: StreamEvent[] = [
      streamEvent("agent_turn_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        model: "x",
        parent_user_event_id: "evt",
        session_id: "s",
      }, 1),
      // Delta arrives before Started — out-of-order shouldn't strand
      // the rest of the turn.
      streamEvent("agent_content_block_delta", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 0,
        delta: "early",
      }, 2),
      streamEvent("agent_content_block_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 0,
        block_kind: { kind: "text" },
      }, 3),
    ];
    const t = buildChatThreadFromEvents(events).byTab[tab].turns[turn];
    expect(t.blocks[0].delta).toBe("early");
    expect(t.blocks[0].kind).toEqual({ kind: "text" });
  });

  test("tool_result for unknown turn drops silently", () => {
    const result = applyStreamEvent(
      emptyStore(),
      streamEvent("agent_tool_result", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: "msg_ghost",
        tool_use_id: "toolu_x",
        content: "orphaned",
        is_error: false,
      }),
    );
    expect(result.byTab[tab]).toBeUndefined();
  });
});

describe("chat-thread reducer — orphan-turn guard (A2)", () => {
  test("turn open + no live subprocess synthesizes Interrupted at boot", () => {
    const events: StreamEvent[] = [
      streamEvent("agent_turn_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        model: "x",
        parent_user_event_id: "evt",
        session_id: "s",
      }, 1),
      streamEvent("agent_content_block_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 0,
        block_kind: { kind: "text" },
      }, 2),
      streamEvent("agent_content_block_delta", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        block_index: 0,
        delta: "partial",
      }, 3),
      // No agent_turn_ended; subprocess died here.
    ];
    const store = buildChatThreadFromEvents(events);
    expect(store.byTab[tab].turns[turn].stop_reason).toBeNull();
    // No team-lifecycle events fed in → runningSubprocesses is empty
    // → orphan guard synthesizes Interrupted.
    const guarded = applyOrphanTurnGuard(store);
    expect(guarded.byTab[tab].turns[turn].stop_reason).toBe("interrupted");
  });

  test("orphan guard is a no-op when subprocess is live", () => {
    const events: StreamEvent[] = [
      streamEvent("agent_turn_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: turn,
        model: "x",
        parent_user_event_id: "evt",
        session_id: "s",
      }, 1),
    ];
    let store = buildChatThreadFromEvents(events);
    store = applyTeamLifecycle(store, {
      kind: "ready",
      workspace_id: ws,
      tab_id: tab,
    });
    const guarded = applyOrphanTurnGuard(store);
    expect(guarded.byTab[tab].turns[turn].stop_reason).toBeNull();
    expect(currentOpenTurn(guarded.byTab[tab])).not.toBeNull();
  });
});

describe("chat-thread reducer — user message interleaving", () => {
  test("user MessagePosted lands in row_order between turns (arrival order)", () => {
    const events: StreamEvent[] = [
      streamEvent("agent_turn_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: "msg_01",
        model: "x",
        parent_user_event_id: "evt_pre",
        session_id: "s",
      }, 1),
      streamEvent("agent_turn_ended", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: "msg_01",
        stop_reason: "end_turn",
        usage: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },
      }, 2),
      // Stamp an `id` on this StreamEvent so the reducer captures it.
      {
        ...streamEvent("message_posted", {
          workspace_id: ws,
          tab_id: tab,
          author: { kind: "user" },
          body: "follow-up question",
        }, 3),
        id: "evt_user_2" as unknown as string,
      } as StreamEvent,
      streamEvent("agent_turn_started", {
        workspace_id: ws,
        tab_id: tab,
        turn_id: "msg_02",
        model: "x",
        parent_user_event_id: "evt_user_2",
        session_id: "s",
      }, 4),
    ];
    const store = buildChatThreadFromEvents(events);
    const ts = store.byTab[tab];
    expect(ts.row_order.map((r) => r.kind)).toEqual([
      "turn",
      "user_message",
      "turn",
    ]);
    expect(ts.user_messages["evt_user_2"]?.body).toBe("follow-up question");
  });
});
