// Phase 24 (ADR 0008) §4 — render-only projection of legacy chat
// events into synthetic `AgentTurn*` shapes.
//
// Replay safety: dogfood machines have months of legacy chat logs
// (`MessagePosted{author_role: AGENT|TEAM_LEAD}` +
// `ArtifactCreated{kind: Report, author_role: agent|workspace-lead}` +
// `ArtifactUpdated`). The renderer-side legacy projection translates
// those into the `AgentTurn*` shape so the same renderer can display
// both legacy and post-Phase-24 conversations. The projection runs
// at read time only — it never writes back to the event log.
//
// Algorithm overview:
//   - Walk events in chronological order (StreamEvent.sequence asc).
//   - Maintain a `currentTurn` accumulator per tab; open it on the
//     first agent-authored event after a user message; close it on
//     the next user message or on end-of-input.
//   - Each agent `MessagePosted` becomes a synthetic Text block.
//   - Each agent `ArtifactCreated{kind: Report}` whose title parses as
//     "Used <Tool> <target>" or similar becomes a synthetic
//     ToolUse block.
//   - Each `ArtifactUpdated` on the producing artifact becomes a
//     synthetic AgentToolResult.
//   - On turn close, emit a synthetic `AgentTurnEnded{stop_reason:
//     end_turn}`.
//
// Determinism: synthetic `turn_id` values are prefixed `legacy_<seq>_`
// so the renderer can identify legacy turns and suppress live-only
// affordances (interrupt, elapsed chip).

import type {
  AgentContentBlockKind,
  ArtifactId,
  EventId,
  StreamEvent,
  TabId,
  WorkspaceId,
} from "../ipc/types";
import { AGENT_TURN_KINDS } from "../ipc/types";

const AGENT_AUTHOR_ROLES = new Set(["agent", "team-lead", "workspace-lead"]);

/** Parse the verb-first title format produced by today's translator
 *  (`tool_use_card` in stream.rs) back into `{name, target}`. The
 *  legacy translator emits titles like "Read CLAUDE.md", "Wrote x.txt",
 *  "Edited src/foo.rs", "Ran git", "Searched files". */
function parseToolTitle(
  title: string,
): { name: string; tool_use_id: string } | null {
  const trimmed = title.trim();
  // Heuristic: first word is the verb. Map to a tool name. Falls
  // through to "tool" so unknown verbs still produce a usable block.
  const firstSpace = trimmed.indexOf(" ");
  const verb = firstSpace < 0 ? trimmed : trimmed.slice(0, firstSpace);
  const verbToTool: Record<string, string> = {
    Read: "Read",
    Wrote: "Write",
    Edited: "Edit",
    Ran: "Bash",
    Searched: "Grep",
    Used: trimmed.slice(5).split(" ")[0] ?? "tool", // "Used <Tool>"
  };
  const name = verbToTool[verb] ?? "tool";
  return { name, tool_use_id: `legacy_${title}` };
}

/** Internal state for the per-tab walker. */
interface TurnDraft {
  turn_id: string;
  next_block_index: number;
  /** Track `(artifact_id) -> block_index` so subsequent
   *  `ArtifactUpdated` on the same artifact projects to a synthetic
   *  AgentToolResult against the matching block's tool_use_id. */
  artifactToBlock: Map<
    ArtifactId,
    { block_index: number; tool_use_id: string }
  >;
}

/** Project a chronological event list into synthetic AgentTurn*
 *  StreamEvents for one tab. Filters in `tabId` if provided.
 *
 *  Synthetic events are returned as `StreamEvent`s so the same
 *  reducer (`applyStreamEvent`) folds them into chatThreadStore
 *  unchanged. The synthetic `kind` matches the wire kind exactly. */
export function projectLegacyChat(
  events: StreamEvent[],
  tabId?: TabId,
): StreamEvent[] {
  const result: StreamEvent[] = [];
  let currentTurn: TurnDraft | null = null;
  // Track the most recent user-message event id for `parent_user_event_id`.
  let lastUserEventId: EventId = "";
  // Synthetic-id sequence counter (suffixed onto the legacy_<…> prefix).
  let synthCounter = 0;

  // Helper: close the current turn if any, emitting a synthetic end.
  const closeTurn = (workspace_id: WorkspaceId, tab_id: TabId, ts: string, seq: number) => {
    if (!currentTurn) return;
    result.push({
      kind: "agent_turn_ended",
      stream_id: `synthetic:${tab_id}`,
      sequence: seq,
      timestamp: ts,
      payload: {
        kind: "agent_turn_ended",
        workspace_id,
        tab_id,
        turn_id: currentTurn.turn_id,
        stop_reason: "end_turn",
        usage: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },
      },
    });
    currentTurn = null;
  };

  // Helper: open a turn for the given workspace/tab if none open.
  const ensureTurn = (
    workspace_id: WorkspaceId,
    tab_id: TabId,
    ts: string,
    seq: number,
  ): TurnDraft => {
    if (currentTurn) return currentTurn;
    const turn_id = `legacy_${seq}_${synthCounter++}`;
    currentTurn = { turn_id, next_block_index: 0, artifactToBlock: new Map() };
    result.push({
      kind: "agent_turn_started",
      stream_id: `synthetic:${tab_id}`,
      sequence: seq,
      timestamp: ts,
      payload: {
        kind: "agent_turn_started",
        workspace_id,
        tab_id,
        turn_id,
        model: "legacy",
        parent_user_event_id: lastUserEventId,
        session_id: "legacy",
      },
    });
    return currentTurn;
  };

  for (const event of events) {
    // Already a native AgentTurn* event — pass through unchanged.
    // (Mixed-mode logs interleave both shapes by sequence.)
    if (AGENT_TURN_KINDS.has(event.kind)) {
      result.push(event);
      continue;
    }

    const payload = event.payload as
      | {
          tab_id?: TabId;
          workspace_id?: WorkspaceId;
          author?: { kind: string };
          author_role?: string;
          body?: string;
          artifact_kind?: string;
          title?: string;
          summary?: string;
          artifact_id?: ArtifactId;
        }
      | undefined;

    if (!payload) continue;
    if (tabId && payload.tab_id && payload.tab_id !== tabId) continue;

    if (event.kind === "message_posted") {
      // User message closes any open turn (the user-reply boundary
      // is the deterministic turn-end signal in legacy logs).
      if (payload.author?.kind === "user") {
        const tab = payload.tab_id ?? tabId;
        const ws = payload.workspace_id;
        if (tab && ws) closeTurn(ws, tab, event.timestamp, event.sequence);
        // Track for parent_user_event_id on the next opened turn.
        lastUserEventId =
          (event as { id?: EventId }).id ??
          `${event.stream_id}:${event.sequence}`;
        // We do NOT emit a synthetic user_message here — the persisted
        // MessagePosted event flows through to the live reducer
        // unchanged. Pass it through.
        result.push(event);
        continue;
      }
      // Agent message — open turn if needed, append a Text block.
      const tab = payload.tab_id;
      const ws = payload.workspace_id;
      if (!tab || !ws || typeof payload.body !== "string") continue;
      const turn = ensureTurn(ws, tab, event.timestamp, event.sequence);
      const block_index = turn.next_block_index++;
      result.push({
        kind: "agent_content_block_started",
        stream_id: `synthetic:${tab}`,
        sequence: event.sequence,
        timestamp: event.timestamp,
        payload: {
          kind: "agent_content_block_started",
          workspace_id: ws,
          tab_id: tab,
          turn_id: turn.turn_id,
          block_index,
          block_kind: { kind: "text" } as AgentContentBlockKind,
        },
      });
      result.push({
        kind: "agent_content_block_delta",
        stream_id: `synthetic:${tab}`,
        sequence: event.sequence,
        timestamp: event.timestamp,
        payload: {
          kind: "agent_content_block_delta",
          workspace_id: ws,
          tab_id: tab,
          turn_id: turn.turn_id,
          block_index,
          delta: payload.body,
        },
      });
      result.push({
        kind: "agent_content_block_ended",
        stream_id: `synthetic:${tab}`,
        sequence: event.sequence,
        timestamp: event.timestamp,
        payload: {
          kind: "agent_content_block_ended",
          workspace_id: ws,
          tab_id: tab,
          turn_id: turn.turn_id,
          block_index,
        },
      });
      continue;
    }

    if (event.kind === "artifact_created") {
      // Tool-use Reports become synthetic ToolUse blocks. Recap /
      // auditor reports stay in the spine — they were never in the
      // chat stream visually and we don't synthesize them.
      if (payload.artifact_kind !== "report") continue;
      const role = payload.author_role ?? "";
      if (!AGENT_AUTHOR_ROLES.has(role)) continue;
      const tab = payload.tab_id;
      const ws = payload.workspace_id;
      if (!tab || !ws) continue;
      const parsed = parseToolTitle(payload.title ?? "");
      if (!parsed) continue;
      const turn = ensureTurn(ws, tab, event.timestamp, event.sequence);
      const block_index = turn.next_block_index++;
      if (payload.artifact_id) {
        turn.artifactToBlock.set(payload.artifact_id, {
          block_index,
          tool_use_id: parsed.tool_use_id,
        });
      }
      result.push({
        kind: "agent_content_block_started",
        stream_id: `synthetic:${tab}`,
        sequence: event.sequence,
        timestamp: event.timestamp,
        payload: {
          kind: "agent_content_block_started",
          workspace_id: ws,
          tab_id: tab,
          turn_id: turn.turn_id,
          block_index,
          block_kind: {
            kind: "tool_use",
            name: parsed.name,
            tool_use_id: parsed.tool_use_id,
          } as AgentContentBlockKind,
        },
      });
      // Deltas: we don't have the original input; use the summary as
      // a single delta so the renderer has something to display.
      result.push({
        kind: "agent_content_block_delta",
        stream_id: `synthetic:${tab}`,
        sequence: event.sequence,
        timestamp: event.timestamp,
        payload: {
          kind: "agent_content_block_delta",
          workspace_id: ws,
          tab_id: tab,
          turn_id: turn.turn_id,
          block_index,
          delta: payload.summary ?? "",
        },
      });
      result.push({
        kind: "agent_content_block_ended",
        stream_id: `synthetic:${tab}`,
        sequence: event.sequence,
        timestamp: event.timestamp,
        payload: {
          kind: "agent_content_block_ended",
          workspace_id: ws,
          tab_id: tab,
          turn_id: turn.turn_id,
          block_index,
        },
      });
      continue;
    }

    if (event.kind === "artifact_updated") {
      // Tool-result correlation: ArtifactUpdated on a previously
      // emitted tool-use Report.
      // The closeTurn / ensureTurn closures mutate currentTurn, so
      // TS narrows the type inside this block to `never` after a
      // pass that assigned `null`. Cast explicitly to recover the
      // type — the runtime null-check guards correctness.
      const turn = currentTurn as TurnDraft | null;
      if (!turn) continue;
      const aid = payload.artifact_id;
      if (!aid) continue;
      const found = turn.artifactToBlock.get(aid);
      if (!found) continue;
      // We don't have a workspace/tab on ArtifactUpdated; carry from
      // the producing block's resolution. Best-effort — most logs
      // preserve a tab_id one level up. For now reach into the
      // tabId argument or the most recent producing event's binding.
      // The caller filters by tabId, so any binding on this event's
      // resolution is consistent.
      result.push({
        kind: "agent_tool_result",
        stream_id: event.stream_id,
        sequence: event.sequence,
        timestamp: event.timestamp,
        payload: {
          kind: "agent_tool_result",
          // Workspace/tab can be reconstructed from the most-recent
          // open turn's binding — not available here without a
          // sidecar lookup. The renderer reducer doesn't actually
          // read workspace_id on AgentToolResult, so a placeholder
          // is harmless for legacy display. Use the legacy artifact
          // id as a stable fallback.
          workspace_id: "" as WorkspaceId,
          tab_id: (tabId ?? "") as TabId,
          turn_id: turn.turn_id,
          tool_use_id: found.tool_use_id,
          content: payload.summary ?? "",
          is_error: false,
        },
      });
      continue;
    }
    // Other event kinds (artifact_pinned/unpinned/archived, friction,
    // approvals, etc.) flow through unchanged — they aren't chat-domain
    // and don't need projection.
    result.push(event);
  }

  // Close trailing turn if any.
  if (currentTurn) {
    const lastSeq =
      events.length > 0 ? events[events.length - 1].sequence + 1 : 0;
    const lastTs =
      events.length > 0
        ? events[events.length - 1].timestamp
        : new Date().toISOString();
    // Best-effort workspace/tab from the trailing draft scope.
    const lastEvent = events[events.length - 1];
    const lastPayload = lastEvent?.payload as
      | { workspace_id?: WorkspaceId; tab_id?: TabId }
      | undefined;
    const ws = lastPayload?.workspace_id ?? ("" as WorkspaceId);
    const tab = (tabId ?? lastPayload?.tab_id ?? "") as TabId;
    closeTurn(ws, tab, lastTs, lastSeq);
  }

  return result;
}

/** Detect "legacy-only conversation" — emit the dismissible
 *  "Imported from earlier version" banner only when the entire tab
 *  has no native AgentTurn* events. Mixed-mode skips the banner. */
export function isLegacyOnly(events: StreamEvent[]): boolean {
  if (events.length === 0) return false;
  return !events.some((e) => AGENT_TURN_KINDS.has(e.kind));
}

/** localStorage key for the per-tab dismissal of the legacy banner.
 *  Mirrors the per-tab pattern used elsewhere
 *  (`composerDraftByTab` etc.). */
export function legacyBannerDismissKey(
  workspaceId: WorkspaceId,
  tabId: TabId,
): string {
  return `phase24.legacyBanner.dismissed.${workspaceId}.${tabId}`;
}
