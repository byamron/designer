import { ProjectStrip } from "./ProjectStrip";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { MainView } from "./MainView";
import { ActivitySpine } from "./ActivitySpine";

export function AppShell() {
  return (
    <div className="app-shell">
      {/* Skip-link: visible only on keyboard focus; jumps screen-reader + keyboard
          users past the project strip and sidebar to the main content. */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <ProjectStrip />
      <WorkspaceSidebar />
      <MainView />
      <ActivitySpine />
    </div>
  );
}
