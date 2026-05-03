import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { activityKey, useDataState } from "../store/data";
import type { TabId, WorkspaceId } from "../ipc/types";

/**
 * Phase 23.B — pinned status row above the compose textarea. Reads
 * the per-tab activity slice and renders three states:
 *
 *   - `idle`               → renders nothing (the row hides)
 *   - `working`            → "Working… {MM:SS|H:MM:SS}" with a pulsing dot
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
 * **A11y**: the live region wraps only the *label* ("Working…" /
 * "Approve to continue") — never the elapsed counter. A naive
 * `aria-live="polite"` on the outer container would re-announce the
 * full string every time the elapsed span ticks (every second), which
 * is the screen-reader equivalent of a robotic stopwatch and violates
 * Designer's calm-by-default axiom. The counter is `aria-hidden` so
 * AT users hear "Working…" once on the state edge and the visible
 * elapsed display is a sighted-user affordance only.
 */
export function ComposeDockActivityRow({
  workspaceId,
  tabId,
}: {
  workspaceId: WorkspaceId;
  tabId: TabId | null | undefined;
}) {
  const slice = useDataState((s) => s.activity[activityKey(workspaceId, tabId)]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!slice || slice.state !== "working") {
      // The elapsed counter only ticks while the working state is
      // visible. `awaiting_approval` shows static copy with no
      // counter, so we don't burn a setInterval there either.
      return;
    }
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [slice?.state, slice?.since_ms]);

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

  // Working: render the pulsing dot + elapsed counter.
  const elapsedMs = Math.max(0, now - slice.since_ms);
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
