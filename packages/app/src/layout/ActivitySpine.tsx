import { useMemo } from "react";
import { FileText, FolderCode, Sparkles } from "lucide-react";
import {
  PANE_DEFAULT_WIDTH,
  commitSpineWidth,
  selectTab,
  setFollowingAgent,
  setSpineWidthLive,
  toggleSpine,
  useAppState,
} from "../store/app";
import { refreshWorkspaces, useDataState } from "../store/data";
import { ipcClient } from "../ipc/client";
import type { SpineRow, StreamEvent } from "../ipc/types";
import { emptyArray } from "../util/empty";
import { humanizeKind } from "../util/humanize";
import { Tooltip } from "../components/Tooltip";
import { IconButton } from "../components/IconButton";
import { PaneResizer } from "../components/PaneResizer";
import { IconCollapseRight } from "../components/icons";

/**
 * Activity spine — strictly scoped to the selected workspace. Section
 * order, top-to-bottom:
 *
 *   1. Artifacts (specs, prototypes) — clicking opens as a new tab.
 *   2. Code files — placeholder until the file-index IPC lands.
 *   3. Agents — the live activity tree (following an agent still drives
 *      the main view through `setFollowingAgent`).
 *   4. Recent events — the last few stream events for this workspace.
 *
 * Previously the spine would fall back to project-level activity when no
 * workspace was selected. User feedback: that made the scope ambiguous.
 * Now if no workspace is active the spine renders a single empty state
 * asking the user to pick a workspace, and the four sections disappear.
 */
export function ActivitySpine() {
  const activeProject = useAppState((s) => s.activeProject);
  const activeWorkspace = useAppState((s) => s.activeWorkspace);
  const spineWidth = useAppState((s) => s.spineWidth);
  const spine = useDataState<SpineRow[]>((s) =>
    activeWorkspace
      ? s.spines[`workspace:${activeWorkspace}`] ?? emptyArray()
      : emptyArray(),
  );
  const allEvents = useDataState<StreamEvent[]>((s) => s.events);

  const events = useMemo(() => {
    if (!activeWorkspace) return [];
    const scoped = allEvents.filter(
      (e) => e.stream_id === activeWorkspace || e.stream_id.startsWith(`${activeWorkspace}:`),
    );
    const sorted = [...scoped].sort(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
    );
    return sorted.slice(0, 6);
  }, [activeWorkspace, allEvents]);

  const artifacts = useMemo(
    () => collectArtifacts(spine),
    [spine],
  );

  const agentRows = useMemo(
    () => flattenSpine(filterOutArtifacts(spine)),
    [spine],
  );

  const summary = useMemo(() => {
    const activeCount = countState(spine, "active");
    const needsYou = countState(spine, "needs_you");
    const errored = countState(spine, "errored");
    return { activeCount, needsYou, errored };
  }, [spine]);

  const nothingStreaming =
    summary.activeCount + summary.needsYou + summary.errored === 0;

  const openArtifactAsTab = async (artifact: SpineRow) => {
    if (!activeWorkspace || !activeProject) return;
    // TODO(13.D): artifacts will get a first-class TabTemplate ("artifact")
    // with a dedicated content pane. For now we open a Blank tab seeded
    // with the artifact's label so the user gets a scaffolded surface
    // while the artifact template is designed.
    const tab = await ipcClient().openTab({
      workspace_id: activeWorkspace,
      title: artifact.label,
      template: "blank",
    });
    await refreshWorkspaces(activeProject);
    selectTab(activeWorkspace, tab.id);
  };

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
          <strong className="sidebar-title">Workspace activity</strong>
          <IconButton
            label="Hide activity"
            shortcut="⌘]"
            onClick={() => toggleSpine(false)}
          >
            <IconCollapseRight />
          </IconButton>
        </div>
        {activeWorkspace && (
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
        )}
      </header>

      {!activeWorkspace ? (
        <p className="sidebar-empty">Pick a workspace to see activity.</p>
      ) : (
        <>
          <div className="spine-section">
            <span className="sidebar-label">Artifacts</span>
            {artifacts.length === 0 ? (
              <p className="sidebar-empty">No specs or prototypes yet.</p>
            ) : (
              <ul className="spine-items" role="list">
                {artifacts.map((a) => (
                  <li key={a.id}>
                    <Tooltip label={a.summary ? `${a.label} · ${a.summary}` : `Open ${a.label}`}>
                      <button
                        type="button"
                        className="spine-item"
                        onClick={() => void openArtifactAsTab(a)}
                      >
                        <FileText size={14} strokeWidth={1.5} aria-hidden="true" />
                        <span className="spine-item__label">{a.label}</span>
                        {a.summary && (
                          <span className="spine-item__meta">{a.summary}</span>
                        )}
                      </button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="spine-section">
            <span className="sidebar-label">Code files</span>
            {/* TODO(13.E): wire a workspace-scoped file index — treat
              * recently edited and currently-open files as first-class
              * entries that open as tabs. Empty until then. */}
            <p className="sidebar-empty">
              <FolderCode size={12} strokeWidth={1.25} aria-hidden="true" />
              <span> No files tracked in this workspace yet.</span>
            </p>
          </div>

          <div className="spine-section">
            <span className="sidebar-label">
              <Sparkles size={12} strokeWidth={1.25} aria-hidden="true" />
              <span> Agents</span>
            </span>
            {agentRows.length === 0 ? (
              <p className="sidebar-empty">No agents running.</p>
            ) : (
              <ul className="spine-list" role="tree" aria-label="Agents">
                {agentRows.map(({ row, depth }) => (
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
            )}
          </div>

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
        </>
      )}
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

function collectArtifacts(rows: SpineRow[]): SpineRow[] {
  const out: SpineRow[] = [];
  const walk = (rs: SpineRow[]) => {
    for (const r of rs) {
      if (r.altitude === "artifact") out.push(r);
      if (r.children?.length) walk(r.children);
    }
  };
  walk(rows);
  return out;
}

function filterOutArtifacts(rows: SpineRow[]): SpineRow[] {
  return rows
    .filter((r) => r.altitude !== "artifact")
    .map((r) => ({
      ...r,
      children: filterOutArtifacts(r.children ?? []),
    }));
}

function countState(rows: SpineRow[], state: SpineRow["state"]): number {
  let total = 0;
  for (const r of rows) {
    if (r.state === state) total++;
    total += countState(r.children ?? [], state);
  }
  return total;
}
