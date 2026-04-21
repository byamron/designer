import { useMemo } from "react";
import { selectTab, selectWorkspace, useAppState } from "../store/app";
import { refreshWorkspaces, useDataState } from "../store/data";
import { ipcClient } from "../ipc/client";
import type { Workspace, WorkspaceSummary } from "../ipc/types";
import { emptyArray } from "../util/empty";

export function WorkspaceSidebar() {
  const activeProjectId = useAppState((s) => s.activeProject);
  const activeWorkspaceId = useAppState((s) => s.activeWorkspace);
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
    selectTab(summary.workspace.id, "home");
  };

  return (
    <aside className="app-sidebar" aria-label="Workspaces">
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
        }}
      >
        <span className="sidebar-section-title">Project</span>
        <strong style={{ fontSize: "var(--type-lead-size)" }}>
          {activeProject?.project.name ?? "Pick a project"}
        </strong>
        {activeProject && (
          <span
            className="workspace-row__meta"
            style={{ overflow: "hidden", textOverflow: "ellipsis" }}
            title={activeProject.project.root_path}
          >
            {activeProject.project.root_path}
          </span>
        )}
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span className="sidebar-section-title">Workspaces</span>
        {workspaces.length === 0 ? (
          <p style={{ color: "var(--color-muted)", margin: 0 }}>
            No workspaces yet — create one to get started.
          </p>
        ) : (
          workspaces.map((summary) => (
            <WorkspaceRow
              key={summary.workspace.id}
              workspace={summary.workspace}
              active={activeWorkspaceId === summary.workspace.id}
            />
          ))
        )}
      </div>

      <button
        type="button"
        className="btn"
        style={{ alignSelf: "stretch" }}
        onClick={onCreate}
        disabled={!activeProjectId}
      >
        + New workspace
      </button>
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
  const state = workspace.state;
  return (
    <button
      type="button"
      className="workspace-row"
      data-active={active}
      onClick={() => {
        selectWorkspace(workspace.id);
        selectTab(workspace.id, "home");
      }}
    >
      <span className="workspace-row__title">{workspace.name}</span>
      <span className="workspace-row__meta">
        <span className="state-dot" data-state={state} aria-hidden="true" />
        <span>{state}</span>
        <span>•</span>
        <span>{workspace.base_branch}</span>
      </span>
    </button>
  );
}
