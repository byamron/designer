import { useEffect, useMemo, useState } from "react";
import { House } from "lucide-react";
import {
  PANE_DEFAULT_WIDTH,
  commitSidebarWidth,
  selectTab,
  selectWorkspace,
  setSidebarWidthLive,
  toggleSidebar,
  useAppState,
} from "../store/app";
import { refreshWorkspaces, useDataState } from "../store/data";
import { ipcClient } from "../ipc/client";
import { invoke, isTauri } from "../ipc/tauri";
import type { TrackSummary, Workspace, WorkspaceSummary } from "../ipc/types";
import { emptyArray } from "../util/empty";
import { IconButton } from "../components/IconButton";
import { Tooltip } from "../components/Tooltip";
import { PaneResizer } from "../components/PaneResizer";
import { WorkspaceStatusIcon } from "../components/WorkspaceStatusIcon";
import { IconPlus, IconCollapseLeft, IconPullRequest } from "../components/icons";

export function WorkspaceSidebar() {
  const activeProjectId = useAppState((s) => s.activeProject);
  const activeWorkspaceId = useAppState((s) => s.activeWorkspace);
  const sidebarWidth = useAppState((s) => s.sidebarWidth);
  const workspaces = useDataState<WorkspaceSummary[]>((s) =>
    activeProjectId ? s.workspaces[activeProjectId] ?? emptyArray() : emptyArray(),
  );
  const projects = useDataState((s) => s.projects);
  const activeProject = useMemo(
    () => projects.find((p) => p.project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const onCreate = async () => {
    if (!activeProjectId) return;
    const name = window.prompt("Workspace name?")?.trim();
    if (!name) return;
    const summary = await ipcClient().createWorkspace({
      project_id: activeProjectId,
      name,
      base_branch: "main",
    });
    await refreshWorkspaces(activeProjectId);
    selectWorkspace(summary.workspace.id);
  };

  const onHome = () => selectWorkspace(null);
  const homeActive = activeProjectId !== null && activeWorkspaceId === null;

  return (
    <aside
      className="app-sidebar"
      aria-label="Workspaces"
      style={{ width: sidebarWidth }}
    >
      <PaneResizer
        side="right"
        width={sidebarWidth}
        onLiveChange={setSidebarWidthLive}
        onCommit={commitSidebarWidth}
        defaultWidth={PANE_DEFAULT_WIDTH}
        ariaLabel="Resize workspaces pane"
      />
      <header className="sidebar-header">
        <div className="sidebar-header__row">
          <strong className="sidebar-title">
            {activeProject?.project.name ?? "Pick a project"}
          </strong>
          {activeWorkspaceId && <RequestMergeButton workspaceId={activeWorkspaceId} />}
          <IconButton
            label="Hide workspaces"
            shortcut="⌘["
            onClick={() => toggleSidebar(false)}
          >
            <IconCollapseLeft />
          </IconButton>
        </div>
        {activeProject && (
          <Tooltip label={`Reveal ${activeProject.project.root_path} in Finder`}>
            <button
              type="button"
              className="sidebar-path"
              onClick={() => revealInFinder(activeProject.project.root_path)}
            >
              {activeProject.project.root_path}
            </button>
          </Tooltip>
        )}
      </header>

      <Tooltip label="Project home">
        <button
          type="button"
          className="sidebar-home"
          data-active={homeActive}
          onClick={onHome}
          disabled={!activeProjectId}
        >
          <House size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>Home</span>
        </button>
      </Tooltip>

      <div className="sidebar-group">
        <div className="sidebar-group__head">
          <span className="sidebar-label">Workspaces</span>
          <IconButton
            label="New workspace"
            shortcut="⌘⇧N"
            onClick={onCreate}
            disabled={!activeProjectId}
          >
            <IconPlus />
          </IconButton>
        </div>
        {workspaces.length === 0 ? (
          <p className="sidebar-empty">No workspaces yet.</p>
        ) : (
          <ul className="sidebar-list" role="list">
            {workspaces.map((summary) => (
              <WorkspaceRow
                key={summary.workspace.id}
                workspace={summary.workspace}
                active={activeWorkspaceId === summary.workspace.id}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/**
 * Reveal a repo root in Finder. In Tauri we call the `reveal_in_finder`
 * IPC command (TODO(13.E): wire the Rust side to NSWorkspace). In the
 * web/dev build we can't shell out, so we copy the path to the clipboard
 * and return silently — the user still has a usable affordance without
 * needing to manually select the text.
 */
async function revealInFinder(path: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke<void>("reveal_in_finder", { path });
      return;
    } catch (err) {
      console.warn("reveal_in_finder failed; falling back to clipboard", err);
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      // clipboard blocked (insecure context or user gesture gated) — no-op
    }
  }
}

/**
 * Lightest-touch placement for the Request Merge action: an icon button in
 * the sidebar header next to the workspace name. Surfaces only when the
 * active workspace has at least one mergeable track. Click runs
 * `cmd_request_merge` on the most recent track that's still merge-eligible.
 */
function RequestMergeButton({ workspaceId }: { workspaceId: string }) {
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    void ipcClient()
      .listTracks(workspaceId)
      .then((rows) => mounted && setTracks(rows))
      .catch(() => mounted && setTracks([]));
    return () => {
      mounted = false;
    };
  }, [workspaceId]);
  const target = useMemo(() => {
    return [...tracks]
      .reverse()
      .find((t) => t.state === "active" || t.state === "requesting_merge");
  }, [tracks]);
  if (!target) return null;
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ipcClient().requestMerge({ track_id: target.id });
      const refreshed = await ipcClient().listTracks(workspaceId);
      setTracks(refreshed);
    } catch (err) {
      console.warn("request merge failed", err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <IconButton
      label={busy ? "Requesting merge…" : `Request merge — ${target.branch}`}
      onClick={onClick}
      disabled={busy}
    >
      <IconPullRequest />
    </IconButton>
  );
}

function WorkspaceRow({
  workspace,
  active,
}: {
  workspace: Workspace;
  active: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        className="workspace-row"
        data-active={active}
        title={`${workspace.name} · ${workspace.base_branch}`}
        onClick={() => {
          selectWorkspace(workspace.id);
          const first = workspace.tabs.find((t) => !t.closed_at);
          if (first) selectTab(workspace.id, first.id);
        }}
      >
        {workspace.status ? (
          <WorkspaceStatusIcon status={workspace.status} />
        ) : (
          <span className="state-dot" data-state={workspace.state} aria-hidden="true" />
        )}
        <span className="workspace-row__title">{workspace.name}</span>
      </button>
    </li>
  );
}

