import { useMemo } from "react";
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
import type { Workspace, WorkspaceStatus, WorkspaceSummary } from "../ipc/types";
import { emptyArray } from "../util/empty";
import { IconButton } from "../components/IconButton";
import { Tooltip } from "../components/Tooltip";
import { PaneResizer } from "../components/PaneResizer";
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
          <IconHome />
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
          <StatusIcon status={workspace.status} />
        ) : (
          <span className="state-dot" data-state={workspace.state} aria-hidden="true" />
        )}
        <span className="workspace-row__title">{workspace.name}</span>
        <span className="workspace-row__branch">{workspace.base_branch}</span>
      </button>
    </li>
  );
}

function StatusIcon({ status }: { status: WorkspaceStatus }) {
  const label = STATUS_LABEL[status];
  return (
    <span
      className="workspace-status"
      data-status={status}
      aria-label={label}
      title={label}
    >
      {renderStatusGlyph(status)}
    </span>
  );
}

const STATUS_LABEL: Record<WorkspaceStatus, string> = {
  idle: "Idle",
  in_progress: "In progress",
  in_review: "In review",
  pr_open: "PR open",
  pr_conflict: "PR has conflicts",
  pr_ready: "PR ready to merge",
  pr_merged: "PR merged",
};

function renderStatusGlyph(status: WorkspaceStatus) {
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    fill: "none" as const,
    stroke: "currentColor" as const,
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (status) {
    case "idle":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4" />
        </svg>
      );
    case "in_progress":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4" opacity="0.3" />
          <path d="M6 2a4 4 0 0 1 4 4" />
        </svg>
      );
    case "in_review":
      return (
        <svg {...common}>
          <path d="M1.5 6s1.8-3 4.5-3 4.5 3 4.5 3-1.8 3-4.5 3S1.5 6 1.5 6Z" />
          <circle cx="6" cy="6" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pr_open":
      return (
        <svg {...common}>
          <circle cx="3" cy="3" r="1.25" />
          <circle cx="3" cy="9" r="1.25" />
          <circle cx="9" cy="9" r="1.25" />
          <path d="M3 4.25v3.5" />
          <path d="M9 7.75V6a2 2 0 0 0-2-2H5" />
          <path d="M6 3l-1-1 1-1" />
        </svg>
      );
    case "pr_conflict":
      return (
        <svg {...common}>
          <path d="M6 1.5L10.5 10H1.5z" />
          <path d="M6 5v2.5" />
          <circle cx="6" cy="9" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pr_ready":
      return (
        <svg {...common}>
          <path d="M2 6.5L4.8 9.5 10 3.5" />
        </svg>
      );
    case "pr_merged":
      return (
        <svg {...common}>
          <circle cx="3" cy="3" r="1.25" />
          <circle cx="3" cy="9" r="1.25" />
          <circle cx="9" cy="6" r="1.25" />
          <path d="M3 4.25v3.5" />
          <path d="M3 6h4.75" />
        </svg>
      );
  }
}

function IconHome() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6.5L7 2.5l5 4V11.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" />
      <path d="M5.5 12.5v-3h3v3" />
    </svg>
  );
}
