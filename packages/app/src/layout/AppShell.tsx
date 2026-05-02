import { useEffect, type ReactNode } from "react";
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

  // DP-B — auto-show the activity spine when the user clicks an inline
  // artifact reference (e.g. `→ Spec: foo.md`) in chat. Without this,
  // a click on a hidden-spine workspace flashes a row the user never
  // sees. ActivitySpine attaches its own listener for the scroll +
  // flash; this one only handles the visibility flip. The shell is
  // always mounted, so the listener catches events that fire before
  // ActivitySpine itself mounts.
  useEffect(() => {
    const onFocus = () => toggleSpine(true);
    window.addEventListener("designer:focus-artifact", onFocus);
    return () => window.removeEventListener("designer:focus-artifact", onFocus);
  }, []);

  // data-component drives Track 13.K Friction smart-snap;
  // pattern-log.md captures the convention.
  return (
    <div
      className="app-shell"
      data-component="AppShell"
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
