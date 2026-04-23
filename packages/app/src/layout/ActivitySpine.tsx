import { useMemo } from "react";
import {
  PANE_DEFAULT_WIDTH,
  commitSpineWidth,
  setFollowingAgent,
  setSpineWidthLive,
  toggleSpine,
  useAppState,
} from "../store/app";
import { useDataState } from "../store/data";
import type { SpineRow, StreamEvent, WorkspaceSummary } from "../ipc/types";
import { emptyArray } from "../util/empty";
import { humanizeKind } from "../util/humanize";
import { Tooltip } from "../components/Tooltip";
import { IconButton } from "../components/IconButton";
import { PaneResizer } from "../components/PaneResizer";
import { IconCollapseRight } from "../components/icons";

/**
 * Activity spine — scoped to the current project by default. When a workspace
 * is active, narrows further to that workspace. Events are filtered to the
 * active-project's streams rather than the global event bus, so the user
 * doesn't see activity from a project they aren't currently in.
 */
export function ActivitySpine() {
  const activeProject = useAppState((s) => s.activeProject);
  const activeWorkspace = useAppState((s) => s.activeWorkspace);
  const spineWidth = useAppState((s) => s.spineWidth);
  const spine = useDataState<SpineRow[]>((s) =>
    activeWorkspace
      ? s.spines[`workspace:${activeWorkspace}`] ?? emptyArray()
      : activeProject
        ? s.spines[`project:${activeProject}`] ?? s.spines["project:*"] ?? emptyArray()
        : emptyArray(),
  );
  const allEvents = useDataState<StreamEvent[]>((s) => s.events);
  const workspaceMap = useDataState((s) => s.workspaces);

  const scopeIds = useMemo(() => {
    if (!activeProject) return new Set<string>();
    const list: WorkspaceSummary[] = workspaceMap[activeProject] ?? emptyArray();
    const set = new Set<string>([activeProject]);
    for (const w of list) set.add(w.workspace.id);
    return set;
  }, [activeProject, workspaceMap]);

  const events = useMemo(() => {
    if (!activeProject) return [];
    const scoped = allEvents.filter((e) =>
      activeWorkspace
        ? e.stream_id === activeWorkspace || e.stream_id.startsWith(`${activeWorkspace}:`)
        : scopeIds.has(e.stream_id) || [...scopeIds].some((id) => e.stream_id.startsWith(`${id}:`)),
    );
    // Sort newest first by timestamp (Date.parse-safe ISO strings). Prior
    // `.slice(-6).reverse()` assumed push order was chronological — which
    // breaks the moment an out-of-order backfill lands.
    const sorted = [...scoped].sort(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
    );
    return sorted.slice(0, 6);
  }, [activeProject, activeWorkspace, allEvents, scopeIds]);

  const header = activeWorkspace ? "Workspace" : "Project";

  const summary = useMemo(() => {
    const activeCount = countState(spine, "active");
    const needsYou = countState(spine, "needs_you");
    const errored = countState(spine, "errored");
    return { activeCount, needsYou, errored };
  }, [spine]);

  const flatRows = useMemo(() => flattenSpine(spine), [spine]);
  const nothingStreaming =
    summary.activeCount + summary.needsYou + summary.errored === 0;

  return (
    <aside
      className="app-spine"
      aria-label="Activity"
      style={{ width: spineWidth }}
    >
      <PaneResizer
        side="left"
        width={spineWidth}
        onLiveChange={setSpineWidthLive}
        onCommit={commitSpineWidth}
        defaultWidth={PANE_DEFAULT_WIDTH}
        ariaLabel="Resize activity pane"
      />
      <header className="spine-header">
        <div className="spine-header__row">
          <strong className="sidebar-title">{header} activity</strong>
          <IconButton
            size="sm"
            label="Hide activity"
            shortcut="⌘]"
            onClick={() => toggleSpine(false)}
          >
            <IconCollapseRight />
          </IconButton>
        </div>
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
          {nothingStreaming && (
            <span className="spine-summary__item spine-summary__item--muted">
              <span className="state-dot" data-state="idle" aria-hidden="true" />
              Nothing streaming
            </span>
          )}
        </div>
      </header>

      <ul className="spine-list" role="tree" aria-label="Activity spine">
        {flatRows.map(({ row, depth }) => (
          <li key={row.id} role="treeitem" aria-label={row.label}>
            <Tooltip label={row.summary ? `${row.label} · ${row.summary}` : `Follow ${row.label}`}>
              <button
                type="button"
                className="spine-row"
                data-depth={depth}
                style={{ "--depth": depth } as React.CSSProperties}
                onClick={() => setFollowingAgent(row.id)}
                aria-label={`${row.label}: ${row.summary ?? "no activity"}`}
              >
                <span className="state-dot" data-state={row.state} aria-hidden="true" />
                <span className="spine-row__body">
                  <span className="spine-row__label">{row.label}</span>
                  {row.summary && (
                    <span className="spine-row__summary">{row.summary}</span>
                  )}
                </span>
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>

      <div className="spine-section">
        <span className="sidebar-label">Recent events</span>
        {events.length === 0 ? (
          <p className="sidebar-empty">No events yet.</p>
        ) : (
          <ul className="spine-events" role="list">
            {events.map((e, i) => (
              // Fallback to index because the mock seeds duplicate
              // stream_id+sequence pairs across workspaces (see mock.ts).
              <li key={`${e.stream_id}:${e.sequence}:${i}`}>
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
