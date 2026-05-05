// Phase 24 (ADR 0008) §4 — render-only legacy-event projection
// fixtures. The projector at packages/app/src/blocks/legacy-chat-
// projection.ts walks chronological events from pre-Phase-24 logs and
// emits synthetic AgentTurn* StreamEvents for the new renderer to
// fold. These tests pin the per-pattern transformations so a
// regression in the projector doesn't silently break replay safety
// for dogfood machines with historical chat.

import { describe, expect, test } from "vitest";
import {
  isLegacyOnly,
  legacyBannerDismissKey,
  projectLegacyChat,
} from "../blocks/legacy-chat-projection";
import type { StreamEvent, TabId, WorkspaceId } from "../ipc/types";

const ws = "wks_legacy" as WorkspaceId;
const tab = "tab_legacy" as TabId;

function event(
  kind: string,
  sequence: number,
  payload: Record<string, unknown>,
  extra: Partial<StreamEvent> = {},
): StreamEvent {
  return {
    kind,
    stream_id: `workspace:${ws}`,
    sequence,
    timestamp: `2026-04-01T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload: { kind, ...payload },
    ...extra,
  };
}

describe("legacy-chat-projection", () => {
  test("agent MessagePosted folds into one Text-block trio", () => {
    const events = [
      event("message_posted", 1, {
        workspace_id: ws,
        tab_id: tab,
        author: { kind: "agent", role: "assistant", team: "workspace-lead" },
        author_role: "agent",
        body: "Hello, world.",
      }),
    ];
    const out = projectLegacyChat(events, tab);
    // Started + Delta + Ended trio per agent message.
    expect(out.map((e) => e.kind)).toEqual([
      "agent_turn_started",
      "agent_content_block_started",
      "agent_content_block_delta",
      "agent_content_block_ended",
      "agent_turn_ended",
    ]);
    const startPayload = out[0].payload as { turn_id: string; model: string };
    expect(startPayload.turn_id).toMatch(/^legacy_/);
    expect(startPayload.model).toBe("legacy");
    const deltaPayload = out[2].payload as { delta: string };
    expect(deltaPayload.delta).toBe("Hello, world.");
  });

  test("user message between agent messages closes the prior turn", () => {
    const events = [
      event("message_posted", 1, {
        workspace_id: ws,
        tab_id: tab,
        author: { kind: "agent", role: "assistant" },
        author_role: "agent",
        body: "First reply.",
      }),
      // User message — the deterministic turn-end signal in legacy logs.
      {
        ...event("message_posted", 2, {
          workspace_id: ws,
          tab_id: tab,
          author: { kind: "user" },
          body: "Follow up.",
        }),
        id: "evt_user_2" as unknown as string,
      } as StreamEvent,
      event("message_posted", 3, {
        workspace_id: ws,
        tab_id: tab,
        author: { kind: "agent", role: "assistant" },
        author_role: "agent",
        body: "Second reply.",
      }),
    ];
    const out = projectLegacyChat(events, tab);
    const ends = out.filter((e) => e.kind === "agent_turn_ended");
    expect(ends.length).toBe(2); // two synthesized turn-ends, one per agent run
    // Pass-through user message lands in the output unchanged.
    const userMsg = out.find(
      (e) =>
        e.kind === "message_posted" &&
        (e.payload as { author?: { kind?: string } })?.author?.kind === "user",
    );
    expect(userMsg).toBeDefined();
    // Two distinct turn_ids — the prior turn closed before the second
    // agent message opened a new one.
    const startEvents = out.filter((e) => e.kind === "agent_turn_started");
    expect(startEvents.length).toBe(2);
    const ids = new Set(
      startEvents.map((e) => (e.payload as { turn_id: string }).turn_id),
    );
    expect(ids.size).toBe(2);
  });

  test("Report ArtifactCreated projects to a synthetic ToolUse block", () => {
    const events = [
      event("message_posted", 1, {
        workspace_id: ws,
        tab_id: tab,
        author: { kind: "agent", role: "assistant" },
        author_role: "agent",
        body: "Reading.",
      }),
      event("artifact_created", 2, {
        workspace_id: ws,
        tab_id: tab,
        artifact_kind: "report",
        author_role: "agent",
        artifact_id: "art_tool_1",
        title: "Read plan.md",
        summary: "412 lines",
      }),
    ];
    const out = projectLegacyChat(events, tab);
    const blockStart = out.find(
      (e) =>
        e.kind === "agent_content_block_started" &&
        ((e.payload as { block_kind?: { kind?: string } }).block_kind?.kind ??
          "") === "tool_use",
    );
    expect(blockStart).toBeDefined();
    const blockKind = (blockStart!.payload as {
      block_kind: { kind: string; name: string; tool_use_id: string };
    }).block_kind;
    expect(blockKind.name).toBe("Read");
    expect(blockKind.tool_use_id).toMatch(/^legacy_/);
  });

  test("ArtifactUpdated on a tool-use Report projects to AgentToolResult", () => {
    const events = [
      event("message_posted", 1, {
        workspace_id: ws,
        tab_id: tab,
        author: { kind: "agent", role: "assistant" },
        author_role: "agent",
        body: "Running tool.",
      }),
      event("artifact_created", 2, {
        workspace_id: ws,
        tab_id: tab,
        artifact_kind: "report",
        author_role: "agent",
        artifact_id: "art_tool_42",
        title: "Read foo.txt",
        summary: "stub",
      }),
      event("artifact_updated", 3, {
        artifact_id: "art_tool_42",
        summary: "<file contents>",
      }),
    ];
    const out = projectLegacyChat(events, tab);
    const result = out.find((e) => e.kind === "agent_tool_result");
    expect(result).toBeDefined();
    const payload = result!.payload as {
      tool_use_id: string;
      content: string;
      is_error: boolean;
    };
    expect(payload.tool_use_id).toMatch(/^legacy_/);
    expect(payload.content).toBe("<file contents>");
    expect(payload.is_error).toBe(false);
  });

  test("native AgentTurn* events pass through unchanged (mixed-mode)", () => {
    const events = [
      event("message_posted", 1, {
        workspace_id: ws,
        tab_id: tab,
        author: { kind: "agent" },
        author_role: "agent",
        body: "Legacy message.",
      }),
      // Native event — should pass through untouched.
      event("agent_turn_started", 2, {
        workspace_id: ws,
        tab_id: tab,
        turn_id: "msg_native",
        model: "claude-opus-4-7",
        parent_user_event_id: "evt_user",
        session_id: "sess_01",
      }),
    ];
    const out = projectLegacyChat(events, tab);
    const native = out.find(
      (e) =>
        e.kind === "agent_turn_started" &&
        (e.payload as { turn_id: string }).turn_id === "msg_native",
    );
    expect(native).toBeDefined();
  });

  test("isLegacyOnly distinguishes pure-legacy from mixed conversations", () => {
    const legacy = [
      event("message_posted", 1, {
        author: { kind: "agent" },
        author_role: "agent",
        body: "x",
      }),
      event("artifact_created", 2, { artifact_kind: "report" }),
    ];
    expect(isLegacyOnly(legacy)).toBe(true);

    const mixed = [
      ...legacy,
      event("agent_turn_started", 3, {
        workspace_id: ws,
        tab_id: tab,
        turn_id: "msg_01",
        model: "x",
        parent_user_event_id: "evt",
        session_id: "s",
      }),
    ];
    expect(isLegacyOnly(mixed)).toBe(false);

    // Empty conversation: isLegacyOnly is false (no banner needed).
    expect(isLegacyOnly([])).toBe(false);
  });

  test("legacyBannerDismissKey is per-(workspace, tab)", () => {
    const a = legacyBannerDismissKey("ws_a" as WorkspaceId, "tab_x" as TabId);
    const b = legacyBannerDismissKey("ws_a" as WorkspaceId, "tab_y" as TabId);
    const c = legacyBannerDismissKey("ws_b" as WorkspaceId, "tab_x" as TabId);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });
});
