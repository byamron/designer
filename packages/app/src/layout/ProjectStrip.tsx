import { selectProject, toggleQuickSwitcher, useAppState } from "../store/app";
import { promptCreateProject, useDataState } from "../store/data";

export function ProjectStrip() {
  const active = useAppState((s) => s.activeProject);
  const projects = useDataState((s) => s.projects);

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
