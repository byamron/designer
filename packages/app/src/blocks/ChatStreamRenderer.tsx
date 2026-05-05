// Phase 24 (ADR 0008) — Chat thread renderer for show_chat_v2 mode.
//
// Reads the per-tab chat reducer (chatThreadStore) and renders turns
// + user messages in arrival order. Replaces the legacy artifact-list
// path inside WorkspaceThread when the flag is on. Falls back to the
// legacy renderer when the flag is off.
//
// Block-level components live in this file (TextBlock, ToolUseBlock,
// ThinkingBlock, InterruptedMarker, LegacyChatBanner). Keeping them
// co-located until the surface stabilizes; once dogfood validates the
// shapes, they can split into sibling files alongside blocks.tsx.

import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  applyStreamEvent,
  isCurrentTurnOpen,
  subprocessKey,
  type BlockAccumulator,
  type ChatThreadRow,
  type ChatThreadState,
  type TurnAccumulator,
  useChatThreadState,
} from "../store/chatThread";
import { MessageProse } from "./blocks";
import {
  isLegacyOnly,
  legacyBannerDismissKey,
  projectLegacyChat,
} from "./legacy-chat-projection";
import { useDataState } from "../store/data";
import type {
  AgentContentBlockKind,
  StreamEvent,
  TabId,
  WorkspaceId,
} from "../ipc/types";

interface ChatStreamRendererProps {
  workspaceId: WorkspaceId;
  tabId: TabId;
}

/** Top-level renderer for the new chat surface. Mounted by
 *  WorkspaceThread when `show_chat_v2` is on. */
export function ChatStreamRenderer({
  workspaceId,
  tabId,
}: ChatStreamRendererProps) {
  // Subscribe to the per-tab chat slice. The selector only fires
  // when this tab's slice changes, not on every workspace event.
  const tabState = useChatThreadState((s) => s.byTab[tabId]);
  // Subprocess-running flag for this (workspace, tab). Drives the
  // activity indicator and the post-conversation idle copy.
  const subprocessRunning = useChatThreadState((s) =>
    s.runningSubprocesses.has(subprocessKey(workspaceId, tabId)),
  );

  // Mixed-mode hook: if there are no native AgentTurn* events in the
  // tab yet (legacy-only conversation), pull the legacy events out
  // of dataStore and run them through the projection. Mixed-mode
  // conversations skip projection because the live reducer already
  // has the post-flag-flip events.
  const events = useDataState((s) => s.events);
  const projected = useMemo(() => {
    if (!tabState || tabState.row_order.length === 0) {
      // Empty tab from the reducer's perspective. If the persisted
      // event log has chat-relevant rows for this tab, project them
      // and fold into a derived state for display only. We don't
      // mutate the store — the store stays the live truth.
      const tabEvents = events.filter((e) => {
        const p = e.payload as { tab_id?: TabId } | undefined;
        return p?.tab_id === tabId;
      });
      if (tabEvents.length === 0) return null;
      const synthetic = projectLegacyChat(tabEvents, tabId);
      return foldEventsIntoTab(synthetic, workspaceId, tabId);
    }
    return null;
  }, [events, tabState, tabId, workspaceId]);

  const display = tabState ?? projected ?? null;
  const showBanner = useLegacyBannerVisibility(workspaceId, tabId, events);

  if (!display || display.row_order.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="thread__stream" data-component="ChatStreamRenderer">
      {showBanner && (
        <LegacyChatBanner workspaceId={workspaceId} tabId={tabId} />
      )}
      {display.row_order.map((row, idx) => (
        <ChatThreadRowView
          key={rowKey(row, idx)}
          row={row}
          state={display}
        />
      ))}
      {/* Idle copy: turn ended cleanly and no subprocess running →
          gentle "send a follow-up" prompt. */}
      {!subprocessRunning && !isCurrentTurnOpen(display) &&
        display.row_order.length > 0 && <IdlePrompt />}
    </div>
  );
}

function rowKey(row: ChatThreadRow, idx: number): string {
  return row.kind === "turn"
    ? `t:${row.turn_id}`
    : `u:${row.event_id}:${idx}`;
}

function ChatThreadRowView({
  row,
  state,
}: {
  row: ChatThreadRow;
  state: ChatThreadState;
}) {
  if (row.kind === "user_message") {
    const msg = state.user_messages[row.event_id];
    if (!msg) return null;
    return <UserMessageRow body={msg.body} />;
  }
  const turn = state.turns[row.turn_id];
  if (!turn) return null;
  return <AgentTurnRow turn={turn} />;
}

function UserMessageRow({ body }: { body: string }) {
  return (
    <div
      className="block block--message"
      data-author="you"
      data-component="UserMessageRow"
    >
      <div className="block__message-body">
        <MessageProse text={body} />
      </div>
    </div>
  );
}

function AgentTurnRow({ turn }: { turn: TurnAccumulator }) {
  return (
    <div
      className="block"
      data-author="agent"
      data-component="AgentTurnRow"
      data-turn-id={turn.turn_id}
    >
      {turn.block_order.map((idx) => {
        const block = turn.blocks[idx];
        if (!block) return null;
        return <BlockView key={idx} block={block} turn={turn} />;
      })}
      {turn.stop_reason === "interrupted" && <InterruptedMarker />}
    </div>
  );
}

function BlockView({
  block,
  turn,
}: {
  block: BlockAccumulator;
  turn: TurnAccumulator;
}) {
  const k = block.kind;
  if (k.kind === "text") return <TextBlock block={block} />;
  if (k.kind === "thinking") return <ThinkingBlock block={block} />;
  // tool_use
  return (
    <ToolUseBlock
      block={block}
      kind={k}
      toolResult={turn.tool_results[k.tool_use_id]}
    />
  );
}

// ---- TextBlock ---------------------------------------------------------

/** Streaming text. Renders raw delta as `pre-wrap` plain text while
 *  the block is open; on `ended`, swaps to MessageProse markdown
 *  rendering inside requestAnimationFrame so the parsed DOM commits
 *  in the next frame after the final delta paints (spec §5.8 UX-1). */
function TextBlock({ block }: { block: BlockAccumulator }) {
  const ended = block.ended;
  const [parsedReady, setParsedReady] = useState(false);

  useEffect(() => {
    if (!ended) {
      setParsedReady(false);
      return;
    }
    const id = requestAnimationFrame(() => setParsedReady(true));
    return () => cancelAnimationFrame(id);
  }, [ended, block.delta]);

  if (!ended || !parsedReady) {
    return (
      <div
        className="block__message-body block__message-body--streaming"
        style={{ whiteSpace: "pre-wrap", willChange: "transform" }}
      >
        {block.delta}
      </div>
    );
  }
  return (
    <div className="block__message-body">
      <MessageProse text={block.delta} />
    </div>
  );
}

// ---- ThinkingBlock -----------------------------------------------------

/** Default-collapsed disclosure with `· Thinking` label. Honors
 *  `prefers-reduced-motion` via existing CSS chevron transition. */
function ThinkingBlock({ block }: { block: BlockAccumulator }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="thinking" data-component="ThinkingBlock">
      <button
        type="button"
        className="thinking__head"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="thinking__dot" aria-hidden>
          ·
        </span>
        <span className="thinking__label">Thinking</span>
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          className="thinking__chevron"
        />
      </button>
      {expanded && (
        <div className="thinking__body" role="region" aria-label="Agent thinking">
          <pre>{block.delta}</pre>
        </div>
      )}
    </div>
  );
}

// ---- ToolUseBlock ------------------------------------------------------

/** Verb-first inline `· Read plan.md` line; expand-on-click reveals
 *  input + tool result. No IPC fetch — input lives in `block.delta`
 *  (JSON-encoded), result lives in `turn.tool_results[tool_use_id]`. */
function ToolUseBlock({
  block,
  kind,
  toolResult,
}: {
  block: BlockAccumulator;
  kind: Extract<AgentContentBlockKind, { kind: "tool_use" }>;
  toolResult: { content: string; is_error: boolean } | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const head = useMemo(
    () => parseToolHead(kind.name, block.delta),
    [kind.name, block.delta],
  );
  const isError = toolResult?.is_error === true;
  const expandable = block.delta.length > 0 || toolResult !== undefined;

  return (
    <div
      className="tool-line"
      data-component="ToolUseBlock"
      data-error={isError ? "true" : undefined}
    >
      <button
        type="button"
        className="tool-line__head"
        aria-expanded={expanded}
        disabled={!expandable}
        onClick={() => expandable && setExpanded((v) => !v)}
      >
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          className="tool-line__chevron"
        />
        <span className="tool-line__verb">{head.verb}</span>
        {head.target && <span className="tool-line__target">{head.target}</span>}
      </button>
      {expanded && (
        <div
          className="tool-line__region"
          role="region"
          aria-label={`Tool ${kind.name} details`}
          aria-live="polite"
          aria-relevant="additions"
        >
          {block.delta && (
            <div className="tool-line__panel" data-panel="input">
              <pre>{prettyJson(block.delta)}</pre>
            </div>
          )}
          {toolResult && (
            <div className="tool-line__panel" data-panel="result">
              <pre>
                {isError ? `Tool ${kind.name} failed: ` : ""}
                {toolResult.content || "(empty result)"}
              </pre>
            </div>
          )}
          {!toolResult && block.ended && (
            <div className="tool-line__panel" data-panel="result-pending">
              <span className="tool-line__muted">
                · No result captured
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ParsedToolHead {
  verb: string;
  target: string | null;
}

/** Map a tool name to a verb-first head per DP-B's microcopy. */
function parseToolHead(name: string, deltaJson: string): ParsedToolHead {
  const verbMap: Record<string, string> = {
    Read: "Read",
    Write: "Wrote",
    Edit: "Edited",
    MultiEdit: "Edited",
    NotebookEdit: "Edited",
    Glob: "Searched files",
    Grep: "Searched",
    Bash: "Ran",
  };
  const verb = verbMap[name] ?? `Used ${name}`;
  const target = pickTarget(name, deltaJson);
  return { verb, target };
}

/** Best-effort extraction of the first input field for the head's
 *  target text. Tolerant of partial JSON during streaming — falls
 *  back to a regex scan if JSON.parse fails. */
function pickTarget(name: string, deltaJson: string): string | null {
  if (!deltaJson) return null;
  const fields: Record<string, string[]> = {
    Read: ["file_path", "path"],
    Write: ["file_path"],
    Edit: ["file_path"],
    MultiEdit: ["file_path"],
    NotebookEdit: ["file_path"],
    Glob: ["pattern", "file_path"],
    Grep: ["pattern"],
    Bash: ["command"],
  };
  const keys = fields[name] ?? [];
  // Try strict JSON first.
  try {
    const obj = JSON.parse(deltaJson) as Record<string, unknown>;
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.length > 0) return basenameOrFull(name, v);
    }
  } catch {
    /* partial JSON — fall through */
  }
  // Tolerant regex scan for a first matching key.
  for (const k of keys) {
    const re = new RegExp(`"${k}"\\s*:\\s*"([^"]*)`);
    const m = deltaJson.match(re);
    if (m && m[1].length > 0) return basenameOrFull(name, m[1]);
  }
  return null;
}

function basenameOrFull(name: string, value: string): string {
  // Show basename for FS tools so "Read plan.md" stays terse.
  if (
    name === "Read" ||
    name === "Write" ||
    name === "Edit" ||
    name === "MultiEdit" ||
    name === "NotebookEdit"
  ) {
    const slash = value.lastIndexOf("/");
    return slash >= 0 ? value.slice(slash + 1) : value;
  }
  // Bash: first word of the command.
  if (name === "Bash") {
    const sp = value.indexOf(" ");
    return sp > 0 ? value.slice(0, sp) : value;
  }
  return value;
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// ---- InterruptedMarker -------------------------------------------------

function InterruptedMarker() {
  return (
    <div
      className="thread__interrupted-marker"
      data-component="InterruptedMarker"
      role="status"
    >
      <span className="thread__interrupted-marker-text">Interrupted</span>
    </div>
  );
}

// ---- LegacyChatBanner --------------------------------------------------

interface LegacyChatBannerProps {
  workspaceId: WorkspaceId;
  tabId: TabId;
}

function LegacyChatBanner({ workspaceId, tabId }: LegacyChatBannerProps) {
  const dismissKey = legacyBannerDismissKey(workspaceId, tabId);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissKey) === "1";
    } catch {
      return false;
    }
  });
  if (dismissed) return null;
  const onDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey, "1");
    } catch {
      /* localStorage unavailable; one-shot dismissal in-memory */
    }
  };
  return (
    <div
      className="thread__legacy-banner"
      data-component="LegacyChatBanner"
      role="status"
    >
      <span className="thread__legacy-banner-text">
        Imported from earlier version — turn boundaries may be approximate.
      </span>
      <button
        type="button"
        className="thread__legacy-banner-dismiss"
        aria-label="Dismiss imported-chat banner"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

function useLegacyBannerVisibility(
  _workspaceId: WorkspaceId,
  tabId: TabId,
  events: StreamEvent[],
): boolean {
  return useMemo(() => {
    const tabEvents = events.filter((e) => {
      const p = e.payload as { tab_id?: TabId } | undefined;
      return p?.tab_id === tabId;
    });
    return isLegacyOnly(tabEvents);
  }, [events, tabId]);
}

// ---- Empty + idle states ----------------------------------------------

function EmptyState() {
  return (
    <div className="thread__empty" role="status" data-component="EmptyState">
      <span className="thread__empty-text">Start by asking something.</span>
    </div>
  );
}

function IdlePrompt() {
  return (
    <div className="thread__idle" role="status" data-component="IdlePrompt">
      <span className="thread__idle-text">Send a follow-up.</span>
    </div>
  );
}

// ---- Helpers -----------------------------------------------------------

/** Fold a list of (synthetic or live) events into a single
 *  ChatThreadState for one tab. Used by the legacy-only projection
 *  branch in `ChatStreamRenderer` so display works without going
 *  through the live store. */
function foldEventsIntoTab(
  events: StreamEvent[],
  _workspaceId: WorkspaceId,
  tabId: TabId,
): ChatThreadState {
  // Build a fresh store so the live chatThreadStore isn't mutated.
  let temp: {
    byTab: Record<TabId, ChatThreadState>;
    runningSubprocesses: Set<string>;
  } = {
    byTab: {},
    runningSubprocesses: new Set(),
  };
  for (const event of events) {
    temp = applyStreamEvent(temp, event);
  }
  return temp.byTab[tabId] ?? { row_order: [], turns: {}, user_messages: {} };
}
