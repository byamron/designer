import { useMemo } from "react";
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
import type { Workspace, WorkspaceSummary } from "../ipc/types";
import { emptyArray } from "../util/empty";
import { IconButton } from "../components/IconButton";
import { Tooltip } from "../components/Tooltip";
import { PaneResizer } from "../components/PaneResizer";
import { WorkspaceStatusIcon } from "../components/WorkspaceStatusIcon";
import { IconPlus, IconCollapseLeft } from "../components/icons";

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
          <IconButton
            size="sm"
            label="Hide workspaces"
            shortcut="⌘["
            onClick={() => toggleSidebar(false)}
          >
            <IconCollapseLeft />
          </IconButton>
        </div>
        {activeProject && (
          <Tooltip label={activeProject.project.root_path}>
            <span className="sidebar-path">
              {activeProject.project.root_path}
            </span>
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
          <House size={14} strokeWidth={1.25} aria-hidden="true" />
          <span>Home</span>
        </button>
      </Tooltip>

      <div className="sidebar-group">
        <div className="sidebar-group__head">
          <span className="sidebar-label">Workspaces</span>
          <IconButton
            size="sm"
            label="New workspace"
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

