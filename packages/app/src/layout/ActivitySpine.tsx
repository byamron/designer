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

  return (
    <aside className="app-spine" aria-label="Activity spine">
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
          marginBottom: "var(--space-3)",
        }}
      >
        <span className="sidebar-section-title">Activity</span>
        <strong style={{ fontSize: "var(--type-lead-size)" }}>{header}</strong>
        <span className="workspace-row__meta">
          {summary.activeCount} active · {summary.needsYou} needs you · {summary.errored} errored
        </span>
      </header>

      <div role="tree" aria-label="Activity spine tree">
        {spine.map((row) => (
          <SpineNode key={row.id} row={row} onFollow={setFollowingAgent} />
        ))}
      </div>

      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
          margin: "var(--space-4) 0 var(--space-2)",
        }}
      >
        <span className="sidebar-section-title">Recent events</span>
      </header>
      {events.length === 0 ? (
        <p style={{ margin: 0, color: "var(--color-muted)" }}>No events yet.</p>
      ) : (
        <ul role="list" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {events.map((e) => (
            <li
              key={`${e.stream_id}:${e.sequence}`}
              style={{
                fontFamily: "var(--type-family-mono)",
                fontSize: "var(--type-caption-size)",
                color: "var(--color-muted)",
              }}
            >
              {new Date(e.timestamp).toLocaleTimeString()} · {humanizeKind(e.kind)}
              {e.summary ? ` · ${e.summary}` : ""}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function SpineNode({
  row,
  onFollow,
}: {
  row: SpineRow;
  onFollow: (id: string) => void;
}) {
  return (
    <div role="treeitem" aria-label={row.label} aria-expanded={row.children.length > 0}>
      <button
        type="button"
        className="spine-row"
        onClick={() => onFollow(row.id)}
        aria-label={`${row.label}: ${row.summary ?? "no activity"}`}
      >
        <span className="state-dot" data-state={row.state} aria-hidden="true" />
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            gap: "var(--space-1)",
          }}
        >
          <span className="spine-row__label">{row.label}</span>
          {row.summary && (
            <span className="spine-row__summary">{row.summary}</span>
          )}
        </span>
      </button>
      {row.children.length > 0 && (
        <div className="spine-row__indent" role="group">
          {row.children.map((child) => (
            <SpineNode key={child.id} row={child} onFollow={onFollow} />
          ))}
        </div>
      )}
    </div>
  );
}

function countState(rows: SpineRow[], state: SpineRow["state"]): number {
  let total = 0;
  for (const r of rows) {
    if (r.state === state) total++;
    total += countState(r.children, state);
  }
  return total;
}
