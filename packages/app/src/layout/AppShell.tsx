import type { ReactNode } from "react";
import { ProjectStrip } from "./ProjectStrip";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { MainView } from "./MainView";
import { ActivitySpine } from "./ActivitySpine";
import { toggleSidebar, toggleSpine, useAppState } from "../store/app";
import { IconButton } from "../components/IconButton";
import { IconChevronLeft, IconChevronRight } from "../components/icons";

export function AppShell() {
  const stripVisible = useAppState((s) => s.projectStripVisible);
  const sidebarVisible = useAppState((s) => s.sidebarVisible);
  const spineVisible = useAppState((s) => s.spineVisible);

  return (
    <>
      {/* Full-width titlebar zone: clears the macOS traffic-light inset
       *  and provides a window-drag region across the whole top edge.
       *  Tauri picks up `data-tauri-drag-region` at runtime; in the web
       *  build it's just an empty strip. */}
      <div className="app-titlebar" data-tauri-drag-region />
      <div
        className="app-shell"
        data-strip={stripVisible ? "visible" : "hidden"}
        data-sidebar={sidebarVisible ? "visible" : "hidden"}
        data-spine={spineVisible ? "visible" : "hidden"}
      >
      <a href="#main-content" className="skip-link" title="Jump past navigation to the main content">
        Skip to main content
      </a>
      {stripVisible && <ProjectStrip />}
      {sidebarVisible ? (
        <WorkspaceSidebar />
      ) : (
        <CollapsedRail
          side="left"
          ariaLabel="Workspaces (collapsed)"
          onExpand={() => toggleSidebar(true)}
          expandLabel="Show workspaces"
          shortcut="⌘["
          icon={<IconChevronRight />}
        />
      )}
      <MainView />
      {spineVisible ? (
        <ActivitySpine />
      ) : (
        <CollapsedRail
          side="right"
          ariaLabel="Activity (collapsed)"
          onExpand={() => toggleSpine(true)}
          expandLabel="Show activity"
          shortcut="⌘]"
          icon={<IconChevronLeft />}
        />
      )}
      </div>
    </>
  );
}

function CollapsedRail({
  side,
  ariaLabel,
  expandLabel,
  shortcut,
  onExpand,
  icon,
}: {
  side: "left" | "right";
  ariaLabel: string;
  expandLabel: string;
  shortcut: string;
  onExpand: () => void;
  icon: ReactNode;
}) {
  return (
    <aside
      className={side === "right" ? "pane-rail pane-rail--right" : "pane-rail"}
      aria-label={ariaLabel}
    >
      <IconButton label={expandLabel} shortcut={shortcut} onClick={onExpand}>
        {icon}
      </IconButton>
    </aside>
  );
}
