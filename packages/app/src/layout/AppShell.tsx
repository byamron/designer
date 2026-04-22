import { ProjectStrip } from "./ProjectStrip";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { MainView } from "./MainView";
import { ActivitySpine } from "./ActivitySpine";
import { useAppState } from "../store/app";

export function AppShell() {
  const stripVisible = useAppState((s) => s.projectStripVisible);
  return (
    <div className="app-shell" data-strip={stripVisible ? "visible" : "hidden"}>
      <a href="#main-content" className="skip-link" title="Jump past navigation to the main content">
        Skip to main content
      </a>
      {stripVisible && <ProjectStrip />}
      <WorkspaceSidebar />
      <MainView />
      <ActivitySpine />
    </div>
  );
}
