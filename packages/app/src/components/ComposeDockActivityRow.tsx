import { useEffect, useState } from "react";
import { ChevronRight, StopCircle } from "lucide-react";
import { activityKey, useDataState } from "../store/data";
import {
  currentOpenTurn,
  subprocessKey,
  useChatThreadState,
} from "../store/chatThread";
import { useFlag } from "../store/flags";
import { ipcClient } from "../ipc/client";
import type { TabId, WorkspaceId } from "../ipc/types";

/**
 * Phase 23.B — pinned status row above the compose textarea. Reads
 * the per-tab activity slice and renders three states:
 *
 *   - `idle`               → renders nothing (the row hides)
 *   - `working`            → "Working… {MM:SS|H:MM:SS}" with a pulsing dot
 *                            and a Stop button that fires `interruptTurn`
 *   - `awaiting_approval`  → "Approve to continue" with a chevron
 *
 * The Rust enum names (`ActivityState::Working` …) are deliberately
 * kept off the user-facing surface — copy lives here, not in
 * `designer-ipc`.
 *
 * The elapsed counter ticks every second via `setInterval`. The
 * counter is keyed off the slice's `since_ms` so a state edge restarts
 * it from 0; a no-op same-state event from the orchestrator does NOT
 * change `since_ms` (Rust translator suppresses no-op transitions),
 * so the counter keeps incrementing through bursty stream events.
 *
 * Phase 23.F — Stop affordance. The button only renders when
 * `state === "working"` (no-op for `awaiting_approval`, where the
 * recovery path is the inbox decision, not an interrupt). Click
 * dispatches `interruptTurn` and optimistically hides the row; the
 * authoritative `ActivityChanged{Idle}` arriving over the activity
 * stream is what actually clears the slice in the data store, and the
 * optimistic flag resets on the next state edge so a stale "stopped"
 * doesn't suppress a later `Working` for the same tab.
 *
 * **A11y**: the live region wraps only the *label* ("Working…" /
 * "Approve to continue") — never the elapsed counter. A naive
 * `aria-live="polite"` on the outer container would re-announce the
 * full string every time the elapsed span ticks (every second), which
 * is the screen-reader equivalent of a robotic stopwatch and violates
 * Designer's calm-by-default axiom. The counter is `aria-hidden` so
 * AT users hear "Working…" once on the state edge and the visible
 * elapsed display is a sighted-user affordance only. The Stop button
 * lives in the natural tab-order *after* the live label so a
 * keyboard user advancing from the composer textarea reads the
 * status, then lands on the actionable control.
 */
export function ComposeDockActivityRow({
  workspaceId,
  tabId,
}: {
  workspaceId: WorkspaceId;
  tabId: TabId | null | undefined;
}) {
  const showChatV2 = useFlag("show_chat_v2");

  // Phase 24 (ADR 0008) — render-time observable. The indicator is
  // shown when `subprocess_running(tab) && !turn_ended_for_current_turn(tab)`
  // (spec §5.2). `subprocess_running` derives from
  // chatThreadStore.runningSubprocesses (driven by team-lifecycle
  // edges); turn_open derives from currentOpenTurn(tabState). The
  // elapsed chip reads `started_at` from the open turn (envelope
  // timestamp captured by the reducer).
  const phase24Open = useChatThreadState((s) => {
    if (!showChatV2 || !tabId) return null;
    const tabState = s.byTab[tabId];
    const open = currentOpenTurn(tabState);
    if (!open) return null;
    if (!s.runningSubprocesses.has(subprocessKey(workspaceId, tabId)))
      return null;
    return { started_at: open.started_at };
  });

  // Legacy data source. When show_chat_v2 is OFF, this is the only
  // signal. When ON, we ignore it (phase24Open carries the truth)
  // since the translator suppresses ActivityChanged emission.
  const slice = useDataState((s) => s.activity[activityKey(workspaceId, tabId)]);

  const [now, setNow] = useState(() => Date.now());
  // Optimistic-hide flag: set when the user clicks Stop, reset on the
  // next state edge so a follow-up turn shows the row again. Keyed off
  // `slice.since_ms` so the optimistic flag clears when the
  // authoritative Idle (or any other transition) lands — a single
  // useEffect does the reset rather than a second `useState` + manual
  // sync that drifts.
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  useEffect(() => {
    setStoppedAt(null);
  }, [slice?.state, slice?.since_ms]);

  useEffect(() => {
    // Tick the elapsed counter while either the legacy `working`
    // state is showing or the phase24 indicator is on. One interval
    // covers both modes.
    const ticking =
      (showChatV2 && phase24Open !== null) ||
      (!showChatV2 && slice?.state === "working");
    if (!ticking) return;
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [
    showChatV2,
    phase24Open,
    slice?.state,
    slice?.since_ms,
  ]);

  // Optimistic hide always wins.
  if (stoppedAt !== null) return null;

  // Phase 24 path. Read from chatThreadStore-derived phase24Open;
  // ignore the legacy slice. AwaitingApproval is dropped per spec —
  // the inline ApprovalBlock carries the signal in phase24 mode.
  if (showChatV2) {
    if (phase24Open === null) return null;
    const elapsedMs = Math.max(0, now - phase24Open.started_at);
    return renderWorkingChip(workspaceId, tabId, elapsedMs, setStoppedAt);
  }

  if (!slice) {
    return null;
  }

  if (slice.state === "awaiting_approval") {
    return (
      <div
        className="compose-dock-activity-row"
        data-component="ComposeDockActivityRow"
        data-state="awaiting_approval"
      >
        <span className="compose-dock-activity-row__pulse" aria-hidden="true" />
        <span
          className="compose-dock-activity-row__label"
          role="status"
          aria-live="polite"
        >
          Approve to continue
        </span>
        <span className="compose-dock-activity-row__chevron" aria-hidden="true">
          <ChevronRight size={12} strokeWidth={1.5} />
        </span>
      </div>
    );
  }

  // Legacy working: render the same chip as phase24 — share via helper.
  const elapsedMs = Math.max(0, now - slice.since_ms);
  return renderWorkingChip(workspaceId, tabId, elapsedMs, setStoppedAt);
}

/** Shared "working" chip render — used by both legacy
 *  `slice.state === "working"` and phase24 `phase24Open !== null`
 *  branches. Body is identical (pulse + label + elapsed + stop). */
function renderWorkingChip(
  workspaceId: WorkspaceId,
  tabId: TabId | null | undefined,
  elapsedMs: number,
  setStoppedAt: (n: number | null) => void,
) {
  const onStop = () => {
    if (!tabId) return;
    setStoppedAt(Date.now());
    void ipcClient()
      .interruptTurn(workspaceId, tabId)
      .catch((err) => {
        console.warn("interruptTurn failed", err);
        setStoppedAt(null);
      });
  };

  return (
    <div
      className="compose-dock-activity-row"
      data-component="ComposeDockActivityRow"
      data-state="working"
    >
      <span className="compose-dock-activity-row__pulse" aria-hidden="true" />
      <span className="compose-dock-activity-row__label">
        <span role="status" aria-live="polite">
          Working…
        </span>{" "}
        <span
          className="compose-dock-activity-row__elapsed"
          aria-hidden="true"
        >
          {formatElapsed(elapsedMs)}
        </span>
      </span>
      <button
        type="button"
        className="compose-dock-activity-row__stop"
        onClick={onStop}
        aria-label="Stop response"
      >
        <StopCircle size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * MM:SS for the first hour, H:MM:SS after. Tabular figures via CSS.
 * Exported for unit tests so the format contract is locked
 * independent of timer mechanics.
 */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}
