import { useMemo } from "react";
import { setFollowingAgent, useAppState } from "../store/app";
import { useDataState } from "../store/data";
import type { SpineRow, StreamEvent } from "../ipc/types";
import { emptyArray } from "../util/empty";
import { humanizeKind } from "../util/humanize";

export function ActivitySpine() {
  const activeWorkspace = useAppState((s) => s.activeWorkspace);
  const spine = useDataState<SpineRow[]>((s) =>
    activeWorkspace
      ? s.spines[`workspace:${activeWorkspace}`] ?? emptyArray()
      : s.spines["project:*"] ?? emptyArray(),
  );
  const allEvents = useDataState<StreamEvent[]>((s) => s.events);
  const events = useMemo(() => allEvents.slice(-6).reverse(), [allEvents]);

  const header = activeWorkspace ? "Workspace activity" : "Projects";

  const summary = useMemo(() => {
    const activeCount = countState(spine, "active");
    const needsYou = countState(spine, "needs_you");
    const errored = countState(spine, "errored");
    return { activeCount, needsYou, errored };
  }, [spine]);

  const flatRows = useMemo(() => flattenSpine(spine), [spine]);

  return (
    <aside className="app-spine" aria-label="Activity spine">
      <header className="spine-header">
        <span className="sidebar-label">Activity</span>
        <strong className="sidebar-title">{header}</strong>
        <div className="spine-summary" aria-label="Activity summary">
          {summary.activeCount > 0 && (
            <span className="spine-summary__item">
              <span className="state-dot" data-state="active" aria-hidden="true" />
              {summary.activeCount} active
            </span>
          )}
          {summary.needsYou > 0 && (
            <span className="spine-summary__item">
              <span className="state-dot" data-state="needs_you" aria-hidden="true" />
              {summary.needsYou} need{summary.needsYou === 1 ? "s" : ""} you
            </span>
          )}
          {summary.errored > 0 && (
            <span className="spine-summary__item">
              <span className="state-dot" data-state="errored" aria-hidden="true" />
              {summary.errored} errored
            </span>
          )}
          {summary.activeCount + summary.needsYou + summary.errored === 0 && (
            <span className="spine-summary__item spine-summary__item--muted">
              <span className="state-dot" data-state="idle" aria-hidden="true" />
              All quiet
            </span>
          )}
        </div>
      </header>

      <ul className="spine-list" role="tree" aria-label="Activity spine">
        {flatRows.map(({ row, depth }) => (
          <li key={row.id} role="treeitem" aria-label={row.label}>
            <button
              type="button"
              className="spine-row"
              data-depth={depth}
              style={{ "--depth": depth } as React.CSSProperties}
              onClick={() => setFollowingAgent(row.id)}
              aria-label={`${row.label}: ${row.summary ?? "no activity"}`}
              title={`Follow ${row.label}${row.summary ? ` · ${row.summary}` : ""}`}
            >
              <span className="state-dot" data-state={row.state} aria-hidden="true" />
              <span className="spine-row__body">
                <span className="spine-row__label">{row.label}</span>
                {row.summary && (
                  <span className="spine-row__summary">{row.summary}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="spine-section">
        <span className="sidebar-label">Recent events</span>
        {events.length === 0 ? (
          <p className="sidebar-empty">No events yet.</p>
        ) : (
          <ul className="spine-events" role="list">
            {events.map((e) => (
              <li key={`${e.stream_id}:${e.sequence}`}>
                <span className="spine-event__time">
                  {new Date(e.timestamp).toLocaleTimeString()}
                </span>
                <span className="spine-event__body">
                  {humanizeKind(e.kind)}
                  {e.summary ? ` · ${e.summary}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function flattenSpine(rows: SpineRow[], depth = 0): { row: SpineRow; depth: number }[] {
  const out: { row: SpineRow; depth: number }[] = [];
  for (const r of rows) {
    out.push({ row: r, depth });
    const children = r.children ?? [];
    if (children.length > 0) {
      out.push(...flattenSpine(children, depth + 1));
    }
  }
  return out;
}

function countState(rows: SpineRow[], state: SpineRow["state"]): number {
  let total = 0;
  for (const r of rows) {
    if (r.state === state) total++;
    total += countState(r.children ?? [], state);
  }
  return total;
}
