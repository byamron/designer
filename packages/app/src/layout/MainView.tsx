import { useMemo } from "react";
import { openCreateProject, selectTab, useAppState } from "../store/app";
import { refreshWorkspaces, useDataState } from "../store/data";
import { ipcClient } from "../ipc/client";
import type { Project, Tab, Workspace } from "../ipc/types";
import { HomeTabA } from "../home/HomeTabA";
import { WorkspaceThread } from "../tabs/WorkspaceThread";
import { emptyArray } from "../util/empty";
import type { WorkspaceSummary } from "../ipc/types";
import { Tooltip } from "../components/Tooltip";
import { IconButton } from "../components/IconButton";
import { IconX, IconPlus } from "../components/icons";
import { CostChip } from "../components/CostChip";

export function MainView() {
  const activeWorkspaceId = useAppState((s) => s.activeWorkspace);
  const activeProjectId = useAppState((s) => s.activeProject);
  const activeTabByWorkspace = useAppState((s) => s.activeTabByWorkspace);
  const projects = useDataState((s) => s.projects);
  const workspaces = useDataState((s) => s.workspaces);

  const project: Project | null = useMemo(
    () => projects.find((p) => p.project.id === activeProjectId)?.project ?? null,
    [projects, activeProjectId],
  );

  const workspace: Workspace | null = useMemo(() => {
    if (!activeProjectId || !activeWorkspaceId) return null;
    const group: WorkspaceSummary[] =
      workspaces[activeProjectId] ?? emptyArray();
    return group.find((w) => w.workspace.id === activeWorkspaceId)?.workspace ?? null;
  }, [activeProjectId, activeWorkspaceId, workspaces]);

  if (!project) {
    // First-run (no projects) ships a primary CTA so the empty surface
    // doesn't read as a dead end. Once at least one project exists, fall
    // back to the "pick from sidebar" copy.
    const firstRun = projects.length === 0;
    return (
      <main className="app-main" aria-label="Main" id="main-content" tabIndex={-1}>
        <div className="main-surface">
          <div className="main-empty">
            <h2 className="main-empty__title">
              {firstRun ? "Welcome to Designer" : "Pick a project"}
            </h2>
            <p className="main-empty__body">
              {firstRun
                ? "Point Designer at a folder you'd like to manage. Designer will set up per-track worktrees so agents can work on independent branches without touching your main checkout."
                : "Select a project from the sidebar to see its home."}
            </p>
            {firstRun && (
              <button
                type="button"
                className="btn main-empty__cta"
                data-variant="primary"
                onClick={openCreateProject}
              >
                <IconPlus size={14} />
                Create your first project
              </button>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="app-main" aria-label="Main" id="main-content" tabIndex={-1}>
        {/* Project home — always the Panels variant. The palette is still
            available for blank tabs (BlankTab) where it better fits the
            "I don't know what I want yet; show me affordances" intent. */}
        <div className="main-surface">
          <section
            className="tab-body"
            role="region"
            id="project-home"
            aria-label={`${project.name} home`}
            tabIndex={0}
          >
            <HomeTabA project={project} />
          </section>
        </div>
      </main>
    );
  }

  const visibleTabs = workspace.tabs.filter((t) => !t.closed_at);
  const storedTab = activeTabByWorkspace[workspace.id];
  const activeTab =
    storedTab && storedTab !== "home" && visibleTabs.some((t) => t.id === storedTab)
      ? storedTab
      : visibleTabs[0]?.id ?? null;

  const onOpenTab = async () => {
    // Post-13.1: every new tab is a thread. No template picker.
    const tabIndex = visibleTabs.length + 1;
    const tab = await ipcClient().openTab({
      workspace_id: workspace.id,
      title: `Tab ${tabIndex}`,
      template: "thread",
    });
    if (workspace.project_id) {
      await refreshWorkspaces(workspace.project_id);
    }
    selectTab(workspace.id, tab.id);
  };

  return (
    <main className="app-main" aria-label="Main" id="main-content" tabIndex={-1}>
      {/* Workspace chrome: the tabs bar is the top row. Workspace name,
          branch, and lifecycle state all live in the left sidebar already. */}
      <div className="tabs-bar" role="tablist" aria-orientation="horizontal">
        {visibleTabs.map((tab, idx) => (
          <TabButton
            key={tab.id}
            workspaceId={workspace.id}
            id={tab.id}
            label={displayLabel(tab, idx)}
            active={activeTab === tab.id}
            onClose={async () => {
              await ipcClient().closeTab(workspace.id, tab.id);
              await refreshWorkspaces(workspace.project_id);
              const remaining = visibleTabs.filter((t) => t.id !== tab.id);
              if (activeTab === tab.id && remaining[0]) {
                selectTab(workspace.id, remaining[0].id);
              }
            }}
          />
        ))}
        <div className="new-tab">
          <IconButton label="New tab" shortcut="⌘T" onClick={() => void onOpenTab()}>
            <IconPlus />
          </IconButton>
        </div>
        <CostChip workspaceId={workspace.id} />
      </div>

      <div className="main-surface">
        {visibleTabs.length > 0 && activeTab !== null ? (
          <section
            className="tab-body"
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
            aria-labelledby={`tab-${workspace.id}-${activeTab}`}
            tabIndex={0}
          >
            <WorkspaceThread
              key={`${workspace.id}:${activeTab}`}
              workspace={workspace}
            />
          </section>
        ) : (
          <section className="tab-body" role="region" tabIndex={0}>
            <div className="main-empty">
              <h2 className="main-empty__title">No tabs yet</h2>
              <p className="main-empty__body">
                Open a new tab with the + button above to start a thread.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

/** Normalize legacy tab titles ("Plan", "Design", "Build", "Blank tab") to
 *  "Tab N" so the unified surface doesn't telegraph the old rigid types.
 *  Auto-generated titles ("Tab 1" / "Tab 2" from the + button) also reindex
 *  based on current position so closing a middle tab doesn't leave a gap.
 *  User-renamed tabs keep their title. */
function displayLabel(tab: Tab, index: number): string {
  const legacyTypes = new Set(["Plan", "Design", "Build", "Blank tab", "Thread"]);
  if (legacyTypes.has(tab.title)) return `Tab ${index + 1}`;
  // Auto-generated "Tab N" titles reindex — this keeps the visible
  // sequence tidy when intermediate tabs close.
  if (/^Tab \d+$/.test(tab.title)) return `Tab ${index + 1}`;
  return tab.title;
}

function TabButton({
  id,
  workspaceId,
  label,
  active,
  onClose,
}: {
  id: Tab["id"];
  workspaceId: string;
  label: string;
  active: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="tab-button-wrap" data-active={active}>
      <Tooltip label={label} shortcut={active && onClose ? "⌘W" : undefined}>
        <button
          type="button"
          role="tab"
          id={`tab-${workspaceId}-${id}`}
          aria-selected={active}
          aria-controls={`tabpanel-${id}`}
          tabIndex={active ? 0 : -1}
          className="tab-button"
          data-active={active}
          onClick={() => selectTab(workspaceId, id)}
          onAuxClick={(e) => {
            if (e.button === 1 && onClose) {
              e.preventDefault();
              onClose();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const parent = (e.currentTarget.parentElement?.parentElement as HTMLElement) || null;
              if (!parent) return;
              const tabs = Array.from(
                parent.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
              );
              const idx = tabs.indexOf(e.currentTarget);
              if (idx < 0) return;
              const next =
                e.key === "ArrowRight"
                  ? tabs[(idx + 1) % tabs.length]
                  : tabs[(idx - 1 + tabs.length) % tabs.length];
              next.focus();
              next.click();
            } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w" && onClose) {
              e.preventDefault();
              onClose();
            }
          }}
        >
          <span className="tab-button__label">{label}</span>
        </button>
      </Tooltip>
      {onClose && (
        <button
          type="button"
          className="tab-button__close"
          aria-label={`Close ${label}`}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <IconX size={16} />
        </button>
      )}
    </div>
  );
}

