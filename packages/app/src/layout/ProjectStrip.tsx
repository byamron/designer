import { selectProject, toggleQuickSwitcher, useAppState } from "../store/app";
import { refreshProjects, useDataState } from "../store/data";
import { ipcClient } from "../ipc/client";

export function ProjectStrip() {
  const active = useAppState((s) => s.activeProject);
  const projects = useDataState((s) => s.projects);

  const onCreate = async () => {
    const name = window.prompt("New project name?")?.trim();
    if (!name) return;
    const root = window.prompt("Repo root path?", "~/code/")?.trim();
    if (!root) return;
    const summary = await ipcClient().createProject({ name, root_path: root });
    await refreshProjects();
    selectProject(summary.project.id);
  };

  return (
    <nav className="app-strip" aria-label="Projects">
      {projects.map((p) => {
        const initials = p.project.name
          .split(/\s+/)
          .slice(0, 2)
          .map((x) => x[0]?.toUpperCase() ?? "")
          .join("");
        return (
          <button
            key={p.project.id}
            type="button"
            className="strip-icon"
            data-active={active === p.project.id}
            title={p.project.name}
            aria-label={p.project.name}
            onClick={() => selectProject(p.project.id)}
          >
            {initials || "·"}
          </button>
        );
      })}
      <button
        type="button"
        className="strip-icon"
        aria-label="New project"
        title="New project"
        onClick={onCreate}
      >
        +
      </button>
      <button
        type="button"
        className="strip-icon"
        aria-label="Quick switcher (Cmd+K)"
        title="Quick switcher  ⌘K"
        onClick={() => toggleQuickSwitcher()}
      >
        ⌘
      </button>
    </nav>
  );
}
