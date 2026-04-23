import { openDialog, selectProject, useAppState } from "../store/app";
import { promptCreateProject, useDataState } from "../store/data";
import { Tooltip } from "../components/Tooltip";
import { IconButton } from "../components/IconButton";
import { IconPlus } from "../components/icons";
import type { WorkspaceSummary } from "../ipc/types";

/**
 * ProjectStrip — vertical rail of projects. Top: project initials. Bottom:
 * new-project (icon, no chrome), settings, help. ⌘K opens the quick switcher;
 * there is no dedicated strip icon for it — discovered via tooltip on any
 * project or via the menubar.
 *
 * Each project square carries a tiny pulsing status dot when any workspace in
 * that project has active/needs_you/errored activity.
 */
export function ProjectStrip() {
  const active = useAppState((s) => s.activeProject);
  const projects = useDataState((s) => s.projects);
  const workspacesByProject = useDataState((s) => s.workspaces);

  const onCreate = async () => {
    const id = await promptCreateProject();
    if (id) selectProject(id);
  };

  return (
    <nav className="app-strip" aria-label="Projects">
      {/* Drag spacer — clears the macOS traffic-light inset (titleBarStyle:
          Overlay) and gives the user a grip area for window moves. Tauri
          picks up the attribute at runtime; no effect in the web build. */}
      <div className="app-strip-drag" data-tauri-drag-region />
      {projects.map((p) => {
        const initials = p.project.name
          .split(/\s+/)
          .slice(0, 2)
          .map((x) => x[0]?.toUpperCase() ?? "")
          .join("");
        const ws: WorkspaceSummary[] = workspacesByProject[p.project.id] ?? [];
        const hasActivity = ws.some((w) => w.state === "active");
        const needsYou = ws.some((w) =>
          w.workspace.status === "pr_conflict" || w.workspace.status === "pr_ready",
        );
        const signalState = hasActivity ? "active" : needsYou ? "needs_you" : null;
        return (
          <Tooltip key={p.project.id} label={p.project.name} side="right">
            <button
              type="button"
              className="strip-icon"
              data-active={active === p.project.id}
              aria-label={p.project.name}
              onClick={() => selectProject(p.project.id)}
            >
              {initials || "·"}
              {signalState && (
                <span
                  className="strip-icon__activity"
                  data-state={signalState}
                  aria-hidden="true"
                />
              )}
            </button>
          </Tooltip>
        );
      })}
      <IconButton
        label="New project"
        shortcut="⌘N"
        onClick={onCreate}
        className="strip-icon-btn"
      >
        <IconPlus size={14} />
      </IconButton>
      <div className="app-strip__spacer" />
      <IconButton
        label="Settings"
        onClick={() => openDialog("settings")}
        className="strip-icon-btn"
      >
        <IconSettings />
      </IconButton>
      <IconButton
        label="Help"
        shortcut="⌘?"
        onClick={() => openDialog("help")}
        className="strip-icon-btn"
      >
        <IconHelp />
      </IconButton>
    </nav>
  );
}

function IconSettings() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7" cy="7" r="2" />
      <path d="M7 1.5v1.5M7 11v1.5M1.5 7h1.5M11 7h1.5M3.1 3.1l1.05 1.05M9.85 9.85l1.05 1.05M3.1 10.9l1.05-1.05M9.85 4.15l1.05-1.05" />
    </svg>
  );
}

function IconHelp() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="5" />
      <path d="M5.5 5.5a1.5 1.5 0 0 1 3 0c0 1-1.5 1.25-1.5 2.25" />
      <circle cx="7" cy="10" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
